import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data: employees, error } = await supabase.from('toast_employees').select('*').limit(1)
  if (error) {
    console.error('Error fetching employees:', error)
    return
  }
  if (employees && employees.length > 0) {
    console.log('--- EMPLOYEE COLUMNS ---')
    console.log(Object.keys(employees[0]))
    console.log('Sample employee:', JSON.stringify(employees[0], null, 2))
  } else {
    console.log('No employees found')
  }
}

run()
