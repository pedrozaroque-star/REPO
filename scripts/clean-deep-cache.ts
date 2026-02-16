
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function cleanDeepCache() {
    // Clear ENTIRE Jan and Feb 2025 cache to force re-fetch
    const startDate = '2025-01-01'
    const endDate = '2025-02-14'

    console.log(`🚨 DEEP CLEAN: Clearing sales_daily_cache from ${startDate} to ${endDate}...`)

    const { error, count } = await supabase
        .from('sales_daily_cache')
        .delete({ count: 'exact' })
        .gte('business_date', startDate)
        .lte('business_date', endDate)

    if (error) {
        console.error('Error clearing cache:', error)
    } else {
        console.log(`✅ Cache CLEARED for ${count} entries. System acts as if data is new.`)
    }
}

cleanDeepCache()
