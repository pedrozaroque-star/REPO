
import { fetchToastData } from '../lib/toast-api';

async function testFastMode() {
    console.log('--- TESTING FAST MODE (BUSINESS AWARE) ---');

    // Simulate API Route Logic
    const now = new Date();
    const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

    // Check if < 4AM
    const hour = laTime.getHours();
    console.log(`Current LA Hour: ${hour}`);

    if (hour < 4) {
        console.log('Early Morning detected. Shifting Business Day to Yesterday.');
        laTime.setDate(laTime.getDate() - 1);
    }

    const yyyy = laTime.getFullYear();
    const mm = String(laTime.getMonth() + 1).padStart(2, '0');
    const dd = String(laTime.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    console.log(`Target Business Date: ${todayStr}`);

    try {
        console.time('Fetch-ALL');
        const result = await fetchToastData({
            storeIds: 'all',
            startDate: todayStr, // Using CORRECT Business Date
            endDate: todayStr,
            groupBy: 'day',
            fastMode: true,
            skipCache: true
        });
        console.timeEnd('Fetch-ALL');

        let totalNet = 0;
        result.rows.forEach((row: any) => {
            if (row.netSales > 0) {
                console.log(`✅ Store: ${row.storeName} -> $${row.netSales} (${row.orderCount} orders)`);
                totalNet += row.netSales;
            }
        });

        if (totalNet === 0) {
            console.warn('⚠️ WARNING: Still Zero Sales across all stores.');
        } else {
            console.log(`🎉 SUCCESS! Total Network Sales: $${totalNet}`);
        }

    } catch (e) {
        console.error(`> Error testing ALL:`, e);
    }
}

testFastMode();
