/**
 * @module app/api/mobile/order/curbside/check-in/route
 * @description Endpoint de confirmación de arribo y asignación de cajón de estacionamiento
 * para órdenes en modalidad 'Auto (Curbside)' de Tacos Gavilan.
 * 
 * @businessRules
 * - Notificación al Expeditor / Barra: Informa al personal de piso el número exacto de cajón
 *   (e.g., 'Cajón #3') y la descripción del vehículo para llevar la comanda empacada hasta el auto.
 * - Validación de Modalidad: Solo aplica para órdenes de retiro en sucursal con pickup_method = 'curbside'.
 * - Disparo Inmediato: Si la comanda se encontraba en 'HOLDING' (espera), el check-in manual en cajón
 *   la transiciona a 'FIRED' y activa la inyección a cocina de inmediato si aún no se había disparado.
 * 
 * @dataFlow
 * - App Móvil POST /api/mobile/order/curbside/check-in (Bearer JWT) -> app_orders (Supabase) ->
 *   Actualiza curbside_stall e items_json.curbsideArrival.
 * 
 * @notes
 * - curbside_stall se trunca a 20 caracteres para cumplir con la restricción de esquema VARCHAR(20) de Postgres.
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
import { injectOrderToToast } from '@/lib/toast-orders'

export const dynamic = 'force-dynamic'

interface CurbsideCheckInBody {
  orderId: string
  stallNumber: string
  vehicleDescription?: string
}

export async function OPTIONS(): Promise<NextResponse> {
  return corsResponse()
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Autenticación con Supabase Auth
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // 2. Parsear y validar body
    let body: CurbsideCheckInBody
    try {
      body = (await request.json()) as CurbsideCheckInBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { orderId, stallNumber, vehicleDescription } = body

    if (!orderId || typeof orderId !== 'string') {
      return jsonError('orderId es requerido.', 400)
    }

    if (!stallNumber || typeof stallNumber !== 'string' || !stallNumber.trim()) {
      return jsonError('stallNumber (número de cajón) es requerido.', 400)
    }

    // 3. Consultar la orden existente
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('app_orders')
      .select('id, user_id, store_id, status, pickup_method, items_json')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      return jsonError(`Orden ${orderId} no encontrada.`, 404)
    }

    if (order.user_id !== authResult.userId) {
      return jsonError('No autorizado para gestionar esta orden.', 403)
    }

    if (order.pickup_method !== 'curbside') {
      return jsonError('El check-in de cajón solo aplica para órdenes con modalidad Curbside (Auto).', 400)
    }

    // 4. Preparar payload de actualización
    const now = new Date().toISOString()
    const trimmedStall = stallNumber.trim()
    const safeStallColumn = trimmedStall.slice(0, 20) // Respetar VARCHAR(20)

    const currentItemsJson = typeof order.items_json === 'object' && order.items_json !== null
      ? (order.items_json as Record<string, any>)
      : {}

    const updatedCurbsideArrival = {
      arrivedAt: now,
      stallNumber: trimmedStall,
      vehicleDescription: vehicleDescription ? vehicleDescription.trim() : currentItemsJson.curbsideDetails || null,
    }

    const updatePayload: Record<string, unknown> = {
      curbside_stall: safeStallColumn,
      items_json: {
        ...currentItemsJson,
        curbsideArrival: updatedCurbsideArrival,
      },
      updated_at: now,
    }

    // Si la orden aún estaba en HOLDING, intentar dispararla inmediatamente a cocina Toast KDS
    let triggeredFire = false
    let toastInjected = false
    let toastOrderGuid: string | null = null
    let toastError: string | null = null

    if (order.status === 'HOLDING') {
      try {
        const toastRes = await injectOrderToToast(orderId)
        if (toastRes.ok && toastRes.toastOrderGuid) {
          toastInjected = true
          toastOrderGuid = toastRes.toastOrderGuid
          triggeredFire = true
          updatePayload.status = 'FIRED'
          updatePayload.fired_at = now
          updatePayload.toast_order_guid = toastOrderGuid
          console.log(`✅ [CURBSIDE CHECK-IN] Disparo Toast KDS exitoso -> GUID: ${toastOrderGuid}`)
        } else {
          toastError = toastRes.error || 'Toast POS no aceptó la orden'
          console.warn('[CURBSIDE CHECK-IN] Toast KDS no completado. La orden permanece en HOLDING:', toastError)
          // Regla estricta: NO cambiar estado a FIRED si Toast rechazó o falló
          updatePayload.status = 'HOLDING'
          updatePayload.items_json = {
            ...currentItemsJson,
            curbsideArrival: updatedCurbsideArrival,
            toastInjectionError: toastError,
            lastCurbsideAttemptAt: now,
          }
        }
      } catch (toastErr: unknown) {
        const msg = toastErr instanceof Error ? toastErr.message : 'Error al conectar con Toast'
        toastError = msg
        console.warn('[CURBSIDE CHECK-IN] Excepción inyectando orden a Toast POS:', toastError)
        updatePayload.status = 'HOLDING'
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from('app_orders')
      .update(updatePayload)
      .eq('id', orderId)

    if (updateErr) {
      console.error('[CURBSIDE CHECK-IN] Error actualizando app_orders:', updateErr)
      return jsonError('Error al registrar arribo en base de datos.', 500)
    }

    console.log(
      `🚗 [CURBSIDE CHECK-IN] Cliente arribó a ${trimmedStall} (${vehicleDescription || 'Vehículo registrado'}) para orden #${orderId.slice(0, 8)}`
    )

    const finalStatus = (updatePayload.status || order.status) as string

    return jsonOk({
      ok: true,
      arrived: true,
      stallNumber: trimmedStall,
      vehicleDescription: vehicleDescription || null,
      triggeredFire,
      status: finalStatus,
      toastInjected,
      toastOrderGuid,
      toastError,
      message: triggeredFire
        ? '¡Arribo registrado! Tu orden ha sido enviada a cocina.'
        : '¡Arribo registrado! Nuestro equipo llevará tu orden hasta tu vehículo en breve.',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al registrar check-in'
    console.error('[CURBSIDE CHECK-IN] Excepción crítica:', msg)
    return jsonError(msg, 500)
  }
}
