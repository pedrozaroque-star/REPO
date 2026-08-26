import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkAugustWeeks() {
  console.log('='.repeat(75));
  console.log('       INSPECCIÓN DE SEMANAS DE AGOSTO 2026 EN SUPABASE          ');
  console.log('='.repeat(75));

  for (const cId of [36, 29, 328]) {
    const { data: weeks } = await supabaseAdmin
      .from('ronos_work_weeks')
      .select('*')
      .eq('company_id', cId)
      .gte('start_date', '2026-08-01')
      .lte('start_date', '2026-08-31')
      .order('start_date', { ascending: false });

    console.log(`\nCompany ID: ${cId} (${weeks?.length || 0} semanas en Agosto 2026):`);
    for (const w of (weeks || [])) {
      console.log(`  Week ID: ${w.week_id} | Start: ${w.start_date} | End: ${w.end_date}`);
    }

    const { data: cards } = await supabaseAdmin
      .from('ronos_employee_timecards_cache')
      .select('week_id, total_weekly_hours')
      .eq('company_id', cId);

    const counts: Record<number, { cards: number, hrs: number }> = {};
    for (const c of (cards || [])) {
      if (!counts[c.week_id]) counts[c.week_id] = { cards: 0, hrs: 0 };
      counts[c.week_id].cards++;
      counts[c.week_id].hrs += Number(c.total_weekly_hours || 0);
    }

    console.log('  Tarjetas en caché:', counts);
  }
}

checkAugustWeeks().catch(console.error);
