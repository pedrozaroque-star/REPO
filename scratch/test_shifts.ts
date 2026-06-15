import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const dateStr = '2026-06-07';
  
  const { data: shifts, error: shiftsErr } = await supabase
    .from('shifts')
    .select('id, employee_id, start_time, end_time, is_callback, shift_date')
    .eq('shift_date', dateStr);
    
  if (shiftsErr) {
    console.error('Shifts error:', shiftsErr);
    return;
  }
  
  const { data: emps, error: empsErr } = await supabase
    .from('toast_employees')
    .select('id, first_name, last_name');
    
  if (empsErr) {
    console.error('Employees error:', empsErr);
    return;
  }

  const empMap = new Map(emps?.map(e => [String(e.id), e]));

  console.log(`\n--- SHIFTS ON ${dateStr} ---`);
  const result = (shifts || []).map(s => {
    const emp = empMap.get(String(s.employee_id));
    return {
      name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      start_time: s.start_time,
      end_time: s.end_time,
      is_callback: s.is_callback,
      shift_date: s.shift_date
    };
  });
  
  console.log(JSON.stringify(result, null, 2));
}

test();
