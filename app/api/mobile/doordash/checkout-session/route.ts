/**
 * @module app/api/mobile/doordash/checkout-session/route
 * @description Endpoint de Menu2 para crear una sesión de checkout hospedado de DoorDash Storefront
 * (`order_session`) a partir del carrito nativo de la app. También expone una cotización Drive de prueba
 * (`action: 'quote'`) claramente marcada como sandbox.
 *
 * @businessRules
 * - Requiere usuario autenticado (Bearer de Supabase Auth, `getAuthUser`).
 * - Límite de frecuencia por usuario+IP (mejor esfuerzo en memoria) y tamaño máximo de cuerpo (64 KB).
 * - Esquema estricto (`parseCheckoutRequest`): cantidades enteras 1..25, ≤40 líneas, IDs seguros, textos acotados.
 *   Precios/totales enviados por el cliente se ignoran: solo cuentan los precios del menú Storefront autorizado.
 * - `checkoutUrl` SOLO se devuelve cuando DoorDash creó la sesión (`order_session_id` + URL HTTPS en host permitido
 *   que no es la página principal de la tienda). En cualquier otro caso: `ok:false` + `code` + HTTP 4xx/5xx, sin URL.
 * - Idempotencia: la misma `idempotencyKey` del mismo usuario devuelve la misma sesión durante 10 minutos
 *   (evita sesiones duplicadas por doble toque o reintento). No se reintenta el POST a DoorDash.
 * - No se solicita repartidor por Drive: el checkout de Storefront gestiona el reparto (evita entregas duplicadas).
 *
 * @dataFlow
 * - Menu2 → POST (Bearer) → `parseCheckoutRequest` → `createStorefrontOrderSession` (lib/doordash-storefront.ts)
 *   → `{ ok, orderSessionId, checkoutUrl, storeId, fulfillmentType }` | `{ ok:false, code, error }`.
 *
 * @notes
 * - 2026-10-16: reescrito. Antes devolvía `ok:true` con la página principal de la tienda cuando DoorDash respondía
 *   403, no validaba nada, confiaba en precios del cliente (y sumaba modificadores dos veces) y era público.
 * - Integración productiva deshabilitada por defecto (`STOREFRONT_ORDER_SESSION_ENABLED` ≠ 'true').
 * - Logs: solo códigos y estados HTTP; nunca tokens, teléfonos, direcciones ni cuerpos de error del proveedor.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { corsResponse, jsonOk, jsonError, getAuthUser, isAuthSuccess } from '../../_helpers'
import {
  createStorefrontOrderSession,
  getDoorDashStoreMapping,
  quoteStoreDeliveryWithDoorDash,
  DOORDASH_DRIVE_ENVIRONMENT,
} from '@/lib/doordash-storefront'
import { CHECKOUT_LIMITS, parseCheckoutRequest } from '@/lib/storefront/order-session-contract'
import { checkRateLimit, getClientIp } from '@/lib/storefront/rate-limit'
import type { DoorDashAddress } from '@/lib/doordash-drive'

const RATE_LIMIT_PER_MINUTE = 10
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000

interface CachedSession {
  expiresAt: number
  body: Record<string, unknown>
}
const idempotencyCache = new Map<string, CachedSession>()

function sweepIdempotency(now: number): void {
  for (const [k, v] of idempotencyCache) if (v.expiresAt <= now) idempotencyCache.delete(k)
}

/** Mensajes de cliente bilingües y breves; el detalle técnico queda en logs del servidor. */
const CLIENT_MESSAGES: Record<string, { en: string; es: string }> = {
  STOREFRONT_DISABLED: {
    en: 'Online checkout from this bag is not available yet.',
    es: 'El pago en línea desde esta bolsa todavía no está disponible.',
  },
  STOREFRONT_NOT_AUTHORIZED: {
    en: 'Online checkout from this bag is not available yet.',
    es: 'El pago en línea desde esta bolsa todavía no está disponible.',
  },
  CREDENTIALS_MISSING: {
    en: 'Online checkout from this bag is not available yet.',
    es: 'El pago en línea desde esta bolsa todavía no está disponible.',
  },
  CATALOG_NOT_AUTHORIZED: {
    en: 'This menu cannot be used for online checkout yet.',
    es: 'Este menú todavía no se puede usar para pagar en línea.',
  },
  CATALOG_STALE: {
    en: 'The menu changed. Please review your bag.',
    es: 'El menú cambió. Revisa tu bolsa.',
  },
  CART_INVALID: {
    en: 'Some items in your bag are not available as selected.',
    es: 'Algunos productos de tu bolsa no están disponibles como los elegiste.',
  },
  ADDRESS_INVALID: {
    en: 'We could not verify the delivery address.',
    es: 'No pudimos verificar la dirección de entrega.',
  },
  STORE_NOT_MAPPED: {
    en: 'This location is not available for online checkout.',
    es: 'Esta sucursal no está disponible para pago en línea.',
  },
  PROVIDER_TIMEOUT: {
    en: 'Checkout took too long to respond. Your bag is saved; please try again.',
    es: 'El pago tardó demasiado en responder. Tu bolsa sigue guardada; intenta de nuevo.',
  },
  PROVIDER_ERROR: {
    en: 'Checkout is temporarily unavailable. Your bag is saved.',
    es: 'El pago no está disponible por ahora. Tu bolsa sigue guardada.',
  },
  INVALID_PROVIDER_RESPONSE: {
    en: 'Checkout is temporarily unavailable. Your bag is saved.',
    es: 'El pago no está disponible por ahora. Tu bolsa sigue guardada.',
  },
}

