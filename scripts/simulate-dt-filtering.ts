import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Stats {
    count: number
    avg: number
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

async function main() {
    try {
        const { data, error } = await supabase
            .from('dt_orders')
            .select('store_name, duration_seconds')
            .not('duration_seconds', 'is', null)

        if (error) throw error
        if (!data) return

        const stores = [...new Set(data.map(o => o.store_name))]

        console.log('🧪 DRIVE-THRU OUTLIER FILTERING SIMULATION 🧪\n')
        console.log('Comparing different filtering bounds on Toast Drive-Thru orders:\n')

        const tableData = []

        for (const store of stores) {
            const storeOrders = data.filter(o => o.store_name === store).map(o => o.duration_seconds as number)
            
            // Scenario A: No filtering
            const rawCount = storeOrders.length
            const rawAvg = storeOrders.reduce((a,b)=>a+b, 0) / rawCount

            // Scenario B: Exclude < 15s and > 15m (900s)
            const bOrders = storeOrders.filter(d => d >= 15 && d <= 900)
            const bCount = bOrders.length
            const bAvg = bCount > 0 ? (bOrders.reduce((a,b)=>a+b, 0) / bCount) : 0

            // Scenario C: Exclude < 20s and > 20m (1200s)
            const cOrders = storeOrders.filter(d => d >= 20 && d <= 1200)
            const cCount = cOrders.length
            const cAvg = cCount > 0 ? (cOrders.reduce((a,b)=>a+b, 0) / cCount) : 0

            // Scenario D: Exclude < 30s and > 10m (600s)
            const dOrders = storeOrders.filter(d => d >= 30 && d <= 600)
            const dCount = dOrders.length
            const dAvg = dCount > 0 ? (dOrders.reduce((a,b)=>a+b, 0) / dCount) : 0

            // Median for reference
            const sorted = [...storeOrders].sort((a,b)=>a-b)
            const median = sorted[Math.floor(sorted.length / 2)]

            tableData.push({
                store,
                rawCount,
                rawAvg: formatDuration(rawAvg),
                median: formatDuration(median),
                bCount,
                bAvg: formatDuration(bAvg),
                cCount,
                cAvg: formatDuration(cAvg),
                dCount,
                dAvg: formatDuration(dAvg)
            })
        }

        console.table(tableData)

        console.log('\n--- SCENARIO DETAILS ---')
        console.log('Scenario A (Current): No filtering. Averages are heavily distorted by forgotten open tickets (e.g. 105 mins).')
        console.log('Scenario B: Exclude < 15s and > 15m (900s). Standard filter. Removes POS keying errors and abandoned tickets.')
        console.log('Scenario C: Exclude < 20s and > 20m (1200s). Conservative filter. Keeps longer prep times but cuts extreme outliers.')
        console.log('Scenario D: Exclude < 30s and > 10m (600s). Strict operational filter. Reflects pure high-speed window throughput.')

    } catch (e: any) {
        console.error(e)
    }
}

main()
