import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const { data, error } = await supabase.rpc('execute_sql', { query_text: 'SELECT 1 as result;' });
    console.log('rpc execute_sql:', error?.message || 'success', data);
}
check();
