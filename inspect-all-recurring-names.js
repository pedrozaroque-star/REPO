import { createClient } from '@supabase/supabase-js';
import OAuthClient from 'intuit-oauth';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const authClient = new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
    environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
});

async function run() {
    const { data: integration, error } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();
        
    if (error || !integration) {
        console.error('Error loading integration:', error);
        return;
    }
    
    // Attempt token refresh just in case it works now or we want to try fetching
    let token = integration.access_token;
    try {
        const authResponse = await authClient.refreshUsingToken(integration.refresh_token);
        const tokens = authResponse.getJson();
        token = tokens.access_token;
        console.log('✅ Token refreshed successfully.');
    } catch (e) {
        console.log('⚠️ Token refresh failed (using existing access token):', e.message);
    }
    
    const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${integration.realm_id}/query?query=${encodeURIComponent("SELECT * FROM RecurringTransaction")}&minorversion=75`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    });
    
    if (!res.ok) {
        console.error(`QB Query Failed: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.error('Body:', text);
        return;
    }
    
    const data = await res.json();
    const list = data?.QueryResponse?.RecurringTransaction || [];
    console.log(`\n--- Found ${list.length} Recurring Transactions ---`);
    list.forEach(t => {
        const est = t.Estimate || t.Invoice || t.SalesReceipt || {};
        const name = est.RecurringInfo?.Name || 'No Name';
        const type = t.Estimate ? 'Estimate' : t.Invoice ? 'Invoice' : 'Other';
        console.log(`- Name: "${name}" [Type: ${type}] (CustomerRef: ${est.CustomerRef?.value || 'None'})`);
    });
}
run();
