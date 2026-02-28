import dotenv from 'dotenv';
import { syncToastPunches } from './lib/toast-labor';

dotenv.config({ path: '.env.local' });

async function run() {
    // We can just fetch a few punches directly using raw fetch to see if timeEntryBreaks exists
    const tokenRes = await fetch(`${process.env.TOAST_API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: process.env.TOAST_CLIENT_ID,
            clientSecret: process.env.TOAST_CLIENT_SECRET,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    });

    const tokenData = await tokenRes.json();
    const token = tokenData.token.accessToken;

    // Choose an arbitrary store ID (e.g. Lynwood: 80a1ec95-bc73-402e-8884-e5abbe9343e6)
    const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6';
    const startDate = '2026-02-27T00:00:00.000+0000';
    const endDate = '2026-02-27T23:59:59.999+0000';

    const url = `${process.env.TOAST_API_HOST}/labor/v1/timeEntries?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&page=1&pageSize=10`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    });

    const data = await res.json();
    console.log("Sample Time Entry:");
    if (data.length > 0) {
        console.log(JSON.stringify(data.find((e: any) => e.timeEntryBreaks && e.timeEntryBreaks.length > 0) || data[0], null, 2));
    } else {
        console.log("No data returned");
    }
}

run();
