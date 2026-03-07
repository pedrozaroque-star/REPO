import { getSupabaseAdminClient } from '../lib/supabase';
async function run() {
    const supabase = await getSupabaseAdminClient();
    const { data } = await supabase.from('sales_daily_cache')
        .select('business_date, labor_cost, labor_hours')
        .eq('store_id', '475bc112-187d-4b9c-884d-1f6a041698ce') // Broadway
        .gte('business_date', '2026-01-01')
        .lte('business_date', '2026-01-31');

    let totalLaborCost = 0;
    let totalLaborHours = 0;
    data?.forEach(d => {
        totalLaborCost += Number(d.labor_cost || 0);
        totalLaborHours += Number(d.labor_hours || 0);
    });

    console.log(`Broadway Jan 2026: Labor Cost $${totalLaborCost.toFixed(2)}, Hours ${totalLaborHours.toFixed(2)}`);
} run();
