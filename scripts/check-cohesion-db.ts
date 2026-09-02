import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkTables() {
  const { data: integrations, error: intErr } = await supabase.from('integrations').select('*');
  console.log('Integrations in DB:', integrations);

  const { data: stores, error: sErr } = await supabase.from('stores').select('id, name, store_number, toast_guid, quickbooks_class, quickbooks_location');
  console.log('Stores in DB:', stores);

  const { data: diningOpts, error: dErr } = await supabase.from('dining_options_map').select('*').limit(10);
  console.log('Dining options sample:', diningOpts);
}

checkTables().catch(console.error);
