
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function run() {
    const { data, error } = await supabase.from('stores').select('*')
    if (error) {
        console.error("Error fetching stores:", error)
    } else {
        console.log("Stores found:", data)
    }
}

run()
