/**
 * @module lib/toast/prices-client
 * @description Cliente autoritativo para Toast Orders API `/orders/v2/prices`.
 * Calcula subtotal, impuestos por jurisdicción, service charges, tarifas de entrega y total final
 * directamente desde el motor financiero de Toast POS, sin usar tasas estáticas locales.
 *
 * @businessRules
 * - Resuelve `diningOptionGuid` desde Toast Config API (`getDiningOptionsMap`) según sucursal y canal.
 * - Incluye `externalId` deterministas y `optionGroup` en modificadores cuando cuentan con UUID de Toast.
 * - Valida la respuesta de Toast mediante el validador runtime estricto `validateToastPricesResponsePayload`
 *   (prohibido usar `data?.checks?.[0] || data` con fallbacks silenciosos a `0`).
 * - Si faltan campos monetarios obligatorios o existen montos negativos/no finitos (`NaN`, `Infinity`),
 *   rechaza la respuesta con `TOAST_API_ERROR`.
 * - Si Toast devuelve `HTTP 403 / code 10010`, retorna `TOAST_SCOPE_BLOCKED` con `httpStatus`, `requestId` y `retryable: false`.
 *
 * @dataFlow
 * - POST /api/mobile/order/quote -> `calculateToastPrices` -> Toast POS `POST /orders/v2/prices`.
 *
 * @notes
 * - Exportado `validateToastPricesResponsePayload` para pruebas unitarias de rechazo de respuestas malformadas.
 */

import { getAuthToken } from '@/lib/toast-api'
import { getDiningOptionsMap } from '@/lib/toast-orders'
import {
  TOAST_WRITE_BLOCKED_DESCRIPTOR,
  UUID_REGEX,
  type FulfillmentChannel,
  type MobileApiErrorCode,
  type ToastWriteBlockedDescriptor,
} from './menus-v3-contract'

const TOAST_API_HOST =
  process.env.TOAST_API_HOSTNAME || 'https://ws-api.toasttab.com'

export interface ToastPriceSelectionInput {
  itemGuid: string
  quantity: number
  optionGroupGuid?: string
  externalId?: string
  modifiers?: Array<{
    guid: string
    optionGroupGuid?: string
    quantity?: number
    externalId?: string
  }>
}

export interface ToastPricesAuthoritativeResult {
  priceSource: 'toast_prices'
  subtotal: number
  taxTotal: number
  serviceChargeTotal: number
  deliveryFee: number
  tipTotal: number
  discountTotal: number
  totalAmount: number
  currency: 'USD'
  rawCheckGuid?: string
}

export type ToastPricesResponse =
  | {
      ok: true
      status: 'READY'
      code?: undefined
      httpStatus: number
      requestId: string | null
      retryable: false
      result: ToastPricesAuthoritativeResult
    }
  | {
      ok: false
      status: 'BLOCKED_EXTERNALLY'
      code: 'TOAST_SCOPE_BLOCKED'
      httpStatus: number
      requestId: string | null
      retryable: false
      blocked: ToastWriteBlockedDescriptor
    }
  | {
      ok: false
      status: 'API_ERROR'
      code: MobileApiErrorCode
      httpStatus: number
      requestId: string | null
      retryable: boolean
      error: string
    }

function isFiniteNonNegativeNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0
}

/**
 * Valida estrictamente en runtime la estructura devuelta por Toast `POST /orders/v2/prices`.
 * Rechaza objetos sin `checks[0]`, campos monetarios faltantes, `NaN`, `Infinity` o negativos.
 */
