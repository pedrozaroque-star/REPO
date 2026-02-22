
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

async function findManagerPunches() {
    console.log(`Checking for MANAGER punches in Downey from ${dateStart} to ${dateEnd}`)

    // 1. Fetch Punches
    const { data: punches } = await supabase
        .from('punches')
        .select('*')
        .eq('store_id', storeId)
        .gte('business_date', dateStart)
        .lte('business_date', dateEnd)

    // 2. Fetch Employee Jobs
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('toast_guid, job_title, first_name, last_name')

    const empMap = {}
    employees?.forEach(e => {
        empMap[e.toast_guid] = { title: e.job_title || '', name: `${e.first_name} ${e.last_name}` }
    })

    let managerCost = 0
    let staffCost = 0

    punches?.forEach(p => {
        const emp = empMap[p.employee_toast_guid] || { title: '', name: 'Unknown' }
        const reg = Number(p.regular_hours) || 0
        const ot = Number(p.overtime_hours) || 0
        const wage = Number(p.hourly_wage) || 0
        const cost = (reg * wage) + (ot * wage * 1.5)

        const title = emp.title.toLowerCase()
        const isManager = title.includes('manager') && !title.includes('assist') && !title.includes('asst') && !title.includes('shift')

        if (isManager) {
            managerCost += cost
            console.log(`  Manager Punch: ${emp.name} (${emp.title}) - ${p.business_date} - $${cost.toFixed(2)}`)
        } else {
            staffCost += cost
        }
    })

    console.log(`\nStaff Cost: $${staffCost.toFixed(2)}`)
    console.log(`Manager Cost: $${managerCost.toFixed(2)}`)
    console.log(`Total: $${(staffCost + managerCost).toFixed(2)}`)

    console.log(`\nToast Actual (Supervisor): $19,093.46`)
    if (Math.abs(staffCost - 19093.46) < 10) {
        console.log('MATCH! Toast is excluding managers, and our system matches Toast if we exclude them too.')
    }
}

findManagerPunches()
