/**
 * @module app/api/inventory/food-cost-cache
 * @description Lector ligero de agregados diarios pre-calculados de Food Cost desde `food_cost_daily_cache`.
 *
 * @businessRules
 * - Devuelve agregados consolidados y desglose por sucursal (`byStore` y `byStoreName`) para el rango `startDate`..`endDate`.
 * - La caché es alimentada vía write-through por `/api/inventory/food-cost` y los crons de sincronización.
 *
 * @dataFlow
 * - Dashboard Ventas / Inventario -> `GET /api/inventory/food-cost-cache` -> `food_cost_daily_cache` (Supabase) -> JSON.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` para personal interno autenticado.
 * - [2026-11-23] Aísla filas corruptas (`total_cost > 0` con `net_sales <= 0`) para que no distorsionen el % global de la cadena y reporta `invalidStoresCount` para disparar auto-reparación en `/ventas`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { calculateSafeFoodCostPct, isInvalidFoodCostCacheRow } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request)
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }
        const searchParams = request.nextUrl.searchParams
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const storeId = searchParams.get('storeId') // optional

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // Query cached food cost data for the date range
        let query = supabase
            .from('food_cost_daily_cache')
            .select('business_date, store_id, store_name, total_cost, net_sales, cost_percentage, total_items, items_with_recipe, total_meat_lbs, updated_at')
            .gte('business_date', startDate)
            .lte('business_date', endDate)
            .order('business_date', { ascending: true })

        // Optional store filter
        if (storeId && storeId !== 'all') {
            query = query.eq('store_id', storeId)
        }

        const { data, error } = await query

        if (error) {
            console.error('[FoodCostCache] Read error:', error.message)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        if (!data || data.length === 0) {
            return NextResponse.json({
                totalCost: 0,
                totalSales: 0,
                costPercentage: 0,
                daysWithData: 0,
                totalDaysInRange: getDayCount(startDate, endDate),
                cached: true,
                empty: true
            })
        }

        // Aggregate totals across all stores and days
        // Isolate broken rows (total_cost > 0 with net_sales <= 0) so 1 poisoned store cannot inflate chain-wide FC%
        let totalCost = 0
        let totalSales = 0
        const uniqueDates = new Set<string>()
        const invalidStoreIds = new Set<string>()

        // Also aggregate by store for per-store table columns
        const storeAgg = new Map<string, { totalCost: number, netSales: number }>()
        const storeNameAgg = new Map<string, { totalCost: number, netSales: number }>()

        data.forEach(row => {
            const rowCost = Number(row.total_cost) || 0
            const rowSales = Number(row.net_sales) || 0
            const isBrokenRow = isInvalidFoodCostCacheRow(rowCost, rowSales)

            if (isBrokenRow) {
                invalidStoreIds.add(row.store_id)
            } else {
                totalCost += rowCost
                totalSales += rowSales
            }
            uniqueDates.add(row.business_date)

            // Per-store aggregation by store_id
            const sid = row.store_id
            if (!storeAgg.has(sid)) {
                storeAgg.set(sid, { totalCost: 0, netSales: 0 })
            }
            const s = storeAgg.get(sid)!
            s.totalCost += rowCost
            s.netSales += rowSales

            // Per-store aggregation by store_name (used by ventas module filter)
            const sname = row.store_name || sid
            if (!storeNameAgg.has(sname)) {
                storeNameAgg.set(sname, { totalCost: 0, netSales: 0 })
            }
            const sn = storeNameAgg.get(sname)!
            sn.totalCost += rowCost
            sn.netSales += rowSales
        })

        const costPercentage = calculateSafeFoodCostPct(totalCost, totalSales)
        const totalDaysInRange = getDayCount(startDate, endDate)

        // Build per-store response (by store_id)
        const byStore: Record<string, { totalCost: number, netSales: number, costPercentage: number }> = {}
        storeAgg.forEach((val, storeId) => {
            byStore[storeId] = {
                totalCost: Number(val.totalCost.toFixed(2)),
                netSales: Number(val.netSales.toFixed(2)),
                costPercentage: calculateSafeFoodCostPct(val.totalCost, val.netSales)
            }
        })

        // Build per-store response (by store_name — for ventas module filter)
        const byStoreName: Record<string, { totalCost: number, netSales: number, costPercentage: number }> = {}
        storeNameAgg.forEach((val, storeName) => {
            byStoreName[storeName] = {
                totalCost: Number(val.totalCost.toFixed(2)),
                netSales: Number(val.netSales.toFixed(2)),
                costPercentage: calculateSafeFoodCostPct(val.totalCost, val.netSales)
            }
        })

        return NextResponse.json({
            totalCost: Number(totalCost.toFixed(2)),
            totalSales: Number(totalSales.toFixed(2)),
            costPercentage,
            daysWithData: uniqueDates.size,
            totalDaysInRange,
            invalidStoresCount: invalidStoreIds.size,
            byStore,
            byStoreName,
            cached: true,
            empty: false
        })

    } catch (e: any) {
        console.error('[FoodCostCache] Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

function getDayCount(start: string, end: string): number {
    const s = new Date(start + 'T00:00:00')
    const e = new Date(end + 'T00:00:00')
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
}
