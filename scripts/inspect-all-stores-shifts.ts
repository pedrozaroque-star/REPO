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
    console.log('🔍 CONSULTANDO TODAS LAS TIENDAS EN SUPABASE');
    console.log('═══════════════════════════════════════════════════════════════════════');

    const { data: stores } = await supabase.from('stores').select('*').order('name');
    stores?.forEach(s => {
        console.log(`Tienda: ${s.name} | ID: ${s.id} | Toast GUID: ${s.toast_guid || s.guid || 'N/A'}`);
    });

    // Check all shifts in August for ALL stores to find Carlos
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .gte('shift_date', '2026-08-01')
        .lte('shift_date', '2026-08-31');

    console.log(`\nTotal shifts in August across all stores: ${shifts?.length || 0}`);

    // Group shifts by store_id
    const storeShiftsCount = new Map();
    shifts?.forEach(s => {
        storeShiftsCount.set(s.store_id, (storeShiftsCount.get(s.store_id) || 0) + 1);
    });

    console.log('\nTurnos por tienda:');
    for (const [sid, cnt] of storeShiftsCount.entries()) {
        const store = stores?.find(st => st.id === sid || st.toast_guid === sid || String(st.id) === String(sid));
        console.log(`  Store ${sid} (${store?.name || 'Unknown'}): ${cnt} turnos`);
    }
}

run();
