
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkLynwood() {
    // Buscar ID de Lynwood
    const { data: store } = await supabase.from('stores').select('external_id').ilike('name', '%Lynwood%').single()
    if (!store) return console.log('No store found')

    const { data } = await supabase
        .from('sales_daily_cache')
        .select('business_date, hourly_data')
        .eq('store_id', store.external_id)
        .eq('business_date', '2025-01-06') // Un Lunes
        .single()

    console.log('Lynwood 2025-01-06 (Monday):')
    console.log(JSON.stringify(data?.hourly_data, null, 2))
}

checkLynwood()
