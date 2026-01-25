
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function backfillTickets() {
    console.log('🔄 Starting Global Ticket Backfill (6 Months)...')

    // Calculate Dates
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(endDate.getMonth() - 6)

    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]

    console.log(`📅 Range: ${startStr} to ${endStr}`)

    // 1. Get All Store IDs
    // We can use the hardcoded overrides in toast-api.ts or fetch from DB. 
    // Let's rely on fetchToastData('all') logic but we want to do it store by store to manage memory/limits.
    // Actually, fetchToastData handles 'all'. But for backfill, maybe safer to do one by one.
    // We'll trust 'all' but we MUST clear cache first.

    // (Cache clearing is now done day-by-day inside the loop)

    // 2. Run Sync
    // fetchToastData logic:
    // - If cache missing -> Fetch from API -> Save to Cache (with new code)

    // We'll iterate day by day to show progress and avoid timeouts
    let currentStart = new Date(startDate)

    while (currentStart <= endDate) {
        // Format YYYY-MM-DD
        const dateStr = currentStart.toISOString().split('T')[0]

        console.log(`\n📅 Processing ${dateStr}... `)

        // 1. Clear Cache for this SPECIFIC day
        // This ensures fetchToastData hits the API and gets fresh ticket data
        const { error: deleteError } = await supabase
            .from('sales_daily_cache')
            .delete()
            .eq('business_date', dateStr)

        if (deleteError) {
            console.error(`   ⚠️ Failed to clear cache for ${dateStr}:`, deleteError.message)
        }

        try {
            // 2. Fetch Data (will save to cache automatically)
            // fetchToastData internally saves to 'sales_daily_cache'
            await fetchToastData({
                storeIds: 'all',
                startDate: dateStr,
                endDate: dateStr,
                groupBy: 'day'
            })
            console.log(`   ✅ Success: ${dateStr}`)
        } catch (err) {
            console.error(`   ❌ Failed: ${dateStr}`, err)
        }

        // Increment by 1 day
        currentStart.setDate(currentStart.getDate() + 1)
    }

    console.log('🎉 Global Backfill Complete.')
}

backfillTickets()
