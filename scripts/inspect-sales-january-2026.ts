
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspect2026() {
    const startDate = '2026-01-01'
    const endDate = '2026-01-05'

    console.log(`Inspecting 2026 Cache Data...`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_name, business_date, net_sales, labor_cost')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .limit(20)

    if (data && data.length > 0) {
        console.log(`✅ FOUND ${data.length} records for Jan 2026.`)
        console.table(data.map(r => ({
            Store: r.store_name,
            Date: r.business_date,
            Labor: r.labor_cost
        })))
    } else {
        console.log('❌ NO DATA found for Jan 2026 yet.')
    }
}

inspect2026()
