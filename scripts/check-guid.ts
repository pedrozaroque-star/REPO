
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function checkGuid() {
    const prefix = 'e5bb7d3e';
    console.log(`Searching for GUIDs starting with ${prefix}...`);
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('*')
        .ilike('guid', `${prefix}%`);

    console.log('Results:', items);
}

checkGuid();
