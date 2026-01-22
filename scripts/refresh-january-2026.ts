
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

async function refreshJanuary() {
    console.log('🚀 Refreshing January 2026 Cache with New Logic...')

    const start = new Date('2026-01-01')
    const end = new Date() // Today

    // Generate dates
    const days: string[] = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().split('T')[0])
    }

    console.log(`📅 Processing ${days.length} days (Jan 1 - Today)...`)
    const supabase = await getSupabaseClient()

    for (const date of days) {
        console.log(`\n----------------------------------------`)
        console.log(`📅 Processing Date: ${date}`)

        // FORCE REFRESH: Delete cache first so fetchToastData goes to API logic (which is fixed)
        await supabase.from('sales_daily_cache').delete().eq('business_date', date)

        try {
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
                    ebt_amount: row.ebtAmount || 0,
                    updated_at: new Date().toISOString()
                }

                const { error } = await supabase
                    .from('sales_daily_cache')
                    .upsert([dbRow], { onConflict: 'store_id,business_date' })

                if (error) {
                    console.error(`   ❌ Failed to save ${row.storeName}:`, error.message)
                } else {
                    savedCount++
                    // Log details to confirm Uber is present
                    console.log(`   📊 ${row.storeName}: $${dbRow.net_sales.toFixed(2)} | Uber: $${dbRow.uber_sales} | EBT: ${dbRow.ebt_count}`)
                }
            }
            console.log(`💾 Saved ${savedCount}/${rows.length} stores to cache`)

            // Short pause
            await new Promise(r => setTimeout(r, 500))

        } catch (e: any) {
            console.error(`❌ Critical Error on ${date}:`, e.message)
        }
    }

    console.log('\n✅ DONE. January 2026 Refreshed.')
}

refreshJanuary()
