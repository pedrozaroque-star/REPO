/**
 * @module lib/doordash-storefront
 * @description Cliente híbrido para DoorDash Storefront API V1 y DoorDash Drive API V2
 * utilizado por el módulo nativo `Menu2` de Tacos Gavilan App.
 *
 * @businessRules
 * - Las 15 sucursales oficiales de Tacos Gavilan se mapean 1:1 con su `doorDashStoreId` real
 *   bajo el `Merchant Business ID: 137616` y el `Developer ID: cbca7678-3306-47b1-baca-46ccdf3607e2`.
 * - Para envíos a domicilio (`delivery`), cotiza en tiempo real con DoorDash Drive API V2 (`/drive/v2/quotes`)
 *   usando el token JWT `DD-JWT-V1`.
 * - Para el cierre de compra (`checkout`), invoca `POST /storefront/api/v1/orders/order_session` para obtener
 *   el `checkout_url` hospedado por DoorDash con el carrito pre-cargado. Mientras DoorDash Support completa
 *   la habilitación del permiso `Storefront API V1` sobre el `Developer ID`, entrega la URL oficial del
 *   Storefront de la sucursal seleccionada con la modalidad (`pickup` o `delivery`) preseleccionada.
 *
 * @dataFlow
 * - `Menu2` (App) -> `POST /api/mobile/doordash/checkout-session` -> `lib/doordash-storefront.ts`
 *   -> DoorDash Drive V2 (`/drive/v2/quotes`) + DoorDash Storefront V1 (`/storefront/api/v1/orders/order_session`)
 *   -> Retorna `{ checkoutUrl, sessionMode, deliveryQuote }`.
 *
 * @notes
 * - Cero datos inventados: las tarifas y tiempos estimados de entrega provienen directamente de DoorDash Drive V2.
 */

import {
  generateDoorDashAuthToken,
  createDoorDashQuote,
  type DoorDashAddress,
  type DoorDashQuoteResult,
} from './doordash-drive'

const DOORDASH_API_HOST =
  process.env.DOORDASH_API_HOST || 'https://openapi.doordash.com'
export const DOORDASH_BUSINESS_ID =
  process.env.DOORDASH_BUSINESS_ID || '137616'

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

export interface StorefrontSessionModifierInput {
  guid: string
  name: string
  price: number
  quantity?: number
}

export interface StorefrontSessionItemInput {
  guid: string
  name: string
  price: number
  quantity: number
  specialInstructions?: string
  modifiers?: StorefrontSessionModifierInput[]
}

export interface CreateDoorDashOrderSessionParams {
  storeId: number
  fulfillmentType: 'in_store' | 'delivery'
  items: StorefrontSessionItemInput[]
  deliveryAddress?: DoorDashAddress
  customerPhone?: string
  customerFirstName?: string
  customerLastName?: string
  customerEmail?: string
}

export interface DoorDashOrderSessionResult {
  ok: boolean
  sessionMode: 'ORDER_SESSION_API' | 'STOREFRONT_HOSTED_CHECKOUT'
  doorDashStoreId: string
  storeName: string
  orderSessionId?: string
  checkoutUrl: string
  deliveryQuote?: DoorDashQuoteResult | null
  apiMessage?: string
  error?: string
}

export function getDoorDashStoreMapping(
  storeId: number
): DoorDashStoreMapping | null {
  return DOORDASH_STORES_BY_ID[storeId] ?? null
}

/**
 * Cotiza en tiempo real el envío con DoorDash Drive V2 (/drive/v2/quotes) para una sucursal de Tacos Gavilan.
 */
export async function quoteStoreDeliveryWithDoorDash(params: {
  storeId: number
  dropoffAddress: DoorDashAddress
  dropoffPhoneNumber?: string
  orderValueCents: number
}): Promise<DoorDashQuoteResult> {
  const store = getDoorDashStoreMapping(params.storeId)
  if (!store) {
    return {
      ok: false,
      error: `Sucursal inválida: ${params.storeId}`,
    }
  }

  const cleanPhone = (params.dropoffPhoneNumber || '+13105550199').replace(
    /[^\d+]/g,
    ''
  )
  const normalizedPhone = cleanPhone.startsWith('+')
    ? cleanPhone
    : `+1${cleanPhone.replace(/^1/, '')}`

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
    dropoffPhoneNumber: normalizedPhone,
    orderValueCents: Math.max(500, Math.round(params.orderValueCents)),
  })
}

/**
 * Crea una sesión de checkout en DoorDash Storefront API V1 (`POST /storefront/api/v1/orders/order_session`).
 * Si el permiso `Storefront API V1` aún está en proceso de activación sobre el Developer ID, retorna de forma
 * limpia la URL del Storefront hospedado de la sucursal (`STOREFRONT_HOSTED_CHECKOUT`) junto con la cotización real de Drive V2.
 */
