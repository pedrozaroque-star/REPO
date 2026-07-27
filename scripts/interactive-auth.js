require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const OAuthClient = require('intuit-oauth');
const readline = require('readline');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const authClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

(async () => {
    // 1. Generate Auth URL
    const authUri = authClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
        state: 'init',
    });

    console.log('\n================================================================');
    console.log('⚡ ASISTENTE DE RE-AUTENTICACIÓN INTERACTIVA DE QUICKBOOKS ⚡');
    console.log('================================================================');
    console.log('\nPaso 1: Copia y abre este enlace en tu navegador:');
    console.log('\x1b[36m%s\x1b[0m', authUri);
    console.log('\nPaso 2: Inicia sesión con la cuenta Administradora y autoriza.');
    console.log('\nPaso 3: QuickBooks te redirigirá a una página que puede decir "Authentication Failed".');
    console.log('NO TE PREOCUPES POR ESE ERROR. Copia la URL completa de la barra de direcciones.');
    console.log('Debería verse algo como: https://tacosgavilan.vercel.app/api/integrations/quickbooks/callback?code=...&state=...&realmId=...');
    
    rl.question('\nPaso 4: Pega la URL completa aquí y presiona ENTER:\n> ', async (pastedUrl) => {
        try {
            console.log('\nProcesando token...');
            const authResponse = await authClient.createToken(pastedUrl.trim());
            const tokens = authResponse.getJson();
            const realmId = new URL(pastedUrl).searchParams.get('realmId');

            if (!realmId) {
                throw new Error('No se encontró el Company ID (realmId) en la URL pegada.');
            }

            console.log('Guardando tokens en Supabase...');
            const { error } = await supabase
                .from('integrations')
                .upsert({
                    service_name: 'quickbooks',
                    realm_id: realmId,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_type: tokens.token_type || 'Bearer',
                    expires_at: new Date(Date.now() + tokens.expires_in * 1000),
                    updated_at: new Date(),
                }, { onConflict: 'service_name' });

            if (error) {
                throw new Error('Error al guardar en Supabase: ' + error.message);
            }

            console.log('\n================================================================');
            console.log('✅ ¡CONEXIÓN CON QUICKBOOKS ACTUALIZADA CON ÉXITO!');
            console.log('================================================================');
            console.log(`Expiración: ${new Date(Date.now() + tokens.expires_in * 1000).toISOString()}`);
            console.log('Ahora puedes regresar a tu localhost:3000 y refrescar la página.');
        } catch (e) {
            console.error('\n❌ Error durante el intercambio:', e.message);
        } finally {
            rl.close();
        }
    });
})();
