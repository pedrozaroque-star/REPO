/**
 * Deep check de los items con discrepancias REALES y el impacto en recetas
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function deepCheck() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Items con discrepancias REALES
    const problemItems = [
        { searchName: 'Salchicha Bag', docQty: 1, docUnit: 'lb', docPack: 'Bag of 1 lb' },
        { searchName: 'Milaneza', docQty: 2.6, docUnit: 'lb', docPack: 'Bag of 2.6 lbs' },
        { searchName: 'Mulitas Con Queso', docQty: 12, docUnit: 'pza', docPack: 'Bag of 3.06 lbs or 12 mulitas' },
        { searchName: 'Queso Cotija', docQty: 12, docUnit: 'oz', docPack: 'Bag of 12 oz' },
        { searchName: 'Queso Tortas/platos', docQty: 1, docUnit: 'lb', docPack: 'Pack of 1 lb' },
    ];

    for (const prob of problemItems) {
        // Find in DB
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
            .ilike('name', `%${prob.searchName}%`);

        const item = items?.[0];
        if (!item) {
            console.log(`❓ "${prob.searchName}" NOT FOUND in DB`);
            continue;
        }

        console.log('═══════════════════════════════════════════════════');
        console.log(`  📦 ${item.name}`);
        console.log('═══════════════════════════════════════════════════');
        console.log(`  Bodega dice: ${prob.docPack}`);
        console.log(`  DB actual:   qty=${item.quantity_per_unit} ${item.unit_measure} | cost=$${item.purchase_unit_cost} | type=${item.unit_type}`);
        
        const dbCostPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        const correctCostPerUnit = (item.purchase_unit_cost || 0) / prob.docQty;
        
        console.log(`  Cost/unit (DB actual):    $${dbCostPerUnit.toFixed(4)}/${item.unit_measure || '?'}`);
        console.log(`  Cost/unit (correcto):     $${correctCostPerUnit.toFixed(4)}/${prob.docUnit}`);
        console.log(`  Ratio: DB dice ${(dbCostPerUnit / correctCostPerUnit).toFixed(2)}x vs real`);

        // Count recipes
        const { data: recipes, count } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid, quantity, unit, type', { count: 'exact' })
            .eq('inventory_item_id', item.id);

        console.log(`  Recetas que lo usan: ${count}`);
        if (recipes?.length && recipes.length <= 10) {
            // Get menu item names
            const guids = recipes.map(r => r.toast_menu_item_guid).filter(Boolean);
            const { data: menuItems } = await supabase
                .from('toast_menu_items')
                .select('guid, name')
                .in('guid', guids);
            const nameMap = new Map(menuItems?.map(m => [m.guid, m.name]) || []);
            
            recipes.forEach(r => {
                const menuName = nameMap.get(r.toast_menu_item_guid) || r.toast_menu_item_guid?.substring(0, 20);
                console.log(`    → ${r.quantity} ${r.unit} en "${menuName}" (${r.type})`);
            });
        }
        console.log('');
    }

    // Also check: Arroz shows qty=5 but the audit said qty=10 earlier??
    console.log('═══════════════════════════════════════════════════');
    console.log('  VERIFICACIÓN EXTRA: Arroz');
    console.log('═══════════════════════════════════════════════════');
    const { data: arroz } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
        .ilike('name', '%Arroz%')
        .limit(5);
    arroz?.forEach(a => {
        console.log(`  "${a.name}" → $${a.purchase_unit_cost} | qty=${a.quantity_per_unit} ${a.unit_measure} | type=${a.unit_type}`);
    });
}

deepCheck();
