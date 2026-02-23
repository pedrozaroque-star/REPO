
import { getSupabaseClient } from '../lib/supabase';
import { calculateRecipeCost } from '../lib/inventory/costs';
import { Recipe, InventoryItem } from '../types/inventory';


async function debugProductCost(productName: string) {
    const supabase = await getSupabaseClient();

    // 1. Get ALL recipes
    const { data: allRecipes, error: recipeError } = await supabase
        .from('recipes')
        .select('*');

    if (recipeError) {
        console.error('Error fetching recipes:', recipeError);
        return;
    }

    // 2. Get inventory items
    const { data: inventoryData, error: invError } = await supabase
        .from('inventory_items')
        .select('*');

    if (invError) {
        console.error('Error fetching inventory:', invError);
        return;
    }

    console.log(`\n--- ASADA INVENTORY ITEMS ---`);
    inventoryData.forEach(item => {
        if (item.name.toLowerCase().includes('asada')) {
            console.log(`ID: ${item.id} | Name: ${item.name}`);
        }
    });

    // 3. Map recipes by GUID
    const recipeMap = new Map<string, any>();
    allRecipes.forEach((row: any) => {
        const guid = row.toast_menu_item_guid;
        if (!recipeMap.has(guid)) {
            recipeMap.set(guid, {
                guid,
                ingredients: []
            });
        }
        recipeMap.get(guid).ingredients.push({
            inventory_item_id: row.inventory_item_id,
            quantity: row.quantity,
            unit: row.unit,
            type: row.type || 'cooked'
        });
    });

    // 4. Fetch Names
    const { data: recipeNamesData } = await supabase.from('recipes').select('toast_menu_item_guid, name');
    const nameMap = new Map<string, string>();
    recipeNamesData?.forEach(r => nameMap.set(r.toast_menu_item_guid, r.name));

    console.log(`\n--- ALL BURRITO ASADA RECIPES ---`);
    recipeMap.forEach((recipe, guid) => {
        const name = nameMap.get(guid) || 'No Name in Mapping';
        if (name.toLowerCase().includes('burrito') && name.toLowerCase().includes('asada')) {
            const costRes = calculateRecipeCost(recipe as any, inventoryData as InventoryItem[]);
            console.log(`\nProduct: ${name} [${guid}]`);
            console.log(`Cost: $${costRes.totalCost.toFixed(4)}`);
            costRes.breakdown.forEach(b => {
                console.log(`  - ${b.itemName}: $${b.cost.toFixed(4)} (${b.quantity} ${b.unit})`);
            });
        }
    });

    console.log(`\n--- ANALYSIS FOR GUID: 0044c4e2-9736-4fc3-a7e1-f315ee76def4 ---`);
    const targetGuid = '0044c4e2-9736-4fc3-a7e1-f315ee76def4';
    const targetRecipe = recipeMap.get(targetGuid);
    if (targetRecipe) {
        const name = nameMap.get(targetGuid) || 'Unknown Name';
        console.log(`Name in System: ${name}`);
        const costRes = calculateRecipeCost(targetRecipe as any, inventoryData as InventoryItem[]);
        console.log(`Total Cost: $${costRes.totalCost.toFixed(4)}`);
        costRes.breakdown.forEach(b => {
            console.log(`  - ${b.itemName}: $${b.cost.toFixed(4)} (${b.quantity} ${b.unit})`);
        });
    } else {
        console.log("GUID not found in recipe map.");
    }

    console.log(`\n--- SEARCHING FOR 19.5122 oz ASADA ---`);
    recipeMap.forEach((recipe, guid) => {
        const has19oz = recipe.ingredients.some((ing: any) =>
            ing.inventory_item_id === 'fab9d589-8ae8-4381-87da-85f836068996' && // Carne Asada
            Math.abs(ing.quantity - 19.5122) < 0.01
        );

        if (has19oz) {
            const name = nameMap.get(guid) || 'No Name in Mapping';
            const costRes = calculateRecipeCost(recipe as any, inventoryData as InventoryItem[]);
            console.log(`\nFound: ${name} [${guid}]`);
            console.log(`Cost: $${costRes.totalCost.toFixed(4)}`);
            costRes.breakdown.forEach(b => {
                console.log(`  - ${b.itemName}: $${b.cost.toFixed(4)} (${b.quantity} ${b.unit})`);
            });
        }
    });
}

debugProductCost('Meat Only Burrito Asada');
