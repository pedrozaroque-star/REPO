
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

async function inspectLynwood() {
    const LYNWOOD_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6' // From code map
    const startDate = '2025-01-01'
    const endDate = '2025-01-31'

    console.log(`Inspecting Lynwood Sales/Labor for Jan 2025...`)

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('business_date, net_sales, labor_cost')
        .eq('store_id', LYNWOOD_ID)
        .gte('business_date', startDate)
        .lte('business_date', endDate)
        .order('business_date', { ascending: true })

    if (error) {
        console.error(error)
        return
    }

    if (!data || data.length === 0) {
        console.log('❌ NO DATA for Lynwood in Jan.')
        return
    }

    console.log(`✅ Found ${data.length} days for Lynwood.`)

    let totalSales = 0
    let totalLabor = 0
    let missingLaborDays = 0

    const table = data.map(r => {
        totalSales += r.net_sales
        totalLabor += r.labor_cost
        if (r.labor_cost === 0) missingLaborDays++
        return {
            Date: r.business_date,
            Sales: r.net_sales,
            Labor: r.labor_cost
        }
    })

    console.table(table)
    console.log('--------------------------------')
    console.log(`TOTAL SALES: $${totalSales.toLocaleString()}`)
    console.log(`TOTAL LABOR: $${totalLabor.toLocaleString()}`)
    console.log(`MISSING LABOR DAYS: ${missingLaborDays}`)
}

inspectLynwood()
