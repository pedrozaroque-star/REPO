import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function verifyTickets() {
    console.log('=== Checking Ticket #940 (Lynwood 2026-07-26) ===')
    const { data: rows940 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Lynwood%')
        .eq('check_id', '940')

    console.log('Ticket #940 Rows:', rows940)
    if (rows940) {
        const sum940 = rows940.reduce((sum, r) => sum + Number(r.discount_amount), 0)
        console.log(`Ticket #940 Total Sum of Discounts: $${sum940.toFixed(2)}`)
    }
}

verifyTickets()
