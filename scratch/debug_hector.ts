
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    const { data: emps } = await supabase.from('toast_employees').select('*').ilike('first_name', '%H%ctor%')
    console.log('Found Employees:', emps?.map(e => `${e.first_name} ${e.last_name} (${e.id})`))
    
    if (emps && emps.length > 0) {
        const id = emps[0].id
        const { data: shifts } = await supabase.from('shifts').select('*').eq('employee_id', id).limit(5)
        console.log(`Shifts for ${emps[0].first_name}:`, shifts?.length)
    }
}

run()
