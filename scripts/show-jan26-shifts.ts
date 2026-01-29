
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const WEEK_START = '2026-01-26'
const WEEK_END = '2026-02-01'

async function showShifts() {
    // Fetch Shifts
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', WEEK_START)
        .lte('shift_date', WEEK_END)
        .order('shift_date', { ascending: true })
        .limit(20) // Show first 20

    // Fetch Employees involved
    const empIds = [...new Set(shifts?.map(s => s.employee_id))]
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('*')
        .in('id', empIds)

    console.log(`\n📋 MUESTRA DE TURNOS (BD) - Semana ${WEEK_START}\n`)
    console.log("Fecha       | Hora Inicio      | Hora Fin         | Duración | Empleado")
    console.log("-".repeat(85))

    shifts?.forEach(s => {
        const emp = employees?.find(e => e.id === s.employee_id)
        const name = emp ? `${emp.first_name} ${emp.last_name}` : `UNKNOWN (${s.employee_id.substring(0, 6)}...)`

        const start = new Date(s.start_time)
        const end = new Date(s.end_time)
        const duration = ((end.getTime() - start.getTime()) / 3600000).toFixed(1) + 'h'

        // Format time strictly
        const timeStr = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) // Shifts usually stored in UTC or naive? App uses UTC offset usually.
        // Assuming stored as ISO with offset correct, check raw output.
        // Let's print raw Date info first to handle timezone visually.

        const dateStr = s.shift_date
        const tStart = start.toISOString().substring(11, 16)
        const tEnd = end.toISOString().substring(11, 16)

        console.log(`${dateStr}  | ${tStart}            | ${tEnd}            | ${duration.padEnd(8)} | ${name}`)
    })
    console.log("-".repeat(85))
    console.log(`... y ${Math.max(0, (shifts?.length || 0) - 20)} más.`)
}

showShifts()
