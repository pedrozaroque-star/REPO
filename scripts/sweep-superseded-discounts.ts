import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function sweepSupersededDiscounts() {
    console.log('=== Sweeping Superseded Discounts for 2026-07-26 ===')
    const { data: rows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')

    const grouped: Record<string, any[]> = {}
    rows?.forEach(curr => {
        const key = `${curr.store_name}_${curr.check_id}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(curr)
    })

    const doubleTickets: string[] = []
    Object.entries(grouped).forEach(([key, items]) => {
        const types = Array.from(new Set(items.map(i => i.discount_name)))
        if (types.length > 1) {
            doubleTickets.push(`${key}: ${types.join(' + ')} (total: $${items.reduce((s, x) => s + Number(x.discount_amount), 0).toFixed(2)})`)
        }
    })

    console.log('All Double Discount Tickets on 2026-07-26 across all stores:', doubleTickets)
}

sweepSupersededDiscounts()
