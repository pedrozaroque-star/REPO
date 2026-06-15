import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
    console.log('Searching for "6854" in toast_employees...')
    
    // Search toast_employees
    const { data: emps, error: err1 } = await supabase
        .from('toast_employees')
        .select('*')
        .or('external_employee_id.eq.6854,passcode.eq.6854')
    
    console.log('Found in toast_employees:', emps)

    // Search users
    const { data: users, error: err2 } = await supabase
        .from('users')
        .select('*')
        .or('phone.ilike.%6854%')
    
    console.log('Found in users:', users)

    // Search punches
    console.log('Searching in punches for employee with 6854 in toast_id or similar...')
    const { data: punches, error: err3 } = await supabase
        .from('punches')
        .select('*')
        .eq('toast_id', '6854')
    console.log('Found in punches:', punches)
}

main()
