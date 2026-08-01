import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanRemainingDiscrepancies() {
    console.log('=== Cleaning 2 historical ghost rows on 2026-07-10 ===')

    // Clean Bell #298 (2026-07-10)
    const { data: bellRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-10')
        .ilike('store_name', '%Bell%')
        .eq('check_id', '298')

    if (bellRows && bellRows.length > 1) {
        const { error } = await supabase.from('sales_discounts_log').delete().eq('id', bellRows[1].id)
        console.log('Deleted Bell #298 ghost row:', error ? error.message : 'SUCCESS')
    }

    // Clean LA Central #121 (2026-07-10)
    const { data: lacRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-10')
        .ilike('store_name', '%LA Central%')
        .eq('check_id', '121')

    if (lacRows && lacRows.length > 1) {
        const { error } = await supabase.from('sales_discounts_log').delete().eq('id', lacRows[1].id)
        console.log('Deleted LA Central #121 ghost row:', error ? error.message : 'SUCCESS')
    }
}

cleanRemainingDiscrepancies()
