import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const query = "SELECT DISTINCT role FROM operating_procedures"
    const { data, error } = await supabaseAdmin.rpc('execute_sql', { query_text: query })
    if (error) {
        console.error('Error executing SQL:', error)
    } else {
        console.log('Tables in database:')
        console.log(data)
    }
}
run()
