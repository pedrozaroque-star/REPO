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

async function run() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🔍 BUSCANDO REGISTRO EXACTO DE CARLOS VELAZQUEZ EN TOAST_EMPLOYEES Y SHIFTS');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Toast employees with Carlos Velazquez
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('*')
        .ilike('first_name', '%Carlos%')
        .ilike('last_name', '%Velazquez%');

    console.log('Registros de Carlos Velazquez en toast_employees:');
    emps?.forEach(e => {
        console.log(`- ID: ${e.id} | GUID: ${e.toast_guid} | Email: ${e.email} | Job: ${e.job_title} | Stores: ${JSON.stringify(e.store_ids)}`);
    });

    // 2. Also check all shifts with job title Manager / General Manager in Lynwood
    const { data: lynwoodStore } = await supabase
        .from('stores')
        .select('*')
        .ilike('name', '%lynwood%')
        .single();

    console.log(`\nTienda Lynwood ID: ${lynwoodStore?.id}`);

    // Let's get ALL shifts in Lynwood for August 2026
    const { data: lynwoodShifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', lynwoodStore?.id)
        .gte('shift_date', '2026-08-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    console.log(`\nTotal turnos en Lynwood en Agosto 2026: ${lynwoodShifts?.length || 0}`);

    // Group shifts by employee_id in Lynwood
    const empCountMap = new Map();
    lynwoodShifts?.forEach(s => {
        empCountMap.set(s.employee_id, (empCountMap.get(s.employee_id) || 0) + 1);
    });

    console.log('\nEmpleados con turnos en Lynwood en Agosto 2026:');
    for (const [empId, count] of empCountMap.entries()) {
        const { data: emp } = await supabase
            .from('toast_employees')
            .select('*')
            .or(`id.eq.${empId},toast_guid.eq.${empId}`)
            .maybeSingle();
        console.log(`  Employee: ${emp ? `${emp.first_name} ${emp.last_name} (${emp.email})` : empId} -> ${count} turnos`);
    }

    // Let's print all shifts for Lynwood managers/employees in August
    console.log('\nListado detallado de turnos en Lynwood:');
    for (const s of (lynwoodShifts || [])) {
        const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        const { data: emp } = await supabase
            .from('toast_employees')
            .select('first_name, last_name, email')
            .or(`id.eq.${s.employee_id},toast_guid.eq.${s.employee_id}`)
            .maybeSingle();
        const empName = emp ? `${emp.first_name} ${emp.last_name}` : s.employee_id;
        console.log(`  ${s.shift_date}: ${startLA} - ${endLA} | Empleado: ${empName} | Job: ${s.job_title || s.role || ''}`);
    }
}

run();
