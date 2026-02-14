
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

async function restoreSales() {
    const supabase = await getSupabaseClient()
    const startDate = '2026-02-09'
    const endDate = '2026-02-13' // Restore up to today/yesterday

    console.log(`🚑 Restoring Missing Sales Data: ${startDate} to ${endDate}`)

    // We can fetch range 'day' to get daily details
    const { rows, connectionError } = await fetchToastData({
        storeIds: 'all',
        startDate,
        endDate,
        groupBy: 'day',
        skipCache: true, // FORCE LIVE FETCH
        fastMode: false
    })

    if (connectionError) {
        console.error("❌ Connection Error:", connectionError)
        return
    }

    console.log(`✅ Fetched ${rows.length} rows from Toast. Saving to DB...`)

    if (rows.length > 0) {
        const dbRows = rows.map(r => ({
            store_id: r.storeId,
            store_name: r.storeName,
            business_date: r.periodStart, // This comes from Toast, usually YYYY-MM-DD
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
            uber_sales: r.uberSales || 0,
            doordash_sales: r.doordashSales || 0,
            grubhub_sales: r.grubhubSales || 0,
            ebt_count: r.ebtCount || 0,
            ebt_amount: r.ebtAmount || 0,
            updated_at: new Date().toISOString()
        }))

        // Upsert in chunks if needed, but 15 stores * 5 days = 75 rows, simple enough
        const { error } = await supabase
            .from('sales_daily_cache')
            .upsert(dbRows, { onConflict: 'store_id,business_date' })

        if (error) console.error("❌ DB Insert Error:", error)
        else console.log("💾 Successfully restored sales cache.")
    } else {
        console.log("⚠️ No rows returned from Toast.")
    }
}

restoreSales()
