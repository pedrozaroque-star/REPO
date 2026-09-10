/**
 * @module api/dashboard/kpis/route
 * @description Dashboard KPIs endpoint — UNIFIED with Ventas module.
 *   Provides high-level executive KPIs (Sales, Labor, Food Cost) for Tacos Gavilan.
 * @businessRules
 * - Uses fetchToastData (same engine as /api/ventas) to guarantee identical sales and labor figures.
 * - Cache-first with live fallback for dirty dates (today / yesterday before 6 AM).
 * - Food cost requires store completeness (>= 14 stores for single-day) before accepting cache.
 * @dataFlow
 * - Client -> GET /api/dashboard/kpis -> fetchToastData + food_cost_daily_cache -> JSON Response.
 * @notes
 * - [2026-09-10] FIX: Validates food cost store completeness (>=14 stores) and uses in-process calculation fallback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchToastData, ToastMetricsOptions } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const skipCache = searchParams.get('skipCache') === 'true'

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }

        // ═══════════════════════════════════════════════════
        // PARALLEL FETCH:
        //   1. Sales + Labor → fetchToastData (same as /api/ventas)
        //   2. Food Cost     → direct Supabase cache read
        // ═══════════════════════════════════════════════════

        const salesOptions: ToastMetricsOptions = {
            storeIds: 'all',
            startDate,
            endDate,
            groupBy: 'day',
            skipCache,
            allowDirtyCache: true // Read today's cache if populated by cron; live fallback if not
        }

        // ═══════════════════════════════════════════════════
        // 1. Sales + Labor via the UNIFIED engine (cache-first, live fallback for dirty dates)
        // ═══════════════════════════════════════════════════
        const salesResult = await fetchToastData(salesOptions)

        // ═══════════════════════════════════════════════════
        // 2. Food Cost: SAME STRATEGY AS VENTAS MODULE
        //    Cache-first → live fallback if cache miss or partial
        // ═══════════════════════════════════════════════════
        let fcTotalCost = 0
        let fcTotalSales = 0

        try {
            // Step A: Try cache (instant ~50ms)
            const supabase = await getSupabaseAdminClient()
            const { data: fcRows, error: fcErr } = await supabase
                .from('food_cost_daily_cache')
                .select('store_id, store_name, total_cost, net_sales, cost_percentage, business_date')
                .gte('business_date', startDate)
                .lte('business_date', endDate)

            const rangeDays = Math.floor(
                (new Date(endDate + 'T00:00:00').getTime() - new Date(startDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
            ) + 1

            let tempCost = 0
            let tempSales = 0
            const distinctStores = new Set<string>()
            fcRows?.forEach(r => {
                tempCost += Number(r.total_cost || 0)
                tempSales += Number(r.net_sales || 0)
                if (r.store_id) distinctStores.add(r.store_id)
            })

            // Cache is complete only if all stores (>= 14) are present and sales > 0
            const isFcCacheComplete = rangeDays === 1
                ? (distinctStores.size >= 14 && tempSales > 0 && tempCost > 0)
                : (fcRows && fcRows.length >= rangeDays * 12 && tempSales > 0)

            if (!fcErr && fcRows && fcRows.length > 0 && isFcCacheComplete) {
                // Cache hit complete — use pre-calculated data
                fcTotalCost = tempCost
                fcTotalSales = tempSales
            } else {
                // Step B: Cache miss or partial — live fallback for short ranges (≤7 days)
                if (rangeDays <= 7) {
                    try {
                        const directReq = new NextRequest(`http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${startDate}&endDate=${endDate}`)
                        const directRes = await foodCostGet(directReq)
                        if (directRes.ok) {
                            const directJson = await directRes.json()
                            if (directJson.data && directJson.data.length > 0) {
                                fcTotalCost = 0
                                fcTotalSales = 0
                                directJson.data.forEach((item: any) => {
                                    fcTotalCost += Number(item.total_cost || 0)
                                    fcTotalSales += Number(item.net_sales || 0)
                                })
                            }
                        }
                    } catch (inProcErr) {
                        const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
                            ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
                            : (process.env.VERCEL_PROJECT_PRODUCTION_URL 
                                ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
                                : (process.env.VERCEL_URL 
                                    ? `https://${process.env.VERCEL_URL}` 
                                    : 'http://localhost:3000'))
                        const fcUrl = `${baseUrl}/api/inventory/food-cost?storeId=all&startDate=${startDate}&endDate=${endDate}`
                        const fcRes = await fetch(fcUrl)
                        const fcJson = await fcRes.json()

                        if (fcJson.data && fcJson.data.length > 0) {
                            fcTotalCost = 0
                            fcTotalSales = 0
                            fcJson.data.forEach((item: any) => {
                                fcTotalCost += Number(item.total_cost || 0)
                                fcTotalSales += Number(item.net_sales || 0)
                            })
                        }
                    }
                }
                // For ranges > 7 days without cache, leave as 0 (too expensive to calculate live)
            }
        } catch (fcError) {
            console.error('[Dashboard KPIs] Food Cost Error:', fcError)
        }

        // ── Aggregate Sales + Labor from fetchToastData rows ──
        // Each row = one store × one day (same structure as /api/ventas response)
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

        // ── Response (backward-compatible shape) ──
        return NextResponse.json({
            totalSales: Number(totalSales.toFixed(2)),
            totalLaborCost: Number(totalLaborCost.toFixed(2)),
            totalLaborHours: Number(totalLaborHours.toFixed(2)),
            laborPct: Number(laborPct.toFixed(2)),
            foodCostPct: Number(foodCostPct.toFixed(2)),
            foodCostDollars: Number(fcTotalCost.toFixed(2)),
            storeCount: new Set(rows.map(r => r.storeId)).size,
            daysWithData: new Set(rows.map(r => r.periodStart)).size,
            connectionError: salesResult.connectionError || undefined
        })

    } catch (e: any) {
        console.error('[Dashboard KPIs] Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
