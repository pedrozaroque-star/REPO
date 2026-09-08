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
 */

import { NextResponse } from 'next/server';
import { syncPlannerToSchedules } from '@/lib/sync-planner-to-schedules';
import { getSupabaseClient } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { store_id, start_date, end_date } = body;

        if (!start_date || !end_date) {
            return NextResponse.json(
                { success: false, error: 'Campos requeridos: start_date y end_date (formato YYYY-MM-DD)' },
                { status: 400 }
            );
        }

        const supabase = await getSupabaseClient();

        // Si se solicita sincronizar todas las tiendas
        if (store_id === 'all' || !store_id) {
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
        const isNumeric = !isNaN(Number(store_id));
        const syncRes = await syncPlannerToSchedules({
            storeExternalId: isNumeric ? undefined : String(store_id),
            storeNumericId: isNumeric ? Number(store_id) : undefined,
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
