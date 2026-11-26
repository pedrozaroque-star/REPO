/**
 * @module lib/inventory/toast-meat-sold-resolver
 * @description Motor unificado y autoritativo del Medidor "Lo que se vende en Toast vs. Lo que hay en el Refrigerador"
 *   para Carne Asada (#1 prioridad) y las 8 proteínas activas en las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - **Una Sola Fuente Exacta de Ventas Toast POS (`pmix_daily_cache` con `bundleModifiers: true` + fallback en vivo)**:
 *   * Elimina la discrepancia histórica entre `meat_consumption_history` (que truncaba recetas a 1,000 filas y omitía Party Trays)
 *     y `PMIX` en `/admin/food-cost/meats`, `/admin/food-cost/varianza` y `portion-control-alerts`.
 *   * Aplica las 4 ramas deterministas por platillo y modificador:
 *     1. `Party Trays / Fiesta Platters` (`buildPartyTrayVirtualIngredients` 15-20, 20-25, 25-30, 30-40 personas).
 *     2. `Taco Plate` (`resolveTacoPlateProteinPortion`: 3 sub-tacos = `4.5 oz` cocidas repartidas según selección).
 *     3. `parseProteinAllocation` (`Half 50/50`, `Carne Dorada 1.9 oz`, `Double/Extra +100%`, `Meat Only 12 oz`, `Catering 2/6/12 lb`, `Side Order 6 oz`).
 *     4. Receta directa paginada de `public.recipes` respetando estrictamente `r.type === 'raw'` (`Chorizo`) vs `'cooked' | 'food'`.
 * - **Libro Diario Real del Refrigerador (`Orden Diaria` Bolsas Cerradas + Facturas QBO de La Bodega)**:
 *   * Respeta el contrato oficial: en `Orden Diaria` las carnes se cuentan **exclusivamente en bolsas cerradas**
 *     (excluyendo `AUTO_CYCLE_V2` y capturas aisladas de sábado `dow === 6`).
 *   * Reconcilia facturas reales despachadas por La Bodega en QuickBooks Online (`reconcileStoreOrdersWithQbInvoices` → `qb_invoice_number`, `final_qty`).
 *   * Une naturalmente `Sábado + Domingo` en un solo corte de fin de semana (pedido del viernes llega el sábado para ambos días y cierra el domingo).
 *   * Si entre semana faltó un conteo humano intermedio, agrupa honestamente el tramo entre los dos conteos humanos reales sin inventar cifras.
 *   * **Cero ocultamiento de conteos negativos**: si `Refri Inicial + Llegadas Bodega - Refri Cierre < 0`, NO lo trunca en silencio a `0`;
 *     marca `hasCountAnomaly = true` para evidenciar errores de captura física en cámara fría.
 *
 * @dataFlow
 *   `pmix_daily_cache` / `getProductMix(bundleModifiers: true)` + `recipes` + `inventory_items` + `inventory_price_history`
 *   + `inventory_counts` + `inventory_orders`/`inventory_order_lines` (`QBO Invoices`)
 *   → `computeStoreToastVsFridgeMeter()` → `/api/inventory/meat-analysis`, `/api/food-cost/variance-avt`, `portion-control-alerts`.
 *
 * @notes
 * - [2026-11-24] BLINDAJE FOOD COST:
 *   * `pmix_daily_cache` se lee exclusivamente mediante `readPmixDailyCacheChunked` (lotes secuenciales <= 15 filas = ~3.2 MB/lote)
 *     en lugar de `fetchAllPaginated(1000)` (~182–472 MB JSONB en 1 sola petición), eliminando `57014 statement timeout` y OOM en `ci_small`.
 *   * Añadido caché TTL de 5 min para catálogos estáticos (`recipes`, `inventory_items`, `toast_menu_items`),
 *     single-flight + caché TTL de 60s para ventanas cerradas en `loadToastMeatContext`, y 1 sola llamada global QBO en vez de 15 en paralelo.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix, type ProductMixItem } from '@/lib/toast-pmix'
import {
  isPmixCacheRowFinalized,
  PMIX_SAFE_CHUNK_ROWS,
  readPmixDailyCacheChunked,
} from '@/lib/inventory/pmix-cache-reader'
import {
  ACTIVE_PROTEIN_IDS,
  MEAT_COOKING_YIELDS,
  MEAT_DEFAULT_BAG_LBS,
  getMeatDefaultBagLbs,
  parseProteinAllocation,
  type ActiveProteinKey,
} from '@/lib/inventory/meat-allocation'
import {
  buildPartyTrayVirtualIngredients,
  isPartyTrayMenuItem,
} from '@/lib/inventory/party-tray-guidelines'
import { getConversionFactor } from '@/lib/inventory/recipe-calculations'
import {
  addDaysIso,
  buildLAInstant,
  diffCalendarDays,
  getBusinessDateLA,
  getLANowParts,
  isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  classifyMeatDishFamily,
  extractBaseMenuItemName,
  isTacoPlateMenuItem,
  resolveExactUnitsServedForLine,
  resolveTacoPlateProteinPortion,
  type DishFamilyKey,
} from '@/lib/inventory/meat-dish-equivalence'
import {
  buildStoreItemDateNetTransferMap,
  fetchConfirmedStoreTransfers,
} from '@/lib/inventory/store-transfers'
import { reconcileStoreOrdersWithQbInvoices } from '@/lib/inventory/qb-shipped-reconciliation'

export const BAG_CUTOVER_DATE = '2026-07-24'

export const PROTEIN_ID_TO_KEY = new Map<string, ActiveProteinKey>(
  (Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>).map(([k, id]) => [id, k])
)

export const BODEGA_COST_RATIO_BY_PROTEIN: Record<ActiveProteinKey, number> = {
  asada: 50 / 60,
  pastor: 8.9 / 10.68,
  pollo: 6.5 / 7.5,
  cabeza: 16.6 / 19.92,
  lengua: 17.5 / 21.0,
  chorizo: 1.295 / 1.554,
  carnitas: 1.28 / 1.54,
  buche: 1.32 / 1.6,
}

const SHORT_WEEKDAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SHORT_MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 100) / 100
}

function round4(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 10000) / 10000
}

function normalizeText(val: unknown): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function formatShortDateLabelEs(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate
  const d = new Date(`${isoDate}T12:00:00Z`)
  const dow = SHORT_WEEKDAYS_ES[d.getUTCDay()] || ''
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = SHORT_MONTHS_ES[d.getUTCMonth()] || ''
  return `${dow} ${day} ${mon}`
}

export function getHistoricalMeatBagLbs(
  proteinKey: ActiveProteinKey | undefined,
  dateStr: string,
  fallbackBagLbs = 10
): number {
  if (!proteinKey) return fallbackBagLbs > 0 ? fallbackBagLbs : 10
  if (dateStr < BAG_CUTOVER_DATE) {
    if (proteinKey === 'pastor' || proteinKey === 'pollo') return 10
    if (proteinKey === 'cabeza' || proteinKey === 'lengua') return 5
  }
  return MEAT_DEFAULT_BAG_LBS[proteinKey]
}

export function isHumanPhysicalCountRow(row: {
  counted_by?: string | null
  notes?: string | null
  count_date?: string | null
  quantity_on_hand?: unknown
}): boolean {
  const qty = Number(row.quantity_on_hand)
  if (!Number.isFinite(qty) || qty < 0) return false
  const by = String(row.counted_by || '').trim().toUpperCase()
  if (by === 'AUTO_CYCLE_V2') return false
  if (/auto_cycle/i.test(String(row.notes || ''))) return false
  const d = String(row.count_date || '')
  if (!isValidIsoDate(d)) return false
  // Sábado no tiene cierre independiente en Orden Diaria (consolida en Domingo)
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return false
  return true
}

async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = []
  const pageSize = 1000
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

export interface ToastSoldLineDetail {
  guid: string
  itemName: string
  familyKey: DishFamilyKey
  soldQty: number
  exactUnitsServed: number
  portionQty: number
  unit: string
  cookedLbs: number
  rawLbs: number
  yieldPct: number
  salesAmount: number
  costAmount: number
  bodegaCostAmount: number
  utilityAmount: number
}

export interface StoreDayProteinToastUsage {
  rawLbs: number
  cookedLbs: number
  tacosUnits: number
  burritosUnits: number
  quesadillasUnits: number
  mulitasUnits: number
  tortasUnits: number
  platesUnits: number
  partyTraysCookedLbs: number
}

export interface FridgeLedgerIntervalEntry {
  startDate: string // primer día de venta incluido (t0 + 1)
  endDate: string // fecha del conteo de cierre (t1)
  anchorDate: string | null // fecha del conteo inicial (t0)
  spanDays: number
  periodLabel: string
  isWeekendPair: boolean
  isBridgedMultiDay: boolean
  openingBags: number | null
  openingCountedBy: string | null
  arrivedBags: number
  invoiceNumbers: string[]
  hasUnreconciledSentOrder: boolean
  availableInFridgeBags: number | null
  expectedClosingBags: number | null // Había en Refri − Vendido en Toast = Lo que DEBERÍA quedar al final del día
  closingBags: number | null // Sobrante capturado = Lo que REALMENTE quedó en el refrigerador al final del día
  closingCountedBy: string | null
  fridgeBalanceBags: number | null // Hay en Refri − Debería Quedar (negativo = FALTAN bolsas en el refri 🔴; positivo = QUEDARON de más 🔵)
  fridgeBalanceDollarStore: number | null
  reboundSuspected: boolean // true si el día previo tuvo sobrante inflado (+) y hoy rebotó a faltante (-)
  fridgeUsedBags: number | null
  fridgeUsedRawLbs: number | null
  toastSoldBags: number
  toastSoldRawLbs: number
  tacosSold: number
  burritosSold: number
  varianceBags: number | null
  varianceRawLbs: number | null
  variancePct: number | null
  dollarImpactStore: number | null
  dollarImpactBodega: number | null
  unbilledTacosEquiv: number | null
  hasNegativeCountAnomaly: boolean
  status: 'ok' | 'warning' | 'critical' | 'efficient' | 'count_anomaly' | 'pending_count'
}

export interface StoreFridgeVsToastSummary {
  storeId: number
  storeName: string
  storeCode: string
  hasMeasuredSpan: boolean
  t0: string | null
  t1: string | null
  spanDays: number
  openingBags: number | null
  openingCountedBy: string | null
  arrivedBags: number
  invoiceNumbers: string[]
  expectedEndingBags: number | null // Sobrante inicial + Llegadas Bodega − Vendido Toast en el periodo = Lo que DEBERÍA haber en el refri al cierre final
  closingBags: number | null
  closingCountedBy: string | null
  fridgeUsedBags: number | null
  fridgeUsedRawLbs: number | null
  toastSoldWindowBags: number
  toastSoldWindowRawLbs: number
  toastSoldSpanBags: number
  toastSoldSpanRawLbs: number
  tacosSoldWindow: number
  burritosSoldWindow: number
  varianceBags: number | null
  varianceRawLbs: number | null
  variancePct: number | null
  dollarImpactStore: number | null
  dollarImpactBodega: number | null
  unbilledTacosEquiv: number | null
  hasNegativeCountAnomaly: boolean
  cumulativeFridgeBalanceBags: number | null // negativo = Faltaron bolsas en el periodo 🔴; positivo = Quedaron bolsas a favor 🔵
  cumulativeFridgeBalanceDollarStore: number | null
  latestCloseCut: {
    periodLabel: string
    availableInFridgeBags: number | null
    toastSoldBags: number
    expectedClosingBags: number | null
    closingBags: number | null
    closingCountedBy: string | null
    fridgeBalanceBags: number | null
    fridgeBalanceDollarStore: number | null
  } | null
  dailyLedger: FridgeLedgerIntervalEntry[]
}

export interface LoadedToastMeatContext {
  stores: Array<{
    id: number
    name: string
    code: string
    external_id: string
    supervisor_id: number | null
    supervisor_name: string | null
  }>
  inventoryById: Map<string, any>
  recipesData: any[]
  toastNameByGuid: Map<string, string>
  foodRecipesByGuid: Map<string, any[]>
  guidsByNormalizedMenuName: Map<string, string[]>
  pmixByStoreDate: Map<string, ProductMixItem[]>
}

interface CachedMeatStaticCatalog {
  expiresAt: number
  recipesData: any[]
  inventoryById: Map<string, any>
  toastNameByGuid: Map<string, string>
  foodRecipesByGuid: Map<string, any[]>
  guidsByNormalizedMenuName: Map<string, string[]>
}

const STATIC_CATALOG_TTL_MS = 5 * 60 * 1000 // 5 min para catálogos estáticos
const CLOSED_CONTEXT_TTL_MS = 60 * 1000 // 60s para ventanas cerradas (reuso entre clics de carnes/categorías)
const CLOSED_CONTEXT_MAX_ENTRIES = 6
const MAX_TOAST_MEAT_CONTEXT_SPAN_DAYS = 95

let staticCatalogCache: CachedMeatStaticCatalog | null = null
let staticCatalogInFlight: Promise<CachedMeatStaticCatalog> | null = null

const inFlightToastMeatContext = new Map<string, Promise<LoadedToastMeatContext>>()
const closedToastMeatContextCache = new Map<string, { expiresAt: number; ctx: LoadedToastMeatContext }>()

function setClosedContextBounded(key: string, ctx: LoadedToastMeatContext) {
  if (closedToastMeatContextCache.size >= CLOSED_CONTEXT_MAX_ENTRIES) {
    const firstKey = closedToastMeatContextCache.keys().next().value
    if (firstKey !== undefined) closedToastMeatContextCache.delete(firstKey)
  }
  closedToastMeatContextCache.set(key, { expiresAt: Date.now() + CLOSED_CONTEXT_TTL_MS, ctx })
}

async function loadMeatStaticCatalog(supabase: any): Promise<CachedMeatStaticCatalog> {
  if (staticCatalogCache && staticCatalogCache.expiresAt > Date.now()) {
    return staticCatalogCache
  }
  if (staticCatalogInFlight) {
    return staticCatalogInFlight
  }
  const promise = (async () => {
    const [recipesData, inventoryData, toastMenuItems] = await Promise.all([
      fetchAllPaginated<any>((from, to) =>
        supabase
          .from('recipes')
          .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPaginated<any>((from, to) =>
        supabase
          .from('inventory_items')
          .select('id, name, sku, unit_type, unit_measure, quantity_per_unit, purchase_unit_cost, yield_percent, is_bodega')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllPaginated<any>((from, to) =>
        supabase
          .from('toast_menu_items')
          .select('guid, name')
          .order('guid', { ascending: true })
          .range(from, to)
      ),
    ])

    const inventoryById = new Map<string, any>()
    for (const item of inventoryData) {
      inventoryById.set(String(item.id), item)
    }

    const toastNameByGuid = new Map<string, string>()
    const guidsByNormalizedMenuName = new Map<string, string[]>()
    for (const m of toastMenuItems) {
      const g = String(m.guid || '')
      const n = String(m.name || '')
      if (!g) continue
      toastNameByGuid.set(g, n)
      const norm = normalizeText(n)
      if (norm) {
        const list = guidsByNormalizedMenuName.get(norm) || []
        list.push(g)
        guidsByNormalizedMenuName.set(norm, list)
      }
    }

    const foodRecipesByGuid = new Map<string, any[]>()
    for (const r of recipesData) {
      const rType = String(r.type || 'food')
      if (rType.startsWith('cogs_')) continue
      const g = String(r.toast_menu_item_guid || '')
      if (!g) continue
      const list = foodRecipesByGuid.get(g) || []
      list.push(r)
      foodRecipesByGuid.set(g, list)
    }

    const built: CachedMeatStaticCatalog = {
      expiresAt: Date.now() + STATIC_CATALOG_TTL_MS,
      recipesData,
      inventoryById,
      toastNameByGuid,
      foodRecipesByGuid,
      guidsByNormalizedMenuName,
    }
    staticCatalogCache = built
    return built
  })()

  staticCatalogInFlight = promise
  try {
    return await promise
  } finally {
    if (staticCatalogInFlight === promise) {
      staticCatalogInFlight = null
    }
  }
}

/**
 * Carga en lote (con `pmix_daily_cache` fragmentado en <= 15 filas/lote + fallback en vivo acotado)
 * todo el contexto necesario para calcular el consumo exacto de Toast POS día por día en 1 o en las 15 tiendas.
 */
