/**
 * @module lib/inventory/historical-mass-balance
 * @description Motor causal de Balance de Masas Histórico (Historical Mass-Balance Engine)
 *              para calcular el consumo diario esperado de los 19 insumos de la Orden Diaria
 *              a La Bodega que NO son observables directamente por platillo en tickets de
 *              Toast POS (aguas frescas de autoservicio con refills, salsabar libre en comedor,
 *              bolsitas de salsa/mixta/limón/rajas para llevar y abarrotes internos de cocina).
 *
 * @businessRules
 *   - Ecuación Física Causal de Balance de Masas en cada cierre histórico `t < businessDate`:
 *       `Consumo_Real(t) = Sobrante_Apertura(t_prev) + Pedido_Recibido(t_prev) - Sobrante_Cierre(t)`
 *   - Normalización por volumen real de negocio:
 *       `Tasa_Por_1000_USD(t) = Consumo_Real(t) / (Ventas_Netas(t) / 1000)`
 *   - Cero fuga de datos del futuro (Strictly Causal): jamás lee conteos ni órdenes de `businessDate`
 *     ni posteriores para estimar la tasa; únicamente usa cierres `histDate < businessDate`.
 *   - Sábado y Domingo se concilian juntos en el cierre del domingo (`t_prev = viernes`,
 *     ventas = `NetSales(Sáb) + NetSales(Dom)`). En sábado (`dayOfWeek === 6`) no hay cierre diario.
 *   - Ventanas adaptativas por familia operativa:
 *       * Bebidas estacionales sensibles al clima (`Horchata`, `Tamarindo`, `Jamaica`, `Piña`,
 *         `Champurrado Mix`): ventana primaria de **14 días** para reaccionar rápido a cambios de
 *         temperatura (ej. entrada de frío en otoño/invierno), con respaldo de 28/42 días.
 *       * Salsabar, condimentos de empaque y cocina (`Salsa Roja/Verde`, `Packs 1.5 oz`, `Mixta`,
 *         `Onion/Cil`, `Rajas`, `Limas`, `Frijol Entero`, `Queso Tortas`, `Viva Lard`): ventana
 *         primaria de **28 días** estratificada entre semana (Lun-Vie) vs fin de semana (Sáb+Dom).
 *   - Filtrado de anomalías de captura:
 *       * Ignora días con entregas inverosímiles (`isImplausibleArrivalQuantity`).
 *       * Ignora consumos aparentes negativos (`Consumo_Real < 0`, ej. préstamos entre tiendas,
 *         órdenes extraordinarias no ligadas o cambios puntuales entre contar piezas vs paquetes).
 *       * Recorta outliers extremos superiores (`> mediana * 4 + 2` cuando hay >= 5 muestras)
 *         antes de tomar la mediana robusta.
 *   - Respaldo intradía de ventas a medianoche: si al cerrar el conteo (~12:30 AM - 2:00 AM)
 *     `sales_daily_cache` aún va detrás del conteo vivo de órdenes de Toast (`liveActiveOrders`),
 *     escala proporcionalmente las ventas netas del día con `liveActiveOrders` o el ticket promedio
 *     histórico de la sucursal para evitar subestimar consumo.
 *
 * @dataFlow
 *   Supabase (`inventory_counts`, `inventory_order_lines` + `inventory_orders`, `sales_daily_cache`)
 *   + catálogo de Orden Diaria + `liveActiveOrders` opcional -> `getHistoricalMassBalanceUsage()`
 *   -> `Map<inventory_item_id, number>` (en unidades exactas de conteo/orden de Bodega).
 *
 * @notes
 *   - [2026-11-09] Creado en Paso 2 de la arquitectura dual de Orden Diaria (Lynwood #14 y Slauson #7)
 *     para complementar el motor determinista de recetas Toast (`daily-order-consumption-engine.ts`),
 *     logrando cobertura honesta de los 51 insumos sin ocultar productos con guiones (`'-'`).
 *   - [2026-11-10] Blindaje Paso 3 contra retroalimentación circular (`AUTO_CYCLE_V2`): los pre-llenados
 *     virtuales de ciclo (`counted_by = 'AUTO_CYCLE_V2'`) jamás se usan como anclas físicas; el motor
 *     calcula tramos telescópicos exactos de conservación de masa entre conteos físicos reales consecutivos
 *     (`1 <= spanDays <= 15`, incluyendo cierres dominicales `Dom -> Dom`).
 *   - [2026-11-11] Caché de 2 min con `options.forceRefresh`, soporte de consumo `0` al inicio de jornada
 *     (`liveActiveOrders === 0` verificado en Toast POS) y guarda `fail-closed` para fechas futuras (`businessDate > todayLa`).
 *   - Todas las consultas a Supabase usan paginación explícita `.range(from, to)` para evitar el
 *     truncamiento silencioso de 1,000 filas de PostgREST.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import {
  AUTO_CYCLE_COUNT_MARKER,
  isExternalTrackOnlyDessert,
  isImplausibleArrivalQuantity,
} from './automation-pilot'

export interface MassBalanceCatalogItem {
  id: string
  name: string
}

export interface HistoricalCountPoint {
  inventoryItemId: string
  countDate: string
  quantityOnHand: number
  countedBy?: string | null
  notes?: string | null
}

export function isAutoCycleCountRecord(point: {
  countedBy?: string | null
  notes?: string | null
}): boolean {
  if (String(point.countedBy || '').trim().toUpperCase() === AUTO_CYCLE_COUNT_MARKER) return true
  if (String(point.notes || '').trim().toLowerCase() === 'auto_cycle_v2') return true
  return false
}

export interface HistoricalOrderArrivalPoint {
  inventoryItemId: string
  orderDate: string
  deliveredQty: number
  parValue: number
  calculatedQty: number
}

export interface HistoricalDailySalesPoint {
  businessDate: string
  netSales: number
  orderCount: number
}

export interface MassBalanceItemDetail {
  inventoryItemId: string
  itemName: string
  estimatedUsage: number
  ratePer1kNetSales: number
  sampleCount: number
  windowDaysUsed: number
  regimeMatched: boolean
}

export interface HistoricalMassBalanceResult {
  status: 'ok' | 'unavailable'
  reason: string
  targetNetSales: number
  usageByItemId: Map<string, number>
  detailsByItemId: Map<string, MassBalanceItemDetail>
}

const normalizeText = (val: string | null | undefined): string =>
  String(val || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** IDs canónicos de los 19 insumos de Orden Diaria gobernados por Balance de Masas Histórico */
