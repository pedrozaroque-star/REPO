
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkData() {
    console.log('🔍 Checking July Data...')

    const { count, error } = await supabase
        .from('sales_daily_cache')
        .select('*', { count: 'exact', head: true })
        .gte('business_date', '2025-07-01')
        .lte('business_date', '2025-07-31')

    if (error) console.error('Error:', error)
    else console.log(`Found ${count} rows for July 2025.`)
}

checkData()
