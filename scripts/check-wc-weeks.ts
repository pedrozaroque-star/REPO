import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkWCWeeks() {
  const { data: weeks } = await supabaseAdmin
    .from('ronos_work_weeks')
    .select('*')
    .eq('company_id', 36)
    .gte('start_date', '2026-08-01')
    .lte('start_date', '2026-08-31')
    .order('start_date', { ascending: false });

  console.log('West Covina (36) August 2026 weeks:', weeks);
}

checkWCWeeks().catch(console.error);
