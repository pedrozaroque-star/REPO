/**
 * @module lib/toast/menus-v3-contract
 * @description Contratos estrictos TypeScript y validador unificado para Toast Menus V3 API,
 * grupos de modificadores, disponibilidad por canal (PICKUP / DELIVERY) y clasificación de bloqueos externos.
 *
 * @businessRules
 * - Todo artículo y modificador DEBE tener un `guid` real de Toast POS en formato UUID estándar;
 *   prohibido usar IDs sintéticos (`mod-cebolla`, `mod-salsa-roja`, `sin-*`, `ext_*`, `tort_*`).
 * - Valida `minSelections` (grupos obligatorios), `maxSelections`, exclusividad (`!isMultiSelect`),
 *   prevención de duplicados por grupo y modificadores anidados (`nestedModifiers`).
 * - No inventa el scope `orders.prices:read`; lista únicamente scopes documentados oficialmente por Toast
 *   (`orders:write`, `menus.channel:read`, `menus:read`) e indica que el scope exacto para `/orders/v2/prices`
 *   está sujeto a confirmación del representante de Toast.
 *
 * @dataFlow
 * - Toast Menus V3 / `app_menu_cache` -> `validateCartLineAgainstMenuV3` -> `/api/mobile/order/quote` & `/api/mobile/order/create`.
 *
 * @notes
 * - Validador unificado utilizado en producción por `/api/mobile/order/quote` y en la suite de pruebas automatizadas.
 * - Valida cantidad de modificadores (`1..25`), multiplica `price * modQty` y reinicia `scopeByGroup` recursivamente por nivel para `nestedModifiers`.
 */

export type FulfillmentChannel = 'PICKUP' | 'DELIVERY'

export type PickupSubType = 'IN_STORE' | 'CURBSIDE'

export type NativeIntegrationStatus =
  | 'READY'
  | 'BLOCKED_EXTERNALLY'
  | 'DISABLED_BY_FLAG'

export type MobileApiErrorCode =
  | 'TOAST_SCOPE_BLOCKED'
  | 'NETWORK_UNAVAILABLE'
  | 'BACKEND_UNAVAILABLE'
  | 'TOAST_TIMEOUT'
  | 'TOAST_API_ERROR'
  | 'MENU_DATA_INCOMPLETE'
  | 'VALIDATION_ERROR'
  | 'DELIVERY_DISABLED'

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ToastMenuOptionV3 {
  guid: string
  name: string
  price: number
  isAvailable: boolean
  isDefault: boolean
  nestedModifierGroupGuids?: string[]
}

export interface ToastModifierGroupV3 {
  guid: string
  name: string
  minSelections: number
  maxSelections: number
  required: boolean
  isMultiSelect: boolean
  allowDuplicates?: boolean
  options: ToastMenuOptionV3[]
}

export interface ToastMenuItemV3 {
  guid: string
  name: string
  description: string | null
  basePrice: number
  imageUrl: string | null
  isAvailable: boolean
  visibility: FulfillmentChannel[]
  modifierGroupGuids: string[]
}

export interface ToastMenuCategoryV3 {
  guid: string
  name: string
  sortOrder: number
  items: ToastMenuItemV3[]
}

export interface ToastStoreMenuSnapshotV3 {
  storeId: number
  restaurantExternalId: string
  versionHash: string
  syncedAt: string
  channelsSupported: FulfillmentChannel[]
  diningOptions: {
    pickupGuid: string | null
    curbsideGuid: string | null
    deliveryGuid: string | null
  }
  categories: ToastMenuCategoryV3[]
  modifierGroups: Record<string, ToastModifierGroupV3>
}

export interface ToastWriteBlockedDescriptor {
  status: 'BLOCKED_EXTERNALLY'
  code: 'TOAST_SCOPE_BLOCKED'
  toastCode: 10010 | number
  httpStatus: number
  requestId: string | null
  retryable: false
  requiredScopes: string[]
  title: string
  userMessage: string
  technicalDetail: string
}

export const TOAST_WRITE_BLOCKED_DESCRIPTOR: ToastWriteBlockedDescriptor = {
  status: 'BLOCKED_EXTERNALLY',
  code: 'TOAST_SCOPE_BLOCKED',
  toastCode: 10010,
  httpStatus: 403,
  requestId: null,
  retryable: false,
  requiredScopes: ['orders:write', 'menus.channel:read', 'menus:read'],
  title: 'Integración Nativa en Espera de Permisos Toast POS',
  userMessage:
    'Tu selección en la bolsa fue validada localmente, pero el cálculo autoritativo de precios (/orders/v2/prices) y el envío directo a cocina en Toast POS requieren la habilitación oficial de permisos de escritura por parte de Toast. Tu bolsa permanece guardada.',
  technicalDetail:
    'Toast API responded HTTP 403 (code 10010: Access Denied). Documented scopes required: orders:write and menus.channel:read / menus:read (exact scope enabling /orders/v2/prices pending Toast representative confirmation).',
}

