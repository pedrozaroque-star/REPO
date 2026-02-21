
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function showMappedIngredients() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mappings, error } = await supabase
        .from('quickbooks_mappings')
        .select(`
            id,
            qb_item_name,
            last_fetch_cost,
            inv:inventory_item_id (
                name,
                unit_type
            )
        `)
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log('--- MAPPED INGREDIENTS EXAMPLES ---');
    mappings.slice(0, 15).forEach(m => {
        // @ts-ignore
        console.log(`- Internal: ${m.inv?.name || 'Unknown'} (${m.inv?.unit_type}) <--> QB: ${m.qb_item_name} | Cost: $${m.last_fetch_cost}`);
    });
}

showMappedIngredients();
