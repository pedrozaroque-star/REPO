/**
 * @module diagnose-food-cost-v2
 * @description Diagnóstico corregido del food cost usando las columnas reales de la BD.
 * Fixed food cost diagnostic using actual DB column names.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('🔍 DIAGNÓSTICO DE FOOD COST v2 - ' + new Date().toISOString());
    console.log('Database:', supabaseUrl);

    // ============================
    // 1. Food Cost Cache - Últimas 30 fechas (agregado por fecha)
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 1. FOOD COST CACHE - Últimas 30 fechas (by store aggregation)');
    console.log('='.repeat(80));
    
    // Get the most recent 30 dates first
    const { data: recentEntries, error: e1 } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date, store_id, store_name, total_cost, net_sales, cost_percentage, total_items, items_with_recipe, total_meat_lbs')
        .order('business_date', { ascending: false })
        .limit(500); // 15 stores × ~30 days = ~450

    if (e1) {
        console.error('Error:', e1);
    } else if (recentEntries) {
        // Group by date
        const grouped: Record<string, { stores: number; sumCost: number; sumSales: number; totalItems: number; itemsWithRecipe: number; totalMeatLbs: number }> = {};
        for (const row of recentEntries) {
            const d = row.business_date;
            if (!grouped[d]) grouped[d] = { stores: 0, sumCost: 0, sumSales: 0, totalItems: 0, itemsWithRecipe: 0, totalMeatLbs: 0 };
            grouped[d].stores++;
            grouped[d].sumCost += Number(row.total_cost) || 0;
            grouped[d].sumSales += Number(row.net_sales) || 0;
            grouped[d].totalItems += Number(row.total_items) || 0;
            grouped[d].itemsWithRecipe += Number(row.items_with_recipe) || 0;
            grouped[d].totalMeatLbs += Number(row.total_meat_lbs) || 0;
        }
        const sortedDates = Object.keys(grouped).sort().reverse().slice(0, 30);
        console.table(sortedDates.map(d => ({
            fecha: d,
            tiendas: grouped[d].stores,
            total_cost: `$${grouped[d].sumCost.toFixed(2)}`,
            total_sales: `$${grouped[d].sumSales.toFixed(2)}`,
            fc_pct: grouped[d].sumSales > 0
                ? `${(grouped[d].sumCost / grouped[d].sumSales * 100).toFixed(2)}%`
                : 'N/A',
            total_items: grouped[d].totalItems,
            items_with_recipe: grouped[d].itemsWithRecipe,
            recipe_coverage: grouped[d].totalItems > 0
                ? `${(grouped[d].itemsWithRecipe / grouped[d].totalItems * 100).toFixed(1)}%`
                : 'N/A',
            meat_lbs: grouped[d].totalMeatLbs.toFixed(1)
        })));
    }

    // ============================
    // 2. Precios de Carnes Clave en inventory_items
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 2. PRECIOS DE CARNES en inventory_items');
    console.log('='.repeat(80));
    const { data: meats, error: e2 } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit, is_bodega, unit_measure, type')
        .eq('type', 'food')
        .or('name.ilike.%asada%,name.ilike.%pollo%,name.ilike.%pastor%,name.ilike.%cabeza%,name.ilike.%carnitas%,name.ilike.%chorizo%,name.ilike.%chicharron%,name.ilike.%buche%,name.ilike.%lengua%,name.ilike.%birria%')
        .order('purchase_unit_cost', { ascending: false });

    if (e2) {
        console.error('Error:', e2);
    } else if (meats) {
        console.table(meats.map(m => ({
            name: m.name,
            package_cost: `$${Number(m.purchase_unit_cost).toFixed(2)}`,
            qty_per_unit: m.quantity_per_unit,
            cost_per_unit: m.quantity_per_unit > 0
                ? `$${(Number(m.purchase_unit_cost) / m.quantity_per_unit).toFixed(4)}`
                : '⚠️ N/A (qty=0)',
            unit_measure: m.unit_measure,
            is_bodega: m.is_bodega
        })));
    }

    // ============================
    // 3. Detalle por tienda para la fecha más reciente
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 3. DETALLE POR TIENDA - Fecha más reciente en caché');
    console.log('='.repeat(80));

    const { data: latestRow } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date')
        .order('business_date', { ascending: false })
        .limit(1);

    const latestDate = latestRow?.[0]?.business_date;
    console.log(`  Fecha más reciente: ${latestDate}`);

    if (latestDate) {
        const { data: storeDetail, error: e3 } = await supabase
            .from('food_cost_daily_cache')
            .select('store_name, total_cost, net_sales, cost_percentage, total_items, items_with_recipe, total_meat_lbs')
            .eq('business_date', latestDate)
            .order('total_cost', { ascending: false });

        if (e3) {
            console.error('Error:', e3);
        } else if (storeDetail) {
            console.table(storeDetail.map(s => ({
                store: s.store_name?.substring(0, 25),
                cost: `$${Number(s.total_cost).toFixed(2)}`,
                sales: `$${Number(s.net_sales).toFixed(2)}`,
                fc_pct: `${Number(s.cost_percentage).toFixed(2)}%`,
                total_items: s.total_items,
                items_with_recipe: s.items_with_recipe,
                recipe_coverage: s.total_items > 0
                    ? `${(s.items_with_recipe / s.total_items * 100).toFixed(1)}%`
                    : 'N/A',
                meat_lbs: Number(s.total_meat_lbs).toFixed(1)
            })));
        }
    }

    // ============================
    // 4. PMIX Cache - Últimas 20 fechas
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 4. PMIX CACHE - Fechas disponibles (últimas 20)');
    console.log('='.repeat(80));

    const { data: pmixEntries, error: e4 } = await supabase
        .from('pmix_daily_cache')
        .select('business_date, store_id')
        .order('business_date', { ascending: false })
        .limit(500);

    if (e4) {
        console.error('Error:', e4);
    } else if (pmixEntries) {
        const pmixByDate: Record<string, number> = {};
        for (const row of pmixEntries) {
            const d = row.business_date;
            pmixByDate[d] = (pmixByDate[d] || 0) + 1;
        }
        const sorted = Object.entries(pmixByDate).sort(([a], [b]) => b.localeCompare(a)).slice(0, 20);
        console.table(sorted.map(([date, count]) => ({ fecha: date, stores_con_pmix: count })));
    }

    // ============================
    // 5. inventory_price_history - Últimos registros
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 5. HISTORIAL DE PRECIOS - Últimos cambios');
    console.log('='.repeat(80));

    const { data: priceHistory, error: e5 } = await supabase
        .from('inventory_price_history')
        .select('item_id, old_price, new_price, changed_at, source')
        .order('changed_at', { ascending: false })
        .limit(15);

    if (e5) {
        console.error('Error:', e5);
    } else if (priceHistory) {
        // Get item names for these items
        const itemIds = [...new Set(priceHistory.map(p => p.item_id))];
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name')
            .in('id', itemIds);
        const nameMap: Record<string, string> = {};
        items?.forEach(i => nameMap[i.id] = i.name);

        console.table(priceHistory.map(p => ({
            item: nameMap[p.item_id] || p.item_id.substring(0, 8),
            old_price: `$${Number(p.old_price).toFixed(2)}`,
            new_price: `$${Number(p.new_price).toFixed(2)}`,
            change: `${((Number(p.new_price) - Number(p.old_price)) / Number(p.old_price) * 100).toFixed(1)}%`,
            changed_at: new Date(p.changed_at).toISOString().substring(0, 16),
            source: p.source
        })));
    }

    // ============================
    // 6. Comparar Jun 1 vs fechas recientes - by store
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 6. COMPARACIÓN: Fechas clave (food cost agregado)');
    console.log('='.repeat(80));

    const datesToCompare = ['2026-06-01', '2026-06-02', '2026-06-10', '2026-06-15', '2026-06-18', '2026-06-19', '2026-06-20'];
    for (const date of datesToCompare) {
        const { data: dayData } = await supabase
            .from('food_cost_daily_cache')
            .select('total_cost, net_sales, cost_percentage, total_items, items_with_recipe')
            .eq('business_date', date);

        if (dayData && dayData.length > 0) {
            const sumCost = dayData.reduce((a, b) => a + Number(b.total_cost), 0);
            const sumSales = dayData.reduce((a, b) => a + Number(b.net_sales), 0);
            const totalItems = dayData.reduce((a, b) => a + Number(b.total_items), 0);
            const itemsWithRecipe = dayData.reduce((a, b) => a + Number(b.items_with_recipe), 0);
            const overallPct = sumSales > 0 ? (sumCost / sumSales * 100).toFixed(2) : 'N/A';
            console.log(`  ${date}: FC=${overallPct}% | Cost=$${sumCost.toFixed(2)} | Sales=$${sumSales.toFixed(2)} | Items=${totalItems} (${itemsWithRecipe} con receta = ${totalItems > 0 ? (itemsWithRecipe/totalItems*100).toFixed(1) : 0}%) | Stores=${dayData.length}`);
        } else {
            console.log(`  ${date}: ❌ No hay datos en caché`);
        }
    }

    // ============================
    // 7. Verificar si hay items con quantity_per_unit = 0 o NULL
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 7. ITEMS CON quantity_per_unit SOSPECHOSO');
    console.log('='.repeat(80));

    const { data: suspiciousItems, error: e7 } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit, type')
        .eq('type', 'food')
        .or('quantity_per_unit.is.null,quantity_per_unit.eq.0,quantity_per_unit.lte.0')
        .order('purchase_unit_cost', { ascending: false })
        .limit(20);

    if (e7) {
        console.error('Error:', e7);
    } else if (suspiciousItems && suspiciousItems.length > 0) {
        console.log(`  ⚠️ ${suspiciousItems.length} items con quantity_per_unit = 0 o NULL:`);
        console.table(suspiciousItems.map(s => ({
            name: s.name,
            cost: `$${Number(s.purchase_unit_cost).toFixed(2)}`,
            qty_per_unit: s.quantity_per_unit
        })));
    } else {
        console.log('  ✅ Todos los items de tipo "food" tienen quantity_per_unit válido');
    }

    // ============================
    // 8. Conteo total de recetas
    // ============================
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 8. RESUMEN DE RECETAS');
    console.log('='.repeat(80));

    const { count: recipeCount } = await supabase
        .from('recipes')
        .select('id', { count: 'exact', head: true });
    console.log(`  Total recetas en DB: ${recipeCount}`);

    const { count: ingredientCount } = await supabase
        .from('recipe_ingredients')
        .select('id', { count: 'exact', head: true });
    console.log(`  Total ingredientes en recetas: ${ingredientCount}`);

    console.log('\n\n✅ Diagnóstico v2 completado.');
}

run().catch(console.error);
