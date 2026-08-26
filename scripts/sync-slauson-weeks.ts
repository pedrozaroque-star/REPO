import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getRonosStoreAudit } from '../lib/ronos-api';
import { supabaseAdmin } from '../lib/supabase';

async function syncSlausonWeeks() {
  console.log('='.repeat(70));
  console.log('       SINCRONIZACIÓN FORZADA DE SEMANAS 154376 Y 154377 PARA SLAUSON    ');
  console.log('='.repeat(70));

  console.log('\n1. Sincronizando Semana 154376 (08/10 - 08/16)...');
  const audit1 = await getRonosStoreAudit(328, 154376, true);
  console.log(`  Empleados auditados: ${audit1.employees.length}`);

  console.log('\n2. Sincronizando Semana 154377 (08/17 - 08/23)...');
  const audit2 = await getRonosStoreAudit(328, 154377, true);
  console.log(`  Empleados auditados: ${audit2.employees.length}`);

  // Verificar en Supabase
  const { data: cards } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, employee_name, total_weekly_hours, regular_hours, overtime_hours, sick_hours, vacation_hours')
    .eq('company_id', 328)
    .in('week_id', [154376, 154377]);

  console.log(`\nTarjetas en Supabase para 154376 y 154377: ${cards?.length || 0}`);
  for (const c of (cards || [])) {
    if (c.sick_hours > 0 || c.vacation_hours > 0) {
      console.log(`  [PTO] ${c.employee_name} | Week: ${c.week_id} | Sick: ${c.sick_hours} | Vac: ${c.vacation_hours}`);
    }
  }
}

syncSlausonWeeks().catch(console.error);
