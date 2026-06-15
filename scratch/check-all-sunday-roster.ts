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
  const activeShift = 'AM'

  console.log(`Simulating UI logic for ${dateStr} shift ${activeShift}...`)

  // 1. Fetch employees
  let allEmps: any[] = []
  let page = 0
  const PAGE_SIZE = 1000
  let hasMore = true
  while (hasMore) {
    const { data } = await supabase
      .from('toast_employees')
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    allEmps = [...allEmps, ...data]
    if (data.length < PAGE_SIZE) hasMore = false
    page++
  }

  // 2. Fetch jobs
  const { data: jobs } = await supabase.from('toast_jobs').select('*')

  // 3. Fetch shifts
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', storeId)
    .eq('shift_date', dateStr)

  // 4. Fetch assignments
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr)

  // Filter shifts like page.tsx:
  const getShiftType = (startTime: string) => {
    const startHour = new Date(startTime).getHours();
    return startHour >= 17 ? 'PM' : 'AM';
  };

  const activeShifts = (shifts || []).filter(s => getShiftType(s.start_time) === activeShift);
  console.log(`Active shifts on Sunday AM: ${activeShifts.length}`)

  for (const s of activeShifts) {
    const emp = allEmps.find(e => String(e.id) === String(s.employee_id));
    if (!emp) {
      console.log(`⚠️ Shift employee ID ${s.employee_id} NOT found in employees list!`)
      continue
    }

    const getTitleSafe = (e: any) => {
      const ref = e.job_references?.[0];
      if (!ref) return '';
      const match = (jobs || []).find((j: any) => j.guid === ref.guid || j.id === ref.guid);
      return match?.title || '';
    };

    const jobTitle = getTitleSafe(emp);
    const ass = (assignments || []).find(a => a.assignment_date === dateStr && String(a.employee_id) === String(s.employee_id));
    const shiftStationKey = ass?.sub_position;
    const assignedStationName = shiftStationKey ? shiftStationKey.replace(/_[AP]M$/, '') : '';

    console.log(`- Scheduled: ${emp.chosen_name || emp.first_name} | Job: ${jobTitle} | Assigned Station: ${assignedStationName || 'None'} | Absent: ${s.is_callback === true}`)
  }
}

run()
