import { fetchToastData, getAuthToken, getToastRestaurants } from '../lib/toast-api';
import { getSupabaseClient } from '../lib/supabase';

async function repairPast() {
    console.log("🚀 Iniciando Sanación Histórica de Base de Datos (Diciembre 2025 - Enero 2026) en todas las tiendas...");
    const sb = await getSupabaseClient();
    const token = await getAuthToken();
    const stores = await getToastRestaurants(token);

    const dateRanges = [
        { start: '2025-12-01', end: '2025-12-31', name: 'Diciembre 2025' },
        { start: '2026-01-01', end: '2026-01-31', name: 'Enero 2026' }
    ];

    for (const store of stores) {
        // Skip ghost/invalid stores
        if (!store.id || store.name === "Guisados") {
            continue;
        }

        console.log(`\n================================`);
        console.log(`🏥 REPARANDO: ${store.name}`);
        console.log(`================================`);

        for (const range of dateRanges) {
            console.log(`\n======================================================`);
            console.log(`🗑️  Eliminando registros corruptos de ${range.name}...`);
            await sb.from('sales_daily_cache')
                .delete()
                .gte('business_date', range.start)
                .lte('business_date', range.end)
                .eq('store_id', store.id);

            console.log(`📡 Descargando ${range.name} con Parche 429 Anti-Bloqueos...`);
            const { rows } = await fetchToastData({
                storeIds: store.id,
                startDate: range.start,
                endDate: range.end,
                groupBy: 'day',
                skipCache: true
            });

            console.log(`💾 Inyectando ${rows.length} días puros a Supabase para ${store.name}...`);
            let savedCount = 0;
            for (const r of rows) {
                const { error } = await sb.from('sales_daily_cache').upsert({
                    store_id: store.id,
                    store_name: store.name,
                    business_date: r.periodStart,
                    net_sales: r.netSales,
                    gross_sales: r.grossSales,
                    discounts: r.discounts,
                    tips: r.tips,
                    taxes: r.taxes,
                    service_charges: r.serviceCharges,
                    order_count: r.orderCount,
                    guest_count: r.guestCount,
                    labor_cost: r.laborCost,
                    labor_hours: r.totalHours,
                    hourly_data: r.hourlySales,
                    hourly_tickets: r.hourlyTickets,
                    hourly_labor: {},
                    uber_sales: r.uberSales || 0,
                    doordash_sales: r.doordashSales || 0,
                    grubhub_sales: r.grubhubSales || 0,
                    ebt_count: r.ebtCount || 0,
                    ebt_amount: r.ebtAmount || 0,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'store_id,business_date' });

                if (error) {
                    console.error(`❌ Error guardando ${r.periodStart}: ${error.message}`);
                } else {
                    savedCount++;
                }
            }
            console.log(`✅ ${range.name}: ${savedCount} días resguardados perfectamente en el Cierre.`);
        }
    }

    console.log('\n🎉 ¡MISION COMPLETA! TODOS LOS MESES (DIC Y ENE) DE TODAS LAS SUCURSALES HAN SIDO BLINDADOS Y ALINEADOS CON TOAST.');
}

repairPast().catch(console.error);
