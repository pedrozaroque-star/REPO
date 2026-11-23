/**
 * @module api/ventas/autofill/route
 * @description Provides daily sales, labor, AM/PM shift breakdown, and 3rd-party delivery metrics to auto-fill the Weekly Operations and Monthly Reports.
 * @businessRules
 * - AM Shift (Apertura) sums hours 6:00 AM to 4:59 PM (hours 6 through 16).
 * - PM Shift (Cierre) sums hours 5:00 PM to 5:59 AM next day (hours 17..23 and 0..5).
 * - Maps delivery channels: Uber/Postmates, DoorDash, Grubhub, and EBT amounts.
 * - Aggregates multiple stores correctly when storeId is 'all'.
 * - Enforces live-verified authentication (`getServerUser`) for store managers, supervisors, and admins.
 * @dataFlow
 * - Client (Reportes) -> GET /api/ventas/autofill -> Toast API (fetchToastData) -> JSON Daily Report Map.
 * @notes
 * - [2026-11-23] FIX CRÍTICO: (1) Autenticación vía `getServerUser(request)` (valida `is_active` y cookies limpiamente); (2) Validación estricta de fechas ISO y tope de 62 días; (3) Resolución de `storeId` numérico a Toast GUID; (4) Reemplazo del guard muerto `connectionError && rows.length === 0` por detección real de filas `hasError` (evita sobrescribir reportes con `$0.00` + HTTP 200); (5) Conservación de signos en `open_sales`/`close_sales` para cuadre ante cross-date refunds.
 */

import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { getServerUser } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { diffCalendarDays, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const AUTOFILL_ALLOWED_ROLES = ['admin', 'administrador', 'supervisor', 'manager', 'gerente', 'general_manager']

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK (live-verified active staff + cookie/header support)
        const user = await getServerUser(request)
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const role = (user.role || '').trim().toLowerCase()
        if (!AUTOFILL_ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const rawStoreId = (searchParams.get('storeId') || '').trim()
        const start = (searchParams.get('start') || '').trim()
        const end = (searchParams.get('end') || '').trim()

        if (!rawStoreId || !start || !end) {
            return NextResponse.json({ error: 'Missing params (storeId, start, end)' }, { status: 400 })
        }

        if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) {
            return NextResponse.json({ error: 'Invalid date range (YYYY-MM-DD required, start <= end)' }, { status: 400 })
        }

        if (diffCalendarDays(start, end) > 62) {
            return NextResponse.json({ error: 'Date range exceeds maximum of 62 days' }, { status: 400 })
        }

        // Resolve numeric stores.id -> Toast GUID (stores.external_id) so fallback lookup never breaks if Toast OAuth fails
        let resolvedStoreIds = rawStoreId
        if (rawStoreId.toLowerCase() !== 'all' && /^\d+$/.test(rawStoreId)) {
            const supabase = await getSupabaseAdminClient()
            const { data: st } = await supabase
                .from('stores')
                .select('external_id')
                .eq('id', Number(rawStoreId))
                .maybeSingle()
            if (st?.external_id) {
                resolvedStoreIds = st.external_id
            }
        }

        // 1. Fetch Toast Data for the range
        const { rows, connectionError } = await fetchToastData({
            storeIds: resolvedStoreIds,
            startDate: start,
            endDate: end,
            groupBy: 'day',
            skipCache: false,
            allowDirtyCache: true,
        })

        // Detect partial or complete Toast failure (fetchToastData returns $0 rows with hasError: true instead of empty [])
        const failedRows = rows.filter((r) => r.hasError)
        const healthyRows = rows.filter((r) => !r.hasError)

        if (failedRows.length > 0 || (connectionError && healthyRows.length === 0)) {
            return NextResponse.json(
                {
                    error: connectionError || `Toast API failed for ${failedRows.length} store-day(s); aborted autofill to prevent $0 overwrites`,
                },
                { status: 502 }
            )
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

        // AM Shift = 6:00 AM - 4:59 PM (hours 6 to 16)
        const amHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
        // PM Shift = 5:00 PM - 5:59 AM next day (hours 17..23 and 0..5)
        const pmHours = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

        healthyRows.forEach((row) => {
            const dateStr = (row.periodStart || '').split(' ')[0]
            if (!dateStr) return

            const openShiftSales = amHours.reduce((sum, h) => sum + Number(row.hourlySales?.[h] || 0), 0)
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
                    closeSales: 0,
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
                // Note: Toast sales_daily_cache stores Drive-Thru car count in guest_count
                daily_cars: item.guestCount.toString(),
                order_count: item.orderCount,
                sos_time: '',
                uber_post: item.uberSales.toFixed(2),
                doordash: item.doordashSales.toFixed(2),
                grubhub: item.grubhubSales.toFixed(2),
                ebt: item.ebtAmount.toFixed(2),
                open_sales: item.openSales.toFixed(2),
                close_sales: item.closeSales.toFixed(2),
            }
        })

        return NextResponse.json({
            data: formattedDailyData,
            meta: {
                storeId: resolvedStoreIds,
                period: `${start} to ${end}`,
                rowsFetched: healthyRows.length,
                connectionError: connectionError || null,
            },
        })
    } catch (e: any) {
        console.error('Auto-Fill Error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
