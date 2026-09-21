/**
 * @module payroll-evidence
 * @description Reglas puras para contrastar una proyección con recibos de nómina.
 * @businessRules Un recibo debe estar aprobado, corresponder al período completo
 * y tener identidad inequívoca. Coincidencia de bruto no certifica facturación.
 * @dataFlow Tarjetas RONOS y paystubs -> identificación -> comparación en centavos.
 * @notes Ausencia de importe no equivale a cero; un nombre solo propone un candidato.
 */
export interface PayrollEvidence {
  id: string
  assignmentId?: string
  employeeNumber?: string
  employeeName?: string
  firstName?: string
  lastName?: string
  siteId?: string
  payPeriodStart?: string
  payPeriodEnd?: string
  status?: string
  grossWages?: number
  invoiceId?: string
  batchId?: string
}

export function normalizePayrollName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\s+/g, ' ').trim()
}

export function moneyCents(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const cents = Math.round((number + Math.sign(number) * Number.EPSILON) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function isClosedPayrollEvidence(stub: PayrollEvidence, start: string, end: string): boolean {
  return !!stub.id && ['approved', 'paid'].includes(String(stub.status || '').toLowerCase()) &&
    !!start && !!end && stub.payPeriodStart?.slice(0, 10) === start && stub.payPeriodEnd?.slice(0, 10) === end
}

export function matchPayrollEvidence(
  employee: { pin: string; fullName: string; ronosAssignmentId?: string | null },
  peers: Array<{ pin: string; fullName: string; ronosAssignmentId?: string | null }>,
  stubs: PayrollEvidence[]
): { stub?: PayrollEvidence; method: 'assignment_id' | 'employee_number' | 'name_candidate' | 'ambiguous' | 'missing' } {
  const unique = [...new Map(stubs.filter(s => s.id).map(s => [s.id, s])).values()]
  const assignmentId = String(employee.ronosAssignmentId || '').trim()
  if (assignmentId) {
    const byAssignment = unique.filter(s => String(s.assignmentId || '').trim() === assignmentId)
    if (byAssignment.length) {
      if (byAssignment.length !== 1 || peers.filter(p => String(p.ronosAssignmentId || '').trim() === assignmentId).length !== 1) return { method: 'ambiguous' }
      return { stub: byAssignment[0], method: 'assignment_id' }
    }
  }
  const pin = employee.pin.trim()
  const byId = unique.filter(s => pin && String(s.employeeNumber || '').trim() === pin)
  if (byId.length) {
    if (byId.length !== 1 || peers.filter(p => p.pin.trim() === pin).length !== 1) return { method: 'ambiguous' }
    return { stub: byId[0], method: 'employee_number' }
  }
  const name = normalizePayrollName(employee.fullName)
  if (!name) return { method: 'missing' }
  const byName = unique.filter(s => {
    const full = s.firstName && s.lastName ? `${s.firstName} ${s.lastName}` :
      s.employeeName?.includes(',') ? s.employeeName.split(',').reverse().join(' ') : s.employeeName || ''
    return normalizePayrollName(full) === name
  })
  if (byName.length !== 1 || peers.filter(p => normalizePayrollName(p.fullName) === name).length !== 1) {
    return { method: byName.length ? 'ambiguous' : 'missing' }
  }
  return { stub: byName[0], method: 'name_candidate' }
}

export function comparePayrollGross(calculated: number, stub?: PayrollEvidence, verifiedIdentity = false) {
  const actual = moneyCents(calculated)
  const expected = moneyCents(stub?.grossWages)
  if (!verifiedIdentity || actual === null || expected === null) {
    return { auditStatus: 'estimated' as const, auditBadgeText: 'Estimado', grossPayVariance: undefined }
  }
  const difference = (actual - expected) / 100
  return {
    auditStatus: difference === 0 ? 'paystub_match' as const : 'variance' as const,
    auditBadgeText: difference === 0 ? 'Bruto coincide con recibo' : 'Diferencia de bruto',
    grossPayVariance: difference
  }
}
