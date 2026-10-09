/**
 * @module lib/toast/prices-client
 * @description Cliente autoritativo para Toast Orders /prices API (v2).
 * Responsable de solicitar a Toast el cálculo oficial y vinculante de precios, impuestos (sales tax),
 * cargos de servicio y total antes de la emisión de cualquier cotización pagable.
 * 
 * @businessRules
 * - Principio de Autoridad Financiera: Ningún cálculo local o tabla estática sustituye a Toast /prices.
 * - Si Toast /prices retorna HTTP 403 / code 10010 (bloqueo por scopes no autorizados en Partner Connect),
 *   el cliente clasifica el resultado como BLOCKED_EXTERNALLY sin inventar totales pagables.
 * - Toda orden pagable debe haber obtenido un quote_id derivado de Toast /prices.
 * 
 * @dataFlow
 * - Backend /api/mobile/order/quote -> calculateToastPrices() -> POST https://ws-api.toasttab.com/orders/v2/prices.
 * 
 * @notes
 * - Documentado conforme a los estándares de Toast Partner Connect.
 */

import { getAuthToken } from '../toast-api'
import {
  ToastPricesRequest,
  ToastPricesResponse,
  ToastExternalBlockedResult,
  TOAST_WRITE_BLOCKED_DESCRIPTOR
} from './menus-v3-contract'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export type CalculatePricesResult = 
  | { ok: true; data: ToastPricesResponse }
  | ToastExternalBlockedResult
  | {
      ok: false
      code: 'TOAST_TIMEOUT' | 'TOAST_API_ERROR' | 'TOAST_AUTH_ERROR' | 'TOAST_UNREACHABLE' | 'API_ERROR'
      httpStatus: number
      message: string
      details?: any
    }

/**
 * Invoca el endpoint oficial /orders/v2/prices de Toast.
 */
export async function calculateToastPrices(
  restaurantExternalId: string,
  requestPayload: {
    diningOptionGuid?: string
    selections: Array<{
      itemGuid: string
      quantity: number
      modifiers?: Array<{ guid: string; optionGroupGuid?: string }>
    }>
    deliveryAddress?: {
      streetAddress: string
      city: string
      state: string
      zipCode: string
      latitude?: number
      longitude?: number
    }
  }
): Promise<CalculatePricesResult> {
  try {
    const token = await getAuthToken()
    if (!token) {
      return {
        ok: false,
        code: 'TOAST_AUTH_ERROR',
        httpStatus: 401,
        message: 'No fue posible obtener el token de autenticación de Toast API.'
      }
    }

    const toastUrl = `${TOAST_API_HOST}/orders/v2/prices`

    // Formatear payload conforme a OpenAPI de Toast Orders v2
    const toastBody = {
      order: {
        diningOption: requestPayload.diningOptionGuid ? { guid: requestPayload.diningOptionGuid } : undefined,
        checks: [
          {
            selections: requestPayload.selections.map(sel => ({
              item: { guid: sel.itemGuid },
              quantity: sel.quantity,
              modifiers: (sel.modifiers || []).map(m => ({
                optionGroup: m.optionGroupGuid ? { guid: m.optionGroupGuid } : undefined,
                item: { guid: m.guid }
              }))
            }))
          }
        ]
      }
    }

    const response = await fetch(toastUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Toast-Restaurant-External-ID': restaurantExternalId
      },
      body: JSON.stringify(toastBody)
    })

    if (response.status === 403) {
      const errorJson = await response.json().catch(() => ({}))
      const toastCode = errorJson?.code || 10010
      return {
        ...TOAST_WRITE_BLOCKED_DESCRIPTOR,
        toastCode,
        message: errorJson?.message || TOAST_WRITE_BLOCKED_DESCRIPTOR.message
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      const isTimeout = response.status === 408 || response.status === 504
      return {
        ok: false,
        code: isTimeout ? 'TOAST_TIMEOUT' : 'TOAST_API_ERROR',
        httpStatus: response.status,
        message: `Error al cotizar con Toast /prices (HTTP ${response.status}): ${errorText}`
      }
    }

    const data = await response.json()

    // Normalizar respuesta autoritativa de Toast
    const check = data?.checks?.[0] || data
    const subtotal = Number(check?.subtotal || data?.subtotal || 0)
    const taxTotal = Number(check?.taxAmount || data?.taxAmount || 0)
    const serviceChargeTotal = Number(check?.serviceChargeAmount || 0)
    const deliveryFee = Number(check?.deliveryFeeAmount || 0)
    const discountTotal = Number(check?.discountAmount || 0)
    const tipTotal = Number(check?.tipAmount || 0)
    const total = Number(check?.totalAmount || data?.total || (subtotal + taxTotal + serviceChargeTotal + deliveryFee + tipTotal - discountTotal))

    return {
      ok: true,
      data: {
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        serviceChargeTotal: Math.round(serviceChargeTotal * 100) / 100,
        deliveryFee: Math.round(deliveryFee * 100) / 100,
        discountTotal: Math.round(discountTotal * 100) / 100,
        tipTotal: Math.round(tipTotal * 100) / 100,
        total: Math.round(total * 100) / 100,
        currency: 'USD',
        breakdown: (check?.selections || []).map((s: any) => ({
          itemGuid: s.item?.guid || '',
          name: s.item?.name || 'Artículo',
          quantity: s.quantity || 1,
          basePrice: Number(s.price || 0),
          modifierPriceTotal: Number(s.modifierTotal || 0),
          totalPrice: Number(s.total || 0)
        })),
        toastCalculatedAt: new Date().toISOString()
      }
    }
  } catch (error: any) {
    return {
      ok: false,
      code: 'TOAST_UNREACHABLE',
      httpStatus: 503,
      message: `Excepción de red al invocar Toast /prices: ${error?.message || 'Error de conectividad'}`
    }
  }
}
