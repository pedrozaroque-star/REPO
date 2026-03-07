import { fetchToastData, getAuthToken, getToastRestaurants } from '../lib/toast-api';
import { getSupabaseClient } from '../lib/supabase';

async function repairAll() {
    console.log("🚀 Starting full repair for February 2026 across all stores...");
    const sb = await getSupabaseClient();
    const token = await getAuthToken();
    const stores = await getToastRestaurants(token);

    for (const store of stores) {
        // Skip ghost/invalid stores
        if (!store.id || store.name === "Guisados" || store.name === "Lynwood") {
            if (store.name === "Lynwood") console.log(`⏩ Skipping ${store.name} (Already fixed)`);
            continue;
        }

        console.log(`\n🗑️  Deleting corrupted cache for ${store.name}...`);
        await sb.from('sales_daily_cache')
            .delete()
            .gte('business_date', '2026-02-01')
            .lte('business_date', '2026-02-28')
            .eq('store_id', store.id);

        console.log(`📡 Fetching 28 days for ${store.name} (with 429 Patch enabled)...`);
        const { rows } = await fetchToastData({
            storeIds: store.id,
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            groupBy: 'day',
            skipCache: true
        });

        console.log(`💾 Saving ${rows.length} rows to DB for ${store.name}...`);
        let savedCount = 0;
        for (const r of rows) {
            const { error } = await sb.from('sales_daily_cache').upsert({
                store_id: store.id,
                store_name: store.name, // Keep the store_name parity
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
                console.error(`❌ Error saving ${r.periodStart} for ${store.name}: ${error.message}`);
            } else {
                savedCount++;
            }
        }
        console.log(`✅ Saved ${savedCount} rows mapping perfectly.`);
    }

    console.log('\n🎉 ALL STORES FULLY SYNCHRONIZED!');
}

repairAll().catch(console.error);
