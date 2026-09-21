/**
 * @module payroll-invoice-evidence
 * @description Comparación documental trazable entre facturas Cingular, nómina aprobada y cálculo independiente RONOS.
 * @businessRules Tienda y período exactos; ninguna tarifa/importación corrige el cálculo para forzar igualdad.
 * Los PDF sin clasificación no se asignan a ordinaria/suplementaria por el nombre de archivo.
 * Un EMP ID impreso puede pertenecer al espacio de empleados o asignaciones: se exige unicidad en ambas fuentes.
 * Los nombres son candidatos, nunca prueba de identidad. Importes ausentes no equivalen a cero.
 * @dataFlow PDFs -> extractor validado (SHA256/página/totales) -> evidencia JSON -> comparación sin escrituras.
 * @notes Diferencias = cálculo menos factura. Coincidencia documental no certifica las tarifas contractuales de la agencia.
 */
import documents from '../data/payroll/invoice-evidence.json'
import { moneyCents, normalizePayrollName, isClosedPayrollEvidence, type PayrollEvidence } from './payroll-evidence'

export type InvoiceDocument = (typeof documents)[number]
export type InvoiceRow = InvoiceDocument['employees'][number]
export type InvoiceMode = 'regular' | 'supplemental' | 'consolidated'
export interface InvoiceEmployeeEvidence {
  invoiceId: string; sourceFile: string; employeeNumber: string | null; officialName: string
  officialGrossPay: number; officialBilledAmount: number
  grossVariance: number | null; billingVariance: number | null; regularHoursVariance: number | null
  overtimeHoursVariance: number | null; ptoHoursVariance: number | null
  officialPayRate: number; officialBillRate: number
  rateSource: 'official_invoice'; identityVerified: boolean
  status: 'matched' | 'variance' | 'incomplete'
}
export interface InvoiceReconciliation {
  invoiceIds: string[]; sourceFiles: string[]; officialGrossPay: number; officialBilledAmount: number
  estimatedGrossPay: number | null; estimatedBilledAmount: number | null; grossVariance: number | null; billingVariance: number | null
  matchedEmployees: number; candidateEmployees: number; unmatchedInvoiceEmployees: number; unmatchedRonosEmployees: number
  unclassifiedInvoices: number; scopeVerified: boolean
  status: 'matched' | 'variance' | 'incomplete'
}
export interface InvoicePayrollVerification {
  invoiceEmployees: number; approvedPaystubs: number; linkedEmployees: number
  grossMatches: number; grossVariances: number; unmatchedInvoiceEmployees: number; unmatchedPaystubs: number
  grossVariance: number | null; status: 'matched' | 'variance' | 'incomplete'
}
type PaymentIdentity = { employeeNumber?: string | null; assignmentId?: string | null }
type ProjectionEmployee = {
  employeeUserId: number; fullName: string; totalGrossPay: number; totalInvoicedAmount: number
  regularHours: number; overtimeHours: number; sickHours: number; vacationHours: number; holidayHours: number
  simplifyEmployeeNumber?: string | null; ronosAssignmentId?: string | null; identityVerified?: boolean
}
const clean = (value: unknown) => value == null ? '' : String(value).trim()
const difference = (a: unknown, b: unknown): number | null => {
  const left = moneyCents(a), right = moneyCents(b)
  return left === null || right === null ? null : (left - right) / 100
}
const sum = (values: number[]): number | null => {
  const cents = values.map(moneyCents)
  return cents.some(value => value === null) ? null : cents.reduce<number>((total,value) => total + value!, 0) / 100
}
/** Exact whole-document period only: never prorate a three-week invoice into a fortnight. */
export function getInvoiceDocuments(companyId: number, start: string, end: string): InvoiceDocument[] {
  return documents.filter(d => d.companyId === companyId && d.periodStart === start && d.periodEnd === end)
}
/** Printed EMP ID has no guaranteed namespace. Reject cross-namespace collisions and duplicate rows. */
export function getInvoiceRowForPayment(invoices: InvoiceDocument[], payment: PaymentIdentity) {
  const ids = new Set([clean(payment.employeeNumber), clean(payment.assignmentId)].filter(Boolean))
  if (!ids.size) return undefined
  const matches = invoices.flatMap(invoice => invoice.employees.filter(row =>
    !!clean(row.employeeNumber) && ids.has(clean(row.employeeNumber))).map(row => ({ invoice, row })))
  return matches.length === 1 ? matches[0] : undefined
}
function scopedDocuments(companyId: number, start: string, end: string, mode: InvoiceMode) {
  // Keep unclassified documents visible but never claim a partial-mode scope is reconciled.
  return getInvoiceDocuments(companyId, start, end).filter(d => mode === 'consolidated' || d.mode === mode || d.mode === 'unclassified')
}
function identity(employee: ProjectionEmployee): PaymentIdentity {
  return { employeeNumber: employee.simplifyEmployeeNumber, assignmentId: employee.ronosAssignmentId }
}

