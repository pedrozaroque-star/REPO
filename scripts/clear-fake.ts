
import { getSupabaseClient } from '../lib/supabase'
import 'dotenv/config'

async function clearFakeData() {
    const supabase = await getSupabaseClient()

    // Clear today's data for Lynwood
    const { error } = await supabase
        .from('sales_daily_cache')
        .delete()
        .eq('business_date', '2026-01-25')
        .eq('store_id', '80a1ec95-bc73-402e-8884-e5abbe9343e6')

    if (error) console.error('Error clearing:', error)
    else console.log('Cleared fake 10k data.')
}

clearFakeData()
