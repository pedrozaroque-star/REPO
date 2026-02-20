
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function findExpensivePlateMods() {
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`);
    const invItems = recipes?.map(r => r.inv) || [];

    const guidMap = new Map();
    recipes?.forEach(r => {
        if (!guidMap.has(r.toast_menu_item_guid)) guidMap.set(r.toast_menu_item_guid, []);
        guidMap.get(r.toast_menu_item_guid).push(r);
    });

    console.log("--- ANALYSIS OF ALL RECIPES ---");
    const results = [];
    for (const [guid, ingredients] of guidMap.entries()) {
        const costResult = calculateRecipeCost({ ingredients } as any, invItems as any);
        results.push({ guid, cost: costResult.totalCost, breakdown: costResult.breakdown });
    }

    // Sort by cost
    results.sort((a, b) => b.cost - a.cost);

    console.log("\nTOP 20 MOST EXPENSIVE RECIPES:");
    results.slice(0, 20).forEach(r => {
        console.log(`GUID: ${r.guid} - Cost: $${r.cost.toFixed(2)}`);
        r.breakdown.forEach(b => console.log(`  - ${b.itemName}: ${b.quantity} ${b.unit} ($${b.cost.toFixed(2)})`));
    });
}

findExpensivePlateMods();
