/**
 * BACKFILL: Borrar food_cost_daily_cache y recalcular para todas las fechas
 * 
 * Estrategia:
 * 1. Borrar TODO el food_cost_daily_cache 
 * 2. Obtener todas las fechas que tienen datos en pmix_daily_cache 
 * 3. Llamar al API de food-cost para cada fecha (recalcula con precios corregidos)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function backfill() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Check current cache state
    const { count: cacheCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });

    console.log(`═══ BACKFILL FOOD COST CACHE ═══`);
    console.log(`  Current cache entries: ${cacheCount}`);

    // 2. Get all distinct dates in the cache
    const { data: cacheDates } = await supabase
        .from('food_cost_daily_cache')
        .select('business_date')
        .order('business_date', { ascending: true });

    const uniqueDates = [...new Set(cacheDates?.map(d => d.business_date) || [])];
    console.log(`  Unique dates in cache: ${uniqueDates.length}`);
    if (uniqueDates.length > 0) {
        console.log(`  Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`);
    }

    // 3. Also check pmix_daily_cache for all dates with data
    const { data: pmixDates } = await supabase
        .from('pmix_daily_cache')
        .select('business_date')
        .order('business_date', { ascending: true });

    const uniquePmixDates = [...new Set(pmixDates?.map(d => d.business_date) || [])];
    console.log(`  Unique dates with PMIX data: ${uniquePmixDates.length}`);
    if (uniquePmixDates.length > 0) {
        console.log(`  PMIX date range: ${uniquePmixDates[0]} to ${uniquePmixDates[uniquePmixDates.length - 1]}`);
    }

    // 4. DELETE all food_cost_daily_cache entries
    console.log(`\n  🗑️ Deleting ALL ${cacheCount} cache entries...`);
    const { error: delError } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .gte('business_date', '2020-01-01'); // Delete all

    if (delError) {
        console.log(`  ❌ Delete error: ${delError.message}`);
        return;
    }

    // Verify deletion
    const { count: afterCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });
    console.log(`  ✅ Deleted. Remaining: ${afterCount}`);

    // 5. Recalculate for each date by calling the API
    // Use all dates that have PMIX data
    const datesToBackfill = uniquePmixDates.reverse(); // Más reciente primero
    console.log(`\n  📊 Backfilling ${datesToBackfill.length} dates via API...`);
    console.log(`  Using API: ${BASE_URL}/api/inventory/food-cost`);

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process in batches of 2 to avoid overwhelming the API
    for (let i = 0; i < datesToBackfill.length; i++) {
        const date = datesToBackfill[i];
        const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`;
        
        try {
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                const itemCount = json.data?.length || 0;
                success++;
                console.log(`  ✅ [${i + 1}/${datesToBackfill.length}] ${date} → ${itemCount} items calculated`);
            } else {
                const errText = await res.text();
                failed++;
                errors.push(`${date}: ${res.status} ${errText.substring(0, 100)}`);
                console.log(`  ❌ [${i + 1}/${datesToBackfill.length}] ${date} → ${res.status}`);
            }
        } catch (err: any) {
            failed++;
            errors.push(`${date}: ${err.message}`);
            console.log(`  ❌ [${i + 1}/${datesToBackfill.length}] ${date} → ${err.message?.substring(0, 80)}`);
        }

        // Small delay to be gentle on the API
        if (i < datesToBackfill.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // 6. Final verification
    const { count: finalCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });

    console.log(`\n═══ BACKFILL COMPLETE ═══`);
    console.log(`  Dates processed: ${datesToBackfill.length}`);
    console.log(`  Success: ${success}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  New cache entries: ${finalCount}`);
    
    if (errors.length > 0) {
        console.log(`\n  Errors:`);
        errors.forEach(e => console.log(`    ${e}`));
    }
}

backfill();
