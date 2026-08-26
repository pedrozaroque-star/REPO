import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkSlausonSupabase() {
  console.log('='.repeat(70));
  console.log('           INSPECCIÓN DE SEMANAS DE SLAUSON EN SUPABASE         ');
  console.log('='.repeat(70));

  const { data: dbWeeks } = await supabaseAdmin
    .from('ronos_work_weeks')
    .select('*')
    .eq('company_id', 328)
    .order('start_date', { ascending: false });

  console.log('Semanas en ronos_work_weeks para Slauson (328):', dbWeeks);

  const { data: dbCards } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, employee_name, total_weekly_hours, regular_hours, overtime_hours, sick_hours')
    .eq('company_id', 328);

  console.log(`\nTotal tarjetas en Supabase para Slauson (328): ${dbCards?.length || 0}`);
  const byWeek: Record<number, { count: number, totalHrs: number }> = {};
  for (const c of (dbCards || [])) {
    if (!byWeek[c.week_id]) byWeek[c.week_id] = { count: 0, totalHrs: 0 };
    byWeek[c.week_id].count++;
    byWeek[c.week_id].totalHrs += Number(c.total_weekly_hours || 0);
  }

  console.log('Desglose por week_id:', byWeek);
}

checkSlausonSupabase().catch(console.error);
