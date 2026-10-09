/**
 * @module lib/toast/menus-v3-contract
 * @description Contrato TypeScript autoritativo para Toast Menus V3 API y Orders /prices API.
 * Diseñado conforme a los estándares oficiales de Toast Partner Connect (Tacos Gavilan).
 * 
 * @businessRules
 * - Prohibición de GUIDs ficticios (e.g. 'group-*', 'mod-cebolla', 'sin-*'). Todos los identificadores deben ser GUIDs reales de Toast.
 * - Validación estricta de modificadores: cada opción debe pertenecer al grupo y producto correspondiente.
 * - Cero descarte silencioso: cualquier modificador desconocido o fuera de rango min/max produce un error explícito.
 * - Separación de identidad: cartLineId local es independiente del Toast item GUID.
 * - Autoridad financiera: los precios vinculantes para el checkout provienen exclusivamente de Toast /prices.
 * 
 * @dataFlow
 * - Menus V3 (Toast) -> Normalización en Backend -> Catálogo y Personalizador Móvil -> Validación -> Orders /prices.
 * 
 * @notes
 * - Cuando Toast responde HTTP 403 / code 10010, el sistema categoriza el estado como BLOCKED_EXTERNALLY.
 */

// ─────────────────────────────────────────────────────────────
// 1. Interfaces de Toast Menus V3
// ─────────────────────────────────────────────────────────────

export interface ToastMenuV3Option {
  guid: string
  name: string
  price: number
  isDefault?: boolean
  calories?: number | null
}

export interface ToastMenuV3ModifierGroup {
  guid: string
  name: string
  required: boolean
  minSelections: number
  maxSelections: number
  isMultiSelect: boolean
  options: ToastMenuV3Option[]
}

export interface ToastMenuV3Item {
  guid: string
  name: string
  description?: string
  price: number
  calories?: number | null
  imageUrl?: string
  visibility: 'ALL' | 'ONLINE_ONLY' | 'POS_ONLY'
  isAvailable: boolean
  modifierGroups: ToastMenuV3ModifierGroup[]
}

export interface ToastMenuV3Subgroup {
  guid: string
  name: string
  items: ToastMenuV3Item[]
}

export interface ToastMenuV3Group {
  guid: string
  name: string
  subgroups: ToastMenuV3Subgroup[]
}

export interface ToastMenusV3Catalog {
  restaurantGuid: string
  menuVersion: string
  diningOption: 'TAKE_OUT' | 'DINE_IN' | 'DELIVERY' | 'CURBSIDE'
  lastUpdated: string
  groups: ToastMenuV3Group[]
}

// ─────────────────────────────────────────────────────────────
// 2. Interfaces de Toast Orders /prices API (Cálculo Financiero)
// ─────────────────────────────────────────────────────────────

export interface ToastPricesSelectionModifier {
  guid: string
  optionGroupGuid: string
}

export interface ToastPricesSelectionItem {
  itemGuid: string
  quantity: number
  modifiers?: ToastPricesSelectionModifier[]
}

export interface ToastPricesRequest {
  restaurantGuid: string
  diningOptionGuid: string
  items: ToastPricesSelectionItem[]
  deliveryAddress?: {
    streetAddress1: string
    streetAddress2?: string
    city: string
    state: string
    zipCode: string
    latitude?: number
    longitude?: number
  }
}

export interface ToastPricesBreakdownItem {
  itemGuid: string
  name: string
  quantity: number
  basePrice: number
  modifierPriceTotal: number
  totalPrice: number
}

export interface ToastPricesResponse {
  subtotal: number
  taxTotal: number
  serviceChargeTotal: number
  deliveryFee: number
  discountTotal: number
  tipTotal: number
  total: number
  currency: string
  breakdown: ToastPricesBreakdownItem[]
  toastCalculatedAt: string
}

// ─────────────────────────────────────────────────────────────
// 3. Resultado de Error de Bloqueo Externo (HTTP 403 / 10010)
// ─────────────────────────────────────────────────────────────

export interface ToastExternalBlockedResult {
  ok: false
  code: 'BLOCKED_EXTERNALLY'
  httpStatus: 403
  toastCode: 10010
  message: string
  requiredScopes: string[]
  partnerActionRequired: string
}

export const TOAST_WRITE_BLOCKED_DESCRIPTOR: ToastExternalBlockedResult = {
  ok: false,
  code: 'BLOCKED_EXTERNALLY',
  httpStatus: 403,
  toastCode: 10010,
  message: "Acceso denegado: El cliente de Toast Partner Connect para Tacos Gavilan aún no cuenta con el scope 'orders.orders:write' o '/prices' habilitado por Toast.",
  requiredScopes: ['orders.orders:write', 'orders.prices:read', 'menus.menu:read'],
  partnerActionRequired: 'Toast Partner Management debe aprobar y asignar los scopes de escritura a las credenciales de producción de Tacos Gavilan.'
}

