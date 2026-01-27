
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkCount() {
    console.log('🔍 Checking REAL row count for 2025 in sales_daily_cache...')

    // 1. Get raw count
    const { count, error } = await supabase
        .from('sales_daily_cache')
        .select('*', { count: 'exact', head: true })
        .gte('business_date', '2025-01-01')
        .lte('business_date', '2025-12-31')

    if (error) {
        console.error('Error counting:', error)
    } else {
        console.log(`📊 Total Rows found for 2025: ${count}`)

        // Expected rows: 15 stores * 365 days = 5475 rows
        const expected = 15 * 365
        const pct = ((count || 0) / expected) * 100
        console.log(`🎯 Coverage: ${pct.toFixed(1)}% (${count}/${expected})`)
    }

    // 2. Check Monthly Distribution to find the gap visually
    console.log('\n📅 Monthly Breakdown (Rows per Month):')
    const { data } = await supabase.rpc('get_sales_count_by_month_2025')
    // Wait, RPC might not exist. Let's do raw query grouping via JS if data is small enough, 
    // or just sample check first and last dates.

    // Alternative: Get distinct dates
    const { data: dates, error: dateError } = await supabase
        .from('sales_daily_cache')
        .select('business_date')
        .gte('business_date', '2025-01-01')
        .lte('business_date', '2025-12-31')
        .order('business_date')

    if (dates && dates.length > 0) {
        const uniqueDates = new Set(dates.map(d => d.business_date))
        console.log(`📅 Unique Business Dates: ${uniqueDates.size} / 365`)
        console.log(`Start Date: ${dates[0].business_date}`)
        console.log(`End Date:   ${dates[dates.length - 1].business_date}`)

        // Check Gap March
        const mar = dates.filter(d => d.business_date.startsWith('2025-03')).length
        const apr = dates.filter(d => d.business_date.startsWith('2025-04')).length
        const dec = dates.filter(d => d.business_date.startsWith('2025-12')).length

        console.log(`\nSpecific Months Check:`)
        console.log(`Starts with 2025-03-: ${mar} rows (Expected ~465)`)
        console.log(`Starts with 2025-04-: ${apr} rows (Expected ~450)`)
        console.log(`Starts with 2025-12-: ${dec} rows (Expected ~465)`)
    }
}

checkCount()
