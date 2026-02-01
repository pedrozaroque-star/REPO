
import { fetchToastData } from '../lib/toast-api';

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood
const DATE = '2025-01-20'; // A generic past date

async function main() {
    console.log(`Fetching data for ${STORE_ID} on ${DATE}...`);
    try {
        const result = await fetchToastData({
            storeIds: STORE_ID,
            startDate: DATE,
            endDate: DATE,
            groupBy: 'day',
            skipCache: true
        });

        if (result.rows.length === 0) {
            console.log('No rows returned.');
            return;
        }

        const row = result.rows[0];
        console.log('Row Data:', JSON.stringify(row, null, 2));

        console.log('Hourly Sales keys:', Object.keys(row.hourlySales || {}));
        console.log('Hour 6:', row.hourlySales?.[6]);
        console.log('Hour 5:', row.hourlySales?.[5]);

    } catch (e) {
        console.error(e);
    }
}

main();
