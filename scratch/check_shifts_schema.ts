import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  // 1. Inspect shifts table schema / columns
  const { data: shifts, error: shiftsErr } = await supabaseAdmin
    .from('shifts')
    .select('*')
    .limit(1);

  if (shiftsErr) {
    console.error('❌ Error fetching shifts:', shiftsErr);
  } else {
    console.log('✅ Shift sample data:', shifts);
  }

  // 2. Inspect station_assignments table
  const { data: assignments, error: assErr } = await supabaseAdmin
    .from('station_assignments')
    .select('*')
    .limit(1);

  if (assErr) {
    console.error('❌ Error fetching assignments:', assErr);
  } else {
    console.log('✅ Assignment sample data:', assignments);
  }
}

run();
