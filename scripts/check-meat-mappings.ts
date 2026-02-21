
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkMeats() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await supabase.from('quickbooks_mappings').select('qb_item_name, inv:inventory_item_id(name)');
    const meats = ['asada', 'pollo', 'pastor', 'cabeza', 'lengua', 'chorizo', 'tripas'];

    console.log('--- CRITICAL MEAT MAPPINGS ---');
    data?.forEach(m => {
        // @ts-ignore
        const internalName = m.inv?.name?.toLowerCase();
        if (meats.some(k => internalName?.includes(k))) {
            // @ts-ignore
            console.log(`✅ [${m.inv.name}] <--> QB: ${m.qb_item_name}`);
        }
    });
}
checkMeats();
