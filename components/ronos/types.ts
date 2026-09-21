/**
 * @module components/ronos/types
 * @description Interfaces y tipos TypeScript unificados para el módulo RONOS.
 *   - Maneja datos de auditoría de tienda, ponchadas, semanas y periodos bisemanales.
 *   - Modela conciliación documental de nómina Cingular HR, salarios Simplify HR y mapeos Toast POS.
 *
 * @businessRules
 *   - Semana laboral de RONOS: Lunes 6:00 AM a Lunes 5:59 AM del siguiente ciclo.
 *   - Periodos de facturación Cingular HR: Bisemanales de 14 días.
 *   - Markup de Cingular HR: 26.00% sobre empleados no exentos (por hora).
 *
 * @dataFlow
 *   Utilizado por todos los subcomponentes de `components/ronos/` y `app/admin/ronos/page.tsx`.
 *
 * @notes
 *   - Define los 5 estados reales de auditoría documental (reconciled, estimated, requires_investigation, insufficient_data, error) erradicando cualquier concepto de cuadre exacto ficticio.
 */

export interface StoreOption {
  tegStoreId: number
  tegCode: string
  tegName: string
  ronosCompanyId: number
  ronosName: string
  isBodega?: boolean
}

export interface WorkWeekOption {
  weekId: number
  companyId: number
  startDate: string
  endDate: string
}

export interface BiWeeklyPeriod {
  id: string
  weekIds: [number, number]
  startDate: string
  endDate: string
  label: string
}

export interface PunchRecord {
  id: string | number
  punchType: number // 1: IN, 2: OUT, 3: LUNCH START, 4: LUNCH END
  punchTypeName?: string
  punchTime: string
  timestampIso?: string
  photoUrl?: string | null
  device?: string
  rawNotes?: string
}

export interface DailyViolation {
  type: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  estimatedCostUsd?: number
}

export interface EmployeeDayPunch {
  date: string
  dayName: string
  clockInTime?: string
  clockInPhoto?: string | null
  lunchStartTime?: string
  lunchStartPhoto?: string | null
  lunchEndTime?: string
  lunchEndPhoto?: string | null
  clockOutTime?: string
  clockOutPhoto?: string | null
  lunchDurationMinutes?: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  punches?: PunchRecord[]
  violations?: DailyViolation[]
}

export interface EmployeeTimecard {
  employeeUserId: number
  firstName: string
  lastName: string
  fullName: string
  pin: string
  active: boolean
  jobTitle?: string
  siteName?: string
  totalWeeklyHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  brokenHours?: boolean
  mealPenaltyCount?: number
  totalViolationsCount?: number
  complianceScore?: number
  payRate?: number
  isSalaried?: boolean
  toastEmail?: string | null
  toastEmployeeId?: string | null
  toastFullName?: string | null
  mappingType?: 'auto' | 'manual' | 'unmapped'
  days?: EmployeeDayPunch[]
}

export interface StoreAuditData {
  companyId: number
  weekId: number
  storeName: string
  startDate: string
  endDate: string
  totalEmployees: number
  activeEmployees: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  mealPenaltiesCount: number
  brokenTimecardsCount: number
  estimatedPenaltyCostUsd: number
  complianceScore: number
  employees: EmployeeTimecard[]
  cachedAt: string
}

export interface ChainStoreSummary {
  tegStoreId: number
  storeCode: string
  storeName: string
  ronosCompanyId: number
  ronosName: string
  isBodega?: boolean
  weekId: number
  startDate: string
  endDate: string
  totalEmployees: number
  activeEmployees: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  mealPenaltiesCount: number
  estimatedPenaltyCostUsd: number
  complianceScore: number
  brokenEmployeesCount: number
  /** Alias emitido por el resumen corporativo de RONOS. */
  brokenTimecards?: number
}

export interface ChainAuditData {
  weekId?: number
  startDate?: string
  endDate?: string
  totalStores: number
  totalActiveEmployees: number
  totalChainEmployees?: number
  totalChainHours?: number
  chainTotalHours: number
  chainRegularHours?: number
  totalOvertimeHours?: number
  chainOvertimeHours: number
  totalMealPenalties?: number
  chainMealPenaltiesCount: number
  totalPenaltyCostUsd?: number
  chainPenaltyCostUsd: number
  chainAverageComplianceScore: number
  stores: ChainStoreSummary[]
  cachedAt?: string
}

export interface CingularEmployeeItem {
  calculationComplete?: boolean
  ronosEstimatedGrossPay?: number | null
  clockHoursVariance?: number
  clockHours?: Record<string, number>
  excludedFromPayroll?: boolean
  payrollSource?: 'ronos' | 'simplify_only'
  invoiceEvidence?: PayrollInvoiceEvidence
  employeeUserId: number
  fullName: string
  firstName?: string
  lastName?: string
  pin?: string
  jobTitle?: string
  siteName?: string
  isSalaried: boolean
  isAdministrativeSupervisor?: boolean
  payRate: number
  billRate: number
  otBillRate?: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  sickHours: number
  vacationHours: number
  holidayHours: number
  mealPenaltyHours: number
  grossRegularPay: number
  grossOvertimePay: number
  grossOtherPay: number
  totalGrossPay: number
  invoicedRegularCost: number
  invoicedOvertimeCost: number
  invoicedOtherCost: number
  totalInvoicedAmount: number
  cingularFeeAmount: number
  auditStatus?: 'reconciled' | 'estimated' | 'requires_investigation' | 'insufficient_data' | 'error' | 'exact' | 'saving' | 'variance' | 'pto' | 'paystub_match'
  auditNote?: string
  officialGrossPay?: number
  grossPayVariance?: number
  officialBilledAmount?: number
  billedVariance?: number | null
  badgeText?: string
  humanLabel?: string
  salaryHours?: number
  hasNativeMatch?: boolean
  auditBadgeText?: string
  rateSource?: string
  paystubId?: string
}

