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

const LYNWOOD_EXTERNAL_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function run() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🔍 CONSULTANDO TODOS LOS TURNOS DE LYNWOOD (80a1ec95-bc73-402e-8884-e5abbe9343e6)');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Get all employees who worked in Lynwood
    const { data: lynwoodEmps } = await supabase
        .from('toast_employees')
        .select('*')
        .contains('store_ids', [LYNWOOD_EXTERNAL_ID]);

    console.log(`Empleados vinculados a Lynwood: ${lynwoodEmps?.length || 0}`);
    lynwoodEmps?.forEach(e => {
        console.log(`- ID: ${e.id} | GUID: ${e.toast_guid} | Name: ${e.first_name} ${e.last_name} | Email: ${e.email} | Job: ${e.job_title}`);
    });

    // 2. Query ALL shifts in Lynwood for June, July, August 2026
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_EXTERNAL_ID)
        .gte('shift_date', '2026-06-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    console.log(`\nTotal turnos en Lynwood (Junio, Julio, Agosto 2026): ${shifts?.length || 0}`);

    // Map employee ID/GUID to name
    const allEmpsMap = new Map();
    const { data: allEmps } = await supabase.from('toast_employees').select('id, toast_guid, first_name, last_name, email, job_title');
    allEmps?.forEach(e => {
        allEmpsMap.set(e.id, e);
        if (e.toast_guid) allEmpsMap.set(e.toast_guid, e);
    });

    // Group shifts by employee
    const shiftsByEmp = new Map();
    shifts?.forEach(s => {
        const emp = allEmpsMap.get(s.employee_id);
        const name = emp ? `${emp.first_name} ${emp.last_name}` : s.employee_id;
        if (!shiftsByEmp.has(name)) shiftsByEmp.set(name, []);
        shiftsByEmp.get(name).push(s);
    });

    console.log('\nResumen de turnos por empleado en Lynwood:');
    for (const [name, empShifts] of shiftsByEmp.entries()) {
        console.log(`\n👤 ${name} (${empShifts.length} turnos):`);
        empShifts.slice(0, 15).forEach((s: any) => {
            const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            console.log(`   ${s.shift_date}: ${startLA} - ${endLA} (${s.hours || 'N/A'} hrs) | Status: ${s.status}`);
        });
    }

    fs.writeFileSync('scripts/lynwood_all_shifts_dump.json', JSON.stringify({ lynwoodEmps, shifts }, null, 2), 'utf-8');
}

run();
