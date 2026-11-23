/**
 * @module api/integrity/verify-day/route
 * @description Verifies sales and labor integrity between live Toast API data and Supabase sales_daily_cache, auto-healing any data drift silently.
 * @businessRules
 * - Only checks strictly CLOSED past business dates (`date < getBusinessDateLA()`, 6:00 AM rule in `America/Los_Angeles`). Never touches Today, Future, or unclosed Yesterday before 6:00 AM LA.
 * - Auto-heals discrepancies exceeding $5.00 in Net Sales or Labor.
 * - Preserves complete granular hourly sales, tickets, labor curves, and EBT amounts during healing.
 * - Never overwrites valid cached sales with `$0` or failed Toast rows (`hasError`), and never wipes valid cached `labor_cost` to `$0` if Toast Labor API times out.
 * - Requires authenticated user with `admin`/`supervisor` role (verified live via `getServerUser`) or `CRON_SECRET`.
 * @dataFlow
 * - Client -> POST /api/integrity/verify-day -> Validate Closed Date -> Read Supabase `sales_daily_cache` -> Toast API (`skipCache: true, readOnly: true`) -> Compare -> Guarded Upsert -> Response.
 * @notes
 * - [2026-11-23] FIX CRÍTICO (5 bugs): (1) Corregido orden invertido pasando `readOnly: true` a `fetchToastData` y leyendo `sales_daily_cache` antes de curar; (2) Bloqueo estricto de hoy, fechas futuras y ayer <6:00 AM LA; (3) Filtro `hasError` + `shouldAllowSalesCacheUpsert` para nunca sobrescribir ventas reales con `$0`; (4) Preservación de `labor_cost`/`labor_hours`/`hourly_labor` válidos ante fallo/timeout de Toast Labor API y de `hourly_tickets` si llega vacío; (5) Validación estricta de `healError` y auth fail-closed `admin`/`supervisor`/`CRON_SECRET`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { fetchToastData } from '@/lib/toast-api'
import { getServerUser, getCronSecret, safeTimingEqual } from '@/lib/auth-server'
import {
    getBusinessDateLA,
    isValidIsoDate,
    shouldAllowSalesCacheUpsert,
} from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const VERIFY_ALLOWED_ROLES = ['admin', 'administrador', 'supervisor']

export async function POST(req: NextRequest) {
    try {
        // 1. Fail-closed Auth: allow CRON_SECRET OR live-verified active admin/supervisor
        const cronSecret = getCronSecret()
        const cronHeader = req.headers.get('x-cron-auth') || req.headers.get('authorization') || ''
        const isCronAuthorized = Boolean(
            cronSecret &&
            cronHeader &&
            (safeTimingEqual(cronHeader, `Bearer ${cronSecret}`) || safeTimingEqual(cronHeader, cronSecret))
        )
        if (!isCronAuthorized) {
            const user = await getServerUser(req)
            if (!user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            const role = (user.role || '').trim().toLowerCase()
            if (!VERIFY_ALLOWED_ROLES.includes(role)) {
                return NextResponse.json({ error: 'Forbidden: Admins & Supervisors Only' }, { status: 403 })
            }
        }

        let body: any
        try {
            body = await req.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const date = typeof body?.date === 'string' ? body.date.trim() : ''
        const storeIds = typeof body?.storeIds === 'string' && body.storeIds.trim() ? body.storeIds.trim() : 'all'

        if (!isValidIsoDate(date)) {
            return NextResponse.json({ error: 'Valid ISO date (YYYY-MM-DD) required' }, { status: 400 })
        }

        // Strict Business Day Guard (6:00 AM LA rule): only allow strictly CLOSED past days
        const activeBusinessDateLA = getBusinessDateLA()
        if (date >= activeBusinessDateLA) {
            return NextResponse.json(
                {
                    status: 'skipped',
                    error: `Only closed past business dates (< ${activeBusinessDateLA}) can be integrity-healed`,
                },
                { status: 400 }
            )
        }

        console.log(`🕵️ [INTEGRITY] Verifying integrity for closed date ${date} (Stores: ${storeIds})...`)

        // 2. Fetch CACHED Data FIRST (before calling Toast, preventing inverted-order race)
        const supabase = await getSupabaseAdminClient()
        let cacheQuery = supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('business_date', date)

        if (storeIds !== 'all') {
            const requestedIds = storeIds.split(',').map((s: string) => s.trim()).filter(Boolean)
            if (requestedIds.length > 0) {
                cacheQuery = cacheQuery.in('store_id', requestedIds)
            }
        }

        const { data: cachedRows, error: cacheReadError } = await cacheQuery
        if (cacheReadError) {
            console.error('[INTEGRITY] Failed to read sales_daily_cache:', cacheReadError.message)
            return NextResponse.json({ status: 'error', message: 'Cache read failed' }, { status: 500 })
        }

        const cacheMap = new Map<string, any>()
        cachedRows?.forEach((r: any) => cacheMap.set(r.store_id, r))

        // 3. Fetch CURRENT Toast Data (Live) ignoring cache, in READ-ONLY mode so verify-day controls all upserts
        const toastData = await fetchToastData({
            startDate: date,
            endDate: date,
            storeIds,
            groupBy: 'day',
            skipCache: true,
            fastMode: false,
            readOnly: true,
        })

        const allLiveRows = toastData.rows || []
        const healthyLiveRows = allLiveRows.filter((r) => !r.hasError)

        if (healthyLiveRows.length === 0) {
            return NextResponse.json(
                { status: 'error', message: toastData.connectionError || 'No healthy data received from Toast' },
                { status: 502 }
            )
        }

        // 4. Compare & Build Guarded Heal Payloads
        const fixedStores: string[] = []
        const toHealPayloads: any[] = []

        for (const liveRow of healthyLiveRows) {
            const cached = cacheMap.get(liveRow.storeId)

            // Guardrail: never overwrite existing positive sales with $0 / 0 orders
            if (!shouldAllowSalesCacheUpsert(liveRow, cached?.net_sales)) {
                console.warn(`🛡️ [INTEGRITY] Skipped potential $0 clobber for ${liveRow.storeName} (${liveRow.storeId})`)
                continue
            }

            // Guardrail: if Toast Labor API failed/timed out and returned $0 while sales > 0 and cache had valid labor, preserve cached labor
            const cachedLaborCost = Number(cached?.labor_cost || 0)
            const preserveCachedLabor =
                Boolean(cached) &&
                cachedLaborCost > 0 &&
                (Boolean(liveRow.laborHasError) || (Number(liveRow.laborCost || 0) <= 0 && Number(liveRow.netSales || 0) > 0))

            const effectiveLaborCost = preserveCachedLabor ? cachedLaborCost : Number(liveRow.laborCost || 0)
            const effectiveLaborHours = preserveCachedLabor ? Number(cached?.labor_hours || 0) : Number(liveRow.totalHours || 0)
            const effectiveHourlyLabor = preserveCachedLabor
                ? (cached?.hourly_labor || {})
                : (liveRow.hourlyLabor && Object.keys(liveRow.hourlyLabor).length > 0 ? liveRow.hourlyLabor : (cached?.hourly_labor || {}))
            const effectiveHourlyTickets =
                liveRow.hourlyTickets && Object.keys(liveRow.hourlyTickets).length > 0
                    ? liveRow.hourlyTickets
                    : (cached?.hourly_tickets || {})

            const salesDiff = Math.abs((liveRow.netSales || 0) - Number(cached?.net_sales || 0))
            const laborDiff = Math.abs(effectiveLaborCost - cachedLaborCost)

            if (!cached || salesDiff > 5.00 || laborDiff > 5.00) {
                console.warn(`⚠️ [INTEGRITY] Discrepancy found for ${liveRow.storeName}: Sales diff $${salesDiff.toFixed(2)}, Labor diff $${laborDiff.toFixed(2)}`)

                toHealPayloads.push({
                    business_date: date,
                    store_id: liveRow.storeId,
                    store_name: liveRow.storeName,
                    net_sales: liveRow.netSales,
                    gross_sales: liveRow.grossSales,
                    discounts: liveRow.discounts,
                    tips: liveRow.tips,
                    taxes: liveRow.taxes,
                    service_charges: liveRow.serviceCharges,
                    order_count: liveRow.orderCount,
                    guest_count: liveRow.guestCount,
                    labor_hours: effectiveLaborHours,
                    labor_cost: effectiveLaborCost,
                    uber_sales: liveRow.uberSales || 0,
                    doordash_sales: liveRow.doordashSales || 0,
                    grubhub_sales: liveRow.grubhubSales || 0,
                    ebt_count: liveRow.ebtCount || 0,
                    ebt_amount: liveRow.ebtAmount || 0,
                    hourly_data: liveRow.hourlySales || {},
                    hourly_tickets: effectiveHourlyTickets,
                    hourly_labor: effectiveHourlyLabor,
                    updated_at: new Date().toISOString(),
                })
                fixedStores.push(liveRow.storeName)
            }
        }

        if (toHealPayloads.length > 0) {
            const { error: healError } = await supabase
                .from('sales_daily_cache')
                .upsert(toHealPayloads, { onConflict: 'store_id,business_date' })

            if (healError) {
                console.error('Failed to heal cache batch:', healError)
                return NextResponse.json(
                    { status: 'error', message: 'Failed to persist cache correction' },
                    { status: 500 }
                )
            }
        }

        // 5. Construct Fresh Data Payload (only from healthy rows)
        const summary = {
            netSales: 0,
            grossSales: 0,
            discounts: 0,
            tips: 0,
            laborCost: 0,
            laborHours: 0,
            orders: 0,
            guests: 0,
        }

        const hourlyData: Record<number, number> = {}
        const hourlyTickets: Record<number, number> = {}

        healthyLiveRows.forEach((r) => {
            summary.netSales += r.netSales || 0
            summary.grossSales += r.grossSales || 0
            summary.discounts += r.discounts || 0
            summary.tips += r.tips || 0
            summary.laborCost += r.laborCost || 0
            summary.laborHours += r.totalHours || 0
            summary.orders += r.orderCount || 0
            summary.guests += r.guestCount || 0

            if (r.hourlySales) {
                Object.entries(r.hourlySales).forEach(([h, val]) => {
                    const hour = Number(h)
                    hourlyData[hour] = (hourlyData[hour] || 0) + Number(val)
                })
            }
            if (r.hourlyTickets) {
                Object.entries(r.hourlyTickets).forEach(([h, val]) => {
                    const hour = Number(h)
                    hourlyTickets[hour] = (hourlyTickets[hour] || 0) + Number(val)
                })
            }
        })

        const freshDataPayload = {
            summary,
            data: healthyLiveRows.map((r) => ({
                ...r,
                labor_cost: r.laborCost,
                labor_hours: r.totalHours,
                net_sales: r.netSales,
            })),
            hourlyData,
            hourlyTickets,
        }

        if (toHealPayloads.length > 0) {
            console.log(`✅ [INTEGRITY] Healed ${toHealPayloads.length} stores: ${fixedStores.join(', ')}`)
            return NextResponse.json({
                status: 'corrected',
                fixed: fixedStores,
                skippedErrored: allLiveRows.length - healthyLiveRows.length,
                message: `Corregidas discrepancias en: ${fixedStores.join(', ')}`,
                freshData: freshDataPayload,
            })
        }

        console.log(`✅ [INTEGRITY] Integrity Verified. No drift detected.`)
        return NextResponse.json({
            status: 'ok',
            skippedErrored: allLiveRows.length - healthyLiveRows.length,
            message: 'Datos verificados (Sincronizados)',
        })
    } catch (e: any) {
        console.error('Integrity Check Failed:', e)
        return NextResponse.json({ status: 'error', error: 'Internal Server Error' }, { status: 500 })
    }
}
