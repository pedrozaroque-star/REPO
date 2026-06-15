import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    console.log('Calling execute_sql RPC...')
    const { data, error } = await supabaseAdmin
        .rpc('execute_sql', { query_text: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bc_vaults'" })
    
    if (error) {
        console.error('Error calling execute_sql:', error)
    } else {
        console.log('Result:', data)
    }
}

run()
