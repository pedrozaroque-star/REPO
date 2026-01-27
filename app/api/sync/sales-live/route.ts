
import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        // DEBUG: Force Lynwood ID to rule out payload issues
        const { storeId } = body

        // Robust YYYY-MM-DD in LA Time
        const now = new Date()
        const laDate = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
        const [mm, dd, yyyy] = laDate.split('/')
        const todayStr = `${yyyy}-${mm}-${dd}`

        // Calculate Next Day for the End Range to cover full LA Business Day
        // Midnight LA (00:00) is 08:00 UTC.
        // End of Day LA (23:59) is 07:59 UTC Next Day.
        // To be safe, we query until Noon UTC next day.
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const laTomorrow = tomorrow.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
        const [mm2, dd2, yyyy2] = laTomorrow.split('/')
        const tomorrowStr = `${yyyy2}-${mm2}-${dd2}`

        // Range: From 00:00 UTC (4pm Prev Day LA) to 12:00 UTC Next Day (4am Next Day LA)
        // This safely covers the entire operating window.
        const startIso = `${todayStr}T00:00:00.000+0000`
        const endIso = `${tomorrowStr}T12:00:00.000+0000`

        console.log(`⚡ [LIVE SYNC] Triggered for Store ${storeId || 'ALL'} Date: ${todayStr}`)

        // 1. Sync Sales
        const salesPromise = fetchToastData({
            storeIds: storeId ? storeId : 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            fastMode: true,
            skipCache: true
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
