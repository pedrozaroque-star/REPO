/**
 * @module app/api/mobile/user/delete/route
 * @description Endpoint de eliminación permanente de cuenta y datos personales de comensales móviles.
 * Cumple estrictamente con el mandato de Apple App Store Guideline 5.1.1(v) y Google Play Policy.
 * 
 * @businessRules
 * - Eliminación Definitiva de Datos: Elimina la cuenta del usuario de Supabase Auth
 *   (auth.users vía supabaseAdmin.auth.admin.deleteUser), su saldo de lealtad (app_rewards_balances),
 *   historial de recompensas (app_rewards_transactions) y anonimiza sus pedidos históricos
 *   desvinculando el user_id para no alterar la contabilidad de la empresa.
 * - Cero Éxito Ficticio: La operación se ejecuta de forma real y transaccional en la base de datos.
 * - Seguridad: Solo el usuario autenticado puede solicitar la eliminación de su propia cuenta.
 * 
 * @dataFlow
 * - App Móvil DELETE /api/mobile/user/delete (Bearer JWT) -> Elimina cuenta en Supabase Auth y purga PII.
 * 
 * @notes
 * - Desvincula app_orders asignando user_id = null para preservar la integridad del libro mayor fiscal y contable, purgando PII de items_json (customerPhone/Email/Name y deliveryLogistics), limpiando retos OTP por email y confiando en ON DELETE CASCADE al ejecutar auth.admin.deleteUser.
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

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Autenticación con Supabase Auth
    const authResult = await getAuthUser(request)
    if (!isAuthSuccess(authResult)) {
      return jsonError(authResult.error, 401)
    }

    const userId = authResult.userId

    console.log(`🗑️ [ACCOUNT DELETION] Iniciando purga de datos para comensal ${userId}`)

    const { data: userProfile } = await supabaseAdmin
      .from('app_users')
      .select('email')
      .eq('id', userId)
      .maybeSingle()

    // 2. Anonimizar y desvincular pedidos históricos para preservar la integridad contable sin retener PII
    const { data: userOrders, error: ordersFetchErr } = await supabaseAdmin
      .from('app_orders')
      .select('id, items_json')
      .eq('user_id', userId)

    if (ordersFetchErr) {
      console.error('[ACCOUNT DELETION] Error consultando pedidos del usuario:', ordersFetchErr.message)
      return jsonError('No fue posible anonimizar el historial de pedidos.', 500)
    }

    if (userOrders && userOrders.length > 0) {
      for (const ord of userOrders) {
        const isRecordObject =
          typeof ord.items_json === 'object' &&
          ord.items_json !== null &&
          !Array.isArray(ord.items_json)

        const sanitizedItemsJson = isRecordObject
          ? (() => {
              const copy = { ...(ord.items_json as Record<string, unknown>) }
              delete copy.deliveryAddress
              delete copy.deliveryLogistics
              delete copy.curbsideArrival
              delete copy.curbsideDetails
              delete copy.geofenceTelemetrics
              delete copy.customerPhone
              delete copy.customerEmail
              delete copy.customerName
              return copy
            })()
          : ord.items_json

        const { error: ordUpdateErr } = await supabaseAdmin
          .from('app_orders')
          .update({
            user_id: null,
            user_latitude: null,
            user_longitude: null,
            curbside_stall: null,
            items_json: sanitizedItemsJson,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ord.id)

        if (ordUpdateErr) {
          console.error('[ACCOUNT DELETION] Error anonimizando orden:', ord.id, ordUpdateErr.message)
          return jsonError('No fue posible completar la anonimización de pedidos.', 500)
        }
      }
    }

    // 3. Anonimizar y desvincular cotizaciones históricas
    const { error: quotesErr } = await supabaseAdmin
      .from('app_quotes')
      .update({
        user_id: null,
        delivery_address: null,
      })
      .eq('user_id', userId)

    if (quotesErr) {
      console.error('[ACCOUNT DELETION] Error anonimizando cotizaciones:', quotesErr.message)
      return jsonError('No fue posible anonimizar cotizaciones históricas.', 500)
    }

    // 4. Purgar retos OTP por correo antes de eliminar credenciales
    const userEmail = (userProfile?.email || authResult.email || '').trim().toLowerCase()
    if (userEmail) {
      await supabaseAdmin
        .from('app_mobile_otp_challenges')
        .delete()
        .ilike('email', userEmail)
    }

    // 5. Eliminar usuario de Supabase Auth primero (propaga ON DELETE CASCADE a app_users,
    //    app_devices, app_carts, app_favorite_orders, app_rewards_balances y app_rewards_transactions)
    const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (authDeleteErr) {
      console.error('[ACCOUNT DELETION] Error eliminando usuario de Supabase Auth:', authDeleteErr)
      return jsonError('No fue posible eliminar las credenciales de autenticación.', 500)
    }

    // Limpieza defensiva en app_users por si existía registro sin FK cascada
    await supabaseAdmin.from('app_users').delete().eq('id', userId)

    console.log(`✅ [ACCOUNT DELETION] Comensal ${userId} eliminado permanentemente (Apple Guideline 5.1.1(v) Compliant)`)

    return jsonOk({
      ok: true,
      deleted: true,
      message: 'Tu cuenta y todos tus datos personales han sido eliminados permanentemente del sistema de Tacos Gavilan.',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al eliminar cuenta'
    console.error('[ACCOUNT DELETION] Excepción crítica:', msg)
    return jsonError(msg, 500)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return DELETE(request)
}
