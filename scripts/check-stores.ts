import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkStores() {
  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('*');

  console.log('Stores error:', error);
  console.log(`Total stores: ${stores?.length}`);
  for (const s of (stores || [])) {
    console.log(s);
  }
}

checkStores().catch(console.error);
