
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function findExtraCarne() {
    const { data: items } = await supabase
        .from('toast_menu_items')
        .select('name, guid')
        .ilike('name', '%Extra Carne%');
    console.log('Results:', items);
}

findExtraCarne();
