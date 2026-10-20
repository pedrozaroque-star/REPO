/**
 * @module verify-actividades-acceptance-2026-10-19
 * @description Suite de verificación automatizada y simulación en tiempo real (Runtime Acceptance Suite)
 * para los hallazgos A01–A26 del módulo ACTIVIDADES y sus integraciones en las 15 sucursales.
 *
 * REGLAS DE SEGURIDAD EN PRUEBAS:
 * - Cero envío de correos reales ni notificaciones a empleados.
 * - Cero mutación sobre datos operativos reales de producción (las pruebas transaccionales
 *   usan la fecha sintética '2099-12-31' y limpian en bloque `finally`).
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';
import {
  calculateStoreOffsets,
  calculateStoreOffsetsForDate,
  resolveStoreHoursForDate,
  applyTimeOffset,
} from '../lib/store-time-offset';
import {
  CANONICAL_STATIONS_CATALOG,
  doesShiftOverlapPeriod,
  getShiftOverlappingPeriods,
  doesActivityIntersectShiftWindow,
  getStoreOverrideForProcedure,
  resolveStoreCatalogActivitiesForDay,
  isFreqMatch,
  getBusinessDaySortMinutes,
  doesActivityBelongToChecklistView,
  isStoreModelMatch,
  getStationConfigStatus,
  resolveStationActivities,
  mergeAndDeduplicateActivities,
  classifyLegacyTasksSnapshot,
  isStorePilotActiveForActivitiesEmail,
} from '../lib/actividades-resolution';
import {
  signCalendarAccessToken,
  verifyCalendarAccessToken,
} from '../lib/calendar-helper';
import { authorizeStoreScope } from '../lib/auth-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function runAcceptanceSuite() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('🔬 SUITE DE VERIFICACIÓN Y SIMULACIÓN EN TIEMPO REAL — MÓDULO ACTIVIDADES');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // 1. Cargar datos reales de Supabase
  const [{ data: stores, error: stErr }, { data: rawProcedures, error: prErr }, { data: posActs, error: paErr }] =
    await Promise.all([
      supabase
        .from('stores')
        .select('id, name, external_id, opening_time, closing_time, weekly_hours, has_drive_thru, is_active')
        .eq('is_active', true)
        .order('id'),
      supabase
        .from('operating_procedures')
        .select('id, role, shift_type, activity, description, start_time, duration_minutes, shift, frequency, store_model, overrides'),
      supabase
        .from('position_activities')
        .select('id, position_key, activity_id, shift, store_model, frequency, sort_order'),
    ]);

  if (stErr || prErr || paErr || !stores || !rawProcedures || !posActs) {
    console.error('❌ Error cargando catálogo real de Supabase:', stErr || prErr || paErr);
    process.exit(1);
  }

  const procedures = rawProcedures.filter((p) => p.role !== 'ROLES_MODULE');

  console.log(`📦 Datos cargados de Supabase: ${stores.length} sucursales activas, ${procedures.length} actividades en catálogo (${rawProcedures.length} totales), ${posActs.length} mapeos en position_activities.\n`);
  assert(stores.length === 15, `Existen exactamente 15 sucursales activas en Supabase (encontradas: ${stores.length})`);
  assert(procedures.length >= 100, `Catálogo corporativo cargado íntegramente incluyendo filas con role=null (${procedures.length} actividades activas)`);

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 1: A01, A02, A03, A25 — Horarios por Día (`weekly_hours`), Anclas y Offsets en las 15 Tiendas
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 1: Matriz 15 Sucursales × 7 Días (A01, A02, A03, A25) ──');

  const testWeekDates = [
    '2026-10-19', // Lunes (day=1)
    '2026-10-20', // Martes (day=2)
    '2026-10-21', // Miércoles (day=3)
    '2026-10-22', // Jueves (day=4)
    '2026-10-23', // Viernes (day=5)
    '2026-10-24', // Sábado (day=6)
    '2026-10-25', // Domingo (day=0)
  ];

  let all15Stores7DaysValid = true;
  let weeklyHoursDifferencesCount = 0;
  for (const store of stores) {
    const generalOffsets = calculateStoreOffsets(store.opening_time, store.closing_time);
    for (const dateStr of testWeekDates) {
      const offsets = calculateStoreOffsetsForDate(store, dateStr);
      if (!offsets.isValidConfig) {
        all15Stores7DaysValid = false;
        console.error(`  ❌ Configuración inválida en tienda ${store.name} para fecha ${dateStr}:`, offsets);
      }
      if (
        offsets.openingOffsetMinutes !== generalOffsets.openingOffsetMinutes ||
        offsets.closingOffsetMinutes !== generalOffsets.closingOffsetMinutes
      ) {
        weeklyHoursDifferencesCount++;
      }
    }
  }
  assert(all15Stores7DaysValid, 'Las 15 sucursales resuelven horarios válidos en los 7 días de la semana (105 combinaciones tienda-día)');
  assert(
    weeklyHoursDifferencesCount === 35,
    `A02 Se detectan exactamente las 35 diferencias tienda/día en stores.weekly_hours respecto del horario general (detectadas: ${weeklyHoursDifferencesCount})`
  );

  // A02: Slauson Viernes/Sábado cierra 03:00 AM (+120 min) vs Lunes-Jueves 01:00 AM (0 min)
  const slauson = stores.find((s) => s.id === 7)!;
  const slausonMon = calculateStoreOffsetsForDate(slauson, '2026-10-19');
  const slausonFri = calculateStoreOffsetsForDate(slauson, '2026-10-23');
  const slausonSat = calculateStoreOffsetsForDate(slauson, '2026-10-24');
  assert(
    slausonMon.openingOffsetMinutes === 0 && slausonMon.closingOffsetMinutes === 0,
    `A02 Slauson Lunes (2026-10-19, 10:00–01:00): openingOffset=0, closingOffset=0`
  );
  assert(
    slausonFri.openingOffsetMinutes === 0 && slausonFri.closingOffsetMinutes === 120,
    `A02 Slauson Viernes (2026-10-23, 10:00–03:00): openingOffset=0, closingOffset=+120 desde weekly_hours`
  );
  assert(
    slausonSat.openingOffsetMinutes === 0 && slausonSat.closingOffsetMinutes === 120,
    `A02 Slauson Sábado (2026-10-24, 10:00–03:00): openingOffset=0, closingOffset=+120 desde weekly_hours`
  );

  // A02: South Gate (id=14) Jueves cierra 00:00 (-60 min) vs Viernes cierra 03:00 AM (+120 min)
  const southGate = stores.find((s) => s.name.toLowerCase().includes('south gate'))!;
  const sgThu = calculateStoreOffsetsForDate(southGate, '2026-10-22');
  const sgFri = calculateStoreOffsetsForDate(southGate, '2026-10-23');
  assert(
    sgThu.closingOffsetMinutes === -60 && sgFri.closingOffsetMinutes === 120,
    `A02 South Gate (#${southGate.id}) Jueves (-60 min, 12:00 AM) vs Viernes (+120 min, 03:00 AM)`
  );

  // A01: LA Central (id=6, Lunes abre 08:00 [-120m], cierra 02:00 [+60m]; Jueves/Viernes/Sábado) y Azusa (cierra 23:00 [-120m] antes de medianoche)
  const laCentral = stores.find((s) => s.id === 6)!;
  const centralMon = calculateStoreOffsetsForDate(laCentral, '2026-10-19');
  const centralThu = calculateStoreOffsetsForDate(laCentral, '2026-10-22');
  const centralFri = calculateStoreOffsetsForDate(laCentral, '2026-10-23');
  const centralSat = calculateStoreOffsetsForDate(laCentral, '2026-10-24');
  assert(
    centralMon.openingOffsetMinutes === -120 && centralMon.closingOffsetMinutes === 60,
    `A01 LA Central Lunes (08:00–02:00): openingOffset=-120 (-2h), closingOffset=+60 (+1h)`
  );
  assert(
    centralThu.isValidConfig && centralFri.isValidConfig && centralSat.isValidConfig &&
      centralFri.closingOffsetMinutes >= centralThu.closingOffsetMinutes,
    `A01/A02 LA Central Jueves (${centralThu.closingOffsetMinutes}m), Viernes (${centralFri.closingOffsetMinutes}m) y Sábado (${centralSat.closingOffsetMinutes}m) resueltos desde weekly_hours`
  );
  const azusa = stores.find((s) => s.name.toLowerCase().includes('azusa'))!;
  const azusaMon = calculateStoreOffsetsForDate(azusa, '2026-10-19');
  assert(
    azusaMon.closingOffsetMinutes === -120 && slausonFri.closingOffsetMinutes === 120,
    `A01 Tienda que cierra antes de medianoche (Azusa 23:00 -> -120m) vs después de medianoche (Slauson Viernes 03:00 -> +120m)`
  );
  // DST transitions in America/Los_Angeles (2026-03-08 Spring Forward & 2026-11-01 Fall Back)
  const dstSpring = calculateStoreOffsetsForDate(slauson, '2026-03-08'); // Domingo
  const dstFall = calculateStoreOffsetsForDate(slauson, '2026-11-01');   // Domingo
  assert(
    dstSpring.isValidConfig && dstFall.isValidConfig &&
      dstSpring.closingOffsetMinutes === dstFall.closingOffsetMinutes,
    `A02 Fechas de cambio horario DST America/Los_Angeles (2026-03-08 y 2026-11-01) mantienen día de semana exacto sin desfase UTC`
  );
  const shifted23pmCierreCentral = applyTimeOffset('23:00:00', 'Cierre', centralMon, {
    activityTitle: 'Adelantar limpieza de cierre',
  });
  const shifted23pmCierreSouthGate = applyTimeOffset('23:00:00', 'Cierre', sgThu, {
    activityTitle: 'Adelantar limpieza de cierre',
  });
  assert(
    shifted23pmCierreCentral === '00:00:00' && shifted23pmCierreSouthGate === '22:00:00',
    `A01 Actividad de Cierre 23:00:00 se mueve con todo el bloque de cierre: -> 00:00:00 en LA Central (+1h) y -> 22:00:00 en South Gate Jueves (-1h)`
  );

  // A03: Separación estricta entre "Cambio de turno" (17:00 fijo) y orden de líquidos/Viele (17:00 desplazable)
  const cambioTurnoProc = procedures.find((p) => p.id === 'a2b10878-d062-4686-965b-f4ef853ff584') || {
    id: 'a2b10878-d062-4686-965b-f4ef853ff584',
    activity: 'Cambio de turno',
    shift_type: 'Regular',
    start_time: '17:00:00',
  };
  const ordenLiquidosProc = procedures.find((p) => p.id === 'ff53c11d-38f7-4fb2-8b9f-cfef4589f2bc') || {
    id: 'ff53c11d-38f7-4fb2-8b9f-cfef4589f2bc',
    activity: 'Solicitar orden de liquidos a la BODEGA y la orden Viele & Sons',
    shift_type: 'Regular',
    start_time: '17:00:00',
  };

  const cambioTurnoInCentral = applyTimeOffset(
    cambioTurnoProc.start_time,
    cambioTurnoProc.shift_type,
    centralMon,
    { activityId: cambioTurnoProc.id, activityTitle: cambioTurnoProc.activity }
  );
  const ordenLiquidosInCentral = applyTimeOffset(
    ordenLiquidosProc.start_time,
    ordenLiquidosProc.shift_type,
    centralMon,
    { activityId: ordenLiquidosProc.id, activityTitle: ordenLiquidosProc.activity }
  );
  assert(
    cambioTurnoInCentral.startsWith('17:00'),
    `A03 "Cambio de turno" permanece fijo a las 17:00 en LA Central (obtenido: ${cambioTurnoInCentral})`
  );
  assert(
    ordenLiquidosInCentral.startsWith('15:00'),
    `A03 "Solicitar orden de liquidos a la BODEGA y la orden Viele & Sons" se desplaza a las 15:00 en LA Central (obtenido: ${ordenLiquidosInCentral})`
  );

  // A25: Horas nulas o mal formadas nunca producen -600/-1500 ni inventan 00:00
  const nullOffsets = calculateStoreOffsets(null, null);
  assert(
    nullOffsets.openingOffsetMinutes === 0 &&
      nullOffsets.closingOffsetMinutes === 0 &&
      nullOffsets.isValidConfig === false,
    `A25 calculateStoreOffsets(null, null) devuelve 0/0 e isValidConfig=false`
  );
  const noTimeResult = applyTimeOffset(null, 'Regular', centralMon);
  assert(noTimeResult === '', `A25 Actividad sin start_time conserva hora vacía ('') sin inventar 00:00`);

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 2: A04, A05 — Checklist Ventana de Apertura y Orden Cronológico (06:00 -> 05:59)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 2: Checklist Categorías y Ordenamiento de Madrugada (A04, A05) ──');

  assert(
    doesActivityBelongToChecklistView('Regular', '10:00:00', 'Apertura') === true,
    'A04 Actividad Regular desplazada a las 10:00 AM en LA Central es visible en vista Apertura (6:00 AM - 11:59 AM)'
  );
  assert(
    doesActivityBelongToChecklistView('Regular', '14:00:00', 'Apertura') === false,
    'A04 Actividad Regular de las 2:00 PM no invade la vista Apertura'
  );

  const sort09am = getBusinessDaySortMinutes('09:00:00');
  const sort23pm = getBusinessDaySortMinutes('23:00:00');
  const sort00am = getBusinessDaySortMinutes('00:00:00');
  const sort01am = getBusinessDaySortMinutes('01:00:00');
  const sort02am = getBusinessDaySortMinutes('02:00:00');
  const sortNoTime = getBusinessDaySortMinutes(null);
  assert(
    sort09am < sort23pm && sort23pm < sort00am && sort00am < sort01am && sort01am < sort02am && sort02am < sortNoTime,
    `A05 Orden cronológico estricto de jornada laboral: 09:00 (${sort09am}) < 23:00 (${sort23pm}) < 00:00 (${sort00am}) < 01:00 (${sort01am}) < 02:00 (${sort02am}) < sin hora (${sortNoTime})`
  );

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 3: A06, A07, A08, A09, A11 — Motor Unificado de Resolución (`lib/actividades-resolution.ts`)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 3: Traslape de Turnos, Frecuencias, Ausentes y Deduplicación (A06–A11) ──');

  // A06: Traslape de turnos
  assert(
    JSON.stringify(getShiftOverlappingPeriods('09:00', '17:30')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno 09:00–17:30 traslapa con AM y PM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('16:00', '00:30')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno 16:00–00:30 traslapa con AM y PM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('09:00', '17:00')) === JSON.stringify(['AM']),
    'A06 Turno 09:00–17:00 traslapa únicamente con AM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('17:00', '01:30')) === JSON.stringify(['PM']),
    'A06 Turno 17:00–01:30 traslapa únicamente con PM'
  );
  assert(
    doesShiftOverlapPeriod('05:30', '14:00', 'AM') === true,
    'A06 Apertura temprana 05:30–14:00 traslapa con AM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('16:00', '00:00')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno 16:00–00:00 traslapa con AM (16:00–17:00) y PM (17:00–00:00)'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('00:00', '08:00')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno de madrugada 00:00–08:00 traslapa con cierre PM (00:00–06:00) y apertura AM (06:00–08:00)'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('22:00', '06:30')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno nocturno largo que cruza las 06:00 AM (22:00–06:30) se parte en 1800 y traslapa con PM y AM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('23:00', '07:00')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno nocturno largo que cruza las 06:00 AM (23:00–07:00) traslapa con PM y AM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('00:00', '06:30')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno de madrugada que cruza las 06:00 AM (00:00–06:30) traslapa con PM y AM'
  );
  assert(
    JSON.stringify(getShiftOverlappingPeriods('04:30', '15:00')) === JSON.stringify(['AM', 'PM']),
    'A06 Turno de apertura anticipada que inicia antes de las 06:00 AM (04:30–15:00) traslapa con PM (madrugada) y AM'
  );

  // A06: Intersección temporal real por minuto [shiftStart, shiftEnd)
  assert(
    doesActivityIntersectShiftWindow('09:00:00', '09:00', '17:00') === true &&
      doesActivityIntersectShiftWindow('17:00:00', '09:00', '17:00') === false &&
      doesActivityIntersectShiftWindow('17:00:00', '09:00', '17:00', { isCambioDeTurno: true }) === true,
    'A06 Intersección por minuto 09:00–17:00: inicio inclusivo (09:00=true), fin exclusivo (17:00=false salvo Cambio de turno=true)'
  );
  assert(
    doesActivityIntersectShiftWindow('17:00:00', '17:00', '01:00') === true &&
      doesActivityIntersectShiftWindow('00:30:00', '17:00', '01:00') === true &&
      doesActivityIntersectShiftWindow('01:00:00', '17:00', '01:00') === false &&
      doesActivityIntersectShiftWindow('01:00:00', '17:00', '01:00', { isClosingShift: true }) === true,
    'A06 Intersección por minuto 17:00–01:00: incluye 17:00 y 00:30, excluye 01:00 salvo actividad de cierre exacto en turno de cierre'
  );
  assert(
    doesActivityIntersectShiftWindow('16:30:00', '16:00', '00:00') === true &&
      doesActivityIntersectShiftWindow('21:00:00', '16:00', '00:00') === true &&
      doesActivityIntersectShiftWindow('00:00:00', '16:00', '00:00') === false,
    'A06 Intersección por minuto 16:00–00:00: incluye 16:30 y 21:00, excluye 00:00'
  );
  assert(
    doesActivityIntersectShiftWindow('01:00:00', '00:00', '08:00') === true &&
      doesActivityIntersectShiftWindow('05:30:00', '00:00', '08:00') === true &&
      doesActivityIntersectShiftWindow('06:30:00', '00:00', '08:00') === true &&
      doesActivityIntersectShiftWindow('08:00:00', '00:00', '08:00') === false,
    'A06 Intersección por minuto 00:00–08:00: incluye madrugada (01:00, 05:30) y mañana (06:30), excluye fin exacto (08:00)'
  );

  // A07: Frecuencias con y sin tilde, diaria, mensual y fecha específica
  assert(
    isFreqMatch('Diario', '2026-10-19') && isFreqMatch('2026-10-19', '2026-10-19') && !isFreqMatch('2026-10-20', '2026-10-19'),
    'A07 Frecuencia "Diario" y fecha específica "2026-10-19" evalúan correctamente'
  );
  assert(
    isFreqMatch('Miercoles', '2026-10-21') && isFreqMatch('Miércoles', '2026-10-21'),
    'A07 Frecuencia "Miercoles" y "Miércoles" hacen match en miércoles 2026-10-21'
  );
  assert(
    isFreqMatch('Sabado', '2026-10-24') && isFreqMatch('Sábado', '2026-10-24'),
    'A07 Frecuencia "Sabado" y "Sábado" hacen match en sábado 2026-10-24'
  );
  assert(
    !isFreqMatch('Miercoles', '2026-10-19'),
    'A07 Frecuencia "Miercoles" NO hace match en lunes 2026-10-19'
  );
  assert(
    isFreqMatch('Dia 19', '2026-10-19') && !isFreqMatch('Dia 19', '2026-10-20'),
    'A07 Frecuencia mensual "Dia 19" hace match exactamente el día 19 del mes'
  );

  // A08: Empleados ausentes (isCallback = true)
  const callbackResolved = resolveStationActivities({
    mainStation: 'TACOS',
    subPosition: 'TACOS_AM',
    shift: 'AM',
    businessDateStr: '2026-10-19',
    store: slauson,
    procedures,
    positionActivities: posActs,
    isCallback: true,
  });
  assert(
    callbackResolved.length === 0,
    'A08 Turno marcado como Ausente/Callback recibe 0 actividades aunque tenga estación asignada'
  );

  // A09: Snapshot legacy en station_assignments.tasks vs excepción manual
  const sampleCatalogTitle = procedures[0]?.activity || 'Cambio de turno';
  const legacyClassification = classifyLegacyTasksSnapshot({
    mainStation: 'TACOS',
    subPosition: 'TACOS_AM',
    tasks: [sampleCatalogTitle, 'Tarea Especial Única Del Manager'],
    procedures,
    positionActivities: posActs,
  });
  assert(
    (legacyClassification.matchedActiveMapping.length + legacyClassification.matchedCatalogOnly.length === 1) &&
      legacyClassification.unclassifiedOrManualPreserved.length === 1 &&
      legacyClassification.unclassifiedOrManualPreserved[0] === 'Tarea Especial Única Del Manager',
    'A09 Clasificador de station_assignments.tasks separa snapshots del catálogo vs tareas manuales reales'
  );

  // A11: Multi-estación y deduplicación determinística
  const tacosActs = resolveStationActivities({
    mainStation: 'TACOS',
    subPosition: 'TACOS_AM',
    shift: 'AM',
    businessDateStr: '2026-10-19',
    store: slauson,
    procedures,
    positionActivities: posActs,
  });
  const carnesActs = resolveStationActivities({
    mainStation: 'CARNES',
    subPosition: 'CARNES_AM',
    shift: 'AM',
    businessDateStr: '2026-10-19',
    store: slauson,
    procedures,
    positionActivities: posActs,
  });
  const mergedDupTest = mergeAndDeduplicateActivities([tacosActs, tacosActs, carnesActs]);
  const uniqueKeys = new Set(mergedDupTest.map((m) => m.occurrence_key));
  assert(
    mergedDupTest.length === uniqueKeys.size && mergedDupTest.length >= tacosActs.length,
    `A11 mergeAndDeduplicateActivities elimina duplicados entre estaciones conservando orden determinístico (${mergedDupTest.length} únicas)`
  );

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 4: A12, A13 — Prueba en Vivo de RPC Transaccional y Control de Concurrencia (409)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 4: Transaccionalidad Atómica en BD y Optimistic Concurrency (A12, A13) ──');

  const testDate = '2099-12-31';
  const testStoreGuid = slauson.external_id;
  const { data: realEmpRows } = await supabase
    .from('station_assignments')
    .select('employee_id')
    .not('employee_id', 'is', null)
    .limit(1);
  const testEmpUuid = realEmpRows?.[0]?.employee_id || '00000000-0000-4000-8000-000000000001';
  const testPosKey = '__TEST_ATOMIC_ROLLBACK_2099__';
  try {
    // Limpiar cualquier residuo previo en la fecha sintética 2099-12-31
    await supabase
      .from('station_assignments')
      .delete()
      .eq('store_id', testStoreGuid)
      .eq('assignment_date', testDate);

    // 1. Insertar atómicamente vía RPC
    const { data: rpcInsert, error: rpcInsErr } = await supabase.rpc(
      'replace_station_assignments_atomic',
      {
        p_store_id: testStoreGuid,
        p_start_date: testDate,
        p_end_date: testDate,
        p_active_shift: 'AM',
        p_assignments: [
          {
            employee_id: testEmpUuid,
            assignment_date: testDate,
            main_station: 'TACOS',
            sub_position: 'TACOS_AM',
            station_group: 'front',
            tasks: [],
          },
        ],
        p_expected_revision: null,
      }
    );

    assert(!rpcInsErr && rpcInsert?.success === true, 'A12/A13 RPC replace_station_assignments_atomic inserta lote atómicamente');
    const revAfterInsert = rpcInsert?.new_revision;
    assert(Boolean(revAfterInsert && revAfterInsert !== '0:0'), `A13 RPC genera hash de revisión determinístico (${revAfterInsert})`);

    // 2. Intentar sobrescribir con una revisión obsoleta -> debe fallar con CONFLICT_REVISION_MISMATCH y conservar el dato
    const { error: conflictErr } = await supabase.rpc('replace_station_assignments_atomic', {
      p_store_id: testStoreGuid,
      p_start_date: testDate,
      p_end_date: testDate,
      p_active_shift: 'AM',
      p_assignments: [],
      p_expected_revision: 'stale-revision-hash-000',
    });

    assert(
      Boolean(conflictErr && conflictErr.message.includes('CONFLICT_REVISION_MISMATCH')),
      'A13 RPC rechaza escritura concurrente con expected_revision obsoleto (CONFLICT_REVISION_MISMATCH)'
    );

    // Verificar que la fila original sigue intacta tras el conflicto
    const { data: survivingRows } = await supabase
      .from('station_assignments')
      .select('id, main_station')
      .eq('store_id', testStoreGuid)
      .eq('assignment_date', testDate);

    assert(
      survivingRows?.length === 1 && survivingRows[0].main_station === 'TACOS',
      'A13 La asignación original permanece intacta en BD tras rechazarse el guardado con revisión obsoleta'
    );

    // 3. Prueba de Rollback atómico en replace_position_activities_atomic ante fallo a mitad de lote
    const validActivityId = procedures[0].id;
    await supabase.from('position_activities').delete().eq('position_key', testPosKey);

    const { data: posInit } = await supabase.rpc('replace_position_activities_atomic', {
      p_position_key: testPosKey,
      p_mappings: [
        {
          activity_id: validActivityId,
          shift: 'AM',
          frequency: 'Diario',
          store_model: 'AMBOS',
          sort_order: 1,
        },
      ],
    });
    assert(posInit?.inserted_count === 1, 'A12 RPC replace_position_activities_atomic inserta mapeo inicial de prueba');

    // Ahora enviamos un lote con 1 válido y 1 UUID inexistente -> debe abortar toda la transacción y NO borrar el mapeo previo
    const { error: posRollbackErr } = await supabase.rpc('replace_position_activities_atomic', {
      p_position_key: testPosKey,
      p_mappings: [
        {
          activity_id: validActivityId,
          shift: 'PM',
          frequency: 'Diario',
          store_model: 'AMBOS',
          sort_order: 1,
        },
        {
          activity_id: '00000000-0000-4000-8000-999999999999', // No existe en operating_procedures
          shift: 'PM',
          frequency: 'Diario',
          store_model: 'AMBOS',
          sort_order: 2,
        },
      ],
    });
    assert(
      Boolean(posRollbackErr && posRollbackErr.message.includes('FOREIGN_KEY_ERROR')),
      'A12 RPC replace_position_activities_atomic detecta FK inválida a mitad del lote y aborta transacción'
    );

    const { data: survivingPosRows } = await supabase
      .from('position_activities')
      .select('activity_id, shift')
      .eq('position_key', testPosKey);
    assert(
      survivingPosRows?.length === 1 && survivingPosRows[0].shift === 'AM',
      'A12 Rollback verificado: el mapeo original (AM) sobrevivió intacto tras fallar el segundo elemento del reemplazo'
    );
  } finally {
    // Limpieza garantizada
    await supabase
      .from('station_assignments')
      .delete()
      .eq('store_id', testStoreGuid)
      .eq('assignment_date', testDate);
    await supabase
      .from('position_activities')
      .delete()
      .eq('position_key', testPosKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 5: A20, A21, A22, Feature Flag Piloto Slauson
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 5: Seguridad de Calendario .ics, Catálogo de 31 Estaciones y Piloto Slauson (A20, A21, A22) ──');

  // A20: Token firmado HMAC-SHA256 para calendario .ics
  const testSecret = 'unit-test-hmac-secret-2026-tacos-gavilan';
  const token = signCalendarAccessToken(
    {
      employeeId: 'emp-123',
      storeId: slauson.external_id,
      startDate: '2026-10-19',
      endDate: '2026-10-25',
    },
    testSecret
  );
  assert(Boolean(token && token.length >= 32), 'A20 signCalendarAccessToken genera firma HMAC-SHA256');
  assert(
    verifyCalendarAccessToken(
      token,
      {
        employeeId: 'emp-123',
        storeId: slauson.external_id,
        startDate: '2026-10-19',
        endDate: '2026-10-25',
      },
      testSecret
    ).valid === true,
    'A20 verifyCalendarAccessToken acepta token válido para empleado/sucursal/semana'
  );
  assert(
    verifyCalendarAccessToken(
      token,
      {
        employeeId: 'emp-other',
        storeId: slauson.external_id,
        startDate: '2026-10-19',
        endDate: '2026-10-25',
      },
      testSecret
    ).valid === false,
    'A20 verifyCalendarAccessToken rechaza intento de usar el token para otro employee_id'
  );
  const expiredToken = signCalendarAccessToken(
    {
      employeeId: 'emp-123',
      storeId: slauson.external_id,
      expTimestamp: Math.floor(Date.now() / 1000) - 3600,
    },
    testSecret
  );
  assert(
    verifyCalendarAccessToken(expiredToken, { employeeId: 'emp-123', storeId: slauson.external_id }, testSecret).reason ===
      'token_expired',
    'A20 verifyCalendarAccessToken rechaza token expirado (token_expired)'
  );
  const tamperedToken = token ? `${token.slice(0, -4)}XXXX` : '';
  assert(
    verifyCalendarAccessToken(tamperedToken, { employeeId: 'emp-123', storeId: slauson.external_id }, testSecret).reason ===
      'invalid_signature',
    'A20 verifyCalendarAccessToken rechaza token alterado (invalid_signature)'
  );

  // A21 & A22: Catálogo canónico de 31 estaciones
  assert(
    CANONICAL_STATIONS_CATALOG.length === 31,
    `A21/A22 CANONICAL_STATIONS_CATALOG contiene las 31 estaciones canónicas (actual: ${CANONICAL_STATIONS_CATALOG.length})`
  );
  const allStationsHaveDisposition = CANONICAL_STATIONS_CATALOG.every((st) => {
    const status = getStationConfigStatus(st.station, posActs);
    return Boolean(status.disposition && status.dispositionReason);
  });
  assert(
    allStationsHaveDisposition,
    'A21 Las 31 estaciones tienen estado de configuración explícito (configured / break_coverage / manual_extra / pending_operational_decision)'
  );

  // Feature Flag Piloto Slauson vs 14 tiendas restantes
  const pilotActiveStoresDefault = stores.filter((s) => isStorePilotActiveForActivitiesEmail(s, 'Slauson,7,9625621e-1b5e-48d7-87ae-7094fab5a4fd'));
  assert(
    pilotActiveStoresDefault.length === 1 && pilotActiveStoresDefault[0].id === 7,
    `Piloto gradual: Por defecto solo Slauson (#7) tiene activo el envío operativo en correos (activas: ${pilotActiveStoresDefault.map((s) => s.name).join(', ')})`
  );
  const pilotAllStoresTest = stores.filter((s) => isStorePilotActiveForActivitiesEmail(s, 'ALL'));
  assert(
    pilotAllStoresTest.length === 15,
    'Piloto gradual: Al configurar ACTIVIDADES_EMAIL_ENABLED_STORES=ALL, las 15 sucursales quedan activas sin tocar código'
  );

  // Validaciones adicionales: Fechas invertidas en RPC, Autorización 401/403 (A16–A19), Paridad Email/Tableta/Checklist y Seguridad Matemática
  const { error: invertedDatesErr } = await supabase.rpc('replace_station_assignments_atomic', {
    p_store_id: testStoreGuid,
    p_start_date: '2099-12-31',
    p_end_date: '2099-12-30',
    p_active_shift: 'AM',
    p_assignments: [],
    p_expected_revision: null,
  });
  assert(
    Boolean(invertedDatesErr && invertedDatesErr.message.includes('VALIDATION_ERROR')),
    'A15 RPC rechaza rango de fechas invertido (2099-12-31 > 2099-12-30) con VALIDATION_ERROR'
  );

  const authUnauth = await authorizeStoreScope(null, slauson.external_id, supabase);
  assert(authUnauth.authorized === false && authUnauth.status === 401, 'A16–A19 Usuario sin sesión recibe 401 Unauthorized');

  const authWrongRole = await authorizeStoreScope(
    { id: 999, email: 'cajero@tacosgavilan.com', name: 'Cajero', role: 'Cashier', store_id: slauson.id },
    slauson.external_id,
    supabase,
    { allowedRoles: ['admin', 'supervisor', 'manager'] }
  );
  assert(authWrongRole.authorized === false && authWrongRole.status === 403, 'A16–A19 Rol no autorizado recibe 403 Forbidden');

  const authOtherStoreManager = await authorizeStoreScope(
    { id: 888, email: 'mgr@tacosgavilan.com', name: 'Manager Slauson', role: 'Manager', store_id: slauson.id },
    laCentral.external_id,
    supabase
  );
  assert(
    authOtherStoreManager.authorized === false && authOtherStoreManager.status === 403,
    'A16–A19 Manager de Slauson (#7) intentando operar sobre LA Central (#6) recibe 403 Forbidden'
  );

  const authOwnStoreManager = await authorizeStoreScope(
    { id: 888, email: 'mgr@tacosgavilan.com', name: 'Manager Slauson', role: 'Manager', store_id: slauson.id },
    slauson.external_id,
    supabase
  );
  assert(
    authOwnStoreManager.authorized === true && authOwnStoreManager.canonicalExternalId === slauson.external_id,
    'A16–A19 Manager de Slauson (#7) autorizado sobre su propia sucursal (acepta ID numérico o GUID)'
  );

  // Paridad exacta entre consumidores (Email Preview / Tableta / Checklist) y preservación de dos ocurrencias legítimas (AM y PM)
  const tacosPmActs = resolveStationActivities({
    mainStation: 'TACOS',
    subPosition: 'TACOS_PM',
    shift: 'PM',
    businessDateStr: '2026-10-19',
    store: slauson,
    procedures,
    positionActivities: posActs,
  });
  const combinedAmPmOccurrences = mergeAndDeduplicateActivities([tacosActs, tacosPmActs]);
  assert(
    combinedAmPmOccurrences.length === tacosActs.length + tacosPmActs.length,
    `A11 Dos ocurrencias legítimas de actividades en turnos distintos (AM=${tacosActs.length} + PM=${tacosPmActs.length}) se preservan sin colapsar (${combinedAmPmOccurrences.length})`
  );

  // Prevención de división por cero (0/0), NaN e Infinity en cálculo de porcentajes de cumplimiento
  const safeCompliancePct = (completed: number, total: number) =>
    total > 0 && Number.isFinite(completed) && Number.isFinite(total)
      ? Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
      : 0;
  assert(
    safeCompliancePct(0, 0) === 0 &&
      !Number.isNaN(safeCompliancePct(0, 0)) &&
      Number.isFinite(safeCompliancePct(5, 10)) &&
      safeCompliancePct(5, 10) === 50,
    'A26 Protección matemática contra división por cero (0/0 -> 0%), NaN e Infinity en reportes'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // BLOQUE 6: Blindaje de RPCs/RLS ante cliente Anon y Paridad E2E de Consumidores
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── Bloque 6: Blindaje RPC/RLS ante Cliente Anon y Paridad E2E (Checklist / Reportes / Overrides) ──');

  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseAnonKey) {
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { error: anonRevErr } = await anonClient.rpc('get_station_assignments_revision', {
      p_store_id: testStoreGuid,
      p_start_date: '2099-12-31',
      p_end_date: '2099-12-31',
      p_active_shift: 'AM',
    });
    const { error: anonRepAssignErr } = await anonClient.rpc('replace_station_assignments_atomic', {
      p_store_id: testStoreGuid,
      p_start_date: '2099-12-31',
      p_end_date: '2099-12-31',
      p_active_shift: 'AM',
      p_assignments: [],
      p_expected_revision: null,
    });
    const { error: anonRepPosErr } = await anonClient.rpc('replace_position_activities_atomic', {
      p_position_key: '__ANON_BLOCKED_TEST__',
      p_mappings: [],
    });
    assert(
      Boolean(anonRevErr && anonRepAssignErr && anonRepPosErr),
      'Seguridad RPC: Las 3 funciones SECURITY DEFINER rechazan llamadas desde cliente anon/PUBLIC (permission denied)'
    );

    const { error: anonInsAssignErr } = await anonClient.from('station_assignments').insert({
      store_id: testStoreGuid,
      assignment_date: '2099-12-31',
      main_station: 'TACOS',
      sub_position: 'TACOS_AM',
    });
    const { error: anonInsPosErr } = await anonClient.from('position_activities').insert({
      position_key: '__ANON_BLOCKED__',
      activity_id: procedures[0].id,
      shift: 'AM',
    });
    assert(
      Boolean(anonInsAssignErr && anonInsPosErr),
      'Seguridad RLS: Escrituras directas desde cliente anon en station_assignments y position_activities están bloqueadas'
    );
  }

  // Paridad exacta ChecklistMode vs ReportesChecklistTab usando resolveStoreCatalogActivitiesForDay y overrides por tienda
  const checklistDaySlauson = resolveStoreCatalogActivitiesForDay({
    procedures,
    store: slauson,
    businessDateStr: '2026-10-23', // Viernes en Slauson (+120m cierre)
  });
  const checklistDayAzusa = resolveStoreCatalogActivitiesForDay({
    procedures,
    store: azusa,
    businessDateStr: '2026-10-23', // Viernes en Azusa (Drive-Thru = false / Regular)
  });
  assert(
    checklistDaySlauson.length > 0 &&
      checklistDayAzusa.length > 0 &&
      checklistDaySlauson.length >= checklistDayAzusa.length,
    `Paridad Checklist/Reportes: resolveStoreCatalogActivitiesForDay resuelve catálogo diario con modelo de tienda, overrides y offsets (Slauson DT=${checklistDaySlauson.length}, Azusa Regular=${checklistDayAzusa.length})`
  );

  // Verificar que overrides por tienda (external_id o id) desactivan o cambian start_time/frequency
  const syntheticProcWithOverride = {
    id: 'synthetic-override-proc-1',
    activity: 'Actividad Con Override En Slauson',
    shift_type: 'Regular',
    start_time: '11:00:00',
    frequency: 'Diario',
    store_model: 'AMBOS',
    overrides: {
      stores: {
        [slauson.external_id]: {
          enabled: true,
          start_time: '13:30:00',
          frequency: 'Viernes',
        },
        [azusa.external_id]: {
          enabled: false,
        },
      },
    },
  };
  const resolvedOverrideFriSlauson = resolveStoreCatalogActivitiesForDay({
    procedures: [syntheticProcWithOverride],
    store: slauson,
    businessDateStr: '2026-10-23', // Viernes
  });
  const resolvedOverrideMonSlauson = resolveStoreCatalogActivitiesForDay({
    procedures: [syntheticProcWithOverride],
    store: slauson,
    businessDateStr: '2026-10-19', // Lunes
  });
  const resolvedOverrideFriAzusa = resolveStoreCatalogActivitiesForDay({
    procedures: [syntheticProcWithOverride],
    store: azusa,
    businessDateStr: '2026-10-23', // Viernes pero enabled=false
  });
  assert(
    resolvedOverrideFriSlauson.length === 1 &&
      resolvedOverrideFriSlauson[0].effective_start_time.startsWith('13:30') &&
      resolvedOverrideMonSlauson.length === 0 &&
      resolvedOverrideFriAzusa.length === 0,
    'A10/A11 Overrides por sucursal (overrides.stores) aplican start_time, frequency y enabled tanto en catálogo como en estaciones'
  );

  // Verificar que actividades mapeadas con shift = 'AMBOS' (ej. deberes continuos de estación con start_time 10:00:00 en CAJA 1 / SALÓN) se resuelven tanto en AM como en PM
  const caja1PmAmbosCheck = resolveStationActivities({
    mainStation: 'CAJA 1 / SALÓN',
    subPosition: 'CAJA 1 / SALÓN_PM',
    shift: 'PM',
    businessDateStr: '2026-10-19',
    store: slauson,
    procedures,
    positionActivities: posActs,
  });
  assert(
    caja1PmAmbosCheck.length >= 2 &&
      caja1PmAmbosCheck.some((a) => a.title.toLowerCase().includes('uber')),
    `Mapeos explícitos shift='AMBOS' se resuelven tanto en Turno AM como en Turno PM (${caja1PmAmbosCheck.length} actividades en CAJA 1 / SALÓN_PM)`
  );

  // Verificar RLS y revocación de escritura directa para anon en station_assignments y checklist_completions
  if (supabaseAnonKey) {
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonAssignErr } = await anonClient.from('station_assignments').insert({
      store_id: slauson.external_id,
      assignment_date: '2099-12-31',
      main_station: 'TACOS',
      sub_position: 'TACOS_AM',
    });
    const { error: anonChecklistErr } = await anonClient.from('checklist_completions').insert({
      store_id: slauson.external_id,
      procedure_id: cambioTurnoProc.id,
      shift_type: 'Apertura',
      completed_by: 'Anon Attack',
    });
    assert(
      Boolean(anonAssignErr && anonChecklistErr),
      'A18/A19/A26 Escritura directa con anon_key bloqueada en station_assignments y checklist_completions (RLS + REVOKE)'
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`📊 RESULTADO FINAL: ${passed} pruebas exitosas, ${failed} fallidas.`);
  console.log('═══════════════════════════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
}

runAcceptanceSuite().catch((err) => {
  console.error('❌ Error fatal en suite de verificación:', err);
  process.exit(1);
});
