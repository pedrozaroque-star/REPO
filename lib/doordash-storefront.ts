/**
 * @module lib/doordash-storefront
 * @description Cliente de servidor para DoorDash Storefront API V1 (menú, direcciones y `order_session`)
 * y cotizaciones de DoorDash Drive API V2 usados por `Menu2` de Tacos Gavilan App.
 *
 * @businessRules
 * - Producto correcto para "nuestro carrito → checkout hospedado con ESE carrito": Storefront
 *   `POST /storefront/api/v1/orders/order_session` (devuelve `order_session_id` + `checkout_url`).
 *   Drive es logística (cotizar/solicitar repartidor); NO provee el checkout de order.online ni cobra la comida.
 * - La sesión SOLO se crea si: `STOREFRONT_ORDER_SESSION_ENABLED === 'true'`, hay credenciales, el menú Storefront
 *   autorizado de la sucursal responde, el carrito proviene de ese menú (`catalog.source === 'DOORDASH_STOREFRONT'`)
 *   y cada línea valida contra él. Si algo falla se devuelve un error con código; JAMÁS se devuelve la página
 *   principal de la tienda como si fuera un checkout.
 * - El checkout de Storefront gestiona el reparto: aquí NO se solicita repartidor por Drive (evita entregas duplicadas).
 * - Las cotizaciones Drive (`quoteStoreDeliveryWithDoorDash`) usan credenciales en estado "Pending activation"
 *   (sandbox) según el portal de DoorDash (captura del 2026-10-16): sus tarifas NO son reales y no se muestran
 *   a clientes como cargo.
 *
 * @dataFlow
 * - `POST /api/mobile/doordash/checkout-session` → `createStorefrontOrderSession()` →
 *   GET `/storefront/api/v1/stores/{id}/menus` → `validateCartAgainstStorefrontMenu()` →
 *   (delivery) POST `/storefront/api/v1/addresses/create` → POST `/storefront/api/v1/orders/order_session` →
 *   `validateOrderSessionResponse()`.
 *
 * @notes
 * - 2026-10-16: con la credencial actual, `order_session` respondió HTTP 403 `authorization_error` ("permissions to
 *   access the following apis: Drive API"). Estado: Storefront NO habilitado. Respuesta de soporte recibida: acceso
 *   restringido, sin fecha (no es aprobación).
 * - `doorDashStoreId` se tomó del número final del slug de cada URL `order.online/store/<slug>-<id>`. NO está
 *   verificado como `store_id` de la Storefront API: confirmar con `GET /storefront/api/v1/stores/{id}` al tener acceso.
 * - Se eliminó el fallback que devolvía `ok:true` con la página principal de la tienda como `checkoutUrl`.
 */

import {
  generateDoorDashAuthToken,
  createDoorDashQuote,
  type DoorDashAddress,
  type DoorDashQuoteResult,
} from './doordash-drive'
import {
  STOREFRONT_CATALOG_SOURCE,
  buildOrderSessionPayload,
  validateCartAgainstStorefrontMenu,
  validateOrderSessionResponse,
  type ParsedCheckoutRequest,
  type StorefrontMenu,
} from './storefront/order-session-contract'

const DOORDASH_API_HOST =
  process.env.DOORDASH_API_HOST || 'https://openapi.doordash.com'
export const DOORDASH_BUSINESS_ID = process.env.DOORDASH_BUSINESS_ID || ''

/** Entorno declarado de la credencial Drive. Por defecto `sandbox` (portal: "Pending activation"). */
export const DOORDASH_DRIVE_ENVIRONMENT: 'sandbox' | 'production' =
  process.env.DOORDASH_DRIVE_ENVIRONMENT === 'production' ? 'production' : 'sandbox'

/** La creación productiva de sesiones permanece deshabilitada hasta tener permiso y validación completa. */
export function isStorefrontOrderSessionEnabled(): boolean {
  return process.env.STOREFRONT_ORDER_SESSION_ENABLED === 'true'
}

export interface DoorDashStoreMapping {
  storeId: number
  storeName: string
  doorDashStoreId: string
  storefrontSlug: string
  storefrontBaseUrl: string
  street: string
  city: string
  state: 'CA'
  zipCode: string
  phoneE164: string
}

