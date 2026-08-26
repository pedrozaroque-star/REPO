import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getRonosStoreAudit } from '../lib/ronos-api';
import { supabaseAdmin } from '../lib/supabase';

async function testAuditSlausonDirect() {
  console.log('='.repeat(70));
  console.log('       TEST DIRECTO DE AUDIT SLAUSON CON LOG DE ERROR          ');
  console.log('='.repeat(70));

  const audit = await getRonosStoreAudit(328, 154376, true);
  console.log(`Empleados en auditoría: ${audit.employees.length}`);

  const sample = audit.employees[0];
  console.log('Sample emp:', sample);

  const { data: dbData, error } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id, employee_name, total_weekly_hours')
    .eq('company_id', 328);

  console.log('DB count for 328:', dbData?.length, 'Error:', error);
}

testAuditSlausonDirect().catch(console.error);
