import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkCooks() {
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('id, first_name, last_name')
        .or('first_name.ilike.%cesar%,first_name.ilike.%fabian%,first_name.ilike.%moises%,first_name.ilike.%william%');
        
    const ids = emps?.map(e => e.id) || [];

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('shift_date', '2026-04-29');

    if (error) {
        console.error("Error:", error);
        return;
    }

    const { data: allEmps } = await supabase.from('toast_employees').select('id, first_name, last_name');
    const { data: allStores } = await supabase.from('toast_stores').select('id, name');

    for (const shift of shifts) {
        const emp = allEmps?.find(e => e.id === shift.employee_id);
        const name = `${emp?.first_name} ${emp?.last_name}`.toLowerCase();
        if (name.includes('cesar') || name.includes('fabian') || name.includes('moises') || name.includes('william') || name.includes('willian')) {
            const store = allStores?.find(s => s.id === shift.store_id);
            console.log(`- ${store?.name} | ${emp?.first_name} ${emp?.last_name}: ${shift.start_time} to ${shift.end_time}`);
            console.log(`  Breaks:`, JSON.stringify(shift.breaks_schedule, null, 2));
        }
    }
}

checkCooks();
