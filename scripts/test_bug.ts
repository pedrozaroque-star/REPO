import { generateSmartForecast } from '../lib/intelligence';

async function run() {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'];
    const stores = [
        '80a1ec95-bc73-402e-8884-e5abbe9343e6', // Lynwood
        'b7f63b01-f089-4ad7-a346-afdb1803dc1a', // Downey
        '42ed15a6-106b-466a-9076-1e8f72451f6b', // Norwalk
        'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8'  // Azusa
    ];

    for (const storeId of stores) {
        console.log(`\n== STORE: ${storeId} ==`);
        for (const d of dates) {
            try {
                const f = await generateSmartForecast(storeId, d);
                console.log(`${d}: total_sales = ${f?.total_sales}`);
            } catch (err: any) {
                console.error(`${d}: ERROR - ${err.message}`);
            }
        }
    }
}
run();
