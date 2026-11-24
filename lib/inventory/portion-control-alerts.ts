/**
 * @module lib/inventory/portion-control-alerts
 * @description Motor central de Control de Porciones, Balance de Masas Telescópico (7 días / rango personalizado),
 *   aislamiento físico de turnos AM vs PM mediante Corte 5:00 PM (`meat_shift_handover_counts`),
 *   atribución exacta de Taqueros/Cocineros y Líderes en turno, y despacho institucional a la Escalera de Mando
 *   vía `sendSystemEmail` + notificaciones de campana (`public.notifications`).
 *
 * @businessRules
 *   - **Prioridad #1 Carne Asada (`009W`, bolsa 10 lb cruda = `$60.00` Tienda / `$50.00` Bodega, rendimiento `61.5%`)**:
 *     * Dispara alerta `warning` cuando el sobre-porcionado supera `> 5%` Y `>= 2 bolsas` / `$120+ USD` en ventana de 7d
 *       (o `>= 3.5%` con `>= 5 bolsas` / `$300+ USD` de pérdida real).
 *     * Dispara alerta `critical` cuando supera `> 10%` (con `>= 2 bolsas` / `$120+`), O cuando supera `> 5%` con `>= 5 bolsas` / `$300+ USD`,
 *       O cuando la sucursal tiene Food Cost `> 35%` con sobre-porcionado real (`> 3%` y `>= $120 USD`).
 *   - **Otras 7 proteínas activas (`Pastor`, `Pollo`, `Cabeza`, `Lengua`, `Chorizo 8 oz`, `Carnitas 6 oz`, `Buche 6 oz`)**:
 *     * Respetan el corte histórico de peso por bolsa del `2026-07-24` y disparan `warning` (`> 8%` y `>= $100 USD`)
 *       o `critical` (`> 15%` y `>= $200 USD`, o `>= $350 USD`, o Food Cost `> 35%` con `> 10%` y `>= $120 USD`).
 *   - **Ley de Conservación Telescópica y Rezago de Entrega (`D -> D+1`)**:
 *     * Excluye conteos virtuales (`counted_by = 'AUTO_CYCLE_V2'` / `notes ILIKE '%AUTO_CYCLE%'`) y sábados parciales (`dow === 6`).
 *     * `Arrived_Bags(t0, t1]` suma `COALESCE(final_qty, adjusted_qty, calculated_qty)` en `inventory_orders` (`status IN ('sent', 'received')`)
 *       con fecha `t0 <= order_date < t1` (semiabierto `[t0, t1)`).
 *     * `Actual_Bags = MAX(0, Count(t0) + Arrived_Bags(t0, t1] - Count(t1))`.
 *     * `Theoretical_Lbs` suma `meat_consumption_history.raw_lbs` en `t0 < business_date <= t1` (semiabierto `(t0, t1]`).
 *   - **Aislamiento AM (`06:00–16:59`) vs PM (`17:00–05:59`)**:
 *     * Si existe conteo físico de cambio de turno 5:00 PM (`meat_shift_handover_counts`), calcula libras físicas exactas de AM
 *       (`Count_Open + Entrega_Mañana - Conteo_5PM`) y de PM (`Conteo_5PM - Count_Close`).
 *     * Si aún no hay conteo 5:00 PM, pondera la exposición AM vs PM según `meat_consumption_history` y adjunta el personal real en turno.
 *   - **Escalera de Mando**:
 *     * `to`: Gerente (`manager`) + Asistentes (`asistente`) activos de la sucursal (normalizando `roque@ -> carlos@`).
 *     * `cc`: Supervisor Regional (`stores.supervisor_id -> users.email`) + Directiva Ejecutiva (`DEFAULT_LEADERSHIP_CC` + `bcc: carlos@`)
 *       cuando `severity === 'critical'` y (`dollar_loss_store >= 500` o reincidencia abierta en los últimos 14 días).
 *
 * @dataFlow
 *   `inventory_counts` + `inventory_orders` + `meat_consumption_history` + `meat_shift_handover_counts` + `punches`/`station_assignments`
 *   → `scanPortionControlAlerts()` → `public.portion_control_alerts` + `sendSystemEmail()` + `public.notifications`.
 *
 * @notes
 *   - Todas las lecturas masivas usan paginación explícita `.range(offset, offset + 999)` para evitar truncamiento de 1,000 filas en PostgREST.
 *   - Cero escritura en columnas autogeneradas de PostgreSQL (`428C9`).
 *   - Soporta `dryRun: true` y `testTo` restringido estrictamente a `@tacosgavilan.com`.
 *   - [2026-11-23] Deep-link completo en `actionUrl` (correo) y `notifications.link` (campana) incluyendo `store_id`, `startDate`, `endDate` y `meat` hacia `/admin/food-cost/meats`.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { sendSystemEmail } from '@/lib/system-mailer'
import { DEFAULT_LEADERSHIP_CC } from '@/lib/ronos-email'
import { resolveAppBaseUrl } from '@/lib/basecamp-todo-email'
import {
  ACTIVE_PROTEIN_IDS,
  MEAT_COOKING_YIELDS,
  MEAT_DEFAULT_BAG_LBS,
  type ActiveProteinKey,
} from '@/lib/inventory/meat-allocation'
import {
  addDaysIso,
  buildLAInstant,
  calculateSafeFoodCostPct,
  diffCalendarDays,
  formatSignedUSD,
  getBusinessDateLA,
  isInvalidFoodCostCacheRow,
  isValidIsoDate,
  resolveCachedFoodCostDollars,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  evaluatePmixItemsForProtein,
  loadToastMeatContext,
  type StoreDayProteinToastUsage,
} from '@/lib/inventory/toast-meat-sold-resolver'

export const CORPORATE_EMAIL_GUARD_REGEX = /^[a-z0-9._%+-]+@tacosgavilan\.com$/i
const BAG_CUTOVER_DATE_ISO = '2026-07-24'
const PAGE_SIZE = 1000

export interface MeatCatalogBenchmark {
  key: ActiveProteinKey
  inventoryItemId: string
  sku: string
  displayName: string
  historyMeatType: string
  defaultBagLbs: number
  preCutoverBagLbs: number
  defaultStoreBagCost: number
  defaultBodegaBagCost: number
  defaultYieldFactor: number
  priorityRank: number
}

export const MEAT_BENCHMARKS: readonly MeatCatalogBenchmark[] = [
  {
    key: 'asada',
    inventoryItemId: ACTIVE_PROTEIN_IDS.asada,
    sku: '009W',
    displayName: 'Carne Asada',
    historyMeatType: 'ASADA',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.asada, // 10 lb
    preCutoverBagLbs: 10,
    defaultStoreBagCost: 60.0,
    defaultBodegaBagCost: 50.0,
    defaultYieldFactor: MEAT_COOKING_YIELDS.asada, // 0.615
    priorityRank: 1,
  },
  {
    key: 'cabeza',
    inventoryItemId: ACTIVE_PROTEIN_IDS.cabeza,
    sku: '011W',
    displayName: 'Cabeza',
    historyMeatType: 'CABEZA',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.cabeza, // 2.5 lb
    preCutoverBagLbs: 5,
    defaultStoreBagCost: 19.92,
    defaultBodegaBagCost: 16.6,
    defaultYieldFactor: MEAT_COOKING_YIELDS.cabeza, // 0.87
    priorityRank: 2,
  },
  {
    key: 'pastor',
    inventoryItemId: ACTIVE_PROTEIN_IDS.pastor,
    sku: '010W',
    displayName: 'Pastor',
    historyMeatType: 'PASTOR',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.pastor, // 5 lb
    preCutoverBagLbs: 10,
    defaultStoreBagCost: 10.68,
    defaultBodegaBagCost: 8.9,
    defaultYieldFactor: MEAT_COOKING_YIELDS.pastor, // 0.615
    priorityRank: 3,
  },
  {
    key: 'lengua',
    inventoryItemId: ACTIVE_PROTEIN_IDS.lengua,
    sku: '012W',
    displayName: 'Lengua',
    historyMeatType: 'LENGUA',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.lengua, // 2.5 lb
    preCutoverBagLbs: 5,
    defaultStoreBagCost: 21.0,
    defaultBodegaBagCost: 17.5,
    defaultYieldFactor: MEAT_COOKING_YIELDS.lengua, // 1.0
    priorityRank: 4,
  },
  {
    key: 'pollo',
    inventoryItemId: ACTIVE_PROTEIN_IDS.pollo,
    sku: '015W',
    displayName: 'Pollo',
    historyMeatType: 'POLLO',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.pollo, // 5 lb
    preCutoverBagLbs: 10,
    defaultStoreBagCost: 7.5,
    defaultBodegaBagCost: 6.5,
    defaultYieldFactor: MEAT_COOKING_YIELDS.pollo, // 0.65
    priorityRank: 5,
  },
  {
    key: 'chorizo',
    inventoryItemId: ACTIVE_PROTEIN_IDS.chorizo,
    sku: '321W',
    displayName: 'Chorizo 8 oz',
    historyMeatType: 'CHORIZO',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.chorizo, // 0.5 lb
    preCutoverBagLbs: 0.5,
    defaultStoreBagCost: 1.554,
    defaultBodegaBagCost: 1.295,
    defaultYieldFactor: MEAT_COOKING_YIELDS.chorizo, // 0.75
    priorityRank: 6,
  },
  {
    key: 'carnitas',
    inventoryItemId: ACTIVE_PROTEIN_IDS.carnitas,
    sku: '320W',
    displayName: 'Carnitas 6 oz',
    historyMeatType: 'CARNITAS',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.carnitas, // 0.375 lb
    preCutoverBagLbs: 0.375,
    defaultStoreBagCost: 1.54,
    defaultBodegaBagCost: 1.28,
    defaultYieldFactor: MEAT_COOKING_YIELDS.carnitas, // 1.0
    priorityRank: 7,
  },
  {
    key: 'buche',
    inventoryItemId: ACTIVE_PROTEIN_IDS.buche,
    sku: '319W',
    displayName: 'Buche 6 oz',
    historyMeatType: 'BUCHE',
    defaultBagLbs: MEAT_DEFAULT_BAG_LBS.buche, // 0.375 lb
    preCutoverBagLbs: 0.375,
    defaultStoreBagCost: 1.6,
    defaultBodegaBagCost: 1.32,
    defaultYieldFactor: MEAT_COOKING_YIELDS.buche, // 1.0
    priorityRank: 8,
  },
] as const

export type AlertSeverity = 'warning' | 'critical'
export type AlertWorkflowStatus = 'open' | 'acknowledged' | 'coached' | 'verified' | 'resolved'
export type DominantShift = 'AM' | 'PM' | 'BOTH'

export interface ShiftStaffMember {
  name: string
  role: string
  category: 'grill' | 'leader'
  hours: number
  shiftsWorked: number
  station?: string
}

export interface StoreEscaleraRecipients {
  storeId: number
  storeName: string
  storeCode: string | null
  externalId: string | null
  managerName: string | null
  managerEmail: string | null
  managerUserIds: string[]
  assistantNames: string[]
  assistantEmails: string[]
  assistantUserIds: string[]
  supervisorName: string | null
  supervisorEmail: string | null
  supervisorUserId: string | null
  toEmails: string[]
  bellUserIds: string[]
}

export interface ComputedPortionAlert {
  id?: string
  store_id: number
  store_name: string
  period_start: string
  period_end: string
  anchor_t0: string
  anchor_t1: string
  span_days: number
  meat_key: ActiveProteinKey
  meat_name: string
  inventory_item_id: string
  bag_weight_lbs: number
  store_cost_per_bag: number
  bodega_cost_per_bag: number
  yield_factor: number
  count_t0_bags: number
  arrived_bags: number
  count_t1_bags: number
  theoretical_lbs: number
  actual_lbs: number
  variance_lbs: number
  variance_bags: number
  variance_pct: number
  excess_oz_per_taco: number
  dollar_loss_store: number
  dollar_loss_bodega: number
  store_food_cost_pct: number
  dominant_shift: DominantShift
  am_theo_lbs: number
  pm_theo_lbs: number
  am_actual_lbs: number | null
  pm_actual_lbs: number | null
  handover_days_count: number
  am_staff: ShiftStaffMember[]
  pm_staff: ShiftStaffMember[]
  manager_email: string | null
  assistant_emails: string[]
  supervisor_email: string | null
  escalated_to_execs: boolean
  severity: AlertSeverity
  status: AlertWorkflowStatus
  dish_equivalence_summary?: {
    tacosSold: number
    burritosSold: number
    quesadillasSold: number
    mulitasSold: number
    tortasSold: number
    platesSold: number
    partyTraysCookedLbs: number
    toastSoldBags: number
    fridgeUsedBags: number
    unbilledTacosEquiv: number
  } | null
  email_sent_at?: string | null
  acknowledged_by?: string | null
  acknowledged_at?: string | null
  coaching_shift?: string | null
  coaching_staff_names?: string | null
  corrective_action_notes?: string | null
  supervisor_verified_by?: string | null
  supervisor_verified_at?: string | null
  resolved_at?: string | null
}

export interface ScanPortionAlertsOptions {
  storeId?: number | string | null
  startDate?: string | null
  endDate?: string | null
  spanDays?: number
  meatKey?: string | null
  dryRun?: boolean
  sendEmails?: boolean
  forceResend?: boolean
  testTo?: string | null
}

export interface DispatchedEmailSummary {
  storeId: number
  storeName: string
  meatKey: string
  severity: AlertSeverity
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  sent: boolean
  skippedDuplicate?: boolean
  dryRun?: boolean
  providerUsed?: string
  bellCount?: number
  error?: string
}

export interface ScanPortionAlertsResult {
  periodStart: string
  periodEnd: string
  anchorLookbackStart: string
  dryRun: boolean
  evaluatedSpans: number
  triggeredAlerts: ComputedPortionAlert[]
  persistedCount: number
  emailsDispatched: DispatchedEmailSummary[]
}

export function escapeHtml(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeCorporateEmail(raw?: string | null): string | null {
  if (!raw) return null
  const clean = String(raw).trim().toLowerCase()
  if (!clean || !clean.includes('@')) return null
  if (clean === 'roque@tacosgavilan.com') return 'carlos@tacosgavilan.com'
  return clean
}

/**
 * Candado de Semana de Pruebas: mientras `PORTION_ALERTS_LIVE_RECIPIENTS` NO sea explícitamente `'true'`,
 * el 100% de correos van únicamente a `carlos@tacosgavilan.com` y se bloquea cualquier notificación a tiendas.
 */
