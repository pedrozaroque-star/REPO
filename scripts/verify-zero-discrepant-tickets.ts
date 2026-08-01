import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function verifyZeroDiscrepancies() {
    console.log('=== Final Verification Audit across sales_discounts_log ===')

    const { data: allRows } = await supabase
        .from('sales_discounts_log')
        .select('*')

    if (!allRows) return

    const grouped: Record<string, any[]> = {}
    allRows.forEach(r => {
        const key = `${r.store_name}_${r.business_date}_${r.check_id}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(r)
    })

    let discrepanciesFound = 0

    Object.entries(grouped).forEach(([key, items]) => {
        if (items.length > 1) {
            const types = Array.from(new Set(items.map(i => i.discount_name)))
            if (types.length > 1) {
                const amounts = items.map(i => Number(i.discount_amount))
                const maxAmt = Math.max(...amounts)
                const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)

                // Check if one discount is a single 50% discount and another is smaller (like #402 or #1160)
                if (isGhost) {
                    discrepanciesFound++
                    console.log(`🚨 Discrepancy Found in ${key}: Ghost duplicate (${types.join(' + ')})`)
                }
            }
        }
    })

    console.log(`\nFINAL RESULT: ${discrepanciesFound} remaining discrepancies across ${allRows.length} total rows in sales_discounts_log.`)
}

verifyZeroDiscrepancies()
