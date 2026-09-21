/**
 * @module api/ronos/payroll
 * @description Consulta administrativa de cálculo independiente RONOS y evidencia de nómina/facturas.
 * @businessRules Solo administradores; GET no sincroniza ni escribe. Períodos completos continuos
 * y parámetros estrictos. Sin CSV, salarios supuestos ni tarifas contractuales certificadas por defecto.
 * La cadena declara tiendas fallidas; sus sumas parciales nunca certifican una conciliación completa.
 * @dataFlow JWT -> parámetros -> semanas cacheadas -> cálculo por tienda (máximo tres en paralelo) -> JSON.
 * @notes Las facturas solo se agregan si todas las tiendas tienen documentos para el mismo período.
 */
import { NextResponse } from 'next/server'
import { calculateCingularPayrollReport, type CingularInvoiceSummaryReport } from '@/lib/payroll-calculator'
import { RONOS_STORES_MAP, getPacificBusinessDate } from '@/lib/ronos-api'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyAdminAuth } from '@/lib/auth-server'
import type { InvoiceReconciliation } from '@/lib/payroll-invoice-evidence'
import { computeCingularBiWeeklyPeriods } from '@/components/ronos/helpers'

export const dynamic = 'force-dynamic'
type Mode = 'regular' | 'supplemental' | 'consolidated'
type CachedWeek = { week_id: number; company_id: number; start_date: string; end_date: string }
type Failure = { companyId: number; storeName: string; reason: string }
class QueryError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function parseQuery(params: URLSearchParams) {
  for (const key of ['companyId','weekIds','format','biWeekly','mode']) {
    if (params.getAll(key).length > 1) throw new QueryError(`Parámetro repetido: ${key}`)
  }
  if (params.has('format') && params.get('format') !== 'json') throw new QueryError('Solo se permite formato JSON; la exportación CSV no está disponible.')
  const company = params.get('companyId') ?? '34'
  const chain = ['0','all','chain'].includes(company)
  if (!chain && (!/^[1-9]\d*$/.test(company) || !RONOS_STORES_MAP.some(s => s.ronosCompanyId === Number(company)))) {
    throw new QueryError('La tienda solicitada no es válida.')
  }
  const biWeekly = params.get('biWeekly') ?? 'true'
  if (!['true','false'].includes(biWeekly)) throw new QueryError('biWeekly debe ser true o false.')
  const mode = params.get('mode') ?? 'consolidated'
  if (!['regular','supplemental','consolidated'].includes(mode)) throw new QueryError('Modo de nómina inválido.')
  const rawWeeks = params.get('weekIds')
  let weekIds: number[] = []
  if (rawWeeks !== null) {
    if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(rawWeeks)) throw new QueryError('Las semanas deben ser identificadores enteros separados por comas.')
    weekIds = rawWeeks.split(',').map(Number)
    if (weekIds.some(id => !Number.isSafeInteger(id)) || new Set(weekIds).size !== weekIds.length || weekIds.length !== (biWeekly === 'true' ? 2 : 1)) {
      throw new QueryError('Selecciona exactamente dos semanas distintas para bisemanal o una para semanal.')
    }
  }
  return { chain, companyId: chain ? 0 : Number(company), weekIds, isBiWeekly: biWeekly === 'true', mode: mode as Mode }
}
function dateOnly(raw: string) {
  const value = String(raw).slice(0,10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new QueryError('Fecha de semana inválida en caché.',409)
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) throw new QueryError('Fecha de semana inválida en caché.',409)
  return value
}
function validateWeeks(rows: CachedWeek[], expected: number) {
  if (rows.length !== expected || new Set(rows.map(w => w.week_id)).size !== expected) throw new QueryError('Faltan semanas completas o hay semanas duplicadas en caché.',409)
  const sorted = [...rows].sort((a,b) => dateOnly(a.start_date).localeCompare(dateOnly(b.start_date)))
  sorted.forEach((row,index) => {
    const start = Date.parse(dateOnly(row.start_date)+'T00:00:00Z')
    const end = Date.parse(dateOnly(row.end_date)+'T00:00:00Z')
    if (end-start !== 6*86400000 || (index && start-Date.parse(dateOnly(sorted[index-1].end_date)+'T00:00:00Z') !== 86400000)) {
      throw new QueryError('Las semanas deben ser completas y consecutivas.',409)
    }
  })
  return sorted
}
async function referenceWeeks(query: ReturnType<typeof parseQuery>) {
  const expected = query.isBiWeekly ? 2 : 1
  let selection = supabaseAdmin.from('ronos_work_weeks').select('week_id, company_id, start_date, end_date')
  if (query.weekIds.length) {
    selection = selection.in('week_id',query.weekIds)
    if (!query.chain) selection = selection.eq('company_id',query.companyId)
  } else selection = selection.eq('company_id',query.chain ? 34 : query.companyId)
  const {data,error} = await selection.order('start_date',{ascending:false})
  if (error) throw new QueryError('No fue posible consultar las semanas guardadas.',503)
  let rows = (data || []) as CachedWeek[]
  if (!query.weekIds.length) {
    // The Pacific business day ends at 05:59, including DST; Monday 00:00 is still Sunday.
    const today = getPacificBusinessDate(new Date())
    rows = rows.filter(w => dateOnly(w.end_date) < today)
    if (query.isBiWeekly) {
      const periods = computeCingularBiWeeklyPeriods(rows.map(w=>({weekId:w.week_id,companyId:w.company_id,startDate:w.start_date,endDate:w.end_date})))
        .sort((a,b)=>b.endDate.localeCompare(a.endDate))
      const selected = periods[0]?.weekIds || []
      rows = rows.filter(w=>selected.includes(w.week_id))
    } else rows = rows.slice(0,expected)
  }
  if (new Set(rows.map(w => w.company_id)).size > 1) throw new QueryError('Las semanas de referencia deben pertenecer a una sola tienda.')
  return validateWeeks(rows,expected)
}

