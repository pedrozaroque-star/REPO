import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Load environment variables
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Faltan variables de entorno Supabase")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
})

async function checkCarlos() {
    console.log('\n🔍 BUSCANDO A CARLOS VELAZQUEZ EN SUPABASE')
    console.log('='.repeat(60))

    // 1. Check toast_employees / employees
    const { data: emps, error: empErr } = await supabase
        .from('toast_employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%')
    console.log('toast_employees:', emps, empErr)

    // 2. Check all employees tables
    const { data: emps2, error: empErr2 } = await supabase
        .from('employees')
        .select('*')
        .or('first_name.ilike.%carlos%,last_name.ilike.%velazquez%')
    console.log('employees:', emps2, empErr2)

    // 3. Search punches for August 2026
    const { data: punches, error: punchErr } = await supabase
        .from('punches')
        .select('*')
        .gte('business_date', '2026-08-01')
        .lte('business_date', '2026-08-31')
        .or('employee_name.ilike.%carlos%,employee_name.ilike.%velazquez%')
        .order('business_date', { ascending: true })
    console.log(`Punches (${punches?.length || 0}):`)
    if (punches && punches.length > 0) {
        punches.forEach(p => console.log(`  ${p.business_date}: ${p.employee_name} | ${p.job_title} | In: ${p.in_date} Out: ${p.out_date} | Hours: ${p.regular_hours + p.overtime_hours}`))
    }

    // 4. Search leadership_schedules
    const { data: leadSched, error: leadErr } = await supabase
        .from('leadership_schedules')
        .select('*')
        .or('employee_name.ilike.%carlos%,employee_name.ilike.%velazquez%')
        .gte('date', '2026-08-01')
        .lte('date', '2026-08-31')
        .order('date', { ascending: true })
    console.log(`\nleadership_schedules (${leadSched?.length || 0}):`, leadSched, leadErr)

    // 5. Let's check store Lynwood schedules or published_schedules
    const { data: storeSched, error: schedErr } = await supabase
        .from('schedules')
        .select('*')
        .gte('date', '2026-08-01')
        .lte('date', '2026-08-31')
        .or('employee_name.ilike.%carlos%,employee_name.ilike.%velazquez%')
    console.log(`\nschedules table (${storeSched?.length || 0}):`, storeSched, schedErr)

    // 6. Check all tables with 'sched' in name or planner
    const { data: userList } = await supabase
        .from('user_roles')
        .select('*')
        .or('user_email.ilike.%carlos%,user_email.ilike.%velazquez%')
    console.log(`\nuser_roles:`, userList)
}

checkCarlos()
