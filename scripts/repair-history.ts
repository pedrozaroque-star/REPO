
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '../lib/toast-api'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log(`\n🚑 REPAIR HISTORY (Backfill 2026)\n`)

    const startDate = new Date('2026-01-01')
    const endDate = new Date() // Today

    // Loop day by day
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]
        console.log(`\n📅 Processing ${dateStr}...`)

        try {
            console.log(`   - Fetching LIVE data (Force Refresh)...`)
            const { rows } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day',
                skipCache: true, // FORCE LIVE to get hourly_labor
                fastMode: false // FULL PRECISION
            })

            if (rows.length === 0) {
                console.log(`   ⚠️ No data found for ${dateStr}`)
                continue
            }

            console.log(`   - Retrieved ${rows.length} stores. Upserting to DB...`)

            const dbRows = rows.map(r => ({
                store_id: r.storeId,
                store_name: r.storeName || 'Unknown Store', // Safety fallback
                business_date: dateStr,
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
                hourly_labor: r.hourlyLabor, // <--- THE CRITICAL FIELD
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

            if (error) {
                console.error(`   ❌ DB Error: ${error.message}`)
            } else {
                console.log(`   ✅ Success! Repaired ${dbRows.length} records for ${dateStr}`)
            }

        } catch (e: any) {
            console.error(`   ❌ Error processing ${dateStr}:`, e.message)
        }
    }

    console.log(`\n✅ History Repair Complete.`)
}

run()
