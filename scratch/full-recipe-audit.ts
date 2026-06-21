/**
 * AUDITORÍA PROFUNDA DE TODAS LAS RECETAS
 * 
 * Revisa:
 * 1. Costo total por receta vs precio de venta (food cost % por item)
 * 2. Unidades incompatibles (receta usa "oz" pero item tiene "pza")
 * 3. Cantidades sospechosas (demasiado grandes o pequeñas)
 * 4. Items con $0 precio que afectan recetas
 * 5. Menú items vendidos sin receta (PMIX coverage gaps)
 * 6. Ingredientes duplicados en la misma receta
 * 7. Items caros usados en muchas recetas
 * 8. Recetas donde la suma de ingredientes parece irreal
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function fullRecipeAudit() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // ═══ LOAD ALL DATA ═══
    const { data: recipes } = await supabase.from('recipes').select('*').limit(10000);
    const { data: items } = await supabase.from('inventory_items').select('*');
    const { data: menuItems } = await supabase.from('toast_menu_items').select('guid, name, price');
    
    if (!recipes || !items || !menuItems) {
        console.log('❌ Could not load data');
        return;
    }

    const itemMap = new Map(items.map(i => [i.id, i]));
    const menuMap = new Map(menuItems.map(m => [m.guid, m]));

    // Group recipes by menu item GUID
    const recipesByGuid = new Map<string, typeof recipes>();
    recipes.forEach(r => {
        const guid = r.toast_menu_item_guid;
        if (!recipesByGuid.has(guid)) recipesByGuid.set(guid, []);
        recipesByGuid.get(guid)!.push(r);
    });

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  AUDITORÍA PROFUNDA DE RECETAS');
    console.log(`  ${recipes.length} entradas de receta | ${recipesByGuid.size} menu items | ${items.length} inventory items`);
    console.log('═══════════════════════════════════════════════════════════════════');

    // ═══════════════════════════════════════════════════
    // 1. COSTO POR RECETA - calcular food cost % por item
    // ═══════════════════════════════════════════════════
    console.log('\n═══ 1. COSTO POR RECETA (food cost % por menu item) ═══');
    
    interface RecipeCost {
        guid: string;
        menuName: string;
        menuPrice: number;
        totalFoodCost: number;
        totalCogsCost: number;
        foodCostPct: number;
        ingredients: { name: string; qty: number; unit: string; cost: number; type: string }[];
        warnings: string[];
    }

    const recipeCosts: RecipeCost[] = [];

    for (const [guid, recipeIngredients] of recipesByGuid) {
        const menu = menuMap.get(guid);
        const menuName = menu?.name || guid.substring(0, 20);
        const menuPrice = Number(menu?.price || 0);

        let totalFoodCost = 0;
        let totalCogsCost = 0;
        const ingredients: RecipeCost['ingredients'] = [];
        const warnings: string[] = [];

        for (const r of recipeIngredients) {
            const item = itemMap.get(r.inventory_item_id);
            if (!item) {
                warnings.push(`❌ Missing inventory item: ${r.inventory_item_id}`);
                continue;
            }

            const costPerUnit = (item.purchase_unit_cost || 0) / (item.quantity_per_unit || 1);
            const qty = Number(r.quantity) || 0;
            let ingredientCost = costPerUnit * qty;

            // Check unit compatibility
            const recipeUnit = r.unit?.toLowerCase() || '';
            const itemUnit = (item.unit_measure || '').toLowerCase();
            
            // Unit conversion warnings
            if (recipeUnit && itemUnit && recipeUnit !== itemUnit) {
                // Some conversions are OK (oz/lb, pza/pieza)
                const compatible = (
                    (recipeUnit === 'pieza' && itemUnit === 'pza') ||
                    (recipeUnit === 'pza' && itemUnit === 'pieza') ||
                    (recipeUnit === 'oz' && itemUnit === 'oz') ||
                    (recipeUnit === 'lb' && itemUnit === 'lb') ||
                    (recipeUnit === 'gal' && itemUnit === 'gal')
                );
                if (!compatible) {
                    warnings.push(`⚠️ Unit mismatch: recipe uses "${recipeUnit}" but item "${item.name}" has "${itemUnit}"`);
                }
            }

            // Check for suspiciously high ingredient cost
            if (ingredientCost > 10 && menuPrice > 0 && ingredientCost > menuPrice * 0.5) {
                warnings.push(`🔴 "${item.name}" alone costs $${ingredientCost.toFixed(2)} (>${(ingredientCost/menuPrice*100).toFixed(0)}% of $${menuPrice} menu price)`);
            }

            // Classify: food vs packaging/cogs
            const type = r.type || 'food';
            if (type === 'food' || type === 'raw' || type === 'cooked') {
                totalFoodCost += ingredientCost;
            } else {
                totalCogsCost += ingredientCost;
            }

            ingredients.push({
                name: item.name,
                qty,
                unit: recipeUnit || itemUnit,
                cost: ingredientCost,
                type
            });
        }

        const foodCostPct = menuPrice > 0 ? (totalFoodCost / menuPrice) * 100 : 0;

        recipeCosts.push({
            guid,
            menuName,
            menuPrice,
            totalFoodCost,
            totalCogsCost,
            foodCostPct,
            ingredients,
            warnings
        });
    }

    // Sort by food cost % (highest first = most expensive recipes)
    recipeCosts.sort((a, b) => b.foodCostPct - a.foodCostPct);

    // Show recipes with VERY HIGH food cost (>60%)
    console.log('\n  🔴 RECETAS CON FOOD COST MUY ALTO (>60%):');
    console.log('  ─────────────────────────────────────────────');
    const highFC = recipeCosts.filter(r => r.foodCostPct > 60 && r.menuPrice > 0);
    highFC.forEach(r => {
        console.log(`  ${r.foodCostPct.toFixed(1)}% | "${r.menuName}" (venta: $${r.menuPrice.toFixed(2)}) | costo food: $${r.totalFoodCost.toFixed(2)} | pkg: $${r.totalCogsCost.toFixed(2)}`);
        r.ingredients.sort((a, b) => b.cost - a.cost);
        r.ingredients.slice(0, 5).forEach(ing => {
            console.log(`         ${ing.qty} ${ing.unit} ${ing.name} → $${ing.cost.toFixed(4)} (${ing.type})`);
        });
    });

    // Show recipes with VERY LOW food cost (<10%) - suspicious
    console.log('\n  🟡 RECETAS CON FOOD COST MUY BAJO (<10%) - sospechoso:');
    console.log('  ─────────────────────────────────────────────');
    const lowFC = recipeCosts.filter(r => r.foodCostPct < 10 && r.menuPrice > 0 && r.foodCostPct > 0);
    lowFC.forEach(r => {
        console.log(`  ${r.foodCostPct.toFixed(1)}% | "${r.menuName}" (venta: $${r.menuPrice.toFixed(2)}) | costo: $${r.totalFoodCost.toFixed(4)}`);
        r.ingredients.forEach(ing => {
            console.log(`         ${ing.qty} ${ing.unit} ${ing.name} → $${ing.cost.toFixed(4)} (${ing.type})`);
        });
    });

    // ═══════════════════════════════════════════════════
    // 2. UNIT MISMATCHES - all warnings
    // ═══════════════════════════════════════════════════
    console.log('\n═══ 2. UNIT MISMATCHES (unidades incompatibles) ═══');
    let unitWarnings = 0;
    recipeCosts.forEach(r => {
        const unitWarns = r.warnings.filter(w => w.includes('Unit mismatch'));
        if (unitWarns.length > 0) {
            unitWarnings += unitWarns.length;
            console.log(`  "${r.menuName}":`);
            unitWarns.forEach(w => console.log(`    ${w}`));
        }
    });
    if (unitWarnings === 0) console.log('  ✅ No unit mismatches found');

    // ═══════════════════════════════════════════════════
    // 3. DUPLICATE INGREDIENTS in same recipe
    // ═══════════════════════════════════════════════════
    console.log('\n═══ 3. INGREDIENTES DUPLICADOS EN LA MISMA RECETA ═══');
    let dupCount = 0;
    for (const [guid, recipeIngs] of recipesByGuid) {
        const itemIds = recipeIngs.map(r => r.inventory_item_id);
        const dupes = itemIds.filter((id, i) => itemIds.indexOf(id) !== i);
        if (dupes.length > 0) {
            dupCount++;
            const menu = menuMap.get(guid);
            console.log(`  ⚠️ "${menu?.name || guid.substring(0, 20)}" tiene ingredientes duplicados:`);
            dupes.forEach(d => {
                const item = itemMap.get(d);
                const entries = recipeIngs.filter(r => r.inventory_item_id === d);
                console.log(`    "${item?.name}" aparece ${entries.length}x: ${entries.map(e => `${e.quantity} ${e.unit} (${e.type})`).join(', ')}`);
            });
        }
    }
    if (dupCount === 0) console.log('  ✅ No duplicates found');

    // ═══════════════════════════════════════════════════
    // 4. MENU ITEMS SIN RECETA (coverage gaps)
    // ═══════════════════════════════════════════════════
    console.log('\n═══ 4. MENU ITEMS SIN RECETA ═══');
    const menuItemsWithRecipe = new Set(recipesByGuid.keys());
    const menuItemsWithoutRecipe = menuItems.filter(m => !menuItemsWithRecipe.has(m.guid) && Number(m.price) > 0);
    console.log(`  Total menu items: ${menuItems.length}`);
    console.log(`  Con receta: ${menuItemsWithRecipe.size}`);
    console.log(`  Sin receta (con precio > $0): ${menuItemsWithoutRecipe.length}`);
    // Show first 20
    menuItemsWithoutRecipe.slice(0, 30).forEach(m => {
        console.log(`    ❓ "${m.name}" ($${Number(m.price).toFixed(2)}) - NO RECIPE`);
    });

    // ═══════════════════════════════════════════════════
    // 5. RECIPE COST OVERVIEW (sorted by total cost)
    // ═══════════════════════════════════════════════════
    console.log('\n═══ 5. TODAS LAS RECETAS ORDENADAS POR FOOD COST % ═══');
    console.log(`${'FC%'.padStart(6)} | ${'Menu Item'.padEnd(45)} | ${'Venta'.padStart(7)} | ${'FoodC'.padStart(7)} | ${'PkgC'.padStart(7)} | ${'Ings'.padStart(4)}`);
    console.log('─'.repeat(95));
    
    recipeCosts.forEach(r => {
        const flag = r.menuPrice === 0 ? '❓' : (r.foodCostPct > 50 ? '🔴' : (r.foodCostPct < 15 ? '🟡' : '  '));
        console.log(`${flag}${r.foodCostPct.toFixed(1).padStart(4)}% | ${r.menuName.substring(0, 45).padEnd(45)} | $${r.menuPrice.toFixed(2).padStart(6)} | $${r.totalFoodCost.toFixed(2).padStart(6)} | $${r.totalCogsCost.toFixed(2).padStart(6)} | ${r.ingredients.length.toString().padStart(4)}`);
    });

    // ═══════════════════════════════════════════════════
    // 6. SUMMARY
    // ═══════════════════════════════════════════════════
    const withPrice = recipeCosts.filter(r => r.menuPrice > 0);
    const avgFC = withPrice.reduce((sum, r) => sum + r.foodCostPct, 0) / (withPrice.length || 1);
    const above50 = withPrice.filter(r => r.foodCostPct > 50).length;
    const below15 = withPrice.filter(r => r.foodCostPct < 15 && r.foodCostPct > 0).length;

    console.log('\n═══ 6. RESUMEN ═══');
    console.log(`  Total recetas calculadas: ${recipeCosts.length}`);
    console.log(`  Con precio de venta: ${withPrice.length}`);
    console.log(`  Food cost promedio: ${avgFC.toFixed(1)}%`);
    console.log(`  🔴 Con FC > 50%: ${above50}`);
    console.log(`  🟡 Con FC < 15%: ${below15}`);
    console.log(`  Unit mismatches: ${unitWarnings}`);
    console.log(`  Duplicados: ${dupCount}`);
}

fullRecipeAudit();
