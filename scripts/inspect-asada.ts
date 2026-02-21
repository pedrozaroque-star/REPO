
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
    console.log('--- INSPECCIÓN DETALLADA: CARNE ASADA ---');

    const { data: integration } = await supabase.from('integrations').select('*').single();
    if (!integration) return;

    const qbo = new QuickBooks(
        process.env.QUICKBOOKS_CLIENT_ID, process.env.QUICKBOOKS_CLIENT_SECRET,
        integration.access_token, false, integration.realm_id,
        process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox', false, null, '2.0', integration.refresh_token
    );

    // Buscar TODOS los items que contengan "Asada" para ver si hay duplicados o variaciones
    const items = await new Promise<any[]>((res) => {
        qbo.findItems({ Name: { ilike: '%Asada%' } }, (err, result) => res(result?.QueryResponse?.Item || []));
    });

    if (items.length === 0) {
        // Reintento con búsqueda más amplia por SKU si el nombre falló en el filtro directo
        qbo.findItems({ Sku: '009W' }, (err, result) => {
            console.log('Resultados por SKU 009W:', JSON.stringify(result?.QueryResponse?.Item, null, 2));
        });
    } else {
        items.forEach(q => {
            console.log(`\nITEM ENCONTRADO: ${q.Name}`);
            console.log(`- ID: ${q.Id}`);
            console.log(`- SKU: ${q.Sku}`);
            console.log(`- PurchaseCost (Costo de Compra): $${q.PurchaseCost}`);
            console.log(`- UnitPrice (Precio de Venta): $${q.UnitPrice}`);
            console.log(`- Description: ${q.Description}`);
            console.log(`- FullyQualifiedName: ${q.FullyQualifiedName}`);
            console.log(`- Last Updated: ${q.MetaData?.LastUpdatedTime}`);
        });
    }

    // También buscar items que cuesten exactamente $61.20 por si acaso
    console.log('\n--- Buscando items con costo $61.20 ---');
    qbo.findItems({ PurchaseCost: 61.2 }, (err, result) => {
        const matches = result?.QueryResponse?.Item || [];
        if (matches.length > 0) {
            matches.forEach((m: any) => console.log(`- MATCH ENCONTRADO: ${m.Name} (SKU: ${m.Sku})`));
        } else {
            console.log('No se encontraron items con costo exacto de $61.20');
        }
    });
}

inspectAsadaPrice().catch(console.error);
