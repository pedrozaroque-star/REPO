import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function cleanAllPaginatedGhosts() {
    console.log('=== Starting Full Paginated Ghost Cleaner across all 351,000+ rows ===')

    let allRows: any[] = []
    let page = 0
    while (true) {
        const { data, error } = await supabase
            .from('sales_discounts_log')
            .select('id, store_name, business_date, check_id, discount_name, discount_amount')
            .range(page * 50000, (page + 1) * 50000 - 1)

        if (!data || data.length === 0) break
        allRows = [...allRows, ...data]
        console.log(`Fetched page ${page + 1}: ${data.length} rows (total accumulated: ${allRows.length})`)
        if (data.length < 50000) break
        page++
    }

    console.log(`Total rows fetched: ${allRows.length}`)

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
                const isGhost = amounts.every(a => Math.abs(a - maxAmt) < 0.01)

                if (isGhost) {
                    items.slice(1).forEach(item => idsToDelete.push(item.id))
                }
            }
        }
    })

    console.log(`Total ghost duplicate rows identified across all 351,000+ records: ${idsToDelete.length}`)

    if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 1000) {
            const chunk = idsToDelete.slice(i, i + 1000)
            const { error } = await supabase.from('sales_discounts_log').delete().in('id', chunk)
            if (error) console.error(`Error deleting chunk ${i / 1000 + 1}:`, error.message)
            else console.log(`Deleted chunk ${i / 1000 + 1} (${chunk.length} rows)`)
        }
    }

    console.log('✅ COMPLETE SYSTEM CLEANUP FINISHED!')
}

cleanAllPaginatedGhosts()
