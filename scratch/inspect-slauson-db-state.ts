import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const slausonStoreId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd';
  const targetDate = '2026-06-07';

  console.log(`Fetching Slauson assignments for ${targetDate}...`);
  const { data: assignments, error } = await supabase
    .from('station_assignments')
    .select(`
      *,
      toast_employees (
        first_name,
        last_name,
        chosen_name
      )
    `)
    .eq('store_id', slausonStoreId)
    .eq('assignment_date', targetDate);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${assignments.length} assignments:`);
  assignments.forEach((a: any) => {
    const empName = a.toast_employees ? `${a.toast_employees.chosen_name || a.toast_employees.first_name} ${a.toast_employees.last_name}` : 'UNASSIGNED';
    console.log(`\nSlot: ${a.sub_position} (Main Station: ${a.main_station})`);
    console.log(`Employee: ${empName}`);
    console.log(`Tasks Count: ${a.tasks?.length || 0}`);
    if (a.tasks && a.tasks.length > 0) {
      console.log('Tasks list:');
      a.tasks.forEach((t: string, idx: number) => console.log(`  - ${t}`));
    }
  });
}

test();
