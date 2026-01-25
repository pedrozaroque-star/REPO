
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Using .env because .env.local might lack some vars in some setups, but usually local is best
const envPath = path.resolve(__dirname, '../.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Needs Service Role to see all

if (!supabaseUrl || !supabaseKey) process.exit(1)

const supabase = createClient(supabaseUrl, supabaseKey)

async function listTables() {
    // This is a hacky way to list tables via PostgREST if we don't have SQL access
    // We try to select from 'toast_employees'

    console.log("🔍 Checking 'toast_employees'...")
    const { data: tData, error: tError } = await supabase.from('toast_employees').select('count', { count: 'exact', head: true })
    if (tError) console.log("   ❌ toast_employees error:", tError.message)
    else console.log("   ✅ toast_employees exists! Count:", tData) // null data for head:true but no error means exists

    console.log("🔍 Checking 'employees'...")
    const { data: eData, error: eError } = await supabase.from('employees').select('count', { count: 'exact', head: true })
    if (eError) console.log("   ❌ employees error:", eError.message)
    else console.log("   ✅ employees exists! Count:", eData)
}

listTables()
