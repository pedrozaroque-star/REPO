
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, anonKey);

async function listPkg() {
    const { data: pkgItems } = await supabase
        .from('inventory_items')
        .select('id, name')
        .or('name.ilike.%box%,name.ilike.%container%,name.ilike.%bag%,name.ilike.%dome%');

    console.log('Packaging Items found:', pkgItems);
}

listPkg();