export function isPortionAlertsWeeklyTestMode(): boolean {
  return String(process.env.PORTION_ALERTS_LIVE_RECIPIENTS || '').trim().toLowerCase() !== 'true'
}

export function validateTestToEmail(testTo?: string | null): { valid: boolean; email: string | null; error?: string } {
  const weeklyTestLock = isPortionAlertsWeeklyTestMode()
  if (!testTo || String(testTo).trim() === '') {
    return { valid: true, email: weeklyTestLock ? 'carlos@tacosgavilan.com' : null }
  }
  const clean = String(testTo).trim().toLowerCase()
  if (!CORPORATE_EMAIL_GUARD_REGEX.test(clean)) {
    return {
      valid: false,
      email: null,
      error: 'El parámetro testTo debe ser exclusivamente un correo corporativo @tacosgavilan.com',
    }
  }
  const normalized = normalizeCorporateEmail(clean)
  if (weeklyTestLock) {
    return { valid: true, email: 'carlos@tacosgavilan.com' }
  }
  return { valid: true, email: normalized }
}

export function resolveHistoricalBagWeightLbs(benchmark: MeatCatalogBenchmark, anchorDateIso: string): number {
  if (anchorDateIso < BAG_CUTOVER_DATE_ISO) {
    return benchmark.preCutoverBagLbs
  }
  return benchmark.defaultBagLbs
}

function getIsoDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function round2(val: number): number {
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0
}

function round3(val: number): number {
  return Number.isFinite(val) ? Math.round(val * 1000) / 1000 : 0
}

async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  maxPages = 40
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

function matchesStoreScopeFallback(
  storeScope: unknown,
  store: { id: number; code?: string | null; name?: string | null }
): boolean {
  if (!Array.isArray(storeScope) || storeScope.length === 0) return false
  const idStr = String(store.id)
  const codeLower = String(store.code || '').trim().toLowerCase()
  const nameLower = String(store.name || '').trim().toLowerCase()
  return storeScope.some((entry) => {
    const clean = String(entry ?? '').trim().toLowerCase()
    if (!clean) return false
    return clean === idStr || (codeLower && clean === codeLower) || (nameLower && clean === nameLower)
  })
}

/**
 * Resuelve la Escalera de Mando completa (Manager, Asistentes, Supervisor Regional) para las sucursales activas.
 */
export function buildEscaleraByStore(
  stores: Array<{
    id: number
    name: string
    code?: string | null
    external_id?: string | null
    supervisor_id?: number | null
    supervisor_name?: string | null
  }>,
  users: Array<{
    id: number
    full_name?: string | null
    email?: string | null
    google_email_connected?: string | null
    role?: string | null
    store_id?: number | null
    store_scope?: unknown
    is_active?: boolean | null
  }>
): Map<number, StoreEscaleraRecipients> {
  const activeUsers = (users || []).filter((u) => Boolean(u.is_active))
  const userById = new Map<number, (typeof activeUsers)[number]>()
  for (const u of activeUsers) {
    userById.set(Number(u.id), u)
  }

  const map = new Map<number, StoreEscaleraRecipients>()

  for (const store of stores) {
    const storeId = Number(store.id)
    const managers = activeUsers.filter((u) => {
      const r = String(u.role || '').trim().toLowerCase()
      const isMgr =
        (r === 'manager' || r === 'gerente' || r === 'general_manager') &&
        !r.includes('asst') &&
        !r.includes('assist') &&
        !r.includes('asistente')
      if (!isMgr) return false
      if (u.store_id !== null && u.store_id !== undefined && Number(u.store_id) === storeId) return true
      return matchesStoreScopeFallback(u.store_scope, store)
    })

    const assistants = activeUsers.filter((u) => {
      const r = String(u.role || '').trim().toLowerCase()
      const isAsst = r === 'asistente' || r === 'assistant' || r === 'asst_manager'
      if (!isAsst) return false
      if (u.store_id !== null && u.store_id !== undefined && Number(u.store_id) === storeId) return true
      return matchesStoreScopeFallback(u.store_scope, store)
    })

    let supervisorEmail: string | null = null
    let supervisorName: string | null = store.supervisor_name || null
    let supervisorUserId: string | null = null

    if (store.supervisor_id) {
      const supUser = userById.get(Number(store.supervisor_id))
      if (supUser) {
        supervisorEmail = normalizeCorporateEmail(supUser.google_email_connected || supUser.email)
        supervisorName = supUser.full_name || supervisorName
        supervisorUserId = String(supUser.id)
      }
    }

    const managerEmails = Array.from(
      new Set(
        managers
          .map((m) => normalizeCorporateEmail(m.google_email_connected || m.email))
          .filter((e): e is string => Boolean(e) && e !== 'carlos@tacosgavilan.com')
      )
    )

    const assistantEmails = Array.from(
      new Set(
        assistants
          .map((a) => normalizeCorporateEmail(a.google_email_connected || a.email))
          .filter((e): e is string => Boolean(e) && e !== 'carlos@tacosgavilan.com')
      )
    )

    const safeSupEmail =
      supervisorEmail && supervisorEmail !== 'carlos@tacosgavilan.com' ? supervisorEmail : null

    const toEmails = Array.from(new Set([...managerEmails, ...assistantEmails]))
    if (toEmails.length === 0 && safeSupEmail) {
      toEmails.push(safeSupEmail)
    }

    const bellUserIds = Array.from(
      new Set([
        ...managers.map((m) => String(m.id)),
        ...assistants.map((a) => String(a.id)),
        ...(supervisorUserId ? [supervisorUserId] : []),
      ])
    )

    map.set(storeId, {
      storeId,
      storeName: store.name,
      storeCode: store.code || null,
      externalId: store.external_id || null,
      managerName: managers[0]?.full_name || null,
      managerEmail: managerEmails[0] || null,
      managerUserIds: managers.map((m) => String(m.id)),
      assistantNames: assistants.map((a) => a.full_name || a.email || '').filter(Boolean),
      assistantEmails,
      assistantUserIds: assistants.map((a) => String(a.id)),
      supervisorName,
      supervisorEmail: safeSupEmail,
      supervisorUserId,
      toEmails,
      bellUserIds,
    })
  }

  return map
}

/**
 * Evalúa si una varianza física vs teórica amerita alerta `warning` o `critical`.
 */
