
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function runAudit() {
    const { generateSmartForecast } = await import('@/lib/intelligence')

    let output = `# 💘 BACKTEST: FEB 2024 vs 2025 (VALENTINE'S UPGRADE)\n\n`
    output += `**Logic:** 50% Recent Trend | 50% History | Valentine's Boost +15%\n\n`

    const years = [2024, 2025]

    for (const year of years) {
        output += `## FEBRUARY ${year}\n`
        output += `| Date       | Day | Forecast | Actual | Diff $ | Error % |\n`
        output += `|------------|-----|----------|--------|--------|---------|\n`

        let totalError = 0
        let count = 0
        const start = new Date(`${year}-02-01`)
        const end = new Date(`${year}-02-29`) // Leap year safe check logic needed? 2024 WAS Leap Year.

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            // Check meaningful month (Date overflow protection)
            if (d.getMonth() !== 1) continue;

            const date = d.toISOString().split('T')[0]

            // 1. Forecast
            const predicted = await generateSmartForecast(STORE_ID, date)

            // 2. Actual
            const { data: actual } = await supabase
                .from('sales_daily_cache')
                .select('*')
                .eq('store_id', STORE_ID)
                .eq('business_date', date)
                .single()

            const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
            const forecastStr = `$${(predicted.total_sales / 1000).toFixed(1)}k`

            let actualStr = 'N/A'
            let diffStr = '---'
            let errorPct = 0

            if (actual && actual.net_sales > 0) {
                actualStr = `$${(actual.net_sales / 1000).toFixed(1)}k`
                const diff = actual.net_sales - predicted.total_sales
                diffStr = `$${(diff / 1000).toFixed(1)}k`
                errorPct = Math.abs(diff) / actual.net_sales * 100
                totalError += errorPct
                count++
            }

            output += `| ${date} | ${dayName} | ${forecastStr.padEnd(8)} | ${actualStr.padEnd(8)} | ${diffStr.padEnd(6)} | ${errorPct.toFixed(1)}% |\n`
            console.log(`Audited ${date}...`)
        }

        const avgError = count > 0 ? (totalError / count) : 0
        output += `\n**Average Error ${year}:** ${avgError.toFixed(1)}%\n\n`
    }

    fs.writeFileSync('audit_feb_multi.md', output)
    console.log('✅ Audit saved to audit_feb_multi.md')
}

runAudit()
