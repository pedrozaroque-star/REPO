import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl) {
    console.log("No supabase URL found in env.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: stores } = await supabase.from('stores').select('external_id, name').limit(1);
    if (!stores || stores.length === 0) {
        console.log("No stores found.");
        return;
    }
    const store = stores[0];
    console.log(`Analyzing store: ${store.name} (${store.external_id})`);

    // target date: 2026-05-19
    const targetDate = new Date('2026-05-19T12:00:00');
    
    // Base comp dates (1, 2, 3 years ago)
    const compDays = [];
    for (let i = 1; i <= 3; i++) {
        const d = new Date(targetDate);
        d.setDate(d.getDate() - (i * 364));
        compDays.push(d.toISOString().split('T')[0]);
    }
    console.log("Comp Days:", compDays);

    const { data: hist } = await supabase.from('sales_daily_cache').select('business_date, net_sales').eq('store_id', store.external_id).in('business_date', compDays);
    console.log("Historical Sales:", hist);

    // Recent dates for trend (last 28 days)
    const dRecentEnd = new Date(targetDate);
    dRecentEnd.setDate(dRecentEnd.getDate() - targetDate.getDay()); // prior Sunday
    const dRecentStart = new Date(dRecentEnd);
    dRecentStart.setDate(dRecentStart.getDate() - 28);
    
    const dRecStartStr = dRecentStart.toISOString().split('T')[0];
    const dRecEndStr = dRecentEnd.toISOString().split('T')[0];
    console.log("Recent Trend 28-day window:", dRecStartStr, "to", dRecEndStr);
    
    const { data: rec28 } = await supabase.from('sales_daily_cache').select('net_sales').eq('store_id', store.external_id).gte('business_date', dRecStartStr).lte('business_date', dRecEndStr);
    const sumRec28 = rec28?.reduce((sum, row) => sum + Number(row.net_sales), 0) || 0;

    // Last year 28 days
    const dLastYearEnd = new Date(dRecentEnd);
    dLastYearEnd.setDate(dLastYearEnd.getDate() - 364);
    const dLastYearStart = new Date(dLastYearEnd);
    dLastYearStart.setDate(dLastYearStart.getDate() - 28);
    
    const dLYStartStr = dLastYearStart.toISOString().split('T')[0];
    const dLYEndStr = dLastYearEnd.toISOString().split('T')[0];
    console.log("Last Year 28-day window:", dLYStartStr, "to", dLYEndStr);

    const { data: ly28 } = await supabase.from('sales_daily_cache').select('net_sales').eq('store_id', store.external_id).gte('business_date', dLYStartStr).lte('business_date', dLYEndStr);
    const sumLy28 = ly28?.reduce((sum, row) => sum + Number(row.net_sales), 0) || 0;

    console.log("Sum Recent 28:", sumRec28);
    console.log("Sum Last Year 28:", sumLy28);
    if (sumLy28 > 0) {
        console.log("Global Growth Factor:", sumRec28 / sumLy28);
    }
}
run();
