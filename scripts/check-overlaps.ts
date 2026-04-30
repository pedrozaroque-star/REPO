import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getRoleKey(title: string): string {
    return (title || 'unknown').toLowerCase().trim();
}

async function checkOverlaps() {
    const { data: emps } = await supabase.from('toast_employees').select('id, first_name, last_name');
    const { data: jobs } = await supabase.from('toast_jobs').select('id, title');
    
    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('employee_id, job_id, start_time, end_time, breaks_schedule')
        .eq('shift_date', '2026-04-29')
        .eq('store_id', '47256ade-2cd4-4073-9632-84567ad9e2c8'); // SLAUSON

    if (error) {
        console.error("Error:", error);
        return;
    }

    const meals: any[] = [];
    shifts.forEach(s => {
        if (!s.breaks_schedule) return;
        const emp = emps?.find(e => e.id === s.employee_id);
        const empName = emp ? `${emp.first_name} ${emp.last_name}` : s.employee_id;
        const job = jobs?.find(j => j.id === s.job_id);
        const jobTitle = job ? job.title : 'unknown';
        const role = getRoleKey(jobTitle);
        
        s.breaks_schedule.forEach((b: any) => {
            if (b.type === 'meal_30') {
                console.log(`- EmpName: ${empName}, role: ${role}`);
                meals.push({
                    emp: empName,
                    role: getRoleKey(jobTitle),
                    start: new Date(b.start_time).getTime(),
                    end: new Date(b.end_time).getTime()
                });
            }
        });
    });

    for (let i = 0; i < meals.length; i++) {
        for (let j = i + 1; j < meals.length; j++) {
            const m1 = meals[i];
            const m2 = meals[j];
            if (m1.role === m2.role) {
                const overlapMs = Math.max(0, Math.min(m1.end, m2.end) - Math.max(m1.start, m2.start));
                if (overlapMs > 0) {
                    console.log(`OVERLAP FOUND: ${m1.emp} and ${m2.emp} (${m1.role}) from ${new Date(Math.max(m1.start, m2.start)).toLocaleTimeString()} for ${overlapMs / 60000} mins`);
                }
            }
        }
    }
    console.log("Done checking overlaps.");
}

checkOverlaps();
