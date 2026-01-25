
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkTicketColumn() {
    console.log('🔍 Checking Ticket Data for 2024...')

    const { data, error } = await supabase
        .from('sales_daily_cache')
        .select('business_date, hourly_tickets')
        .eq('business_date', '2024-01-01')
        .limit(1)

    if (data && data.length > 0) {
        console.log('Row:', JSON.stringify(data[0], null, 2))
    } else {
        console.log('No data found.')
    }
}

checkTicketColumn()
