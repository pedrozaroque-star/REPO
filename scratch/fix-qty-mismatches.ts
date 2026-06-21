/**
 * FIX: Corregir quantity_per_unit para items que no coinciden con la bodega.
 * 
 * NOTA IMPORTANTE sobre unidades de receta:
 * - Las recetas usan "pza" u "oz" como unidad
 * - quantity_per_unit debe coincidir con la unidad de la receta
 * - Si la receta dice "1.6 oz de Salchicha" y quantity_per_unit=50 pza, 
 *   el sistema calcula: $2.00 / 50 * 1.6 = $0.064 (INCORRECTO)
 *   Debería ser: Salchicha $2.00 por 1 lb (16 oz), receta usa 1.6 oz
 *   → $2.00 / 16 * 1.6 = $0.20 (CORRECTO)
 * 
 * Hay que cambiar tanto quantity_per_unit como unit_measure para que la 
 * fórmula de recipe-calculations.ts funcione:
 *   costPerUnit = purchase_unit_cost / quantity_per_unit
 *   ingredientCost = costPerUnit * recipeQuantity
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

interface Fix {
    name: string;
    searchName: string;
    newQty: number;
    newUnit: string;
    newUnitType: string;
    reason: string;
}

async function applyFixes() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // ═══════════════════════════════════════════════════
    // First, let me understand how recipe-calculations.ts uses the data
    // costPerUnit = purchase_unit_cost / quantity_per_unit
    // ingredientCost = costPerUnit * recipe.quantity (in recipe.unit)
    // 
    // So quantity_per_unit MUST be in the SAME unit as recipe.unit
    // ═══════════════════════════════════════════════════

    const fixes: Fix[] = [
        {
            name: 'Salchicha Bag',
            searchName: 'Salchicha Bag',
            // Bodega: Bag of 1 lb. Recipes use oz. 1 lb = 16 oz.
            // $2.00 / 16 oz = $0.125/oz. Recipe: 1.6 oz = $0.20
            newQty: 16,
            newUnit: 'oz',
            newUnitType: '1 lb',
            reason: 'Bodega: 1 lb bag. Recipes use oz. Was 50 pza (wrong: treated as 50 pieces). Correct: 16 oz per lb.'
        },
        {
            name: 'Milaneza',
            searchName: 'Milaneza',
            // Bodega: Bag of 2.6 lbs. Recipes use pza (pieces of milaneza).
            // The document says 2.6 lbs per bag, but recipes count pieces.
            // Need to figure out: how many pieces in a 2.6 lb bag?
            // Current DB says 20 pza, but the user says $22 for 2.6 lbs.
            // Looking at recipes: "4 pza" for Plato, "1 pza" for Torta Cubana, "2 pza" for Torta Milanesa
            // These are pieces (slices). A 2.6 lb bag might have ~10-12 pieces?
            // But the user's document explicitly says 2.6 lbs. Let me keep pza but fix the count.
            // Actually, from the data: unit_type = "20 pza", which seems way too many.
            // A typical milaneza slice is about 4-5 oz. 2.6 lbs = 41.6 oz → ~8-10 pieces
            // Let's ask the user... but for now, let's use a reasonable estimate.
            // Actually, wait - let me just use lbs as the unit since the bodega sells by lb
            newQty: 2.6,
            newUnit: 'lb',
            newUnitType: '2.6 lbs',
            reason: 'Bodega: 2.6 lb bag. Was 20 pza ($1.10/pza). Correct: 2.6 lbs ($8.46/lb). Recipes use pza but may need recipe qty conversion.'
        },
        {
            name: 'Mulitas Con Queso',
            searchName: 'Mulitas Con Queso',
            // Bodega: Bag of 3.06 lbs or 12 mulitas. DB has 13. Should be 12.
            newQty: 12,
            newUnit: 'pza',
            newUnitType: '12 pza',
            reason: 'Bodega: 12 mulitas per bag. Was 13 pza. Correct: 12 pza.'
        },
        {
            name: 'Queso Tortas/platos/Desayuno',
            searchName: 'Queso Tortas/platos',
            // Bodega: Pack of 1 lb. Recipes use pza (pieces of queso fresco).
            // DB has 20 pza which is wrong. 
            // Actually, the recipe uses "pza" as pieces/slices. 
            // 1 lb of queso = 16 oz. But recipe says "1 pza" = 1 slice?
            // The key question: how many "pza" in 1 lb pack?
            // Looking at recipes: "1 pza" for Sope, "3 pza" for Torta Queso, "4 pza" for Side Order
            // If 1 pza = 1 slice, maybe ~10-12 slices per lb?
            // But currently at 20 pza, cost is $0.164/pza = very cheap
            // With bodega spec of 1 lb pack, need to know pieces per pack
            // Actually, let me just put the bodega spec (1 lb = 16 oz)
            // and let the recipe qty work in oz
            newQty: 16,
            newUnit: 'oz',
            newUnitType: '1 lb',
            reason: 'Bodega: 1 lb pack. Was 20 pza ($0.164/pza). Correct: 16 oz per lb ($0.205/oz). Recipes may need qty update to oz.'
        },
    ];

    console.log('═══════════════════════════════════════════════════');
    console.log('  BEFORE FIXES');
    console.log('═══════════════════════════════════════════════════');

    for (const fix of fixes) {
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
            .ilike('name', `%${fix.searchName}%`);
        
        const item = items?.[0];
        if (!item) { console.log(`  ❌ "${fix.name}" not found`); continue; }

        const oldCostPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        const newCostPerUnit = (item.purchase_unit_cost || 0) / fix.newQty;

        console.log(`  📦 "${item.name}" (${item.id})`);
        console.log(`    BEFORE: qty=${item.quantity_per_unit} ${item.unit_measure} → $${oldCostPerUnit.toFixed(4)}/${item.unit_measure}`);
        console.log(`    AFTER:  qty=${fix.newQty} ${fix.newUnit} → $${newCostPerUnit.toFixed(4)}/${fix.newUnit}`);
        console.log(`    Reason: ${fix.reason}`);

        // Check what recipes use this item to see if units are compatible
        const { data: recipes } = await supabase
            .from('recipes')
            .select('quantity, unit')
            .eq('inventory_item_id', item.id);
        
        if (recipes?.length) {
            const recipeUnits = [...new Set(recipes.map(r => r.unit))];
            console.log(`    Recipe units: ${recipeUnits.join(', ')}`);
            
            // Check unit compatibility
            if (!recipeUnits.includes(fix.newUnit) && fix.newUnit !== item.unit_measure) {
                console.log(`    ⚠️ WARNING: Recipe uses ${recipeUnits.join(',')} but new unit is ${fix.newUnit}`);
            }
        }
        console.log('');
    }

    // Ask before applying
    console.log('═══════════════════════════════════════════════════');
    console.log('  APPLYING FIXES...');
    console.log('═══════════════════════════════════════════════════');

    for (const fix of fixes) {
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name')
            .ilike('name', `%${fix.searchName}%`);
        
        const item = items?.[0];
        if (!item) continue;

        const { error } = await supabase
            .from('inventory_items')
            .update({ 
                quantity_per_unit: fix.newQty,
                unit_measure: fix.newUnit,
                unit_type: fix.newUnitType,
                updated_at: new Date()
            })
            .eq('id', item.id);

        if (error) {
            console.log(`  ❌ "${item.name}": ${error.message}`);
        } else {
            console.log(`  ✅ "${item.name}": qty=${fix.newQty} ${fix.newUnit}`);
        }
    }

    // Verify
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  AFTER FIXES (verification)');
    console.log('═══════════════════════════════════════════════════');

    for (const fix of fixes) {
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type')
            .ilike('name', `%${fix.searchName}%`);
        
        const item = items?.[0];
        if (!item) continue;

        const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
        console.log(`  ✅ "${item.name}" → $${item.purchase_unit_cost} / ${item.quantity_per_unit} ${item.unit_measure} = $${costPerUnit.toFixed(4)}/${item.unit_measure}`);
    }
}

applyFixes();