export async function createDoorDashOrderSession(
  params: CreateDoorDashOrderSessionParams
): Promise<DoorDashOrderSessionResult> {
  const store = getDoorDashStoreMapping(params.storeId)
  if (!store) {
    return {
      ok: false,
      sessionMode: 'STOREFRONT_HOSTED_CHECKOUT',
      doorDashStoreId: '',
      storeName: '',
      checkoutUrl: '',
      error: `Sucursal de Tacos Gavilan no reconocida (${params.storeId}).`,
    }
  }

  const isDelivery = params.fulfillmentType === 'delivery'
  const modeParam = isDelivery ? 'delivery=true' : 'pickup=true'
  const fallbackStorefrontUrl = `${store.storefrontBaseUrl}/?hideModal=true&${modeParam}`

  // Calcular subtotal en centavos para la cotización de DoorDash Drive V2
  const subtotalCents = params.items.reduce((acc, item) => {
    const modsTotal = (item.modifiers || []).reduce(
      (mAcc, m) => mAcc + Number(m.price || 0) * (m.quantity || 1),
      0
    )
    return (
      acc +
      Math.round((Number(item.price || 0) + modsTotal) * 100) *
        Math.max(1, item.quantity || 1)
    )
  }, 0)

  let deliveryQuote: DoorDashQuoteResult | null = null
  if (isDelivery && params.deliveryAddress?.street && params.deliveryAddress?.zip_code) {
    deliveryQuote = await quoteStoreDeliveryWithDoorDash({
      storeId: store.storeId,
      dropoffAddress: params.deliveryAddress,
      dropoffPhoneNumber: params.customerPhone,
      orderValueCents: subtotalCents || 2000,
    })
  }

  const token = generateDoorDashAuthToken()
  if (!token) {
    return {
      ok: true,
      sessionMode: 'STOREFRONT_HOSTED_CHECKOUT',
      doorDashStoreId: store.doorDashStoreId,
      storeName: store.storeName,
      checkoutUrl: fallbackStorefrontUrl,
      deliveryQuote,
      apiMessage: 'Token JWT de DoorDash no configurado; usando Storefront directo.',
    }
  }

  const orderSessionPayload = {
    store_id: store.doorDashStoreId,
    business_id: DOORDASH_BUSINESS_ID,
    fulfillment_type: isDelivery ? 'delivery' : 'pickup',
    items: params.items.map((item) => ({
      id: item.guid,
      merchant_supplied_id: item.guid,
      name: item.name,
      quantity: Math.max(1, item.quantity || 1),
      special_instructions: item.specialInstructions || '',
      options: (item.modifiers || []).map((mod) => ({
        id: mod.guid,
        merchant_supplied_id: mod.guid,
        name: mod.name,
        quantity: mod.quantity || 1,
      })),
    })),
    ...(params.customerPhone || params.customerFirstName
      ? {
          consumer: {
            first_name: params.customerFirstName || 'Cliente',
            last_name: params.customerLastName || 'Tacos Gavilan',
            phone_number: params.customerPhone || '',
            email: params.customerEmail || '',
          },
        }
      : {}),
    ...(isDelivery && params.deliveryAddress
      ? {
          delivery_address: {
            street: params.deliveryAddress.street,
            city: params.deliveryAddress.city,
            state: params.deliveryAddress.state,
            zip_code: params.deliveryAddress.zip_code,
          },
        }
      : {}),
  }

  try {
    const res = await fetch(
      `${DOORDASH_API_HOST}/storefront/api/v1/orders/order_session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(orderSessionPayload),
      }
    )

    if (res.ok) {
      const data = (await res.json()) as {
        order_session_id?: string
        checkout_url?: string
      }
      if (data.checkout_url) {
        return {
          ok: true,
          sessionMode: 'ORDER_SESSION_API',
          doorDashStoreId: store.doorDashStoreId,
          storeName: store.storeName,
          orderSessionId: data.order_session_id,
          checkoutUrl: data.checkout_url,
          deliveryQuote,
        }
      }
    }

    const errText = await res.text()
    return {
      ok: true,
      sessionMode: 'STOREFRONT_HOSTED_CHECKOUT',
      doorDashStoreId: store.doorDashStoreId,
      storeName: store.storeName,
      checkoutUrl: fallbackStorefrontUrl,
      deliveryQuote,
      apiMessage: `Storefront order_session status ${res.status}: ${errText.slice(0, 180)}`,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error de red'
    return {
      ok: true,
      sessionMode: 'STOREFRONT_HOSTED_CHECKOUT',
      doorDashStoreId: store.doorDashStoreId,
      storeName: store.storeName,
      checkoutUrl: fallbackStorefrontUrl,
      deliveryQuote,
      apiMessage: msg,
    }
  }
}
