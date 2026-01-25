
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
    console.log('🏗️ Applying Schema Migration: Add hourly_tickets...')

    const { error } = await supabase.rpc('execute_sql', {
        sql_query: "ALTER TABLE sales_daily_cache ADD COLUMN IF NOT EXISTS hourly_tickets JSONB DEFAULT '{}'::jsonb;"
    })

    // If RPC is not available/permitted, we might fail here. 
    // Alternative: We can't easily run DDL via client without RPC. 
    // Let's try RPC first. If it fails, I'll ask user to run it or rely on existing tools.

    if (error) {
        console.error('RPC Error:', error)
        console.log('⚠️ Attempting direct query via Postgres (not possible via JS client usually).')
        console.log('Please run this SQL manually in Supabase SQL Editor:')
        console.log("ALTER TABLE sales_daily_cache ADD COLUMN IF NOT EXISTS hourly_tickets JSONB DEFAULT '{}'::jsonb;")
    } else {
        console.log('✅ Migration Successful!')
    }
}

runMigration()
