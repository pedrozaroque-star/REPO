/**
 * Investigación profunda: ¿Desde cuándo está mal el food cost?
 * 
 * 1. Historial completo de precios del Papelito
 * 2. Comparar food cost cache día por día para detectar el punto de quiebre
 * 3. Revisar TODOS los cambios de precio que ocurrieron entre mayo y junio
 * 4. Buscar qué otros items pudieron causar la caída del 33% al 27%
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';

async function investigate() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // ═══════════════════════════════════════════════════
    // 1. HISTORIAL COMPLETO DE PRECIOS DEL PAPELITO
    // ═══════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════');
    console.log('  1. HISTORIAL COMPLETO DE PRECIOS - PAPELITO');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: papHistory } = await supabase
        .from('inventory_price_history')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .order('effective_date', { ascending: true });
    
    if (papHistory?.length) {
        papHistory.forEach(h => {
            const perPiece = (h.purchase_unit_cost / 60).toFixed(4);
            console.log(`  ${h.effective_date} → $${h.purchase_unit_cost} ($/pieza: $${perPiece})`);
        });
    } else {
        console.log('  ⚠️ Solo 0 entradas en price_history');
    }

    // ═══════════════════════════════════════════════════
    // 2. TODOS LOS CAMBIOS DE PRECIO (mayo-junio 2026)
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  2. TODOS LOS CAMBIOS DE PRECIO (May-Jun 2026)');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: allPriceChanges } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .gte('effective_date', '2026-05-01')
        .order('effective_date', { ascending: true });
    
    if (allPriceChanges?.length) {
        // Get item names
        const itemIds = [...new Set(allPriceChanges.map(h => h.inventory_item_id))];
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit')
            .in('id', itemIds);
        
        const nameMap = new Map(items?.map(i => [i.id, i]) || []);
        
        console.log(`  Total cambios de precio en mayo-junio: ${allPriceChanges.length}`);
        console.log('  ---');
        
        // Group by date
        const byDate = new Map<string, any[]>();
        allPriceChanges.forEach(h => {
            const date = h.effective_date.substring(0, 10);
            if (!byDate.has(date)) byDate.set(date, []);
            byDate.get(date)!.push(h);
        });
        
        for (const [date, changes] of byDate) {
            console.log(`\n  📅 ${date} (${changes.length} cambios):`);
            changes.forEach(c => {
                const item = nameMap.get(c.inventory_item_id);
                const name = item?.name || c.inventory_item_id.substring(0, 8);
                console.log(`    "${name}" → $${c.purchase_unit_cost}`);
            });
        }
    } else {
        console.log('  No se encontraron cambios de precio en este periodo');
    }

    // ═══════════════════════════════════════════════════
    // 3. FOOD COST CACHE - TENDENCIA DIARIA
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  3. FOOD COST CACHE - TENDENCIA (May-Jun 2026)');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: fcCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date, store_id, total_food_cost, total_packaging_cost, total_net_sales')
        .gte('business_date', '2026-05-25')
        .lte('business_date', '2026-06-10')
        .order('business_date', { ascending: true });
    
    if (fcCache?.length) {
        // Aggregate by date (sum across all stores)
        const byDate = new Map<string, { food: number, pkg: number, sales: number, stores: number }>();
        fcCache.forEach(fc => {
            const date = fc.business_date;
            if (!byDate.has(date)) byDate.set(date, { food: 0, pkg: 0, sales: 0, stores: 0 });
            const d = byDate.get(date)!;
            d.food += Number(fc.total_food_cost || 0);
            d.pkg += Number(fc.total_packaging_cost || 0);
            d.sales += Number(fc.total_net_sales || 0);
            d.stores++;
        });
        
        for (const [date, d] of byDate) {
            const fcPct = d.sales > 0 ? ((d.food / d.sales) * 100).toFixed(1) : '0';
            const pkgPct = d.sales > 0 ? ((d.pkg / d.sales) * 100).toFixed(1) : '0';
            const marker = Number(fcPct) < 30 ? '🔴' : '✅';
            console.log(`  ${marker} ${date} | ${d.stores} stores | food: $${d.food.toFixed(0)} (${fcPct}%) | pkg: $${d.pkg.toFixed(0)} (${pkgPct}%) | sales: $${d.sales.toFixed(0)}`);
        }
    } else {
        console.log('  No cache data found');
    }

    // ═══════════════════════════════════════════════════
    // 4. TOP 20 ITEMS MÁS CAROS EN INVENTARIO
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  4. TOP 20 ITEMS POR COSTO (posibles causantes)');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: topItems } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type, updated_at')
        .order('purchase_unit_cost', { ascending: false })
        .limit(20);
    
    topItems?.forEach((item, i) => {
        const perUnit = item.quantity_per_unit > 1 
            ? ` ($/unit: $${(item.purchase_unit_cost / item.quantity_per_unit).toFixed(2)})`
            : '';
        console.log(`  ${i+1}. "${item.name}" → $${item.purchase_unit_cost} ${item.unit_type || ''}${perUnit} | updated: ${item.updated_at?.substring(0, 10)}`);
    });

    // ═══════════════════════════════════════════════════
    // 5. ITEMS CON PRECIO $0 O MUY BAJO (sospechosos)
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  5. ITEMS CON PRECIO $0 (missing prices)');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: zeroItems, count: zeroCount } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, unit_type', { count: 'exact' })
        .lte('purchase_unit_cost', 0);
    
    console.log(`  Total items con precio $0 o menor: ${zeroCount}`);
    zeroItems?.slice(0, 15).forEach(item => {
        console.log(`    "${item.name}" → $${item.purchase_unit_cost} (${item.unit_type})`);
    });

    // ═══════════════════════════════════════════════════
    // 6. RECETAS QUE USAN PAPELITO - con nombres reales
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  6. RECETAS QUE USAN PAPELITO (con nombres Toast)');
    console.log('═══════════════════════════════════════════════════');
    
    const { data: papRecipes } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid, quantity, unit, type, menu_item_name')
        .eq('inventory_item_id', PAPELITO_ID);
    
    if (papRecipes?.length) {
        // Get names from toast_menu_items
        const guids = papRecipes.map(r => r.toast_menu_item_guid).filter(Boolean);
        const { data: menuItems } = await supabase
            .from('toast_menu_items')
            .select('guid, name')
            .in('guid', guids);
        
        const guidNameMap = new Map(menuItems?.map(m => [m.guid, m.name]) || []);
        
        console.log(`  Total: ${papRecipes.length} recetas usan Papelito`);
        papRecipes.forEach(r => {
            const name = r.menu_item_name || guidNameMap.get(r.toast_menu_item_guid) || r.toast_menu_item_guid?.substring(0, 16);
            const costPerRecipe = (34.80 / 60) * r.quantity;
            console.log(`    ${r.quantity} ${r.unit} (${r.type || 'food'}) → "${name}" | cost: $${costPerRecipe.toFixed(4)}`);
        });
    } else {
        console.log('  ⚠️ No hay recetas que usen Papelito');
    }

    // ═══════════════════════════════════════════════════
    // 7. CONTEO TOTAL DE RECETAS vs ITEMS DEL PMIX
    // ═══════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  7. COBERTURA DE RECETAS');
    console.log('═══════════════════════════════════════════════════');
    
    const { count: totalRecipeGuids } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid', { count: 'exact', head: true });
    
    // Count unique GUIDs
    const { data: uniqueGuids } = await supabase
        .from('recipes')
        .select('toast_menu_item_guid')
        .limit(10000);
    
    const uniqueGuidSet = new Set(uniqueGuids?.map(r => r.toast_menu_item_guid));
    console.log(`  Total entradas en tabla recipes: ${totalRecipeGuids}`);
    console.log(`  GUIDs únicos con receta: ${uniqueGuidSet.size}`);
}

investigate();
