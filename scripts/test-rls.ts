
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function testWithKey(role: string, key: string | undefined) {
    console.log(`\nTesting with ${role}...`)
    if (!key) {
        console.log(`Key for ${role} is missing!`)
        return
    }
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        key
    )

    const storeId = '8685e942-3f07-403a-afb6-faec697cd2cb'
    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('net_sales')
        .eq('store_id', storeId)
        .gte('business_date', '2026-01-22')
        .lte('business_date', '2026-02-18')

    if (error) {
        console.error(`Error with ${role}:`, error.message)
    } else {
        console.log(`${role} saw ${data?.length} rows. Total Sales: $${data?.reduce((a, b) => a + b.net_sales, 0).toFixed(0)}`)
    }
}

async function run() {
    await testWithKey('SERVICE_ROLE', process.env.SUPABASE_SERVICE_ROLE_KEY)
    await testWithKey('ANON', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

run()
