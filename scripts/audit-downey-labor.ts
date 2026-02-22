
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const storeId = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'
const dateStart = '2026-02-09'
const dateEnd = '2026-02-15'

async function auditLabor() {
    console.log(`Auditing Downey (${storeId}) from ${dateStart} to ${dateEnd}`)

    const { data: cacheData, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)
        .order('business_date', { ascending: true })

    if (error) {
        console.error('Error fetching cache data:', error)
        return
    }

    if (!cacheData || cacheData.length === 0) {
        console.log('No data found in sales_daily_cache for these dates.')
        return
    }

    let totalSales = 0
    let totalLabor = 0
    let totalHours = 0

    console.log('\nDaily Breakdown:')
    console.log('Date | Sales | Labor $ | Labor % | Hours')
    console.log('-------------------------------------------')

    cacheData.forEach(row => {
        const sales = Number(row.net_sales) || 0
        const labor = Number(row.labor_cost) || 0
        const hours = Number(row.labor_hours) || 0
        const pct = sales > 0 ? (labor / sales) * 100 : 0

        totalSales += sales
        totalLabor += labor
        totalHours += hours

        console.log(`${row.business_date} | $${sales.toLocaleString()} | $${labor.toLocaleString()} | ${pct.toFixed(2)}% | ${hours.toFixed(1)}h`)
    })

    const totalPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0
    console.log('-------------------------------------------')
    console.log(`TOTAL | $${totalSales.toLocaleString()} | $${totalLabor.toLocaleString()} | ${totalPct.toFixed(2)}% | ${totalHours.toFixed(1)}h`)
    console.log(`\nDiscrepancy Analysis:`)
    console.log(`Supervisor Toast: $19,093.46 (22.53%)`)
    console.log(`System Total: $${totalLabor.toFixed(2)} (${totalPct.toFixed(2)}%)`)
    console.log(`Difference: $${(totalLabor - 19093.46).toFixed(2)}`)
}

auditLabor()
