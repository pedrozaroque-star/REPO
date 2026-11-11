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
 *   [2026-11-09] Papelito Para Torta se cuenta en piezas individuales con escalón operativo `ceiling_30`
 *   (media caja = 30 piezas), por lo que su tolerancia unitaria equivale a 30 piezas y no a 1 pieza suelta.
 *   [2026-11-10] Incorpora Paso 3 (Modo Operativo de 2 Niveles `assisted_2tier` con Ancla Física Dominical
 *   y marcador `AUTO_CYCLE_V2`), partición determinista de los 17 SKU Críticos Diarios vs 34 Estables de Ciclo,
 *   exclusión de pedido Bodega (`order_qty = 0`) para postres externos `TRACK_ONLY` (`Flan`, `Cheesecake`),
 *   y el modo definitivo `'auto_order_visible'` en las 15 sucursales (51 SKU visibles con orden a QB
 *   pre-calculada desde el inicio, donde el conteo físico capturado por el asistente o manager manda al 100%).
 */

export type InventoryAutomationMode = 'off' | 'shadow_blind' | 'assisted_2tier' | 'auto_order_visible'

export const AUTO_CYCLE_COUNT_MARKER = 'AUTO_CYCLE_V2'

export const EXTERNAL_TRACK_ONLY_DESSERT_IDS = new Set<string>([
  'f8f776c5-3b8c-453e-8161-b49840823933', // Flan
  '8ba55664-5ca9-4886-8ac8-acf1fd070713', // Cheesecake
])

/**
 * 17 SKU Críticos Diarios (Tier 2 — Auditoría Física Rápida de ~2.5 min cada noche):
 * - 8 Carnes (alto costo / merma de cocción y porcionado)
 * - 5 Bebidas estacionales de autoservicio (alta sensibilidad climática)
 * - 2 Insumos cocinados a granel de cocina (Arroz, Frijol Molido)
 * - 2 Postres de proveedor externo en rastreo (Flan, Cheesecake)
 */
export const CRITICAL_DAILY_PHYSICAL_SKU_IDS = new Set<string>([
  // 8 Carnes (UUIDs activos en store_order_template de las 15 sucursales)
  'fab9d589-8ae8-4381-87da-85f836068996', // Carne Asada
  'ad7e3703-2701-4a05-aa97-77866c8c717e', // Pastor
  '511e341b-ca42-44ed-89df-a4a84b51a619', // Cabeza
  '0fb87578-1185-41a9-a318-97428db20a5d', // Lengua
  'baac1d41-3b80-4f80-acfc-7a19f46e03c2', // Buche 6 oz
  '14990e85-0d90-467c-ad9d-362e6ed4f1cd', // Carnitas 6 oz
  '4ea7ef9c-986e-4fc1-a363-7200ca558aab', // Pollo
  '1e4c43b6-4e1b-4e51-8617-e127b89467f1', // Chorizo 8 oz
  // 8 Carnes (UUIDs alternos / legado por compatibilidad histórica)
  'f908b904-b0c5-4f8c-a92f-a2b0ad3ff301', // Carne Asada (alt)
  'cfb108ad-06fa-432b-821f-d03fd03bf28a', // Pastor (alt)
  '3adcdde2-fa65-43ba-a25b-9c820faef678', // Cabeza (alt)
  '0bc6d1f1-2c18-4d6f-9464-57ad3f3eb4c4', // Lengua (alt)
  '70ba3c5d-c544-4d0e-942c-601eaeb00349', // Buche 6 oz (alt)
  'a4f96537-5016-4bd0-9dc5-04ca64a2fe4c', // Carnitas 6 oz (alt)
  'f910687d-7d1c-43d3-8d95-4df0d4ebec47', // Pollo (alt)
  'db1cc691-fc16-4f25-8353-c526ed4bd25a', // Chorizo 8 oz (alt)
  // 5 Bebidas Estacionales
  '085ecb0d-c711-4134-ae1a-f7630a22759c', // Horchata
  'b6f3f5de-c554-4650-b0df-09dd5d3ca053', // Tamarindo Concentrate
  '6051e960-7564-41f6-9a52-ff79ed7c6353', // Jamaica Concentrate
  '9851a32c-dc35-4653-a1e4-b2cf7bac9009', // Piña Concentrate
  '808c43e2-df89-4b6d-bef3-2f5c7310914c', // Champurrado Mix
  // 2 Graneles Cocinados de Cocina (UUIDs activos + legado)
  'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562', // Arroz
  '557d9414-c769-4399-a6cc-15bb81cba85f', // Frijol Molido
  '7fa8840d-f231-4169-9f97-94985200bc0e', // Arroz (alt)
  'f5e898e7-22a0-4306-b62d-84a021ff7b03', // Frijol Molido (alt)
  // 2 Postres Externos (TRACK_ONLY)
  'f8f776c5-3b8c-453e-8161-b49840823933', // Flan
  '8ba55664-5ca9-4886-8ac8-acf1fd070713', // Cheesecake
])