export function validateToastPricesResponsePayload(
  data: unknown,
  requestedTipAmount: number = 0
):
  | { valid: true; result: ToastPricesAuthoritativeResult }
  | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      error: 'Respuesta de Toast /prices inválida: el cuerpo no es un objeto JSON.',
    }
  }

  const record = data as Record<string, unknown>
  if (!Array.isArray(record.checks) || record.checks.length === 0) {
    return {
      valid: false,
      error: 'Respuesta de Toast /prices incompleta: falta el arreglo obligatorio checks[0].',
    }
  }

  const check = record.checks[0]
  if (!check || typeof check !== 'object') {
    return {
      valid: false,
      error: 'Respuesta de Toast /prices inválida: checks[0] no es un objeto válido.',
    }
  }

  const checkObj = check as Record<string, unknown>
  const rawNet = checkObj.netAmount ?? checkObj.subtotal ?? checkObj.amount
  const rawTax = checkObj.taxAmount
  const rawTotal = checkObj.totalAmount

  if (!isFiniteNonNegativeNumber(rawNet)) {
    return {
      valid: false,
      error: `Respuesta de Toast /prices inválida: subtotal/netAmount ausente o negativo (${String(rawNet)}).`,
    }
  }

  if (!isFiniteNonNegativeNumber(rawTax)) {
    return {
      valid: false,
      error: `Respuesta de Toast /prices inválida: taxAmount ausente o negativo (${String(rawTax)}).`,
    }
  }

  if (!isFiniteNonNegativeNumber(rawTotal)) {
    return {
      valid: false,
      error: `Respuesta de Toast /prices inválida: totalAmount ausente o negativo (${String(rawTotal)}).`,
    }
  }

  let serviceChargeTotal = 0
  if (checkObj.serviceCharges !== undefined) {
    if (!Array.isArray(checkObj.serviceCharges)) {
      return {
        valid: false,
        error: 'Respuesta de Toast /prices inválida: serviceCharges no es un arreglo.',
      }
    }
    for (const sc of checkObj.serviceCharges) {
      const amt = (sc as Record<string, unknown>)?.chargeAmount ?? (sc as Record<string, unknown>)?.amount ?? 0
      if (!isFiniteNonNegativeNumber(amt)) {
        return {
          valid: false,
          error: 'Respuesta de Toast /prices inválida: cargo por servicio negativo o no finito.',
        }
      }
      serviceChargeTotal += amt
    }
  }

  const deliveryFee =
    checkObj.deliveryFee !== undefined ? checkObj.deliveryFee : 0
  if (!isFiniteNonNegativeNumber(deliveryFee)) {
    return {
      valid: false,
      error: 'Respuesta de Toast /prices inválida: deliveryFee negativo o no finito.',
    }
  }

  const discountTotal =
    checkObj.discountAmount !== undefined ? checkObj.discountAmount : 0
  if (!isFiniteNonNegativeNumber(discountTotal)) {
    return {
      valid: false,
      error: 'Respuesta de Toast /prices inválida: discountAmount negativo o no finito.',
    }
  }

  const tipTotal = isFiniteNonNegativeNumber(requestedTipAmount)
    ? requestedTipAmount
    : 0

  return {
    valid: true,
    result: {
      priceSource: 'toast_prices',
      subtotal: Number(rawNet.toFixed(2)),
      taxTotal: Number(rawTax.toFixed(2)),
      serviceChargeTotal: Number(serviceChargeTotal.toFixed(2)),
      deliveryFee: Number(deliveryFee.toFixed(2)),
      tipTotal: Number(tipTotal.toFixed(2)),
      discountTotal: Number(discountTotal.toFixed(2)),
      totalAmount: Number((rawTotal + tipTotal).toFixed(2)),
      currency: 'USD',
      rawCheckGuid: typeof checkObj.guid === 'string' ? checkObj.guid : undefined,
    },
  }
}

/**
 * Resuelve el `diningOptionGuid` de Toast Config API para la sucursal y canal solicitados.
 */
export async function resolveDiningOptionGuidForChannel(
  token: string,
  restaurantGuid: string,
  channel: FulfillmentChannel
): Promise<string | undefined> {
  try {
    const map = await getDiningOptionsMap(token, restaurantGuid)
    const entries = Object.entries(map)
    if (entries.length === 0) return undefined

    if (channel === 'DELIVERY') {
      const deliveryMatch = entries.find(([, name]) =>
        name.toLowerCase().includes('delivery')
      )
      if (deliveryMatch) return deliveryMatch[0]
    } else {
      const pickupMatch = entries.find(([, name]) => {
        const n = name.toLowerCase()
        return (
          n.includes('take out') ||
          n.includes('takeout') ||
          n.includes('pickup') ||
          n.includes('to go') ||
          n.includes('llevar')
        )
      })
      if (pickupMatch) return pickupMatch[0]
    }

    return entries[0][0]
  } catch {
    return undefined
  }
}

