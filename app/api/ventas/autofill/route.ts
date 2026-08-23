/**
 * @module api/ventas/autofill/route
 * @description Provides daily sales, labor, AM/PM shift breakdown, and 3rd-party delivery metrics to auto-fill the Weekly Operations and Monthly Reports.
 * @businessRules
 * - AM Shift (Apertura) sums hours 6:00 AM to 4:59 PM (hours 6 through 16).
 * - PM Shift (Cierre) sums hours 5:00 PM to 5:59 AM next day (hours 17..23 and 0..5).
 * - Maps delivery channels: Uber/Postmates, DoorDash, Grubhub, and EBT amounts.
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
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
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

        // 2. Transform to Report Format
        const dailyData: Record<string, any> = {}

        rows.forEach(row => {
            const dateStr = (row.periodStart || '').split(' ')[0]
            if (!dateStr) return

            const avgOrder = row.orderCount > 0 ? (row.netSales / row.orderCount).toFixed(2) : '0.00'

            // Exact AM & PM Shift Calculations
            // AM Shift = 6:00 AM - 4:59 PM (hours 6 to 16)
            const amHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
            const openShiftSales = amHours.reduce((sum, h) => sum + Number(row.hourlySales?.[h] || 0), 0)

            // PM Shift = 5:00 PM - 5:59 AM next day (hours 17..23 and 0..5)
            const pmHours = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]
            const closeShiftSales = pmHours.reduce((sum, h) => sum + Number(row.hourlySales?.[h] || 0), 0)

            dailyData[dateStr] = {
                actual_sales: (row.netSales || 0).toFixed(2),
                actual_hours: (row.totalHours || 0).toFixed(2),
                actual_labor: (row.laborPercentage || 0).toFixed(2),
                actual_avg_order: avgOrder,
                daily_cars: (row.guestCount || 0).toString(),
                order_count: row.orderCount || 0,
                sos_time: '', // Left clean unless dedicated drive-thru sensor timer is present
                uber_post: (row.uberSales || 0).toFixed(2),
                doordash: (row.doordashSales || 0).toFixed(2),
                grubhub: (row.grubhubSales || 0).toFixed(2),
                ebt: (row.ebtAmount || 0).toFixed(2),
                open_sales: openShiftSales > 0 ? openShiftSales.toFixed(2) : '0.00',
                close_sales: closeShiftSales > 0 ? closeShiftSales.toFixed(2) : '0.00'
            }
        })

        return NextResponse.json({
            data: dailyData,
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
