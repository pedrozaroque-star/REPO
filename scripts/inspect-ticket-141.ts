import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function inspectTicket141() {
    console.log('=== Inspecting sales_discounts_log for Ticket #141 (West Covina, 2026-07-22) ===')
    const { data: dbRows, error } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-22')
        .ilike('store_name', '%West Covina%')
        .eq('check_id', '141')

    console.log('Rows in sales_discounts_log:', dbRows)

    if (dbRows && dbRows.length > 0) {
        const orderId = dbRows[0].order_id
        const storeId = dbRows[0].store_id
        console.log(`\n=== Fetching order from Toast API (order_id: ${orderId}) ===`)
        
        // Fetch store external ID or use Toast API endpoint logic
        const { data: store } = await supabase.from('stores').select('*').eq('id', storeId).single()
        const toastStoreId = store?.toast_store_id
        console.log('Toast store ID:', toastStoreId)

        if (toastStoreId) {
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
}

inspectTicket141()
