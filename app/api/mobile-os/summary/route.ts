/**
 * @module app/api/mobile-os/summary/route
 * @description Endpoint ultrarrápido de pulso en vivo (`GET /api/mobile-os/summary`) para los
 *              Widgets de Inicio Mobile & Tablet OS de Tacos Gavilan.
 *
 * @businessRules
 * - Protegido estrictamente con `verifyStaffAuth(req, { allowCron: false })` de `@/lib/auth-server`.
 * - Opera exclusivamente sobre cachés precalculadas en Supabase (`sales_daily_cache`,
 *   `food_cost_daily_cache`, conteos indexados `head: true` en tablas operativas) sin invocar jamás
 *   la API lenta en vivo de Toast POS durante la carga de `/inicio` (objetivo `< 250ms`).
 * - Día laboral `America/Los_Angeles`: inicia a las `06:00 AM` y cierra a las `05:59:59.999 AM` del
 *   día calendario siguiente (si `laHour < 6`, resta 1 día calendario). Turno `AM` (`06:00..16:59`)
 *   y turno `PM` (`17:00..05:59`).
 * - `financialPulse` en dólares estadounidenses (`USD`):
 *   * `null` para `vikesh@tacosgavilan.com`, `asistente`, `planificador`, `basecamp` y `employee`.
 *   * Visible para `admin`, `supervisor`, `manager` y `auditor` (filtrado a las sucursales autorizadas
 *     del gerente cuando aplica; si aún no hay filas hoy en `sales_daily_cache`, recurre al último
 *     `business_date` disponible marcando `isLiveToday: false` y `effectiveDate`).
 *   * Prevención estricta de divisiones por cero (`0/0` -> `0`, nunca `NaN` ni `Infinity`).
 * - `operationsPulse`: conteos reales del día laboral actual (`supervisor_inspections`,
 *   `manager_checklists`, `assistant_checklists`, `shifts` + `schedules`) más `myNextShift` del usuario.
 *
 * @dataFlow
 * - `GET /api/mobile-os/summary` -> `verifyStaffAuth` -> resolución de sucursales en caché RAM ->
 *   consultas paralelas en `teg-tacos-gavilan` (`service_role`) -> JSON tipado `MobileOSSummaryResponse`.
 *
 * @notes
 * - `sales_daily_cache.store_id`, `food_cost_daily_cache.store_id` y `shifts.store_id` usan Toast GUID
 *   (`stores.external_id`), mientras que `supervisor_inspections`, `manager_checklists`,
 *   `assistant_checklists` y `schedules` usan ID numérico (`stores.id`) y `users.store_scope` usa `stores.code`.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth, type DecodedToken } from '@/lib/auth-server'
import { getSupabaseAdminClient, formatStoreName } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface StoreDirectoryRow {
  id: number
  code: string | null
  name: string
  external_id: string | null
  is_active: boolean | null
}

interface SalesCacheRow {
  store_id: string
  business_date: string
  net_sales: number | string | null
  order_count: number | string | null
  labor_cost: number | string | null
}

interface FoodCostCacheRow {
  store_id: string
  total_cost: number | string | null
  net_sales: number | string | null
  cost_percentage: number | string | null
}

interface UserScopeRow {
  id: number
  store_id: number | null
  store_scope: unknown
}

interface ScheduleNextRow {
  date: string
  start_time: string | null
  end_time: string | null
  store_id: number | null
  shift_label: string | null
}

const STORE_DIR_TTL_MS = 10 * 60 * 1000
let cachedStoresAt = 0
let cachedActiveStores: StoreDirectoryRow[] | null = null

async function getActiveStoresDirectory(): Promise<StoreDirectoryRow[]> {
  const now = Date.now()
  if (cachedActiveStores && now - cachedStoresAt < STORE_DIR_TTL_MS) {
    return cachedActiveStores
  }
  const supabase = await getSupabaseAdminClient()
  const { data, error } = await supabase
    .from('stores')
    .select('id, code, name, external_id, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })

  if (error || !Array.isArray(data)) {
    return cachedActiveStores ?? []
  }

  const parsed: StoreDirectoryRow[] = data.map((raw) => ({
    id: Number(raw.id),
    code: raw.code ? String(raw.code).trim() : null,
    name: formatStoreName(String(raw.name || '')) || `Sucursal #${String(raw.id)}`,
    external_id: raw.external_id ? String(raw.external_id).trim() : null,
    is_active: raw.is_active !== false,
  }))

  cachedActiveStores = parsed
  cachedStoresAt = now
  return parsed
}

function computeLaBusinessWindow(now: Date = new Date()): {
  businessDate: string
  shiftPeriod: 'AM' | 'PM'
  laTimeLabel: string
  startIso: string
  endIso: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const getNum = (type: Intl.DateTimeFormatPartTypes): number => {
    const val = parts.find((p) => p.type === type)?.value
    return val ? parseInt(val, 10) : 0
  }

  const laYear = getNum('year')
  const laMonth = getNum('month')
  const laDay = getNum('day')
  const laHour = getNum('hour') % 24

  const anchorUtc = new Date(Date.UTC(laYear, laMonth - 1, laDay, 12, 0, 0, 0))
  if (laHour < 6) {
    anchorUtc.setUTCDate(anchorUtc.getUTCDate() - 1)
  }
  const businessDate = anchorUtc.toISOString().slice(0, 10)
  const shiftPeriod: 'AM' | 'PM' = laHour >= 6 && laHour < 17 ? 'AM' : 'PM'

  const laTimeLabel = now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const sixAmEpochForDate = (ymd: string): number => {
    const [y, m, d] = ymd.split('-').map(Number)
    const approx = Date.UTC(y, m - 1, d, 14, 0, 0, 0)
    const checkParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(approx))
    const checkHour =
      parseInt(checkParts.find((p) => p.type === 'hour')?.value || '6', 10) % 24
    return approx - (checkHour - 6) * 3_600_000
  }

  const nextAnchor = new Date(anchorUtc.getTime())
  nextAnchor.setUTCDate(nextAnchor.getUTCDate() + 1)
  const nextBusinessDate = nextAnchor.toISOString().slice(0, 10)

  const startMs = sixAmEpochForDate(businessDate)
  const endMs = sixAmEpochForDate(nextBusinessDate) - 1

  return {
    businessDate,
    shiftPeriod,
    laTimeLabel,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

function round2(val: number): number {
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0
}

function round1(val: number): number {
  return Number.isFinite(val) ? Math.round(val * 10) / 10 : 0
}

function formatSqlClockTime(raw: string | null | undefined): string {
  if (!raw) return ''
  const parts = String(raw).trim().split(':')
  if (parts.length < 2) return String(raw)
  const h24 = parseInt(parts[0] || '0', 10)
  const min = (parts[1] || '00').padStart(2, '0')
  if (!Number.isFinite(h24)) return String(raw)
  const suffix = h24 >= 12 && h24 < 24 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${min} ${suffix}`
}

function extractScopeTokens(rawScope: unknown, rawStoreId: unknown): string[] {
  const tokens: string[] = []
  const pushToken = (v: unknown) => {
    if (v === null || v === undefined) return
    const s = String(v).trim()
    if (s && s.toUpperCase() !== 'ALL' && s !== '*') {
      tokens.push(s)
    }
  }
  pushToken(rawStoreId)
  if (Array.isArray(rawScope)) {
    for (const item of rawScope) pushToken(item)
  } else if (typeof rawScope === 'string') {
    for (const part of rawScope.split(',')) pushToken(part)
  }
  return tokens
}

async function resolveUserStoreScope(
  user: DecodedToken,
  normalizedRole: string,
  activeStores: StoreDirectoryRow[]
): Promise<{
  isAllStores: boolean
  numericStoreIds: number[]
  externalStoreIds: string[]
  storeScopeLabel: string
}> {
  const isGlobalRole =
    normalizedRole === 'admin' || normalizedRole === 'supervisor' || normalizedRole === 'auditor'

  if (isGlobalRole) {
    return {
      isAllStores: true,
      numericStoreIds: activeStores.map((s) => s.id),
      externalStoreIds: activeStores
        .map((s) => s.external_id)
        .filter((ext): ext is string => Boolean(ext)),
      storeScopeLabel: `Tacos Gavilan (${activeStores.length})`,
    }
  }

  const meta = user.user_metadata ?? {}
  let tokens = extractScopeTokens(meta.store_scope, meta.store_id)

  if (tokens.length === 0) {
    const supabase = await getSupabaseAdminClient()
    const numericUid = Number(user.id)
    let dbUser: UserScopeRow | null = null
    if (Number.isFinite(numericUid) && numericUid > 0) {
      const { data } = await supabase
        .from('users')
        .select('id, store_id, store_scope')
        .eq('id', numericUid)
        .maybeSingle<UserScopeRow>()
      dbUser = data ?? null
    }
    if (!dbUser && user.email) {
      const { data } = await supabase
        .from('users')
        .select('id, store_id, store_scope')
        .ilike('email', String(user.email).trim())
        .maybeSingle<UserScopeRow>()
      dbUser = data ?? null
    }
    if (dbUser) {
      tokens = extractScopeTokens(dbUser.store_scope, dbUser.store_id)
    }
  }

  const matchedMap = new Map<number, StoreDirectoryRow>()
  for (const tok of tokens) {
    const upper = tok.toUpperCase()
    const isNumeric = /^\d+$/.test(tok)
    for (const st of activeStores) {
      if (
        (isNumeric && st.id === Number(tok)) ||
        (st.code && st.code.toUpperCase() === upper) ||
        (st.external_id && st.external_id.toLowerCase() === tok.toLowerCase())
      ) {
        matchedMap.set(st.id, st)
      }
    }
  }

  const matched = Array.from(matchedMap.values())
  const storeScopeLabel =
    matched.length === 1
      ? matched[0].name
      : matched.length > 1
        ? matched.map((s) => s.name).join(', ')
        : 'Sucursal'

  return {
    isAllStores: false,
    numericStoreIds: matched.map((s) => s.id),
    externalStoreIds: matched
      .map((s) => s.external_id)
      .filter((ext): ext is string => Boolean(ext)),
    storeScopeLabel,
  }
}

export async function GET(req: Request) {
  const auth = verifyStaffAuth(req, { allowCron: false })
  if (!auth.authorized || !auth.user) {
    return (
      auth.response ??
      NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
    )
  }

  try {
    const user = auth.user
    const emailNorm = String(user.email || '')
      .trim()
      .toLowerCase()
    const isVikesh = emailNorm === 'vikesh@tacosgavilan.com'

    const rawRole = String(user.role || user.user_role || '')
      .trim()
      .toLowerCase()
    const role =
      rawRole === 'gerente'
        ? 'manager'
        : rawRole === 'regional_manager'
          ? 'supervisor'
          : rawRole === 'assistant'
            ? 'asistente'
            : rawRole === 'administrador'
              ? 'admin'
              : rawRole

    const isPlanificadorOnly =
      emailNorm === 'stephany@cingularhr.com' || role === 'planificador'
    const isBasecampOnly = role === 'basecamp'
    const isEmployeeOnly =
      String(user.user_type || '').toLowerCase() === 'employee' || rawRole === 'employee'

    const canViewFinancialPulse =
      !isVikesh &&
      !isPlanificadorOnly &&
      !isBasecampOnly &&
      !isEmployeeOnly &&
      ['admin', 'supervisor', 'manager', 'auditor'].includes(role)

    const { businessDate, shiftPeriod, laTimeLabel, startIso, endIso } =
      computeLaBusinessWindow(new Date())

    const supabase = await getSupabaseAdminClient()
    const activeStores = await getActiveStoresDirectory()
    const storesById = new Map<number, StoreDirectoryRow>(
      activeStores.map((s) => [s.id, s])
    )

    const scope = await resolveUserStoreScope(user, role, activeStores)

    // 1. Financial Pulse (fast cache-only read)
    const fetchFinancialPulse = async () => {
      if (!canViewFinancialPulse) return null
      if (!scope.isAllStores && scope.externalStoreIds.length === 0) {
        return {
          netSales: 0,
          orderCount: 0,
          avgTicket: 0,
          laborPct: 0,
          foodCostPct: 0,
          reportingStores: 0,
          isLiveToday: true,
          effectiveDate: businessDate,
        }
      }

      let salesQuery = supabase
        .from('sales_daily_cache')
        .select('store_id, business_date, net_sales, order_count, labor_cost')
        .eq('business_date', businessDate)

      if (!scope.isAllStores) {
        salesQuery = salesQuery.in('store_id', scope.externalStoreIds)
      }

      const { data: todayRows } = await salesQuery.returns<SalesCacheRow[]>()
      let effectiveSalesRows: SalesCacheRow[] = Array.isArray(todayRows) ? todayRows : []
      let isLiveToday = true
      let effectiveDate = businessDate

      if (effectiveSalesRows.length === 0) {
        let latestQuery = supabase
          .from('sales_daily_cache')
          .select('business_date')
          .order('business_date', { ascending: false })
          .limit(1)

        if (!scope.isAllStores) {
          latestQuery = latestQuery.in('store_id', scope.externalStoreIds)
        }

        const { data: latestRow } = await latestQuery.maybeSingle<{ business_date: string }>()
        if (latestRow?.business_date) {
          effectiveDate = String(latestRow.business_date)
          isLiveToday = effectiveDate === businessDate

          let fallbackQuery = supabase
            .from('sales_daily_cache')
            .select('store_id, business_date, net_sales, order_count, labor_cost')
            .eq('business_date', effectiveDate)

          if (!scope.isAllStores) {
            fallbackQuery = fallbackQuery.in('store_id', scope.externalStoreIds)
          }

          const { data: fallbackRows } = await fallbackQuery.returns<SalesCacheRow[]>()
          effectiveSalesRows = Array.isArray(fallbackRows) ? fallbackRows : []
        }
      }

      let fcQuery = supabase
        .from('food_cost_daily_cache')
        .select('store_id, total_cost, net_sales, cost_percentage')
        .eq('business_date', effectiveDate)

      if (!scope.isAllStores) {
        fcQuery = fcQuery.in('store_id', scope.externalStoreIds)
      }

      const { data: fcRowsRaw } = await fcQuery.returns<FoodCostCacheRow[]>()
      const fcRows = Array.isArray(fcRowsRaw) ? fcRowsRaw : []

      let totalNetSales = 0
      let totalOrders = 0
      let totalLaborCost = 0
      const activeStoreSet = new Set<string>()

      for (const row of effectiveSalesRows) {
        const ns = Number(row.net_sales) || 0
        const oc = Number(row.order_count) || 0
        const lc = Number(row.labor_cost) || 0
        totalNetSales += ns
        totalOrders += oc
        totalLaborCost += lc
        if (ns > 0 || oc > 0) {
          activeStoreSet.add(String(row.store_id))
        }
      }

      const netSales = round2(totalNetSales)
      const orderCount = Math.max(0, Math.round(totalOrders))
      const avgTicket =
        orderCount > 0 && Number.isFinite(netSales / orderCount)
          ? round2(netSales / orderCount)
          : 0
      const laborPct =
        netSales > 0 && Number.isFinite((totalLaborCost / netSales) * 100)
          ? round1((totalLaborCost / netSales) * 100)
          : 0

      let fcTotalCost = 0
      let fcTotalSales = 0
      const validPctList: number[] = []
      for (const fc of fcRows) {
        fcTotalCost += Number(fc.total_cost) || 0
        fcTotalSales += Number(fc.net_sales) || 0
        const pct = Number(fc.cost_percentage)
        if (Number.isFinite(pct) && pct > 0) {
          validPctList.push(pct)
        }
      }

      let foodCostPct = 0
      if (fcTotalSales > 0 && Number.isFinite((fcTotalCost / fcTotalSales) * 100)) {
        foodCostPct = round1((fcTotalCost / fcTotalSales) * 100)
      } else if (validPctList.length > 0) {
        const sumPct = validPctList.reduce((acc, n) => acc + n, 0)
        foodCostPct = round1(sumPct / validPctList.length)
      }

      return {
        netSales,
        orderCount,
        avgTicket,
        laborPct,
        foodCostPct,
        reportingStores: activeStoreSet.size || effectiveSalesRows.length,
        isLiveToday,
        effectiveDate,
      }
    }

    // 2. Operations & Shift Pulse (parallel head counts + next shift)
    const fetchOperationsPulse = async () => {
      const hasScopedNumeric = scope.isAllStores || scope.numericStoreIds.length > 0
      const hasScopedExternal = scope.isAllStores || scope.externalStoreIds.length > 0

      const countInspections = async (): Promise<number> => {
        if (!hasScopedNumeric) return 0
        let q = supabase
          .from('supervisor_inspections')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startIso)
          .lte('created_at', endIso)
        if (!scope.isAllStores) q = q.in('store_id', scope.numericStoreIds)
        const { count } = await q
        return count ?? 0
      }

      const countMgrChecklists = async (): Promise<number> => {
        if (!hasScopedNumeric) return 0
        let q = supabase
          .from('manager_checklists')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startIso)
          .lte('created_at', endIso)
        if (!scope.isAllStores) q = q.in('store_id', scope.numericStoreIds)
        const { count } = await q
        return count ?? 0
      }

      const countStaffChecklists = async (): Promise<number> => {
        if (!hasScopedNumeric) return 0
        let q = supabase
          .from('assistant_checklists')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startIso)
          .lte('created_at', endIso)
        if (!scope.isAllStores) q = q.in('store_id', scope.numericStoreIds)
        const { count } = await q
        return count ?? 0
      }

      const countShiftsToday = async (): Promise<number> => {
        const [hourlyCount, leadershipCount] = await Promise.all([
          (async () => {
            if (!hasScopedExternal) return 0
            let q = supabase
              .from('shifts')
              .select('id', { count: 'exact', head: true })
              .gte('start_time', startIso)
              .lte('start_time', endIso)
            if (!scope.isAllStores) q = q.in('store_id', scope.externalStoreIds)
            const { count } = await q
            return count ?? 0
          })(),
          (async () => {
            if (!hasScopedNumeric) return 0
            let q = supabase
              .from('schedules')
              .select('id', { count: 'exact', head: true })
              .eq('date', businessDate)
            if (!scope.isAllStores) q = q.in('store_id', scope.numericStoreIds)
            const { count } = await q
            return count ?? 0
          })(),
        ])
        return hourlyCount + leadershipCount
      }

      const fetchMyNextShift = async () => {
        const numericUid = Number(user.id)
        if (!Number.isFinite(numericUid) || numericUid <= 0) return null

        const { data } = await supabase
          .from('schedules')
          .select('date, start_time, end_time, store_id, shift_label')
          .eq('user_id', numericUid)
          .gte('date', businessDate)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1)
          .maybeSingle<ScheduleNextRow>()

        if (!data) return null
        const startFmt = formatSqlClockTime(data.start_time)
        const endFmt = formatSqlClockTime(data.end_time)
        const storeName =
          data.store_id !== null ? (storesById.get(Number(data.store_id))?.name ?? null) : null
        const timeSpan = startFmt && endFmt ? `${startFmt} - ${endFmt}` : startFmt || ''
        const formattedRange = [data.date, storeName, timeSpan].filter(Boolean).join(' • ')

        return {
          date: data.date,
          startTime: startFmt,
          endTime: endFmt,
          storeName,
          shiftLabel: data.shift_label ?? null,
          formattedRange,
        }
      }

      const [
        inspectionsToday,
        managerChecklistsToday,
        staffChecklistsToday,
        shiftsToday,
        myNextShift,
      ] = await Promise.all([
        countInspections(),
        countMgrChecklists(),
        countStaffChecklists(),
        countShiftsToday(),
        fetchMyNextShift(),
      ])

      let primaryActionPath = '/checklists'
      let secondaryActionPath = '/mis-horarios'

      if (isPlanificadorOnly) {
        primaryActionPath = '/planificador'
        secondaryActionPath = '/planificador'
      } else if (isBasecampOnly) {
        primaryActionPath = '/basecamp'
        secondaryActionPath = '/basecamp'
      } else if (role === 'admin' || role === 'supervisor') {
        primaryActionPath = '/inspecciones'
        secondaryActionPath = '/planificador'
      } else if (role === 'auditor') {
        primaryActionPath = '/inspecciones'
        secondaryActionPath = '/dashboard'
      } else if (role === 'manager') {
        primaryActionPath = '/checklists-manager'
        secondaryActionPath = '/planificador'
      }

      return {
        inspectionsToday,
        managerChecklistsToday,
        staffChecklistsToday,
        shiftsToday,
        storeScopeLabel: scope.storeScopeLabel,
        myNextShift,
        primaryActionPath,
        secondaryActionPath,
      }
    }

    const [financialPulse, operationsPulse] = await Promise.all([
      fetchFinancialPulse(),
      fetchOperationsPulse(),
    ])

    return NextResponse.json({
      businessDate,
      shiftPeriod,
      laTimeLabel,
      role,
      storeScopeLabel: scope.storeScopeLabel,
      financialPulse,
      operationsPulse,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno'
    console.error('❌ [GET /api/mobile-os/summary] Unexpected error:', message)
    return NextResponse.json(
      { error: 'Error al consultar el resumen operativo móvil.' },
      { status: 500 }
    )
  }
}
