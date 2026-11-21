/**
 * @module SyncRonosAPI
 * @description Endpoint de API para sincronizar bajo demanda las ausencias oficiales (Enfermedad y Vacaciones)
 * desde RONOS hacia la matriz operativa de Horarios de Supervisores (`schedules`).
 *
 * @businessRules
 * 1. Extrae solicitudes aprobadas de PTO (Vacaciones) y días por enfermedad (Sick) de RONOS.
 * 2. Cruza con los empleados de liderazgo (Managers, Asistentes y Supervisores).
 * 3. Actualiza 'schedules' con turnos '00:00' - '00:00' y shift_label 'Enfermedad' | 'Vacaciones'.
 * 4. Las ausencias no cubren bloques operativos, alertando los semáforos de cobertura.
 *
 * @dataFlow
 * - Invocado por: Botón "Sincronizar RONOS" en `/horarios`.
 * - Ejecuta: `syncRonosAbsencesToSchedules` en `lib/sync-ronos-absences.ts`.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` (`admin`, `supervisor`, `manager`, `planificador` o `CRON_SECRET`).
 * - Omite el detalle individual de ausencias médicas/permisos de empleados en la respuesta HTTP pública, retornando únicamente conteos agregados.
 */

import { NextResponse } from 'next/server'
import { syncRonosAbsencesToSchedules } from '@/lib/sync-ronos-absences'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const SYNC_RONOS_ROLES = ['admin', 'supervisor', 'manager', 'gerente', 'general_manager', 'planificador']

export async function POST(req: Request) {
  try {
    const auth = await verifyStaffAuth(req, { allowedRoles: SYNC_RONOS_ROLES, allowCron: true })
    if (!auth.authorized) {
      return auth.response || NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Body vacío permitido
    }

    const { store_id, weeks_to_scan, start_date, end_date, force_refresh } = body

    let storeIdNum = store_id && store_id !== 'all' ? Number(store_id) : undefined

    if (auth.user) {
      const rawServerUser = await getServerUser(req)
      let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase()
      let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
      let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope

      if (!effectiveStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
        const { data: userProfile } = await supabaseAdmin
          .from('users')
          .select('role, store_id, store_scope')
          .ilike('email', auth.user.email)
          .maybeSingle()
        if (userProfile) {
          if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase()
          if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id
          if (userProfile.store_scope) effectiveScope = userProfile.store_scope
        }
      }

      const isGlobalOrUnscopedPlanner =
        ['admin', 'administrador', 'supervisor'].includes(effectiveRole) ||
        (effectiveRole === 'planificador' && !effectiveStoreId)

      if (!isGlobalOrUnscopedPlanner) {
        const serverUser = {
          id: rawServerUser?.id || auth.user.id,
          email: rawServerUser?.email || auth.user.email,
          name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
          role: effectiveRole,
          store_id: effectiveStoreId,
          store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
          store_scope: effectiveScope,
        }

        const requestedTarget = storeIdNum !== undefined ? storeIdNum : effectiveStoreId
        if (!requestedTarget) {
          return NextResponse.json(
            { success: false, error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada.' },
            { status: 403 }
          )
        }

        const scopeCheck = await authorizeStoreScope(serverUser, requestedTarget, supabaseAdmin, {
          action: 'publish_schedule',
        })
        if (!scopeCheck.authorized) {
          return NextResponse.json({ success: false, error: scopeCheck.error }, { status: scopeCheck.status })
        }
        storeIdNum = scopeCheck.resolvedStoreId ?? Number(requestedTarget)
      }
    }

    const result = await syncRonosAbsencesToSchedules({
      storeId: storeIdNum,
      startDate: start_date ? String(start_date) : undefined,
      endDate: end_date ? String(end_date) : undefined,
      weeksToScan: weeks_to_scan ? Math.min(Math.max(1, Number(weeks_to_scan)), 12) : 4,
      forceRefresh: Boolean(force_refresh)
    })

    return NextResponse.json({
      success: result.success,
      message: `Sincronización completada. ${result.totalAbsencesUpserted} ausencias actualizadas de RONOS.`,
      totalSynced: result.totalAbsencesUpserted,
      totalFound: result.totalAbsencesFound,
      totalScannedStores: result.totalScannedStores,
      durationMs: result.durationMs,
      errorCount: result.errors?.length || 0
    })
  } catch (e: any) {
    console.error('❌ [API /api/schedule/sync-ronos] Error:', e)
    return NextResponse.json(
      { success: false, error: e.message || 'Error interno al sincronizar ausencias de RONOS' },
      { status: 500 }
    )
  }
}
