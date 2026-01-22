import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

async function restoreCacheScript() {
    console.log('🚀 Restoring FULL HISTORY (2020-2025)...')

    // Config: From Jan 1 2020 to Dec 31 2025
    const days: string[] = []
    const start = new Date('2020-01-01')
    const end = new Date('2025-12-31')

    // Generate all dates
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split('T')[0])
    }

    // Reverse order? No, chronological is better for logs.


    let dailyTotalOrders = 0
    let dailyTotalSales = 0


    console.log(`📅 Processing ${days.length} days for ALL stores...`)
    const supabase = await getSupabaseClient()

    for (const date of days) {
        console.log(`\n----------------------------------------`)
        console.log(`📅 Processing Date: ${date}`)

        // FORCE REFRESH: Delete cache first so fetchToastData goes to API
        await supabase.from('sales_daily_cache').delete().eq('business_date', date)

        try {
            // Fetch for ALL stores for this specific day
            // Important: lib/toast-api.ts must have isHourly=false for single days when groupBy='day'
            const { rows, connectionError } = await fetchToastData({
                storeIds: 'all',
                startDate: date,
                endDate: date,
                groupBy: 'day'
            })

            if (connectionError) {
                console.error(`❌ Error fetching Toast: ${connectionError}`)
                continue
            }

            if (!rows || rows.length === 0) {
                console.warn(`⚠️ No data returned for ${date}`)
                continue
            }

            console.log(`✅ Retrieved ${rows.length} store records`)

            // Insert found rows into Supabase
            let savedCount = 0
            for (const row of rows) {
                // Map to DB structure
                const dbRow = {
                    store_id: row.storeId,
                    store_name: row.storeName,
                    business_date: date,
                    net_sales: row.netSales || 0,
                    gross_sales: row.grossSales || 0,
                    discounts: row.discounts || 0,
                    tips: row.tips || 0,
                    taxes: row.taxes || 0,
                    service_charges: row.serviceCharges || 0,
                    order_count: row.orderCount || 0,
                    guest_count: row.guestCount || 0,
                    labor_hours: row.totalHours || 0,
                    labor_cost: row.laborCost || 0,
                    hourly_data: row.hourlySales || {},
                    uber_sales: row.uberSales || 0,
                    doordash_sales: row.doordashSales || 0,
                    grubhub_sales: row.grubhubSales || 0,
                    ebt_count: row.ebtCount || 0,
                    ebt_amount: row.ebtAmount || 0
                }

                const { error } = await supabase
                    .from('sales_daily_cache')
                    .upsert([dbRow], { onConflict: 'store_id,business_date' })

                if (error) {
                    console.error(`   ❌ Failed to save ${row.storeName}:`, error.message)
                } else {
                    savedCount++
                    // Log details for confirmation for ALL stores
                    console.log(`   📊 ${row.storeName}: $${dbRow.net_sales.toFixed(2)} | Uber: $${dbRow.uber_sales} | DD: $${dbRow.doordash_sales}`)

                    dailyTotalOrders += dbRow.order_count
                    dailyTotalSales += dbRow.net_sales
                }
            }
            console.log(`💾 Saved ${savedCount}/${rows.length} stores to cache`)
            console.log(`\n🔴 GLOBAL DAY STATS: Orders=${dailyTotalOrders} | Net=$${dailyTotalSales.toFixed(2)}`)

            // Short pause to be nice to API
            await new Promise(r => setTimeout(r, 800))

        } catch (e: any) {
            console.error(`❌ Critical Error on ${date}:`, e.message)
        }
    }

    console.log('\n✅ DONE. Cache restoration complete.')
}

restoreCacheScript()
