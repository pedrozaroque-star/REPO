/**
 * AUDITORÍA v2 — Usa EXACTAMENTE la misma lógica de recipe-calculations.ts
 * para calcular el food cost REAL de cada receta.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// ── Replicar EXACTAMENTE getConversionFactor y calculateIngredientCost ──
function getConversionFactor(rUnit: string, iUnit: string): number {
    rUnit = rUnit?.toLowerCase()?.trim() || '';
    iUnit = iUnit?.toLowerCase()?.trim() || '';
    if (rUnit === iUnit) return 1;
    if (rUnit === 'oz' && iUnit === 'lb') return 1 / 16;
    if (rUnit === 'lb' && iUnit === 'oz') return 16;
    if (rUnit === 'g' && iUnit === 'kg') return 1 / 1000;
    if (rUnit === 'kg' && iUnit === 'g') return 1000;
    if (rUnit === 'ml' && iUnit === 'l') return 1 / 1000;
    if (rUnit === 'l' && iUnit === 'ml') return 1000;
    if ((rUnit === 'gal' || rUnit === 'gallon') && (iUnit === 'oz' || iUnit === 'fl oz')) return 128;
    if ((rUnit === 'oz' || rUnit === 'fl oz') && (iUnit === 'gal' || iUnit === 'gallon')) return 1 / 128;
    if (rUnit === 'dz' && (iUnit === 'pza' || iUnit === 'unit')) return 12;
    return 1;
}

function calculateIngredientCost(recipeQuantity: number, recipeUnit: string, inv: any, recipeType: string = 'cooked'): number {
    const rawCount = Number(recipeQuantity) || 0;
    if (rawCount === 0) return 0;
    const purchaseUnit = inv.unit_type?.toLowerCase() || '';
    let iUnit = inv.unit_measure?.toLowerCase()?.trim() || '';
    const rUnit = recipeUnit?.toLowerCase()?.trim() || '';
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
    if ((rUnit === 'pza' || rUnit === 'unit') && iUnit !== 'pza' && iUnit !== 'unit') {
        conversion = inv.quantity_per_unit || 1;
    }
    const cost = (costPerUnit * rawCount * conversion) / yieldFactor;
    return cost;
}

async function auditV2() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: recipes } = await supabase.from('recipes').select('*').limit(10000);
    const { data: items } = await supabase.from('inventory_items').select('*');
    const { data: menuItems } = await supabase.from('toast_menu_items').select('guid, name, price');

    if (!recipes || !items || !menuItems) { console.log('❌ No data'); return; }

    const itemMap = new Map(items.map(i => [i.id, i]));
    const menuMap = new Map(menuItems.map(m => [m.guid, m]));

    // Group recipes by GUID
    const recipesByGuid = new Map<string, typeof recipes>();
    recipes.forEach(r => {
        const guid = r.toast_menu_item_guid;
        if (!recipesByGuid.has(guid)) recipesByGuid.set(guid, []);
        recipesByGuid.get(guid)!.push(r);
    });

    interface Result {
        menuName: string; menuPrice: number; foodCost: number; cogsCost: number;
        fcPct: number; ingCount: number; warnings: string[];
        details: { name: string; qty: number; rUnit: string; iUnit: string; cost: number; type: string; conversion: string }[];
    }

    const results: Result[] = [];

    for (const [guid, recipeIngs] of recipesByGuid) {
        const menu = menuMap.get(guid);
        const menuName = menu?.name || guid.substring(0, 20);
        const menuPrice = Number(menu?.price || 0);
        let foodCost = 0, cogsCost = 0;
        const warnings: string[] = [];
        const details: Result['details'] = [];

        for (const r of recipeIngs) {
            const item = itemMap.get(r.inventory_item_id);
            if (!item) { warnings.push(`Missing item: ${r.inventory_item_id}`); continue; }

            const cost = calculateIngredientCost(r.quantity, r.unit, item, r.type || 'food');
            const type = r.type || 'food';
            
            if (['food', 'raw', 'cooked'].includes(type)) foodCost += cost;
            else cogsCost += cost;

            // Detect conversion used
            let iUnit = item.unit_measure?.toLowerCase()?.trim() || '';
            const purchaseUnit = item.unit_type?.toLowerCase() || '';
            if (iUnit === 'pza' || iUnit === 'unit') {
                if (purchaseUnit.includes('gallon') || purchaseUnit.includes('gal')) iUnit = 'gal';
                else if (purchaseUnit.includes('lb')) iUnit = 'lb';
                else if (purchaseUnit.includes('oz')) iUnit = 'oz';
            }
            const rUnit = r.unit?.toLowerCase()?.trim() || '';
            let conversionNote = rUnit === iUnit ? 'same' : `${rUnit}→${iUnit}`;

            // Flag suspicious costs
            if (cost > 5 && menuPrice > 0 && cost > menuPrice * 0.4) {
                warnings.push(`🔴 "${item.name}" $${cost.toFixed(2)} = ${(cost/menuPrice*100).toFixed(0)}% of price`);
            }
            if (cost < 0) {
                warnings.push(`❌ "${item.name}" has NEGATIVE cost: $${cost.toFixed(4)}`);
            }

            details.push({ name: item.name, qty: r.quantity, rUnit, iUnit, cost, type, conversion: conversionNote });
        }

        const fcPct = menuPrice > 0 ? (foodCost / menuPrice) * 100 : 0;
        results.push({ menuName, menuPrice, foodCost, cogsCost, fcPct, ingCount: recipeIngs.length, warnings, details });
    }

    // Sort by FC%
    results.sort((a, b) => b.fcPct - a.fcPct);

    // ═══ SHOW HIGH FOOD COST ═══
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🔴 RECETAS CON FOOD COST >50% (usando fórmula real)');
    console.log('═══════════════════════════════════════════════════════════');
    const highFC = results.filter(r => r.fcPct > 50 && r.menuPrice > 0);
    highFC.forEach(r => {
        console.log(`  ${r.fcPct.toFixed(1)}% | "${r.menuName}" ($${r.menuPrice.toFixed(2)}) | food: $${r.foodCost.toFixed(2)} | pkg: $${r.cogsCost.toFixed(2)}`);
        r.details.sort((a, b) => b.cost - a.cost);
        r.details.slice(0, 5).forEach(d => {
            console.log(`       ${d.qty} ${d.rUnit} "${d.name}" [${d.conversion}] → $${d.cost.toFixed(4)} (${d.type})`);
        });
        if (r.warnings.length) r.warnings.forEach(w => console.log(`       ${w}`));
        console.log('');
    });

    // ═══ SHOW LOW FOOD COST ═══
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  🟡 RECETAS CON FOOD COST <15% (sospechosamente bajo)');
    console.log('═══════════════════════════════════════════════════════════');
    const lowFC = results.filter(r => r.fcPct > 0 && r.fcPct < 15 && r.menuPrice > 0);
    lowFC.forEach(r => {
        console.log(`  ${r.fcPct.toFixed(1)}% | "${r.menuName}" ($${r.menuPrice.toFixed(2)}) | food: $${r.foodCost.toFixed(2)}`);
        r.details.forEach(d => {
            console.log(`       ${d.qty} ${d.rUnit} "${d.name}" [${d.conversion}] → $${d.cost.toFixed(4)} (${d.type})`);
        });
        console.log('');
    });

    // ═══ NORMAL RANGE ═══
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✅ RECETAS EN RANGO NORMAL (15-50%)');
    console.log('═══════════════════════════════════════════════════════════');
    const normalFC = results.filter(r => r.fcPct >= 15 && r.fcPct <= 50 && r.menuPrice > 0);
    normalFC.forEach(r => {
        const flag = r.warnings.length > 0 ? '⚠️' : '✅';
        console.log(`  ${flag} ${r.fcPct.toFixed(1)}% | "${r.menuName}" ($${r.menuPrice.toFixed(2)}) | food: $${r.foodCost.toFixed(2)} | pkg: $${r.cogsCost.toFixed(2)}`);
    });

    // ═══ SUMMARY ═══
    const withPrice = results.filter(r => r.menuPrice > 0);
    const avgFC = withPrice.reduce((sum, r) => sum + r.fcPct, 0) / (withPrice.length || 1);
    const above50 = withPrice.filter(r => r.fcPct > 50).length;
    const below15 = withPrice.filter(r => r.fcPct < 15 && r.fcPct > 0).length;
    const normal = withPrice.filter(r => r.fcPct >= 15 && r.fcPct <= 50).length;

    console.log('\n═══ RESUMEN FINAL ═══');
    console.log(`  Total recetas: ${results.length} (${withPrice.length} con precio)`);
    console.log(`  Promedio food cost: ${avgFC.toFixed(1)}%`);
    console.log(`  🔴 FC > 50%: ${above50}`);
    console.log(`  ✅ FC 15-50%: ${normal}`);
    console.log(`  🟡 FC < 15%: ${below15}`);
    console.log(`  Warnings totales: ${results.reduce((s, r) => s + r.warnings.length, 0)}`);
}

auditV2();
