import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error fetching stores:', error);
    return;
  }

  console.log('Store columns and sample data:', stores[0]);
}

run();
