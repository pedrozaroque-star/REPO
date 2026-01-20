
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

try { const envConfig = dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env.local'))); for (const k in envConfig) process.env[k] = envConfig[k] } catch (e) { }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function check() {
    const { count, error } = await supabase.from('punches').select('*', { count: 'exact', head: true })
    console.log(`Punches count: ${count}`)
    if (error) console.error(error)
}

check()
