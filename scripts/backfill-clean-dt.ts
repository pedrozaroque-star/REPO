import dotenv from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { syncDriveThruData } from '../lib/drive-thru-api'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getDatesRange(startStr: string, endStr: string): string[] {
    const dates: string[] = []
    const start = new Date(startStr + 'T12:00:00')
    const end = new Date(endStr + 'T12:00:00')
    
    while (start <= end) {
        dates.push(start.toISOString().split('T')[0])
        start.setDate(start.getDate() + 1)
    }
    return dates
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
    const startDate = '2026-06-01'
    const endDate = '2026-06-26'
    const dates = getDatesRange(startDate, endDate)
    
    console.log(`🧹 Starting historical backfill for Drive-Thru from ${startDate} to ${endDate}`)
    console.log(`Total days to process: ${dates.length}`)
    
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i]
        console.log(`\n--------------------------------------------------`)
        console.log(`📅 [Day ${i + 1}/${dates.length}] Processing Date: ${date}`)
        console.log(`--------------------------------------------------`)
        
        try {
            // 1. Clear existing database records for this date
            console.log(`  Deleting existing records for ${date} in dt_orders...`)
            const { error: errOrders } = await supabase
                .from('dt_orders')
                .delete()
                .eq('business_date', date)
                
            if (errOrders) console.error(`  ⚠️ Warning deleting orders:`, errOrders.message)
            
            console.log(`  Deleting existing records for ${date} in dt_halfhour_stats...`)
            const { error: errStats } = await supabase
                .from('dt_halfhour_stats')
                .delete()
                .eq('business_date', date)
                
            if (errStats) console.error(`  ⚠️ Warning deleting stats:`, errStats.message)
            
            // 2. Fetch and import clean data using the new filter
            console.log(`  Running syncDriveThruData(${date})...`)
            const result = await syncDriveThruData(date)
            console.log(`  ✅ Date completed. Stored: ${result.stored} orders, Stats: ${result.stats} slots. Errors: ${result.errors.length}`)
            
            if (result.errors.length > 0) {
                console.error(`  ❌ Errors reported:`, result.errors)
            }
            
            // Wait 1.5s between days to respect rate limits
            await sleep(1500)
            
        } catch (err: any) {
            console.error(`  ❌ Error processing date ${date}:`, err.message || err)
        }
    }
    
    console.log('\n🎉 Backfill completed successfully!')
}

main()
