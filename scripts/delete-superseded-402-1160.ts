import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function deleteSpecificSuperseded() {
    console.log('=== Deleting superseded row for Ticket #402 (Hollywood) and #1160 (LA Central) ===')

    // Delete Employee Discount ($4.60) for Ticket #402 (id: e6d8b910-0efa-4f26-b710-3292b3b27e5e)
    const { error: e1 } = await supabase
        .from('sales_discounts_log')
        .delete()
        .eq('id', 'e6d8b910-0efa-4f26-b710-3292b3b27e5e')
    console.log('Deleted Hollywood #402 superseded row:', e1 ? e1.message : 'SUCCESS')

    // Delete First Responder ($4.84) for Ticket #1160 (id: 93f6fae9-0740-4180-a4e4-aefffee899e6)
    const { error: e2 } = await supabase
        .from('sales_discounts_log')
        .delete()
        .eq('id', '93f6fae9-0740-4180-a4e4-aefffee899e6')
    console.log('Deleted LA Central #1160 superseded row:', e2 ? e2.message : 'SUCCESS')
}

deleteSpecificSuperseded()
