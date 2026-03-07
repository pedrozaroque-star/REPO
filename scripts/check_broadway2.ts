import { fetchToastData } from '../lib/toast-api';
import { getSupabaseAdminClient } from '../lib/supabase';

async function run() {
    const res = await fetchToastData({
        storeIds: 'all',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        groupBy: 'day'
    });

    let total = 0;
    let days = 0;
    res.rows.forEach((r: any) => {
        if (r.storeName && r.storeName.toLowerCase().includes('broadway')) {
            console.log(`${r.periodStart} - ${r.storeName}: $${r.netSales}`);
            total += (r.netSales || 0);
            days++;
        }
    });
    console.log(`Total BroadWay in Jan: $${total} across ${days} days`);
}
run();
