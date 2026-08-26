import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkSlausonToastEmployees() {
  console.log('='.repeat(70));
  console.log('       EMPLEADOS TOAST DE SLAUSON (9625621e-1b5e-48d7-87ae-7094fab5a4fd)      ');
  console.log('='.repeat(70));

  const { data: emps } = await supabaseAdmin
    .from('toast_employees')
    .select('id, first_name, last_name, email, wage_data, job_references, deleted, store_ids')
    .contains('store_ids', ['9625621e-1b5e-48d7-87ae-7094fab5a4fd']);

  console.log(`Total Toast employees in Slauson: ${emps?.length || 0}`);
  for (const e of (emps || [])) {
    const w = e.wage_data?.[0]?.wage;
    const j = e.job_references?.[0]?.title || e.job_references?.[0]?.name;
    console.log(
      `${(e.first_name + ' ' + e.last_name).padEnd(32)} | Deleted: ${e.deleted} | Wage: $${w} | Job: ${j} | Email: ${e.email}`
    );
  }
}

checkSlausonToastEmployees().catch(console.error);
