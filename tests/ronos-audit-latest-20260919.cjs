/**
 * @module tests/ronos-audit-latest-20260919
 * @description Reproducciones ejecutables de la auditoría RONOS del 19 de septiembre.
 * @businessRules Evalúa sesiones reales de la lógica actual; tipo 1 también es regreso de comida.
 * @dataFlow Lee y transpila el helper productivo sin modificarlo, sin red y sin DB.
 * @notes Casos deterministas de frontera; no sustituye validación con datos upstream reales.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const helperPath = path.resolve(__dirname, '../components/ronos/helpers.ts')
const js = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const loaded = { exports: {} }
new Function('exports', 'require', 'module', js)(loaded.exports, require, loaded)
const { detectTodayAnomalies, getPacificBusinessDate } = loaded.exports
const today = '2026-09-19'
const now = Date.parse('2026-09-19T22:30:00-07:00')
const punch = (punchType, punchTime) => ({ punchType, punchTime })
const employee = (days, brokenHours = false) => ({ employeeUserId: 1, fullName: 'Audit fixture', days, brokenHours })
const run = days => detectTodayAnomalies([employee(days)], today, now)
const previousDay = () => ({
  date: '2026-09-18', clockInTime: '2026-09-18T23:00:00-07:00',
  punches: [punch(1, '2026-09-18T23:00:00-07:00')]
})
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`) }
  catch (err) { failed++; console.error(`FAIL ${name}: ${err.message}`) }
}
test('05:59 pertenece al día laboral anterior', () => {
  assert.equal(getPacificBusinessDate('2026-09-19T05:59:00-07:00'), '2026-09-18')
})
test('06:00 inicia nuevo día laboral', () => {
  assert.equal(getPacificBusinessDate('2026-09-19T06:00:00-07:00'), today)
})
test('OUT cierra primera sesión antes del segundo turno', () => {
  const result = run([{ date: today, punches: [punch(1, `${today}T06:00:00-07:00`), punch(2, `${today}T10:00:00-07:00`), punch(1, `${today}T20:00:00-07:00`)] }])
  assert.equal(result.openToday.length, 0)
})
test('Regreso de comida tipo 1 conserva comienzo del turno', () => {
  const result = run([{ date: today, punches: [punch(1, `${today}T06:00:00-07:00`), punch(3, `${today}T10:00:00-07:00`), punch(1, `${today}T10:30:00-07:00`)] }])
  assert.equal(result.openToday.filter(x => x.reason === 'shift_over_14h').length, 1)
})
test('Salida nocturna válida no inventa histórico', () => {
  const result = run([previousDay(), { date: today, punches: [punch(2, `${today}T06:30:00-07:00`)] }])
  assert.equal(result.historicalBroken.length, 0)
  assert.equal(result.openToday.length, 0)
})
test('OUT futuro no puede cerrar tarjeta histórica', () => {
  const result = run([previousDay(), { date: today, punches: [punch(2, `${today}T23:30:00-07:00`)] }])
  assert.equal(result.historicalBroken.length, 1)
})
test('OUT de nueva sesión no cierra entrada histórica anterior', () => {
  const result = run([previousDay(), { date: today, punches: [punch(1, `${today}T12:00:00-07:00`), punch(2, `${today}T18:00:00-07:00`)] }])
  assert.equal(result.historicalBroken.length, 1)
})
test('Null en ponchadas de hoy no rompe consulta', () => {
  assert.doesNotThrow(() => run([{ date: today, punches: [null] }]))
})
test('Null en contexto previo tampoco rompe consulta', () => {
  assert.doesNotThrow(() => run([{ date: '2026-09-18', punches: [null] }, { date: today, punches: [punch(2, `${today}T06:30:00-07:00`)] }]))
})
test('Bandera semanal conserva categoría pendiente sin inventar fecha', () => {
  const result = detectTodayAnomalies([employee([], true)], today, now)
  assert.equal(result.pendingWeeklyReview.length, 1)
  assert.equal(result.historicalBroken.length, 0)
})
console.log(`RESULT ${passed} passed / ${failed} failed`)
process.exitCode = failed ? 1 : 0
