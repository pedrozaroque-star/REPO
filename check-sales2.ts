import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    const { data: sales, error } = await supabase.from('sales_daily_cache')
        .select('store_id, business_date, net_sales')
        .gte('business_date', '2026-02-23')
        .lte('business_date', '2026-02-25');
    console.log('Sales Cache for Feb 23-25:', sales);
}
check();
