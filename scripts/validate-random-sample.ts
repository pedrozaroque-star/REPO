
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function randomSampleTest() {
    const { generateSmartForecast, CAPACITY_RULES } = await import('@/lib/intelligence')

    console.log(`🎲 RANDOM SAMPLE AUDIT (Multi-Factor Engine)`)

    const sampleDates = [
        { date: '2025-05-05', label: 'Cinco de Mayo 2025' },
        { date: '2025-12-01', label: 'Post-Thanksgiving Mon' },
        { date: '2026-02-08', label: 'FUTURE: SuperBowl 2026' }, // Future Prediction!
        { date: '2025-03-04', label: 'Random Tuesday (March)' }
    ]

    for (const item of sampleDates) {
        console.log(`\n---------------------------------------------------`)
        console.log(`📅 ${item.label} (${item.date})`)

        // 1. Prediction
        const predicted = await generateSmartForecast(STORE_ID, item.date)

        console.log(`   🔮 PREDICTION:`)
        console.log(`      Sales: $${predicted.total_sales.toFixed(0)}`)
        console.log(`      Growth Factor Applied: ${predicted.growth_factor_applied.toFixed(2)}x`)
        if (predicted.weather_adjustment) {
            console.log(`      ⛈️ Weather Adj: ${predicted.weather_adjustment}`)
        }

        // 2. Reality (If available)
        const { data: actual } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('store_id', STORE_ID)
            .eq('business_date', item.date)
            .single()

        if (actual) {
            const errorPct = ((actual.net_sales - predicted.total_sales) / actual.net_sales) * 100
            console.log(`   ✅ REALITY: $${actual.net_sales.toFixed(0)}`)
            console.log(`   📊 DIFF: ${errorPct > 0 ? '+' : ''}${errorPct.toFixed(1)}%`)

            // Peak Staffing Check
            let peakHour = 19
            let maxSales = 0
            if (actual.hourly_data) {
                Object.entries(actual.hourly_data).forEach(([h, s]) => {
                    if (Number(s) > maxSales) { maxSales = Number(s); peakHour = Number(h) }
                })
            }
            const sugCooks = predicted.hours.find(h => h.hour === peakHour)?.required_kitchen || 0
            const needCooks = Math.ceil((Number(actual.hourly_data?.[peakHour]) || 0) / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)
            console.log(`   👮 Peak Staffing (${peakHour}:00): Sug ${sugCooks} vs Need ${needCooks}`)

        } else {
            console.log(`   🔮 (Future Date - No reality to compare yet)`)
        }
    }
}

randomSampleTest()
