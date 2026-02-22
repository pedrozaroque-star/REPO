
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { subYears } from 'date-fns'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const storeId = '8685e942-3f07-403a-afb6-faec697cd2cb'
const targetDateStr = '2026-02-19'

async function debugIntelligence() {
    const targetDate = new Date(targetDateStr + 'T12:00:00')
    const compDays: string[] = []
    const yearsBack = 3
    for (let i = 1; i <= yearsBack; i++) {
        const d = new Date(targetDate)
        d.setDate(d.getDate() - (i * 364))
        compDays.push(d.toISOString().split('T')[0])
    }

    console.log('Comp Days (Historical):', compDays)

    const { data: historyPoints } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales, hourly_data')
        .eq('store_id', storeId)
        .in('business_date', compDays)

    console.log('History Points found:', historyPoints?.length)
    if (historyPoints) {
        historyPoints.forEach(p => console.log(` - ${p.business_date}: $${p.net_sales}`))
    }

    // Recent trend data (Last 35 days)
    const trendStartDate = new Date(targetDate)
    trendStartDate.setDate(trendStartDate.getDate() - 35)

    const { data: recentTrendData } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', storeId)
        .gte('business_date', trendStartDate.toISOString().split('T')[0])
        .lt('business_date', targetDateStr)

    console.log('Recent sequence (Last 35 days) found:', recentTrendData?.length)

    // Specific Weekday Trend
    const targetDayOfWeek = targetDate.getUTCDay()
    const recentSameWeekdays = recentTrendData?.filter(d => new Date(d.business_date).getUTCDay() === targetDayOfWeek)
    console.log('Recent Same Weekdays (Thursdays):')
    recentSameWeekdays?.forEach(d => console.log(` - ${d.business_date}: $${d.net_sales}`))

    const avgRecent = (recentSameWeekdays?.reduce((a, b) => a + b.net_sales, 0) || 0) / (recentSameWeekdays?.length || 1)
    const avgHist = (historyPoints?.reduce((a, b) => a + b.net_sales, 0) || 0) / (historyPoints?.length || 1)

    const specificTrendFactor = avgRecent / avgHist
    console.log(`Avg Recent: $${avgRecent.toFixed(2)}`)
    console.log(`Avg Hist: $${avgHist.toFixed(2)}`)
    console.log(`Specific Trend Factor: ${specificTrendFactor.toFixed(4)}`)

    // Global Trend (28 days)
    const dRecentStart = new Date(targetDate)
    dRecentStart.setDate(dRecentStart.getDate() - 28)
    const dRecentEnd = new Date(targetDate)
    dRecentEnd.setDate(dRecentEnd.getDate() - 1)

    const dLastYearStart = new Date(dRecentStart)
    dLastYearStart.setDate(dLastYearStart.getDate() - 364)
    const dLastYearEnd = new Date(dRecentEnd)
    dLastYearEnd.setDate(dLastYearEnd.getDate() - 364)

    const salesRecent28 = recentTrendData?.filter(d => d.business_date >= dRecentStart.toISOString().split('T')[0] && d.business_date <= dRecentEnd.toISOString().split('T')[0])
    const { data: salesLastYear28 } = await supabase
        .from('sales_daily_cache')
        .select('net_sales')
        .eq('store_id', storeId)
        .gte('business_date', dLastYearStart.toISOString().split('T')[0])
        .lte('business_date', dLastYearEnd.toISOString().split('T')[0])

    const sumRecent28 = salesRecent28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const sumLastYear28 = salesLastYear28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const globalGrowth = sumRecent28 / (sumLastYear28 || 1)
    console.log(`Global Growth (28d): ${globalGrowth.toFixed(4)} (Recent: $${sumRecent28.toFixed(0)}, LY: $${sumLastYear28.toFixed(0)})`)

    let growthFactorSales = (specificTrendFactor * 0.7) + (globalGrowth * 0.3)
    console.log(`Final Growth Factor (Raw): ${growthFactorSales.toFixed(4)}`)
    growthFactorSales = Math.min(Math.max(growthFactorSales, 0.85), 1.40)
    console.log(`Final Growth Factor (Capped): ${growthFactorSales.toFixed(4)}`)

    // Weighting History sales
    let totalWeight = 0
    let weightedSales = 0
    historyPoints?.forEach(pt => {
        const ptDate = new Date(pt.business_date)
        const diffYears = Math.round((targetDate.getTime() - ptDate.getTime()) / (1000 * 60 * 60 * 24 * 365))
        let weight = 1
        if (diffYears === 1) weight = 3
        if (diffYears === 2) weight = 2
        totalWeight += weight
        weightedSales += (pt.net_sales * weight)
    })
    const baseSales = totalWeight > 0 ? weightedSales / totalWeight : 0
    console.log(`Base Sales (Historical Weighted): $${baseSales.toFixed(2)}`)

    const projection = baseSales * growthFactorSales
    console.log(`FINAL PROJECTION: $${projection.toFixed(2)}`)
}

debugIntelligence()
