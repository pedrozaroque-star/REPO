import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  corsResponse,
  getAuthUser,
  isAuthSuccess,
  jsonOk,
  jsonError,
} from '@/app/api/mobile/_helpers'

export const dynamic = 'force-dynamic'

// ============================================================================
// CONSTANTES — Geofencing
// ============================================================================

/** Radio de la Tierra en millas para la fórmula de Haversine */
const EARTH_RADIUS_MILES = 3959

/** Velocidad promedio de manejo en zona urbana LA (mph) */
const AVG_DRIVING_SPEED_MPH = 25

/** Umbral de ETA en minutos para disparar la orden automáticamente */
const FIRE_ETA_THRESHOLD_MINUTES = 4

// ============================================================================
// Helper: Fórmula de Haversine — calcula distancia entre 2 coordenadas
// ============================================================================

/** Convierte grados a radianes */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Calcula la distancia entre dos puntos geográficos usando la fórmula de Haversine.
 * d = 2 * R * arcsin(sqrt(sin²(Δlat/2) + cos(lat1)*cos(lat2)*sin²(Δlng/2)))
 *
 * @returns Distancia en millas
 */
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

// ============================================================================
// Tipo de entrada
// ============================================================================

interface GeofenceUpdateBody {
  orderId: string
  latitude: number
  longitude: number
  deviceEtaMinutes?: number // ETA reportado por el dispositivo (Google Maps, etc.)
}

// ============================================================================
// OPTIONS (Preflight CORS)
// ============================================================================
export async function OPTIONS() {
  return corsResponse()
}

// ============================================================================
// POST /api/mobile/order/geofence/update
// Actualiza la ubicación del usuario y evalúa si debe disparar la orden
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    // --- 1. AUTENTICACIÓN ---
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // --- 2. PARSEAR BODY ---
    let body: GeofenceUpdateBody
    try {
      body = (await request.json()) as GeofenceUpdateBody
    } catch {
      return jsonError('JSON inválido en el cuerpo de la petición.', 400)
    }

    const { orderId, latitude, longitude, deviceEtaMinutes } = body

    // Validaciones
    if (!orderId || typeof orderId !== 'string') {
      return jsonError('orderId es requerido.', 400)
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return jsonError('latitude y longitude son requeridos y deben ser numéricos.', 400)
    }

    // --- 3. OBTENER LA ORDEN ---
    const { data: order, error: orderError } = await supabaseAdmin
      .from('app_orders')
      .select('id, store_id, status, user_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return jsonError(`Orden ${orderId} no encontrada.`, 404)
    }

    // Verificar que la orden pertenece al usuario autenticado
    if (order.user_id !== authResult.userId) {
      return jsonError('No autorizado para actualizar esta orden.', 403)
    }

    // --- 4. OBTENER COORDENADAS DE LA TIENDA ---
    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, name, latitude, longitude')
      .eq('id', order.store_id)
      .single()

    if (storeError || !store) {
      console.error('[MOBILE ORDER] Tienda no encontrada para geofence:', storeError)
      return jsonError('Tienda asociada a la orden no encontrada.', 404)
    }

    if (store.latitude == null || store.longitude == null) {
      console.error(`[MOBILE ORDER] Tienda ${store.id} (${store.name}) sin coordenadas configuradas.`)
      return jsonError('La tienda no tiene coordenadas configuradas para geofencing.', 500)
    }

    // --- 5. CALCULAR DISTANCIA Y ETA ---
    const distanceMiles = haversineDistance(
      latitude,
      longitude,
      Number(store.latitude),
      Number(store.longitude)
    )
    const distanceRounded = Number(distanceMiles.toFixed(2))

    // ETA calculado: distancia / velocidad * 60 (convertir horas a minutos)
    const calculatedEtaMinutes = (distanceMiles / AVG_DRIVING_SPEED_MPH) * 60

    // Usar el MÍNIMO entre ETA calculado y ETA del dispositivo (si se proporcionó)
    let finalEta: number
    if (deviceEtaMinutes != null && typeof deviceEtaMinutes === 'number' && deviceEtaMinutes > 0) {
      finalEta = Math.min(calculatedEtaMinutes, deviceEtaMinutes)
    } else {
      finalEta = calculatedEtaMinutes
    }
    finalEta = Number(finalEta.toFixed(1))

    // --- 6. ACTUALIZAR ORDEN CON UBICACIÓN Y ETA ---
    const updatePayload: Record<string, unknown> = {
      user_latitude: latitude,
      user_longitude: longitude,
      eta_minutes: finalEta,
      updated_at: new Date().toISOString(),
    }

    // --- 7. EVALUAR SI DEBE DISPARAR LA ORDEN (FIRE) ---
    // Solo dispara si ETA <= 4 minutos Y la orden está en estado HOLDING
    let firedAt: string | null = null
    if (finalEta <= FIRE_ETA_THRESHOLD_MINUTES && order.status === 'HOLDING') {
      const fireTimestamp = new Date().toISOString()
      updatePayload.status = 'FIRED'
      updatePayload.fired_at = fireTimestamp
      firedAt = fireTimestamp
      console.log(
        `🔥 [MOBILE ORDER] Orden ${orderId} FIRED — ETA: ${finalEta} min — Distancia: ${distanceRounded} mi`
      )
    }

    const { error: updateError } = await supabaseAdmin
      .from('app_orders')
      .update(updatePayload)
      .eq('id', orderId)

    if (updateError) {
      console.error('[MOBILE ORDER] Error actualizando geofence:', updateError)
      return jsonError('Error al actualizar la ubicación de la orden.', 500)
    }

    // --- 8. RESPUESTA ---
    const currentStatus = firedAt ? 'FIRED' : (order.status as string)

    return jsonOk({
      status: currentStatus,
      eta: finalEta,
      distance: distanceRounded,
      firedAt: firedAt,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE ORDER] Error crítico en geofence update:', message)
    return jsonError(message, 500)
  }
}
