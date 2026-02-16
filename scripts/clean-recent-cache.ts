
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

async function cleanRecentCache() {
    // Dates to clear: Feb 10, 11, 12, 13
    const dates = ['2025-02-10', '2025-02-11', '2025-02-12', '2025-02-13']

    console.log(`🗑️ Clearing sales_daily_cache for dates: ${dates.join(', ')}...`)

    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .in('business_date', dates)

    if (error) {
        console.error('Error clearing cache:', error)
    } else {
        console.log('✅ Cache cleared successfully. Next request will force a fresh Toast fetch.')
    }
}

cleanRecentCache()
