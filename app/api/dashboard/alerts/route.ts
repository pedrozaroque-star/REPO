import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// Targets
const LABOR_TARGET = 21.5
const LABOR_CRITICAL = 23
const FOOD_COST_TARGET = 32
const FOOD_COST_CRITICAL = 36

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0]
    const endDate = searchParams.get('endDate') || startDate

    // Calculate lookback window (28 days before start of current range)
    const lookbackEnd = new Date(startDate + 'T12:00:00')
    lookbackEnd.setDate(lookbackEnd.getDate() - 1)
    const lookbackStart = new Date(lookbackEnd)
    lookbackStart.setDate(lookbackStart.getDate() - 27) // 28 days total
    const lbStartStr = lookbackStart.toISOString().split('T')[0]
    const lbEndStr = lookbackEnd.toISOString().split('T')[0]

    // ── Parallel data fetch ──
    const [salesRes, fcRes, inspRes, supRes, schedRes, storesRes, histSalesRes] = await Promise.all([
      // 1. Sales + Labor by store (current range)
      supabaseAdmin.from('sales_daily_cache')
        .select('store_id, store_name, net_sales, labor_cost, business_date')
        .gte('business_date', startDate).lte('business_date', endDate),
      // 2. Food Cost by store
      supabaseAdmin.from('food_cost_daily_cache')
        .select('store_id, store_name, cost_percentage, net_sales, total_cost, business_date')
        .gte('business_date', startDate).lte('business_date', endDate),
      // 3. Inspections in date range
      supabaseAdmin.from('supervisor_inspections')
        .select('inspector_id, store_id, inspection_date')
        .gte('inspection_date', startDate).lte('inspection_date', endDate),
      // 4. Supervisors
      supabaseAdmin.from('users')
        .select('id, full_name, role')
        .eq('role', 'supervisor').eq('is_active', true),
      // 5. Supervisor schedules in date range (for knowing WHEN they were working)
      supabaseAdmin.from('schedules')
        .select('user_id, store_id, date, start_time, end_time')
        .gte('date', startDate).lte('date', endDate),
      // 6. Store details (numeric ID → name + supervisor_id ownership)
      supabaseAdmin.from('stores')
        .select('id, name, supervisor_id'),
      // 7. Historical sales for lookback (prior 4 weeks) — for self-comparison
      supabaseAdmin.from('sales_daily_cache')
        .select('store_id, store_name, net_sales, business_date')
        .gte('business_date', lbStartStr).lte('business_date', lbEndStr)
    ])

    const sales = salesRes.data || []
    const foodCosts = fcRes.data || []
    const inspections = inspRes.data || []
    const supervisors = supRes.data || []
    const schedules = schedRes.data || []
    const stores = storesRes.data || []
    const histSales = histSalesRes.data || []

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
    // 1. LABOR ALERTS — stores exceeding target
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
      .map(a => ({ ...a, severity: a.pct >= LABOR_CRITICAL ? 'critical' : a.pct >= LABOR_TARGET ? 'warning' : 'ok' as const }))
      .filter(a => a.severity !== 'ok')
      .sort((a, b) => b.pct - a.pct)

    // ══════════════════════════════════════════════════
    // 2. FOOD COST ALERTS — stores exceeding target
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
        severity: 'ok' as 'ok' | 'warning' | 'critical'
      }))
      .map(a => ({ ...a, severity: a.pct >= FOOD_COST_CRITICAL ? 'critical' : a.pct >= FOOD_COST_TARGET ? 'warning' : 'ok' as const }))
      .filter(a => a.severity !== 'ok')
      .sort((a, b) => b.pct - a.pct)

    // ══════════════════════════════════════════════════
    // 3. LOW SALES ALERTS — each store vs its OWN historical avg
    // Compare current performance vs prior 4 weeks daily average
    // ══════════════════════════════════════════════════

    // Calculate number of business days in current range
    const currentRangeDays = Math.max(1, Math.round(
      (new Date(endDate + 'T12:00:00').getTime() - new Date(startDate + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)
    ) + 1)

    // Build historical daily average per store from past 28 days
    const histByStore: Record<string, { totalSales: number; dayCount: number; storeId: string }> = {}
    histSales.forEach(r => {
      const name = (r.store_name || '').replace(/^Tacos Gavilan\s+/i, '').trim()
      if (!histByStore[name]) histByStore[name] = { totalSales: 0, dayCount: 0, storeId: r.store_id }
      histByStore[name].totalSales += Number(r.net_sales) || 0
      histByStore[name].dayCount++
    })

    // For each store: compare current sales vs expected (based on own history)
    const SELF_DECLINE_THRESHOLD = 15 // 15% below own average = alert
    const allStoreSales = Object.entries(laborByStore).map(([store, d]) => ({ store, sales: d.sales, storeId: d.storeId }))
    const lowSalesAlerts = allStoreSales
      .map(s => {
        const hist = histByStore[s.store]
        if (!hist || hist.dayCount < 7) return null // Need at least 7 days of history
        const dailyAvg = hist.totalSales / hist.dayCount
        const expectedSales = dailyAvg * currentRangeDays
        const pctChange = expectedSales > 0 ? ((s.sales - expectedSales) / expectedSales) * 100 : 0
        return {
          store: s.store,
          storeId: s.storeId,
          sales: Math.round(s.sales),
          expectedSales: Math.round(expectedSales),
          dailyAvgHist: Math.round(dailyAvg),
          pctChange: +pctChange.toFixed(1),
          histDays: hist.dayCount
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
        const schedule = supScheduleByDate[sup.id]?.[date]
        const wasScheduled = !!schedule
        const inspectedOnDate = supInspByDate[sup.id]?.[date] || new Set<number>()
        const inspectedNames = [...inspectedOnDate].map(id => storeNameMap[id] || `Store #${id}`)

        // Mark all inspected stores
        inspectedNames.forEach(n => allInspectedStores.add(n))

        if (wasScheduled) {
          totalScheduledDays++
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

          // Compliant if at least 1 owned store inspected
          const dayCompliant = ownedInspected.length > 0
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

      const compliancePct = totalScheduledDays > 0
        ? Math.round((totalCompliantDays / totalScheduledDays) * 100)
        : (allInspectedStores.size > 0 ? 100 : 0)

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
        compliant: totalScheduledDays > 0 ? totalCompliantDays === totalScheduledDays : allInspectedStores.size > 0,
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
