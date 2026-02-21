
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkMappings() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: mappings } = await supabase.from('quickbooks_mappings').select('inventory_item_id');
    const uniqueItems = new Set(mappings?.map(m => m.inventory_item_id));
    console.log(`TOTAL_MAPPINGS: ${mappings?.length}`);
    console.log(`UNIQUE_INTERNAL_ITEMS_MAPPED: ${uniqueItems.size}`);
}
checkMappings();
