
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkStoredAsada() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: qbAsada } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .ilike('qb_item_name', '%Asada%');

    console.log('--- ASADA EN SUPABASE (CACHED) ---');
    console.log(JSON.stringify(qbAsada, null, 2));

    const { data: price61 } = await supabase
        .from('quickbooks_mappings')
        .select('*')
        .eq('last_fetch_cost', 61.2);

    if (price61?.length) {
        console.log('\n--- OTROS CON COSTO $61.20 ---');
        console.log(JSON.stringify(price61, null, 2));
    } else {
        console.log('\nNo hay ningún producto guardado con costo $61.20');
    }
}

checkStoredAsada();
