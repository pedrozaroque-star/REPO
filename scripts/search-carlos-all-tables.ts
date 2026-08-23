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
    console.log('🔍 BUSCANDO A CARLOS EN EL PLANIFICADOR Y SHIFTS');
    console.log('═══════════════════════════════════════════════════════════════════════');

    // 1. Search in all employee tables
    const tables = ['toast_employees', 'employees', 'profiles', 'users'];
    for (const t of tables) {
        try {
            const { data, error } = await supabase.from(t).select('*').limit(5);
            console.log(`Table ${t} exists?`, !error, `Sample count: ${data?.length}`);
            if (!error) {
                const { data: carlosData } = await supabase.from(t).select('*').or('first_name.ilike.%carlos%,name.ilike.%carlos%,email.ilike.%carlos%');
                console.log(`  Carlos matches in ${t}:`, carlosData);
            }
        } catch (e) {
            console.log(`Table ${t} error:`, e.message);
        }
    }

    // 2. Look at 7shifts PDF or schedules files in repo
    const files = fs.readdirSync('.').filter(f => f.toLowerCase().includes('horario') || f.toLowerCase().includes('shift') || f.toLowerCase().includes('carlos'));
    console.log('\nArchivos relacionados con horarios en raíz:', files);
}

run();
