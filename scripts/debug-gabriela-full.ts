
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkEmployeeFull() {
    const { data: employees } = await supabase
        .from('toast_employees')
        .select('*')
        .eq('email', 'gabyalta08@gmail.com')

    if (employees && employees.length > 0) {
        console.log('Datos completos de Gabriela:')
        console.log(JSON.stringify(employees[0], null, 2))
    }
}

checkEmployeeFull()
