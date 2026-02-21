
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

async function countRawQBItems() {
    const { data: integration } = await supabase.from('integrations').select('*').eq('service_name', 'quickbooks').single();
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
    } catch (e) { }

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        accessToken, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0',
        integration.refresh_token
    );

    console.log('--- CONSULTANDO TODOS LOS ITEMS ACTIVOS EN QUICKBOOKS ---');

    qbo.findItems({ active: true }, (err, result) => {
        if (err) {
            console.error('Error fetching items:', err);
            return;
        }
        const items = result?.QueryResponse?.Item || [];
        console.log(`TOTAL_ITEMS_QB: ${items.length}`);

        // Contar por tipo
        const types = items.reduce((acc: any, item: any) => {
            acc[item.Type] = (acc[item.Type] || 0) + 1;
            return acc;
        }, {});

        console.log('CONTEO POR TIPO:', JSON.stringify(types, null, 2));

        // Mostrar los primeros 10 para dar una idea
        console.log('\n--- PRIMEROS 10 ITEMS DE LA LISTA RAW ---');
        items.slice(0, 10).forEach((item: any) => {
            console.log(`- ${item.Name} (${item.Type}) | SKU: ${item.Sku || 'N/A'}`);
        });
    });
}

countRawQBItems();
