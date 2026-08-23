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
    console.log('🔍 CONSULTANDO HORARIOS EXACTOS DE CARLOS VELAZQUEZ EN EL PLANIFICADOR');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Find all employees with name Carlos or Velazquez
    const { data: emps, error: empErr } = await supabase
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,email.ilike.%carlos%')

    console.log(`Empleados encontrados matching Carlos (${emps?.length || 0}):`);
    emps?.forEach(e => {
        console.log(`- ID: ${e.id} | GUID: ${e.toast_guid} | Name: ${e.first_name} ${e.last_name} | Email: ${e.email} | Job: ${e.job_title}`);
    });

    const empGuids = emps?.map(e => e.toast_guid).filter(Boolean) || [];
    const empIds = emps?.map(e => e.id).filter(Boolean) || [];
    const allIds = [...new Set([...empGuids, ...empIds])];

    // 2. Query shifts table for June, July, August 2026
    const { data: allShifts, error: shiftErr } = await supabase
        .from('shifts')
        .select('*')
        .gte('shift_date', '2026-06-01')
        .lte('shift_date', '2026-08-31')
        .in('employee_id', allIds)
        .order('shift_date', { ascending: true });

    console.log(`\n📅 Turnos en 'shifts' table para Carlos (${allShifts?.length || 0}):`);
    const shiftsByMonth: Record<string, any[]> = { '2026-06': [], '2026-07': [], '2026-08': [] };
    
    allShifts?.forEach(s => {
        const monthKey = s.shift_date.slice(0, 7);
        if (shiftsByMonth[monthKey]) {
            shiftsByMonth[monthKey].push(s);
        }
        console.log(`  ${s.shift_date} [${s.day_of_week || ''}]: ${s.start_time} - ${s.end_time} | Hours: ${s.hours || s.scheduled_hours || ''} | Job: ${s.job_title || ''} | Store: ${s.store_id}`);
    });

    // 3. Query punches table for June, July, August 2026
    const { data: allPunches } = await supabase
        .from('punches')
        .select('*')
        .gte('business_date', '2026-06-01')
        .lte('business_date', '2026-08-31')
        .in('employee_guid', allIds)
        .order('business_date', { ascending: true });

    console.log(`\n⏰ Punches en 'punches' table para Carlos (${allPunches?.length || 0}):`);
    allPunches?.forEach(p => {
        console.log(`  ${p.business_date}: Clock In: ${p.clock_in} - Clock Out: ${p.clock_out} | Regular Hrs: ${p.regular_hours} | Store: ${p.store_id}`);
    });

    // 4. Also check if there's any other schedule table
    const { data: customSchedules } = await supabase
        .from('schedules')
        .select('*')
        .limit(10);
    console.log(`\nSchedules table count/sample:`, customSchedules?.length);

    fs.writeFileSync('scripts/carlos_shifts_dump.json', JSON.stringify({ emps, allShifts, allPunches }, null, 2), 'utf-8');
    console.log('Saved dump to scripts/carlos_shifts_dump.json');
}

run();
