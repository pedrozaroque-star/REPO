import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkStores() {
  const { data: stores, error } = await supabase.from('stores').select('*');
  console.log('Stores error:', error);
  console.log('Stores list:', stores ? stores.map(s => ({ id: s.id, name: s.name, store_number: s.store_number, toast_restaurant_id: s.toast_restaurant_id })) : null);
}

checkStores().catch(console.error);
