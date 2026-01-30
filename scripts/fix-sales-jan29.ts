
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fetchToastData } from '../lib/toast-api'

// 1. Load Environment Variables
try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    const envConfig = dotenv.parse(fs.readFileSync(envPath))
    for (const k in envConfig) {
        process.env[k] = envConfig[k]
    }
} catch (e) {
    console.warn("⚠️ Could not read .env.local")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing Supabase Credentials")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
})

async function fixJan29() {
    const DATE_TARGET = '2026-01-29'
    console.log(`🧹 Cleaning corrupted data for ${DATE_TARGET}...`)

    // 1. Delete bad data
    const { error: delError } = await supabase
        .from('sales_daily_cache')
        .delete()
        .eq('business_date', DATE_TARGET)

    if (delError) {
        console.error("❌ Error deleting old data:", delError)
        return
    }
    console.log("✅ Old data deleted.")

    console.log(`🔄 Fetching fresh data from Toast for ${DATE_TARGET}...`)

    // 2. Fetch fresh data (Skip Cache is implied by fetching, but we pass true to be safe)
    const { rows, connectionError } = await fetchToastData({
        storeIds: 'all',
        startDate: DATE_TARGET,
        endDate: DATE_TARGET,
        groupBy: 'day',
        skipCache: true,
        fastMode: false // FULL PRECISION
    })

    if (connectionError) {
        console.error("❌ Toast Connection Error:", connectionError)
        return
    }

    if (rows.length === 0) {
        console.warn("⚠️ No data returned from Toast.")
        return
    }

    console.log(`📊 Retrieved ${rows.length} rows. Preparing valid payload...`)

    // 3. Prepare Payload WITH HOURLY DATA
    const dbRows = rows.map(r => ({
        store_id: r.storeId,
        store_name: r.storeName,
        business_date: DATE_TARGET, // Force correct date
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
        hourly_data: r.hourlySales,      // CRITICAL: Hourly Sales
        hourly_tickets: r.hourlyTickets, // CRITICAL: Hourly Tickets
        uber_sales: r.uberSales || 0,
        doordash_sales: r.doordashSales || 0,
        grubhub_sales: r.grubhubSales || 0,
        ebt_count: r.ebtCount || 0,
        ebt_amount: r.ebtAmount || 0,
        updated_at: new Date().toISOString()
    }))

    // 4. Upsert
    const { error: upsertError } = await supabase
        .from('sales_daily_cache')
        .upsert(dbRows, { onConflict: 'store_id,business_date' })

    if (upsertError) {
        console.error("❌ DB Save Failed:", upsertError)
    } else {
        console.log(`✅ Success! ${dbRows.length} stores updated for ${DATE_TARGET} with VALID hourly data.`)
    }
}

fixJan29().catch(console.error)
