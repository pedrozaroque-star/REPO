/**
 * @module lib/ronos-nhp-audit
 * @description Motor backend compartido de enriquecimiento y auditoría cruzada RONOS + Planificador + Toast POS
 *   bajo las políticas de `NHP TEG SPANISH.pdf` (`lib/ronos-attendance-policy.ts`).
 *
 * @businessRules
 *   - Consolida en servidor las fuentes oficiales de verdad:
 *     1) `getRonosStoreAudit` (ponchadas y horas oficiales de RONOS / Cingular HR)
 *     2) `shifts` (turnos publicados en Planificador)
 *     3) `punches` (ponchadas reales de Toast POS para detección de faltantes en RONOS)
 *     4) `ronos_employee_mappings` + `toast_employees` (resolución de identidad sin adivinar por nombres)
 *     5) `simplify_employee_rates` + `users` (exclusión estricta de Managers y Supervisores asalariados)
 *     6) `schedules` (ausencias de liderazgo / vacaciones / enfermedad)
 *   - Respeta el día laboral de California (`America/Los_Angeles`, 6:00 AM a 5:59 AM del siguiente día).
 *   - Nunca persiste auto-mapeos por similitud de nombres; usa mapeos confirmados o identificadores nativos.
 *
 * @dataFlow
 *   Supabase (`stores`, `shifts`, `punches`, `schedules`, `users`, `ronos_employee_mappings`,
 *   `toast_employees`, `simplify_employee_rates`) + RONOS Store Audit
 *   -> `enrichStoreAuditWithNhpPolicy` -> `/api/ronos/punches`, `/api/ronos/notify-violation`,
 *      `/api/cron/sync-ronos-violations`.
 *
 * @notes
 *   - Diseñado para tolerar fallos parciales de lectura en tablas secundarias sin colapsar `/api/ronos/punches`.
 *   - Evita duplicación de lógica entre el endpoint interactivo, el despachador manual y el cron diario.
 */

import { supabaseAdmin } from './supabase'
import { buildVerifiedCorporateEmailSet } from './email-recipient-guard'
import {
  getPacificBusinessDate,
  RONOS_STORES_MAP,
  type RonosComplianceViolation,
  type RonosDailyPunchesRecord,
  type RonosEmployeeTimecard,
  type RonosStoreAuditSummary,
} from './ronos-api'
import {
  calculateNameSimilarity,
  resolveNativeAutoMatch,
  type ToastEmployeeCandidate,
} from './ronos-mapping'
import {
  detectStoreDayCoverageGap,
  evaluateEmployeeDayAttendancePolicy,
  evaluateSalariedExemption,
  INTERNAL_LUNCH_MIN_VIOLATION_MINUTES,
  parseTimeInLA,
  summarizePlannerShiftForDay,
  summarizeToastPunchesForDay,
  type PlannerScheduledShiftInput,
  type PlannerShiftSummary,
  type RonosDayAttendanceEvaluation,
  type RonosPolicyViolationItem,
  type SickDayHistoryItem,
  type StoreDayCoverageContext,
  type StoreDayHourlySalesContext,
  type ToastPunchRecordInput,
  type ToastPunchSummary,
} from './ronos-attendance-policy'

export interface StoreNhpAuditSummary {
  startDate: string
  endDate: string
  evaluatedDaysCount: number
  totalViolations: number
  punctualityViolations: number
  repairViolations: number
  mealViolations: number
  noShowCount: number
  medicalNoteAlertsCount: number
  authorizedEarlyCallIns: number
  authorizedEarlyOuts?: number
  voluntaryExtendedStays?: number
  exemptSalariedCount: number
}

export interface EmployeeNhpSummary {
  isExemptSalaried: boolean
  salariedExemptionReason: string | null
  punctualityViolationsCount: number
  repairViolationsCount: number
  mealViolationsCount: number
  noShowCount: number
  medicalNoteAlertsCount: number
  authorizedEarlyCallInsCount: number
  authorizedEarlyOutsCount?: number
  voluntaryExtendedStaysCount?: number
  totalActiveViolationsCount: number
}

export interface EnrichedRonosDailyRecord extends RonosDailyPunchesRecord {
  scheduledShift?: PlannerShiftSummary
  toastSummary?: ToastPunchSummary
  nhpEvaluation?: RonosDayAttendanceEvaluation
}

export interface EnrichedRonosEmployeeTimecard extends RonosEmployeeTimecard {
  isInactiveMapping?: boolean
  userRole?: string | null
  nhpSummary?: EmployeeNhpSummary
  days: EnrichedRonosDailyRecord[]
}

export interface EnrichedRonosStoreAuditSummary extends RonosStoreAuditSummary {
  nhpAuditSummary?: StoreNhpAuditSummary
  employees: EnrichedRonosEmployeeTimecard[]
}

import { formatStoreDisplayName } from './store-display'

export interface StoreIdentityRow {
  id: number
  code: string | null
  name: string
  external_id: string | null
  is_active: boolean
  supervisor_id: number | null
  supervisor_email: string | null
}

function normalizeTextStrict(str?: string | null): string {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeNameCompact(str?: string | null): string {
  return normalizeTextStrict(str).replace(/[^a-z0-9]/g, '')
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const clean = dateIso.slice(0, 10)
  const parts = clean.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return clean
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0))
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export function normalizeCorporateEmail(raw?: string | null): string | null {
  if (!raw) return null
  const clean = raw.trim().toLowerCase()
  if (!clean) return null
  if (clean === 'roque@tacosgavilan.com') return 'carlos@tacosgavilan.com'
  if (clean.includes('ricardo') && clean.endsWith('@tacosgavilan.com')) {
    return 'ricardo@tacosgavilan.com'
  }
  if (clean.includes('javier') && clean.endsWith('@tacosgavilan.com')) {
    return 'javier@tacosgavilan.com'
  }
  return clean
}

function mapScheduleLabelForPolicy(rawLabel?: string | null): string | null {
  if (!rawLabel) return null
  const upper = rawLabel.trim().toUpperCase()
  if (upper.includes('ENFERM') || upper === 'SICK') return 'SICK'
  if (upper.includes('VAC') || upper === 'VACACIONES' || upper === 'VACATION') return 'VAC'
  if (upper === 'HOLIDAY' || upper.includes('FESTIV')) return 'HOLIDAY'
  return rawLabel
}

async function fetchPaginatedRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

function mapPolicyViolationToCompliance(v: RonosPolicyViolationItem): RonosComplianceViolation & {
  category?: string
  uiSeverity?: 'critical' | 'warning' | 'info'
  isViolation?: boolean
  policyReference?: string
  actionRequired?: string
  exemptionReason?: string | null
  diffMinutes?: number
} {
  return {
    type: v.type as any,
    severity: v.severity,
    uiSeverity: v.uiSeverity,
    category: v.category,
    isViolation: v.isViolation,
    title: v.title,
    description: v.description,
    policyReference: v.policyReference,
    actionRequired: v.actionRequired,
    estimatedCostUsd: v.estimatedCostUsd,
    minutes: v.minutes,
    diffMinutes: v.diffMinutes,
    exemptionReason: v.exemptionReason,
  }
}

function mergeDayViolations(
  existingViolations: RonosComplianceViolation[] | undefined,
  policyViolations: RonosPolicyViolationItem[],
  isExemptSalaried: boolean
): RonosComplianceViolation[] {
  if (isExemptSalaried) {
    return []
  }

  const byType = new Map<string, RonosComplianceViolation>()

  for (const pv of policyViolations) {
    if (!pv.isViolation) continue
    byType.set(pv.type, mapPolicyViolationToCompliance(pv))
  }

  if (Array.isArray(existingViolations)) {
    for (const ev of existingViolations) {
      if (!ev?.type) continue
      // Descartar LONG_LUNCH cacheados antiguos (< 33m cumplidos, ej. 31m o 32m dentro de la tolerancia confidencial)
      if (
        ev.type === 'LONG_LUNCH' &&
        (ev.minutes === undefined ||
          ev.minutes === null ||
          Math.floor(Number(ev.minutes)) < INTERNAL_LUNCH_MIN_VIOLATION_MINUTES)
      ) {
        continue
      }
      if (!byType.has(ev.type)) {
        byType.set(ev.type, ev)
      }
    }
  }

  return Array.from(byType.values())
}

interface CrossRefContext {
  storesByTegId: Map<number, StoreIdentityRow>
  storesByExternalId: Map<string, StoreIdentityRow>
  storesByCompanyId: Map<number, StoreIdentityRow>
  registeredCorporateEmails: Set<string>
  usersById: Map<number, any>
  allUsers: any[]
  toastById: Map<string, any>
  toastByGuid: Map<string, any>
  toastCandidatesByStoreExtId: Map<string, ToastEmployeeCandidate[]>
  allToastCandidates: ToastEmployeeCandidate[]
  mappingsByCompanyAndUser: Map<string, any>
  simplifyByAssignmentId: Map<string, any>
  simplifyByEmpId: Map<string, any>
  simplifyByCompanyName: Map<string, any>
  simplifyByGlobalName: Map<string, any>
  shiftsByStoreAndDate: Map<string, PlannerScheduledShiftInput[]>
  punchesByStoreDateGuid: Map<string, ToastPunchRecordInput[]>
  schedulesByStoreUserDate: Map<string, any>
  salesCacheByStoreAndDate: Map<string, any>
}

interface StaticCrossRefBase {
  fetchedAt: number
  storesData: any[]
  usersData: any[]
  toastEmpsAll: any[]
  simplifyRows: any[]
}

const STATIC_CROSS_REF_TTL_MS = 45_000
let cachedStaticCrossRef: StaticCrossRefBase | null = null
let inflightStaticCrossRef: Promise<StaticCrossRefBase> | null = null

async function getStaticCrossRefBase(): Promise<StaticCrossRefBase> {
  if (cachedStaticCrossRef && Date.now() - cachedStaticCrossRef.fetchedAt < STATIC_CROSS_REF_TTL_MS) {
    return cachedStaticCrossRef
  }
  if (inflightStaticCrossRef) {
    return inflightStaticCrossRef
  }
  inflightStaticCrossRef = (async () => {
    const [storesRes, usersRes, toastEmpsAll, simplifyRows] = await Promise.all([
      supabaseAdmin
        .from('stores')
        .select('id, code, name, external_id, is_active, supervisor_id, users!stores_supervisor_id_fkey(email)')
        .eq('is_active', true),
      supabaseAdmin
        .from('users')
        .select('id, full_name, email, role, store_id, is_active, toast_guid, google_email_connected'),
      fetchPaginatedRows((from, to) =>
        supabaseAdmin
          .from('toast_employees')
          .select(
            'id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, passcode, external_employee_id, external_id, store_ids, deleted'
          )
          .eq('deleted', false)
          .range(from, to)
      ),
      fetchPaginatedRows((from, to) =>
        supabaseAdmin
          .from('simplify_employee_rates')
          .select(
            'employee_id, ronos_company_id, ronos_assignment_id, full_name, normalized_name, first_last_name, pay_rate, pay_type, is_salaried, job_title'
          )
          .range(from, to)
      ),
    ])
    const base: StaticCrossRefBase = {
      fetchedAt: Date.now(),
      storesData: storesRes.data || [],
      usersData: usersRes.data || [],
      toastEmpsAll,
      simplifyRows,
    }
    cachedStaticCrossRef = base
    return base
  })().finally(() => {
    inflightStaticCrossRef = null
  })
  return inflightStaticCrossRef
}

/**
 * Carga en paralelo todas las tablas de referencia necesarias para enriquecer una o varias tiendas
 * dentro de un rango de fechas `[startDate, endDate]`.
 */
