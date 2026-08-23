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
    // Find shifts on 2026-08-01 in Lynwood
    const { data: shifts } = await supabase
        .from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_STORE_GUID)
        .eq('shift_date', '2026-08-01');

    console.log('Shifts on 2026-08-01 in Lynwood:');
    for (const s of (shifts || [])) {
        const start = new Date(s.start_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        const end = new Date(s.end_time).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        
        const { data: emp } = await supabase
            .from('toast_employees')
            .select('*')
            .or(`id.eq.${s.employee_id},toast_guid.eq.${s.employee_id}`)
            .maybeSingle();

        console.log(`- ${start} - ${end} | Employee ID: ${s.employee_id} | Name: ${emp ? `${emp.first_name} ${emp.last_name} (${emp.email})` : 'Unknown'}`);
    }
}

run();
