// RESPALDO + SCANNER PROFUNDO DE FOOD COST
// Escanea TODAS las recetas del sistema buscando anomalías
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Replicate the exact same logic as recipe-calculations.ts
function getConversionFactor(rUnit, iUnit) {
    rUnit = rUnit?.toLowerCase()?.trim() || '';
    iUnit = iUnit?.toLowerCase()?.trim() || '';
    if (rUnit === iUnit) return 1;
    if (rUnit === 'oz' && iUnit === 'lb') return 1/16;
    if (rUnit === 'lb' && iUnit === 'oz') return 16;
    if (rUnit === 'g' && iUnit === 'kg') return 1/1000;
    if (rUnit === 'kg' && iUnit === 'g') return 1000;
    if (rUnit === 'ml' && iUnit === 'l') return 1/1000;
    if (rUnit === 'l' && iUnit === 'ml') return 1000;
    if ((rUnit === 'gal' || rUnit === 'gallon') && (iUnit === 'oz' || iUnit === 'fl oz')) return 128;
    if ((rUnit === 'oz' || rUnit === 'fl oz') && (iUnit === 'gal' || iUnit === 'gallon')) return 1/128;
    if (rUnit === 'dz' && (iUnit === 'pza' || iUnit === 'unit')) return 12;
    return 1;
}

function calculateIngredientCost(qty, rUnit, inv, recipeType) {
    const rawCount = Number(qty) || 0;
    if (rawCount === 0) return { cost: 0, conversion: 1, iUnit: '', warning: null };

    const purchaseUnit = (inv.unit_type || '').toLowerCase();
    let iUnit = (inv.unit_measure || '').toLowerCase().trim();
    rUnit = (rUnit || '').toLowerCase().trim();

    // Smart Fallback
    if (iUnit === 'pza' || iUnit === 'unit') {
        if (purchaseUnit.includes('gallon') || purchaseUnit.includes('gal')) iUnit = 'gal';
        else if (purchaseUnit.includes('lb')) iUnit = 'lb';
        else if (purchaseUnit.includes('oz')) iUnit = 'oz';
        else if (purchaseUnit.includes('kg')) iUnit = 'kg';
    }

    const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1);
    const yieldPct = (recipeType === 'raw') ? 100 : (inv.yield_percent || 100);
    const yieldFactor = yieldPct / 100;

    let conversion = getConversionFactor(rUnit, iUnit);
    let warning = null;

    // SPECIAL CASE: pza on weight/volume item
    if ((rUnit === 'pza' || rUnit === 'unit') && iUnit !== 'pza' && iUnit !== 'unit') {
        conversion = inv.quantity_per_unit || 1;
        warning = `UNIT_MISMATCH: recipe=${rUnit}, inventory=${iUnit} → charges ${inv.quantity_per_unit} ${iUnit} per pza`;
    }

    const cost = (costPerUnit * rawCount * conversion) / yieldFactor;
    return { cost, conversion, iUnit, warning };
}

