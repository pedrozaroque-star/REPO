import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '../lib/toast-api'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log(`\n🔄 SYNC DAILY CACHE (Backfill Recent Days)\n`)

    // Get range: Last 3 days to be sure (Yesterday, Today is live so skip, Day before)
    // Actually, let's just reliable backfill "Yesterday" and "Day Before"

    // We want to fill sales_daily_cache table.

    const now = new Date()
    // Go back 7 days just to be safe and heal any gaps
    const daysToSync = 7

    for (let i = 1; i <= daysToSync; i++) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]

        console.log(`\n📅 Processing ${dateStr}...`)

        // 1. Delete existing cache entry to force fresh fetch logic?
        // Actually fetchToastData has 'skipCache' option.
        // But fetchToastData returns aggregated rows. We need to WRITE to DB.
        // fetchToastData normally READS. 
        // Wait, where is the logic that WRITES to 'sales_daily_cache'?
        // Usually it's in a cron job route like /api/cron/sync-sales.

        // Let's emulate what the CRON JOB does:
        // 1. Fetch from Toast (LIVE)
        // 2. Upsert to Supabase

        try {
            console.log(`   - Fetching LIVE data from Toast API...`)
            const { rows } = await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day',
                skipCache: true, // FORCE LIVE
                fastMode: false // FULL PRECISION
            })

            if (rows.length === 0) {
                console.log(`   ⚠️ No data found for ${dateStr}`)
                continue
            }

            console.log(`   - Retrieved ${rows.length} stores. upserting to DB...`)

            // Transform to DB Schema
            const dbRows = rows.map(r => ({
                store_id: r.storeId,
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
                hourly_data: r.hourlySales, // JSONB
                hourly_tickets: r.hourlyTickets, // JSONB
                hourly_labor: r.hourlyLabor,
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
                console.log(`   ✅ Success! Saved ${dbRows.length} records for ${dateStr}`)
            }

        } catch (e: any) {
            console.error(`   ❌ Error processing ${dateStr}:`, e.message)
        }
    }

    console.log(`\n✅ Done. Cache restored.`)
}

run()
