/**
 * REVERT: Milaneza y Queso Tortas a sus valores originales correctos
 * + Verificar Side Order Queso (es Queso Jack / Queso Rayado, 4oz)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function revertAndFix() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. REVERT Milaneza: 2.6 lbs = 20 piezas → qty=20 pza
    console.log('═══ 1. REVERT Milaneza ═══');
    const { error: e1 } = await supabase
        .from('inventory_items')
        .update({ quantity_per_unit: 20, unit_measure: 'pza', unit_type: '20 pza', updated_at: new Date() })
        .ilike('name', '%Milaneza%');
    
    if (e1) console.log(`  ❌ ${e1.message}`);
    else console.log('  ✅ Milaneza → qty=20 pza (revertido)');

    // 2. REVERT Queso Tortas/platos/Desayuno: 1 lb = 20 rebanadas → qty=20 pza  
    console.log('\n═══ 2. REVERT Queso Tortas/platos/Desayuno ═══');
    const { error: e2 } = await supabase
        .from('inventory_items')
        .update({ quantity_per_unit: 20, unit_measure: 'pza', unit_type: '20 pza', updated_at: new Date() })
        .ilike('name', '%Queso Tortas%');
    
    if (e2) console.log(`  ❌ ${e2.message}`);
    else console.log('  ✅ Queso Tortas → qty=20 pza (revertido)');

    // 3. VERIFY all fixed items
    console.log('\n═══ 3. VERIFICACIÓN COMPLETA ═══');
    const names = ['Milaneza', 'Queso Tortas', 'Salchicha', 'Mulitas Con Queso', 'Papelito'];
    for (const name of names) {
        const { data } = await supabase
            .from('inventory_items')
            .select('name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
            .ilike('name', `%${name}%`)
            .limit(1);
        
        if (data?.[0]) {
            const i = data[0];
            const costPerUnit = (i.purchase_unit_cost || 0) / (i.quantity_per_unit || 1);
            console.log(`  ✅ "${i.name}" → $${i.purchase_unit_cost} / ${i.quantity_per_unit} ${i.unit_measure} = $${costPerUnit.toFixed(4)}/${i.unit_measure}`);
        }
    }

    // 4. Quick FC recalc for the problematic recipes
    console.log('\n═══ 4. FOOD COST RECALC (recetas problemáticas) ═══');
    
    // Get the items we need
    const { data: items } = await supabase.from('inventory_items').select('*');
    const itemMap = new Map(items?.map(i => [i.id, i]) || []);
    
    // Milaneza recipes
    const { data: milItem } = await supabase.from('inventory_items').select('id').ilike('name', '%Milaneza%').single();
    if (milItem) {
        const { data: milRecipes } = await supabase.from('recipes').select('toast_menu_item_guid, quantity, unit').eq('inventory_item_id', milItem.id);
        const { data: menuItems } = await supabase.from('toast_menu_items').select('guid, name, price')
            .in('guid', milRecipes?.map(r => r.toast_menu_item_guid) || []);
        const menuMap = new Map(menuItems?.map(m => [m.guid, m]) || []);
        
        milRecipes?.forEach(r => {
            const menu = menuMap.get(r.toast_menu_item_guid);
            // With qty=20 pza: costPerUnit = $22/20 = $1.10/pza
            // recipe wants X pza, so cost = $1.10 × X
            const cost = 1.10 * r.quantity;
            const fcPct = menu?.price ? (cost / Number(menu.price) * 100) : 0;
            console.log(`  Milaneza: "${menu?.name}" → ${r.quantity} pza × $1.10 = $${cost.toFixed(2)} (FC: ${fcPct.toFixed(1)}%)`);
        });
    }

    // Queso Tortas recipes
    const { data: quesoItem } = await supabase.from('inventory_items').select('id').ilike('name', '%Queso Tortas%').single();
    if (quesoItem) {
        const { data: quesoRecipes } = await supabase.from('recipes').select('toast_menu_item_guid, quantity, unit').eq('inventory_item_id', quesoItem.id);
        const { data: menuItems } = await supabase.from('toast_menu_items').select('guid, name, price')
            .in('guid', quesoRecipes?.map(r => r.toast_menu_item_guid) || []);
        const menuMap = new Map(menuItems?.map(m => [m.guid, m]) || []);
        
        quesoRecipes?.forEach(r => {
            const menu = menuMap.get(r.toast_menu_item_guid);
            // With qty=20 pza: costPerUnit = $3.28/20 = $0.164/pza
            const cost = 0.164 * r.quantity;
            const fcPct = menu?.price ? (cost / Number(menu.price) * 100) : 0;
            console.log(`  Queso: "${menu?.name}" → ${r.quantity} pza × $0.164 = $${cost.toFixed(2)} (FC: ${fcPct.toFixed(1)}%)`);
        });
    }
}

revertAndFix();
