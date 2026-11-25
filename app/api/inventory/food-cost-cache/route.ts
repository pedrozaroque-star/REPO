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
 * - [2026-11-23] Aísla filas corruptas (`total_cost > 0` con `net_sales <= 0`) de forma simétrica tanto en el total consolidado de la cadena como en `byStore` y `byStoreName`, y reporta `invalidStoresCount` para disparar auto-reparación en `/ventas`.
 * - [2026-11-23] Paginación determinista `.order('id', { ascending: true }).range(offset, offset + 999)` para que rangos trimestrales/anuales (`> 66 días`) jamás trunquen a 1,000 filas.
 * - [2026-11-23] Separación completa de `totalFoodCost`, `totalPackagingCost`, `packagingPercentage`, `totalCogs`, `totalMeatCost`, `totalAsadaLbs`, `totalAsadaCost` y corrección DST en `getDayCount` con mediodía UTC.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
    calculateSafeFoodCostPct,
    calculateSafePackagingCostPct,
    getBusinessDateLA,
    isInvalidFoodCostCacheRow,
    isValidIsoDate,
    resolveCachedFoodCostDollars,
} from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

interface StoreCacheRollup {
    totalCost: number
    totalFoodCost: number
    totalPackagingCost: number
    netSales: number
    totalMeatCost: number
    totalMeatLbs: number
    totalAsadaLbs: number
    totalAsadaCost: number
    totalUnmappedSales: number
}

function emptyRollup(): StoreCacheRollup {
    return {
        totalCost: 0,
        totalFoodCost: 0,
        totalPackagingCost: 0,
        netSales: 0,
        totalMeatCost: 0,
        totalMeatLbs: 0,
        totalAsadaLbs: 0,
        totalAsadaCost: 0,
        totalUnmappedSales: 0,
    }
}