async function loadCrossRefContext(params: {
  companyIds: number[]
  startDate: string
  endDate: string
  historyStartDate: string
}): Promise<CrossRefContext> {
  const { companyIds, startDate, endDate, historyStartDate } = params

  const [staticBase, mappingsRes] = await Promise.all([
    getStaticCrossRefBase(),
    companyIds.length === 1
      ? supabaseAdmin
          .from('ronos_employee_mappings')
          .select(
            'ronos_employee_user_id, ronos_employee_id, ronos_company_id, ronos_full_name, ronos_pin, ronos_job_title, toast_employee_id, toast_guid, toast_full_name, toast_email, mapping_type, is_confirmed'
          )
          .eq('ronos_company_id', companyIds[0])
      : fetchPaginatedRows((from, to) =>
          supabaseAdmin
            .from('ronos_employee_mappings')
            .select(
              'ronos_employee_user_id, ronos_employee_id, ronos_company_id, ronos_full_name, ronos_pin, ronos_job_title, toast_employee_id, toast_guid, toast_full_name, toast_email, mapping_type, is_confirmed'
            )
            .range(from, to)
        ).then((data) => ({ data, error: null })),
  ])

  const { storesData, usersData, toastEmpsAll, simplifyRows } = staticBase

  const storesByTegId = new Map<number, StoreIdentityRow>()
  const storesByExternalId = new Map<string, StoreIdentityRow>()
  const storesByCompanyId = new Map<number, StoreIdentityRow>()

  for (const s of storesData) {
    const rawSupEmail = (s.users as any)?.email || null
    const row: StoreIdentityRow = {
      id: Number(s.id),
      code: s.code || null,
      name: formatStoreDisplayName(s) || 'Tacos Gavilan',
      external_id: s.external_id || null,
      is_active: Boolean(s.is_active),
      supervisor_id: s.supervisor_id != null ? Number(s.supervisor_id) : null,
      supervisor_email: normalizeCorporateEmail(rawSupEmail),
    }
    storesByTegId.set(row.id, row)
    if (row.external_id) storesByExternalId.set(row.external_id, row)

    const cleanName = row.name.replace(/^Tacos Gavilan\s+/i, '').trim().toLowerCase()
    const mapEntry = RONOS_STORES_MAP.find(
      (r) =>
        r.tegStoreId === row.id ||
        (row.code && r.tegCode.toUpperCase() === row.code.toUpperCase()) ||
        r.tegName.toLowerCase() === cleanName
    )
    if (mapEntry) {
      storesByCompanyId.set(mapEntry.ronosCompanyId, row)
    }
  }

  const targetTegIds: number[] = []
  const targetExternalIds: string[] = []
  for (const cId of companyIds) {
    const st = storesByCompanyId.get(cId)
    if (st) {
      targetTegIds.push(st.id)
      if (st.external_id) targetExternalIds.push(st.external_id)
    }
  }

  const neededSalesDatesSet = new Set<string>()
  let salesCur = startDate
  for (let i = 0; i < 15 && salesCur <= endDate; i++) {
    neededSalesDatesSet.add(salesCur)
    neededSalesDatesSet.add(addDaysIso(salesCur, -7))
    neededSalesDatesSet.add(addDaysIso(salesCur, -14))
    neededSalesDatesSet.add(addDaysIso(salesCur, -21))
    neededSalesDatesSet.add(addDaysIso(salesCur, -28))
    salesCur = addDaysIso(salesCur, 1)
  }
  const neededSalesDates = Array.from(neededSalesDatesSet)

  const [shiftsRows, punchesRows, schedulesRows, salesRows] = await Promise.all([
    targetExternalIds.length > 0
      ? fetchPaginatedRows((from, to) => {
          let q = supabaseAdmin
            .from('shifts')
            .select(
              'id, employee_id, store_id, job_id, shift_date, start_time, end_time, status, notes, is_callback'
            )
            .eq('status', 'published')
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)
            .range(from, to)
          if (companyIds.length === 1 && targetExternalIds.length === 1) {
            q = q.eq('store_id', targetExternalIds[0])
          } else {
            q = q.in('store_id', targetExternalIds)
          }
          return q
        })
      : Promise.resolve([] as any[]),
    targetExternalIds.length > 0
      ? fetchPaginatedRows((from, to) => {
          let q = supabaseAdmin
            .from('punches')
            .select(
              'toast_id, store_id, employee_toast_guid, business_date, clock_in, clock_out, regular_hours, overtime_hours, breaks'
            )
            .gte('business_date', startDate)
            .lte('business_date', endDate)
            .range(from, to)
          if (companyIds.length === 1 && targetExternalIds.length === 1) {
            q = q.eq('store_id', targetExternalIds[0])
          } else {
            q = q.in('store_id', targetExternalIds)
          }
          return q
        })
      : Promise.resolve([] as any[]),
    targetTegIds.length > 0
      ? fetchPaginatedRows((from, to) => {
          let q = supabaseAdmin
            .from('schedules')
            .select('user_id, store_id, date, shift_label, start_time, end_time, role')
            .gte('date', historyStartDate)
            .lte('date', endDate)
            .range(from, to)
          if (companyIds.length === 1 && targetTegIds.length === 1) {
            q = q.eq('store_id', targetTegIds[0])
          } else {
            q = q.in('store_id', targetTegIds)
          }
          return q
        })
      : Promise.resolve([] as any[]),
    targetExternalIds.length > 0 && neededSalesDates.length > 0
      ? fetchPaginatedRows((from, to) => {
          let q = supabaseAdmin
            .from('sales_daily_cache')
            .select(
              'store_id, business_date, net_sales, order_count, labor_hours, labor_cost, hourly_data, hourly_tickets, hourly_labor'
            )
            .in('business_date', neededSalesDates)
            .range(from, to)
          if (companyIds.length === 1 && targetExternalIds.length === 1) {
            q = q.eq('store_id', targetExternalIds[0])
          } else {
            q = q.in('store_id', targetExternalIds)
          }
          return q
        }).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ])

  const allUsers = usersData
  const usersById = new Map<number, any>()
  for (const u of allUsers) {
    if (u.id != null) usersById.set(Number(u.id), u)
  }
  const registeredCorporateEmails = buildVerifiedCorporateEmailSet(allUsers)

  const toastById = new Map<string, any>()
  const toastByGuid = new Map<string, any>()
  const toastCandidatesByStoreExtId = new Map<string, ToastEmployeeCandidate[]>()
  const toastCandidateIdsByStoreExtId = new Map<string, Set<string>>()
  const allToastCandidates: ToastEmployeeCandidate[] = []
  const candidateById = new Map<string, ToastEmployeeCandidate>()

  const addCandidateToStoreIndex = (storeGuid: string, candidate: ToastEmployeeCandidate) => {
    if (!storeGuid || !candidate?.id) return
    let seen = toastCandidateIdsByStoreExtId.get(storeGuid)
    if (!seen) {
      seen = new Set<string>()
      toastCandidateIdsByStoreExtId.set(storeGuid, seen)
    }
    if (seen.has(candidate.id)) return
    seen.add(candidate.id)
    const list = toastCandidatesByStoreExtId.get(storeGuid) || []
    list.push(candidate)
    toastCandidatesByStoreExtId.set(storeGuid, list)
  }

  const registerToastEmployeeRow = (e: any) => {
    if (!e || !e.id) return
    const idStr = String(e.id)
    const fullName = `${e.chosen_name || e.first_name || ''} ${e.last_name || ''}`.trim()
    const candidate: ToastEmployeeCandidate = candidateById.get(idStr) || {
      id: idStr,
      toast_guid: e.toast_guid ? String(e.toast_guid) : '',
      first_name: e.first_name || '',
      last_name: e.last_name || '',
      full_name: fullName || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      email: e.email || null,
      phone: null,
      store_ids: Array.isArray(e.store_ids) ? e.store_ids : [],
      passcode: e.passcode || null,
      external_employee_id: e.external_employee_id || null,
      external_id: e.external_id || null,
    }
    if (!candidateById.has(idStr)) {
      candidateById.set(idStr, candidate)
      allToastCandidates.push(candidate)
    }
    toastById.set(idStr, e)
    if (e.toast_guid) toastByGuid.set(String(e.toast_guid), e)
    if (e.v2_toast_guid) toastByGuid.set(String(e.v2_toast_guid), e)

    if (Array.isArray(e.store_ids)) {
      for (const sGuid of e.store_ids) {
        if (!sGuid) continue
        addCandidateToStoreIndex(String(sGuid), candidate)
      }
    }
  }

  for (const e of toastEmpsAll) {
    registerToastEmployeeRow(e)
  }

  // Asegurar que cualquier empleado referenciado en `shiftsRows` o `punchesRows` exista en `toastById`/`toastByGuid`
  // (incluso si tiene `deleted = true` o no tenía `store_ids` poblado)
  const missingShiftEmpIds = Array.from(
    new Set(
      shiftsRows
        .map((sh: any) => (sh?.employee_id ? String(sh.employee_id) : ''))
        .filter((id: string) => Boolean(id) && !toastById.has(id))
    )
  )
  const missingPunchGuids = Array.from(
    new Set(
      punchesRows
        .map((p: any) => (p?.employee_toast_guid ? String(p.employee_toast_guid) : ''))
        .filter((g: string) => Boolean(g) && !toastByGuid.has(g))
    )
  )

  if (missingShiftEmpIds.length > 0 || missingPunchGuids.length > 0) {
    const extraQueries: PromiseLike<{ data: any[] | null; error: any }>[] = []
    for (let i = 0; i < missingShiftEmpIds.length; i += 200) {
      const chunk = missingShiftEmpIds.slice(i, i + 200)
      extraQueries.push(
        supabaseAdmin
          .from('toast_employees')
          .select(
            'id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, passcode, external_employee_id, external_id, store_ids, deleted'
          )
          .in('id', chunk)
      )
    }
    for (let i = 0; i < missingPunchGuids.length; i += 200) {
      const chunk = missingPunchGuids.slice(i, i + 200)
      extraQueries.push(
        supabaseAdmin
          .from('toast_employees')
          .select(
            'id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, passcode, external_employee_id, external_id, store_ids, deleted'
          )
          .in('toast_guid', chunk)
      )
      extraQueries.push(
        supabaseAdmin
          .from('toast_employees')
          .select(
            'id, toast_guid, v2_toast_guid, first_name, last_name, chosen_name, email, passcode, external_employee_id, external_id, store_ids, deleted'
          )
          .in('v2_toast_guid', chunk)
      )
    }
    const extraResults = await Promise.all(extraQueries)
    for (const res of extraResults) {
      for (const e of res.data || []) {
        registerToastEmployeeRow(e)
      }
    }
  }

  // Vincular candidatos a la tienda donde efectivamente tienen `shifts` o `punches`
  for (const sh of shiftsRows) {
    if (!sh?.store_id || !sh?.employee_id) continue
    const cand = candidateById.get(String(sh.employee_id))
    if (cand) addCandidateToStoreIndex(String(sh.store_id), cand)
  }
  for (const p of punchesRows) {
    if (!p?.store_id || !p?.employee_toast_guid) continue
    const rawEmp = toastByGuid.get(String(p.employee_toast_guid))
    if (rawEmp?.id) {
      const cand = candidateById.get(String(rawEmp.id))
      if (cand) addCandidateToStoreIndex(String(p.store_id), cand)
    }
  }

  const mappingsByCompanyAndUser = new Map<string, any>()
  for (const m of (mappingsRes as any).data || []) {
    if (!m) continue
    const key = `${Number(m.ronos_company_id)}::${Number(m.ronos_employee_user_id)}`
    mappingsByCompanyAndUser.set(key, m)
  }

  const simplifyByAssignmentId = new Map<string, any>()
  const simplifyByEmpId = new Map<string, any>()
  const simplifyByCompanyName = new Map<string, any>()
  const simplifyByGlobalName = new Map<string, any>()

  for (const r of simplifyRows) {
    if (!r) continue
    if (r.ronos_assignment_id) {
      simplifyByAssignmentId.set(String(r.ronos_assignment_id).trim(), r)
    }
    if (r.employee_id) {
      if (r.ronos_company_id) {
        simplifyByEmpId.set(`${Number(r.ronos_company_id)}::${String(r.employee_id).trim()}`, r)
      }
      simplifyByEmpId.set(`global::${String(r.employee_id).trim()}`, r)
    }
    const norm = r.normalized_name ? String(r.normalized_name).toLowerCase().trim() : normalizeTextStrict(r.full_name)
    if (norm) {
      if (r.ronos_company_id) {
        simplifyByCompanyName.set(`${Number(r.ronos_company_id)}::${norm}`, r)
      }
      const existingGlobal = simplifyByGlobalName.get(norm)
      if (!existingGlobal || r.is_salaried || Number(r.pay_rate || 0) >= Number(existingGlobal.pay_rate || 0)) {
        simplifyByGlobalName.set(norm, r)
      }
    }
  }

  const shiftsByStoreAndDate = new Map<string, PlannerScheduledShiftInput[]>()
  for (const sh of shiftsRows) {
    if (!sh || !sh.store_id || !sh.shift_date) continue
    const dStr = String(sh.shift_date).slice(0, 10)
    const key = `${String(sh.store_id)}::${dStr}`
    const list = shiftsByStoreAndDate.get(key) || []
    list.push(sh)
    shiftsByStoreAndDate.set(key, list)
  }

  const punchesByStoreDateGuid = new Map<string, ToastPunchRecordInput[]>()
  for (const p of punchesRows) {
    if (!p || !p.store_id || !p.business_date || !p.employee_toast_guid) continue
    const dStr = String(p.business_date).slice(0, 10)
    const key = `${String(p.store_id)}::${dStr}::${String(p.employee_toast_guid)}`
    const list = punchesByStoreDateGuid.get(key) || []
    list.push(p)
    punchesByStoreDateGuid.set(key, list)
  }

  const schedulesByStoreUserDate = new Map<string, any>()
  for (const sc of schedulesRows) {
    if (!sc || !sc.store_id || !sc.user_id || !sc.date) continue
    const key = `${Number(sc.store_id)}::${Number(sc.user_id)}::${String(sc.date).slice(0, 10)}`
    schedulesByStoreUserDate.set(key, sc)
  }

  const salesCacheByStoreAndDate = new Map<string, any>()
  for (const sr of salesRows) {
    if (!sr || !sr.store_id || !sr.business_date) continue
    const sKey = `${String(sr.store_id).trim().toLowerCase()}::${String(sr.business_date).slice(0, 10)}`
    salesCacheByStoreAndDate.set(sKey, sr)
  }

  return {
    storesByTegId,
    storesByExternalId,
    storesByCompanyId,
    registeredCorporateEmails,
    usersById,
    allUsers,
    toastById,
    toastByGuid,
    toastCandidatesByStoreExtId,
    allToastCandidates,
    mappingsByCompanyAndUser,
    simplifyByAssignmentId,
    simplifyByEmpId,
    simplifyByCompanyName,
    simplifyByGlobalName,
    shiftsByStoreAndDate,
    punchesByStoreDateGuid,
    schedulesByStoreUserDate,
    salesCacheByStoreAndDate,
  }
}

