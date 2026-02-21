
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
import OAuthClient from 'intuit-oauth';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkAsadaQuery() {
    const { data: integration } = await supabase.from('integrations').select('*').single();
    if (!integration) return;

    const oauthClient = new OAuthClient({
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        environment: process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production',
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
    });

    oauthClient.setToken(integration);
    let accessToken = integration.access_token;

    try {
        console.log('Refrescando token...');
        const authResponse = await oauthClient.refresh();
        const newToken = authResponse.getJson();
        accessToken = newToken.access_token;

        await supabase.from('integrations').update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);
        console.log('✅ Token renovado.');
    } catch (e) {
        console.log('Token vigente o error de refresco.');
    }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    console.log('--- BUSCANDO VARIACIONES DE ASADA ---');

    qbo.findItems({ active: true }, (err, result) => {
        if (err) {
            console.error('Error:', err);
            return;
        }
        const items = result?.QueryResponse?.Item || [];
        const asadaItems = items.filter(i =>
            (i.Name || '').toLowerCase().includes('asada') ||
            (i.Description || '').toLowerCase().includes('asada') ||
            i.Sku === '009W'
        );

        asadaItems.forEach(a => {
            console.log(`- NOMBRE: ${a.Name}`);
            console.log(`  SKU: ${a.Sku}`);
            console.log(`  COSTO (PurchaseCost): $${a.PurchaseCost}`);
            console.log(`  PRECIO (UnitPrice): $${a.UnitPrice}`);
            console.log(`  DESC: ${a.Description}`);
            console.log(`  ID: ${a.Id}`);
            console.log('---------------------------');
        });

        const priceMatches = items.filter(i => i.PurchaseCost === 61.2);
        if (priceMatches.length > 0) {
            console.log('\n--- OTROS PRODUCTOS QUE CUESTAN $61.20 ---');
            priceMatches.forEach(p => console.log(`- ${p.Name} (SKU: ${p.Sku})`));
        }
    });
}

checkAsadaQuery().catch(console.error);
