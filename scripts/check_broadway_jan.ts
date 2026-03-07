import { getSupabaseAdminClient } from '../lib/supabase';
import { fetchToastData } from '../lib/toast-api';

async function run() {
    const supabase = await getSupabaseAdminClient();

    // Get Broadway ID
    const { data: stores } = await supabase.from('stores').select('id, name');
    const broadway = stores?.find(s => s.name.toLowerCase().includes('broadway'));

    if (!broadway) {
        console.log('Broadway store not found in DB');
        return;
    }

    console.log(`Broadway ID: ${broadway.id}`);

    const { data: sales } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', broadway.id)
        .gte('business_date', '2026-01-01')
        .lte('business_date', '2026-01-31')
        .order('business_date', { ascending: true });

    console.log(`Encontrados ${sales?.length} días de venta en Enero para Broadway:`);
    let total = 0;
    sales?.forEach(s => {
        console.log(`${s.business_date}: $${s.net_sales}`);
        total += s.net_sales;
    });
    console.log(`Total: $${total}`);

    // Check with Toast
    const toastRes = await fetchToastData({
        storeIds: broadway.id,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        groupBy: 'day'
    });

    console.log(`\nToast API reporta ${toastRes.rows.length} días:`);
    let toastTotal = 0;
    toastRes.rows.forEach((r: any) => {
        console.log(`${r.periodStart}: $${r.netSales}`);
        toastTotal += r.netSales;
    });
    console.log(`Total Toast: $${toastTotal}`);

}
run();
