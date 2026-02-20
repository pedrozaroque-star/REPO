
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspectPastor() {
    const { data: item } = await supabase.from('inventory_items').select('*').ilike('name', 'Pastor').single();
    console.log('--- PASTOR DATA FROM DATABASE ---');
    console.log(JSON.stringify(item, null, 2));
}

inspectPastor();
