
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkBurritoRecipe() {
    const guid = '2fa0875b-b503-42ef-b54a-f0031d4cdd1d';
    console.log(`--- ANALYZING: Meat Only Super Burrito Asada (${guid}) ---`);

    const { data: recipeRows } = await supabase
        .from('recipes')
        .select(`*, inv:inventory_items(*)`)
        .eq('toast_menu_item_guid', guid);

    if (!recipeRows?.length) {
        console.log('No recipe found.');
        return;
    }

    let totalCost = 0;
    recipeRows.forEach(r => {
        const costPerUnit = r.inv.purchase_unit_cost / r.inv.quantity_per_unit;
        const yieldFactor = (r.inv.yield_percent || 100) / 100;
        let lbs = (r.unit.startsWith('oz') ? r.quantity / 16 : r.quantity);
        const line = (lbs / yieldFactor) * costPerUnit;
        totalCost += line;
        console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit} (Cost: $${line.toFixed(4)})`);
    });
    console.log(`TOTAL COST: $${totalCost.toFixed(4)}`);
}

checkBurritoRecipe();
