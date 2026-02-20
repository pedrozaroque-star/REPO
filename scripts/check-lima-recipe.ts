
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkLimaRecipe() {
    const guid = 'd28aed59-5303-49a3-a8a2-0a93c05d87bc';
    const { data: recipe } = await supabase.from('recipes').select('*').eq('toast_menu_item_guid', guid);
    console.log('--- LIMA RECIPE DATA ---');
    console.log(JSON.stringify(recipe, null, 2));
}

checkLimaRecipe();
