import { supabaseAdmin } from '../lib/supabase';

async function run() {
  console.log('Testing RPC calls with query parameter...');
  
  const { data: res1, error: err1 } = await supabaseAdmin.rpc('execute_sql', { query: 'SELECT tablename FROM pg_tables WHERE schemaname = \'public\' LIMIT 5;' });
  console.log('execute_sql (query):', err1 ? err1.message : res1);

  const { data: res2, error: err2 } = await supabaseAdmin.rpc('exec_sql', { query: 'SELECT tablename FROM pg_tables WHERE schemaname = \'public\' LIMIT 5;' });
  console.log('exec_sql (query):', err2 ? err2.message : res2);
}
run();
