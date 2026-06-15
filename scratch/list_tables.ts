import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data, error } = await supabaseAdmin
    .rpc('get_tables_list'); // Check if there is an RPC, or run a query on pg_tables

  if (error) {
    // Fallback: run query via raw sql if RPC doesn't exist.
    // Wait, we don't have direct SQL RPC unless there's an execute_sql or custom RPC.
    // Let's check PG catalog via standard table queries or check schema.
    console.error('❌ Error calling get_tables_list:', error);
    
    // Let's try querying information_schema
    // Note: Supabase JS client doesn't allow direct SELECT from information_schema tables usually unless exposed.
    // But we can check if we can query it.
  } else {
    console.log('Tables:', data);
  }
}

run();
