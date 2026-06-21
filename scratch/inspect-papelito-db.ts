import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function inspectDb() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: item } = await supabase
        .from('inventory_items')
        .select('*')
        .ilike('name', '%papelito%')
        .single();
    
    console.log('=== INVENTORY ITEM ===');
    console.log(item);

    if (item) {
        const { data: mappings } = await supabase
            .from('quickbooks_mappings')
            .select('*')
            .eq('inventory_item_id', item.id);
        
        console.log('\n=== QUICKBOOKS MAPPINGS ===');
        console.log(mappings);

        const { data: history } = await supabase
            .from('inventory_price_history')
            .select('*')
            .eq('inventory_item_id', item.id)
            .order('effective_date', { ascending: false })
            .limit(10);
        
        console.log('\n=== PRICE HISTORY (last 10) ===');
        console.log(history);
    }
}

inspectDb();
