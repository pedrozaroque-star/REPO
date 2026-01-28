
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function runAudit() {
    const { generateSmartForecast, CAPACITY_RULES } = await import('@/lib/intelligence')

    // 1. FORECAST FUTURE (Jan 27 2026 to Mar 15 2026)
    const allDates = []
    const start = new Date('2026-01-27')
    const end = new Date('2026-03-15')

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        allDates.push(d.toISOString().split('T')[0])
    }

    let output = `# 🔮 FORECAST & SCHEDULE: LYNWOOD (Jan - Mar 2026)\n\n`
    output += `**Planning Rules:** Kitchen @ $211/hr | Cashiers @ 18.3 Tix/hr\n\n`
    output += `| Date       | Day | Forecast | Actual | Staff Suggestion (Peak) | Peak Hr |\n`
    output += `|------------|-----|----------|--------|-------------------------|---------|\n`

    for (const date of allDates) {
        // 1. Forecast
        const predicted = await generateSmartForecast(STORE_ID, date)

        // 2. Actual (Try to fetch, but expect null for future)
        const { data: actual } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('store_id', STORE_ID)
            .eq('business_date', date)
            .single()

        const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
        const forecastStr = `$${(predicted.total_sales / 1000).toFixed(1)}k`

        // Logic for Future vs Past
        let actualStr = 'Pending'
        let staffStr = ''
        let peakStr = '19:00' // Default

        // Determine Peak Hour from Forecast if Real doesn't exist
        let peakHour = 19
        let maxSales = 0

        if (predicted.hours && predicted.hours.length > 0) {
            predicted.hours.forEach(h => {
                // Use predicted sales to find peak
                if (h.projected_sales > maxSales) { maxSales = h.projected_sales; peakHour = h.hour }
            })
        }
        peakStr = `${peakHour}:00`

        // Staffing Suggestion (From Forecast)
        const sugBOH = predicted.hours.find(h => h.hour === peakHour)?.required_kitchen || 0
        const sugFOH = predicted.hours.find(h => h.hour === peakHour)?.required_foh || 0

        if (actual && actual.net_sales > 0) {
            // We have actual data (e.g. today or past)
            actualStr = `$${(actual.net_sales / 1000).toFixed(1)}k`

            // Recalculate peak based on ACTUAL data
            let realMax = 0
            if (actual.hourly_data) {
                Object.entries(actual.hourly_data).forEach(([h, s]) => {
                    if (Number(s) > realMax) { realMax = Number(s); peakHour = Number(h) }
                })
            }
            peakStr = `${peakHour}:00` // Update to real peak

            // Calculate Needs
            const realSalesAtPeak = Number(actual.hourly_data?.[peakHour]) || 0
            const needBOH = Math.ceil(realSalesAtPeak / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)

            const realTixAtPeak = Number(actual.hourly_tickets?.[peakHour]) || 0
            const needFOH = Math.ceil(realTixAtPeak / CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN)

            // Diff Icons
            const diffBOH = sugBOH - needBOH
            const diffFOH = sugFOH - needFOH

            const iconB = diffBOH < -1 ? '🆘' : (diffBOH > 1 ? '💸' : '✅')
            const iconF = diffFOH < -1 ? '🆘' : (diffFOH > 1 ? '💸' : '✅')

            staffStr = `K:${sugBOH}(${iconB} ${needBOH}) | C:${sugFOH}(${iconF} ${needFOH})`
        } else {
            // Future / No Data - Just show suggestions
            staffStr = `👨‍🍳 **${sugBOH}** Kitchen | 🏪 **${sugFOH}** Front`
        }

        output += `| ${date} | ${dayName} | ${forecastStr.padEnd(8)} | ${actualStr.padEnd(8)} | ${staffStr.padEnd(23)} | ${peakStr} |\n`
        console.log(`Planned ${date}...`)
    }

    fs.writeFileSync('forecast_future_2026.md', output)
    console.log('✅ Schedule Plan saved to forecast_future_2026.md')
}

runAudit()
