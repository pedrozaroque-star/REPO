import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd' // Slauson
  const dateStr = '2026-06-07' // Sunday

  console.log(`Checking shifts for ${dateStr}...`)

  // 1. Fetch shifts
  const { data: shifts, error: shiftsErr } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', storeId)
    .eq('shift_date', dateStr)

  if (shiftsErr) {
    console.error('Shifts error:', shiftsErr)
    return
  }

  console.log(`Found ${shifts?.length} shifts:`)
  for (const s of shifts || []) {
    // Fetch employee details
    const { data: emp } = await supabase
      .from('toast_employees')
      .select('*')
      .eq('id', s.employee_id)
      .single()

    const startHour = new Date(s.start_time).getHours()
    const shiftType = startHour >= 17 ? 'PM' : 'AM'

    console.log(`- Shift: ${emp ? emp.first_name + ' ' + emp.last_name : s.employee_id} | Start: ${s.start_time} | ShiftType: ${shiftType} | Absent: ${s.is_callback === true}`)
  }
}

run()
