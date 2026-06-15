import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function diagnosePapelito() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. All inventory items matching "papelito"
    console.log('=== INVENTORY ITEMS: Papelito ===');
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, updated_at')
        .ilike('name', '%papelito%');
    
    items?.forEach(i => {
        console.log(`  ID: ${i.id} | "${i.name}" | cost: $${i.purchase_unit_cost} | qty_per_unit: ${i.quantity_per_unit} | unit: ${i.unit_measure} | type: ${i.unit_type} | updated: ${i.updated_at}`);
    });

    // 2. All QB mappings for papelito
    console.log('\n=== QUICKBOOKS MAPPINGS: Papelito ===');
    const { data: mappings } = await supabase
        .from('quickbooks_mappings')
        .select('id, qb_item_id, qb_item_name, inventory_item_id, last_fetch_cost, updated_at')
        .ilike('qb_item_name', '%papelito%');
    
    mappings?.forEach(m => {
        console.log(`  Mapping ID: ${m.id} | QB: "${m.qb_item_name}" (QB_ID: ${m.qb_item_id}) → inv_id: ${m.inventory_item_id} | last_cost: $${m.last_fetch_cost} | updated: ${m.updated_at}`);
    });

    // 3. Also check if there are multiple inventory items for same name
    console.log('\n=== ALL ITEMS with "torta" or "papel" ===');
    const { data: tortas } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost')
        .or('name.ilike.%papelito%,name.ilike.%papel torta%');
    
    tortas?.forEach(i => {
        console.log(`  ID: ${i.id} | "${i.name}" | cost: $${i.purchase_unit_cost}`);
    });

    // 4. Price history for papelito (last 10)
    console.log('\n=== PRICE HISTORY: Papelito (last 10) ===');
    const papIds = items?.map(i => i.id) || [];
    if (papIds.length > 0) {
        const { data: history } = await supabase
            .from('inventory_price_history')
            .select('id, inventory_item_id, purchase_unit_cost, effective_date')
            .in('inventory_item_id', papIds)
            .order('effective_date', { ascending: false })
            .limit(10);
        
        history?.forEach(h => {
            console.log(`  ${h.effective_date} | inv_id: ${h.inventory_item_id} | $${h.purchase_unit_cost}`);
        });

        // Count total papelito history entries
        const { count } = await supabase
            .from('inventory_price_history')
            .select('id', { count: 'exact', head: true })
            .in('inventory_item_id', papIds);
        
        console.log(`\n  TOTAL registros de historial papelito: ${count}`);
    }
}

diagnosePapelito();
