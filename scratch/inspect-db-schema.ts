import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data: cols, error } = await supabaseAdmin
        .rpc('get_table_columns', { table_name: 'bc_vaults' })
    if (error) {
        // If RPC doesn't exist, query from information_schema
        const { data: cols2, error: err2 } = await supabaseAdmin
            .from('pg_attribute')
            .select('attname, atttypid')
            .filter('attrelid', 'eq', 'public.bc_vaults' as any)
        
        console.log('Error calling RPC, trying raw query or information_schema...')
        
        const { data: infoSchema, error: err3 } = await supabaseAdmin
            .rpc('execute_sql', { query: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bc_vaults'" })
        if (err3) {
            console.log('Error infoSchema:', err3)
        } else {
            console.log('infoSchema:', infoSchema)
        }
    } else {
        console.log('Columns:', cols)
    }

    // Let's just run execute_sql query via a helper or direct query if possible, or just print a table details:
    const { data: testQuery, error: qErr } = await supabaseAdmin
        .from('bc_vaults')
        .select('*')
        .limit(1)
    console.log('Vault row keys:', testQuery ? Object.keys(testQuery[0] || {}) : null)
    if (qErr) console.error(qErr)
}

run()
