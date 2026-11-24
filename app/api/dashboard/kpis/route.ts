/**
 * @module api/dashboard/kpis/route
 * @description Dashboard KPIs endpoint — UNIFIED with Ventas module.
 *   Provides high-level executive KPIs (Sales, Labor, pure Food Cost & separated Packaging Cost) for Tacos Gavilan.
 * @businessRules
 * - Uses fetchToastData (same engine as /api/ventas) to guarantee identical sales and labor figures.
 * - Cache-first with deterministic pagination (`.order('id').range()`) and live fallback for dirty/incomplete dates.
 * - Food cost requires store completeness (>= 14 stores for single-day) before accepting cache, and isolates broken rows (`isInvalidFoodCostCacheRow`) in both cache and live fallback.
 * @dataFlow
 * - Client -> GET /api/dashboard/kpis -> fetchToastData + food_cost_daily_cache -> JSON Response.
 * @notes
 * - [2026-11-23] Paginación determinista sobre `food_cost_daily_cache`, separación de `foodCostDollars`/`packagingCostDollars` y aislamiento por tienda en fallback vivo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'
import { diffCalendarDays, isInvalidFoodCostCacheRow, resolveCachedFoodCostDollars } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

function aggregateLiveFoodCostPayload(fcJson: any): { fcCost: number; pkgCost: number; fcSales: number } {
    const storeMap = new Map<string, { foodCost: number; pkgCost: number; netSales: number }>()
    const authSalesByStore: Record<string, number> = fcJson?.salesNetSales || {}

    for (const item of fcJson?.data || []) {
        const sid = item.store_id || item.store_name || 'unknown'
        const cur = storeMap.get(sid) || { foodCost: 0, pkgCost: 0, netSales: 0 }
        cur.foodCost += Number(item.food_cost ?? item.total_cost ?? 0)
        cur.pkgCost += Number(item.packaging_cost ?? 0)
        cur.netSales += Number(item.net_sales || 0)
        storeMap.set(sid, cur)
    }

    let fcCost = 0
    let pkgCost = 0
    let fcSales = 0

    storeMap.forEach((vals, sid) => {
        const authSales = Number(authSalesByStore[sid] || 0)
        const resolvedSales = authSales > 0 ? authSales : vals.netSales
        if (isInvalidFoodCostCacheRow(vals.foodCost, resolvedSales)) {
            return
        }
        fcCost += vals.foodCost
        pkgCost += vals.pkgCost
        fcSales += resolvedSales
    })

    return { fcCost, pkgCost, fcSales }
}

export async function GET(req: NextRequest) {
    const auth = await verifyStaffAuth(req)
    if (!auth.authorized) return auth.response!

    try {
        const { searchParams } = new URL(req.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const skipCache = searchParams.get('skipCache') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }

        const salesOptions: ToastMetricsOptions = {
            storeIds: 'all',
            startDate,
            endDate,
            groupBy: 'day',
            skipCache,
            allowDirtyCache: true
        }

        const salesPromise = fetchToastData(salesOptions)

        let fcTotalCost = 0
        let fcTotalPackaging = 0
        let fcTotalSales = 0

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

            const rangeDays = Math.max(1, diffCalendarDays(startDate, endDate) + 1)

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
                if (r.store_id) distinctStores.add(r.store_id)
            })

            const isFcCacheComplete = brokenStoreRows === 0 && (rangeDays === 1
                ? (distinctStores.size >= 14 && tempSales > 0 && tempCost > 0)
                : (fcRows.length >= rangeDays * 12 && tempSales > 0))

            if (!fcErr && fcRows.length > 0 && isFcCacheComplete) {
                fcTotalCost = tempCost
                fcTotalPackaging = tempPkg
                fcTotalSales = tempSales
            } else if (rangeDays <= 7) {
                fcTotalCost = tempCost
                fcTotalPackaging = tempPkg
                fcTotalSales = tempSales
                try {
                    const directReq = new NextRequest(`http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${startDate}&endDate=${endDate}`, {
                        headers: req.headers
                    })
                    const directRes = await foodCostGet(directReq)
                    if (directRes.ok) {
                        const directJson = await directRes.json()
                        if (directJson.data && directJson.data.length > 0) {
                            const agg = aggregateLiveFoodCostPayload(directJson)
                            fcTotalCost = agg.fcCost
                            fcTotalPackaging = agg.pkgCost
                            fcTotalSales = agg.fcSales
                        }
                    }
                } catch {
                    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
                        ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
                        : (process.env.VERCEL_PROJECT_PRODUCTION_URL
                            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
                            : (process.env.VERCEL_URL
                                ? `https://${process.env.VERCEL_URL}`
                                : 'http://localhost:3000'))
                    const fcUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${startDate}&endDate=${endDate}`
                    const fcRes = await fetch(fcUrl, {
                        headers: {
                            cookie: req.headers.get('cookie') || '',
                            authorization: req.headers.get('authorization') || '',
                            'x-cron-auth': process.env.CRON_SECRET || ''
                        }
                    })
                    const fcJson = await fcRes.json()

                    if (fcJson.data && fcJson.data.length > 0) {
                        const agg = aggregateLiveFoodCostPayload(fcJson)
                        fcTotalCost = agg.fcCost
                        fcTotalPackaging = agg.pkgCost
                        fcTotalSales = agg.fcSales
                    }
                }
            } else {
                fcTotalCost = tempCost
                fcTotalPackaging = tempPkg
                fcTotalSales = tempSales
            }
        } catch (fcError) {
            console.error('[Dashboard KPIs] Food Cost Error:', fcError)
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

        return NextResponse.json({
            totalSales: Number(totalSales.toFixed(2)),
            totalLaborCost: Number(totalLaborCost.toFixed(2)),
            totalLaborHours: Number(totalLaborHours.toFixed(2)),
            laborPct: Number(laborPct.toFixed(2)),
            foodCostPct: Number(foodCostPct.toFixed(2)),
            foodCostDollars: Number(fcTotalCost.toFixed(2)),
            packagingCostPct: Number(packagingCostPct.toFixed(2)),
            packagingCostDollars: Number(fcTotalPackaging.toFixed(2)),
            storeCount: new Set(rows.map(r => r.storeId)).size,
            daysWithData: new Set(rows.map(r => r.periodStart)).size,
            connectionError: salesResult.connectionError || undefined
        })

    } catch (e: any) {
        console.error('[Dashboard KPIs] Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
