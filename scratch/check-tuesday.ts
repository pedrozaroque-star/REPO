import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
  const dateStr = '2026-06-02'; // Tuesday

  const { data: assignments, error } = await supabaseAdmin
    .from('station_assignments')
    .select('*')
    .eq('store_id', storeId)
    .eq('assignment_date', dateStr);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Assignments count on ${dateStr}:`, assignments.length);
  console.log(assignments.map(a => `${a.main_station} (${a.sub_position})`));
}

test();