export function evaluatePortionAlertSeverity(params: {
  meatKey: ActiveProteinKey
  spanDays: number
  varianceLbs: number
  varianceBags: number
  variancePct: number
  dollarLossStore: number
  storeFoodCostPct: number
}): AlertSeverity | null {
  const { meatKey, spanDays, varianceLbs, varianceBags, variancePct, dollarLossStore, storeFoodCostPct } = params
  if (!Number.isFinite(varianceLbs) || varianceLbs <= 0 || spanDays < 1) return null

  const scale = Math.min(1, Math.max(1 / 7, spanDays / 7))

  if (meatKey === 'asada') {
    const isCritical =
      (variancePct > 10 && (varianceBags >= 2 * scale || dollarLossStore >= 120 * scale)) ||
      (variancePct > 5 && (varianceBags >= 5 * scale || dollarLossStore >= 300 * scale)) ||
      (storeFoodCostPct > 35 && variancePct > 3 && dollarLossStore >= 120 * scale)

    if (isCritical) return 'critical'

    const isWarning =
      (variancePct > 5 && (varianceBags >= 2 * scale || dollarLossStore >= 120 * scale)) ||
      (variancePct >= 3.5 && (varianceBags >= 5 * scale || dollarLossStore >= 300 * scale))

    if (isWarning) return 'warning'
    return null
  }

  // Otras 7 carnes activas: exigir impacto monetario real para evitar ruido de paquetes pequeños
  const isOtherCritical =
    (variancePct > 15 && dollarLossStore >= 200 * scale && varianceBags >= 2 * scale) ||
    (variancePct > 8 && dollarLossStore >= 350 * scale && varianceBags >= 2 * scale) ||
    (storeFoodCostPct > 35 && variancePct > 10 && dollarLossStore >= 120 * scale && varianceBags >= 2 * scale)

  if (isOtherCritical) return 'critical'

  const isOtherWarning = variancePct > 8 && dollarLossStore >= 100 * scale && varianceBags >= 2 * scale
  if (isOtherWarning) return 'warning'

  return null
}

/**
 * Construye el HTML ejecutivo institucional para la Escalera de Mando (100% escapado contra inyección HTML).
 */
