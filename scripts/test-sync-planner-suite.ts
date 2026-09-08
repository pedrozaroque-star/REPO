/**
 * @file test-sync-planner-suite.ts
 * @description Suite de pruebas automatizadas en tiempo real para la sincronización entre Planificador y Horarios.
 * Valida la lógica de negocio, mapeo relacional, conversiones de zona horaria y mutación real en Supabase.
 */

import { supabase } from '../lib/supabase';
import { syncPlannerToSchedules, formatToLATime, formatToLADate } from '../lib/sync-planner-to-schedules';

async function runSuite() {
    console.log('================================================================');
    console.log('🧪 SUITE DE PRUEBAS AUTOMATIZADAS: PLANIFICADOR -> HORARIOS');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition: boolean, msg: string) => {
        if (condition) {
            console.log(`✅ [PASS] ${msg}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${msg}`);
            failed++;
        }
    };

    // -------------------------------------------------------------
    // PRUEBA 1: Conversión de Horas UTC a California Local (PST/PDT)
    // -------------------------------------------------------------
    // 2026-09-07T16:00:00+00:00 en Los Ángeles (PDT, UTC-7) = 09:00 AM
    const time1 = formatToLATime('2026-09-07T16:00:00+00:00');
    assert(time1 === '09:00', `Conversión 16:00 UTC -> 09:00 PDT local (obtenido: ${time1})`);

    // 2026-09-08T01:00:00+00:00 en Los Ángeles (PDT, UTC-7) = 18:00 (6:00 PM)
    const time2 = formatToLATime('2026-09-08T01:00:00+00:00');
    assert(time2 === '18:00', `Conversión 01:00 UTC día sig. -> 18:00 PDT (obtenido: ${time2})`);

    // Horario ya en formato simple '08:00:00' o '08:00'
    const time3 = formatToLATime('08:00:00');
    assert(time3 === '08:00', `Formato simple '08:00:00' -> '08:00' (obtenido: ${time3})`);

    // -------------------------------------------------------------
    // PRUEBA 2: Conversión de Fechas UTC a Local
    // -------------------------------------------------------------
    const date1 = formatToLADate('2026-09-07T16:00:00+00:00');
    assert(date1 === '2026-09-07', `Extracción de fecha local '2026-09-07' (obtenido: ${date1})`);

    // -------------------------------------------------------------
    // PRUEBA 3: Consulta de Tiendas y Mapeo Relacional
    // -------------------------------------------------------------
    const { data: stores } = await supabase.from('stores').select('id, name, external_id').limit(1);
    assert(!!stores && stores.length > 0, `Tiendas accesibles en DB (ej: ${stores?.[0]?.name})`);

    const testStore = stores![0];

    // -------------------------------------------------------------
    // PRUEBA 4: Sincronización en Tienda Real con Rango Vacío
    // -------------------------------------------------------------
    const emptyRangeRes = await syncPlannerToSchedules({
        storeNumericId: testStore.id,
        startDate: '2099-01-05',
        endDate: '2099-01-11',
        customClient: supabase
    });
    assert(emptyRangeRes.success === true, `Sincronización en rango sin turnos no explota (éxito idempotente)`);

    // -------------------------------------------------------------
    // PRUEBA 5: MUTACIÓN REAL EN BASE DE DATOS (SMOKE TEST EN VIVO)
    // -------------------------------------------------------------
    console.log('\n--- 🔌 PROBANDO MUTACIÓN REAL EN SUPABASE (SMOKE TEST) ---');
    
    // Buscar un manager o asistente real de la tienda
    const { data: managerUser } = await supabase
        .from('users')
        .select('id, full_name, role, store_id, toast_guid')
        .eq('store_id', testStore.id)
        .eq('is_active', true)
        .in('role', ['manager', 'asistente'])
        .limit(1)
        .single();

    if (managerUser && managerUser.toast_guid) {
        const { data: matchedEmp } = await supabase
            .from('toast_employees')
            .select('id')
            .eq('toast_guid', managerUser.toast_guid)
            .single();

        if (matchedEmp) {
            const testDate = '2028-11-20'; // Lunes en el futuro para prueba aislada
            const testShiftId = '00000000-0000-0000-0000-000000009999';

            // 1. Insertar turno de prueba en `shifts`
            const { error: insShiftErr } = await supabase.from('shifts').insert({
                id: testShiftId,
                employee_id: matchedEmp.id,
                store_id: testStore.external_id,
                shift_date: testDate,
                start_time: `${testDate}T16:00:00+00:00`, // 09:00 AM local
                end_time: `${testDate}T23:59:00+00:00`,
                status: 'published'
            });

            assert(!insShiftErr, `Insertado turno de prueba en shifts para ${managerUser.full_name}`);

            // 2. Ejecutar syncPlannerToSchedules
            const syncLiveRes = await syncPlannerToSchedules({
                storeNumericId: testStore.id,
                startDate: testDate,
                endDate: '2028-11-26',
                customClient: supabase
            });

            assert(syncLiveRes.success === true, `syncPlannerToSchedules ejecutó correctamente`);
            assert(syncLiveRes.syncedShiftsCount > 0, `Turno de liderazgo fue detectado y trasladado a schedules (${syncLiveRes.syncedShiftsCount} turnos)`);

            // 3. Verificar que el turno exista en `schedules`
            const { data: syncedSchedule } = await supabase
                .from('schedules')
                .select('*')
                .eq('user_id', managerUser.id)
                .eq('date', testDate)
                .single();

            assert(!!syncedSchedule, `Turno existe en schedules con user_id=${managerUser.id} y date=${testDate}`);
            const expectedTime = formatToLATime(`${testDate}T16:00:00+00:00`);
            assert(syncedSchedule?.start_time?.slice(0, 5) === expectedTime, `Hora de entrada en schedules es ${expectedTime} (obtenido: ${syncedSchedule?.start_time})`);

            // 4. Limpieza (Cleanup) inmediata
            await supabase.from('schedules').delete().eq('user_id', managerUser.id).eq('date', testDate);
            await supabase.from('shifts').delete().eq('id', testShiftId);
            console.log('🧹 Limpieza completada: registros de prueba eliminados de schedules y shifts.');
            passed++;
        } else {
            console.log('⚠️ [SKIP] No se encontró toast_employee coincidente para prueba de mutación.');
        }
    } else {
        console.log('⚠️ [SKIP] Tienda sin manager con toast_guid para prueba de mutación.');
    }

    console.log('\n================================================================');
    console.log(`📊 RESULTADO FINAL: ${passed} PASADAS, ${failed} FALLIDAS`);
    console.log('================================================================\n');

    if (failed > 0) process.exit(1);
}

runSuite().catch(e => {
    console.error('Fatal error in test suite:', e);
    process.exit(1);
});
