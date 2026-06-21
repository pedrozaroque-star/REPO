/**
 * Investigar: ¿Los precios de antes (FC 33%) o los de ahora (FC 27%) son los correctos?
 * 
 * Comparar precios ANTES vs DESPUÉS del 2 de junio para los ingredientes
 * más usados en recetas (mayor impacto en food cost).
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function investigatePriceDrop() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Get all price history entries to see before/after June 2
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .order('effective_date', { ascending: true });

    // 2. Get all inventory items
    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure');

    // 3. Get recipe usage counts
    const { data: recipes } = await supabase
        .from('recipes')
        .select('inventory_item_id, quantity, unit, type');

    if (!history || !items || !recipes) { console.log('No data'); return; }

    const itemMap = new Map(items.map(i => [i.id, i]));

    // Calculate weighted usage (recipe count × avg quantity)
    const usageMap = new Map<string, { count: number; avgQty: number; type: string }>();
    recipes.forEach(r => {
        if (!usageMap.has(r.inventory_item_id)) {
            usageMap.set(r.inventory_item_id, { count: 0, avgQty: 0, type: r.type || 'food' });
        }
        const u = usageMap.get(r.inventory_item_id)!;
        u.count++;
        u.avgQty += Number(r.quantity || 0);
    });

    // Group price history by item
    const priceHistory = new Map<string, { date: string; cost: number }[]>();
    history.forEach(h => {
        if (!priceHistory.has(h.inventory_item_id)) {
            priceHistory.set(h.inventory_item_id, []);
        }
        priceHistory.get(h.inventory_item_id)!.push({
            date: h.effective_date,
            cost: h.purchase_unit_cost
        });
    });

    // 4. For each item used in recipes, compare before/after June 2
    console.log('═══════════════════════════════════════════════════════════════════════════════════');
    console.log('  COMPARACIÓN DE PRECIOS: ANTES vs DESPUÉS del 2 de Junio 2026');
    console.log('  (Solo ingredientes usados en recetas, ordenados por impacto)');
    console.log('═══════════════════════════════════════════════════════════════════════════════════');

    interface Comparison {
        name: string;
        beforeCost: number;
        afterCost: number;
        changePct: number;
        qtyPerUnit: number;
        unit: string;
        recipeCount: number;
        beforePerUnit: number;
        afterPerUnit: number;
    }

    const comparisons: Comparison[] = [];

    for (const [itemId, usage] of usageMap) {
        const item = itemMap.get(itemId);
        if (!item) continue;
        if (usage.type !== 'food' && usage.type !== 'raw' && usage.type !== 'cooked') continue;

        const prices = priceHistory.get(itemId) || [];
        
        // Find last price before June 2 and first price after
        const beforePrices = prices.filter(p => p.date < '2026-06-02');
        const afterPrices = prices.filter(p => p.date >= '2026-06-02');

        let beforeCost = beforePrices.length > 0 ? beforePrices[beforePrices.length - 1].cost : null;
        let afterCost = afterPrices.length > 0 ? afterPrices[afterPrices.length - 1].cost : item.purchase_unit_cost;

        // If no before price, use the current as both (no change)
        if (beforeCost === null) beforeCost = afterCost;

        const qpu = item.quantity_per_unit || 1;
        const changePct = beforeCost > 0 ? ((afterCost - beforeCost) / beforeCost) * 100 : 0;

        comparisons.push({
            name: item.name,
            beforeCost,
            afterCost,
            changePct,
            qtyPerUnit: qpu,
            unit: item.unit_measure || '?',
            recipeCount: usage.count,
            beforePerUnit: beforeCost / qpu,
            afterPerUnit: afterCost / qpu
        });
    }

    // Sort by absolute change (biggest impact first)
    comparisons.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    // Show items that CHANGED
    const changed = comparisons.filter(c => Math.abs(c.changePct) > 1);
    console.log(`\n  📊 Items con cambio de precio >1%: ${changed.length}\n`);
    console.log(`${'Item'.padEnd(40)} | ${'ANTES'.padStart(8)} | ${'DESPUÉS'.padStart(8)} | ${'Cambio'.padStart(8)} | ${'$/unit ANTES'.padStart(12)} | ${'$/unit DESPUÉS'.padStart(14)} | Recetas`);
    console.log('─'.repeat(120));

    changed.forEach(c => {
        const dir = c.changePct > 0 ? '📈' : '📉';
        console.log(`${dir} ${c.name.substring(0, 38).padEnd(38)} | $${c.beforeCost.toFixed(2).padStart(7)} | $${c.afterCost.toFixed(2).padStart(7)} | ${c.changePct.toFixed(1).padStart(6)}% | $${c.beforePerUnit.toFixed(4).padStart(10)}/${c.unit} | $${c.afterPerUnit.toFixed(4).padStart(12)}/${c.unit} | ${c.recipeCount}`);
    });

    // Items with NO change
    const unchanged = comparisons.filter(c => Math.abs(c.changePct) <= 1);
    console.log(`\n  ✅ Items sin cambio: ${unchanged.length}`);

    // 5. SIMULATE: What would the average food cost be with OLD prices?
    console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
    console.log('  SIMULACIÓN: Food cost con precios VIEJOS vs NUEVOS');
    console.log('═══════════════════════════════════════════════════════════════════════════════════');

    // For items that changed, what's the total cost difference per "use"?
    let totalOldCostPerUse = 0;
    let totalNewCostPerUse = 0;
    
    changed.forEach(c => {
        // Rough: cost per recipe use = costPerUnit × avgQty
        // But we don't have avgQty here easily, so just show the per-unit difference
        totalOldCostPerUse += c.beforePerUnit * c.recipeCount;
        totalNewCostPerUse += c.afterPerUnit * c.recipeCount;
    });

    const priceDiffPct = totalOldCostPerUse > 0 
        ? ((totalNewCostPerUse - totalOldCostPerUse) / totalOldCostPerUse) * 100 
        : 0;
    
    console.log(`  Weighted old cost index: $${totalOldCostPerUse.toFixed(2)}`);
    console.log(`  Weighted new cost index: $${totalNewCostPerUse.toFixed(2)}`);
    console.log(`  Change: ${priceDiffPct.toFixed(1)}%`);
    console.log(`\n  Si FC con precios nuevos = 27.6%`);
    console.log(`  Entonces FC con precios viejos ≈ ${(27.6 * (totalOldCostPerUse / totalNewCostPerUse)).toFixed(1)}%`);

    // 6. Specific meat analysis
    console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
    console.log('  🥩 ANÁLISIS DE CARNES (mayor impacto en food cost)');
    console.log('═══════════════════════════════════════════════════════════════════════════════════');
    
    const meats = comparisons.filter(c => 
        ['Carne Asada', 'Pastor', 'Pollo', 'Cabeza', 'Lengua', 'Birria', 'Buche', 'Carnitas', 'Chorizo', 'Milaneza']
        .some(m => c.name.toLowerCase().includes(m.toLowerCase()))
    );
    
    meats.forEach(c => {
        const dir = c.changePct > 0 ? '📈' : (c.changePct < -1 ? '📉' : '✅');
        console.log(`  ${dir} "${c.name}": $${c.beforePerUnit.toFixed(2)}/${c.unit} → $${c.afterPerUnit.toFixed(2)}/${c.unit} (${c.changePct.toFixed(1)}%) [${c.recipeCount} recetas]`);
    });

    // 7. What field does QB use?
    console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
    console.log('  🔑 PREGUNTA CLAVE');
    console.log('═══════════════════════════════════════════════════════════════════════════════════');
    console.log('  QuickBooks tiene DOS campos de precio:');
    console.log('    • PurchaseCost = lo que la bodega PAGA al proveedor externo');
    console.log('    • UnitPrice = lo que la bodega COBRA al restaurante');
    console.log('  ');
    console.log('  Nuestro sync usa PurchaseCost primero, UnitPrice como fallback.');
    console.log('  ');
    console.log('  Si la bodega le cobra al restaurante MÁS que el PurchaseCost,');
    console.log('  entonces el food cost real del RESTAURANTE debería usar UnitPrice.');
}

investigatePriceDrop();