// ─────────────────────────────────────────────────────────────
// 4. Validador de Carrito contra Catálogo Menus V3
// ─────────────────────────────────────────────────────────────

export interface CartLineValidationInput {
  cartLineId: string
  itemGuid: string
  quantity: number
  modifiers?: Array<{
    optionGuid: string
    groupGuid: string
  }>
}

export interface ValidationSuccessResult {
  valid: true
  cartLineId: string
  item: ToastMenuV3Item
  validatedModifiers: ToastMenuV3Option[]
  estimatedSubtotal: number
}

export interface ValidationErrorResult {
  valid: false
  cartLineId: string
  error: string
  field?: string
}

export type CartItemValidationResult = ValidationSuccessResult | ValidationErrorResult

/**
 * Valida rigurosamente una línea del carrito contra la definición auténtica de Menus V3.
 * Regla: No admite modificadores desconocidos, respeta min/max y evita duplicaciones no permitidas.
 */
export function validateCartLineAgainstMenuV3(
  input: CartLineValidationInput,
  catalogItemsMap: Map<string, ToastMenuV3Item>
): CartItemValidationResult {
  if (!input.quantity || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    return {
      valid: false,
      cartLineId: input.cartLineId,
      error: `Cantidad inválida (${input.quantity}). Debe ser un entero positivo mayor a cero.`,
      field: 'quantity'
    }
  }

  const menuItem = catalogItemsMap.get(input.itemGuid)
  if (!menuItem) {
    return {
      valid: false,
      cartLineId: input.cartLineId,
      error: `El platillo con GUID ${input.itemGuid} no existe en el catálogo oficial de esta sucursal.`,
      field: 'itemGuid'
    }
  }

  if (!menuItem.isAvailable) {
    return {
      valid: false,
      cartLineId: input.cartLineId,
      error: `El platillo '${menuItem.name}' no está disponible actualmente en esta sucursal.`,
      field: 'isAvailable'
    }
  }

  const requestedMods = input.modifiers || []
  const validatedOptions: ToastMenuV3Option[] = []
  let modifiersPriceSum = 0

  // Validar cada grupo de modificadores del producto
  for (const group of menuItem.modifierGroups) {
    const selectedInThisGroup = requestedMods.filter(m => m.groupGuid === group.guid)

    // Validar mínimo requerido
    if (group.required && selectedInThisGroup.length < group.minSelections) {
      return {
        valid: false,
        cartLineId: input.cartLineId,
        error: `El grupo '${group.name}' requiere al menos ${group.minSelections} selección(es) (recibidas: ${selectedInThisGroup.length}).`,
        field: group.guid
      }
    }

    // Validar máximo permitido
    if (group.maxSelections > 0 && selectedInThisGroup.length > group.maxSelections) {
      return {
        valid: false,
        cartLineId: input.cartLineId,
        error: `El grupo '${group.name}' permite máximo ${group.maxSelections} selección(es) (recibidas: ${selectedInThisGroup.length}).`,
        field: group.guid
      }
    }

    // Validar existencia de cada opción dentro del grupo oficial
    for (const sel of selectedInThisGroup) {
      const optionDef = group.options.find(opt => opt.guid === sel.optionGuid)
      if (!optionDef) {
        return {
          valid: false,
          cartLineId: input.cartLineId,
          error: `El modificador ${sel.optionGuid} no pertenece al grupo '${group.name}' de '${menuItem.name}'.`,
          field: 'optionGuid'
        }
      }
      validatedOptions.push(optionDef)
      modifiersPriceSum += Number(optionDef.price) || 0
    }
  }

  // Verificar si hay modificadores huérfanos que no pertenecen a ningún grupo del producto
  const itemGroupGuids = new Set(menuItem.modifierGroups.map(g => g.guid))
  for (const sel of requestedMods) {
    if (!itemGroupGuids.has(sel.groupGuid)) {
      return {
        valid: false,
        cartLineId: input.cartLineId,
        error: `El grupo de modificadores ${sel.groupGuid} no pertenece a '${menuItem.name}'. Prohibido descarte silencioso.`,
        field: 'groupGuid'
      }
    }
  }

  const unitBasePrice = Number(menuItem.price) || 0
  const estimatedSubtotal = Math.round((unitBasePrice + modifiersPriceSum) * input.quantity * 100) / 100

  return {
    valid: true,
    cartLineId: input.cartLineId,
    item: menuItem,
    validatedModifiers: validatedOptions,
    estimatedSubtotal
  }
}
