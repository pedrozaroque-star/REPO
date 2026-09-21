/**
 * @module payroll-calculator
 * @description Lectura de fuentes de nómina RONOS y comparación independiente con Cingular.
 * @businessRules Consultar nunca sincroniza ni escribe. No hay tarifas por nombre, horas
 * salariales inventadas ni excepciones financieras por persona. Diferencia no implica sobrecargo.
 * @dataFlow Caché RONOS + tarifas identificadas + recibos paginados -> motor puro -> evidencia PDF.
 * @notes Importes de facturas nunca se usan para forzar el cálculo. Fallos parciales permanecen visibles.
 */
import { supabaseAdmin } from './supabase'
import { RONOS_STORES_MAP } from './ronos-api'
import { RONOS_TO_SIMPLIFY_SITE_MAP } from './simplifyhr-api'
import { loadPeriodPaystubs } from './payroll-paystubs'
import { getStoreSupervisorContext, type StoreSupervisorContextItem } from './supervisor-assignments'
import type { UnmatchedPaystubItem } from '../components/ronos/types'
import type { InvoiceEmployeeEvidence, InvoiceReconciliation, InvoicePayrollVerification } from './payroll-invoice-evidence'
import { buildPayrollReport } from './payroll-reconciliation'
import type { PayrollCard, PayrollRate } from './payroll-reconciliation'
export { safeNum, safeDiv, safeRound } from './payroll-reconciliation'
export { isEmployeeSalaried } from './payroll-classification'
export interface SupplementalInvoiceInfo {
  ronosCompanyId: number; employeeNamePattern: string; employeeFullName: string; invoiceCode: string
  checkNumber?: string; netPay?: number; invoicedAmount?: number; hours?: number; regularHours?: number
  overtimeHours?: number; payRate?: number; billRate?: number; grossPay?: number
  reason: 'finiquito' | 'off_cycle' | 'ajuste'; description: string; effectivePeriodStart?: string; effectivePeriodEnd?: string
}
export type PayrollEvidenceAuditStatus = 'reconciled' | 'estimated' | 'requires_investigation' | 'insufficient_data' | 'error'

export interface CingularEmployeePayrollItem {
  paystubIds?: string[]
  payrollSource?: 'ronos' | 'simplify_only'
  excludedFromPayroll?: boolean
  ronosAssignmentId?: string
  simplifyEmployeeNumber?: string
  identityVerified?: boolean
  officialGrossPay?: number
  grossPayVariance?: number
  officialBilledAmount?: number
  billedVariance?: number | null
  ronosEstimatedGrossPay?: number | null
  clockHoursVariance?: number
  clockHours?: Record<string, number>
  calculationComplete?: boolean
  invoiceEvidence?: InvoiceEmployeeEvidence
  employeeId: string
  employeeUserId: number
  firstName: string
  lastName: string
  fullName: string
  jobTitle: string
  isSalaried: boolean
  isAdministrativeSupervisor?: boolean
  humanLabel?: string
  siteName: string
  payRate: number
  billRate: number
  regularHours: number
  salaryHours: number
  overtimeHours: number
  doubleTimeHours: number
  mealPenaltyHours: number
  sickHours: number
  vacationHours: number
  holidayHours: number
  totalHours: number
  grossRegularPay: number
  grossOvertimePay: number
  grossDoubleTimePay: number
  grossOtherPay: number
  totalGrossPay: number
  invoicedRegularCost: number
  invoicedOvertimeCost: number
  invoicedDoubleTimeCost: number
  invoicedOtherCost: number
  totalInvoicedAmount: number
  cingularFeeAmount: number
  markupPercentage: number
  rateSource?: 'simplify' | 'paystub' | 'toast' | 'static_catalog' | 'role_default' | 'unknown'
  // Campos de Auditoría PEO y Discrepancias
  auditStatus?: PayrollEvidenceAuditStatus
  auditBadgeText?: string
  auditNote?: string
  simplifyPayRate?: number
  simplifyPayType?: string
  varianceAmount?: number
  hasNativeMatch?: boolean
  evidenceSource?: string
  paystubId?: string
}

export interface CingularInvoiceSummaryReport {
  calculationCoverageComplete?: boolean
  totalApprovedGrossPay?: number | null
  approvedPaystubsCount?: number
  paystubCoverageComplete?: boolean
  ronosEstimatedGrossPay?: number | null
  dataWarnings?: string[]
  invoiceReconciliation?: InvoiceReconciliation
  invoicePayrollVerification?: InvoicePayrollVerification
  invoiceId?: string
  storeId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  periodStartDate: string
  periodEndDate: string
  isBiWeekly: boolean
  totalEmployees: number
  salariedCount: number
  hourlyCount: number
  totalHours: number
  totalRegularHours: number
  totalSalaryHours: number
  totalOvertimeHours: number
  totalDoubleTimeHours: number
  totalMealPenaltyHours: number
  totalSickHours: number
  totalVacationHours: number
  totalHolidayHours?: number
  totalGrossPay: number
  totalInvoicedAmount: number
  totalCingularFee: number
  effectiveMarkupPercentage: number
  // Métricas de Auditoría PEO Documental
  reconciledCount?: number
  estimatedCount?: number
  requiresInvestigationCount?: number
  insufficientDataCount?: number
  errorCount?: number
  pendingStubsCount?: number
  exactMatchesCount: number
  auditAlertsCount: number
  auditSavingsAmount: number
  reconciliationPercentage: number
  // Soporte Multi-Lote / Facturas Suplementarias (Finiquitos vs Regular vs Consolidado)
  invoiceMode?: 'regular' | 'supplemental' | 'consolidated'
  supplementalsCount?: number
  supplementalsList?: SupplementalInvoiceInfo[]
  unmatchedPaystubsCount?: number
  unmatchedPaystubs?: UnmatchedPaystubItem[]
  confirmedOperationalPayments?: CingularEmployeePayrollItem[]
  administrativeSupervisorPayments?: CingularEmployeePayrollItem[]
  operationalSupervisors?: StoreSupervisorContextItem[]
  pendingPaystubs?: UnmatchedPaystubItem[]
  insufficientDataEmployees?: CingularEmployeePayrollItem[]
  investigationEmployees?: CingularEmployeePayrollItem[]
  isFullyReconciled?: boolean
  isPartial?: boolean
  consolidationStatus?: 'complete' | 'partial'
  failedStoresCount?: number
  failedStores?: any[]
  employees: CingularEmployeePayrollItem[]
}