interface ResolvedEmployeeMeta {
  isInactiveMapping: boolean
  toastEmployeeId: string | null
  toastGuid: string | null
  toastV2Guid: string | null
  toastEmail: string | null
  toastFullName: string | null
  matchedUser: any | null
  jobTitle: string
  isSalaried: boolean
  salariedReason: string | null
  payType: string
  payRate: number
  userRole: string | null
}

function normalizeLeadershipRoleForExemption(rawRole?: string | null): string | null {
  if (!rawRole) return null
  const r = String(rawRole).trim().toLowerCase()
  if (!r) return null
  const isAssistantOrShift =
    r.includes('asst') ||
    r.includes('assist') ||
    r.includes('asistente') ||
    r.includes('subgerente') ||
    r.includes('shift') ||
    r.includes('lead') ||
    r.includes('lider') ||
    r.includes('turno')
  if (isAssistantOrShift) return rawRole
  if (r.includes('supervisor')) return 'supervisor'
  if (r.includes('manager') || r.includes('gerente')) return 'manager'
  if (r.includes('director')) return 'director'
  if (r.includes('admin')) return 'admin'
  return rawRole
}

function findMatchedLeadershipUser(params: {
  empFullName: string
  toastFullName?: string | null
  toastEmail?: string | null
  toastGuid?: string | null
  toastV2Guid?: string | null
  storeRow: StoreIdentityRow | undefined
  allUsers: any[]
}): any | null {
  const { empFullName, toastFullName, toastEmail, toastGuid, toastV2Guid, storeRow, allUsers } =
    params
  const cleanEmail = toastEmail ? toastEmail.trim().toLowerCase() : ''
  const compactRonosName = normalizeNameCompact(empFullName)
  const compactToastName = toastFullName ? normalizeNameCompact(toastFullName) : ''

  return (
    allUsers.find((u: any) => {
      if (!u.is_active) return false
      if (u.toast_guid && (u.toast_guid === toastGuid || u.toast_guid === toastV2Guid)) {
        return true
      }
      if (cleanEmail) {
        const uEmail = u.email ? String(u.email).trim().toLowerCase() : ''
        const uGoogle = u.google_email_connected
          ? String(u.google_email_connected).trim().toLowerCase()
          : ''
        if (cleanEmail === uEmail || cleanEmail === uGoogle) {
          return true
        }
      }
      const uRole = String(u.role || '').toLowerCase()
      const isSameStoreOrGlobal =
        uRole.includes('supervisor') ||
        uRole === 'admin' ||
        (storeRow ? Number(u.store_id) === storeRow.id : false)
      if (!isSameStoreOrGlobal) return false

      const userNameCompact = normalizeNameCompact(u.full_name)
      if (!userNameCompact || userNameCompact.length < 4) return false
      if (
        (compactRonosName && userNameCompact === compactRonosName) ||
        (compactToastName && userNameCompact === compactToastName)
      ) {
        return true
      }
      const sim = Math.max(
        calculateNameSimilarity(empFullName, u.full_name || ''),
        toastFullName ? calculateNameSimilarity(toastFullName, u.full_name || '') : 0
      )
      return sim >= 88
    }) || null
  )
}

function resolveEmployeeMetadata(
  emp: RonosEmployeeTimecard,
  companyId: number,
  storeRow: StoreIdentityRow | undefined,
  ctx: CrossRefContext
): ResolvedEmployeeMeta {
  const mapKey = `${companyId}::${emp.employeeUserId}`
  const savedMap = ctx.mappingsByCompanyAndUser.get(mapKey)
  const isInactiveMapping = savedMap?.mapping_type === 'inactive'

  let toastEmp: any = null
  const explicitToastId = savedMap?.toast_employee_id || emp.toastEmployeeId || null
  const explicitToastGuid = savedMap?.toast_guid || emp.toastGuid || null

  if (explicitToastId && ctx.toastById.has(String(explicitToastId))) {
    toastEmp = ctx.toastById.get(String(explicitToastId))
  } else if (explicitToastGuid && ctx.toastByGuid.has(String(explicitToastGuid))) {
    toastEmp = ctx.toastByGuid.get(String(explicitToastGuid))
  }

  // Si sigue sin vínculo y no está marcado como inactivo, intentar ÚNICAMENTE por ID nativo unívoco (assignmentId, employeeId, PIN único)
  if (!toastEmp && !isInactiveMapping) {
    const storeCandidates =
      storeRow?.external_id && ctx.toastCandidatesByStoreExtId.has(storeRow.external_id)
        ? ctx.toastCandidatesByStoreExtId.get(storeRow.external_id)!
        : []
    const nativeMatch = resolveNativeAutoMatch(
      {
        employeeUserId: emp.employeeUserId,
        employeeId: emp.employeeId,
        pin: emp.pin,
        assignmentId: emp.ronosAssignmentId || undefined,
      },
      storeCandidates,
      ctx.allToastCandidates
    )
    if (nativeMatch?.matchedCandidate?.id) {
      toastEmp = ctx.toastById.get(nativeMatch.matchedCandidate.id) || nativeMatch.matchedCandidate
    }
  }

  const toastEmployeeId = explicitToastId || (toastEmp?.id ? String(toastEmp.id) : null)
  const toastGuid = explicitToastGuid || (toastEmp?.toast_guid ? String(toastEmp.toast_guid) : null)
  const toastV2Guid = toastEmp?.v2_toast_guid ? String(toastEmp.v2_toast_guid) : null
  const toastEmail =
    (savedMap?.toast_email || emp.toastEmail || toastEmp?.email || null)?.trim() || null
  const toastFullName =
    savedMap?.toast_full_name ||
    emp.toastFullName ||
    (toastEmp ? `${toastEmp.first_name || ''} ${toastEmp.last_name || ''}`.trim() : null)

  // Cruzar con `simplify_employee_rates`
  const normRonosName = normalizeTextStrict(emp.fullName)
  const simplifyRow =
    (emp.ronosAssignmentId
      ? ctx.simplifyByAssignmentId.get(String(emp.ronosAssignmentId).trim())
      : null) ||
    ctx.simplifyByEmpId.get(`${companyId}::${emp.employeeId}`) ||
    ctx.simplifyByEmpId.get(`${companyId}::${emp.employeeUserId}`) ||
    ctx.simplifyByEmpId.get(`global::${emp.employeeId}`) ||
    ctx.simplifyByCompanyName.get(`${companyId}::${normRonosName}`) ||
    ctx.simplifyByGlobalName.get(normRonosName) ||
    null

  // Cruzar con `public.users` (por toast_guid, email o nombre en misma tienda/supervisor)
  const matchedUser = findMatchedLeadershipUser({
    empFullName: emp.fullName,
    toastFullName,
    toastEmail,
    toastGuid,
    toastV2Guid,
    storeRow,
    allUsers: ctx.allUsers,
  })

  const isPlaceholderManagerAccount = /^manager\b/i.test(emp.fullName.trim())
  const resolvedJobTitle = isPlaceholderManagerAccount
    ? 'Manager'
    : simplifyRow?.job_title ||
      savedMap?.ronos_job_title ||
      emp.jobTitle ||
      'Colaborador'
  const resolvedPayType = simplifyRow?.pay_type || emp.payType || 'Hourly'
  const resolvedPayRate =
    Number(simplifyRow?.pay_rate || 0) > 0
      ? Number(simplifyRow.pay_rate)
      : Number(emp.payRate || 0)
  const userRole = normalizeLeadershipRoleForExemption(matchedUser?.role)
  const isCanonicalLeadershipUser =
    userRole === 'manager' ||
    userRole === 'supervisor' ||
    userRole === 'director' ||
    userRole === 'admin'

  const effectiveJobTitle = isCanonicalLeadershipUser
    ? userRole === 'supervisor'
      ? 'Supervisor'
      : 'Store Manager'
    : resolvedJobTitle

  const salariedCheck = evaluateSalariedExemption({
    jobTitle: effectiveJobTitle,
    fullName: emp.fullName,
    payRate: resolvedPayRate,
    isSalaried:
      isCanonicalLeadershipUser ||
      emp.isSalaried === true ||
      simplifyRow?.is_salaried === true,
    is_salaried: isCanonicalLeadershipUser || simplifyRow?.is_salaried === true,
    payType: resolvedPayType,
    role: userRole,
  })

  return {
    isInactiveMapping,
    toastEmployeeId,
    toastGuid,
    toastV2Guid,
    toastEmail,
    toastFullName,
    matchedUser,
    jobTitle: resolvedJobTitle,
    isSalaried: salariedCheck.isExempt,
    salariedReason: salariedCheck.reason,
    payType: salariedCheck.isExempt ? 'Yearly' : resolvedPayType,
    payRate: resolvedPayRate,
    userRole,
  }
}

