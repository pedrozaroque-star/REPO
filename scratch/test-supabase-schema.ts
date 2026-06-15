import { supabaseAdmin } from '../lib/supabase';

async function run() {
  console.log('Testing direct system queries via Supabase JS client...');
  try {
    const { data: tables, error: err1 } = await supabaseAdmin
      .from('pg_tables')
      .select('tablename')
      .limit(10);
    console.log('pg_tables:', err1 ? err1.message : tables);
  } catch (e: any) {
    console.log('pg_tables failed:', e.message);
  }

  try {
    const { data: routines, error: err2 } = await supabaseAdmin
      .from('pg_proc')
      .select('proname')
      .limit(10);
    console.log('pg_proc:', err2 ? err2.message : routines);
  } catch (e: any) {
    console.log('pg_proc failed:', e.message);
  }
}
run();
