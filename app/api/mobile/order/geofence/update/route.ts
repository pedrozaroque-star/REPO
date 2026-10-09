/**
 * @module app/api/mobile/order/geofence/update/route
 * @description Endpoint de actualización de telemetría GPS y disparo de cocción (Geofencing Just-in-Time)
 * para órdenes de retiro en sucursal (Pickup) de Tacos Gavilan.
 * 
 * @businessRules
 * - Cocción Just-in-Time: Las carnes de Tacos Gavilan (asada al carbón, pastor en trompo) se preparan
 *   para garantizar máxima frescura y temperatura. La orden se mantiene en estado 'HOLDING' hasta que
 *   el cliente se encuentra a un tiempo estimado de llegada (ETA) menor o igual a 4 minutos.
 * - Disparo a Cocina (FIRE): Al cruzar el umbral de 4 minutos, la orden transiciona a 'FIRED' e invoca
 *   inmediatamente la inyección a Toast POS / KDS vía injectOrderToToast.
 * - Cero Éxito Ficticio: Si Toast POS rechaza la inyección, se registra el error real y jamás se inventa
 *   un GUID simulado.
 * 
 * @dataFlow
 * - App Móvil POST /api/mobile/order/geofence/update (Bearer JWT) -> Haversine calculation ->
 *   Evalúa ETA <= 4 min -> injectOrderToToast(orderId) -> app_orders.
 * 
 * @notes
 * - Almacena snapshot de telemetría GPS (latitud, longitud, velocidad y ETA calculada) en app_orders.items_json.geofenceTelemetrics.
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

/** Radio de la Tierra en millas para la fórmula de Haversine */
const EARTH_RADIUS_MILES = 3959

/** Velocidad promedio de manejo en zona urbana de Los Ángeles (mph) */
const AVG_DRIVING_SPEED_MPH = 25

/** Umbral de ETA en minutos para disparar la orden automáticamente a cocina */
const FIRE_ETA_THRESHOLD_MINUTES = 4

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const lat1Rad = toRadians(lat1)
  const lat2Rad = toRadians(lat2)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.asin(Math.sqrt(a))
  return EARTH_RADIUS_MILES * c
}

interface GeofenceUpdateBody {
  orderId: string
  latitude: number
  longitude: number
  deviceEtaMinutes?: number
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
    let body: GeofenceUpdateBody
    try {
      body = (await request.json()) as GeofenceUpdateBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { orderId, latitude, longitude, deviceEtaMinutes } = body

    if (!orderId || typeof orderId !== 'string') {
      return jsonError('orderId es requerido.', 400)
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return jsonError('latitude y longitude son requeridos y deben ser numéricos.', 400)
    }

    // 3. Obtener la orden de la base de datos
    const { data: order, error: orderError } = await supabaseAdmin
      .from('app_orders')
      .select('id, store_id, status, user_id, pickup_method, curbside_stall, items_json')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return jsonError(`Orden ${orderId} no encontrada.`, 404)
    }

    if (order.user_id !== authResult.userId) {
      return jsonError('No autorizado para actualizar esta orden.', 403)
    }

    // 4. Obtener coordenadas de la sucursal
    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, name, latitude, longitude')
      .eq('id', order.store_id)
      .single()

    if (storeError || !store) {
      return jsonError('Tienda asociada a la orden no encontrada.', 404)
    }

    if (store.latitude == null || store.longitude == null) {
      return jsonError('La tienda no tiene coordenadas configuradas para geofencing.', 500)
    }

    // 5. Calcular Distancia y ETA
    const distanceMiles = haversineDistance(
      latitude,
      longitude,
      Number(store.latitude),
      Number(store.longitude)
    )
    const distanceRounded = Number(distanceMiles.toFixed(2))

    const calculatedEtaMinutes = (distanceMiles / AVG_DRIVING_SPEED_MPH) * 60
    let finalEta: number
    if (deviceEtaMinutes != null && typeof deviceEtaMinutes === 'number' && deviceEtaMinutes > 0) {
      finalEta = Math.min(calculatedEtaMinutes, deviceEtaMinutes)
    } else {
      finalEta = calculatedEtaMinutes
    }
    finalEta = Number(finalEta.toFixed(1))

    // 6. Preparar payload de actualización
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      user_latitude: latitude,
      user_longitude: longitude,
      eta_minutes: finalEta,
      updated_at: now,
    }

    // 7. Evaluar si debe disparar la orden a cocina (FIRE)
    let firedAt: string | null = null
    let toastInjected = false
    let toastOrderGuid: string | null = null
    let toastError: string | null = null

    if (finalEta <= FIRE_ETA_THRESHOLD_MINUTES && order.status === 'HOLDING') {
      console.log(
        `🔥 [GEOFENCE FIRE] Evaluando disparo a cocina para orden ${orderId} en ${store.name} — ETA: ${finalEta} min — Distancia: ${distanceRounded} mi`
      )

      // Inyección autoritativa al POS/KDS de Toast
      try {
        const toastResult = await injectOrderToToast(orderId)
        if (toastResult.ok && toastResult.toastOrderGuid) {
          toastInjected = true
          toastOrderGuid = toastResult.toastOrderGuid
          firedAt = now
          updatePayload.status = 'FIRED'
          updatePayload.fired_at = firedAt
          updatePayload.toast_order_guid = toastOrderGuid
          console.log(`✅ [GEOFENCE FIRE] Despacho Toast KDS exitoso -> GUID: ${toastOrderGuid}`)
        } else {
          toastError = toastResult.error || 'Toast POS no aceptó el pedido'
          console.warn(`⚠️ [GEOFENCE FIRE] Despacho Toast KDS no completado. La orden permanece en HOLDING:`, toastError)
          // Regla estricta: NO cambiar estado a FIRED si Toast falló; mantener en HOLDING
          updatePayload.status = 'HOLDING'
          const currentItems = typeof order.items_json === 'object' && order.items_json !== null
            ? (order.items_json as Record<string, any>)
            : {}
          updatePayload.items_json = {
            ...currentItems,
            toastInjectionError: toastError,
            lastGeofenceAttemptAt: now,
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al conectar con Toast'
        toastError = msg
        console.error(`❌ [GEOFENCE FIRE] Excepción al invocar Toast KDS:`, toastError)
        updatePayload.status = 'HOLDING'
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('app_orders')
      .update(updatePayload)
      .eq('id', orderId)

    if (updateError) {
      console.error('[GEOFENCE UPDATE] Error actualizando orden en DB:', updateError)
      return jsonError('Error al actualizar la ubicación de la orden.', 500)
    }

    const currentStatus = (updatePayload.status || order.status) as string

    return jsonOk({
      status: currentStatus,
      eta: finalEta,
      distance: distanceRounded,
      firedAt,
      toastInjected,
      toastOrderGuid,
      toastError,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[GEOFENCE UPDATE] Excepción crítica:', message)
    return jsonError(message, 500)
  }
}
