/**
 * Investigación enfocada:
 * 1. ¿Cómo se llaman las columnas reales de food_cost_daily_cache?
 * 2. ¿El Papelito está en recipe_ingredients o en recipes?
 * 3. ¿Cuántas recetas usan papelito POR TABLA?
 * 4. ¿Qué cambios de precio ocurrieron el 1 de junio (día del fix)?
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';

async function investigate2() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Check food_cost_daily_cache columns
    console.log('═══ 1. FOOD_COST_DAILY_CACHE SCHEMA ═══');
    const { data: sampleCache, error: cacheErr } = await supabase
        .from('food_cost_daily_cache')
        .select('*')
        .limit(1);
    
    if (cacheErr) {
        console.log(`  Error: ${cacheErr.message}`);
    } else if (sampleCache?.length) {
        console.log(`  Columns: ${Object.keys(sampleCache[0]).join(', ')}`);
        console.log(`  Sample:`, JSON.stringify(sampleCache[0], null, 2));
    } else {
        console.log('  ⚠️ Table exists but is EMPTY');
    }

    // 2. Check recipe_ingredients table
    console.log('\n═══ 2. RECIPE_INGREDIENTS TABLE CHECK ═══');
    const { data: riSample, error: riErr } = await supabase
        .from('recipe_ingredients')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .limit(5);
    
    if (riErr) {
        console.log(`  Error (table might not exist): ${riErr.message}`);
    } else {
        console.log(`  Papelito entries in recipe_ingredients: ${riSample?.length || 0}`);
        if (riSample?.length) {
            console.log(`  Columns: ${Object.keys(riSample[0]).join(', ')}`);
            riSample.forEach(r => console.log(`    Recipe: ${r.recipe_id} | qty: ${r.quantity} ${r.unit} | type: ${r.type}`));
        }
    }

    // 3. Check recipes table (flat) for papelito  
    console.log('\n═══ 3. RECIPES TABLE (flat) FOR PAPELITO ═══');
    const { data: flatRecipes, error: frErr } = await supabase
        .from('recipes')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .limit(5);
    
    if (frErr) {
        console.log(`  Error: ${frErr.message}`);
    } else {
        console.log(`  Papelito entries in recipes: ${flatRecipes?.length || 0}`);
        if (flatRecipes?.length) {
            console.log(`  Columns: ${Object.keys(flatRecipes[0]).join(', ')}`);
            flatRecipes.forEach(r => {
                console.log(`    GUID: ${r.toast_menu_item_guid} | qty: ${r.quantity} ${r.unit} | type: ${r.type} | name: ${r.menu_item_name}`);
            });
        }
    }

    // 4. All price history entries from June 1 specifically
    console.log('\n═══ 4. PRICE HISTORY: June 1, 2026 ═══');
    const { data: june1History } = await supabase
        .from('inventory_price_history')
        .select('inventory_item_id, purchase_unit_cost, effective_date')
        .gte('effective_date', '2026-06-01T00:00:00')
        .lte('effective_date', '2026-06-01T23:59:59');
    
    if (june1History?.length) {
        const itemIds = [...new Set(june1History.map(h => h.inventory_item_id))];
        const { data: items } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost')
            .in('id', itemIds);
        const nameMap = new Map(items?.map(i => [i.id, i.name]) || []);
        
        console.log(`  Total cambios en Jun 1: ${june1History.length}`);
        june1History.forEach(h => {
            const name = nameMap.get(h.inventory_item_id) || h.inventory_item_id.substring(0, 8);
            console.log(`    "${name}" → $${h.purchase_unit_cost} at ${h.effective_date}`);
        });
    } else {
        console.log('  No changes on June 1');
    }

    // 5. Check the FULL price history - ALL entries, ordered by date
    console.log('\n═══ 5. ALL PRICE HISTORY ENTRIES (total count) ═══');
    const { count: totalHistory } = await supabase
        .from('inventory_price_history')
        .select('id', { count: 'exact', head: true });
    console.log(`  Total price history entries: ${totalHistory}`);
    
    // Group by date
    const { data: allHistory } = await supabase
        .from('inventory_price_history')
        .select('effective_date')
        .order('effective_date', { ascending: true });
    
    if (allHistory?.length) {
        const dateGroups = new Map<string, number>();
        allHistory.forEach(h => {
            const date = h.effective_date.substring(0, 10);
            dateGroups.set(date, (dateGroups.get(date) || 0) + 1);
        });
        console.log(`  Dates with price changes:`);
        for (const [date, count] of dateGroups) {
            console.log(`    ${date}: ${count} changes`);
        }
    }

    // 6. Look at recipes table more broadly - what items have MOST recipe entries
    console.log('\n═══ 6. TOP INGREDIENTS BY RECIPE COUNT ═══');
    const { data: allRecipes } = await supabase
        .from('recipes')
        .select('inventory_item_id')
        .limit(10000);
    
    if (allRecipes?.length) {
        const countMap = new Map<string, number>();
        allRecipes.forEach(r => {
            const id = r.inventory_item_id;
            countMap.set(id, (countMap.get(id) || 0) + 1);
        });
        
        // Sort by count
        const sorted = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
        const topIds = sorted.map(s => s[0]);
        
        const { data: topItems } = await supabase
            .from('inventory_items')
            .select('id, name, purchase_unit_cost, quantity_per_unit')
            .in('id', topIds);
        
        const nameMap = new Map(topItems?.map(i => [i.id, i]) || []);
        
        sorted.forEach(([id, count]) => {
            const item = nameMap.get(id);
            const costPerUnit = item ? (item.purchase_unit_cost / (item.quantity_per_unit || 1)).toFixed(4) : '?';
            console.log(`    ${count} recipes → "${item?.name || id}" | cost/unit: $${costPerUnit}`);
        });
    }
}

investigate2();
