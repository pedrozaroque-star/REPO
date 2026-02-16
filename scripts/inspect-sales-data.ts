
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

async function inspectSalesData() {
    const startDate = '2025-02-01' // Inspect a recent range
    const endDate = '2025-02-14'

    console.log(`Inspecting sales_daily_cache from ${startDate} to ${endDate}...`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_name, business_date, net_sales, labor_cost, labor_hours')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date', { ascending: false })
        .limit(50)

    if (error) {
        console.error('Error fetching data:', error)
        return
    }

    if (!data || data.length === 0) {
        console.log('No data found in range.')
        return
    }

    console.table(data.map(r => ({
        Store: r.store_name,
        Date: r.business_date,
        Sales: r.net_sales,
        LaborCost: r.labor_cost,
        LaborHours: r.labor_hours
    })))
}

inspectSalesData()
