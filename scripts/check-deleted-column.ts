
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    const { data, error } = await supabase
        .from('toast_employees')
        .select('deleted, is_deleted, status')
        .limit(1)

    if (error) console.error('Column check error:', error)
    else console.log('Columns found:', data?.[0])
}

check()
