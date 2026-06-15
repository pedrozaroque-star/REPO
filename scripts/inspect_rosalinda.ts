import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ywwwdcvgfculqmcfkihq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const targetDate = '2026-06-07';

  // 1. Find Rosalinda in employees
  const { data: employees } = await supabase
    .from('toast_employees')
    .select('*')
    .or('first_name.ilike.%Rosalinda%,chosen_name.ilike.%Rosalinda%');

  console.log('Employees matching Rosalinda:', employees);

  if (!employees || employees.length === 0) return;
  const rosalindaId = employees[0].id;

  // 2. Fetch her shifts for that day
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('shift_date', targetDate)
    .eq('employee_id', rosalindaId);

  console.log('\nShifts for Rosalinda on 2026-06-07:', shifts);

  // 3. Fetch her assignments for that day
  const { data: assignments } = await supabase
    .from('station_assignments')
    .select('*')
    .eq('assignment_date', targetDate)
    .eq('employee_id', rosalindaId);

  console.log('\nAssignments for Rosalinda on 2026-06-07:', assignments);
}

test();
