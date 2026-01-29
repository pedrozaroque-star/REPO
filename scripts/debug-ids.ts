
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_NAME = 'Enrique'

async function debugIds() {
    console.log("🕵️ ID MISMATCH DETECTIVE")

    // 1. Get Enrique from Employee Table
    const { data: emps } = await supabase.from('toast_employees').select('*').ilike('first_name', `%${TARGET_NAME}%`)
    const enrique = emps?.find(e => e.last_name.includes('Navarrete'))

    if (!enrique) { console.log("Enrique not found in DB"); return }

    console.log(`\nEMPLOYEE TABLE:`)
    console.log(`Name: ${enrique.first_name} ${enrique.last_name}`)
    console.log(`Supabase ID:    ${enrique.id}`)
    console.log(`Toast GUID:     ${enrique.guid}`)

    // 2. Get Shifts for Enrique (Logic: How did we find them before? By Filtering employee_id = ID!)
    // Wait, debug-enrique.ts worked perfectly using `eq('employee_id', emp.id)`.
    // So the shifts DO use the Supabase ID.

    const { data: shifts } = await supabase.from('shifts')
        .select('id, employee_id, start_time')
        .eq('store_id', LYNWOOD_GUID)
        .eq('employee_id', enrique.id)
        .limit(1)

    console.log(`\nSHIFTS TABLE:`)
    if (shifts && shifts.length > 0) {
        console.log(`Shift ID:       ${shifts[0].id}`)
        console.log(`Shift emp_id:   ${shifts[0].employee_id}`)
        console.log(`Match?          ${shifts[0].employee_id === enrique.id ? '✅ YES' : '❌ NO'}`)
    } else {
        console.log("⚠️ No shifts found using Supabase ID.")
    }
}

debugIds()
