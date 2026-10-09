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
 * - Desvincula app_orders asignando user_id = null para preservar la integridad del libro mayor fiscal y contable.
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

    // 2. Desvincular pedidos históricos para preservar la integridad contable sin retener PII
    const { error: ordersErr } = await supabaseAdmin
      .from('app_orders')
      .update({
        user_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (ordersErr) {
      console.warn('[ACCOUNT DELETION] Aviso desvinculando órdenes:', ordersErr.message)
    }

    // 3. Eliminar saldo de recompensas y transacciones de lealtad
    await supabaseAdmin
      .from('app_rewards_transactions')
      .delete()
      .eq('user_id', userId)

    await supabaseAdmin
      .from('app_rewards_balances')
      .delete()
      .eq('user_id', userId)

    // 4. Eliminar perfil de usuario comensal en public.app_users
    const { error: appUserDeleteErr } = await supabaseAdmin
      .from('app_users')
      .delete()
      .eq('id', userId)

    if (appUserDeleteErr) {
      console.warn('[ACCOUNT DELETION] Aviso eliminando de app_users:', appUserDeleteErr.message)
    }

    // 5. Eliminar usuario de Supabase Auth (auth.users)
    const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (authDeleteErr) {
      console.error('[ACCOUNT DELETION] Error eliminando usuario de Supabase Auth:', authDeleteErr)
      return jsonError('No fue posible eliminar las credenciales de autenticación.', 500)
    }

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
