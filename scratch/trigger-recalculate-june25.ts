import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
    const date = '2026-06-25';
    const url = `http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`;
    console.log(`Triggering food cost recalculation for ${date} via: ${url}`);
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            console.log(`✅ Success! Recalculated food cost. Items in report: ${json.data?.length}`);
        } else {
            const txt = await res.text();
            console.error(`❌ API Error ${res.status}: ${txt}`);
        }
    } catch (e: any) {
        console.error('❌ Connection Error:', e.message);
    }
}
run();