export async function loadToastMeatContext(params: {
  storeNumericIds?: number[]
  minDate: string
  maxDate: string
  reconcileQbInvoices?: boolean
  maxLiveFallbackCalls?: number
}): Promise<LoadedToastMeatContext> {
  if (!isValidIsoDate(params.minDate) || !isValidIsoDate(params.maxDate) || params.minDate > params.maxDate) {
    throw new Error(`Rango de fechas inválido en loadToastMeatContext: ${params.minDate}..${params.maxDate}`)
  }
  const spanDays = diffCalendarDays(params.minDate, params.maxDate) + 1
  if (spanDays > MAX_TOAST_MEAT_CONTEXT_SPAN_DAYS) {
    throw new Error(
      `Rango de ${spanDays} días excede el límite seguro (${MAX_TOAST_MEAT_CONTEXT_SPAN_DAYS} días) de loadToastMeatContext.`
    )
  }

  const todayLa = getBusinessDateLA()
  const isClosedWindow = params.maxDate < todayLa
  const sortedStoreKey =
    params.storeNumericIds && params.storeNumericIds.length > 0
      ? Array.from(new Set(params.storeNumericIds.map(Number))).sort((a, b) => a - b).join(',')
      : 'all'
  const contextKey = `${sortedStoreKey}|${params.minDate}|${params.maxDate}`

  if (isClosedWindow) {
    const hit = closedToastMeatContextCache.get(contextKey)
    if (hit && hit.expiresAt > Date.now()) {
      return hit.ctx
    }
  }

  const existingInFlight = inFlightToastMeatContext.get(contextKey)
  if (existingInFlight) {
    return existingInFlight
  }

  const workPromise = runLoadToastMeatContext(params, todayLa)
  inFlightToastMeatContext.set(contextKey, workPromise)
  try {
    const built = await workPromise
    if (isClosedWindow) {
      setClosedContextBounded(contextKey, built)
    }
    return built
  } finally {
    if (inFlightToastMeatContext.get(contextKey) === workPromise) {
      inFlightToastMeatContext.delete(contextKey)
    }
  }
}

