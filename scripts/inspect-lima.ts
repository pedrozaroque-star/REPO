
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspectLimaItem() {
    const { data: item } = await supabase.from('inventory_items').select('*').eq('id', 'f73fe7a6-105c-4624-a87b-07d5f78c09ea').single();
    console.log('--- LIMA BOLSITA DATA ---');
    console.log(JSON.stringify(item, null, 2));
}

inspectLimaItem();
