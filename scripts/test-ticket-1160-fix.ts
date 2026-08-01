import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function testTicket1160Fix() {
    console.log('=== Testing Superseded Discount Filter on Ticket #1160 ===')

    // Delete superseded First Responder row (eb08fede-739d-44da-bb26-1aa63af04c85) for Ticket #1160
    const { error } = await supabase
        .from('sales_discounts_log')
        .delete()
        .eq('id', 'eb08fede-739d-44da-bb26-1aa63af04c85')

    console.log('Deleted superseded First Responder row for LA Central #1160:', error ? error.message : 'SUCCESS')

    // Fetch remaining rows for LA Central #1160
    const { data: remaining } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-28')
        .ilike('store_name', '%LA Central%')
        .eq('check_id', '1160')

    console.log('Remaining rows for Ticket #1160:', remaining)
}

testTicket1160Fix()
