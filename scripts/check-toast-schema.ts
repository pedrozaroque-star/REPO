import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkToastSchema() {
  console.log('='.repeat(70));
  console.log('       INSPECCIÓN DE STORES Y TOAST_EMPLOYEES EN SUPABASE        ');
  console.log('='.repeat(70));

  const { data: stores } = await supabaseAdmin
    .from('stores')
    .select('id, name, external_id, toast_guid');

  console.log('Stores en Supabase:');
  for (const s of (stores || [])) {
    console.log(`  ID: ${s.id} | Name: ${s.name} | ExternalID: ${s.external_id} | ToastGUID: ${s.toast_guid}`);
  }

  // Sample toast_employees
  const { data: emps } = await supabaseAdmin
    .from('toast_employees')
    .select('*')
    .limit(5);

  console.log('\nSample toast_employees row:');
  console.log(emps?.[0]);

  // Check unique values of store identifiers in toast_employees
  const { data: allEmps } = await supabaseAdmin
    .from('toast_employees')
    .select('restaurant_id, first_name, last_name, wage_data')
    .limit(1000);

  console.log(`\nTotal toast_employees fetched: ${allEmps?.length}`);
  const restCounts: Record<string, number> = {};
  for (const e of (allEmps || [])) {
    const r = String((e as any).restaurant_id || (e as any).store_external_id || (e as any).store_id || 'unknown');
    restCounts[r] = (restCounts[r] || 0) + 1;
  }
  console.log('Distribución por restaurant/store identifier:', restCounts);
}

checkToastSchema().catch(console.error);
