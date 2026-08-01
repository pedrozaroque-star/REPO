import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanGhostRows() {
    console.log('=== Cleaning Ghost Duplicate Rows in sales_discounts_log ===')

    // Delete the duplicate First Responder row for West Covina Ticket #141 (2026-07-22)
    const { error: err1 } = await supabase
        .from('sales_discounts_log')
        .delete()
        .eq('id', 'fe951093-d73b-4275-b693-4efbe5c695b2')

    console.log('Deleted West Covina Ticket #141 ghost row:', err1 ? err1.message : 'SUCCESS')

    // Delete Hollywood Ticket #402 ghost row if duplicate
    const { data: hwRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-22')
        .ilike('store_name', '%Hollywood%')
        .eq('check_id', '402')

    if (hwRows && hwRows.length > 1) {
        console.log('Hollywood #402 rows:', hwRows)
        // Delete second duplicate row
        const { error: err2 } = await supabase
            .from('sales_discounts_log')
            .delete()
            .eq('id', hwRows[1].id)
        console.log('Deleted Hollywood #402 ghost row:', err2 ? err2.message : 'SUCCESS')
    }
}

cleanGhostRows()
