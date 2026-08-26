import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';
import { getRonosWeeks } from '../lib/ronos-api';

async function checkSlausonWeeks() {
  console.log('='.repeat(70));
  console.log('           INSPECCIÓN DE SEMANAS DE SLAUSON (ID: 328)           ');
  console.log('='.repeat(70));

  // 1. Check API work weeks for 328
  const apiWeeks = await getRonosWeeks(328);
  console.log('\n--- Semanas devueltas por RONOS API para Slauson (328) ---');
  for (const w of apiWeeks.slice(0, 10)) {
    console.log(`  ID: ${w.id} | Name: ${w.name} | Period: ${w.startDate} -> ${w.endDate} | Current: ${w.isCurrent}`);
  }

  // 2. Check Supabase cached timecards for Slauson
  const { data: dbCards } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, employee_name, total_weekly_hours, regular_hours, overtime_hours, sick_hours')
    .eq('company_id', 328);

  console.log(`\n--- Tarjetas en Supabase para Slauson (Total: ${dbCards?.length || 0}) ---`);
  const countByWeek: Record<number, { count: number, totalHrs: number }> = {};
  for (const card of (dbCards || [])) {
    if (!countByWeek[card.week_id]) {
      countByWeek[card.week_id] = { count: 0, totalHrs: 0 };
    }
    countByWeek[card.week_id].count++;
    countByWeek[card.week_id].totalHrs += Number(card.total_weekly_hours || 0);
  }

  for (const [wId, stats] of Object.entries(countByWeek)) {
    console.log(`  Semana ${wId}: ${stats.count} tarjetas, ${stats.totalHrs.toFixed(2)} horas`);
  }
}

checkSlausonWeeks().catch(console.error);
