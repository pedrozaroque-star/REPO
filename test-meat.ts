import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
import { GET } from './app/api/inventory/food-cost/route';

const params = new URLSearchParams({ storeId: 'all', period: 'today' });
const req = {
    nextUrl: {
        searchParams: {
            get: (key: string) => params.get(key)
        }
    }
};

GET(req as any).then(async (res: any) => {
    const text = await res.text();
    if (text.startsWith('{"error"')) {
        console.log('Error:', text);
        return;
    }
    try {
        const json = JSON.parse(text);
        if (!json.data) { console.log("No data"); return; }

        console.log('Got', json.data.length, 'items');
        let totalMeat = 0;
        json.data.forEach((item: any) => totalMeat += item.total_meat_lbs || 0);
        console.log('--- NEW TOTAL MEAT LBS:', totalMeat, '---');

        const withMeat = json.data.filter((i: any) => i.total_meat_lbs > 0).sort((a: any, b: any) => b.total_meat_lbs - a.total_meat_lbs).slice(0, 50);
        withMeat.forEach((i: any) => console.log(i.name.padEnd(40, ' '), '| Meat:', i.total_meat_lbs.toFixed(2).padStart(8, ' '), 'lbs | Qty:', i.quantity));
    } catch (e) {
        console.log(e);
    }
});