async function runLoadToastMeatContext(
  params: {
    storeNumericIds?: number[]
    minDate: string
    maxDate: string
    reconcileQbInvoices?: boolean
    maxLiveFallbackCalls?: number
  },
  todayLa: string
): Promise<LoadedToastMeatContext> {
  const supabase = await getSupabaseAdminClient()

  const { data: storesRows, error: storesError } = await supabase
    .from('stores')
    .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })

  if (storesError) throw new Error(storesError.message)

  let stores = (storesRows || [])
    .filter((s: any) => Boolean(s.external_id))
    .map((s: any) => ({
      id: Number(s.id),
      name: String(s.name || `#${s.id}`),
      code: String(s.code || ''),
      external_id: String(s.external_id),
      supervisor_id: s.supervisor_id ? Number(s.supervisor_id) : null,
      supervisor_name: s.supervisor_name ? String(s.supervisor_name) : null,
    }))

  if (params.storeNumericIds && params.storeNumericIds.length > 0) {
    const allowed = new Set(params.storeNumericIds.map(Number))
    stores = stores.filter((s) => allowed.has(s.id))
  }

  // Reconciliar facturas QBO de La Bodega con UNA sola llamada global/por-tienda (cero fan-out de 15× en paralelo)
  // y omitiendo ventanas estrictamente antiguas (> 45 días) donde las órdenes ya fueron conciliadas.
  if (
    params.reconcileQbInvoices !== false &&
    stores.length > 0 &&
    params.maxDate >= addDaysIso(todayLa, -45)
  ) {
    const ageDays = Math.max(7, diffCalendarDays(params.minDate, todayLa) + 5)
    const lookbackDays = Math.min(45, ageDays)
    try {
      await reconcileStoreOrdersWithQbInvoices({
        storeId: stores.length === 1 ? stores[0].id : undefined,
        lookbackDays,
        forceResync: false,
      })
    } catch (qbErr) {
      console.warn('[ToastMeatResolver] Reconciliación QBO omitida por error transitorio:', qbErr)
    }
  }

  const storeGuids = stores.map((s) => s.external_id)

  // 1. Cargar catálogos estáticos desde caché TTL (5 min) ANTES de leer pmix_daily_cache
  const catalog = await loadMeatStaticCatalog(supabase)

  // 2. Leer pmix_daily_cache de forma estrictamente secuencial y fragmentada (<= 15 filas/lote = ~3.2 MB)
  //    Solo consultar fechas cerradas (< todayLa) para no gastar IO en hoy/futuro
  const pmixByStoreDate = new Map<string, ProductMixItem[]>()
  const closedMaxDate = params.maxDate < todayLa ? params.maxDate : addDaysIso(todayLa, -1)
  if (storeGuids.length > 0 && params.minDate <= closedMaxDate) {
    await readPmixDailyCacheChunked(supabase, {
      storeGuids,
      startDate: params.minDate,
      endDate: closedMaxDate,
      includeUpdatedAt: true,
      chunkRows: PMIX_SAFE_CHUNK_ROWS,
      onChunk: (chunk) => {
        for (const row of chunk) {
          const guid = String(row.store_id || '')
          const bDate = String(row.business_date || '')
          if (!guid || !bDate || bDate >= todayLa) continue
          if (!Array.isArray(row.items) || row.items.length === 0) continue
          if (!isPmixCacheRowFinalized(bDate, row.updated_at, todayLa)) continue
          pmixByStoreDate.set(`${guid}::${bDate}`, row.items as ProductMixItem[])
        }
      },
    })
  }

  // 3. Descargar en vivo únicamente cualquier `(store, date)` faltante o del día abierto actual
  //    (nunca fechas futuras, pasando `skipCache: true` si ya confirmamos ausencia en DB y con tope defensivo).
  const allDates: string[] = []
  for (let d = params.minDate; d <= params.maxDate; d = addDaysIso(d, 1)) {
    if (d <= todayLa) allDates.push(d)
  }

  const maxLiveCalls = Math.max(0, params.maxLiveFallbackCalls ?? 20)
  let liveFallbackCount = 0

  for (const store of stores) {
    for (const d of allDates) {
      const key = `${store.external_id}::${d}`
      if (pmixByStoreDate.has(key)) continue
      if (diffCalendarDays(d, todayLa) > 120) continue
      if (liveFallbackCount >= maxLiveCalls) {
        pmixByStoreDate.set(key, [])
        continue
      }
      liveFallbackCount++
      try {
        const liveItems = await getProductMix({
          storeId: store.external_id,
          startDate: d,
          endDate: d,
          bundleModifiers: true,
          // Para fechas pasadas ya verificamos ausencia en `pmix_daily_cache` arriba -> evitar re-hit DB
          skipCache: d < todayLa,
        })
        pmixByStoreDate.set(key, liveItems)
      } catch (err) {
        console.warn(`[ToastMeatResolver] Live PMIX fallback omitido en ${store.name} (${d}):`, err)
        pmixByStoreDate.set(key, [])
      }
    }
  }

  return {
    stores,
    inventoryById: catalog.inventoryById,
    recipesData: catalog.recipesData,
    toastNameByGuid: catalog.toastNameByGuid,
    foodRecipesByGuid: catalog.foodRecipesByGuid,
    guidsByNormalizedMenuName: catalog.guidsByNormalizedMenuName,
    pmixByStoreDate,
  }
}

/**
 * Calcula las libras crudas, libras cocidas y desglose exacto por platillo de una proteína
 * sobre una lista de `ProductMixItem[]` usando la lógica unificada de 4 ramas.
 */
