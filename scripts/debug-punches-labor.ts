
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

async function debugPunches() {
    console.log(`Debugging PUNCHES for Downey from ${dateStart} to ${dateEnd}`)

    // 1. Fetch Punches
    const { data: punches } = await supabase
        .from('punches')
        .select('id, employee_toast_guid, regular_hours, overtime_hours, business_date')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)

    // 2. Fetch Employee Wages
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('toast_guid, wage_data, first_name, last_name, job_title')

    const wageMap = {}
    employees?.forEach(e => {
        let wage = 16.0
        if (e.wage_data && Array.isArray(e.wage_data) && e.wage_data.length > 0) {
            wage = Number(e.wage_data[0].wage) || 16.0
        }
        wageMap[e.toast_guid] = { wage, name: `${e.first_name} ${e.last_name}`, title: e.job_title }
    })

    let totalSysCost = 0

    punches?.forEach(p => {
        const emp = wageMap[p.employee_toast_guid] || { wage: 16.0, name: 'Unknown', title: '' }
        const reg = Number(p.regular_hours) || 0
        const ot = Number(p.overtime_hours) || 0
        const cost = (reg * emp.wage) + (ot * emp.wage * 1.5)
        totalSysCost += cost

        if (emp.name === 'Unknown') {
            console.log(`  Unknown Emp Punch: ${p.id} - ${p.business_date}`)
        }
    })

    console.log(`\nSystem Aggregated Labor Cost: $${totalSysCost.toFixed(2)}`)
    console.log(`Supervisor/Toast Figure: $19,093.46`)
    console.log(`Discrepancy: $${(totalSysCost - 19093.46).toFixed(2)}`)
}

debugPunches()
