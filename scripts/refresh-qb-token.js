require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const OAuthClient = require('intuit-oauth');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data: integ } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
    
    console.log('Current token expires:', integ.expires_at);
    console.log('Current token updated:', integ.updated_at);
    console.log('Refresh token starts:', integ.refresh_token?.substring(0, 30) + '...');
    
    const authClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
    });

    try {
        console.log('\nRefreshing token...');
        const authResponse = await authClient.refreshUsingToken(integ.refresh_token);
        const tokens = authResponse.getJson();
        
        const { error } = await supabase.from('integrations').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000),
            updated_at: new Date(),
        }).eq('id', integ.id);

        if (error) console.log('DB Error:', error.message);
        else {
            console.log('✅ Token refreshed and saved!');
            console.log('New expires:', new Date(Date.now() + tokens.expires_in * 1000).toISOString());
        }
    } catch (e) {
        console.log('❌ Refresh failed:', e.originalMessage || e.message);
        console.log('\nEl refresh_token también expiró. Necesitas re-autenticar desde localhost:');
        console.log('→ http://localhost:3000/api/integrations/quickbooks/connect');
    }
})();
