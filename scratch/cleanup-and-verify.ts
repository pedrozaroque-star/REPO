/**
 * Limpiar entradas malas de price_history ($0.48) y verificar estado final
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function cleanAndVerify() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';

    // 1. Show all price history
    console.log('═══ BEFORE CLEANUP ═══');
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('id, inventory_item_id, purchase_unit_cost, effective_date')
        .eq('inventory_item_id', PAPELITO_ID)
        .order('effective_date', { ascending: true });
    
    history?.forEach(h => {
        const bad = h.purchase_unit_cost < 1 ? '❌ BAD' : '✅ OK';
        console.log(`  ${bad} | ${h.effective_date} → $${h.purchase_unit_cost} (id: ${h.id})`);
    });

    // 2. Delete the $0.48 entries (wrong prices from bad sync)
    const badIds = history?.filter(h => h.purchase_unit_cost < 1).map(h => h.id) || [];
    if (badIds.length > 0) {
        console.log(`\n  Deleting ${badIds.length} bad entries...`);
        const { error } = await supabase
            .from('inventory_price_history')
            .delete()
            .in('id', badIds);
        
        if (error) {
            console.log(`  ❌ Error: ${error.message}`);
        } else {
            console.log(`  ✅ Deleted ${badIds.length} bad entries`);
        }
    }

    // 3. Verify final state
    console.log('\n═══ AFTER CLEANUP ═══');
    const { data: cleanHistory } = await supabase
        .from('inventory_price_history')
        .select('id, purchase_unit_cost, effective_date')
        .eq('inventory_item_id', PAPELITO_ID)
        .order('effective_date', { ascending: true });
    
    cleanHistory?.forEach(h => {
        console.log(`  ✅ ${h.effective_date} → $${h.purchase_unit_cost}`);
    });

    // 4. Verify current item price
    const { data: item } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit')
        .eq('id', PAPELITO_ID)
        .single();
    
    console.log(`\n═══ CURRENT ITEM STATE ═══`);
    console.log(`  "${item?.name}" → $${item?.purchase_unit_cost} | qty_per_unit: ${item?.quantity_per_unit} | $/pieza: $${((item?.purchase_unit_cost || 0) / (item?.quantity_per_unit || 1)).toFixed(4)}`);

    // 5. Verify mapping
    const { data: mapping } = await supabase
        .from('quickbooks_mappings')
        .select('qb_item_id, qb_item_name, multiplier, max_drop_percent, last_fetch_cost')
        .eq('qb_item_id', '540')
        .single();
    
    console.log(`\n═══ QB MAPPING ═══`);
    console.log(`  multiplier: ${mapping?.multiplier} | max_drop: ${mapping?.max_drop_percent}% | last_cost: $${mapping?.last_fetch_cost}`);

    // 6. Recipe count
    const { count } = await supabase
        .from('recipes')
        .select('id', { count: 'exact', head: true })
        .eq('inventory_item_id', PAPELITO_ID);
    
    console.log(`\n═══ RECIPES ═══`);
    console.log(`  ✅ ${count} recetas usan Papelito Para Torta`);
}

cleanAndVerify();
