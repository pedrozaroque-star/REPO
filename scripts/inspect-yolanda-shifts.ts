import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectShifts() {
    console.log('Inspecting shifts for Yolanda Reza at LA Broadway...')

    // 1. Get Employee ID
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('*')
        .ilike('first_name', '%Yolanda%')
        .ilike('last_name', '%Reza%') // Adjust if name differs

    if (!employees || employees.length === 0) {
        console.log('Employee not found.')
        return
    }
    const emp = employees[0]
    console.log(`Found Employee: ${emp.first_name} ${emp.last_name} (${emp.id})`)

    // 2. Get Shifts for Feb 16-22 2026
    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('employee_id', emp.id)
        .gte('shift_date', '2026-02-16')
        .lte('shift_date', '2026-02-22')
        .order('start_time')

    if (error) {
        console.error('Error fetching shifts:', error)
        return
    }

    console.log('--- RAW SHIFTS ---')
    shifts?.forEach(s => {
        console.log(`ID: ${s.id}`)
        console.log(`  Shift Date (Column): ${s.shift_date}`)
        console.log(`  Start Time (Column): ${s.start_time}`)
        console.log(`  End Time (Column):   ${s.end_time}`)

        // Simulate formatting logic from route.ts
        const startDate = new Date(s.start_time)
        const dayName = startDate.toLocaleDateString('es-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
        const dayNum = startDate.toLocaleDateString('es-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })
        const time = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
        console.log(`  -> Formatted in LA: ${dayName} ${dayNum}, ${time}`)
        console.log('')
    })
}

inspectShifts()
