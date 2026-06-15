import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const query = "SELECT tasks FROM station_assignments WHERE store_id = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'";
    const { data, error } = await supabase.rpc('execute_sql', { query_text: query });
    if (error) {
        console.error('Error:', error);
        return;
    }
    const uniqueTasks = new Set<string>();
    data.forEach((row: any) => {
        if (row.tasks && Array.isArray(row.tasks)) {
            row.tasks.forEach((t: string) => {
                if (t && t.trim()) {
                    uniqueTasks.add(t.trim());
                }
            });
        }
    });

    console.log(`Found ${data.length} assignments rows.`);
    console.log(`Found ${uniqueTasks.size} unique tasks in Slauson assignments:`);
    const sorted = Array.from(uniqueTasks).sort();
    sorted.forEach((t, idx) => {
        console.log(`${idx + 1}. "${t}"`);
    });
}
run()
