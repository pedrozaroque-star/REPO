import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabase';

async function test() {
  const { data, error } = await supabaseAdmin
    .from('position_activities')
    .select(`
      *,
      operating_procedures (
        activity,
        frequency
      )
    `)
    .eq('position_key', 'Caja 1 / Salón');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${data.length} mappings for Caja 1 / Salón:`);
  console.log(JSON.stringify(data, null, 2));
}

test();
