
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function findAnyExtraCarne() {
    console.log('Searching for any Extra Carne items with recipes...');
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('name, guid');

    if (items) {
        for (const item of items) {
            if (item.name.toLowerCase().includes('extra carne')) {
                const { data: recipe } = await supabase
                    .from('recipes')
                    .select('id')
                    .eq('toast_menu_item_guid', item.guid);

                if (recipe?.length) {
                    console.log(`FOUND RECIPE: ${item.name} (${item.guid})`);
                }
            }
        }
    }
}

findAnyExtraCarne();
