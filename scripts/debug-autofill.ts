
import { fetchToastData } from '../lib/toast-api';

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'; // Lynwood
// Use a date we know implies data, yesterday or same as debug
const DATE = '2025-01-20';

async function main() {
    console.log(`Running Autofill Logic Simulation for ${DATE}...`);
    try {
        const { rows } = await fetchToastData({
            storeIds: STORE_ID,
            startDate: DATE,
            endDate: DATE,
            groupBy: 'day',
            skipCache: true
        });

        if (rows.length === 0) {
            console.log('No rows found');
            return;
        }

        const row = rows[0];
        console.log(`Fetch Result - Net: ${row.netSales}, HourlyKeys: ${Object.keys(row.hourlySales || {}).length}`);

        // THE LOGIC FROM route.ts
        const open_sales = (() => {
            const order = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
            for (const h of order) {
                const val = row.hourlySales?.[h] || 0
                if (val > 0) {
                    console.log(`[OPEN] Found value ${val} at hour ${h}`);
                    return val.toFixed(2)
                }
            }
            return '0.00'
        })();

        const close_sales = (() => {
            const order = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
            // Search backwards
            for (let i = order.length - 1; i >= 0; i--) {
                const h = order[i]
                const val = row.hourlySales?.[h] || 0
                if (val > 0) {
                    console.log(`[CLOSE] Found value ${val} at hour ${h}`);
                    return val.toFixed(2)
                }
            }
            return '0.00'
        })();

        console.log('--- FINAL RESULT ---');
        console.log(`OPEN: ${open_sales}`);
        console.log(`CLOSE: ${close_sales}`);

    } catch (e) {
        console.error(e);
    }
}

main();
