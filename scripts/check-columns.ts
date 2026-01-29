
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function check() {
    console.log("Checking weekly_budgets columns...")
    const { data, error } = await supabase.from('weekly_budgets').select('*').limit(1)
    if (error) {
        console.error("Error:", error.message)
        return
    }
    if (data && data.length > 0) {
        console.log("Columns found:", Object.keys(data[0]))
        console.log("Sample row:", JSON.stringify(data[0], null, 2))
    } else {
        console.log("Table is empty, cannot infer columns easily via select. Trying empty insert...")
    }
}

check()
