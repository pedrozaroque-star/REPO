/**
 * @module scripts/check-grubhub-orders
 * @description Inspects historical Grubhub orders in Toast API and sales_daily_cache to understand how items, modifiers, discounts and payments are structured.
 */
import { getSupabaseClient } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
    console.log('🔍 Checking Grubhub data in Supabase sales_daily_cache...')
    const supabase = await getSupabaseClient()
    
    // Check if any stores have registered grubhub_sales
    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('business_date, store_id, store_name, net_sales, grubhub_sales, uber_sales, doordash_sales')
        .gt('grubhub_sales', 0)
        .order('business_date', { ascending: false })
        .limit(15)

    if (error) {
        console.error('❌ Error querying sales_daily_cache:', error.message)
        return
    }

    console.log(`Found ${data?.length || 0} rows with grubhub_sales > 0:`)
    if (data && data.length > 0) {
        console.table(data)
    } else {
        console.log('No rows with grubhub_sales > 0 found in sales_daily_cache.')
        
        // Let's check recent rows in general to see delivery columns
        const { data: recent } = await supabase
            .from('sales_daily_cache')
            .select('business_date, store_name, net_sales, uber_sales, doordash_sales, grubhub_sales')
            .order('business_date', { ascending: false })
            .limit(10)
        console.log('Recent 10 rows in sales_daily_cache:')
        console.table(recent)
    }
}

main().catch(err => {
    console.error('Fatal:', err)
})
