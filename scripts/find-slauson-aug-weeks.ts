import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';
import { callRonosApi } from '../lib/ronos-api';

async function findAugust2026SlausonWeeks() {
  console.log('='.repeat(70));
  console.log('       BUSCAR SEMANAS DE AGOSTO 2026 PARA SLAUSON (328)        ');
  console.log('='.repeat(70));

  // 1. Direct call to RONOS API: WorkWeek/GetWeeksByCompany
  const apiWeeks: any = await callRonosApi('WorkWeek/GetWeeksByCompany', {
    companyId: 328
  });

  console.log(`Total semanas devueltas por API: ${Array.isArray(apiWeeks) ? apiWeeks.length : 0}`);
  if (Array.isArray(apiWeeks)) {
    // Filter for August 2026
    const augWeeks = apiWeeks.filter((w: any) => {
      const s = String(w.startDate || w.start_date || '');
      const e = String(w.endDate || w.end_date || '');
      return s.includes('2026-08') || e.includes('2026-08') || s.includes('08/') || e.includes('08/');
    });

    console.log('\nSemanas de Agosto 2026 en API:', augWeeks);

    console.log('\nPrimeras 5 semanas más recientes de la API:');
    for (const w of apiWeeks.slice(0, 5)) {
      console.log(w);
    }
  }
}

findAugust2026SlausonWeeks().catch(console.error);
