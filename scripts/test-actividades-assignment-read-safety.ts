/**
 * @module TestActividadesAssignmentReadSafety
 * @description Simulación determinista de lectura paginada segura para asignaciones de ACTIVIDADES.
 * @businessRules Un rango solo puede usarse para guardar si cada página devuelve conteo exacto estable
 *   y la revisión de `station_assignments` no cambia durante el recorrido. Un rango vacío con conteo cero es válido.
 * @dataFlow Llama lógica pura de `lib/actividades-resolution.ts` con páginas y revisiones en memoria; no usa Supabase.
 * @notes Ejecutar con `npx tsx scripts/test-actividades-assignment-read-safety.ts`; no inserta, actualiza ni elimina datos.
 */

import assert from 'node:assert/strict';
import {
    fetchCompleteRangeAssignments,
    getBusinessDateLA,
    getShiftFromTime,
    isFreqMatch,
    normalizeText,
    toBusinessDayMinutes,
} from '../lib/actividades-resolution';

async function main() {
    const sevenRows = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
    const stableMultiPage = await fetchCompleteRangeAssignments({
        pageSize: 3,
        fetchPage: async (offset, limit) => ({ data: sevenRows.slice(offset, offset + limit), error: null, count: 7 }),
        fetchRevision: async () => ({ revision: '7:stable-fingerprint', error: null }),
    });
    assert.equal(stableMultiPage.isComplete, true);
    assert.deepEqual(stableMultiPage.data, sevenRows);
    assert.equal(stableMultiPage.pagesFetched, 3);

    const missingCount = await fetchCompleteRangeAssignments({
        pageSize: 3,
        fetchPage: async () => ({ data: [{ id: 1 }], error: null, count: null }),
    });
    assert.equal(missingCount.isComplete, false, 'count ausente nunca debe declararse completo');

    let countPage = 0;
    const changingCount = await fetchCompleteRangeAssignments({
        pageSize: 2,
        fetchPage: async () => ({ data: [{ id: ++countPage }], error: null, count: countPage === 1 ? 3 : 2 }),
    });
    assert.equal(changingCount.isComplete, false, 'count cambiante debe abortar');

    let revisionRead = 0;
    const changingRevision = await fetchCompleteRangeAssignments({
        pageSize: 2,
        fetchPage: async () => ({ data: [{ id: 1 }], error: null, count: 1 }),
        fetchRevision: async () => ({ revision: ++revisionRead === 1 ? '1:before' : '1:after', error: null }),
    });
    assert.equal(changingRevision.isComplete, false, 'revisión distinta antes/después debe abortar');

    const emptyRange = await fetchCompleteRangeAssignments({
        pageSize: 3,
        fetchPage: async () => ({ data: [], error: null, count: 0 }),
        fetchRevision: async () => ({ revision: '0:empty', error: null }),
    });
    assert.equal(emptyRange.isComplete, true, 'un rango realmente vacío debe seguir siendo válido');
    assert.deepEqual(emptyRange.data, []);

    const beforeSixLa = new Date('2026-10-21T12:59:00Z');
    const atSixLa = new Date('2026-10-21T13:00:00Z');
    assert.equal(getBusinessDateLA(beforeSixLa), '2026-10-20');
    assert.equal(getBusinessDateLA(atSixLa), '2026-10-21');
    assert.equal(getShiftFromTime('2026-10-21T12:59:00Z'), 'PM');
    assert.equal(getShiftFromTime('2026-10-21T13:00:00Z'), 'AM');
    assert.equal(toBusinessDayMinutes(5, 59), 1799);
    assert.equal(isFreqMatch('Miércoles', '2026-10-21'), true);
    assert.equal(normalizeText('Sábado'), normalizeText('Sabado'));
    assert.equal(Number.isFinite(0 / 0), false);
    assert.equal(Number.isFinite(1 / 0), false);

    console.log('PASS: paginación estable, count ausente/cambiante, revisión concurrente y rango vacío.');
    console.log('PASS: límites 5:59/6:00 AM en America/Los_Angeles, día de negocio, acentos y valores no finitos.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
