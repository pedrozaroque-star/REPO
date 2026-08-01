import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspectTicket696() {
    console.log('=== Inspecting Ticket #696 (Santa Ana, 2026-07-26) ===')
    const { data: rows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Santa Ana%')
        .eq('check_id', '696')

    console.log('Rows in sales_discounts_log for Ticket #696:', rows)
}

inspectTicket696()
