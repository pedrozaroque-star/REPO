
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function diagnoseForecast() {
    const { generateSmartForecast } = await import('@/lib/intelligence')

    // Check next 5 days
    const dates = ['2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31']

    console.log(`\n🕵️ DIAGNOSING FORECAST LOGIC (Why so optimistic?)\n`)
    console.log(`| Date | 2025 Base (Hist) | Recent Trend (21-Day) | Final Forecast | Impact |`)
    console.log(`|---|---|---|---|---|`)

    for (const date of dates) {
        // We need to inspect the internal logic. 
        // Since we can't easily console.log from inside the imported library without modifying it,
        // we will infer the components from the result and separate queries.

        // 1. Get the forecast result
        const forecast = await generateSmartForecast(STORE_ID, date)

        // 2. Re-calculate Base manually to show comparison
        const targetDate = new Date(date + 'T12:00:00')
        const baseDate = new Date(targetDate)
        baseDate.setDate(baseDate.getDate() - 364) // Last Year
        const baseDateStr = baseDate.toISOString().split('T')[0]

        const { data: hist } = await supabase
            .from('sales_daily_cache')
            .select('net_sales')
            .eq('store_id', STORE_ID)
            .eq('business_date', baseDateStr)
            .single()

        const baseSales = hist?.net_sales || 0
        const predicted = forecast.total_sales

        // Infer the growth factor applied
        // Forecast ~= Base * (1 + Growth)
        // So Growth ~= (Forecast / Base) - 1
        let impliedGrowth = 0
        if (baseSales > 0) {
            impliedGrowth = (predicted / baseSales) - 1
        }

        console.log(`| ${date} | $${(baseSales / 1000).toFixed(1)}k | ${(impliedGrowth * 100).toFixed(1)}% | $${(predicted / 1000).toFixed(1)}k | ${impliedGrowth > 0 ? '📈 Boosting' : '📉 Dragging'} |`)
    }
}

diagnoseForecast()
