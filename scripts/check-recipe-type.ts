
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkRecipeType() {
    const asadaGuid = '6141b8b8-8707-4632-a837-81cfccffc0e6';
    const { data: recipes } = await supabase.from('recipes').select('*').eq('toast_menu_item_guid', asadaGuid);
    console.log('--- RECIPE TYPES FOR ASADA TACO ---');
    console.log(JSON.stringify(recipes, null, 2));
}

checkRecipeType();
