
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debugRaw() {
    console.log('🕵️‍♂️ Downloading raw sample for 2025...')

    // Get 5 random rows from mid-year to verify April-Dec existence
    const { data, error } = await supabase
        .from('sales_daily_cache') // Checking this table ONLY
        .select('store_id, business_date, net_sales')
        .gte('business_date', '2025-06-01') // Look specifically in the "supposed gap"
        .limit(5)

    if (error) {
        console.error('❌ Error:', error)
        return
    }

    if (!data || data.length === 0) {
        console.log('⚠️ No rows found after June 2025. The gap IS REAL.')
    } else {
        console.log('✅ Rows FOUND in June 2025! The Health Check is lying.')
        console.log('Sample Row 1:', data[0])
        console.log(`Store ID used: ${data[0].store_id}`)
    }
}

debugRaw()
