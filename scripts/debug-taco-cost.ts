
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function debugTacoIssue() {
    const parentGuid = '6141b8b8-0d10-449e-b9b0-bb230235ad6c'; // Likely part of the GUID in screenshot 6141b8b8...
    console.log(`--- DEBUGGING PRODUCT: 6141b8b8... ---`);

    // 1. Get Recipe for the product
    const { data: recipes } = await supabase.from('recipes').select('*').ilike('toast_menu_item_guid', '6141b8b8%');
    console.log('Main Recipes found:', recipes?.length);
    recipes?.forEach(r => console.log(` - Recipe for ${r.toast_menu_item_guid}: Base Cost placeholder logic...`));

    // 2. Search for common modifiers that might be linked
    // Since I don't have the sales data here, I'll search for recipes that have a very high cost
    console.log('\nChecking for high-cost recipes (> $10)...');
    const { data: allRecipes } = await supabase.from('recipes').select('*, inv:inventory_items(*)');

    // We need to calculate costs for all to find the culprit
    const { calculateRecipeCost } = require('../lib/inventory/costs');
    const { data: inventory } = await supabase.from('inventory_items').select('*');

    const highCostMods = [];
    if (allRecipes) {
        // Group recipes by GUID
        const guidMap = new Map();
        allRecipes.forEach(r => {
            if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
            guidMap.get(r.toast_menu_item_guid).push(r);
        });

        for (const [guid, items] of guidMap.entries()) {
            const cost = calculateRecipeCost(items, inventory).totalCost;
            if (cost > 10) {
                highCostMods.push({ guid, cost });
            }
        }
    }

    console.log('High cost recipes found:', highCostMods.length);
    highCostMods.slice(0, 10).forEach(m => console.log(` - GUID ${m.guid}: $${m.cost.toFixed(2)}`));
}

// Simulated calculateRecipeCost local copy because importing might fail in script
function calculateRecipeCostLocal(recipeItems, inventory) {
    let total = 0;
    recipeItems.forEach(r => {
        const inv = inventory.find(i => i.id === r.inventory_item_id);
        if (inv) {
            const costPerUnit = inv.purchase_unit_cost / inv.quantity_per_unit;
            const yieldFactor = (inv.yield_percent || 100) / 100;
            let lbs = (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
            total += (lbs / yieldFactor) * costPerUnit;
        }
    });
    return total;
}

debugTacoIssue();
