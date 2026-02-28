import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const { error } = await supabase.rpc('execute_sql', { sql: 'SELECT 1;' });
    console.log('rpc execute_sql:', error?.message || 'success');

    const { error: err2 } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    console.log('rpc exec_sql:', err2?.message || 'success');
}
check();