export function buildPortionControlEmailHtml(
  alert: ComputedPortionAlert,
  escalera: StoreEscaleraRecipients,
  isTest: boolean = false
): { subject: string; html: string } {
  const isCritical = alert.severity === 'critical'
  const isAsada = alert.meat_key === 'asada'
  const headerBg = isCritical ? '#991B1B' : '#B45309'
  const badgeBg = isCritical ? '#FEE2E2' : '#FEF3C7'
  const badgeText = isCritical ? '#991B1B' : '#92400E'
  const severityLabel = isCritical ? 'CRÍTICO — ACCIÓN INMEDIATA' : 'PREVENTIVO — AJUSTE DE LÍNEA'

  const theoBags = alert.bag_weight_lbs > 0 ? alert.theoretical_lbs / alert.bag_weight_lbs : 0
  const actualBags = alert.bag_weight_lbs > 0 ? alert.actual_lbs / alert.bag_weight_lbs : 0
  const excessOzBurrito = alert.excess_oz_per_taco * 4

  const shiftLabel =
    alert.dominant_shift === 'AM'
      ? 'Turno AM (06:00 AM – 04:59 PM)'
      : alert.dominant_shift === 'PM'
        ? 'Turno PM (05:00 PM – 05:59 AM)'
        : 'Ambos Turnos (AM y PM)'

  const renderStaffPills = (staff: ShiftStaffMember[]) => {
    if (!staff || staff.length === 0) {
      return '<span style="color:#6B7280;font-size:12px;">Sin marcajes registrados de parrilla en el periodo</span>'
    }
    return staff
      .slice(0, 6)
      .map((s) => {
        const pillBg = s.category === 'grill' ? '#FEF2F2' : '#EFF6FF'
        const pillBorder = s.category === 'grill' ? '#FECACA' : '#BFDBFE'
        const pillColor = s.category === 'grill' ? '#991B1B' : '#1E40AF'
        return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:4px 8px;border-radius:6px;background:${pillBg};border:1px solid ${pillBorder};color:${pillColor};font-size:12px;font-weight:600;">${escapeHtml(s.name)} <span style="font-weight:400;opacity:0.85;">(${escapeHtml(s.role)} · ${s.hours.toFixed(1)}h)</span></span>`
      })
      .join('')
  }

  const amShiftDetail =
    alert.am_actual_lbs !== null
      ? `Teórico POS: <strong>${alert.am_theo_lbs.toFixed(1)} lb</strong> vs Físico (Corte 5PM): <strong style="color:#991B1B;">${alert.am_actual_lbs.toFixed(1)} lb</strong>`
      : `Volumen Teórico POS: <strong>${alert.am_theo_lbs.toFixed(1)} lb</strong> (${(alert.theoretical_lbs > 0 ? (alert.am_theo_lbs / alert.theoretical_lbs) * 100 : 0).toFixed(0)}% exposición)`

  const pmShiftDetail =
    alert.pm_actual_lbs !== null
      ? `Teórico POS: <strong>${alert.pm_theo_lbs.toFixed(1)} lb</strong> vs Físico (Corte 5PM): <strong style="color:#991B1B;">${alert.pm_actual_lbs.toFixed(1)} lb</strong>`
      : `Volumen Teórico POS: <strong>${alert.pm_theo_lbs.toFixed(1)} lb</strong> (${(alert.theoretical_lbs > 0 ? (alert.pm_theo_lbs / alert.theoretical_lbs) * 100 : 0).toFixed(0)}% exposición)`

  const appBaseUrl = resolveAppBaseUrl()
  const actionUrl = `${appBaseUrl}/admin/food-cost/meats?store_id=${encodeURIComponent(String(alert.store_id))}&startDate=${encodeURIComponent(alert.period_start)}&endDate=${encodeURIComponent(alert.period_end)}&meat=${encodeURIComponent(alert.meat_key)}`

  const subjectCore = `${isCritical ? '🚨 [CRÍTICO]' : '⚠️ [ALERTA PORCIÓN]'} #${alert.store_id} ${alert.store_name} — ${alert.meat_name.toUpperCase()}: +${alert.variance_bags.toFixed(1)} bolsas (+${formatSignedUSD(alert.dollar_loss_store)}) en ${alert.span_days}d`
  const subject = isTest ? `[PRUEBA] ${subjectCore}` : subjectCore

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:${headerBg};padding:22px 28px;color:#FFFFFF;">
              <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:0.9;">
                Tacos Gavilan · Control de Porciones y Cadena de Mando
              </div>
              <div style="font-size:21px;font-weight:800;margin-top:6px;">
                ${isAsada ? '🥩 PRIORIDAD #1 CARNE ASADA' : `🥩 ${escapeHtml(alert.meat_name.toUpperCase())}`} — Sucursal #${alert.store_id} ${escapeHtml(alert.store_name)}
              </div>
              <div style="margin-top:8px;font-size:13px;opacity:0.95;">
                Periodo medido: <strong>${escapeHtml(alert.period_start)}</strong> al <strong>${escapeHtml(alert.period_end)}</strong> (${alert.span_days} días · Anclas físicas ${escapeHtml(alert.anchor_t0)} → ${escapeHtml(alert.anchor_t1)})
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px;">
              <div style="margin-bottom:16px;">
                <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${badgeBg};color:${badgeText};font-size:12px;font-weight:800;">
                  ${severityLabel}
                </span>
                ${alert.store_food_cost_pct > 0 ? `<span style="display:inline-block;margin-left:8px;padding:5px 12px;border-radius:999px;background:${alert.store_food_cost_pct > 35 ? '#FEE2E2' : '#F3F4F6'};color:${alert.store_food_cost_pct > 35 ? '#991B1B' : '#374151'};font-size:12px;font-weight:700;">Food Cost Tienda: ${alert.store_food_cost_pct.toFixed(1)}%</span>` : ''}
                ${alert.escalated_to_execs ? `<span style="display:inline-block;margin-left:8px;padding:5px 12px;border-radius:999px;background:#111827;color:#F9FAFB;font-size:11px;font-weight:700;">Copia Directiva Ejecutiva</span>` : ''}
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:18px;">
                <tr>
                  <td width="25%" style="padding:14px 12px;border-right:1px solid #E5E7EB;text-align:center;">
                    <div style="font-size:11px;color:#6B7280;font-weight:700;text-transform:uppercase;">Teórico POS</div>
                    <div style="font-size:18px;font-weight:800;color:#111827;margin-top:4px;">${theoBags.toFixed(1)} bolsas</div>
                    <div style="font-size:12px;color:#4B5563;">${alert.theoretical_lbs.toFixed(1)} lb crudas</div>
                  </td>
                  <td width="25%" style="padding:14px 12px;border-right:1px solid #E5E7EB;text-align:center;">
                    <div style="font-size:11px;color:#6B7280;font-weight:700;text-transform:uppercase;">Consumo Físico</div>
                    <div style="font-size:18px;font-weight:800;color:#111827;margin-top:4px;">${actualBags.toFixed(1)} bolsas</div>
                    <div style="font-size:12px;color:#4B5563;">${alert.actual_lbs.toFixed(1)} lb crudas</div>
                  </td>
                  <td width="25%" style="padding:14px 12px;border-right:1px solid #E5E7EB;text-align:center;background:#FEF2F2;">
                    <div style="font-size:11px;color:#991B1B;font-weight:700;text-transform:uppercase;">Exceso Físico</div>
                    <div style="font-size:18px;font-weight:800;color:#DC2626;margin-top:4px;">+${alert.variance_bags.toFixed(1)} bolsas</div>
                    <div style="font-size:12px;color:#991B1B;font-weight:700;">+${alert.variance_lbs.toFixed(1)} lb (+${alert.variance_pct.toFixed(1)}%)</div>
                  </td>
                  <td width="25%" style="padding:14px 12px;text-align:center;background:#FEF2F2;">
                    <div style="font-size:11px;color:#991B1B;font-weight:700;text-transform:uppercase;">Pérdida Tienda</div>
                    <div style="font-size:18px;font-weight:800;color:#DC2626;margin-top:4px;">${formatSignedUSD(alert.dollar_loss_store)}</div>
                    <div style="font-size:11px;color:#7F1D1D;">Costo Bodega: ${formatSignedUSD(alert.dollar_loss_bodega)}</div>
                  </td>
                </tr>
              </table>

              <div style="background:#FFFBEB;border-left:4px solid #D97706;padding:12px 14px;border-radius:6px;margin-bottom:18px;font-size:13px;color:#78350F;">
                <strong>Impacto estimado en cuchara/porción:</strong> Equivale a servir <strong>+${alert.excess_oz_per_taco.toFixed(2)} oz cocidas extra por taco</strong> (estándar <strong>1.50 oz</strong> → real <strong>${(1.5 + alert.excess_oz_per_taco).toFixed(2)} oz</strong>) o <strong>+${excessOzBurrito.toFixed(2)} oz extra por burrito</strong> (estándar <strong>6.00 oz</strong> → real <strong>${(6.0 + excessOzBurrito).toFixed(2)} oz</strong>).
                <div style="margin-top:4px;font-size:12px;color:#92400E;">
                  📦 <strong>Corte de Sobrantes (Orden Diaria + Facturas Bodega):</strong> Sobrante Inicial <strong>${alert.count_t0_bags}</strong> bolsas + Entregas Bodega <strong>${alert.arrived_bags}</strong> bolsas − Sobrante Capturado <strong>${alert.count_t1_bags}</strong> bolsas = <strong>${actualBags.toFixed(2)}</strong> bolsas consumidas (@ ${formatSignedUSD(alert.store_cost_per_bag)}/bolsa de ${alert.bag_weight_lbs} lb).
                </div>
                ${
                  alert.dish_equivalence_summary
                    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #F59E0B;font-size:12px;color:#78350F;">
                  🌮 <strong>Vendido en Toast POS:</strong> <strong>${Math.round(alert.dish_equivalence_summary.tacosSold).toLocaleString()} tacos</strong> + <strong>${Math.round(alert.dish_equivalence_summary.burritosSold).toLocaleString()} burritos</strong> + quesadillas/mulitas/tortas/platos/charolas = <strong>${alert.dish_equivalence_summary.toastSoldBags.toFixed(2)} bolsas</strong> requeridas vs. <strong>${alert.dish_equivalence_summary.fridgeUsedBags.toFixed(2)} bolsas</strong> consumidas según sobrantes (<strong>+${Math.max(0, alert.dish_equivalence_summary.unbilledTacosEquiv).toLocaleString()} tacos</strong> equivalentes sin cobrar).
                </div>`
                    : ''
                }
              </div>

              <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:8px;">
                🕒 Desglose por Turno y Personal en Línea (Foco: ${escapeHtml(shiftLabel)})
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:20px;">
                <tr>
                  <td width="50%" valign="top" style="padding:12px 14px;border-right:1px solid #E5E7EB;">
                    <div style="font-size:12px;font-weight:800;color:#1F2937;text-transform:uppercase;">☀️ Turno AM (06:00 – 16:59)</div>
                    <div style="font-size:12px;color:#374151;margin:6px 0 8px 0;">${amShiftDetail}</div>
                    <div>${renderStaffPills(alert.am_staff)}</div>
                  </td>
                  <td width="50%" valign="top" style="padding:12px 14px;">
                    <div style="font-size:12px;font-weight:800;color:#1F2937;text-transform:uppercase;">🌙 Turno PM (17:00 – 05:59)</div>
                    <div style="font-size:12px;color:#374151;margin:6px 0 8px 0;">${pmShiftDetail}</div>
                    <div>${renderStaffPills(alert.pm_staff)}</div>
                  </td>
                </tr>
              </table>

              <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:8px;">
                🪜 Protocolo Correctivo Obligatorio — Escalera de Mando
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:22px;font-size:13px;color:#1F2937;">
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;">
                    <strong>1. Gerente de Sucursal (${escapeHtml(escalera.managerName || 'Gerente')}):</strong> Calibrar báscula digital en línea y auditar gramaje cocido exacto: <strong>1.5 oz</strong> taco regular (` + '`1.9 oz`' + ` Carne Dorada) y <strong>6.0 oz</strong> burrito (` + '`12.0 oz`' + ` Meat Only). Confirmar enterado en el sistema hoy.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;">
                    <strong>2. Asistentes de Turno (${escapeHtml(escalera.assistantNames.join(', ') || 'AM y PM')}):</strong> Pesar muestra en vivo de <strong>5 tacos y 3 burritos</strong> al inicio de AM y PM, registrar coaching al taquero en turno y capturar el <strong>Conteo Cambio de Turno 5:00 PM</strong> (bolsas selladas + lbs abiertas) para aislar exactamente AM vs PM.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;">
                    <strong>3. Supervisor Regional (${escapeHtml(escalera.supervisorName || 'Supervisor')}):</strong> Verificar en su próxima visita física báscula, merma de cocción en plancha y cierre del plan correctivo en el Centro de Carnes.
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:22px 0 8px 0;">
                <a href="${escapeHtml(actionUrl)}" target="_blank" style="display:inline-block;background:#DC2626;color:#FFFFFF;font-size:14px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:8px;">
                  Abrir Centro de Porciones y Registrar Acción ➔
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="background:#F9FAFB;padding:14px 28px;border-top:1px solid #E5E7EB;font-size:11px;color:#6B7280;text-align:center;">
              Sistema de Monitoreo Operativo · <strong>Tacos Gavilan</strong> · Moneda oficial USD
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html }
}

/**
 * Ejecuta el escaneo de Balance de Masas Telescópico (7d rolling o rango explícito),
 * persiste alertas idempotentes y despacha correos + notificaciones de campana si corresponde.
 */
export async function scanPortionControlAlerts(
  options: ScanPortionAlertsOptions = {}
): Promise<ScanPortionAlertsResult> {
  const supabase = await getSupabaseAdminClient()
  const dryRun = Boolean(options.dryRun)
  const sendEmails = options.sendEmails ?? !dryRun
  const forceResend = Boolean(options.forceResend)

  const testCheck = validateTestToEmail(options.testTo)
  if (!testCheck.valid) {
    throw new Error(testCheck.error || 'Invalid testTo email')
  }
  const safeTestTo = testCheck.email

  const todayLA = getBusinessDateLA()
  const yesterdayLA = addDaysIso(todayLA, -1)
  const targetSpanDays = Math.max(1, Math.min(35, Number(options.spanDays) || 7))

  const resolvedEndDate =
    options.endDate && isValidIsoDate(options.endDate) && options.endDate <= yesterdayLA
      ? options.endDate
      : yesterdayLA

  const resolvedStartDate =
    options.startDate && isValidIsoDate(options.startDate) && options.startDate <= resolvedEndDate
      ? options.startDate
      : addDaysIso(resolvedEndDate, -(targetSpanDays - 1))

  // El conteo de apertura t0 que alimenta `resolvedStartDate` ocurre al cierre de `resolvedStartDate - 1`
  // (con margen de -2 días por si `resolvedStartDate - 1` cayó en sábado sin conteo aislado).
  const anchorLookbackStart = addDaysIso(resolvedStartDate, -3)

  const meatFilterKey = options.meatKey ? String(options.meatKey).trim().toLowerCase() : null
  const activeBenchmarks = meatFilterKey
    ? MEAT_BENCHMARKS.filter((b) => b.key === meatFilterKey || b.inventoryItemId === meatFilterKey)
    : [...MEAT_BENCHMARKS]

  const itemIds = activeBenchmarks.map((b) => b.inventoryItemId)
  const historyMeatTypes = activeBenchmarks.map((b) => b.historyMeatType)

  // 1. Cargar sucursales activas, usuarios activos, catálogo de carnes, trabajos Toast y empleados Toast
  let storesQuery = supabase
    .from('stores')
    .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })

  if (options.storeId !== undefined && options.storeId !== null && String(options.storeId).trim() !== '' && String(options.storeId).toLowerCase() !== 'all') {
    const rawStore = String(options.storeId).trim()
    if (/^\d+$/.test(rawStore)) {
      storesQuery = storesQuery.eq('id', Number(rawStore))
    } else {
      storesQuery = storesQuery.eq('external_id', rawStore)
    }
  }

  const [
    { data: storesData, error: storesErr },
    { data: usersData, error: usersErr },
    { data: itemsData, error: itemsErr },
    { data: jobsData },
    toastEmployees,
  ] = await Promise.all([
    storesQuery,
    supabase
      .from('users')
      .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active')
      .limit(2000),
    supabase
      .from('inventory_items')
      .select('id, sku, name, purchase_unit_cost, quantity_per_unit, yield_percent')
      .in('id', itemIds),
    supabase.from('toast_jobs').select('guid, title').limit(2000),
    fetchAllRows((from, to) =>
      supabase
        .from('toast_employees')
        .select('id, toast_guid, v2_toast_guid, chosen_name, first_name, last_name')
        .order('id', { ascending: true })
        .range(from, to)
    ),
  ])

  if (storesErr) throw new Error(`Error cargando sucursales: ${storesErr.message}`)
  if (usersErr) throw new Error(`Error cargando usuarios: ${usersErr.message}`)
  if (itemsErr) throw new Error(`Error cargando catálogo de carnes: ${itemsErr.message}`)

  const stores = (storesData || []) as Array<{
    id: number
    name: string
    code: string | null
    external_id: string | null
    supervisor_id: number | null
    supervisor_name: string | null
  }>

  if (stores.length === 0) {
    return {
      periodStart: resolvedStartDate,
      periodEnd: resolvedEndDate,
      anchorLookbackStart,
      dryRun,
      evaluatedSpans: 0,
      triggeredAlerts: [],
      persistedCount: 0,
      emailsDispatched: [],
    }
  }

  const storeIdsNumeric = stores.map((s) => Number(s.id))
  const storeIdsText = stores.map((s) => String(s.id))
  const storeGuids = stores.map((s) => s.external_id).filter((g): g is string => Boolean(g))
  const escaleraMap = buildEscaleraByStore(stores, usersData || [])

  const itemLiveCostMap = new Map<string, { purchaseCost: number; yieldFactor: number }>()
  for (const row of itemsData || []) {
    const cost = Number(row.purchase_unit_cost)
    const yieldPct = Number(row.yield_percent)
    itemLiveCostMap.set(String(row.id), {
      purchaseCost: Number.isFinite(cost) && cost > 0 ? cost : 0,
      yieldFactor: Number.isFinite(yieldPct) && yieldPct > 0 ? yieldPct / 100 : 0,
    })
  }

  // 2. Consultas paginadas de conteos físicos, órdenes entregadas, consumo teórico 30-min, cortes 5PM, FC% y personal
  // Cargar contexto autoritativo Toast PMIX (`pmix_daily_cache` + reconciliación QBO Invoices de Bodega) antes de leer órdenes
  const toastMeatCtx = await loadToastMeatContext({
    storeNumericIds: storeIdsNumeric,
    minDate: addDaysIso(anchorLookbackStart, 1),
    maxDate: resolvedEndDate,
    reconcileQbInvoices: true,
  })

  const [
    countsRows,
    ordersHeaderRows,
    historyRows,
    handoverRows,
    fcCacheRows,
    punchesRows,
    stationRows,
    scheduleRows,
    checklistRows,
    priorAlertsRows,
  ] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('inventory_counts')
        .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes, created_at')
        .in('store_id', storeIdsText)
        .in('inventory_item_id', itemIds)
        .gte('count_date', anchorLookbackStart)
        .lte('count_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('inventory_orders')
        .select('id, store_id, order_date, status')
        .in('store_id', storeIdsNumeric)
        .in('status', ['sent', 'received'])
        .gte('order_date', anchorLookbackStart)
        .lt('order_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('meat_consumption_history')
        .select('id, store_id, business_date, interval_start, meat_type, raw_lbs')
        .in('store_id', storeIdsNumeric)
        .in('meat_type', historyMeatTypes)
        .gt('business_date', anchorLookbackStart)
        .lte('business_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('meat_shift_handover_counts')
        .select('id, store_id, business_date, meat_key, sealed_bags, open_cooked_lbs, counted_by_name')
        .in('store_id', storeIdsNumeric)
        .gt('business_date', anchorLookbackStart)
        .lte('business_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('food_cost_daily_cache')
        .select('id, store_id, business_date, total_cost, food_cost, net_sales')
        .gte('business_date', resolvedStartDate)
        .lte('business_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    storeGuids.length > 0
      ? fetchAllRows((from, to) =>
          supabase
            .from('punches')
            .select('toast_id, store_id, employee_toast_guid, job_toast_guid, business_date, clock_in, clock_out')
            .in('store_id', storeGuids)
            .gte('business_date', resolvedStartDate)
            .lte('business_date', resolvedEndDate)
            .order('toast_id', { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([]),
    storeGuids.length > 0
      ? fetchAllRows((from, to) =>
          supabase
            .from('station_assignments')
            .select('id, store_id, employee_id, assignment_date, main_station, sub_position, is_closing')
            .in('store_id', storeGuids)
            .gte('assignment_date', resolvedStartDate)
            .lte('assignment_date', resolvedEndDate)
            .order('id', { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([]),
    fetchAllRows((from, to) =>
      supabase
        .from('schedules')
        .select('id, user_id, store_id, date, shift_label, start_time, role')
        .in('store_id', storeIdsNumeric)
        .gte('date', resolvedStartDate)
        .lte('date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('assistant_checklists')
        .select('id, store_id, checklist_date, shift, user_name')
        .in('store_id', storeIdsNumeric)
        .gte('checklist_date', resolvedStartDate)
        .lte('checklist_date', resolvedEndDate)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    supabase
      .from('portion_control_alerts')
      .select('id, store_id, period_start, period_end, meat_key, status, email_sent_at')
      .in('store_id', storeIdsNumeric)
      .gte('period_end', addDaysIso(resolvedEndDate, -21))
      .then((r) => r.data || []),
  ])

  // Cargar líneas de las órdenes encontradas (en lotes limpios)
  const orderIds = ordersHeaderRows.map((o: any) => String(o.id))
  const orderHeaderById = new Map<string, { storeId: number; orderDate: string }>()
  for (const o of ordersHeaderRows) {
    orderHeaderById.set(String(o.id), { storeId: Number(o.store_id), orderDate: String(o.order_date) })
  }

  const orderLinesRows: Array<{ order_id: string; inventory_item_id: string; qty: number }> = []
  const chunkSize = 250
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const batch = orderIds.slice(i, i + chunkSize)
    const batchLines = await fetchAllRows((from, to) =>
      supabase
        .from('inventory_order_lines')
        .select('id, order_id, inventory_item_id, calculated_qty, adjusted_qty, final_qty')
        .in('order_id', batch)
        .in('inventory_item_id', itemIds)
        .order('id', { ascending: true })
        .range(from, to)
    )
    for (const l of batchLines) {
      const rawQty = l.final_qty ?? l.adjusted_qty ?? l.calculated_qty ?? 0
      const qty = Number(rawQty)
      if (Number.isFinite(qty) && qty > 0) {
        orderLinesRows.push({
          order_id: String(l.order_id),
          inventory_item_id: String(l.inventory_item_id),
          qty,
        })
      }
    }
  }

  // 3. Indexar conteos físicos humanos (excluyendo AUTO_CYCLE_V2 y sábados parciales dow === 6)
  // Mapa: `${storeId}|${itemId}` -> Map<count_date, bags>
  const humanCountsIndex = new Map<string, Map<string, { bags: number; createdAt: string }>>()
  for (const c of countsRows) {
    const countedBy = String(c.counted_by || '').trim().toUpperCase()
    const notes = String(c.notes || '').trim().toUpperCase()
    if (countedBy === 'AUTO_CYCLE_V2' || notes.includes('AUTO_CYCLE')) continue

    const countDate = String(c.count_date)
    if (getIsoDayOfWeek(countDate) === 6) continue // Sábado consolida con domingo

    const bags = Number(c.quantity_on_hand)
    if (!Number.isFinite(bags) || bags < 0) continue

    const storeId = Number(c.store_id)
    const key = `${storeId}|${c.inventory_item_id}`
    let dateMap = humanCountsIndex.get(key)
    if (!dateMap) {
      dateMap = new Map()
      humanCountsIndex.set(key, dateMap)
    }
    const prev = dateMap.get(countDate)
    const createdAt = String(c.created_at || '')
    if (!prev || createdAt >= prev.createdAt) {
      dateMap.set(countDate, { bags, createdAt })
    }
  }

  // Indexar entregas por `${storeId}|${itemId}|${orderDate}`
  const arrivedByStoreItemDate = new Map<string, number>()
  for (const line of orderLinesRows) {
    const hdr = orderHeaderById.get(line.order_id)
    if (!hdr) continue
    const k = `${hdr.storeId}|${line.inventory_item_id}|${hdr.orderDate}`
    arrivedByStoreItemDate.set(k, (arrivedByStoreItemDate.get(k) || 0) + line.qty)
  }

  // Indexar consumo horario AM vs PM por `${storeId}|${meatType}|${businessDate}` (para proporción AM/PM)
  const theoByStoreMeatDate = new Map<string, { am: number; pm: number }>()
  for (const h of historyRows) {
    const lbs = Number(h.raw_lbs)
    if (!Number.isFinite(lbs) || lbs <= 0) continue
    const k = `${Number(h.store_id)}|${String(h.meat_type).toUpperCase()}|${String(h.business_date)}`
    let bucket = theoByStoreMeatDate.get(k)
    if (!bucket) {
      bucket = { am: 0, pm: 0 }
      theoByStoreMeatDate.set(k, bucket)
    }
    const hour = parseInt(String(h.interval_start || '12:00:00').slice(0, 2), 10)
    if (hour >= 6 && hour <= 16) {
      bucket.am += lbs
    } else {
      bucket.pm += lbs
    }
  }

  // Indexar consumo exacto Toast POS (`PMIX` con `bundleModifiers: true`) por `${storeId}|${meatKey}|${businessDate}`
  const exactToastByStoreMeatDate = new Map<string, StoreDayProteinToastUsage>()
  for (const bench of activeBenchmarks) {
    const liveItem = itemLiveCostMap.get(bench.inventoryItemId)
    const yieldPct = ((liveItem && liveItem.yieldFactor > 0 ? liveItem.yieldFactor : bench.defaultYieldFactor) || 1) * 100
    for (const s of toastMeatCtx.stores) {
      for (let d = addDaysIso(anchorLookbackStart, 1); d <= resolvedEndDate; d = addDaysIso(d, 1)) {
        const pmixItems = toastMeatCtx.pmixByStoreDate.get(`${s.external_id}::${d}`) || []
        if (pmixItems.length === 0) continue
        const usage = evaluatePmixItemsForProtein({
          pmixItems,
          inventoryItemId: bench.inventoryItemId,
          proteinKey: bench.key,
          yieldPercent: yieldPct,
          costPerRawLbStore: 0,
          costPerRawLbBodega: 0,
          ctx: toastMeatCtx,
        })
        exactToastByStoreMeatDate.set(`${s.id}|${bench.key}|${d}`, usage)
      }
    }
  }

  // Indexar cortes 5:00 PM por `${storeId}|${meatKey}|${businessDate}`
  const handoverIndex = new Map<string, { sealedBags: number; openCookedLbs: number }>()
  for (const ho of handoverRows) {
    const k = `${Number(ho.store_id)}|${String(ho.meat_key).toLowerCase()}|${String(ho.business_date)}`
    handoverIndex.set(k, {
      sealedBags: Math.max(0, Number(ho.sealed_bags) || 0),
      openCookedLbs: Math.max(0, Number(ho.open_cooked_lbs) || 0),
    })
  }

  // Indexar Food Cost % de cada tienda en el periodo (filtrando filas inválidas)
  const storeByGuid = new Map<string, number>()
  for (const s of stores) {
    if (s.external_id) storeByGuid.set(s.external_id, Number(s.id))
    storeByGuid.set(String(s.id), Number(s.id))
  }
  const fcTotalsByStore = new Map<number, { cost: number; sales: number }>()
  for (const row of fcCacheRows) {
    const sid = storeByGuid.get(String(row.store_id))
    if (!sid) continue
    const cost = resolveCachedFoodCostDollars(row)
    const sales = Number(row.net_sales) || 0
    if (isInvalidFoodCostCacheRow(cost, sales)) continue
    const agg = fcTotalsByStore.get(sid) || { cost: 0, sales: 0 }
    agg.cost += cost
    agg.sales += sales
    fcTotalsByStore.set(sid, agg)
  }

  // 4. Indexar personal en turno AM vs PM por tienda (Taqueros/Cooks + Managers/Asistentes)
  const jobTitleByGuid = new Map<string, string>()
  for (const j of jobsData || []) {
    if (j.guid && j.title) jobTitleByGuid.set(String(j.guid), String(j.title))
  }

  const empByGuid = new Map<string, string>()
  const empById = new Map<string, string>()
  for (const emp of toastEmployees) {
    const fullName =
      String(emp.chosen_name || '').trim() ||
      `${String(emp.first_name || '').trim()} ${String(emp.last_name || '').trim()}`.trim()
    if (!fullName) continue
    if (emp.id) empById.set(String(emp.id), fullName)
    if (emp.toast_guid) empByGuid.set(String(emp.toast_guid), fullName)
    if (emp.v2_toast_guid) empByGuid.set(String(emp.v2_toast_guid), fullName)
  }

  const userByIdNameRole = new Map<number, { name: string; role: string }>()
  for (const u of usersData || []) {
    userByIdNameRole.set(Number(u.id), {
      name: String(u.full_name || u.email || `User #${u.id}`),
      role: String(u.role || 'staff'),
    })
  }

  // Acumulador de personal por `${storeId}|AM` o `${storeId}|PM`
  const staffAccByStoreShift = new Map<string, Map<string, ShiftStaffMember>>()
  const upsertStaffMember = (
    storeId: number,
    shift: 'AM' | 'PM',
    memberKey: string,
    info: { name: string; role: string; category: 'grill' | 'leader'; hoursDelta: number; shiftCountDelta: number; station?: string }
  ) => {
    const mapKey = `${storeId}|${shift}`
    let m = staffAccByStoreShift.get(mapKey)
    if (!m) {
      m = new Map()
      staffAccByStoreShift.set(mapKey, m)
    }
    const existing = m.get(memberKey)
    if (existing) {
      existing.hours = round2(existing.hours + info.hoursDelta)
      existing.shiftsWorked += info.shiftCountDelta
      if (info.station && !existing.station) existing.station = info.station
      if (info.category === 'grill') existing.category = 'grill'
    } else {
      m.set(memberKey, {
        name: info.name,
        role: info.role,
        category: info.category,
        hours: round2(info.hoursDelta),
        shiftsWorked: info.shiftCountDelta,
        station: info.station,
      })
    }
  }

  // 4a. Enriquecimiento desde `station_assignments` (ej. Slauson CARNES_AM / CARNES_PM)
  for (const sa of stationRows) {
    const sid = storeByGuid.get(String(sa.store_id))
    if (!sid) continue
    const mainStation = String(sa.main_station || '').toUpperCase()
    const subPos = String(sa.sub_position || '').toUpperCase()
    const isGrill = mainStation === 'CARNES' || mainStation === 'TACOS' || mainStation === 'PREPARACION' || subPos.includes('CARNES')
    const isLeader = mainStation === 'MANAGER' || mainStation === 'ASSISTANT' || mainStation.startsWith('SHIFT_LEADER')
    if (!isGrill && !isLeader) continue

    const empName = empById.get(String(sa.employee_id)) || empByGuid.get(String(sa.employee_id))
    if (!empName) continue

    const shift: 'AM' | 'PM' = subPos.includes('_PM') || Boolean(sa.is_closing) ? 'PM' : 'AM'
    upsertStaffMember(sid, shift, empName.toLowerCase(), {
      name: empName,
      role: subPos || mainStation,
      category: isGrill ? 'grill' : 'leader',
      hoursDelta: 0,
      shiftCountDelta: 1,
      station: mainStation,
    })
  }

  // 4b. Primaria universal (15 tiendas) desde `punches` + `toast_jobs`
  const relevantJobRegex = /\b(taquero|cook|cocinero|parrillero|prep|preparador|shift\s*leader|asst\.?\s*manager|manager)\b/i
  const grillJobRegex = /\b(taquero|cook|cocinero|parrillero|prep|preparador)\b/i

  for (const p of punchesRows) {
    const sid = storeByGuid.get(String(p.store_id))
    if (!sid || !p.clock_in) continue
    const jobTitle = jobTitleByGuid.get(String(p.job_toast_guid || '')) || ''
    if (!relevantJobRegex.test(jobTitle)) continue

    const empName = empByGuid.get(String(p.employee_toast_guid || ''))
    if (!empName) continue

    const bizDate = String(p.business_date)
    const clockInMs = new Date(p.clock_in).getTime()
    const clockOutMs = p.clock_out ? new Date(p.clock_out).getTime() : clockInMs + 4 * 3600_000
    if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs) || clockOutMs <= clockInMs) continue

    const amStartMs = buildLAInstant(bizDate, 6, 0).getTime()
    const pmStartMs = buildLAInstant(bizDate, 17, 0).getTime()
    const pmEndMs = buildLAInstant(addDaysIso(bizDate, 1), 6, 0).getTime()

    const amOverlapMin = Math.max(0, Math.min(clockOutMs, pmStartMs) - Math.max(clockInMs, amStartMs)) / 60_000
    const pmOverlapMin = Math.max(0, Math.min(clockOutMs, pmEndMs) - Math.max(clockInMs, pmStartMs)) / 60_000

    const isGrill = grillJobRegex.test(jobTitle)
    if (amOverlapMin >= 20) {
      upsertStaffMember(sid, 'AM', empName.toLowerCase(), {
        name: empName,
        role: jobTitle,
        category: isGrill ? 'grill' : 'leader',
        hoursDelta: amOverlapMin / 60,
        shiftCountDelta: 1,
      })
    }
    if (pmOverlapMin >= 20) {
      upsertStaffMember(sid, 'PM', empName.toLowerCase(), {
        name: empName,
        role: jobTitle,
        category: isGrill ? 'grill' : 'leader',
        hoursDelta: pmOverlapMin / 60,
        shiftCountDelta: 1,
      })
    }
  }

  // 4c. Enriquecimiento de líderes en turno desde `schedules` y `assistant_checklists`
  for (const sch of scheduleRows) {
    const sid = Number(sch.store_id)
    const usr = userByIdNameRole.get(Number(sch.user_id))
    if (!usr) continue
    const r = usr.role.toLowerCase()
    if (r !== 'manager' && r !== 'asistente' && r !== 'assistant') continue
    const label = String(sch.shift_label || '').toLowerCase()
    const startHour = parseInt(String(sch.start_time || '08:00').slice(0, 2), 10)
    const shift: 'AM' | 'PM' = label.includes('tarde') || label.includes('noche') || startHour >= 14 ? 'PM' : 'AM'
    upsertStaffMember(sid, shift, usr.name.toLowerCase(), {
      name: usr.name,
      role: r === 'manager' ? 'Gerente' : 'Asistente',
      category: 'leader',
      hoursDelta: 8,
      shiftCountDelta: 1,
    })
  }

  for (const chk of checklistRows) {
    const sid = Number(chk.store_id)
    const uName = String(chk.user_name || '').trim()
    if (!uName) continue
    const shift: 'AM' | 'PM' = String(chk.shift || '').toUpperCase() === 'PM' ? 'PM' : 'AM'
    upsertStaffMember(sid, shift, uName.toLowerCase(), {
      name: uName,
      role: 'Asistente Checklist',
      category: 'leader',
      hoursDelta: 0,
      shiftCountDelta: 1,
    })
  }

  const getSortedShiftStaff = (storeId: number, shift: 'AM' | 'PM'): ShiftStaffMember[] => {
    const m = staffAccByStoreShift.get(`${storeId}|${shift}`)
    if (!m) return []
    return Array.from(m.values())
      .sort((a, b) => {
        if (a.category !== b.category) return a.category === 'grill' ? -1 : 1
        if (b.hours !== a.hours) return b.hours - a.hours
        return b.shiftsWorked - a.shiftsWorked
      })
      .slice(0, 8)
  }

  // Indexar alertas previas para idempotencia y detección de reincidencia
  const existingByWindowKey = new Map<string, any>()
  const openPriorByStoreMeat = new Set<string>()
  for (const pa of priorAlertsRows) {
    const wKey = `${Number(pa.store_id)}|${pa.period_start}|${pa.period_end}|${pa.meat_key}`
    existingByWindowKey.set(wKey, pa)
    if (pa.status !== 'resolved' && pa.status !== 'verified') {
      openPriorByStoreMeat.add(`${Number(pa.store_id)}|${pa.meat_key}|${pa.period_end}`)
    }
  }

  // 5. Evaluar Balance de Masas Telescópico por tienda × proteína
  let evaluatedSpans = 0
  const triggeredAlerts: ComputedPortionAlert[] = []

  for (const store of stores) {
    const storeId = Number(store.id)
    const escalera = escaleraMap.get(storeId)!
    const fcAgg = fcTotalsByStore.get(storeId)
    const storeFoodCostPct = fcAgg ? calculateSafeFoodCostPct(fcAgg.cost, fcAgg.sales) : 0
    const amStaff = getSortedShiftStaff(storeId, 'AM')
    const pmStaff = getSortedShiftStaff(storeId, 'PM')

    for (const bench of activeBenchmarks) {
      const dateMap = humanCountsIndex.get(`${storeId}|${bench.inventoryItemId}`)
      if (!dateMap || dateMap.size < 2) continue

      const sortedDates = Array.from(dateMap.keys()).sort()
      // Seleccionar t1 = último conteo humano <= resolvedEndDate (dentro del rango objetivo)
      const t1Candidates = sortedDates.filter((d) => d >= resolvedStartDate && d <= resolvedEndDate)
      if (t1Candidates.length === 0) continue
      const t1 = t1Candidates[t1Candidates.length - 1]

      // Seleccionar t0 = conteo humano más cercano a `resolvedStartDate - 1` (o el primero disponible < t1)
      const targetT0 = addDaysIso(resolvedStartDate, -1)
      const t0Candidates = sortedDates.filter((d) => d < t1)
      if (t0Candidates.length === 0) continue

      let t0 = t0Candidates[0]
      let bestDiff = Math.abs(diffCalendarDays(targetT0, t0))
      for (const cand of t0Candidates) {
        const diff = Math.abs(diffCalendarDays(targetT0, cand))
        if (diff < bestDiff) {
          bestDiff = diff
          t0 = cand
        }
      }

      const spanDays = diffCalendarDays(t0, t1)
      if (spanDays < 2) continue

      evaluatedSpans++

      const countT0 = dateMap.get(t0)!.bags
      const countT1 = dateMap.get(t1)!.bags
      const bagWeightLbs = resolveHistoricalBagWeightLbs(bench, t1)

      const liveItem = itemLiveCostMap.get(bench.inventoryItemId)
      const storeCostPerBag = liveItem && liveItem.purchaseCost > 0 ? liveItem.purchaseCost : bench.defaultStoreBagCost
      const costRatio = bench.defaultStoreBagCost > 0 ? storeCostPerBag / bench.defaultStoreBagCost : 1
      const bodegaCostPerBag = round2(bench.defaultBodegaBagCost * costRatio)
      const yieldFactor = liveItem && liveItem.yieldFactor > 0 ? liveItem.yieldFactor : bench.defaultYieldFactor

      // Sumar entregas en [t0, t1)
      let arrivedBags = 0
      for (let d = t0; d < t1; d = addDaysIso(d, 1)) {
        arrivedBags += arrivedByStoreItemDate.get(`${storeId}|${bench.inventoryItemId}|${d}`) || 0
      }

      // Sumar consumo exacto Toast POS (`PMIX` con `bundleModifiers: true`) en (t0, t1] y proporción AM vs PM
      let exactTheoLbs = 0
      let histAmLbs = 0
      let histPmLbs = 0
      let spanTacos = 0
      let spanBurritos = 0
      let spanQuesadillas = 0
      let spanMulitas = 0
      let spanTortas = 0
      let spanPlates = 0
      let spanPartyTraysLbs = 0
      let measuredAmActualLbs = 0
      let measuredPmActualLbs = 0
      let handoverDaysCount = 0

      for (let d = addDaysIso(t0, 1); d <= t1; d = addDaysIso(d, 1)) {
        const exactDay = exactToastByStoreMeatDate.get(`${storeId}|${bench.key}|${d}`)
        if (exactDay) {
          exactTheoLbs += exactDay.rawLbs
          spanTacos += exactDay.tacosUnits
          spanBurritos += exactDay.burritosUnits
          spanQuesadillas += exactDay.quesadillasUnits
          spanMulitas += exactDay.mulitasUnits
          spanTortas += exactDay.tortasUnits
          spanPlates += exactDay.platesUnits
          spanPartyTraysLbs += exactDay.partyTraysCookedLbs
        }
        const bucket = theoByStoreMeatDate.get(`${storeId}|${bench.historyMeatType}|${d}`)
        if (bucket) {
          histAmLbs += bucket.am
          histPmLbs += bucket.pm
        }

        const ho = handoverIndex.get(`${storeId}|${bench.key}|${d}`)
        const prevDate = addDaysIso(d, -1)
        const openDayCount = dateMap.get(prevDate)
        const closeDayCount = dateMap.get(d)
        if (ho && openDayCount && closeDayCount) {
          const morningArrivedBags = arrivedByStoreItemDate.get(`${storeId}|${bench.inventoryItemId}|${prevDate}`) || 0
          const handover5pmRawLbs = ho.sealedBags * bagWeightLbs + (yieldFactor > 0 ? ho.openCookedLbs / yieldFactor : ho.openCookedLbs)
          const dayAmActual = Math.max(0, (openDayCount.bags + morningArrivedBags) * bagWeightLbs - handover5pmRawLbs)
          const dayPmActual = Math.max(0, handover5pmRawLbs - closeDayCount.bags * bagWeightLbs)
          measuredAmActualLbs += dayAmActual
          measuredPmActualLbs += dayPmActual
          handoverDaysCount++
        }
      }

      const histTotalLbs = histAmLbs + histPmLbs
      const theoreticalLbs = exactTheoLbs > 0 ? exactTheoLbs : histTotalLbs
      if (theoreticalLbs <= 0) continue

      const amShareRatio = histTotalLbs > 0 ? histAmLbs / histTotalLbs : 0.45
      const amTheoLbs = theoreticalLbs * amShareRatio
      const pmTheoLbs = Math.max(0, theoreticalLbs - amTheoLbs)

      const rawActualBags = countT0 + arrivedBags - countT1
      if (rawActualBags < 0) continue
      const actualBags = rawActualBags
      const actualLbs = actualBags * bagWeightLbs
      const varianceLbs = actualLbs - theoreticalLbs
      const varianceBags = bagWeightLbs > 0 ? varianceLbs / bagWeightLbs : 0
      const variancePct = (varianceLbs / theoreticalLbs) * 100

      const storeCostPerRawLb = bagWeightLbs > 0 ? storeCostPerBag / bagWeightLbs : 0
      const bodegaCostPerRawLb = bagWeightLbs > 0 ? bodegaCostPerBag / bagWeightLbs : 0
      const dollarLossStore = Math.max(0, varianceLbs * storeCostPerRawLb)
      const dollarLossBodega = Math.max(0, varianceLbs * bodegaCostPerRawLb)

      const severity = evaluatePortionAlertSeverity({
        meatKey: bench.key,
        spanDays,
        varianceLbs,
        varianceBags,
        variancePct,
        dollarLossStore,
        storeFoodCostPct,
      })

      if (!severity) continue

      // Si todos los días medidos tuvieron corte 5PM usamos la suma exacta; si fue parcial, combinamos días medidos + resto ponderado
      let amActualLbs: number | null = null
      let pmActualLbs: number | null = null
      if (handoverDaysCount > 0) {
        if (handoverDaysCount >= spanDays) {
          amActualLbs = round2(measuredAmActualLbs)
          pmActualLbs = round2(measuredPmActualLbs)
        } else {
          const remainingActual = Math.max(0, actualLbs - (measuredAmActualLbs + measuredPmActualLbs))
          const amShare = theoreticalLbs > 0 ? amTheoLbs / theoreticalLbs : 0.5
          amActualLbs = round2(measuredAmActualLbs + remainingActual * amShare)
          pmActualLbs = round2(measuredPmActualLbs + remainingActual * (1 - amShare))
        }
      }

      let dominantShift: DominantShift = 'BOTH'
      if (amActualLbs !== null && pmActualLbs !== null) {
        const amVar = amActualLbs - amTheoLbs
        const pmVar = pmActualLbs - pmTheoLbs
        if (amVar > 0 && amVar >= pmVar * 1.25) dominantShift = 'AM'
        else if (pmVar > 0 && pmVar >= amVar * 1.25) dominantShift = 'PM'
      } else {
        const amShare = amTheoLbs / theoreticalLbs
        const pmShare = pmTheoLbs / theoreticalLbs
        if (amShare >= 0.58) dominantShift = 'AM'
        else if (pmShare >= 0.58) dominantShift = 'PM'
      }

      const periodStart = addDaysIso(t0, 1)
      const periodEnd = t1
      const windowKey = `${storeId}|${periodStart}|${periodEnd}|${bench.key}`
      const existingRow = existingByWindowKey.get(windowKey)

      const hasRepeatedUnresolved = Array.from(openPriorByStoreMeat).some((entry) => {
        const [sidStr, mKey, pEnd] = entry.split('|')
        return Number(sidStr) === storeId && mKey === bench.key && pEnd !== periodEnd
      })

      const escalatedToExecs =
        severity === 'critical' && (dollarLossStore >= 500 || hasRepeatedUnresolved)

      // Exceso en oz cocidas por taco estándar de 1.5 oz: `1.5 * (varianceLbs / theoreticalLbs)`
      const excessOzPerTaco = round3(Math.max(0, 1.5 * (varianceLbs / theoreticalLbs)))

      triggeredAlerts.push({
        id: existingRow?.id,
        store_id: storeId,
        store_name: store.name,
        period_start: periodStart,
        period_end: periodEnd,
        anchor_t0: t0,
        anchor_t1: t1,
        span_days: spanDays,
        meat_key: bench.key,
        meat_name: bench.displayName,
        inventory_item_id: bench.inventoryItemId,
        bag_weight_lbs: bagWeightLbs,
        store_cost_per_bag: storeCostPerBag,
        bodega_cost_per_bag: bodegaCostPerBag,
        yield_factor: yieldFactor,
        count_t0_bags: round2(countT0),
        arrived_bags: round2(arrivedBags),
        count_t1_bags: round2(countT1),
        theoretical_lbs: round2(theoreticalLbs),
        actual_lbs: round2(actualLbs),
        variance_lbs: round2(varianceLbs),
        variance_bags: round2(varianceBags),
        variance_pct: round2(variancePct),
        excess_oz_per_taco: excessOzPerTaco,
        dollar_loss_store: round2(dollarLossStore),
        dollar_loss_bodega: round2(dollarLossBodega),
        store_food_cost_pct: round2(storeFoodCostPct),
        dominant_shift: dominantShift,
        am_theo_lbs: round2(amTheoLbs),
        pm_theo_lbs: round2(pmTheoLbs),
        am_actual_lbs: amActualLbs,
        pm_actual_lbs: pmActualLbs,
        handover_days_count: handoverDaysCount,
        am_staff: amStaff,
        pm_staff: pmStaff,
        manager_email: escalera.managerEmail,
        assistant_emails: escalera.assistantEmails,
        supervisor_email: escalera.supervisorEmail,
        escalated_to_execs: escalatedToExecs,
        severity,
        status: (existingRow?.status as AlertWorkflowStatus) || 'open',
        dish_equivalence_summary: {
          tacosSold: round2(spanTacos),
          burritosSold: round2(spanBurritos),
          quesadillasSold: round2(spanQuesadillas),
          mulitasSold: round2(spanMulitas),
          tortasSold: round2(spanTortas),
          platesSold: round2(spanPlates),
          partyTraysCookedLbs: round2(spanPartyTraysLbs),
          toastSoldBags: bagWeightLbs > 0 ? round2(theoreticalLbs / bagWeightLbs) : 0,
          fridgeUsedBags: round2(actualBags),
          unbilledTacosEquiv: Math.round((varianceLbs * yieldFactor * 16) / 1.5),
        },
        email_sent_at: existingRow?.email_sent_at || null,
      })
    }
  }

  // Ordenar: Carne Asada primero, luego Crítico > Warning, luego mayor pérdida en USD
  triggeredAlerts.sort((a, b) => {
    if ((a.meat_key === 'asada') !== (b.meat_key === 'asada')) {
      return a.meat_key === 'asada' ? -1 : 1
    }
    if (a.severity !== b.severity) {
      return a.severity === 'critical' ? -1 : 1
    }
    return b.dollar_loss_store - a.dollar_loss_store
  })

  // 6. Persistencia idempotente y envío de correos + notificaciones de campana
  let persistedCount = 0
  const emailsDispatched: DispatchedEmailSummary[] = []

  for (const alert of triggeredAlerts) {
    const escalera = escaleraMap.get(alert.store_id)!
    const effectiveTo = safeTestTo ? [safeTestTo] : escalera.toEmails

    const ccSet = new Set<string>()
    if (!safeTestTo) {
      if (escalera.supervisorEmail && !effectiveTo.includes(escalera.supervisorEmail)) {
        ccSet.add(escalera.supervisorEmail)
      }
      if (alert.escalated_to_execs) {
        for (const execEmail of DEFAULT_LEADERSHIP_CC) {
          if (!effectiveTo.includes(execEmail)) ccSet.add(execEmail)
        }
      }
    }
    const effectiveCc = Array.from(ccSet)
    const effectiveBcc = !safeTestTo && alert.escalated_to_execs ? ['carlos@tacosgavilan.com'] : []
    const { subject, html } = buildPortionControlEmailHtml(alert, escalera, Boolean(safeTestTo))

    if (dryRun) {
      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: false,
        dryRun: true,
      })
      continue
    }

    // Upsert sin pisar campos de seguimiento si la fila ya existía
    const upsertPayload = {
      store_id: alert.store_id,
      store_name: alert.store_name,
      period_start: alert.period_start,
      period_end: alert.period_end,
      span_days: alert.span_days,
      meat_key: alert.meat_key,
      meat_name: alert.meat_name,
      inventory_item_id: alert.inventory_item_id,
      theoretical_lbs: alert.theoretical_lbs,
      actual_lbs: alert.actual_lbs,
      variance_lbs: alert.variance_lbs,
      variance_bags: alert.variance_bags,
      variance_pct: alert.variance_pct,
      excess_oz_per_taco: alert.excess_oz_per_taco,
      dollar_loss_store: alert.dollar_loss_store,
      dollar_loss_bodega: alert.dollar_loss_bodega,
      dominant_shift: alert.dominant_shift,
      am_theo_lbs: alert.am_theo_lbs,
      pm_theo_lbs: alert.pm_theo_lbs,
      am_actual_lbs: alert.am_actual_lbs,
      pm_actual_lbs: alert.pm_actual_lbs,
      am_staff: alert.am_staff,
      pm_staff: alert.pm_staff,
      manager_email: alert.manager_email,
      assistant_emails: alert.assistant_emails,
      supervisor_email: alert.supervisor_email,
      escalated_to_execs: alert.escalated_to_execs,
      severity: alert.severity,
      dish_equivalence_summary: alert.dish_equivalence_summary || null,
    }

    const { data: savedRow, error: upsertErr } = await supabase
      .from('portion_control_alerts')
      .upsert(upsertPayload, { onConflict: 'store_id,period_start,period_end,meat_key' })
      .select('id, email_sent_at, status')
      .single()

    if (upsertErr) {
      console.error(`[PortionAlerts] Error guardando alerta ${alert.store_name} ${alert.meat_key}:`, upsertErr.message)
      continue
    }

    persistedCount++
    alert.id = savedRow.id
    alert.email_sent_at = savedRow.email_sent_at
    alert.status = (savedRow.status as AlertWorkflowStatus) || 'open'

    if (!sendEmails) continue

    // En modo de Semana de Pruebas (`isPortionAlertsWeeklyTestMode()`), cuando se escanean las 15 tiendas juntas,
    // enviamos solo la alerta prioritaria #1 de Carne Asada si aún no se envió para no saturar el correo de Carlos
    const alreadyEmailed = Boolean(savedRow.email_sent_at)
    if (alreadyEmailed && !forceResend) {
      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: false,
        skippedDuplicate: true,
      })
      continue
    }

    if (safeTestTo && stores.length > 1 && emailsDispatched.some((e) => e.sent)) {
      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: false,
        skippedDuplicate: true,
      })
      continue
    }

    if (effectiveTo.length === 0) {
      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: [],
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: false,
        error: 'Sin destinatarios activos configurados en la sucursal',
      })
      continue
    }

    try {
      const mailRes = await sendSystemEmail({
        fromName: 'Sistema de Monitoreo',
        to: effectiveTo,
        cc: effectiveCc.length > 0 ? effectiveCc : undefined,
        bcc: effectiveBcc.length > 0 ? effectiveBcc : undefined,
        subject,
        html,
      })

      let bellInserted = 0
      const sentIso = new Date().toISOString()
      await supabase
        .from('portion_control_alerts')
        .update({ email_sent_at: sentIso })
        .eq('id', savedRow.id)
      alert.email_sent_at = sentIso

      if (!safeTestTo && escalera.bellUserIds.length > 0) {
          const notifTitle = `${alert.severity === 'critical' ? '🚨' : '⚠️'} Porción ${alert.meat_name}: #${alert.store_id} ${alert.store_name}`
          const notifMsg = `Exceso físico de +${alert.variance_bags.toFixed(1)} bolsas (+${formatSignedUSD(alert.dollar_loss_store)}) en ${alert.span_days}d (${alert.period_start}..${alert.period_end}). Revisa gramaje y registra acción.`
          const bellRows = escalera.bellUserIds.map((uid) => ({
            user_id: String(uid),
            type: alert.severity === 'critical' ? 'alert' : 'warning',
            title: notifTitle,
            message: notifMsg,
            link: `/admin/food-cost/meats?store_id=${encodeURIComponent(String(alert.store_id))}&startDate=${encodeURIComponent(alert.period_start)}&endDate=${encodeURIComponent(alert.period_end)}&meat=${encodeURIComponent(alert.meat_key)}`,
            reference_id: String(savedRow.id),
            reference_type: 'portion_control_alert',
          }))
        const { error: bellErr } = await supabase.from('notifications').insert(bellRows)
        if (!bellErr) bellInserted = bellRows.length
      }

      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: true,
        providerUsed: mailRes.providerUsed,
        bellCount: bellInserted,
      })
    } catch (mailErr: any) {
      emailsDispatched.push({
        storeId: alert.store_id,
        storeName: alert.store_name,
        meatKey: alert.meat_key,
        severity: alert.severity,
        to: effectiveTo,
        cc: effectiveCc,
        bcc: effectiveBcc,
        subject,
        sent: false,
        error: mailErr?.message || String(mailErr),
      })
    }
  }

  return {
    periodStart: resolvedStartDate,
    periodEnd: resolvedEndDate,
    anchorLookbackStart,
    dryRun,
    evaluatedSpans,
    triggeredAlerts,
    persistedCount,
    emailsDispatched,
  }
}

