/**
 * @module api/sync/sales-live/route
 * @description Triggers on-demand live synchronization of sales and labor punches from Toast API for the current business day and persists to database.
 * @businessRules
 * - Day rollover boundary is 6:00 AM PST/PDT.
 * - Captures labor punches from 00:00 UTC through 14:00 UTC next day (7:00 AM PDT) ensuring no early morning punch cutoffs.
 * - Writes live sales records atomically to sales_daily_cache.
 * @dataFlow
 * - Client / Background Sync -> POST /api/sync/sales-live -> Toast API & syncToastPunches -> Supabase -> Response.
 * @notes
 * - Protegido con `verifyStaffAuth` (`admin`, `supervisor` o `CRON_SECRET`, y `manager` exclusivamente cuando provee `storeId` autorizado vía `authorizeStoreScope`).
 * - [2026-11-23] Blindado con `shouldAllowSalesCacheUpsert`: ignora filas con `hasError` y jamás sobrescribe ventas positivas ya cacheadas en `sales_daily_cache` con `$0 / 0 órdenes`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { syncToastPunches } from '@/lib/toast-labor'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { shouldAllowSalesCacheUpsert } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const SALES_LIVE_ROLES = ['admin', 'supervisor', 'manager', 'gerente', 'general_manager']

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: SALES_LIVE_ROLES, allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const body = await request.json().catch(() => ({}))
        const rawStoreId = body?.storeId !== undefined && body?.storeId !== null ? String(body.storeId).trim() : ''
        const supabase = await getSupabaseAdminClient()
        let effectiveStoreId = rawStoreId

        if (auth.user) {
            const rawServerUser = await getServerUser(request)
            let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase()
            let effectiveUserStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
            let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope

            if (!effectiveUserStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
                const { data: userProfile } = await supabase
                    .from('users')
                    .select('role, store_id, store_scope')
                    .ilike('email', auth.user.email)
                    .maybeSingle()
                if (userProfile) {
                    if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
                    if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveUserStoreId = userProfile.store_id
                    if (userProfile.store_scope) effectiveScope = userProfile.store_scope
                }
            }

            const isGlobalRole = ['admin', 'administrador', 'supervisor'].includes(effectiveRole)
            if (!isGlobalRole) {
                if (!rawStoreId || rawStoreId.toLowerCase() === 'all') {
                    return NextResponse.json(
                        { error: 'Forbidden: Store Managers must specify their authorized storeId' },
                        { status: 403 }
                    )
                }

                const serverUser = {
                    id: rawServerUser?.id || auth.user.id,
                    email: rawServerUser?.email || auth.user.email,
                    name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
                    role: effectiveRole,
                    store_id: effectiveUserStoreId,
                    store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                    store_scope: effectiveScope,
                }

                const scopeCheck = await authorizeStoreScope(serverUser, rawStoreId, supabase, {
                    requireWrite: true,
                    allowedRoles: SALES_LIVE_ROLES,
                })
                if (!scopeCheck.authorized) {
                    return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
                }
                if (scopeCheck.resolvedStoreGuid) {
                    effectiveStoreId = scopeCheck.resolvedStoreGuid
                }
            }
        }

        const storeId = effectiveStoreId

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

        const incomingRows = salesRes.rows || []
        const storeIdsToCheck = incomingRows.map((r: any) => r.storeId).filter(Boolean)
        const existingSalesMap = new Map<string, number>()
        if (storeIdsToCheck.length > 0) {
            const { data: existingRows } = await supabase
                .from('sales_daily_cache')
                .select('store_id, net_sales')
                .eq('business_date', todayStr)
                .in('store_id', storeIdsToCheck)
            existingRows?.forEach((er: any) => {
                existingSalesMap.set(er.store_id, Number(er.net_sales) || 0)
            })
        }

        const safeRows = incomingRows.filter((r: any) =>
            shouldAllowSalesCacheUpsert(r, existingSalesMap.get(r.storeId))
        )

        if (salesRes.connectionError && safeRows.length === 0) {
            return NextResponse.json({ error: salesRes.connectionError }, { status: 502 })
        }

        // Explicit Upsert into sales_daily_cache for today's live sales (excluding errored/$0-clobber rows)
        if (safeRows.length > 0) {
            const dbRows = safeRows.map((r: any) => ({
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
            sales_records: safeRows.length,
            skipped_errored: incomingRows.length - safeRows.length,
            labor_records: laborCount,
            message: `Updated Live Data for ${todayStr}. Sales: ${safeRows.length}, Punches: ${laborCount}`
        })

    } catch (error: any) {
        console.error('Live Sync Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
