
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    // Try to select just deleted and status
    // If status doesn't exist, this will error, letting us know.
    const { data, error } = await supabase
        .from('toast_employees')
        .select('deleted')
        .limit(1)

    if (error) {
        console.error('Deleted column check error:', error)
    } else {
        console.log('Deleted column exists. Sample:', data?.[0])
    }

    const { data: stData, error: stError } = await supabase
        .from('toast_employees')
        .select('status')
        .limit(1)

    if (stError) {
        console.log('Status column check:', stError.message)
    } else {
        console.log('Status column exists. Sample:', stData?.[0])
    }
}

check()
