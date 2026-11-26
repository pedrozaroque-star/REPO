/**
 * @module api/food-cost/variance-avt
 * @description Motor Real vs. Teórico (Actual vs. Theoretical / AvT) de varianza de porciones y mermas,
 * ordenando los insumos por pérdida económica real medida en dólares (`$ Loss`), con prioridad #1 en Carne Asada.
 *
 * @businessRules
 * - Requiere sesión autenticada de personal interno mediante `verifyStaffAuth`.
 * - **Ley Telescópica de Conservación de Masa (`D -> D+1` Arrival Lag)**:
 *   * Filtra `inventory_counts` exclusivamente a conteos físicos humanos (excluye `counted_by = 'AUTO_CYCLE_V2'`,
 *     `notes ILIKE '%AUTO_CYCLE%'`, y conteos parciales aislados de sábado `dow === 6` que consolidan en domingo).
 *   * Por cada par `(store_id, inventory_item_id)` con ancla inicial `t0` y cierre `t1` (`t0 < t1`):
 *     - `arrivedUnits = SUM(final_qty ?? adjusted_qty ?? calculated_qty)` de `inventory_orders` con `status IN ('sent', 'received')`
 *       y desfase de llegada **`t0 <= order_date < t1`**, acotado estrictamente a esa misma `store_id`.
 *     - `actualUnits = Math.max(0, Count(t0) + arrivedUnits - Count(t1))`.
 * - **Normalización Física Exacta de las 8 Proteínas (`ACTIVE_PROTEIN_IDS`)**:
 *   * Convierte bolsas físicas (`actualUnits`) a **libras crudas (`lb`)** respetando el corte histórico de gramaje de bolsa
 *     (`2026-07-24`: Pastor `10 -> 5 lb`, Pollo `10 -> 5 lb`, Cabeza `5 -> 2.5 lb`, Lengua `5 -> 2.5 lb`; post-corte usa `MEAT_DEFAULT_BAG_LBS`).
 *   * Compara contra las **libras crudas teóricas reales de Toast POS** en `(t0, t1]` desde `meat_consumption_history` (paginado `.range()`).
 *   * Costo Store USD por lb cruda = `purchase_unit_cost / bagWeightLbs` (ej. Carne Asada `$60 / 10 lb = $6.00/lb`) y Costo Bodega (`PurchaseCost` QBO, ej. `$5.00/lb` Asada).
 *   * Calcula `variance_lbs`, `variance_bags`, `dollar_loss` (Store USD), `bodega_dollar_loss`, `excess_tacos_equiv` (`cookedVarianceOz / 1.5`)
 *     y marca tramos cortos (`span_days < 5`) con nota de WIP de bolsas cerradas en cámara fría (`wip_cooler_note`).
 * - **Insumos No Cárnicos Observables en POS**:
 *   * Lee consumo teórico real en `(t0, t1]` desde `inventory_usage_log` (paginado), normalizando `Papelito Para Torta` (contado en piezas contra caja de `60`)
 *     a unidades de compra (`quantity_per_unit`), y excluyendo los 19 insumos de autoservicio/salsabar libre (`isHistoricalMassBalanceItem`) que no tienen botón POS por refill.
 *   * Cero `theoPer1k` sintético: si un insumo no tiene ≥2 conteos físicos válidos (`[t0, t1]`), se reporta honestamente como `status: 'unmeasured'`.
 * - **Contexto Suplementario de Sobrante Cocido**:
 *   * Lee `assistant_checklists` (`checklist_type = 'sobrante'`), interpretando claves bilingües ES/EN en `answers`.
 *
 * @dataFlow
 * - `verifyStaffAuth` -> `stores`, `inventory_items`, `sales_daily_cache`, `inventory_counts` (paginado),
 *   `inventory_orders` + `inventory_order_lines` (paginado), `meat_consumption_history` (paginado),
 *   `inventory_usage_log` (paginado), `assistant_checklists` -> Matriz AvT + `asadaSpotlight` -> `/admin/food-cost/varianza`.
 *
 * @notes
 * - [2026-11-23] Reconstrucción integral: eliminada consulta rota a `food_cost_daily_cache.details` y erradicados benchmarks `theoPer1k`;
 *   implementada Ley Telescópica `[t0, t1)` por tienda, normalización `MEAT_DEFAULT_BAG_LBS` + corte `2026-07-24` y paginación anti-1,000 filas.
 * - [2026-11-25] Calibraciones confirmadas por Carlos: `251W Cheesecake` y `253W Whole Cheese Cake` marcados como
 *   proveedor externo directo (`bodegaRatio = 1.0`, sin descuento `0.90x` de Bodega) y `029W Queso Fresco` habilitado como `pos_recipe`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  ACTIVE_PROTEIN_IDS,
  MEAT_COOKING_YIELDS,
  MEAT_DEFAULT_BAG_LBS,
  type ActiveProteinKey,
} from '@/lib/inventory/meat-allocation'
import { isHistoricalMassBalanceItem } from '@/lib/inventory/historical-mass-balance'
import { EXTERNAL_TRACK_ONLY_ITEM_IDS } from '@/app/inventory/orders/utils'
import {
  addDaysIso,
  diffCalendarDays,
  FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
  FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS,
  getBusinessDateLA,
  isValidIsoDate,
  validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  evaluatePmixItemsForProtein,
  loadToastMeatContext,
} from '@/lib/inventory/toast-meat-sold-resolver'
import {
  buildStoreItemDateNetTransferMap,
  fetchConfirmedStoreTransfers,
} from '@/lib/inventory/store-transfers'
import {
  PMIX_SAFE_CHUNK_ROWS,
  isPmixCacheRowFinalized,
  readPmixDailyCacheChunked,
} from '@/lib/inventory/pmix-cache-reader'
import {
  calculateDailyOrderConsumption,
  type RawToastTicket,
} from '@/lib/inventory/daily-order-consumption-engine'
import {
  calculateInventoryUsage,
  calculateRawUsage,
} from '@/lib/inventory/conversions'
import type { ProductMixItem } from '@/lib/toast-pmix'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const varianceAvtInFlight = new Map<string, Promise<{ status: number; body: any }>>()
const varianceAvtClosedCache = new Map<string, { expiresAt: number; body: any }>()
const VARIANCE_AVT_CLOSED_TTL_MS = 60 * 1000
const VARIANCE_AVT_MAX_CACHE = 16

function setVarianceAvtCacheBounded(key: string, body: any) {
  if (varianceAvtClosedCache.size >= VARIANCE_AVT_MAX_CACHE) {
    const firstKey = varianceAvtClosedCache.keys().next().value
    if (firstKey !== undefined) varianceAvtClosedCache.delete(firstKey)
  }
  varianceAvtClosedCache.set(key, { expiresAt: Date.now() + VARIANCE_AVT_CLOSED_TTL_MS, body })
}

const PAPELITO_ITEM_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807'
// Confirmado por Carlos: Cheesecake (251W) y Whole Cheese Cake (253W) son proveedor externo directo (bodegaRatio = 1.0)
const EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS = new Set<string>([
  '8ba55664-5ca9-4886-8ac8-acf1fd070713', // 251W Cheesecake
  'df79c42c-7219-4563-8501-6acc1116238f', // 251W Cheese cake
  '2e53d7a5-67ff-4247-83cf-1d976650a9bf', // 253W Whole Cheese Cake
])
const BAG_CUTOVER_DATE = '2026-07-24'

const PROTEIN_ID_TO_KEY = new Map<string, ActiveProteinKey>(
  (Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>).map(([k, id]) => [id, k])
)

const HISTORY_MEAT_TYPE_TO_KEY: Record<string, ActiveProteinKey> = {
  ASADA: 'asada',
  PASTOR: 'pastor',
  POLLO: 'pollo',
  CABEZA: 'cabeza',
  LENGUA: 'lengua',
  CHORIZO: 'chorizo',
  CARNITAS: 'carnitas',
  BUCHE: 'buche',
}

/**
 * Proporción verificada en QuickBooks Online (`PurchaseCost / UnitPrice`, #39) para calcular el costo real Bodega.
 */
