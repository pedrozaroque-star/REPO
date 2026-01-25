
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fix2024Tickets() {
    console.log('🔧 Fixing 2024 Tickets (Q1)...')
    const startStr = '2024-01-01'
    const endStr = '2024-03-31'

    // 1. DELETE CACHE for Q1 to force Sales + Tickets re-fetch
    // We leave Punches alone? Punches are in a separate table, so deleting sales_daily_cache is safe for Sales.
    console.log('🧹 Clearing Q1 2024 Sales Cache to force Ticket update...')
    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .gte('business_date', startStr)
        .lte('business_date', endStr)

    if (error) console.error('Delete error:', error)
    else console.log('✅ Cache cleared.')

    // 2. Iterate
    const startDate = new Date(startStr + 'T12:00:00')
    const endDate = new Date(endStr + 'T12:00:00')

    let current = new Date(startDate)

    while (current <= endDate) {
        const dayStr = current.toISOString().split('T')[0]
        console.log(`Processing ${dayStr}...`)

        try {
            // A. Fetch Sales + Tickets (All Stores)
            // Since cache is gone, this will hit API and save hourly_tickets
            const result = await fetchToastData({
                storeIds: 'all',
                startDate: dayStr,
                endDate: dayStr,
                groupBy: 'day'
            })

            process.stdout.write(`  [Sales: ${result.rows.length} Stores] `)

            // B. Sync Punches? 
            // We already did this in previous step, so 'punches' table should be good.
            // But cleaning cache might verify store IDs.
            // Let's just do Sales for speed, assuming Punches are there.
            // Wait, 'calculate-labor-standards' needs both. 
            // If I just fix Sales, Punches remain untouched in 'punches' table. PERFECT.

            console.log(`✅ Done.`)

        } catch (err) {
            console.error(`  ❌ Critical Fail for ${dayStr}:`, err)
        }

        current.setDate(current.getDate() + 1)
        await new Promise(r => setTimeout(r, 200))
    }

    console.log(`🎉 Q1 2024 Repaired.`)
}

fix2024Tickets()
