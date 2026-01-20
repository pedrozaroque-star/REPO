
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'


// Load environment variables correctly
const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = dotenv.parse(fs.readFileSync(envPath))
for (const k in envConfig) {
    process.env[k] = envConfig[k]
}

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } })

async function verify() {
    const { count, error } = await supabase
        .from('shifts')
        .select('*', { count: 'exact', head: true })
        .gte('shift_date', '2026-01-19')
        .lte('shift_date', '2026-01-25')

    console.log(`Shifts generated for 19-25 Jan: ${count}`)
    if (error) console.error(error)

    if (count! > 400) console.log("✅ Success! Looks like enough shifts.")
    else console.log("⚠️ Warning: Shift count is low (might still be running or failed).")
}

verify().catch(console.error)