export const MASS_BALANCE_CANONICAL_IDS = new Set<string>([
  '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata
  'b6f3f5de-c554-4650-b0df-09dd5d3ca053', // Tamarindo Concentrate
  '6051e960-7564-41f6-9a52-ff79ed7c6353', // Jamaica Concentrate
  '9851a32c-dc35-4653-a1e4-b2cf7bac9009', // Piña Concentrate
  '808c43e2-df89-4b6d-bef3-2f5c7310914c', // Champurrado Mix
  'aa8d2711-fbd7-45b7-9223-52a2722ffd0e', // Salsa Roja (1 gal salsabar)
  '68a502a5-7e28-4b63-a830-47b9acb91bdf', // Salsa Verde (1 gal salsabar)
  'a639ad41-81bf-4de6-8dbc-0291005654ad', // 1.5 oz Salsa Roja Pack (400 ct)
  '6c0a3378-8309-48c9-a438-15313cabd9d8', // 1.5 oz Salsa Verde Pack (400 ct)
  '88a992db-c021-4719-88f9-58c70302392e', // Frijol Entero (10 lb salsabar)
  '90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb', // 1 oz Bolsa de Mixta (190 ct)
  'ea165e4e-d939-49a8-af9a-7bc186f50e2e', // Onion/ Cil. Mix 1/4 (5 lb)
  '34720160-015c-4623-bb1e-98da0e7b4e51', // Queso Tortas/platos/Desayuno (20 pza)
  'd56d8df8-d30c-4964-a425-9aa25d962364', // Rajas y Zanahorias (6.56 lb salsabar)
  'b4e7349c-669a-42e6-9810-ec3a7673b3f2', // 2 oz Bolsas de Rajas con Zanahoria (165 pza)
  'c6b172dc-7455-403a-a61f-c1079ff036fc', // Onion Pepper Mix (5 lb)
  'f73fe7a6-105c-4624-a87b-07d5f78c09ea', // Lima Bolsita (210 ct)
  '0c1f780a-1166-44fd-aa51-879173fa0861', // Bolsa Lima 5 LB
  'cbb0ce87-dac0-4741-a4f1-f9d2911fcaf1', // Viva Lard (Manteca)
  // Ítems adicionales sin receta POS presentes en plantillas diarias específicas (#4 Azusa, #10 La Puente, #12 Norwalk)
  '4013d253-c768-48d6-bed4-28750391f37f', // Agua Para Los Clientes
  'd66c2fbf-4e83-45f1-b0c0-e9de57c6dbac', // Agua Gavilan
  'cb91a193-87fd-402b-88ca-f9cec8d15a25', // Cover Para Taco
  'b8572de9-d11a-4a3c-84eb-49ae0cb732bd', // Gavilan Catering box 231880
])

