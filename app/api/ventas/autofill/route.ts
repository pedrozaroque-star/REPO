/**
 * @module api/ventas/autofill/route
 * @description Provides daily sales, labor, AM/PM shift breakdown, and 3rd-party delivery metrics to auto-fill the Weekly Operations and Monthly Reports.
 * @businessRules
 * - AM Shift (Apertura) sums hours 6:00 AM to 4:59 PM (hours 6 through 16).
 * - PM Shift (Cierre) sums hours 5:00 PM to 5:59 AM next day (hours 17..23 and 0..5).
 * - Maps delivery channels: Uber/Postmates, DoorDash, Grubhub, and EBT amounts.
 * - Aggregates multiple stores correctly when storeId is 'all'.
 * - Enforces authentication and authorization for store managers, supervisors, and admins.
 * @dataFlow
 * - Client (Reportes) -> GET /api/ventas/autofill -> Toast API (fetchToastData) -> JSON Daily Report Map.
 */

import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { verifyAuthToken } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        const cookieHeader = request.headers.get('cookie') || ''
        let token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : ''

        if (!token) {
            const match = cookieHeader.match(/teg_token=([^;]+)/)
            if (match) token = match[1]
        }

        if (!token) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const user = verifyAuthToken(token)
        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const storeId = searchParams.get('storeId')
        const start = searchParams.get('start') // YYYY-MM-DD (Monday)
        const end = searchParams.get('end') // YYYY-MM-DD (Sunday)

        if (!storeId || !start || !end) {
            return NextResponse.json({ error: 'Missing params (storeId, start, end)' }, { status: 400 })
        }

        // 1. Fetch Toast Data for the range
        const { rows, connectionError } = await fetchToastData({
            storeIds: storeId,
            startDate: start,
            endDate: end,
            groupBy: 'day',
            skipCache: false,
            allowDirtyCache: true
        })

        if (connectionError && rows.length === 0) {
            return NextResponse.json({ error: connectionError }, { status: 502 })
        }

        // 2. Transform and Aggregate to Report Format
        const dailyDataAcc: Record<string, {
            netSales: number
            totalHours: number
            laborCost: number
            orderCount: number
            guestCount: number
            uberSales: number
            doordashSales: number
            grubhubSales: number
            ebtAmount: number
            openSales: number
            closeSales: number
        }> = {}

        rows.forEach(row => {
            const dateStr = (row.periodStart || '').split(' ')[0]
            if (!dateStr) return

            // Exact AM & PM Shift Calculations
            // AM Shift = 6:00 AM - 4:59 PM (hours 6 to 16)
            const amHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
            const openShiftSales = amHours.reduce((sum, h) => sum + Number(row.hourlySales?.[h] || 0), 0)

            // PM Shift = 5:00 PM - 5:59 AM next day (hours 17..23 and 0..5)
            const pmHours = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
            const closeShiftSales = pmHours.reduce((sum, h) => sum + Number(row.hourlySales?.[h] || 0), 0)

            if (!dailyDataAcc[dateStr]) {
                dailyDataAcc[dateStr] = {
                    netSales: 0,
                    totalHours: 0,
                    laborCost: 0,
                    orderCount: 0,
                    guestCount: 0,
                    uberSales: 0,
                    doordashSales: 0,
                    grubhubSales: 0,
                    ebtAmount: 0,
                    openSales: 0,
                    closeSales: 0
                }
            }

            const curr = dailyDataAcc[dateStr]
            curr.netSales += Number(row.netSales || 0)
            curr.totalHours += Number(row.totalHours || 0)
            curr.laborCost += Number(row.laborCost || 0)
            curr.orderCount += Number(row.orderCount || 0)
            curr.guestCount += Number(row.guestCount || 0)
            curr.uberSales += Number(row.uberSales || 0)
            curr.doordashSales += Number(row.doordashSales || 0)
            curr.grubhubSales += Number(row.grubhubSales || 0)
            curr.ebtAmount += Number(row.ebtAmount || 0)
            curr.openSales += openShiftSales
            curr.closeSales += closeShiftSales
        })

        const formattedDailyData: Record<string, any> = {}
        Object.entries(dailyDataAcc).forEach(([dateStr, item]) => {
            const avgOrder = item.orderCount > 0 ? (item.netSales / item.orderCount).toFixed(2) : '0.00'
            const laborPct = item.netSales > 0 ? ((item.laborCost / item.netSales) * 100).toFixed(2) : '0.00'

            formattedDailyData[dateStr] = {
                actual_sales: item.netSales.toFixed(2),
                actual_hours: item.totalHours.toFixed(2),
                actual_labor: laborPct,
                actual_avg_order: avgOrder,
                daily_cars: item.guestCount.toString(),
                order_count: item.orderCount,
                sos_time: '', // Left clean unless dedicated drive-thru sensor timer is present
                uber_post: item.uberSales.toFixed(2),
                doordash: item.doordashSales.toFixed(2),
                grubhub: item.grubhubSales.toFixed(2),
                ebt: item.ebtAmount.toFixed(2),
                open_sales: item.openSales > 0 ? item.openSales.toFixed(2) : '0.00',
                close_sales: item.closeSales > 0 ? item.closeSales.toFixed(2) : '0.00'
            }
        })

        return NextResponse.json({
            data: formattedDailyData,
            meta: {
                storeId,
                period: `${start} to ${end}`,
                rowsFetched: rows.length,
                connectionError: connectionError || null
            }
        })

    } catch (e: any) {
        console.error("Auto-Fill Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
