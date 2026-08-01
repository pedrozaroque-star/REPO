import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspectTicket1160() {
    console.log('=== Inspecting sales_discounts_log for Ticket #1160 (LA Central, 2026-07-28) ===')
    const { data: dbRows } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-28')
        .ilike('store_name', '%LA Central%')
        .eq('check_id', '1160')

    console.log('Rows in sales_discounts_log for Ticket #1160:', dbRows)

    if (dbRows && dbRows.length > 0) {
        const orderId = dbRows[0].order_id
        const storeId = dbRows[0].store_id
        console.log(`\n=== Fetching order from Toast API via endpoint (order_id: ${orderId}) ===`)
        const res = await fetch(`https://teg-modernizado.vercel.app/api/toast-order-detail?guid=${orderId}&storeId=${storeId}`)
        const orderDetail = await res.json()
        console.log('Order Detail checks appliedDiscounts:', JSON.stringify(orderDetail?.order?.checks?.[0]?.appliedDiscounts, null, 2))
        console.log('Order Detail selections appliedDiscounts:', JSON.stringify(
            orderDetail?.order?.checks?.[0]?.selections?.flatMap((s: any) => s.appliedDiscounts || []),
            null,
            2
        ))
    }
}

inspectTicket1160()
