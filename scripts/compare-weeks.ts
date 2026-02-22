
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const storeId = '8685e942-3f07-403a-afb6-faec697cd2cb'

async function debugWeek(targetDateStr: string) {
    console.log(`\n--- DEBUGGING ${targetDateStr} ---`)
    const targetDate = new Date(targetDateStr + 'T12:00:00')
    const targetDayOfWeek = targetDate.getUTCDay()

    // Base History
    const compDays: string[] = []
    for (let i = 1; i <= 3; i++) {
        const d = new Date(targetDate)
        d.setDate(d.getDate() - (i * 364))
        compDays.push(d.toISOString().split('T')[0])
    }
    const { data: historyPoints } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', storeId)
        .in('business_date', compDays)

    let totalWeight = 0, weightedSales = 0, sumHist = 0
    historyPoints?.forEach(pt => {
        const ptDate = new Date(pt.business_date)
        const diffYears = Math.round((targetDate.getTime() - ptDate.getTime()) / (1000 * 60 * 60 * 24 * 365))
        let weight = 1
        if (diffYears === 1) weight = 3
        if (diffYears === 2) weight = 2
        totalWeight += weight
        weightedSales += (pt.net_sales * weight)
        sumHist += pt.net_sales
    })
    const baseSales = weightedSales / totalWeight
    const avgHist = sumHist / (historyPoints?.length || 1)

    // Recent same-weekday
    const trendStartDate = new Date(targetDate)
    trendStartDate.setDate(trendStartDate.getDate() - 35)
    const { data: recentTrendData } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales')
        .eq('store_id', storeId)
        .gte('business_date', trendStartDate.toISOString().split('T')[0])
        .lt('business_date', targetDateStr)

    const recentSameWeekdays = recentTrendData?.filter(d => new Date(d.business_date).getUTCDay() === targetDayOfWeek)
    const avgRecent = (recentSameWeekdays?.reduce((a, b) => a + b.net_sales, 0) || 0) / (recentSameWeekdays?.length || 1)
    const specificTrendFactor = avgRecent / avgHist

    // Global
    const dRecentStart = new Date(targetDate); dRecentStart.setDate(dRecentStart.getDate() - 28)
    const dRecentEnd = new Date(targetDate); dRecentEnd.setDate(dRecentEnd.getDate() - 1)
    const dLYStart = new Date(dRecentStart); dLYStart.setDate(dLYStart.getDate() - 364)
    const dLYEnd = new Date(dRecentEnd); dLYEnd.setDate(dLYEnd.getDate() - 364)

    const salesRecent28 = recentTrendData?.filter(d => d.business_date >= dRecentStart.toISOString().split('T')[0] && d.business_date <= dRecentEnd.toISOString().split('T')[0])
    const { data: salesLY28 } = await supabase
        .from('sales_daily_cache')
        .select('net_sales')
        .eq('store_id', storeId)
        .gte('business_date', dLYStart.toISOString().split('T')[0])
        .lte('business_date', dLYEnd.toISOString().split('T')[0])

    const sumR = salesRecent28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const sumLY = salesLY28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const globalGrowth = sumR / (sumLY || 1)

    const rawGF = (specificTrendFactor * 0.7) + (globalGrowth * 0.3)
    const cappedGF = Math.min(Math.max(rawGF, 0.85), 1.40)

    console.log(`Base Sales: $${baseSales.toFixed(0)}`)
    console.log(`Specific Factor: ${specificTrendFactor.toFixed(3)} (Recent Avg: $${avgRecent.toFixed(0)}, Hist Avg: $${avgHist.toFixed(0)})`)
    console.log(`Global Factor: ${globalGrowth.toFixed(3)} (R: $${sumR.toFixed(0)}, LY: $${sumLY.toFixed(0)})`)
    console.log(`Raw GF: ${rawGF.toFixed(3)} -> Capped: ${cappedGF.toFixed(3)}`)
    console.log(`PROJECTION: $${(baseSales * cappedGF).toFixed(0)}`)
}

async function run() {
    await debugWeek('2026-02-05')
    await debugWeek('2026-02-12')
    await debugWeek('2026-02-19')
}

run()