export const DOORDASH_STORES_BY_ID: Record<number, DoorDashStoreMapping> = {
  1: {
    storeId: 1,
    storeName: 'Rialto',
    doorDashStoreId: '841931',
    storefrontSlug: 'tacos-gavilan-rialto-841931',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-rialto-841931',
    street: '115 E. Baseline Rd.',
    city: 'Rialto',
    state: 'CA',
    zipCode: '92376',
    phoneE164: '+19095620430',
  },
  3: {
    storeId: 3,
    storeName: 'West Covina',
    doorDashStoreId: '725035',
    storefrontSlug: 'tacos-gavilan-west-covina-725035',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-west-covina-725035',
    street: '101 S. Azusa Ave.',
    city: 'West Covina',
    state: 'CA',
    zipCode: '91791',
    phoneE164: '+16269172662',
  },
  4: {
    storeId: 4,
    storeName: 'Azusa',
    doorDashStoreId: '718169',
    storefrontSlug: 'tacos-gavilan-azusa-718169',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-azusa-718169',
    street: '887 S. Azusa Ave.',
    city: 'Azusa',
    state: 'CA',
    zipCode: '91702',
    phoneE164: '+16269691011',
  },
  5: {
    storeId: 5,
    storeName: 'LA Broadway',
    doorDashStoreId: '260769',
    storefrontSlug: 'tacos-gavilan-los-angeles-260769',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
    street: '4380 S. Broadway',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90037',
    phoneE164: '+13232332302',
  },
  6: {
    storeId: 6,
    storeName: 'LA Central',
    doorDashStoreId: '260847',
    storefrontSlug: 'tacos-gavilan-los-angeles-260847',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
    street: '1900 S. Central Ave.',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90011',
    phoneE164: '+12137426677',
  },
  7: {
    storeId: 7,
    storeName: 'Slauson',
    doorDashStoreId: '23989119',
    storefrontSlug: 'tacos-gavilan-slauson-broadway-23989119',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
    street: '5833 S. Broadway',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90003',
    phoneE164: '+13236150084',
  },
  8: {
    storeId: 8,
    storeName: 'Hollywood',
    doorDashStoreId: '551916',
    storefrontSlug: 'tacos-gavilan-los-angeles-551916',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
    street: '7070 Sunset Blvd.',
    city: 'Los Angeles',
    state: 'CA',
    zipCode: '90028',
    phoneE164: '+13239637993',
  },
  9: {
    storeId: 9,
    storeName: 'Santa Ana',
    doorDashStoreId: '724574',
    storefrontSlug: 'tacos-gavilan-santa-ana-724574',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
    street: '1258 E. 17th St.',
    city: 'Santa Ana',
    state: 'CA',
    zipCode: '92701',
    phoneE164: '+17144800713',
  },
  10: {
    storeId: 10,
    storeName: 'La Puente',
    doorDashStoreId: '963464',
    storefrontSlug: 'tacos-gavilan-la-puente-963464',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-la-puente-963464',
    street: '13009 Valley Blvd.',
    city: 'La Puente',
    state: 'CA',
    zipCode: '91746',
    phoneE164: '+16263363000',
  },
  11: {
    storeId: 11,
    storeName: 'Huntington Park',
    doorDashStoreId: '260849',
    storefrontSlug: 'tacos-gavilan-huntington-park-260849',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
    street: '2425 E. Florence Ave.',
    city: 'Huntington Park',
    state: 'CA',
    zipCode: '90255',
    phoneE164: '+13235817309',
  },
  12: {
    storeId: 12,
    storeName: 'Norwalk',
    doorDashStoreId: '1327857',
    storefrontSlug: 'tacos-gavilan-norwalk-1327857',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
    street: '10968 Rosecrans Ave.',
    city: 'Norwalk',
    state: 'CA',
    zipCode: '90650',
    phoneE164: '+15626510045',
  },
  13: {
    storeId: 13,
    storeName: 'Bell',
    doorDashStoreId: '260912',
    storefrontSlug: 'tacos-gavilan-bell-260912',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-bell-260912',
    street: '4406 E. Florence Ave.',
    city: 'Bell',
    state: 'CA',
    zipCode: '90201',
    phoneE164: '+13237711722',
  },
  14: {
    storeId: 14,
    storeName: 'Lynwood',
    doorDashStoreId: '727877',
    storefrontSlug: 'tacos-gavilan-lynwood-727877',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-lynwood-727877',
    street: '3220 E. Imperial Hwy.',
    city: 'Lynwood',
    state: 'CA',
    zipCode: '90262',
    phoneE164: '+14247855535',
  },
  15: {
    storeId: 15,
    storeName: 'South Gate',
    doorDashStoreId: '846517',
    storefrontSlug: 'tacos-gavilan-south-gate-846517',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-south-gate-846517',
    street: '5800 Firestone Blvd.',
    city: 'South Gate',
    state: 'CA',
    zipCode: '90280',
    phoneE164: '+15628061200',
  },
  16: {
    storeId: 16,
    storeName: 'Downey',
    doorDashStoreId: '302620',
    storefrontSlug: 'tacos-gavilan-downey-302620',
    storefrontBaseUrl: 'https://order.online/store/tacos-gavilan-downey-302620',
    street: '7947 E. Florence Ave.',
    city: 'Downey',
    state: 'CA',
    zipCode: '90240',
    phoneE164: '+15629277486',
  },
}

