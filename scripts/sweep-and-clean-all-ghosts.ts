import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function sweepAndCleanAllGhosts() {
    console.log('=== Initiating Full Database Audit across all dates for sales_discounts_log ===')

    // Fetch all discount logs in batches or by business_date
    // First, let's get distinct business dates from sales_discounts_log
    const { data: dateRows } = await supabase
        .from('sales_discounts_log')
        .select('business_date')
        .order('business_date', { ascending: false })

    if (!dateRows) return

    const uniqueDates = Array.from(new Set(dateRows.map(r => r.business_date)))
    console.log(`Found ${uniqueDates.length} distinct business dates in sales_discounts_log:`, uniqueDates)

    let totalGhostsDeleted = 0
    let totalGhostsFound = 0

    for (const bDate of uniqueDates) {
        const { data: rows } = await supabase
            .from('sales_discounts_log')
            .select('*')
            .eq('business_date', bDate)

        if (!rows || rows.length === 0) continue

        const grouped: Record<string, any[]> = {}
        rows.forEach(r => {
            const key = `${r.store_name}_${r.check_id}`
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

                    // Case A: Identical Ghost Duplicates (e.g. $9.93 + $9.93)
                    const isGhostDuplicate = amounts.every(a => Math.abs(a - maxAmt) < 0.01)
                    if (isGhostDuplicate) {
                        totalGhostsFound++
                        // Keep the first row, delete remaining duplicates
                        items.slice(1).forEach(item => idsToDelete.push(item.id))
                        console.log(`🧹 Ghost Duplicate in ${bDate} ${key}: Keeping 1 row, deleting ${items.length - 1} ghost row(s) (${types.join(' + ')})`)
                    }
                }
            }
        })

        if (idsToDelete.length > 0) {
            const { error } = await supabase
                .from('sales_discounts_log')
                .delete()
                .in('id', idsToDelete)

            if (!error) {
                totalGhostsDeleted += idsToDelete.length
            } else {
                console.error(`Error deleting ghosts for ${bDate}:`, error.message)
            }
        }
    }

    console.log(`\n✅ DATABASE AUDIT FINISHED: Found ${totalGhostsFound} ghost tickets, deleted ${totalGhostsDeleted} ghost rows.`)
}

sweepAndCleanAllGhosts()
