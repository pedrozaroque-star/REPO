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
  const dates = [
    '2026-06-01', // Mon
    '2026-06-02', // Tue
    '2026-06-03', // Wed
    '2026-06-04', // Thu
    '2026-06-05', // Fri
    '2026-06-06', // Sat
    '2026-06-07'  // Sun
  ]

  console.log('Assignments count per day for Slauson:')
  for (const d of dates) {
    const { data } = await supabase
      .from('station_assignments')
      .select('id, sub_position')
      .eq('store_id', storeId)
      .eq('assignment_date', d)

    console.log(`- Date: ${d} | Assignments Count: ${data?.length || 0}`)
  }
}

run()
