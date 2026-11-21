/**
 * @module SyncPlannerAPI
 * @description Endpoint de API para sincronizar turnos de liderazgo publicados desde el Planificador (`shifts`)
 * hacia la tabla de Horarios de Supervisores (`schedules`).
 * 
 * @businessRules
 * 1. Sincroniza únicamente turnos en estado 'published'.
 * 2. Solo traslada turnos de Managers y Asistentes de Gerente, dejando los turnos de cocina/cajas en el Planificador.
 * 3. Soporta sincronización individual por tienda (`store_id`) o masiva (`store_id: 'all'`).
 * 
 * @dataFlow
 * - Invocado por: `/api/notifications/publish-schedule` tras publicar un horario, o por el botón de sincronización en `/horarios`.
 * - Ejecuta: `syncPlannerToSchedules` en `lib/sync-planner-to-schedules.ts`.
 *
 * @notes
 * - Protegido con `verifyStaffAuth` (`admin`, `supervisor`, `manager`, `planificador` o `CRON_SECRET`) y aislamiento por sucursal para gerentes.
 */

import { NextResponse } from 'next/server';
import { syncPlannerToSchedules } from '@/lib/sync-planner-to-schedules';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { verifyStaffAuth, getServerUser, authorizeStoreScope } from '@/lib/auth-server';

const SYNC_PLANNER_ROLES = ['admin', 'supervisor', 'manager', 'gerente', 'general_manager', 'planificador'];

export async function POST(req: Request) {
    try {
        const auth = await verifyStaffAuth(req, { allowedRoles: SYNC_PLANNER_ROLES, allowCron: true });
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
        }

        const body = await req.json();
        const { store_id, start_date, end_date } = body;

        if (!start_date || !end_date) {
            return NextResponse.json(
                { success: false, error: 'Campos requeridos: start_date y end_date (formato YYYY-MM-DD)' },
                { status: 400 }
            );
        }

        const supabase = await getSupabaseAdminClient();
        let effectiveTargetStore = store_id;

        if (auth.user) {
            const rawServerUser = await getServerUser(req);
            let effectiveRole = (rawServerUser?.role || auth.user.role || auth.user.user_role || '').toLowerCase();
            let effectiveStoreId = rawServerUser?.store_id ?? auth.user.user_metadata?.store_id ?? (auth.user as any)?.store_id;
            let effectiveScope = rawServerUser?.store_scope ?? auth.user.user_metadata?.store_scope;

            if (!effectiveStoreId && auth.user.email && !['admin', 'administrador', 'supervisor'].includes(effectiveRole)) {
                const { data: userProfile } = await supabase
                    .from('users')
                    .select('role, store_id, store_scope')
                    .ilike('email', auth.user.email)
                    .maybeSingle();
                if (userProfile) {
                    if (userProfile.role) effectiveRole = String(userProfile.role).trim().toLowerCase();
                    if (userProfile.store_id !== null && userProfile.store_id !== undefined) effectiveStoreId = userProfile.store_id;
                    if (userProfile.store_scope) effectiveScope = userProfile.store_scope;
                }
            }

            const isGlobalOrUnscopedPlanner =
                ['admin', 'administrador', 'supervisor'].includes(effectiveRole) ||
                (effectiveRole === 'planificador' && !effectiveStoreId);

            if (!isGlobalOrUnscopedPlanner) {
                const serverUser = {
                    id: rawServerUser?.id || auth.user.id,
                    email: rawServerUser?.email || auth.user.email,
                    name: rawServerUser?.name || auth.user.user_metadata?.full_name || auth.user.email,
                    role: effectiveRole,
                    store_id: effectiveStoreId,
                    store_ids: rawServerUser?.store_ids ?? auth.user.user_metadata?.store_ids,
                    store_scope: effectiveScope,
                };

                if (!effectiveTargetStore || String(effectiveTargetStore).toLowerCase() === 'all') {
                    if (!effectiveStoreId) {
                        return NextResponse.json(
                            { success: false, error: 'Acceso denegado: Tu cuenta no tiene una sucursal asignada.' },
                            { status: 403 }
                        );
                    }
                    effectiveTargetStore = effectiveStoreId;
                }

                const scopeCheck = await authorizeStoreScope(serverUser, effectiveTargetStore, supabase, {
                    action: 'publish_schedule',
                });
                if (!scopeCheck.authorized) {
                    return NextResponse.json({ success: false, error: scopeCheck.error }, { status: scopeCheck.status });
                }
            }
        }

        // Si se solicita sincronizar todas las tiendas
        if (effectiveTargetStore === 'all' || !effectiveTargetStore) {
            const { data: stores, error: storesErr } = await supabase
                .from('stores')
                .select('id, name, external_id')
                .order('name');

            if (storesErr) throw storesErr;

            const results = [];
            for (const st of stores || []) {
                try {
                    const res = await syncPlannerToSchedules({
                        storeExternalId: st.external_id,
                        storeNumericId: st.id,
                        startDate: start_date,
                        endDate: end_date,
                        customClient: supabase
                    });
                    results.push(res);
                } catch (storeError: any) {
                    results.push({
                        success: false,
                        storeId: st.id,
                        storeName: st.name,
                        syncedShiftsCount: 0,
                        leadershipUsersCount: 0,
                        details: storeError.message || 'Error sincronizando tienda'
                    });
                }
            }

            const totalSynced = results.reduce((sum, r) => sum + (r.syncedShiftsCount || 0), 0);
            return NextResponse.json({
                success: true,
                message: `Sincronizadas ${results.length} tiendas. Total turnos trasladados: ${totalSynced}`,
                totalSynced,
                results
            });
        }

        // Sincronización de tienda específica
        const isNumeric = !isNaN(Number(effectiveTargetStore));
        const syncRes = await syncPlannerToSchedules({
            storeExternalId: isNumeric ? undefined : String(effectiveTargetStore),
            storeNumericId: isNumeric ? Number(effectiveTargetStore) : undefined,
            startDate: start_date,
            endDate: end_date,
            customClient: supabase
        });

        return NextResponse.json({
            success: true,
            result: syncRes
        });

    } catch (e: any) {
        console.error('❌ [API /api/schedule/sync-planner] Error:', e);
        return NextResponse.json(
            { success: false, error: e.message || 'Error interno al sincronizar con el planificador' },
            { status: 500 }
        );
    }
}
