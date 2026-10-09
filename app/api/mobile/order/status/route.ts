/**
 * @module app/api/mobile/order/status/route
 * @description Endpoint autoritativo de consulta de estado para órdenes móviles de Tacos Gavilan.
 * Implementa la Máquina de Tres Estados (Kitchen Status, Payment Status, Delivery Status)
 * tanto para retiros en sucursal (Pickup) como para entregas a domicilio (Delivery vía DoorDash).
 * 
 * @businessRules
 * - Máquina de Tres Estados:
 *   1. Kitchen Status: Estado en POS/KDS ('HOLDING' | 'FIRED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED').
 *   2. Payment Status: Estado en pasarela Stripe ('PENDING' | 'PAID' | 'REFUNDED').
 *   3. Delivery/Pickup Status: Estado logístico de retiro o traslado según el canal.
 * - Seguridad y Aislamiento: El usuario solo puede consultar órdenes asociadas a su UUID autenticado.
 * - Cero Éxito Ficticio: Reporta fielmente el identificador toast_order_guid generado por Toast POS.
 * 
 * @dataFlow
 * - App Móvil GET /api/mobile/order/status?orderId=X (Bearer JWT) -> Consulta app_orders -> Formatea 3-State -> Retorna JSON.
 * 
 * @notes
 * - Soporta tanto canales PICKUP (mostrador / curbside) como DELIVERY (con DoorDash Drive tracking_url y dasher info).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsResponse,
  getAuthUser,
  isAuthSuccess,
  jsonOk,
  jsonError,
} from '@/app/api/mobile/_helpers'

export const dynamic = 'force-dynamic'

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Autenticación con Supabase Auth
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // 2. Obtener orderId del query string
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')

    if (!orderId) {
      return jsonError('El parámetro orderId es requerido.', 400)
    }

    // 3. Consultar orden completa desde app_orders
    const { data: order, error: orderError } = await supabaseAdmin
      .from('app_orders')
      .select(
        'id, user_id, store_id, toast_order_guid, status, total_amount, net_amount, tax_amount, discount_amount, items_json, pickup_method, curbside_stall, payment_status, payment_intent_id, user_latitude, user_longitude, eta_minutes, fired_at, created_at, updated_at'
      )
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return jsonError(`Orden ${orderId} no encontrada.`, 404)
    }

    // 4. Verificar autorización de propiedad
    if (order.user_id !== authResult.userId) {
      return jsonError('No autorizado para ver esta orden.', 403)
    }

    // 5. Determinar Canal (PICKUP vs DELIVERY)
    const itemsJsonObj = typeof order.items_json === 'object' && order.items_json !== null
      ? (order.items_json as Record<string, any>)
      : {}

    const isDelivery = itemsJsonObj.channel === 'DELIVERY' || order.curbside_stall === 'DOORDASH_DELIVERY'
    const channel: 'PICKUP' | 'DELIVERY' = isDelivery ? 'DELIVERY' : 'PICKUP'
    const deliveryAddress = itemsJsonObj.deliveryAddress || null

    // 6. Computar Máquina de Tres Estados
    const kitchenStatus = (order.status || 'HOLDING') as string
    const paymentStatus = (order.payment_status || 'PENDING') as string

    let deliveryStatus = 'NOT_APPLICABLE'
    if (channel === 'PICKUP') {
      switch (kitchenStatus) {
        case 'HOLDING':
        case 'FIRED':
        case 'PREPARING':
          deliveryStatus = 'AWAITING_ARRIVAL'
          break
        case 'READY':
          deliveryStatus = order.pickup_method === 'curbside' ? 'ARRIVED_AT_STALL' : 'READY_FOR_PICKUP'
          break
        case 'COMPLETED':
          deliveryStatus = 'HANDED_OFF'
          break
        case 'CANCELLED':
          deliveryStatus = 'CANCELLED'
          break
        default:
          deliveryStatus = 'AWAITING_ARRIVAL'
      }
    } else {
      // Canal DELIVERY (DoorDash Drive)
      switch (kitchenStatus) {
        case 'HOLDING':
          deliveryStatus = 'ORDER_PLACED'
          break
        case 'FIRED':
          deliveryStatus = 'DISPATCHING_DRIVER'
          break
        case 'PREPARING':
          deliveryStatus = 'DRIVER_ASSIGNED'
          break
        case 'READY':
          deliveryStatus = 'OUT_FOR_DELIVERY'
          break
        case 'COMPLETED':
          deliveryStatus = 'DELIVERED'
          break
        case 'CANCELLED':
          deliveryStatus = 'CANCELLED'
          break
        default:
          deliveryStatus = 'DISPATCHING_DRIVER'
      }
    }

    // 7. Formatear Orden con compatibilidad hacia atrás y adelante
    const formattedOrder = {
      id: order.id,
      storeId: order.store_id,
      toastOrderGuid: order.toast_order_guid || null,
      status: order.status,
      kitchenStatus,
      paymentStatus,
      deliveryStatus,
      channel,
      deliveryAddress,
      total_amount: Number(order.total_amount),
      net_amount: Number(order.net_amount),
      tax_amount: Number(order.tax_amount),
      discount_amount: Number(order.discount_amount),
      items_json: order.items_json,
      pickup_method: order.pickup_method,
      curbside_stall: order.curbside_stall,
      user_latitude: order.user_latitude,
      user_longitude: order.user_longitude,
      eta_minutes: order.eta_minutes,
      fired_at: order.fired_at,
      created_at: order.created_at,
      updated_at: order.updated_at,
    }

    return jsonOk({
      order: formattedOrder,
      data: formattedOrder,
      ...formattedOrder,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE ORDER STATUS] Error crítico en consulta de estado:', message)
    return jsonError(message, 500)
  }
}