function validateReport(report: CingularInvoiceSummaryReport) {
  for (const key of ['totalGrossPay','totalInvoicedAmount','totalCingularFee','totalHours','totalEmployees'] as const) {
    if (!Number.isFinite(report[key])) throw new QueryError('El cálculo contiene importes u horas incompletos.',409)
  }
}

function aggregate(reports: CingularInvoiceSummaryReport[], failures: Failure[], start: string, end: string,
  isBiWeekly: boolean, mode: Mode): CingularInvoiceSummaryReport {
  const sum = (key: keyof CingularInvoiceSummaryReport) => round(reports.reduce((total,r) => total + (typeof r[key] === 'number' && Number.isFinite(r[key]) ? r[key] as number : 0),0))
  const nullableSum = (key: 'totalApprovedGrossPay' | 'ronosEstimatedGrossPay') =>
    failures.length || reports.some(r => typeof r[key] !== 'number' || !Number.isFinite(r[key])) ? null : sum(key)
  const partial = failures.length > 0 || reports.some(r => r.isPartial || r.paystubCoverageComplete !== true)
  const coverage = !partial && reports.every(r => r.paystubCoverageComplete === true)
  const missingInvoices = reports.filter(r => !r.invoiceReconciliation).length + failures.length
  const warnings = reports.flatMap(r => (r.dataWarnings || []).map(w => `${r.storeName}: ${w}`))
  failures.forEach(f => warnings.push(`${f.storeName}: ${f.reason}`))
  if (partial) warnings.push('Cobertura parcial: los importes mostrados son subtotales de las tiendas disponibles.')
  if (missingInvoices) warnings.push(`${missingInvoices} tienda(s) sin comparación documental disponible; no se presenta un total de facturas de toda la cadena.`)
  const denominator = sum('totalEmployees') + sum('unmatchedPaystubsCount')
  const percentage = coverage && denominator > 0 ? round(sum('reconciledCount') / denominator * 100) : 0
  let invoiceReconciliation: InvoiceReconciliation | undefined
  if (!missingInvoices && reports.every(r => r.periodStartDate === start && r.periodEndDate === end)) {
    const docs = reports.map(r => r.invoiceReconciliation!)
    const money = (key: 'officialGrossPay' | 'officialBilledAmount') => round(docs.reduce((s,d) => s+d[key],0))
    const nullableMoney = (key: 'estimatedGrossPay' | 'estimatedBilledAmount' | 'grossVariance' | 'billingVariance') =>
      docs.some(d => d[key] === null || !Number.isFinite(d[key])) ? null : round(docs.reduce((s,d) => s+d[key]!,0))
    const count = (key: 'matchedEmployees' | 'candidateEmployees' | 'unmatchedInvoiceEmployees' | 'unmatchedRonosEmployees' | 'unclassifiedInvoices') => docs.reduce((s,d) => s+d[key],0)
    invoiceReconciliation = {
      invoiceIds:docs.flatMap(d => d.invoiceIds),sourceFiles:docs.flatMap(d => d.sourceFiles),
      officialGrossPay:money('officialGrossPay'),officialBilledAmount:money('officialBilledAmount'),
      estimatedGrossPay:nullableMoney('estimatedGrossPay'),estimatedBilledAmount:nullableMoney('estimatedBilledAmount'),
      grossVariance:nullableMoney('grossVariance'),billingVariance:nullableMoney('billingVariance'),
      matchedEmployees:count('matchedEmployees'),candidateEmployees:count('candidateEmployees'),
      unmatchedInvoiceEmployees:count('unmatchedInvoiceEmployees'),unmatchedRonosEmployees:count('unmatchedRonosEmployees'),
      unclassifiedInvoices:count('unclassifiedInvoices'),scopeVerified:docs.every(d => d.scopeVerified),
      status:partial || docs.some(d => d.status === 'incomplete') ? 'incomplete' : docs.some(d => d.status === 'variance') ? 'variance' : 'matched'
    }
  }
  return {
    invoiceId:`CHAIN-${mode.toUpperCase()}`,invoiceMode:mode,storeId:0,storeCode:'CHAIN',
    storeName:partial ? 'Todas las Tiendas (cobertura parcial)' : 'Todas las Tiendas',ronosCompanyId:0,
    periodStartDate:start,periodEndDate:end,isBiWeekly,
    supplementalsCount:sum('supplementalsCount'),supplementalsList:reports.flatMap(r => r.supplementalsList || []),
    totalEmployees:sum('totalEmployees'),salariedCount:sum('salariedCount'),hourlyCount:sum('hourlyCount'),
    totalHours:sum('totalHours'),totalRegularHours:sum('totalRegularHours'),totalSalaryHours:sum('totalSalaryHours'),
    totalOvertimeHours:sum('totalOvertimeHours'),totalDoubleTimeHours:sum('totalDoubleTimeHours'),
    totalMealPenaltyHours:sum('totalMealPenaltyHours'),totalSickHours:sum('totalSickHours'),
    totalVacationHours:sum('totalVacationHours'),totalHolidayHours:sum('totalHolidayHours'),
    totalGrossPay:sum('totalGrossPay'),totalInvoicedAmount:sum('totalInvoicedAmount'),totalCingularFee:sum('totalCingularFee'),
    effectiveMarkupPercentage:sum('totalGrossPay') > 0 ? round(sum('totalCingularFee') / sum('totalGrossPay') * 100) : 0,
    reconciledCount:sum('reconciledCount'),estimatedCount:sum('estimatedCount'),requiresInvestigationCount:sum('requiresInvestigationCount'),
    insufficientDataCount:sum('insufficientDataCount'),exactMatchesCount:sum('exactMatchesCount'),auditAlertsCount:sum('auditAlertsCount'),
    errorCount:sum('errorCount'),pendingStubsCount:sum('pendingStubsCount'),auditSavingsAmount:sum('auditSavingsAmount'),
    reconciliationPercentage:percentage,isFullyReconciled:!partial && reports.length > 0 && reports.every(r => r.isFullyReconciled === true),
    unmatchedPaystubsCount:sum('unmatchedPaystubsCount'),unmatchedPaystubs:reports.flatMap(r => r.unmatchedPaystubs || []),
    confirmedOperationalPayments:reports.flatMap(r => r.confirmedOperationalPayments || []),
    // Payment rows retain store identity; never deduplicate by a person's name.
    administrativeSupervisorPayments:reports.flatMap(r => r.administrativeSupervisorPayments || []),
    operationalSupervisors:reports.flatMap(r => r.operationalSupervisors || []),
    pendingPaystubs:reports.flatMap(r => r.pendingPaystubs || []),employees:reports.flatMap(r => r.employees),
    insufficientDataEmployees:reports.flatMap(r => r.insufficientDataEmployees || []),investigationEmployees:reports.flatMap(r => r.investigationEmployees || []),
    totalApprovedGrossPay:coverage ? nullableSum('totalApprovedGrossPay') : null,approvedPaystubsCount:sum('approvedPaystubsCount'),
    paystubCoverageComplete:coverage,ronosEstimatedGrossPay:nullableSum('ronosEstimatedGrossPay'),
    calculationCoverageComplete:!failures.length && reports.every(r=>r.calculationCoverageComplete===true),
    dataWarnings:warnings,invoiceReconciliation,isPartial:partial,consolidationStatus:partial ? 'partial' : 'complete',
    failedStoresCount:failures.length,failedStores:failures
  }
}

