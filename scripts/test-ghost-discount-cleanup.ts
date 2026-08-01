import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function testGhostFilter() {
    // Clean up ghost duplicate row for Ticket #141 in database if desired
    const { data: dbRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-22')
        .ilike('store_name', '%West Covina%')
        .eq('check_id', '141')

    console.log('Ticket #141 DB Rows count:', dbRows?.length)

    // Test JS filtering logic
    const groupedByCheck: Record<string, any> = {}
    dbRows?.forEach(curr => {
        const checkKey = `${curr.store_name}_${curr.business_date}_${curr.check_id}`
        if (!groupedByCheck[checkKey]) {
            groupedByCheck[checkKey] = {
                check_id: curr.check_id,
                store_name: curr.store_name,
                discounts: []
            }
        }
        groupedByCheck[checkKey].discounts.push(curr)
    })

    const filtered = Object.values(groupedByCheck)
        .map((ticket: any) => {
            const types = Array.from(new Set(ticket.discounts.map((d: any) => d.discount_name)))
            const amounts = ticket.discounts.map((d: any) => Number(d.discount_amount))
            const isGhostDuplicate = types.length > 1 && amounts.length > 1 && amounts.every(a => Math.abs(a - amounts[0]) < 0.01)
            return {
                ...ticket,
                types,
                isGhostDuplicate
            }
        })
        .filter(ticket => ticket.types.length > 1 && !ticket.isGhostDuplicate)

    console.log('Filtered double discount tickets for Ticket #141:', filtered)
    console.log(`✅ Ticket #141 properly ignored? ${filtered.length === 0 ? 'YES' : 'NO'}`)
}

testGhostFilter()
