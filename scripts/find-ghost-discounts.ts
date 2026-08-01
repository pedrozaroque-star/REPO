import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function findGhostDiscounts() {
    console.log('=== Searching for Ghost Duplicates in sales_discounts_log for 2026-07-22 ===')
    const { data: allRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-22')

    if (!allRows) return

    const grouped: Record<string, any[]> = {}
    allRows.forEach(r => {
        const key = `${r.store_name}_${r.business_date}_${r.order_id || r.check_id}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(r)
    })

    let ghostCount = 0
    Object.entries(grouped).forEach(([key, items]) => {
        if (items.length > 1) {
            const types = Array.from(new Set(items.map(i => i.discount_name)))
            if (types.length > 1) {
                const amounts = items.map(i => Number(i.discount_amount))
                const maxAmt = Math.max(...amounts)
                const minAmt = Math.min(...amounts)
                if (maxAmt === minAmt && maxAmt > 0) {
                    ghostCount++
                    console.log(`🚨 Ghost Duplicate: ${items[0].store_name} Check #${items[0].check_id} -> ${types.join(' + ')} (both $${maxAmt})`)
                }
            }
        }
    })

    console.log(`Total Ghost Duplicates on 2026-07-22: ${ghostCount}`)
}

findGhostDiscounts()
