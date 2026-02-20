
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { calculateRecipeCost } = require('../lib/inventory/costs');

async function debugExpensiveBurrito() {
    const guid = '656b4a82-c240-42b7-916a-5ed277302d8b';

    // 1. Get Recipes and Inventory
    const { data: recipes } = await supabase.from('recipes').select(`*, inv:inventory_items(*)`).eq('toast_menu_item_guid', guid);
    const { data: allInv } = await supabase.from('inventory_items').select('*');

    if (!recipes || recipes.length === 0) {
        console.log(`No recipe found for GUID: ${guid}`);
        return;
    }

    console.log(`--- BREAKDOWN FOR MEAT ONLY BURRITO PASTOR (${guid}) ---`);
    const costResult = calculateRecipeCost({ ingredients: recipes } as any, allInv as any);

    console.log(`TOTAL COST: $${costResult.totalCost.toFixed(2)}`);
    console.log(`INGREDIENTS:`);
    costResult.breakdown.forEach((b: any) => {
        console.log(` - ${b.itemName}: ${b.quantity} ${b.unit} (Costo: $${b.cost.toFixed(2)})`);
    });
}

debugExpensiveBurrito();