export function evaluatePmixItemsForProtein(params: {
  pmixItems: ProductMixItem[]
  inventoryItemId: string
  proteinKey: ActiveProteinKey | undefined
  yieldPercent: number
  costPerRawLbStore: number
  costPerRawLbBodega: number
  ctx: Pick<LoadedToastMeatContext, 'toastNameByGuid' | 'foodRecipesByGuid' | 'guidsByNormalizedMenuName'>
  collectBreakdownMap?: Map<string, ToastSoldLineDetail>
}): StoreDayProteinToastUsage {
  const {
    pmixItems,
    inventoryItemId,
    proteinKey,
    yieldPercent,
    costPerRawLbStore,
    costPerRawLbBodega,
    ctx,
    collectBreakdownMap,
  } = params

  const yieldRatio = yieldPercent > 0 ? yieldPercent / 100 : 1

  const resolveFoodRecipeRows = (guid: string, rawItemName: string): any[] => {
    const direct = ctx.foodRecipesByGuid.get(guid)
    if (direct && direct.length > 0) return direct
    const baseName = normalizeText(extractBaseMenuItemName(rawItemName))
    const candidateGuids = ctx.guidsByNormalizedMenuName.get(baseName) || []
    for (const cg of candidateGuids) {
      const rows = ctx.foodRecipesByGuid.get(cg)
      if (rows && rows.length > 0) return rows
    }
    return []
  }

  const usage: StoreDayProteinToastUsage = {
    rawLbs: 0,
    cookedLbs: 0,
    tacosUnits: 0,
    burritosUnits: 0,
    quesadillasUnits: 0,
    mulitasUnits: 0,
    tortasUnits: 0,
    platesUnits: 0,
    partyTraysCookedLbs: 0,
  }

  for (const soldItem of pmixItems) {
    const soldQty = Number(soldItem.quantity || 0)
    if (!Number.isFinite(soldQty) || soldQty <= 0) continue

    const itemName = String(soldItem.name || '')
    const modGuids: string[] = Array.isArray(soldItem.modifier_guids) ? soldItem.modifier_guids : []
    const modifierTexts = modGuids.map((mg) => ctx.toastNameByGuid.get(mg) || '').filter(Boolean)
    const uniqueModifierTexts = Array.from(new Set(modifierTexts))
    const combinedNameForAllocation =
      !itemName.includes('(') && uniqueModifierTexts.length > 0
        ? `${itemName} (${uniqueModifierTexts.join(', ')})`
        : itemName

    let itemCookedLbsPerUnit = 0
    let itemRawLbsPerUnit = 0
    let displayPortionQty = 0
    let displayPortionUnit = 'oz'
    let explicitSubUnitsPerOrder: number | undefined = undefined

    if (isPartyTrayMenuItem(itemName, soldItem.guid)) {
      const unitPrice =
        Number(soldItem.unit_price) > 0
          ? Number(soldItem.unit_price)
          : soldQty > 0
            ? Number(soldItem.net_sales || 0) / soldQty
            : 0
      const isDeliveryChannel = /uber|doordash|grubhub|postmates|delivery/i.test(String(soldItem.group_name || ''))
      const virtual = buildPartyTrayVirtualIngredients({
        itemName,
        unitPrice,
        toastGuid: soldItem.guid,
        isDeliveryChannel,
        modifierTexts,
      })
      const matchingLines = virtual.ingredients.filter((ing) => ing.inventory_item_id === inventoryItemId)
      for (const mLine of matchingLines) {
        const lbs = Number(mLine.quantity || 0) * getConversionFactor(mLine.unit, 'lb')
        if (mLine.type === 'raw') {
          itemCookedLbsPerUnit += lbs * yieldRatio
          itemRawLbsPerUnit += lbs
        } else {
          itemCookedLbsPerUnit += lbs
          itemRawLbsPerUnit += yieldRatio > 0 ? lbs / yieldRatio : lbs
        }
        displayPortionQty += Number(mLine.quantity || 0)
        displayPortionUnit = mLine.unit
      }
    } else if (isTacoPlateMenuItem(itemName) && proteinKey) {
      const platePortion = resolveTacoPlateProteinPortion({
        itemName,
        modifierTexts,
        proteinKey,
      })
      if (platePortion.recognizedSlotsCount > 0) {
        if (platePortion.subTacosPerOrder > 0) {
          itemCookedLbsPerUnit = platePortion.cookedOzPerOrder / 16
          itemRawLbsPerUnit = yieldRatio > 0 ? itemCookedLbsPerUnit / yieldRatio : itemCookedLbsPerUnit
          displayPortionQty = round2(platePortion.cookedOzPerOrder)
          displayPortionUnit = 'oz'
          explicitSubUnitsPerOrder = platePortion.subTacosPerOrder
        }
      } else {
        const baseRows = resolveFoodRecipeRows(soldItem.guid, itemName).filter(
          (r) => String(r.inventory_item_id) === inventoryItemId
        )
        for (const r of baseRows) {
          const lbs = Number(r.quantity || 0) * getConversionFactor(r.unit || 'oz', 'lb')
          if (r.type === 'raw') {
            itemCookedLbsPerUnit += lbs * yieldRatio
            itemRawLbsPerUnit += lbs
          } else {
            itemCookedLbsPerUnit += lbs
            itemRawLbsPerUnit += yieldRatio > 0 ? lbs / yieldRatio : lbs
          }
          displayPortionQty += Number(r.quantity || 0)
          displayPortionUnit = r.unit || 'oz'
        }
        if (itemCookedLbsPerUnit > 0) {
          explicitSubUnitsPerOrder = (itemCookedLbsPerUnit * 16) / 1.5
        }
      }
    } else {
      const baseRecipeRows = resolveFoodRecipeRows(soldItem.guid, itemName)
      const allocation = proteinKey
        ? parseProteinAllocation(
            combinedNameForAllocation,
            baseRecipeRows.map((r) => ({
              inventory_item_id: String(r.inventory_item_id),
              quantity: Number(r.quantity || 0),
              unit: String(r.unit || 'oz'),
            }))
          )
        : null

      if (allocation && allocation.replacedBaseMeat) {
        const allocatedOz = allocation.portionsOz.get(inventoryItemId) || 0
        if (allocatedOz > 0) {
          const matchingBaseRow = baseRecipeRows.find((r) => String(r.inventory_item_id) === inventoryItemId)
          const isRawRecipe = matchingBaseRow?.type === 'raw' || proteinKey === 'chorizo'
          const lbs = allocatedOz / 16
          if (isRawRecipe && matchingBaseRow?.type === 'raw') {
            itemCookedLbsPerUnit = lbs * yieldRatio
            itemRawLbsPerUnit = lbs
          } else {
            itemCookedLbsPerUnit = lbs
            itemRawLbsPerUnit = yieldRatio > 0 ? lbs / yieldRatio : lbs
          }
          displayPortionQty = round2(allocatedOz)
          displayPortionUnit = 'oz'
        }
      } else {
        const targetRows = baseRecipeRows.filter((r) => String(r.inventory_item_id) === inventoryItemId)
        for (const r of targetRows) {
          const qty = Number(r.quantity || 0)
          const unit = String(r.unit || 'oz')
          const lbs = qty * getConversionFactor(unit, 'lb')
          if (r.type === 'raw') {
            itemCookedLbsPerUnit += lbs * yieldRatio
            itemRawLbsPerUnit += lbs
          } else {
            itemCookedLbsPerUnit += lbs
            itemRawLbsPerUnit += yieldRatio > 0 ? lbs / yieldRatio : lbs
          }
          displayPortionQty += qty
          displayPortionUnit = unit
        }
      }
    }

    if (itemRawLbsPerUnit <= 0) continue

    const rowRawLbs = itemRawLbsPerUnit * soldQty
    const rowCookedLbs = itemCookedLbsPerUnit * soldQty
    const rowSales = Number(soldItem.net_sales || 0)
    const rowCostStore = rowRawLbs * costPerRawLbStore
    const rowCostBodega = rowRawLbs * costPerRawLbBodega
    const rowUtility = rowSales - rowCostStore
    const rowFamilyKey = classifyMeatDishFamily(itemName, soldItem.guid)
    const rowExactUnitsServed = resolveExactUnitsServedForLine({
      itemName,
      soldQty,
      cookedLbsPerOrder: itemCookedLbsPerUnit,
      explicitSubUnitsPerOrder,
    })

    usage.rawLbs += rowRawLbs
    usage.cookedLbs += rowCookedLbs
    if (rowFamilyKey === 'tacos') usage.tacosUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'burritos') usage.burritosUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'quesadillas') usage.quesadillasUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'mulitas') usage.mulitasUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'tortas') usage.tortasUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'plates_nachos_sides') usage.platesUnits += rowExactUnitsServed
    else if (rowFamilyKey === 'party_trays_lbs') usage.partyTraysCookedLbs += rowCookedLbs

    if (collectBreakdownMap) {
      const displayKey = `${soldItem.guid}::${itemName}`
      const existing = collectBreakdownMap.get(displayKey)
      if (!existing) {
        collectBreakdownMap.set(displayKey, {
          guid: soldItem.guid,
          itemName,
          familyKey: rowFamilyKey,
          soldQty,
          exactUnitsServed: rowExactUnitsServed,
          portionQty: round2(displayPortionQty),
          unit: displayPortionUnit,
          cookedLbs: rowCookedLbs,
          rawLbs: rowRawLbs,
          yieldPct: yieldPercent,
          salesAmount: rowSales,
          costAmount: rowCostStore,
          bodegaCostAmount: rowCostBodega,
          utilityAmount: rowUtility,
        })
      } else {
        existing.soldQty += soldQty
        existing.exactUnitsServed += rowExactUnitsServed
        existing.cookedLbs += rowCookedLbs
        existing.rawLbs += rowRawLbs
        existing.salesAmount += rowSales
        existing.costAmount += rowCostStore
        existing.bodegaCostAmount += rowCostBodega
        existing.utilityAmount += rowUtility
      }
    }
  }

  return usage
}

