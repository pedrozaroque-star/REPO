
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkSchema() {
    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error:', error)
        return
    }
    console.log('Columns in sales_daily_cache:', Object.keys(data[0] || {}))
}

checkSchema()
