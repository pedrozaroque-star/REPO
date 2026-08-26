import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkSlausonCurrentWeeks() {
  const { data: cards, error } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, full_name, total_weekly_hours, regular_hours, overtime_hours, sick_hours, vacation_hours')
    .eq('company_id', 328)
    .in('week_id', [154376, 154377]);

  console.log(`Cards for 328 weeks [154376, 154377]: ${cards?.length || 0}`);
  for (const c of (cards || [])) {
    if (c.sick_hours > 0 || c.vacation_hours > 0) {
      console.log(`  [PTO] ${c.full_name} | Week: ${c.week_id} | Sick: ${c.sick_hours} | Vac: ${c.vacation_hours}`);
    }
  }
}

checkSlausonCurrentWeeks().catch(console.error);
