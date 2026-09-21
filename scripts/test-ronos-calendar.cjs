/** Simulación de funciones reales de calendario UI y horario cron, extraídas por AST. */
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const names = ['formatTime12h', 'formatUsaDate', 'computeCingularBiWeeklyPeriods', 'isPayrollSyncMinuteInLosAngeles']
let source = ''
for (const path of ['app/admin/ronos/page.tsx', 'app/api/cron/sync-daily-payroll/route.ts']) {
  const file = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  for (const node of file.statements) if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) source += node.getText(file) + '\n'
}
const code = ts.transpileModule(source + '\n({ ' + names.join(', ') + ' })', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
const api = vm.runInNewContext(code, { Date, Intl })
for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
  process.env.TZ = zone
  for (const [iso, expected] of [['2026-09-17T12:59:00Z','5:59 AM'],['2026-09-17T13:00:00Z','6:00 AM'],['2026-09-17T23:59:00Z','4:59 PM'],['2026-09-18T00:00:00Z','5:00 PM']]) assert.equal(api.formatTime12h(iso), expected)
  assert.equal(api.computeCingularBiWeeklyPeriods([]).length, 0)
  const periods = api.computeCingularBiWeeklyPeriods([{weekId:1,startDate:'2026-10-19',endDate:'2026-10-25'},{weekId:2,startDate:'2026-10-26',endDate:'2026-11-01'}])
  assert.equal(periods[0].startDate, '2026-10-19')
  assert.equal(periods[0].endDate, '2026-11-01')
  assert.equal(api.isPayrollSyncMinuteInLosAngeles(new Date('2026-09-17T18:59:00Z')), true)
  assert.equal(api.isPayrollSyncMinuteInLosAngeles(new Date('2026-09-17T19:59:00Z')), false)
  assert.equal(api.isPayrollSyncMinuteInLosAngeles(new Date('2026-12-17T19:59:00Z')), true)
  assert.equal(api.isPayrollSyncMinuteInLosAngeles(new Date('2026-12-17T18:59:00Z')), false)
}
console.log('PASS: límites 5:59/6:00, 16:59/17:00, calendario DST y cron verano/invierno en tres zonas.')
