import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
    console.log('🚀 Running SQL Migration for sales_projections_cache...')

    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20260519231500_sales_projections_cache.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    // execute_sql is a custom RPC function configured on the user's Supabase instance
    const { data, error } = await supabase.rpc('execute_sql', { query: sql })

    if (error) {
        console.error('❌ Failed to execute SQL:', error)
        return
    }

    console.log('✅ Migration executed successfully!')
}

runMigration()
