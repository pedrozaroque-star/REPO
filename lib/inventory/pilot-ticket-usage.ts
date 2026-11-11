/**
 * @module lib/inventory/pilot-ticket-usage
 * @description Calcula el consumo determinista por tickets reales de Toast POS para los insumos
 *              observables en punto de venta dentro del piloto supervisado de Orden Diaria
 *              (Lynwood #14 y Slauson #7).
 *
 * @businessRules
 *   - Requiere fuente estable de Toast en dos lecturas consecutivas (`fetchStableToastTicketSource`).
 *   - Si existen snapshots históricos (`toast_ticket_consumption_snapshots`), valida paridad contra ellos.
 *   - Habilitado para:
 *       * **Lynwood (`storeId === 14`)** desde `2026-09-01`.
 *       * **Slauson (`storeId === 7`)** desde `2026-09-19` (fecha en que Slauson homologó bolsas de
 *         5 lb en Pastor y Pollo y los 49 SKU de plantilla diaria).
 *       * **Resto de las 15 sucursales activas (`stores.external_id`)** desde `2026-10-01` (con empaques
 *         de carnes y catálogo diario homologados en las 15 tiendas).
 *   - Sábado (`dayOfWeek === 6`) no se cierra por separado; el domingo acumula las ventas de
 *     sábado + domingo para conciliar contra el cierre físico dominical.
 *   - Los 19 insumos de autoservicio, salsabar libre y cocina interna (aguas frescas, salsas,
 *     frijol entero, mixta, cebolla/cilantro, rajas, limas, manteca, etc.) se complementan en
 *     `actions.ts` mediante `lib/inventory/historical-mass-balance.ts`, sin bloquear ni ocultar
 *     productos detrás de `'-'`.
 *
 * @dataFlow
 *   Toast `ordersBulk` + recetas/catálogo Supabase (solo SELECT paginado) ->
 *   `calculateDailyOrderConsumption()` -> consumo por SKU y reporte de cobertura.
 *   No escribe en `inventory_usage_log`.
 *
 * @notes
 *   - [2026-09-30] `intrinsicPilotBlockedItemIds` se conserva exportada como clasificador de
 *     observabilidad directa en POS para pruebas de regresión de auditoría.
 *   - [2026-11-09] Habilitado Slauson (`storeId === 7`, `>= 2026-09-19`) y eliminado el bloqueo
 *     masivo de carnes/aguas ante notas sueltas o vasos de autoservicio para operar en conjunto
 *     con el motor causal de Balance de Masas Histórico en los 51 productos de Orden Diaria.
 *   - [2026-11-11] Caché inteligente por TTL (3 min jornada activa, 30 min jornadas cerradas, 5 min recetas/catálogo),
 *     soporte de `options.forceRefresh` para actualización manual en vivo desde UI, paginación determinista `.order('id')`
 *     en `rows()` para evitar desplazamientos entre páginas de PostgREST, y guarda `fail-closed` en fechas futuras (`businessDate > todayLa`).
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { comparableTicketDigest, fetchStableToastTicketSource } from './toast-ticket-source'
import {
  calculateDailyOrderConsumption,
  type InventoryItemCatalogEntry,
  type RawToastTicket,
  type RecipeRow,
} from './daily-order-consumption-engine'

export interface PilotTicketUsage {
  sourceStatus: 'verified_live_and_snapshot' | 'verified_live_only' | 'unavailable'
  sourceReason: string
  usageByItemId: Map<string, number>
  blockedItemIds: Set<string>
  allItemsBlocked: boolean
  tickets: number
  selections: number
  uncovered: Array<{ name: string; quantitySold: number }>
}

const empty = (reason: string): PilotTicketUsage => ({
  sourceStatus: 'unavailable',
  sourceReason: reason,
  usageByItemId: new Map(),
  blockedItemIds: new Set(),
  allItemsBlocked: true,
  tickets: 0,
  selections: 0,
  uncovered: [],
})

const LIVE_TICKET_CACHE_TTL_MS = 3 * 60 * 1000 // 3 min para jornada comercial activa
const HISTORICAL_TICKET_CACHE_TTL_MS = 30 * 60 * 1000 // 30 min para jornadas cerradas
const CATALOG_RECIPES_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min para recetas y catálogo

const ticketUsageCache = new Map<string, { expiresAt: number; value: PilotTicketUsage }>()
let cachedRecipesEntry: { expiresAt: number; data: RecipeRow[] } | null = null
let cachedCatalogEntry: { expiresAt: number; data: InventoryItemCatalogEntry[] } | null = null

function clonePilotTicketUsage(src: PilotTicketUsage): PilotTicketUsage {
  return {
    sourceStatus: src.sourceStatus,
    sourceReason: src.sourceReason,
    usageByItemId: new Map(src.usageByItemId),
    blockedItemIds: new Set(src.blockedItemIds),
    allItemsBlocked: src.allItemsBlocked,
    tickets: src.tickets,
    selections: src.selections,
    uncovered: src.uncovered.map(u => ({ ...u })),
  }
}

function getLaCurrentBusinessDateIso(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const dt = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), 12, 0, 0))
  if (Number(map.hour) % 24 < 6) dt.setUTCDate(dt.getUTCDate() - 1)
  return dt.toISOString().slice(0, 10)
}

async function rows<T>(table: string, columns: string): Promise<T[]> {
  const db = await getSupabaseAdminClient()
  const output: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + 499)
    if (error || !data) throw new Error(`${table}: ${error?.message || 'respuesta vacía'}`)
    output.push(...(data as T[]))
    if (data.length < 500) return output
  }
}

async function snapshotsForDate(storeId: number, date: string): Promise<RawToastTicket[]> {
  const db = await getSupabaseAdminClient()
  const output: RawToastTicket[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .from('toast_ticket_consumption_snapshots')
      .select('toast_order_guid,dining_option_name,channel_metadata,selections')
      .eq('store_id', storeId)
      .eq('business_date', date)
      .order('toast_order_guid')
      .range(from, from + 499)
    if (error || !data) throw new Error(`Snapshots ${date}: ${error?.message || 'respuesta vacía'}`)
    output.push(...(data as RawToastTicket[]))
    if (data.length < 500) return output
  }
}

const isMeat = (name: string) =>
  /^(?:asada|carne asada|pastor|pollo|cabeza|lengua|chorizo(?:\s+\d+\s*oz)?|carnitas(?:\s+\d+\s*oz)?|buche(?:\s+\d+\s*oz)?)$/i.test(name.trim())

const isNonTicketOrExternal = (name: string) =>
  /^(?:flan|cheesecake|frijol entero|salsa\s+(?:roja|verde)|1(?:\.5)?\s*oz\s*salsa\s*(?:roja|verde)\s*pack|1\s*oz\s*bolsa\s*de\s*mixta|lima bolsita|rajas y zanahorias)$/i.test(name.trim())

/**
 * Clasificador estático de SKU que no son puramente observables como bolsas cerradas / salsabar
 * únicamente desde tickets POS (conservado para auditoría de observabilidad directa).
 */