const SEASONAL_BEVERAGE_CANONICAL_IDS = new Set<string>([
  '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata
  'b6f3f5de-c554-4650-b0df-09dd5d3ca053', // Tamarindo Concentrate
  '6051e960-7564-41f6-9a52-ff79ed7c6353', // Jamaica Concentrate
  '9851a32c-dc35-4653-a1e4-b2cf7bac9009', // Piña Concentrate
  '808c43e2-df89-4b6d-bef3-2f5c7310914c', // Champurrado Mix
])

const SEASONAL_BEVERAGE_PATTERNS: RegExp[] = [
  /^(?:concentrado\s+de\s+)?horchata(?:\s+concentrate)?$/,
  /^(?:concentrado\s+de\s+)?tamarindo(?:\s+concentrate)?$/,
  /^(?:concentrado\s+de\s+)?jamaica(?:\s+concentrate)?$/,
  /^(?:concentrado\s+de\s+)?pina(?:\s+concentrate)?$/,
  /^champurrado(?:\s+mix)?$/,
]

const SALSABAR_AND_BULK_PATTERNS: RegExp[] = [
  /^salsa\s+(?:roja|verde)$/,
  /^1(?:\.5)?\s*oz\s*salsa\s*(?:roja|verde)\s*pack$/,
  /^frijol\s+entero$/,
  /^1\s*oz\s*bolsa\s*de\s*mixta$/,
  /^onion\/?\s*cil\.?\s*mix(?:\s*1\/4)?$/,
  /^queso\s+tortas\/platos\/desayuno$/,
  /^rajas\s+y\s+zanahorias$/,
  /^2\s*oz\s*bolsas?\s*de\s*rajas\s*con\s*zanahoria$/,
  /^onion\s+pepper\s+mix$/,
  /^lima\s+bolsita$/,
  /^bolsa\s+lima\s+5\s*lb$/,
  /^viva\s+lard(?:\s*\(manteca\))?$/,
  /^agua\s+para\s+los\s+clientes$/,
  /^agua\s+gavilan$/,
  /^gavilan\s+catering\s+box(?:\s+\d+)?$/,
  /^cover\s+para\s+taco$/,
]

export function isSeasonalBeverageMassBalanceItem(item: MassBalanceCatalogItem): boolean {
  if (SEASONAL_BEVERAGE_CANONICAL_IDS.has(item.id)) return true
  const norm = normalizeText(item.name)
  return SEASONAL_BEVERAGE_PATTERNS.some(p => p.test(norm))
}

