import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data: stores } = await supabaseAdmin.from('stores').select('*');
  const dates = [
    '2026-06-01', // Mon
    '2026-06-02', // Tue
    '2026-06-03', // Wed
    '2026-06-04', // Thu
    '2026-06-05', // Fri
    '2026-06-06', // Sat
    '2026-06-07', // Sun
  ];

  if (!stores) return;

  for (const store of stores) {
    const guid = store.store_guid || store.id;
    console.log(`\nStore: ${store.name} (${guid})`);
    const counts = [];
    for (const dateStr of dates) {
      const { data } = await supabaseAdmin
        .from('station_assignments')
        .select('id')
        .eq('store_id', guid)
        .eq('assignment_date', dateStr);
      counts.push(data?.length || 0);
    }
    console.log(`  Counts (Mon-Sun):`, counts.join(' | '));
  }
}

test();
