import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data, error } = await supabaseAdmin
    .from('position_activities')
    .select('position_key');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const keys = new Set();
  data.forEach(item => {
    keys.add(item.position_key);
  });

  console.log("Distinct position_key in position_activities:", Array.from(keys));
}

test();