async function main() {
    const s = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. BACKUP: Save current state of all inventory items used in recipes
    console.log('=== 1. RESPALDO DEL ESTADO ACTUAL ===');
    const { data: allRecipes } = await s
        .from('recipes')
        .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type');
    
    const itemIds = [...new Set((allRecipes || []).map(r => r.inventory_item_id))];
    const { data: allInvItems } = await s
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type, yield_percent')
        .in('id', itemIds);
    
    const invMap = new Map((allInvItems || []).map(i => [i.id, i]));
    console.log(`  Total recetas: ${(allRecipes || []).length} líneas`);
    console.log(`  Ingredientes únicos: ${itemIds.length}`);

    // 2. Group recipes by toast_menu_item_guid
    const recipesByGuid = new Map();
    (allRecipes || []).forEach(r => {
        if (!recipesByGuid.has(r.toast_menu_item_guid)) {
            recipesByGuid.set(r.toast_menu_item_guid, []);
        }
        recipesByGuid.get(r.toast_menu_item_guid).push(r);
    });

    console.log(`  Recetas únicas (GUIDs): ${recipesByGuid.size}`);

    // 3. Get menu item names from toast_menu_items
    const guids = [...recipesByGuid.keys()];
    const { data: menuItems } = await s
        .from('toast_menu_items')
        .select('guid, name')
        .in('guid', guids);
    const nameMap = new Map((menuItems || []).map(m => [m.guid, m.name]));

    // 4. SCAN: Calculate cost for every recipe, flag anomalies
    console.log('\n=== 2. SCANNER PROFUNDO — TODAS LAS RECETAS ===\n');
    
    const anomalies = [];
    const allResults = [];

    for (const [guid, ingredients] of recipesByGuid) {
        const menuName = nameMap.get(guid) || '(unknown)';
        let totalCost = 0;
        const ingredientDetails = [];
        const recipeWarnings = [];

        for (const ing of ingredients) {
            const inv = invMap.get(ing.inventory_item_id);
            if (!inv) {
                recipeWarnings.push(`MISSING_ITEM: ${ing.inventory_item_id}`);
                continue;
            }

            const result = calculateIngredientCost(ing.quantity, ing.unit, inv, ing.type);
            totalCost += result.cost;
            
            ingredientDetails.push({
                name: inv.name,
                qty: ing.quantity,
                unit: ing.unit,
                cost: result.cost,
                warning: result.warning
            });

            if (result.warning) {
                recipeWarnings.push(`${inv.name}: ${result.warning} → $${result.cost.toFixed(2)}`);
            }
            if (result.cost > 15) {
                recipeWarnings.push(`HIGH_COST: ${inv.name} = $${result.cost.toFixed(2)} for ${ing.quantity} ${ing.unit}`);
            }
        }

        allResults.push({ guid, name: menuName, totalCost, warnings: recipeWarnings.length });

        if (totalCost > 20 || recipeWarnings.length > 0) {
            anomalies.push({
                guid,
                name: menuName,
                totalCost,
                warnings: recipeWarnings,
                ingredients: ingredientDetails
            });
        }
    }

    // 5. RESULTS
    if (anomalies.length === 0) {
        console.log('✅ NO SE ENCONTRARON ANOMALÍAS en ninguna receta!\n');
    } else {
        console.log(`🔴 ENCONTRADAS ${anomalies.length} RECETAS CON ANOMALÍAS:\n`);
        
        anomalies.sort((a, b) => b.totalCost - a.totalCost);
        
        for (const a of anomalies) {
            console.log(`${'─'.repeat(60)}`);
            console.log(`📋 ${a.name} (guid: ${a.guid.substring(0, 8)}...)`);
            console.log(`   💰 Costo total: $${a.totalCost.toFixed(2)}`);
            
            for (const w of a.warnings) {
                console.log(`   ⚠️ ${w}`);
            }
            
            console.log(`   Ingredientes:`);
            for (const ing of a.ingredients) {
                const flag = ing.cost > 10 ? '🔴' : (ing.cost > 5 ? '🟡' : '🟢');
                console.log(`     ${flag} ${ing.name}: ${ing.qty} ${ing.unit} = $${ing.cost.toFixed(2)}${ing.warning ? ' ⚠️' : ''}`);
            }
        }
    }

    // 6. SUMMARY STATS
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`RESUMEN DE ESCANEO PROFUNDO`);
    console.log(`${'═'.repeat(60)}`);
    
    allResults.sort((a, b) => b.totalCost - a.totalCost);
    
    console.log(`\nTOP 20 recetas más caras:`);
    allResults.slice(0, 20).forEach((r, i) => {
        const flag = r.totalCost > 20 ? '🔴' : (r.totalCost > 10 ? '🟡' : '🟢');
        console.log(`  ${String(i+1).padStart(3)}. ${flag} $${r.totalCost.toFixed(2).padStart(7)} | ${r.name}${r.warnings > 0 ? ` ⚠️ (${r.warnings} warnings)` : ''}`);
    });

    // Count by unit_mismatch
    let unitMismatches = 0;
    let highCostItems = 0;
    anomalies.forEach(a => {
        a.warnings.forEach(w => {
            if (w.includes('UNIT_MISMATCH')) unitMismatches++;
            if (w.includes('HIGH_COST')) highCostItems++;
        });
    });

    console.log(`\nEstadísticas:`);
    console.log(`  Total recetas escaneadas: ${recipesByGuid.size}`);
    console.log(`  Recetas con anomalías: ${anomalies.length}`);
    console.log(`  Unit mismatches (pza↔lb/gal): ${unitMismatches}`);
    console.log(`  Ingredientes con costo > $15: ${highCostItems}`);
    console.log(`  Recetas con costo > $20: ${anomalies.filter(a => a.totalCost > 20).length}`);
}

main().catch(console.error);
