import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET(request: Request) {
    // FORCE REBUILD 1 
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
            groupBy: 'day',
            skipCache: true // Force fresh fetch to get hourly details
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
                daily_cars: row.orderCount.toString(),

                // New Fields for Monthly Report
                uber_post: (row.uberSales || 0).toFixed(2),
                doordash: (row.doordashSales || 0).toFixed(2),
                grubhub: (row.grubhubSales || 0).toFixed(2),
                ebt: (row.ebtCount || 0).toString(), // Using Count per image analysis (no decimal)
                // ebt_amount: (row.ebtAmount || 0).toFixed(2), // Available if needed

                open_sales: (() => {
                    const order = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
                    for (const h of order) {
                        const val = row.hourlySales?.[h] || 0
                        if (val > 0) return val.toFixed(2)
                    }
                    return '0.00'
                })(),

                close_sales: (() => {
                    const order = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
                    // Search backwards
                    for (let i = order.length - 1; i >= 0; i--) {
                        const h = order[i]
                        const val = row.hourlySales?.[h] || 0
                        if (val > 0) return val.toFixed(2)
                    }
                    return '0.00'
                })()
            }
        })

        return NextResponse.json({
            data: dailyData,
            debug: {
                receivedStoreId: storeId,
                period: `${start} to ${end}`,
                rowsFetched: rows.length,
                connectionError: connectionError || 'None',
                sampleRow: rows.length > 0 ? rows[0] : 'N/A'
            }
        })

    } catch (e: any) {
        console.error("Auto-Fill Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