function resolveTelescopingAnchorPair(
  sortedDates: string[],
  startDate: string,
  endDate: string
): { t0: string; t1: string; spanDays: number } | null {
  const inWindow = sortedDates.filter((d) => d >= startDate && d <= endDate)
  if (inWindow.length === 0) return null
  const t1 = inWindow[inWindow.length - 1]
  const isSingleDay = startDate === endDate
  const startDow = new Date(`${startDate}T12:00:00Z`).getUTCDay()
  const idealMinPre = isSingleDay
    ? addDaysIso(startDate, -3)
    : startDow === 1
      ? addDaysIso(startDate, -3)
      : addDaysIso(startDate, -2)

  const preCandidates = sortedDates.filter((d) => d >= idealMinPre && d < startDate)
  const t0 = preCandidates.length > 0 ? preCandidates[preCandidates.length - 1] : inWindow.length >= 2 ? inWindow[0] : null
  if (!t0 || t0 >= t1) return null
  const spanDays = diffCalendarDays(t0, t1)
  return spanDays >= 1 ? { t0, t1, spanDays } : null
}

/**
 * Construye el medidor completo `Toast Vendido vs. Refrigerador` (resumen telescópico + Libro Diario por tienda)
 * para un insumo proteico en `[startDate, endDate]`.
 */
