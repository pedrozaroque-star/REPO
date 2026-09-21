// Read-only regression probes: execute the actual shipped helper, not a copy.
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('components/ronos/helpers.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', 'require', compiled)(mod.exports, mod, require);
const { detectTodayAnomalies, getPacificBusinessDate } = mod.exports;
let failed = 0;
let total = 0;
function check(name, actual, expected) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${total}] ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!ok) failed++;
}

// === GRUPO 1: getPacificBusinessDate (Hallazgo E boundary) ===
// 5:59 AM Pacific (12:59 UTC) → día anterior
check('05:59 LA → día anterior', getPacificBusinessDate('2026-09-19T12:59:00Z'), '2026-09-18');
// 6:00 AM Pacific (13:00 UTC) → día actual
check('06:00 LA → día actual', getPacificBusinessDate('2026-09-19T13:00:00Z'), '2026-09-19');

// === Constantes reutilizables ===
// El "now" simulado: 3 PM Pacific (22:00 UTC) del 2026-09-19
const now = Date.parse('2026-09-19T22:00:00Z');
const workDate = '2026-09-19';

// Helper: crea un empleado de prueba
const employee = (days, brokenHours = false) => ({
  employeeUserId: 1,
  fullName: 'Test Employee',
  days,
  brokenHours
});

// === GRUPO 2: Hallazgo C — BROKEN_TIMECARD case-insensitive en historial ===
check(
  'Backend BROKEN_TIMECARD retained in history',
  detectTodayAnomalies([
    employee([{ date: '2026-09-18', clockInTime: '08:00 AM', clockOutTime: '05:00 PM', violations: [{ type: 'BROKEN_TIMECARD' }] }])
  ], undefined, now).historicalBroken.length,
  1
);

// Test 4: lowercase missing_punch → también historicalBroken (case insensitive)
check(
  'lowercase missing_punch → historicalBroken',
  detectTodayAnomalies([
    employee([{ date: '2026-09-18', clockInTime: '09:00 AM', clockOutTime: '04:00 PM', violations: [{ type: 'missing_punch' }] }])
  ], undefined, now).historicalBroken.length,
  1
);

// === GRUPO 3: Hallazgo B — Turno abierto normal NO es anomalía ===
// Test 5: Empleado con solo un IN (punchType 1) que lleva <14h → NO es anomalía, es turno normal
check(
  'Normal IN punch (<14h) → NOT an anomaly (Finding B)',
  detectTodayAnomalies([
    employee([{
      date: workDate,
      punches: [{
        punchType: 1,
        punchTime: '2026-09-19T16:00:00Z',    // 9 AM Pacific → 6h de turno
        timestampIso: '2026-09-19T16:00:00Z'
      }]
    }])
  ], undefined, now).openToday.length,
  0
);

// Test 6: Empleado con IN + meal OUT (<120 min) → descanso normal, NO anomalía
check(
  'Employee on meal break (<120 min) → NOT an anomaly',
  detectTodayAnomalies([
    employee([{
      date: workDate,
      punches: [
        { punchType: 1, punchTime: '2026-09-19T16:00:00Z', timestampIso: '2026-09-19T16:00:00Z' },
        { punchType: 3, punchTime: '2026-09-19T21:30:00Z', timestampIso: '2026-09-19T21:30:00Z' }  // 30 min ago at now=22:00
      ]
    }])
  ], undefined, now).openToday.length,
  0
);

// Test 7: Empleado con IN + meal OUT (>120 min) → anomalía real: lunch prolongado
check(
  'Meal break > 120 min → IS an anomaly (lunch_without_return)',
  detectTodayAnomalies([
    employee([{
      date: workDate,
      punches: [
        { punchType: 1, punchTime: '2026-09-19T15:00:00Z', timestampIso: '2026-09-19T15:00:00Z' },
        { punchType: 3, punchTime: '2026-09-19T16:00:00Z', timestampIso: '2026-09-19T16:00:00Z' }  // 6h ago → way over 120 min
      ]
    }])
  ], undefined, now).openToday.length,
  1
);

