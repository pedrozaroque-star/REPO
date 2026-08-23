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
    console.log('🔍 ANALIZANDO TURNOS DE CARLOS VELAZQUEZ POR TIENDA Y EMPLEADO');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Get stores map
    const { data: stores } = await supabase.from('stores').select('*');
    const storeMap = new Map();
    stores?.forEach(s => storeMap.set(s.id, s.name));

    // 2. Find Carlos in toast_employees
    const { data: emps } = await supabase
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%,email.ilike.%carlos%');

    console.log('Empleados encontrados:');
    emps?.forEach(e => {
        console.log(`- ID: ${e.id} | GUID: ${e.toast_guid} | Name: ${e.first_name} ${e.last_name} | Email: ${e.email} | Stores: ${e.store_ids?.map((sid: any) => storeMap.get(sid) || sid).join(', ')}`);
    });

    // 3. For each Carlos employee record, find shifts in August 2026
    for (const e of (emps || [])) {
        const { data: empShifts } = await supabase
            .from('shifts')
            .select('*')
            .gte('shift_date', '2026-08-01')
            .lte('shift_date', '2026-08-31')
            .eq('employee_id', e.id)
            .order('shift_date', { ascending: true });

        console.log(`\nTurnos de ${e.first_name} ${e.last_name} (ID ${e.id}) en Agosto 2026: ${empShifts?.length || 0}`);
        empShifts?.forEach(s => {
            const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const storeName = storeMap.get(s.store_id) || s.store_id;
            console.log(`  ${s.shift_date}: ${startLA} - ${endLA} (${s.hours || 'N/A'} hrs) | Tienda: ${storeName}`);
        });

        // Also check by toast_guid
        if (e.toast_guid) {
            const { data: guidShifts } = await supabase
                .from('shifts')
                .select('*')
                .gte('shift_date', '2026-08-01')
                .lte('shift_date', '2026-08-31')
                .eq('employee_id', e.toast_guid)
                .order('shift_date', { ascending: true });
            
            if (guidShifts && guidShifts.length > 0) {
                console.log(`  [Por GUID ${e.toast_guid}] Turnos encontrados: ${guidShifts.length}`);
                guidShifts.forEach(s => {
                    const startLA = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
                    const endLA = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
                    const storeName = storeMap.get(s.store_id) || s.store_id;
                    console.log(`    ${s.shift_date}: ${startLA} - ${endLA} (${s.hours || 'N/A'} hrs) | Tienda: ${storeName}`);
                });
            }
        }
    }
}

run();
