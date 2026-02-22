
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

async function debugLaborDiscrepancy() {
    console.log(`Auditing Downey from ${dateStart} to ${dateEnd} using PUNCHES.HOURLY_WAGE`)

    // 1. Fetch Punches with hourly_wage
    const { data: punches } = await supabase
        .from('punches')
        .select('business_date, regular_hours, overtime_hours, hourly_wage, employee_toast_guid')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)

    let totalPunchCost = 0
    let totalPunchesByDate = {}

    punches?.forEach(p => {
        const reg = Number(p.regular_hours) || 0
        const ot = Number(p.overtime_hours) || 0
        const wage = Number(p.hourly_wage) || 0

        const cost = (reg * wage) + (ot * wage * 1.5)
        totalPunchCost += cost

        if (!totalPunchesByDate[p.business_date]) totalPunchesByDate[p.business_date] = 0
        totalPunchesByDate[p.business_date] += cost
    })

    console.log(`\nLabor Cost Sum (Punches Table): $${totalPunchCost.toFixed(2)}`)

    // 2. Fetch Cache
    const { data: cache } = await supabase
        .from('sales_daily_cache')
        .select('business_date, labor_cost')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)

    let totalCacheCost = 0
    cache?.forEach(c => {
        totalCacheCost += Number(c.labor_cost) || 0
    })

    console.log(`Labor Cost Sum (Cache Table): $${totalCacheCost.toFixed(2)}`)
    console.log(`Supervisor/Toast Figure: $19,093.46`)

    console.log(`\nDiscrepancies:`)
    console.log(`Punches vs Toast: $${(totalPunchCost - 19093.46).toFixed(2)}`)
    console.log(`Cache vs Toast: $${(totalCacheCost - 19093.46).toFixed(2)}`)
}

debugLaborDiscrepancy()
