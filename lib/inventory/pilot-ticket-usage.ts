/**
 * @module lib/inventory/pilot-ticket-usage
 * @description Previsualiza consumo de Orden Diaria desde tickets Toast reales para el piloto.
 * @businessRules Fuente estable en dos lecturas; los SKU afectados por sabor/carne no
 *                observados quedan bloqueados. Las carnes en bolsas cerradas no producen
 *                un sobrante teórico comparable con las onzas vendidas.
 * @dataFlow Toast ordersBulk + recetas/catálogo Supabase (solo SELECT) -> motor diario
 *           -> consumo por SKU y estado de cobertura. No escribe inventory_usage_log.
 * @notes Los tamaños de empaque históricos o de Slauson requieren versión por tienda/fecha;
 *        esta previsualización usa unidades actuales de Lynwood desde septiembre de 2026.
 *        [2026-09-30] Papelito Para Torta sobrante el domingo se desecha y se captura
 *        como cero utilizable; salsa roja/verde de salsabar tampoco se observa en Toast.
 *        Ninguno debe mostrarse como sobrante automático certificado.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { comparableTicketDigest, fetchStableToastTicketSource } from './toast-ticket-source'
import { calculateDailyOrderConsumption, type InventoryItemCatalogEntry, type RawToastTicket, type RecipeRow } from './daily-order-consumption-engine'

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
  sourceStatus: 'unavailable', sourceReason: reason, usageByItemId: new Map(),
  blockedItemIds: new Set(), allItemsBlocked: true, tickets: 0, selections: 0, uncovered: [],
})

async function rows<T>(table: string, columns: string): Promise<T[]> {
  const db = await getSupabaseAdminClient()
  const output: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 499)
    if (error || !data) throw new Error(`${table}: ${error?.message || 'respuesta vacía'}`)
    output.push(...data as T[])
    if (data.length < 500) return output
  }
}

async function snapshotsForDate(storeId: number, date: string): Promise<RawToastTicket[]> {
  const db = await getSupabaseAdminClient()
  const output: RawToastTicket[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from('toast_ticket_consumption_snapshots')
      .select('toast_order_guid,dining_option_name,channel_metadata,selections')
      .eq('store_id', storeId).eq('business_date', date)
      .order('toast_order_guid').range(from, from + 499)
    if (error || !data) throw new Error(`Snapshots ${date}: ${error?.message || 'respuesta vacía'}`)
    output.push(...data as RawToastTicket[])
    if (data.length < 500) return output
  }
}

const isMeat = (name: string) => /^(?:asada|carne asada|pastor|pollo|cabeza|lengua|chorizo(?:\s+\d+\s*oz)?|carnitas(?:\s+\d+\s*oz)?|buche(?:\s+\d+\s*oz)?)$/i.test(name.trim())
const isWater = (name: string) => /^(?:horchata|tamarindo concentrate|jamaica concentrate|piña concentrate|pina concentrate)$/i.test(name.trim())
const isNonTicketOrExternal = (name: string) => /^(?:flan|cheesecake|frijol entero|salsa\s+(?:roja|verde)|1(?:\.5)?\s*oz\s*salsa\s*(?:roja|verde)\s*pack|1\s*oz\s*bolsa\s*de\s*mixta|lima bolsita|rajas y zanahorias)$/i.test(name.trim())

export function intrinsicPilotBlockedItemIds(items: Array<{ id: string; name: string }>, isSunday: boolean): Set<string> {
  return new Set(items.filter(item =>
    isMeat(item.name) || isNonTicketOrExternal(item.name) ||
    (isSunday && /papelito\s*para\s*torta/i.test(item.name))
  ).map(item => item.id))
}

export async function getPilotTicketUsage(storeId: number, businessDate: string): Promise<PilotTicketUsage> {
  // Actualmente solo Lynwood tiene empaques actuales conciliados en este motor.
  if (storeId !== 14) return empty('Empaques por tienda aún no versionados para esta sucursal')
  if (businessDate < '2026-09-01') return empty('Empaques históricos anteriores a septiembre aún no versionados')
  const businessDay = new Date(`${businessDate}T12:00:00Z`)
  if (Number.isNaN(businessDay.getTime())) return empty('Fecha de negocio inválida')
  if (businessDay.getUTCDay() === 6) return empty('Sábado se concilia junto con el cierre del domingo')
  const salesDates = businessDay.getUTCDay() === 0
    ? [new Date(businessDay.getTime() - 86_400_000).toISOString().slice(0, 10), businessDate]
    : [businessDate]
  const db = await getSupabaseAdminClient()
  const { data: store, error: storeError } = await db.from('stores').select('external_id').eq('id', storeId).single()
  if (storeError || !store?.external_id) return empty(`Tienda sin Toast external_id: ${storeError?.message || 'vacío'}`)

  try {
    const [sources, snapshots, recipes, items] = await Promise.all([
      Promise.all(salesDates.map(date => fetchStableToastTicketSource(store.external_id, date))),
      Promise.all(salesDates.map(date => snapshotsForDate(storeId, date))),
      rows<RecipeRow>('recipes', 'toast_menu_item_guid,inventory_item_id,quantity,unit,type'),
      rows<InventoryItemCatalogEntry>('inventory_items', 'id,name,unit_type,unit_measure,quantity_per_unit,order_rounding_rule,excel_reference'),
    ])
    let allSnapshotsPresent = true
    for (let index = 0; index < salesDates.length; index++) {
      if (snapshots[index].length === 0) {
        allSnapshotsPresent = false
        continue
      }
      if (sources[index].activeOrders !== snapshots[index].length ||
        comparableTicketDigest(sources[index].tickets) !== comparableTicketDigest(snapshots[index])) {
        return empty(`Snapshots incompletos o distintos de Toast para ${salesDates[index]}`)
      }
    }
    if (!recipes.length || !items.length) return empty('Catálogo o recetas vacíos')
    const calculated = calculateDailyOrderConsumption(storeId, businessDate, sources.flatMap(source => source.tickets), recipes, items)
    const blockedItemIds = new Set<string>()
    let allItemsBlocked = false
    for (const row of calculated.uncoveredProducts) {
      const name = row.name.toLowerCase()
      if (/sabor autoservicio no observado|sabor no registrado/.test(name)) {
        items.filter(item => isWater(item.name)).forEach(item => blockedItemIds.add(item.id))
      } else if (/carne no registrada|tacos sin carne registrada|cantidad de tacos modificadores incongruente/.test(name)) {
        items.filter(item => isMeat(item.name)).forEach(item => blockedItemIds.add(item.id))
      } else if (/^(?:cup of water|ice cup|vaso caliente agua)$/i.test(row.name)) {
        // Solo afecta vaso/empaque semanal, fuera de Orden Diaria.
      } else if (/modificador pendiente:\s*no\s+|para llevar|separador|test item|separator|in store|instore|add value/i.test(name)) {
        // Instrucciones de cocina o exclusión de ingrediente; no consumen inventario ni bloquean.
      } else {
        // Reportar producto sin receta; no bloquear todos los insumos conocidos.
      }
    }
    const usageByItemId = new Map<string, number>()
    for (const [itemId, usage] of calculated.itemConsumption) usageByItemId.set(itemId, usage.totalCalculatedUsage)
    return {
      sourceStatus: allSnapshotsPresent ? 'verified_live_and_snapshot' : 'verified_live_only',
      sourceReason: allItemsBlocked ? 'Hay productos sin receta que pueden afectar cualquier SKU' :
        `${allSnapshotsPresent ? 'Toast estable y snapshots coincidentes' : 'Toast estable en dos lecturas; sin snapshots de respaldo'}. ` +
        (calculated.uncoveredProducts.length ? 'Algunos SKU no son observables o no están mapeados' :
          'Aún pendiente certificar recetas y movimientos físicos'),
      usageByItemId, blockedItemIds, allItemsBlocked,
      tickets: sources.reduce((sum, source) => sum + source.activeOrders, 0), selections: calculated.totalSelections,
      uncovered: calculated.uncoveredProducts.map(row => ({ name: row.name, quantitySold: row.quantitySold })),
    }
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error))
  }
}
