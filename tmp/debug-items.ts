import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Fetching target items from inventory_items...");
    const { data: invItems, error } = await supabase.from('inventory_items')
        .select('*')
        .or('name.ilike.%aguacate%,name.ilike.%guaca%,name.ilike.%frijol%,name.ilike.%arroz%');

    if (error) {
        console.error("Error fetching inventory items:", error);
        return;
    }
    
    console.log("Found Inventory Items:");
    for (const item of invItems) {
        console.log(`- ID: ${item.id} | Name: ${item.name} | Unit: ${item.purchase_unit}`);
        
        // Check if there are recipes referencing this item
        const { data: recipes, error: rError } = await supabase.from('recipes')
            .select('toast_menu_item_guid, quantity')
            .eq('inventory_item_id', item.id);
            
        console.log(`  -> Used in ${recipes ? recipes.length : 0} recipes.`);
    }
}

run();
