import dotenv from 'dotenv'
import path from 'path'
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    console.log("📊 Fetching all Drive-Thru orders from dt_orders with pagination...")
    
    let allRows: any[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('dt_orders')
            .select('business_date, store_name, duration_seconds')
            .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) {
            console.error("❌ Error fetching data:", error.message)
            return
        }

        if (data && data.length > 0) {
            allRows = allRows.concat(data)
            if (data.length < pageSize) {
                hasMore = false
            } else {
                page++
            }
        } else {
            hasMore = false
        }
    }

    console.log(`📈 Total orders retrieved: ${allRows.length}`)

    if (allRows.length === 0) {
        console.log("⚠️ No orders found in dt_orders.")
        return
    }

    // Group by business_date and store_name
    const summary: Record<string, Record<string, { total_duration: number; count: number }>> = {}

    for (const r of allRows) {
        const date = r.business_date
        const name = r.store_name
        const dur = r.duration_seconds || 0

        if (!summary[date]) summary[date] = {}
        if (!summary[date][name]) summary[date][name] = { total_duration: 0, count: 0 }

        summary[date][name].total_duration += dur
        summary[date][name].count += 1
    }

    const sortedDates = Object.keys(summary).sort().reverse().slice(0, 7) // Last 7 days in database

    for (const date of sortedDates) {
        console.log(`\n📅 Business Date: ${date}`)
        const storeStats = summary[date]
        const storesRanked = Object.entries(storeStats)
            .map(([name, stat]) => ({
                name,
                count: stat.count,
                avg: Math.round(stat.total_duration / stat.count)
            }))
            .sort((a, b) => a.avg - b.avg)

        storesRanked.forEach((s, idx) => {
            const min = Math.floor(s.avg / 60)
            const sec = String(s.avg % 60).padStart(2, '0')
            console.log(`   ${idx + 1}. ${s.name.padEnd(16)}: ${min}:${sec} (${s.avg}s) | Count: ${s.count}`)
        })
    }
}

run()
