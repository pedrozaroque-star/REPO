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
  const dateStr = '2026-06-02' // Tuesday

  console.log(`Checking Tuesday assignments for ${dateStr}...`)

  const { data: assignments, error } = await supabase
    .from('station_assignments')
    .select('*, toast_employees(*)')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Found ${assignments?.length} assignments:`)
  for (const a of assignments || []) {
    console.log(`- Employee: ${a.toast_employees?.first_name} ${a.toast_employees?.last_name} | Sub-position: ${a.sub_position}`)
  }
}

run()
