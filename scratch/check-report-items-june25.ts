import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getProductMix } from '../lib/toast-pmix';
import { getSupabaseAdminClient } from '../lib/supabase';
import { calculateRecipeCost } from '../lib/inventory/costs';
import { Recipe } from '../types/inventory';

async function run() {
    const startDate = '2026-06-25';
    const endDate = '2026-06-25';

    const supabase = await getSupabaseAdminClient();
    const { data: storesData } = await supabase
        .from('stores')
        .select('name, external_id')
        .eq('is_active', true);

    const validStores = storesData?.filter(s => s.external_id) || [];
    console.log(`Valid stores: ${validStores.length}`);

    const results: any[] = [];
    for (const s of validStores) {
        const items = await getProductMix({ storeId: s.external_id, startDate, endDate, bundleModifiers: true });
        results.push(...items.map(item => ({
            ...item,
            store_id: s.external_id,
            store_name: s.name || 'Unknown'
        })));
    }

    // 2. Fetch ALL Recipes and Inventory Items from DB
    const { data: recipesData } = await supabase.from('recipes').select('*');
    const { data: inventoryData } = await supabase.from('inventory_items').select('*');

    const recipeMap = new Map<string, Recipe>();
    recipesData?.forEach((row: any) => {
        const guid = row.toast_menu_item_guid;
        if (!recipeMap.has(guid)) {
            recipeMap.set(guid, {
                id: guid,
                toast_menu_item_guid: guid,
                ingredients: []
            });
        }
        recipeMap.get(guid)!.ingredients.push({
            inventory_item_id: row.inventory_item_id,
            quantity: row.quantity,
            unit: row.unit,
            type: row.type || 'cooked'
        });
    });

    const nameToRecipeMap = new Map<string, Recipe>();
    const { data: menuItemsWithRecipes } = await supabase
        .from('toast_menu_items')
        .select('guid, name')
        .in('guid', Array.from(recipeMap.keys()));

    if (menuItemsWithRecipes) {
        menuItemsWithRecipes.forEach((mi: any) => {
            const normalizedName = mi.name.trim().toLowerCase();
            if (!nameToRecipeMap.has(normalizedName)) {
                const recipe = recipeMap.get(mi.guid);
                if (recipe) {
                    nameToRecipeMap.set(normalizedName, recipe);
                }
            }
        });
    }

    // Aggregate by STORE + GUID + Group Name + Name (Variation)
    const aggMap = new Map<string, any>();
    results.forEach(item => {
        const key = `${item.store_name}_${item.guid}_${item.group_name || 'Uncategorized'}_${item.name}`;
        if (!aggMap.has(key)) {
            const newItem = { ...item };
            if (item.modifier_guids) newItem.modifier_guids = [...item.modifier_guids];
            aggMap.set(key, newItem);
        } else {
            const existing = aggMap.get(key);
            existing.quantity += item.quantity;
            existing.net_sales += item.net_sales;
            existing.gross_sales += item.gross_sales;
            existing.discounts += item.discounts;
            existing.voided_quantity += item.voided_quantity;
            if (item.modifier_guids && item.modifier_guids.length > 0) {
                if (!existing.modifier_guids) existing.modifier_guids = [];
                existing.modifier_guids.push(...item.modifier_guids);
            }
        }
    });

    const pmixItems = Array.from(aggMap.values()).map(item => ({
        ...item,
        unit_price: item.quantity > 0 ? item.gross_sales / item.quantity : 0
    }));

    const filteredPmix = pmixItems.filter(item => !item.name.toLowerCase().includes('separator'));

    const report = filteredPmix.map(item => {
        let recipe = recipeMap.get(item.guid);
        if (!recipe) {
            const baseName = item.name.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
            recipe = nameToRecipeMap.get(baseName);
        }
        return {
            ...item,
            has_recipe: !!recipe
        };
    });

    // Let's filter report items for Downey
    const downeyReportItems = report.filter(item => item.store_name === 'Downey');
    console.log(`\n=== DOWNEY REPORT ITEMS (${downeyReportItems.length} found) ===`);
    if (downeyReportItems.length > 0) {
        console.log('Sample Downey report items (first 10):');
        downeyReportItems.slice(0, 10).forEach(item => {
            console.log(`  GUID: ${item.guid} | Name: "${item.name}" | Qty: ${item.quantity} | Sales: $${item.net_sales} | Has Recipe: ${item.has_recipe}`);
        });
    }
}

run().catch(console.error);
