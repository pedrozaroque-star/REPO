
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood

async function validateJan5() {
    const { generateSmartForecast, CAPACITY_RULES } = await import('@/lib/intelligence')

    console.log(`⚖️  VALIDATING FORECAST: 05 ENE 2026 (Monday)`)

    const date = '2026-01-05'

    console.log(`\n---------------------------------------------------`)
    console.log(`📅 TESTING DATE: ${date}`)

    // 1. Get WHAT ACTUALLY HAPPENED
    const { data: actual } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', STORE_ID)
        .eq('business_date', date)
        .single()

    if (!actual) {
        console.log('   ❌ No actual data found.')
        return
    }

    // 2. Get WHAT MODEL PREDICTS
    // NOTE: Uses historical data from Jan 2025, 2024, 2023
    const predicted = await generateSmartForecast(STORE_ID, date)

    const errorDelta = actual.net_sales - predicted.total_sales
    const errorPct = (errorDelta / actual.net_sales) * 100

    console.log(`   💰 Sales Accuracy:`)
    console.log(`      REAL: $${actual.net_sales.toFixed(0)}`)
    console.log(`      PROJ: $${predicted.total_sales.toFixed(0)} (Method: ${predicted.growth_factor_applied > 1 ? 'Hist+Growth' : 'Fallback Avg'})`)
    console.log(`      DIFF: ${errorPct > 0 ? '+' : ''}${errorPct.toFixed(1)}%`)

    // 3. STAFFING REALITY CHECK
    console.log(`\n   👮 Staffing Reality Check (Peak Hour):`)

    let peakHour = 19
    let maxSales = 0
    if (actual.hourly_data) {
        Object.entries(actual.hourly_data).forEach(([h, s]) => {
            if (Number(s) > maxSales) { maxSales = Number(s); peakHour = Number(h) }
        })
    }

    const actSalesPk = Number(actual.hourly_data?.[peakHour] || 0)

    const suggestKitch = predicted.hours.find(h => h.hour === peakHour)?.required_kitchen || 0
    const neededKitchForActual = Math.ceil(actSalesPk / CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN)

    console.log(`      Peak Hour Detected: ${peakHour}:00`)
    console.log(`      @ Peak - Projected Sales: $${predicted.hours.find(h => h.hour === peakHour)?.sales_projected.toFixed(0)} -> Sug: ${suggestKitch} Cooks`)
    console.log(`      @ Peak - Actual Sales:    $${actSalesPk.toFixed(0)} -> Need: ${neededKitchForActual} Cooks`)

    const diff = Math.abs(suggestKitch - neededKitchForActual)
    if (diff > 1) {
        console.log(`      ⚠️  Model off by ${diff} cooks.`)
    } else {
        console.log(`      ✅ Model aligned with reality!`)
    }
}

validateJan5()
