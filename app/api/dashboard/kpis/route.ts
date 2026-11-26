/**
 * @module api/dashboard/kpis/route
 * @description Dashboard KPIs endpoint — UNIFIED with Ventas module.
 *   Provides high-level executive KPIs (Sales, Labor, pure Food Cost & separated Packaging Cost) for Tacos Gavilan.
 * @businessRules
 * - Uses fetchToastData (same engine as /api/ventas) with `excludeHourly: true` to guarantee identical scalar sales and labor figures without pulling hourly JSONB blobs.
 * - Strictly enforces `maxDays <= 366` and blocks `skipCache=true` whenever span `> 1` day so no request can trigger a multi-day live Toast storm.
 * - NEVER invokes `foodCostGet(storeId=all)` or HTTP `/api/inventory/food-cost` synchronously during dashboard polling: reads `food_cost_daily_cache` with deterministic pagination (`.order('id').range()`), isolates broken rows (`isInvalidFoodCostCacheRow`), and exposes `foodCostPartial: true` when `< 14` valid stores are cached yet (relying on `sync-food-cost-today` cron).
 * - Deduplicates concurrent dashboard polls via 60s bounded TTL cache (`MAX_CACHE_KEYS = 50`) + `inFlight` single-flight map (bypassed only on valid single-day `skipCache=true`).
 * @dataFlow
 * - Client -> GET /api/dashboard/kpis -> TTL/inFlight cache -> fetchToastData (scalar) + food_cost_daily_cache -> JSON Response.
 * @notes
 * - [2026-11-23] Paginación determinista sobre `food_cost_daily_cache`, separación de `foodCostDollars`/`packagingCostDollars` y aislamiento por tienda.
 * - [2026-11-26] Blindaje Supabase `ci_small` (Critical #3): `maxDuration = 60`, tope `maxDays <= 366`, bloqueo `skipCache` > 1 día, eliminación total de fallback vivo `foodCostGet`/HTTP, `foodCostPartial`, y caché single-flight TTL 60s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { fetchToastData, SalesCacheReadError, ToastMetricsOptions } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import {
    isInvalidFoodCostCacheRow,
    resolveCachedFoodCostDollars,
    validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_KPIS_DAYS = 366
const KPIS_CACHE_TTL_MS = 60_000
const KPIS_MAX_CACHE_KEYS = 50

interface DashboardKpisPayload {
    totalSales: number
    totalLaborCost: number
    totalLaborHours: number
    laborPct: number
    foodCostPct: number
    foodCostDollars: number
    packagingCostPct: number
    packagingCostDollars: number
    foodCostPartial: boolean
    foodCostStoresCount: number
    storeCount: number
    daysWithData: number
    connectionError?: string
}

const kpisResponseCache = new Map<string, { expiresAt: number; payload: DashboardKpisPayload }>()
const kpisInFlight = new Map<string, Promise<DashboardKpisPayload>>()

function setKpisCacheBounded(key: string, payload: DashboardKpisPayload) {
    if (kpisResponseCache.size >= KPIS_MAX_CACHE_KEYS) {
        const oldestKey = kpisResponseCache.keys().next().value
        if (oldestKey !== undefined) kpisResponseCache.delete(oldestKey)
    }
    kpisResponseCache.set(key, { expiresAt: Date.now() + KPIS_CACHE_TTL_MS, payload })
}

async function computeDashboardKpis(
    startDate: string,
    endDate: string,
    rangeDays: number,
    skipCache: boolean
): Promise<DashboardKpisPayload> {
    const salesOptions: ToastMetricsOptions = {
        storeIds: 'all',
        startDate,
        endDate,
        groupBy: 'day',
        skipCache,
        allowDirtyCache: true,
        excludeHourly: true,
    }

    const salesPromise = fetchToastData(salesOptions)

    let fcTotalCost = 0
    let fcTotalPackaging = 0
    let fcTotalSales = 0
    let foodCostPartial = true
    let foodCostStoresCount = 0

    try {
        const supabase = await getSupabaseAdminClient()
        const fcRows: any[] = []
        const PAGE_SIZE = 1000
        let fcErr: any = null

        for (let page = 0; page < 25; page++) {
            const offset = page * PAGE_SIZE
            const { data: batch, error: err } = await supabase
                .from('food_cost_daily_cache')
                .select('id, store_id, store_name, food_cost, total_cost, packaging_cost, net_sales, cost_percentage, business_date')
                .gte('business_date', startDate)
                .lte('business_date', endDate)
                .order('id', { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1)
            if (err) {
                fcErr = err
                break
            }
            if (!batch || batch.length === 0) break
            fcRows.push(...batch)
            if (batch.length < PAGE_SIZE) break
        }

        let tempCost = 0
        let tempPkg = 0
        let tempSales = 0
        let brokenStoreRows = 0
        const distinctStores = new Set<string>()
        fcRows.forEach(r => {
            const rowCost = resolveCachedFoodCostDollars(r)
            const rowPkg = Number(r.packaging_cost ?? 0)
            const rowSales = Number(r.net_sales ?? 0)
            if (isInvalidFoodCostCacheRow(rowCost, rowSales)) {
                brokenStoreRows += 1
                return
            }
            tempCost += rowCost
            tempPkg += rowPkg
            tempSales += rowSales
            if (r.store_id) distinctStores.add(String(r.store_id))
        })

        foodCostStoresCount = distinctStores.size
        fcTotalCost = tempCost
        fcTotalPackaging = tempPkg
        fcTotalSales = tempSales

        const isFcCacheComplete = !fcErr && brokenStoreRows === 0 && (
            rangeDays === 1
                ? (distinctStores.size >= 14 && tempSales > 0 && tempCost > 0)
                : (distinctStores.size >= 14 && fcRows.length >= rangeDays * 12 && tempSales > 0)
        )
        foodCostPartial = !isFcCacheComplete
    } catch (fcError) {
        console.error('[Dashboard KPIs] Food Cost Cache Read Error:', fcError)
        foodCostPartial = true
    }

    const salesResult = await salesPromise

    const rows = salesResult.rows
    let totalSales = 0
    let totalLaborCost = 0
    let totalLaborHours = 0

    rows.forEach(r => {
        totalSales += (r.netSales || 0)
        totalLaborCost += (r.laborCost || 0)
        totalLaborHours += (r.totalHours || 0)
    })

    const laborPct = totalSales > 0 ? (totalLaborCost / totalSales) * 100 : 0
    const foodCostPct = fcTotalSales > 0 ? (fcTotalCost / fcTotalSales) * 100 : 0
    const packagingCostPct = fcTotalSales > 0 ? (fcTotalPackaging / fcTotalSales) * 100 : 0

    return {
        totalSales: Number(totalSales.toFixed(2)),
        totalLaborCost: Number(totalLaborCost.toFixed(2)),
        totalLaborHours: Number(totalLaborHours.toFixed(2)),
        laborPct: Number(laborPct.toFixed(2)),
        foodCostPct: Number(foodCostPct.toFixed(2)),
        foodCostDollars: Number(fcTotalCost.toFixed(2)),
        packagingCostPct: Number(packagingCostPct.toFixed(2)),
        packagingCostDollars: Number(fcTotalPackaging.toFixed(2)),
        foodCostPartial,
        foodCostStoresCount,
        storeCount: new Set(rows.map(r => r.storeId)).size,
        daysWithData: new Set(rows.map(r => r.periodStart)).size,
        connectionError: salesResult.connectionError || undefined,
    }
}

export async function GET(req: NextRequest) {
    const auth = await verifyStaffAuth(req)
    if (!auth.authorized) return auth.response!

    try {
        const { searchParams } = new URL(req.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const requestedSkipCache = searchParams.get('skipCache') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }

        const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, MAX_KPIS_DAYS)
        if (!rangeCheck.ok) {
            return NextResponse.json({ error: rangeCheck.error }, { status: 400 })
        }

        if (requestedSkipCache && rangeCheck.days > 1) {
            return NextResponse.json(
                { error: 'skipCache=true is only allowed for single-day queries (<= 1 day) to protect database and Toast API stability.' },
                { status: 400 }
            )
        }

        const cacheKey = `${startDate}:${endDate}`

        if (requestedSkipCache) {
            const freshPayload = await computeDashboardKpis(startDate, endDate, rangeCheck.days, true)
            if (!freshPayload.connectionError) {
                setKpisCacheBounded(cacheKey, freshPayload)
            }
            return NextResponse.json(freshPayload)
        }

        const cached = kpisResponseCache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.payload)
        }

        let loader = kpisInFlight.get(cacheKey)
        if (!loader) {
            loader = computeDashboardKpis(startDate, endDate, rangeCheck.days, false)
            kpisInFlight.set(cacheKey, loader)
            loader.finally(() => {
                if (kpisInFlight.get(cacheKey) === loader) {
                    kpisInFlight.delete(cacheKey)
                }
            })
        }

        const payload = await loader
        if (!payload.connectionError) {
            setKpisCacheBounded(cacheKey, payload)
        }

        return NextResponse.json(payload)
    } catch (e: any) {
        console.error('[Dashboard KPIs] Error:', e)
        const status = e instanceof SalesCacheReadError || e?.name === 'SalesCacheReadError' ? 503 : 500
        return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status })
    }
}
