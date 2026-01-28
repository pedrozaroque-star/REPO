
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Config
const START_DATE = '2025-01-01'
const END_DATE = new Date().toISOString().split('T')[0] // Today

async function analyzeEfficiency() {
    console.log(`⛏️  MINING EFFICIENCY DATA (${START_DATE} to ${END_DATE})...`)

    // Fetch ALL valid sales data for the period
    // We need: store_id, business_date, net_sales, labor_hours
    // Filter out: net_sales = 0 or labor_hours = 0 (Closed days or Bad Data)

    let allRows: any[] = []
    let page = 0
    let hasMore = true
    const PAGE_SIZE = 1000

    while (hasMore) {
        console.log(`   fetching page ${page}...`)
        const { data, error } = await supabase
            .from('sales_daily_cache')
            .select('store_id, business_date, net_sales, labor_hours')
            .gte('business_date', START_DATE)
            .lte('business_date', END_DATE)
            .gt('net_sales', 100) // Ignore very low sales (closed/training?)
            .gt('labor_hours', 5) // Ignore ghost shifts
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (error) {
            console.error('Fetch error:', error)
            break
        }

        if (data && data.length > 0) {
            allRows = allRows.concat(data)
            if (data.length < PAGE_SIZE) hasMore = false
            page++
        } else {
            hasMore = false
        }
    }

    console.log(`✅ Loaded ${allRows.length} valid operating days. analyzing...`)

    // Analysis Structure
    // Store -> { TotalSales, TotalHours, Days, AvgSPLH, WeekdayBreakdown }
    const analysis: Record<string, any> = {}

    allRows.forEach(row => {
        const id = row.store_id
        if (!analysis[id]) {
            analysis[id] = {
                totalSales: 0,
                totalHours: 0,
                days: 0,
                byDay: {}, // 0=Sun, 1=Mon...
                rawSplh: [] // To calculate Median later?
            }
            // Init weekdays
            for (let i = 0; i < 7; i++) {
                analysis[id].byDay[i] = { sales: 0, hours: 0, days: 0 }
            }
        }

        const sales = Number(row.net_sales)
        const hours = Number(row.labor_hours)
        const date = new Date(row.business_date)
        // Fix timezone drift? business_date is YYYY-MM-DD
        // new Date('2025-01-01') is UTC. 
        // getUTCDay() 0=Sunday
        const dayOfWeek = date.getUTCDay()

        analysis[id].totalSales += sales
        analysis[id].totalHours += hours
        analysis[id].days++

        // Per Day stats
        analysis[id].byDay[dayOfWeek].sales += sales
        analysis[id].byDay[dayOfWeek].hours += hours
        analysis[id].byDay[dayOfWeek].days++
    })

    // Calculate Final Metrics
    const report: any[] = []

    // We need a map for Store Names if possible, or just use IDs for now
    // Let's try to fetch store names for nicer output
    // (Assuming generic IDs, we'll output ID first)

    Object.keys(analysis).forEach(storeId => {
        const d = analysis[storeId]
        const avgSplh = d.totalSales / d.totalHours

        // Analyze Day Volatility (Variance between Mon vs Fri)
        const dailySplh: any = {}
        let minSplh = 999
        let maxSplh = 0

        for (let i = 0; i < 7; i++) {
            const dayData = d.byDay[i]
            if (dayData.hours > 0) {
                const s = dayData.sales / dayData.hours
                dailySplh[i] = Number(s.toFixed(2))
                if (s < minSplh) minSplh = s
                if (s > maxSplh) maxSplh = s
            }
        }

        report.push({
            store_id: storeId,
            days_analyzed: d.days,
            total_sales_2025_2026: d.totalSales,
            overall_splh: Number(avgSplh.toFixed(2)),
            best_day_splh: Number(maxSplh.toFixed(2)),
            worst_day_splh: Number(minSplh.toFixed(2)),
            volatility: Number(((maxSplh - minSplh) / avgSplh * 100).toFixed(1)) + '%',
            daily_breakdown: dailySplh
        })
    })

    // Sort by Efficiency (Highest SPLH first)
    report.sort((a, b) => b.overall_splh - a.overall_splh)

    // Save to JSON
    const outFile = path.join(process.cwd(), 'scripts', 'mining', 'efficiency-report.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

    console.log(`💎 Analysis Complete. Saved to ${outFile}`)
    console.log('\n🏆 TOP 5 MOST EFFICIENT STORES:')
    report.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. Store ${r.store_id.slice(0, 8)}: $${r.overall_splh}/hr (Vol: ${r.volatility})`)
    })
}

analyzeEfficiency()
