/**
 * @module lib/inventory/historical-allocation
 * @description Calcula participaciones de consumo por insumo variable desde pedidos y sobrantes físicos de una tienda.
 * @businessRules
 *   - El consumo estimado de un día es: sobrante anterior + pedido anterior recibido − sobrante al cierre.
 *   - Se privilegia el mismo día de la semana durante las últimas ocho semanas.
 *   - Con menos de tres observaciones válidas, usa los últimos 28 días; sin evidencia, divide equitativamente.
 *   - Nunca usa una proporción de otra tienda mientras exista historial local.
 * @dataFlow
 *   inventory_orders + inventory_order_lines → observaciones diarias → pesos por insumo → receta virtual/consumo teórico.
 * @notes
 *   - La orden generada el día D se considera llegada para la operación del día D+1, conforme al flujo de Bodega.
 */

type OrderLine = {
  inventory_item_id: string
  final_qty: number | null
  adjusted_qty: number | null
  calculated_qty: number | null
  leftover_value: number | null
}

export type HistoricalOrder = {
  order_date: string
  inventory_order_lines: OrderLine[] | null
}

export type HistoricalAllocationSource = 'same_weekday' | 'recent_store' | 'equal_fallback'

export interface HistoricalAllocation {
  shares: Map<string, number>
  source: HistoricalAllocationSource
  observations: number
}

const toUtcDay = (date: string) => new Date(`${date}T12:00:00Z`)
const addDays = (date: string, days: number) => {
  const value = toUtcDay(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const quantityOrdered = (line?: OrderLine) => Number(line?.final_qty ?? line?.adjusted_qty ?? line?.calculated_qty ?? 0)
const leftover = (line?: OrderLine) => Number(line?.leftover_value ?? 0)

export function calculateHistoricalAllocation(
  orders: HistoricalOrder[],
  candidateItemIds: string[],
  targetDate: string,
): HistoricalAllocation {
  const equal = () => new Map(candidateItemIds.map(id => [id, 1 / Math.max(1, candidateItemIds.length)]))
  if (candidateItemIds.length === 0) return { shares: new Map(), source: 'equal_fallback', observations: 0 }

  const candidateSet = new Set(candidateItemIds)
  const byDate = new Map<string, Map<string, OrderLine>>()
  for (const order of orders) {
    const lines = new Map<string, OrderLine>()
    for (const line of order.inventory_order_lines || []) {
      if (candidateSet.has(line.inventory_item_id)) lines.set(line.inventory_item_id, line)
    }
    byDate.set(order.order_date, lines)
  }

  const targetDayOfWeek = toUtcDay(targetDate).getUTCDay()
  const observations: { date: string; values: Map<string, number> }[] = []
  for (const [date, current] of byDate) {
    if (date >= targetDate) continue
    const previous = byDate.get(addDays(date, -1))
    if (!previous) continue
    const values = new Map<string, number>()
    let total = 0
    for (const itemId of candidateItemIds) {
      const estimate = Math.max(0, leftover(previous.get(itemId)) + quantityOrdered(previous.get(itemId)) - leftover(current.get(itemId)))
      values.set(itemId, estimate)
      total += estimate
    }
    if (total > 0) observations.push({ date, values })
  }

  const sameWeekday = observations
    .filter(observation => toUtcDay(observation.date).getUTCDay() === targetDayOfWeek)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
  const recent = observations
    .filter(observation => observation.date >= addDays(targetDate, -28))
    .sort((a, b) => b.date.localeCompare(a.date))

  const selected = sameWeekday.length >= 3 ? sameWeekday : recent
  if (selected.length === 0) return { shares: equal(), source: 'equal_fallback', observations: 0 }

  const totals = new Map(candidateItemIds.map(id => [id, 0]))
  for (const observation of selected) {
    for (const itemId of candidateItemIds) totals.set(itemId, (totals.get(itemId) || 0) + (observation.values.get(itemId) || 0))
  }
  const grandTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0)
  if (grandTotal <= 0) return { shares: equal(), source: 'equal_fallback', observations: 0 }

  return {
    shares: new Map(candidateItemIds.map(id => [id, (totals.get(id) || 0) / grandTotal])),
    source: sameWeekday.length >= 3 ? 'same_weekday' : 'recent_store',
    observations: selected.length,
  }
}
