/**
 * @module app/api/inventory/meat-analysis
 * @description Centro de Control de Porciones de Carnes (Carne Asada #1 prioridad + las 8 proteínas activas):
 *   cruza el Product Mix con modificadores agrupados (`bundleModifiers: true`), asignación dinámica de proteínas
 *   (`parseProteinAllocation`), recetas virtuales de Party Trays (`buildPartyTrayVirtualIngredients`),
 *   equivalencia exacta de las 7 familias de platillos a bolsas cocinadas (`meat-dish-equivalence`),
 *   historial de precios (`inventory_price_history`), desglose por turno AM (`06:00–16:59`) vs PM (`17:00–05:59`),
 *   conciliación física telescópica (`inventory_counts` + `inventory_orders` + `meat_shift_handover_counts`) y
 *   atribución exacta al personal en turno (`Taqueros/Cooks`, `Managers/Asistentes` y `Escalera de Mando`).
 *
 * @businessRules
 * - Respeta `recipeRow.type === 'raw'` (`yieldRatio = 1`) vs `'cooked' | 'food'` (`rawLbs = cookedLbs / yieldRatio`).
 * - Usa `MEAT_DEFAULT_BAG_LBS` (`getMeatDefaultBagLbs`) y corte histórico de bolsa `2026-07-24` (`Pastor/Pollo` `10 -> 5 lb`, `Cabeza/Lengua` `5 -> 2.5 lb`).
 * - Calcula costo real Store USD (`$60/bolsa 10 lb = $6.00/lb cruda, $9.76/lb cocida` en Carne Asada) y Bodega PurchaseCost (`$50/bolsa = $5.00/lb`).
 * - Desglosa consumo teórico AM (`06:00–16:59` LA) vs PM (`17:00–05:59` LA) desde `meat_consumption_history` paginado.
 * - Cuando existe conteo de entrega de turno 5:00 PM en `meat_shift_handover_counts`, aísla bolsas físicas reales AM vs PM;
 *   de lo contrario pondera exposición por volumen teórico AM vs PM y muestra los responsables exactos en turno.
 *
 * @dataFlow
 * - UI `/admin/food-cost/meats` -> `GET /api/inventory/meat-analysis` -> `getProductMix(bundleModifiers: true)` +
 *   `recipes` + `inventory_items` + `inventory_price_history` + `meat_consumption_history` + `inventory_counts` +
 *   `inventory_orders` + `meat_shift_handover_counts` + `punches`/`station_assignments`/`schedules`/`users` -> JSON ejecutivo.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` y cliente admin `getSupabaseAdminClient()` con paginación `.range()` anti-1,000 filas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
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
  FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
  FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS,
  getBusinessDateLA,
  isValidIsoDate,
  validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  buildBagCookingReconciliation,
  classifyMeatDishFamily,
  extractBaseMenuItemName,
  isTacoPlateMenuItem,
  resolveExactUnitsServedForLine,
  resolveTacoPlateProteinPortion,
  type DishFamilyKey,
} from '@/lib/inventory/meat-dish-equivalence'
import {
  computeToastVsFridgeForIngredient,
  loadToastMeatContext,
  type FridgeLedgerIntervalEntry,
} from '@/lib/inventory/toast-meat-sold-resolver'

export const maxDuration = 120

const meatAnalysisInFlight = new Map<string, Promise<any>>()
const meatAnalysisClosedCache = new Map<string, { expiresAt: number; payload: any }>()
const MEAT_ANALYSIS_CLOSED_TTL_MS = 60 * 1000
const MEAT_ANALYSIS_MAX_CACHE = 16

function setMeatAnalysisCacheBounded(key: string, payload: any) {
  if (meatAnalysisClosedCache.size >= MEAT_ANALYSIS_MAX_CACHE) {
    const firstKey = meatAnalysisClosedCache.keys().next().value
    if (firstKey !== undefined) meatAnalysisClosedCache.delete(firstKey)
  }
  meatAnalysisClosedCache.set(key, { expiresAt: Date.now() + MEAT_ANALYSIS_CLOSED_TTL_MS, payload })
}

export const dynamic = 'force-dynamic'

const BAG_CUTOVER_DATE = '2026-07-24'

const PROTEIN_ID_TO_KEY = new Map<string, ActiveProteinKey>(
  (Object.entries(ACTIVE_PROTEIN_IDS) as Array<[ActiveProteinKey, string]>).map(([k, id]) => [id, k])
)

const PROTEIN_KEY_TO_HISTORY_TYPE: Record<ActiveProteinKey, string> = {
  asada: 'ASADA',
  pastor: 'PASTOR',
  pollo: 'POLLO',
  cabeza: 'CABEZA',
  lengua: 'LENGUA',
  chorizo: 'CHORIZO',
  carnitas: 'CARNITAS',
  buche: 'BUCHE',
}

const BODEGA_COST_RATIO_BY_PROTEIN: Record<ActiveProteinKey, number> = {
  asada: 50 / 60,
  pastor: 8.9 / 10.68,
  pollo: 6.5 / 7.5,
  cabeza: 16.6 / 19.92,
  lengua: 17.5 / 21.0,
  chorizo: 1.295 / 1.554,
  carnitas: 1.28 / 1.54,
  buche: 1.32 / 1.6,
}

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

function normalizeCorporateEmail(email?: string | null, connectedEmail?: string | null): string {
  const candidate = String(connectedEmail || email || '').trim().toLowerCase()
  if (candidate === 'roque@tacosgavilan.com') return 'carlos@tacosgavilan.com'
  return candidate
}

function getHistoricalMeatBagLbs(
  proteinKey: ActiveProteinKey | undefined,
  dateStr: string,
  fallbackBagLbs: number
): number {
  if (!proteinKey) return fallbackBagLbs > 0 ? fallbackBagLbs : 10
  if (dateStr < BAG_CUTOVER_DATE) {
    if (proteinKey === 'pastor' || proteinKey === 'pollo') return 10
    if (proteinKey === 'cabeza' || proteinKey === 'lengua') return 5
  }
  return MEAT_DEFAULT_BAG_LBS[proteinKey]
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
  if (/auto_cycle/i.test(String(row.notes || ''))) return false
  const d = String(row.count_date || '')
  if (!isValidIsoDate(d)) return false
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return false
  return true
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
    : startDow === 0
      ? addDaysIso(startDate, -2)
      : addDaysIso(startDate, -1)

  const preCandidates = sortedDates.filter((d) => d >= idealMinPre && d < startDate)
  const t0 = preCandidates.length > 0 ? preCandidates[preCandidates.length - 1] : inWindow.length >= 2 ? inWindow[0] : null
  if (!t0 || t0 >= t1) return null
  const spanDays = diffCalendarDays(t0, t1)
  return spanDays >= 1 ? { t0, t1, spanDays } : null
}

function parseSobranteForProtein(answers: unknown, proteinKey?: ActiveProteinKey): number | null {
  if (!proteinKey || !answers || typeof answers !== 'object' || Array.isArray(answers)) return null
  let total = 0
  let matched = false
  for (const [rawKey, rawVal] of Object.entries(answers as Record<string, unknown>)) {
    if (rawKey.startsWith('__') || rawVal === null || rawVal === undefined || typeof rawVal === 'object') continue
    const cleaned = String(rawVal).trim().replace(/[^0-9.-]/g, '')
    if (!cleaned) continue
    const num = parseFloat(cleaned)
    if (!Number.isFinite(num) || num < 0) continue

    const k = normalizeText(rawKey).toUpperCase()
    const isHit =
      (proteinKey === 'asada' && /\bASADA\b/.test(k)) ||
      (proteinKey === 'pastor' && /\bPASTOR\b/.test(k)) ||
      (proteinKey === 'pollo' && /\b(?:POLLO|CHICKEN)\b/.test(k)) ||
      (proteinKey === 'cabeza' && /\b(?:CABEZA|HEAD)\b/.test(k)) ||
      (proteinKey === 'lengua' && /\b(?:LENGUA|TONGUE)\b/.test(k)) ||
      (proteinKey === 'carnitas' && /\bCARNITAS\b/.test(k)) ||
      (proteinKey === 'buche' && /\bBUCHE\b/.test(k)) ||
      (proteinKey === 'chorizo' && /\bCHORIZO\b/.test(k))

    if (isHit) {
      total += num
      matched = true
    }
  }
  return matched ? round2(total) : null
}

function inferProteinKey(itemId: string, itemName: string): ActiveProteinKey | undefined {
  const direct = PROTEIN_ID_TO_KEY.get(itemId)
  if (direct) return direct
  const norm = normalizeText(itemName)
  if (/\basada\b/.test(norm)) return 'asada'
  if (/\bpastor\b/.test(norm)) return 'pastor'
  if (/\b(?:pollo|chicken)\b/.test(norm)) return 'pollo'
  if (/\bcabeza\b/.test(norm)) return 'cabeza'
  if (/\blengua\b/.test(norm)) return 'lengua'
  if (/\bchorizo\b/.test(norm)) return 'chorizo'
  if (/\bcarnitas\b/.test(norm)) return 'carnitas'
  if (/\bbuche\b/.test(norm)) return 'buche'
  return undefined
}

export async function GET(request: NextRequest) {
  try {
    const auth = verifyStaffAuth(request)
    if (!auth.authorized) {
      return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const rawStoreId = (searchParams.get('storeId') || 'all').trim()
    const todayLA = getBusinessDateLA()
    const defaultEnd = addDaysIso(todayLA, -1)
    const defaultStart = addDaysIso(defaultEnd, -6)

    const startDate = (searchParams.get('startDate') || defaultStart).trim()
    const endDate = (searchParams.get('endDate') || defaultEnd).trim()
    const requestedIngredientId = (searchParams.get('ingredientId') || ACTIVE_PROTEIN_IDS.asada).trim()

    const maxAllowedDays =
      rawStoreId === 'all' ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_SINGLE_STORE_DAYS
    const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, maxAllowedDays)
    if (!rangeCheck.ok) {
      return NextResponse.json({ error: rangeCheck.error }, { status: 400 })
    }

    const isClosedWindow = endDate < todayLA
    const reqCacheKey = `${rawStoreId}|${startDate}|${endDate}|${requestedIngredientId}`
    if (isClosedWindow) {
      const cached = meatAnalysisClosedCache.get(reqCacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json(cached.payload, {
          headers: { 'Cache-Control': 'private, max-age=60' },
        })
      }
    }
    const existingInFlight = meatAnalysisInFlight.get(reqCacheKey)
    if (existingInFlight) {
      const shared = await existingInFlight
      return NextResponse.json(shared.body, {
        status: shared.status,
        headers: { 'Cache-Control': isClosedWindow && shared.status === 200 ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate' },
      })
    }

    const runPromise = computeMeatAnalysisPayload({
      rawStoreId,
      todayLA,
      startDate,
      endDate,
      requestedIngredientId,
    })
    meatAnalysisInFlight.set(reqCacheKey, runPromise)
    let result: { status: number; body: any }
    try {
      result = await runPromise
      if (isClosedWindow && result.status === 200) {
        setMeatAnalysisCacheBounded(reqCacheKey, result.body)
      }
    } finally {
      if (meatAnalysisInFlight.get(reqCacheKey) === runPromise) {
        meatAnalysisInFlight.delete(reqCacheKey)
      }
    }

    return NextResponse.json(result.body, {
      status: result.status,
      headers: {
        'Cache-Control': isClosedWindow && result.status === 200 ? 'private, max-age=60' : 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (e: any) {
    console.error('[MeatAnalysisAPI] Error:', e)
    return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
  }
}

async function computeMeatAnalysisPayload(params: {
  rawStoreId: string
  todayLA: string
  startDate: string
  endDate: string
  requestedIngredientId: string
}): Promise<{ status: number; body: any }> {
    const { rawStoreId, todayLA, startDate, endDate, requestedIngredientId } = params
    const supabase = await getSupabaseAdminClient()

    // 1. Resolver sucursales activas
    const { data: storesRows, error: storesError } = await supabase
      .from('stores')
      .select('id, name, code, external_id, supervisor_id, supervisor_name, is_active')
      .eq('is_active', true)
      .order('id', { ascending: true })

    if (storesError) throw new Error(storesError.message)
    if (!storesRows || storesRows.length === 0) {
      throw new Error('No active stores found')
    }

    let selectedStores = storesRows.filter((s: any) => Boolean(s.external_id))
    let singleStore: any = null

    if (rawStoreId !== 'all') {
      singleStore = /^\d+$/.test(rawStoreId)
        ? storesRows.find((s: any) => Number(s.id) === Number(rawStoreId))
        : storesRows.find((s: any) => String(s.external_id) === rawStoreId)
      if (!singleStore) {
        return { status: 404, body: { error: 'Store not found' } }
      }
      selectedStores = [singleStore]
    }

    const targetNumericStoreIds = selectedStores.map((s: any) => Number(s.id))
    const targetNumericStoreSet = new Set<number>(targetNumericStoreIds)
    const targetGuids = selectedStores.map((s: any) => String(s.external_id)).filter(Boolean)

    // 2. UNA SOLA carga unificada y fragmentada (<= 15 filas/lote) para las 15 sucursales + catálogos estáticos (cacheados 5 min)
    //    Elimina por completo el fan-out paralelo de 15× getProductMix y la doble descarga en Fase 4.
    const allActiveStoreIds = storesRows
      .filter((s: any) => Boolean(s.external_id))
      .map((s: any) => Number(s.id))

    const [sharedToastMeatCtx, priceHistoryRows] = await Promise.all([
      loadToastMeatContext({
        storeNumericIds: allActiveStoreIds,
        minDate: addDaysIso(startDate, -3),
        maxDate: endDate,
        reconcileQbInvoices: true,
      }),
      fetchAllRows<any>((from, to) =>
        supabase
          .from('inventory_price_history')
          .select('id, inventory_item_id, purchase_unit_cost, quantity_per_unit, effective_date')
          .eq('inventory_item_id', requestedIngredientId)
          .order('effective_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ])

    // Agregar PMIX desde `sharedToastMeatCtx.pmixByStoreDate` exclusivamente para `selectedStores` en `[startDate, endDate]`
    const pmixItems = (() => {
      const aggMap = new Map<string, any>()
      for (const s of selectedStores) {
        const extId = String(s.external_id || '')
        if (!extId) continue
        for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) {
          const dayItems = sharedToastMeatCtx.pmixByStoreDate.get(`${extId}::${d}`)
          if (!dayItems || dayItems.length === 0) continue
          for (const item of dayItems) {
            const key = `${item.guid}__${item.group_name || ''}__${item.name}`
            const existing = aggMap.get(key)
            if (!existing) {
              aggMap.set(key, {
                ...item,
                modifier_guids: Array.isArray(item.modifier_guids) ? [...item.modifier_guids] : [],
              })
            } else {
              existing.quantity += Number(item.quantity || 0)
              existing.net_sales += Number(item.net_sales || 0)
              existing.gross_sales += Number(item.gross_sales || 0)
              existing.discounts += Number(item.discounts || 0)
              existing.voided_quantity += Number(item.voided_quantity || 0)
              existing.modifier_gross_sales = (existing.modifier_gross_sales || 0) + Number(item.modifier_gross_sales || 0)
              existing.half_meat_adjustments = (existing.half_meat_adjustments || 0) + Number(item.half_meat_adjustments || 0)
              if (Array.isArray(item.modifier_guids) && item.modifier_guids.length > 0) {
                for (let mIdx = 0; mIdx < item.modifier_guids.length; mIdx++) {
                  existing.modifier_guids.push(item.modifier_guids[mIdx])
                }
              }
              if (!existing.unit_price && item.unit_price) existing.unit_price = item.unit_price
            }
          }
        }
      }
      return Array.from(aggMap.values())
    })()

    const recipesData = sharedToastMeatCtx.recipesData
    const inventoryData = Array.from(sharedToastMeatCtx.inventoryById.values())
    const toastMenuItems = Array.from(sharedToastMeatCtx.toastNameByGuid.entries()).map(([guid, name]) => ({
      guid,
      name,
    }))

    const targetItem = sharedToastMeatCtx.inventoryById.get(requestedIngredientId)
    if (!targetItem) {
      return { status: 404, body: { error: 'Ingredient not found' } }
    }

    const inventoryItemId = String(targetItem.id)
    const proteinKey = inferProteinKey(inventoryItemId, targetItem.name)
    const bagWeightLbs = getHistoricalMeatBagLbs(
      proteinKey,
      endDate,
      getMeatDefaultBagLbs(inventoryItemId, Number(targetItem.quantity_per_unit || 10))
    )

    // Resolver precio histórico vigente al cierre de `endDate` (05:59 AM del día siguiente en LA)
    const endWindowInstantMs = buildLAInstant(addDaysIso(endDate, 1), 5, 59).getTime()
    let effectivePurchaseUnitCost = Number(targetItem.purchase_unit_cost || 0)
    let effectiveQtyPerUnit = Number(targetItem.quantity_per_unit || bagWeightLbs || 1)

    if (priceHistoryRows.length > 0) {
      let matchedHist: any = null
      for (const ph of priceHistoryRows) {
        const effMs = Date.parse(String(ph.effective_date || ''))
        const costVal = Number(ph.purchase_unit_cost || 0)
        if (Number.isFinite(effMs) && effMs <= endWindowInstantMs && costVal > 0) {
          matchedHist = ph
        }
      }
      if (matchedHist) {
        effectivePurchaseUnitCost = Number(matchedHist.purchase_unit_cost)
        if (Number(matchedHist.quantity_per_unit) > 0) {
          effectiveQtyPerUnit = Number(matchedHist.quantity_per_unit)
        }
      }
    }

    const yieldPercent = Number(
      targetItem.yield_percent || (proteinKey ? MEAT_COOKING_YIELDS[proteinKey] * 100 : 100) || 100
    )
    const yieldRatio = yieldPercent > 0 ? yieldPercent / 100 : 1

    // Calcular Costo Store USD por Libra Cruda y por Bolsa
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
    const tacoPortionCostStore = round4((costPerCookedLbStore / 16) * 1.5)
    const burritoPortionCostStore = round4((costPerCookedLbStore / 16) * 6.0)
    const cookedLbsPerBag = round2(bagWeightLbs * yieldRatio)
    const tacosPerBag = round2((cookedLbsPerBag * 16) / 1.5)
    const burritosPerBag = round2((cookedLbsPerBag * 16) / 6.0)

    // Índices rápidos de menú y recetas
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

    const resolveFoodRecipeRows = (guid: string, rawItemName: string): any[] => {
      const direct = foodRecipesByGuid.get(guid)
      if (direct && direct.length > 0) return direct
      // Fallback por nombre limpio antes del primer paréntesis (inmune a paréntesis anidados "(In Store)")
      const baseName = normalizeText(extractBaseMenuItemName(rawItemName))
      const candidateGuids = guidsByNormalizedMenuName.get(baseName) || []
      for (const cg of candidateGuids) {
        const rows = foodRecipesByGuid.get(cg)
        if (rows && rows.length > 0) return rows
      }
      return []
    }

    // 3. Procesar cada línea vendida en PMIX con fidelidad completa (Party Trays, Taco Plate, Half/Extra/Dorada, Raw vs Cooked)
    const breakdownMap = new Map<
      string,
      {
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
    >()

    let totalRawLbs = 0
    let totalCookedLbs = 0

    for (const soldItem of pmixItems) {
      const soldQty = Number(soldItem.quantity || 0)
      if (!Number.isFinite(soldQty) || soldQty <= 0) continue

      const itemName = String(soldItem.name || '')
      const modGuids: string[] = Array.isArray(soldItem.modifier_guids) ? soldItem.modifier_guids : []
      const modifierTexts = modGuids.map((mg) => toastNameByGuid.get(mg) || '').filter(Boolean)
      const uniqueModifierTexts = Array.from(new Set(modifierTexts))
      // Cuando `bundleModifiers: true`, `itemName` ya incluye los modificadores exactos por unidad entre paréntesis
      const combinedNameForAllocation =
        !itemName.includes('(') && uniqueModifierTexts.length > 0
          ? `${itemName} (${uniqueModifierTexts.join(', ')})`
          : itemName

      let itemCookedLbsPerUnit = 0
      let itemRawLbsPerUnit = 0
      let displayPortionQty = 0
      let displayPortionUnit = 'oz'
      let explicitSubUnitsPerOrder: number | undefined = undefined

      // Rama A: Party Trays / Fiesta Platters
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
      }
      // Rama B: Taco Plate (3 tacos de 1.5 oz = 4.5 oz cocidos distribuidos entre los sub-tacos elegidos)
      else if (isTacoPlateMenuItem(itemName) && proteinKey) {
        const platePortion = resolveTacoPlateProteinPortion({
          itemName,
          modifierTexts: uniqueModifierTexts,
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
          // Si PMIX no desglosó modificador en nombre, consultar receta base
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
      }
      // Rama C: Asignación dinámica de proteínas (`parseProteinAllocation`: Half 50/50, Extra <Carne>, Double Meat, Carne Dorada, Catering lb, Side Order Carne)
      else {
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
            // Verificar si la receta base original de este platillo estaba declarada como 'raw'
            const matchingBaseRow = baseRecipeRows.find((r) => String(r.inventory_item_id) === inventoryItemId)
            const isRawRecipe = matchingBaseRow?.type === 'raw'
            const lbs = allocatedOz / 16
            if (isRawRecipe) {
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
          // Rama D: Receta directa en base de datos (respeta estrictamente `r.type === 'raw'`)
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

      totalRawLbs += rowRawLbs
      totalCookedLbs += rowCookedLbs

      const displayKey = `${soldItem.guid}::${itemName}`
      const existing = breakdownMap.get(displayKey)
      if (!existing) {
        breakdownMap.set(displayKey, {
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

    const unroundedBreakdownRows = Array.from(breakdownMap.values())

    const breakdown = unroundedBreakdownRows
      .map((b) => ({
        ...b,
        exactUnitsServed: round2(b.exactUnitsServed),
        cookedLbs: round2(b.cookedLbs),
        rawLbs: round2(b.rawLbs),
        equivalentBagsCooked: bagWeightLbs > 0 ? round2(b.rawLbs / bagWeightLbs) : 0,
        salesAmount: round2(b.salesAmount),
        costAmount: round2(b.costAmount),
        bodegaCostAmount: round2(b.bodegaCostAmount),
        utilityAmount: round2(b.utilityAmount),
      }))
      .sort((a, b) => b.rawLbs - a.rawLbs)

    // 4. Desglose AM (06:00–16:59) vs PM (17:00–05:59) + Conciliación Física Telescópica + Personal en Turno
    const anchorLookbackStart = addDaysIso(startDate, -3)
    const possibleCountStoreTokens = Array.from(new Set([...targetNumericStoreIds.map(String), ...targetGuids]))
    const historyMeatType = proteinKey ? PROTEIN_KEY_TO_HISTORY_TYPE[proteinKey] : null

    // Omitir consultas de conteos/órdenes/handover cuando rawStoreId === 'all' (solo se consumen en modo singleStore)
    const [rawCounts, rawOrderLines, meatHistoryAmPmRows, sobranteRows, handoverResult] = await Promise.all([
      singleStore && possibleCountStoreTokens.length > 0
        ? fetchAllRows<any>((from, to) =>
            supabase
              .from('inventory_counts')
              .select('id, store_id, inventory_item_id, count_date, quantity_on_hand, counted_by, notes')
              .eq('inventory_item_id', inventoryItemId)
              .in('store_id', possibleCountStoreTokens)
              .or('counted_by.is.null,counted_by.neq.AUTO_CYCLE_V2')
              .gte('count_date', anchorLookbackStart)
              .lte('count_date', endDate)
              .order('count_date', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          )
        : Promise.resolve([]),
      singleStore
        ? fetchAllRows<any>((from, to) =>
            supabase
              .from('inventory_order_lines')
              .select('id, inventory_item_id, final_qty, adjusted_qty, calculated_qty, inventory_orders!inner(id, store_id, order_date, status, order_type)')
              .eq('inventory_item_id', inventoryItemId)
              .eq('inventory_orders.order_type', 'daily')
              .in('inventory_orders.status', ['sent', 'received'])
              .in('inventory_orders.store_id', targetNumericStoreIds)
              .gte('inventory_orders.order_date', anchorLookbackStart)
              .lte('inventory_orders.order_date', endDate)
              .order('id', { ascending: true })
              .range(from, to)
          )
        : Promise.resolve([]),
      historyMeatType
        ? (async (): Promise<Array<{ store_id: number; business_date: string; am_lbs: number; pm_lbs: number }>> => {
            const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_meat_consumption_ampm_summary', {
              p_start_date: anchorLookbackStart,
              p_end_date: endDate,
              p_meat_types: [historyMeatType],
              p_store_ids: rawStoreId === 'all' ? null : targetNumericStoreIds,
            })
            if (!rpcErr && Array.isArray(rpcRows)) {
              return rpcRows as any[]
            }
            console.warn('[MeatAnalysisAPI] Fallback raw meat_consumption_history tras error RPC:', rpcErr?.message)
            const rawRows = await fetchAllRows<any>((from, to) => {
              let q = supabase
                .from('meat_consumption_history')
                .select('id, store_id, business_date, interval_start, raw_lbs')
                .eq('meat_type', historyMeatType)
                .gte('business_date', anchorLookbackStart)
                .lte('business_date', endDate)
                .order('id', { ascending: true })
                .range(from, to)
              if (rawStoreId !== 'all') {
                q = q.in('store_id', targetNumericStoreIds)
              }
              return q
            })
            const agg = new Map<string, { store_id: number; business_date: string; am_lbs: number; pm_lbs: number }>()
            for (const r of rawRows) {
              const sId = Number(r.store_id)
              const bDate = String(r.business_date || '')
              const lbs = Number(r.raw_lbs || 0)
              if (!bDate || !Number.isFinite(lbs) || lbs <= 0) continue
              const k = `${sId}::${bDate}`
              const cur = agg.get(k) || { store_id: sId, business_date: bDate, am_lbs: 0, pm_lbs: 0 }
              const hour = parseInt(String(r.interval_start || '12:00:00').slice(0, 2), 10)
              if (hour >= 6 && hour <= 16) cur.am_lbs += lbs
              else cur.pm_lbs += lbs
              agg.set(k, cur)
            }
            return Array.from(agg.values())
          })()
        : Promise.resolve([]),
      proteinKey
        ? fetchAllRows<any>((from, to) => {
            let q = supabase
              .from('assistant_checklists')
              .select('id, store_id, checklist_date, shift, user_name, answers')
              .eq('checklist_type', 'sobrante')
              .gte('checklist_date', startDate)
              .lte('checklist_date', endDate)
              .order('checklist_date', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
            if (rawStoreId !== 'all') {
              q = q.in('store_id', targetNumericStoreIds)
            }
            return q
          })
        : Promise.resolve([]),
      // Consulta resiliente de `meat_shift_handover_counts` (5:00 PM shift handover; solo en singleStore)
      (async () => {
        if (!proteinKey || !singleStore) return []
        try {
          const { data, error } = await supabase
            .from('meat_shift_handover_counts')
            .select('id, store_id, business_date, meat_key, sealed_bags, open_cooked_lbs, counted_by_name, notes, updated_at')
            .eq('meat_key', proteinKey)
            .in('store_id', targetNumericStoreIds)
            .gte('business_date', startDate)
            .lte('business_date', endDate)
            .order('business_date', { ascending: false })
            .order('id', { ascending: true })
            .limit(200)
          if (error) return []
          return data || []
        } catch {
          return []
        }
      })(),
    ])

    // Desglose AM (06:00–16:59) vs PM (17:00–05:59) en [startDate, endDate] desde RPC SQL
    let amHistoryRawLbs = 0
    let pmHistoryRawLbs = 0
    const historyByStoreAndDate = new Map<string, { am: number; pm: number; total: number }>()

    for (const row of meatHistoryAmPmRows) {
      const sId = Number(row.store_id)
      if (!targetNumericStoreSet.has(sId)) continue
      const bDate = String(row.business_date || '')
      const amLbs = Number(row.am_lbs || 0)
      const pmLbs = Number(row.pm_lbs || 0)
      if (!bDate || (amLbs <= 0 && pmLbs <= 0)) continue

      const k = `${sId}::${bDate}`
      const cur = historyByStoreAndDate.get(k) || { am: 0, pm: 0, total: 0 }
      if (Number.isFinite(amLbs) && amLbs > 0) cur.am += amLbs
      if (Number.isFinite(pmLbs) && pmLbs > 0) cur.pm += pmLbs
      cur.total = cur.am + cur.pm
      historyByStoreAndDate.set(k, cur)

      if (bDate >= startDate && bDate <= endDate) {
        if (Number.isFinite(amLbs) && amLbs > 0) amHistoryRawLbs += amLbs
        if (Number.isFinite(pmLbs) && pmLbs > 0) pmHistoryRawLbs += pmLbs
      }
    }

    const totalHistoryWindowLbs = amHistoryRawLbs + pmHistoryRawLbs
    // Usar proporciones horarias exactas de `meat_consumption_history` sobre el total teórico del periodo
    const effectiveTotalTheoLbs = totalRawLbs > 0 ? totalRawLbs : totalHistoryWindowLbs
    const amShareRatio = totalHistoryWindowLbs > 0 ? amHistoryRawLbs / totalHistoryWindowLbs : 0.45
    const pmShareRatio = totalHistoryWindowLbs > 0 ? pmHistoryRawLbs / totalHistoryWindowLbs : 0.55

    const amTheoRawLbs = round2(
      totalHistoryWindowLbs > 0 && totalRawLbs <= 0 ? amHistoryRawLbs : effectiveTotalTheoLbs * amShareRatio
    )
    const pmTheoRawLbs = round2(Math.max(0, effectiveTotalTheoLbs - amTheoRawLbs))

    // Conciliación Física Telescópica [t0, t1] por tienda
    const storeGuidToId = new Map<string, number>()
    for (const s of selectedStores) {
      if (s.external_id) storeGuidToId.set(String(s.external_id), Number(s.id))
    }

    const countsByStore = new Map<number, Map<string, { qty: number; by: string | null }>>()
    for (const c of rawCounts) {
      if (!isHumanPhysicalCount(c)) continue
      const rawS = String(c.store_id || '').trim()
      const sId = /^\d+$/.test(rawS) ? Number(rawS) : storeGuidToId.get(rawS) ?? null
      if (sId === null || !targetNumericStoreSet.has(sId)) continue
      let dMap = countsByStore.get(sId)
      if (!dMap) {
        dMap = new Map()
        countsByStore.set(sId, dMap)
      }
      dMap.set(String(c.count_date), {
        qty: Number(c.quantity_on_hand),
        by: c.counted_by ? String(c.counted_by) : null,
      })
    }

    const arrivalsByStoreDate = new Map<string, number>()
    for (const ln of rawOrderLines) {
      const ord = Array.isArray(ln.inventory_orders) ? ln.inventory_orders[0] : ln.inventory_orders
      if (!ord) continue
      const sId = Number(ord.store_id)
      if (!targetNumericStoreSet.has(sId)) continue
      const d = String(ord.order_date || '')
      const qty = Number(ln.final_qty ?? ln.adjusted_qty ?? ln.calculated_qty ?? 0)
      if (!d || !Number.isFinite(qty) || qty <= 0) continue
      const k = `${sId}::${d}`
      arrivalsByStoreDate.set(k, (arrivalsByStoreDate.get(k) || 0) + qty)
    }

    // 4b. Motor autoritativo unificado Toast Vendido vs. Refrigerador en las 15 sucursales (REUSANDO `sharedToastMeatCtx` — cero doble lectura PMIX!)
    const unifiedMeter = await computeToastVsFridgeForIngredient({
      inventoryItemId,
      proteinKey,
      startDate,
      endDate,
      storeNumericIds: allActiveStoreIds,
      ctx: sharedToastMeatCtx,
    })

    const storesComparison = [...unifiedMeter.storesSummaries].sort((a, b) => {
      if (a.hasMeasuredSpan !== b.hasMeasuredSpan) return a.hasMeasuredSpan ? -1 : 1
      const balA = a.cumulativeFridgeBalanceDollarStore ?? 999999
      const balB = b.cumulativeFridgeBalanceDollarStore ?? 999999
      return balA - balB
    })

    const scopedSummaries = unifiedMeter.storesSummaries.filter((s) =>
      targetNumericStoreSet.has(s.storeId)
    )

    let measuredStoresCount = 0
    let physicalOpeningBags = 0
    let physicalArrivedBags = 0
    let physicalEndingBags = 0
    let physicalActualRawLbs = 0
    let physicalSpanTheoRawLbs = 0
    let physicalSpanAmTheoRawLbs = 0
    let physicalSpanPmTheoRawLbs = 0
    let totalSpanDays = 0
    let minT0: string | null = null
    let maxT1: string | null = null
    let hasNegativeCountAnomaly = false
    const allScopedInvoices: string[] = []

    for (const sSum of scopedSummaries) {
      if (!sSum.hasMeasuredSpan || !sSum.t0 || !sSum.t1) continue

      measuredStoresCount++
      totalSpanDays += sSum.spanDays
      if (!minT0 || sSum.t0 < minT0) minT0 = sSum.t0
      if (!maxT1 || sSum.t1 > maxT1) maxT1 = sSum.t1
      if (sSum.hasNegativeCountAnomaly) hasNegativeCountAnomaly = true

      for (const inv of sSum.invoiceNumbers) {
        if (!allScopedInvoices.includes(inv)) allScopedInvoices.push(inv)
      }

      let storeAmLbs = 0
      let storePmLbs = 0
      for (let step = 1; step <= sSum.spanDays; step++) {
        const dBiz = addDaysIso(sSum.t0, step)
        const h = historyByStoreAndDate.get(`${sSum.storeId}::${dBiz}`)
        if (h) {
          storeAmLbs += h.am
          storePmLbs += h.pm
        }
      }

      physicalOpeningBags += sSum.openingBags || 0
      physicalArrivedBags += sSum.arrivedBags || 0
      physicalEndingBags += sSum.closingBags || 0
      physicalActualRawLbs += sSum.fridgeUsedRawLbs || 0
      physicalSpanTheoRawLbs += sSum.toastSoldSpanRawLbs || 0
      physicalSpanAmTheoRawLbs += storeAmLbs
      physicalSpanPmTheoRawLbs += storePmLbs
    }

    // Construir Libro Diario para la tienda seleccionada (o consolidado por fecha de cierre en modo 15 tiendas)
    let dailyFridgeLedger: FridgeLedgerIntervalEntry[] = []
    if (singleStore) {
      dailyFridgeLedger = scopedSummaries[0]?.dailyLedger || []
    } else {
      const byEndDate = new Map<string, FridgeLedgerIntervalEntry>()
      for (const sSum of scopedSummaries) {
        for (const entry of sSum.dailyLedger) {
          if (entry.status === 'pending_count') continue
          const prev = byEndDate.get(entry.endDate)
          if (!prev) {
            byEndDate.set(entry.endDate, {
              ...entry,
              openingCountedBy: null,
              closingCountedBy: null,
              invoiceNumbers: [...entry.invoiceNumbers],
            })
          } else {
            prev.openingBags = round2((prev.openingBags || 0) + (entry.openingBags || 0))
            prev.arrivedBags = round2(prev.arrivedBags + entry.arrivedBags)
            prev.availableInFridgeBags = round2(
              (prev.availableInFridgeBags || 0) + (entry.availableInFridgeBags || 0)
            )
            prev.closingBags = round2((prev.closingBags || 0) + (entry.closingBags || 0))
            prev.fridgeUsedBags = round2((prev.fridgeUsedBags || 0) + (entry.fridgeUsedBags || 0))
            prev.fridgeUsedRawLbs = round2((prev.fridgeUsedRawLbs || 0) + (entry.fridgeUsedRawLbs || 0))
            prev.toastSoldBags = round2(prev.toastSoldBags + entry.toastSoldBags)
            prev.toastSoldRawLbs = round2(prev.toastSoldRawLbs + entry.toastSoldRawLbs)
            prev.expectedClosingBags = round2((prev.availableInFridgeBags || 0) - prev.toastSoldBags)
            prev.tacosSold = round2(prev.tacosSold + entry.tacosSold)
            prev.burritosSold = round2(prev.burritosSold + entry.burritosSold)
            prev.varianceRawLbs = round2((prev.fridgeUsedRawLbs || 0) - prev.toastSoldRawLbs)
            prev.varianceBags = bagWeightLbs > 0 ? round2(prev.varianceRawLbs / bagWeightLbs) : 0
            prev.variancePct =
              prev.toastSoldRawLbs > 0 ? round2((prev.varianceRawLbs / prev.toastSoldRawLbs) * 100) : 0
            prev.dollarImpactStore = round2(prev.varianceRawLbs * costPerRawLbStore)
            prev.dollarImpactBodega = round2(prev.varianceRawLbs * costPerRawLbBodega)
            prev.fridgeBalanceBags = round2(-prev.varianceBags)
            prev.fridgeBalanceDollarStore = round2(-prev.dollarImpactStore)
            prev.reboundSuspected = Boolean(prev.reboundSuspected || entry.reboundSuspected)
            prev.unbilledTacosEquiv = Math.round((prev.varianceRawLbs * yieldRatio * 16) / 1.5)
            for (const inv of entry.invoiceNumbers) {
              if (!prev.invoiceNumbers.includes(inv)) prev.invoiceNumbers.push(inv)
            }
          }
        }
      }
      dailyFridgeLedger = Array.from(byEndDate.values()).sort((a, b) => a.endDate.localeCompare(b.endDate))
    }

    const hasMeasuredPhysical = measuredStoresCount > 0
    const avgSpanDays = hasMeasuredPhysical ? round2(totalSpanDays / measuredStoresCount) : 0
    const physicalActualBags = bagWeightLbs > 0 ? round2(physicalActualRawLbs / bagWeightLbs) : 0
    const referenceTheoRawLbs =
      hasMeasuredPhysical && physicalSpanTheoRawLbs > 0 ? physicalSpanTheoRawLbs : effectiveTotalTheoLbs
    const referenceTheoBags = bagWeightLbs > 0 ? round2(referenceTheoRawLbs / bagWeightLbs) : 0
    const varianceRawLbs = hasMeasuredPhysical ? round2(physicalActualRawLbs - referenceTheoRawLbs) : 0
    const varianceBags = bagWeightLbs > 0 ? round2(varianceRawLbs / bagWeightLbs) : 0
    const variancePct =
      hasMeasuredPhysical && referenceTheoRawLbs > 0 ? round2((varianceRawLbs / referenceTheoRawLbs) * 100) : 0
    const dollarLossStore = hasMeasuredPhysical ? round2(varianceRawLbs * costPerRawLbStore) : 0
    const dollarLossBodega = hasMeasuredPhysical ? round2(varianceRawLbs * costPerRawLbBodega) : 0

    // Exceso promedio de onzas cocidas por taco equivalente (1.5 oz estándar) y burrito (6.0 oz estándar)
    const theoTacoEquivUnits = referenceTheoRawLbs > 0 ? (referenceTheoRawLbs * yieldRatio * 16) / 1.5 : 0
    const cookedVarianceOz = varianceRawLbs * yieldRatio * 16
    const excessOzPerTaco =
      hasMeasuredPhysical && theoTacoEquivUnits > 0 ? round2(cookedVarianceOz / theoTacoEquivUnits) : 0
    const excessOzPerBurrito = round2(excessOzPerTaco * 4)

    // Equivalencia exacta de las 7 familias de cocina -> Bolsas Teóricas Cocinadas vs. Bolsas Físicas Cocinadas
    const requestedWindowDays = diffCalendarDays(startDate, endDate) + 1
    const spanMatchesExactWindow =
      hasMeasuredPhysical &&
      measuredStoresCount === selectedStores.length &&
      minT0 === addDaysIso(startDate, -1) &&
      maxT1 === endDate &&
      totalSpanDays === requestedWindowDays * selectedStores.length

    const familyEquivalence = buildBagCookingReconciliation({
      lines: unroundedBreakdownRows.map((row) => ({
        guid: row.guid,
        itemName: row.itemName,
        familyKey: row.familyKey,
        soldQty: row.soldQty,
        exactUnitsServed: row.exactUnitsServed,
        cookedLbs: row.cookedLbs,
        rawLbs: row.rawLbs,
        costStoreUsd: row.costAmount,
        costBodegaUsd: row.bodegaCostAmount,
      })),
      bagWeightLbs,
      yieldRatio,
      costPerRawLbStore,
      costPerRawLbBodega,
      physicalBagsCooked: spanMatchesExactWindow ? physicalActualBags : null,
      physicalRawLbs: spanMatchesExactWindow ? physicalActualRawLbs : null,
    })

    // Verificar si existe conteo de corte 5:00 PM (`meat_shift_handover_counts`) para aislar AM vs PM físicamente
    let handoverShiftSplit: {
      hasExact5PmHandover: boolean
      businessDate: string | null
      sealedBags5Pm: number
      openCookedLbs5Pm: number
      equivalentRawBags5Pm: number
      countedByName: string | null
      notes: string | null
      amActualBags: number | null
      pmActualBags: number | null
      amActualRawLbs: number | null
      pmActualRawLbs: number | null
      amVarianceBags: number | null
      pmVarianceBags: number | null
      amDollarLossStore: number | null
      pmDollarLossStore: number | null
    } = {
      hasExact5PmHandover: false,
      businessDate: null,
      sealedBags5Pm: 0,
      openCookedLbs5Pm: 0,
      equivalentRawBags5Pm: 0,
      countedByName: null,
      notes: null,
      amActualBags: null,
      pmActualBags: null,
      amActualRawLbs: null,
      pmActualRawLbs: null,
      amVarianceBags: null,
      pmVarianceBags: null,
      amDollarLossStore: null,
      pmDollarLossStore: null,
    }

    if (singleStore && handoverResult.length > 0) {
      const latestHandover = handoverResult[0]
      const hDate = String(latestHandover.business_date || '')
      const sealedBags = Number(latestHandover.sealed_bags || 0)
      const openCookedLbs = Number(latestHandover.open_cooked_lbs || 0)
      const openRawEquivLbs = yieldRatio > 0 ? openCookedLbs / yieldRatio : openCookedLbs
      const equivBags5Pm = bagWeightLbs > 0 ? sealedBags + openRawEquivLbs / bagWeightLbs : sealedBags

      const storeCounts = countsByStore.get(Number(singleStore.id))
      const prevDate = addDaysIso(hDate, -1)
      const openAnchor = storeCounts?.get(prevDate)?.qty
      const closeAnchor = storeCounts?.get(hDate)?.qty
      const morningArr = arrivalsByStoreDate.get(`${Number(singleStore.id)}::${prevDate}`) || 0
      const dayHist = historyByStoreAndDate.get(`${Number(singleStore.id)}::${hDate}`)

      let amActBags: number | null = null
      let pmActBags: number | null = null
      let amVarBags: number | null = null
      let pmVarBags: number | null = null
      let amLoss: number | null = null
      let pmLoss: number | null = null

      if (openAnchor !== undefined) {
        amActBags = round2(Math.max(0, openAnchor + morningArr - equivBags5Pm))
        if (dayHist && bagWeightLbs > 0) {
          amVarBags = round2(amActBags - dayHist.am / bagWeightLbs)
          amLoss = round2(amVarBags * bagWeightLbs * costPerRawLbStore)
        }
      }
      if (closeAnchor !== undefined) {
        pmActBags = round2(Math.max(0, equivBags5Pm - closeAnchor))
        if (dayHist && bagWeightLbs > 0) {
          pmVarBags = round2(pmActBags - dayHist.pm / bagWeightLbs)
          pmLoss = round2(pmVarBags * bagWeightLbs * costPerRawLbStore)
        }
      }

      handoverShiftSplit = {
        hasExact5PmHandover: amActBags !== null || pmActBags !== null,
        businessDate: hDate,
        sealedBags5Pm: round2(sealedBags),
        openCookedLbs5Pm: round2(openCookedLbs),
        equivalentRawBags5Pm: round2(equivBags5Pm),
        countedByName: latestHandover.counted_by_name ? String(latestHandover.counted_by_name) : null,
        notes: latestHandover.notes ? String(latestHandover.notes) : null,
        amActualBags: amActBags,
        pmActualBags: pmActBags,
        amActualRawLbs: amActBags !== null ? round2(amActBags * bagWeightLbs) : null,
        pmActualRawLbs: pmActBags !== null ? round2(pmActBags * bagWeightLbs) : null,
        amVarianceBags: amVarBags,
        pmVarianceBags: pmVarBags,
        amDollarLossStore: amLoss,
        pmDollarLossStore: pmLoss,
      }
    }

    // Sobrante cocido de cierre (`assistant_checklists`)
    let closingSobranteCookedLbs: number | null = null
    let closingSobranteDate: string | null = null
    let closingSobranteBy: string | null = null
    if (proteinKey && sobranteRows.length > 0) {
      const latestByStore = new Map<number, { lbs: number; date: string; by: string | null }>()
      for (const sRow of sobranteRows) {
        const sId = Number(sRow.store_id)
        const val = parseSobranteForProtein(sRow.answers, proteinKey)
        if (val === null) continue
        const d = String(sRow.checklist_date || '')
        const prev = latestByStore.get(sId)
        if (!prev || d >= prev.date) {
          latestByStore.set(sId, { lbs: val, date: d, by: sRow.user_name ? String(sRow.user_name) : null })
        }
      }
      if (latestByStore.size > 0) {
        let sum = 0
        for (const v of latestByStore.values()) {
          sum += v.lbs
          if (!closingSobranteDate || v.date >= closingSobranteDate) {
            closingSobranteDate = v.date
            closingSobranteBy = singleStore ? v.by : null
          }
        }
        closingSobranteCookedLbs = round2(sum)
      }
    }

    // 5. Atribución de Personal en Turno (AM vs PM Taqueros/Cooks, Encargados y Escalera de Mando) cuando hay sucursal seleccionada
    interface StaffAttributionMember {
      name: string
      role: string
      hours?: number
      shiftsCount?: number
      station?: string | null
    }

    let escaleraDeMando: {
      storeNumericId: number
      storeName: string
      manager: { name: string; email: string } | null
      assistants: Array<{ name: string; email: string }>
      supervisor: { name: string; email: string } | null
    } | null = null

    let amLeaders: StaffAttributionMember[] = []
    let pmLeaders: StaffAttributionMember[] = []
    let amTaqueros: StaffAttributionMember[] = []
    let pmTaqueros: StaffAttributionMember[] = []

    if (singleStore) {
      const storeNumericId = Number(singleStore.id)
      const storeToastGuid = String(singleStore.external_id || '')

      const [activeUsersRes, schedulesRes, checklistsRes, stationRes, punchesRows, jobsRes] = await Promise.all([
        supabase
          .from('users')
          .select('id, full_name, email, google_email_connected, role, store_id, store_scope, is_active')
          .eq('is_active', true)
          .limit(500),
        supabase
          .from('schedules')
          .select('user_id, date, shift_label, start_time, end_time, role')
          .eq('store_id', storeNumericId)
          .gte('date', startDate)
          .lte('date', endDate)
          .limit(1000),
        supabase
          .from('assistant_checklists')
          .select('user_id, user_name, checklist_date, shift')
          .eq('store_id', storeNumericId)
          .gte('checklist_date', startDate)
          .lte('checklist_date', endDate)
          .limit(1000),
        storeToastGuid
          ? supabase
              .from('station_assignments')
              .select('employee_id, assignment_date, main_station, sub_position')
              .eq('store_id', storeToastGuid)
              .gte('assignment_date', startDate)
              .lte('assignment_date', endDate)
              .limit(1000)
          : Promise.resolve({ data: [] as any[] }),
        storeToastGuid
          ? fetchAllRows<any>((from, to) =>
              supabase
                .from('punches')
                .select('toast_id, employee_toast_guid, job_toast_guid, business_date, clock_in, clock_out')
                .eq('store_id', storeToastGuid)
                .gte('business_date', startDate)
                .lte('business_date', endDate)
                .order('toast_id', { ascending: true })
                .range(from, to)
            )
          : Promise.resolve([]),
        supabase.from('toast_jobs').select('guid, title').limit(2000),
      ])

      const activeUsers = activeUsersRes.data || []
      const userById = new Map<number, any>()
      for (const u of activeUsers) userById.set(Number(u.id), u)

      const matchesStoreScope = (u: any): boolean => {
        if (Number(u.store_id) === storeNumericId) return true
        if (Array.isArray(u.store_scope)) {
          return u.store_scope.some((tok: any) => {
            const s = String(tok || '').trim().toLowerCase()
            return (
              s === String(storeNumericId) ||
              s === String(singleStore.code || '').trim().toLowerCase() ||
              s === String(singleStore.name || '').trim().toLowerCase()
            )
          })
        }
        return false
      }

      const managerUser =
        activeUsers.find(
          (u: any) => String(u.role || '').toLowerCase() === 'manager' && Number(u.store_id) === storeNumericId
        ) ||
        activeUsers.find((u: any) => String(u.role || '').toLowerCase() === 'manager' && matchesStoreScope(u)) ||
        null

      const assistantUsers = activeUsers.filter((u: any) => {
        const r = String(u.role || '').toLowerCase()
        return (r === 'asistente' || r === 'assistant') && matchesStoreScope(u)
      })

      const supervisorUser =
        (singleStore.supervisor_id ? userById.get(Number(singleStore.supervisor_id)) : null) ||
        activeUsers.find((u: any) => String(u.role || '').toLowerCase() === 'supervisor' && matchesStoreScope(u)) ||
        null

      escaleraDeMando = {
        storeNumericId,
        storeName: String(singleStore.name || `#${storeNumericId}`),
        manager: managerUser
          ? {
              name: String(managerUser.full_name || managerUser.email),
              email: normalizeCorporateEmail(managerUser.email, managerUser.google_email_connected),
            }
          : null,
        assistants: assistantUsers.map((a: any) => ({
          name: String(a.full_name || a.email),
          email: normalizeCorporateEmail(a.email, a.google_email_connected),
        })),
        supervisor: supervisorUser
          ? {
              name: String(supervisorUser.full_name || singleStore.supervisor_name || supervisorUser.email),
              email: normalizeCorporateEmail(supervisorUser.email, supervisorUser.google_email_connected),
            }
          : null,
      }

      // Clasificar Encargados AM vs PM (`schedules` + `assistant_checklists`)
      const amLeaderCounter = new Map<string, { name: string; role: string; shifts: Set<string> }>()
      const pmLeaderCounter = new Map<string, { name: string; role: string; shifts: Set<string> }>()

      for (const sc of schedulesRes.data || []) {
        const u = userById.get(Number(sc.user_id))
        if (!u) continue
        const name = String(u.full_name || u.email)
        const roleLabel = String(sc.role || u.role || 'manager')
        const lbl = normalizeText(sc.shift_label)
        const startHour = parseInt(String(sc.start_time || '08:00:00').slice(0, 2), 10)
        const isPmShift =
          lbl.includes('tarde') ||
          lbl.includes('noche') ||
          lbl.includes('pm') ||
          startHour >= 15 ||
          startHour < 5
        const target = isPmShift ? pmLeaderCounter : amLeaderCounter
        const prev = target.get(name) || { name, role: roleLabel, shifts: new Set<string>() }
        prev.shifts.add(String(sc.date))
        target.set(name, prev)
      }

      for (const ck of checklistsRes.data || []) {
        const name = String(ck.user_name || '').trim()
        if (!name) continue
        const isPmShift = String(ck.shift || '').toUpperCase() === 'PM'
        const target = isPmShift ? pmLeaderCounter : amLeaderCounter
        const prev = target.get(name) || { name, role: 'asistente', shifts: new Set<string>() }
        prev.shifts.add(String(ck.checklist_date))
        target.set(name, prev)
      }

      // Resolver empleados Toast para `punches` y `station_assignments`
      const empGuids = new Set<string>()
      for (const p of punchesRows) {
        if (p.employee_toast_guid) empGuids.add(String(p.employee_toast_guid))
      }
      for (const sa of stationRes.data || []) {
        if (sa.employee_id) empGuids.add(String(sa.employee_id))
      }

      const empNameByGuid = new Map<string, string>()
      const empGuidArr = Array.from(empGuids)
      for (let i = 0; i < empGuidArr.length; i += 200) {
        const chunk = empGuidArr.slice(i, i + 200)
        const { data: emps } = await supabase
          .from('toast_employees')
          .select('toast_guid, v2_toast_guid, chosen_name, first_name, last_name')
          .in('toast_guid', chunk)
        for (const e of emps || []) {
          const full =
            String(e.chosen_name || '').trim() ||
            [e.first_name, e.last_name].filter(Boolean).join(' ').trim() ||
            'Staff'
          if (e.toast_guid) empNameByGuid.set(String(e.toast_guid), full)
          if (e.v2_toast_guid) empNameByGuid.set(String(e.v2_toast_guid), full)
        }
      }

      const jobTitleByGuid = new Map<string, string>()
      for (const j of jobsRes.data || []) {
        if (j.guid) jobTitleByGuid.set(String(j.guid), String(j.title || '').trim())
      }

      // Asignaciones de estación explícitas (`CARNES_AM` / `CARNES_PM`)
      const stationMapAm = new Map<string, number>()
      const stationMapPm = new Map<string, number>()
      for (const sa of stationRes.data || []) {
        const mainSt = String(sa.main_station || '').toUpperCase()
        const subPos = String(sa.sub_position || '').toUpperCase()
        if (mainSt !== 'CARNES' && !subPos.includes('CARNES') && mainSt !== 'TACOS') continue
        const empGuid = String(sa.employee_id || '')
        if (!empGuid) continue
        if (subPos.includes('_PM')) {
          stationMapPm.set(empGuid, (stationMapPm.get(empGuid) || 0) + 1)
        } else {
          stationMapAm.set(empGuid, (stationMapAm.get(empGuid) || 0) + 1)
        }
      }

      // Acumular horas reales trabajadas en AM [06:00, 17:00) vs PM [17:00, 06:00+1d) para Taqueros/Cooks y Shift Leaders
      const grillAmByEmp = new Map<string, { name: string; role: string; hours: number; station: string | null }>()
      const grillPmByEmp = new Map<string, { name: string; role: string; hours: number; station: string | null }>()

      for (const p of punchesRows) {
        const empGuid = String(p.employee_toast_guid || '')
        const jobTitle = jobTitleByGuid.get(String(p.job_toast_guid || '')) || ''
        const bDate = String(p.business_date || '')
        if (!empGuid || !bDate || !p.clock_in) continue

        const isGrillRole = /\b(?:taquero|cook|prep|preparador|parrillero|carnes)\b/i.test(jobTitle)
        const isFloorLeader = /\b(?:manager|asst\.?\s*manager|shift\s*leader)\b/i.test(jobTitle)
        const hasCarnesStation = stationMapAm.has(empGuid) || stationMapPm.has(empGuid)
        if (!isGrillRole && !isFloorLeader && !hasCarnesStation) continue

        const amStartMs = buildLAInstant(bDate, 6, 0).getTime()
        const pmStartMs = buildLAInstant(bDate, 17, 0).getTime()
        const pmEndMs = buildLAInstant(addDaysIso(bDate, 1), 6, 0).getTime()

        const inMs = Date.parse(String(p.clock_in))
        const outMs = p.clock_out ? Date.parse(String(p.clock_out)) : Math.min(Date.now(), pmEndMs)
        if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) continue

        const amHrs = Math.max(0, Math.min(outMs, pmStartMs) - Math.max(inMs, amStartMs)) / 3_600_000
        const pmHrs = Math.max(0, Math.min(outMs, pmEndMs) - Math.max(inMs, pmStartMs)) / 3_600_000
        const empName = empNameByGuid.get(empGuid) || 'Empleado Cocina'

        if (isGrillRole || hasCarnesStation) {
          if (amHrs >= 0.5) {
            const cur = grillAmByEmp.get(empGuid) || {
              name: empName,
              role: jobTitle || 'Taquero',
              hours: 0,
              station: stationMapAm.has(empGuid) ? 'CARNES_AM' : null,
            }
            cur.hours += amHrs
            if (/taquero/i.test(jobTitle)) cur.role = 'Taquero'
            grillAmByEmp.set(empGuid, cur)
          }
          if (pmHrs >= 0.5) {
            const cur = grillPmByEmp.get(empGuid) || {
              name: empName,
              role: jobTitle || 'Taquero',
              hours: 0,
              station: stationMapPm.has(empGuid) ? 'CARNES_PM' : null,
            }
            cur.hours += pmHrs
            if (/taquero/i.test(jobTitle)) cur.role = 'Taquero'
            grillPmByEmp.set(empGuid, cur)
          }
        } else if (isFloorLeader) {
          if (amHrs >= 1 && !amLeaderCounter.has(empName)) {
            const prev = amLeaderCounter.get(empName) || { name: empName, role: jobTitle, shifts: new Set<string>() }
            prev.shifts.add(bDate)
            amLeaderCounter.set(empName, prev)
          }
          if (pmHrs >= 1 && !pmLeaderCounter.has(empName)) {
            const prev = pmLeaderCounter.get(empName) || { name: empName, role: jobTitle, shifts: new Set<string>() }
            prev.shifts.add(bDate)
            pmLeaderCounter.set(empName, prev)
          }
        }
      }

      const rolePriority = (r: string, st: string | null): number => {
        if (st && st.startsWith('CARNES')) return 0
        if (/taquero/i.test(r)) return 1
        if (/cook/i.test(r)) return 2
        return 3
      }

      amTaqueros = Array.from(grillAmByEmp.values())
        .sort((a, b) => {
          const pa = rolePriority(a.role, a.station)
          const pb = rolePriority(b.role, b.station)
          if (pa !== pb) return pa - pb
          return b.hours - a.hours
        })
        .slice(0, 6)
        .map((x) => ({
          name: x.name,
          role: x.role,
          hours: round2(x.hours),
          station: x.station,
        }))

      pmTaqueros = Array.from(grillPmByEmp.values())
        .sort((a, b) => {
          const pa = rolePriority(a.role, a.station)
          const pb = rolePriority(b.role, b.station)
          if (pa !== pb) return pa - pb
          return b.hours - a.hours
        })
        .slice(0, 6)
        .map((x) => ({
          name: x.name,
          role: x.role,
          hours: round2(x.hours),
          station: x.station,
        }))

      amLeaders = Array.from(amLeaderCounter.values())
        .sort((a, b) => b.shifts.size - a.shifts.size)
        .slice(0, 4)
        .map((x) => ({ name: x.name, role: x.role, shiftsCount: x.shifts.size }))

      pmLeaders = Array.from(pmLeaderCounter.values())
        .sort((a, b) => b.shifts.size - a.shifts.size)
        .slice(0, 4)
        .map((x) => ({ name: x.name, role: x.role, shiftsCount: x.shifts.size }))
    }

    // Exposición ponderada AM vs PM cuando aún no hay conteo intermedio de 5:00 PM
    const amSpanShare =
      physicalSpanAmTheoRawLbs + physicalSpanPmTheoRawLbs > 0
        ? physicalSpanAmTheoRawLbs / (physicalSpanAmTheoRawLbs + physicalSpanPmTheoRawLbs)
        : amShareRatio
    const pmSpanShare = 1 - amSpanShare

    const amAttributedLossStore =
      handoverShiftSplit.amDollarLossStore !== null
        ? handoverShiftSplit.amDollarLossStore
        : hasMeasuredPhysical
          ? round2(dollarLossStore * amSpanShare)
          : 0
    const pmAttributedLossStore =
      handoverShiftSplit.pmDollarLossStore !== null
        ? handoverShiftSplit.pmDollarLossStore
        : hasMeasuredPhysical
          ? round2(dollarLossStore * pmSpanShare)
          : 0

    const dominantShift =
      handoverShiftSplit.amDollarLossStore !== null && handoverShiftSplit.pmDollarLossStore !== null
        ? handoverShiftSplit.pmDollarLossStore > handoverShiftSplit.amDollarLossStore
          ? 'PM'
          : 'AM'
        : pmSpanShare >= 0.55
          ? 'PM'
          : amSpanShare >= 0.55
            ? 'AM'
            : 'BOTH'

    return {
      status: 200,
      body: {
        storeId: rawStoreId,
        storeNumericId: singleStore ? Number(singleStore.id) : null,
        storeName: singleStore ? String(singleStore.name) : '15 Sucursales (Consolidado)',
        startDate,
        endDate,
        todayBusinessDateLA: todayLA,
        ingredientId: inventoryItemId,
        ingredientName: targetItem.name,
        meatKey: proteinKey || null,
        bagWeightLbs,
        bagCostStore: round2(effectivePurchaseUnitCost),
        bagCostBodega: round2(effectivePurchaseUnitCost * bodegaRatio),
        costPerRawLbStore: round4(costPerRawLbStore),
        costPerRawLbBodega: round4(costPerRawLbBodega),
        costPerCookedLbStore: round4(costPerCookedLbStore),
        costPerCookedLbBodega: round4(costPerCookedLbBodega),
        tacoPortionCostStore,
        burritoPortionCostStore,
        cookedLbsPerBag,
        tacosPerBag,
        burritosPerBag,
        yieldPercent,
        totalQuantityUsed: round2(totalCookedLbs),
        totalCookedLbs: round2(totalCookedLbs),
        totalRawLbs: round2(effectiveTotalTheoLbs),
        theoreticalBagsUsed: bagWeightLbs > 0 ? round2(effectiveTotalTheoLbs / bagWeightLbs) : 0,
        theoreticalCostStore: round2(effectiveTotalTheoLbs * costPerRawLbStore),
        theoreticalCostBodega: round2(effectiveTotalTheoLbs * costPerRawLbBodega),
        shiftBreakdown: {
          am: {
            label: 'AM (06:00 AM – 04:59 PM)',
            theoRawLbs: amTheoRawLbs,
            theoBags: bagWeightLbs > 0 ? round2(amTheoRawLbs / bagWeightLbs) : 0,
            sharePct: round2(amShareRatio * 100),
            actualBags: handoverShiftSplit.amActualBags,
            actualRawLbs: handoverShiftSplit.amActualRawLbs,
            varianceBags:
              handoverShiftSplit.amVarianceBags !== null
                ? handoverShiftSplit.amVarianceBags
                : hasMeasuredPhysical
                  ? round2(varianceBags * amSpanShare)
                  : null,
            attributedDollarLossStore: amAttributedLossStore,
            leaders: amLeaders,
            taqueros: amTaqueros,
          },
          pm: {
            label: 'PM (05:00 PM – 05:59 AM)',
            theoRawLbs: pmTheoRawLbs,
            theoBags: bagWeightLbs > 0 ? round2(pmTheoRawLbs / bagWeightLbs) : 0,
            sharePct: round2(pmShareRatio * 100),
            actualBags: handoverShiftSplit.pmActualBags,
            actualRawLbs: handoverShiftSplit.pmActualRawLbs,
            varianceBags:
              handoverShiftSplit.pmVarianceBags !== null
                ? handoverShiftSplit.pmVarianceBags
                : hasMeasuredPhysical
                  ? round2(varianceBags * pmSpanShare)
                  : null,
            attributedDollarLossStore: pmAttributedLossStore,
            leaders: pmLeaders,
            taqueros: pmTaqueros,
          },
          dominantShift,
          attributionMode: handoverShiftSplit.hasExact5PmHandover ? 'exact_5pm_handover' : 'volume_weighted_exposure',
          handover5Pm: handoverShiftSplit,
        },
        physicalReconciliation: {
          hasMeasuredSpan: hasMeasuredPhysical,
          measuredStoresCount,
          t0: minT0,
          t1: maxT1,
          spanDays: avgSpanDays,
          wipCoolerNote: hasMeasuredPhysical && avgSpanDays < 5,
          openingBags: round2(physicalOpeningBags),
          arrivedBags: round2(physicalArrivedBags),
          expectedEndingBags: hasMeasuredPhysical
            ? round2(physicalOpeningBags + physicalArrivedBags - referenceTheoBags)
            : null,
          endingBags: round2(physicalEndingBags),
          fridgeBalanceBags: hasMeasuredPhysical ? round2(-varianceBags) : 0,
          fridgeBalanceDollarStore: hasMeasuredPhysical ? round2(-dollarLossStore) : 0,
          latestCloseCut: singleStore ? scopedSummaries[0]?.latestCloseCut || null : null,
          actualBags: physicalActualBags,
          actualRawLbs: round2(physicalActualRawLbs),
          spanTheoRawLbs: round2(referenceTheoRawLbs),
          spanTheoBags: referenceTheoBags,
          varianceRawLbs,
          varianceBags,
          variancePct,
          dollarLossStore,
          dollarLossBodega,
          excessOzPerTaco,
          excessOzPerBurrito,
          actualAvgOzPerTaco: round2(1.5 + excessOzPerTaco),
          actualAvgOzPerBurrito: round2(6.0 + excessOzPerBurrito),
          closingSobranteCookedLbs,
          closingSobranteDate,
          closingSobranteBy,
          hasNegativeCountAnomaly,
          invoiceNumbers: allScopedInvoices,
        },
        dailyFridgeLedger,
        storesComparison,
        escaleraDeMando,
        familyEquivalence,
        breakdown,
      },
    }
}
