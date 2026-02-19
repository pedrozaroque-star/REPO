
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function run() {
    // List tables in public schema
    const { data, error } = await supabase
        .from('information_schema.tables') // This might fail due to RLS/security
        .select('table_name')
        .eq('table_schema', 'public')

    // Alternative: Try to select 1 row from likely tables
    const potentialTables = ['toast_menugroups', 'sales_categories', 'toast_sales_categories', 'toast_menus']

    for (const t of potentialTables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
        if (!error) {
            console.log(`Table exists: ${t} (${count} rows)`)
        } else {
            // console.log(`Table missing/error: ${t}`, error.message)
        }
    }
}

run()
