
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const STORE_ID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'

async function debugDate() {
    const date = '2024-04-02'
    console.log(`🔍 Inspecting ${date}...`)

    const { data: actual } = await supabase
        .from('sales_daily_cache')
        .select('hourly_tickets, hourly_data')
        .eq('store_id', STORE_ID)
        .eq('business_date', date)
        .single()

    console.log('Hourly Tickets Raw:', JSON.stringify(actual?.hourly_tickets, null, 2))
    console.log('Hourly Sales Raw:', JSON.stringify(actual?.hourly_data, null, 2))
}

debugDate()
