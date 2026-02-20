
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkExtraCarne() {
    const guid = 'c467971b-e4dd-48b8-852b-aa8440106735';
    const { data: recipe } = await supabase
        .from('recipes')
        .select(`*, inv:inventory_items(*)`)
        .eq('toast_menu_item_guid', guid);

    console.log('Recipe for Extra Carne:', recipe);
}

checkExtraCarne();
