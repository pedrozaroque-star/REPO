/**
 * @module app/api/mobile/doordash/checkout-session/route
 * @description Endpoint público para `Menu2` que cotiza entregas en tiempo real con DoorDash Drive API V2
 * (`/drive/v2/quotes`) y genera la sesión de pago hospedada (`checkout_url`) mediante DoorDash Storefront API V1
 * (`/storefront/api/v1/orders/order_session`).
 *
 * @businessRules
 * - Valida que `storeId` corresponda a una de las 15 sucursales oficiales de Tacos Gavilan.
 * - Cuando `action === 'quote'`, solicita una cotización real a DoorDash Drive API V2 usando las credenciales
 *   JWT de `TG Tacos Gavilan` (`DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET`).
 * - Cuando `action === 'checkout'` (por defecto), invoca `createDoorDashOrderSession` enviando el carrito
 *   nativo de `Menu2` y retorna el `checkoutUrl` oficial de DoorDash junto con la cotización real de envío.
 *
 * @dataFlow
 * - `Menu2` (App) -> `POST /api/mobile/doordash/checkout-session` -> `lib/doordash-storefront.ts`
 *   -> DoorDash Drive V2 + DoorDash Storefront V1 -> JSON `{ ok, mode, checkoutUrl, driveQuote }`.
 *
 * @notes
 * - Soporta CORS completo (`OPTIONS`) para consumo desde Web (`/app`) y dispositivos nativos iOS/Android.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { corsResponse, jsonOk, jsonError } from '../../_helpers'
import {
  createDoorDashOrderSession,
  getDoorDashStoreMapping,
  quoteStoreDeliveryWithDoorDash,
  type StorefrontSessionItemInput,
} from '@/lib/doordash-storefront'
import type { DoorDashAddress } from '@/lib/doordash-drive'

interface IncomingAddressPayload {
  street?: string
  city?: string
  state?: string
  zipCode?: string
  zip_code?: string
  aptSuite?: string
  subpremise?: string
}

interface IncomingItemPayload {
  guid: string
  name: string
  price: number
  basePrice?: number
  qty?: number
  quantity?: number
  specialInstructions?: string
  modifiers?: Array<{
    guid: string
    name: string
    price: number
    quantity?: number
  }>
}

interface CheckoutSessionRequestBody {
  action?: 'quote' | 'checkout'
  storeId?: number
  fulfillmentType?: 'in_store' | 'delivery' | 'PICKUP' | 'DELIVERY'
  items?: IncomingItemPayload[]
  dropoffAddress?: IncomingAddressPayload
  deliveryAddress?: IncomingAddressPayload
  dropoffPhoneNumber?: string
  orderValueCents?: number
  customerPhone?: string
  customerFirstName?: string
  customerLastName?: string
  customerEmail?: string
  customer?: {
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
  }
}

function normalizeDoorDashAddress(
  raw: IncomingAddressPayload | undefined,
  fallbackCity: string
): DoorDashAddress | undefined {
  if (!raw) return undefined
  const street = (raw.street || '').trim()
  const zip = (raw.zipCode || raw.zip_code || '').trim()
  if (!street || !zip) return undefined

  return {
    street,
    city: (raw.city || fallbackCity).trim(),
    state: (raw.state || 'CA').trim(),
    zip_code: zip,
    unit: (raw.aptSuite || raw.subpremise || '').trim() || undefined,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CheckoutSessionRequestBody
    const storeId = Number(body.storeId || 0)
    const store = getDoorDashStoreMapping(storeId)

    if (!store) {
      return jsonError(
        `Sucursal inválida o no reconocida (${String(body.storeId)}).`,
        400
      )
    }

    const action = body.action === 'quote' ? 'quote' : 'checkout'
    const rawFulfillment = String(body.fulfillmentType || '').toLowerCase()
    const fulfillmentType: 'in_store' | 'delivery' =
      rawFulfillment === 'delivery' ? 'delivery' : 'in_store'

    const normalizedAddress = normalizeDoorDashAddress(
      body.dropoffAddress || body.deliveryAddress,
      store.city
    )

    const customerPhone =
      body.dropoffPhoneNumber ||
      body.customerPhone ||
      body.customer?.phone ||
      undefined

    if (action === 'quote') {
      if (!normalizedAddress) {
        return jsonError(
          'Ingresa la calle, ciudad y código postal para cotizar el envío con DoorDash.',
          400
        )
      }

      const quote = await quoteStoreDeliveryWithDoorDash({
        storeId: store.storeId,
        dropoffAddress: normalizedAddress,
        dropoffPhoneNumber: customerPhone,
        orderValueCents: Number(body.orderValueCents || 2500),
      })

      if (!quote.ok) {
        return jsonError(
          quote.error || 'No fue posible cotizar la entrega con DoorDash.',
          422
        )
      }

      const feeCents = Number(quote.feeCents ?? 0)
      const feeDollars = Number((feeCents / 100).toFixed(2))
      const rawExternalId =
        typeof quote.details?.external_delivery_id === 'string'
          ? quote.details.external_delivery_id
          : `dd-quote-${store.storeId}-${Date.now()}`
      const rawPickupTime =
        typeof quote.details?.pickup_time_estimated === 'string'
          ? quote.details.pickup_time_estimated
          : null

      return jsonOk({
        ok: true,
        quoteId: rawExternalId,
        feeCents,
        feeDollars,
        currency: quote.currency || 'USD',
        estimatedPickupTime: rawPickupTime,
        estimatedDropoffTime: quote.estimatedDeliveryTime || null,
        storeId: store.storeId,
        storeName: store.storeName,
        doorDashStoreId: store.doorDashStoreId,
        deliveryQuote: quote,
      })
    }

    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      return jsonError(
        'Agrega al menos un platillo a tu bolsa antes de proceder al pago.',
        400
      )
    }

    const items: StorefrontSessionItemInput[] = rawItems.map((it) => ({
      guid: it.guid,
      name: it.name,
      price: Number(it.price || it.basePrice || 0),
      quantity: Math.max(1, Number(it.qty ?? it.quantity ?? 1)),
      specialInstructions: it.specialInstructions,
      modifiers: (it.modifiers || []).map((m) => ({
        guid: m.guid,
        name: m.name,
        price: Number(m.price || 0),
        quantity: m.quantity ?? 1,
      })),
    }))

    const sessionResult = await createDoorDashOrderSession({
      storeId: store.storeId,
      fulfillmentType,
      items,
      deliveryAddress: normalizedAddress,
      customerPhone,
      customerFirstName:
        body.customerFirstName || body.customer?.firstName || undefined,
      customerLastName:
        body.customerLastName || body.customer?.lastName || undefined,
      customerEmail: body.customerEmail || body.customer?.email || undefined,
    })

    if (!sessionResult.ok) {
      return jsonError(
        sessionResult.error ||
          'Error al iniciar la sesión de pago en DoorDash.',
        500
      )
    }

    const sessionQuoteId =
      typeof sessionResult.deliveryQuote?.details?.external_delivery_id ===
      'string'
        ? sessionResult.deliveryQuote.details.external_delivery_id
        : `dd-quote-${store.storeId}`

    const driveQuotePayload =
      sessionResult.deliveryQuote && sessionResult.deliveryQuote.ok
        ? {
            quoteId: sessionQuoteId,
            feeCents: Number(sessionResult.deliveryQuote.feeCents ?? 0),
            feeDollars: Number(
              (Number(sessionResult.deliveryQuote.feeCents ?? 0) / 100).toFixed(
                2
              )
            ),
            estimatedDropoffTime:
              sessionResult.deliveryQuote.estimatedDeliveryTime || null,
          }
        : null

    return jsonOk({
      ok: true,
      mode:
        sessionResult.sessionMode === 'ORDER_SESSION_API'
          ? 'STOREFRONT_API_SESSION'
          : 'STOREFRONT_WEB_CHECKOUT',
      sessionMode: sessionResult.sessionMode,
      checkoutUrl: sessionResult.checkoutUrl,
      sessionId: sessionResult.orderSessionId || null,
      doorDashStoreId: sessionResult.doorDashStoreId,
      storeName: sessionResult.storeName,
      fulfillmentType: fulfillmentType === 'delivery' ? 'DELIVERY' : 'PICKUP',
      driveQuote: driveQuotePayload,
      deliveryQuote: sessionResult.deliveryQuote || null,
      apiNote: sessionResult.apiMessage,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno'
    console.error('❌ [mobile/doordash/checkout-session] Error:', msg)
    return jsonError('Error al procesar la sesión de DoorDash.', 500)
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
