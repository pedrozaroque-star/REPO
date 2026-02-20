
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkUber() {
    console.log('Searching for Uber/Delivery items...');
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('name, guid, group_name')
        .or('name.ilike.%uber%,name.ilike.%delivery%,group_name.ilike.%uber%')
        .limit(20);

    console.log('Results:', items);

    if (items) {
        for (const item of items) {
            const { data: recipe } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', item.guid);

            if (recipe?.length) {
                console.log(`\nRecipe for ${item.name} (${item.guid}):`);
                recipe.forEach(r => console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit}`));
            }
        }
    }
}

checkUber();
