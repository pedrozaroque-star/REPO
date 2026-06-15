import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: jobs, error } = await supabase.from('toast_jobs').select('*')
  if (error) {
    console.error('Error fetching jobs:', error)
    return
  }
  console.log('--- JOBS LIST ---')
  console.log(JSON.stringify(jobs, null, 2))
}

run()
