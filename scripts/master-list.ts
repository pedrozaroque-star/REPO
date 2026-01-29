
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

const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

async function listAll() {
    console.log(`📋 LISTA MAESTRA DE EMPLEADOS EN BD (Semana ${TARGET_WEEK})\n`)

    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    if (!shifts) return

    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: emps } = await supabase.from('toast_employees').select('*').in('id', empIds)

    const list: any[] = []
    let total = 0

    emps?.forEach(e => {
        // Exclude hard deletes and known names
        if (e.deleted_at && e.deleted_at.length > 5) return
        const name = (e.first_name + ' ' + e.last_name).toLowerCase()
        if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return

        const empShifts = shifts.filter(s => s.employee_id === e.id)
        let hours = 0
        empShifts.forEach(s => hours += calcDuration(s))

        if (hours > 0) {
            list.push({ Name: `${e.first_name} ${e.last_name}`, Hours: hours })
            total += hours
        }
    })

    list.sort((a, b) => b.Hours - a.Hours)
    console.table(list)
    console.log(`TOTAL: ${total.toFixed(1)}`)
}

listAll()
