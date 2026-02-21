
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

async function deepInspectAsada() {
    console.log('--- INSPECCIÓN PROFUNDA DE "CARNE ASADA" EN QUICKBOOKS ---');

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
        const authResponse = await oauthClient.refresh();
        const newToken = authResponse.getJson();
        accessToken = newToken.access_token;
        await supabase.from('integrations').update({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            updated_at: new Date()
        }).eq('id', integration.id);
    } catch (e) { }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    // Buscamos todos los items para ver si hay duplicados o variaciones de nombre
    qbo.findItems({ active: true }, (err, result) => {
        if (err) {
            console.error('Error fetching items:', err);
            return;
        }

        const items = result?.QueryResponse?.Item || [];
        console.log(`Total de items encontrados: ${items.length}`);

        const matches = items.filter(i =>
            (i.Name || '').toLowerCase().includes('asada') ||
            (i.Sku || '').toLowerCase().includes('009w')
        );

        console.log(`\nCoincidencias encontradas: ${matches.length}`);

        matches.forEach(item => {
            console.log('\n=========================================');
            console.log(`NOMBRE: ${item.Name}`);
            console.log(`FQN: ${item.FullyQualifiedName}`);
            console.log(`SKU: ${item.Sku}`);
            console.log(`ID: ${item.Id}`);
            console.log(`COSTO DE COMPRA (PurchaseCost): $${item.PurchaseCost}`);
            console.log(`PRECIO DE VENTA (UnitPrice): $${item.UnitPrice}`);
            console.log(`PRECIO DE VENTA (SALES): $${item.SalesPrice || 'N/A'}`);
            console.log(`MARCADOR DE PRECIO (Rate): $${item.Rate || 'N/A'}`);
            console.log(`DESCRIPCIÓN: ${item.Description}`);
            console.log('JSON COMPLETO:', JSON.stringify(item, null, 2));
            console.log('=========================================\n');
        });
    });
}

deepInspectAsada().catch(console.error);
