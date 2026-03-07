import { fetchToastData } from '../lib/toast-api';

async function run() {
    const res = await fetchToastData({
        storeIds: 'all',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        groupBy: 'day'
    });

    let total = 0;
    res.rows.forEach((r: any) => {
        if (r.storeName && r.storeName.toLowerCase().includes('broadway')) {
            console.log(`${r.periodStart} - ${r.storeName}: $${r.netSales}`);
            total += (r.netSales || 0);
        }
    });
    console.log(`Total BroadWay in Feb: $${total}`);
}
run();
