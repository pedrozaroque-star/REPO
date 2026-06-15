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

  console.log(`Checking assignments for ${dateStr}...`)

  // 1. Fetch assignments
  const { data: assignments, error: assErr } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr)

  if (assErr) {
    console.error('Assignments error:', assErr)
    return
  }

  console.log(`Found ${assignments?.length} assignments:`)
  for (const a of assignments || []) {
    // Fetch employee details
    const { data: emp } = await supabase
      .from('toast_employees')
      .select('*')
      .eq('id', a.employee_id)
      .single()

    console.log(`- Employee: ${emp ? emp.first_name + ' ' + emp.last_name : a.employee_id} on sub_position: ${a.sub_position} (main_station: ${a.main_station})`)
  }

  // 2. Fetch position activities
  const { data: posActs } = await supabase
    .from('position_activities')
    .select('*, operating_procedures(*)')
  
  console.log(`\nTotal position activities in DB: ${posActs?.length}`)
}

run()