const BODEGA_COST_RATIO_BY_PROTEIN: Record<ActiveProteinKey, number> = {
  asada: 50 / 60,        // $50.00 / $60.00 (10 lb -> $5.00/lb Bodega vs $6.00/lb Tienda)
  pastor: 8.9 / 10.68,   // $8.90 / $10.68 (5 lb -> $1.78/lb Bodega vs $2.136/lb Tienda)
  pollo: 6.5 / 7.5,      // $6.50 / $7.50 (5 lb -> $1.30/lb Bodega vs $1.50/lb Tienda)
  cabeza: 16.6 / 19.92,  // $16.60 / $19.92 (2.5 lb -> $6.64/lb Bodega vs $7.968/lb Tienda)
  lengua: 17.5 / 21.0,   // $17.50 / $21.00 (2.5 lb -> $7.00/lb Bodega vs $8.40/lb Tienda)
  chorizo: 1.295 / 1.554,// $1.295 / $1.554 (8 oz -> $2.59/lb Bodega vs $3.108/lb Tienda)
  carnitas: 1.28 / 1.54, // $1.28 / $1.54 (6 oz -> $3.4133/lb Bodega vs $4.1067/lb Tienda)
  buche: 1.32 / 1.6,     // $1.32 / $1.60 (6 oz -> $3.52/lb Bodega vs $4.2667/lb Tienda)
}

export interface AvTItem {
  id: string
  name: string
  category: 'Meat' | 'Dairy' | 'Produce' | 'Grocery' | 'Packaging'
  unit_measure: string
  unit_cost: number
  bodega_unit_cost?: number
  actual_qty: number
  theoretical_qty: number
  variance_qty: number
  variance_pct?: number
  waste_qty: number
  unexplained_variance: number
  efficiency_pct: number
  actual_dollar: number
  theoretical_dollar: number
  dollar_loss: number
  bodega_dollar_loss?: number
  status: 'critical' | 'warning' | 'normal' | 'efficient' | 'unmeasured'
  dataSource?: 'real' | 'unmeasured'
  hasRealInventoryData?: boolean
  is_meat?: boolean
  meat_key?: ActiveProteinKey
  bag_weight_lbs?: number
  bag_cost?: number
  actual_bags?: number
  theoretical_bags?: number
  variance_bags?: number
  variance_lbs?: number
  excess_tacos_equiv?: number
  yield_pct?: number
  span_days?: number
  measured_stores_count?: number
  wip_cooler_note?: boolean
  period_anchor_start?: string | null
  period_anchor_end?: string | null
  opening_count_units?: number
  arrived_units?: number
  ending_count_units?: number
  closing_sobrante_cooked_lbs?: number | null
  closing_sobrante_date?: string | null
  closing_sobrante_by?: string | null
}

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 100) / 100
}

function round4(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 10000) / 10000
}

export function getHistoricalMeatBagLbs(protein: ActiveProteinKey, dateStr: string): number {
  if (dateStr < BAG_CUTOVER_DATE) {
    if (protein === 'pastor' || protein === 'pollo') return 10
    if (protein === 'cabeza' || protein === 'lengua') return 5
  }
  return MEAT_DEFAULT_BAG_LBS[protein]
}

