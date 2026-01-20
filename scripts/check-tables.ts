
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

try { const envConfig = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env.local'))); for (const k in envConfig) process.env[k] = envConfig[k] } catch (e) { }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function check() {
    console.log("Checking 'punches'...")
    const r1 = await supabase.from('punches').select('*', { count: 'exact', head: true })
    if (r1.error) console.log(`Error punches: ${r1.error.message}`)
    else console.log(`'punches' exists. Count: ${r1.count}`)

    console.log("Checking 'shifts'...")
    const r2 = await supabase.from('shifts').select('*', { count: 'exact', head: true })
    if (r2.error) console.log(`Error shifts: ${r2.error.message}`)
    else console.log(`'shifts' exists. Count: ${r2.count}`)
}

check()
