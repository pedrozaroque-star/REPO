
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function countItems() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { count } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
    console.log(`TOTAL_INVENTORY_ITEMS: ${count}`);
}
countItems();
