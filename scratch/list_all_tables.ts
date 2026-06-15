import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data, error } = await supabase.rpc('get_tables') // Or direct query to schemas if get_tables is not exposed
  if (error) {
    // If RPC doesn't exist, let's query the system tables via a general query if possible
    console.error('Error with RPC:', error.message)
    // Let's do a select from information_schema
    const { data: tables, error: sqlError } = await supabase.from('pg_tables' as any).select('tablename').eq('schemaname', 'public')
    if (sqlError) {
      console.error('Error querying pg_tables:', sqlError.message)
      return
    }
    console.log('Tables:', tables.map((t: any) => t.tablename))
  } else {
    console.log('Tables:', data)
  }
}

run()
