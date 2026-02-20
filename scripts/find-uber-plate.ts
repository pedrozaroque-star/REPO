
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function findUberPlate() {
    console.log('Searching for all Taco Plates...');
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('name, guid, group_name')
        .ilike('name', 'Taco Plate%');

    console.log('Results:', items);

    if (items) {
        for (const item of items) {
            console.log(`\nRecipe for ${item.name} [${item.group_name}] (${item.guid}):`);
            const { data: recipe } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', item.guid);

            if (recipe?.length) {
                recipe.forEach(r => {
                    console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit}`);
                });
            } else {
                console.log(' - No recipe found.');
            }
        }
    }

    // Also search for packaging
    console.log('\nSearching for packaging in inventory...');
    const { data: pkg } = await supabase
        .from('inventory_items')
        .select('name, purchase_unit_cost, quantity_per_unit')
        .or('name.ilike.%box%,name.ilike.%container%,name.ilike.%bag%,name.ilike.%delivery%');
    console.log('Packaging:', pkg);
}

findUberPlate();
