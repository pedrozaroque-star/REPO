
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

async function verify2024() {
    console.log('🔍 Verifying 2024 Data (Q1)...')

    // Check Sales
    const { count: salesCount } = await supabase
        .from('sales_daily_cache')
        .select('*', { count: 'exact', head: true })
        .gte('business_date', '2024-01-01')
        .lte('business_date', '2024-03-31')

    // Check Punches
    const { count: punchCount } = await supabase
        .from('punches')
        .select('*', { count: 'exact', head: true })
        .gte('business_date', '2024-01-01')
        .lte('business_date', '2024-03-31')

    console.log(`📊 Sales Days (Q1 2024): ${salesCount}`)
    console.log(`🥊 Punches (Q1 2024): ${punchCount}`)

    if (salesCount && salesCount > 10 && punchCount && punchCount > 100) {
        console.log('✅ Data looks sufficient for Analysis.')
    } else {
        console.log('⚠️ Warning: Data might be sparse. Analysis may be inaccurate.')
    }
}

verify2024()
