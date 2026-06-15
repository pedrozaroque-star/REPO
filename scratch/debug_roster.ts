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
  } catch {
    return 'AM';
  }
};

async function test() {
  const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';
  const targetDate = '2026-06-07';

  // Load shifts
  const { data: weekShifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('store_id', slausonStoreId)
    .gte('shift_date', '2026-06-01')
    .lte('shift_date', '2026-06-07');

  // Load employees
  let allEmps: any[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('toast_employees')
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error || !data) break;
    allEmps = [...allEmps, ...data];
    if (data.length < PAGE_SIZE) hasMore = false;
    page++;
  }

  // Load assignments
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('store_id', slausonStoreId)
    .gte('assignment_date', '2026-06-01')
    .lte('assignment_date', '2026-06-07');

  const todayShifts = (weekShifts || []).filter(s => 
    s.shift_date === targetDate && 
    getShiftFromTime(s.start_time) === 'AM'
  );

  console.log('Today AM shifts count:', todayShifts.length);

  const rosterToday = todayShifts.map(s => {
    const emp = allEmps.find(e => String(e.id) === String(s.employee_id));
    const assignment = (assignments || []).find(a => 
      a.assignment_date === s.shift_date && 
      a.employee_id === s.employee_id && 
      a.sub_position?.endsWith('_AM')
    );
    return {
      shift: s,
      employee: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      isAbsent: s.is_callback === true,
      isAssigned: !!assignment
    };
  });

  console.log('\nRoster Today AM:', rosterToday);
}

test();
