import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { scheduleBreaksWithDemand } from '../lib/breaks-engine';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const dummyOpHours = Array.from({ length: 24 }).map((_, i) => ({
    hour: i,
    projectedSales: 1000,
    projectedTickets: 100
}));

async function run() {
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name');
        
    const marina = emps?.find(e => e.first_name?.toLowerCase().includes('marina'));

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('employee_id', marina?.id)
        .gte('shift_date', '2026-04-27')
        .lte('shift_date', '2026-05-03');

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${shifts.length} shifts for Marina`);
    const calculated = scheduleBreaksWithDemand(shifts, dummyOpHours as any);
    
    for (const s of calculated) {
        console.log(`Shift ${s.shift_date}: ${s.breaks_schedule.length} breaks assigned`);
        console.log(s.breaks_schedule);
    }
}

run();
