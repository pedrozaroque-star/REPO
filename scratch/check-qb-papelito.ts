// Must load env BEFORE any imports that use env vars
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Set env vars that quickbooks.ts needs at module-level
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

import { createClient } from '@supabase/supabase-js';

async function checkQBPapelito() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('service_name', 'quickbooks')
        .single();

    if (!integration) { console.log('No QB integration found'); return; }

    // Use intuit-oauth directly instead of importing from quickbooks.ts
    const OAuthClient = (await import('intuit-oauth')).default;
    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
        environment: process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        redirectUri: 'https://teg-modernizado.vercel.app/api/integrations/quickbooks/callback'
    });

    let accessToken = integration.access_token;
    try {
        const authResponse = await oauthClient.refreshUsingToken(integration.refresh_token);
        const tokens = authResponse.getJson();
        accessToken = tokens.access_token;
        await supabase.from('integrations').update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
        }).eq('id', integration.id);
    } catch (e: any) { 
        console.error('Token refresh failed:', e.message); 
    }

    const QuickBooks = (await import('node-quickbooks')).default;
    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID,
        process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken,
        false,
        integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? false : true,
        false, null, '2.0', integration.refresh_token
    );

    const qbItems = await new Promise<any[]>((resolve, reject) => {
        qbo.findItems({ active: true }, (err: any, result: any) => {
            if (err) reject(err);
            else resolve(result?.QueryResponse?.Item || []);
        });
    });

    const papelitos = qbItems.filter((i: any) => i.Name.toLowerCase().includes('papelito'));
    console.log(`\n=== QB ITEMS matching "papelito" (${papelitos.length} found) ===`);
    papelitos.forEach((p: any) => {
        console.log(`  ID: ${p.Id} | Name: "${p.Name}" | Type: ${p.Type}`);
        console.log(`    UnitPrice (Sale Price): $${p.UnitPrice}`);
        console.log(`    PurchaseCost (Buy Price): $${p.PurchaseCost || 'N/A'}`);
        console.log(`    Description: ${p.Description || 'N/A'}`);
        console.log(`    PurchaseDesc: ${p.PurchaseDesc || 'N/A'}`);
        console.log('');
    });

    // Also check Asada while we're at it
    const asadas = qbItems.filter((i: any) => i.Name.toLowerCase().includes('asada'));
    console.log(`=== QB ITEMS matching "asada" (${asadas.length} found) ===`);
    asadas.forEach((p: any) => {
        console.log(`  ID: ${p.Id} | Name: "${p.Name}" | Type: ${p.Type}`);
        console.log(`    UnitPrice (Sale): $${p.UnitPrice} | PurchaseCost (Buy): $${p.PurchaseCost || 'N/A'}`);
    });
}

checkQBPapelito();
