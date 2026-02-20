
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkUberGroup() {
    console.log('Searching for items in UBER EATS - DELIVERY group...');
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('*')
        .ilike('group_name', '%UBER EATS%');

    console.log(`Found ${items?.length || 0} items.`);

    if (items) {
        for (const item of items) {
            const { data: recipe } = await supabase
                .from('recipes')
                .select(`*, inv:inventory_items(*)`)
                .eq('toast_menu_item_guid', item.guid);

            if (recipe?.length) {
                console.log(`\nRECIPE FOUND: ${item.name} (${item.guid})`);
                recipe.forEach(r => console.log(` - ${r.inv.name}: ${r.quantity} ${r.unit}`));
            }
        }
    }
}

checkUberGroup();
