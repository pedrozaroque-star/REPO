import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkMarina() {
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name');
        
    const marina = emps?.find(e => e.first_name?.toLowerCase().includes('marina'));
    console.log("Marina ID:", marina?.id);

    const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('employee_id', marina?.id)
        .gte('shift_date', '2026-04-27')
        .lte('shift_date', '2026-05-03');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${data.length} shifts for Marina`);
    for (const s of data) {
        const sMs = new Date(s.start_time).getTime();
        const eMs = new Date(s.end_time).getTime();
        const dur = (eMs - sMs) / 3600000;
        console.log(`- ${s.shift_date}: [SHIFT_ID: ${s.id}] | Store: ${s.store_id} | Job: ${s.job_id} | ${s.start_time} to ${s.end_time} | Duration: ${dur} hrs | Breaks: ${s.breaks_schedule?.length}`);
    }
}

checkMarina();
