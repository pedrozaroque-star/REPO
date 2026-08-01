import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function testRefinedLogic() {
    const { data: discounts } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Lynwood%')

    if (!discounts) return

    const groupedByCheck = discounts.reduce((acc, curr) => {
        const checkKey = curr.order_id && curr.order_id !== 'N/A' 
            ? `${curr.store_name}_${curr.business_date}_${curr.order_id}`
            : `${curr.store_name}_${curr.business_date}_check_${curr.check_id}`;

        if (!acc[checkKey]) {
            acc[checkKey] = {
                order_id: curr.order_id,
                check_id: curr.check_id,
                store_name: curr.store_name,
                store_id: curr.store_id,
                business_date: curr.business_date,
                opened_date: curr.opened_date,
                cashier: curr.approver_name || curr.server_name || 'Autoservicio',
                discounts: [] as any[],
                totalAmount: 0
            }
        }
        acc[checkKey].discounts.push(curr)
        acc[checkKey].totalAmount += Number(curr.discount_amount)
        return acc
    }, {} as Record<string, any>)

    const doubleDiscountTickets = Object.values(groupedByCheck)
        .map(ticket => {
            const types = Array.from(new Set(ticket.discounts.map((d: any) => d.discount_name)))
            return {
                ...ticket,
                types,
                isMixed: types.length > 1
            }
        })
        .filter(ticket => ticket.types.length > 1) // Solo incluir si tiene 2+ tipos DISTINTOS de descuento
        .sort((a, b) => b.totalAmount - a.totalAmount)

    console.log(`\n=== PRUEBA DE REGLA: 2+ TIPOS DIFERENTES DE DESCUENTO (Lynwood 2026-07-26) ===`)
    console.log(`Total Órdenes con 2+ TIPOS DIFERENTES de descuento: ${doubleDiscountTickets.length}`)
    
    doubleDiscountTickets.forEach(t => {
        console.log(`- Ticket #${t.check_id} (${t.cashier}): ${t.types.join(' + ')} -> Total: $${t.totalAmount.toFixed(2)}`)
    })
}

testRefinedLogic()
