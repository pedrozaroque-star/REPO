/**
 * @module lib/storefront/order-session-contract
 * @description Contrato puro (sin red) para crear una sesión de checkout hospedado de DoorDash Storefront
 * (`POST /storefront/api/v1/orders/order_session`) a partir del carrito nativo de Menu2.
 * Valida la petición del cliente, valida cada línea contra el menú Storefront autorizado de la sucursal,
 * construye el payload con precios del menú (nunca del cliente) y valida la respuesta del proveedor.
 *
 * @businessRules
 * - Esquema tomado de la especificación oficial vigente (https://developer.doordash.com/en-US/api/storefront/,
 *   "Storefront V1 API Specification 1.0.0", revisada 2026-10-16):
 *   request `{ store_id, menu_id, fulfillment_type: 'delivery'|'pickup', items: ExternalCartItem[],
 *   delivery_details?: { address: { address_id, apartment_number }, delivery_option, delivery_instruction },
 *   scheduled_time? }` → response `{ order_session_id, checkout_url }`.
 * - Los IDs de producto/extra/opción deben ser IDs del menú Storefront (`GET /storefront/api/v1/stores/{id}/menus`).
 *   Un GUID de Toast NO es un ID de Storefront: un carrito cuyo catálogo no proviene de Storefront se rechaza
 *   (`CATALOG_NOT_AUTHORIZED`). Prohibido mapear por coincidencia aproximada de nombres.
 * - El servidor ignora precios/totales enviados por el cliente; usa únicamente `price.value` del menú.
 * - El `checkout_url` solo es aceptable si es HTTPS, pertenece a un host permitido y NO es la página principal
 *   de una tienda (`/store/<slug>`), y si viene acompañado de un `order_session_id` no vacío.
 *
 * @dataFlow
 * - `app/api/mobile/doordash/checkout-session/route.ts` → `parseCheckoutRequest()` →
 *   `lib/doordash-storefront.ts` (red) → `validateCartAgainstStorefrontMenu()` → `buildOrderSessionPayload()` →
 *   DoorDash → `validateOrderSessionResponse()`.
 *
 * @notes
 * - NO CONFIRMADO con DoorDash: la documentación pública muestra `items[].extras[].options: [ { } ]` sin definir
 *   la forma de cada opción. Aquí se envía `extras[] = { id: <extra id>, quantity, price, options: [{ id, quantity,
 *   price, extras? }] }`. Debe confirmarse con storefront-api-support@doordash.com antes de producción.
 * - `num_free_options` no se aplica localmente; el checkout del proveedor es la fuente autoritativa del total.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Menú Storefront (forma oficial de GET /storefront/api/v1/stores/{store_id}/menus)
// ─────────────────────────────────────────────────────────────────────────────

export interface StorefrontPrice {
  value: number
  currency: string
}

export interface StorefrontMenuOption {
  id: string
  name?: string
  price?: StorefrontPrice
  available?: boolean
  extras?: StorefrontMenuExtra[]
  default_on?: boolean
}

export interface StorefrontMenuExtra {
  id: string
  name?: string
  min_num_options?: number
  max_num_options?: number
  num_free_options?: number
  min_option_choice_quantity?: number
  max_option_choice_quantity?: number
  min_aggregate_options_quantity?: number
  max_aggregate_options_quantity?: number
  options?: StorefrontMenuOption[]
}

export interface StorefrontMenuItem {
  id: string
  name?: string
  description?: string
  price?: StorefrontPrice
  available?: boolean
  extras?: StorefrontMenuExtra[]
}

export interface StorefrontMenu {
  id: string
  name?: string
  categories?: Array<{ id?: string; name?: string; items?: StorefrontMenuItem[] }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Petición del cliente (Menu2 → nuestro servidor)
// ─────────────────────────────────────────────────────────────────────────────

export const CHECKOUT_LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxLines: 40,
  maxQuantityPerLine: 25,
  maxExtrasPerLine: 25,
  maxOptionsPerExtra: 30,
  maxNestingDepth: 3,
  maxInstructionsLength: 200,
  maxAddressLength: 200,
  maxApartmentLength: 40,
  maxIdLength: 80,
  maxIdempotencyKeyLength: 80,
} as const

export const STOREFRONT_CATALOG_SOURCE = 'DOORDASH_STOREFRONT' as const

export interface CheckoutOptionSelection {
  optionId: string
  quantity: number
  extras: CheckoutExtraSelection[]
}

export interface CheckoutExtraSelection {
  extraId: string
  options: CheckoutOptionSelection[]
}

export interface CheckoutLine {
  itemId: string
  quantity: number
  specialInstructions: string
  extras: CheckoutExtraSelection[]
}

export interface ParsedCheckoutRequest {
  storeId: number
  fulfillmentType: 'pickup' | 'delivery'
  catalogSource: string
  menuId: string | null
  lines: CheckoutLine[]
  delivery: {
    formattedAddress: string
    apartmentNumber: string
    instructions: string
  } | null
  idempotencyKey: string
}

export type ParseResult =
  | { ok: true; value: ParsedCheckoutRequest }
  | { ok: false; errors: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length > max) return null
  return trimmed
}

function isSafeId(v: string): boolean {
  return v.length > 0 && v.length <= CHECKOUT_LIMITS.maxIdLength && /^[A-Za-z0-9_\-:.]+$/.test(v)
}

function parseQuantity(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return null
  if (v < 1 || v > max) return null
  return v
}

function parseExtras(raw: unknown, path: string, depth: number, errors: string[]): CheckoutExtraSelection[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push(`${path}: extras debe ser un arreglo`)
    return []
  }
  if (depth > CHECKOUT_LIMITS.maxNestingDepth) {
    errors.push(`${path}: anidación de extras excede ${CHECKOUT_LIMITS.maxNestingDepth}`)
    return []
  }
  if (raw.length > CHECKOUT_LIMITS.maxExtrasPerLine) {
    errors.push(`${path}: demasiados extras (${raw.length})`)
    return []
  }
  const out: CheckoutExtraSelection[] = []
  raw.forEach((ex, i) => {
    const p = `${path}.extras[${i}]`
    if (!isPlainObject(ex)) {
      errors.push(`${p}: formato inválido`)
      return
    }
    const extraId = cleanString(ex.extraId, CHECKOUT_LIMITS.maxIdLength)
    if (!extraId || !isSafeId(extraId)) {
      errors.push(`${p}: extraId inválido`)
      return
    }
    const opts = Array.isArray(ex.options) ? ex.options : null
    if (!opts) {
      errors.push(`${p}: options debe ser un arreglo`)
      return
    }
    if (opts.length > CHECKOUT_LIMITS.maxOptionsPerExtra) {
      errors.push(`${p}: demasiadas opciones (${opts.length})`)
      return
    }
    const options: CheckoutOptionSelection[] = []
    opts.forEach((op, j) => {
      const q = `${p}.options[${j}]`
      if (!isPlainObject(op)) {
        errors.push(`${q}: formato inválido`)
        return
      }
      const optionId = cleanString(op.optionId, CHECKOUT_LIMITS.maxIdLength)
      if (!optionId || !isSafeId(optionId)) {
        errors.push(`${q}: optionId inválido`)
        return
      }
      const quantity = parseQuantity(op.quantity ?? 1, CHECKOUT_LIMITS.maxQuantityPerLine)
      if (quantity === null) {
        errors.push(`${q}: cantidad inválida`)
        return
      }
      options.push({ optionId, quantity, extras: parseExtras(op.extras, q, depth + 1, errors) })
    })
    out.push({ extraId, options })
  })
  return out
}

/**
 * Valida estrictamente el cuerpo enviado por la app. Nunca acepta precios ni totales del cliente
 * (si vienen, se ignoran). Devuelve errores legibles sin datos personales.
 */
