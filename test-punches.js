require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const {data: stores} = await supabase.from('stores').select('id, name, external_id');
  const downey = stores.find(s => s.name.toLowerCase().includes('downey'));
  console.log('Downey:', downey.name, downey.external_id);

  const {data: punches} = await supabase.from('punches').select('employee_toast_guid, clock_in, store_id').eq('business_date', '2026-04-06').eq('store_id', downey.external_id);
  console.log('Downey punches today:', punches?.length);

  // Maybe the punches are under Downey's INTERNAL ID?
  const {data: punches2} = await supabase.from('punches').select('employee_toast_guid, clock_in, store_id').eq('business_date', '2026-04-06').eq('store_id', downey.id.toString());
  console.log('Downey punches by ID today:', punches2?.length);

  
  const vBell = stores.find(s => s.name.toLowerCase().includes('bell'));
  const {data: punchesBell} = await supabase.from('punches').select('employee_toast_guid, clock_in, store_id').eq('business_date', '2026-04-06').eq('store_id', vBell.external_id);
  console.log('Bell punches today:', punchesBell?.length);
}
check();
