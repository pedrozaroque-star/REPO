
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'
import { getSupabaseClient } from '@/lib/supabase'

async function resyncFullHistory() {
    const supabase = await getSupabaseClient()
    const startDate = '2026-01-01'
    const endDate = '2026-02-13' // Up to yesterday

    console.log(`🚀 STARTING MASSIVE FULL RESYNC: ${startDate} to ${endDate}`)
    console.log(`   This will fetch Sales AND Labor for all stores and fix any discrepancies.`)

    // We'll process in 15-day chunks to be safe with API limits
    const chunks = [
        { start: '2026-01-01', end: '2026-01-15' },
        { start: '2026-01-16', end: '2026-01-31' },
        { start: '2026-02-01', end: '2026-02-13' }
    ]

    for (const chunk of chunks) {
        console.log(`\n📦 Processing Chunk: ${chunk.start} -> ${chunk.end}`)

        // 1. SYNC SALES (Dashboard Cache)
        console.log(`   🔄 Syncing Sales Data...`)
        try {
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: chunk.start,
                endDate: chunk.end,
                groupBy: 'day',
                skipCache: true, // FORCE LIVE
                fastMode: false
            })

            if (connectionError) {
                console.error(`   ❌ Sales Sync Failed: ${connectionError}`)
            } else {
                console.log(`   ✅ Sales Fetched: ${rows.length} records. Saving to DB...`)

                if (rows.length > 0) {
                    const dbRows = rows.map(r => ({
                        store_id: r.storeId,
                        store_name: r.storeName,
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
                        uber_sales: r.uberSales || 0,
                        doordash_sales: r.doordashSales || 0,
                        grubhub_sales: r.grubhubSales || 0,
                        ebt_count: r.ebtCount || 0,
                        ebt_amount: r.ebtAmount || 0,
                        updated_at: new Date().toISOString()
                    }))

                    const { error } = await supabase
                        .from('sales_daily_cache')
                        .upsert(dbRows, { onConflict: 'store_id,business_date' })

                    if (error) console.error("   ❌ DB Save Error:", error)
                }
            }
        } catch (e: any) {
            console.error("   ❌ Sales Chunk Error:", e.message)
        }

        // 2. SYNC LABOR (Punches/Planner) - Store by Store
        // We need store list first
        const { data: stores } = await supabase.from('stores').select('id, name, external_id').not('external_id', 'is', null)

        if (stores) {
            console.log(`   🔄 Syncing Labor Punches for ${stores.length} stores...`)
            for (const store of stores) {
                if (!store.external_id) continue
                // Create ISO range for punches
                const sIso = `${chunk.start}T00:00:00.000+0000`
                const eIso = `${chunk.end}T23:59:59.999+0000`

                // console.log(`      > ${store.name}`)
                // The syncToastPunches function handles delete-before-insert logic internally now
                try {
                    await syncToastPunches(store.external_id, sIso, eIso)
                } catch (err: any) {
                    console.error(`      ❌ Error syncing labor for ${store.name}: ${err.message}`)
                }
            }
            console.log(`   ✅ Labor Sync Complete for Chunk.`)
        }
    }

    console.log(`\n✨✨ FULL RESYNC COMPLETE ✨✨`)
}

resyncFullHistory()