export interface PayrollInvoiceEvidence {
  invoiceId: string
  sourceFile: string
  employeeNumber: string | null
  officialName?: string
  officialPayRate?: number
  officialBillRate?: number
  officialGrossPay: number
  officialBilledAmount: number
  grossVariance: number | null
  billingVariance: number | null
  regularHoursVariance: number | null
  overtimeHoursVariance: number | null
  ptoHoursVariance: number | null
  rateSource: 'official_invoice'
  identityVerified: boolean
  status: 'matched' | 'variance' | 'incomplete'
}

export interface UnmatchedPaystubItem {
  paystubId: string
  employeeName?: string
  employeeNumber?: string
  assignmentId?: string
  grossWages: number
  hours: number
  category: 'admin_supervisor' | 'pending_native_link' | 'unavailable' | 'supplemental'
  suggestedRonosMatch?: string | null
  note?: string
}

export interface PayrollReportData {
  calculationCoverageComplete?: boolean
  ronosEstimatedGrossPay?: number | null
  dataWarnings?: string[]
  totalApprovedGrossPay?: number | null
  approvedPaystubsCount?: number
  paystubCoverageComplete?: boolean
  invoiceReconciliation?: {
    invoiceIds: string[]
    officialGrossPay: number
    officialBilledAmount: number
    billingVariance: number | null
    status: 'matched' | 'variance' | 'incomplete'
    unmatchedInvoiceEmployees: number
    unmatchedRonosEmployees: number
  }
  success: boolean
  companyId: number
  storeName: string
  storeCode: string
  startDate: string
  endDate: string
  isBiWeekly?: boolean
  totalEmployees: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  doubleTimeHours: number
  sickHours: number
  vacationHours: number
  holidayHours: number
  mealPenaltyHours: number
  totalGrossPay: number
  totalInvoicedAmount: number
  totalCingularFee: number
  effectiveMarkupPercentage?: number
  reconciliationPercentage?: number
  reconciledCount?: number
  estimatedCount?: number
  requiresInvestigationCount?: number
  insufficientDataCount?: number
  errorCount?: number
  exactMatchesCount?: number
  auditAlertsCount?: number
  pendingStubsCount?: number
  isFullyReconciled?: boolean
  isPartial?: boolean
  consolidationStatus?: 'complete' | 'partial'
  salariedCount: number
  hourlyCount: number
  invoiceId?: string
  supplementalsList?: Array<{
    employeeFullName: string
    invoiceCode?: string
    invoicedAmount: number
    checkNumber?: string
    paymentReference?: string
  }>
  unmatchedPaystubsCount?: number
  salariedPaystubsWithoutRonosCount?: number
  unmatchedPaystubs?: UnmatchedPaystubItem[]
  operationalSupervisors?: Array<{
    assignmentId?: string | null
    employeeId?: string | null
    supervisorName: string
    jobTitle: string
    isPayingStore: boolean
    operationalStoreIds: number[]
    operationalStoreNames: string[]
    payrollStoreId: number
    payrollStoreName: string
    payrollStoreCode: string
    humanLabel: string
    grossWages: number
    salaryHours: number
    invoicedAmount: number
  }>
  employees: CingularEmployeeItem[]
}

export interface ToastCandidate {
  id: string
  fullName?: string
  full_name?: string
  first_name?: string
  last_name?: string
  email: string | null
  phone: string | null
  jobTitle?: string | null
  job_title?: string | null
}

export interface MappedEmployeeItem {
  ronosEmployeeUserId: number
  ronosCompanyId: number
  ronosFullName: string
  ronosPin: string
  ronosActive: boolean
  toastEmployeeId: string | null
  toastFullName: string | null
  toastEmail: string | null
  toastPhone: string | null
  toastJobTitle: string | null
  mappingType: 'auto' | 'manual' | 'inactive' | 'unmapped'
  isConfirmed: boolean
  confidenceScore: number
  transferredToStore?: string | null
  // Campos para cola de revisión manual supervisada
  suggestedCandidate?: ToastCandidate | null
  suggestedReason?: string | null
  nativeIdentifier?: string | null
  evidence?: string | null
  similarityScore?: number
  storeName?: string | null
  periodLabel?: string | null
}

export interface PhotoModalState {
  isOpen: boolean
  photoUrl: string
  title: string
  employeeName: string
  timestamp: string
  rotation: number
}

export interface EmailModalState {
  isOpen: boolean
  employeeUserId: number
  employeeName: string
  employeeEmail: string
  employeePin: string
  employeeJobTitle: string
  violationDate: string
  violationType: string
  violationTitle: string
  violationDescription: string
  clockInTime?: string
  lunchStartTime?: string
  lunchEndTime?: string
  clockOutTime?: string
  totalHoursWorked?: number
  additionalNotes: string
  warningStage?: 'first' | 'second' | 'suspension'
  storeName?: string
  ronosCompanyId?: number
  escalera: {
    managerName: string | null
    managerEmail: string | null
    supervisorName: string | null
    supervisorEmail: string | null
    allCcEmails: string[]
  } | null
  isSending: boolean
  sendSuccess: boolean
  sendError: string | null
}
