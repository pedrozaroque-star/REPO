/**
 * @module api/sync/sales-live/route
 * @description Triggers on-demand live synchronization of sales and labor punches from Toast API for the current business day and persists to database.
 * @businessRules
 * - Day rollover boundary is 6:00 AM PST/PDT.
 * - Captures labor punches from 00:00 UTC through 14:00 UTC next day (7:00 AM PDT) ensuring no early morning punch cutoffs.
 * - Writes live sales records atomically to sales_daily_cache.
 * @dataFlow
 * - Client / Background Sync -> POST /api/sync/sales-live -> Toast API & syncToastPunches -> Supabase -> Response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'
import { verifyAuthToken } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        // Authenticate request
        const authHeader = request.headers.get('Authorization')
        const cookieToken = request.cookies.get('teg_token')?.value
        const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : cookieToken

        if (!token) {
            return NextResponse.json({ error: 'Missing Authentication Token' }, { status: 401 })
        }

        const user = verifyAuthToken(token)
        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const body = await request.json()
        const { storeId } = body

        // Robust YYYY-MM-DD in LA Time with Business Day Awareness
        const now = new Date()
        const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))

        // If < 6 AM, belongs to Previous Business Day
        if (laTime.getHours() < 6) {
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

        // Range: From 00:00 UTC (Business Day Start - Buffer) to 14:00 UTC Next Day (7am LA Next Day, safely covers 5:59am closing)
        const startIso = `${todayStr}T00:00:00.000+0000`
        const endIso = `${tomorrowStr}T14:00:00.000+0000`

        console.log(`⚡ [LIVE SYNC] Triggered for Store ${storeId || 'ALL'} Date: ${todayStr}`)

        // 1. Sync Sales
        const salesPromise = fetchToastData({
            storeIds: storeId ? storeId : 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            fastMode: false,
            skipCache: true,
            readOnly: false
        })

        // 2. Sync Labor (Punches)
        const supabase = await getSupabaseAdminClient()
        let laborCount = 0

        if (storeId && storeId !== 'all') {
            const laborRes = await (syncToastPunches(storeId, startIso, endIso) as Promise<{ count: number, success: boolean }>)
            laborCount = laborRes.count || 0
        } else {
            const { data: stores } = await supabase.from('stores').select('id, external_id, name').eq('is_active', true)
            if (stores && stores.length > 0) {
                const punchPromises = stores.map(st => {
                    const extId = st.external_id || st.id
                    return syncToastPunches(extId, startIso, endIso)
                })
                const results = await Promise.allSettled(punchPromises)
                results.forEach((r: any) => {
                    if (r.status === 'fulfilled' && r.value?.count) {
                        laborCount += r.value.count
                    }
                })
            }
        }

        const salesRes = await salesPromise

        if (salesRes.connectionError && salesRes.rows.length === 0) {
            return NextResponse.json({ error: salesRes.connectionError }, { status: 502 })
        }

        // Explicit Upsert into sales_daily_cache for today's live sales
        if (salesRes.rows && salesRes.rows.length > 0) {
            const dbRows = salesRes.rows.map((r: any) => ({
                store_id: r.storeId,
                business_date: todayStr,
                store_name: r.storeName,
                net_sales: r.netSales,
                gross_sales: r.grossSales,
                discounts: r.discounts,
                tips: r.tips,
                taxes: r.taxes,
                service_charges: r.serviceCharges,
                order_count: r.orderCount,
                guest_count: r.guestCount,
                labor_hours: r.totalHours,
                labor_cost: r.laborCost,
                uber_sales: r.uberSales || 0,
                doordash_sales: r.doordashSales || 0,
                grubhub_sales: r.grubhubSales || 0,
                ebt_count: r.ebtCount || 0,
                ebt_amount: r.ebtAmount || 0,
                hourly_data: r.hourlySales || {},
                hourly_tickets: r.hourlyTickets || {},
                hourly_labor: r.hourlyLabor || {},
                updated_at: new Date().toISOString()
            }))

            await supabase
                .from('sales_daily_cache')
                .upsert(dbRows, { onConflict: 'store_id,business_date' })
        }

        return NextResponse.json({
            success: true,
            sales_records: salesRes.rows.length,
            labor_records: laborCount,
            message: `Updated Live Data for ${todayStr}. Sales: ${salesRes.rows.length}, Punches: ${laborCount}`
        })

    } catch (error: any) {
        console.error('Live Sync Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
