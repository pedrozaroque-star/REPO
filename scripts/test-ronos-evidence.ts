/**
 * @module test-ronos-evidence
 * @description Simulación de conciliación sobre lógica real y recibos reales de Hollywood.
 * @businessRules Solo lectura; no imprime información personal ni certifica facturas.
 * @dataFlow Reglas puras + Simplify HR paginado + caché RONOS -> aserciones.
 * @notes Los casos límite son entradas de prueba a funciones reales, sin sustituir servicios.
 */
import assert from 'node:assert/strict'
import { moneyCents, normalizePayrollName, comparePayrollGross, isClosedPayrollEvidence, matchPayrollEvidence } from '../lib/payroll-evidence'
import { loadPeriodPaystubs } from '../lib/payroll-paystubs'
import { RONOS_TO_SIMPLIFY_SITE_MAP } from '../lib/simplifyhr-api'
import { supabaseAdmin } from '../lib/supabase'
import { calculateCingularPayrollReport } from '../lib/payroll-calculator'

async function main() {
  for (const value of [undefined, null, '', '   ', [], {}, NaN, Infinity, -Infinity, false]) assert.equal(moneyCents(value), null)
  assert.equal(moneyCents(0), 0)
  assert.equal(moneyCents(1.005), 101)
  assert.equal(normalizePayrollName('  MIÉRCOLES SÁBADO  '), normalizePayrollName('Miercoles Sabado'))
  assert.equal(comparePayrollGross(0).auditStatus, 'estimated')
  const start = '2026-08-24', end = '2026-09-06'
  const stubs = await loadPeriodPaystubs(RONOS_TO_SIMPLIFY_SITE_MAP[26], start, end)
  assert.ok(stubs.length > 0, 'La prueba necesita recibos reales')
  assert.equal(new Set(stubs.map(s => s.id)).size, stubs.length)
  for (const stub of stubs) {
    assert.equal(stub.siteId, RONOS_TO_SIMPLIFY_SITE_MAP[26])
    assert.equal(stub.payPeriodStart?.slice(0, 10), start)
    assert.equal(stub.payPeriodEnd?.slice(0, 10), end)
  }
  const approved = stubs.filter(s => isClosedPayrollEvidence(s, start, end))
  assert.ok(approved.length > 0)
  const sample = approved.find(s => Number.isFinite(s.grossWages))!
  assert.ok(sample)
  assert.equal(isClosedPayrollEvidence(sample, start, '2026-09-07'), false)
  assert.equal(isClosedPayrollEvidence({ ...sample, status: 'draft' }, start, end), false)
  assert.equal(comparePayrollGross(sample.grossWages!, sample, true).auditStatus, 'paystub_match')
  assert.equal(comparePayrollGross(sample.grossWages! + .01, sample, true).auditStatus, 'variance')
  assert.equal(comparePayrollGross(sample.grossWages!, sample, false).auditStatus, 'estimated')
  assert.equal(comparePayrollGross(0, { ...sample, grossWages: undefined }, true).auditStatus, 'estimated')
  const nativeLinkedStub = { ...sample, id: 'native-assignment-test', assignmentId: 'shr-assignment-123' }
  const nativeLinkedEmployee = { pin: '', fullName: 'Nombre que no debe importar', ronosAssignmentId: 'shr-assignment-123' }
  assert.equal(matchPayrollEvidence(nativeLinkedEmployee, [nativeLinkedEmployee], [nativeLinkedStub]).method, 'assignment_id')
  assert.equal(matchPayrollEvidence(nativeLinkedEmployee, [nativeLinkedEmployee, nativeLinkedEmployee], [nativeLinkedStub]).method, 'ambiguous')
  if (sample.employeeNumber) {
    const person = { pin: String(sample.employeeNumber), fullName: sample.employeeName || '' }
    assert.equal(matchPayrollEvidence(person, [person], [sample]).method, 'employee_number')
    assert.equal(matchPayrollEvidence(person, [person, person], [sample]).method, 'ambiguous')
    assert.equal(matchPayrollEvidence(person, [person], [sample, { ...sample, id: 'duplicate-test' }]).method, 'ambiguous')
  }
  const { data, error } = await supabaseAdmin.from('ronos_employee_timecards_cache')
    .select('pin,full_name').eq('company_id', 26).in('week_id', [155953, 155954])
  if (error) throw error
  assert.ok(data?.length)
  const report = await calculateCingularPayrollReport(26, [155953, 155954], true)
  assert.equal(report.billingStatus, 'estimated')
  assert.equal(report.exactMatchesCount, 0)
  assert.equal(report.invoiceId, undefined)
  assert.equal(report.supplementalsCount, 0)
  assert.ok(report.invoiceReconciliation, 'Hollywood debe encontrar la factura documental del período')
  assert.equal(report.invoiceReconciliation?.status, 'incomplete', 'Los nombres no validan el vínculo RONOS–Simplify')
  assert.equal(report.invoiceReconciliation?.officialGrossPay, 36594.94)
  assert.equal(report.invoiceReconciliation?.officialBilledAmount, 46064.13)
  assert.equal(report.invoiceReconciliation?.matchedEmployees, 0)
  assert.ok((report.invoiceReconciliation?.candidateEmployees || 0) > 0)
  assert.equal(report.invoicePayrollVerification?.status, 'matched')
  assert.equal(report.invoicePayrollVerification?.grossMatches, 18)
  assert.equal(report.invoicePayrollVerification?.grossVariance, 0)
  assert.equal(report.unmatchedPaystubsCount || 0, report.invoicePayrollVerification?.unmatchedPaystubs || 0, 'El conteo de pendientes debe coincidir con la conciliación documental')
  const centralReport = await calculateCingularPayrollReport(31, [155964, 155963], true)
  assert.equal(centralReport.unmatchedPaystubsCount || 0, 0, 'LA Central no debe dejar recibos pendientes cuando los pagos salariales están identificados')
  assert.equal(centralReport.salariedPaystubsWithoutRonosCount || 0, 2, 'Javier Pastor y el otro pago salarial de LA Central se presentan como pagos sin tarjeta RONOS, no como errores')
  assert.ok(report.employees.length > 0)
  assert.ok(Number.isFinite(report.totalGrossPay) && Number.isFinite(report.totalInvoicedAmount))
  assert.ok(report.employees.every(e => e.auditStatus !== 'exact'))
  assert.equal(Math.round(report.employees.reduce((sum, e) => sum + e.totalGrossPay, 0) * 100), Math.round(report.totalGrossPay * 100))
  assert.equal(Math.round(report.employees.reduce((sum, e) => sum + e.holidayHours, 0) * 100), Math.round((report.totalHolidayHours || 0) * 100))
  await assert.rejects(() => calculateCingularPayrollReport(26, [155953], true))
  await assert.rejects(() => calculateCingularPayrollReport(26, [155953, 155953], true))
  console.log(`PASS: cálculo real Hollywood; ${report.employees.length} colaboradores, factura documental identificada sin fingir vínculo RONOS, totales finitos y suma consistente.`)
  console.log(`PASS: reglas monetarias, identidad, períodos y paginación real; ${stubs.length} recibos del período, ${approved.length} aprobados, ${data.length} tarjetas. Cero escrituras.`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
