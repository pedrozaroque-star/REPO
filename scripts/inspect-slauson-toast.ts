import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function inspectSlausonWages() {
  console.log('='.repeat(70));
  console.log('       INSPECCIÓN DE EMPLEADOS TOAST PARA SLAUSON (STORE ID 7)       ');
  console.log('='.repeat(70));

  // Get Slauson Toast employees (store_external_id = '7' or store_id)
  const { data: toastEmps } = await supabaseAdmin
    .from('toast_employees')
    .select('id, external_id, first_name, last_name, email, wage_data, job_references, store_external_id')
    .or('store_external_id.eq.7,store_external_id.eq.328');

  console.log(`Toast employees for Slauson: ${toastEmps?.length || 0}`);
  for (const te of (toastEmps || [])) {
    const w = te.wage_data?.[0]?.wage;
    const j = te.job_references?.[0]?.title || te.job_references?.[0]?.name;
    console.log(
      `${(te.first_name + ' ' + te.last_name).padEnd(30)} | ExternalID: ${String(te.external_id).padEnd(10)} | Wage: $${w} | Job: ${j}`
    );
  }

  // Check ronos_employee_mappings for Slauson
  const { data: mappings } = await supabaseAdmin
    .from('ronos_employee_mappings')
    .select('*')
    .eq('company_id', 328);

  console.log(`\n--- Mappings en Supabase para Slauson (328): ${mappings?.length || 0} ---`);
  for (const m of (mappings || [])) {
    console.log(
      `${m.ronos_employee_name.padEnd(30)} | RonosID: ${String(m.ronos_user_id).padEnd(6)} | Status: ${m.status} | ToastID: ${m.toast_employee_id}`
    );
  }
}

inspectSlausonWages().catch(console.error);
