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
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
  getBusinessDateLA,
  isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  evaluatePmixItemsForProtein,
  loadToastMeatContext,
} from '@/lib/inventory/toast-meat-sold-resolver'

export const dynamic = 'force-dynamic'

const PAPELITO_ITEM_ID = 'fb83420e-8c32-4e85-a29d-e74de2055807'
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
    : startDow === 0
      ? addDaysIso(startDate, -2) // Domingo consolida Sáb+Dom desde el cierre del Viernes
      : addDaysIso(startDate, -1)

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
    const storeId = (searchParams.get('storeId') || 'all').trim()
    const todayLA = getBusinessDateLA()
    const defaultEnd = addDaysIso(todayLA, -1)
    const defaultStart = addDaysIso(defaultEnd, -6)

    const startDate = (searchParams.get('startDate') || defaultStart).trim()
    const endDate = (searchParams.get('endDate') || defaultEnd).trim()
    const categoryFilter = (searchParams.get('category') || 'all').trim()

    if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
      return NextResponse.json(
        { error: 'Rango de fechas inválido (use YYYY-MM-DD con startDate <= endDate).' },
        { status: 400 }
      )
    }

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
    if (storeId !== 'all') {
      const single = /^\d+$/.test(storeId)
        ? storeByNumericId.get(Number(storeId))
        : storeByGuid.get(storeId)
      if (!single) {
        return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 })
      }
      targetStores = [single]
    }

    const targetNumericIds = targetStores.map((s) => s.id)
    const targetNumericIdSet = new Set<number>(targetNumericIds)
    const targetGuids = targetStores.map((s) => s.external_id).filter((g): g is string => Boolean(g))

    // 2. Catálogo de inventario completo (paginado) + ventas netas del periodo
    const [rawItems, salesRows] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        supabase
          .from('inventory_items')
          .select('id, name, sku, unit_type, purchase_unit_cost, quantity_per_unit, unit_measure, is_bodega, yield_percent')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('sales_daily_cache')
          .select('id, net_sales, store_id, business_date')
          .gte('business_date', startDate)
          .lte('business_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId !== 'all' && targetGuids.length > 0) {
          q = q.in('store_id', targetGuids)
        }
        return q
      }),
    ])

    const totalNetSales = round2(
      salesRows.reduce((sum, r) => sum + Math.max(0, Number(r.net_sales || 0)), 0)
    )

    // 3. Conteos físicos humanos con ventana de anclaje previo [startDate - 3, endDate]
    const anchorLookbackStart = addDaysIso(startDate, -3)
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

    // 4. Consultar en paralelo:
    //    a) Contexto unificado Toast PMIX (`pmix_daily_cache` + reconciliación QBO Invoices de Bodega)
    //    b) Llegadas de Bodega (`inventory_order_lines` + `inventory_orders` status IN ('sent','received') en [globalMinT0, globalMaxT1))
    //    c) Consumo teórico POS de insumos no cárnicos (`inventory_usage_log` paginado)
    //    d) Sobrante cocido al cierre (`assistant_checklists` checklist_type = 'sobrante')
    const toastMeatCtx = await loadToastMeatContext({
      storeNumericIds: targetNumericIds,
      minDate: minTheoDate,
      maxDate: endDate,
      reconcileQbInvoices: true,
    })

    const [orderLineRows, usageLogRows, sobranteRows] = await Promise.all([
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('inventory_order_lines')
          .select(
            'id, inventory_item_id, final_qty, adjusted_qty, calculated_qty, inventory_orders!inner(id, store_id, order_date, status, order_type)'
          )
          .in('inventory_orders.status', ['sent', 'received'])
          .gte('inventory_orders.order_date', globalMinT0)
          .lt('inventory_orders.order_date', globalMaxT1)
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId !== 'all') {
          q = q.in('inventory_orders.store_id', targetNumericIds)
        }
        return q
      }),
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('inventory_usage_log')
          .select('id, store_id, business_date, inventory_item_id, theoretical_usage')
          .gte('business_date', minTheoDate)
          .lte('business_date', endDate)
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId !== 'all') {
          q = q.in('store_id', targetNumericIds.map(String))
        }
        return q
      }),
      fetchAllRows<any>((from, to) => {
        let q = supabase
          .from('assistant_checklists')
          .select('id, store_id, checklist_date, shift, user_name, answers, created_at')
          .eq('checklist_type', 'sobrante')
          .gte('checklist_date', startDate)
          .lte('checklist_date', endDate)
          .order('checklist_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (storeId !== 'all') {
          q = q.in('store_id', targetNumericIds)
        }
        return q
      }),
    ])

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

    // Indexar consumo teórico POS no cárnico por (storeId, itemId, businessDate)
    const usageTheoByStoreItemDate = new Map<string, Map<string, number>>()
    for (const u of usageLogRows) {
      const rawS = String(u.store_id || '').trim()
      const sId = /^\d+$/.test(rawS) ? Number(rawS) : storeByGuid.get(rawS)?.id ?? null
      if (sId === null || !targetNumericIdSet.has(sId)) continue
      const itemId = String(u.inventory_item_id || '')
      if (!itemId || PROTEIN_ID_TO_KEY.has(itemId)) continue
      const bDate = String(u.business_date || '')
      const theo = Number(u.theoretical_usage || 0)
      if (!bDate || !Number.isFinite(theo) || theo <= 0) continue

      const key = `${sId}::${itemId}`
      let dMap = usageTheoByStoreItemDate.get(key)
      if (!dMap) {
        dMap = new Map<string, number>()
        usageTheoByStoreItemDate.set(key, dMap)
      }
      dMap.set(bDate, (dMap.get(bDate) || 0) + theo)
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

        if (itemSpans.length > 0) {
          let totalActualRawLbs = 0
          let totalActualBagsEquiv = 0
          let totalTheoRawLbs = 0
          let totalOpeningBags = 0
          let totalArrivedBags = 0
          let totalEndingBags = 0
          let totalSpanDaysWeighted = 0
          let minAnchorT0 = itemSpans[0].t0
          let maxAnchorT1 = itemSpans[0].t1
          const measuredStoreIds: number[] = []

          for (const sp of itemSpans) {
            measuredStoreIds.push(sp.storeId)
            if (sp.t0 < minAnchorT0) minAnchorT0 = sp.t0
            if (sp.t1 > maxAnchorT1) maxAnchorT1 = sp.t1
            totalSpanDaysWeighted += sp.spanDays

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

            const storeActualLbs = sp.countT0 * w0 + storeArrivedLbs - sp.countT1 * w1
            const storeActualBags = currentBagLbs > 0 ? storeActualLbs / currentBagLbs : 0

            // Consumo teórico POS estrictamente sobre los mismos días (t0, t1] de esa tienda
            const theoMap = meatTheoByStoreKeyDate.get(`${sp.storeId}::${proteinKey}`)
            let storeTheoLbs = 0
            for (let step = 1; step <= sp.spanDays; step++) {
              const dBiz = addDaysIso(sp.t0, step) // (t0, t1]
              storeTheoLbs += theoMap?.get(dBiz) || 0
            }

            totalOpeningBags += sp.countT0
            totalArrivedBags += storeArrivedBags
            totalEndingBags += sp.countT1
            totalActualRawLbs += storeActualLbs
            totalActualBagsEquiv += storeActualBags
            totalTheoRawLbs += storeTheoLbs
          }

          const avgSpanDays = round2(totalSpanDaysWeighted / itemSpans.length)
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
            measured_stores_count: itemSpans.length,
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
      const bodegaUnitCost = item.is_bodega !== false ? rawPurchaseCost / 1.2 : rawPurchaseCost

      if (itemSpans.length > 0) {
        let totalActualPurchaseUnits = 0
        let totalTheoPurchaseUnits = 0
        let totalOpeningUnits = 0
        let totalArrivedUnits = 0
        let totalEndingUnits = 0
        let totalSpanDaysWeighted = 0
        let minAnchorT0 = itemSpans[0].t0
        let maxAnchorT1 = itemSpans[0].t1
        const measuredStoreIds: number[] = []

        for (const sp of itemSpans) {
          measuredStoreIds.push(sp.storeId)
          if (sp.t0 < minAnchorT0) minAnchorT0 = sp.t0
          if (sp.t1 > maxAnchorT1) maxAnchorT1 = sp.t1
          totalSpanDaysWeighted += sp.spanDays

          const arrivalMap = arrivalsByStoreItemDate.get(`${sp.storeId}::${itemId}`)
          let storeArrived = 0
          for (let step = 0; step < sp.spanDays; step++) {
            storeArrived += arrivalMap?.get(addDaysIso(sp.t0, step)) || 0
          }

          const rawStoreActual = Math.max(0, sp.countT0 + storeArrived - sp.countT1)
          const storeActualNorm = rawStoreActual / purchaseUnitDivisor

          const theoMap = usageTheoByStoreItemDate.get(`${sp.storeId}::${itemId}`)
          let rawStoreTheo = 0
          for (let step = 1; step <= sp.spanDays; step++) {
            rawStoreTheo += theoMap?.get(addDaysIso(sp.t0, step)) || 0
          }
          const storeTheoNorm = rawStoreTheo / purchaseUnitDivisor

          totalOpeningUnits += sp.countT0 / purchaseUnitDivisor
          totalArrivedUnits += storeArrived / purchaseUnitDivisor
          totalEndingUnits += sp.countT1 / purchaseUnitDivisor
          totalActualPurchaseUnits += storeActualNorm
          totalTheoPurchaseUnits += storeTheoNorm
        }

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
        const avgSpanDays = round2(totalSpanDaysWeighted / itemSpans.length)

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
          measured_stores_count: itemSpans.length,
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

    return NextResponse.json(
      {
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
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch (err: any) {
    console.error('Error in GET /api/food-cost/variance-avt:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
