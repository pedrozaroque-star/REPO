
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
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

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', integration.refresh_token
    );

    console.log('--- BUSCANDO ASADA CON QUERY SQL ---');
    const query = "SELECT * FROM Item WHERE Active = true";

    qbo.findItems({ active: true }, async (err, result) => {
        if (err) console.error('Error findItems:', err);
        const items = result?.QueryResponse?.Item || [];
        console.log(`Encontrados directos: ${items.length}`);

        const asada = items.find(i => i.Name.toLowerCase().includes('asada') || i.Sku === '009W');
        if (asada) {
            console.log('ASADA DATA:', JSON.stringify(asada, null, 2));
        } else {
            console.log('No asada in first batch. Fetching more...');
            // Maybe it needs paging?
        }
    });

    // Try a direct query for Asada name
    qbo.findItems({ Name: 'Carne Asada' }, (err, result) => {
        console.log('Búsqueda exacta "Carne Asada":', JSON.stringify(result?.QueryResponse?.Item, null, 2));
    });
}

checkAsadaQuery().catch(console.error);
