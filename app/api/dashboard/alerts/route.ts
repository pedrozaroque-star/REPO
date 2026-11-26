/**
 * @module api/dashboard/alerts/route
 * @description Operational Alerts Engine for the main Dashboard.
 *   Computes real-time store alerts for Labor Cost, Food Cost, Low Sales (self-comparison vs prior period),
 *   and Supervisor Inspection Compliance (cross-referencing store ownership, schedules, and inspections).
 * @businessRules
 * - Business day runs 6:00 AM to 5:59 AM next day in America/Los_Angeles.
 * - Strictly enforces `maxDays <= 366` on `startDate..endDate`.
 * - Labor Target: <= 21.5% (Warning > 21.5%, Critical > 23.0%).
 * - Food Cost Target: <= 32.0% (Warning > 32.0%–35.0%, Critical > 35.0%).
 * - NEVER invokes `foodCostGet(storeId=all)` synchronously inside this polled dashboard endpoint: reads `food_cost_daily_cache` with bounded deterministic pagination and exposes `foodCostPartial: true` if `< 14` valid stores are populated yet (relying on `sync-food-cost-today` cron).
 * - Low Sales Alert: Store drops >= 15% compared to its own equivalent previous period.
 * - Inspection Compliance: Each scheduled day for a supervisor requires >= 1 inspection at an owned store.
 *   Future dates or shifts still in progress today are not penalized as misses.
 * - Deduplicates concurrent dashboard polls via 60s bounded TTL cache (`MAX_CACHE_KEYS = 50`) + `inFlight` single-flight map.
 * @dataFlow
 * - GET /api/dashboard/alerts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * - Reads sales_daily_cache (bounded pagination, 1-2d live fallback if empty), food_cost_daily_cache (cache-only),
 *   supervisor_inspections, users, schedules (filtered by supervisor IDs), stores, and portion_control_alerts.
 * @notes
 * - [2026-10-16] Fixed schedules PostgREST 1,000-row truncation by filtering .in('user_id', supervisorIds).
 * - [2026-10-16] Added live fallback when today's cache is not yet populated.
 * - [2026-11-26] Blindaje Supabase `ci_small` (Critical #3): `maxDuration = 60`, singleton `supabaseAdmin`, `maxDays <= 366`, paginación determinista `.order('id')` (`MAX_PAGES = 3`, `1000`/pág.) en lugar de `.limit(5000)`, eliminación de fallback vivo `foodCostGet`, exposición de `foodCostPartial` y caché single-flight TTL 60s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchToastData, SalesCacheReadError } from '@/lib/toast-api'
import { formatStoreDisplayName, getInternalStoreNameById, sortStoresAlphabetically } from '@/lib/store-display'
import {
  FOOD_COST_HEALTHY_MAX_PCT,
  FOOD_COST_WARNING_MAX_PCT,
  addDaysIso,
  isInvalidFoodCostCacheRow,
  resolveCachedFoodCostDollars,
  validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Targets (unified with food-cost-sales-resolver.ts)
const LABOR_TARGET = 21.5
const LABOR_CRITICAL = 23
const FOOD_COST_TARGET = FOOD_COST_HEALTHY_MAX_PCT
const FOOD_COST_CRITICAL = FOOD_COST_WARNING_MAX_PCT

const MAX_ALERTS_DAYS = 366
const ALERTS_PAGE_SIZE = 1000
const ALERTS_MAX_PAGES = 3
const ALERTS_CACHE_TTL_MS = 60_000
const ALERTS_MAX_CACHE_KEYS = 50

const alertsResponseCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>()
const alertsInFlight = new Map<string, Promise<Record<string, unknown>>>()

function setAlertsCacheBounded(key: string, payload: Record<string, unknown>) {
  if (alertsResponseCache.size >= ALERTS_MAX_CACHE_KEYS) {
    const oldestKey = alertsResponseCache.keys().next().value
    if (oldestKey !== undefined) alertsResponseCache.delete(oldestKey)
  }
  alertsResponseCache.set(key, { expiresAt: Date.now() + ALERTS_CACHE_TTL_MS, payload })
}

async function fetchPaginatedById<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const allRows: T[] = []
  for (let page = 0; page < ALERTS_MAX_PAGES; page++) {
    const from = page * ALERTS_PAGE_SIZE
    const to = from + ALERTS_PAGE_SIZE - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < ALERTS_PAGE_SIZE) break
  }
  return allRows
}

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

async function computeDashboardAlerts(
  startDate: string,
  endDate: string,
  rangeDays: number,
  todayBusinessStr: string,
  nowTimeLA: string
): Promise<Record<string, unknown>> {
    // Calculate lookback: equivalent previous period (same length), UTC-pure and DST-safe
    let lbStartStr: string
    let lbEndStr: string
    if (rangeDays <= 2) {
      // For single/two day filters: compare vs same day(s) last week
      lbStartStr = addDaysIso(startDate, -7)
      lbEndStr = addDaysIso(endDate, -7)
    } else {
      // For longer ranges: compare vs equivalent previous period
      lbEndStr = addDaysIso(startDate, -1)
      lbStartStr = addDaysIso(lbEndStr, -(rangeDays - 1))
    }

    // First fetch supervisors (tiny table, ~4 rows) so we can filter schedules strictly by supervisor IDs
    const { data: supervisorsData, error: supErr } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role')
      .eq('role', 'supervisor')
      .eq('is_active', true)

    if (supErr) throw supErr

    const supervisors = supervisorsData || []
    const supervisorIds = supervisors.map(s => s.id)

    // ── Bounded parallel data fetch (concurrency <= 3, deterministic .order('id'), MAX_PAGES = 3) ──
    const [salesRows, foodCosts, histSales] = await Promise.all([
      // 1. Sales + Labor by store (current range)
      fetchPaginatedById<any>((from, to) =>
        supabaseAdmin
          .from('sales_daily_cache')
          .select('id, store_id, store_name, net_sales, labor_cost, business_date')
          .gte('business_date', startDate)
          .lte('business_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      // 2. Food Cost by store (cache-only; never trigger synchronous live 15-store foodCostGet during polling)
      fetchPaginatedById<any>((from, to) =>
        supabaseAdmin
          .from('food_cost_daily_cache')
          .select('id, store_id, store_name, cost_percentage, net_sales, food_cost, total_cost, packaging_cost, business_date')
          .gte('business_date', startDate)
          .lte('business_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      // 3. Historical sales for lookback — for self-comparison
      fetchPaginatedById<any>((from, to) =>
        supabaseAdmin
          .from('sales_daily_cache')
          .select('id, store_id, store_name, net_sales, business_date')
          .gte('business_date', lbStartStr)
          .lte('business_date', lbEndStr)
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ])

    const [inspections, schedules, storesRes] = await Promise.all([
      // 4. Inspections in date range
      fetchPaginatedById<any>((from, to) =>
        supabaseAdmin
          .from('supervisor_inspections')
          .select('id, inspector_id, store_id, inspection_date')
          .gte('inspection_date', startDate)
          .lte('inspection_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      // 5. Supervisor schedules in date range (strictly filtered by supervisorIds + bounded pagination)
      supervisorIds.length > 0
        ? fetchPaginatedById<any>((from, to) =>
            supabaseAdmin
              .from('schedules')
              .select('id, user_id, store_id, date, start_time, end_time, shift_label')
              .in('user_id', supervisorIds)
              .gte('date', startDate)
              .lte('date', endDate)
              .order('id', { ascending: true })
              .range(from, to)
          )
        : Promise.resolve([] as any[]),
      // 6. Store details (numeric ID → name + supervisor_id ownership + external_id)
      supabaseAdmin.from('stores').select('id, name, supervisor_id, external_id'),
    ])

    if (storesRes.error) throw storesRes.error

    let sales = salesRows
    const stores = storesRes.data || []

    // Live fallback for Sales + Labor ONLY if cache is genuinely empty on a short range (e.g. Today early morning)
    if (sales.length === 0 && rangeDays <= 2) {
      try {
        const liveSales = await fetchToastData({
          storeIds: 'all',
          startDate,
          endDate,
          groupBy: 'day',
          allowDirtyCache: true,
          excludeHourly: true,
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

    // Track cached food-cost store coverage (rely on sync-food-cost-today cron; never invoke foodCostGet synchronously)
    const distinctValidFcStores = new Set<string>()
    foodCosts.forEach((r: any) => {
      const rowCost = resolveCachedFoodCostDollars(r)
      const rowSales = Number(r.net_sales) || 0
      if (!isInvalidFoodCostCacheRow(rowCost, rowSales) && r.store_id) {
        distinctValidFcStores.add(String(r.store_id))
      }
    })
    const foodCostPartial = distinctValidFcStores.size < 14

    // Build store numeric ID → name map
    const storeNameMap: Record<number, string> = {}
    stores.forEach(s => { storeNameMap[s.id] = formatStoreDisplayName(s) || (s.name || '').trim() })

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
      const name = formatStoreDisplayName(r.store_name) || (r.store_name || '').trim()
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
    // 2. FOOD COST ALERTS — stores exceeding target (> 32% warning, > 35% critical)
    // ══════════════════════════════════════════════════
    const fcByStore: Record<string, { cost: number; sales: number; storeId: string }> = {}
    foodCosts.forEach((r: any) => {
      const rowCost = resolveCachedFoodCostDollars(r)
      const rowSales = Number(r.net_sales) || 0
      if (isInvalidFoodCostCacheRow(rowCost, rowSales)) return
      const name = formatStoreDisplayName(r.store_name) || (r.store_name || '').trim()
      if (!name) return
      if (!fcByStore[name]) fcByStore[name] = { cost: 0, sales: 0, storeId: r.store_id }
      fcByStore[name].cost += rowCost
      fcByStore[name].sales += rowSales
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

    // Helper: convert HH:MM to minutes elapsed since 06:00 AM business day start (06:00 = 0, 00:00 = 1080, 05:59 = 1439)
    const toBizMins = (hhmm: string): number => {
      const [h, m] = (hhmm || '06:00').split(':').map(Number)
      const adjH = h < 6 ? h + 24 : h
      return (adjH - 6) * 60 + (m || 0)
    }
    const nowBizMins = toBizMins(nowTimeLA)

    // Expected cumulative fraction of daily sales completed by `nowBizMins` (calibrated to Tacos Gavilan 9 AM - 2 AM curve)
    const getIntradaySalesFraction = (bizMins: number): number => {
      // 06:00 - 09:00 (0..180 mins): 0% -> 1% (prep & opening)
      if (bizMins <= 180) return (bizMins / 180) * 0.01
      // 09:00 - 12:00 (180..360 mins): 1% -> 10% (morning)
      if (bizMins <= 360) return 0.01 + ((bizMins - 180) / 180) * 0.09
      // 12:00 - 15:00 (360..540 mins): 10% -> 32% (lunch rush)
      if (bizMins <= 540) return 0.10 + ((bizMins - 360) / 180) * 0.22
      // 15:00 - 18:00 (540..720 mins): 32% -> 52% (afternoon)
      if (bizMins <= 720) return 0.32 + ((bizMins - 540) / 180) * 0.20
      // 18:00 - 22:00 (720..960 mins): 52% -> 84% (dinner rush)
      if (bizMins <= 960) return 0.52 + ((bizMins - 720) / 240) * 0.32
      // 22:00 - 02:00 (960..1200 mins): 84% -> 98% (late night)
      if (bizMins <= 1200) return 0.84 + ((bizMins - 960) / 240) * 0.14
      // 02:00 - 06:00 (1200..1440 mins): 98% -> 100%
      return Math.min(1.0, 0.98 + ((bizMins - 1200) / 240) * 0.02)
    }

    const isSingleDayToday = startDate === todayBusinessStr && endDate === todayBusinessStr
    const includesTodayInProgress = endDate === todayBusinessStr

    // Build previous period total per store (pro-rating the lookback day corresponding to Today if Today is still in progress)
    const prevByStore: Record<string, { totalSales: number; storeId: string }> = {}
    histSales.forEach(r => {
      const name = formatStoreDisplayName(r.store_name) || (r.store_name || '').trim()
      if (!prevByStore[name]) prevByStore[name] = { totalSales: 0, storeId: r.store_id }
      let dayNetSales = Number(r.net_sales) || 0
      if (includesTodayInProgress && r.business_date === lbEndStr) {
        dayNetSales = dayNetSales * getIntradaySalesFraction(nowBizMins)
      }
      prevByStore[name].totalSales += dayNetSales
    })

    // For each store: compare current vs previous equivalent period
    const SELF_DECLINE_THRESHOLD = 15 // 15% below previous period = alert
    const allStoreSales = Object.entries(laborByStore).map(([store, d]) => ({ store, sales: d.sales, storeId: d.storeId }))
    const prevPeriodLabel = rangeDays <= 2
      ? `mismo día semana pasada`
      : `${lbStartStr.slice(5)} al ${lbEndStr.slice(5)}`

    // Do not fire low sales alerts on single-day Today before 11:00 AM LA time (300 biz mins) while stores are just opening
    const lowSalesAlerts = (isSingleDayToday && nowBizMins < 300)
      ? []
      : allStoreSales
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

    // Generate list of dates in range (UTC-pure, DST-safe)
    const dateList: string[] = []
    for (let i = 0; i < rangeDays; i++) {
      dateList.push(addDaysIso(startDate, i))
    }

    // Build schedule lookup: supId → date → {store_id, start_time, end_time}
    // Also track explicit absences (Vacaciones, Enfermedad, Permiso) vs unscheduled Days Off
    const supScheduleByDate: Record<number, Record<string, { store_id: number; start_time: string; end_time: string }>> = {}
    const supAbsenceByDate: Record<number, Record<string, 'vacation' | 'sick' | 'permission'>> = {}

    schedules.forEach((s: any) => {
      const startShort = (s.start_time || '').slice(0, 5)
      const endShort = (s.end_time || '').slice(0, 5)
      const labelLower = (s.shift_label || '').toLowerCase()

      if (labelLower.includes('vacac') || labelLower.includes('vacat')) {
        if (!supAbsenceByDate[s.user_id]) supAbsenceByDate[s.user_id] = {}
        supAbsenceByDate[s.user_id][s.date] = 'vacation'
        return
      }
      if (labelLower.includes('enferm') || labelLower.includes('sick')) {
        if (!supAbsenceByDate[s.user_id]) supAbsenceByDate[s.user_id] = {}
        supAbsenceByDate[s.user_id][s.date] = 'sick'
        return
      }
      if (labelLower.includes('permis') || labelLower.includes('leave') || labelLower.includes('unpaid')) {
        if (!supAbsenceByDate[s.user_id]) supAbsenceByDate[s.user_id] = {}
        supAbsenceByDate[s.user_id][s.date] = 'permission'
        return
      }

      const isDayOff =
        (startShort === '00:00' && endShort === '00:00') ||
        labelLower.includes('descanso') ||
        labelLower.includes('ausenc') ||
        labelLower.includes('absence') ||
        labelLower === 'off'

      if (isDayOff) return

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
      const ownedStoreNames = sortStoresAlphabetically(
        ownedStoreIds.map(id => storeNameMap[id] || getInternalStoreNameById(id) || 'Sucursal'),
        undefined,
        { pinSpecialFirst: false }
      )

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
      let absenceDays = 0
      let dayOffDays = 0
      let primaryAbsenceType: 'vacation' | 'sick' | 'permission' | null = null
      let inProgressShift: string | null = null
      const allInspectedStores = new Set<string>()
      const allMissingStores = new Set<string>()

      dateList.forEach(date => {
        // Never evaluate future dates as missed inspections
        if (date > todayBusinessStr) return

        const absenceOnDate = supAbsenceByDate[sup.id]?.[date] || null
        const schedule = supScheduleByDate[sup.id]?.[date]
        const wasScheduled = !!schedule
        const inspectedOnDate = supInspByDate[sup.id]?.[date] || new Set<number>()
        const inspectedNames = sortStoresAlphabetically(
          [...inspectedOnDate].map(id => storeNameMap[id] || getInternalStoreNameById(id) || 'Sucursal'),
          undefined,
          { pinSpecialFirst: false }
        )

        // Mark all inspected stores
        inspectedNames.forEach(n => allInspectedStores.add(n))

        if (absenceOnDate) {
          absenceDays++
          if (!primaryAbsenceType) primaryAbsenceType = absenceOnDate
          return
        }

        if (!wasScheduled) {
          dayOffDays++
          return
        }

        const scheduledStoreName = storeNameMap[schedule.store_id] || getInternalStoreNameById(schedule.store_id) || 'Sucursal'
        const startShort = schedule.start_time ? schedule.start_time.slice(0, 5) : null
        const endShort = schedule.end_time ? schedule.end_time.slice(0, 5) : null
        const shift = startShort && endShort ? `${startShort} - ${endShort}` : null

        // Check: did the supervisor inspect at least one of their OWNED stores this day?
        const ownedInspected = sortStoresAlphabetically(
          ownedStoreIds
            .filter(id => inspectedOnDate.has(id))
            .map(id => storeNameMap[id] || getInternalStoreNameById(id) || 'Sucursal'),
          undefined,
          { pinSpecialFirst: false }
        )
        const ownedMissing = sortStoresAlphabetically(
          ownedStoreIds
            .filter(id => !inspectedOnDate.has(id))
            .map(id => storeNameMap[id] || getInternalStoreNameById(id) || 'Sucursal'),
          undefined,
          { pinSpecialFirst: false }
        )

        const dayCompliant = ownedInspected.length > 0

        // If this is TODAY and the supervisor hasn't inspected yet, check if their shift is still in progress or hasn't ended
        if (date === todayBusinessStr && !dayCompliant) {
          const startBiz = startShort ? toBizMins(startShort) : 180 // default 09:00
          let endBiz = endShort ? toBizMins(endShort) : 1080 // default 00:00 (midnight)
          // Handle AM/PM schedule entry typos (e.g. 12:00 - 10:00 where 10:00 was meant as 22:00 / 10:00 PM)
          if (endBiz <= startBiz) {
            endBiz = Math.max(startBiz + 8 * 60, endBiz + 12 * 60)
          }
          if (nowBizMins <= endBiz) {
            inProgressShift = shift || 'Hoy'
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
      })

      // Extra stores (inspected but not owned)
      const ownedNames = new Set(ownedStoreNames)
      const extraStores = sortStoresAlphabetically(
        [...allInspectedStores].filter(n => !ownedNames.has(n)),
        undefined,
        { pinSpecialFirst: false }
      )

      // If supervisor had 0 scheduled days due in this period (e.g. vacation, day off, or shift still in progress today), they are 100% compliant (never trigger alert)
      const compliancePct = totalScheduledDays > 0
        ? Math.round((totalCompliantDays / totalScheduledDays) * 100)
        : 100

      let status: 'active' | 'in_progress' | 'vacation' | 'sick' | 'permission' | 'day_off' = 'active'
      if (totalScheduledDays === 0) {
        if (inProgressShift) status = 'in_progress'
        else if (primaryAbsenceType) status = primaryAbsenceType
        else status = 'day_off'
      }

      return {
        supervisor: sup.full_name.split(' ')[0],
        supervisorFull: sup.full_name,
        supervisorId: sup.id,
        ownedStores: ownedStoreNames,
        scheduledStores: ownedStoreNames, // Legacy compat: these are their owned stores
        inspectedStores: sortStoresAlphabetically([...allInspectedStores], undefined, { pinSpecialFirst: false }),
        extraStores,
        missingStores: sortStoresAlphabetically([...allMissingStores], undefined, { pinSpecialFirst: false }),
        totalScheduled: totalScheduledDays,
        totalInspected: totalCompliantDays,
        totalInspections: allInspectedStores.size,
        compliant: totalScheduledDays > 0 ? totalCompliantDays === totalScheduledDays : true,
        compliancePct,
        status,
        absenceType: primaryAbsenceType,
        absenceDays,
        dayOffDays,
        inProgressShift,
        dailyDetail: dailyDetail.filter(d => d.wasScheduled) // Only show days they were scheduled
      }
    }).sort((a, b) => {
      // 1. Non-compliant active supervisors first
      if (a.compliant !== b.compliant) return a.compliant ? 1 : -1
      // 2. Active supervisors (totalScheduled > 0) before off/vacation/in_progress
      const aActive = a.totalScheduled > 0 ? 0 : 1
      const bActive = b.totalScheduled > 0 ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      // 3. Lowest compliancePct first
      return a.compliancePct - b.compliancePct
    })

    // ══════════════════════════════════════════════════
    // 5. PORTION CONTROL ALERTS (Carne Asada & 8 Meats — Escalera de Mando)
    // ══════════════════════════════════════════════════
    let portionControlAlerts: {
      id: string
      storeId: string
      store: string
      meatKey: string
      meatName: string
      severity: 'warning' | 'critical'
      status: string
      varianceLbs: number
      varianceBags: number
      variancePct: number
      dollarLoss: number
      dominantShift: string
      periodStart: string
      periodEnd: string
    }[] = []

    try {
      const rollingCutoff = addDaysIso(startDate, -7)
      const { data: pcRows } = await supabaseAdmin
        .from('portion_control_alerts')
        .select('id, store_id, store_name, meat_key, meat_name, severity, status, variance_lbs, variance_bags, variance_pct, dollar_loss_store, dominant_shift, period_start, period_end')
        .neq('status', 'resolved')
        .gte('period_end', rollingCutoff)
        .lte('period_start', endDate)
        .order('dollar_loss_store', { ascending: false })
        .limit(50)

      if (Array.isArray(pcRows)) {
        portionControlAlerts = pcRows.map((r: any) => ({
          id: String(r.id),
          storeId: String(r.store_id),
          store: formatStoreDisplayName(r.store_name) || getInternalStoreNameById(r.store_id) || (r.store_name || '').trim(),
          meatKey: String(r.meat_key || 'asada'),
          meatName: String(r.meat_name || 'Carne Asada'),
          severity: r.severity === 'critical' ? 'critical' : 'warning',
          status: String(r.status || 'open'),
          varianceLbs: Number(Number(r.variance_lbs || 0).toFixed(1)),
          varianceBags: Number(Number(r.variance_bags || 0).toFixed(1)),
          variancePct: Number(Number(r.variance_pct || 0).toFixed(1)),
          dollarLoss: Math.round(Number(r.dollar_loss_store || 0)),
          dominantShift: String(r.dominant_shift || 'BOTH'),
          periodStart: String(r.period_start || ''),
          periodEnd: String(r.period_end || ''),
        }))
      }
    } catch {
      // Safe fallback if portion_control_alerts is empty or migrating
    }

    // ══════════════════════════════════════════════════
    // Summary counts
    // ══════════════════════════════════════════════════
    const totalAlerts =
      laborAlerts.length +
      foodCostAlerts.length +
      portionControlAlerts.length +
      lowSalesAlerts.length +
      inspectionCompliance.filter(s => !s.compliant).length

    return {
      totalAlerts,
      laborAlerts,
      foodCostAlerts,
      foodCostPartial,
      foodCostStoresCount: distinctValidFcStores.size,
      portionControlAlerts,
      lowSalesAlerts,
      inspectionCompliance,
      targets: { labor: LABOR_TARGET, laborCritical: LABOR_CRITICAL, foodCost: FOOD_COST_TARGET, foodCostCritical: FOOD_COST_CRITICAL },
      dateRange: { startDate, endDate }
    }
}

export async function GET(req: NextRequest) {
  const auth = await verifyStaffAuth(req)
  if (!auth.authorized) return auth.response!

  try {
    const { searchParams } = new URL(req.url)
    const { dateStr: todayBusinessStr, timeStr: nowTimeLA } = getBusinessDateLA()
    const startDate = searchParams.get('startDate') || todayBusinessStr
    const endDate = searchParams.get('endDate') || startDate

    const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, MAX_ALERTS_DAYS)
    if (!rangeCheck.ok) {
      return NextResponse.json({ error: rangeCheck.error }, { status: 400 })
    }

    const cacheKey = `${startDate}:${endDate}:${todayBusinessStr}`
    const cached = alertsResponseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload)
    }

    let loader = alertsInFlight.get(cacheKey)
    if (!loader) {
      loader = computeDashboardAlerts(startDate, endDate, rangeCheck.days, todayBusinessStr, nowTimeLA)
      alertsInFlight.set(cacheKey, loader)
      loader.finally(() => {
        if (alertsInFlight.get(cacheKey) === loader) {
          alertsInFlight.delete(cacheKey)
        }
      })
    }

    const payload = await loader
    setAlertsCacheBounded(cacheKey, payload)
    return NextResponse.json(payload)
  } catch (err: any) {
    console.error('[Dashboard Alerts] Error:', err?.message || err)
    const status = err instanceof SalesCacheReadError || err?.name === 'SalesCacheReadError' ? 503 : 500
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status })
  }
}
