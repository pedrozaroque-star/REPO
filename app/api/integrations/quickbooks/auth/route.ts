/**
 * @module api/integrations/quickbooks/auth
 * @description Inicia el flujo OAuth 2.0 con Intuit QuickBooks Online exigiendo sesión autenticada en servidor,
 * firmando criptográficamente el parámetro `state` (HMAC-SHA256) y fijando cookie HttpOnly `qb_oauth_nonce`.
 *
 * @businessRules
 * - `mode=external` o `mode=external_all`: exclusivo para usuarios autorizados de Contabilidad Externa (Raquel 45, Roberto 46, Roque 47).
 * - Modo principal (`init`): exclusivo para administradores (`role === 'admin'`) de Tacos Gavilan.
 * - `external_all` omite empresas retiradas de QBO (`qbo_sync_enabled === false`).
 *
 * @dataFlow
 * - GET `/api/integrations/quickbooks/auth` -> valida JWT -> genera `state` firmado + cookie `qb_oauth_nonce` -> redirect a Intuit.
 *
 * @notes
 * - 2026-11-12 (Wave P0 Security): Cerrado acceso anónimo y añadida protección anti-CSRF con HMAC-SHA256.
 */

import { NextRequest, NextResponse } from 'next/server';
import OAuthClient from 'intuit-oauth';
import { createClient } from '@supabase/supabase-js';
import { getAuthClient, signQuickBooksOAuthState, QB_OAUTH_NONCE_COOKIE } from '@/lib/quickbooks';
import { authorizeExternalAccounting } from '@/lib/external-accounting-auth';
import { getServerUser } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

const FIRM_REALM_ID = '123145825185692';

function getServiceSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Missing Supabase service configuration');
    }
    return createClient(url, key);
}

export async function GET(req: NextRequest) {
    try {
        const supabase = getServiceSupabase();
        const url = new URL(req.url);
        const rawMode = (url.searchParams.get('mode') || '').trim();
        const isExternalMode = rawMode === 'external' || rawMode === 'external_all';
        let authorizedUserId = '';

        if (isExternalMode) {
            const extAuth = await authorizeExternalAccounting(req, supabase);
            if (!extAuth.authorized) {
                return NextResponse.json({ error: extAuth.error }, { status: extAuth.status });
            }
            authorizedUserId = String(extAuth.user.id);
        } else {
            const adminUser = await getServerUser(req);
            if (!adminUser || String(adminUser.role || '').toLowerCase() !== 'admin') {
                const extAuth = await authorizeExternalAccounting(req, supabase);
                if (!extAuth.authorized) {
                    return NextResponse.json(
                        { error: 'No autorizado: Se requiere sesión de Administrador o Contabilidad Externa.' },
                        { status: adminUser ? 403 : 401 }
                    );
                }
                authorizedUserId = String(extAuth.user.id);
            } else {
                authorizedUserId = String(adminUser.id);
            }
        }

        let targetRealmId = (url.searchParams.get('realmId') || '').trim();

        if (rawMode === 'external' && targetRealmId) {
            const { data: targetComp } = await supabase
                .from('external_accounting_companies')
                .select('realm_id, metadata')
                .eq('realm_id', targetRealmId)
                .maybeSingle();

            if (!targetComp) {
                return NextResponse.json({ error: 'Empresa externa no registrada.' }, { status: 404 });
            }
            if (targetComp.metadata?.qbo_sync_enabled === false) {
                return NextResponse.json(
                    { error: 'Esta empresa opera en modo local autónomo (retirada de QBO).' },
                    { status: 400 }
                );
            }
        }

        if (rawMode === 'external_all' && !targetRealmId) {
            const { data: allComps } = await supabase
                .from('external_accounting_companies')
                .select('realm_id, metadata')
                .order('company_name', { ascending: true });

            const activeQboComps = (allComps || []).filter(
                (c: any) => c.metadata?.qbo_sync_enabled !== false
            );
            const firstUnconnected = activeQboComps.find(
                (c: any) => !c.metadata?.qbo_oauth?.refresh_token
            );
            targetRealmId = firstUnconnected?.realm_id || activeQboComps[0]?.realm_id || '';
        }

        const effectiveMode: 'init' | 'external' | 'external_all' =
            rawMode === 'external_all'
                ? 'external_all'
                : rawMode === 'external'
                ? 'external'
                : 'init';

        const existingNonceCookie = req.cookies.get(QB_OAUTH_NONCE_COOKIE)?.value?.trim();
        const { state: signedState, nonce } = signQuickBooksOAuthState({
            mode: effectiveMode,
            targetRealmId,
            userId: authorizedUserId,
            nonce: existingNonceCookie || undefined,
        });

        const client = getAuthClient();
        let authUri = client.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: signedState,
        });

        if (isExternalMode && targetRealmId) {
            authUri =
                authUri.replace(
                    'https://appcenter.intuit.com/connect/oauth2?',
                    'https://appcenter.intuit.com/app/connect/oauth2/authorize?'
                ) + `&locale=en-us&realm_id=${encodeURIComponent(targetRealmId)}&firm_id=${FIRM_REALM_ID}`;
        }

        const res = NextResponse.redirect(authUri);
        res.cookies.set(QB_OAUTH_NONCE_COOKIE, nonce, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 15 * 60,
        });
        return res;
    } catch (error: any) {
        console.error('[QuickBooks Auth] Error initiating OAuth:', error);
        return NextResponse.json({ error: 'Failed to initiate QuickBooks authentication' }, { status: 500 });
    }
}
