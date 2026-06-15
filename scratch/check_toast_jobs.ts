import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: jobs, error } = await supabaseAdmin
    .from('toast_jobs')
    .select('*');

  if (error) {
    console.error('❌ Error fetching toast_jobs:', error);
    return;
  }

  console.log('Jobs in toast_jobs table:');
  jobs.forEach(j => {
    console.log(`- ID: ${j.id}, Title: "${j.title}", Code: "${j.code}"`);
  });
}

run();
