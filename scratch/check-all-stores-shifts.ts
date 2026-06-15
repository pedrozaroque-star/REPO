import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
  const dateStr = '2026-06-07' // Sunday
  const activeShift = 'AM'

  // Get all stores
  const { data: stores } = await supabase.from('stores').select('*')

  console.log(`Checking stores for Sunday AM (${dateStr}):`)

  for (const s of stores || []) {
    // Shifts
    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, start_time')
      .eq('store_id', s.external_id)
      .eq('shift_date', dateStr)

    const getShiftType = (startTime: string) => {
      const startHour = new Date(startTime).getHours();
      return startHour >= 17 ? 'PM' : 'AM';
    };

    const amShifts = (shifts || []).filter(sh => getShiftType(sh.start_time) === activeShift)

    // Assignments
    const { data: assignments } = await supabase
      .from('station_assignments')
      .select('id, sub_position')
      .eq('store_id', s.external_id)
      .eq('assignment_date', dateStr)

    const amAssignments = (assignments || []).filter(a => a.sub_position.endsWith('_AM'))

    console.log(`- Store ID: ${s.id} | Name: ${s.name} | AM Shifts: ${amShifts.length} | AM Assignments: ${amAssignments.length}`)
  }
}

run()