export interface CartModifierSelectionInput {
  optionGuid: string
  groupGuid?: string
  qty?: number
  nestedModifiers?: CartModifierSelectionInput[]
}

export interface ResolvedValidatedModifier {
  guid: string
  optionGroupGuid: string
  name: string
  price: number
  qty?: number
}

export interface CartLineValidationResult {
  valid: boolean
  code?: 'VALIDATION_ERROR' | 'MENU_DATA_INCOMPLETE'
  errors: string[]
  resolvedItem?: {
    guid: string
    name: string
    basePrice: number
    unitPrice: number
    lineTotal: number
    modifiers: ResolvedValidatedModifier[]
  }
}

/**
 * Valida una línea del carrito contra el contrato de menú y modificadores de Toast POS.
 */
export function validateCartLineAgainstMenuV3(
  menuItem: ToastMenuItemV3,
  modifierGroupsMap: Record<string, ToastModifierGroupV3>,
  selectedModifiers: CartModifierSelectionInput[],
  channel: FulfillmentChannel,
  qty: number = 1
): CartLineValidationResult {
  const errors: string[] = []

  if (!menuItem.guid || !UUID_REGEX.test(menuItem.guid)) {
    errors.push(`El GUID del artículo "${menuItem.name || menuItem.guid}" no es un UUID válido de Toast POS.`)
    return { valid: false, code: 'VALIDATION_ERROR', errors }
  }

  if (!Number.isInteger(qty) || qty <= 0 || qty > 99) {
    errors.push(`Cantidad inválida (${qty}) para "${menuItem.name}". Debe ser un entero entre 1 y 99.`)
    return { valid: false, code: 'VALIDATION_ERROR', errors }
  }

  if (!menuItem.isAvailable) {
    errors.push(`El artículo "${menuItem.name}" se encuentra agotado temporalmente (86'd).`)
  }

  if (Array.isArray(menuItem.visibility) && !menuItem.visibility.includes(channel)) {
    errors.push(`El artículo "${menuItem.name}" no está disponible para el canal ${channel}.`)
  }

  const itemGroups: ToastModifierGroupV3[] = []
  for (const grpGuid of menuItem.modifierGroupGuids || []) {
    const grp = modifierGroupsMap[grpGuid]
    if (!grp) {
      errors.push(`Datos de menú incompletos: grupo de modificadores "${grpGuid}" no encontrado para "${menuItem.name}".`)
      return { valid: false, code: 'MENU_DATA_INCOMPLETE', errors }
    }
    itemGroups.push(grp)
  }

  if (itemGroups.length === 0 && selectedModifiers.length > 0) {
    errors.push(`El artículo "${menuItem.name}" no admite modificadores.`)
    return { valid: false, code: 'VALIDATION_ERROR', errors }
  }

  const resolvedModifiers: ResolvedValidatedModifier[] = []
  let modsPriceSum = 0

  const validateGroupCardinalities = (
    groupsToCheck: ToastModifierGroupV3[],
    byGroup: Map<string, Array<{ sel: CartModifierSelectionInput; qty: number }>>,
    scopeLabel: string
  ) => {
    for (const group of groupsToCheck) {
      const selectedInThisGroup = byGroup.get(group.guid) || []
      const count = selectedInThisGroup.reduce((acc, entry) => acc + entry.qty, 0)
      const effectiveMin = Math.max(group.minSelections || 0, group.required ? 1 : 0)
      const effectiveMax = group.maxSelections ?? 10

      if (effectiveMin > 0 && count < effectiveMin) {
        errors.push(
          `El grupo "${group.name}" en ${scopeLabel} requiere al menos ${effectiveMin} selección(es).`
        )
      }

      if (effectiveMax > 0 && count > effectiveMax) {
        errors.push(
          `El grupo "${group.name}" en ${scopeLabel} permite máximo ${effectiveMax} selección(es).`
        )
      }

      if (!group.isMultiSelect && effectiveMax === 1 && count > 1) {
        errors.push(
          `El grupo "${group.name}" en ${scopeLabel} es de selección única (exclusivo).`
        )
      }

      if (!group.allowDuplicates && count > 1) {
        const seenOptionGuids = new Set<string>()
        for (const entry of selectedInThisGroup) {
          if (entry.qty > 1 || seenOptionGuids.has(entry.sel.optionGuid)) {
            errors.push(
              `No se permiten opciones duplicadas ("${entry.sel.optionGuid}") dentro del grupo "${group.name}" en ${scopeLabel}.`
            )
            break
          }
          seenOptionGuids.add(entry.sel.optionGuid)
        }
      }
    }
  }

  const validateModifierList = (
    modsToValidate: CartModifierSelectionInput[],
    allowedGroups: ToastModifierGroupV3[],
    contextLabel: string
  ) => {
    const scopeByGroup = new Map<string, Array<{ sel: CartModifierSelectionInput; qty: number }>>()

    for (const sel of modsToValidate) {
      const optGuid = String(sel.optionGuid || '').trim()
      if (!optGuid || !UUID_REGEX.test(optGuid)) {
        errors.push(
          `El modificador "${optGuid}" en ${contextLabel} no tiene un UUID válido de Toast POS (prohibidos IDs sintéticos).`
        )
        continue
      }

      const modQty = sel.qty === undefined ? 1 : sel.qty
      if (!Number.isInteger(modQty) || modQty <= 0 || modQty > 25) {
        errors.push(
          `Cantidad inválida (${String(sel.qty)}) para el modificador "${optGuid}" en ${contextLabel}. Debe ser un entero entre 1 y 25.`
        )
        continue
      }

      let targetGroup: ToastModifierGroupV3 | undefined
      if (sel.groupGuid) {
        targetGroup = allowedGroups.find((g) => g.guid === sel.groupGuid)
        if (!targetGroup) {
          errors.push(
            `El grupo de modificadores "${sel.groupGuid}" no pertenece a ${contextLabel}.`
          )
          continue
        }
      } else {
        const matchingGroups = allowedGroups.filter((g) =>
          g.options.some((o) => o.guid === optGuid)
        )
        if (matchingGroups.length === 0) {
          errors.push(
            `El modificador "${optGuid}" no pertenece a ningún grupo permitido de ${contextLabel}.`
          )
          continue
        }
        if (matchingGroups.length > 1) {
          errors.push(
            `El modificador "${optGuid}" aparece en múltiples grupos de ${contextLabel}; debe especificarse optionGroupGuid.`
          )
          continue
        }
        targetGroup = matchingGroups[0]
      }

      const matchedOpt = targetGroup.options.find((o) => o.guid === optGuid)
      if (!matchedOpt) {
        errors.push(
          `La opción "${optGuid}" no existe dentro del grupo "${targetGroup.name}" en ${contextLabel}.`
        )
        continue
      }

      if (!matchedOpt.isAvailable) {
        errors.push(
          `La opción "${matchedOpt.name}" en "${targetGroup.name}" no está disponible actualmente.`
        )
        continue
      }

      const currentInGroup = scopeByGroup.get(targetGroup.guid) || []
      currentInGroup.push({ sel, qty: modQty })
      scopeByGroup.set(targetGroup.guid, currentInGroup)

      const unitModPrice = Number(matchedOpt.price || 0)
      modsPriceSum += unitModPrice * modQty
      resolvedModifiers.push({
        guid: matchedOpt.guid,
        optionGroupGuid: targetGroup.guid,
        name: matchedOpt.name,
        price: unitModPrice,
        ...(modQty > 1 ? { qty: modQty } : {}),
      })

      const nestedGroupGuids = matchedOpt.nestedModifierGroupGuids || []
      const hasNestedInput = Array.isArray(sel.nestedModifiers) && sel.nestedModifiers.length > 0

      if (hasNestedInput && nestedGroupGuids.length === 0) {
        errors.push(
          `La opción "${matchedOpt.name}" no admite modificadores anidados.`
        )
      } else if (nestedGroupGuids.length > 0) {
        const nestedAllowedGroups = nestedGroupGuids
          .map((id) => modifierGroupsMap[id])
          .filter(Boolean)
        validateModifierList(
          sel.nestedModifiers || [],
          nestedAllowedGroups,
          `"${matchedOpt.name}"`
        )
      }
    }

    validateGroupCardinalities(allowedGroups, scopeByGroup, contextLabel)
  }

  validateModifierList(selectedModifiers, itemGroups, `"${menuItem.name}"`)

  if (errors.length > 0) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      errors,
    }
  }

  const unitPrice = Math.round((Number(menuItem.basePrice) + modsPriceSum) * 100) / 100
  const lineTotal = Math.round(unitPrice * qty * 100) / 100

  return {
    valid: true,
    errors: [],
    resolvedItem: {
      guid: menuItem.guid,
      name: menuItem.name,
      basePrice: Number(menuItem.basePrice),
      unitPrice,
      lineTotal,
      modifiers: resolvedModifiers,
    },
  }
}
