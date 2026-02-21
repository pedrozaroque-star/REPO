
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function generateFullPriceReport() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mappings, error } = await supabase
        .from('quickbooks_mappings')
        .select(`
            qb_item_name,
            last_fetch_cost,
            inv:inventory_item_id (
                name,
                unit_type
            )
        `)
        .order('qb_item_name', { ascending: true });

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log('--- REPORTE FINAL DE PRECIOS MAPEADOS (QB) ---');
    console.log('| Insumo Interno | QB Match | Costo | Unidad |');
    console.log('| :--- | :--- | :--- | :--- |');

    mappings.forEach(m => {
        // @ts-ignore
        const internalName = m.inv?.name || 'DESCONOCIDO';
        // @ts-ignore
        const unit = m.inv?.unit_type || '-';
        console.log(`| ${internalName} | ${m.qb_item_name} | $${m.last_fetch_cost} | ${unit} |`);
    });
}

generateFullPriceReport();
