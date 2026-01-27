
import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        // DEBUG: Force Lynwood ID to rule out payload issues
        const { storeId } = body

        // Robust YYYY-MM-DD in LA Time with Business Day Awareness
        const now = new Date()
        const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // If < 4 AM, belongs to Previous Business Day
        if (laTime.getHours() < 4) {
            laTime.setDate(laTime.getDate() - 1)
        }

        const yyyy = laTime.getFullYear()
        const mm = String(laTime.getMonth() + 1).padStart(2, '0')
        const dd = String(laTime.getDate()).padStart(2, '0')
        const todayStr = `${yyyy}-${mm}-${dd}`

        // Calculate Next Day for the End Range
        const nextDay = new Date(laTime)
        nextDay.setDate(nextDay.getDate() + 1)
        const yyyy2 = nextDay.getFullYear()
        const mm2 = String(nextDay.getMonth() + 1).padStart(2, '0')
        const dd2 = String(nextDay.getDate()).padStart(2, '0')
        const tomorrowStr = `${yyyy2}-${mm2}-${dd2}`

        // Range: From 00:00 UTC (Business Day Start - Buffer) to 12:00 UTC Next Day (4am LA Next Day)
        const startIso = `${todayStr}T00:00:00.000+0000`
        const endIso = `${tomorrowStr}T12:00:00.000+0000`

        console.log(`⚡ [LIVE SYNC] Triggered for Store ${storeId || 'ALL'} Date: ${todayStr}`)

        // 1. Sync Sales
        const salesPromise = fetchToastData({
            storeIds: storeId ? storeId : 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            fastMode: false, // Switch to Full Mode for precision parity with Sales Page
            skipCache: true,
            readOnly: true
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
