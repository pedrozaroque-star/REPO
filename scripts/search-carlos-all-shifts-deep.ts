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
    console.log('🔍 BUSCANDO TURNOS DE CARLOS / GENERAL MANAGER EN LYNWOOD');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Get ALL shifts in Lynwood for August 2026
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .gte('shift_date', '2026-08-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    // Get unique employee IDs
    const empIds = [...new Set(shifts?.map(s => s.employee_id) || [])];
    console.log(`Unique employee IDs with shifts in Lynwood (${empIds.length}):`, empIds);

    // Fetch employee details from toast_employees
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('*')
        .in('id', empIds);

    const { data: empsByGuid } = await supabase
        .from('toast_employees')
        .select('*')
        .in('toast_guid', empIds);

    const allEmpsMap = new Map();
    emps?.forEach(e => allEmpsMap.set(e.id, e));
    empsByGuid?.forEach(e => allEmpsMap.set(e.toast_guid, e));

    console.log('\nEmpleados identificados en Lynwood:');
    empIds.forEach(id => {
        const emp = allEmpsMap.get(id);
        if (emp) {
            console.log(`- ${emp.first_name} ${emp.last_name} | ID: ${id} | Job: ${emp.job_title || ''} | Email: ${emp.email}`);
        } else {
            console.log(`- Desconocido ID: ${id}`);
        }
    });

    // 2. Also check if Carlos has shifts in ANY other store or by another ID
    console.log('\nBuscando si Carlos tiene turnos en otras tiendas...');
    const { data: allCarlosEmps } = await supabase
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%');

    for (const ce of (allCarlosEmps || [])) {
        const { data: cShifts } = await supabase
            .from('shifts')
            .select('*')
            .gte('shift_date', '2026-08-01')
            .lte('shift_date', '2026-08-31')
            .or(`employee_id.eq.${ce.id},employee_id.eq.${ce.toast_guid}`);
        
        if (cShifts && cShifts.length > 0) {
            console.log(`\nTurnos de ${ce.first_name} ${ce.last_name} (${ce.email || ce.id}): ${cShifts.length} turnos`);
            cShifts.forEach(s => {
                const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
                const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
                console.log(`  ${s.shift_date}: ${startLA} - ${endLA} | Store: ${s.store_id}`);
            });
        }
    }
}

run();
