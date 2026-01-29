
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-26'
const TARGET_END = '2026-02-01'

// --- LOGICA EXACTA ---
const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

async function listEmployees() {
    console.log(`🕵️ AUDITORIA DE EMPLEADOS (Semana ${TARGET_WEEK})\n`)

    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    if (!shifts) return

    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: emps } = await supabase.from('toast_employees').select('*').in('id', empIds)

    const report: any[] = []
    let totalH = 0

    emps?.forEach(emp => {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        let hours = 0
        empShifts.forEach(s => hours += calcDuration(s))

        report.push({
            Name: `${emp.first_name} ${emp.last_name}`,
            Hours: hours.toFixed(1),
            Shifts: empShifts.length,
            HomeStore: emp.store_ids?.includes(LYNWOOD_GUID) ? '✅ Lynwood' : '❌ ' + JSON.stringify(emp.store_ids)
        })
        totalH += hours
    })

    // Sort by hours dec
    report.sort((a, b) => Number(b.Hours) - Number(a.Hours))

    console.table(report)
    console.log(`\nTOTAL BACKEND: ${totalH.toFixed(1)} hrs`)
}

listEmployees()
