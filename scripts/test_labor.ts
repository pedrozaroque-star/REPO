import { getSupabaseAdminClient } from '../lib/supabase';

async function run() {
    const supabase = await getSupabaseAdminClient();
    const { data } = await supabase.from('sales_daily_cache').select('business_date, hourly_labor, hourly_data').eq('store_id', '475bc112-187d-4b9c-884d-1f6a041698ce').gte('business_date', '2026-03-01').lte('business_date', '2026-03-05');
    console.log(JSON.stringify(data, null, 2));
} run();
