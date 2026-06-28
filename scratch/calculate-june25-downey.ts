import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getProductMix } from '../lib/toast-pmix';
import { getSupabaseAdminClient } from '../lib/supabase';
import { calculateRecipeCost } from '../lib/inventory/costs';
import { Recipe } from '../types/inventory';

async function run() {
    const storeId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'; // Downey external_id
    const date = '2026-06-25';

    console.log(`Calculating food cost for Downey on ${date}...`);

    // 1. Fetch pmixItems
    const pmixItems = await getProductMix({ 
        storeId, 
        startDate: date, 
        endDate: date, 
        bundleModifiers: true 
    });

    console.log(`getProductMix returned ${pmixItems.length} items.`);
    if (pmixItems.length === 0) {
        console.log('No PMIX items found.');
        return;
    }

    // Print first 5 items to verify their structure
    console.log('Sample PMIX items (first 5):', pmixItems.slice(0, 5).map(item => ({
        guid: item.guid,
        name: item.name,
        quantity: item.quantity,
        net_sales: item.net_sales,
        store_id: (item as any).store_id,
        store_name: (item as any).store_name
    })));

    // 2. Fetch recipes and inventory items
    const supabase = await getSupabaseAdminClient();
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

    // 3. Process report
    let totalItems = 0;
    let itemsWithRecipe = 0;
    let totalCost = 0;
    let totalSales = 0;

    const noRecipeList: any[] = [];

    pmixItems.forEach(item => {
        if (item.name.toLowerCase().includes('separator')) return;
        totalItems++;
        const recipe = recipeMap.get(item.guid);
        let hasRecipe = !!recipe;

        let itemCost = 0;
        if (recipe) {
            itemsWithRecipe++;
            const costResult = calculateRecipeCost(recipe, inventoryData as any, item.group_name);
            itemCost = costResult.foodCost * item.quantity;
        } else {
            noRecipeList.push(item);
        }

        totalCost += itemCost;
        totalSales += item.net_sales;
    });

    console.log(`Calculation finished:`);
    console.log(`  Total Items processed: ${totalItems}`);
    console.log(`  Items with recipe: ${itemsWithRecipe}`);
    console.log(`  Total Cost: $${totalCost.toFixed(2)}`);
    console.log(`  Total Sales (from PMIX): $${totalSales.toFixed(2)}`);
    console.log(`  FC %: ${totalSales > 0 ? (totalCost / totalSales * 100).toFixed(2) : 0}%`);

    if (noRecipeList.length > 0) {
        console.log(`Items without recipe count: ${noRecipeList.length}`);
        console.log('Sample items without recipe (top 10 by qty):');
        noRecipeList.sort((a,b) => b.quantity - a.quantity).slice(0, 10).forEach(item => {
            console.log(`  GUID: ${item.guid} | Name: "${item.name}" | Qty: ${item.quantity} | Sales: $${item.net_sales}`);
        });
    }
}

run().catch(console.error);