export function getDoorDashStoreMapping(
  storeId: number
): DoorDashStoreMapping | null {
  return DOORDASH_STORES_BY_ID[storeId] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive (cotización sandbox; NO es parte del checkout de Storefront)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cotiza el envío con DoorDash Drive V2 (`/drive/v2/quotes`). Con la credencial actual el resultado es de
 * sandbox (`DOORDASH_DRIVE_ENVIRONMENT`). No crea entregas ni solicita repartidor.
 */
export async function quoteStoreDeliveryWithDoorDash(params: {
  storeId: number
  dropoffAddress: DoorDashAddress
  dropoffPhoneNumber: string
  orderValueCents: number
}): Promise<DoorDashQuoteResult> {
  const store = getDoorDashStoreMapping(params.storeId)
  if (!store) {
    return { ok: false, error: `Sucursal inválida: ${params.storeId}` }
  }

  const digits = params.dropoffPhoneNumber.replace(/[^\d]/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10) {
    return { ok: false, error: 'Teléfono de entrega inválido (10 dígitos).' }
  }

  const orderValue = Number.isFinite(params.orderValueCents)
    ? Math.min(100_000, Math.max(500, Math.round(params.orderValueCents)))
    : 2500

  return createDoorDashQuote({
    externalDeliveryId: `tg-m2-quote-${store.storeId}-${Date.now()}`,
    pickupAddress: {
      street: store.street,
      city: store.city,
      state: store.state,
      zip_code: store.zipCode,
    },
    pickupPhoneNumber: store.phoneE164,
    pickupBusinessName: `Tacos Gavilan - ${store.storeName}`,
    dropoffAddress: params.dropoffAddress,
    dropoffPhoneNumber: `+1${national}`,
    orderValueCents: orderValue,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Storefront: menú, direcciones y order_session
// ─────────────────────────────────────────────────────────────────────────────

export type StorefrontSessionErrorCode =
  | 'STOREFRONT_DISABLED'
  | 'CREDENTIALS_MISSING'
  | 'STORE_NOT_MAPPED'
  | 'CATALOG_NOT_AUTHORIZED'
  | 'CATALOG_STALE'
  | 'CART_INVALID'
  | 'ADDRESS_INVALID'
  | 'STOREFRONT_NOT_AUTHORIZED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_PROVIDER_RESPONSE'

export type StorefrontSessionResult =
  | {
      ok: true
      orderSessionId: string
      checkoutUrl: string
      storefrontStoreId: string
      menuId: string
      fulfillmentType: 'pickup' | 'delivery'
    }
  | {
      ok: false
      code: StorefrontSessionErrorCode
      httpStatus: number
      /** Mensaje interno, sin secretos ni datos personales. */
      detail: string
      providerStatus?: number
      cartErrors?: string[]
    }

const MENU_TIMEOUT_MS = 8000
const ADDRESS_TIMEOUT_MS = 8000
const ORDER_SESSION_TIMEOUT_MS = 10000

type FetchOutcome =
  | { kind: 'response'; status: number; bodyText: string }
  | { kind: 'timeout' }
  | { kind: 'network'; message: string }

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<FetchOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const bodyText = await res.text()
    return { kind: 'response', status: res.status, bodyText }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return { kind: 'timeout' }
    return { kind: 'network', message: err instanceof Error ? err.message : 'network error' }
  } finally {
    clearTimeout(timer)
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Extrae solo el `code` del error del proveedor (nunca el cuerpo completo, que puede contener datos). */
function providerErrorCode(bodyText: string): string {
  const parsed = safeJson(bodyText)
  if (parsed && typeof parsed === 'object' && 'code' in parsed) {
    const c = (parsed as { code?: unknown }).code
    if (typeof c === 'string') return c.slice(0, 60)
  }
  return 'unknown'
}

function mapProviderFailure(
  stage: string,
  outcome: FetchOutcome
): Extract<StorefrontSessionResult, { ok: false }> {
  if (outcome.kind === 'timeout') {
    return { ok: false, code: 'PROVIDER_TIMEOUT', httpStatus: 504, detail: `${stage}: tiempo de espera agotado` }
  }
  if (outcome.kind === 'network') {
    return { ok: false, code: 'PROVIDER_ERROR', httpStatus: 502, detail: `${stage}: error de red` }
  }
  if (outcome.status === 401 || outcome.status === 403) {
    return {
      ok: false,
      code: 'STOREFRONT_NOT_AUTHORIZED',
      httpStatus: 503,
      providerStatus: outcome.status,
      detail: `${stage}: HTTP ${outcome.status} (${providerErrorCode(outcome.bodyText)})`,
    }
  }
  return {
    ok: false,
    code: 'PROVIDER_ERROR',
    httpStatus: 502,
    providerStatus: outcome.status,
    detail: `${stage}: HTTP ${outcome.status} (${providerErrorCode(outcome.bodyText)})`,
  }
}

/** GET menú Storefront autorizado. Un reintento solo ante 5xx o error de red (operación de lectura). */
export async function fetchStorefrontMenu(
  storefrontStoreId: string,
  token: string
): Promise<{ ok: true; menu: StorefrontMenu } | Extract<StorefrontSessionResult, { ok: false }>> {
  const url = `${DOORDASH_API_HOST}/storefront/api/v1/stores/${encodeURIComponent(storefrontStoreId)}/menus`
  let outcome: FetchOutcome = { kind: 'network', message: 'not attempted' }
  for (let attempt = 0; attempt < 2; attempt++) {
    outcome = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      MENU_TIMEOUT_MS
    )
    const retryable =
      outcome.kind === 'network' || (outcome.kind === 'response' && outcome.status >= 500)
    if (!retryable) break
  }
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return mapProviderFailure('menus', outcome)
  }
  const parsed = safeJson(outcome.bodyText) as { menu?: StorefrontMenu } | null
  const menu = parsed && parsed.menu
  if (!menu || typeof menu.id !== 'string' || !menu.id) {
    return {
      ok: false,
      code: 'INVALID_PROVIDER_RESPONSE',
      httpStatus: 502,
      detail: 'menus: respuesta sin menu.id',
    }
  }
  return { ok: true, menu }
}

/** Obtiene/crea el `address_id` de Storefront a partir de una dirección completa. */
async function resolveStorefrontAddressId(
  storefrontStoreId: string,
  formattedAddress: string,
  token: string
): Promise<{ ok: true; addressId: string } | Extract<StorefrontSessionResult, { ok: false }>> {
  const outcome = await fetchWithTimeout(
    `${DOORDASH_API_HOST}/storefront/api/v1/addresses/create`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        integration_id: storefrontStoreId,
        integration_type: 'STORE',
        formatted_address: formattedAddress,
        country_code: 'US',
      }),
    },
    ADDRESS_TIMEOUT_MS
  )
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    const failure = mapProviderFailure('addresses/create', outcome)
    return outcome.kind === 'response' && outcome.status === 400
      ? { ...failure, code: 'ADDRESS_INVALID', httpStatus: 422 }
      : failure
  }
  const parsed = safeJson(outcome.bodyText) as { address?: { address_id?: unknown } } | null
  const addressId = parsed?.address?.address_id
  if (typeof addressId !== 'string' || !addressId) {
    return { ok: false, code: 'ADDRESS_INVALID', httpStatus: 422, detail: 'addresses/create sin address_id' }
  }
  return { ok: true, addressId }
}

