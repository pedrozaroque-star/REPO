import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ywwwdcvgfculqmcfkihq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA';
const supabase = createClient(supabaseUrl, supabaseKey);

const getShiftFromTime = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    const hour = date.getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  } catch (e) {
    return 'AM';
  }
};

const getShiftFromTimeLA = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour');
    const hour = hourPart ? parseInt(hourPart.value, 10) : date.getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  } catch (e) {
    return 'AM';
  }
};

async function test() {
  const targetDate = '2026-06-07';
  const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';

  // Fetch shifts
  const { data: weekShifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', slausonStoreId)
    .eq('shift_date', targetDate);

  // Fetch employees
  const { data: allEmps } = await supabase
    .from('toast_employees')
    .select('*');

  // Fetch jobs
  const { data: jobs } = await supabase.from('toast_jobs').select('*');

  // Fetch assignments
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('assignment_date', targetDate)
    .eq('store_id', slausonStoreId);

  // Emulate filteredEmps
  const ALLOWED_ROLES = ['manager', 'shift', 'cook', 'cocinero', 'cashier', 'cajero', 'prep', 'taquero', 'assistant', 'asst'];
  const shiftEmployeeIds = new Set((weekShifts || [])?.map(s => String(s.employee_id)));

  const filteredEmps = allEmps?.filter((e: any) => {
    if (shiftEmployeeIds.has(String(e.id))) return true;
    if (e.deleted) return false;
    
    let empStoreIds: string[] = [];
    if (Array.isArray(e.store_ids)) empStoreIds = e.store_ids;
    else if (typeof e.store_ids === 'string') {
      try {
        const parsed = JSON.parse(e.store_ids);
        if (Array.isArray(parsed)) empStoreIds = parsed;
      } catch {
        empStoreIds = [e.store_ids];
      }
    }
    if (!empStoreIds.includes(slausonStoreId)) return false;

    const empJobGuids = new Set<string>();
    e.job_references?.forEach((r: any) => empJobGuids.add(r.guid));
    e.wage_data?.forEach((w: any) => empJobGuids.add(w.job_guid));

    let hasAllowedRole = false;
    for (const guid of Array.from(empJobGuids)) {
      const job = jobs?.find(j => j.guid === guid || j.id === guid);
      if (job?.title) {
        const titleLower = job.title.toLowerCase();
        if (ALLOWED_ROLES.some(role => titleLower.includes(role))) {
          hasAllowedRole = true;
          break;
        }
      }
    }
    return hasAllowedRole;
  }) || [];

  console.log(`Loaded ${filteredEmps.length} employees total.`);

  // Test AM shifts using old timezone logic
  console.log('\n--- AM Roster (Old Timezone Logic) ---');
  const todayShiftsOld = weekShifts?.filter(s => getShiftFromTime(s.start_time) === 'AM') || [];
  const rosterTodayOld = todayShiftsOld.map(s => {
    const emp = filteredEmps.find(e => String(e.id) === String(s.employee_id));
    const assignment = assignments?.find(a => 
      a.assignment_date === s.shift_date && 
      a.employee_id === s.employee_id && 
      a.sub_position?.endsWith('_AM')
    );
    return {
      name: emp ? `${emp.first_name} ${emp.last_name}` : `Unknown (${s.employee_id})`,
      isAbsent: s.is_callback === true,
      isAssigned: !!assignment,
      station: assignment?.main_station
    };
  });
  console.log(rosterTodayOld);

  // Test AM shifts using LA timezone logic
  console.log('\n--- AM Roster (LA Timezone Logic) ---');
  const todayShiftsLA = weekShifts?.filter(s => getShiftFromTimeLA(s.start_time) === 'AM') || [];
  const rosterTodayLA = todayShiftsLA.map(s => {
    const emp = filteredEmps.find(e => String(e.id) === String(s.employee_id));
    const assignment = assignments?.find(a => 
      a.assignment_date === s.shift_date && 
      a.employee_id === s.employee_id && 
      a.sub_position?.endsWith('_AM')
    );
    return {
      name: emp ? `${emp.first_name} ${emp.last_name}` : `Unknown (${s.employee_id})`,
      isAbsent: s.is_callback === true,
      isAssigned: !!assignment,
      station: assignment?.main_station
    };
  });
  console.log(rosterTodayLA);
}

test();
