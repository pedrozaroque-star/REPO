import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');

async function run() {
    const { data: stores } = await supabase.from('stores').select('external_id, name');
    
    // target date: 2026-05-19
    const targetDate = new Date('2026-05-19T12:00:00');
    
    const compDays = [];
    for (let i = 1; i <= 3; i++) {
        const d = new Date(targetDate);
        d.setDate(d.getDate() - (i * 364));
        compDays.push(d.toISOString().split('T')[0]);
    }

    let totalWeightedHist = 0;
    let totalLY28 = 0;
    let totalRecent28 = 0;

    for (const store of stores || []) {
        const { data: hist } = await supabase.from('sales_daily_cache').select('business_date, net_sales').eq('store_id', store.external_id).in('business_date', compDays);
        
        let weightedSales = 0;
        let totalWeight = 0;
        
        hist?.forEach(pt => {
            const diffYears = targetDate.getFullYear() - new Date(pt.business_date).getFullYear();
            let weight = 1;
            if (diffYears === 1) weight = 3;
            if (diffYears === 2) weight = 2;
            
            weightedSales += Number(pt.net_sales) * weight;
            totalWeight += weight;
        });
        
        if (totalWeight > 0) {
            totalWeightedHist += (weightedSales / totalWeight);
        }

        // Recent dates for trend (last 28 days)
        const dRecentEnd = new Date(targetDate);
        dRecentEnd.setDate(dRecentEnd.getDate() - targetDate.getDay()); // prior Sunday
        const dRecentStart = new Date(dRecentEnd);
        dRecentStart.setDate(dRecentStart.getDate() - 28);
        
        const { data: rec28 } = await supabase.from('sales_daily_cache').select('net_sales').eq('store_id', store.external_id).gte('business_date', dRecentStart.toISOString().split('T')[0]).lte('business_date', dRecentEnd.toISOString().split('T')[0]);
        totalRecent28 += rec28?.reduce((sum, row) => sum + Number(row.net_sales), 0) || 0;

        // Last year 28 days
        const dLastYearEnd = new Date(dRecentEnd);
        dLastYearEnd.setDate(dLastYearEnd.getDate() - 364);
        const dLastYearStart = new Date(dLastYearEnd);
        dLastYearStart.setDate(dLastYearStart.getDate() - 28);
        
        const { data: ly28 } = await supabase.from('sales_daily_cache').select('net_sales').eq('store_id', store.external_id).gte('business_date', dLastYearStart.toISOString().split('T')[0]).lte('business_date', dLastYearEnd.toISOString().split('T')[0]);
        totalLY28 += ly28?.reduce((sum, row) => sum + Number(row.net_sales), 0) || 0;
    }
    
    console.log("Total Weighted History across all stores (Base):", totalWeightedHist);
    console.log("Global Growth:", totalRecent28 / totalLY28);
    console.log("Rough Projected Total:", totalWeightedHist * (totalRecent28 / totalLY28));
}
run();
