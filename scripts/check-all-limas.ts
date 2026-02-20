
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkLimaRecipes() {
    const { data: recipes } = await supabase.from('recipes').select('*').eq('inventory_item_id', 'f73fe7a6-105c-4624-a87b-07d5f78c09ea');
    console.log('--- ALL RECIPES USING LIMA BOLSITA ---');
    console.table(recipes?.map(r => ({ guid: r.toast_menu_item_guid, qty: r.quantity, unit: r.unit })));
}

checkLimaRecipes();
