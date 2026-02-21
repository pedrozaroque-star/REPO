
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function listInventoryItems() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: items, error } = await supabase
        .from('inventory_items')
        .select('*');

    if (error) {
        console.error('Error fetching inventory items:', error.message);
        return;
    }

    console.log(`Found ${items.length} inventory items:`);
    items.forEach(item => {
        console.log(`- [${item.id}] ${item.name} (${item.unit_type}) SKU: ${item.sku || 'N/A'}`);
    });
}

listInventoryItems();
