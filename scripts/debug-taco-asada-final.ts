
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceKey);

async function findTheGuiltyRecipe() {
    const guidPrefix = '6141b8b8';

    // 1. Find the recipe
    const { data: recipes } = await supabase
        .from('recipes')
        .select(`*, inv:inventory_items(*)`)
        .ilike('toast_menu_item_guid', `${guidPrefix}%`);

    if (!recipes || recipes.length === 0) {
        console.log('No recipe found for GUID prefix');
        return;
    }

    console.log(`--- RECIPE FOR ${recipes[0].toast_menu_item_guid} ---`);
    let total = 0;
    recipes.forEach(r => {
        const inv = r.inv;
        const costPerUnit = inv.purchase_unit_cost / inv.quantity_per_unit;
        const yieldFactor = (inv.yield_percent || 100) / 100;
        let qtyToUse = r.quantity;
        if (r.unit === 'oz') qtyToUse = r.quantity / 16;

        const lineCost = (qtyToUse / yieldFactor) * costPerUnit;
        total += lineCost;
        console.log(` - ${inv.name}: ${r.quantity} ${r.unit} (Cost: $${lineCost.toFixed(4)})`);
    });
    console.log(`TOTAL RECIPE COST: $${total.toFixed(4)}`);
}

findTheGuiltyRecipe();
