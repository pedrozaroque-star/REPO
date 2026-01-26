
import { getSupabaseClient } from '../lib/supabase'
import 'dotenv/config'

async function testUpsert() {
    const supabase = await getSupabaseClient()

    const payload = {
        store_id: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
        store_name: 'Test Store',
        business_date: '2026-01-25',
        net_sales: 9999.99, // Fake value to see if it updates
        updated_at: new Date().toISOString()
    }

    // Try upsert with columns
    const { data, error } = await supabase
        .from('sales_daily_cache')
        .upsert(payload, { onConflict: 'store_id, business_date' })
        .select()

    if (error) {
        console.error('Upsert Error:', JSON.stringify(error, null, 2))
    } else {
        console.log('Upsert Success:', data)
    }
}

testUpsert()
