import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';
import { getAllToastEmployees, getStoreEmployeeMappings } from '../lib/ronos-api';

async function inspectSlausonToastAndMappings() {
  console.log('='.repeat(70));
  console.log('       INSPECCIÓN DE EMPLEADOS TOAST Y MAPEOS PARA SLAUSON      ');
  console.log('='.repeat(70));

  // 1. Toast employees for Slauson (storeExternalId for Slauson is '7' or store GUID)
  const toastEmployees = await getAllToastEmployees();
  console.log(`Total Toast employees global: ${toastEmployees.length}`);

  // 2. Mappings for Slauson (company_id: 328)
  const mappings = await getStoreEmployeeMappings(328);
  console.log(`Total Mappings for Slauson (328): ${mappings.length}`);

  console.log('\n--- MAPEOS ACTUALES EN SLAUSON ---');
  for (const m of mappings) {
    console.log(
      `${m.ronosEmployeeName.padEnd(28)} | RonosID: ${String(m.ronosUserId).padEnd(6)} | Status: ${m.status} | ToastID: ${String(m.toastEmployeeId).padEnd(6)} | ToastName: ${m.toastEmployeeName} | ToastWage: $${m.toastWageRate}`
    );
  }
}

inspectSlausonToastAndMappings().catch(console.error);