function getToastPunchesForEmployeeDate(
  meta: ResolvedEmployeeMeta,
  storeExternalId: string | null | undefined,
  businessDate: string,
  ctx: CrossRefContext
): ToastPunchRecordInput[] {
  if (!storeExternalId) return []
  const result: ToastPunchRecordInput[] = []
  const seenToastIds = new Set<string>()
  const candidateGuids = Array.from(
    new Set([meta.toastGuid, meta.toastV2Guid].filter((g): g is string => Boolean(g)))
  )
  for (const guid of candidateGuids) {
    const list = ctx.punchesByStoreDateGuid.get(`${storeExternalId}::${businessDate}::${guid}`) || []
    for (const p of list) {
      const idKey = p.toast_id ? String(p.toast_id) : `${p.clock_in || ''}-${p.clock_out || ''}`
      if (!seenToastIds.has(idKey)) {
        seenToastIds.add(idKey)
        result.push(p)
      }
    }
  }
  return result
}

function getPlannerShiftsForEmployeeDate(
  meta: ResolvedEmployeeMeta,
  storeExternalId: string | null | undefined,
  businessDate: string,
  ctx: CrossRefContext
): PlannerScheduledShiftInput[] {
  if (!storeExternalId || !meta.toastEmployeeId) return []
  const allStoreShifts = ctx.shiftsByStoreAndDate.get(`${storeExternalId}::${businessDate}`) || []
  return allStoreShifts.filter(
    (s) => s.employee_id && String(s.employee_id) === String(meta.toastEmployeeId)
  )
}

function getScheduleEntryForEmployeeDate(
  meta: ResolvedEmployeeMeta,
  tegStoreId: number | undefined,
  businessDate: string,
  ctx: CrossRefContext
): { shift_label?: string | null; start_time?: string | null; end_time?: string | null } | null {
  if (!meta.matchedUser?.id || !tegStoreId) return null
  const sc = ctx.schedulesByStoreUserDate.get(`${tegStoreId}::${meta.matchedUser.id}::${businessDate}`)
  if (!sc) return null
  return {
    shift_label: mapScheduleLabelForPolicy(sc.shift_label),
    start_time: sc.start_time || null,
    end_time: sc.end_time || null,
  }
}

function buildSickHistoryDays(
  empDays: RonosDailyPunchesRecord[],
  meta: ResolvedEmployeeMeta,
  storeRow: StoreIdentityRow | undefined,
  targetDate: string,
  ctx: CrossRefContext
): SickDayHistoryItem[] {
  const byDate = new Map<string, SickDayHistoryItem>()

  // 1. Días históricos de `schedules` (cubre hasta 10 días atrás aunque pertenezcan a la semana previa)
  if (meta.matchedUser?.id && storeRow?.id) {
    for (let offset = -10; offset <= 0; offset++) {
      const d = addDaysIso(targetDate, offset)
      const sc = ctx.schedulesByStoreUserDate.get(`${storeRow.id}::${meta.matchedUser.id}::${d}`)
      if (!sc) continue
      const mappedLabel = mapScheduleLabelForPolicy(sc.shift_label)
      const isSickLabel = mappedLabel === 'SICK'
      const isRestLabel = String(sc.shift_label || '').toUpperCase() === 'OFF'
      if (!isRestLabel || isSickLabel) {
        byDate.set(d, {
          date: d,
          isSick: isSickLabel,
          shiftLabel: mappedLabel,
        })
      }
    }
  }

  // 2. Días de la semana en RONOS (excluyendo días libres sin ponchadas ni turno publicado)
  for (const d of empDays || []) {
    const dStr = String(d?.date || '').slice(0, 10)
    if (!dStr || dStr > targetDate) continue

    const shifts = getPlannerShiftsForEmployeeDate(meta, storeRow?.external_id, dStr, ctx)
    const toastPunches = getToastPunchesForEmployeeDate(meta, storeRow?.external_id, dStr, ctx)
    const dayIsSick = Boolean(d.isSick) || Number(d.sickHours || 0) > 0
    const hasActivityOrSchedule =
      dayIsSick ||
      Number(d.totalHours || 0) > 0 ||
      (Array.isArray(d.punches) && d.punches.length > 0) ||
      shifts.length > 0 ||
      toastPunches.length > 0

    if (hasActivityOrSchedule) {
      byDate.set(dStr, {
        date: dStr,
        isSick: dayIsSick,
        sickHours: d.sickHours ?? 0,
        shiftLabel: dayIsSick ? 'SICK' : null,
      })
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function buildEmptyRonosDayStub(dateIso: string): RonosDailyPunchesRecord {
  let dayName = ''
  try {
    const d = new Date(`${dateIso}T12:00:00Z`)
    if (!Number.isNaN(d.getTime())) {
      const raw = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'long',
      }).format(d)
      dayName = raw
    }
  } catch {}
  return {
    date: dateIso,
    dayName,
    totalHours: 0,
    regularHours: 0,
    overtimeHours: 0,
    doubleTimeHours: 0,
    lunchHours: 0,
    lunchDurationMinutes: 0,
    punches: [],
    violations: [],
  }
}

const NAME_CONNECTORS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'el',
  'da',
  'do',
  'dos',
  'san',
  'santa',
])

const GENERIC_ROLE_TOKENS = new Set([
  'manager',
  'gerente',
  'colaborador',
  'employee',
  'default',
  'admin',
  'cajero',
  'taquero',
  'cocinero',
  'prep',
])

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function toBusinessDayMinutes(p: ReturnType<typeof parseTimeInLA>): number | null {
  if (!p) return null
  let rel = p.relativeMinutesFromBizDate
  if (p.epochMs === null && rel < 360) {
    rel += 1440
  }
  return rel
}

function extractNonConnectorTokens(rawName?: string | null): string[] {
  if (!rawName) return []
  return normalizeTextStrict(rawName)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => Boolean(t) && !NAME_CONNECTORS.has(t))
}

/**
 * Pasada 2 (Estrictamente en Memoria): Cruce operativo por misma tienda + huella de horario/ponchada
 * para colaboradores activos que no cuentan con `passcode` en `toast_employees` ni fila en `ronos_employee_mappings`.
 * JAMÁS escribe en `ronos_employee_mappings` ni modifica `mappingType`.
 */
