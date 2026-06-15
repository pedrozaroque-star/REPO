import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { supabaseAdmin } from '../lib/supabase'

async function run() {
    const { data, error } = await supabaseAdmin.rpc('get_tables')
    if (error) {
        // If RPC doesn't exist, query pg_catalog
        const { data: tables, error: err2 } = await supabaseAdmin
            .from('pg_tables')
            .select('tablename')
            .eq('schemaname', 'public')
        if (err2) {
            // Try raw query or list tables using query
            console.error('Error listing tables:', err2)
        } else {
            console.log('Tables:', tables.map(t => t.tablename))
        }
    } else {
        console.log('Tables:', data)
    }
}
run()
