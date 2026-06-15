import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
  console.log('🔌 Verifying execute_sql RPC on Supabase...');
  const query = "SELECT tablename FROM pg_tables WHERE schemaname = 'public' LIMIT 5;";
  const { data, error } = await supabase.rpc('execute_sql', { query_text: query });

  if (error) {
    console.error('❌ Verification Failed:', error.message);
    console.error('Detail:', error.details);
  } else {
    console.log('🎉 SUCCESS! execute_sql RPC is working perfectly.');
    console.log('Result:', data);
  }
}

verify().catch(console.error);
