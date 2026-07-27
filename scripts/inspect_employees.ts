import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectEmployees() {
  console.log('Inspecting employees tables...')
  
  // Try fetching from employees table
  const { data: empData, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, first_name, last_name, toast_guid, store_id, role')
    .limit(10)

  if (empErr) {
    console.log('employees error:', empErr.message)
  } else {
    console.log(`Found ${empData?.length} rows in employees table:`)
    console.log(empData?.slice(0, 5))
  }

  // Try fetching distinct employees from punches
  const { data: punchData, error: punchErr } = await supabase
    .from('punches')
    .select('employee_toast_guid, employee_name, store_id')
    .limit(10)

  if (punchErr) {
    console.log('punches error:', punchErr.message)
  } else {
    console.log(`Found ${punchData?.length} sample rows in punches:`)
    console.log(punchData?.slice(0, 5))
  }
}

inspectEmployees().catch(console.error)
