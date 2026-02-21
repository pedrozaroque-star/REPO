
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function transferCosts() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('--- TRANSFIRIENDO COSTOS DE MAPPINGS A INVENTORY_ITEMS ---');

    const { data: mappings } = await supabase.from('quickbooks_mappings').select('*');
    if (!mappings) return;

    for (const mapping of mappings) {
        if (mapping.last_fetch_cost > 0) {
            console.log(`Actualizando Item ID ${mapping.inventory_item_id} a $${mapping.last_fetch_cost}`);
            const { error } = await supabase
                .from('inventory_items')
                .update({
                    purchase_unit_cost: mapping.last_fetch_cost,
                    updated_at: new Date()
                })
                .eq('id', mapping.inventory_item_id);

            if (error) console.error(`Error actualizando item ${mapping.inventory_item_id}:`, error.message);
        }
    }

    console.log('✅ PROCESO COMPLETADO.');
}

transferCosts();
