
import { getSupabaseClient } from '../lib/supabase'
import 'dotenv/config'

async function check() {
    const supabase = await getSupabaseClient()

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('*')
        .eq('business_date', '2026-01-25')
        .eq('store_id', '80a1ec95-bc73-402e-8884-e5abbe9343e6')

    console.log('Error:', error)
    console.log('Data:', data)
}

check()