export function parseCheckoutRequest(raw: unknown): ParseResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) return { ok: false, errors: ['El cuerpo debe ser un objeto JSON'] }

  const storeId = raw.storeId
  if (typeof storeId !== 'number' || !Number.isInteger(storeId) || storeId < 1 || storeId > 999) {
    errors.push('storeId inválido')
  }

  const ft = typeof raw.fulfillmentType === 'string' ? raw.fulfillmentType.toLowerCase() : ''
  const fulfillmentType: 'pickup' | 'delivery' | null =
    ft === 'delivery' ? 'delivery' : ft === 'pickup' || ft === 'in_store' ? 'pickup' : null
  if (!fulfillmentType) errors.push('fulfillmentType debe ser pickup o delivery')

  const catalog = isPlainObject(raw.catalog) ? raw.catalog : null
  const catalogSource = catalog ? cleanString(catalog.source, 60) : null
  if (!catalogSource) errors.push('catalog.source requerido')
  const menuIdRaw = catalog ? catalog.menuId : undefined
  let menuId: string | null = null
  if (menuIdRaw !== undefined && menuIdRaw !== null) {
    const m = cleanString(menuIdRaw, CHECKOUT_LIMITS.maxIdLength)
    if (!m || !isSafeId(m)) errors.push('catalog.menuId inválido')
    else menuId = m
  }

  const idempotencyKey = cleanString(raw.idempotencyKey, CHECKOUT_LIMITS.maxIdempotencyKeyLength)
  if (!idempotencyKey || !/^[A-Za-z0-9_\-]{8,}$/.test(idempotencyKey)) {
    errors.push('idempotencyKey inválido')
  }

  const linesRaw = raw.lines
  const lines: CheckoutLine[] = []
  if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
    errors.push('lines debe contener al menos un producto')
  } else if (linesRaw.length > CHECKOUT_LIMITS.maxLines) {
    errors.push(`Demasiadas líneas (${linesRaw.length} > ${CHECKOUT_LIMITS.maxLines})`)
  } else {
    linesRaw.forEach((ln, i) => {
      const p = `lines[${i}]`
      if (!isPlainObject(ln)) {
        errors.push(`${p}: formato inválido`)
        return
      }
      const itemId = cleanString(ln.itemId ?? ln.guid, CHECKOUT_LIMITS.maxIdLength)
      if (!itemId || !isSafeId(itemId)) {
        errors.push(`${p}: itemId inválido`)
        return
      }
      const quantity = parseQuantity(ln.quantity ?? ln.qty, CHECKOUT_LIMITS.maxQuantityPerLine)
      if (quantity === null) {
        errors.push(`${p}: cantidad inválida (entero 1..${CHECKOUT_LIMITS.maxQuantityPerLine})`)
        return
      }
      const si =
        ln.specialInstructions === undefined
          ? ''
          : cleanString(ln.specialInstructions, CHECKOUT_LIMITS.maxInstructionsLength)
      if (si === null) {
        errors.push(`${p}: instrucciones demasiado largas`)
        return
      }

      let extras: CheckoutExtraSelection[] = []
      if (ln.extras !== undefined && ln.extras !== null) {
        extras = parseExtras(ln.extras, p, 1, errors)
      } else if (Array.isArray(ln.modifiers)) {
        if (ln.modifiers.length > CHECKOUT_LIMITS.maxExtrasPerLine * 2) {
          errors.push(`${p}: demasiados modificadores`)
        } else {
          const grouped = new Map<string, CheckoutOptionSelection[]>()
          ln.modifiers.forEach((mod, mIdx) => {
            const mp = `${p}.modifiers[${mIdx}]`
            if (!isPlainObject(mod)) {
              errors.push(`${mp}: formato inválido`)
              return
            }
            const groupId = cleanString(mod.groupId ?? mod.optionGroupGuid, CHECKOUT_LIMITS.maxIdLength)
            const optionId = cleanString(mod.optionId ?? mod.guid, CHECKOUT_LIMITS.maxIdLength)
            if (!groupId || !isSafeId(groupId)) {
              errors.push(`${mp}: groupId inválido`)
              return
            }
            if (!optionId || !isSafeId(optionId)) {
              errors.push(`${mp}: optionId inválido`)
              return
            }
            const optQty = parseQuantity(mod.qty ?? mod.quantity ?? 1, CHECKOUT_LIMITS.maxQuantityPerLine)
            if (optQty === null) {
              errors.push(`${mp}: cantidad inválida`)
              return
            }
            const list = grouped.get(groupId) || []
            list.push({ optionId, quantity: optQty, extras: [] })
            grouped.set(groupId, list)
          })
          grouped.forEach((options, extraId) => {
            extras.push({ extraId, options })
          })
        }
      }

      lines.push({ itemId, quantity, specialInstructions: si, extras })
    })
  }

  let delivery: ParsedCheckoutRequest['delivery'] = null
  if (fulfillmentType === 'delivery') {
    const d = isPlainObject(raw.delivery) ? raw.delivery : null
    let formattedAddress = d ? cleanString(d.formattedAddress, CHECKOUT_LIMITS.maxAddressLength) : null
    if (!formattedAddress && d) {
      const street = cleanString(d.street, 120)
      const city = cleanString(d.city, 60)
      const state = cleanString(d.state, 10) || 'CA'
      const zipCode = cleanString(d.zipCode, 10)
      if (street && city && zipCode && /^\d{5}(-\d{4})?$/.test(zipCode)) {
        const composed = `${street}, ${city}, ${state} ${zipCode}`
        if (composed.length <= CHECKOUT_LIMITS.maxAddressLength) {
          formattedAddress = composed
        }
      }
    }
    if (!formattedAddress || formattedAddress.length < 8) {
      errors.push('delivery.formattedAddress requerido para entrega a domicilio')
    } else {
      const rawApt = d ? (d.apartmentNumber ?? d.aptSuite) : undefined
      const apt =
        rawApt !== undefined
          ? cleanString(rawApt, CHECKOUT_LIMITS.maxApartmentLength)
          : ''
      const ins =
        d && d.instructions !== undefined
          ? cleanString(d.instructions, CHECKOUT_LIMITS.maxInstructionsLength)
          : ''
      if (apt === null) errors.push('delivery.apartmentNumber demasiado largo')
      if (ins === null) errors.push('delivery.instructions demasiado largo')
      delivery = { formattedAddress, apartmentNumber: apt || '', instructions: ins || '' }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      storeId: storeId as number,
      fulfillmentType: fulfillmentType as 'pickup' | 'delivery',
      catalogSource: catalogSource as string,
      menuId,
      lines,
      delivery,
      idempotencyKey: idempotencyKey as string,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación del carrito contra el menú Storefront autorizado
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderSessionItemPayload {
  id: string
  quantity: number
  price: StorefrontPrice
  special_instructions?: string
  extras?: OrderSessionExtraPayload[]
}

export interface OrderSessionExtraPayload {
  id: string
  quantity: number
  price: StorefrontPrice
  options: OrderSessionOptionPayload[]
}

export interface OrderSessionOptionPayload {
  id: string
  quantity: number
  price: StorefrontPrice
  extras?: OrderSessionExtraPayload[]
}

export type CartValidationResult =
  | { ok: true; items: OrderSessionItemPayload[] }
  | { ok: false; errors: string[] }

function indexMenuItems(menu: StorefrontMenu): Map<string, StorefrontMenuItem> {
  const map = new Map<string, StorefrontMenuItem>()
  for (const cat of menu.categories || []) {
    for (const item of cat.items || []) {
      if (item && typeof item.id === 'string' && item.id) map.set(item.id, item)
    }
  }
  return map
}

function priceOf(p: StorefrontPrice | undefined): StorefrontPrice | null {
  if (!p || typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0) return null
  return { value: Math.round(p.value), currency: typeof p.currency === 'string' && p.currency ? p.currency : 'USD' }
}

function positive(n: number | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

function validateExtras(
  menuExtras: StorefrontMenuExtra[] | undefined,
  selections: CheckoutExtraSelection[],
  path: string,
  errors: string[]
): OrderSessionExtraPayload[] {
  const byId = new Map<string, StorefrontMenuExtra>()
  for (const ex of menuExtras || []) if (ex && ex.id) byId.set(ex.id, ex)

  const seen = new Set<string>()
  const out: OrderSessionExtraPayload[] = []

  for (const sel of selections) {
    const p = `${path} extra ${sel.extraId}`
    const menuExtra = byId.get(sel.extraId)
    if (!menuExtra) {
      errors.push(`${p}: no pertenece a este producto en el menú de la sucursal`)
      continue
    }
    if (seen.has(sel.extraId)) {
      errors.push(`${p}: grupo repetido`)
      continue
    }
    seen.add(sel.extraId)

    const optById = new Map<string, StorefrontMenuOption>()
    for (const op of menuExtra.options || []) if (op && op.id) optById.set(op.id, op)

    const distinct = new Set<string>()
    let aggregate = 0
    const options: OrderSessionOptionPayload[] = []
    for (const os of sel.options) {
      const menuOpt = optById.get(os.optionId)
      if (!menuOpt) {
        errors.push(`${p}: opción ${os.optionId} no existe en el menú`)
        continue
      }
      if (menuOpt.available === false) {
        errors.push(`${p}: opción ${os.optionId} no está disponible actualmente`)
        continue
      }
      if (distinct.has(os.optionId)) {
        errors.push(`${p}: opción ${os.optionId} repetida`)
        continue
      }
      distinct.add(os.optionId)
      const maxChoice = positive(menuExtra.max_option_choice_quantity)
      const minChoice = positive(menuExtra.min_option_choice_quantity)
      if (maxChoice !== null && os.quantity > maxChoice) errors.push(`${p}: cantidad de ${os.optionId} excede ${maxChoice}`)
      if (minChoice !== null && os.quantity < minChoice) errors.push(`${p}: cantidad de ${os.optionId} menor a ${minChoice}`)
      aggregate += os.quantity
      const optPrice = priceOf(menuOpt.price) || { value: 0, currency: 'USD' }
      const nested = validateExtras(menuOpt.extras, os.extras, `${p} > ${os.optionId}`, errors)
      options.push({
        id: os.optionId,
        quantity: os.quantity,
        price: optPrice,
        ...(nested.length > 0 ? { extras: nested } : {}),
      })
    }

    const minN = positive(menuExtra.min_num_options)
    const maxN = positive(menuExtra.max_num_options)
    if (minN !== null && distinct.size < minN) errors.push(`${p}: requiere al menos ${minN} opción(es)`)
    if (maxN !== null && distinct.size > maxN) errors.push(`${p}: permite máximo ${maxN} opción(es)`)
    const minAgg = positive(menuExtra.min_aggregate_options_quantity)
    const maxAgg = positive(menuExtra.max_aggregate_options_quantity)
    if (minAgg !== null && aggregate < minAgg) errors.push(`${p}: cantidad total menor a ${minAgg}`)
    if (maxAgg !== null && aggregate > maxAgg) errors.push(`${p}: cantidad total excede ${maxAgg}`)

    out.push({ id: sel.extraId, quantity: 1, price: { value: 0, currency: 'USD' }, options })
  }

  // Grupos obligatorios no seleccionados
  for (const ex of menuExtras || []) {
    const minN = positive(ex.min_num_options)
    if (minN !== null && !seen.has(ex.id)) {
      errors.push(`${path}: falta el grupo obligatorio ${ex.name || ex.id}`)
    }
  }
  return out
}

/**
 * Valida cada línea contra el menú Storefront autorizado y construye los `items` del payload usando
 * exclusivamente precios del menú. Cualquier producto/extra/opción ausente, no disponible (`available: false`),
 * grupo obligatorio faltante o mínimo/máximo violado rechaza el carrito completo (no se envía un carrito parcial).
 */
export function validateCartAgainstStorefrontMenu(
  menu: StorefrontMenu,
  lines: CheckoutLine[]
): CartValidationResult {
  const errors: string[] = []
  const index = indexMenuItems(menu)
  if (index.size === 0) return { ok: false, errors: ['El menú de la sucursal no tiene productos'] }

  const items: OrderSessionItemPayload[] = []
  lines.forEach((ln, i) => {
    const path = `Línea ${i + 1}`
    const menuItem = index.get(ln.itemId)
    if (!menuItem) {
      errors.push(`${path}: el producto ${ln.itemId} no existe en el menú actual de la sucursal`)
      return
    }
    if (menuItem.available === false) {
      errors.push(`${path}: el producto ${ln.itemId} no está disponible actualmente`)
      return
    }
    const price = priceOf(menuItem.price)
    if (!price) {
      errors.push(`${path}: el producto ${ln.itemId} no tiene precio válido en el menú`)
      return
    }
    const extras = validateExtras(menuItem.extras, ln.extras, path, errors)
    items.push({
      id: ln.itemId,
      quantity: ln.quantity,
      price,
      ...(ln.specialInstructions ? { special_instructions: ln.specialInstructions } : {}),
      ...(extras.length > 0 ? { extras } : {}),
    })
  })

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, items }
}

export interface OrderSessionPayload {
  store_id: string
  menu_id: string
  fulfillment_type: 'pickup' | 'delivery'
  items: OrderSessionItemPayload[]
  delivery_details?: {
    address: { address_id: string; apartment_number?: string }
    delivery_instruction?: string
  }
}

export function buildOrderSessionPayload(params: {
  storefrontStoreId: string
  menuId: string
  fulfillmentType: 'pickup' | 'delivery'
  items: OrderSessionItemPayload[]
  addressId?: string
  apartmentNumber?: string
  deliveryInstruction?: string
}): OrderSessionPayload {
  const payload: OrderSessionPayload = {
    store_id: params.storefrontStoreId,
    menu_id: params.menuId,
    fulfillment_type: params.fulfillmentType,
    items: params.items,
  }
  if (params.fulfillmentType === 'delivery' && params.addressId) {
    payload.delivery_details = {
      address: {
        address_id: params.addressId,
        ...(params.apartmentNumber ? { apartment_number: params.apartmentNumber } : {}),
      },
      ...(params.deliveryInstruction ? { delivery_instruction: params.deliveryInstruction } : {}),
    }
  }
  return payload
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación de la respuesta del proveedor
// ─────────────────────────────────────────────────────────────────────────────

/** Hosts aceptados para un checkout hospedado. Ampliar solo con evidencia de DoorDash. */
export const ALLOWED_CHECKOUT_HOSTS = ['order.online', 'www.order.online'] as const
const ALLOWED_CHECKOUT_HOST_SUFFIXES = ['.doordash.com'] as const

export function isAllowedCheckoutHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if ((ALLOWED_CHECKOUT_HOSTS as readonly string[]).includes(h)) return true
  return ALLOWED_CHECKOUT_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length)
}

/** Página principal de tienda (`/store/<slug>` sin más ruta): NO es un checkout con carrito. */
export function isStoreHomepageUrl(u: URL): boolean {
  return /^\/store\/[^/]+\/?$/i.test(u.pathname)
}

export type ProviderResponseCheck =
  | { ok: true; orderSessionId: string; checkoutUrl: string }
  | { ok: false; reason: string }

export function validateOrderSessionResponse(
  data: unknown,
  expectedStorefrontStoreId?: string
): ProviderResponseCheck {
  if (!isPlainObject(data)) return { ok: false, reason: 'Respuesta no es un objeto JSON' }
  const id = typeof data.order_session_id === 'string' ? data.order_session_id.trim() : ''
  if (!id) return { ok: false, reason: 'Falta order_session_id' }
  const rawUrl = typeof data.checkout_url === 'string' ? data.checkout_url.trim() : ''
  if (!rawUrl) return { ok: false, reason: 'Falta checkout_url' }
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'checkout_url no es una URL válida' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'checkout_url no es HTTPS' }
  if (u.username || u.password) return { ok: false, reason: 'checkout_url contiene credenciales' }
  if (!isAllowedCheckoutHost(u.hostname)) return { ok: false, reason: `Host no permitido: ${u.hostname}` }
  if (isStoreHomepageUrl(u)) return { ok: false, reason: 'checkout_url es la página principal de la tienda' }
  if (expectedStorefrontStoreId) {
    const slugStoreMatch = u.pathname.match(/^\/store\/[^/]*-(\d+)(?:\/|$)/i)
    if (slugStoreMatch && slugStoreMatch[1] !== expectedStorefrontStoreId) {
      return {
        ok: false,
        reason: `checkout_url corresponde a otra sucursal (${slugStoreMatch[1]} != ${expectedStorefrontStoreId})`,
      }
    }
  }
  return { ok: true, orderSessionId: id, checkoutUrl: u.toString() }
}
