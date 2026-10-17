/**
 * @module api/dashboard/alerts/route
 * @description Operational Alerts Engine for the main Dashboard.
 *   Computes real-time store alerts for Labor Cost, Food Cost, Low Sales (self-comparison vs prior period),
 *   and Supervisor Inspection Compliance (cross-referencing store ownership, schedules, and inspections).
 * @businessRules
 * - Business day runs 6:00 AM to 5:59 AM next day in America/Los_Angeles.
 * - Labor Target: <= 21.5% (Warning > 21.5%, Critical > 23.0%).
 * - Food Cost Target: <= 32.0% (Warning > 32.0%, Critical > 36.0%).
 * - Low Sales Alert: Store drops >= 15% compared to its own equivalent previous period.
 * - Inspection Compliance: Each scheduled day for a supervisor requires >= 1 inspection at an owned store.
 *   Future dates or shifts still in progress today are not penalized as misses.
 * @dataFlow
 * - GET /api/dashboard/alerts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * - Reads sales_daily_cache (with fetchToastData live fallback), food_cost_daily_cache (with foodCostGet fallback),
 *   supervisor_inspections, users, schedules (filtered by supervisor IDs), and stores.
 * @notes
 * - [2026-10-16] Fixed schedules PostgREST 1,000-row truncation by filtering .in('user_id', supervisorIds).
 * - [2026-10-16] Added live fallback when today's cache is not yet populated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchToastData } from '@/lib/toast-api'
import { GET as foodCostGet } from '@/app/api/inventory/food-cost/route'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { persistSession: false } }
)

// Targets
const LABOR_TARGET = 21.5
const LABOR_CRITICAL = 23
const FOOD_COST_TARGET = 32
const FOOD_COST_CRITICAL = 36

function getBusinessDateLA(): { dateStr: string; timeStr: string } {
  const now = new Date()
  const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const hh = String(laTime.getHours()).padStart(2, '0')
  const mm = String(laTime.getMinutes()).padStart(2, '0')
  if (laTime.getHours() < 6) {
    laTime.setDate(laTime.getDate() - 1)
  }
  const y = laTime.getFullYear()
  const m = String(laTime.getMonth() + 1).padStart(2, '0')
  const d = String(laTime.getDate()).padStart(2, '0')
  return { dateStr: `${y}-${m}-${d}`, timeStr: `${hh}:${mm}` }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const { dateStr: todayBusinessStr, timeStr: nowTimeLA } = getBusinessDateLA()
    const startDate = searchParams.get('startDate') || todayBusinessStr
    const endDate = searchParams.get('endDate') || startDate

    // Calculate lookback: equivalent previous period (same length)
    const rangeMs = new Date(endDate + 'T12:00:00').getTime() - new Date(startDate + 'T12:00:00').getTime()
    const rangeDays = Math.max(1, Math.round(rangeMs / (1000 * 60 * 60 * 24)) + 1)

    let lookbackEnd: Date, lookbackStart: Date
    if (rangeDays <= 2) {
      // For single/two day filters: compare vs same day(s) last week
      lookbackEnd = new Date(endDate + 'T12:00:00')
      lookbackEnd.setDate(lookbackEnd.getDate() - 7)
      lookbackStart = new Date(startDate + 'T12:00:00')
      lookbackStart.setDate(lookbackStart.getDate() - 7)
    } else {
      // For longer ranges: compare vs equivalent previous period
      lookbackEnd = new Date(startDate + 'T12:00:00')
      lookbackEnd.setDate(lookbackEnd.getDate() - 1)
      lookbackStart = new Date(lookbackEnd)
      lookbackStart.setDate(lookbackStart.getDate() - (rangeDays - 1))
    }
    const lbStartStr = lookbackStart.toISOString().split('T')[0]
    const lbEndStr = lookbackEnd.toISOString().split('T')[0]

    // First fetch supervisors (tiny table, ~4 rows) so we can filter schedules strictly by supervisor IDs
    const { data: supervisorsData } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role')
      .eq('role', 'supervisor')
      .eq('is_active', true)

    const supervisors = supervisorsData || []
    const supervisorIds = supervisors.map(s => s.id)

    // ── Parallel data fetch ──
    const [salesRes, fcRes, inspRes, schedRes, storesRes, histSalesRes] = await Promise.all([
      // 1. Sales + Labor by store (current range)
      supabaseAdmin.from('sales_daily_cache')
        .select('store_id, store_name, net_sales, labor_cost, business_date')
        .gte('business_date', startDate).lte('business_date', endDate)
        .limit(5000),
      // 2. Food Cost by store
      supabaseAdmin.from('food_cost_daily_cache')
        .select('store_id, store_name, cost_percentage, net_sales, total_cost, business_date')
        .gte('business_date', startDate).lte('business_date', endDate)
        .limit(5000),
      // 3. Inspections in date range
      supabaseAdmin.from('supervisor_inspections')
        .select('inspector_id, store_id, inspection_date')
        .gte('inspection_date', startDate).lte('inspection_date', endDate)
        .limit(5000),
      // 4. Supervisor schedules in date range (strictly filtered by supervisorIds to prevent 1,000-row truncation!)
      supervisorIds.length > 0
        ? supabaseAdmin.from('schedules')
            .select('user_id, store_id, date, start_time, end_time')
            .in('user_id', supervisorIds)
            .gte('date', startDate).lte('date', endDate)
            .limit(5000)
        : Promise.resolve({ data: [] as any[] }),
      // 5. Store details (numeric ID → name + supervisor_id ownership + external_id)
      supabaseAdmin.from('stores')
        .select('id, name, supervisor_id, external_id'),
      // 6. Historical sales for lookback — for self-comparison
      supabaseAdmin.from('sales_daily_cache')
        .select('store_id, store_name, net_sales, business_date')
        .gte('business_date', lbStartStr).lte('business_date', lbEndStr)
        .limit(5000)
    ])

    let sales = salesRes.data || []
    let foodCosts = fcRes.data || []
    const inspections = inspRes.data || []
    const schedules = schedRes.data || []
    const stores = storesRes.data || []
    const histSales = histSalesRes.data || []

    // Live fallback for Sales + Labor if cache is empty on a short range (e.g. Today early morning)
    if (sales.length === 0 && rangeDays <= 2) {
      try {
        const liveSales = await fetchToastData({
          storeIds: 'all',
          startDate,
          endDate,
          groupBy: 'day',
          allowDirtyCache: true
        })
        if (liveSales.rows && liveSales.rows.length > 0) {
          sales = liveSales.rows.map(r => ({
            store_id: r.storeId,
            store_name: r.storeName,
            net_sales: r.netSales || 0,
            labor_cost: r.laborCost || 0,
            business_date: r.periodStart
          }))
        }
      } catch (e) {
        console.error('[Dashboard Alerts] Live sales fallback error:', e)
      }
    }

    // Live fallback for Food Cost if cache is missing/incomplete on 1-day range
    const distinctFcStores = new Set(foodCosts.map(r => r.store_id).filter(Boolean))
    if (rangeDays === 1 && distinctFcStores.size < 14) {
      try {
        const directReq = new NextRequest(`http://localhost:3000/api/inventory/food-cost?storeId=all&startDate=${startDate}&endDate=${endDate}`)
        const directRes = await foodCostGet(directReq)
        if (directRes.ok) {
          const directJson = await directRes.json()
          if (directJson.data && directJson.data.length > 0) {
            const byStore: Record<string, { store_id: string; store_name: string; total_cost: number; net_sales: number }> = {}
            directJson.data.forEach((item: any) => {
              const sName = item.store_name || 'Unknown'
              if (!byStore[sName]) {
                byStore[sName] = { store_id: item.store_id || '', store_name: sName, total_cost: 0, net_sales: 0 }
              }
              byStore[sName].total_cost += Number(item.total_cost || 0)
              byStore[sName].net_sales += Number(item.net_sales || 0)
            })
            if (directJson.salesNetSales) {
              Object.entries(directJson.salesNetSales as Record<string, number>).forEach(([sName, authSales]) => {
                if (byStore[sName] && authSales > 0) {
                  byStore[sName].net_sales = Number(authSales)
                }
              })
            }
            foodCosts = Object.values(byStore).map(s => ({
              store_id: s.store_id,
              store_name: s.store_name,
              total_cost: s.total_cost,
              net_sales: s.net_sales,
              cost_percentage: s.net_sales > 0 ? (s.total_cost / s.net_sales) * 100 : 0,
              business_date: startDate
            }))
          }
        }
      } catch (e) {
        console.error('[Dashboard Alerts] Live food cost fallback error:', e)
      }
    }

    // Build store numeric ID → name map
    const storeNameMap: Record<number, string> = {}
    stores.forEach(s => { storeNameMap[s.id] = (s.name || '').replace(/^Tacos Gavilan\s+/i, '').trim() })

    // ══════════════════════════════════════════════════
    // Build OWNERSHIP map: supervisor_id → store_ids[]
    // This comes from stores.supervisor_id, NOT schedules
    // ══════════════════════════════════════════════════
    const supOwnedStores: Record<number, number[]> = {}
    stores.forEach(s => {
      if (s.supervisor_id) {
        if (!supOwnedStores[s.supervisor_id]) supOwnedStores[s.supervisor_id] = []
        supOwnedStores[s.supervisor_id].push(s.id)
      }
    })

    // ══════════════════════════════════════════════════
    // 1. LABOR ALERTS — stores exceeding target (> 21.5% warning, > 23% critical)
    // ══════════════════════════════════════════════════
    const laborByStore: Record<string, { sales: number; labor: number; storeId: string }> = {}
    sales.forEach(r => {
      const name = (r.store_name || '').replace(/^Tacos Gavilan\s+/i, '').trim()
      if (!laborByStore[name]) laborByStore[name] = { sales: 0, labor: 0, storeId: r.store_id }
      laborByStore[name].sales += Number(r.net_sales) || 0
      laborByStore[name].labor += Number(r.labor_cost) || 0
    })
    const laborAlerts = Object.entries(laborByStore)
      .map(([store, d]) => ({
        store,
        storeId: d.storeId,
        pct: d.sales > 0 ? +((d.labor / d.sales) * 100).toFixed(1) : 0,
        sales: Math.round(d.sales),
        labor: Math.round(d.labor),
        severity: 'ok' as 'ok' | 'warning' | 'critical'
      }))
      .map(a => ({ ...a, severity: a.pct > LABOR_CRITICAL ? 'critical' : a.pct > LABOR_TARGET ? 'warning' : 'ok' as const }))
      .filter(a => a.severity !== 'ok')
      .sort((a, b) => b.pct - a.pct)

    // ══════════════════════════════════════════════════
    // 2. FOOD COST ALERTS — stores exceeding target (> 32% warning, > 36% critical)
    // ══════════════════════════════════════════════════
    const fcByStore: Record<string, { cost: number; sales: number; storeId: string }> = {}
    foodCosts.forEach(r => {
      const name = (r.store_name || '').replace(/^Tacos Gavilan\s+/i, '').trim()
      if (!fcByStore[name]) fcByStore[name] = { cost: 0, sales: 0, storeId: r.store_id }
      fcByStore[name].cost += Number(r.total_cost) || 0
      fcByStore[name].sales += Number(r.net_sales) || 0
    })
    const foodCostAlerts = Object.entries(fcByStore)
      .map(([store, d]) => ({
        store,
        storeId: d.storeId,
        pct: d.sales > 0 ? +((d.cost / d.sales) * 100).toFixed(1) : 0,
        sales: Math.round(d.sales),
        cost: Math.round(d.cost),
        severity: 'ok' as 'ok' | 'warning' | 'critical'
      }))
      .map(a => ({ ...a, severity: a.pct > FOOD_COST_CRITICAL ? 'critical' : a.pct > FOOD_COST_TARGET ? 'warning' : 'ok' as const }))
      .filter(a => a.severity !== 'ok')
      .sort((a, b) => b.pct - a.pct)

    // ══════════════════════════════════════════════════
    // 3. LOW SALES ALERTS — each store vs its OWN previous period
    // e.g. This month vs last month, this week vs last week
    // ══════════════════════════════════════════════════

    // Build previous period total per store
    const prevByStore: Record<string, { totalSales: number; storeId: string }> = {}
    histSales.forEach(r => {
      const name = (r.store_name || '').replace(/^Tacos Gavilan\s+/i, '').trim()
      if (!prevByStore[name]) prevByStore[name] = { totalSales: 0, storeId: r.store_id }
      prevByStore[name].totalSales += Number(r.net_sales) || 0
    })

    // For each store: compare current vs previous equivalent period
    const SELF_DECLINE_THRESHOLD = 15 // 15% below previous period = alert
    const allStoreSales = Object.entries(laborByStore).map(([store, d]) => ({ store, sales: d.sales, storeId: d.storeId }))
    const prevPeriodLabel = rangeDays <= 2
      ? `mismo día semana pasada`
      : `${lbStartStr.slice(5)} al ${lbEndStr.slice(5)}`
    const lowSalesAlerts = allStoreSales
      .map(s => {
        const prev = prevByStore[s.store]
        if (!prev || prev.totalSales <= 0) return null
        const pctChange = ((s.sales - prev.totalSales) / prev.totalSales) * 100
        return {
          store: s.store,
          storeId: s.storeId,
          sales: Math.round(s.sales),
          previousSales: Math.round(prev.totalSales),
          pctChange: +pctChange.toFixed(1),
          prevPeriodLabel
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null && s.pctChange <= -SELF_DECLINE_THRESHOLD)
      .sort((a, b) => a.pctChange - b.pctChange)

    // ══════════════════════════════════════════════════
    // 4. INSPECTION COMPLIANCE — per supervisor per date
    // Uses stores.supervisor_id for OWNERSHIP (not schedules)
    // Cross-refs with schedules to know WHEN supervisor was working
    // ══════════════════════════════════════════════════

    // Generate list of dates in range
    const dateList: string[] = []
    const dtStart = new Date(startDate + 'T12:00:00')
    const dtEnd = new Date(endDate + 'T12:00:00')
    for (let d = new Date(dtStart); d <= dtEnd; d.setDate(d.getDate() + 1)) {
      dateList.push(d.toISOString().split('T')[0])
    }

    // Build schedule lookup: supId → date → {store_id, start_time, end_time}
    const supScheduleByDate: Record<number, Record<string, { store_id: number; start_time: string; end_time: string }>> = {}
    schedules.forEach(s => {
      if (!supScheduleByDate[s.user_id]) supScheduleByDate[s.user_id] = {}
      supScheduleByDate[s.user_id][s.date] = {
        store_id: s.store_id,
        start_time: s.start_time,
        end_time: s.end_time
      }
    })

    // Build inspection lookup: supId → date → Set<store_id>
    const supInspByDate: Record<number, Record<string, Set<number>>> = {}
    inspections.forEach(i => {
      if (!supInspByDate[i.inspector_id]) supInspByDate[i.inspector_id] = {}
      if (!supInspByDate[i.inspector_id][i.inspection_date]) supInspByDate[i.inspector_id][i.inspection_date] = new Set()
      supInspByDate[i.inspector_id][i.inspection_date].add(i.store_id)
    })

    const inspectionCompliance = supervisors.map(sup => {
      const ownedStoreIds = supOwnedStores[sup.id] || []
      const ownedStoreNames = ownedStoreIds.map(id => storeNameMap[id] || `Store #${id}`)

      // Per-date detail
      const dailyDetail: {
        date: string
        wasScheduled: boolean
        scheduledAt: string | null
        shift: string | null
        inspectedStores: string[]
        ownedStoresInspected: string[]
        ownedStoresMissing: string[]
        compliant: boolean
      }[] = []

      let totalScheduledDays = 0
      let totalCompliantDays = 0
      const allInspectedStores = new Set<string>()
      const allMissingStores = new Set<string>()

      dateList.forEach(date => {
        // Never evaluate future dates as missed inspections
        if (date > todayBusinessStr) return

        const schedule = supScheduleByDate[sup.id]?.[date]
        const wasScheduled = !!schedule
        const inspectedOnDate = supInspByDate[sup.id]?.[date] || new Set<number>()
        const inspectedNames = [...inspectedOnDate].map(id => storeNameMap[id] || `Store #${id}`)

        // Mark all inspected stores
        inspectedNames.forEach(n => allInspectedStores.add(n))

        if (wasScheduled) {
          const scheduledStoreName = storeNameMap[schedule.store_id] || `Store #${schedule.store_id}`
          const shift = schedule.start_time && schedule.end_time
            ? `${schedule.start_time.slice(0, 5)} - ${schedule.end_time.slice(0, 5)}`
            : null

          // Check: did the supervisor inspect at least one of their OWNED stores this day?
          const ownedInspected = ownedStoreIds
            .filter(id => inspectedOnDate.has(id))
            .map(id => storeNameMap[id] || `Store #${id}`)
          const ownedMissing = ownedStoreIds
            .filter(id => !inspectedOnDate.has(id))
            .map(id => storeNameMap[id] || `Store #${id}`)

          const dayCompliant = ownedInspected.length > 0

          // If this is TODAY and the supervisor hasn't inspected yet, check if their shift is still in progress or hasn't ended
          if (date === todayBusinessStr && !dayCompliant) {
            const endTimeShort = schedule.end_time ? schedule.end_time.slice(0, 5) : '23:59'
            // Only count today as a missed scheduled day if current LA time has passed the shift end_time
            if (nowTimeLA <= endTimeShort) {
              return
            }
          }

          totalScheduledDays++
          if (dayCompliant) totalCompliantDays++
          ownedMissing.forEach(n => allMissingStores.add(n))

          dailyDetail.push({
            date,
            wasScheduled: true,
            scheduledAt: scheduledStoreName,
            shift,
            inspectedStores: inspectedNames,
            ownedStoresInspected: ownedInspected,
            ownedStoresMissing: ownedMissing,
            compliant: dayCompliant
          })
        }
      })

      // Extra stores (inspected but not owned)
      const ownedNames = new Set(ownedStoreNames)
      const extraStores = [...allInspectedStores].filter(n => !ownedNames.has(n))

      // If supervisor had 0 scheduled days due in this period (e.g. day off or shift still in progress today), they are 100% compliant
      const compliancePct = totalScheduledDays > 0
        ? Math.round((totalCompliantDays / totalScheduledDays) * 100)
        : 100

      return {
        supervisor: sup.full_name.split(' ')[0],
        supervisorFull: sup.full_name,
        supervisorId: sup.id,
        ownedStores: ownedStoreNames,
        scheduledStores: ownedStoreNames, // Legacy compat: these are their owned stores
        inspectedStores: [...allInspectedStores],
        extraStores,
        missingStores: [...allMissingStores],
        totalScheduled: totalScheduledDays,
        totalInspected: totalCompliantDays,
        totalInspections: allInspectedStores.size,
        compliant: totalScheduledDays > 0 ? totalCompliantDays === totalScheduledDays : true,
        compliancePct,
        dailyDetail: dailyDetail.filter(d => d.wasScheduled) // Only show days they were scheduled
      }
    }).sort((a, b) => a.compliancePct - b.compliancePct)

    // ══════════════════════════════════════════════════
    // Summary counts
    // ══════════════════════════════════════════════════
    const totalAlerts = laborAlerts.length + foodCostAlerts.length + lowSalesAlerts.length + inspectionCompliance.filter(s => !s.compliant).length

    return NextResponse.json({
      totalAlerts,
      laborAlerts,
      foodCostAlerts,
      lowSalesAlerts,
      inspectionCompliance,
      targets: { labor: LABOR_TARGET, laborCritical: LABOR_CRITICAL, foodCost: FOOD_COST_TARGET, foodCostCritical: FOOD_COST_CRITICAL },
      dateRange: { startDate, endDate }
    })
  } catch (err: any) {
    console.error('[Dashboard Alerts] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
