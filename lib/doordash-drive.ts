/**
 * @module lib/doordash-drive
 * @description Cliente autoritativo para la integración con DoorDash Drive Classic API v2.
 * Permite cotizar tarifas de envío, despachar repartidores (Dashers) y rastrear entregas
 * para órdenes del canal 'DELIVERY' de Tacos Gavilan.
 * 
 * @businessRules
 * - Precios de Tienda Respetados: Los comensales compran a los precios oficiales de la sucursal de Tacos Gavilan.
 *   La tarifa de envío es transparente ($4.99) o cotizada por DoorDash.
 * - Despacho Sincronizado: Al confirmarse el pago y entrar a preparación, se emite la orden de entrega a DoorDash
 *   para que el repartidor recoja la comanda en el mostrador de la sucursal con el identificador del pedido.
 * - Cero Simulación Ficticia: Si las credenciales de DoorDash Drive no están configuradas en el entorno
 *   (DOORDASH_DEVELOPER_ID, DOORDASH_KEY_ID, DOORDASH_SIGNING_SECRET), se devuelve un error explícito
 *   y jamás se generan códigos de seguimiento simulados ('simulated_dasher_...').
 * 
 * @dataFlow
 * - app_orders (Supabase) -> lib/doordash-drive.ts -> DoorDash Drive API (https://openapi.doordash.com) ->
 *   Actualiza app_orders con tracking_url y delivery_status.
 * 
 * @notes
 * - La autenticación con DoorDash Drive requiere tokens JWT firmados con algoritmo HS256 y header 'dd-ver': 'DD-HEX-1'.
 */

import jwt from 'jsonwebtoken'

const DOORDASH_API_HOST = process.env.DOORDASH_API_HOST || 'https://openapi.doordash.com'

/**
 * Genera el JWT firmado necesario para autenticar peticiones con DoorDash Drive API v2.
 */
export function generateDoorDashAuthToken(): string | null {
  const developerId = process.env.DOORDASH_DEVELOPER_ID
  const keyId = process.env.DOORDASH_KEY_ID
  const signingSecret = process.env.DOORDASH_SIGNING_SECRET

  if (!developerId || !keyId || !signingSecret) {
    return null
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  const payload = {
    aud: 'doordash',
    iss: developerId,
    kid: keyId,
    exp: nowSeconds + 300, // 5 minutos de validez
    iat: nowSeconds,
  }

  const headers = {
    algorithm: 'HS256' as const,
    header: {
      alg: 'HS256',
      typ: 'JWT',
      'dd-ver': 'DD-HEX-1',
    },
  }

  try {
    const decodedSecret = Buffer.from(signingSecret, 'base64')
    return jwt.sign(payload, decodedSecret, headers)
  } catch (err) {
    console.error('[DoorDash Drive] Error firmando token JWT:', err)
    return null
  }
}

export interface DoorDashAddress {
  street: string
  unit?: string
  city: string
  state: string
  zip_code: string
}

export interface QuoteDeliveryParams {
  externalDeliveryId: string
  pickupAddress: DoorDashAddress
  pickupPhoneNumber: string
  pickupBusinessName: string
  dropoffAddress: DoorDashAddress
  dropoffPhoneNumber: string
  orderValueCents: number
}

export interface DoorDashQuoteResult {
  ok: boolean
  feeCents?: number
  currency?: string
  estimatedDeliveryTime?: string
  error?: string
  details?: Record<string, unknown>
}

/**
 * Solicita una cotización de costo de entrega y tiempo estimado a DoorDash Drive API.
 */
export async function createDoorDashQuote(
  params: QuoteDeliveryParams
): Promise<DoorDashQuoteResult> {
  const token = generateDoorDashAuthToken()
  if (!token) {
    return {
      ok: false,
      error: 'Credenciales de DoorDash Drive no configuradas en el entorno.',
    }
  }

  const url = `${DOORDASH_API_HOST}/drive/v2/deliveries/quotes`

  const body = {
    external_delivery_id: params.externalDeliveryId,
    pickup_address: `${params.pickupAddress.street}, ${params.pickupAddress.city}, ${params.pickupAddress.state} ${params.pickupAddress.zip_code}`,
    pickup_phone_number: params.pickupPhoneNumber,
    pickup_business_name: params.pickupBusinessName,
    dropoff_address: `${params.dropoffAddress.street}, ${params.dropoffAddress.city}, ${params.dropoffAddress.state} ${params.dropoffAddress.zip_code}`,
    dropoff_phone_number: params.dropoffPhoneNumber,
    order_value: params.orderValueCents,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.warn(`[DoorDash Drive] Error en cotización (HTTP ${res.status}):`, errText)
      return {
        ok: false,
        error: `DoorDash Drive rechazó la cotización (HTTP ${res.status}): ${errText}`,
      }
    }

    const data = await res.json()
    return {
      ok: true,
      feeCents: data.fee,
      currency: data.currency || 'USD',
      estimatedDeliveryTime: data.estimated_delivery_time,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al cotizar con DoorDash'
    console.error('[DoorDash Drive] Excepción en cotización:', msg)
    return {
      ok: false,
      error: msg,
    }
  }
}

export interface DispatchDeliveryParams extends QuoteDeliveryParams {
  customerName: string
  dropoffInstructions?: string
  tipCents?: number
}

export interface DoorDashDispatchResult {
  ok: boolean
  deliveryId?: string
  trackingUrl?: string
  status?: string
  dasherName?: string
  error?: string
  details?: Record<string, unknown>
}

/**
 * Despacha un repartidor de DoorDash para recoger la orden en la sucursal de Tacos Gavilan.
 */
export async function dispatchDoorDashDelivery(
  params: DispatchDeliveryParams
): Promise<DoorDashDispatchResult> {
  const token = generateDoorDashAuthToken()
  if (!token) {
    return {
      ok: false,
      error: 'Credenciales de DoorDash Drive no configuradas en el entorno.',
    }
  }

  const url = `${DOORDASH_API_HOST}/drive/v2/deliveries`

  const body = {
    external_delivery_id: params.externalDeliveryId,
    pickup_address: `${params.pickupAddress.street}, ${params.pickupAddress.city}, ${params.pickupAddress.state} ${params.pickupAddress.zip_code}`,
    pickup_phone_number: params.pickupPhoneNumber,
    pickup_business_name: params.pickupBusinessName,
    pickup_instructions: 'Dirígete al mostrador de entrega y solicita la orden para la app Tacos Gavilan.',
    dropoff_address: `${params.dropoffAddress.street}, ${params.dropoffAddress.city}, ${params.dropoffAddress.state} ${params.dropoffAddress.zip_code}`,
    dropoff_phone_number: params.dropoffPhoneNumber,
    dropoff_instructions: params.dropoffInstructions || 'Entregar en mano al cliente.',
    order_value: params.orderValueCents,
    tip: params.tipCents || 0,
    pickup_reference_tag: `TG-${params.externalDeliveryId.slice(0, 8).toUpperCase()}`,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.warn(`[DoorDash Drive] Error al despachar entrega (HTTP ${res.status}):`, errText)
      return {
        ok: false,
        error: `DoorDash Drive rechazó la orden de despacho (HTTP ${res.status}): ${errText}`,
      }
    }

    const data = await res.json()
    return {
      ok: true,
      deliveryId: data.id || data.delivery_id,
      trackingUrl: data.tracking_url,
      status: data.delivery_status || 'CREATED',
      dasherName: data.dasher_name,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al despachar con DoorDash'
    console.error('[DoorDash Drive] Excepción al despachar entrega:', msg)
    return {
      ok: false,
      error: msg,
    }
  }
}
