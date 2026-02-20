
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkYields() {
    const { data: items } = await supabase.from('inventory_items').select('name, yield_percent').ilike('name', '%Asada%');
    console.log('--- YIELDS FOR ASADA ITEMS ---');
    console.table(items);
}

checkYields();
