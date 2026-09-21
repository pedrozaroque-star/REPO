// Audit probes against the actual helper; no network or database mutations.
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('components/ronos/helpers.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', 'require', compiled)(mod.exports, mod, require);
const { detectTodayAnomalies } = mod.exports;
const punch = (type, stamp) => ({ punchType: type, timestampIso: stamp, punchTime: stamp });
const employee = days => ({ employeeUserId: 1, fullName: 'Audit fixture', days, brokenHours: false });
let failures = 0;
function check(name, run, expected) {
  try {
    const actual = run();
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    if (!ok) failures++;
  } catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`); }
}
check('Closed first shift must not extend a second shift', () => detectTodayAnomalies([employee([
  { date: '2026-09-19', punches: [punch(1,'2026-09-19T06:00:00-07:00'),punch(2,'2026-09-19T10:00:00-07:00'),punch(1,'2026-09-19T20:00:00-07:00')] }
])], '2026-09-19', Date.parse('2026-09-19T22:30:00-07:00')).openToday.length, 0);
check('Overnight session closed after business boundary must not remain broken', () => detectTodayAnomalies([employee([
  { date: '2026-09-18', clockInTime: '11:00 PM', clockOutTime: '', punches: [punch(1,'2026-09-18T23:00:00-07:00')] },
  { date: '2026-09-19', clockOutTime: '06:30 AM', punches: [punch(2,'2026-09-19T06:30:00-07:00')] }
])], '2026-09-19', Date.parse('2026-09-19T07:00:00-07:00')).historicalBroken.length, 0);
check('Malformed null punch must not crash the view', () => detectTodayAnomalies([employee([
  { date: '2026-09-19', punches: [null,punch(1,'2026-09-19T08:00:00-07:00')] }
])], '2026-09-19', Date.parse('2026-09-19T09:00:00-07:00')).openToday.length, 0);
console.log(`Follow-up: ${3-failures}/3 passed`);
process.exitCode = failures ? 1 : 0;
