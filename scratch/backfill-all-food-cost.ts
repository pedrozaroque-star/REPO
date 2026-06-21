/**
 * @module backfill-all-food-cost
 * @description Reparación TOTAL del food cost cache.
 * Borra TODO el food_cost_daily_cache y reconstruye desde cero
 * para TODAS las fechas que tienen datos PMIX.
 * 
 * Maneja el límite de 1000 filas de Supabase paginando la consulta.
 * 
 * Complete food cost cache rebuild. Deletes everything and recalculates
 * for ALL dates with PMIX data, handling Supabase's 1000-row pagination limit.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function backfillAll() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('🔧 REPARACIÓN TOTAL DE FOOD COST CACHE');
    console.log('='.repeat(80));
    console.log(`  Fecha: ${new Date().toISOString()}`);
    console.log(`  API: ${BASE_URL}/api/inventory/food-cost`);

    // ═══ PASO 1: Obtener TODAS las fechas PMIX (paginando) ═══
    console.log('\n📊 PASO 1: Obteniendo todas las fechas con datos PMIX...');
    
    const allPmixDates = new Set<string>();
    let from = 0;
    const pageSize = 1000;
    
    while (true) {
        const { data, error } = await supabase
            .from('pmix_daily_cache')
            .select('business_date')
            .order('business_date', { ascending: true })
            .range(from, from + pageSize - 1);
        
        if (error) {
            console.error('  ❌ Error al obtener PMIX dates:', error.message);
            return;
        }
        
        if (!data || data.length === 0) break;
        
        data.forEach(d => allPmixDates.add(d.business_date));
        console.log(`    Página ${Math.floor(from / pageSize) + 1}: ${data.length} filas (${allPmixDates.size} fechas únicas acumuladas)`);
        
        if (data.length < pageSize) break; // Last page
        from += pageSize;
    }

    const sortedDates = [...allPmixDates].sort();
    console.log(`  Total fechas únicas con PMIX: ${sortedDates.length}`);
    if (sortedDates.length > 0) {
        console.log(`  Rango: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);
    }

    // ═══ PASO 2: Borrar TODO el food_cost_daily_cache ═══
    console.log('\n🗑️  PASO 2: Borrando TODO el food_cost_daily_cache...');
    
    const { count: beforeCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });
    
    console.log(`  Entradas actuales: ${beforeCount}`);
    
    const { error: delError } = await supabase
        .from('food_cost_daily_cache')
        .delete()
        .gte('business_date', '2020-01-01');
    
    if (delError) {
        console.error('  ❌ Error al borrar:', delError.message);
        return;
    }
    
    const { count: afterCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });
    
    console.log(`  ✅ Borrado. Entradas restantes: ${afterCount}`);

    // ═══ PASO 3: Backfill de todas las fechas ═══
    // Process from most recent to oldest
    const datesToProcess = [...sortedDates].reverse();
    console.log(`\n📊 PASO 3: Backfilling ${datesToProcess.length} fechas...`);

    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: { date: string; fc: number; cost: number; sales: number; stores: number }[] = [];

    for (let i = 0; i < datesToProcess.length; i++) {
        const date = datesToProcess[i];
        const url = `${BASE_URL}/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`;

        try {
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                const itemCount = json.data?.length || 0;
                success++;
                
                // Progress indicator every 10 dates
                if ((i + 1) % 10 === 0 || i === 0 || i === datesToProcess.length - 1) {
                    console.log(`  ✅ [${i + 1}/${datesToProcess.length}] ${date} → ${itemCount} items`);
                }
            } else {
                failed++;
                errors.push(`${date}: HTTP ${res.status}`);
                console.log(`  ❌ [${i + 1}/${datesToProcess.length}] ${date} → HTTP ${res.status}`);
            }
        } catch (err: any) {
            failed++;
            errors.push(`${date}: ${err.message?.substring(0, 60)}`);
            console.log(`  ❌ [${i + 1}/${datesToProcess.length}] ${date} → ${err.message?.substring(0, 60)}`);
        }

        // Small delay between requests
        if (i < datesToProcess.length - 1) {
            await new Promise(r => setTimeout(r, 400));
        }
    }

    // ═══ PASO 4: Verificación completa ═══
    console.log('\n' + '='.repeat(80));
    console.log('📊 PASO 4: VERIFICACIÓN COMPLETA');
    console.log('='.repeat(80));

    const { count: finalCount } = await supabase
        .from('food_cost_daily_cache')
        .select('id', { count: 'exact', head: true });

    console.log(`  Entradas en caché: ${finalCount}`);
    console.log(`  Fechas procesadas: ${datesToProcess.length}`);
    console.log(`  Éxitos: ${success}`);
    console.log(`  Fallos: ${failed}`);

    // Get all cache data for verification, paginated
    const allCacheData: any[] = [];
    let cacheFrom = 0;
    while (true) {
        const { data } = await supabase
            .from('food_cost_daily_cache')
            .select('business_date, total_cost, net_sales, cost_percentage, store_name')
            .order('business_date', { ascending: false })
            .range(cacheFrom, cacheFrom + 999);
        
        if (!data || data.length === 0) break;
        allCacheData.push(...data);
        if (data.length < 1000) break;
        cacheFrom += 1000;
    }

    // Group by date
    const byDate: Record<string, { stores: number; cost: number; sales: number; fcPcts: number[] }> = {};
    for (const row of allCacheData) {
        const d = row.business_date;
        if (!byDate[d]) byDate[d] = { stores: 0, cost: 0, sales: 0, fcPcts: [] };
        byDate[d].stores++;
        byDate[d].cost += Number(row.total_cost) || 0;
        byDate[d].sales += Number(row.net_sales) || 0;
        if (row.cost_percentage > 0) byDate[d].fcPcts.push(Number(row.cost_percentage));
    }

    const allDatesResult = Object.keys(byDate).sort().reverse();
    
    // Group by month for summary
    const byMonth: Record<string, { days: number; cost: number; sales: number }> = {};
    for (const d of allDatesResult) {
        const month = d.substring(0, 7); // YYYY-MM
        if (!byMonth[month]) byMonth[month] = { days: 0, cost: 0, sales: 0 };
        byMonth[month].days++;
        byMonth[month].cost += byDate[d].cost;
        byMonth[month].sales += byDate[d].sales;
    }

    console.log('\n  📅 RESUMEN POR MES:');
    console.log('  ' + '-'.repeat(70));
    console.log('  Mes        | Días | FC %    | Costo Total    | Ventas Total');
    console.log('  ' + '-'.repeat(70));
    
    const sortedMonths = Object.keys(byMonth).sort().reverse();
    for (const month of sortedMonths) {
        const m = byMonth[month];
        const fc = m.sales > 0 ? (m.cost / m.sales * 100).toFixed(2) : 'N/A';
        const marker = Number(fc) >= 30 && Number(fc) <= 38 ? '✅' : '⚠️';
        console.log(`  ${marker} ${month} | ${String(m.days).padStart(4)} | ${String(fc).padStart(6)}% | $${m.cost.toFixed(0).padStart(14)} | $${m.sales.toFixed(0).padStart(14)}`);
    }

    // Show daily detail for June (most recent month)
    console.log('\n  📅 DETALLE DIARIO - JUNIO 2026:');
    const juneDates = allDatesResult.filter(d => d.startsWith('2026-06'));
    juneDates.forEach(d => {
        const g = byDate[d];
        const fc = g.sales > 0 ? (g.cost / g.sales * 100).toFixed(2) : 'N/A';
        const marker = Number(fc) >= 30 && Number(fc) <= 38 ? '✅' : '⚠️';
        console.log(`    ${marker} ${d}: FC=${fc}% | Cost=$${g.cost.toFixed(0)} | Sales=$${g.sales.toFixed(0)} | ${g.stores} stores`);
    });

    if (errors.length > 0) {
        console.log('\n  Errores:');
        errors.forEach(e => console.log(`    ❌ ${e}`));
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎉 REPARACIÓN TOTAL COMPLETADA');
    console.log('='.repeat(80));
}

backfillAll().catch(console.error);
