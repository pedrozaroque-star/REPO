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
    // Check all shifts in Lynwood sorted by shift_date
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .gte('shift_date', '2026-06-01')
        .lte('shift_date', '2026-08-31')
        .order('shift_date', { ascending: true });

    // Look for Carlos
    const { data: carlosEmps } = await supabase
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,email.ilike.%carlos%');

    const carlosIds = carlosEmps?.map(e => e.id) || [];
    const carlosGuids = carlosEmps?.map(e => e.toast_guid).filter(Boolean) || [];
    const allCarlosKeys = [...new Set([...carlosIds, ...carlosGuids])];

    const carlosShifts = shifts?.filter(s => allCarlosKeys.includes(s.employee_id));

    console.log(`\n🎯 TURNOS EXACTOS DE CARLOS EN LYNWOOD (${carlosShifts?.length || 0}):`);
    
    // Group by month
    const byMonth: Record<string, any[]> = { '2026-06': [], '2026-07': [], '2026-08': [] };
    carlosShifts?.forEach(s => {
        const m = s.shift_date.slice(0, 7);
        if (byMonth[m]) byMonth[m].push(s);
    });

    for (const [m, mShifts] of Object.entries(byMonth)) {
        console.log(`\n=== MES ${m} (${mShifts.length} turnos) ===`);
        mShifts.sort((a, b) => a.shift_date.localeCompare(b.shift_date)).forEach(s => {
            const start = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const end = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const diffH = ((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3600000).toFixed(1);
            console.log(`  ${s.shift_date}: ${start} - ${end} (${diffH}h)`);
        });
    }

    fs.writeFileSync('scripts/carlos_lynwood_exact_shifts.json', JSON.stringify(byMonth, null, 2), 'utf-8');
}

run();
