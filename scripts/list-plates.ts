
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkPlates() {
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('*')
        .ilike('name', '%Plate%');

    console.log('Plates found:', items?.map(i => ({ name: i.name, group: i.group_name, guid: i.guid })));
}

checkPlates();
