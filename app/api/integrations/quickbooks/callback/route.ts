import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient, getSanitizedRedirectUri, saveLocalSandboxIntegration } from '@/lib/quickbooks';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
);

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const sanitizedRedirect = getSanitizedRedirectUri();
    
    // Reconstruir la URL de callback exactamente usando el redirectUri sanitizado y la query string recibida.
    // Esto garantiza 100% de coincidencia entre authorizeUri, redirectUri de OAuthClient y la respuesta de Intuit.
    const parseRedirect = `${sanitizedRedirect}${url.search}`;

    try {
        const client = getAuthClient();
        // 1. Exchange auth code for tokens
        const authResponse = await client.createToken(parseRedirect);
        const tokens = authResponse.getJson();

        const realmId = url.searchParams.get('realmId');

        if (!realmId) {
            return NextResponse.json({ error: 'Missing Realm ID (Company ID)' }, { status: 400 });
        }

        // 2. Store tokens: Check if this realmId belongs to External Accounting (Raquel's 8 companies) or main Tacos Gavilan
        const stateParam = url.searchParams.get('state') || '';
        const { data: extCompany } = await supabase
            .from('external_accounting_companies')
            .select('realm_id, company_name, metadata')
            .eq('realm_id', realmId)
            .maybeSingle();

        const isExternalCompany = Boolean(extCompany) || stateParam.startsWith('external:');

        if (isExternalCompany) {
            const expiresIso = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
            const nowIso = new Date().toISOString();

            // Save in integrations under a dedicated service_name so we NEVER overwrite Tacos Gavilan's main `quickbooks` row (187736243)
            const { error: intErr } = await supabase
                .from('integrations')
                .upsert({
                    service_name: `quickbooks_ext_${realmId}`,
                    realm_id: realmId,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_type: tokens.token_type || 'Bearer',
                    expires_at: expiresIso,
                    updated_at: nowIso,
                }, { onConflict: 'service_name' });

            if (intErr) {
                console.error('Database error saving external QB integration:', intErr);
            }

            if (extCompany) {
                const currMeta = extCompany.metadata && typeof extCompany.metadata === 'object' ? extCompany.metadata : {};
                const updatedMeta = {
                    ...currMeta,
                    qbo_sync_enabled: currMeta.qbo_sync_enabled !== false,
                    qbo_oauth: {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        token_type: tokens.token_type || 'Bearer',
                        expires_at: expiresIso,
                        connected_at: nowIso,
                        updated_at: nowIso,
                        last_sync_error: null,
                    }
                };
                await supabase
                    .from('external_accounting_companies')
                    .update({ metadata: updatedMeta, updated_at: nowIso })
                    .eq('realm_id', realmId);
            }
        } else if (process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox') {
            saveLocalSandboxIntegration(tokens, realmId);
            console.log('✅ Sandbox tokens saved locally to .sandbox_tokens.json');
        } else {
            const { error } = await supabase
                .from('integrations')
                .upsert({
                    service_name: 'quickbooks',
                    realm_id: realmId,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_type: tokens.token_type,
                    expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                    updated_at: new Date(),
                }, { onConflict: 'service_name' });

            if (error) {
                console.error('Database error:', error);
                return NextResponse.json({ error: 'Failed to save tokens' }, { status: 500 });
            }
        }

        return new NextResponse(
            `<html>
                <head>
                    <meta charset="utf-8">
                    <title>QuickBooks Conectado</title>
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0;">
                    <div style="max-width: 420px; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05); border: 1px border-slate-100;">
                        <div style="font-size: 48px; margin-bottom: 20px;">🔌</div>
                        <h1 style="color: #10b981; font-size: 24px; font-weight: 800; margin: 0 0 10px 0; tracking: -0.025em;">¡Conexión Exitosa!</h1>
                        <p style="font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 24px 0;">La sesión con QuickBooks se ha iniciado correctamente. Esta ventana se cerrará automáticamente en un momento...</p>
                        <div style="display: inline-block; width: 20px; height: 20px; border: 3px solid #e2e8f0; border-radius: 50%; border-top-color: #10b981; animation: spin 1s ease-in-out infinite;"></div>
                    </div>
                    <style>
                        @keyframes spin { to { transform: rotate(360deg); } }
                    </style>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage("qb_authorized", "*");
                        }
                        setTimeout(() => { window.close(); }, 2000);
                    </script>
                </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );

    } catch (error: any) {
        console.error('OAuth Error:', error);
        const errorDetails = {
            error: 'Authentication Failed',
            message: error?.message || 'Unknown error',
            originalMessage: error?.originalMessage || error?.authResponse?.json?.error || null,
            intuit_error: error?.authResponse?.json || null,
            statusCode: error?.authResponse?.statusCode || null,
            configured_redirect_uri: process.env.QUICKBOOKS_REDIRECT_URI,
            configured_environment: process.env.QUICKBOOKS_ENVIRONMENT,
            configured_client_id_prefix: process.env.QUICKBOOKS_CLIENT_ID?.substring(0, 8) + '...',
            actual_callback_url: url.href,
        };
        console.error('OAuth Error Details:', JSON.stringify(errorDetails, null, 2));
        return NextResponse.json(errorDetails, { status: 500 });
    }
}
