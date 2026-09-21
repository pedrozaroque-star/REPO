/**
 * @module payroll-reconciliation
 * @description Cálculo independiente y trazable de horas, nómina aprobada y factura.
 * @businessRules Nunca usa importes ni tarifas de factura para ajustar la proyección.
 * Identidad por assignmentId unívoco dentro de tienda; nombres solo sugieren revisión.
 * Pagos sin reloj se conservan separados, sin sumar de nuevo tarjetas sin vínculo.
 * @dataFlow Capturas de lectura RONOS/Simplify -> operaciones monetarias -> comparación PDF.
 * @notes Sin red ni escrituras. Tarifas actuales sin vigencia histórica no certifican un cobro.
 */
import type { SimplifyHrPaystub } from './simplifyhr-api'
import type { CingularEmployeePayrollItem, CingularInvoiceSummaryReport } from './payroll-calculator'
import { isClosedPayrollEvidence, moneyCents, normalizePayrollName } from './payroll-evidence'
import { reconcileInvoiceEvidence, verifyInvoicePayrollEvidence } from './payroll-invoice-evidence'

export const safeNum = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value); return Number.isFinite(n) ? n : fallback
}
export const safeDiv = (a: number, b: number, fallback = 0) => b && Number.isFinite(a / b) ? a / b : fallback
export const safeRound = (value: number, decimals = 2) => {
  const factor = 10 ** decimals
  return Math.round((safeNum(value) + Math.sign(value) * Number.EPSILON) * factor) / factor
}
const sumMoney = (values: number[]) => values.reduce((a, b) => a + (moneyCents(b) ?? 0), 0) / 100
const id = (v: unknown) => String(v ?? '').trim()
export interface PayrollCard {
  company_id: number; week_id: number; employee_user_id: number; ronos_assignment_id?: string | null
  full_name?: string; first_name?: string; last_name?: string; pin?: string; job_title?: string
  regular_hours?: number; overtime_hours?: number; double_time_hours?: number; total_weekly_hours?: number
  sick_hours?: number; vacation_hours?: number; holiday_hours?: number; bereavement_hours?: number
  meal_penalty_count?: number; broken_hours?: boolean
}
export interface PayrollRate {
  ronos_company_id: number; employee_id: string; ronos_assignment_id?: string | null
  pay_rate: number; bill_rate: number; ot_pay_rate?: number; ot_bill_rate?: number
  is_salaried?: boolean; job_title?: string
}
export interface PayrollInputs {
  companyId: number; storeId: number; storeName: string; storeCode: string; siteId: string
  start: string; end: string; isBiWeekly: boolean; mode: 'regular' | 'supplemental' | 'consolidated'
  cards: PayrollCard[]; rates: PayrollRate[]; stubs: SimplifyHrPaystub[]
  paystubCoverageComplete: boolean; clockCoverageComplete: boolean; warnings?: string[]
  supervisorPaystubIds?: string[]
}
type Bucket = 'regular' | 'salary' | 'overtime' | 'doubleTime' | 'sick' | 'vacation' | 'holiday' | 'meal' | 'bereavement' | 'other'
function bucket(e: NonNullable<SimplifyHrPaystub['earnings']>[number]): Bucket {
  const c = String(e.systemCode || e.paycodeName || e.type || '').toLowerCase().replace(/[^a-z]/g, '')
  if (c.includes('unpaid')) return 'other'
  if (c.includes('salary')) return 'salary'
  if (c.includes('double')) return 'doubleTime'
  if (c.includes('overtime')) return 'overtime'
  if (c.includes('sick')) return 'sick'
  if (c.includes('vacation') || c === 'pto') return 'vacation'
  if (c.includes('holiday')) return 'holiday'
  if (c.includes('meal')) return 'meal'
  if (c.includes('bereavement')) return 'bereavement'
  if (c.includes('regular')) return 'regular'
  return 'other'
}
const emptyHours = (): Record<Bucket, number> => ({regular:0,salary:0,overtime:0,doubleTime:0,sick:0,vacation:0,holiday:0,meal:0,bereavement:0,other:0})