export function isHistoricalMassBalanceItem(item: MassBalanceCatalogItem): boolean {
  if (MASS_BALANCE_CANONICAL_IDS.has(item.id)) return true
  const norm = normalizeText(item.name)
  return SEASONAL_BEVERAGE_PATTERNS.some(p => p.test(norm)) ||
    SALSABAR_AND_BULK_PATTERNS.some(p => p.test(norm))
}

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().split('T')[0]
}

export function computeRobustMedian(values: number[]): number {
  const clean = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b)
  if (clean.length === 0) return 0
  const rawMid = Math.floor(clean.length / 2)
  const rawMed = clean.length % 2 === 1 ? clean[rawMid] : (clean[rawMid - 1] + clean[rawMid]) / 2

  // Si hay suficientes muestras, recortar saltos extremos por cambios puntuales de unidad de conteo
  let trimmed = clean
  if (clean.length >= 5) {
    const upperCap = rawMed * 4 + 2
    const filtered = clean.filter(v => v <= upperCap)
    if (filtered.length >= 3) trimmed = filtered
  }

  const mid = Math.floor(trimmed.length / 2)
  return trimmed.length % 2 === 1 ? trimmed[mid] : (trimmed[mid - 1] + trimmed[mid]) / 2
}

/**
 * Núcleo matemático puro (100% determinista y libre de I/O) para pruebas unitarias y backtests.
 */