export function intrinsicPilotBlockedItemIds(items: Array<{ id: string; name: string }>, isSunday: boolean): Set<string> {
  return new Set(
    items
      .filter(
        item =>
          isMeat(item.name) ||
          isNonTicketOrExternal(item.name) ||
          (isSunday && /papelito\s*para\s*torta/i.test(item.name))
      )
      .map(item => item.id)
  )
}

export async function getPilotTicketUsage(
  storeId: number,
  businessDate: string,
  options?: { forceRefresh?: boolean }
): Promise<PilotTicketUsage> {
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return empty('Identificador de sucursal inválido')
  }
  if (storeId === 14 && businessDate < '2026-09-01') {
    return empty('Empaques históricos de Lynwood anteriores a 2026-09-01 aún no versionados')
  }
  if (storeId === 7 && businessDate < '2026-09-19') {
    return empty('Empaques históricos de Slauson anteriores a 2026-09-19 aún no versionados')
  }
  if (storeId !== 14 && storeId !== 7 && businessDate < '2026-10-01') {
    return empty('Empaques históricos de la sucursal anteriores a 2026-10-01 aún no versionados')
  }

  const businessDay = new Date(`${businessDate}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || Number.isNaN(businessDay.getTime())) {
    return empty('Fecha de negocio inválida')
  }
  if (businessDay.getUTCDay() === 6) {
    return empty('Sábado se concilia junto con el cierre del domingo')
  }
  const todayLa = getLaCurrentBusinessDateIso()
  if (businessDate > todayLa) {
    return empty('Día comercial futuro aún no iniciado')
  }

  const cacheKey = `${storeId}:${businessDate}`
  const nowMs = Date.now()
  if (!options?.forceRefresh) {
    const hit = ticketUsageCache.get(cacheKey)
    if (hit && hit.expiresAt > nowMs) {
      return clonePilotTicketUsage(hit.value)
    }
  }

  const salesDates =
    businessDay.getUTCDay() === 0
      ? [new Date(businessDay.getTime() - 86_400_000).toISOString().slice(0, 10), businessDate]
      : [businessDate]

  const db = await getSupabaseAdminClient()
  const { data: store, error: storeError } = await db
    .from('stores')
    .select('external_id')
    .eq('id', storeId)
    .single()
  if (storeError || !store?.external_id) {
    return empty(`Tienda sin Toast external_id: ${storeError?.message || 'vacío'}`)
  }

  try {
    const loadRecipes = async (): Promise<RecipeRow[]> => {
      if (!options?.forceRefresh && cachedRecipesEntry && cachedRecipesEntry.expiresAt > Date.now()) {
        return cachedRecipesEntry.data
      }
      const fetched = await rows<RecipeRow>('recipes', 'toast_menu_item_guid,inventory_item_id,quantity,unit,type')
      cachedRecipesEntry = { expiresAt: Date.now() + CATALOG_RECIPES_CACHE_TTL_MS, data: fetched }
      return fetched
    }

    const loadItems = async (): Promise<InventoryItemCatalogEntry[]> => {
      if (!options?.forceRefresh && cachedCatalogEntry && cachedCatalogEntry.expiresAt > Date.now()) {
        return cachedCatalogEntry.data
      }
      const fetched = await rows<InventoryItemCatalogEntry>(
        'inventory_items',
        'id,name,unit_type,unit_measure,quantity_per_unit,order_rounding_rule,excel_reference'
      )
      cachedCatalogEntry = { expiresAt: Date.now() + CATALOG_RECIPES_CACHE_TTL_MS, data: fetched }
      return fetched
    }

    const [sources, snapshots, recipes, items] = await Promise.all([
      Promise.all(salesDates.map(date => fetchStableToastTicketSource(store.external_id, date))),
      Promise.all(salesDates.map(date => snapshotsForDate(storeId, date))),
      loadRecipes(),
      loadItems(),
    ])

    let allSnapshotsPresent = true
    for (let index = 0; index < salesDates.length; index++) {
      if (snapshots[index].length === 0) {
        allSnapshotsPresent = false
        continue
      }
      if (
        sources[index].activeOrders !== snapshots[index].length ||
        comparableTicketDigest(sources[index].tickets) !== comparableTicketDigest(snapshots[index])
      ) {
        return empty(`Snapshots incompletos o distintos de Toast para ${salesDates[index]}`)
      }
    }

    if (!recipes.length || !items.length) {
      return empty('Catálogo o recetas vacíos')
    }

    const calculated = calculateDailyOrderConsumption(
      storeId,
      businessDate,
      sources.flatMap(source => source.tickets),
      recipes,
      items
    )

    // No bloqueamos carnes ni aguas en `blockedItemIds` por vasos de autoservicio o notas aisladas:
    // las aguas/salsabar/cocina se calculan vía `getHistoricalMassBalanceUsage` y las excepciones
    // puntuales quedan trazadas en `uncovered` sin ocultar productos detrás de '-'.
    const blockedItemIds = new Set<string>()
    const allItemsBlocked = false

    const usageByItemId = new Map<string, number>()
    for (const [itemId, usage] of calculated.itemConsumption) {
      usageByItemId.set(itemId, usage.totalCalculatedUsage)
    }

    const result: PilotTicketUsage = {
      sourceStatus: allSnapshotsPresent ? 'verified_live_and_snapshot' : 'verified_live_only',
      sourceReason: `${
        allSnapshotsPresent
          ? 'Toast estable y snapshots coincidentes'
          : 'Toast estable en dos lecturas; sin snapshots de respaldo'
      }. Motor dual: recetas POS + balance de masas histórico causal`,
      usageByItemId,
      blockedItemIds,
      allItemsBlocked,
      tickets: sources.reduce((sum, source) => sum + source.activeOrders, 0),
      selections: calculated.totalSelections,
      uncovered: calculated.uncoveredProducts.map(row => ({
        name: row.name,
        quantitySold: row.quantitySold,
      })),
    }

    const ttl = businessDate >= todayLa ? LIVE_TICKET_CACHE_TTL_MS : HISTORICAL_TICKET_CACHE_TTL_MS
    ticketUsageCache.set(cacheKey, { expiresAt: Date.now() + ttl, value: result })
    return clonePilotTicketUsage(result)
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error))
  }
}