/**
 * Crea la sesión de checkout hospedado desde el carrito de Menu2. Solo retorna `ok:true` cuando DoorDash
 * devolvió un `order_session_id` y un `checkout_url` HTTPS válido en un host permitido.
 * No hay reintento automático del POST para no crear sesiones duplicadas.
 */
export async function createStorefrontOrderSession(
  req: ParsedCheckoutRequest
): Promise<StorefrontSessionResult> {
  if (!isStorefrontOrderSessionEnabled()) {
    return {
      ok: false,
      code: 'STOREFRONT_DISABLED',
      httpStatus: 503,
      detail: 'STOREFRONT_ORDER_SESSION_ENABLED no está activo (acceso Storefront pendiente de DoorDash)',
    }
  }

  const store = getDoorDashStoreMapping(req.storeId)
  if (!store) {
    return { ok: false, code: 'STORE_NOT_MAPPED', httpStatus: 400, detail: `Sucursal ${req.storeId} sin mapeo` }
  }

  if (req.catalogSource !== STOREFRONT_CATALOG_SOURCE || !req.menuId) {
    return {
      ok: false,
      code: 'CATALOG_NOT_AUTHORIZED',
      httpStatus: 409,
      detail: `El carrito proviene de "${req.catalogSource}"; se requiere el menú Storefront autorizado`,
    }
  }

  const token = generateDoorDashAuthToken()
  if (!token) {
    return { ok: false, code: 'CREDENTIALS_MISSING', httpStatus: 503, detail: 'Credenciales DoorDash no configuradas' }
  }

  const menuResult = await fetchStorefrontMenu(store.doorDashStoreId, token)
  if (!menuResult.ok) return menuResult
  const menu = menuResult.menu

  if (menu.id !== req.menuId) {
    return {
      ok: false,
      code: 'CATALOG_STALE',
      httpStatus: 409,
      detail: 'El menú de la sucursal cambió; el carrito debe revalidarse',
    }
  }

  const validation = validateCartAgainstStorefrontMenu(menu, req.lines)
  if (!validation.ok) {
    return {
      ok: false,
      code: 'CART_INVALID',
      httpStatus: 422,
      detail: 'El carrito no coincide con el menú autorizado',
      cartErrors: validation.errors.slice(0, 20),
    }
  }

  let addressId: string | undefined
  if (req.fulfillmentType === 'delivery') {
    if (!req.delivery) {
      return { ok: false, code: 'ADDRESS_INVALID', httpStatus: 422, detail: 'Falta dirección de entrega' }
    }
    const addr = await resolveStorefrontAddressId(store.doorDashStoreId, req.delivery.formattedAddress, token)
    if (!addr.ok) return addr
    addressId = addr.addressId
  }

  const payload = buildOrderSessionPayload({
    storefrontStoreId: store.doorDashStoreId,
    menuId: menu.id,
    fulfillmentType: req.fulfillmentType,
    items: validation.items,
    addressId,
    apartmentNumber: req.delivery?.apartmentNumber,
    deliveryInstruction: req.delivery?.instructions,
  })

  const outcome = await fetchWithTimeout(
    `${DOORDASH_API_HOST}/storefront/api/v1/orders/order_session`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    ORDER_SESSION_TIMEOUT_MS
  )
  if (outcome.kind !== 'response' || outcome.status !== 200) {
    return mapProviderFailure('order_session', outcome)
  }

  const check = validateOrderSessionResponse(safeJson(outcome.bodyText), store.doorDashStoreId)
  if (!check.ok) {
    return { ok: false, code: 'INVALID_PROVIDER_RESPONSE', httpStatus: 502, detail: `order_session: ${check.reason}` }
  }

  return {
    ok: true,
    orderSessionId: check.orderSessionId,
    checkoutUrl: check.checkoutUrl,
    storefrontStoreId: store.doorDashStoreId,
    menuId: menu.id,
    fulfillmentType: req.fulfillmentType,
  }
}
