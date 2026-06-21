/**
 * Deep audit of "Papelito Para Torta" — traces the full chain:
 * 1. Current inventory_items state
 * 2. QuickBooks mapping (qb_item_id = 540)
 * 3. Price history (last 20)
 * 4. Recipes that reference this item (via recipe_ingredients or recipes table)
 * 5. Food cost cache impact
 * 6. Verify the multiplication logic: QB PurchaseCost × 60 = DB purchase_unit_cost
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PAPELITO_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807';

async function deepAudit() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Current inventory state
    console.log('=== 1. INVENTORY ITEM STATE ===');
    const { data: item } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('id', PAPELITO_ID)
        .single();
    
    if (!item) { console.log('❌ Papelito not found in inventory_items'); return; }
    console.log(`  Name: "${item.name}"`);
    console.log(`  purchase_unit_cost: $${item.purchase_unit_cost}`);
    console.log(`  quantity_per_unit: ${item.quantity_per_unit}`);
    console.log(`  unit_measure: ${item.unit_measure}`);
    console.log(`  unit_type: ${item.unit_type}`);
    console.log(`  is_bodega: ${item.is_bodega}`);
    console.log(`  yield_percent: ${item.yield_percent}`);
    console.log(`  → Costo por pieza: $${(item.purchase_unit_cost / (item.quantity_per_unit || 1)).toFixed(4)}`);
    console.log(`  → updated_at: ${item.updated_at}`);

    // 2. QB Mapping
    console.log('\n=== 2. QUICKBOOKS MAPPING ===');
    const { data: mapping } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .single();
    
    if (mapping) {
        console.log(`  qb_item_id: ${mapping.qb_item_id}`);
        console.log(`  qb_item_name: "${mapping.qb_item_name}"`);
        console.log(`  last_fetch_cost: $${mapping.last_fetch_cost}`);
        console.log(`  multiplier: ${mapping.multiplier ?? 'N/A (column may not exist)'}`);
        console.log(`  updated_at: ${mapping.updated_at}`);
        
        // Verify: if multiplier is 60, then last_fetch_cost / 60 should be the per-piece QB price
        if (mapping.last_fetch_cost) {
            console.log(`  → Implied QB per-piece: $${(mapping.last_fetch_cost / 60).toFixed(4)}`);
        }
    } else {
        console.log('  ❌ No mapping found');
    }

    // 3. Price History (ALL)
    console.log('\n=== 3. PRICE HISTORY (all entries) ===');
    const { data: history } = await supabase
        .from('inventory_price_history')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID)
        .order('effective_date', { ascending: false });
    
    if (history?.length) {
        history.forEach(h => {
            const perPiece = (h.purchase_unit_cost / 60).toFixed(4);
            console.log(`  ${h.effective_date} → $${h.purchase_unit_cost} (per pieza: $${perPiece})`);
        });
    } else {
        console.log('  No price history found');
    }

    // 4. Recipes — check BOTH the `recipes` table AND any `recipe_ingredients` table
    console.log('\n=== 4. RECIPES USING PAPELITO ===');
    
    // Check if there's a recipe_ingredients table
    const { data: recipeIngs } = await supabase
        .from('recipe_ingredients')
        .select('*, recipe:recipe_id(name)')
        .eq('inventory_item_id', PAPELITO_ID);
    
    if (recipeIngs?.length) {
        console.log(`  Found ${recipeIngs.length} recipe_ingredients entries:`);
        recipeIngs.forEach((ri: any) => {
            console.log(`    Recipe: "${ri.recipe?.name || ri.recipe_id}" | qty: ${ri.quantity} ${ri.unit} | type: ${ri.type}`);
        });
    } else {
        console.log('  No recipe_ingredients found for this item');
    }

    // Also check the old `recipes` table (flat structure)
    const { data: oldRecipes } = await supabase
        .from('recipes')
        .select('*')
        .eq('inventory_item_id', PAPELITO_ID);
    
    if (oldRecipes?.length) {
        console.log(`  Found ${oldRecipes.length} entries in flat 'recipes' table:`);
        oldRecipes.forEach((r: any) => {
            console.log(`    GUID: ${r.toast_menu_item_guid} | name: "${r.menu_item_name}" | qty: ${r.quantity} ${r.unit}`);
        });
    } else {
        console.log('  No flat recipes entries found for this item');
    }

    // 5. Food cost cache — sample check
    console.log('\n=== 5. FOOD COST CACHE SAMPLE ===');
    const { data: fcCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date, store_id, total_food_cost, total_packaging_cost, total_net_sales')
        .order('business_date', { ascending: false })
        .limit(5);
    
    if (fcCache?.length) {
        fcCache.forEach(fc => {
            const fcPct = fc.total_net_sales > 0 ? ((fc.total_food_cost / fc.total_net_sales) * 100).toFixed(2) : '0';
            console.log(`  ${fc.business_date} | store: ${fc.store_id?.substring(0, 8)}... | food: $${fc.total_food_cost?.toFixed(2)} | pkg: $${fc.total_packaging_cost?.toFixed(2)} | sales: $${fc.total_net_sales?.toFixed(2)} | FC%: ${fcPct}%`);
        });
    }

    // 6. Verify the MATH
    console.log('\n=== 6. MATH VERIFICATION ===');
    console.log(`  QB PurchaseCost per piece (expected): $0.58`);
    console.log(`  Case size (quantity_per_unit): 60`);
    console.log(`  Expected DB purchase_unit_cost: $${(0.58 * 60).toFixed(2)} (0.58 × 60)`);
    console.log(`  Actual DB purchase_unit_cost: $${item.purchase_unit_cost}`);
    console.log(`  ✅ Match: ${Math.abs(item.purchase_unit_cost - 34.8) < 0.01 ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  Actual costo por pieza: $${(item.purchase_unit_cost / (item.quantity_per_unit || 1)).toFixed(4)}`);
    console.log(`  Expected costo por pieza: $0.5800`);
    console.log(`  ✅ Per-piece match: ${Math.abs((item.purchase_unit_cost / (item.quantity_per_unit || 1)) - 0.58) < 0.001 ? 'YES ✅' : 'NO ❌'}`);
}

deepAudit();