function formatRollup(val: StoreCacheRollup) {
    const totalFoodCost = Number(val.totalFoodCost.toFixed(2))
    const totalPackagingCost = Number(val.totalPackagingCost.toFixed(2))
    const totalCogs = Number((totalFoodCost + totalPackagingCost).toFixed(2))
    const netSales = Number(val.netSales.toFixed(2))
    return {
        totalCost: totalFoodCost,
        totalFoodCost,
        totalPackagingCost,
        totalCogs,
        netSales,
        costPercentage: calculateSafeFoodCostPct(totalFoodCost, netSales),
        packagingPercentage: calculateSafePackagingCostPct(totalPackagingCost, netSales),
        totalCogsPercentage: calculateSafeFoodCostPct(totalCogs, netSales),
        totalMeatCost: Number(val.totalMeatCost.toFixed(2)),
        totalMeatLbs: Number(val.totalMeatLbs.toFixed(2)),
        totalAsadaLbs: Number(val.totalAsadaLbs.toFixed(2)),
        totalAsadaCost: Number(val.totalAsadaCost.toFixed(2)),
        totalUnmappedSales: Number(val.totalUnmappedSales.toFixed(2)),
    }
}

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
        if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
            return NextResponse.json({ error: 'Invalid startDate or endDate' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // Paginate cached food cost data deterministically using composite index `(business_date, store_id)`
        const data: any[] = []
        const PAGE_SIZE = 1000
        const MAX_PAGES = 30

        for (let page = 0; page < MAX_PAGES; page++) {
            const offset = page * PAGE_SIZE
            let query = supabase
                .from('food_cost_daily_cache')
                .select('business_date, store_id, store_name, total_cost, food_cost, packaging_cost, net_sales, total_meat_lbs, meat_cost, asada_raw_lbs, asada_cost, unmapped_sales')
                .gte('business_date', startDate)
                .lte('business_date', endDate)
                .order('business_date', { ascending: true })
                .order('store_id', { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1)

            if (storeId && storeId !== 'all') {
                query = query.eq('store_id', storeId)
            }

            const { data: pageRows, error } = await query
            if (error) {
                console.error('[FoodCostCache] Read error:', error.message)
                return NextResponse.json({ error: error.message }, { status: 500 })
            }
            if (!pageRows || pageRows.length === 0) break
            data.push(...pageRows)
            if (pageRows.length < PAGE_SIZE) break
        }

        if (!data || data.length === 0) {
            return NextResponse.json({
                totalCost: 0,
                totalFoodCost: 0,
                totalPackagingCost: 0,
                totalCogs: 0,
                totalSales: 0,
                costPercentage: 0,
                packagingPercentage: 0,
                totalCogsPercentage: 0,
                totalMeatCost: 0,
                totalMeatLbs: 0,
                totalAsadaLbs: 0,
                totalAsadaCost: 0,
                totalUnmappedSales: 0,
                daysWithData: 0,
                totalDaysInRange: getDayCount(startDate, endDate),
                invalidStoresCount: 0,
                byStore: {},
                byStoreName: {},
                cached: true,
                empty: true
            })
        }

        // Aggregate totals across all stores and days
        // Isolate broken rows (cost > 0 with net_sales <= 0) consistently in BOTH chain totals AND byStore/byStoreName
        const chainRollup = emptyRollup()
        const uniqueDates = new Set<string>()
        const invalidStoreIds = new Set<string>()

        const storeAgg = new Map<string, StoreCacheRollup>()
        const storeNameAgg = new Map<string, StoreCacheRollup>()

        data.forEach(row => {
            const rawTotalCost = Number(row.total_cost) || 0
            const rowFoodCost = resolveCachedFoodCostDollars(row)
            const rowPackagingCost = Number(row.packaging_cost) || 0
            const rowSales = Number(row.net_sales) || 0
            const rowMeatCost = Number(row.meat_cost) || 0
            const rowMeatLbs = Number(row.total_meat_lbs) || 0
            const rowAsadaLbs = Number(row.asada_raw_lbs) || 0
            const rowAsadaCost = Number(row.asada_cost) || 0
            const rowUnmappedSales = Number(row.unmapped_sales) || 0

            const isBrokenRow =
                isInvalidFoodCostCacheRow(rowFoodCost, rowSales) ||
                isInvalidFoodCostCacheRow(rawTotalCost, rowSales) ||
                isInvalidFoodCostCacheRow(rowFoodCost + rowPackagingCost, rowSales)

            uniqueDates.add(row.business_date)

            if (isBrokenRow) {
                invalidStoreIds.add(row.store_id)
                return
            }

            chainRollup.totalCost += rowFoodCost
            chainRollup.totalFoodCost += rowFoodCost
            chainRollup.totalPackagingCost += rowPackagingCost
            chainRollup.netSales += rowSales
            chainRollup.totalMeatCost += rowMeatCost
            chainRollup.totalMeatLbs += rowMeatLbs
            chainRollup.totalAsadaLbs += rowAsadaLbs
            chainRollup.totalAsadaCost += rowAsadaCost
            chainRollup.totalUnmappedSales += rowUnmappedSales

            const sid = row.store_id
            if (!storeAgg.has(sid)) {
                storeAgg.set(sid, emptyRollup())
            }
            const s = storeAgg.get(sid)!
            s.totalCost += rowFoodCost
            s.totalFoodCost += rowFoodCost
            s.totalPackagingCost += rowPackagingCost
            s.netSales += rowSales
            s.totalMeatCost += rowMeatCost
            s.totalMeatLbs += rowMeatLbs
            s.totalAsadaLbs += rowAsadaLbs
            s.totalAsadaCost += rowAsadaCost
            s.totalUnmappedSales += rowUnmappedSales

            const sname = row.store_name || sid
            if (!storeNameAgg.has(sname)) {
                storeNameAgg.set(sname, emptyRollup())
            }
            const sn = storeNameAgg.get(sname)!
            sn.totalCost += rowFoodCost
            sn.totalFoodCost += rowFoodCost
            sn.totalPackagingCost += rowPackagingCost
            sn.netSales += rowSales
            sn.totalMeatCost += rowMeatCost
            sn.totalMeatLbs += rowMeatLbs
            sn.totalAsadaLbs += rowAsadaLbs
            sn.totalAsadaCost += rowAsadaCost
            sn.totalUnmappedSales += rowUnmappedSales
        })

        const formattedChain = formatRollup(chainRollup)
        const totalDaysInRange = getDayCount(startDate, endDate)

        const byStore: Record<string, ReturnType<typeof formatRollup>> = {}
        storeAgg.forEach((val, sid) => {
            byStore[sid] = formatRollup(val)
        })

        const byStoreName: Record<string, ReturnType<typeof formatRollup>> = {}
        storeNameAgg.forEach((val, sname) => {
            byStoreName[sname] = formatRollup(val)
        })

        const isClosedCacheRange = endDate < getBusinessDateLA()
        return NextResponse.json({
            totalCost: formattedChain.totalCost,
            totalFoodCost: formattedChain.totalFoodCost,
            totalPackagingCost: formattedChain.totalPackagingCost,
            totalCogs: formattedChain.totalCogs,
            totalSales: formattedChain.netSales,
            costPercentage: formattedChain.costPercentage,
            packagingPercentage: formattedChain.packagingPercentage,
            totalCogsPercentage: formattedChain.totalCogsPercentage,
            totalMeatCost: formattedChain.totalMeatCost,
            totalMeatLbs: formattedChain.totalMeatLbs,
            totalAsadaLbs: formattedChain.totalAsadaLbs,
            totalAsadaCost: formattedChain.totalAsadaCost,
            totalUnmappedSales: formattedChain.totalUnmappedSales,
            daysWithData: uniqueDates.size,
            totalDaysInRange,
            invalidStoresCount: invalidStoreIds.size,
            byStore,
            byStoreName,
            cached: true,
            empty: false
        }, {
            headers: {
                'Cache-Control': isClosedCacheRange ? 'private, max-age=300' : 'private, max-age=30',
            },
        })

    } catch (e: any) {
        console.error('[FoodCostCache] Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

function getDayCount(start: string, end: string): number {
    const [sy, sm, sd] = start.split('-').map(Number)
    const [ey, em, ed] = end.split('-').map(Number)
    if (!sy || !sm || !sd || !ey || !em || !ed) return 0
    const diffDays = Math.round(
        (Date.UTC(ey, em - 1, ed, 12, 0, 0) - Date.UTC(sy, sm - 1, sd, 12, 0, 0)) / 86_400_000
    ) + 1
    return Math.max(0, diffDays)
}
