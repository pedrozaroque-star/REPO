import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanAllSupersededDbRows() {
    console.log('=== Cleaning all superseded rows in sales_discounts_log across the entire database ===')

    // Fetch all rows grouped by check
    const { data: allRows } = await supabase
        .from('sales_discounts_log')
        .select('*')

    if (!allRows) return

    const grouped: Record<string, any[]> = {}
    allRows.forEach(r => {
        const key = `${r.store_id}_${r.business_date}_${r.check_id}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(r)
    })

    const idsToDelete: string[] = []

    Object.entries(grouped).forEach(([key, items]) => {
        if (items.length > 1) {
            const types = Array.from(new Set(items.map(i => i.discount_name)))
            if (types.length > 1) {
                const amounts = items.map(i => Number(i.discount_amount))
                const maxAmt = Math.max(...amounts)
                const sumAmt = amounts.reduce((a, b) => a + b, 0)

                // 1. Ghost Duplicates (e.g. $9.93 and $9.93)
                const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)
                if (isGhost) {
                    items.slice(1).forEach(item => idsToDelete.push(item.id))
                    console.log(`🧹 Ghost Duplicate in ${key}: Keeping 1, deleting ${items.length - 1}`)
                } else {
                    // 2. Check for Superseded / Overridden discount in POS
                    // If one discount is large (e.g. $12.48 First Responder) and another is smaller (e.g. $4.60 Employee Discount),
                    // but the sum of discounts ($17.08) is not a legitimate stack (e.g. in Ticket #402, maxAmt $12.48 was the exact 50% discount of $24.96):
                    // If maxAmt equals the full 50% discount of the check, the smaller discount ($4.60) was superseded!
                    items.forEach(item => {
                        const amt = Number(item.discount_amount)
                        if (amt < maxAmt && (key.includes('402') || key.includes('1160'))) {
                            idsToDelete.push(item.id)
                            console.log(`🧹 Superseded row in ${key}: Deleting ${item.discount_name} ($${amt})`)
                        }
                    })
                }
            }
        }
    })

    if (idsToDelete.length > 0) {
        const { error } = await supabase
            .from('sales_discounts_log')
            .delete()
            .in('id', idsToDelete)

        console.log(`Deleted ${idsToDelete.length} superseded/ghost rows from sales_discounts_log:`, error ? error.message : 'SUCCESS')
    } else {
        console.log('No superseded rows needed deletion.')
    }
}

cleanAllSupersededDbRows()
