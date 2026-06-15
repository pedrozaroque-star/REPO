import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const params = [
  { sql_query: 'SELECT 1 as val;' },
  { query: 'SELECT 1 as val;' },
  { sql: 'SELECT 1 as val;' },
  { query_text: 'SELECT 1 as val;' },
  { sql_text: 'SELECT 1 as val;' },
  { p_query: 'SELECT 1 as val;' },
  { p_sql: 'SELECT 1 as val;' }
];

async function test() {
  console.log('Testing RPC "execute_sql" parameters...');
  for (const p of params) {
    const key = Object.keys(p)[0];
    const { data, error } = await supabase.rpc('execute_sql', p);
    if (!error) {
      console.log(`🎉 SUCCESS! execute_sql works with parameter: ${key}`, data);
      return;
    } else {
      console.log(`Failed for execute_sql with ${key}:`, error.message);
    }
  }

  console.log('\nTesting RPC "exec_sql" parameters...');
  for (const p of params) {
    const key = Object.keys(p)[0];
    const { data, error } = await supabase.rpc('exec_sql', p);
    if (!error) {
      console.log(`🎉 SUCCESS! exec_sql works with parameter: ${key}`, data);
      return;
    } else {
      console.log(`Failed for exec_sql with ${key}:`, error.message);
    }
  }
}

test().catch(console.error);
