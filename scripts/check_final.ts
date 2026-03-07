import { getSupabaseAdminClient } from '../lib/supabase';
async function run() {
    const supabase = await getSupabaseAdminClient();
    const { data } = await supabase.from('sales_daily_cache').select('store_id, business_date, net_sales').gte('business_date', '2026-01-01').lte('business_date', '2026-01-02');
    console.log('Sample data keys:', data?.slice(0, 5).map(d => d.store_id));

    const { data: bwayData } = await supabase.from('sales_daily_cache').select('store_id, net_sales').in('store_id', ['5', '475bc112-187d-4b9c-884d-1f6a041698ce']).gte('business_date', '2026-01-01').lte('business_date', '2026-01-31');
    let total = 0;
    bwayData?.forEach(d => total += d.net_sales);
    console.log(`Found ${bwayData?.length} broadway records. Total: $${total}`);
} run();
