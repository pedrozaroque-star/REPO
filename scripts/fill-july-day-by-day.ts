
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fillJulyDayByDay() {
    console.log('🗓️ Starting Force Fill for JULY 2025 (Day by Day)...')

    const startStr = '2025-07-01'
    const endStr = '2025-07-31'

    // 1. CLEAR CACHE for July
    console.log('🧹 Deleting cache for July 2025...')
    const { error: deleteError } = await supabase
        .from('sales_daily_cache')
        .delete()
        .gte('business_date', startStr)
        .lte('business_date', endStr)

    if (deleteError) {
        console.error('❌ Failed to clear cache:', deleteError)
        // We continue? Maybe safer to stop if we want to ensure clean slate.
        // user said "delete everything july 2025", so availability to delete is key.
        // If it fails, likely permissions or connection.
        return
    }
    console.log('✅ Cache cleared for July.')

    // 2. Iterate Day by Day
    const startDate = new Date(startStr + 'T12:00:00') // Noon to avoid timezone boundary issues on initiation
    const endDate = new Date(endStr + 'T12:00:00')

    let current = new Date(startDate)

    while (current <= endDate) {
        const dayStr = current.toISOString().split('T')[0]
        console.log(`🔄 Processing Date: ${dayStr}...`)

        try {
            // Fetch for ALL stores for this single day
            const result = await fetchToastData({
                storeIds: 'all',
                startDate: dayStr,
                endDate: dayStr,
                groupBy: 'day'
            })

            const successCount = result.rows.length
            console.log(`   ✅ Success: Fetched ${successCount} stores sales for ${dayStr}.`)

            // 3. Sync Punches for these stores
            console.log(`   🥊 Syncing punches for ${result.rows.length} stores...`)
            for (const row of result.rows) {
                // Ignore errors to keep moving
                try {
                    // Toast requires full ISO strings with timezone (UTC usually accepted if +0000 appended)
                    const startIso = `${dayStr}T00:00:00.000+0000`
                    const endIso = `${dayStr}T23:59:59.999+0000`
                    await syncToastPunches(row.storeId, startIso, endIso)
                } catch (e) { console.error(`Failed punch sync ${row.storeId}`, e) }
            }

            // Optional: Add small delay to be nice to API
            await new Promise(r => setTimeout(r, 500))

        } catch (err) {
            console.error(`   ❌ Failed for ${dayStr}:`, err)
        }

        // Next day
        current.setDate(current.getDate() + 1)
    }

    console.log('🎉 July Backfill Complete.')
}

fillJulyDayByDay()
