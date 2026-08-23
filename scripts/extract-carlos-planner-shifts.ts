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

const CARLOS_LYNWOOD_EMP_ID = '42deef34-31ed-441e-ba89-3531b78fd1d9';

async function run() {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🎯 HORARIOS EXACTOS DE CARLOS VELAZQUEZ EN EL PLANIFICADOR (JUNIO, JULIO, AGOSTO 2026)');
    console.log('═══════════════════════════════════════════════════════════════════════');

    const { data: shifts, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('employee_id', CARLOS_LYNWOOD_EMP_ID)
        .gte('shift_date', '2026-06-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    console.log(`Total turnos encontrados para Carlos en shifts: ${shifts?.length || 0}`);

    const byDate: Record<string, { start: string, end: string, hours: number, rawStart: string, rawEnd: string }> = {};

    shifts?.forEach(s => {
        const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
        const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
        const diffH = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3600000;
        byDate[s.shift_date] = {
            start: startLA,
            end: endLA,
            hours: diffH,
            rawStart: s.start_time,
            rawEnd: s.end_time
        };
        console.log(`  ${s.shift_date}: ${startLA} - ${endLA} (${diffH.toFixed(1)}h) [status: ${s.status}]`);
    });

    fs.writeFileSync('scripts/carlos_planner_shifts_by_date.json', JSON.stringify(byDate, null, 2), 'utf-8');
    console.log('Saved to scripts/carlos_planner_shifts_by_date.json');
}

run();
