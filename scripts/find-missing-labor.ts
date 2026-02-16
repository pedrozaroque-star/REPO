
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

async function findMissingLabor() {
    const startDate = '2025-01-01'
    const endDate = '2025-02-14'

    console.log(`Checking for NULL labor_cost from ${startDate} to ${endDate}...`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('store_name, business_date, net_sales, labor_cost')
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .is('labor_cost', null)
        .gt('net_sales', 0)
        .order('business_date', { ascending: false })

    if (error) {
        console.error('Error fetching data:', error)
        return
    }

    if (!data || data.length === 0) {
        console.log('✅ No entries found with NULL labor cost in this range.')
        return
    }

    console.log(`found ${data.length} entries with NULL labor:`)
    console.table(data.map(r => ({
        Store: r.store_name,
        Date: r.business_date,
        Sales: r.net_sales,
        Labor: r.labor_cost
    })))
}

findMissingLabor()
