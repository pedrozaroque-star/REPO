import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkAllShifts() {
    const { data: emps } = await supabase.from('toast_employees').select('id, first_name, last_name');
    
    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('shift_date', '2026-04-29');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${shifts.length} shifts for 2026-04-29:`);
    for (const shift of shifts) {
        const emp = emps?.find(e => e.id === shift.employee_id);
        console.log(`- ${emp?.first_name} ${emp?.last_name}: ${shift.start_time} to ${shift.end_time}`);
        console.log(`  Breaks:`, JSON.stringify(shift.breaks_schedule, null, 2));
    }
}

checkAllShifts();
