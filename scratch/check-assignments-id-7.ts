import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data, error } = await supabaseAdmin
    .from('station_assignments')
    .select('*')
    .eq('store_id', '7');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log("Assignments count in DB with store_id='7':", data.length);
}

test();
