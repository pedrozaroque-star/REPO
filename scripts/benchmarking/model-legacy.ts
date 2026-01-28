
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { addDays, format } from 'date-fns'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// MOCK UTILS FROM FRONTEND HOOK
const formatDateISO = (d: Date) => d.toISOString().split('T')[0]

// THE LEGACY MODEL (Extracted from useSmartProjections.ts)
// Recibe storeId y una fecha OBJETIVO (no weekStart, para simplificar comparación diaria)
export async function generateLegacyForecast(storeId: string, targetDateStr: string): Promise<number> {
    const targetDate = new Date(targetDateStr + 'T12:00:00')
    const weekStart = new Date(targetDate) // Treat target as start for logic simplicity or adapt logic

    // The hook logic generates a whole week. We will replicate generating that day's projection.

    // 1. Define Range: 8 Weeks Lookback
    const targetStart = new Date(targetDate)
    const lookbackStart = new Date(targetStart)
    lookbackStart.setDate(targetStart.getDate() - 56)
    const lookbackEnd = new Date(targetStart)
    lookbackEnd.setDate(targetStart.getDate() - 1)

    // Seasonality: Last year
    const seasonalStart = new Date(targetStart)
    seasonalStart.setDate(targetStart.getDate() - 364)
    const seasonalEnd = new Date(seasonalStart)
    seasonalEnd.setDate(seasonalStart.getDate() + 7)

    // FETCH DATA
    const { data: history } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', storeId)
        .or(`and(business_date.gte.${formatDateISO(lookbackStart)},business_date.lte.${formatDateISO(lookbackEnd)}),and(business_date.gte.${formatDateISO(seasonalStart)},business_date.lte.${formatDateISO(seasonalEnd)})`)

    if (!history) return 0

    // LOGIC FROM HOOK
    const targetDayIndex = targetDate.getDay() // 0-6

    // Weather Factor (Hardcoded Mock equivalent to 'Clear' for benchmark fairness unless we fetch real history)
    // The legacy model had a bug double counting weather, we will replicate the logic exactly as is?
    // User wants "copy the model". The hook logic has "weatherFactor * finalEventFactor".
    // We will assume Weather=1.0 for fairness in backtesting unless we have historical weather.
    const weatherFactor = 1.0

    // BASE ALGORITHM
    const todayStr = '2099-01-01' // Future, so "isPast" is always true for backtest
    const recentRows = history
        .filter((h: any) => new Date(h.business_date + 'T12:00:00').getDay() === targetDayIndex)
        .filter((h: any) => {
            const isInRange = h.business_date >= formatDateISO(lookbackStart) && h.business_date <= formatDateISO(lookbackEnd)
            const hasSales = Number(h.net_sales) > 100
            // isPast check skipped or assumed true
            return isInRange && hasSales
        })
        .sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())

    const seasonalRow = history
        .filter((h: any) => new Date(h.business_date + 'T12:00:00').getDay() === targetDayIndex)
        .find((h: any) => h.business_date >= formatDateISO(seasonalStart) && h.business_date <= formatDateISO(seasonalEnd))

    // Component 1: Recent Weighted (40/20/15...)
    const weights = [0.40, 0.20, 0.15, 0.10, 0.05, 0.05, 0.03, 0.02]
    let wRecentSales = 0, tWeight = 0

    recentRows.forEach((row: any, idx: number) => {
        if (idx < weights.length) {
            const sales = Number(row.net_sales) || 0
            wRecentSales += sales * weights[idx]
            tWeight += weights[idx]
        }
    })

    const finalRecentSales = tWeight > 0 ? wRecentSales / tWeight : 0

    // Component 2: Seasonal
    const sSales = Number(seasonalRow?.net_sales) || 0

    // Component 3: Trend (DAMPENED)
    let trendFactor = 1.0
    if (recentRows.length >= 6) {
        const firstPeriod = recentRows.slice(0, 2).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 2
        const secondPeriod = recentRows.slice(2, 6).reduce((a: number, b: any) => a + Number(b.net_sales), 0) / 4

        if (secondPeriod > 0) {
            const rawTrend = firstPeriod / secondPeriod
            trendFactor = 1.0 + (rawTrend - 1.0) * 0.5
            trendFactor = Math.max(0.90, Math.min(1.10, trendFactor))
        }
    }

    // Ensemble
    let projSales = 0
    const isSeasonalValid = sSales > 0 && sSales > (finalRecentSales * 0.5)

    if (isSeasonalValid) {
        projSales = (finalRecentSales * 0.7 + sSales * 0.3) * (finalRecentSales > 0 ? trendFactor : 1)
    } else {
        projSales = finalRecentSales * trendFactor
    }

    // Safety Cap (Max 120% of baseline)
    const baselineMax = Math.max(finalRecentSales, sSales)
    if (baselineMax > 0 && projSales > baselineMax * 1.20) {
        projSales = baselineMax * 1.20
    }

    // Apply Factors (Leaving Event Factor as 1.0 for now unless requested)
    projSales = projSales * weatherFactor

    return Math.round(projSales)
}
