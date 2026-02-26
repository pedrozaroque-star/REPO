import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    const { data: stores } = await supabase.from('stores').select('id, name, external_id');
    const store = stores?.find(s => s.name.toLowerCase().includes('lynwood') || s.external_id === '14');
    if (store) {
        console.log('Store:', store.name, store.id);
        const { data: sales, error } = await supabase.from('sales_daily_cache')
            .select('business_date, net_sales')
            .eq('store_id', store.id)
            .gte('business_date', '2026-02-23')
            .lte('business_date', '2026-02-25');
        console.log('Sales Cache for Feb 23-25:', sales);
        if (error) console.error(error);
    } else {
        console.log('Store not found.');
    }
}
check();
