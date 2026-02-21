
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findDuplicateAsadas() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await supabase.from('inventory_items').select('*').ilike('name', '%asada%');
    console.log('Asadas found:', JSON.stringify(data, null, 2));
}
findDuplicateAsadas();
