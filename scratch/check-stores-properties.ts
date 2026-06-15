import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data, error } = await supabaseAdmin.from('stores').select('*');
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log("Stores in DB:", JSON.stringify(data, null, 2));
}

test();
