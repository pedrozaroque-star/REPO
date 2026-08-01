import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function sweepAndCleanAllDatabaseGhosts() {
    console.log('=== Sweeping and Cleaning ALL Ghost Duplicate Rows across the entire Database ===')

    // Fetch all rows from sales_discounts_log in chunks or total
    let allRows: any[] = []
    let page = 0
    while (true) {
        const { data } = await supabase
            .from('sales_discounts_log')
            .select('*')
            .range(page * 1000, (page + 1) * 1000 - 1)

        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        if (data.length < 1000) break
        page++
    }

    console.log(`Total rows in sales_discounts_log: ${allRows.length}`)

    const grouped: Record<string, any[]> = {}
    allRows.forEach(r => {
        const key = `${r.store_name}_${r.business_date}_${r.check_id}`
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
                const minAmt = Math.min(...amounts)

                // Identical ghost duplicate amounts (e.g. $9.93 + $9.93)
                const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)
                if (isGhost) {
                    items.slice(1).forEach(item => idsToDelete.push(item.id))
                    console.log(`🧹 Cleaning Ghost Duplicate in ${key}: Keeping 1, deleting ${items.length - 1}`)
                }
            }
        }
    })

    console.log(`Found ${idsToDelete.length} ghost duplicate rows to delete across the entire database.`)

    if (idsToDelete.length > 0) {
        // Delete in chunks of 500
        for (let i = 0; i < idsToDelete.length; i += 500) {
            const chunk = idsToDelete.slice(i, i + 500)
            const { error } = await supabase.from('sales_discounts_log').delete().in('id', chunk)
            console.log(`Deleted chunk ${i / 500 + 1}:`, error ? error.message : 'SUCCESS')
        }
    }

    console.log('\n✅ COMPLETE DATABASE CLEANUP FINISHED!')
}

sweepAndCleanAllDatabaseGhosts()
