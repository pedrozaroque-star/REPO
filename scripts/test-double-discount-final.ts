import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function testFinalLogic() {
    console.log('=== Testing Final Double Discount Logic on Lynwood (2026-07-26) ===')
    const { data: rowsLynwood } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Lynwood%')

    const grouped: Record<string, any> = {}
    rowsLynwood?.forEach(curr => {
        const checkKey = `${curr.store_name}_${curr.business_date}_${curr.check_id}`
        if (!grouped[checkKey]) {
            grouped[checkKey] = {
                check_id: curr.check_id,
                store_name: curr.store_name,
                business_date: curr.business_date,
                cashier: curr.approver_name || curr.server_name,
                order_id: curr.order_id,
                store_id: curr.store_id,
                discounts: [],
                totalAmount: 0
            }
        }
        grouped[checkKey].discounts.push(curr)
        grouped[checkKey].totalAmount += Number(curr.discount_amount)
    })

    const doubleDiscountTickets = Object.values(grouped)
        .map((ticket: any) => {
            const types = Array.from(new Set(ticket.discounts.map((d: any) => d.discount_name)))
            const amounts = ticket.discounts.map((d: any) => Number(d.discount_amount))
            const isGhostDuplicate = types.length > 1 && amounts.length > 1 && amounts.every(a => Math.abs(a - amounts[0]) < 0.01)

            return {
                ...ticket,
                types,
                isGhostDuplicate,
                isMixed: types.length > 1
            }
        })
        .filter(ticket => ticket.types.length > 1 && !ticket.isGhostDuplicate)

    console.log('Double Discount Tickets found for Lynwood on 2026-07-26:', doubleDiscountTickets.length)
    doubleDiscountTickets.forEach(t => {
        console.log(`- Ticket #${t.check_id} (${t.cashier}): ${t.types.join(' + ')} -> Total: $${t.totalAmount.toFixed(2)}`)
    })
}

testFinalLogic()
