
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

async function inspectJanuary() {
    const startDate = '2025-01-01'
    const endDate = '2025-01-05'

    console.log(`Inspecting Early January Sales (checking backfill completion)...`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_name, business_date, net_sales, labor_cost')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .limit(20)

    if (data && data.length > 0) {
        console.log(`✅ FOUND ${data.length} records for Jan 1-5.`)
        console.table(data.map(r => ({
            Store: r.store_name,
            Date: r.business_date,
            Labor: r.labor_cost
        })))
    } else {
        console.log('❌ NO DATA found for Jan 1-5 yet.')
    }
}

inspectJanuary()
