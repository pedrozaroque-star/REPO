/**
 * @module backfill-recent-food-cost
 * @description Backfill suplementario para fechas recientes (Feb-Jun 2026) que no se
 * cubrieron en el backfill principal por el límite de 1000 filas de Supabase.
 * 
 * Supplemental backfill for recent dates (Feb-Jun 2026) missed by the main backfill
 * due to Supabase's default 1000-row limit on PMIX cache query.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function backfillRecent() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('═══ BACKFILL FOOD COST - FECHAS RECIENTES ═══');
    console.log(`  API: ${BASE_URL}/api/inventory/food-cost`);

    // Get PMIX dates for 2026 only (recent data), ordered DESC
    const { data: recentPmix } = await supabase
        .from('pmix_daily_cache')
        .select('business_date')
        .gte('business_date', '2026-01-10')  // After the last backfilled date
        .order('business_date', { ascending: false })
        .limit(1000);

    if (!recentPmix?.length) {
        console.log('  No recent PMIX dates found after 2026-01-09');
        return;
    }

    const uniqueDates = [...new Set(recentPmix.map(d => d.business_date))].sort().reverse();
    console.log(`  Found ${uniqueDates.length} dates to backfill (${uniqueDates[uniqueDates.length-1]} → ${uniqueDates[0]})`);

    // Check which dates already have cache
    const { data: existingCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date')
        .gte('business_date', '2026-01-10');
    
    const existingDates = new Set(existingCache?.map(d => d.business_date) || []);
    const datesToBackfill = uniqueDates.filter(d => !existingDates.has(d));
    console.log(`  Dates already cached: ${existingDates.size}`);
    console.log(`  Dates to backfill: ${datesToBackfill.length}`);

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < datesToBackfill.length; i++) {
        const date = datesToBackfill[i];
        const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`;

        try {
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                const itemCount = json.data?.length || 0;
                success++;
                console.log(`  ✅ [${i + 1}/${datesToBackfill.length}] ${date} → ${itemCount} items`);
            } else {
                const errText = await res.text();
                failed++;
                errors.push(`${date}: ${res.status}`);
                console.log(`  ❌ [${i + 1}/${datesToBackfill.length}] ${date} → ${res.status}`);
            }
        } catch (err: any) {
            failed++;
            errors.push(`${date}: ${err.message}`);
            console.log(`  ❌ [${i + 1}/${datesToBackfill.length}] ${date} → ${err.message?.substring(0, 80)}`);
        }

        // Delay between requests
        if (i < datesToBackfill.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Verification
    console.log('\n═══ VERIFICACIÓN POST-BACKFILL ═══');
    
    const { data: verifyCache } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date, total_cost, net_sales, cost_percentage')
        .gte('business_date', '2026-01-10')
        .order('business_date', { ascending: false })
        .limit(500);

    if (verifyCache?.length) {
        const grouped: Record<string, { stores: number; cost: number; sales: number }> = {};
        for (const row of verifyCache) {
            const d = row.business_date;
            if (!grouped[d]) grouped[d] = { stores: 0, cost: 0, sales: 0 };
            grouped[d].stores++;
            grouped[d].cost += Number(row.total_cost) || 0;
            grouped[d].sales += Number(row.net_sales) || 0;
        }

        const sortedDates = Object.keys(grouped).sort().reverse();
        console.log(`\n  Últimas 20 fechas con food cost:`);
        sortedDates.slice(0, 20).forEach(d => {
            const g = grouped[d];
            const fcPct = g.sales > 0 ? (g.cost / g.sales * 100).toFixed(2) : 'N/A';
            const marker = Number(fcPct) >= 30 && Number(fcPct) <= 38 ? '✅' : '⚠️';
            console.log(`  ${marker} ${d}: FC=${fcPct}% | Cost=$${g.cost.toFixed(0)} | Sales=$${g.sales.toFixed(0)} | ${g.stores} stores`);
        });
    }

    console.log(`\n═══ BACKFILL RECIENTE COMPLETADO ═══`);
    console.log(`  Success: ${success} | Failed: ${failed}`);
    if (errors.length > 0) {
        console.log('  Errors:', errors.join(', '));
    }
}

backfillRecent().catch(console.error);
