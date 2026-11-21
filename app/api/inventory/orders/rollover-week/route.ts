/**
 * @module api/inventory/orders/rollover-week
 * @description API route para ejecutar el cierre/rollover de semana.
 *              Equivalente al macro `cambiarNombre()` del Google Sheets.
 *
 * @businessRules
 * - Solo se puede cerrar la semana si TODOS los items tienen sobrante del Domingo
 * - Al cerrar: clona las bases de la semana actual a la nueva semana
 * - Recalcula el PAR Ideal con el promedio de las últimas 8 semanas
 * - No se puede cerrar una semana futura
 *
 * @dataFlow
 * - Lee inventory_items (con excel_reference) para saber cuáles participan
 * - Lee inventory_counts del domingo para validar completitud
 * - Clona inventory_weekly_bases → nueva semana
 * - Recalcula inventory_par_ideal con promedio histórico
 *
 * @notes
 * - [2026-06-24] Implementación inicial.
 * - Blindaje Fail-Closed (`verifyStaffAuth` + `authorizeStoreScope`): restringido a `admin`, `supervisor`, `manager` (o `CRON_SECRET`) con alcance estricto por sucursal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeWeekRollover } from '@/app/inventory/orders/actions'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'

const ROLLOVER_ROLES = ['admin', 'supervisor', 'manager', 'gerente', 'general_manager']

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ROLLOVER_ROLES, allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const body = await request.json()
        const { storeId, currentMonday } = body

        if (!storeId || !currentMonday) {
            return NextResponse.json(
                { error: 'storeId y currentMonday son requeridos' },
                { status: 400 }
            )
        }

        // Validar formato de fecha
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(currentMonday)) {
            return NextResponse.json(
                { error: 'Formato de fecha inválido. Use YYYY-MM-DD.' },
                { status: 400 }
            )
        }

        if (auth.user && String(storeId).toLowerCase() !== 'all') {
            const supabase = await getSupabaseAdminClient()
            const rawServerUser = await getServerUser(request)
            let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase()
            let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id
            let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope

            if (!effectiveStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
                const { data: userProfile } = await supabase
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

            const serverUser = {
                id: rawServerUser?.id || auth.user.id,
                email: rawServerUser?.email || auth.user.email,
                name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
                role: effectiveRole === 'administrador' ? 'admin' : effectiveRole,
                store_id: effectiveStoreId,
                store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                store_scope: effectiveScope,
            }

            const scopeCheck = await authorizeStoreScope(serverUser, storeId, supabase, {
                requireWrite: true,
                allowedRoles: ROLLOVER_ROLES,
            })
            if (!scopeCheck.authorized) {
                return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
            }
        } else if (auth.user && String(storeId).toLowerCase() === 'all') {
            const roleLower = (auth.user.role || auth.user.user_role || '').toLowerCase()
            if (!['admin', 'administrador', 'supervisor'].includes(roleLower)) {
                return NextResponse.json(
                    { error: 'Acceso denegado: No tienes permisos globales para cerrar la semana en todas las sucursales.' },
                    { status: 403 }
                )
            }
        }

        const result = await executeWeekRollover(storeId, currentMonday)

        if (result.error) {
            return NextResponse.json(
                { error: result.error, missingCount: (result as any).missingCount },
                { status: 400 }
            )
        }

        return NextResponse.json({
            success: true,
            nextMonday: result.nextMonday,
            message: 'Semana cerrada exitosamente'
        })

    } catch (error: any) {
        console.error('[Rollover] Error:', error)
        return NextResponse.json(
            { error: error.message || 'Error al cerrar la semana' },
            { status: 500 }
        )
    }
}
