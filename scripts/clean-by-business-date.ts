import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanByBusinessDate() {
    console.log('=== Fetching all distinct business_date entries ===')

    // Get all distinct dates using RPC or paginated distinct
    let dates: string[] = []
    let p = 0
    while (true) {
        const { data } = await supabase.from('sales_discounts_log').select('business_date').range(p * 1000, (p + 1) * 1000 - 1)
        if (!data || data.length === 0) break
        data.forEach(d => { if (d.business_date) dates.push(d.business_date) })
        if (data.length < 1000) break
        p++
    }

    const uniqueDates = Array.from(new Set(dates)).sort()
    console.log(`Auditing ${uniqueDates.length} business dates...`)

    let totalDeleted = 0

    for (const bDate of uniqueDates) {
        const { data: rows } = await supabase
            .from('sales_discounts_log')
            .select('id, store_name, business_date, check_id, discount_name, discount_amount')
            .eq('business_date', bDate)

        if (!rows || rows.length < 2) continue

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
                    const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)

                    if (isGhost) {
                        items.slice(1).forEach(item => idsToDelete.push(item.id))
                        console.log(`🧹 Ghost in ${bDate} ${key}: ${types.join(' + ')} ($${maxAmt})`)
                    }
                }
            }
        })

        if (idsToDelete.length > 0) {
            const { error } = await supabase.from('sales_discounts_log').delete().in('id', idsToDelete)
            if (!error) totalDeleted += idsToDelete.length
        }
    }

    console.log(`\n🎉 TOTAL HISTORICAL GHOST ROWS CLEANED: ${totalDeleted}`)
}

cleanByBusinessDate()
