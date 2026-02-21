
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function reportUnsynced() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Get all internal items
    const { data: internal } = await supabase.from('inventory_items').select('id, name, sku');

    // 2. Get all mappings
    const { data: mappings } = await supabase.from('quickbooks_mappings').select('inventory_item_id');
    const mappedIds = new Set(mappings?.map(m => m.inventory_item_id));

    const unsynced = internal?.filter(i => !mappedIds.has(i.id)) || [];

    console.log(`TOTAL ITEMS: ${internal?.length}`);
    console.log(`SYNCED ITEMS: ${mappedIds.size}`);
    console.log(`UNSYNCED ITEMS: ${unsynced.length}`);

    console.log('\n--- TOP 20 ITEMS SIN SINCRONIZAR (Revisar nombres) ---');
    unsynced.slice(0, 20).forEach(i => {
        console.log(`- ${i.name} (SKU: ${i.sku || 'N/A'})`);
    });
}
reportUnsynced();
