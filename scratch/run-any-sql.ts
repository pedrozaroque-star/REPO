import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const query = "SELECT id, employee_id, shift_date, start_time, is_callback FROM shifts WHERE store_id = '9625621e-1b5e-48d7-87ae-7094fab5a4fd' AND shift_date = '2026-06-07'";
    const { data, error } = await supabase.rpc('execute_sql', { query_text: query });
    if (error) {
        console.error('Error:', error);
    } else {
        console.log(data);
    }
}
run()
