import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { scheduleBreaksWithDemand } from '../lib/breaks-engine';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    const { data: shifts } = await supabase
        .from('shifts')
        .select(`
            *,
            employee:toast_employees(id, first_name, last_name, roles:toast_employee_roles(role:toast_roles(id, name))),
            role:toast_roles(id, name)
        `)
        .eq('shift_date', '2026-04-29');

    if (!shifts) {
        console.log("No shifts found or error");
        return;
    }

    const mappedShifts = shifts.map(s => ({
        ...s,
        employee_name: s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : 'Unknown',
        job_title: s.role?.name || s.job_id || 'unknown'
    }));

    // Operating hours for heat
    const operatingHours = [
        { hour: 10, projected_sales: 100 },
        { hour: 13, projected_sales: 800 },
        { hour: 20, projected_sales: 900 }
    ];

    const processed = scheduleBreaksWithDemand(mappedShifts, operatingHours);

    const david = processed.find(s => s.employee_name.includes('David Rodriguez'));
    if (david) {
        console.log(`DAVID RODRIGUEZ:`);
        console.log(JSON.stringify(david.breaks_schedule, null, 2));
    }
}
run();
