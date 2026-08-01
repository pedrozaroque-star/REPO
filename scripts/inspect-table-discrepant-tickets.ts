import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspectDiscrepantTickets() {
    console.log('=== Inspecting Tickets #228, #402, #507, #1160 in sales_discounts_log ===')

    // Hollywood Ticket #402 on 2026-07-27
    const { data: hw402 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-27')
        .ilike('store_name', '%Hollywood%')
        .eq('check_id', '402')
    console.log('\nHollywood Ticket #402 (2026-07-27):', hw402)

    // Azusa Ticket #228 on 2026-07-28
    const { data: az228 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-28')
        .ilike('store_name', '%Azusa%')
        .eq('check_id', '228')
    console.log('\nAzusa Ticket #228 (2026-07-28):', az228)

    // South Gate Ticket #507 on 2026-07-28
    const { data: sg507 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-28')
        .ilike('store_name', '%South Gate%')
        .eq('check_id', '507')
    console.log('\nSouth Gate Ticket #507 (2026-07-28):', sg507)

    // LA Central Ticket #1160 on 2026-07-28
    const { data: lac1160 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-28')
        .ilike('store_name', '%LA Central%')
        .eq('check_id', '1160')
    console.log('\nLA Central Ticket #1160 (2026-07-28):', lac1160)
}

inspectDiscrepantTickets()