const CRITICAL_DAILY_NAME_PATTERNS: RegExp[] = [
  /\b(carne\s+asada|asada|pastor|cabeza|lengua|buche|carnitas|pollo|chorizo)\b/i,
  /^(horchata|tamarindo(?:\s+concentrate)?|jamaica(?:\s+concentrate)?|pina(?:\s+concentrate)?|champurrado(?:\s+mix)?)$/i,
  /^(arroz|frijol\s+molido|flan|whole\s+flan|cheesecake)$/i,
]

function normalizeSkuLabel(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function isExternalTrackOnlyDessert(item: {
  id?: string | null
  inventory_item_id?: string | null
  name?: string | null
  item_name?: string | null
  qb_item_id?: string | null
}): boolean {
  if (item.qb_item_id === 'TRACK_ONLY') return true
  const id = String(item.inventory_item_id || item.id || '').trim()
  if (id && EXTERNAL_TRACK_ONLY_DESSERT_IDS.has(id)) return true
  const norm = normalizeSkuLabel(item.item_name || item.name)
  return /^(flan|whole\s+flan|cheesecake)$/.test(norm)
}

export function isCriticalDailyPhysicalSku(item: {
  id?: string | null
  inventory_item_id?: string | null
  name?: string | null
  item_name?: string | null
  qb_item_id?: string | null
}): boolean {
  if (isExternalTrackOnlyDessert(item)) return true
  const id = String(item.inventory_item_id || item.id || '').trim()
  if (id && CRITICAL_DAILY_PHYSICAL_SKU_IDS.has(id)) return true
  const norm = normalizeSkuLabel(item.item_name || item.name)
  return CRITICAL_DAILY_NAME_PATTERNS.some(pattern => pattern.test(norm))
}

/** En cierres dominicales (`dayOfWeek === 0`), los 51 SKU exigen conteo físico completo (Ancla Dominical). */
export function isFullPhysicalAnchorDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const d = new Date(`${dateStr}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0
}

export function canManageInventoryAutomationMode(input: {
  userName?: string | null
  userEmail?: string | null
  userRole?: string | null
}): boolean {
  const normalizedName = normalizeSkuLabel(input.userName)
  const normalizedEmail = String(input.userEmail || '').trim().toLowerCase()
  const normalizedRole = normalizeSkuLabel(input.userRole)
  if (['admin', 'administrador'].includes(normalizedRole)) return true
  if (normalizedName === 'roque' || normalizedEmail.startsWith('roque@')) return true
  if (normalizedName === 'carlos velazquez' || normalizedEmail.startsWith('carlos@')) return true
  return false
}

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

  // 3. Cualquier manager/gerente/asistente asignado a su propia sucursal puede guardar/ver el comparativo
  const matchesAssignedStore = assignedStoreIds.has(String(input.targetStoreId))
    || Array.from(assignedStoreIds).some(s => {
      const sNorm = s.trim().toLowerCase()
      const targetNameNorm = input.storeName.trim().toLowerCase()
      return sNorm === targetNameNorm || targetNameNorm.includes(sNorm) || sNorm.includes(targetNameNorm)
    })

  return ['manager', 'gerente', 'asistente', 'assistant'].includes(normalizedRole) && matchesAssignedStore
}

const ONE_UNIT_PATTERNS = [
  /carne/i, /asada/i, /pastor/i, /pollo/i, /cabeza/i, /lengua/i,
  /chorizo/i, /carnitas/i, /buche/i, /salsa/i, /mixta/i, /lima/i,
  /rajas/i, /queso/i, /aguacate/i, /tortilla/i, /quesadilla/i,
]

export function applyPilotRounding(value: number, rule?: string | null): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (rule === 'ceiling_60') return Math.ceil(value / 60) * 60
  if (rule === 'ceiling_30') return Math.ceil(value / 30) * 30
  if (rule === 'ceiling_4') return Math.ceil(value / 4) * 4
  return Math.round(value)
}

export function getPilotTolerance(itemName: string, physicalLeftover: number): number {
  if (/papelito/i.test(itemName)) return 30
  if (ONE_UNIT_PATTERNS.some(pattern => pattern.test(itemName))) return 1
  return Math.max(1, Number((Math.abs(physicalLeftover) * 0.15).toFixed(2)))
}

export function buildPilotComparisonLine(input: PilotComparisonInput): PilotComparisonLine {
  const isTrackOnly = isExternalTrackOnlyDessert({
    inventory_item_id: input.inventory_item_id,
    item_name: input.item_name,
  })
  const officialOrderQty = isTrackOnly
    ? 0
    : applyPilotRounding(
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
    automatic_order_qty: isTrackOnly ? 0 : applyPilotRounding(baseAuto, input.rounding_rule),
    official_order_qty: officialOrderQty,
  }
}
