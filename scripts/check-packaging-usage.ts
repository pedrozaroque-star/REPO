
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkPackagingUsage() {
    console.log('Searching for recipes that use packaging...');

    // 1. Get packaging item IDs
    const { data: pkgItems } = await supabase
        .from('inventory_items')
        .select('id, name')
        .or('name.ilike.%box%,name.ilike.%container%,name.ilike.%bag%,name.ilike.%dome%');

    if (!pkgItems) return;

    const ids = pkgItems.map(p => p.id);
    console.log(`Found ${ids.length} packaging items.`);

    // 2. Find recipes using these IDs
    const { data: usages } = await supabase
        .from('recipes')
        .select(`*, item:toast_menu_items(name, group_name)`)
        .in('inventory_item_id', ids);

    console.log(`Found ${usages?.length || 0} recipe lines using packaging.`);

    if (usages) {
        usages.forEach(u => {
            console.log(` - Used in: ${u.item?.name} [${u.item?.group_name}] | Qty: ${u.quantity} ${u.unit}`);
        });
    }
}

checkPackagingUsage();
