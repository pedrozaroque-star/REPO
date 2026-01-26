
import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        // DEBUG: Force Lynwood ID to rule out payload issues
        const storeId = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
        // const { storeId } = body

        // Robust YYYY-MM-DD in LA Time
        const laDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
        // en-US gives MM/DD/YYYY usually. Let's parse.
        const [mm, dd, yyyy] = laDate.split('/')
        const todayStr = `${yyyy}-${mm}-${dd}`

        // Prepare Full ISO Range for Labor Sync
        const startIso = `${todayStr}T00:00:00.000+0000`
        const endIso = `${todayStr}T23:59:59.999+0000`

        console.log(`⚡ [LIVE SYNC] Triggered for Store ${storeId || 'ALL'} Date: ${todayStr}`)

        // 1. Sync Sales
        const salesPromise = fetchToastData({
            storeIds: storeId ? [storeId] : 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day'
        })

        // 2. Sync Labor (Punches)
        // Only if storeId is provided (optimization), otherwise loop?
        // syncToastPunches requires storeId.
        let laborPromise = Promise.resolve({ count: 0, success: true })

        if (storeId) {
            laborPromise = (syncToastPunches(storeId, startIso, endIso) as Promise<{ count: number, success: boolean }>)
        }

        const [salesRes, laborRes] = await Promise.all([salesPromise, laborPromise])

        if (salesRes.connectionError) {
            return NextResponse.json({ error: salesRes.connectionError }, { status: 502 })
        }

        return NextResponse.json({
            success: true,
            sales_records: salesRes.rows.length,
            labor_records: laborRes.count,
            sales_data: salesRes.rows.length > 0 ? salesRes.rows[0].netSales : 0,
            message: `Updated Live Data for ${todayStr}. Sales: ${salesRes.rows.length}, Punches: ${laborRes.count}`
        })

    } catch (error: any) {
        console.error('Live Sync Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
