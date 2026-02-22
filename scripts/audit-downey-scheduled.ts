
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

async function auditScheduledLabor() {
    console.log(`Auditing SCHEDULED labor for Downey (${storeId}) from ${dateStart} to ${dateEnd}`)

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', storeId)
        .gte('shift_date', dateStart)
        .lte('shift_date', dateEnd)
        .neq('status', 'draft')

    if (error) {
        console.error('Error fetching shifts:', error)
        return
    }

    const { data: employees } = await supabase
        .from('toast_employees')
        .select('id, wage_data, first_name, last_name, job_title')

    const wageMap = {}
    employees?.forEach(e => {
        let wage = 16.0
        if (e.wage_data && Array.isArray(e.wage_data) && e.wage_data.length > 0) {
            wage = Number(e.wage_data[0].wage) || 16.0
        }
        wageMap[e.id] = { wage, title: e.job_title }
    })

    let totalCost = 0
    let totalHours = 0
    let managerCost = 0

    shifts.forEach(s => {
        if (!s.start_time || !s.end_time) return
        const start = new Date(s.start_time)
        const end = new Date(s.end_time)
        let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
        if (diff < 0) diff += 24 // Handle overnight

        const emp = wageMap[s.employee_id] || { wage: 16.0, title: '' }
        const cost = diff * emp.wage

        const title = (emp.title || '').toLowerCase()
        const isManager = title.includes('manager') && !title.includes('assist') && !title.includes('asst') && !title.includes('shift')

        if (isManager) {
            managerCost += cost
        } else {
            totalCost += cost
            totalHours += diff
        }
    })

    console.log(`\nScheduled Total (Excluding Managers): $${totalCost.toFixed(2)}`)
    console.log(`Scheduled Managers: $${managerCost.toFixed(2)}`)
    console.log(`Total Scheduled (Including Managers): $${(totalCost + managerCost).toFixed(2)}`)

    if (Math.abs((totalCost + managerCost) - 19791) < 100) {
        console.log('MATCH! $19,791 is the SCHEDULED labor (Including Managers).')
    } else if (Math.abs(totalCost - 19791) < 100) {
        console.log('MATCH! $19,791 is the SCHEDULED labor (Excluding Managers).')
    }
}

auditScheduledLabor()