function applySecondPassStoreOperationalMatching(params: {
  employees: RonosEmployeeTimecard[]
  defaultCompanyId: number
  contextStartDate: string
  contextEndDate: string
  ctx: CrossRefContext
  resolvedMetaByCompanyEmp: Map<string, ResolvedEmployeeMeta>
  resolvedMetaByEmployee: Map<number, ResolvedEmployeeMeta>
}): void {
  const {
    employees,
    defaultCompanyId,
    contextStartDate,
    contextEndDate,
    ctx,
    resolvedMetaByCompanyEmp,
    resolvedMetaByEmployee,
  } = params

  const claimedIdsByCompany = new Map<number, Set<string>>()
  const claimedGuidsByCompany = new Map<number, Set<string>>()

  const claimCandidate = (companyId: number, toastId?: string | null, toastGuid?: string | null) => {
    if (toastId) {
      let s = claimedIdsByCompany.get(companyId)
      if (!s) {
        s = new Set<string>()
        claimedIdsByCompany.set(companyId, s)
      }
      s.add(String(toastId))
    }
    if (toastGuid) {
      let g = claimedGuidsByCompany.get(companyId)
      if (!g) {
        g = new Set<string>()
        claimedGuidsByCompany.set(companyId, g)
      }
      g.add(String(toastGuid))
    }
  }

  for (const emp of employees) {
    const cId = Number((emp as any).companyId || defaultCompanyId)
    const meta = resolvedMetaByCompanyEmp.get(`${cId}::${emp.employeeUserId}`)
    if (meta?.toastEmployeeId || meta?.toastGuid) {
      claimCandidate(cId, meta.toastEmployeeId, meta.toastGuid)
    }
  }

  // Generar lista de fechas del período para verificar actividad del candidato en la tienda
  const periodDates: string[] = []
  let cur = contextStartDate
  for (let i = 0; i < 15 && cur <= contextEndDate; i++) {
    periodDates.push(cur)
    cur = addDaysIso(cur, 1)
  }

  const assignCandidateToMeta = (
    emp: RonosEmployeeTimecard,
    companyId: number,
    meta: ResolvedEmployeeMeta,
    cand: ToastEmployeeCandidate
  ) => {
    const rawToast = ctx.toastById.get(cand.id)
    const storeRow = ctx.storesByCompanyId.get(companyId)
    claimCandidate(companyId, cand.id, cand.toast_guid || rawToast?.toast_guid)
    meta.toastEmployeeId = String(cand.id)
    meta.toastGuid =
      cand.toast_guid || (rawToast?.toast_guid ? String(rawToast.toast_guid) : null)
    meta.toastV2Guid = rawToast?.v2_toast_guid ? String(rawToast.v2_toast_guid) : null
    meta.toastEmail =
      (meta.toastEmail || cand.email || rawToast?.email || null)?.trim() || null
    meta.toastFullName = meta.toastFullName || cand.full_name || null

    // Re-evaluar cruce con `users` y `simplify_employee_rates` ahora que conocemos email/guid/nombre de Toast
    if (!meta.matchedUser) {
      meta.matchedUser = findMatchedLeadershipUser({
        empFullName: emp.fullName,
        toastFullName: meta.toastFullName,
        toastEmail: meta.toastEmail,
        toastGuid: meta.toastGuid,
        toastV2Guid: meta.toastV2Guid,
        storeRow,
        allUsers: ctx.allUsers,
      })
      if (meta.matchedUser?.role) {
        meta.userRole = normalizeLeadershipRoleForExemption(meta.matchedUser.role)
      }
    }

    const normToastName = meta.toastFullName ? normalizeTextStrict(meta.toastFullName) : ''
    const simplifyByToast =
      (normToastName &&
        (ctx.simplifyByCompanyName.get(`${companyId}::${normToastName}`) ||
          ctx.simplifyByGlobalName.get(normToastName))) ||
      null
    if (simplifyByToast) {
      if (simplifyByToast.job_title && meta.jobTitle === 'Colaborador') {
        meta.jobTitle = simplifyByToast.job_title
      }
      if (Number(simplifyByToast.pay_rate || 0) > 0 && meta.payRate === 0) {
        meta.payRate = Number(simplifyByToast.pay_rate)
      }
    }

    if (!meta.isSalaried) {
      const isCanonicalLeader =
        meta.userRole === 'manager' ||
        meta.userRole === 'supervisor' ||
        meta.userRole === 'director' ||
        meta.userRole === 'admin'
      const recheck = evaluateSalariedExemption({
        jobTitle: isCanonicalLeader ? 'Store Manager' : meta.jobTitle,
        fullName: emp.fullName,
        payRate: meta.payRate,
        isSalaried: isCanonicalLeader || simplifyByToast?.is_salaried === true,
        is_salaried: isCanonicalLeader || simplifyByToast?.is_salaried === true,
        payType: simplifyByToast?.pay_type || meta.payType,
        role: meta.userRole,
      })
      if (recheck.isExempt) {
        meta.isSalaried = true
        meta.salariedReason = recheck.reason
        meta.payType = 'Yearly'
      }
    }

    resolvedMetaByEmployee.set(emp.employeeUserId, meta)
  }

  for (const emp of employees) {
    const companyId = Number((emp as any).companyId || defaultCompanyId)
    const meta = resolvedMetaByCompanyEmp.get(`${companyId}::${emp.employeeUserId}`)
    if (!meta || meta.isInactiveMapping || meta.toastEmployeeId) continue

    const storeRow = ctx.storesByCompanyId.get(companyId)
    if (!storeRow?.external_id) continue
    const storeExtId = storeRow.external_id

    const claimedIds = claimedIdsByCompany.get(companyId) || new Set<string>()
    const claimedGuids = claimedGuidsByCompany.get(companyId) || new Set<string>()
    const candidates = (ctx.toastCandidatesByStoreExtId.get(storeExtId) || []).filter(
      (c) =>
        Boolean(c?.id) &&
        !claimedIds.has(c.id) &&
        (!c.toast_guid || !claimedGuids.has(c.toast_guid))
    )
    if (candidates.length === 0) continue

    const empCompact = normalizeNameCompact(emp.fullName)
    const scored = candidates.map((cand) => {
      const rawToast = ctx.toastById.get(cand.id)
      const candGuids = Array.from(
        new Set([cand.toast_guid, rawToast?.v2_toast_guid].filter((g): g is string => Boolean(g)))
      )
      const c1 = normalizeNameCompact(cand.full_name)
      const c2 = normalizeNameCompact(`${cand.first_name || ''} ${cand.last_name || ''}`)
      const isExactName = Boolean(empCompact && (empCompact === c1 || empCompact === c2))
      const sim = isExactName
        ? 100
        : Math.max(
            calculateNameSimilarity(emp.fullName, cand.full_name),
            calculateNameSimilarity(
              emp.fullName,
              `${cand.first_name || ''} ${cand.last_name || ''}`.trim()
            )
          )

      let matchingPunchDaysCount = 0
      for (const d of emp.days || []) {
        const dKey = String(d?.date || '').slice(0, 10)
        if (!dKey || !d.clockInTime) continue
        const ronosInP = parseTimeInLA(d.clockInTime, dKey)
        if (!ronosInP) continue
        let matchedDay = false
        for (const g of candGuids) {
          const tPunches = ctx.punchesByStoreDateGuid.get(`${storeExtId}::${dKey}::${g}`) || []
          for (const tp of tPunches) {
            const toastInP = parseTimeInLA(
              tp.clock_in || tp.in_date || tp.clockInTime,
              dKey
            )
            if (
              toastInP &&
              Math.abs(ronosInP.relativeMinutesFromBizDate - toastInP.relativeMinutesFromBizDate) <=
                5
            ) {
              matchedDay = true
              break
            }
          }
          if (matchedDay) break
        }
        if (matchedDay) matchingPunchDaysCount++
      }

      let hasStoreActivityInPeriod = matchingPunchDaysCount > 0
      if (!hasStoreActivityInPeriod) {
        for (const pDate of periodDates) {
          const dayShifts = ctx.shiftsByStoreAndDate.get(`${storeExtId}::${pDate}`) || []
          if (dayShifts.some((s) => String(s.employee_id) === cand.id)) {
            hasStoreActivityInPeriod = true
            break
          }
          for (const g of candGuids) {
            if ((ctx.punchesByStoreDateGuid.get(`${storeExtId}::${pDate}::${g}`) || []).length > 0) {
              hasStoreActivityInPeriod = true
              break
            }
          }
          if (hasStoreActivityInPeriod) break
        }
      }

      return {
        cand,
        isExactName,
        similarity: sim,
        matchingPunchDaysCount,
        hasStoreActivityInPeriod,
      }
    })

    // Nivel A: Coincidencia exacta por nombre normalizado en la misma tienda
    const exactMatches = scored.filter((s) => s.isExactName)
    if (exactMatches.length === 1) {
      assignCandidateToMeta(emp, companyId, meta, exactMatches[0].cand)
      continue
    } else if (exactMatches.length > 1) {
      const activeExact = exactMatches.filter((s) => s.hasStoreActivityInPeriod)
      if (activeExact.length === 1) {
        assignCandidateToMeta(emp, companyId, meta, activeExact[0].cand)
        continue
      }
    }

    // Nivel B1: Similitud >= 65 corroborada con ponchada Toast `clock_in` dentro de ±5 min en la misma tienda/fecha
    const corroborated = scored
      .filter((s) => s.similarity >= 65 && s.matchingPunchDaysCount >= 1)
      .sort(
        (a, b) =>
          b.matchingPunchDaysCount - a.matchingPunchDaysCount || b.similarity - a.similarity
      )
    if (corroborated.length === 1) {
      assignCandidateToMeta(emp, companyId, meta, corroborated[0].cand)
      continue
    } else if (corroborated.length > 1) {
      const top = corroborated[0]
      const second = corroborated[1]
      if (
        top.matchingPunchDaysCount > second.matchingPunchDaysCount ||
        top.similarity - second.similarity >= 5
      ) {
        assignCandidateToMeta(emp, companyId, meta, top.cand)
        continue
      }
    }

    // Nivel B2: Similitud alta (>= 85) sin empate cercano (o único con actividad real en el período)
    const highSim = scored
      .filter((s) => s.similarity >= 85)
      .sort(
        (a, b) =>
          Number(b.hasStoreActivityInPeriod) - Number(a.hasStoreActivityInPeriod) ||
          b.similarity - a.similarity
      )
    if (highSim.length === 1) {
      assignCandidateToMeta(emp, companyId, meta, highSim[0].cand)
      continue
    } else if (highSim.length > 1) {
      const top = highSim[0]
      const second = highSim[1]
      if (
        (top.hasStoreActivityInPeriod && !second.hasStoreActivityInPeriod) ||
        top.similarity - second.similarity >= 12
      ) {
        assignCandidateToMeta(emp, companyId, meta, top.cand)
        continue
      }
    }
  }

  // Fase 2 (Nivel C — Deducción Humana sobre el pool restante NO reclamado en la misma tienda)
  const empsByCompany = new Map<number, RonosEmployeeTimecard[]>()
  for (const emp of employees) {
    const cId = Number((emp as any).companyId || defaultCompanyId)
    const list = empsByCompany.get(cId) || []
    list.push(emp)
    empsByCompany.set(cId, list)
  }

  for (const [companyId, companyEmps] of empsByCompany.entries()) {
    const storeRow = ctx.storesByCompanyId.get(companyId)
    if (!storeRow?.external_id) continue
    const storeExtId = storeRow.external_id

    const getUnmatchedEmps = () =>
      companyEmps.filter((emp) => {
        const m = resolvedMetaByCompanyEmp.get(`${companyId}::${emp.employeeUserId}`)
        return Boolean(m && !m.isInactiveMapping && !m.toastEmployeeId)
      })

    const getUnclaimedCands = () => {
      const cIds = claimedIdsByCompany.get(companyId) || new Set<string>()
      const cGuids = claimedGuidsByCompany.get(companyId) || new Set<string>()
      return (ctx.toastCandidatesByStoreExtId.get(storeExtId) || []).filter(
        (c) =>
          Boolean(c?.id) &&
          !cIds.has(c.id) &&
          (!c.toast_guid || !cGuids.has(c.toast_guid))
      )
    }

    const initialUnmatched = getUnmatchedEmps()
    const initialUnclaimed = getUnclaimedCands()
    if (initialUnmatched.length === 0 || initialUnclaimed.length === 0) continue

    interface LevelCEdge {
      emp: RonosEmployeeTimecard
      meta: ResolvedEmployeeMeta
      cand: ToastEmployeeCandidate
      score: number
    }

    const candidateEdges: LevelCEdge[] = []
    const empPunchDaysByUserId = new Map<number, number>()

    for (const emp of initialUnmatched) {
      const meta = resolvedMetaByCompanyEmp.get(`${companyId}::${emp.employeeUserId}`)!
      const empNonConn = extractNonConnectorTokens(emp.fullName)
      const empSigTokens = empNonConn.filter(
        (t) => t.length >= 3 && !GENERIC_ROLE_TOKENS.has(t)
      )
      const empFirst = empNonConn[0] || ''

      let empTotalPunchDays = 0
      for (const d of emp.days || []) {
        const dKey = String(d?.date || '').slice(0, 10)
        if (!dKey) continue
        if (
          d.clockInTime ||
          d.clockOutTime ||
          Number(d.totalHours || 0) > 0 ||
          (Array.isArray(d.punches) && d.punches.length > 0)
        ) {
          empTotalPunchDays++
        }
      }
      empPunchDaysByUserId.set(emp.employeeUserId, empTotalPunchDays)

      for (const cand of initialUnclaimed) {
        const rawToast = ctx.toastById.get(cand.id)
        const candGuids = Array.from(
          new Set(
            [cand.toast_guid, rawToast?.v2_toast_guid].filter((g): g is string => Boolean(g))
          )
        )
        const candPrimaryNonConn = extractNonConnectorTokens(
          `${cand.first_name || ''} ${cand.last_name || ''}`
        )
        const candFullNonConn = extractNonConnectorTokens(cand.full_name)
        const candChosenNonConn = rawToast?.chosen_name
          ? extractNonConnectorTokens(`${rawToast.chosen_name} ${cand.last_name || ''}`)
          : []
        const candTokenLists = [
          candPrimaryNonConn,
          candFullNonConn,
          candChosenNonConn,
        ].filter((arr) => arr.length > 0)

        const candSigSet = new Set<string>()
        for (const arr of candTokenLists) {
          for (const t of arr) {
            if (t.length >= 3 && !GENERIC_ROLE_TOKENS.has(t)) candSigSet.add(t)
          }
        }
        const candSigTokens = Array.from(candSigSet)

        const directFirstTokenMatch =
          empFirst.length >= 3 &&
          !GENERIC_ROLE_TOKENS.has(empFirst) &&
          candTokenLists.some((arr) => arr[0] === empFirst)

        const initialSecondMatch =
          empNonConn.length >= 2 &&
          empNonConn[1].length >= 3 &&
          !GENERIC_ROLE_TOKENS.has(empNonConn[1]) &&
          candTokenLists.some(
            (arr) =>
              arr.length >= 2 &&
              arr[0][0] === empNonConn[0][0] &&
              (arr[1] === empNonConn[1] ||
                (arr[1].length >= 5 &&
                  empNonConn[1].length >= 5 &&
                  arr[1][0] === empNonConn[1][0] &&
                  levenshteinDistance(arr[1], empNonConn[1]) <= 2))
          )

        const firstTokenMatch = directFirstTokenMatch || initialSecondMatch
        const exactTokenHits = empSigTokens.filter((t) => candSigSet.has(t)).length
        const fuzzyTokenHits = empSigTokens.filter(
          (t1) =>
            t1.length >= 5 &&
            !candSigSet.has(t1) &&
            candSigTokens.some(
              (t2) =>
                t2.length >= 5 && t1[0] === t2[0] && levenshteinDistance(t1, t2) <= 2
            )
        ).length

        const rawEmail = String(cand.email || rawToast?.email || '')
          .trim()
          .toLowerCase()
        const emailLocalClean = rawEmail.includes('@')
          ? rawEmail.split('@')[0].replace(/[^a-z0-9]/g, '')
          : ''
        const emailTokenHits =
          emailLocalClean.length >= 3
            ? Array.from(new Set(empSigTokens)).filter((t) => emailLocalClean.includes(t))
                .length
            : 0

        const sim = Math.max(
          calculateNameSimilarity(emp.fullName, cand.full_name),
          calculateNameSimilarity(
            emp.fullName,
            `${cand.first_name || ''} ${cand.last_name || ''}`.trim()
          ),
          rawToast?.chosen_name
            ? calculateNameSimilarity(
                emp.fullName,
                `${rawToast.chosen_name} ${cand.last_name || ''}`.trim()
              )
            : 0
        )

        let matchingPunchDaysCount = 0
        let dualPunchDaysCount = 0
        let conflictingPunchDaysCount = 0

        for (const d of emp.days || []) {
          const dKey = String(d?.date || '').slice(0, 10)
          if (!dKey) continue
          const ronosInMin = toBusinessDayMinutes(parseTimeInLA(d.clockInTime, dKey))
          if (ronosInMin === null) continue
          const ronosOutMin = toBusinessDayMinutes(parseTimeInLA(d.clockOutTime, dKey))
          const ronosLunchRaw =
            d.lunchStartTime ||
            (Array.isArray((d as any).mealBreaks) && (d as any).mealBreaks[0]?.startTime) ||
            null
          const ronosLunchMin = toBusinessDayMinutes(parseTimeInLA(ronosLunchRaw, dKey))

          const dayToastPunches: ToastPunchRecordInput[] = []
          for (const g of candGuids) {
            const tList =
              ctx.punchesByStoreDateGuid.get(`${storeExtId}::${dKey}::${g}`) || []
            dayToastPunches.push(...tList)
          }
          if (dayToastPunches.length === 0) continue

          let dayInMatched = false
          let dayDualMatched = false
          let minInDiff = Infinity

          for (const tp of dayToastPunches) {
            const toastInMin = toBusinessDayMinutes(
              parseTimeInLA(tp.clock_in || tp.in_date || tp.clockInTime, dKey)
            )
            const toastOutMin = toBusinessDayMinutes(
              parseTimeInLA(tp.clock_out || tp.out_date || tp.clockOutTime, dKey)
            )
            let toastLunchMin: number | null = null
            if (Array.isArray(tp.breaks)) {
              const unpaidBreak = tp.breaks.find((b) => b && b.paid !== true && b.inDate)
              if (unpaidBreak?.inDate) {
                toastLunchMin = toBusinessDayMinutes(
                  parseTimeInLA(unpaidBreak.inDate, dKey)
                )
              }
            }

            if (toastInMin !== null) {
              const inDiff = Math.abs(ronosInMin - toastInMin)
              if (inDiff < minInDiff) minInDiff = inDiff
              if (inDiff <= 5) {
                dayInMatched = true
                const outMatched =
                  ronosOutMin !== null &&
                  toastOutMin !== null &&
                  (Math.abs(ronosOutMin - toastOutMin) <= 10 ||
                    (toastOutMin >= 1790 &&
                      toastOutMin <= 1805 &&
                      ronosOutMin < toastOutMin))
                const lunchMatched =
                  ronosLunchMin !== null &&
                  toastLunchMin !== null &&
                  Math.abs(ronosLunchMin - toastLunchMin) <= 5
                if (outMatched || lunchMatched) {
                  dayDualMatched = true
                }
              }
            }
          }

          if (dayInMatched) {
            matchingPunchDaysCount++
            if (dayDualMatched) dualPunchDaysCount++
          } else if (minInDiff < Infinity && minInDiff > 30) {
            conflictingPunchDaysCount++
          }
        }

        const isLevelC1 = emailTokenHits >= 2 && conflictingPunchDaysCount === 0
        const isLevelC2 =
          matchingPunchDaysCount >= 1 &&
          (dualPunchDaysCount >= 1 || matchingPunchDaysCount >= 1) &&
          (firstTokenMatch ||
            initialSecondMatch ||
            exactTokenHits >= 1 ||
            fuzzyTokenHits >= 1 ||
            emailTokenHits >= 1 ||
            sim >= 50)

        if (isLevelC1 || isLevelC2) {
          const score =
            dualPunchDaysCount * 100 +
            matchingPunchDaysCount * 40 +
            (firstTokenMatch ? 30 : 0) +
            emailTokenHits * 25 +
            exactTokenHits * 15 +
            fuzzyTokenHits * 15 +
            sim
          candidateEdges.push({ emp, meta, cand, score })
        }
      }
    }

    // Candado bipartite 1-a-1 obligatorio para Nivel C1 y Nivel C2 (ganador mutuo único sin empate)
    while (candidateEdges.length > 0) {
      const cIds = claimedIdsByCompany.get(companyId) || new Set<string>()
      const cGuids = claimedGuidsByCompany.get(companyId) || new Set<string>()
      const activeEdges = candidateEdges.filter(
        (e) =>
          !e.meta.toastEmployeeId &&
          !cIds.has(e.cand.id) &&
          (!e.cand.toast_guid || !cGuids.has(e.cand.toast_guid))
      )
      if (activeEdges.length === 0) break

      const bestByEmp = new Map<number, { maxScore: number; count: number }>()
      const bestByCand = new Map<string, { maxScore: number; count: number }>()

      for (const e of activeEdges) {
        const curEmp = bestByEmp.get(e.emp.employeeUserId)
        if (!curEmp || e.score > curEmp.maxScore) {
          bestByEmp.set(e.emp.employeeUserId, { maxScore: e.score, count: 1 })
        } else if (e.score === curEmp.maxScore) {
          curEmp.count++
        }

        const curCand = bestByCand.get(e.cand.id)
        if (!curCand || e.score > curCand.maxScore) {
          bestByCand.set(e.cand.id, { maxScore: e.score, count: 1 })
        } else if (e.score === curCand.maxScore) {
          curCand.count++
        }
      }

      const mutualWinners = activeEdges
        .filter((e) => {
          const bEmp = bestByEmp.get(e.emp.employeeUserId)
          const bCand = bestByCand.get(e.cand.id)
          return (
            bEmp &&
            bCand &&
            bEmp.maxScore === e.score &&
            bEmp.count === 1 &&
            bCand.maxScore === e.score &&
            bCand.count === 1
          )
        })
        .sort((a, b) => b.score - a.score)

      if (mutualWinners.length === 0) break

      for (const win of mutualWinners) {
        if (win.meta.toastEmployeeId) continue
        const curIds = claimedIdsByCompany.get(companyId) || new Set<string>()
        const curGuids = claimedGuidsByCompany.get(companyId) || new Set<string>()
        if (
          curIds.has(win.cand.id) ||
          (win.cand.toast_guid && curGuids.has(win.cand.toast_guid))
        ) {
          continue
        }
        assignCandidateToMeta(win.emp, companyId, win.meta, win.cand)
      }
    }

    // Nivel C3 (Singleton de Gerente / Turno sin ponchadas de reloj o candidato corporativo sin ponchadas Toast)
    const remUnmatchedEmps = getUnmatchedEmps()
    const remUnclaimedCands = getUnclaimedCands()
    if (remUnmatchedEmps.length > 0 && remUnclaimedCands.length > 0) {
      for (const emp of remUnmatchedEmps) {
        const empFirst = extractNonConnectorTokens(emp.fullName)[0] || ''
        if (empFirst.length < 4 || GENERIC_ROLE_TOKENS.has(empFirst)) continue

        const sameFirstEmps = remUnmatchedEmps.filter(
          (e2) => (extractNonConnectorTokens(e2.fullName)[0] || '') === empFirst
        )
        if (sameFirstEmps.length > 1) {
          const activeSameFirst = sameFirstEmps.filter(
            (e2) => (empPunchDaysByUserId.get(e2.employeeUserId) || 0) > 0
          )
          if (activeSameFirst.length !== 1 || activeSameFirst[0].employeeUserId !== emp.employeeUserId) {
            continue
          }
        }

        const activeMatchingCands = remUnclaimedCands.filter((cand) => {
          const rawToast = ctx.toastById.get(cand.id)
          const candGuids = Array.from(
            new Set([cand.toast_guid, rawToast?.v2_toast_guid].filter((g): g is string => Boolean(g)))
          )
          const cFirsts = new Set(
            [
              extractNonConnectorTokens(`${cand.first_name || ''} ${cand.last_name || ''}`)[0],
              extractNonConnectorTokens(cand.full_name)[0],
              rawToast?.chosen_name ? extractNonConnectorTokens(rawToast.chosen_name)[0] : '',
            ].filter(Boolean)
          )
          if (!cFirsts.has(empFirst)) return false
          const email = String(cand.email || rawToast?.email || '').trim().toLowerCase()
          const isCorpEmail = email.endsWith('@tacosgavilan.com')
          const hasShifts = periodDates.some((pDate) => {
            const dayShifts = ctx.shiftsByStoreAndDate.get(`${storeExtId}::${pDate}`) || []
            return dayShifts.some((s) => String(s.employee_id) === cand.id)
          })
          if (!isCorpEmail && !hasShifts) return false

          const empHasPunches = (empPunchDaysByUserId.get(emp.employeeUserId) || 0) > 0
          if (!empHasPunches || isCorpEmail) return true

          const candHasToastPunches = periodDates.some((pDate) =>
            candGuids.some(
              (g) => (ctx.punchesByStoreDateGuid.get(`${storeExtId}::${pDate}::${g}`) || []).length > 0
            )
          )
          return !candHasToastPunches
        })

        if (activeMatchingCands.length === 1) {
          const meta = resolvedMetaByCompanyEmp.get(`${companyId}::${emp.employeeUserId}`)!
          assignCandidateToMeta(emp, companyId, meta, activeMatchingCands[0])
        }
      }
    }
  }
}