export function reconcileInvoiceEvidence(companyId: number, start: string, end: string,
  mode: InvoiceMode, employees: ProjectionEmployee[]) {
  const invoices = scopedDocuments(companyId,start,end,mode)
  if (!invoices.length) return undefined
  const officialRows = invoices.flatMap(invoice => invoice.employees.map(row => ({ invoice, row })))
  const evidence = new Map<number, InvoiceEmployeeEvidence>()
  const used = new Set<InvoiceRow>()
  const nativeMatches = employees.map(e => e.identityVerified ? getInvoiceRowForPayment(invoices, identity(e)) : undefined)
  let verified = 0, candidates = 0
  employees.forEach((employee, index) => {
    // Duplicate projection IDs would otherwise overwrite evidence and falsify coverage.
    if (employees.filter(e => e.employeeUserId === employee.employeeUserId).length !== 1) return
    let match = nativeMatches[index]
    let identityVerified = !!match && nativeMatches.filter(m => m?.row === match?.row).length === 1
    if (!identityVerified) {
      const name = normalizePayrollName(employee.fullName)
      if (!name || employees.filter(e => normalizePayrollName(e.fullName) === name).length !== 1) return
      const rows = officialRows.filter(({row}) => normalizePayrollName(row.fullName) === name)
      if (rows.length !== 1) return
      match = rows[0]
    }
    if (!match) return
    const {row,invoice} = match
    const grossVariance = difference(employee.totalGrossPay,row.grossPay)
    const billingVariance = difference(employee.totalInvoicedAmount,row.billedAmount)
    const regularHoursVariance = difference(employee.regularHours,row.regularHours)
    const overtimeHoursVariance = difference(employee.overtimeHours,row.overtimeHours)
    const ptoHoursVariance = difference(employee.sickHours + employee.vacationHours + employee.holidayHours,
      row.sickHours + row.vacationHours + row.holidayHours)
    const deltas = [grossVariance,billingVariance,regularHoursVariance,overtimeHoursVariance,ptoHoursVariance]
    const status = !identityVerified || deltas.some(d => d === null) ? 'incomplete' : deltas.some(d => d !== 0) ? 'variance' : 'matched'
    if (identityVerified) { verified++; used.add(row) } else candidates++
    evidence.set(employee.employeeUserId, {
      invoiceId:invoice.invoiceId,sourceFile:invoice.sourceFile,employeeNumber:row.employeeNumber,officialName:row.fullName,
      officialGrossPay:row.grossPay,officialBilledAmount:row.billedAmount,officialPayRate:row.payRate,officialBillRate:row.billRate,
      grossVariance,billingVariance,regularHoursVariance,overtimeHoursVariance,ptoHoursVariance,
      rateSource:'official_invoice',identityVerified,status
    })
  })
  const officialGrossPay = sum(invoices.map(i => i.grossPay))!
  const officialBilledAmount = sum(invoices.map(i => i.billedAmount))!
  const estimatedGrossPay = sum(employees.map(e => e.totalGrossPay))
  const estimatedBilledAmount = sum(employees.map(e => e.totalInvoicedAmount))
  const grossVariance = difference(estimatedGrossPay,officialGrossPay)
  const billingVariance = difference(estimatedBilledAmount,officialBilledAmount)
  const unclassifiedInvoices = invoices.filter(i => i.mode === 'unclassified').length
  const scopeVerified = mode === 'consolidated' || !unclassifiedInvoices
  const incomplete = !scopeVerified || used.size !== officialRows.length || verified !== employees.length ||
    grossVariance === null || billingVariance === null || [...evidence.values()].some(e => e.status === 'incomplete')
  const summary: InvoiceReconciliation = {
    invoiceIds:invoices.map(i => i.invoiceId),sourceFiles:invoices.map(i => i.sourceFile),officialGrossPay,officialBilledAmount,
    estimatedGrossPay,estimatedBilledAmount,grossVariance,billingVariance,matchedEmployees:verified,candidateEmployees:candidates,
    unmatchedInvoiceEmployees:officialRows.length-used.size,unmatchedRonosEmployees:employees.length-verified,
    unclassifiedInvoices,scopeVerified,
    status:incomplete ? 'incomplete' : grossVariance || billingVariance || [...evidence.values()].some(e => e.status === 'variance') ? 'variance' : 'matched'
  }
  return {summary,evidence}
}

/** Approved exact-period receipts only. Name-only and reused/colliding IDs never certify a link. */
export function verifyInvoicePayrollEvidence(companyId: number, start: string, end: string,
  mode: InvoiceMode, paystubs: PayrollEvidence[]) {
  const invoices = scopedDocuments(companyId,start,end,mode)
  if (!invoices.length) return undefined
  const rows = invoices.flatMap(i => i.employees)
  const approved = paystubs.filter(p => isClosedPayrollEvidence(p,start,end))
  const matches = approved.map(p => getInvoiceRowForPayment(invoices,p))
  let linkedEmployees = 0, grossMatches = 0, grossVariances = 0, grossVarianceCents = 0, missingAmount = false
  approved.forEach((stub,index) => {
    const match = matches[index]
    if (!match || matches.filter(m => m?.row === match.row).length !== 1 || approved.filter(p => p.id === stub.id).length !== 1) return
    linkedEmployees++
    const delta = difference(stub.grossWages,match.row.grossPay)
    if (delta === null) missingAmount = true
    else if (delta === 0) grossMatches++
    else { grossVariances++; grossVarianceCents += Math.round(delta*100) }
  })
  const scopeVerified = mode === 'consolidated' || invoices.every(i => i.mode !== 'unclassified')
  const incomplete = !scopeVerified || missingAmount || linkedEmployees !== rows.length || linkedEmployees !== approved.length
  return {
    invoiceEmployees:rows.length,approvedPaystubs:approved.length,linkedEmployees,grossMatches,grossVariances,
    unmatchedInvoiceEmployees:rows.length-linkedEmployees,unmatchedPaystubs:approved.length-linkedEmployees,
    grossVariance:missingAmount ? null : grossVarianceCents/100,
    status:incomplete ? 'incomplete' : grossVariances ? 'variance' : 'matched'
  } satisfies InvoicePayrollVerification
}
