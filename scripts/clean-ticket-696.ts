import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanTicket696() {
    console.log('=== Deleting Superseded Row for Santa Ana Ticket #696 ===')
    const { error } = await supabase
        .from('sales_discounts_log')
        .delete()
        .eq('id', '422103ae-7e11-41b2-a928-a753a6393d67')

    console.log('Deleted 25% Catering superseded row for Ticket #696:', error ? error.message : 'SUCCESS')

    const { data: remaining } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Santa Ana%')
        .eq('check_id', '696')

    console.log('Remaining rows for Ticket #696:', remaining)
}

cleanTicket696()
