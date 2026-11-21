/**
 * @module api/food-cost/variance-avt
 * @description Generates the Actual vs. Theoretical (AvT) food variance analysis,
 * ranking ingredients by real measured financial loss in dollars ($ Loss).
 *
 * @businessRules
 * - Requires authenticated staff session via `verifyStaffAuth`.
 * - Theoretical Usage (Theo): Calculated from Toast POS product mix (PMIX) * standardized recipe portions (`food_cost_daily_cache`), falling back to calibrated sales-volume benchmarks only for theoretical projection.
 * - Actual Usage (Actl): Computed ONLY from real physical inventory counts (`starting_count + deliveries - ending_count`) when at least two physical counts exist for the period.
 * - **Zero Synthetic Variance**: When no complete physical count exists for an item, `actual_qty`, `variance_qty`, and `dollar_loss` are reported honestly as `0` with `status: 'unmeasured'` and `dataSource: 'unmeasured'` — NEVER fabricated via character hashes.
 *
 * @dataFlow
 * - `verifyStaffAuth` -> `inventory_items`, `sales_daily_cache`, `food_cost_daily_cache`, `inventory_counts`, `inventory_orders` + `inventory_order_lines` -> Ranked AvT Matrix -> `/admin/food-cost/varianza`
 *
 * @notes
 * - Hardened 2026-11-20: Added `verifyStaffAuth` and eradicated synthetic ASCII-hash variance (`hash % 25 - 8`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

interface AvTItem {
  id: string
  name: string
  category: 'Meat' | 'Dairy' | 'Produce' | 'Grocery' | 'Packaging'
  unit_measure: string
  unit_cost: number
  actual_qty: number
  theoretical_qty: number
  variance_qty: number
  waste_qty: number
  unexplained_variance: number
  efficiency_pct: number
  actual_dollar: number
  theoretical_dollar: number
  dollar_loss: number
  status: 'critical' | 'warning' | 'normal' | 'efficient' | 'unmeasured'
  dataSource?: 'real' | 'benchmark' | 'unmeasured'
  hasRealInventoryData?: boolean
}

function round2(val: number): number {
  return parseFloat((val || 0).toFixed(2))
}

export async function GET(request: NextRequest) {
  const auth = verifyStaffAuth(request)
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId') || 'all'
    const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0]
    const endDate = searchParams.get('endDate') || startDate
    const categoryFilter = searchParams.get('category') || 'all'

    // Resolve numeric store ID alongside Toast GUID if a single store was requested
    let targetNumericStoreId: number | null = null
    let targetStoreGuid: string | null = null
    if (storeId !== 'all') {
      if (/^\d+$/.test(storeId)) {
        targetNumericStoreId = Number(storeId)
        const { data: st } = await supabase
          .from('stores')
          .select('id, external_id')
          .eq('id', targetNumericStoreId)
          .maybeSingle()
        targetStoreGuid = st?.external_id || null
      } else {
        targetStoreGuid = storeId
        const { data: st } = await supabase
          .from('stores')
          .select('id, external_id')
          .eq('external_id', storeId)
          .maybeSingle()
        targetNumericStoreId = typeof st?.id === 'number' ? st.id : null
      }
    }

    // 1. Fetch inventory items
    const { data: rawItems, error: itemsErr } = await supabase
      .from('inventory_items')
      .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, unit_measure, is_bodega, yield_percent')
      .order('name')

    if (itemsErr) throw itemsErr

    // 2. Fetch sales summary for the period
    let salesQuery = supabase
      .from('sales_daily_cache')
      .select('net_sales, store_id')
      .gte('business_date', startDate)
      .lte('business_date', endDate)

    if (storeId !== 'all') {
      salesQuery = salesQuery.eq('store_id', targetStoreGuid || storeId)
    }

    const { data: salesRows } = await salesQuery
    const totalNetSales = (salesRows || []).reduce((sum, r) => sum + Number(r.net_sales || 0), 0)

    if (totalNetSales === 0) {
      return NextResponse.json({
        storeId,
        startDate,
        endDate,
        totalNetSales: 0,
        totalTheoreticalDollar: 0,
        totalActualDollar: 0,
        totalDollarLoss: 0,
        overallEfficiencyPct: 0,
        itemsCount: 0,
        items: [],
        dataQuality: 'unmeasured',
        message: 'No sales data found for the given period. Cannot calculate theoretical consumption.'
      })
    }

    // 3. Fetch real physical inventory counts ordered chronologically
    let countsQuery = supabase
      .from('inventory_counts')
      .select('inventory_item_id, quantity_on_hand, count_date, store_id')
      .gte('count_date', startDate)
      .lte('count_date', endDate)
      .order('count_date', { ascending: true })

    if (storeId !== 'all') {
      const possibleStoreIds = [storeId, targetStoreGuid, targetNumericStoreId ? String(targetNumericStoreId) : null]
        .filter((v): v is string => Boolean(v))
      countsQuery = countsQuery.in('store_id', Array.from(new Set(possibleStoreIds)))
    }

    const { data: countsRows } = await countsQuery

    // Group counts by (store_id, inventory_item_id) to measure real starting vs ending stock when >= 2 counts exist
    const countsByStoreAndItem = new Map<string, Array<{ date: string; qty: number }>>()
    for (const c of countsRows || []) {
      const key = `${c.store_id}::${c.inventory_item_id}`
      const arr = countsByStoreAndItem.get(key) || []
      arr.push({ date: String(c.count_date), qty: Number(c.quantity_on_hand || 0) })
      countsByStoreAndItem.set(key, arr)
    }

    // Fetch real warehouse deliveries in the period (inventory_orders + inventory_order_lines)
    let ordersQuery = supabase
      .from('inventory_orders')
      .select('id, store_id, order_date')
      .gte('order_date', startDate)
      .lte('order_date', endDate)

    if (storeId !== 'all' && targetNumericStoreId !== null) {
      ordersQuery = ordersQuery.eq('store_id', targetNumericStoreId)
    }

    const { data: invOrders } = await ordersQuery
    const orderIds = (invOrders || []).map(o => o.id)
    const deliveredByItem = new Map<string, number>()

    if (orderIds.length > 0) {
      const { data: orderLines } = await supabase
        .from('inventory_order_lines')
        .select('inventory_item_id, final_qty, adjusted_qty, calculated_qty')
        .in('order_id', orderIds)

      for (const ln of orderLines || []) {
        const itemIdStr = String(ln.inventory_item_id)
        const qty = Number(ln.final_qty ?? ln.adjusted_qty ?? ln.calculated_qty ?? 0)
        if (Number.isFinite(qty) && qty > 0) {
          deliveredByItem.set(itemIdStr, (deliveredByItem.get(itemIdStr) || 0) + qty)
        }
      }
    }

    // Aggregate measured actual usage across stores where starting + ending counts exist
    const measuredActualByItem = new Map<string, number>()
    for (const [compositeKey, snapshots] of countsByStoreAndItem.entries()) {
      const [, itemIdStr] = compositeKey.split('::')
      // Deduplicate by count_date
      const byDate = new Map<string, number>()
      for (const snap of snapshots) {
        byDate.set(snap.date, snap.qty)
      }
      const orderedDates = Array.from(byDate.keys()).sort()
      if (orderedDates.length >= 2) {
        const startingQty = byDate.get(orderedDates[0]) || 0
        const endingQty = byDate.get(orderedDates[orderedDates.length - 1]) || 0
        const prev = measuredActualByItem.get(itemIdStr) || 0
        measuredActualByItem.set(itemIdStr, prev + (startingQty - endingQty))
      }
    }

    // 4. Fetch real theoretical usage from PMIX via food_cost_daily_cache
    let fcQuery = supabase
      .from('food_cost_daily_cache')
      .select('store_id, total_cost, details')
      .gte('business_date', startDate)
      .lte('business_date', endDate)

    if (storeId !== 'all') {
      fcQuery = fcQuery.eq('store_id', targetStoreGuid || storeId)
    }
    const { data: fcRows } = await fcQuery

    const realTheoMap = new Map<string, number>()
    for (const fc of fcRows || []) {
      if (fc.details && Array.isArray(fc.details)) {
        for (const item of fc.details) {
          if (item.inventory_item_id) {
            const k = String(item.inventory_item_id)
            realTheoMap.set(k, (realTheoMap.get(k) || 0) + Number(item.theoretical_qty || 0))
          }
        }
      }
    }

    const salesK = Math.max(1, totalNetSales / 1000)
    const avtList: AvTItem[] = []

    for (const item of rawItems || []) {
      const nameLower = item.name.toLowerCase()
      let category: AvTItem['category'] = 'Grocery'
      let theoPer1k = 0
      let unitCost = Number(item.purchase_unit_cost || 0)

      if (nameLower.includes('asada')) {
        category = 'Meat'
        theoPer1k = 42.5
        if (unitCost === 0) unitCost = 4.85
      } else if (nameLower.includes('pastor') || nameLower.includes('adobada')) {
        category = 'Meat'
        theoPer1k = 38.0
        if (unitCost === 0) unitCost = 3.25
      } else if (nameLower.includes('pollo') || nameLower.includes('chicken')) {
        category = 'Meat'
        theoPer1k = 24.5
        if (unitCost === 0) unitCost = 2.45
      } else if (nameLower.includes('carnitas')) {
        category = 'Meat'
        theoPer1k = 14.0
        if (unitCost === 0) unitCost = 2.85
      } else if (nameLower.includes('cabeza')) {
        category = 'Meat'
        theoPer1k = 8.5
        if (unitCost === 0) unitCost = 4.10
      } else if (nameLower.includes('lengua')) {
        category = 'Meat'
        theoPer1k = 6.0
        if (unitCost === 0) unitCost = 7.95
      } else if (nameLower.includes('queso') || nameLower.includes('cheese') || nameLower.includes('monterey') || nameLower.includes('oaxaca')) {
        category = 'Dairy'
        theoPer1k = 18.5
        if (unitCost === 0) unitCost = 2.70
      } else if (nameLower.includes('frijol') || nameLower.includes('beans')) {
        category = 'Grocery'
        theoPer1k = 16.0
        if (unitCost === 0) unitCost = 0.85
      } else if (nameLower.includes('arroz') || nameLower.includes('rice')) {
        category = 'Grocery'
        theoPer1k = 14.0
        if (unitCost === 0) unitCost = 0.78
      } else if (nameLower.includes('tortilla')) {
        category = 'Grocery'
        theoPer1k = 85.0
        if (unitCost === 0) unitCost = 0.65
      } else if (nameLower.includes('aguacate') || nameLower.includes('cebolla') || nameLower.includes('cilantro') || nameLower.includes('limon')) {
        category = 'Produce'
        theoPer1k = 12.0
        if (unitCost === 0) unitCost = 1.60
      } else {
        if (!item.is_bodega && !nameLower.includes('carne')) continue
        theoPer1k = 5.0
        if (unitCost === 0) unitCost = 2.00
      }

      if (categoryFilter !== 'all' && category !== categoryFilter) {
        continue
      }

      const itemIdStr = String(item.id)
      let theoreticalQty = realTheoMap.get(itemIdStr) || 0
      let theoSource: 'real' | 'benchmark' = 'real'

      if (theoreticalQty <= 0) {
        theoreticalQty = round2(theoPer1k * salesK)
        theoSource = 'benchmark'
      }

      if (theoreticalQty <= 0) continue

      const theoreticalDollar = round2(theoreticalQty * unitCost)
      const hasMeasuredCountDelta = measuredActualByItem.has(itemIdStr)

      if (hasMeasuredCountDelta) {
        const netStockReduction = measuredActualByItem.get(itemIdStr) || 0
        const deliveredQty = deliveredByItem.get(itemIdStr) || 0
        const actualQty = round2(Math.max(0, netStockReduction + deliveredQty))
        const varianceQty = round2(actualQty - theoreticalQty)
        const unexplainedVar = round2(Math.max(0, varianceQty))
        const efficiencyPct = actualQty > 0 ? round2((theoreticalQty / actualQty) * 100) : 0
        const actualDollar = round2(actualQty * unitCost)
        const dollarLoss = round2(varianceQty * unitCost)

        let status: AvTItem['status'] = 'normal'
        if (dollarLoss > 150 || (actualQty > 0 && efficiencyPct < 85)) {
          status = 'critical'
        } else if (dollarLoss > 50 || (actualQty > 0 && efficiencyPct < 92)) {
          status = 'warning'
        } else if (efficiencyPct >= 98 && efficiencyPct <= 102) {
          status = 'efficient'
        }

        avtList.push({
          id: itemIdStr,
          name: item.name,
          category,
          unit_measure: item.unit_measure || item.unit_type || 'LB',
          unit_cost: unitCost,
          actual_qty: actualQty,
          theoretical_qty: theoreticalQty,
          variance_qty: varianceQty,
          waste_qty: 0,
          unexplained_variance: unexplainedVar,
          efficiency_pct: efficiencyPct,
          actual_dollar: actualDollar,
          theoretical_dollar: theoreticalDollar,
          dollar_loss: dollarLoss,
          status,
          dataSource: theoSource,
          hasRealInventoryData: true
        })
      } else {
        // Honest unmeasured state — zero fabricated variance
        avtList.push({
          id: itemIdStr,
          name: item.name,
          category,
          unit_measure: item.unit_measure || item.unit_type || 'LB',
          unit_cost: unitCost,
          actual_qty: 0,
          theoretical_qty: theoreticalQty,
          variance_qty: 0,
          waste_qty: 0,
          unexplained_variance: 0,
          efficiency_pct: 0,
          actual_dollar: 0,
          theoretical_dollar: theoreticalDollar,
          dollar_loss: 0,
          status: 'unmeasured',
          dataSource: 'unmeasured',
          hasRealInventoryData: false
        })
      }
    }

    avtList.sort((a, b) => {
      if (b.dollar_loss !== a.dollar_loss) return b.dollar_loss - a.dollar_loss
      return b.theoretical_dollar - a.theoretical_dollar
    })

    const measuredItems = avtList.filter(i => i.hasRealInventoryData)
    const totalTheoreticalDollar = round2(avtList.reduce((sum, i) => sum + i.theoretical_dollar, 0))
    const totalActualDollar = round2(measuredItems.reduce((sum, i) => sum + i.actual_dollar, 0))
    const totalDollarLoss = round2(measuredItems.reduce((sum, i) => sum + (i.dollar_loss > 0 ? i.dollar_loss : 0), 0))
    const measuredTheoDollar = round2(measuredItems.reduce((sum, i) => sum + i.theoretical_dollar, 0))
    const overallEfficiencyPct = totalActualDollar > 0 ? round2((measuredTheoDollar / totalActualDollar) * 100) : 0

    const dataQuality =
      measuredItems.length === 0
        ? 'unmeasured'
        : measuredItems.length === avtList.length
          ? 'real'
          : 'mixed'

    return NextResponse.json({
      storeId,
      startDate,
      endDate,
      totalNetSales: round2(totalNetSales),
      totalTheoreticalDollar,
      totalActualDollar,
      totalDollarLoss,
      overallEfficiencyPct,
      itemsCount: avtList.length,
      measuredItemsCount: measuredItems.length,
      items: avtList,
      dataQuality
    })
  } catch (err: any) {
    console.error('Error in GET /api/food-cost/variance-avt:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
