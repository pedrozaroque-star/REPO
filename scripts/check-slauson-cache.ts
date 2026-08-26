import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkSlausonCache() {
  const { data: cards, error } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, full_name, total_weekly_hours, regular_hours, overtime_hours, sick_hours, vacation_hours')
    .eq('company_id', 328);

  console.log(`Cards for 328: ${cards?.length || 0}`);
  const byW: Record<number, number> = {};
  for (const c of (cards || [])) {
    byW[c.week_id] = (byW[c.week_id] || 0) + 1;
  }
  console.log('Cards by week:', byW);
}

checkSlausonCache().catch(console.error);
