import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId')
    const start = searchParams.get('start') // YYYY-MM-DD (Monday)
    const end = searchParams.get('end') // YYYY-MM-DD (Sunday)

    if (!storeId || !start || !end) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    try {
        // Authenticate (Basic check)
        // In a real app, verify session here.

        // 1. Fetch Toast Data for the range
        // We group by 'day' to get daily breakdown
        const { rows, connectionError } = await fetchToastData({
            storeIds: storeId,
            startDate: start,
            endDate: end,
            groupBy: 'day'
        })

        if (connectionError && rows.length === 0) {
            return NextResponse.json({ error: connectionError }, { status: 502 })
        }

        // 2. Transform to Report Format
        // Result: { "2026-01-12": { actual_sales: 123, actual_hours: 40... } }
        const dailyData: Record<string, any> = {}

        rows.forEach(row => {
            // Toast row.periodStart is likely "2026-01-12 00:00:00" or just date depending on implementation
            // Our fetchToastData with groupBy='day' returns rows with periodStart as YYYY-MM-DD usually (check lib)
            // Looking at lib/toast-api.ts:
            // "rows.push({ ... periodStart: pStart ... })" where pStart is YYYY-MM-DD

            const dateStr = row.periodStart.split(' ')[0] // Safety split

            // Calculate Avg Order
            const avgOrder = row.orderCount > 0 ? (row.netSales / row.orderCount).toFixed(2) : '0.00'

            dailyData[dateStr] = {
                actual_sales: row.netSales.toFixed(2),
                actual_hours: row.totalHours.toFixed(2),
                actual_labor: row.laborPercentage.toFixed(2),
                actual_avg_order: avgOrder,
                // We can also infer 'daily_cars' using guestCount or orderCount if that's the proxy
                // The user excel says "DAILY CARS", usually derived from drive-thru sensors or guest counts.
                // We'll map 'daily_cars' to 'orderCount' for now as a proxy, user can edit.
                daily_cars: row.orderCount.toString()
            }
        })

        return NextResponse.json({ data: dailyData })

    } catch (e: any) {
        console.error("Auto-Fill Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
