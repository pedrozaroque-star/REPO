import { fetchToastData, getAuthToken, getToastRestaurants } from '../lib/toast-api'
import { getSupabaseClient } from '../lib/supabase'

async function repairGaps() {
    console.log("🚀 Iniciando Sanación de Huecos Específicos (Azusa & Downey) 2026...");
    const sb = await getSupabaseClient();
    const token = await getAuthToken();
    const stores = await getToastRestaurants(token);

    // Encuentra los IDs de Azusa y Downey
    const azusa = stores.find(s => s.name.includes('Azusa'));
    const downey = stores.find(s => s.name.includes('Downey'));

    const targets = [
        { store: azusa, startDate: '2026-01-01', endDate: '2026-01-31', checkName: 'Azusa - Enero' },
        { store: downey, startDate: '2026-02-01', endDate: '2026-02-28', checkName: 'Downey - Febrero' }
    ];

    for (const target of targets) {
        if (!target.store || !target.store.id) {
            console.error(`❌ No se encontró la tienda para ${target.checkName}`);
            continue;
        }

        console.log(`\n================================`);
        console.log(`🏥 REPARANDO: ${target.checkName}`);
        console.log(`================================`);

        console.log(`🗑️ Eliminando chatarra/huecos de ${target.checkName}...`);
        await sb.from('sales_daily_cache')
            .delete()
            .gte('business_date', target.startDate)
            .lte('business_date', target.endDate)
            .eq('store_id', target.store.id);

        console.log(`📡 Descargando desde Toast ${target.checkName}...`);
        try {
            const { rows, connectionError } = await fetchToastData({
                storeIds: target.store.id,
                startDate: target.startDate,
                endDate: target.endDate,
                groupBy: 'day',
                skipCache: true
            });

            if (connectionError) {
                console.error(`❌ Error en conexión a Toast para ${target.checkName}:`, connectionError);
                continue;
            }

            console.log(`💾 Inyectando ${rows.length} días a Supabase...`);
            let savedCount = 0;
            for (const r of rows) {
                const { error } = await sb.from('sales_daily_cache').upsert({
                    store_id: target.store.id,
                    store_name: target.store.name,
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
            console.log(`✅ ${target.checkName}: ${savedCount} días guardados exitosamente.`);
        } catch (e: any) {
            console.error(`❌ Fallo crítico al procesar ${target.checkName}:`, e.message);
        }
    }

    console.log('\n🎉 REPARACIÓN DE AZUSA Y DOWNEY COMPLETADA.');
}

repairGaps().catch(console.error);
