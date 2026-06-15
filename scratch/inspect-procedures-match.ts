import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function run() {
    // Fetch Slauson assignments
    const { data: assignments } = await supabase.rpc('execute_sql', { 
        query_text: "SELECT tasks FROM station_assignments WHERE store_id = '9625621e-1b5e-48d7-87ae-7094fab5a4fd'" 
    });

    const uniqueTasks = new Set<string>();
    assignments.forEach((row: any) => {
        if (row.tasks && Array.isArray(row.tasks)) {
            row.tasks.forEach((t: string) => {
                if (t && t.trim()) uniqueTasks.add(t.trim());
            });
        }
    });

    // Fetch operating procedures
    const { data: procedures } = await supabase.rpc('execute_sql', {
        query_text: "SELECT id, activity FROM operating_procedures"
    });

    console.log(`Unique tasks in assignments: ${uniqueTasks.size}`);
    console.log(`Procedures in catalog: ${procedures?.length}`);

    let missing = 0;
    const taskList = Array.from(uniqueTasks);
    taskList.forEach((t) => {
        const normT = normalizeText(t);
        const match = procedures.find((p: any) => {
            const normP = normalizeText(p.activity);
            return normP === normT || normT.includes(normP) || normP.includes(normT);
        });
        if (!match) {
            console.log(`❌ Missing from catalog: "${t}"`);
            missing++;
        }
    });
    console.log(`Total missing: ${missing}`);
}
run();
