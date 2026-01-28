
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function debugWeights() {
    const { generateSmartForecast } = await import('@/lib/intelligence')

    // Pick a date where volatility matters (e.g. a Saturday)
    const targetDate = '2026-01-31'

    console.log(`\n🔬 DEBUGGING WEIGHTS FOR ${targetDate}\n`)

    // We can't see inside the function easily, but we can verify changes by 
    // simulating the logic externally with the same data fetch.

    const dTarget = new Date(targetDate + 'T12:00:00')

    // 1. Fetch History directly
    const dLastYear = new Date(dTarget); dLastYear.setDate(dLastYear.getDate() - 364)
    const dRecentEnd = new Date(dTarget); dRecentEnd.setDate(dRecentEnd.getDate() - 1)

    const dShortStart7 = new Date(dRecentEnd); dShortStart7.setDate(dShortStart7.getDate() - 7)
    const dShortStart21 = new Date(dRecentEnd); dShortStart21.setDate(dShortStart21.getDate() - 21)

    console.log(`Comparing Time Windows:`)
    console.log(`   - 7-Day Window Start: ${dShortStart7.toISOString().split('T')[0]}`)
    console.log(`   - 21-Day Window Start: ${dShortStart21.toISOString().split('T')[0]}`)

    // Fetch Sales Data
    const { data: salesRecent28 } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .gte('business_date', dShortStart21.toISOString().split('T')[0]) // Get enough for both
        .lte('business_date', dRecentEnd.toISOString().split('T')[0])

    const sales7 = salesRecent28?.filter(s => s.business_date >= dShortStart7.toISOString().split('T')[0]) || []
    const sales21 = salesRecent28 || []

    const avg7 = sales7.reduce((a, b) => a + b.net_sales, 0) / (sales7.length || 1)
    const avg21 = sales21.reduce((a, b) => a + b.net_sales, 0) / (sales21.length || 1)

    console.log(`\nReal Data Analysis:`)
    console.log(`   - Avg Sales (Last 7 Days): $${(avg7 / 1000).toFixed(2)}k`)
    console.log(`   - Avg Sales (Last 21 Days): $${(avg21 / 1000).toFixed(2)}k`)

    const diff = avg7 - avg21
    console.log(`   - Difference: $${(diff).toFixed(2)}`)

    if (Math.abs(diff) < 500) {
        console.log(`\n✅ CONCLUSION: The 7-day trend matches the 21-day trend almost perfectly.`)
        console.log(`   That explains why the forecast didn't change! Your store is very stable right now.`)
    } else {
        console.log(`\n⚠️ CONCLUSION: Significant difference found ($${diff.toFixed(2)}). Forecast SHOULD have changed.`)
    }
}

debugWeights()