export async function calculateCingularPayrollReport(
  companyIdOrParams: number | {
    ronosCompanyId?: number; companyId?: number; weekIds?: (number | string)[]
    periodId?: string | number | (number | string)[]; isBiWeekly?: boolean; biWeekly?: boolean
    useLiveRates?: boolean; syncSimplify?: boolean; invoiceMode?: 'regular' | 'supplemental' | 'consolidated'
  },
  rawWeekIds?: (number | string)[] | string | number,
  isBiWeeklyParam = true,
  invoiceModeParam: 'regular' | 'supplemental' | 'consolidated' = 'consolidated'
): Promise<CingularInvoiceSummaryReport> {
  const params = typeof companyIdOrParams === 'object' ? companyIdOrParams : undefined
  const companyId = Number(params ? params.ronosCompanyId ?? params.companyId : companyIdOrParams)
  const raw = params ? params.weekIds ?? params.periodId : rawWeekIds
  const weekIds = [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map(Number))]
  if (!Number.isSafeInteger(companyId) || !weekIds.length || weekIds.some(n=>!Number.isSafeInteger(n)||n<=0)) throw new Error('Tienda o semanas inválidas')
  const store = RONOS_STORES_MAP.find(s=>s.ronosCompanyId===companyId)
  if (!store) throw new Error('Tienda no reconocida')
  const mode = params?.invoiceMode || invoiceModeParam
  if (!['regular','supplemental','consolidated'].includes(mode)) throw new Error('Modo de nómina inválido')
  const {data:weeks,error:weekError} = await supabaseAdmin.from('ronos_work_weeks').select('week_id, company_id, start_date, end_date')
    .eq('company_id',companyId).in('week_id',weekIds).order('start_date',{ascending:true})
  if (weekError || !weeks || weeks.length!==weekIds.length) throw new Error('No se encontraron todas las semanas de esta tienda')
  const start = String(weeks[0].start_date).slice(0,10), end = String(weeks[weeks.length-1].end_date).slice(0,10)
  for(let i=1;i<weeks.length;i++) {
    const previousEnd = Date.parse(String(weeks[i-1].end_date).slice(0,10)+'T00:00:00Z')
    const nextStart = Date.parse(String(weeks[i].start_date).slice(0,10)+'T00:00:00Z')
    if(nextStart-previousEnd!==86400000) throw new Error('Las semanas deben formar un período continuo')
  }
  const results = await Promise.all([
    supabaseAdmin.from('ronos_employee_timecards_cache').select('*').eq('company_id',companyId).in('week_id',weekIds),
    supabaseAdmin.from('simplify_employee_rates').select('*').eq('ronos_company_id',companyId)
  ])
  const [cardsResult,ratesResult] = results
  if(cardsResult.error) throw new Error('No fue posible leer las tarjetas de asistencia')
  const warnings:string[]=[]
  if(ratesResult.error) warnings.push('No se pudieron cargar las tarifas actuales; solo se usarán tarifas de recibos verificables.')
  const siteId = RONOS_TO_SIMPLIFY_SITE_MAP[companyId] || ''
  let stubs: Awaited<ReturnType<typeof loadPeriodPaystubs>>=[]
  let coverage=false
  if(siteId) {
    try { stubs=await loadPeriodPaystubs(siteId,start,end); coverage=true }
    catch { warnings.push('No se obtuvo la colección completa de recibos de Simplify. No se certifican totales oficiales.') }
  } else warnings.push('La tienda no tiene un identificador de Simplify configurado.')
  let supervisors: StoreSupervisorContextItem[]=[]
  try {
    const context=await getStoreSupervisorContext(store.tegStoreId,start,end)
    supervisors=[...context.paidSupervisors,...context.operationalOnlySupervisors]
  } catch { warnings.push('No se pudo verificar el contexto de supervisores.') }
  const cards=(cardsResult.data||[]) as PayrollCard[]
  const report=buildPayrollReport({companyId,storeId:store.tegStoreId,storeName:store.tegName,storeCode:store.tegCode,
    siteId,start,end,isBiWeekly:params?.isBiWeekly??params?.biWeekly??isBiWeeklyParam,mode,
    cards,rates:(ratesResult.data||[]) as PayrollRate[],stubs,paystubCoverageComplete:coverage,
    clockCoverageComplete:weekIds.every(w=>cards.some(c=>c.week_id===w)),warnings,
    supervisorPaystubIds:supervisors.filter(s=>s.isPayingStore&&s.reviewStatus==='verified'&&s.paystubId).map(s=>s.paystubId!)})
  report.operationalSupervisors=supervisors
  return report
}
