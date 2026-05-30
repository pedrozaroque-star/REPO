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
// OPTIONS (Preflight CORS)
// ============================================================================
export async function OPTIONS() {
  return corsResponse()
}

// ============================================================================
// GET /api/mobile/order/status?orderId=X
// Consulta el estado actual de una orden móvil
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    // --- 1. AUTENTICACIÓN ---
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    // --- 2. OBTENER orderId DEL QUERY STRING ---
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')

    if (!orderId) {
      return jsonError('El parámetro orderId es requerido.', 400)
    }

    // --- 3. CONSULTAR ORDEN (incluye user_id para verificación de propiedad) ---
    const { data: order, error: orderError } = await supabaseAdmin
      .from('app_orders')
      .select(
        'id, user_id, status, total_amount, net_amount, tax_amount, discount_amount, items_json, pickup_method, curbside_stall, payment_status, payment_intent_id, user_latitude, user_longitude, eta_minutes, fired_at, created_at, updated_at'
      )
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return jsonError(`Orden ${orderId} no encontrada.`, 404)
    }

    // --- 4. VERIFICAR QUE LA ORDEN PERTENECE AL USUARIO AUTENTICADO ---
    if (order.user_id !== authResult.userId) {
      return jsonError('No autorizado para ver esta orden.', 403)
    }

    // --- 5. RESPUESTA (excluye user_id por seguridad) ---
    return jsonOk({
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        net_amount: order.net_amount,
        tax_amount: order.tax_amount,
        discount_amount: order.discount_amount,
        items_json: order.items_json,
        pickup_method: order.pickup_method,
        curbside_stall: order.curbside_stall,
        payment_status: order.payment_status,
        eta_minutes: order.eta_minutes,
        fired_at: order.fired_at,
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error interno desconocido'
    console.error('[MOBILE ORDER] Error crítico en consulta de estado:', message)
    return jsonError(message, 500)
  }
}
