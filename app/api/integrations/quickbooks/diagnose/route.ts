/**
 * @module api/integrations/quickbooks/diagnose
 * @description Diagnóstico administrativo protegido de configuración OAuth de QuickBooks Online.
 *
 * @businessRules
 * - Acceso exclusivo para Administradores de Tacos Gavilan (`role === 'admin'`) o usuarios autorizados de Contabilidad Externa.
 * - Jamás expone `stack`, secretos ni enlaces OAuth sin firma HMAC-SHA256.
 *
 * @dataFlow
 * - GET `/api/integrations/quickbooks/diagnose` -> valida JWT -> genera enlace firmado -> muestra estado sanitizado.
 *
 * @notes
 * - 2026-11-12 (Wave P0 Security): Cerrado endpoint público anónimo y eliminada exposición de stack traces.
 */

import { NextRequest, NextResponse } from 'next/server';
import OAuthClient from 'intuit-oauth';
import { createClient } from '@supabase/supabase-js';
import {
    getAuthClient,
    signQuickBooksOAuthState,
    escapeQbHtml,
    QB_OAUTH_NONCE_COOKIE,
} from '@/lib/quickbooks';
import { getServerUser } from '@/lib/auth-server';
import { authorizeExternalAccounting } from '@/lib/external-accounting-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const adminUser = await getServerUser(req);
        let authorizedUserId = '';

        if (adminUser && String(adminUser.role || '').toLowerCase() === 'admin') {
            authorizedUserId = String(adminUser.id);
        } else {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (!url || !key) {
                return NextResponse.json({ error: 'Server configuration unavailable' }, { status: 500 });
            }
            const supabase = createClient(url, key);
            const extAuth = await authorizeExternalAccounting(req, supabase);
            if (!extAuth.authorized) {
                return NextResponse.json(
                    { error: 'No autorizado: Diagnóstico restringido a Administradores.' },
                    { status: adminUser ? 403 : 401 }
                );
            }
            authorizedUserId = String(extAuth.user.id);
        }

        const { state: signedState, nonce } = signQuickBooksOAuthState({
            mode: 'diagnose',
            userId: authorizedUserId,
        });

        const client = getAuthClient();
        const authUri = client.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
            state: signedState,
        });

        const safeEnv = escapeQbHtml(process.env.QUICKBOOKS_ENVIRONMENT || 'unknown');
        const safeRedirect = escapeQbHtml(process.env.QUICKBOOKS_REDIRECT_URI || '');
        const safeAuthUri = escapeQbHtml(authUri);

        const html = `<!DOCTYPE html>
        <html>
            <head><meta charset="utf-8"><title>QuickBooks Diagnostics</title></head>
            <body style="font-family: sans-serif; padding: 20px;">
                <h1>QuickBooks Connection Diagnostics</h1>
                <div style="background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                    <h3>Current Configuration:</h3>
                    <p><strong>Environment:</strong> ${safeEnv}</p>
                    <p><strong>Redirect URI:</strong> ${safeRedirect}</p>
                </div>
                <div style="background: #e6f7ff; padding: 15px; border-radius: 5px; border: 1px solid #91d5ff;">
                    <p>Compare the Redirect URI above with the Intuit Developer Portal, or test authorization:</p>
                    <a href="${safeAuthUri}" style="display: inline-block; background: #0077c5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Connect to QuickBooks</a>
                </div>
            </body>
        </html>`;

        const res = new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
        res.cookies.set(QB_OAUTH_NONCE_COOKIE, nonce, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 15 * 60,
        });
        return res;
    } catch (error: any) {
        console.error('[QuickBooks Diagnose] Error:', error?.message || error);
        return NextResponse.json({ error: 'Diagnostics failed' }, { status: 500 });
    }
}