/** No se consulta la factura dentro del cálculo; únicamente se compara al terminar. */
export function buildPayrollReport(input: PayrollInputs): CingularInvoiceSummaryReport {
  const warnings = [...(input.warnings || [])]
  const uniqueStubs = new Map<string, SimplifyHrPaystub>()
  for (const s of input.stubs) {
    if (s.siteId !== input.siteId || !isClosedPayrollEvidence(s, input.start, input.end)) continue
    if (uniqueStubs.has(s.id)) throw new Error('Recibo duplicado: no se puede certificar la cobertura')
    uniqueStubs.set(s.id, s)
  }
  const stubs = [...uniqueStubs.values()]
  // El endpoint no aporta una clasificación de lote confiable. No inventar finiquitos por nombre.
  const scopeKnown = input.mode === 'consolidated'
  if (!scopeKnown) warnings.push('La fuente no certifica el tipo de lote. Seleccione Todos los pagos para comparar el período completo.')
  const complete = input.paystubCoverageComplete && stubs.every(s => moneyCents(s.grossWages) !== null)
  const useApprovedScope = stubs.length > 0
  const groups = new Map<number, PayrollCard[]>()
  const seenCards = new Set<string>()
  for (const card of input.cards) {
    if (card.company_id !== input.companyId || !Number.isSafeInteger(card.employee_user_id)) continue
    const key = `${card.week_id}:${card.employee_user_id}`
    if (seenCards.has(key)) throw new Error('Tarjeta duplicada: revisar la caché de asistencia')
    seenCards.add(key)
    const list = groups.get(card.employee_user_id) || []; list.push(card); groups.set(card.employee_user_id, list)
  }
  const assignmentByUser = new Map<number, string>()
  for (const [uid, cards] of groups) {
    const assignments = [...new Set(cards.map(c => id(c.ronos_assignment_id)).filter(Boolean))]
    if (assignments.length === 1) assignmentByUser.set(uid, assignments[0])
  }
  const assignmentUnique = (assignment: string) => assignment && [...assignmentByUser.values()].filter(x => x === assignment).length === 1
  const used = new Set<string>()
  const employees: CingularEmployeePayrollItem[] = []

  function calculate(cards: PayrollCard[], receipts: SimplifyHrPaystub[], uid: number) {
    const card = cards[0], stub = receipts[0]
    const assignment = stub ? id(stub.assignmentId) : assignmentByUser.get(uid) || ''
    const candidates = input.rates.filter(r => r.ronos_company_id === input.companyId &&
      ((assignment && id(r.ronos_assignment_id) === assignment) || (stub?.employeeNumber && id(r.employee_id) === id(stub.employeeNumber))))
    const rate = candidates.length === 1 ? candidates[0] : undefined
    const knownSupervisor = receipts.some(s => input.supervisorPaystubIds?.includes(s.id))
    const earnings = receipts.flatMap(s => s.earnings || [])
    const validClock = cards.length > 0 && cards.every(c =>
      [c.regular_hours,c.overtime_hours,c.double_time_hours].every(v=>moneyCents(v)!==null))
    const paidRates = (kind: 'base' | 'overtime' | 'doubleTime') => new Set(earnings.filter(e=>safeNum(e.units ?? e.hours)>0 &&
      (kind==='base' ? !['overtime','doubleTime','other'].includes(bucket(e)) : bucket(e)===kind)).map(e=>e.rate))
    const clockRateUnambiguous = ['base','overtime','doubleTime'].every(k=>paidRates(k as 'base'|'overtime'|'doubleTime').size<=1)
    const salaried = earnings.some(e => bucket(e) === 'salary') || (!receipts.length && rate?.is_salaried === true)
    const hours = emptyHours(), clock = emptyHours()
    for (const c of cards) {
      clock.regular += safeNum(c.regular_hours); clock.overtime += safeNum(c.overtime_hours)
      clock.doubleTime += safeNum(c.double_time_hours); clock.sick += safeNum(c.sick_hours)
      clock.vacation += safeNum(c.vacation_hours); clock.holiday += safeNum(c.holiday_hours)
      clock.bereavement += safeNum(c.bereavement_hours)
      // Una alerta de lunch no constituye un concepto autorizado de pago.
    }
    if (salaried) { clock.salary = clock.regular; clock.regular = 0 }
    const base = earnings.find(e => ['regular','salary'].includes(bucket(e)) && Number.isFinite(e.rate))?.rate ?? rate?.pay_rate
    const otRate = earnings.find(e => bucket(e) === 'overtime' && Number.isFinite(e.rate))?.rate ?? rate?.ot_pay_rate
    const dtRate = earnings.find(e => bucket(e) === 'doubleTime' && Number.isFinite(e.rate))?.rate
    const payRate = safeNum(base)
    const factor = salaried ? 1.2451 : 1.26
    // Factores de proyección existentes; NO se presentan como contrato histórico certificado.
    const billRate = safeRound(payRate * factor)
    const gross: Record<Bucket, number> = emptyHours(), billed: Record<Bucket, number> = emptyHours()
    let unsupported = receipts.length > 0 && earnings.length === 0
    if (receipts.length) {
      for (const e of earnings) {
        const kind = bucket(e), units = e.units ?? e.hours
        if (kind === 'other') {
          if (safeNum(e.amount) !== 0 || safeNum(units) !== 0) unsupported = true
          continue
        }
        if (moneyCents(units) === null || moneyCents(e.rate) === null) { if (safeNum(e.amount) !== 0 || safeNum(units) !== 0) unsupported = true; continue }
        hours[kind] += safeNum(units)
        gross[kind] = sumMoney([gross[kind], safeRound(safeNum(units) * safeNum(e.rate))])
        billed[kind] = sumMoney([billed[kind], safeRound(safeNum(units) * safeRound(safeNum(e.rate) * factor))])
      }
    } else {
      Object.assign(hours, clock)
      for (const c of cards) {
        const parts: Array<[Bucket, number, number]> = [
          [salaried ? 'salary' : 'regular', safeNum(c.regular_hours), payRate],
          ['overtime', safeNum(c.overtime_hours), safeNum(otRate, safeRound(payRate * 1.5))],
          ['doubleTime', safeNum(c.double_time_hours), safeNum(dtRate, safeRound(payRate * 2))],
          ['sick', safeNum(c.sick_hours), payRate], ['vacation', safeNum(c.vacation_hours), payRate],
          ['holiday', safeNum(c.holiday_hours), payRate], ['bereavement', safeNum(c.bereavement_hours), payRate]
        ]
        for (const [kind, units, price] of parts) {
          gross[kind] = sumMoney([gross[kind], safeRound(units * price)])
          billed[kind] = sumMoney([billed[kind], safeRound(units * safeRound(price * factor))])
        }
      }
    }
    const clockGross = sumMoney(cards.map(c => sumMoney([
      safeRound((safeNum(c.regular_hours) + safeNum(c.sick_hours) + safeNum(c.vacation_hours) + safeNum(c.holiday_hours) + safeNum(c.bereavement_hours)) * payRate),
      safeRound(safeNum(c.overtime_hours) * safeNum(otRate, safeRound(payRate * 1.5))),
      safeRound(safeNum(c.double_time_hours) * safeNum(dtRate, safeRound(payRate * 2)))
    ])))
    const excluded = useApprovedScope && !receipts.length
    const totalGross = sumMoney(Object.values(gross)), totalBill = sumMoney(Object.values(billed))
    const native = cards.length > 0 && receipts.length > 0
    const officialGross = receipts.length && receipts.every(s => moneyCents(s.grossWages) !== null)
      ? sumMoney(receipts.map(s => s.grossWages!)) : undefined
    const clockVariance = native && validClock ? safeRound(Object.values(clock).reduce((a,b) => a+b,0) - Object.values(hours).reduce((a,b)=>a+b,0)) : undefined
    const clockDetailMismatch = native && (Object.keys(clock) as Bucket[]).some(k => Math.abs(clock[k] - hours[k]) > 0.005)
    const grossVariance = officialGross === undefined ? undefined : safeRound(totalGross - officialGross)
    const fullName = stub ? `${stub.firstName || ''} ${stub.lastName || ''}`.trim() || stub.employeeName || 'Identidad pendiente'
      : card?.full_name || `${card?.first_name || ''} ${card?.last_name || ''}`.trim()
    const note = excluded ? 'Tarjeta sin vínculo nativo: se conserva para revisión y no se suma de nuevo a la nómina aprobada.'
      : unsupported ? 'Hay conceptos o importes sin una regla de cálculo verificable. Revisar el desglose del recibo.'
      : receipts.length && !native ? knownSupervisor ? 'Pago de supervisor en su tienda pagadora; no requiere tarjeta de asistencia.'
        : 'Pago aprobado en esta tienda, pendiente de vincular con asistencia. No se ha vinculado por nombre.'
      : clockDetailMismatch ? 'Las horas o conceptos aprobados difieren del reloj. Se conservan ambas fuentes para revisar el ajuste.'
      : 'Cálculo independiente. Las tarifas de facturación son una proyección, sin vigencia contractual histórica certificada.'
    const other = (x: Record<Bucket,number>) => sumMoney([x.sick,x.vacation,x.holiday,x.meal,x.bereavement,x.other])
    employees.push({
      employeeId: stub?.employeeNumber || card?.pin || String(uid), employeeUserId: uid,
      firstName: stub?.firstName || card?.first_name || '', lastName: stub?.lastName || card?.last_name || '', fullName,
      jobTitle: rate?.job_title || card?.job_title || (salaried ? 'Personal asalariado' : 'Por confirmar'),
      isSalaried: salaried, isAdministrativeSupervisor: knownSupervisor, siteName: input.storeName,
      humanLabel: knownSupervisor ? 'Supervisor · pagado por ' + input.storeName : undefined,
      payRate, billRate, regularHours: safeRound(hours.regular), salaryHours: safeRound(hours.salary),
      overtimeHours: safeRound(hours.overtime), doubleTimeHours: safeRound(hours.doubleTime),
      sickHours: safeRound(hours.sick), vacationHours: safeRound(hours.vacation), holidayHours: safeRound(hours.holiday),
      mealPenaltyHours: safeRound(hours.meal), totalHours: safeRound(Object.values(hours).reduce((a,b)=>a+b,0)),
      grossRegularPay: sumMoney([gross.regular,gross.salary]), grossOvertimePay: gross.overtime,
      grossDoubleTimePay: gross.doubleTime, grossOtherPay: other(gross), totalGrossPay: totalGross,
      invoicedRegularCost: sumMoney([billed.regular,billed.salary]), invoicedOvertimeCost: billed.overtime,
      invoicedDoubleTimeCost: billed.doubleTime, invoicedOtherCost: other(billed), totalInvoicedAmount: totalBill,
      cingularFeeAmount: safeRound(totalBill-totalGross), markupPercentage: safeRound(safeDiv(totalBill-totalGross,totalGross)*100),
      hasNativeMatch: native, paystubId: stub?.id, paystubIds: receipts.map(s=>s.id),
      payrollSource: receipts.length && !cards.length ? 'simplify_only' : 'ronos', excludedFromPayroll: excluded,
      ronosAssignmentId: assignment || undefined, simplifyEmployeeNumber: stub?.employeeNumber,
      identityVerified: !!stub && (!!stub.employeeNumber || !!stub.assignmentId),
      officialGrossPay: officialGross, grossPayVariance: grossVariance,
      ronosEstimatedGrossPay: validClock && clockRateUnambiguous && payRate > 0 ? clockGross : null,
      clockHoursVariance: clockVariance, clockHours: validClock ? clock : undefined,
      calculationComplete: !unsupported && payRate > 0 && (receipts.length > 0 || validClock),
      rateSource: receipts.length ? 'paystub' : rate ? 'simplify' : 'unknown',
      evidenceSource: receipts.length ? 'simplify_paystub' : 'ronos_cache',
      auditStatus: unsupported || payRate <= 0 ? 'insufficient_data' : excluded || clockDetailMismatch || grossVariance || (!native && !knownSupervisor) ? 'requires_investigation' : 'estimated',
      auditBadgeText: excluded ? 'Vínculo pendiente' : grossVariance ? 'Diferencia con recibo' : 'Facturación estimada', auditNote: note
    })
  }
  for (const [uid, cards] of groups) {
    const assignment = assignmentByUser.get(uid) || ''
    const matched = assignmentUnique(assignment) ? stubs.filter(s => id(s.assignmentId) === assignment) : []
    // Varios pagos de una asignación se pueden sumar solo si corresponden a una única identidad.
    const identities = new Set(matched.map(s => id(s.employeeNumber) || id(s.userId)).filter(Boolean))
    const accepted = identities.size === 1 && matched.every(s=>!!(id(s.employeeNumber)||id(s.userId)) && !used.has(s.id)) ? matched : []
    accepted.forEach(s=>used.add(s.id)); calculate(cards, accepted, uid)
  }
  let synthetic = -1
  for (const stub of stubs) if (!used.has(stub.id)) calculate([], [stub], synthetic--)
  employees.sort((a,b)=>a.fullName.localeCompare(b.fullName,'es'))
  const active = employees.filter(e=>!e.excludedFromPayroll)
  const comparison = reconcileInvoiceEvidence(input.companyId,input.start,input.end,input.mode,active)
  const calculationCoverageComplete = complete && scopeKnown && (useApprovedScope || input.clockCoverageComplete) && active.every(e=>e.calculationComplete)
  if (comparison && !calculationCoverageComplete) {
    comparison.summary.estimatedGrossPay = null
    comparison.summary.estimatedBilledAmount = null
    comparison.summary.grossVariance = null
    comparison.summary.billingVariance = null
    comparison.summary.status = 'incomplete'
  }
  const invoicePayroll = verifyInvoicePayrollEvidence(input.companyId,input.start,input.end,input.mode,stubs)
  if (invoicePayroll && (invoicePayroll.unmatchedInvoiceEmployees || invoicePayroll.unmatchedPaystubs)) {
    warnings.push(`Cobertura documental pendiente: ${invoicePayroll.unmatchedInvoiceEmployees} renglones de factura y ${invoicePayroll.unmatchedPaystubs} recibos no tienen cruce nativo único. La diferencia global incluye diferencias de población; revise los renglones antes de atribuir un cobro a la agencia.`)
  }
  for (const e of active) {
    const evidence = comparison?.evidence.get(e.employeeUserId)
    if (evidence) {
      if (!e.calculationComplete) { evidence.billingVariance = null; evidence.grossVariance = null; evidence.status = 'incomplete' }
      e.invoiceEvidence = evidence; e.officialBilledAmount = evidence.officialBilledAmount; e.billedVariance = evidence.billingVariance
    }
    // Igualar una factura no acredita contrato ni elimina incidencias de asistencia.
  }
  const pending = stubs.filter(s=>!used.has(s.id) && !input.supervisorPaystubIds?.includes(s.id)).map(s=>({
    paystubId:s.id,employeeName:s.employeeName || `${s.firstName || ''} ${s.lastName || ''}`.trim(),
    employeeNumber:s.employeeNumber,assignmentId:s.assignmentId,grossWages:safeNum(s.grossWages),
    hours:safeRound((s.earnings||[]).reduce((a,e)=>a+safeNum(e.units??e.hours),0)),
    category:'pending_native_link' as const,
    suggestedRonosMatch:[...groups.values()].map(c=>c[0].full_name||'').find(n=>normalizePayrollName(n)===normalizePayrollName(`${s.firstName||''} ${s.lastName||''}`))||null,
    note:'Pago incluido una sola vez desde Simplify; falta verificar su vínculo con el reloj.'
  }))
  const totalGross = sumMoney(active.map(e=>e.totalGrossPay)), totalBill = sumMoney(active.map(e=>e.totalInvoicedAmount))
  const sum = (key: keyof CingularEmployeePayrollItem) => safeRound(active.reduce((a,e)=>a+safeNum(e[key]),0))
  if (!input.clockCoverageComplete) warnings.push('La caché de asistencia no contiene todas las semanas solicitadas. Sincronice explícitamente para completar la comparación.')
  warnings.push('La diferencia con factura no demuestra un cobro indebido: falta certificar tarifas contractuales y ajustes del período.')
  return {
    invoiceId:comparison?.summary.invoiceIds.join(', ') || undefined, storeId:input.storeId, storeCode:input.storeCode,
    storeName:input.storeName,ronosCompanyId:input.companyId,periodStartDate:input.start,periodEndDate:input.end,isBiWeekly:input.isBiWeekly,
    invoiceMode:input.mode,totalEmployees:active.length,salariedCount:active.filter(e=>e.isSalaried).length,hourlyCount:active.filter(e=>!e.isSalaried).length,
    totalHours:sum('totalHours'),totalRegularHours:sum('regularHours'),totalSalaryHours:sum('salaryHours'),totalOvertimeHours:sum('overtimeHours'),
    totalDoubleTimeHours:sum('doubleTimeHours'),totalSickHours:sum('sickHours'),totalVacationHours:sum('vacationHours'),totalHolidayHours:sum('holidayHours'),totalMealPenaltyHours:sum('mealPenaltyHours'),
    totalGrossPay:totalGross,totalInvoicedAmount:totalBill,totalCingularFee:safeRound(totalBill-totalGross),effectiveMarkupPercentage:safeRound(safeDiv(totalBill-totalGross,totalGross)*100),
    totalApprovedGrossPay:complete && scopeKnown ? sumMoney(stubs.map(s=>s.grossWages!)) : null,approvedPaystubsCount:stubs.length,paystubCoverageComplete:complete && scopeKnown,
    calculationCoverageComplete,
    ronosEstimatedGrossPay:!input.clockCoverageComplete || employees.some(e=>e.payrollSource==='ronos' && e.ronosEstimatedGrossPay===null) ? null : sumMoney(employees.map(e=>e.ronosEstimatedGrossPay||0)),
    dataWarnings:warnings,invoiceReconciliation:comparison?.summary,invoicePayrollVerification:invoicePayroll,
    pendingStubsCount:pending.length,unmatchedPaystubsCount:pending.length,unmatchedPaystubs:pending,pendingPaystubs:pending,
    confirmedOperationalPayments:active.filter(e=>e.hasNativeMatch && !e.isAdministrativeSupervisor),administrativeSupervisorPayments:active.filter(e=>e.isAdministrativeSupervisor),
    insufficientDataEmployees:employees.filter(e=>e.auditStatus==='insufficient_data'),investigationEmployees:employees.filter(e=>e.auditStatus==='requires_investigation'),
    reconciledCount:0,estimatedCount:active.filter(e=>e.auditStatus==='estimated').length,
    requiresInvestigationCount:employees.filter(e=>e.auditStatus==='requires_investigation').length,insufficientDataCount:employees.filter(e=>e.auditStatus==='insufficient_data').length,
    exactMatchesCount:0,auditAlertsCount:employees.filter(e=>e.auditStatus!=='estimated').length,auditSavingsAmount:0,reconciliationPercentage:0,
    isFullyReconciled:false,isPartial:!complete || !input.clockCoverageComplete || !scopeKnown || active.some(e=>!e.calculationComplete),consolidationStatus:'partial',employees,
    supplementalsCount:0,supplementalsList:[]
  }
}
