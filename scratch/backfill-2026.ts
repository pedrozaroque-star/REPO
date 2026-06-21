/**
 * @module backfill-2026-food-cost
 * @description Rebuild food cost cache SOLO para 2026.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function backfill2026() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('🔧 REBUILD FOOD COST CACHE - SOLO 2026');
    console.log('='.repeat(80));

    // Get all 2026 PMIX dates (paginated)
    const allDates = new Set<string>();
    let from = 0;
    while (true) {
        const { data } = await supabase
            .from('pmix_daily_cache')
            .select('business_date')
            .gte('business_date', '2026-01-01')
            .lte('business_date', '2026-12-31')
            .order('business_date', { ascending: false })
            .range(from, from + 999);
        if (!data || data.length === 0) break;
        data.forEach(d => allDates.add(d.business_date));
        if (data.length < 1000) break;
        from += 1000;
    }

    const dates = [...allDates].sort().reverse(); // Más reciente primero
    console.log(`  Fechas 2026 con PMIX: ${dates.length}`);
    console.log(`  Rango: ${dates[dates.length-1]} → ${dates[0]}`);

    // Borrar cache 2026
    console.log('\n🗑️  Borrando cache 2026...');
    await supabase.from('food_cost_daily_cache').delete().gte('business_date', '2026-01-01').lte('business_date', '2026-12-31');
    console.log('  ✅ Cache 2026 borrado');

    // Backfill
    console.log(`\n📊 Backfilling ${dates.length} fechas (reciente → viejo)...`);
    let ok = 0, fail = 0;

    for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        try {
            const res = await fetch(`${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${d}&endDate=${d}`);
            if (res.ok) {
                const json = await res.json();
                ok++;
                console.log(`  ✅ [${i+1}/${dates.length}] ${d} → ${json.data?.length || 0} items`);
            } else {
                fail++;
                console.log(`  ❌ [${i+1}/${dates.length}] ${d} → HTTP ${res.status}`);
            }
        } catch (e: any) {
            fail++;
            console.log(`  ❌ [${i+1}/${dates.length}] ${d} → ${e.message?.substring(0,60)}`);
        }
        if (i < dates.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    // Verificación por mes
    console.log('\n' + '='.repeat(80));
    console.log('📊 VERIFICACIÓN POR MES - 2026');
    console.log('='.repeat(80));

    const allCache: any[] = [];
    let cf = 0;
    while (true) {
        const { data } = await supabase
            .from('food_cost_daily_cache')
            .select('business_date, total_cost, net_sales, cost_percentage')
            .gte('business_date', '2026-01-01')
            .order('business_date', { ascending: false })
            .range(cf, cf + 999);
        if (!data || data.length === 0) break;
        allCache.push(...data);
        if (data.length < 1000) break;
        cf += 1000;
    }

    const byMonth: Record<string, { days: Set<string>; cost: number; sales: number }> = {};
    for (const row of allCache) {
        const m = row.business_date.substring(0, 7);
        if (!byMonth[m]) byMonth[m] = { days: new Set(), cost: 0, sales: 0 };
        byMonth[m].days.add(row.business_date);
        byMonth[m].cost += Number(row.total_cost) || 0;
        byMonth[m].sales += Number(row.net_sales) || 0;
    }

    console.log('\n  Mes        | Días | FC %    | Costo Total     | Ventas Total');
    console.log('  ' + '-'.repeat(70));
    for (const m of Object.keys(byMonth).sort()) {
        const d = byMonth[m];
        const fc = d.sales > 0 ? (d.cost / d.sales * 100).toFixed(2) : 'N/A';
        const mark = Number(fc) >= 30 && Number(fc) <= 38 ? '✅' : '⚠️';
        console.log(`  ${mark} ${m}  | ${String(d.days.size).padStart(4)} | ${String(fc).padStart(6)}% | $${d.cost.toFixed(0).padStart(14)} | $${d.sales.toFixed(0).padStart(14)}`);
    }

    console.log(`\n🎉 Completado: ${ok} éxitos, ${fail} fallos`);
}

backfill2026().catch(console.error);
