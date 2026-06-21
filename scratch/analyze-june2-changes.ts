/**
 * SMOKING GUN: ¿Qué 350 precios cambiaron el 2 de junio?
 * Compara el precio ANTES (2026-06-01) vs DESPUÉS (2026-06-02) para cada item.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function analyze_june2() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get ALL price changes from June 2
    const { data: june2Changes } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .gte('effective_date', '2026-06-02T00:00:00')
        .lte('effective_date', '2026-06-02T23:59:59')
        .order('purchase_unit_cost', { ascending: false });

    if (!june2Changes?.length) {
        console.log('No changes found on June 2');
        return;
    }

    // Get item details
    const itemIds = [...new Set(june2Changes.map(h => h.inventory_item_id))];
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type, unit_measure')
        .in('id', itemIds);
    const itemMap = new Map(items?.map(i => [i.id, i]) || []);

    // Get the PREVIOUS price for each item (price history BEFORE June 2)
    const { data: prevHistory } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .lt('effective_date', '2026-06-02T00:00:00')
        .order('effective_date', { ascending: false });

    // Build map of latest price before June 2
    const prevPriceMap = new Map<string, number>();
    prevHistory?.forEach(h => {
        if (!prevPriceMap.has(h.inventory_item_id)) {
            prevPriceMap.set(h.inventory_item_id, h.purchase_unit_cost);
        }
    });

    console.log(`═══════════════════════════════════════════════════`);
    console.log(`  350 PRICE CHANGES ON JUNE 2, 2026`);
    console.log(`═══════════════════════════════════════════════════`);
    console.log(`  Total changes: ${june2Changes.length}`);

    // Classify changes: UP, DOWN, SAME, NEW (no previous)
    let pricesUp = 0, pricesDown = 0, pricesSame = 0, pricesNew = 0;
    const bigDrops: any[] = [];
    const bigRises: any[] = [];
    let totalFoodCostImpact = 0;

    june2Changes.forEach(change => {
        const item = itemMap.get(change.inventory_item_id);
        const prevPrice = prevPriceMap.get(change.inventory_item_id);
        const newPrice = change.purchase_unit_cost;
        const name = item?.name || change.inventory_item_id.substring(0, 8);

        if (prevPrice === undefined) {
            pricesNew++;
            return;
        }

        const diff = newPrice - prevPrice;
        const pctChange = prevPrice > 0 ? ((diff / prevPrice) * 100) : 0;

        if (Math.abs(diff) < 0.01) {
            pricesSame++;
        } else if (diff > 0) {
            pricesUp++;
            if (pctChange > 20) {
                bigRises.push({ name, prevPrice, newPrice, pctChange, diff });
            }
        } else {
            pricesDown++;
            totalFoodCostImpact += diff; // negative
            if (pctChange < -20) {
                bigDrops.push({ name, prevPrice, newPrice, pctChange, diff });
            }
        }
    });

    console.log(`\n  📊 Summary:`);
    console.log(`    ⬆️  Prices UP:   ${pricesUp}`);
    console.log(`    ⬇️  Prices DOWN: ${pricesDown}`);
    console.log(`    ➡️  Same:        ${pricesSame}`);
    console.log(`    🆕  New (no prev): ${pricesNew}`);

    // Sort big drops by impact
    bigDrops.sort((a, b) => a.diff - b.diff);
    bigRises.sort((a, b) => b.diff - a.diff);

    console.log(`\n  🔴 TOP DROPS (>20% decrease):`);
    bigDrops.slice(0, 25).forEach(d => {
        console.log(`    "${d.name}": $${d.prevPrice.toFixed(2)} → $${d.newPrice.toFixed(2)} (${d.pctChange.toFixed(1)}%) [Δ $${d.diff.toFixed(2)}]`);
    });

    console.log(`\n  🟢 TOP RISES (>20% increase):`);
    bigRises.slice(0, 15).forEach(r => {
        console.log(`    "${r.name}": $${r.prevPrice.toFixed(2)} → $${r.newPrice.toFixed(2)} (+${r.pctChange.toFixed(1)}%) [Δ +$${r.diff.toFixed(2)}]`);
    });

    // Show ALL the June 2 changes with before/after
    console.log(`\n  📋 COMPLETE LIST (before → after):`);
    const allChanges: { name: string; prev: number; after: number; diff: number }[] = [];
    june2Changes.forEach(change => {
        const item = itemMap.get(change.inventory_item_id);
        const prevPrice = prevPriceMap.get(change.inventory_item_id) ?? -1;
        const name = item?.name || change.inventory_item_id.substring(0, 8);
        allChanges.push({ name, prev: prevPrice, after: change.purchase_unit_cost, diff: change.purchase_unit_cost - prevPrice });
    });
    
    // Sort by absolute diff (biggest impact first)
    allChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    allChanges.slice(0, 50).forEach(c => {
        const arrow = c.prev < 0 ? '🆕' : (c.diff > 0 ? '⬆️' : (c.diff < 0 ? '⬇️' : '➡️'));
        const prevStr = c.prev < 0 ? 'NEW' : `$${c.prev.toFixed(2)}`;
        console.log(`    ${arrow} "${c.name}": ${prevStr} → $${c.after.toFixed(2)} [Δ $${c.diff.toFixed(2)}]`);
    });
}

analyze_june2();
