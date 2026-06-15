import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const storeId = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'; // Slauson
  const dates = [
    '2026-06-01', // Monday
    '2026-06-02', // Tuesday
    '2026-06-03', // Wednesday
    '2026-06-04', // Thursday
    '2026-06-05', // Friday
    '2026-06-06', // Saturday
    '2026-06-07', // Sunday
  ];

  for (const dateStr of dates) {
    const { data } = await supabaseAdmin
      .from('station_assignments')
      .select('*')
      .eq('store_id', storeId)
      .eq('assignment_date', dateStr);

    console.log(`Assignments count on ${dateStr}:`, data?.length || 0);
  }
}

test();
