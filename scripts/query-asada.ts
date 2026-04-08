import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
    const { data: store } = await supabase.from('stores').select('id').ilike('name', '%slauson%').single()
    const { data } = await supabase.from('meat_consumption_history')
        .select('*')
        .eq('business_date', '2026-04-06')
        .eq('interval_start', '15:00:00')
        .eq('store_id', store?.id)
        .eq('meat_type', 'ASADA')
    
    console.log('NEW ASADA LBS:', data)
}

main().then(() => process.exit(0))
