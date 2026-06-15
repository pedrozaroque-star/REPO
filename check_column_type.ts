import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkColumnType() {
  const query = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bc_todos' AND column_name = 'position'"
  const { data, error } = await supabase.rpc('execute_sql', { query_text: query })

  if (error) {
    console.error('Error executing SQL:', error)
  } else {
    console.log('Column Type Info:', data)
  }
}

checkColumnType()
