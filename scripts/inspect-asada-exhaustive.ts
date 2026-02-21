
import { createClient } from '@supabase/supabase-js';
import QuickBooks from 'node-quickbooks';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectAsadaPrice() {
    console.log('--- INSPECCIÓN EXHAUSTIVA ---');

    const { data: integration } = await supabase.from('integrations').select('*').single();
    if (!integration) return;

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', integration.refresh_token
    );

    // Traer TODO y filtrar en JS para no fallar por sintaxis de búsqueda de QBO
    const items = await new Promise<any[]>((res) => {
        qbo.findItems({ active: true }, (err, result) => res(result?.QueryResponse?.Item || []));
    });

    console.log(`Total de items revisados: ${items.length}`);

    const asadaMatches = items.filter(q =>
        (q.Name || '').toLowerCase().includes('asada') ||
        (q.Sku || '').toLowerCase().includes('009w')
    );

    if (asadaMatches.length === 0) {
        console.log('No se encontró nada con "Asada" o "009W"');
    } else {
        asadaMatches.forEach(q => {
            console.log(`\nProducto: ${q.Name}`);
            console.log(`- SKU: ${q.Sku}`);
            console.log(`- Costo de Compra (PurchaseCost): $${q.PurchaseCost}`);
            console.log(`- Precio Unitario (UnitPrice): $${q.UnitPrice}`);
            console.log(`- Descripción: ${q.Description}`);
            console.log(`- Actualizado: ${q.MetaData?.LastUpdatedTime}`);
        });
    }

    const priceMatches = items.filter(q => q.PurchaseCost === 61.2 || q.UnitPrice === 61.2);
    if (priceMatches.length > 0) {
        console.log('\n--- PRODUCTOS CON COSTO $61.20 ---');
        priceMatches.forEach(q => console.log(`- ${q.Name} (SKU: ${q.Sku}) | Costo: $${q.PurchaseCost}`));
    }
}

inspectAsadaPrice().catch(console.error);
