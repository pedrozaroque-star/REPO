import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkPapelitoRecipes() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Find the papelito item
    const { data: papelito } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
        .ilike('name', '%papelito%')
        .single();

    if (!papelito) { console.log('Papelito not found'); return; }
    console.log('=== PAPELITO ITEM ===');
    console.log(`  "${papelito.name}" | cost: $${papelito.purchase_unit_cost} | qty_per_unit: ${papelito.quantity_per_unit} | unit: ${papelito.unit_measure} | type: ${papelito.unit_type}`);
    console.log(`  Costo por pieza: $${(papelito.purchase_unit_cost / (papelito.quantity_per_unit || 1)).toFixed(4)}`);

    // 2. Find ALL recipes that use papelito
    const { data: recipes } = await supabase
        .from('recipes')
        .select('id, toast_menu_item_guid, quantity, unit, menu_item_name')
        .eq('inventory_item_id', papelito.id)
        .order('menu_item_name');

    if (!recipes?.length) { console.log('\nNo recipes found using Papelito'); return; }

    console.log(`\n=== RECETAS QUE USAN PAPELITO (${recipes.length} total) ===`);
    recipes.forEach(r => {
        const costPerRecipe = (papelito.purchase_unit_cost / (papelito.quantity_per_unit || 1)) * r.quantity;
        console.log(`  ${r.quantity} ${r.unit} → "${r.menu_item_name || r.toast_menu_item_guid}" | cost: $${costPerRecipe.toFixed(4)}`);
    });
}

checkPapelitoRecipes();
