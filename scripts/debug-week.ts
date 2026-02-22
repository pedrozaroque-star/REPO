
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const storeId = '8685e942-3f07-403a-afb6-faec697cd2cb'

async function debugDay(dateStr: string) {
    const targetDate = new Date(dateStr + 'T12:00:00')
    const targetDayOfWeek = targetDate.getUTCDay()

    // Base History (Weighted)
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
        let weight = 1; if (diffYears === 1) weight = 3; if (diffYears === 2) weight = 2
        totalWeight += weight; weightedSales += (pt.net_sales * weight); sumHist += pt.net_sales
    })
    const baseSales = weightedSales / totalWeight
    const avgHist = sumHist / (historyPoints?.length || 1)

    // Specific Factor
    const trendStartDate = new Date(targetDate); trendStartDate.setDate(trendStartDate.getDate() - 35)
    const { data: recentTrendData } = await supabase.from('sales_daily_cache').select('business_date, net_sales').eq('store_id', storeId).gte('business_date', trendStartDate.toISOString().split('T')[0]).lt('business_date', dateStr)
    const recentSameWeekdays = recentTrendData?.filter(d => new Date(d.business_date).getUTCDay() === targetDayOfWeek)
    const avgRecent = (recentSameWeekdays?.reduce((a, b) => a + b.net_sales, 0) || 0) / (recentSameWeekdays?.length || 1)
    const specificFactor = avgRecent / avgHist

    // Global
    const dRecentStart = new Date(targetDate); dRecentStart.setDate(dRecentStart.getDate() - 28)
    const dRecentEnd = new Date(targetDate); dRecentEnd.setDate(dRecentEnd.getDate() - 1)
    const dLYStart = new Date(dRecentStart); dLYStart.setDate(dLYStart.getDate() - 364)
    const dLYEnd = new Date(dRecentEnd); dLYEnd.setDate(dLYEnd.getDate() - 364)
    const salesRecent28 = recentTrendData?.filter(d => d.business_date >= dRecentStart.toISOString().split('T')[0] && d.business_date <= dRecentEnd.toISOString().split('T')[0])
    const { data: salesLY28 } = await supabase.from('sales_daily_cache').select('net_sales').eq('store_id', storeId).gte('business_date', dLYStart.toISOString().split('T')[0]).lte('business_date', dLYEnd.toISOString().split('T')[0])
    const sumR = salesRecent28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const sumLY = salesLY28?.reduce((a, b) => a + b.net_sales, 0) || 0
    const globalGrowth = sumR / (sumLY || 1)

    const rawGF = (specificFactor * 0.7) + (globalGrowth * 0.3)
    const cappedGF = Math.min(Math.max(rawGF, 0.85), 1.40)

    console.log(`${dateStr} | Base: ${baseSales.toFixed(0)} | Spec: ${specificFactor.toFixed(2)} | Glob: ${globalGrowth.toFixed(2)} | Raw: ${rawGF.toFixed(2)} | Proj: ${(baseSales * cappedGF).toFixed(0)}`)
}

async function run() {
    console.log('Date       | Base  | Spec | Glob | Raw  | Proj')
    console.log('-----------|-------|------|------|------|------')
    await debugDay('2026-02-16')
    await debugDay('2026-02-17')
    await debugDay('2026-02-18')
    await debugDay('2026-02-19')
    await debugDay('2026-02-20')
    await debugDay('2026-02-21')
    await debugDay('2026-02-22')
}

run()
