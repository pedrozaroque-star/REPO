
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

async function simulatePlannerCalc() {
    console.log(`Simulating Planner calculation for Downey from ${dateStart} to ${dateEnd}`)

    // 1. Fetch Punches
    const { data: punches } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)

    // 2. Fetch Employee Wages
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('toast_guid, wage_data, first_name, last_name')

    const wageMap = {}
    employees?.forEach(e => {
        let wage = 16.0
        if (e.wage_data && Array.isArray(e.wage_data) && e.wage_data.length > 0) {
            wage = Number(e.wage_data[0].wage) || 16.0
        }
        wageMap[e.toast_guid] = wage
    })

    let totalCalculatedCost = 0
    let totalHours = 0

    punches?.forEach(p => {
        const hours = (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0)
        const wage = wageMap[p.employee_toast_guid] || 16.0
        const cost = (Number(p.regular_hours || 0) * wage) + (Number(p.overtime_hours || 0) * wage * 1.5)

        totalCalculatedCost += cost
        totalHours += hours
    })

    console.log(`\nCalculated Total (Estimated like Planner): $${totalCalculatedCost.toFixed(2)}`)
    console.log(`Actual Total (from Toast Cache): $19,093.42`)
    console.log(`Difference: $${(totalCalculatedCost - 19093.42).toFixed(2)}`)

    if (Math.abs(totalCalculatedCost - 19791) < 100) {
        console.log('\nMATCH! The discrepancy is likely because the Planner is overwriting correct Toast data with an estimation from punches.')
    }
}

simulatePlannerCalc()
