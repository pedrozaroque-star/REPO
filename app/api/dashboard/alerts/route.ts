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

    // ── Parallel data fetch ──
    const [salesRes, fcRes, inspRes, supRes, schedRes, storesRes] = await Promise.all([
      // 1. Sales + Labor by store
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
      // 5. Supervisor schedules in date range
      supabaseAdmin.from('schedules')
        .select('user_id, store_id, date')
        .gte('date', startDate).lte('date', endDate),
      // 6. Store names (numeric ID → name)
      supabaseAdmin.from('stores')
        .select('id, name')
    ])

    const sales = salesRes.data || []
    const foodCosts = fcRes.data || []
    const inspections = inspRes.data || []
    const supervisors = supRes.data || []
    const schedules = schedRes.data || []
    const stores = storesRes.data || []

    // Build store numeric ID → name map
    const storeNameMap: Record<number, string> = {}
    stores.forEach(s => { storeNameMap[s.id] = (s.name || '').replace(/^Tacos Gavilan\s+/i, '').trim() })

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
    // 3. LOW SALES ALERTS — stores below fleet average
    // ══════════════════════════════════════════════════
    const allStoreSales = Object.entries(laborByStore).map(([store, d]) => ({ store, sales: d.sales, storeId: d.storeId }))
    const fleetAvg = allStoreSales.length > 0
      ? allStoreSales.reduce((s, r) => s + r.sales, 0) / allStoreSales.length
      : 0
    const lowThreshold = fleetAvg * 0.75 // 25% below average
    const lowSalesAlerts = allStoreSales
      .filter(s => s.sales < lowThreshold && s.sales > 0)
      .map(s => ({
        store: s.store,
        storeId: s.storeId,
        sales: Math.round(s.sales),
        fleetAvg: Math.round(fleetAvg),
        pctBelowAvg: +((1 - s.sales / fleetAvg) * 100).toFixed(1)
      }))
      .sort((a, b) => a.sales - b.sales)

    // ══════════════════════════════════════════════════
    // 4. INSPECTION COMPLIANCE — supervisors vs schedules
    // ══════════════════════════════════════════════════
    const supIds = supervisors.map(s => s.id)

    // Build: supervisor → Set of scheduled store_ids (numeric)
    const supScheduled: Record<number, Set<number>> = {}
    schedules.forEach(s => {
      if (supIds.includes(s.user_id)) {
        if (!supScheduled[s.user_id]) supScheduled[s.user_id] = new Set()
        supScheduled[s.user_id].add(s.store_id)
      }
    })

    // Build: supervisor → Set of inspected store_ids (numeric)
    const supInspected: Record<number, Set<number>> = {}
    inspections.forEach(i => {
      if (supIds.includes(i.inspector_id)) {
        if (!supInspected[i.inspector_id]) supInspected[i.inspector_id] = new Set()
        supInspected[i.inspector_id].add(i.store_id)
      }
    })

    const inspectionCompliance = supervisors.map(sup => {
      const scheduled = supScheduled[sup.id] || new Set()
      const inspected = supInspected[sup.id] || new Set()
      const scheduledStores = [...scheduled].map(id => storeNameMap[id] || `Store #${id}`)
      const inspectedStores = [...inspected].map(id => storeNameMap[id] || `Store #${id}`)
      const missingStores = [...scheduled]
        .filter(id => !inspected.has(id))
        .map(id => storeNameMap[id] || `Store #${id}`)
      const totalScheduled = scheduled.size
      const totalInspected = [...scheduled].filter(id => inspected.has(id)).length
      // Also count extra inspections (stores not scheduled but inspected)
      const extraStores = [...inspected]
        .filter(id => !scheduled.has(id))
        .map(id => storeNameMap[id] || `Store #${id}`)

      return {
        supervisor: sup.full_name.split(' ')[0],
        supervisorFull: sup.full_name,
        supervisorId: sup.id,
        scheduledStores,
        inspectedStores,
        extraStores,
        missingStores,
        totalScheduled,
        totalInspected,
        totalInspections: inspected.size,
        compliant: missingStores.length === 0 && totalScheduled > 0,
        compliancePct: totalScheduled > 0 ? Math.round((totalInspected / totalScheduled) * 100) : (inspected.size > 0 ? 100 : 0)
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