export async function computeToastVsFridgeForIngredient(params: {
  inventoryItemId: string
  proteinKey: ActiveProteinKey | undefined
  startDate: string
  endDate: string
  storeNumericIds?: number[]
  ctx?: LoadedToastMeatContext
}): Promise<{
  bagWeightLbs: number
  yieldPercent: number
  yieldRatio: number
  bagCostStore: number
  bagCostBodega: number
  costPerRawLbStore: number
  costPerRawLbBodega: number
  costPerCookedLbStore: number
  costPerCookedLbBodega: number
  storesSummaries: StoreFridgeVsToastSummary[]
  breakdownRows: ToastSoldLineDetail[]
  totalToastRawLbs: number
  totalToastCookedLbs: number
  toastByStoreAndDate: Map<string, StoreDayProteinToastUsage>
}> {
  const supabase = await getSupabaseAdminClient()
  const anchorLookbackStart = addDaysIso(params.startDate, -4)

  const ctx =
    params.ctx ||
    (await loadToastMeatContext({
      storeNumericIds: params.storeNumericIds,
      minDate: addDaysIso(anchorLookbackStart, 1),
      maxDate: params.endDate,
      reconcileQbInvoices: true,
    }))

  const targetItem = ctx.inventoryById.get(params.inventoryItemId)
  if (!targetItem) {
    throw new Error(`Insumo no encontrado: ${params.inventoryItemId}`)
  }

  const proteinKey = params.proteinKey
  const bagWeightLbs = getHistoricalMeatBagLbs(
    proteinKey,
    params.endDate,
    getMeatDefaultBagLbs(params.inventoryItemId, Number(targetItem.quantity_per_unit || 10))
  )

  // Resolver precio vigente al cierre de `endDate`
  const priceHistoryRows = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from('inventory_price_history')
      .select('id, inventory_item_id, purchase_unit_cost, quantity_per_unit, effective_date')
      .eq('inventory_item_id', params.inventoryItemId)
      .order('effective_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const endWindowInstantMs = buildLAInstant(addDaysIso(params.endDate, 1), 5, 59).getTime()
  let effectivePurchaseUnitCost = Number(targetItem.purchase_unit_cost || 0)
  let effectiveQtyPerUnit = Number(targetItem.quantity_per_unit || bagWeightLbs || 1)

  for (const ph of priceHistoryRows) {
    const effMs = Date.parse(String(ph.effective_date || ''))
    const costVal = Number(ph.purchase_unit_cost || 0)
    if (Number.isFinite(effMs) && effMs <= endWindowInstantMs && costVal > 0) {
      effectivePurchaseUnitCost = costVal
      if (Number(ph.quantity_per_unit) > 0) {
        effectiveQtyPerUnit = Number(ph.quantity_per_unit)
      }
    }
  }

  const yieldPercent = Number(
    targetItem.yield_percent || (proteinKey ? MEAT_COOKING_YIELDS[proteinKey] * 100 : 100) || 100
  )
  const yieldRatio = yieldPercent > 0 ? yieldPercent / 100 : 1

  let costPerRawLbStore = 0
  if (proteinKey) {
    costPerRawLbStore = bagWeightLbs > 0 ? effectivePurchaseUnitCost / bagWeightLbs : 0
  } else if (effectivePurchaseUnitCost > 0) {
    const qpu = effectiveQtyPerUnit > 0 ? effectiveQtyPerUnit : 1
    const factorToLb = getConversionFactor('lb', targetItem.unit_measure || targetItem.unit_type || 'lb')
    costPerRawLbStore = (effectivePurchaseUnitCost / qpu) * factorToLb
  }

  const bodegaRatio = proteinKey ? BODEGA_COST_RATIO_BY_PROTEIN[proteinKey] ?? 1 / 1.2 : 1 / 1.2
  const costPerRawLbBodega = costPerRawLbStore * bodegaRatio
  const costPerCookedLbStore = yieldRatio > 0 ? costPerRawLbStore / yieldRatio : costPerRawLbStore
  const costPerCookedLbBodega = yieldRatio > 0 ? costPerRawLbBodega / yieldRatio : costPerRawLbBodega

  const targetStoreIds = ctx.stores.map((s) => s.id)
  const targetStoreIdSet = new Set<number>(targetStoreIds)
  const storeGuidToId = new Map<string, number>()
  for (const s of ctx.stores) {
    storeGuidToId.set(s.external_id, s.id)
  }
  const possibleCountStoreTokens = Array.from(
    new Set([...targetStoreIds.map(String), ...ctx.stores.map((s) => s.external_id)])
  )

  const [rawCounts, rawOrderLines, confirmedTransfers] = await Promise.all([
    possibleCountStoreTokens.length > 0
      ? fetchAllPaginated<any>((from, to) =>
          supabase
            .from('inventory_counts')
            .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes, created_at')
            .eq('inventory_item_id', params.inventoryItemId)
            .in('store_id', possibleCountStoreTokens)
            .or('counted_by.is.null,counted_by.neq.AUTO_CYCLE_V2')
            .gte('count_date', anchorLookbackStart)
            .lte('count_date', params.endDate)
            .order('count_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([]),
    targetStoreIds.length > 0
      ? fetchAllPaginated<any>((from, to) =>
          supabase
            .from('inventory_order_lines')
            .select(
              'id, inventory_item_id, final_qty, adjusted_qty, calculated_qty, inventory_orders!inner(id, store_id, order_date, order_type, status, qb_invoice_number)'
            )
            .eq('inventory_item_id', params.inventoryItemId)
            .eq('inventory_orders.order_type', 'daily')
            .in('inventory_orders.status', ['sent', 'received'])
            .in('inventory_orders.store_id', targetStoreIds)
            .gte('inventory_orders.order_date', anchorLookbackStart)
            .lte('inventory_orders.order_date', params.endDate)
            .order('id', { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([]),
    targetStoreIds.length > 0
      ? fetchConfirmedStoreTransfers({
          supabase,
          storeIds: targetStoreIds,
          itemIds: [params.inventoryItemId],
          minDate: anchorLookbackStart,
          maxDate: params.endDate,
        }).catch((err) => {
          console.warn('[ToastMeatResolver] Error leyendo inventory_store_transfers:', err)
          return []
        })
      : Promise.resolve([]),
  ])
  const transferNetMap = buildStoreItemDateNetTransferMap(confirmedTransfers, targetStoreIdSet)

  // 1. Calcular ventas exactas de Toast por `(storeId, businessDate)` desde `addDaysIso(anchorLookbackStart, 1)` hasta `endDate`
  const toastByStoreAndDate = new Map<string, StoreDayProteinToastUsage>()
  const breakdownMap = new Map<string, ToastSoldLineDetail>()
  let totalToastRawLbs = 0
  let totalToastCookedLbs = 0

  const minEvalDate = addDaysIso(anchorLookbackStart, 1)
  for (const store of ctx.stores) {
    for (let d = minEvalDate; d <= params.endDate; d = addDaysIso(d, 1)) {
      const pmixItems = ctx.pmixByStoreDate.get(`${store.external_id}::${d}`) || []
      const inRequestedWindow = d >= params.startDate && d <= params.endDate
      const dayUsage = evaluatePmixItemsForProtein({
        pmixItems,
        inventoryItemId: params.inventoryItemId,
        proteinKey,
        yieldPercent,
        costPerRawLbStore,
        costPerRawLbBodega,
        ctx,
        collectBreakdownMap: inRequestedWindow ? breakdownMap : undefined,
      })
      toastByStoreAndDate.set(`${store.id}::${d}`, dayUsage)
      if (inRequestedWindow) {
        totalToastRawLbs += dayUsage.rawLbs
        totalToastCookedLbs += dayUsage.cookedLbs
      }
    }
  }

  // 2. Indexar conteos físicos humanos del refrigerador por tienda y fecha
  const countsByStore = new Map<number, Map<string, { qty: number; by: string | null; createdAt: string }>>()
  for (const c of rawCounts) {
    if (!isHumanPhysicalCountRow(c)) continue
    const rawS = String(c.store_id || '').trim()
    const sId = /^\d+$/.test(rawS) ? Number(rawS) : storeGuidToId.get(rawS) ?? null
    if (sId === null || !targetStoreIdSet.has(sId)) continue
    let dMap = countsByStore.get(sId)
    if (!dMap) {
      dMap = new Map()
      countsByStore.set(sId, dMap)
    }
    const cDate = String(c.count_date)
    const createdAt = String(c.created_at || '')
    const prev = dMap.get(cDate)
    if (!prev || createdAt >= prev.createdAt) {
      dMap.set(cDate, {
        qty: Number(c.quantity_on_hand),
        by: c.counted_by ? String(c.counted_by) : null,
        createdAt,
      })
    }
  }

  // 3. Indexar llegadas reales de Bodega (`inventory_order_lines` + `qb_invoice_number`)
  const arrivalsByStoreDate = new Map<
    string,
    { qty: number; invoiceNumbers: string[]; hasSentOnly: boolean }
  >()
  for (const ln of rawOrderLines) {
    const ord = Array.isArray(ln.inventory_orders) ? ln.inventory_orders[0] : ln.inventory_orders
    if (!ord) continue
    const sId = Number(ord.store_id)
    if (!targetStoreIdSet.has(sId)) continue
    const d = String(ord.order_date || '')
    const qty = Number(ln.final_qty ?? ln.adjusted_qty ?? ln.calculated_qty ?? 0)
    if (!d || !Number.isFinite(qty) || qty < 0) continue
    const k = `${sId}::${d}`
    const cur = arrivalsByStoreDate.get(k) || { qty: 0, invoiceNumbers: [], hasSentOnly: false }
    cur.qty += qty
    if (ord.qb_invoice_number) {
      const invStr = `#${String(ord.qb_invoice_number).trim()}`
      if (!cur.invoiceNumbers.includes(invStr)) cur.invoiceNumbers.push(invStr)
    } else if (ord.status === 'sent' && qty > 0) {
      cur.hasSentOnly = true
    }
    arrivalsByStoreDate.set(k, cur)
  }

  // 4. Construir resumen y Libro Diario del Refrigerador por cada sucursal
  const storesSummaries: StoreFridgeVsToastSummary[] = []

  for (const store of ctx.stores) {
    const dMap = countsByStore.get(store.id) || new Map()
    const sortedDates = Array.from(dMap.keys()).sort()

    // Totales de venta Toast en la ventana solicitada `[startDate, endDate]`
    let windowToastRawLbs = 0
    let windowTacos = 0
    let windowBurritos = 0
    for (let d = params.startDate; d <= params.endDate; d = addDaysIso(d, 1)) {
      const u = toastByStoreAndDate.get(`${store.id}::${d}`)
      if (u) {
        windowToastRawLbs += u.rawLbs
        windowTacos += u.tacosUnits
        windowBurritos += u.burritosUnits
      }
    }
    const windowToastBags = bagWeightLbs > 0 ? round2(windowToastRawLbs / bagWeightLbs) : 0

    // Construir Libro Diario consecutivo entre conteos humanos reales
    const dailyLedger: FridgeLedgerIntervalEntry[] = []
    const preDates = sortedDates.filter((d) => d < params.startDate)
    let prevAnchorDate: string | null = preDates.length > 0 ? preDates[preDates.length - 1] : null

    const closingDatesInWindow = sortedDates.filter((d) => d >= params.startDate && d <= params.endDate)

    for (const closeDate of closingDatesInWindow) {
      if (!prevAnchorDate) {
        prevAnchorDate = closeDate
        continue
      }
      const spanDays = diffCalendarDays(prevAnchorDate, closeDate)
      if (spanDays < 1 || spanDays > 10) {
        prevAnchorDate = closeDate
        continue
      }

      const firstSaleDate = addDaysIso(prevAnchorDate, 1)
      const openInfo = dMap.get(prevAnchorDate) || null
      const closeInfo = dMap.get(closeDate) || null

      let arrBags = 0
      let arrLbs = 0
      const invNums: string[] = []
      let hasSentOnly = false
      for (let step = 0; step < spanDays; step++) {
        const dOrd = addDaysIso(prevAnchorDate, step)
        const arr = arrivalsByStoreDate.get(`${store.id}::${dOrd}`)
        if (arr) {
          arrBags += arr.qty
          arrLbs += arr.qty * getHistoricalMeatBagLbs(proteinKey, dOrd, bagWeightLbs)
          for (const inv of arr.invoiceNumbers) {
            if (!invNums.includes(inv)) invNums.push(inv)
          }
          if (arr.hasSentOnly) hasSentOnly = true
        }
      }

      let intervalToastRawLbs = 0
      let intervalTacos = 0
      let intervalBurritos = 0
      for (let step = 1; step <= spanDays; step++) {
        const dBiz = addDaysIso(prevAnchorDate, step)
        const tr = transferNetMap.get(`${store.id}::${params.inventoryItemId}::${dBiz}`)
        if (tr && tr.netQty !== 0) {
          arrBags += tr.netQty
          arrLbs += tr.netQty * getHistoricalMeatBagLbs(proteinKey, dBiz, bagWeightLbs)
          for (const tag of tr.transferTags) {
            if (!invNums.includes(tag)) invNums.push(tag)
          }
        }
        const u = toastByStoreAndDate.get(`${store.id}::${dBiz}`)
        if (u) {
          intervalToastRawLbs += u.rawLbs
          intervalTacos += u.tacosUnits
          intervalBurritos += u.burritosUnits
        }
      }
      const intervalToastBags = bagWeightLbs > 0 ? round2(intervalToastRawLbs / bagWeightLbs) : 0

      const wOpen = getHistoricalMeatBagLbs(proteinKey, prevAnchorDate, bagWeightLbs)
      const wClose = getHistoricalMeatBagLbs(proteinKey, closeDate, bagWeightLbs)
      const openBags = openInfo ? round2(openInfo.qty) : null
      const closeBags = closeInfo ? round2(closeInfo.qty) : null
      const availableBags = openBags !== null ? round2(openBags + arrBags) : null

      const rawUsedLbs =
        openInfo && closeInfo ? openInfo.qty * wOpen + arrLbs - closeInfo.qty * wClose : null
      const hasNegativeAnomaly = rawUsedLbs !== null && rawUsedLbs < -0.01
      const usedBags = rawUsedLbs !== null && bagWeightLbs > 0 ? round2(rawUsedLbs / bagWeightLbs) : null
      const varLbs = rawUsedLbs !== null ? round2(rawUsedLbs - intervalToastRawLbs) : null
      const varBags = varLbs !== null && bagWeightLbs > 0 ? round2(varLbs / bagWeightLbs) : null
      const varPct =
        varLbs !== null && intervalToastRawLbs > 0 ? round2((varLbs / intervalToastRawLbs) * 100) : null
      const dollarStore = varLbs !== null ? round2(varLbs * costPerRawLbStore) : null
      const dollarBodega = varLbs !== null ? round2(varLbs * costPerRawLbBodega) : null
      const unbilledTacos =
        varLbs !== null ? Math.round((varLbs * yieldRatio * 16) / 1.5) : null

      const closeDow = new Date(`${closeDate}T12:00:00Z`).getUTCDay()
      const isWeekendPair = spanDays === 2 && closeDow === 0
      const isBridgedMultiDay = spanDays > 1 && !isWeekendPair

      const periodLabel =
        spanDays === 1
          ? formatShortDateLabelEs(closeDate)
          : isWeekendPair
            ? `${formatShortDateLabelEs(firstSaleDate)} + ${formatShortDateLabelEs(closeDate)}`
            : `${formatShortDateLabelEs(firstSaleDate)} – ${formatShortDateLabelEs(closeDate)} (${spanDays}d)`

      let rowStatus: FridgeLedgerIntervalEntry['status'] = 'ok'
      if (hasNegativeAnomaly) rowStatus = 'count_anomaly'
      else if (varBags !== null && varPct !== null) {
        if (varBags >= 2 && varPct > 10) rowStatus = 'critical'
        else if (varBags >= 1 && varPct > 5) rowStatus = 'warning'
        else if (varBags < -1 && varPct < -5) rowStatus = 'efficient'
      }

      const expectedClosingBags =
        availableBags !== null ? round2(availableBags - intervalToastBags) : null
      const fridgeBalanceBags =
        closeBags !== null && expectedClosingBags !== null
          ? round2(closeBags - expectedClosingBags)
          : varBags !== null
            ? round2(-varBags)
            : null
      const fridgeBalanceDollarStore =
        dollarStore !== null ? round2(-dollarStore) : null
      const prevEntry = dailyLedger.length > 0 ? dailyLedger[dailyLedger.length - 1] : null
      const reboundSuspected = Boolean(
        prevEntry &&
          prevEntry.fridgeBalanceBags !== null &&
          prevEntry.fridgeBalanceBags >= 2.5 &&
          fridgeBalanceBags !== null &&
          fridgeBalanceBags <= -2.0
      )

      dailyLedger.push({
        startDate: firstSaleDate,
        endDate: closeDate,
        anchorDate: prevAnchorDate,
        spanDays,
        periodLabel,
        isWeekendPair,
        isBridgedMultiDay,
        openingBags: openBags,
        openingCountedBy: openInfo?.by || null,
        arrivedBags: round2(arrBags),
        invoiceNumbers: invNums,
        hasUnreconciledSentOrder: hasSentOnly,
        availableInFridgeBags: availableBags,
        expectedClosingBags,
        closingBags: closeBags,
        closingCountedBy: closeInfo?.by || null,
        fridgeBalanceBags,
        fridgeBalanceDollarStore,
        reboundSuspected,
        fridgeUsedBags: usedBags,
        fridgeUsedRawLbs: rawUsedLbs !== null ? round2(rawUsedLbs) : null,
        toastSoldBags: intervalToastBags,
        toastSoldRawLbs: round2(intervalToastRawLbs),
        tacosSold: round2(intervalTacos),
        burritosSold: round2(intervalBurritos),
        varianceBags: varBags,
        varianceRawLbs: varLbs,
        variancePct: varPct,
        dollarImpactStore: dollarStore,
        dollarImpactBodega: dollarBodega,
        unbilledTacosEquiv: unbilledTacos,
        hasNegativeCountAnomaly: hasNegativeAnomaly,
        status: rowStatus,
      })

      prevAnchorDate = closeDate
    }

    // Si quedan fechas al final del rango sin conteo físico de cierre aún (ej. hoy o tienda pendiente de contar)
    const lastCountCovered = closingDatesInWindow.length > 0 ? closingDatesInWindow[closingDatesInWindow.length - 1] : prevAnchorDate
    if (lastCountCovered && lastCountCovered < params.endDate) {
      const pendingFirst = addDaysIso(lastCountCovered, 1)
      const pendingSpan = diffCalendarDays(lastCountCovered, params.endDate)
      const openInfo = dMap.get(lastCountCovered) || null
      let arrBags = 0
      const invNums: string[] = []
      let hasSentOnly = false
      for (let step = 0; step < pendingSpan; step++) {
        const dOrd = addDaysIso(lastCountCovered, step)
        const arr = arrivalsByStoreDate.get(`${store.id}::${dOrd}`)
        if (arr) {
          arrBags += arr.qty
          for (const inv of arr.invoiceNumbers) {
            if (!invNums.includes(inv)) invNums.push(inv)
          }
          if (arr.hasSentOnly) hasSentOnly = true
        }
      }
      let pToastLbs = 0
      let pTacos = 0
      let pBurritos = 0
      for (let step = 1; step <= pendingSpan; step++) {
        const dBiz = addDaysIso(lastCountCovered, step)
        const tr = transferNetMap.get(`${store.id}::${params.inventoryItemId}::${dBiz}`)
        if (tr && tr.netQty !== 0) {
          arrBags += tr.netQty
          for (const tag of tr.transferTags) {
            if (!invNums.includes(tag)) invNums.push(tag)
          }
        }
        const u = toastByStoreAndDate.get(`${store.id}::${dBiz}`)
        if (u) {
          pToastLbs += u.rawLbs
          pTacos += u.tacosUnits
          pBurritos += u.burritosUnits
        }
      }
      if (pToastLbs > 0 || arrBags > 0) {
        const pAvail = openInfo ? round2(openInfo.qty + arrBags) : null
        const pToastBags = bagWeightLbs > 0 ? round2(pToastLbs / bagWeightLbs) : 0
        dailyLedger.push({
          startDate: pendingFirst,
          endDate: params.endDate,
          anchorDate: lastCountCovered,
          spanDays: pendingSpan,
          periodLabel:
            pendingSpan === 1
              ? `${formatShortDateLabelEs(params.endDate)} (Pendiente cierre)`
              : `${formatShortDateLabelEs(pendingFirst)} – ${formatShortDateLabelEs(params.endDate)} (Sin conteo final)`,
          isWeekendPair: false,
          isBridgedMultiDay: pendingSpan > 1,
          openingBags: openInfo ? round2(openInfo.qty) : null,
          openingCountedBy: openInfo?.by || null,
          arrivedBags: round2(arrBags),
          invoiceNumbers: invNums,
          hasUnreconciledSentOrder: hasSentOnly,
          availableInFridgeBags: pAvail,
          expectedClosingBags: pAvail !== null ? round2(pAvail - pToastBags) : null,
          closingBags: null,
          closingCountedBy: null,
          fridgeBalanceBags: null,
          fridgeBalanceDollarStore: null,
          reboundSuspected: false,
          fridgeUsedBags: null,
          fridgeUsedRawLbs: null,
          toastSoldBags: pToastBags,
          toastSoldRawLbs: round2(pToastLbs),
          tacosSold: round2(pTacos),
          burritosSold: round2(pBurritos),
          varianceBags: null,
          varianceRawLbs: null,
          variancePct: null,
          dollarImpactStore: null,
          dollarImpactBodega: null,
          unbilledTacosEquiv: null,
          hasNegativeCountAnomaly: false,
          status: 'pending_count',
        })
      }
    }

    // Resumen telescópico oficial `[t0, t1]` de la tienda
    const pair = resolveTelescopingAnchorPair(sortedDates, params.startDate, params.endDate)
    if (!pair) {
      storesSummaries.push({
        storeId: store.id,
        storeName: store.name,
        storeCode: store.code,
        hasMeasuredSpan: false,
        t0: null,
        t1: null,
        spanDays: 0,
        openingBags: null,
        openingCountedBy: null,
        arrivedBags: 0,
        invoiceNumbers: [],
        expectedEndingBags: null,
        closingBags: null,
        closingCountedBy: null,
        fridgeUsedBags: null,
        fridgeUsedRawLbs: null,
        toastSoldWindowBags: windowToastBags,
        toastSoldWindowRawLbs: round2(windowToastRawLbs),
        toastSoldSpanBags: 0,
        toastSoldSpanRawLbs: 0,
        tacosSoldWindow: round2(windowTacos),
        burritosSoldWindow: round2(windowBurritos),
        varianceBags: null,
        varianceRawLbs: null,
        variancePct: null,
        dollarImpactStore: null,
        dollarImpactBodega: null,
        unbilledTacosEquiv: null,
        hasNegativeCountAnomaly: false,
        cumulativeFridgeBalanceBags: null,
        cumulativeFridgeBalanceDollarStore: null,
        latestCloseCut: null,
        dailyLedger,
      })
      continue
    }

    const openInfo = dMap.get(pair.t0)!
    const closeInfo = dMap.get(pair.t1)!
    const w0 = getHistoricalMeatBagLbs(proteinKey, pair.t0, bagWeightLbs)
    const w1 = getHistoricalMeatBagLbs(proteinKey, pair.t1, bagWeightLbs)

    let spanArrBags = 0
    let spanArrLbs = 0
    const spanInvoices: string[] = []
    for (let step = 0; step < pair.spanDays; step++) {
      const dOrd = addDaysIso(pair.t0, step)
      const arr = arrivalsByStoreDate.get(`${store.id}::${dOrd}`)
      if (arr) {
        spanArrBags += arr.qty
        spanArrLbs += arr.qty * getHistoricalMeatBagLbs(proteinKey, dOrd, bagWeightLbs)
        for (const inv of arr.invoiceNumbers) {
          if (!spanInvoices.includes(inv)) spanInvoices.push(inv)
        }
      }
    }

    let spanToastRawLbs = 0
    for (let step = 1; step <= pair.spanDays; step++) {
      const dBiz = addDaysIso(pair.t0, step)
      const tr = transferNetMap.get(`${store.id}::${params.inventoryItemId}::${dBiz}`)
      if (tr && tr.netQty !== 0) {
        spanArrBags += tr.netQty
        spanArrLbs += tr.netQty * getHistoricalMeatBagLbs(proteinKey, dBiz, bagWeightLbs)
        for (const tag of tr.transferTags) {
          if (!spanInvoices.includes(tag)) spanInvoices.push(tag)
        }
      }
      const u = toastByStoreAndDate.get(`${store.id}::${dBiz}`)
      if (u) spanToastRawLbs += u.rawLbs
    }

    const rawSpanUsedLbs = openInfo.qty * w0 + spanArrLbs - closeInfo.qty * w1
    const hasNeg = rawSpanUsedLbs < -0.01
    const spanUsedBags = bagWeightLbs > 0 ? round2(rawSpanUsedLbs / bagWeightLbs) : 0
    const spanToastBags = bagWeightLbs > 0 ? round2(spanToastRawLbs / bagWeightLbs) : 0
    const spanVarLbs = round2(rawSpanUsedLbs - spanToastRawLbs)
    const spanVarBags = bagWeightLbs > 0 ? round2(spanVarLbs / bagWeightLbs) : 0
    const spanVarPct = spanToastRawLbs > 0 ? round2((spanVarLbs / spanToastRawLbs) * 100) : 0
    const spanDollarStore = round2(spanVarLbs * costPerRawLbStore)
    const spanDollarBodega = round2(spanVarLbs * costPerRawLbBodega)
    const spanUnbilledTacos = Math.round((spanVarLbs * yieldRatio * 16) / 1.5)

    const closedEntries = dailyLedger.filter((e) => e.status !== 'pending_count' && e.closingBags !== null)
    const lastClosed = closedEntries.length > 0 ? closedEntries[closedEntries.length - 1] : null

    storesSummaries.push({
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      hasMeasuredSpan: true,
      t0: pair.t0,
      t1: pair.t1,
      spanDays: pair.spanDays,
      openingBags: round2(openInfo.qty),
      openingCountedBy: openInfo.by,
      arrivedBags: round2(spanArrBags),
      invoiceNumbers: spanInvoices,
      expectedEndingBags: round2(openInfo.qty + spanArrBags - spanToastBags),
      closingBags: round2(closeInfo.qty),
      closingCountedBy: closeInfo.by,
      fridgeUsedBags: spanUsedBags,
      fridgeUsedRawLbs: round2(rawSpanUsedLbs),
      toastSoldWindowBags: windowToastBags,
      toastSoldWindowRawLbs: round2(windowToastRawLbs),
      toastSoldSpanBags: spanToastBags,
      toastSoldSpanRawLbs: round2(spanToastRawLbs),
      tacosSoldWindow: round2(windowTacos),
      burritosSoldWindow: round2(windowBurritos),
      varianceBags: spanVarBags,
      varianceRawLbs: spanVarLbs,
      variancePct: spanVarPct,
      dollarImpactStore: spanDollarStore,
      dollarImpactBodega: spanDollarBodega,
      unbilledTacosEquiv: spanUnbilledTacos,
      hasNegativeCountAnomaly: hasNeg,
      cumulativeFridgeBalanceBags: round2(-spanVarBags),
      cumulativeFridgeBalanceDollarStore: round2(-spanDollarStore),
      latestCloseCut: lastClosed
        ? {
            periodLabel: lastClosed.periodLabel,
            availableInFridgeBags: lastClosed.availableInFridgeBags,
            toastSoldBags: lastClosed.toastSoldBags,
            expectedClosingBags: lastClosed.expectedClosingBags,
            closingBags: lastClosed.closingBags,
            closingCountedBy: lastClosed.closingCountedBy,
            fridgeBalanceBags: lastClosed.fridgeBalanceBags,
            fridgeBalanceDollarStore: lastClosed.fridgeBalanceDollarStore,
          }
        : null,
      dailyLedger,
    })
  }

  return {
    bagWeightLbs,
    yieldPercent,
    yieldRatio,
    bagCostStore: round2(effectivePurchaseUnitCost),
    bagCostBodega: round2(effectivePurchaseUnitCost * bodegaRatio),
    costPerRawLbStore: round4(costPerRawLbStore),
    costPerRawLbBodega: round4(costPerRawLbBodega),
    costPerCookedLbStore: round4(costPerCookedLbStore),
    costPerCookedLbBodega: round4(costPerCookedLbBodega),
    storesSummaries,
    breakdownRows: Array.from(breakdownMap.values()),
    totalToastRawLbs: round2(totalToastRawLbs),
    totalToastCookedLbs: round2(totalToastCookedLbs),
    toastByStoreAndDate,
  }
}
