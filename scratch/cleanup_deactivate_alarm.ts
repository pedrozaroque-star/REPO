import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: procedures, error: procErr } = await supabaseAdmin
    .from('operating_procedures')
    .select('id, activity')
    .ilike('activity', '%Abrir puerta y desactivar alarma%');

  if (procErr || !procedures || procedures.length === 0) {
    console.error('❌ Procedure not found:', procErr);
    return;
  }

  const proc = procedures[0];
  console.log(`Target Activity: "${proc.activity}" (ID: ${proc.id})`);

  // Delete the MANAGER mapping for this activity
  const { data, error } = await supabaseAdmin
    .from('position_activities')
    .delete()
    .eq('activity_id', proc.id)
    .eq('position_key', 'MANAGER');

  if (error) {
    console.error('❌ Error deleting MANAGER mapping:', error);
  } else {
    console.log('✅ Successfully removed MANAGER mapping for this task.');
  }
}

run();
