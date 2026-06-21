/**
 * @module compare-march-vs-june-prices
 * @description Compara los precios del inventario entre marzo 14 y junio 2 para identificar
 * qué items bajaron de precio y podrían causar la caída del food cost.
 * 
 * Compare inventory prices between March 14 and June 2 to identify which items
 * dropped in price and could be causing the food cost decline.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function compare() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Get ALL price history entries
    console.log('📊 Loading all price history entries...');
    const { data: allHistory } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .order('effective_date', { ascending: true });

    if (!allHistory?.length) {
        console.log('❌ No history found');
        return;
    }

    // Get all item names
    const itemIds = [...new Set(allHistory.map(h => h.inventory_item_id))];
    const { data: allItems } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type')
        .in('id', itemIds);

    const itemMap = new Map(allItems?.map(i => [i.id, i]) || []);

    // 2. Build price maps by date
    // March 14 prices (initial)
    const marchPrices = new Map<string, number>();
    // June 2 prices (post-fix)
    const junePrices = new Map<string, number>();
    // Current prices
    const currentPrices = new Map<string, number>();

    allHistory.forEach(h => {
        const date = h.effective_date.substring(0, 10);
        if (date === '2026-03-14') {
            marchPrices.set(h.inventory_item_id, h.purchase_unit_cost);
        }
        if (date === '2026-06-02') {
            junePrices.set(h.inventory_item_id, h.purchase_unit_cost);
        }
    });

    allItems?.forEach(i => {
        currentPrices.set(i.id, i.purchase_unit_cost);
    });

    console.log(`\nMarch 14 prices: ${marchPrices.size}`);
    console.log(`June 2 prices: ${junePrices.size}`);
    console.log(`Current prices: ${currentPrices.size}`);

    // 3. Compare: items that DROPPED between March and June
    console.log('\n' + '='.repeat(80));
    console.log('🔴 ITEMS QUE BAJARON DE PRECIO (March 14 → June 2)');
    console.log('='.repeat(80));
    
    const drops: { name: string; marchPrice: number; junePrice: number; currentPrice: number; dropPct: number; qtyPerUnit: number }[] = [];
    const increases: { name: string; marchPrice: number; junePrice: number; dropPct: number }[] = [];
    const unchanged: string[] = [];

    for (const [itemId, marchPrice] of marchPrices) {
        const junePrice = junePrices.get(itemId);
        const item = itemMap.get(itemId);
        const currentPrice = currentPrices.get(itemId) || 0;

        if (junePrice === undefined) {
            // Not updated in June - check if price stayed the same
            continue;
        }

        const diff = junePrice - marchPrice;
        const pctChange = marchPrice > 0 ? (diff / marchPrice) * 100 : 0;

        if (pctChange < -1) { // More than 1% drop
            drops.push({
                name: item?.name || itemId.substring(0, 8),
                marchPrice,
                junePrice,
                currentPrice,
                dropPct: pctChange,
                qtyPerUnit: item?.quantity_per_unit || 1
            });
        } else if (pctChange > 1) { // More than 1% increase
            increases.push({
                name: item?.name || itemId.substring(0, 8),
                marchPrice,
                junePrice,
                dropPct: pctChange
            });
        } else {
            unchanged.push(item?.name || itemId.substring(0, 8));
        }
    }

    // Sort drops by magnitude (most significant first)
    drops.sort((a, b) => a.dropPct - b.dropPct);

    console.log(`\n⬇️  ${drops.length} items bajaron de precio:`);
    drops.forEach(d => {
        const perUnitMarch = (d.marchPrice / d.qtyPerUnit).toFixed(4);
        const perUnitJune = (d.junePrice / d.qtyPerUnit).toFixed(4);
        console.log(`  ${d.dropPct.toFixed(1)}% ⬇️  "${d.name}"`);
        console.log(`      March: $${d.marchPrice.toFixed(2)} → June: $${d.junePrice.toFixed(2)} → Current: $${d.currentPrice.toFixed(2)}`);
        console.log(`      Per unit: $${perUnitMarch} → $${perUnitJune}`);
    });

    console.log(`\n⬆️  ${increases.length} items subieron de precio:`);
    increases.sort((a, b) => b.dropPct - a.dropPct);
    increases.slice(0, 20).forEach(i => {
        console.log(`  +${i.dropPct.toFixed(1)}% ⬆️  "${i.name}": $${i.marchPrice.toFixed(2)} → $${i.junePrice.toFixed(2)}`);
    });

    console.log(`\n⏸️  ${unchanged.length} items sin cambio significativo (<1%)`);

    // 4. Items in March but NOT in June (potentially stuck with old prices)
    console.log('\n' + '='.repeat(80));
    console.log('⚠️  ITEMS EN MARZO QUE NO SE ACTUALIZARON EN JUNIO');
    console.log('='.repeat(80));
    
    const missingFromJune: { name: string; marchPrice: number; currentPrice: number }[] = [];
    for (const [itemId, marchPrice] of marchPrices) {
        if (!junePrices.has(itemId)) {
            const item = itemMap.get(itemId);
            const currentPrice = currentPrices.get(itemId) || 0;
            missingFromJune.push({
                name: item?.name || itemId.substring(0, 8),
                marchPrice,
                currentPrice
            });
        }
    }

    missingFromJune.sort((a, b) => b.marchPrice - a.marchPrice);
    console.log(`\n${missingFromJune.length} items no se actualizaron en junio:`);
    missingFromJune.forEach(m => {
        const changed = Math.abs(m.marchPrice - m.currentPrice) > 0.01 ? '⚠️ CHANGED SINCE' : '✅ Same';
        console.log(`  "${m.name}": March $${m.marchPrice.toFixed(2)} | Current: $${m.currentPrice.toFixed(2)} | ${changed}`);
    });

    // 5. Check meat items specifically
    console.log('\n' + '='.repeat(80));
    console.log('🥩 PRECIOS DE CARNES: COMPARACIÓN DETALLADA');
    console.log('='.repeat(80));

    const meatKeywords = ['asada', 'pollo', 'pastor', 'cabeza', 'carnitas', 'buche', 'lengua', 'chorizo', 'birria'];
    const allMeats = allItems?.filter(i => 
        meatKeywords.some(k => i.name.toLowerCase().includes(k))
    ) || [];

    for (const meat of allMeats) {
        const marchP = marchPrices.get(meat.id);
        const juneP = junePrices.get(meat.id);
        const curP = meat.purchase_unit_cost;
        const qty = meat.quantity_per_unit || 1;

        console.log(`\n  "${meat.name}" (${meat.unit_type}, qty/unit: ${qty}):`);
        console.log(`    March 14:  ${marchP !== undefined ? '$' + marchP.toFixed(2) + ' (per unit: $' + (marchP/qty).toFixed(4) + ')' : '❌ No entry'}`);
        console.log(`    June 2:    ${juneP !== undefined ? '$' + juneP.toFixed(2) + ' (per unit: $' + (juneP/qty).toFixed(4) + ')' : '❌ No entry'}`);
        console.log(`    Current:   $${curP.toFixed(2)} (per unit: $${(curP/qty).toFixed(4)})`);
        
        if (marchP !== undefined && juneP !== undefined) {
            const pctChange = ((juneP - marchP) / marchP * 100).toFixed(1);
            console.log(`    Change:    ${Number(pctChange) > 0 ? '+' : ''}${pctChange}%`);
        }
    }

    // 6. Summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN');
    console.log('='.repeat(80));
    
    const totalMarchCost = [...marchPrices.values()].reduce((a, b) => a + b, 0);
    const totalJuneCost = [...junePrices.values()].reduce((a, b) => a + b, 0);
    // Only compare items present in both
    let matchedMarchSum = 0, matchedJuneSum = 0;
    for (const [id, mp] of marchPrices) {
        const jp = junePrices.get(id);
        if (jp !== undefined) {
            matchedMarchSum += mp;
            matchedJuneSum += jp;
        }
    }
    
    console.log(`  Matched items (both March & June): ${junePrices.size}`);
    console.log(`  Sum of March prices: $${matchedMarchSum.toFixed(2)}`);
    console.log(`  Sum of June prices:  $${matchedJuneSum.toFixed(2)}`);
    console.log(`  Overall change: ${((matchedJuneSum - matchedMarchSum) / matchedMarchSum * 100).toFixed(1)}%`);

    console.log('\n✅ Comparación completada.');
}

compare().catch(console.error);
