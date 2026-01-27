
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const KNOWN_STORES = [
    'acf15327-54c8-4da4-8d0d-3ac0544dc422', // Rialto
    'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8', // Azusa
    '42ed15a6-106b-466a-9076-1e8f72451f6b', // Norwalk
    'b7f63b01-f089-4ad7-a346-afdb1803dc1a', // Downey
    '475bc112-187d-4b9c-884d-1f6a041698ce', // LA Broadway
    'a83901db-2431-4283-834e-9502a2ba4b3b', // Bell
    '5fbb58f5-283c-4ea4-9415-04100ee6978b', // Hollywood
    '47256ade-2cd4-4073-9632-84567ad9e2c8', // Huntington Park
    '8685e942-3f07-403a-afb6-faec697cd2cb', // LA Central
    '3a803939-eb13-4def-a1a4-462df8e90623', // La Puente
    '80a1ec95-bc73-402e-8884-e5abbe9343e6', // Lynwood
    '3c2d8251-c43c-43b8-8306-387e0a4ed7c2', // Santa Ana
    '9625621e-1b5e-48d7-87ae-7094fab5a4fd', // Slauson
    '95866cfc-eeb8-4af9-9586-f78931e1ea04', // South Gate
    '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'  // West Covina
]

async function checkHealth() {
    console.log(`🏥 Starting DATA HEALTH CHECK (2025-2026)`)

    // 1. Check Row Counts per Year per Store
    console.log(`\n📊 Analyzing Row Consistency...`)
    const { data: counts, error } = await supabase.rpc('execute_sql', {
        query: `
            SELECT 
                store_id,
                EXTRACT(YEAR FROM business_date) as year,
                COUNT(*) as days_logged,
                SUM(CASE WHEN net_sales = 0 THEN 1 ELSE 0 END) as zero_sales_days
            FROM sales_daily_cache
            WHERE business_date >= '2025-01-01'
            GROUP BY store_id, year
            ORDER BY store_id, year DESC;
        `
    })

    if (error) {
        // Fallback if RPC not available (which we know it is now, but safe fallback logic)
        // Actually we confirmed RPC works via MCP previously, but here we run local script.
        // Wait, local script CANNOT run RPC 'execute_sql' unless it's exposed. 
        // We should use standard query.
        console.log("⚠️ RPC execute_sql not accessible from client, using iterative store check (accurate)...")

        for (const storeId of KNOWN_STORES) {
            const { count } = await supabase
                .from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .eq('store_id', storeId)
                .gte('business_date', '2025-01-01')
                .lte('business_date', '2025-12-31')

            const { count: zeros } = await supabase
                .from('sales_daily_cache')
                .select('*', { count: 'exact', head: true })
                .eq('store_id', storeId)
                .gte('business_date', '2025-01-01')
                .lte('business_date', '2025-12-31')
                .eq('net_sales', 0)

            printStat(storeId, '2025', count || 0, zeros || 0)
        }
        return
    }

    if (counts) {
        counts.forEach((r: any) => printStat(r.store_id, r.year, r.days_logged, r.zero_sales_days))
    }
}

function printStat(storeId: string, year: string, count: number, zeros: number) {
    const storeShort = storeId.slice(0, 8)
    // Expected days in 2025: 365. In 2026 (so far): ~26
    const expected = year === '2026' ? 26 : 365
    const health = count >= (expected - 2) ? '✅' : '⚠️'
    const quality = zeros === 0 ? '💎' : zeros < 5 ? '⚠️' : '❌'

    console.log(`${health} Store ${storeShort} [${year}]: ${count}/${expected} days. Zeros: ${zeros} ${quality}`)
}

checkHealth()