// Test 8: Empleado con IN + OUT (salió normalmente) → NO anomalía
check(
  'Employee clocked IN then OUT → NOT an anomaly',
  detectTodayAnomalies([
    employee([{
      date: workDate,
      punches: [
        { punchType: 1, punchTime: '2026-09-19T14:00:00Z', timestampIso: '2026-09-19T14:00:00Z' },
        { punchType: 2, punchTime: '2026-09-19T21:00:00Z', timestampIso: '2026-09-19T21:00:00Z' }
      ]
    }])
  ], undefined, now).openToday.length,
  0
);

// === GRUPO 4: Turno nocturno y turno prolongado ===
// Test 9: OUT hoy después de IN ayer → turno nocturno legítimo, NO anomalía
check(
  'Night shift: OUT today after IN yesterday → NOT an anomaly',
  detectTodayAnomalies([
    employee([
      {
        date: '2026-09-18',
        punches: [{ punchType: 1, punchTime: '2026-09-19T03:00:00Z', timestampIso: '2026-09-19T03:00:00Z' }]
      },
      {
        date: workDate,
        punches: [{ punchType: 2, punchTime: '2026-09-19T14:00:00Z', timestampIso: '2026-09-19T14:00:00Z' }]
      }
    ])
  ], undefined, now).openToday.length,
  0
);

// Test 10: Turno >14h sin salida → anomalía shift_over_14h
check(
  'Shift >14h without OUT → IS an anomaly (shift_over_14h)',
  detectTodayAnomalies([
    employee([{
      date: workDate,
      punches: [{
        punchType: 1,
        punchTime: '2026-09-19T06:00:00Z',    // 16h ago (11 PM Pacific yesterday)
        timestampIso: '2026-09-19T06:00:00Z'
      }]
    }])
  ], undefined, now).openToday.length,
  1
);

// === GRUPO 5: Hallazgo A — null/undefined/vacío ===
// Test 11: null employees → empty arrays (not "all clear")
check(
  'detectTodayAnomalies(null) → empty arrays (data unavailable)',
  (() => {
    const r = detectTodayAnomalies(null, undefined, now);
    return r.openToday.length + r.historicalBroken.length + r.pendingWeeklyReview.length;
  })(),
  0
);

// Test 12: empty array of employees → empty arrays (0 employees, not anomaly)
check(
  'detectTodayAnomalies([]) → empty arrays (0 employees)',
  (() => {
    const r = detectTodayAnomalies([], undefined, now);
    return r.openToday.length + r.historicalBroken.length + r.pendingWeeklyReview.length;
  })(),
  0
);

// Test 13: undefined employees → empty arrays
check(
  'detectTodayAnomalies(undefined) → empty arrays',
  (() => {
    const r = detectTodayAnomalies(undefined, undefined, now);
    return r.openToday.length + r.historicalBroken.length + r.pendingWeeklyReview.length;
  })(),
  0
);

// === GRUPO 6: Flags semanales y futuro ===
// Test 14: Future punch discarded (no puede confirmar anomalía que aún no ocurre)
check(
  'Future punch cannot confirm an anomaly now',
  detectTodayAnomalies([
    employee([{ date: workDate, punches: [{ punchType: 2, punchTime: '2026-09-20T01:00:00Z' }] }])
  ], undefined, now).openToday.length,
  0
);

// Test 15: Weekly flag alone (brokenHours: true) pero sin fechas → pendingWeeklyReview (no historicalBroken)
check(
  'Weekly flag alone → pendingWeeklyReview, not historicalBroken',
  (() => {
    const r = detectTodayAnomalies([employee([], true)], undefined, now);
    return { broken: r.historicalBroken.length, weekly: r.pendingWeeklyReview.length };
  })(),
  { broken: 0, weekly: 1 }
);

// Test 16: brokenHours: true con fecha comprobada → historicalBroken (no pendingWeeklyReview)
check(
  'brokenHours with proven date → historicalBroken, not pendingWeeklyReview',
  (() => {
    const r = detectTodayAnomalies([
      employee([{ date: '2026-09-17', clockInTime: '08:00 AM', violations: [{ type: 'BROKEN_TIMECARD' }] }], true)
    ], undefined, now);
    return { broken: r.historicalBroken.length, weekly: r.pendingWeeklyReview.length };
  })(),
  { broken: 1, weekly: 0 }
);

console.log(`\nRegression probes with actual RONOS helper: ${total} tests, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
