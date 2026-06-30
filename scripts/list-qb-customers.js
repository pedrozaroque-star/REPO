require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const OAuthClient = require('intuit-oauth');
const QuickBooks = require('node-quickbooks');

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const {data: integ} = await s.from('integrations').select('*').eq('service_name','quickbooks').single();
    console.log('Token updated at:', integ.updated_at);
    console.log('Token expires at:', integ.expires_at);

    const auth = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI
    });

    let accessToken = integ.access_token;
    try {
        const r = await auth.refreshUsingToken(integ.refresh_token);
        const t = r.getJson();
        accessToken = t.access_token;
        await s.from('integrations').update({
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_at: new Date(Date.now() + t.expires_in * 1000),
            updated_at: new Date()
        }).eq('id', integ.id);
        console.log('Token refresh OK!');
    } catch(e) {
        console.log('Refresh failed:', e.message);
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integ.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
        false, null, '2.0', integ.refresh_token
    );

    qbo.findCustomers({fetchAll: true}, function(err, customers) {
        if (err) {
            console.log('Error:', JSON.stringify(err).slice(0, 500));
            return;
        }
        const list = customers.QueryResponse?.Customer || [];
        console.log('\nTotal customers found:', list.length);
        console.log('\n=== ALL CUSTOMERS ===');
        list.forEach(c => {
            console.log('  ID: ' + String(c.Id).padEnd(6) + ' | ' + c.DisplayName);
        });
    });
})();
