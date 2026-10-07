/**
 * @module inventory/automation-pilot
 * @description Motor puro para comparar el sobrante automatico contra el conteo fisico
 *              durante el piloto controlado de Orden Diaria en Lynwood y Slauson.
 * @businessRules
 * - El conteo fisico permanece como fuente oficial durante el piloto.
 * - La estimacion automatica permanece oculta hasta cerrar el conteo completo.
 * - Carnes, articulos de alto costo y cajas visuales usan tolerancia de una unidad.
 * - Insumos operativos sin receta usan una tolerancia inicial de 15% (minimo una unidad).
 * @dataFlow Nombre de tienda -> elegibilidad del piloto; líneas calculadas + conteos físicos
 *           -> comparaciones persistibles del piloto.
 * @notes No escribe a DB y no recibe columnas generadas; se puede simular sin mocks.
 *   [2026-09-26] Slauson se incorpora al mismo piloto shadow de Lynwood.
 *   [2026-09-26] Un pedido histórico implausible se excluye como recepción inferida; no se compara ese sobrante automático.
 *   [2026-09-28] La comparación aplica la misma fórmula PAR menos sobrante a ambos lados;
 *   ningún colchón adicional altera el pedido oficial o el pedido teórico shadow.
 *   [2026-10-07] Desbloqueo de Lynwood: se eliminó la restricción exclusiva a Carlos Velázquez;
 *   ahora el manager/encargado asignado a Lynwood (así como Roque y Carlos) puede cerrar y validar el piloto.
 */

export type PilotComparisonInput = {
  inventory_item_id: string
  item_name: string
  physical_leftover: number
  automatic_leftover: number | null
  par_value: number
  rounding_rule?: string | null
}

export type PilotComparisonLine = PilotComparisonInput & {
  variance: number | null
  tolerance_value: number | null
  within_tolerance: boolean | null
  automatic_order_qty: number | null
  official_order_qty: number
}

export const INVENTORY_AUTOMATION_PILOT_STORES = ['Lynwood', 'Slauson'] as const

/** Devuelve el nombre canónico si la sucursal forma parte del piloto activo. */
export function getInventoryAutomationPilotStoreName(storeName: string | null | undefined): string | null {
  const normalized = (storeName || '').trim().toLowerCase()
  return INVENTORY_AUTOMATION_PILOT_STORES.find(name => normalized.includes(name.toLowerCase())) || null
}

export function isInventoryAutomationPilotStore(storeName: string | null | undefined): boolean {
  return getInventoryAutomationPilotStoreName(storeName) !== null
}

/** Rechaza capturas extremas sin limitar los ajustes manuales razonables del manager. */
export function isImplausibleArrivalQuantity(
  quantity: number,
  parValue: number | null | undefined,
  calculatedQuantity: number | null | undefined,
): boolean {
  if (!Number.isFinite(quantity) || quantity < 0) return true
  const par = Number.isFinite(parValue) ? Math.max(0, Number(parValue)) : 0
  const calculated = Number.isFinite(calculatedQuantity) ? Math.max(0, Number(calculatedQuantity)) : 0
  return quantity > Math.max(1000, par * 10, calculated * 10)
}

export type PilotCloseAuthorizationInput = {
  storeName: string
  targetStoreId: string | number
  userName: string
  userEmail: string
  userRole: string
  assignedStoreIds: Array<string | number>
}

/** Mantiene a Roque global y permite al manager/encargado asignado cerrar el piloto en su sucursal (Lynwood y Slauson). */
export function canCloseInventoryAutomationPilot(input: PilotCloseAuthorizationInput): boolean {
  const normalizedName = input.userName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const normalizedEmail = input.userEmail.trim().toLowerCase()
  const normalizedRole = input.userRole.trim().toLowerCase()
  const assignedStoreIds = new Set(input.assignedStoreIds.map(String))

  // 1. Roque y roles administrativos/supervisores tienen acceso global a cerrar cualquier piloto
  if (normalizedName === 'roque' || normalizedEmail.startsWith('roque@')) return true
  if (['admin', 'administrador', 'supervisor'].includes(normalizedRole)) return true

  // 2. Carlos Velázquez conserva acceso para supervisión
  if (normalizedName === 'carlos velazquez' || normalizedEmail.startsWith('carlos@')) return true

  // 3. Tiendas del piloto (Lynwood, Slauson):
  // Cualquier manager/gerente/asistente asignado a la sucursal puede cerrar y validar el piloto
  const isPilotStore = isInventoryAutomationPilotStore(input.storeName)
  if (!isPilotStore) return false

  const matchesAssignedStore = assignedStoreIds.has(String(input.targetStoreId))
    || Array.from(assignedStoreIds).some(s => {
      const sNorm = s.trim().toLowerCase()
      const targetNameNorm = input.storeName.trim().toLowerCase()
      return sNorm === targetNameNorm || targetNameNorm.includes(sNorm) || sNorm.includes(targetNameNorm)
    })

  return ['manager', 'gerente', 'asistente'].includes(normalizedRole) && matchesAssignedStore
}

const ONE_UNIT_PATTERNS = [
  /carne/i, /asada/i, /pastor/i, /pollo/i, /cabeza/i, /lengua/i,
  /chorizo/i, /carnitas/i, /buche/i, /salsa/i, /mixta/i, /lima/i,
  /rajas/i, /queso/i, /aguacate/i, /tortilla/i, /papelito/i, /quesadilla/i,
]

export function applyPilotRounding(value: number, rule?: string | null): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
  if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
  if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
  return Math.round(value)
}

export function getPilotTolerance(itemName: string, physicalLeftover: number): number {
  if (ONE_UNIT_PATTERNS.some(pattern => pattern.test(itemName))) return 1
  return Math.max(1, Number((Math.abs(physicalLeftover) * 0.15).toFixed(2)))
}

export function buildPilotComparisonLine(input: PilotComparisonInput): PilotComparisonLine {
  const officialOrderQty = applyPilotRounding(
    Math.max(0, input.par_value - input.physical_leftover),
    input.rounding_rule,
  )

  if (input.automatic_leftover === null || !Number.isFinite(input.automatic_leftover)) {
    return {
      ...input,
      variance: null,
      tolerance_value: null,
      within_tolerance: null,
      automatic_order_qty: null,
      official_order_qty: officialOrderQty,
    }
  }

  const variance = Number((input.physical_leftover - input.automatic_leftover).toFixed(4))
  const tolerance = getPilotTolerance(input.item_name, input.physical_leftover)

  const baseAuto = Math.max(0, input.par_value - input.automatic_leftover)

  return {
    ...input,
    variance,
    tolerance_value: tolerance,
    within_tolerance: Math.abs(variance) <= tolerance,
    automatic_order_qty: applyPilotRounding(baseAuto, input.rounding_rule),
    official_order_qty: officialOrderQty,
  }
}
