import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
  const dateStr = '2026-05-31'; // Sunday

  // Fetch employees
  const { data: employees } = await supabaseAdmin.from('toast_employees').select('id, chosen_name, first_name');

  const { data } = await supabaseAdmin
    .from('station_assignments')
    .select('*')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr)
    .eq('sub_position', 'Caja 1 / Salón_AM');

  if (data && data.length > 0) {
    const emp = employees.find(e => String(e.id) === String(data[0].employee_id));
    console.log(`${dateStr}: ${emp ? emp.chosen_name || emp.first_name : 'Unknown'}`);
  } else {
    console.log(`${dateStr}: No assignment`);
  }
}

test();