function classifyInventoryCategory(
  item: { id: string; name: string; unit_type?: string | null; is_bodega?: boolean | null },
  isMeat: boolean
): AvTItem['category'] {
  if (isMeat) return 'Meat'
  const n = String(item.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (
    /\b(?:container|lid|cup|vaso|plato|plate|fork|tenedor|spoon|cuchara|napkin|servilleta|foil|aluminio|wax\s*paper|bag\s*\d|seal2go|glove|guante|straw|popote|charola|tray|domo|dome|galones\s*vacios)\b/.test(
      n
    )
  ) {
    return 'Packaging'
  }
  if (/\b(?:queso|cheese|crema|cream|milk|leche|butter|mantequilla)\b/.test(n)) {
    return 'Dairy'
  }
  if (/\b(?:aguacate|avocado|cebolla|onion|cilantro|limon|lima|jalapeno|rajas|tomate|produce)\b/.test(n)) {
    return 'Produce'
  }
  if (/\b(?:milanesa|jamon|salchicha)\b/.test(n)) {
    return 'Meat'
  }
  return 'Grocery'
}

function isHumanPhysicalCount(row: {
  counted_by?: string | null
  notes?: string | null
  count_date?: string | null
  quantity_on_hand?: unknown
}): boolean {
  const qty = Number(row.quantity_on_hand)
  if (!Number.isFinite(qty) || qty < 0) return false
  const by = String(row.counted_by || '').trim().toUpperCase()
  if (by === 'AUTO_CYCLE_V2') return false
  const notes = String(row.notes || '').trim()
  if (/auto_cycle/i.test(notes)) return false
  const dateStr = String(row.count_date || '')
  if (!isValidIsoDate(dateStr)) return false
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
  // Sábado no tiene cierre físico independiente (Sáb + Dom cierran juntos en Domingo)
  if (dow === 6) return false
  return true
}

function parseSobranteChecklistAnswers(answers: unknown): Partial<Record<ActiveProteinKey | 'arroz' | 'frijol', number>> {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {}
  const out: Partial<Record<ActiveProteinKey | 'arroz' | 'frijol', number>> = {}

  for (const [rawKey, rawVal] of Object.entries(answers as Record<string, unknown>)) {
    if (rawKey.startsWith('__')) continue
    if (rawVal === null || rawVal === undefined || typeof rawVal === 'object') continue
    const cleaned = String(rawVal).trim().replace(/[^0-9.-]/g, '')
    if (!cleaned) continue
    const num = parseFloat(cleaned)
    if (!Number.isFinite(num) || num < 0) continue

    const k = rawKey
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim()

    if (/\bASADA\b/.test(k)) out.asada = (out.asada || 0) + num
    else if (/\bPASTOR\b/.test(k)) out.pastor = (out.pastor || 0) + num
    else if (/\b(?:POLLO|CHICKEN)\b/.test(k)) out.pollo = (out.pollo || 0) + num
    else if (/\b(?:CABEZA|HEAD)\b/.test(k)) out.cabeza = (out.cabeza || 0) + num
    else if (/\b(?:LENGUA|TONGUE)\b/.test(k)) out.lengua = (out.lengua || 0) + num
    else if (/\bCARNITAS\b/.test(k)) out.carnitas = (out.carnitas || 0) + num
    else if (/\bBUCHE\b/.test(k)) out.buche = (out.buche || 0) + num
    else if (/\bCHORIZO\b/.test(k)) out.chorizo = (out.chorizo || 0) + num
    else if (/\b(?:ARROZ|RICE)\b/.test(k)) out.arroz = (out.arroz || 0) + num
    else if (/\b(?:FRIJOL|BEANS)\b/.test(k) && !/\b(?:OLLA|WHOLE|ENTERO)\b/.test(k)) {
      out.frijol = (out.frijol || 0) + num
    }
  }
  return out
}

async function fetchAllRows<T>(
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

/**
 * Resuelve el tramo telescópico `[t0, t1]` (`t0 < t1`) de conteos físicos humanos para una tienda e insumo:
 * - `t1`: último conteo físico humano dentro de `[startDate, endDate]`.
 * - `t0`: conteo de apertura ideal (`startDate - 1`, o viernes `startDate - 2` cuando `startDate` es domingo,
 *   o hasta `startDate - 3` en consultas de 1 solo día); si no existe previo inmediato en rangos multi-día,
 *   usa el primer conteo humano `>= startDate` que sea estrictamente `< t1`.
 */
function resolveTelescopingAnchorPair(
  sortedDates: string[],
  startDate: string,
  endDate: string
): { t0: string; t1: string; spanDays: number } | null {
  const inWindow = sortedDates.filter((d) => d >= startDate && d <= endDate)
  if (inWindow.length === 0) return null
  const t1 = inWindow[inWindow.length - 1]

  const isSingleDayRequest = startDate === endDate
  const startDow = new Date(`${startDate}T12:00:00Z`).getUTCDay()
  const idealMinPreDate = isSingleDayRequest
    ? addDaysIso(startDate, -3)
    : startDow === 1
      ? addDaysIso(startDate, -3) // Lunes permite anclar contra Viernes si no hubo conteo dominical
      : addDaysIso(startDate, -2) // Domingo consolida Sáb+Dom desde Viernes; entre semana cubre puentes de 1 día

  const preCandidates = sortedDates.filter((d) => d >= idealMinPreDate && d < startDate)
  let t0: string | null = null

  if (preCandidates.length > 0) {
    t0 = preCandidates[preCandidates.length - 1]
  } else if (inWindow.length >= 2) {
    t0 = inWindow[0]
  }

  if (!t0 || t0 >= t1) return null
  const spanDays = diffCalendarDays(t0, t1)
  if (spanDays < 1) return null
  return { t0, t1, spanDays }
}

export async function GET(request: NextRequest) {
  const auth = verifyStaffAuth(request, {
    allowedRoles: ['admin', 'accounting', 'supervisor', 'manager', 'asistente', 'assistant', 'shift_leader'],
  })
  if (!auth.authorized) {
    return auth.response!
  }

  try {
    const { searchParams } = new URL(request.url)
    let storeId = (searchParams.get('storeId') || 'all').trim()
    let allowedStoreTokens: string[] | null = null

    if (auth.user) {
      const role = String(auth.user.role || '').toLowerCase().trim()
      const isGlobalRole = role === 'admin' || role === 'accounting' || role === 'supervisor'
      if (!isGlobalRole) {
        const assignedStoreId = (auth.user as any).storeId ?? (auth.user as any).store_id ?? null
        const scopeRaw = (auth.user as any).storeScope ?? (auth.user as any).store_scope ?? null
        const tokens = new Set<string>()
        if (assignedStoreId !== null && assignedStoreId !== undefined && String(assignedStoreId).trim() !== '') {
          tokens.add(String(assignedStoreId).trim().toLowerCase())
        }
        if (Array.isArray(scopeRaw)) {
          for (const s of scopeRaw) {
            if (s !== null && s !== undefined && String(s).trim() !== '') {
              tokens.add(String(s).trim().toLowerCase())
            }
          }
        }
        if (tokens.size === 0) {
          return NextResponse.json({ error: 'No autorizado: sin sucursal asignada.' }, { status: 403 })
        }
        allowedStoreTokens = Array.from(tokens)
        if (storeId.toLowerCase() === 'all') {
          storeId = allowedStoreTokens[0]
        }
      }
    }

    const todayLA = getBusinessDateLA()
    const defaultEnd = addDaysIso(todayLA, -1)
    const defaultStart = addDaysIso(defaultEnd, -6)

    const startDate = (searchParams.get('startDate') || defaultStart).trim()
    const endDate = (searchParams.get('endDate') || defaultEnd).trim()
    const categoryFilter = (searchParams.get('category') || 'all').trim()

    const maxAllowedDays =
      storeId.toLowerCase() === 'all' ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS
    const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, maxAllowedDays)
    if (!rangeCheck.ok) {
      return NextResponse.json({ error: rangeCheck.error }, { status: 400 })
    }

    const scopeTag = allowedStoreTokens ? allowedStoreTokens.sort().join(',') : 'global'
    const isClosedWindow = endDate < todayLA
    const cacheKey = `${storeId.toLowerCase()}|${startDate}|${endDate}|${categoryFilter}|${scopeTag}`
    if (isClosedWindow) {
      const hit = varianceAvtClosedCache.get(cacheKey)
      if (hit && hit.expiresAt > Date.now()) {
        return NextResponse.json(hit.body, {
          headers: { 'Cache-Control': 'private, max-age=60' },
        })
      }
    }
    const existingInFlight = varianceAvtInFlight.get(cacheKey)
    if (existingInFlight) {
      const shared = await existingInFlight
      return NextResponse.json(shared.body, {
        status: shared.status,
        headers: { 'Cache-Control': isClosedWindow && shared.status === 200 ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate' },
      })
    }

    const workPromise = computeVarianceAvtPayload({
      storeId,
      startDate,
      endDate,
      categoryFilter,
      todayLA,
      allowedStoreTokens,
    })
    varianceAvtInFlight.set(cacheKey, workPromise)
    let result: { status: number; body: any }
    try {
      result = await workPromise
      if (isClosedWindow && result.status === 200) {
        setVarianceAvtCacheBounded(cacheKey, result.body)
      }
    } finally {
      if (varianceAvtInFlight.get(cacheKey) === workPromise) {
        varianceAvtInFlight.delete(cacheKey)
      }
    }

    return NextResponse.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': isClosedWindow && result.status === 200 ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (err: any) {
    console.error('Error in GET /api/food-cost/variance-avt:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

async function computeVarianceAvtPayload(params: {
  storeId: string
  startDate: string
  endDate: string
  categoryFilter: string
  todayLA: string
  allowedStoreTokens?: string[] | null
}): Promise<{ status: number; body: any }> {
    const { storeId, startDate, endDate, categoryFilter, todayLA, allowedStoreTokens } = params
    const supabase = await getSupabaseAdminClient()

    // 1. Resolver sucursales activas (ID numérico + external_id GUID de Toast)
    const { data: storesData, error: storesErr } = await supabase
      .from('stores')
      .select('id, name, code, external_id, is_active')
      .eq('is_active', true)
      .order('id', { ascending: true })

    if (storesErr) throw new Error(storesErr.message)

    const storeByNumericId = new Map<number, { id: number; name: string; external_id: string | null }>()
    const storeByGuid = new Map<string, { id: number; name: string; external_id: string | null }>()

    for (const s of storesData || []) {
      const numId = Number(s.id)
      const row = { id: numId, name: String(s.name || `#${numId}`), external_id: s.external_id || null }
      storeByNumericId.set(numId, row)
      if (row.external_id) storeByGuid.set(row.external_id, row)
    }

    let targetStores = Array.from(storeByNumericId.values())
    if (storeId.toLowerCase() !== 'all') {
      const single = /^\d+$/.test(storeId)
        ? storeByNumericId.get(Number(storeId))
        : storeByGuid.get(storeId) ||
          Array.from(storeByNumericId.values()).find(
            (x) => Boolean(x.external_id) && x.external_id!.toLowerCase() === storeId.toLowerCase()
          )
      if (!single) {
        return { status: 404, body: { error: 'Sucursal no encontrada.' } }
      }
      if (allowedStoreTokens && allowedStoreTokens.length > 0) {
        const numMatch = allowedStoreTokens.includes(String(single.id).toLowerCase())
        const guidMatch =
          Boolean(single.external_id) &&
          allowedStoreTokens.includes(String(single.external_id).toLowerCase())
        if (!numMatch && !guidMatch) {
          return { status: 403, body: { error: 'No autorizado para consultar otra sucursal.' } }
        }
      }
      targetStores = [single]
    }

    const targetNumericIds = targetStores.map((s) => s.id)
    const targetNumericIdSet = new Set<number>(targetNumericIds)
    const targetGuids = targetStores.map((s) => s.external_id).filter((g): g is string => Boolean(g))

    // 2. Catálogo de inventario completo (paginado) + mapeo de proveedores externos + ventas netas del periodo
    const [rawItems, supplierMappingRows, salesRows] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        supabase
          .from('inventory_items')
          .select('id, name, sku, unit_type, purchase_unit_cost, quantity_per_unit, unit_measure, is_bodega, yield_percent')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<any>((from, to) =>
        supabase
          .from('supplier_item_mappings')
          .select('master_item_id')
          .not('master_item_id', 'is', null)
          .order('master_item_id', { ascending: true })
          .range(from, to)
      ).catch(() => []),
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('sales_daily_cache')
          .select('id, net_sales, store_id, business_date')
          .gte('business_date', startDate)
          .lte('business_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId.toLowerCase() !== 'all' && targetGuids.length > 0) {
          q = q.in('store_id', targetGuids)
        }
        return q
      }),
    ])

    const externalSupplierIds = new Set<string>([
      ...(supplierMappingRows || [])
        .map((r: any) => String(r?.master_item_id || ''))
        .filter(Boolean),
      ...EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS,
    ])

    const totalNetSales = round2(
      salesRows.reduce((sum, r) => sum + Math.max(0, Number(r.net_sales || 0)), 0)
    )

    // 3. Conteos físicos humanos con ventana de anclaje previo [startDate - 4, endDate]
    const anchorLookbackStart = addDaysIso(startDate, -4)
    const possibleCountStoreTokens = Array.from(
      new Set([
        ...targetNumericIds.map(String),
        ...targetGuids,
      ])
    )

    const rawCounts = await fetchAllRows<any>((from, to) => {
      let q = supabase
        .from('inventory_counts')
        .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes')
        .or('counted_by.is.null,counted_by.neq.AUTO_CYCLE_V2')
        .gte('count_date', anchorLookbackStart)
        .lte('count_date', endDate)
        .order('count_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
      if (storeId !== 'all' && possibleCountStoreTokens.length > 0) {
        q = q.in('store_id', possibleCountStoreTokens)
      }
      return q
    })

    // Agrupar conteos físicos humanos válidos por (numericStoreId, itemId, countDate)
    const humanCountsByStoreItem = new Map<string, Map<string, number>>()
    for (const c of rawCounts) {
      if (!isHumanPhysicalCount(c)) continue
      const rawStoreStr = String(c.store_id || '').trim()
      const resolvedStoreId = /^\d+$/.test(rawStoreStr)
        ? Number(rawStoreStr)
        : storeByGuid.get(rawStoreStr)?.id ?? null
      if (resolvedStoreId === null || !targetNumericIdSet.has(resolvedStoreId)) continue

      const itemId = String(c.inventory_item_id || '')
      if (!itemId) continue
      const key = `${resolvedStoreId}::${itemId}`
      let dateMap = humanCountsByStoreItem.get(key)
      if (!dateMap) {
        dateMap = new Map<string, number>()
        humanCountsByStoreItem.set(key, dateMap)
      }
      dateMap.set(String(c.count_date), Number(c.quantity_on_hand))
    }

    // Resolver todos los tramos telescópicos medibles [t0, t1]
    interface StoreItemSpan {
      storeId: number
      itemId: string
      t0: string
      t1: string
      spanDays: number
      countT0: number
      countT1: number
    }

    const spansByItem = new Map<string, StoreItemSpan[]>()
    let globalMinT0 = startDate
    let globalMaxT1 = endDate

    for (const [compositeKey, dateMap] of humanCountsByStoreItem.entries()) {
      const [sIdStr, itemId] = compositeKey.split('::')
      const numStoreId = Number(sIdStr)
      const sortedDates = Array.from(dateMap.keys()).sort()
      const pair = resolveTelescopingAnchorPair(sortedDates, startDate, endDate)
      if (!pair) continue

      if (pair.t0 < globalMinT0) globalMinT0 = pair.t0
      if (pair.t1 > globalMaxT1) globalMaxT1 = pair.t1

      const arr = spansByItem.get(itemId) || []
      arr.push({
        storeId: numStoreId,
        itemId,
        t0: pair.t0,
        t1: pair.t1,
        spanDays: pair.spanDays,
        countT0: dateMap.get(pair.t0) || 0,
        countT1: dateMap.get(pair.t1) || 0,
      })
      spansByItem.set(itemId, arr)
    }

    const minTheoDate = addDaysIso(globalMinT0, 1) < startDate ? addDaysIso(globalMinT0, 1) : startDate

    // 4. Cargar únicamente lo que exige `categoryFilter`:
    //    - Si `categoryFilter` excluye Carnes, omitir completamente `loadToastMeatContext` (0 lecturas de `pmix_daily_cache`!).
    //    - Si `categoryFilter === 'Meat'`, omitir completamente `inventory_usage_log`.
    const needsMeats = categoryFilter === 'all' || categoryFilter === 'Meat'
    const needsNonMeatUsage = categoryFilter !== 'Meat'

    const toastMeatCtx = needsMeats
      ? await loadToastMeatContext({
          storeNumericIds: targetNumericIds,
          minDate: minTheoDate,
          maxDate: endDate,
          reconcileQbInvoices: true,
        })
      : null

    const [orderLineRows, usageLogRows, sobranteRows, confirmedTransfers] = await Promise.all([
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('inventory_order_lines')
          .select(
            'id, inventory_item_id, final_qty, adjusted_qty, calculated_qty, inventory_orders!inner(id, store_id, order_date, status, order_type)'
          )
          .in('inventory_orders.status', ['sent', 'received'])
          .in('inventory_orders.order_type', ['daily', 'liquids'])
          .gte('inventory_orders.order_date', globalMinT0)
          .lt('inventory_orders.order_date', globalMaxT1)
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId.toLowerCase() !== 'all') {
          q = q.in('inventory_orders.store_id', targetNumericIds)
        }
        return q
      }),
      needsNonMeatUsage
        ? fetchAllRows<any>((from, to) => {
            let q = supabase
              .from('inventory_usage_log')
              .select('id, store_id, business_date, inventory_item_id, theoretical_usage')
              .gte('business_date', minTheoDate)
              .lte('business_date', endDate)
              .order('id', { ascending: true })
              .range(from, to)
            if (storeId.toLowerCase() !== 'all') {
              q = q.in('store_id', targetNumericIds.map(String))
            }
            return q
          })
        : Promise.resolve([]),
      needsMeats
        ? fetchAllRows<any>((from, to) => {
            let q = supabase
              .from('assistant_checklists')
              .select('id, store_id, checklist_date, shift, user_name, answers, created_at')
              .eq('checklist_type', 'sobrante')
              .gte('checklist_date', startDate)
              .lte('checklist_date', endDate)
              .order('checklist_date', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
            if (storeId.toLowerCase() !== 'all') {
              q = q.in('store_id', targetNumericIds)
            }
            return q
          })
        : Promise.resolve([]),
      fetchConfirmedStoreTransfers({
        supabase,
        storeIds: targetNumericIds,
        minDate: addDaysIso(globalMinT0, 1),
        maxDate: globalMaxT1,
      }).catch((err) => {
        console.warn('[VarianceAvT] Error leyendo inventory_store_transfers:', err)
        return []
      }),
    ])
    const transferNetMap = buildStoreItemDateNetTransferMap(confirmedTransfers, targetNumericIdSet)

    // Indexar llegadas por (storeId, itemId, orderDate)
    const arrivalsByStoreItemDate = new Map<string, Map<string, number>>()
    for (const ln of orderLineRows) {
      const ord = Array.isArray(ln.inventory_orders) ? ln.inventory_orders[0] : ln.inventory_orders
      if (!ord) continue
      const sId = Number(ord.store_id)
      if (!targetNumericIdSet.has(sId)) continue
      const itemId = String(ln.inventory_item_id || '')
      if (!itemId || EXTERNAL_TRACK_ONLY_ITEM_IDS.has(itemId)) continue
      if (PROTEIN_ID_TO_KEY.has(itemId) && ord.order_type && ord.order_type !== 'daily') continue
      const orderDate = String(ord.order_date || '')
      if (!orderDate) continue
      const qty = Number(ln.final_qty ?? ln.adjusted_qty ?? ln.calculated_qty ?? 0)
      if (!Number.isFinite(qty) || qty <= 0) continue

      const key = `${sId}::${itemId}`
      let dMap = arrivalsByStoreItemDate.get(key)
      if (!dMap) {
        dMap = new Map<string, number>()
        arrivalsByStoreItemDate.set(key, dMap)
      }
      dMap.set(orderDate, (dMap.get(orderDate) || 0) + qty)
    }

    // Indexar consumo teórico exacto Toast POS (PMIX con bundleModifiers: true) de las 8 carnes por (storeId, proteinKey, businessDate) en libras crudas
    const meatTheoByStoreKeyDate = new Map<string, Map<string, number>>()
    if (toastMeatCtx) {
      for (const [proteinKey, proteinItemId] of Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>) {
        const catItem = toastMeatCtx.inventoryById.get(proteinItemId)
        const yieldPct = Number(catItem?.yield_percent || MEAT_COOKING_YIELDS[proteinKey] * 100 || 100)
        for (const s of toastMeatCtx.stores) {
          if (!targetNumericIdSet.has(s.id)) continue
          const dMap = new Map<string, number>()
          for (let d = minTheoDate; d <= endDate; d = addDaysIso(d, 1)) {
            const pmixItems = toastMeatCtx.pmixByStoreDate.get(`${s.external_id}::${d}`) || []
            if (pmixItems.length === 0) continue
            const dayUsage = evaluatePmixItemsForProtein({
              pmixItems,
              inventoryItemId: proteinItemId,
              proteinKey,
              yieldPercent: yieldPct,
              costPerRawLbStore: 0,
              costPerRawLbBodega: 0,
              ctx: toastMeatCtx,
            })
            if (dayUsage.rawLbs > 0) {
              dMap.set(d, dayUsage.rawLbs)
            }
          }
          meatTheoByStoreKeyDate.set(`${s.id}::${proteinKey}`, dMap)
        }
      }
    }

    // Indexar consumo teórico POS no cárnico por (storeId, itemId, businessDate)
    const usageTheoByStoreItemDate = new Map<string, Map<string, number>>()
    const loggedNonMeatStoreDates = new Set<string>()
    for (const u of usageLogRows) {
      const rawS = String(u.store_id || '').trim()
      const sId = /^\d+$/.test(rawS) ? Number(rawS) : storeByGuid.get(rawS)?.id ?? null
      if (sId === null || !targetNumericIdSet.has(sId)) continue
      const itemId = String(u.inventory_item_id || '')
      if (!itemId || PROTEIN_ID_TO_KEY.has(itemId)) continue
      const bDate = String(u.business_date || '')
      const theo = Number(u.theoretical_usage || 0)
      if (!bDate) continue
      loggedNonMeatStoreDates.add(`${sId}::${bDate}`)
      if (!Number.isFinite(theo) || theo <= 0) continue

      const key = `${sId}::${itemId}`
      let dMap = usageTheoByStoreItemDate.get(key)
      if (!dMap) {
        dMap = new Map<string, number>()
        usageTheoByStoreItemDate.set(key, dMap)
      }
      dMap.set(bDate, (dMap.get(bDate) || 0) + theo)
    }

    // Respaldo exacto desde `pmix_daily_cache` (`readPmixDailyCacheChunked` chunkRows: 15 + `calculateDailyOrderConsumption`)
    // para cualquier fecha cerrada en `[minTheoDate, endDate]` ausente en `inventory_usage_log`
    if (needsNonMeatUsage) {
      const missingPairs: Array<{ storeId: number; externalId: string; date: string }> = []
      const closedTheoMax = endDate < todayLA ? endDate : addDaysIso(todayLA, -1)
      for (const s of targetStores) {
        if (!s.external_id) continue
        for (let d = minTheoDate; d <= closedTheoMax; d = addDaysIso(d, 1)) {
          if (!loggedNonMeatStoreDates.has(`${s.id}::${d}`)) {
            missingPairs.push({ storeId: s.id, externalId: s.external_id, date: d })
          }
        }
      }

      if (missingPairs.length > 0) {
        let pmixSourceMap: Map<string, ProductMixItem[]>
        let recipesList: any[]
        let menuNameByGuid: Map<string, string>

        if (toastMeatCtx) {
          pmixSourceMap = toastMeatCtx.pmixByStoreDate
          recipesList = toastMeatCtx.recipesData
          menuNameByGuid = toastMeatCtx.toastNameByGuid
        } else {
          pmixSourceMap = new Map<string, ProductMixItem[]>()
          const uniqueMissingGuids = Array.from(new Set(missingPairs.map((p) => p.externalId)))
          let minMissDate = missingPairs[0].date
          let maxMissDate = missingPairs[0].date
          for (const mp of missingPairs) {
            if (mp.date < minMissDate) minMissDate = mp.date
            if (mp.date > maxMissDate) maxMissDate = mp.date
          }
          const [fetchedRecipes, fetchedMenuItems] = await Promise.all([
            fetchAllRows<any>((from, to) =>
              supabase
                .from('recipes')
                .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
                .order('id', { ascending: true })
                .range(from, to)
            ),
            fetchAllRows<any>((from, to) =>
              supabase
                .from('toast_menu_items')
                .select('guid, name')
                .order('guid', { ascending: true })
                .range(from, to)
            ),
          ])
          recipesList = fetchedRecipes
          menuNameByGuid = new Map<string, string>()
          for (const m of fetchedMenuItems) {
            if (m.guid) menuNameByGuid.set(String(m.guid), String(m.name || ''))
          }
          await readPmixDailyCacheChunked(supabase, {
            storeGuids: uniqueMissingGuids,
            startDate: minMissDate,
            endDate: maxMissDate,
            includeUpdatedAt: true,
            chunkRows: PMIX_SAFE_CHUNK_ROWS,
            onChunk: (chunk) => {
              for (const row of chunk) {
                const guid = String(row.store_id || '')
                const bDate = String(row.business_date || '')
                if (!guid || !bDate || bDate >= todayLA) continue
                if (!Array.isArray(row.items) || row.items.length === 0) continue
                if (!isPmixCacheRowFinalized(bDate, row.updated_at, todayLA)) continue
                pmixSourceMap.set(`${guid}::${bDate}`, row.items as ProductMixItem[])
              }
            },
          })
        }

        const itemsByIdMap = new Map<string, any>(rawItems.map((it: any) => [String(it.id), it]))
        const recipesByMenuGuid = new Map<string, any[]>()
        for (const r of recipesList) {
          if (!r.toast_menu_item_guid) continue
          const arr = recipesByMenuGuid.get(String(r.toast_menu_item_guid)) || []
          arr.push(r)
          recipesByMenuGuid.set(String(r.toast_menu_item_guid), arr)
        }
        const normMod = (txt: string) =>
          String(txt || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()

        for (const mp of missingPairs) {
          const pmixItems = pmixSourceMap.get(`${mp.externalId}::${mp.date}`) || []
          if (pmixItems.length === 0) continue

          const channelGroups = new Map<string, ProductMixItem[]>()
          for (const p of pmixItems) {
            if ((Number(p.quantity) || 0) <= 0) continue
            const ch = p.group_name && p.group_name !== 'Uncategorized' ? p.group_name : 'To Go'
            const list = channelGroups.get(ch) || []
            list.push(p)
            channelGroups.set(ch, list)
          }

          const synthesizedTickets: RawToastTicket[] = []
          let channelIdx = 0
          for (const [diningOptionName, channelItems] of channelGroups.entries()) {
            channelIdx++
            synthesizedTickets.push({
              orderGuid: `pmix-avt-${mp.date}-${channelIdx}`,
              businessDate: mp.date,
              diningOptionName,
              deliveryService: /uber|doordash|grubhub|postmates/i.test(diningOptionName)
                ? diningOptionName
                : undefined,
              selections: channelItems.map((p) => {
                const sQty = Number(p.quantity) || 1
                const modGuidCounts = new Map<string, number>()
                for (const g of p.modifier_guids || []) {
                  if (g) modGuidCounts.set(g, (modGuidCounts.get(g) || 0) + 1)
                }
                const resolvedMods: { guid?: string; name: string; quantity: number }[] = []
                const resolvedNormSet = new Set<string>()
                const baseMenuName = menuNameByGuid.get(p.guid)
                const baseNorm = baseMenuName ? normMod(baseMenuName) : ''

                const parenTokenCounts = new Map<string, { raw: string; count: number }>()
                const cleanForParen = String(p.name || '').replace(/\(\s*in\s+store\s*\)/gi, '')
                for (const m of cleanForParen.matchAll(/\(([^)]+)\)/g)) {
                  const groupContent = m[1].trim()
                  if (baseNorm && baseNorm.includes(normMod(`(${groupContent})`))) continue
                  for (const rawTok of groupContent.split(',')) {
                    const tok = rawTok.trim()
                    const tokNorm = normMod(tok)
                    if (!tok || !tokNorm || tokNorm === 'in store' || /^\d+\s*-\s*\d+\s*people$/.test(tokNorm)) {
                      continue
                    }
                    const prev = parenTokenCounts.get(tokNorm) || { raw: tok, count: 0 }
                    prev.count += 1
                    parenTokenCounts.set(tokNorm, prev)
                  }
                }

                for (const [tokNorm, { raw, count }] of parenTokenCounts.entries()) {
                  resolvedMods.push({ name: raw, quantity: count * sQty })
                  resolvedNormSet.add(tokNorm)
                }

                for (const [guid, count] of modGuidCounts.entries()) {
                  const modName = menuNameByGuid.get(guid)
                  if (modName) {
                    const cleanMod = normMod(modName.replace(/\(\s*in\s+store\s*\)/gi, ''))
                    if (resolvedNormSet.has(cleanMod) || resolvedNormSet.has(normMod(modName))) continue
                    resolvedMods.push({ guid, name: modName, quantity: count })
                    resolvedNormSet.add(cleanMod)
                  }
                }

                const unitPrice =
                  Number(p.unit_price) > 0
                    ? Number(p.unit_price)
                    : sQty > 0
                      ? Number(p.gross_sales ?? p.net_sales ?? 0) / sQty
                      : 0

                return {
                  guid: p.guid,
                  name: baseMenuName || p.name,
                  price: unitPrice,
                  quantity: sQty,
                  modifiers: resolvedMods,
                }
              }),
            })
          }

          const dayUsageMap = new Map<string, number>()
          const codexHandledIds = new Set<string>()
          try {
            const codexRes = calculateDailyOrderConsumption(
              mp.storeId,
              mp.date,
              synthesizedTickets,
              recipesList as any,
              rawItems as any
            )
            for (const [, res] of codexRes.itemConsumption.entries()) {
              if (res.totalCalculatedUsage > 0) {
                dayUsageMap.set(res.inventoryItemId, res.totalCalculatedUsage)
                codexHandledIds.add(res.inventoryItemId)
              }
            }
          } catch (codexErr) {
            console.warn(`[VarianceAvT] Error en CODEX fallback (${mp.storeId} ${mp.date}):`, codexErr)
          }

          for (const pmixItem of pmixItems) {
            const qtySold = Number(pmixItem.quantity) || 0
            if (qtySold <= 0) continue
            const dbIngs = recipesByMenuGuid.get(pmixItem.guid) || []
            for (const ing of dbIngs) {
              if (codexHandledIds.has(ing.inventory_item_id)) continue
              const rType = String(ing.type || 'food')
              if (rType.startsWith('cogs_')) {
                const doLower = (
                  pmixItem.group_name && pmixItem.group_name !== 'Uncategorized' ? pmixItem.group_name : 'To Go'
                ).toLowerCase()
                const isDineIn = doLower.includes('here') || doLower.includes('dine')
                const isDelivery =
                  doLower.includes('uber') ||
                  doLower.includes('door') ||
                  doLower.includes('grub') ||
                  doLower.includes('delivery')
                const isTakeout = !isDineIn && !isDelivery
                if (rType === 'cogs_dine_in' && !isDineIn) continue
                if (rType === 'cogs_delivery' && !isDelivery) continue
                if (rType === 'cogs_takeout' && !isTakeout) continue
              }
              const catItem = itemsByIdMap.get(String(ing.inventory_item_id))
              if (!catItem) continue
              const rawU = calculateRawUsage(
                Number(ing.quantity) || 0,
                ing.unit || 'oz',
                catItem.yield_percent || 100,
                rType
              )
              const invU = calculateInventoryUsage(
                rawU.quantity * qtySold,
                rawU.unit,
                catItem.unit_type || 'pza',
                catItem.quantity_per_unit
              )
              if (invU > 0) {
                dayUsageMap.set(String(catItem.id), (dayUsageMap.get(String(catItem.id)) || 0) + invU)
              }
            }
          }

          for (const [itId, theoVal] of dayUsageMap.entries()) {
            if (PROTEIN_ID_TO_KEY.has(itId) || !Number.isFinite(theoVal) || theoVal <= 0) continue
            const key = `${mp.storeId}::${itId}`
            let dMap = usageTheoByStoreItemDate.get(key)
            if (!dMap) {
              dMap = new Map<string, number>()
              usageTheoByStoreItemDate.set(key, dMap)
            }
            dMap.set(mp.date, (dMap.get(mp.date) || 0) + theoVal)
          }
        }
      }
    }

    // Indexar último sobrante cocido al cierre por sucursal -> sumar última captura de cada tienda activa en el cierre del rango
    const latestSobranteByStore = new Map<
      number,
      {
        date: string
        by: string | null
        parsed: Partial<Record<ActiveProteinKey | 'arroz' | 'frijol', number>>
      }
    >()
    for (const row of sobranteRows) {
      const sId = Number(row.store_id)
      if (!targetNumericIdSet.has(sId)) continue
      const parsed = parseSobranteChecklistAnswers(row.answers)
      if (Object.keys(parsed).length === 0) continue
      const cDate = String(row.checklist_date || '')
      const prev = latestSobranteByStore.get(sId)
      if (!prev || cDate >= prev.date) {
        latestSobranteByStore.set(sId, {
          date: cDate,
          by: row.user_name ? String(row.user_name) : null,
          parsed,
        })
      }
    }

    const getAggregatedClosingSobrante = (
      key: ActiveProteinKey | 'arroz' | 'frijol',
      scopedStoreIds?: number[]
    ): { lbs: number; date: string | null; by: string | null } | null => {
      const ids = scopedStoreIds && scopedStoreIds.length > 0 ? scopedStoreIds : targetNumericIds
      let total = 0
      let found = false
      let latestDate: string | null = null
      let latestBy: string | null = null
      for (const sId of ids) {
        const entry = latestSobranteByStore.get(sId)
        if (!entry || entry.parsed[key] === undefined) continue
        total += entry.parsed[key]!
        found = true
        if (!latestDate || entry.date >= latestDate) {
          latestDate = entry.date
          latestBy = ids.length === 1 ? entry.by : null
        }
      }
      return found ? { lbs: round2(total), date: latestDate, by: latestBy } : null
    }

    // 5. Construir matriz AvT limpia
    const avtList: AvTItem[] = []

    for (const item of rawItems) {
      const itemId = String(item.id)
      const proteinKey = PROTEIN_ID_TO_KEY.get(itemId)
      const isMeat = Boolean(proteinKey)

      // Excluir insumos de autoservicio/salsabar libre (no observables por ticket POS)
      if (!isMeat && isHistoricalMassBalanceItem({ id: itemId, name: String(item.name || '') })) {
        continue
      }

      const category = classifyInventoryCategory(item, isMeat)
      if (categoryFilter !== 'all' && category !== categoryFilter) {
        continue
      }

      const itemSpans = spansByItem.get(itemId) || []

      if (isMeat && proteinKey) {
        const currentBagLbs = getHistoricalMeatBagLbs(proteinKey, endDate)
        const bagCostStore = Number(item.purchase_unit_cost || 0)
        const costPerRawLbStore = currentBagLbs > 0 ? bagCostStore / currentBagLbs : 0
        const bodegaRatio = BODEGA_COST_RATIO_BY_PROTEIN[proteinKey] ?? 1 / 1.2
        const costPerRawLbBodega = costPerRawLbStore * bodegaRatio
        const yieldPct = Number(item.yield_percent || MEAT_COOKING_YIELDS[proteinKey] * 100 || 100)
        const yieldRatio = yieldPct > 0 ? yieldPct / 100 : 1

        let totalActualRawLbs = 0
        let totalActualBagsEquiv = 0
        let totalTheoRawLbs = 0
        let totalOpeningBags = 0
        let totalArrivedBags = 0
        let totalEndingBags = 0
        let totalSpanDaysWeighted = 0
        let minAnchorT0 = ''
        let maxAnchorT1 = ''
        const measuredStoreIds: number[] = []

        for (const sp of itemSpans) {
          const w0 = getHistoricalMeatBagLbs(proteinKey, sp.t0)
          const w1 = getHistoricalMeatBagLbs(proteinKey, sp.t1)

          const arrivalMap = arrivalsByStoreItemDate.get(`${sp.storeId}::${itemId}`)
          let storeArrivedBags = 0
          let storeArrivedLbs = 0
          for (let step = 0; step < sp.spanDays; step++) {
            const dOrd = addDaysIso(sp.t0, step) // [t0, t1)
            const bagsOnDay = arrivalMap?.get(dOrd) || 0
            if (bagsOnDay > 0) {
              storeArrivedBags += bagsOnDay
              storeArrivedLbs += bagsOnDay * getHistoricalMeatBagLbs(proteinKey, dOrd)
            }
          }

          let storeTransferBags = 0
          let storeTransferLbs = 0
          for (let step = 1; step <= sp.spanDays; step++) {
            const dBiz = addDaysIso(sp.t0, step) // (t0, t1]
            const netTrans = transferNetMap.get(`${sp.storeId}::${itemId}::${dBiz}`)?.netQty || 0
            if (netTrans !== 0) {
              storeTransferBags += netTrans
              storeTransferLbs += netTrans * getHistoricalMeatBagLbs(proteinKey, dBiz)
            }
          }

          const storeActualLbs = sp.countT0 * w0 + storeArrivedLbs + storeTransferLbs - sp.countT1 * w1
          if (storeActualLbs < -0.01) {
            continue
          }
          const clampedActualLbs = Math.max(0, storeActualLbs)
          const storeActualBags = currentBagLbs > 0 ? clampedActualLbs / currentBagLbs : 0

          measuredStoreIds.push(sp.storeId)
          if (!minAnchorT0 || sp.t0 < minAnchorT0) minAnchorT0 = sp.t0
          if (!maxAnchorT1 || sp.t1 > maxAnchorT1) maxAnchorT1 = sp.t1
          totalSpanDaysWeighted += sp.spanDays

          // Consumo teórico POS estrictamente sobre los mismos días (t0, t1] de esa tienda
          const theoMap = meatTheoByStoreKeyDate.get(`${sp.storeId}::${proteinKey}`)
          let storeTheoLbs = 0
          for (let step = 1; step <= sp.spanDays; step++) {
            const dBiz = addDaysIso(sp.t0, step) // (t0, t1]
            storeTheoLbs += theoMap?.get(dBiz) || 0
          }

          totalOpeningBags += sp.countT0
          totalArrivedBags += storeArrivedBags + storeTransferBags
          totalEndingBags += sp.countT1
          totalActualRawLbs += clampedActualLbs
          totalActualBagsEquiv += storeActualBags
          totalTheoRawLbs += storeTheoLbs
        }

        if (measuredStoreIds.length > 0) {
          const avgSpanDays = round2(totalSpanDaysWeighted / measuredStoreIds.length)
          const actualQty = round2(totalActualRawLbs)
          const theoreticalQty = round2(totalTheoRawLbs)
          const varianceLbs = round2(actualQty - theoreticalQty)
          const varianceBags = currentBagLbs > 0 ? round2(varianceLbs / currentBagLbs) : 0
          const variancePct = theoreticalQty > 0 ? round2((varianceLbs / theoreticalQty) * 100) : 0
          const efficiencyPct = actualQty > 0 ? round2((theoreticalQty / actualQty) * 100) : 0
          const actualDollar = round2(actualQty * costPerRawLbStore)
          const theoreticalDollar = round2(theoreticalQty * costPerRawLbStore)
          const dollarLoss = round2(varianceLbs * costPerRawLbStore)
          const bodegaDollarLoss = round2(varianceLbs * costPerRawLbBodega)
          const cookedVarianceOz = varianceLbs * 16 * yieldRatio
          const excessTacosEquiv = round2(cookedVarianceOz / 1.5)
          const wipCoolerNote = avgSpanDays < 5
          const sobranteInfo = getAggregatedClosingSobrante(proteinKey, measuredStoreIds)

          let status: AvTItem['status'] = 'normal'
          if (
            (proteinKey === 'asada' && (variancePct > 10 || varianceBags >= 5 || dollarLoss >= 300)) ||
            dollarLoss > 150 ||
            (actualQty > 0 && efficiencyPct < 85)
          ) {
            status = 'critical'
          } else if (
            (proteinKey === 'asada' && variancePct > 5 && (varianceBags >= 2 || dollarLoss >= 120)) ||
            dollarLoss > 50 ||
            (actualQty > 0 && efficiencyPct < 92)
          ) {
            status = 'warning'
          } else if (efficiencyPct >= 96 && efficiencyPct <= 104) {
            status = 'efficient'
          }

          avtList.push({
            id: itemId,
            name: item.name,
            category: 'Meat',
            unit_measure: 'lb',
            unit_cost: round4(costPerRawLbStore),
            bodega_unit_cost: round4(costPerRawLbBodega),
            actual_qty: actualQty,
            theoretical_qty: theoreticalQty,
            variance_qty: varianceLbs,
            variance_pct: variancePct,
            waste_qty: 0,
            unexplained_variance: round2(Math.max(0, varianceLbs)),
            efficiency_pct: efficiencyPct,
            actual_dollar: actualDollar,
            theoretical_dollar: theoreticalDollar,
            dollar_loss: dollarLoss,
            bodega_dollar_loss: bodegaDollarLoss,
            status,
            dataSource: 'real',
            hasRealInventoryData: true,
            is_meat: true,
            meat_key: proteinKey,
            bag_weight_lbs: currentBagLbs,
            bag_cost: round2(bagCostStore),
            actual_bags: round2(totalActualBagsEquiv),
            theoretical_bags: currentBagLbs > 0 ? round2(theoreticalQty / currentBagLbs) : 0,
            variance_bags: varianceBags,
            variance_lbs: varianceLbs,
            excess_tacos_equiv: excessTacosEquiv,
            yield_pct: yieldPct,
            span_days: avgSpanDays,
            measured_stores_count: measuredStoreIds.length,
            wip_cooler_note: wipCoolerNote,
            period_anchor_start: minAnchorT0,
            period_anchor_end: maxAnchorT1,
            opening_count_units: round2(totalOpeningBags),
            arrived_units: round2(totalArrivedBags),
            ending_count_units: round2(totalEndingBags),
            closing_sobrante_cooked_lbs: sobranteInfo?.lbs ?? null,
            closing_sobrante_date: sobranteInfo?.date ?? null,
            closing_sobrante_by: sobranteInfo?.by ?? null,
          })
        } else {
          // Sin >= 2 conteos físicos humanos en el rango: reportar teórico POS real y estado honesto 'unmeasured'
          let windowTheoLbs = 0
          const windowDays = diffCalendarDays(startDate, endDate) + 1
          for (const sId of targetNumericIds) {
            const theoMap = meatTheoByStoreKeyDate.get(`${sId}::${proteinKey}`)
            for (let step = 0; step < windowDays; step++) {
              windowTheoLbs += theoMap?.get(addDaysIso(startDate, step)) || 0
            }
          }
          const theoreticalQty = round2(windowTheoLbs)
          const sobranteInfo = getAggregatedClosingSobrante(proteinKey)

          avtList.push({
            id: itemId,
            name: item.name,
            category: 'Meat',
            unit_measure: 'lb',
            unit_cost: round4(costPerRawLbStore),
            bodega_unit_cost: round4(costPerRawLbBodega),
            actual_qty: 0,
            theoretical_qty: theoreticalQty,
            variance_qty: 0,
            variance_pct: 0,
            waste_qty: 0,
            unexplained_variance: 0,
            efficiency_pct: 0,
            actual_dollar: 0,
            theoretical_dollar: round2(theoreticalQty * costPerRawLbStore),
            dollar_loss: 0,
            bodega_dollar_loss: 0,
            status: 'unmeasured',
            dataSource: 'unmeasured',
            hasRealInventoryData: false,
            is_meat: true,
            meat_key: proteinKey,
            bag_weight_lbs: currentBagLbs,
            bag_cost: round2(bagCostStore),
            actual_bags: 0,
            theoretical_bags: currentBagLbs > 0 ? round2(theoreticalQty / currentBagLbs) : 0,
            variance_bags: 0,
            variance_lbs: 0,
            excess_tacos_equiv: 0,
            yield_pct: yieldPct,
            span_days: 0,
            measured_stores_count: 0,
            wip_cooler_note: false,
            closing_sobrante_cooked_lbs: sobranteInfo?.lbs ?? null,
            closing_sobrante_date: sobranteInfo?.date ?? null,
            closing_sobrante_by: sobranteInfo?.by ?? null,
          })
        }
        continue
      }

      // Insumos NO cárnicos observables en POS (`inventory_usage_log`)
      const isPapelito = itemId === PAPELITO_ITEM_ID
      const qpu = Math.max(1, Number(item.quantity_per_unit || 1))
      const rawPurchaseCost = Number(item.purchase_unit_cost || 0)
      if (rawPurchaseCost <= 0) continue

      // Para Papelito Para Torta (contado/pedido/logueado en piezas individuales frente a caja de 60),
      // normalizar cantidades entre `quantity_per_unit` (60) para expresar todo en unidades de compra (`Case`).
      const purchaseUnitDivisor = isPapelito ? qpu : 1
      const unitLabel = isPapelito ? `Case (${qpu} pza)` : String(item.unit_type || item.unit_measure || 'unit')
      const unitCost = rawPurchaseCost
      const isExternalDirectSupplier =
        externalSupplierIds.has(itemId) ||
        EXTERNAL_DIRECT_SUPPLIER_ITEM_IDS.has(itemId) ||
        item.sku === '251W' ||
        item.sku === '253W'
      const bodegaUnitCost = isExternalDirectSupplier ? rawPurchaseCost : rawPurchaseCost * 0.9

      let totalActualPurchaseUnits = 0
      let totalTheoPurchaseUnits = 0
      let totalOpeningUnits = 0
      let totalArrivedUnits = 0
      let totalEndingUnits = 0
      let totalSpanDaysWeighted = 0
      let minAnchorT0 = ''
      let maxAnchorT1 = ''
      const measuredStoreIds: number[] = []

      for (const sp of itemSpans) {
        const arrivalMap = arrivalsByStoreItemDate.get(`${sp.storeId}::${itemId}`)
        let storeArrived = 0
        for (let step = 0; step < sp.spanDays; step++) {
          storeArrived += arrivalMap?.get(addDaysIso(sp.t0, step)) || 0
        }

        let storeTransfer = 0
        for (let step = 1; step <= sp.spanDays; step++) {
          storeTransfer += transferNetMap.get(`${sp.storeId}::${itemId}::${addDaysIso(sp.t0, step)}`)?.netQty || 0
        }

        const rawStoreActual = sp.countT0 + storeArrived + storeTransfer - sp.countT1
        if (rawStoreActual < -0.01) {
          continue
        }
        const clampedStoreActual = Math.max(0, rawStoreActual)
        const storeActualNorm = clampedStoreActual / purchaseUnitDivisor

        measuredStoreIds.push(sp.storeId)
        if (!minAnchorT0 || sp.t0 < minAnchorT0) minAnchorT0 = sp.t0
        if (!maxAnchorT1 || sp.t1 > maxAnchorT1) maxAnchorT1 = sp.t1
        totalSpanDaysWeighted += sp.spanDays

        const theoMap = usageTheoByStoreItemDate.get(`${sp.storeId}::${itemId}`)
        let rawStoreTheo = 0
        for (let step = 1; step <= sp.spanDays; step++) {
          rawStoreTheo += theoMap?.get(addDaysIso(sp.t0, step)) || 0
        }
        const storeTheoNorm = rawStoreTheo / purchaseUnitDivisor

        totalOpeningUnits += sp.countT0 / purchaseUnitDivisor
        totalArrivedUnits += (storeArrived + storeTransfer) / purchaseUnitDivisor
        totalEndingUnits += sp.countT1 / purchaseUnitDivisor
        totalActualPurchaseUnits += storeActualNorm
        totalTheoPurchaseUnits += storeTheoNorm
      }

      if (measuredStoreIds.length > 0) {
        // Solo emitir insumos que tengan actividad POS teórica o consumo físico real
        if (totalTheoPurchaseUnits <= 0 && totalActualPurchaseUnits <= 0) continue
        // Si no existe ningún registro teórico en POS para este ítem (ej. insumo sin receta POS), no fabricar pérdida falsa
        if (totalTheoPurchaseUnits <= 0) continue

        const actualQty = round2(totalActualPurchaseUnits)
        const theoreticalQty = round2(totalTheoPurchaseUnits)
        const varianceQty = round2(actualQty - theoreticalQty)
        const variancePct = theoreticalQty > 0 ? round2((varianceQty / theoreticalQty) * 100) : 0
        const efficiencyPct = actualQty > 0 ? round2((theoreticalQty / actualQty) * 100) : 0
        const actualDollar = round2(actualQty * unitCost)
        const theoreticalDollar = round2(theoreticalQty * unitCost)
        const dollarLoss = round2(varianceQty * unitCost)
        const bodegaDollarLoss = round2(varianceQty * bodegaUnitCost)
        const avgSpanDays = round2(totalSpanDaysWeighted / measuredStoreIds.length)

        const sobranteKey =
          itemId === 'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562'
            ? 'arroz'
            : itemId === '557d9414-c769-4399-a6cc-15bb81cba85f'
              ? 'frijol'
              : null
        const sobranteInfo = sobranteKey ? getAggregatedClosingSobrante(sobranteKey, measuredStoreIds) : null

        let status: AvTItem['status'] = 'normal'
        if (dollarLoss > 150 || (actualQty > 0 && efficiencyPct < 85)) {
          status = 'critical'
        } else if (dollarLoss > 50 || (actualQty > 0 && efficiencyPct < 92)) {
          status = 'warning'
        } else if (efficiencyPct >= 96 && efficiencyPct <= 104) {
          status = 'efficient'
        }

        avtList.push({
          id: itemId,
          name: item.name,
          category,
          unit_measure: unitLabel,
          unit_cost: round2(unitCost),
          bodega_unit_cost: round2(bodegaUnitCost),
          actual_qty: actualQty,
          theoretical_qty: theoreticalQty,
          variance_qty: varianceQty,
          variance_pct: variancePct,
          waste_qty: 0,
          unexplained_variance: round2(Math.max(0, varianceQty)),
          efficiency_pct: efficiencyPct,
          actual_dollar: actualDollar,
          theoretical_dollar: theoreticalDollar,
          dollar_loss: dollarLoss,
          bodega_dollar_loss: bodegaDollarLoss,
          status,
          dataSource: 'real',
          hasRealInventoryData: true,
          is_meat: false,
          span_days: avgSpanDays,
          measured_stores_count: measuredStoreIds.length,
          wip_cooler_note: false,
          period_anchor_start: minAnchorT0,
          period_anchor_end: maxAnchorT1,
          opening_count_units: round2(totalOpeningUnits),
          arrived_units: round2(totalArrivedUnits),
          ending_count_units: round2(totalEndingUnits),
          closing_sobrante_cooked_lbs: sobranteInfo?.lbs ?? null,
          closing_sobrante_date: sobranteInfo?.date ?? null,
          closing_sobrante_by: sobranteInfo?.by ?? null,
        })
      } else {
        // Sin conteos físicos suficientes: mostrar solo si tiene consumo teórico POS real en [startDate, endDate]
        let rawWindowTheo = 0
        const windowDays = diffCalendarDays(startDate, endDate) + 1
        for (const sId of targetNumericIds) {
          const theoMap = usageTheoByStoreItemDate.get(`${sId}::${itemId}`)
          for (let step = 0; step < windowDays; step++) {
            rawWindowTheo += theoMap?.get(addDaysIso(startDate, step)) || 0
          }
        }
        const theoreticalQty = round2(rawWindowTheo / purchaseUnitDivisor)
        if (theoreticalQty <= 0) continue

        avtList.push({
          id: itemId,
          name: item.name,
          category,
          unit_measure: unitLabel,
          unit_cost: round2(unitCost),
          bodega_unit_cost: round2(bodegaUnitCost),
          actual_qty: 0,
          theoretical_qty: theoreticalQty,
          variance_qty: 0,
          variance_pct: 0,
          waste_qty: 0,
          unexplained_variance: 0,
          efficiency_pct: 0,
          actual_dollar: 0,
          theoretical_dollar: round2(theoreticalQty * unitCost),
          dollar_loss: 0,
          bodega_dollar_loss: 0,
          status: 'unmeasured',
          dataSource: 'unmeasured',
          hasRealInventoryData: false,
          is_meat: false,
          span_days: 0,
          measured_stores_count: 0,
          wip_cooler_note: false,
        })
      }
    }

    // Ordenamiento:
    // 1) Ítems medidos primero sobre 'unmeasured' cuando tienen pérdida o movimiento real,
    // 2) Mayor pérdida en dólares ($ Loss DESC), y desempate por Carne Asada y mayor gasto teórico.
    avtList.sort((a, b) => {
      const aMeasured = a.hasRealInventoryData ? 1 : 0
      const bMeasured = b.hasRealInventoryData ? 1 : 0
      if (aMeasured !== bMeasured) return bMeasured - aMeasured
      if (b.dollar_loss !== a.dollar_loss) return b.dollar_loss - a.dollar_loss
      if (a.meat_key === 'asada' && b.meat_key !== 'asada') return -1
      if (b.meat_key === 'asada' && a.meat_key !== 'asada') return 1
      return b.theoretical_dollar - a.theoretical_dollar
    })

    const measuredItems = avtList.filter((i) => i.hasRealInventoryData)
    const measuredTheoDollar = round2(measuredItems.reduce((sum, i) => sum + i.theoretical_dollar, 0))
    const allItemsTheoreticalDollar = round2(avtList.reduce((sum, i) => sum + i.theoretical_dollar, 0))
    const totalActualDollar = round2(measuredItems.reduce((sum, i) => sum + i.actual_dollar, 0))
    const totalDollarLoss = round2(
      measuredItems.reduce((sum, i) => sum + (i.dollar_loss > 0 ? i.dollar_loss : 0), 0)
    )
    const totalBodegaDollarLoss = round2(
      measuredItems.reduce((sum, i) => sum + ((i.bodega_dollar_loss || 0) > 0 ? i.bodega_dollar_loss || 0 : 0), 0)
    )
    const netDollarVariance = round2(measuredItems.reduce((sum, i) => sum + i.dollar_loss, 0))
    const overallEfficiencyPct =
      totalActualDollar > 0 ? round2((measuredTheoDollar / totalActualDollar) * 100) : 0

    // Si hay ítems medidos, el KPI de Costo Teórico usa exactamente el mismo universo medido para que Theo vs Real sea 1:1 comparable
    const totalTheoreticalDollar = measuredItems.length > 0 ? measuredTheoDollar : allItemsTheoreticalDollar

    const asadaItem = avtList.find((i) => i.meat_key === 'asada') || null

    const dataQuality =
      measuredItems.length === 0
        ? 'unmeasured'
        : measuredItems.length === avtList.length
          ? 'real'
          : 'mixed'

    const message =
      measuredItems.length === 0
        ? endDate >= todayLA
          ? 'El conteo físico de cierre del día actual aún no se registra. Selecciona la ventana de 7 días cerrados (hasta ayer) para medir consumo físico real.'
          : 'No se encontraron ≥2 conteos físicos humanos en la ventana seleccionada para calcular balance de masas.'
        : undefined

    return {
      status: 200,
      body: {
        storeId,
        startDate,
        endDate,
        todayBusinessDateLA: todayLA,
        totalNetSales,
        totalTheoreticalDollar,
        allItemsTheoreticalDollar,
        totalActualDollar,
        totalDollarLoss,
        totalBodegaDollarLoss,
        netDollarVariance,
        overallEfficiencyPct,
        itemsCount: avtList.length,
        measuredItemsCount: measuredItems.length,
        unmeasuredItemsCount: avtList.length - measuredItems.length,
        asadaSpotlight: asadaItem,
        items: avtList,
        dataQuality,
        message,
      },
    }
}
