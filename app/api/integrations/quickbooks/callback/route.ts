/**
 * @module api/integrations/quickbooks/callback
 * @description Procesa el callback OAuth 2.0 de Intuit QuickBooks Online verificando criptográficamente
 * la firma HMAC-SHA256 del parámetro `state`, el nonce HttpOnly (`qb_oauth_nonce`) y el aislamiento de `realmId`.
 *
 * @businessRules
 * - Rechaza cualquier callback sin `state` firmado válido o sin coincidencia exacta de cookie `qb_oauth_nonce` (HTTP 403).
 * - Si `mode` es `external` o `external_all`, exige que `realmId` exista en `external_accounting_companies` y jamás toca `integrations.service_name = 'quickbooks'`.
 * - Si `mode` es `init` (Tacos Gavilan), verifica que no sobreescriba accidentalmente el `realm_id` productivo existente con otro `realmId` ajeno.
 * - Escapa todas las cadenas interpoladas en HTML/JS y restringe `postMessage` a `window.location.origin`.
 *
 * @dataFlow
 * - Intuit OAuth Redirect -> `verifyQuickBooksOAuthState` -> `client.createToken` -> persistencia aislada en Supabase.
 *
 * @notes
 * - 2026-11-12 (Wave P0 Security): Eliminada vulnerabilidad de sobreescritura CSRF de tokens, XSS reflejado y fuga de variables de entorno en errores 500.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    getAuthClient,
    getSanitizedRedirectUri,
    saveLocalSandboxIntegration,
    verifyQuickBooksOAuthState,
    escapeQbHtml,
    safeInlineJson,
    QB_OAUTH_NONCE_COOKIE,
} from '@/lib/quickbooks';

export const dynamic = 'force-dynamic';

function getServiceSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Missing Supabase service configuration');
    }
    return createClient(url, key);
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const sanitizedRedirect = getSanitizedRedirectUri();
    const parseRedirect = `${sanitizedRedirect}${url.search}`;

    try {
        const stateParam = url.searchParams.get('state');
        const rawCookieHeader = req.headers.get('cookie') || '';
        const fallbackCookieNonce = rawCookieHeader.match(new RegExp(`(?:^|;\\s*)${QB_OAUTH_NONCE_COOKIE}=([^;]+)`))?.[1];
        const cookieNonce = req.cookies?.get?.(QB_OAUTH_NONCE_COOKIE)?.value || (fallbackCookieNonce ? decodeURIComponent(fallbackCookieNonce) : undefined);
        const verifiedState = verifyQuickBooksOAuthState(stateParam, cookieNonce);

        if (!verifiedState) {
            return NextResponse.json(
                { error: 'Invalid, expired, or unverified QuickBooks OAuth state. Please start authorization from the application.' },
                { status: 403 }
            );
        }

        const realmId = (url.searchParams.get('realmId') || '').trim();
        if (!realmId || !/^\d{5,30}$/.test(realmId)) {
            return NextResponse.json({ error: 'Missing or invalid Realm ID (Company ID)' }, { status: 400 });
        }

        const supabase = getServiceSupabase();
        const client = getAuthClient();
        const authResponse = await client.createToken(parseRedirect);
        const tokens = authResponse.getJson();

        const isExternalFlow = verifiedState.m === 'external' || verifiedState.m === 'external_all';

        if (isExternalFlow) {
            if (verifiedState.r && verifiedState.r !== realmId) {
                return NextResponse.json(
                    { error: `Realm mismatch: expected ${verifiedState.r} but received ${realmId}` },
                    { status: 403 }
                );
            }

            const { data: extCompany } = await supabase
                .from('external_accounting_companies')
                .select('realm_id, company_name, metadata')
                .eq('realm_id', realmId)
                .maybeSingle();

            if (!extCompany) {
                return NextResponse.json(
                    { error: 'Company realm is not registered in External Accounting.' },
                    { status: 403 }
                );
            }

            const expiresIso = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
            const nowIso = new Date().toISOString();

            const { error: intErr } = await supabase
                .from('integrations')
                .upsert(
                    {
                        service_name: `quickbooks_ext_${realmId}`,
                        realm_id: realmId,
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        token_type: tokens.token_type || 'Bearer',
                        expires_at: expiresIso,
                        updated_at: nowIso,
                    },
                    { onConflict: 'service_name' }
                );

            if (intErr) {
                console.error('[QuickBooks Callback] Database error saving external QB integration:', intErr);
            }

            const currMeta = extCompany.metadata && typeof extCompany.metadata === 'object' ? extCompany.metadata : {};
            const { qbo_refresh_lock_until: _dropLock, ...cleanMeta } = currMeta as Record<string, any>;
            const updatedMeta = {
                ...cleanMeta,
                qbo_sync_enabled: currMeta.qbo_sync_enabled !== false,
                qbo_oauth: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_type: tokens.token_type || 'Bearer',
                    expires_at: expiresIso,
                    connected_at: nowIso,
                    updated_at: nowIso,
                    last_sync_error: null,
                },
            };

            await supabase
                .from('external_accounting_companies')
                .update({ metadata: updatedMeta, updated_at: nowIso })
                .eq('realm_id', realmId);

            if (verifiedState.m === 'external_all') {
                const { data: allComps } = await supabase
                    .from('external_accounting_companies')
                    .select('realm_id, company_name, metadata')
                    .order('company_name', { ascending: true });

                const activeQboComps = (allComps || []).filter(
                    (c: any) => c.metadata?.qbo_sync_enabled !== false
                );
                const totalComps = activeQboComps.length;
                const unconnected = activeQboComps.filter(
                    (c: any) => !c.metadata?.qbo_oauth?.refresh_token
                );
                const connectedCount = totalComps - unconnected.length;

                if (unconnected.length > 0) {
                    const nextComp = unconnected[0];
                    const nextAuthUrl = `/api/integrations/quickbooks/auth?mode=external_all&realmId=${encodeURIComponent(nextComp.realm_id)}`;
                    const safeConnectedTitle = escapeQbHtml(extCompany.company_name || realmId);
                    const safeNextName = escapeQbHtml(nextComp.company_name || nextComp.realm_id);
                    const msgJson = safeInlineJson({ type: 'qb_external_authorized', realmId });
                    const nextUrlJson = safeInlineJson(nextAuthUrl);

                    return new NextResponse(
                        `<!DOCTYPE html>
                        <html>
                            <head>
                                <meta charset="utf-8">
                                <title>Conectando Empresas (${connectedCount}/${totalComps})</title>
                            </head>
                            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0;">
                                <div style="max-width: 440px; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);">
                                    <div style="font-size: 42px; margin-bottom: 16px;">⚡</div>
                                    <h1 style="color: #10b981; font-size: 20px; font-weight: 800; margin: 0 0 8px 0;">
                                        Conectada (${connectedCount}/${totalComps}): ${safeConnectedTitle}
                                    </h1>
                                    <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 20px 0;">
                                        Avanzando automáticamente a la siguiente empresa:<br/>
                                        <strong style="color: #0f172a;">${safeNextName}</strong>...
                                    </p>
                                    <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid #e2e8f0; border-radius: 50%; border-top-color: #10b981; animation: spin 0.8s linear infinite;"></div>
                                </div>
                                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                                <script>
                                    if (window.opener) {
                                        window.opener.postMessage(${msgJson}, window.location.origin);
                                    }
                                    setTimeout(function () { window.location.href = ${nextUrlJson}; }, 400);
                                </script>
                            </body>
                        </html>`,
                        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                    );
                }
            }
        } else if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
            saveLocalSandboxIntegration(tokens, realmId);
        } else {
            // Protect main Tacos Gavilan QuickBooks integration from accidental cross-realm overwrite
            const { data: existingMain } = await supabase
                .from('integrations')
                .select('realm_id')
                .eq('service_name', 'quickbooks')
                .maybeSingle();

            if (existingMain?.realm_id && String(existingMain.realm_id) !== realmId) {
                return NextResponse.json(
                    {
                        error: `Realm protection triggered: main Tacos Gavilan QuickBooks integration is bound to realm ${existingMain.realm_id}, refusing to overwrite with ${realmId}. Use mode=external for External Accounting companies.`,
                    },
                    { status: 409 }
                );
            }

            const { error } = await supabase
                .from('integrations')
                .upsert(
                    {
                        service_name: 'quickbooks',
                        realm_id: realmId,
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        token_type: tokens.token_type,
                        expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
                        updated_at: new Date(),
                    },
                    { onConflict: 'service_name' }
                );

            if (error) {
                console.error('[QuickBooks Callback] Database error saving tokens:', error);
                return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 });
            }
        }

        const doneMsgJson = safeInlineJson(
            isExternalFlow ? { type: 'qb_external_authorized', realmId } : 'qb_authorized'
        );
        const res = new NextResponse(
            `<!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>QuickBooks Conectado</title>
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0;">
                    <div style="max-width: 420px; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05);">
                        <div style="font-size: 48px; margin-bottom: 20px;">🔌</div>
                        <h1 style="color: #10b981; font-size: 24px; font-weight: 800; margin: 0 0 10px 0;">¡Conexión Exitosa!</h1>
                        <p style="font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 24px 0;">Todas las cuentas seleccionadas de QuickBooks están conectadas. Esta ventana se cerrará automáticamente...</p>
                        <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid #e2e8f0; border-radius: 50%; border-top-color: #10b981; animation: spin 1s ease-in-out infinite;"></div>
                    </div>
                    <style>
                        @keyframes spin { to { transform: rotate(360deg); } }
                    </style>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage(${doneMsgJson}, window.location.origin);
                        }
                        setTimeout(function () { window.close(); }, 1500);
                    </script>
                </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
        res.cookies.delete(QB_OAUTH_NONCE_COOKIE);
        return res;
    } catch (error: any) {
        console.error('[QuickBooks Callback] OAuth Error:', error?.message || error);
        return NextResponse.json(
            { error: 'QuickBooks authentication failed. Please retry from an authorized session.' },
            { status: 500 }
        );
    }
}
