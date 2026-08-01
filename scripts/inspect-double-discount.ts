import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspectOrder940() {
    const { data, error } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Lynwood%')

    console.log(`Total discounts for Lynwood on 2026-07-26: ${data?.length}`)

    const matches = data?.filter(d => d.check_id === '940' || d.order_id?.includes('940'))
    console.log('Matches for check_id 940:', matches)

    // Group by check_id / order_id for Lynwood on 2026-07-26 to find multiple discounts on the same check!
    const byCheck: Record<string, any[]> = {}
    data?.forEach(d => {
        const key = d.check_id || d.order_id || 'unknown'
        if (!byCheck[key]) byCheck[key] = []
        byCheck[key].push(d)
    })

    const doubleDiscounts = Object.entries(byCheck).filter(([_, items]) => items.length > 1)
    console.log(`Checks with multiple discounts (Lynwood 2026-07-26): ${doubleDiscounts.length}`)
    doubleDiscounts.slice(0, 5).forEach(([checkId, items]) => {
        console.log(`\nCheck ID ${checkId} has ${items.length} discounts:`)
        items.forEach(it => {
            console.log(`  - ${it.discount_name}: $${it.discount_amount} (Approver: ${it.approver_name || it.server_name})`)
        })
    })
}

inspectOrder940()
