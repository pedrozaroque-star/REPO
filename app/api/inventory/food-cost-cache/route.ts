import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * LIGHTWEIGHT Food Cost Cache Reader
 * 
 * Instead of recalculating food cost from Toast + Recipes every time,
 * this endpoint reads pre-calculated aggregates from food_cost_daily_cache.
 * 
 * Response time: ~50ms (vs ~5-15s for the full calculation)
 * 
 * Cache is populated via write-through in /api/inventory/food-cost
 * every time someone views food cost data for a single day.
 * 
 * Params:
 *   - startDate: YYYY-MM-DD
 *   - endDate: YYYY-MM-DD
 *   - storeId: (optional) filter by specific store
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const storeId = searchParams.get('storeId') // optional

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 })
        }

        const supabase = await getSupabaseClient()

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
        let totalCost = 0
        let totalSales = 0
        const uniqueDates = new Set<string>()

        // Also aggregate by store for per-store table columns
        const storeAgg = new Map<string, { totalCost: number, netSales: number }>()

        data.forEach(row => {
            totalCost += Number(row.total_cost) || 0
            totalSales += Number(row.net_sales) || 0
            uniqueDates.add(row.business_date)

            // Per-store aggregation
            const sid = row.store_id
            if (!storeAgg.has(sid)) {
                storeAgg.set(sid, { totalCost: 0, netSales: 0 })
            }
            const s = storeAgg.get(sid)!
            s.totalCost += Number(row.total_cost) || 0
            s.netSales += Number(row.net_sales) || 0
        })

        const costPercentage = totalSales > 0 ? (totalCost / totalSales) * 100 : 0
        const totalDaysInRange = getDayCount(startDate, endDate)

        // Build per-store response
        const byStore: Record<string, { totalCost: number, netSales: number, costPercentage: number }> = {}
        storeAgg.forEach((val, storeId) => {
            byStore[storeId] = {
                totalCost: Number(val.totalCost.toFixed(2)),
                netSales: Number(val.netSales.toFixed(2)),
                costPercentage: val.netSales > 0 ? Number(((val.totalCost / val.netSales) * 100).toFixed(2)) : 0
            }
        })

        return NextResponse.json({
            totalCost: Number(totalCost.toFixed(2)),
            totalSales: Number(totalSales.toFixed(2)),
            costPercentage: Number(costPercentage.toFixed(2)),
            daysWithData: uniqueDates.size,
            totalDaysInRange,
            byStore,
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