export async function calculateToastPrices(
  restaurantGuid: string,
  requestPayload: {
    channel?: FulfillmentChannel
    diningOptionGuid?: string
    selections: ToastPriceSelectionInput[]
    tipAmount?: number
    orderExternalId?: string
    deliveryAddress?: {
      street: string
      city: string
      state: string
      zipCode: string
      latitude?: number
      longitude?: number
    }
  }
): Promise<ToastPricesResponse> {
  try {
    const token = await getAuthToken()
    if (!token) {
      return {
        ok: false,
        status: 'API_ERROR',
        code: 'TOAST_API_ERROR',
        httpStatus: 401,
        requestId: null,
        retryable: true,
        error: 'No se pudo obtener token OAuth de Toast POS.',
      }
    }
    const channel: FulfillmentChannel = requestPayload.channel || 'PICKUP'
    const resolvedDiningOptionGuid =
      requestPayload.diningOptionGuid ||
      (await resolveDiningOptionGuidForChannel(token, restaurantGuid, channel))

    const baseExternalId =
      requestPayload.orderExternalId || `teg-quote-${restaurantGuid.slice(0, 8)}`

    const toastBody: Record<string, unknown> = {
      entityType: 'Order',
      externalId: `${baseExternalId}:order`,
      diningOption: resolvedDiningOptionGuid
        ? { guid: resolvedDiningOptionGuid, entityType: 'DiningOption' }
        : undefined,
      deliveryInfo:
        channel === 'DELIVERY' && requestPayload.deliveryAddress
          ? {
              address1: requestPayload.deliveryAddress.street,
              city: requestPayload.deliveryAddress.city,
              state: requestPayload.deliveryAddress.state,
              zipCode: requestPayload.deliveryAddress.zipCode,
              latitude: requestPayload.deliveryAddress.latitude,
              longitude: requestPayload.deliveryAddress.longitude,
            }
          : undefined,
      checks: [
        {
          entityType: 'Check',
          externalId: `${baseExternalId}:check:0`,
          selections: requestPayload.selections.map((sel, selIdx) => ({
            entityType: 'MenuItemSelection',
            externalId: sel.externalId || `${baseExternalId}:sel:${selIdx}`,
            item: { guid: sel.itemGuid, entityType: 'MenuItem' },
            optionGroup:
              sel.optionGroupGuid && UUID_REGEX.test(sel.optionGroupGuid)
                ? { guid: sel.optionGroupGuid, entityType: 'MenuOptionGroup' }
                : undefined,
            quantity: sel.quantity,
            modifiers: (sel.modifiers || []).map((m, modIdx) => ({
              entityType: 'MenuItemSelection',
              externalId:
                m.externalId || `${baseExternalId}:sel:${selIdx}:mod:${modIdx}`,
              item: { guid: m.guid, entityType: 'MenuItem' },
              optionGroup:
                m.optionGroupGuid && UUID_REGEX.test(m.optionGroupGuid)
                  ? { guid: m.optionGroupGuid, entityType: 'MenuOptionGroup' }
                  : undefined,
              quantity: m.quantity || 1,
            })),
          })),
        },
      ],
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)

    let response: Response
    try {
      response = await fetch(`${TOAST_API_HOST}/orders/v2/prices`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': restaurantGuid,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toastBody),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const rawRequestId =
      response.headers.get('Toast-Request-Id') ||
      response.headers.get('x-request-id') ||
      null
    const sanitizedRequestId = rawRequestId
      ? rawRequestId.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64)
      : null

    if (response.status === 403) {
      let toastCode = 10010
      try {
        const errJson = await response.json()
        if (typeof errJson?.code === 'number') {
          toastCode = errJson.code
        }
      } catch {
        // Ignorar si el cuerpo no es JSON
      }

      return {
        ok: false,
        status: 'BLOCKED_EXTERNALLY',
        code: 'TOAST_SCOPE_BLOCKED',
        httpStatus: 403,
        requestId: sanitizedRequestId,
        retryable: false,
        blocked: {
          ...TOAST_WRITE_BLOCKED_DESCRIPTOR,
          toastCode,
          httpStatus: 403,
          requestId: sanitizedRequestId,
        },
      }
    }

    if (!response.ok) {
      const errText = await response.text()
      const isServerErr = response.status >= 500 || response.status === 429
      return {
        ok: false,
        status: 'API_ERROR',
        code: 'TOAST_API_ERROR',
        httpStatus: response.status,
        requestId: sanitizedRequestId,
        retryable: isServerErr,
        error: `Toast /orders/v2/prices respondió HTTP ${response.status}: ${errText.slice(0, 200)}`,
      }
    }

    const data: unknown = await response.json()
    const validated = validateToastPricesResponsePayload(
      data,
      requestPayload.tipAmount || 0
    )

    if (!validated.valid) {
      return {
        ok: false,
        status: 'API_ERROR',
        code: 'TOAST_API_ERROR',
        httpStatus: response.status,
        requestId: sanitizedRequestId,
        retryable: false,
        error: validated.error,
      }
    }

    return {
      ok: true,
      status: 'READY',
      httpStatus: response.status,
      requestId: sanitizedRequestId,
      retryable: false,
      result: validated.result,
    }
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
    const msg = err instanceof Error ? err.message : 'Error desconocido en Toast /prices'
    return {
      ok: false,
      status: 'API_ERROR',
      code: isAbort ? 'TOAST_TIMEOUT' : 'TOAST_API_ERROR',
      httpStatus: isAbort ? 504 : 502,
      requestId: null,
      retryable: true,
      error: msg,
    }
  }
}
