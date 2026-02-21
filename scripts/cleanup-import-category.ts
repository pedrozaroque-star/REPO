
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function cleanupAndRetry() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const CAT_ID = '5678dc7e-4514-4757-a5d0-9330e904140e';

    console.log('Cleaning up QuickBooks Import category...');

    // Get items in that category
    const { data: items } = await supabase.from('inventory_items').select('id').eq('category_id', CAT_ID);
    const itemIds = items?.map(i => i.id) || [];

    if (itemIds.length > 0) {
        // Delete mappings first
        await supabase.from('quickbooks_mappings').delete().in('inventory_item_id', itemIds);
        // Delete items
        await supabase.from('inventory_items').delete().in('id', itemIds);
    }

    console.log(`Deleted ${itemIds.length} items. Now you can run the 1-to-1 import script.`);
}
cleanupAndRetry();
