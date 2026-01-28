
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // Lynwood
const TEST_DATE = '2025-08-15' // A Friday

async function debug() {
    console.log(`Debug Data for ${TEST_DATE}`)

    // 1. Sales
    const { data: sales } = await supabase
        .from('sales_daily_cache')
        .select('hourly_data')
        .eq('store_id', STORE_ID)
        .eq('business_date', TEST_DATE)
        .single()

    console.log('Hourly Sales 19:00:', sales?.hourly_data['19'])

    // 2. Punches
    const { data: punches } = await supabase
        .from('punches')
        .select('business_date, clock_in, clock_out, job_toast_guid')
        .eq('store_id', STORE_ID)
        .eq('business_date', TEST_DATE) // Assume business_date aligns

    console.log(`Found ${punches?.length} punches for this business date.`)

    // 3. Inspect Timestamps
    if (punches && punches.length > 0) {
        console.log('--- Sample Punch 1 ---')
        const p = punches[0]
        console.log('Raw Clock In:', p.clock_in)

        // Test Conversion
        const toLocalHour = (dStr: string) => {
            const d = new Date(dStr)
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles',
                hour: 'numeric',
                hour12: false
            }).formatToParts(d)
            const hPart = parts.find(x => x.type === 'hour')
            return hPart ? parseInt(hPart.value) : -1
        }

        console.log('Local Hour In:', toLocalHour(p.clock_in))
        console.log('Local Hour Out:', p.clock_out ? toLocalHour(p.clock_out) : 'NULL')

        // Check 19:00 Overlap
        let activeAt19 = 0
        punches.forEach(x => {
            if (!x.clock_out) return
            const inH = toLocalHour(x.clock_in)
            const outH = toLocalHour(x.clock_out)

            // Logic replication
            let isWorking = false
            if (outH < inH) {
                if (19 >= inH || 19 < outH) isWorking = true
            } else {
                if (19 >= inH && 19 < outH) isWorking = true
            }

            if (isWorking) activeAt19++
        })
        console.log(`Active at 19:00 according to logic: ${activeAt19}`)
    }
}

debug()
