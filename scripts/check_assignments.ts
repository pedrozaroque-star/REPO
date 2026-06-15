import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ywwwdcvgfculqmcfkihq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const targetDate = '2026-06-07';
  const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';

  // 1. Fetch all assignments
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('assignment_date', targetDate)
    .eq('store_id', slausonStoreId);

  // 2. Fetch all employees
  const { data: employees } = await supabase
    .from('toast_employees')
    .select('id, first_name, last_name');

  const formatted = assignments?.map(a => {
    const emp = employees?.find(e => e.id === a.employee_id);
    return {
      name: emp ? `${emp.first_name} ${emp.last_name}` : `Unknown ID (${a.employee_id})`,
      station: a.main_station,
      sub_position: a.sub_position
    };
  });

  console.log('Assignments on Slauson for 2026-06-07:', formatted);
}

test();
