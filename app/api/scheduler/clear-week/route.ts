/**
 * @module app/api/scheduler/clear-week/route
 * @description Limpia los turnos programados de una sucursal en el rango semanal especificado desde `/planificador`.
 *
 * @businessRules
 *   - Exige sesión autenticada (`verifyStaffAuth`) y validación estricta de alcance por sucursal (`authorizeStoreScope`),
 *     impidiendo que un gerente/asistente de una tienda borre turnos de otra sucursal.
 *
 * @dataFlow
 *   `/planificador` -> `POST /api/scheduler/clear-week` -> `authorizeStoreScope` -> `DELETE FROM shifts`.
 *
 * @notes
 *   - [2026-11-20] FIX CRÍTICO: Agregado `authorizeStoreScope` para bloquear borrado cruzado entre sucursales.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'

const CLEAR_WEEK_ROLES = [
    'admin',
    'supervisor',
    'manager',
    'gerente',
    'asistente',
    'assistant',
    'general_manager',
    'planificador',
]

export async function POST(req: NextRequest) {
    const auth = verifyStaffAuth(req, { allowedRoles: CLEAR_WEEK_ROLES, allowCron: false })
    if (!auth.authorized) return auth.response!

    try {
        const { storeId, startDate, endDate } = await req.json()

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()
        const userRole = (auth.user?.role || auth.user?.user_role || '').toLowerCase()
        const rawServerUser = await getServerUser(req)
        const serverUser = rawServerUser || {
            id: auth.user!.id,
            email: auth.user!.email,
            name: auth.user!.user_metadata?.full_name || auth.user!.email,
            role: userRole,
            store_id: auth.user!.user_metadata?.store_id,
            store_ids: auth.user!.user_metadata?.store_ids,
            store_scope: auth.user!.user_metadata?.store_scope,
        }
        const hasAssignedStore = Boolean(
            serverUser.store_id ||
            (Array.isArray(serverUser.store_ids) && serverUser.store_ids.length > 0) ||
            serverUser.store_scope
        )

        if (userRole !== 'planificador' || hasAssignedStore) {
            const scopeCheck = await authorizeStoreScope(serverUser, storeId, supabase, {
                requireWrite: true,
                action: 'publish_schedule',
            })
            if (!scopeCheck.authorized) {
                return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status })
            }
        }

        // Delete shifts in this range strictly for the authorized store
        const { error, count } = await supabase
            .from('shifts')
            .delete({ count: 'exact' })
            .eq('store_id', storeId)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)

        if (error) {
            console.error('Error clearing shifts:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, count })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