export function calculateCausalMassBalanceFromSeries(params: {
  businessDate: string
  items: MassBalanceCatalogItem[]
  counts: HistoricalCountPoint[]
  arrivals: HistoricalOrderArrivalPoint[]
  sales: HistoricalDailySalesPoint[]
  liveActiveOrders?: number
}): HistoricalMassBalanceResult {
  const { businessDate, items, counts, arrivals, sales, liveActiveOrders } = params

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return {
      status: 'unavailable',
      reason: 'Fecha de negocio inválida en balance de masas',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const targetDateObj = new Date(`${businessDate}T12:00:00Z`)
  if (Number.isNaN(targetDateObj.getTime())) {
    return {
      status: 'unavailable',
      reason: 'Fecha de negocio inválida en balance de masas',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const targetDow = targetDateObj.getUTCDay()
  if (targetDow === 6) {
    return {
      status: 'unavailable',
      reason: 'Sábado se concilia junto con el cierre del domingo',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const targetItems = items.filter(isHistoricalMassBalanceItem)
  if (targetItems.length === 0) {
    return {
      status: 'ok',
      reason: 'Sin insumos configurados para balance de masas',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  // Indexar conteos físicos históricos (< businessDate únicamente para entrenamiento causal)
  // EXCLUYENDO estrictamente pre-llenados virtuales de ciclo (`AUTO_CYCLE_V2`) para impedir retroalimentación circular.
  const countMap = new Map<string, number>()
  const itemDatesMap = new Map<string, Set<string>>()
  for (const c of counts) {
    if (isAutoCycleCountRecord(c)) continue
    if (!Number.isFinite(c.quantityOnHand) || c.quantityOnHand < 0) continue
    if (c.countDate < businessDate) {
      const cDow = new Date(`${c.countDate}T12:00:00Z`).getUTCDay()
      if (cDow === 6) continue // Sábado no tiene cierre diario independiente
      countMap.set(`${c.inventoryItemId}:${c.countDate}`, c.quantityOnHand)
      if (!itemDatesMap.has(c.inventoryItemId)) itemDatesMap.set(c.inventoryItemId, new Set())
      itemDatesMap.get(c.inventoryItemId)!.add(c.countDate)
    }
  }

  // Indexar llegadas de pedidos diarios (< businessDate), bloqueando capturas inverosímiles y postres externos TRACK_ONLY
  const arrivalMap = new Map<string, number>()
  const unreliableArrivalKeys = new Set<string>()
  for (const a of arrivals) {
    if (a.orderDate >= businessDate) continue
    if (isExternalTrackOnlyDessert({ inventory_item_id: a.inventoryItemId })) continue
    const key = `${a.inventoryItemId}:${a.orderDate}`
    if (!Number.isFinite(a.deliveredQty) || a.deliveredQty < 0 ||
      isImplausibleArrivalQuantity(a.deliveredQty, a.parValue, a.calculatedQty)) {
      unreliableArrivalKeys.add(key)
      continue
    }
    arrivalMap.set(key, (arrivalMap.get(key) || 0) + a.deliveredQty)
  }

  // Indexar ventas netas y conteo de órdenes
  const salesMap = new Map<string, { netSales: number; orderCount: number }>()
  let histSalesSum = 0
  let histOrdersSum = 0
  for (const s of sales) {
    const net = Number(s.netSales)
    const ord = Number(s.orderCount)
    if (!Number.isFinite(net) || net < 0) continue
    salesMap.set(s.businessDate, {
      netSales: net,
      orderCount: Number.isFinite(ord) && ord > 0 ? ord : 0,
    })
    if (s.businessDate < businessDate && net > 500 && ord > 0) {
      histSalesSum += net
      histOrdersSum += ord
    }
  }

  // Resolver ventas netas efectivas del periodo objetivo (Lun-Vie = hoy; Dom = Sáb + Dom)
  const targetSalesDates = targetDow === 0
    ? [shiftIsoDate(businessDate, -1), businessDate]
    : [businessDate]

  let cachedTargetSales = 0
  let cachedTargetOrders = 0
  for (const d of targetSalesDates) {
    const row = salesMap.get(d)
    if (row) {
      cachedTargetSales += row.netSales
      cachedTargetOrders += row.orderCount
    }
  }

  let effectiveTargetSales = cachedTargetSales
  if (typeof liveActiveOrders === 'number' && Number.isFinite(liveActiveOrders) && liveActiveOrders > 0) {
    if (cachedTargetSales > 0 && cachedTargetOrders > 0 && liveActiveOrders > cachedTargetOrders * 1.02) {
      effectiveTargetSales = cachedTargetSales * (liveActiveOrders / cachedTargetOrders)
    } else if (cachedTargetSales <= 0 && histOrdersSum > 0) {
      const avgTicketNet = histSalesSum / histOrdersSum
      effectiveTargetSales = avgTicketNet * liveActiveOrders
    }
  }

  if (!Number.isFinite(effectiveTargetSales) || effectiveTargetSales <= 0) {
    if (liveActiveOrders === 0) {
      const zeroUsageMap = new Map<string, number>()
      for (const item of targetItems) {
        zeroUsageMap.set(item.id, 0)
      }
      return {
        status: 'ok',
        reason: '0 órdenes activas verificadas en Toast POS (consumo 0 al inicio de jornada)',
        targetNetSales: 0,
        usageByItemId: zeroUsageMap,
        detailsByItemId: new Map(),
      }
    }
    return {
      status: 'unavailable',
      reason: 'Sin ventas netas registradas para escalar balance de masas histórico',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const isTargetSunday = targetDow === 0
  const minDate14 = shiftIsoDate(businessDate, -14)
  const minDate28 = shiftIsoDate(businessDate, -28)
  const minDate42 = shiftIsoDate(businessDate, -42)

  const usageByItemId = new Map<string, number>()
  const detailsByItemId = new Map<string, MassBalanceItemDetail>()

  for (const item of targetItems) {
    const isSeasonal = isSeasonalBeverageMassBalanceItem(item)
    const primaryMinDate = isSeasonal ? minDate14 : minDate28

    const samplesPrimaryRegime: number[] = []
    const samplesPrimaryAll: number[] = []
    const samples28Regime: number[] = []
    const samples28All: number[] = []
    const samples42All: number[] = []

    const sortedItemDates = Array.from(itemDatesMap.get(item.id) || []).sort()

    // Detectar saltos imposibles sin pedido (ej. un encargado contó rebanadas sueltas 24 en vez de 1 paquete de 20)
    // para no tomar el día inflado como apertura del día siguiente.
    const spikedCountDates = new Set<string>()
    for (let k = 1; k < sortedItemDates.length; k++) {
      const d0 = sortedItemDates[k - 1]
      const d1 = sortedItemDates[k]
      const span = Math.round((Date.parse(`${d1}T12:00:00Z`) - Date.parse(`${d0}T12:00:00Z`)) / 86_400_000)
      if (span < 1 || span > 3) continue
      const c0 = countMap.get(`${item.id}:${d0}`)
      const c1 = countMap.get(`${item.id}:${d1}`)
      if (c0 === undefined || c1 === undefined) continue
      let arr = 0
      for (let s = 0; s < span; s++) {
        arr += arrivalMap.get(`${item.id}:${shiftIsoDate(d0, s)}`) || 0
      }
      if (c0 + arr - c1 < -2) {
        spikedCountDates.add(d1)
      }
    }

    for (let idx = 1; idx < sortedItemDates.length; idx++) {
      const prevDate = sortedItemDates[idx - 1]
      const histDate = sortedItemDates[idx]
      if (histDate < minDate42 || histDate >= businessDate) continue
      if (spikedCountDates.has(prevDate) || spikedCountDates.has(histDate)) continue

      const prevMs = Date.parse(`${prevDate}T12:00:00Z`)
      const currMs = Date.parse(`${histDate}T12:00:00Z`)
      const spanDays = Math.round((currMs - prevMs) / 86_400_000)
      if (spanDays < 1 || spanDays > 15) continue

      const hDow = new Date(currMs).getUTCDay()
      if (hDow === 6) continue

      const prevCount = countMap.get(`${item.id}:${prevDate}`)
      const currCount = countMap.get(`${item.id}:${histDate}`)
      if (prevCount === undefined || currCount === undefined) continue

      // Sumar todas las llegadas físicas en [prevDate, histDate) verificando que ninguna sea inverosímil
      let arrived = 0
      let hasUnreliableSpanArrival = false
      for (let step = 0; step < spanDays; step++) {
        const dOrder = shiftIsoDate(prevDate, step)
        const arrivalKey = `${item.id}:${dOrder}`
        if (unreliableArrivalKeys.has(arrivalKey)) {
          hasUnreliableSpanArrival = true
          break
        }
        arrived += arrivalMap.get(arrivalKey) || 0
      }
      if (hasUnreliableSpanArrival) continue

      const physicalConsumption = prevCount + arrived - currCount
      if (!Number.isFinite(physicalConsumption) || physicalConsumption < 0) continue

      // Sumar ventas netas en (prevDate, histDate] exigiendo cobertura de ventas en cada día del tramo
      let periodNetSales = 0
      let missingDaySales = false
      for (let step = 1; step <= spanDays; step++) {
        const dSales = shiftIsoDate(prevDate, step)
        const dayNet = salesMap.get(dSales)?.netSales || 0
        if (dayNet <= 200) {
          missingDaySales = true
          break
        }
        periodNetSales += dayNet
      }
      if (missingDaySales || !Number.isFinite(periodNetSales) || periodNetSales <= 500) continue

      const ratePer1k = physicalConsumption / (periodNetSales / 1000)
      if (!Number.isFinite(ratePer1k) || ratePer1k < 0) continue

      const isPureDailyWeekday = spanDays === 1 && hDow >= 1 && hDow <= 5
      const isPureWeekend = spanDays === 2 && hDow === 0
      const sameRegime = isTargetSunday ? isPureWeekend : isPureDailyWeekday

      samples42All.push(ratePer1k)
      if (histDate >= minDate28) {
        samples28All.push(ratePer1k)
        if (sameRegime) samples28Regime.push(ratePer1k)
      }
      if (histDate >= primaryMinDate) {
        samplesPrimaryAll.push(ratePer1k)
        if (sameRegime) samplesPrimaryRegime.push(ratePer1k)
      }
    }

    let chosenSamples: number[] = []
    let windowDaysUsed = isSeasonal ? 14 : 28
    let regimeMatched = false

    if (isTargetSunday && samples28Regime.length >= 2) {
      // En cierres dominicales (Sáb+Dom), 28 días contiene hasta 4 domingos comparables
      chosenSamples = samples28Regime
      windowDaysUsed = 28
      regimeMatched = true
    } else if (!isTargetSunday && samplesPrimaryRegime.length >= 3) {
      chosenSamples = samplesPrimaryRegime
      windowDaysUsed = isSeasonal ? 14 : 28
      regimeMatched = true
    } else if (samplesPrimaryAll.length >= 3) {
      chosenSamples = samplesPrimaryAll
      windowDaysUsed = isSeasonal ? 14 : 28
    } else if (samples28All.length >= 3) {
      chosenSamples = samples28All
      windowDaysUsed = 28
    } else if (samples42All.length >= 1) {
      chosenSamples = samples42All
      windowDaysUsed = 42
    }

    if (chosenSamples.length === 0) continue

    const ratePer1kNetSales = computeRobustMedian(chosenSamples)
    const rawEstimated = ratePer1kNetSales * (effectiveTargetSales / 1000)
    if (!Number.isFinite(rawEstimated) || rawEstimated < 0) continue

    const estimatedUsage = Number(rawEstimated.toFixed(4))
    usageByItemId.set(item.id, estimatedUsage)
    detailsByItemId.set(item.id, {
      inventoryItemId: item.id,
      itemName: item.name,
      estimatedUsage,
      ratePer1kNetSales: Number(ratePer1kNetSales.toFixed(4)),
      sampleCount: chosenSamples.length,
      windowDaysUsed,
      regimeMatched,
    })
  }

  return {
    status: 'ok',
    reason: `Balance de masas histórico causal (${usageByItemId.size}/${targetItems.length} SKU, ventas base $${effectiveTargetSales.toFixed(2)})`,
    targetNetSales: Number(effectiveTargetSales.toFixed(2)),
    usageByItemId,
    detailsByItemId,
  }
}

async function fetchPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

const massBalanceCache = new Map<string, { expiresAt: number; value: HistoricalMassBalanceResult }>()
const MASS_BALANCE_TTL_MS = 2 * 60 * 1000 // 2 min en interacciones de UI

function cloneMassBalanceResult(src: HistoricalMassBalanceResult): HistoricalMassBalanceResult {
  return {
    status: src.status,
    reason: src.reason,
    targetNetSales: src.targetNetSales,
    usageByItemId: new Map(src.usageByItemId),
    detailsByItemId: new Map(src.detailsByItemId),
  }
}

/**
 * Consulta Supabase de manera paginada y causal (`< businessDate` para tasas) y devuelve
 * el consumo estimado de aguas frescas, salsabar y abarrotes internos para `businessDate`.
 */
export async function getHistoricalMassBalanceUsage(
  storeId: number,
  businessDate: string,
  items: MassBalanceCatalogItem[],
  liveActiveOrders?: number,
  options?: { forceRefresh?: boolean }
): Promise<HistoricalMassBalanceResult> {
  const targetItems = items.filter(isHistoricalMassBalanceItem)
  if (targetItems.length === 0) {
    return {
      status: 'ok',
      reason: 'Sin insumos de balance de masas en plantilla',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const businessDay = new Date(`${businessDate}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || Number.isNaN(businessDay.getTime())) {
    return {
      status: 'unavailable',
      reason: 'Fecha de negocio inválida',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }
  if (businessDay.getUTCDay() === 6) {
    return {
      status: 'unavailable',
      reason: 'Sábado se concilia junto con el cierre del domingo',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }
  const laParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const laMap: Record<string, string> = {}
  for (const p of laParts) laMap[p.type] = p.value
  const laCursor = new Date(
    Date.UTC(Number(laMap.year), Number(laMap.month) - 1, Number(laMap.day), 12, 0, 0)
  )
  if ((Number(laMap.hour) % 24) < 6) laCursor.setUTCDate(laCursor.getUTCDate() - 1)
  const todayLaIso = laCursor.toISOString().slice(0, 10)
  if (businessDate > todayLaIso) {
    return {
      status: 'unavailable',
      reason: 'Día comercial futuro aún no iniciado',
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }

  const cacheKey = `${storeId}:${businessDate}:${liveActiveOrders ?? 'na'}:${targetItems.length}`
  if (!options?.forceRefresh) {
    const hit = massBalanceCache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) {
      return cloneMassBalanceResult(hit.value)
    }
  }

  try {
    const db = await getSupabaseAdminClient()
    const { data: store, error: storeError } = await db
      .from('stores')
      .select('external_id')
      .eq('id', storeId)
      .single()

    if (storeError || !store?.external_id) {
      return {
        status: 'unavailable',
        reason: `Tienda sin Toast external_id: ${storeError?.message || 'vacío'}`,
        targetNetSales: 0,
        usageByItemId: new Map(),
        detailsByItemId: new Map(),
      }
    }

    // 50 días hacia atrás cubren la ventana extendida de 42 días + tramos dominicales previos
    const lookbackStart = shiftIsoDate(businessDate, -50)
    const targetIds = targetItems.map(i => i.id)

    const [rawCounts, rawOrderLines, rawSales] = await Promise.all([
      fetchPaginated<any>((from, to) =>
        db.from('inventory_counts')
          .select('inventory_item_id, count_date, quantity_on_hand, counted_by, notes')
          .eq('store_id', String(storeId))
          .in('inventory_item_id', targetIds)
          .gte('count_date', lookbackStart)
          .lt('count_date', businessDate)
          .order('count_date', { ascending: true })
          .order('inventory_item_id', { ascending: true })
          .range(from, to)
      ),
      fetchPaginated<any>((from, to) =>
        db.from('inventory_order_lines')
          .select('inventory_item_id, final_qty, adjusted_qty, calculated_qty, par_value, id, inventory_orders!inner(order_date, store_id, order_type, status)')
          .eq('inventory_orders.store_id', storeId)
          .eq('inventory_orders.order_type', 'daily')
          .in('inventory_orders.status', ['sent', 'received'])
          .in('inventory_item_id', targetIds)
          .gte('inventory_orders.order_date', lookbackStart)
          .lt('inventory_orders.order_date', businessDate)
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchPaginated<any>((from, to) =>
        db.from('sales_daily_cache')
          .select('business_date, net_sales, order_count')
          .eq('store_id', store.external_id)
          .gte('business_date', lookbackStart)
          .lte('business_date', businessDate)
          .order('business_date', { ascending: true })
          .range(from, to)
      ),
    ])

    const counts: HistoricalCountPoint[] = rawCounts.map((r: any) => ({
      inventoryItemId: String(r.inventory_item_id),
      countDate: String(r.count_date),
      quantityOnHand: Number(r.quantity_on_hand),
      countedBy: r.counted_by ?? null,
      notes: r.notes ?? null,
    }))

    const arrivals: HistoricalOrderArrivalPoint[] = rawOrderLines.map((r: any) => ({
      inventoryItemId: String(r.inventory_item_id),
      orderDate: String(r.inventory_orders?.order_date || ''),
      deliveredQty: Number(r.final_qty ?? r.adjusted_qty ?? r.calculated_qty ?? 0),
      parValue: Number(r.par_value ?? 0),
      calculatedQty: Number(r.calculated_qty ?? 0),
    }))

    const sales: HistoricalDailySalesPoint[] = rawSales.map((r: any) => ({
      businessDate: String(r.business_date),
      netSales: Number(r.net_sales ?? 0),
      orderCount: Number(r.order_count ?? 0),
    }))

    const computed = calculateCausalMassBalanceFromSeries({
      businessDate,
      items: targetItems,
      counts,
      arrivals,
      sales,
      liveActiveOrders,
    })
    if (computed.status === 'ok') {
      massBalanceCache.set(cacheKey, { expiresAt: Date.now() + MASS_BALANCE_TTL_MS, value: computed })
    }
    return cloneMassBalanceResult(computed)
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
      targetNetSales: 0,
      usageByItemId: new Map(),
      detailsByItemId: new Map(),
    }
  }
}
