import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
    console.log('📊 Analyzing Drive-Thru orders duration distribution...')
    try {
        const { data, error } = await supabase
            .from('dt_orders')
            .select('id, store_name, duration_seconds, order_number, business_date')
            .not('duration_seconds', 'is', null)

        if (error) throw error

        if (!data || data.length === 0) {
            console.log('No orders found.')
            return
        }

        const total = data.length
        let under15 = 0
        let under30 = 0
        let over10m = 0
        let over15m = 0
        let over30m = 0
        let over60m = 0

        const durations = data.map(o => o.duration_seconds as number)
        durations.sort((a, b) => a - b)

        const sum = durations.reduce((a, b) => a + b, 0)
        const avg = sum / total
        const median = durations[Math.floor(total / 2)]
        const p25 = durations[Math.floor(total * 0.25)]
        const p75 = durations[Math.floor(total * 0.75)]
        const p90 = durations[Math.floor(total * 0.90)]

        console.log(`Total orders analyzed: ${total}`)
        console.log(`Average duration: ${Math.round(avg)}s (${Math.floor(avg/60)}:${Math.round(avg%60).toString().padStart(2, '0')})`)
        console.log(`Median duration: ${median}s`)
        console.log(`25th percentile (P25): ${p25}s`)
        console.log(`75th percentile (P75): ${p75}s`)
        console.log(`90th percentile (P90): ${p90}s`)
        console.log(`Min duration: ${durations[0]}s`)
        console.log(`Max duration: ${durations[durations.length - 1]}s`)

        const storeDurations: Record<string, number[]> = {}
        const extremeSloppyOrders: any[] = []
        const extremeFastOrders: any[] = []

        for (const o of data) {
            const d = o.duration_seconds as number
            if (!storeDurations[o.store_name]) {
                storeDurations[o.store_name] = []
            }
            storeDurations[o.store_name].push(d)

            if (d < 15) {
                under15++
                extremeFastOrders.push(o)
            } else if (d < 30) {
                under30++
            }

            if (d > 3600) {
                over60m++
                extremeSloppyOrders.push(o)
            } else if (d > 1800) {
                over30m++
                extremeSloppyOrders.push(o)
            } else if (d > 900) {
                over15m++
                extremeSloppyOrders.push(o)
            } else if (d > 600) {
                over10m++
            }
        }

        console.log('\n--- OUTLIER SUMMARY ---')
        console.log(`Under 15s (Likely mistakes/aborted): ${under15} (${((under15/total)*100).toFixed(2)}%)`)
        console.log(`Under 30s (Very fast): ${under30} (${((under30/total)*100).toFixed(2)}%)`)
        console.log(`Over 10 min: ${over10m} (${((over10m/total)*100).toFixed(2)}%)`)
        console.log(`Over 15 min: ${over15m} (${((over15m/total)*100).toFixed(2)}%)`)
        console.log(`Over 30 min: ${over30m} (${((over30m/total)*100).toFixed(2)}%)`)
        console.log(`Over 60 min (Forgotten POS tabs): ${over60m} (${((over60m/total)*100).toFixed(2)}%)`)

        console.log('\n--- BY-STORE AVERAGE VS MEDIAN ---')
        for (const [store, sDurs] of Object.entries(storeDurations)) {
            sDurs.sort((a, b) => a - b)
            const sSum = sDurs.reduce((a, b) => a + b, 0)
            const sAvg = sSum / sDurs.length
            const sMedian = sDurs[Math.floor(sDurs.length / 2)]
            const sP90 = sDurs[Math.floor(sDurs.length * 0.90)]
            console.log(`Store: ${store.padEnd(15)} | Count: ${String(sDurs.length).padEnd(4)} | Avg: ${Math.floor(sAvg/60)}:${Math.round(sAvg%60).toString().padStart(2,'0')} (${Math.round(sAvg)}s) | Median: ${Math.floor(sMedian/60)}:${Math.round(sMedian%60).toString().padStart(2,'0')} (${sMedian}s) | P90: ${Math.floor(sP90/60)}:${Math.round(sP90%60).toString().padStart(2,'0')}`)
        }

        console.log('\n--- EXTREME OVER-60M SLOPPY ORDERS EXAMPLE ---')
        extremeSloppyOrders.slice(0, 10).forEach(o => {
            console.log(`- ${o.store_name} | Date: ${o.business_date} | Order #${o.order_number} | duration: ${(o.duration_seconds/60).toFixed(1)} mins`)
        })

        console.log('\n--- EXTREME UNDER-15S ORDERS EXAMPLE ---')
        extremeFastOrders.slice(0, 10).forEach(o => {
            console.log(`- ${o.store_name} | Date: ${o.business_date} | Order #${o.order_number} | duration: ${o.duration_seconds}s`)
        })

    } catch (e: any) {
        console.error(e)
    }
}

main()
