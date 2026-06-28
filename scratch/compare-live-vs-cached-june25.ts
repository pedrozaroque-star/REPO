import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getProductMix } from '../lib/toast-pmix';
import { getSupabaseAdminClient } from '../lib/supabase';

async function run() {
    const storeId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'; // Downey external_id
    const date = '2026-06-25';

    console.log(`=== DIAGNOSING DOWNEY PMIX CACHE FOR ${date} ===`);

    // 1. Fetch from Cache
    console.log('\n1. Fetching from local cache (skipCache = false)...');
    const cachedItems = await getProductMix({
        storeId,
        startDate: date,
        endDate: date,
        bundleModifiers: true,
        skipCache: false
    });
    const cachedSales = cachedItems.reduce((sum, item) => sum + item.net_sales, 0);
    const cachedQty = cachedItems.reduce((sum, item) => sum + item.quantity, 0);
    console.log(`   Cached Items Count: ${cachedItems.length}`);
    console.log(`   Cached Total Sales: $${cachedSales.toFixed(2)}`);
    console.log(`   Cached Total Qty  : ${cachedQty}`);

    // 2. Fetch Live from Toast (skipCache = true)
    console.log('\n2. Fetching live from Toast API (skipCache = true)...');
    const liveItems = await getProductMix({
        storeId,
        startDate: date,
        endDate: date,
        bundleModifiers: true,
        skipCache: true
    });
    const liveSales = liveItems.reduce((sum, item) => sum + item.net_sales, 0);
    const liveQty = liveItems.reduce((sum, item) => sum + item.quantity, 0);
    console.log(`   Live Items Count: ${liveItems.length}`);
    console.log(`   Live Total Sales: $${liveSales.toFixed(2)}`);
    console.log(`   Live Total Qty  : ${liveQty}`);

    // 3. Compare top items
    console.log('\n3. Comparing Top 5 items by quantity:');
    const sortFn = (a: any, b: any) => b.quantity - a.quantity;
    const topCached = [...cachedItems].sort(sortFn).slice(0, 5);
    const topLive = [...liveItems].sort(sortFn).slice(0, 5);

    console.log('   --- TOP CACHED ---');
    topCached.forEach(i => console.log(`     Name: "${i.name}" | Qty: ${i.quantity} | Sales: $${i.net_sales.toFixed(2)}`));

    console.log('   --- TOP LIVE ---');
    topLive.forEach(i => console.log(`     Name: "${i.name}" | Qty: ${i.quantity} | Sales: $${i.net_sales.toFixed(2)}`));
}

run().catch(console.error);
