import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    const envConfig = dotenv.parse(fs.readFileSync(envPath))
    for (const k in envConfig) {
        process.env[k] = envConfig[k]
    }
} catch (e) {
    console.warn("⚠️ No se pudo leer .env.local")
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false }
})

const LYNWOOD_STORE_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6';

async function run() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🔍 REVISIÓN DE EMPLEADOS Y TURNOS DE LYNWOOD EN PLANIFICADOR');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Toast Jobs
    const { data: jobs } = await supabase.from('toast_jobs').select('*');
    const jobMap = new Map();
    jobs?.forEach(j => jobMap.set(j.id, j.title));

    // 2. Toast Employees in Lynwood
    const { data: allEmps } = await supabase.from('toast_employees').select('*');
    const lynwoodEmps = allEmps?.filter(e => {
        let storeIds = [];
        if (Array.isArray(e.store_ids)) {
            storeIds = e.store_ids.map((id: any) => typeof id === 'object' ? id?.id || id?.guid : id);
        } else if (typeof e.store_ids === 'string') {
            try {
                const parsed = JSON.parse(e.store_ids);
                storeIds = Array.isArray(parsed) ? parsed.map((id: any) => typeof id === 'object' ? id?.id || id?.guid : id) : [e.store_ids];
            } catch {
                storeIds = [e.store_ids];
            }
        }
        return storeIds.includes(LYNWOOD_STORE_GUID);
    });

    console.log(`\nEmpleados en Lynwood (${lynwoodEmps?.length || 0}):`);
    lynwoodEmps?.forEach(e => {
        console.log(`- ${e.first_name} ${e.last_name} | ID: ${e.id} | GUID: ${e.toast_guid} | Job: ${e.job_title}`);
    });

    // 3. Find shifts for each employee in Lynwood
    const empIds = lynwoodEmps?.map(e => e.id) || [];
    const empGuids = lynwoodEmps?.map(e => e.toast_guid).filter(Boolean) || [];
    const allEmpKeys = [...new Set([...empIds, ...empGuids])];

    const { data: lynwoodShifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .gte('shift_date', '2026-08-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    console.log(`\nTotal turnos en Lynwood en Agosto 2026: ${lynwoodShifts?.length || 0}`);

    // Map shifts by employee
    const shiftsByEmployee = new Map();
    lynwoodShifts?.forEach(s => {
        const emp = lynwoodEmps?.find(e => e.id === s.employee_id || e.toast_guid === s.employee_id);
        const name = emp ? `${emp.first_name} ${emp.last_name}` : s.employee_id;
        if (!shiftsByEmployee.has(name)) shiftsByEmployee.set(name, []);
        shiftsByEmployee.get(name).push(s);
    });

    for (const [empName, sList] of shiftsByEmployee.entries()) {
        console.log(`\n📅 Turnos de ${empName} (${sList.length}):`);
        sList.forEach((s: any) => {
            const start = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const end = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            console.log(`   ${s.shift_date}: ${start} - ${end} | Job: ${jobMap.get(s.job_id) || s.job_id || 'N/A'}`);
        });
    }

    // 4. Also check June and July shifts in Lynwood
    const { data: juneShifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .gte('shift_date', '2026-06-01')
        .lte('shift_date', '2026-06-30');

    const { data: julyShifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .gte('shift_date', '2026-07-01')
        .lte('shift_date', '2026-07-31');

    console.log(`\nJunio Lynwood Shifts: ${juneShifts?.length || 0} | Julio Lynwood Shifts: ${julyShifts?.length || 0}`);
}

run();