/**
 * Enriquece un `RonosStoreAuditSummary` (individual o consolidado `companyId === 0`)
 * con los turnos publicados del Planificador (`shifts`), ponchadas Toast POS (`punches`),
 * exención de asalariados (`simplify_employee_rates`) y evaluación NHP (`lib/ronos-attendance-policy.ts`).
 *
 * Si se indica `targetDateOnly`, prioriza/limita la evaluación detallada a esa fecha (ideal para cron diario
 * o validación de `/api/ronos/notify-violation`).
 */
export async function enrichStoreAuditWithNhpPolicy(
  storeAudit: RonosStoreAuditSummary,
  options?: {
    targetDateOnly?: string
    asOfDate?: Date
  }
): Promise<{
  enrichedAudit: EnrichedRonosStoreAuditSummary
  evaluationsByEmployeeDate: Map<string, RonosDayAttendanceEvaluation>
  resolvedMetaByEmployee: Map<number, ResolvedEmployeeMeta>
  storesByCompanyId: Map<number, StoreIdentityRow>
  registeredCorporateEmails: Set<string>
  allUsers: any[]
}> {
  const startDate =
    options?.targetDateOnly?.slice(0, 10) ||
    String(storeAudit.startDate || '').slice(0, 10) ||
    getPacificBusinessDate()
  const rawEndDate =
    options?.targetDateOnly?.slice(0, 10) ||
    String(storeAudit.endDate || '').slice(0, 10)
  const endDate =
    rawEndDate && /^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)
      ? rawEndDate
      : addDaysIso(startDate, 6)
  const auditWeekStart = String(storeAudit.startDate || '').slice(0, 10)
  const auditWeekEnd = String(storeAudit.endDate || '').slice(0, 10)
  const contextStartDate =
    auditWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(auditWeekStart) && auditWeekStart < startDate
      ? auditWeekStart
      : startDate
  const contextEndDate =
    auditWeekEnd && /^\d{4}-\d{2}-\d{2}$/.test(auditWeekEnd) && auditWeekEnd > endDate
      ? auditWeekEnd
      : endDate
  const historyStartDate = addDaysIso(contextStartDate, -10)

  const employees = Array.isArray(storeAudit.employees) ? storeAudit.employees : []
  const companyIds = Array.from(
    new Set(
      [
        storeAudit.ronosCompanyId,
        ...employees.map((e: any) => Number(e.companyId || storeAudit.ronosCompanyId)),
      ].filter((id) => Number.isFinite(id) && id > 0)
    )
  )

  const ctx = await loadCrossRefContext({
    companyIds,
    startDate: contextStartDate,
    endDate: contextEndDate,
    historyStartDate,
  })

  // 1. Pasada 1 (Nativa): Resolver metadata con mapeos guardados y `resolveNativeAutoMatch`
  const resolvedMetaByEmployee = new Map<number, ResolvedEmployeeMeta>()
  const resolvedMetaByCompanyEmp = new Map<string, ResolvedEmployeeMeta>()
  for (const emp of employees) {
    const empCompanyId = Number((emp as any).companyId || storeAudit.ronosCompanyId)
    const storeRow = ctx.storesByCompanyId.get(empCompanyId)
    const resolvedMeta = resolveEmployeeMetadata(emp, empCompanyId, storeRow, ctx)
    resolvedMetaByCompanyEmp.set(`${empCompanyId}::${emp.employeeUserId}`, resolvedMeta)
    if (!resolvedMetaByEmployee.has(emp.employeeUserId)) {
      resolvedMetaByEmployee.set(emp.employeeUserId, resolvedMeta)
    }
  }

  // 1b. Pasada 2 (En Memoria): Cruce operativo por misma tienda + huella de horario/ponchada
  applySecondPassStoreOperationalMatching({
    employees,
    defaultCompanyId: storeAudit.ronosCompanyId,
    contextStartDate,
    contextEndDate,
    ctx,
    resolvedMetaByCompanyEmp,
    resolvedMetaByEmployee,
  })

  // 2. Calcular contexto de brecha de cobertura por (companyId, businessDate)
  const coverageContextCache = new Map<string, StoreDayCoverageContext>()
  const getCoverageContext = (companyId: number, businessDate: string): StoreDayCoverageContext => {
    const cacheKey = `${companyId}::${businessDate}`
    if (coverageContextCache.has(cacheKey)) {
      return coverageContextCache.get(cacheKey)!
    }

    const storeRow = ctx.storesByCompanyId.get(companyId)
    if (!storeRow?.external_id) {
      const empty: StoreDayCoverageContext = {
        hasStoreCoverageGap: false,
        absentOrLateCoworkersCount: 0,
        coworkerDetails: [],
      }
      coverageContextCache.set(cacheKey, empty)
      return empty
    }

    const allPublishedShifts =
      ctx.shiftsByStoreAndDate.get(`${storeRow.external_id}::${businessDate}`) || []

    const storeEmployees = employees.filter(
      (e: any) => Number(e.companyId || storeAudit.ronosCompanyId) === companyId
    )
    const salariedToastIds = new Set<string>()
    const employeeEvaluationsOrPunches: Array<{
      toastEmployeeId?: string | null
      clockInTime?: string | null
      isSick?: boolean | null
      isVacation?: boolean | null
    }> = []

    for (const e of storeEmployees) {
      const meta =
        resolvedMetaByCompanyEmp.get(`${companyId}::${e.employeeUserId}`) ||
        resolvedMetaByEmployee.get(e.employeeUserId)
      if (!meta || meta.isInactiveMapping || !meta.toastEmployeeId) continue
      if (meta.isSalaried) {
        salariedToastIds.add(String(meta.toastEmployeeId))
        continue
      }

      const dayRec = (e.days || []).find(
        (d) => String(d?.date || '').slice(0, 10) === businessDate
      )
      const toastPunches = getToastPunchesForEmployeeDate(meta, storeRow.external_id, businessDate, ctx)
      const firstToastIn =
        toastPunches
          .map((tp) => tp.clock_in || tp.in_date || tp.clockInTime)
          .find(Boolean) || null
      const scEntry = getScheduleEntryForEmployeeDate(meta, storeRow.id, businessDate, ctx)
      const scLabelUpper = String(scEntry?.shift_label || '').toUpperCase()

      employeeEvaluationsOrPunches.push({
        toastEmployeeId: meta.toastEmployeeId,
        clockInTime: dayRec?.clockInTime || firstToastIn || null,
        isSick: Boolean(dayRec?.isSick) || Number(dayRec?.sickHours || 0) > 0 || scLabelUpper === 'SICK',
        isVacation:
          Boolean(dayRec?.isVacation) ||
          Number(dayRec?.vacationHours || 0) > 0 ||
          scLabelUpper === 'VAC',
      })
    }

    const publishedShifts = allPublishedShifts.filter(
      (sh) => !sh.employee_id || !salariedToastIds.has(String(sh.employee_id))
    )

    const gapCtx = detectStoreDayCoverageGap({
      businessDate,
      publishedShifts,
      employeeEvaluationsOrPunches,
    })
    coverageContextCache.set(cacheKey, gapCtx)
    return gapCtx
  }

  // 2b. Calcular contexto de ventas horarias (StoreDayHourlySalesContext) y cohorte de salidas tempranas por (companyId, businessDate)
  const salesContextCache = new Map<string, StoreDayHourlySalesContext | null>()
  const getSalesContext = (
    companyId: number,
    businessDate: string
  ): StoreDayHourlySalesContext | null => {
    const cacheKey = `${companyId}::${businessDate}`
    if (salesContextCache.has(cacheKey)) {
      return salesContextCache.get(cacheKey)!
    }
    const storeRow = ctx.storesByCompanyId.get(companyId)
    if (!storeRow?.external_id) {
      salesContextCache.set(cacheKey, null)
      return null
    }
    const storeKey = storeRow.external_id.trim().toLowerCase()
    const curRow = ctx.salesCacheByStoreAndDate.get(`${storeKey}::${businessDate}`) || null
    const priorRows = [-7, -14, -21, -28]
      .map((off) => ctx.salesCacheByStoreAndDate.get(`${storeKey}::${addDaysIso(businessDate, off)}`))
      .filter((r) => Boolean(r) && Number(r.net_sales || 0) > 0)

    if (!curRow && priorRows.length === 0) {
      salesContextCache.set(cacheKey, null)
      return null
    }

    const dailyNetSales =
      curRow && Number(curRow.net_sales || 0) > 0 ? Number(curRow.net_sales) : null
    const avgDailyNetSales4Weeks =
      priorRows.length > 0
        ? Number(
            (
              priorRows.reduce((acc, r) => acc + Number(r.net_sales || 0), 0) / priorRows.length
            ).toFixed(2)
          )
        : null
    const dailySalesRatio =
      dailyNetSales !== null && avgDailyNetSales4Weeks !== null && avgDailyNetSales4Weeks > 0
        ? Number((dailyNetSales / avgDailyNetSales4Weeks).toFixed(4))
        : null

    const salesByHour: Record<number, number> = {}
    const avgSalesByHour: Record<number, number> = {}
    const ticketsByHour: Record<number, number> = {}
    const laborPctByHour: Record<number, number> = {}

    for (let h = 0; h < 24; h++) {
      const hKey = String(h)
      if (curRow?.hourly_data && (curRow.hourly_data[h] !== undefined || curRow.hourly_data[hKey] !== undefined)) {
        const sVal = Number(curRow.hourly_data[h] ?? curRow.hourly_data[hKey] ?? 0)
        salesByHour[h] = sVal
        if (
          sVal > 0 &&
          curRow?.hourly_labor &&
          (curRow.hourly_labor[h] !== undefined || curRow.hourly_labor[hKey] !== undefined)
        ) {
          const lCost = Number(curRow.hourly_labor[h] ?? curRow.hourly_labor[hKey] ?? 0)
          laborPctByHour[h] = Number(((lCost / sVal) * 100).toFixed(2))
        }
      }
      if (
        curRow?.hourly_tickets &&
        (curRow.hourly_tickets[h] !== undefined || curRow.hourly_tickets[hKey] !== undefined)
      ) {
        ticketsByHour[h] = Number(curRow.hourly_tickets[h] ?? curRow.hourly_tickets[hKey] ?? 0)
      }
      const pHourVals = priorRows
        .filter(
          (r) =>
            r?.hourly_data && (r.hourly_data[h] !== undefined || r.hourly_data[hKey] !== undefined)
        )
        .map((r) => Number(r.hourly_data[h] ?? r.hourly_data[hKey] ?? 0))
      if (pHourVals.length > 0) {
        avgSalesByHour[h] = Number(
          (pHourVals.reduce((a, b) => a + b, 0) / pHourVals.length).toFixed(2)
        )
      }
    }

    const salesCtx: StoreDayHourlySalesContext = {
      businessDate,
      dailyNetSales,
      netSales: dailyNetSales,
      avgDailyNetSales4Weeks,
      avgDailyNetSales: avgDailyNetSales4Weeks,
      dailySalesRatio,
      salesByHour,
      avgSalesByHour,
      ticketsByHour,
      laborPctByHour,
    }
    salesContextCache.set(cacheKey, salesCtx)
    return salesCtx
  }

  const earlyOutCohortCache = new Map<string, number>()
  const getEarlyOutCohortCount = (companyId: number, businessDate: string): number => {
    const cacheKey = `${companyId}::${businessDate}`
    if (earlyOutCohortCache.has(cacheKey)) {
      return earlyOutCohortCache.get(cacheKey)!
    }
    const storeRow = ctx.storesByCompanyId.get(companyId)
    if (!storeRow?.external_id) {
      earlyOutCohortCache.set(cacheKey, 0)
      return 0
    }
    const storeEmployees = employees.filter(
      (e: any) => Number(e.companyId || storeAudit.ronosCompanyId) === companyId
    )
    let count = 0
    for (const e of storeEmployees) {
      const m =
        resolvedMetaByCompanyEmp.get(`${companyId}::${e.employeeUserId}`) ||
        resolvedMetaByEmployee.get(e.employeeUserId)
      if (!m || m.isInactiveMapping || m.isSalaried || !m.toastEmployeeId) continue
      const dayRec = (e.days || []).find(
        (d) => String(d?.date || '').slice(0, 10) === businessDate
      )
      if (!dayRec?.clockInTime || !dayRec?.clockOutTime) continue
      const shifts = getPlannerShiftsForEmployeeDate(m, storeRow.external_id, businessDate, ctx)
      const shiftSum = summarizePlannerShiftForDay(shifts, businessDate)
      if (!shiftSum.hasPublishedShift || !shiftSum.startTimeIso || !shiftSum.endTimeIso) continue
      const sStartP = parseTimeInLA(shiftSum.startTimeIso, businessDate)
      const sEndP = parseTimeInLA(shiftSum.endTimeIso, businessDate)
      const rOutP = parseTimeInLA(dayRec.clockOutTime, businessDate)
      if (!sStartP || !sEndP || !rOutP) continue
      if (sStartP.minuteOfDay === sEndP.minuteOfDay) continue
      let schedEndMin = sEndP.relativeMinutesFromBizDate
      if (schedEndMin < sStartP.relativeMinutesFromBizDate) schedEndMin += 1440
      let actualOutMin = rOutP.relativeMinutesFromBizDate
      if (actualOutMin < sStartP.relativeMinutesFromBizDate - 120) actualOutMin += 1440
      const endDiff = actualOutMin - schedEndMin
      if (endDiff <= -15) {
        const tPunches = getToastPunchesForEmployeeDate(m, storeRow.external_id, businessDate, ctx)
        const tSum = summarizeToastPunchesForDay(tPunches, businessDate)
        let toastMuchLater = false
        if (tSum.hasToastPunches && tSum.clockOutTime && !tSum.isAutoClockOut) {
          const tOutP = parseTimeInLA(tSum.clockOutTime, businessDate)
          if (tOutP) {
            let tOutMin = tOutP.relativeMinutesFromBizDate
            if (tOutMin < sStartP.relativeMinutesFromBizDate - 120) tOutMin += 1440
            if (tOutMin - actualOutMin >= 15) toastMuchLater = true
          }
        }
        if (!toastMuchLater) count++
      }
    }
    earlyOutCohortCache.set(cacheKey, count)
    return count
  }

  // 3. Evaluar cada colaborador y enriquecer sus días
  const asOfDate = options?.asOfDate || new Date()
  const nowPacificBusinessDate = getPacificBusinessDate(asOfDate)

  const evaluationsByEmployeeDate = new Map<string, RonosDayAttendanceEvaluation>()
  const storeMetrics: StoreNhpAuditSummary = {
    startDate,
    endDate,
    evaluatedDaysCount: 0,
    totalViolations: 0,
    punctualityViolations: 0,
    repairViolations: 0,
    mealViolations: 0,
    noShowCount: 0,
    medicalNoteAlertsCount: 0,
    authorizedEarlyCallIns: 0,
    authorizedEarlyOuts: 0,
    voluntaryExtendedStays: 0,
    exemptSalariedCount: 0,
  }

  const enrichedEmployees: EnrichedRonosEmployeeTimecard[] = employees.map((emp) => {
    const empCompanyId = Number((emp as any).companyId || storeAudit.ronosCompanyId)
    const storeRow = ctx.storesByCompanyId.get(empCompanyId)
    const meta =
      resolvedMetaByCompanyEmp.get(`${empCompanyId}::${emp.employeeUserId}`) ||
      resolvedMetaByEmployee.get(emp.employeeUserId)!

    if (meta.isSalaried) {
      storeMetrics.exemptSalariedCount++
    }

    const empDaysMap = new Map<string, RonosDailyPunchesRecord>()
    for (const d of emp.days || []) {
      const dKey = String(d?.date || '').slice(0, 10)
      if (dKey) empDaysMap.set(dKey, d)
    }

    // Asegurar evaluación en fechas donde tenga turno publicado o ponchada en Toast aunque RONOS `days` venga vacío
    const datesToEvaluate = new Set<string>()
    if (options?.targetDateOnly) {
      const tDate = options.targetDateOnly.slice(0, 10)
      const hasRonosDay = empDaysMap.has(tDate)
      const hasShifts =
        getPlannerShiftsForEmployeeDate(meta, storeRow?.external_id, tDate, ctx).length > 0
      const hasToast =
        getToastPunchesForEmployeeDate(meta, storeRow?.external_id, tDate, ctx).length > 0
      const hasSchedule = Boolean(getScheduleEntryForEmployeeDate(meta, storeRow?.id, tDate, ctx))
      if (hasRonosDay || hasShifts || hasToast || hasSchedule) {
        datesToEvaluate.add(tDate)
        if (!hasRonosDay && !meta.isInactiveMapping) {
          empDaysMap.set(tDate, buildEmptyRonosDayStub(tDate))
        }
      }
    } else {
      for (const dKey of empDaysMap.keys()) {
        datesToEvaluate.add(dKey)
      }
      if (storeRow?.external_id && !meta.isInactiveMapping) {
        // Revisar fechas dentro de [startDate..endDate] con turnos o ponchadas Toast sin tarjeta en RONOS
        let cursor = startDate
        let guard = 0
        while (cursor <= endDate && guard < 15) {
          guard++
          if (!empDaysMap.has(cursor)) {
            const hasShifts =
              getPlannerShiftsForEmployeeDate(meta, storeRow.external_id, cursor, ctx).length > 0
            const hasToast =
              getToastPunchesForEmployeeDate(meta, storeRow.external_id, cursor, ctx).length > 0
            if (hasShifts || hasToast) {
              datesToEvaluate.add(cursor)
              empDaysMap.set(cursor, buildEmptyRonosDayStub(cursor))
            }
          }
          cursor = addDaysIso(cursor, 1)
        }
      }
    }

    const empNhpSummary: EmployeeNhpSummary = {
      isExemptSalaried: meta.isSalaried,
      salariedExemptionReason: meta.salariedReason,
      punctualityViolationsCount: 0,
      repairViolationsCount: 0,
      mealViolationsCount: 0,
      noShowCount: 0,
      medicalNoteAlertsCount: 0,
      authorizedEarlyCallInsCount: 0,
      authorizedEarlyOutsCount: 0,
      voluntaryExtendedStaysCount: 0,
      totalActiveViolationsCount: 0,
    }

    const sortedDateKeys = Array.from(empDaysMap.keys()).sort()
    const enrichedDays: EnrichedRonosDailyRecord[] = []

    for (const dKey of sortedDateKeys) {
      const rawDay = empDaysMap.get(dKey) || buildEmptyRonosDayStub(dKey)
      if (meta.isInactiveMapping || !datesToEvaluate.has(dKey)) {
        enrichedDays.push({
          ...rawDay,
          violations: meta.isSalaried ? [] : rawDay.violations || [],
        })
        continue
      }

      const scheduledShifts = getPlannerShiftsForEmployeeDate(
        meta,
        storeRow?.external_id,
        dKey,
        ctx
      )
      const toastPunches = getToastPunchesForEmployeeDate(meta, storeRow?.external_id, dKey, ctx)

      // Fechas futuras respecto al día laboral vigente: mostrar horario programado sin generar infracciones ni NO_SHOW
      if (dKey > nowPacificBusinessDate) {
        const futureShift = summarizePlannerShiftForDay(scheduledShifts, dKey)
        const futureToast = summarizeToastPunchesForDay(toastPunches, dKey)
        const futureEval: RonosDayAttendanceEvaluation = {
          businessDate: dKey,
          isExemptSalaried: meta.isSalaried,
          salariedExemptionReason: meta.isSalaried ? meta.salariedReason : null,
          punctualityStatus: meta.isSalaried ? 'EXEMPT_SALARIED' : 'NO_SHIFT_NO_PUNCH',
          punctualityLabelEs: meta.isSalaried
            ? 'Exento (Manager / Supervisor)'
            : futureShift.hasPublishedShift
              ? 'Turno Programado (Próximo)'
              : 'Descanso / Sin Turno',
          punctualityLabelEn: meta.isSalaried
            ? 'Exempt (Salaried Manager / Supervisor)'
            : futureShift.hasPublishedShift
              ? 'Scheduled Shift (Upcoming)'
              : 'Off / No Shift',
          punctualityBadgeColor: 'slate',
          diffMinutesFromSchedule: null,
          endDiffMinutesFromSchedule: null,
          isViolation: false,
          isAuthorizedEarlyCallIn: false,
          exemptionReason: meta.isSalaried ? meta.salariedReason : null,
          earlyCallInSignals: [],
          hasToastRonosDiscrepancy: false,
          discrepancyDetails: [],
          requiresMedicalNote: false,
          consecutiveSickDays: 0,
          scheduledShift: futureShift,
          toastSummary: futureToast,
          ronosSummary: {
            hasRonosPunches: false,
            clockInTime: null,
            clockOutTime: null,
            clockInLA: null,
            clockOutLA: null,
            lunchStartTime: null,
            lunchEndTime: null,
            lunchStartLA: null,
            lunchEndLA: null,
            lunchDurationMinutes: 0,
            totalHours: 0,
            clockInAddedPunch: false,
            clockOutAddedPunch: false,
            isSick: Boolean(rawDay.isSick),
            isVacation: Boolean(rawDay.isVacation),
            isHoliday: Boolean(rawDay.isHoliday),
          },
          violations: [],
        }
        enrichedDays.push({
          ...rawDay,
          scheduledShift: futureShift,
          toastSummary: futureToast,
          nhpEvaluation: futureEval,
          violations: [],
        })
        continue
      }

      const scheduleEntry = getScheduleEntryForEmployeeDate(meta, storeRow?.id, dKey, ctx)
      const coverageCtx = getCoverageContext(empCompanyId, dKey)
      const salesCtx = getSalesContext(empCompanyId, dKey)
      const earlyOutCohortCount = getEarlyOutCohortCount(empCompanyId, dKey)
      const historyDays = buildSickHistoryDays(emp.days || [], meta, storeRow, dKey, ctx)

      const hasOpenClockInToday =
        dKey === nowPacificBusinessDate &&
        Boolean(rawDay.clockInTime) &&
        !rawDay.clockOutTime

      const evalResult = evaluateEmployeeDayAttendancePolicy({
        businessDate: dKey,
        employeeUserId: emp.employeeUserId,
        fullName: emp.fullName,
        jobTitle: meta.jobTitle,
        role: meta.userRole,
        isSalaried: meta.isSalaried,
        payType: meta.payType,
        payRate: meta.payRate,
        ronosDay: rawDay,
        scheduledShifts,
        toastPunches,
        storeCoverageContext: coverageCtx,
        storeSalesContext: salesCtx,
        earlyOutCohortCount,
        scheduleEntry,
        historyDays,
        isCurrentOpenShift: hasOpenClockInToday,
        asOfDate,
      })

      evaluationsByEmployeeDate.set(`${emp.employeeUserId}::${dKey}`, evalResult)
      storeMetrics.evaluatedDaysCount++

      if (evalResult.isAuthorizedEarlyCallIn) {
        empNhpSummary.authorizedEarlyCallInsCount++
        storeMetrics.authorizedEarlyCallIns++
      }
      if (evalResult.isAuthorizedVoluntaryEarlyOut) {
        empNhpSummary.authorizedEarlyOutsCount = (empNhpSummary.authorizedEarlyOutsCount || 0) + 1
        storeMetrics.authorizedEarlyOuts = (storeMetrics.authorizedEarlyOuts || 0) + 1
      }
      if (evalResult.isVoluntaryExtendedStay) {
        empNhpSummary.voluntaryExtendedStaysCount =
          (empNhpSummary.voluntaryExtendedStaysCount || 0) + 1
        storeMetrics.voluntaryExtendedStays = (storeMetrics.voluntaryExtendedStays || 0) + 1
      }

      for (const v of evalResult.violations) {
        if (!v.isViolation) continue
        empNhpSummary.totalActiveViolationsCount++
        storeMetrics.totalViolations++
        if (v.type === 'NO_SHOW') {
          empNhpSummary.noShowCount++
          storeMetrics.noShowCount++
          empNhpSummary.punctualityViolationsCount++
          storeMetrics.punctualityViolations++
        } else if (v.type === 'MEDICAL_NOTE_REQUIRED') {
          empNhpSummary.medicalNoteAlertsCount++
          storeMetrics.medicalNoteAlertsCount++
          empNhpSummary.punctualityViolationsCount++
          storeMetrics.punctualityViolations++
        } else if (v.category === 'punctuality' || v.category === 'attendance') {
          empNhpSummary.punctualityViolationsCount++
          storeMetrics.punctualityViolations++
        } else if (v.category === 'timecard_repair') {
          empNhpSummary.repairViolationsCount++
          storeMetrics.repairViolations++
        } else if (v.category === 'meal_rest') {
          empNhpSummary.mealViolationsCount++
          storeMetrics.mealViolations++
        }
      }

      enrichedDays.push({
        ...rawDay,
        scheduledShift: evalResult.scheduledShift,
        toastSummary: evalResult.toastSummary,
        nhpEvaluation: evalResult,
        violations: mergeDayViolations(
          rawDay.violations,
          evalResult.violations,
          evalResult.isExemptSalaried
        ),
      })
    }

    const totalMergedViolations = meta.isSalaried
      ? 0
      : enrichedDays.reduce((acc, d) => acc + (d.violations?.length || 0), 0)

    return {
      ...emp,
      jobTitle: meta.jobTitle || emp.jobTitle,
      isSalaried: meta.isSalaried,
      payType: meta.payType,
      payRate: meta.payRate || emp.payRate,
      toastEmployeeId: meta.toastEmployeeId ?? emp.toastEmployeeId ?? null,
      toastGuid: meta.toastGuid ?? emp.toastGuid ?? null,
      toastFullName: meta.toastFullName ?? emp.toastFullName ?? null,
      toastEmail: meta.toastEmail ?? emp.toastEmail ?? null,
      isInactiveMapping: meta.isInactiveMapping,
      userRole: meta.userRole,
      totalViolationsCount: Math.max(totalMergedViolations, empNhpSummary.totalActiveViolationsCount),
      nhpSummary: empNhpSummary,
      days: enrichedDays,
    }
  })

  return {
    enrichedAudit: {
      ...storeAudit,
      nhpAuditSummary: storeMetrics,
      employees: enrichedEmployees,
    },
    evaluationsByEmployeeDate,
    resolvedMetaByEmployee,
    storesByCompanyId: ctx.storesByCompanyId,
    registeredCorporateEmails: ctx.registeredCorporateEmails,
    allUsers: ctx.allUsers,
  }
}