/**
 * Reenvía o envía manualmente por correo una alerta ya persistida en `public.portion_control_alerts`.
 */
export async function sendExistingPortionAlertById(params: {
  alertId: string
  dryRun?: boolean
  testTo?: string | null
}): Promise<DispatchedEmailSummary> {
  const supabase = await getSupabaseAdminClient()
  const testCheck = validateTestToEmail(params.testTo)
  if (!testCheck.valid) {
    throw new Error(testCheck.error || 'Invalid testTo email')
  }

  const { data: row, error } = await supabase
    .from('portion_control_alerts')
    .select('*')
    .eq('id', params.alertId)
    .maybeSingle()

  if (error || !row) {
    throw new Error('Alerta de control de porciones no encontrada')
  }

  const [{ data: storeRow }, { data: usersData }] = await Promise.all([
    supabase
      .from('stores')
      .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
      .eq('id', row.store_id)
      .single(),
    supabase
      .from('users')
      .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active')
      .limit(2000),
  ])

  if (!storeRow) {
    throw new Error(`Sucursal #${row.store_id} no encontrada`)
  }

  const escaleraMap = buildEscaleraByStore([storeRow as any], usersData || [])
  const escalera = escaleraMap.get(Number(row.store_id))!
  const bench = MEAT_BENCHMARKS.find((b) => b.key === row.meat_key) || MEAT_BENCHMARKS[0]
  const bagWeight = resolveHistoricalBagWeightLbs(bench, String(row.period_end))

  const alertObj: ComputedPortionAlert = {
    id: row.id,
    store_id: Number(row.store_id),
    store_name: row.store_name,
    period_start: row.period_start,
    period_end: row.period_end,
    anchor_t0: addDaysIso(row.period_start, -1),
    anchor_t1: row.period_end,
    span_days: Number(row.span_days) || 7,
    meat_key: bench.key,
    meat_name: row.meat_name,
    inventory_item_id: row.inventory_item_id || bench.inventoryItemId,
    bag_weight_lbs: bagWeight,
    store_cost_per_bag: bench.defaultStoreBagCost,
    bodega_cost_per_bag: bench.defaultBodegaBagCost,
    yield_factor: bench.defaultYieldFactor,
    count_t0_bags: 0,
    arrived_bags: round2(Number(row.actual_lbs || 0) / bagWeight),
    count_t1_bags: 0,
    theoretical_lbs: Number(row.theoretical_lbs) || 0,
    actual_lbs: Number(row.actual_lbs) || 0,
    variance_lbs: Number(row.variance_lbs) || 0,
    variance_bags: Number(row.variance_bags) || 0,
    variance_pct: Number(row.variance_pct) || 0,
    excess_oz_per_taco: Number(row.excess_oz_per_taco) || 0,
    dollar_loss_store: Number(row.dollar_loss_store) || 0,
    dollar_loss_bodega: Number(row.dollar_loss_bodega) || 0,
    store_food_cost_pct: 0,
    dominant_shift: (row.dominant_shift as DominantShift) || 'BOTH',
    am_theo_lbs: Number(row.am_theo_lbs) || 0,
    pm_theo_lbs: Number(row.pm_theo_lbs) || 0,
    am_actual_lbs: row.am_actual_lbs !== null ? Number(row.am_actual_lbs) : null,
    pm_actual_lbs: row.pm_actual_lbs !== null ? Number(row.pm_actual_lbs) : null,
    handover_days_count: row.am_actual_lbs !== null ? 1 : 0,
    am_staff: Array.isArray(row.am_staff) ? row.am_staff : [],
    pm_staff: Array.isArray(row.pm_staff) ? row.pm_staff : [],
    manager_email: escalera.managerEmail,
    assistant_emails: escalera.assistantEmails,
    supervisor_email: escalera.supervisorEmail,
    escalated_to_execs: Boolean(row.escalated_to_execs),
    severity: (row.severity as AlertSeverity) || 'warning',
    status: (row.status as AlertWorkflowStatus) || 'open',
  }

  const safeTestTo = testCheck.email
  const effectiveTo = safeTestTo ? [safeTestTo] : escalera.toEmails
  const ccSet = new Set<string>()
  if (!safeTestTo) {
    if (escalera.supervisorEmail && !effectiveTo.includes(escalera.supervisorEmail)) {
      ccSet.add(escalera.supervisorEmail)
    }
    if (alertObj.escalated_to_execs) {
      for (const execEmail of DEFAULT_LEADERSHIP_CC) {
        if (!effectiveTo.includes(execEmail)) ccSet.add(execEmail)
      }
    }
  }
  const effectiveCc = Array.from(ccSet)
  const effectiveBcc = !safeTestTo && alertObj.escalated_to_execs ? ['carlos@tacosgavilan.com'] : []
  const { subject, html } = buildPortionControlEmailHtml(alertObj, escalera, Boolean(safeTestTo))

  if (params.dryRun) {
    return {
      storeId: alertObj.store_id,
      storeName: alertObj.store_name,
      meatKey: alertObj.meat_key,
      severity: alertObj.severity,
      to: effectiveTo,
      cc: effectiveCc,
      bcc: effectiveBcc,
      subject,
      sent: false,
      dryRun: true,
    }
  }

  const mailRes = await sendSystemEmail({
    fromName: 'Sistema de Monitoreo',
    to: effectiveTo,
    cc: effectiveCc.length > 0 ? effectiveCc : undefined,
    bcc: effectiveBcc.length > 0 ? effectiveBcc : undefined,
    subject,
    html,
  })

  if (!safeTestTo) {
    await supabase
      .from('portion_control_alerts')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', row.id)
  }

  return {
    storeId: alertObj.store_id,
    storeName: alertObj.store_name,
    meatKey: alertObj.meat_key,
    severity: alertObj.severity,
    to: effectiveTo,
    cc: effectiveCc,
    bcc: effectiveBcc,
    subject,
    sent: true,
    providerUsed: mailRes.providerUsed,
  }
}