function clientMessage(code: string, lang: 'en' | 'es'): string {
  const m = CLIENT_MESSAGES[code] || CLIENT_MESSAGES.PROVIDER_ERROR
  return m[lang]
}

function pickLang(request: NextRequest): 'en' | 'es' {
  const h = (request.headers.get('accept-language') || '').toLowerCase()
  return h.startsWith('es') ? 'es' : 'en'
}

async function readJsonBody(
  request: NextRequest
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; code: string; message: string }> {
  const declared = Number(request.headers.get('content-length') || '0')
  if (declared > CHECKOUT_LIMITS.maxBodyBytes) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' }
  }
  const text = await request.text()
  if (text.length > CHECKOUT_LIMITS.maxBodyBytes) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' }
  }
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Invalid JSON' }
  }
}

function toDriveAddress(raw: unknown): DoorDashAddress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : '')
  const street = s(r.street, 120)
  const city = s(r.city, 60)
  const zip = s(r.zipCode ?? r.zip_code, 10)
  if (!street || !city || !/^\d{5}(-\d{4})?$/.test(zip)) return null
  return {
    street,
    city,
    state: 'CA',
    zip_code: zip,
    unit: s(r.aptSuite, 40) || undefined,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const lang = pickLang(request)
  try {
    const ip = getClientIp(request.headers)
    const authHeader = request.headers.get('authorization')?.trim() || ''
    const clientToken = request.headers.get('x-gavilan-client')?.trim() || ''

    let callerKey = `guest:${ip}`
    let isAuthenticatedUser = false

    if (authHeader) {
      const auth = await getAuthUser(request)
      if (!isAuthSuccess(auth)) {
        return jsonError(
          lang === 'es' ? 'Sesión inválida. Inicia sesión nuevamente.' : 'Invalid session. Please sign in again.',
          401,
          'AUTH_REQUIRED'
        )
      }
      callerKey = `user:${auth.userId}:${ip}`
      isAuthenticatedUser = true
    } else if (!clientToken || clientToken.length < 6 || clientToken.length > 64) {
      return jsonError(
        lang === 'es' ? 'Inicia sesión para continuar al pago.' : 'Please sign in to continue to checkout.',
        401,
        'AUTH_REQUIRED'
      )
    }

    const rl = checkRateLimit(`checkout-session:${callerKey}`, RATE_LIMIT_PER_MINUTE, 60_000)
    if (!rl.allowed) {
      return jsonError(
        lang === 'es' ? 'Demasiados intentos. Espera un momento.' : 'Too many attempts. Please wait a moment.',
        429,
        'RATE_LIMITED',
        { retryAfterSeconds: rl.retryAfterSeconds }
      )
    }

    const read = await readJsonBody(request)
    if (!read.ok) return jsonError(read.message, read.status, read.code)
    const body = read.body as Record<string, unknown> | null

    // ── Cotización Drive (sandbox; requiere usuario autenticado; no se usa en el checkout ni se muestra como cargo real) ──
    if (body && body.action === 'quote') {
      if (!isAuthenticatedUser) {
        return jsonError(
          lang === 'es' ? 'Autenticación requerida para cotización.' : 'Authentication required for quote.',
          401,
          'AUTH_REQUIRED'
        )
      }
      const storeId = typeof body.storeId === 'number' ? body.storeId : NaN
      const store = getDoorDashStoreMapping(storeId)
      const address = toDriveAddress(body.dropoffAddress)
      const phone = typeof body.dropoffPhoneNumber === 'string' ? body.dropoffPhoneNumber : ''
      if (!store || !address || !phone) {
        return jsonError('storeId, dropoffAddress y dropoffPhoneNumber válidos son requeridos', 400, 'VALIDATION_ERROR')
      }
      const quote = await quoteStoreDeliveryWithDoorDash({
        storeId: store.storeId,
        dropoffAddress: address,
        dropoffPhoneNumber: phone,
        orderValueCents: typeof body.orderValueCents === 'number' ? body.orderValueCents : 2500,
      })
      if (!quote.ok) {
        console.warn('[checkout-session] Drive quote failed')
        return jsonError('No fue posible cotizar la entrega.', 422, 'DRIVE_QUOTE_FAILED')
      }
      return jsonOk({
        environment: DOORDASH_DRIVE_ENVIRONMENT,
        isRealFee: DOORDASH_DRIVE_ENVIRONMENT === 'production',
        feeCents: Number(quote.feeCents ?? 0),
        currency: quote.currency || 'USD',
        estimatedDropoffTime: quote.estimatedDeliveryTime || null,
        storeId: store.storeId,
      })
    }

    // ── Sesión de checkout Storefront ──
    const parsed = parseCheckoutRequest(body)
    if (!parsed.ok) {
      return jsonError(
        lang === 'es' ? 'La bolsa tiene datos inválidos.' : 'Your bag has invalid data.',
        400,
        'VALIDATION_ERROR',
        { details: parsed.errors.slice(0, 20) }
      )
    }
    const req = parsed.value

    const now = Date.now()
    sweepIdempotency(now)
    const idemKey = `${callerKey}:${req.idempotencyKey}`
    const cached = idempotencyCache.get(idemKey)
    if (cached && cached.expiresAt > now) {
      return jsonOk({ ...cached.body, idempotentReplay: true })
    }

    const result = await createStorefrontOrderSession(req)
    if (!result.ok) {
      console.warn(
        `[checkout-session] ${result.code} store=${req.storeId} ft=${req.fulfillmentType}` +
          (result.providerStatus ? ` providerStatus=${result.providerStatus}` : '') +
          ` detail=${result.detail}`
      )
      return jsonError(clientMessage(result.code, lang), result.httpStatus, result.code, {
        retryable: result.code === 'PROVIDER_TIMEOUT' || result.code === 'PROVIDER_ERROR',
        ...(result.cartErrors ? { details: result.cartErrors } : {}),
      })
    }

    const responseBody: Record<string, unknown> = {
      mode: 'STOREFRONT_ORDER_SESSION',
      orderSessionId: result.orderSessionId,
      checkoutUrl: result.checkoutUrl,
      storeId: req.storeId,
      fulfillmentType: result.fulfillmentType,
      menuId: result.menuId,
    }
    idempotencyCache.set(idemKey, { expiresAt: now + IDEMPOTENCY_TTL_MS, body: responseBody })
    return jsonOk(responseBody)
  } catch (err: unknown) {
    console.error('[checkout-session] unexpected error:', err instanceof Error ? err.name : 'unknown')
    return jsonError(clientMessage('PROVIDER_ERROR', lang), 500, 'INTERNAL_ERROR')
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}
