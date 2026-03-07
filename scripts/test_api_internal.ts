import { fetchToastData } from '../lib/toast-api';

async function run() {
    // We must simulate what route.ts does!!
    const options = {
        storeIds: 'all',
        startDate: '2026-03-02',
        endDate: '2026-03-06',
        groupBy: 'day'
    };

    console.log('Fetching base data...');
    const { rows } = await fetchToastData(options as any);

    // Simulate what route.ts does exactly
    const { generateSmartForecast } = await import('../lib/intelligence')
    const uniqueStoreIds = new Set<string>();
    rows.forEach((row: any) => uniqueStoreIds.add(row.storeId));
    const uniqueDates = new Set<string>();
    rows.forEach((row: any) => {
        if (row.periodStart) uniqueDates.add(row.periodStart);
    });

    console.log('Generating projections for', uniqueStoreIds.size, 'stores and', uniqueDates.size, 'dates...');
    const projectionCache = new Map<string, { total: number, hourly: Record<number, number> }>();

    const storePromises = Array.from(uniqueStoreIds).map(async (storeId) => {
        for (const dateStr of uniqueDates) {
            try {
                const forecast = await generateSmartForecast(storeId, dateStr);
                if (forecast && forecast.total_sales > 0) {
                    const hourlyMap: Record<number, number> = {};
                    forecast.hours.forEach(h => hourlyMap[h.hour] = h.projected_sales);
                    projectionCache.set(`${storeId}|${dateStr}`, {
                        total: forecast.total_sales,
                        hourly: hourlyMap
                    });
                }
            } catch (err) {
                console.error('Failed', storeId, err);
            }
        }
    });

    await Promise.all(storePromises);

    rows.forEach((row: any) => {
        const key = `${row.storeId}|${row.periodStart}`;
        const projData = projectionCache.get(key);
        if (projData) {
            row.projectedSales = projData.total;
            row.projectedHourly = projData.hourly;
        }
    });

    let withProj = 0;
    const storeCount = new Map<string, number>();
    rows.forEach((row: any) => {
        if (row.projectedSales && row.projectedSales > 0) {
            withProj++;
            storeCount.set(row.storeName, (storeCount.get(row.storeName) || 0) + 1);
        }
    });
    console.log('Rows with projection:', withProj, '/', rows.length);
    console.log('Stores with projection data:', Array.from(storeCount.keys()));
}
run();
