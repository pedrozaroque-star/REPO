
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

async function findZeroWagePunches() {
    console.log(`Checking for ZERO WAGE punches in Downey from ${dateStart} to ${dateEnd}`)

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
        .select('toast_guid, job_title, first_name, last_name, wage_data')

    const empMap = {}
    employees?.forEach(e => {
        let systemWage = 16.0
        if (e.wage_data && Array.isArray(e.wage_data) && e.wage_data.length > 0) {
            systemWage = Number(e.wage_data[0].wage) || 16.0
        }
        empMap[e.toast_guid] = {
            systemWage,
            name: `${e.first_name} ${e.last_name}`,
            title: e.job_title || ''
        }
    })

    let totalImpactOfZeros = 0

    punches?.forEach(p => {
        const emp = empMap[p.employee_toast_guid] || { systemWage: 16.0, name: 'Unknown', title: '' }
        const wage = Number(p.hourly_wage) || 0
        const reg = Number(p.regular_hours) || 0
        const ot = Number(p.overtime_hours) || 0

        if (wage === 0 && (reg > 0 || ot > 0)) {
            const systemCost = (reg * emp.systemWage) + (ot * emp.systemWage * 1.5)
            totalImpactOfZeros += systemCost
            console.log(`  Zero Punch: ${emp.name} (${emp.title}) - ${p.business_date} - ${reg + ot}h -> System assumes $${systemCost.toFixed(2)}`)
        }
    })

    console.log(`\nTotal Impact of Zero Rate Punches: $${totalImpactOfZeros.toFixed(2)}`)
    const totalWithZeros = 19093.46 + totalImpactOfZeros
    console.log(`Estimated System Total: $${totalWithZeros.toFixed(2)}`)

    if (Math.abs(totalWithZeros - 19791) < 10) {
        console.log('MATCH! The discrepancy is exactly because some employees have a 0 rate in Toast (likely sync error or salaried) and the system is assuming $16/hr.')
    }
}

findZeroWagePunches()
