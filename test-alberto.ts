import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
const env = dotenv.parse(fs.readFileSync('.env.local'));
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: jobs } = await supa.from('toast_jobs').select('*');
    
    // Slauson is ec6a9359-e932-475a-a309-847e199d750a? Wait maybe not. Let's just find the shift by date and employee guid.
    const { data: allShifts } = await supa.from('shifts').select('*').gte('shift_date', '2026-04-06');
    const albertoShift = allShifts?.filter(s => s.employee_toast_guid === '5e1a93ac-7686-4026-a4be-670aa0d25e97' || s.employee_id === '5e1a93ac-7686-4026-a4be-670aa0d25e97' || s.employee_name?.toLowerCase().includes('alberto romero')).pop();

    if (!albertoShift) {
        console.log('Searching by name...');
        const match = allShifts?.find(s => JSON.stringify(s).toLowerCase().includes('romero'));
        if (!match) return console.log('ALBERTO SHIFT NO ENCONTRADO EN ABSOLUTO');
        console.log('Matches:', match);
        const jobMatch = jobs.find(j => j.guid === match.job_id);
    	console.log('Alberto Job Title:', jobMatch?.title);
        return;
    }
    
    console.log('Alberto Shift Start:', albertoShift.start_time);
    
    const job = jobs.find(j => j.guid === albertoShift.job_id);
    console.log('Alberto Job Title:', job?.title);
}
run();