export async function GET(request: Request) {
  const auth = verifyAdminAuth(request,{allowCron:false})
  if (!auth.authorized) return NextResponse.json({success:false,error:auth.error},{status:auth.status || 401})
  try {
    const query = parseQuery(new URL(request.url).searchParams)
    const reference = await referenceWeeks(query)
    const start = dateOnly(reference[0].start_date), end = dateOnly(reference[reference.length-1].end_date)
    let report: CingularInvoiceSummaryReport
    if (!query.chain) {
      report = await calculateCingularPayrollReport(query.companyId,reference.map(w => w.week_id),query.isBiWeekly,query.mode)
    } else {
      const dates = reference.map(w => w.start_date)
      const {data,error} = await supabaseAdmin.from('ronos_work_weeks').select('week_id, company_id, start_date, end_date').in('start_date',dates)
      if (error) throw new QueryError('No fue posible consultar las semanas de las tiendas.',503)
      const weeks = (data || []) as CachedWeek[]
      const reports: CingularInvoiceSummaryReport[] = [], failures: Failure[] = []
      let cursor = 0
      async function worker() {
        while (cursor < RONOS_STORES_MAP.length) {
          const store = RONOS_STORES_MAP[cursor++]
          try {
            const selected = validateWeeks(weeks.filter(w => w.company_id === store.ronosCompanyId),reference.length)
            if (dateOnly(selected[0].start_date) !== start || dateOnly(selected[selected.length-1].end_date) !== end) throw new QueryError('El período de la tienda no coincide con la referencia.',409)
            const result = await calculateCingularPayrollReport(store.ronosCompanyId,selected.map(w => w.week_id),query.isBiWeekly,query.mode)
            if (result.periodStartDate !== start || result.periodEndDate !== end) throw new QueryError('El cálculo devolvió otro período.',409)
            validateReport(result)
            reports.push(result)
          } catch (error) {
            failures.push({companyId:store.ronosCompanyId,storeName:store.tegName,reason:error instanceof QueryError ? error.message : 'No fue posible calcular esta tienda.'})
          }
        }
      }
      await Promise.all(Array.from({length:Math.min(3,RONOS_STORES_MAP.length)},() => worker()))
      const paystubIds = reports.flatMap(r=>r.employees.flatMap(e=>e.paystubIds || (e.paystubId ? [e.paystubId] : [])))
      if (new Set(paystubIds).size !== paystubIds.length) throw new QueryError('Un recibo aparece en varias tiendas; revise la asignación antes de consolidar.',409)
      if (!reports.length) return NextResponse.json({success:false,error:'Ninguna tienda tiene datos completos para este período.',failedStores:failures,failedStoresCount:failures.length},{status:503})
      reports.sort((a,b) => a.storeName.localeCompare(b.storeName))
      report = aggregate(reports,failures,start,end,query.isBiWeekly,query.mode)
    }
    validateReport(report)
    return NextResponse.json({success:true,data:report})
  } catch (error) {
    if (error instanceof QueryError) return NextResponse.json({success:false,error:error.message},{status:error.status})
    console.error('Error en consulta de nómina RONOS:',error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({success:false,error:'No fue posible calcular la nómina con las fuentes disponibles.'},{status:503})
  }
}
