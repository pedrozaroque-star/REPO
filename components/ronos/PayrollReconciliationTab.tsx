/**
 * @module components/ronos/PayrollReconciliationTab
 * @description Pestaña de Nómina y Conciliación Cingular HR & PEO Simplify HR.
 *   - Separa cálculo RONOS, sueldo aprobado Simplify y factura documental Cingular.
 *   - 4 secciones operativas estructuradas:
 *     1. Pagos confirmados (personal operativo de tienda).
 *     2. Pagos administrativos de supervisores (distrito, exentos).
 *     3. Recibos pendientes con texto reglamentario obligatorio.
 *     4. Datos insuficientes.
 *   - Máximo 5 columnas iniciales en escritorio con expansión de desglose; tarjetas táctiles en móvil.
 *
 * @businessRules
 *   - La UI no calcula tarifas ni certifica facturas desde porcentajes o coincidencias de sueldo.
 *   - Datos oficiales ausentes se muestran como no disponibles, nunca como cero.
 *   - Supervisores administrativos: Salario y compensación leídos directamente de su recibo emitido oficial en Simplify HR.
 *   - Texto reglamentario obligatorio en recibos pendientes sin tarjeta identificada.
 *
 * @dataFlow
 *   Recibe `payrollData` originado en `/api/ronos/payroll`.
 *
 * @notes
 *   - Cumple con estándar Mobile-First con controles táctiles >= 44px.
 *   - Etiquetas bilingües de fuentes; sin cantidades, empleados o tarifas fijas.
 *   - Elimina bloque oscuro gigante, IDs crudos y tecnicismos.
 */

'use client'

import React, { useState, useMemo } from 'react'
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  XCircle,
  ShieldCheck
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { PayrollReportData, CingularEmployeeItem } from './types'
import { formatCurrency } from './helpers'

interface PayrollReconciliationTabProps {
  payrollData: PayrollReportData | null
  payrollLoading: boolean
  payrollError: string | null
  payrollInvoiceMode: 'consolidated' | 'regular' | 'supplemental'
  setPayrollInvoiceMode: (mode: 'consolidated' | 'regular' | 'supplemental') => void
  selectedCompanyId: number
  resolvedPayrollPeriodId: string | number
  payrollBiWeekly: boolean
  onRefresh: () => void
}

export default function PayrollReconciliationTab({
  payrollData,
  payrollLoading,
  payrollError,
  payrollInvoiceMode,
  setPayrollInvoiceMode,
  onRefresh
}: PayrollReconciliationTabProps) {
  const { t, language } = useLanguage()
  const copy = (es: string, en: string) => language === 'es' ? es : en

  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'ot' | 'pto' | 'salaried'>('all')
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null)
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

  const toggleExpand = (empId: string) => {
    setExpandedEmployeeId(prev => prev === empId ? null : empId)
  }

  const totalInvoiced = Number(payrollData?.totalInvoicedAmount) || 0
  const invoice = payrollData?.invoiceReconciliation
  const hasApprovedPaystubs = (payrollData?.approvedPaystubsCount ?? 0) > 0
  const amount = (value: number | null | undefined) => payrollLoading
    ? copy('Cargando…', 'Loading…')
    : typeof value === 'number' && Number.isFinite(value)
      ? formatCurrency(value)
      : copy('No disponible', 'Unavailable')
  const summaryCards = [
    { title: hasApprovedPaystubs ? copy('Recálculo de conceptos aprobados', 'Approved earnings recalculation') : copy('Proyección de asistencia', 'Attendance projection'), value: payrollData && payrollData.calculationCoverageComplete !== false ? totalInvoiced : null, note: hasApprovedPaystubs ? copy('Horas y tarifas del recibo; sin usar el total de la factura. Cargos de agencia proyectados.', 'Paystub hours and rates; does not use the invoice total. Agency charges projected.') : copy('Horas de RONOS con tarifas disponibles; no sustituye la factura.', 'RONOS hours at available rates; does not replace an invoice.') },
    { title: copy('Sueldo aprobado en Simplify', 'Approved Simplify gross pay'), value: payrollData?.paystubCoverageComplete ? payrollData.totalApprovedGrossPay : null, note: copy('Sueldo bruto de los recibos del período.', 'Gross pay from period paystubs.') },
    { title: copy('Factura oficial Cingular', 'Official Cingular invoice'), value: invoice?.officialBilledAmount, note: invoice?.invoiceIds.join(' · ') || copy('Sin documento para esta selección.', 'No document for this selection.') },
    { title: copy('Diferencia por investigar', 'Difference to investigate'), value: payrollData?.isPartial ? null : invoice?.billingVariance, note: copy('Cálculo menos factura. Un negativo indica que la agencia factura más. No prueba un sobrecargo: faltan validar las tarifas contractuales.', 'Calculation minus invoice. A negative value means the agency invoices more. This does not prove an overcharge: contractual rates require validation.') }
  ]

  const supplementalsList = payrollData?.supplementalsList || []
  const supplementalsCount = supplementalsList.length

  // Filtrado de colaboradores
  const filteredEmployees = useMemo(() => {
    if (!Array.isArray(payrollData?.employees)) return []

    return payrollData.employees.filter((emp) => {
      // 1. Buscador
      if (searchTerm.trim()) {
        const q = normalizeSearch(searchTerm)
        const matchName = normalizeSearch(emp.fullName).includes(q)
        const matchJob = normalizeSearch(emp.jobTitle || '').includes(q)
        const matchPin = normalizeSearch(emp.pin || '').includes(q)
        if (!matchName && !matchJob && !matchPin) return false
      }

      // 2. Filtro de tipo
      if (filterType === 'ot') return (emp.overtimeHours || 0) > 0
      if (filterType === 'pto') return ((emp.sickHours || 0) + (emp.vacationHours || 0) + (emp.holidayHours || 0)) > 0
      if (filterType === 'salaried') return emp.isSalaried

      return true
    })
  }, [payrollData?.employees, searchTerm, filterType])

  // Separación clara: Personal Administrativo de Supervisión vs Personal Operativo de Tienda
  const adminSupervisors = useMemo(() => {
    return filteredEmployees.filter(e => e.isAdministrativeSupervisor)
  }, [filteredEmployees])

  const storeCrew = useMemo(() => {
    return filteredEmployees.filter(e => !e.isAdministrativeSupervisor)
  }, [filteredEmployees])

  const employeeKey = (emp: CingularEmployeeItem) => `${emp.siteName || ''}:${emp.payrollSource || 'ronos'}:${emp.employeeUserId}:${emp.paystubId || ''}`
  const sourceNote = (emp: CingularEmployeeItem) => emp.excludedFromPayroll
    ? copy('Tarjeta sin vínculo: se muestra para revisión y no se suma otra vez a la nómina.', 'Unlinked timecard: shown for review and not added to payroll again.')
    : emp.payrollSource === 'simplify_only'
      ? copy('Pago registrado en Simplify; sin tarjeta RONOS vinculada.', 'Payment recorded in Simplify; no linked RONOS timecard.')
      : emp.hasNativeMatch
        ? copy('Recibo vinculado a RONOS.', 'Paystub linked to RONOS.')
        : copy('Estimación pendiente de vincular con un recibo.', 'Estimate awaiting a paystub link.')
  const EmployeeEvidence = ({ emp }: { emp: CingularEmployeeItem }) => (
    <div className="mt-3 space-y-2 text-xs">
      <p className="text-slate-600 dark:text-slate-300">{sourceNote(emp)}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><dt className="text-slate-500">{copy('Sueldo aprobado Simplify', 'Approved Simplify gross')}</dt><dd className="font-semibold tabular-nums">{amount(emp.officialGrossPay)}</dd></div>
        <div><dt className="text-slate-500">{copy('Importe factura individual', 'Individual invoice amount')}</dt><dd className="font-semibold tabular-nums">{amount(emp.invoiceEvidence?.identityVerified ? emp.invoiceEvidence.officialBilledAmount : undefined)}</dd></div>
        <div><dt className="text-slate-500">{copy('Sueldo estimado por tarjeta', 'Gross estimated from timecard')}</dt><dd className="font-semibold tabular-nums">{amount(emp.ronosEstimatedGrossPay)}</dd></div>
      </dl>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><dt className="text-slate-500">{copy('Cálculo de sueldo menos recibo', 'Calculated gross minus paystub')}</dt><dd className="font-semibold tabular-nums">{amount(emp.calculationComplete === false ? null : emp.grossPayVariance)}</dd></div>
        <div><dt className="text-slate-500">{copy('Cálculo de cargos menos factura', 'Calculated billing minus invoice')}</dt><dd className="font-semibold tabular-nums">{amount(emp.invoiceEvidence?.identityVerified ? emp.billedVariance : undefined)}</dd></div>
      </dl>
      <p className="text-slate-500">{copy('Vacaciones', 'Vacation')}: {emp.vacationHours.toFixed(2)}h · {copy('Enfermedad', 'Sick')}: {emp.sickHours.toFixed(2)}h · {copy('Festivo', 'Holiday')}: {emp.holidayHours.toFixed(2)}h</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <caption className="text-left font-semibold py-2">{copy('Horas del reloj frente a conceptos aprobados', 'Clock hours versus approved earnings')}</caption>
          <thead><tr><th className="p-2">{copy('Concepto', 'Earning')}</th><th className="p-2 text-right">RONOS</th><th className="p-2 text-right">Simplify</th></tr></thead>
          <tbody>{[
            ['regular', copy('Regulares', 'Regular'), emp.regularHours],
            ['salary', copy('Salario', 'Salary'), emp.salaryHours],
            ['overtime', copy('Extras', 'Overtime'), emp.overtimeHours],
            ['doubleTime', copy('Doble tiempo', 'Double time'), emp.doubleTimeHours],
            ['vacation', copy('Vacaciones', 'Vacation'), emp.vacationHours],
            ['sick', copy('Enfermedad', 'Sick'), emp.sickHours],
            ['holiday', copy('Festivo', 'Holiday'), emp.holidayHours],
            ['meal', copy('Compensación de comida', 'Meal compensation'), emp.mealPenaltyHours],
          ].map(([key, label, approved]) => <tr key={key} className="border-t border-slate-200 dark:border-slate-700">
            <th className="p-2 font-normal">{label}</th>
            <td className="p-2 text-right tabular-nums">{emp.clockHours && typeof emp.clockHours[String(key)] === 'number' ? `${emp.clockHours[String(key)].toFixed(2)}h` : '—'}</td>
            <td className="p-2 text-right tabular-nums">{emp.paystubId && typeof approved === 'number' ? `${approved.toFixed(2)}h` : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {typeof emp.clockHoursVariance === 'number' && <p>{copy('Diferencia de horas (reloj menos recibos)', 'Hours difference (clock minus paystubs)')}: <strong>{emp.clockHoursVariance.toFixed(2)}h</strong></p>}
      {emp.auditNote && <p className="text-amber-700 dark:text-amber-300">{emp.auditNote}</p>}
    </div>
  )

  // Recibos pendientes sin enlace checador
  const pendingPaystubs = useMemo(() => {
    return (payrollData?.unmatchedPaystubs || []).filter(
      s => s.category === 'pending_native_link'
    )
  }, [payrollData?.unmatchedPaystubs])

  // Estado de evidencia claro (Cero afirmación de "Confirmado al centavo" si hay estimados o parciales)
  const evidenceStatus = useMemo(() => {
    if (!payrollData || payrollData.totalEmployees === 0) {
      return {
        label: t('ronos.payroll.evidence_insufficient') || 'Datos Insuficientes',
        color: 'slate',
        icon: Info
      }
    }
    const hasUnconfirmed = !payrollData.isFullyReconciled ||
      payrollData.invoiceReconciliation?.status !== 'matched' ||
      !payrollData.paystubCoverageComplete ||
      (payrollData.requiresInvestigationCount ?? 0) > 0 ||
      pendingPaystubs.length > 0 ||
      (payrollData.reconciliationPercentage !== undefined && payrollData.reconciliationPercentage < 100) ||
      (payrollData.estimatedCount !== undefined && payrollData.estimatedCount > 0) ||
      Boolean((payrollData as any).isPartial)
    if (hasUnconfirmed) {
      return {
        label: language === 'es' ? 'Comparación pendiente de completar' : 'Comparison pending completion',
        color: 'amber',
        icon: AlertTriangle
      }
    }
    return {
      label: language === 'es' ? 'Fuentes conciliadas' : 'Sources reconciled',
      color: 'emerald',
      icon: CheckCircle2
    }
  }, [payrollData, pendingPaystubs.length, t, language])

  const EvidenceIcon = evidenceStatus.icon

  return (
    <div className="space-y-4">
      {/* Banner de error de nómina con botón visible de reintento */}
      {payrollError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <XCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="font-semibold">{payrollError}</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer min-h-[44px] shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('common.retry') || 'Reintentar'}</span>
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. TARJETA RESUMEN EJECUTIVA DE NÓMINA (SOBRIA, SIN BLOQUES OSCUROS)     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-payroll-summary"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                evidenceStatus.color === 'emerald'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : evidenceStatus.color === 'amber'
                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}>
                <EvidenceIcon className="w-3.5 h-3.5" />
                <span>{evidenceStatus.label}</span>
              </span>
            </div>

            <h2 id="heading-payroll-summary" className="text-lg font-bold text-slate-900 dark:text-white">
              {copy('Nómina y facturas', 'Payroll and invoices')}
            </h2>
            <p className="text-sm text-slate-500">{copy('Compara las fuentes del período seleccionado. Los pagos se administran en Simplify HR.', 'Compare sources for the selected period. Payments are managed in Simplify HR.')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-4" aria-live="polite">
          {summaryCards.map(card => (
            <div key={card.title} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 min-w-0">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{card.title}</h3>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-2 break-words">{amount(card.value)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{card.note}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">{copy('Las facturas incluyen cargos de la agencia; el sueldo bruto no incluye esos cargos.', 'Invoices include agency charges; gross pay excludes those charges.')}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{copy('Sueldo estimado independientemente desde las tarjetas RONOS', 'Gross independently estimated from RONOS timecards')}: <strong className="tabular-nums">{amount(payrollData?.ronosEstimatedGrossPay)}</strong>. {copy('El detalle conserva las horas del reloj y las del recibo por separado.', 'The detail keeps clock hours and paystub hours separate.')}</p>

        {!!payrollData?.dataWarnings?.length && <details className="mt-3 text-sm text-amber-800 dark:text-amber-300"><summary className="cursor-pointer min-h-[44px] py-3">{copy('Datos que requieren revisión', 'Data requiring review')}</summary><ul className="list-disc pl-5 space-y-1">{payrollData.dataWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        {/* Selector de Modo de Nómina (Consolidada / Regular / Cheques Suplementarios) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setPayrollInvoiceMode('consolidated')}
            className={`min-h-[44px] p-2.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
              payrollInvoiceMode === 'consolidated'
                ? 'bg-sky-50 dark:bg-sky-950/60 border border-[#0288d1] text-[#0288d1] dark:text-sky-300'
                : 'bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
            }`}
          >
            <span>{t('ronos.payroll.mode_consolidated') || 'Nómina Consolidada'}</span>
            {payrollInvoiceMode === 'consolidated' && <span className="w-2 h-2 rounded-full bg-[#0288d1]" />}
          </button>

          <button
            type="button"
            onClick={() => setPayrollInvoiceMode('regular')}
            className={`min-h-[44px] p-2.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
              payrollInvoiceMode === 'regular'
                ? 'bg-sky-50 dark:bg-sky-950/60 border border-[#0288d1] text-[#0288d1] dark:text-sky-300'
                : 'bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
            }`}
          >
            <span>{t('ronos.payroll.mode_regular') || 'Nómina Regular'}</span>
            {payrollInvoiceMode === 'regular' && <span className="w-2 h-2 rounded-full bg-[#0288d1]" />}
          </button>

          <button
            type="button"
            onClick={() => setPayrollInvoiceMode('supplemental')}
            className={`min-h-[44px] p-2.5 rounded-xl text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
              payrollInvoiceMode === 'supplemental'
                ? 'bg-sky-50 dark:bg-sky-950/60 border border-[#0288d1] text-[#0288d1] dark:text-sky-300'
                : 'bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
            }`}
          >
            <span>{t('ronos.payroll.mode_supplemental') || 'Cheques Suplementarios'}</span>
            {supplementalsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {supplementalsCount}
              </span>
            )}
          </button>
        </div>
      </section>

      {/* Alerta de Cheques Suplementarios / Finiquitos si existen */}
      {supplementalsCount > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block">
              {supplementalsCount} {t('ronos.payroll.supplemental_detected') || 'Cheque(s) Suplementario(s) / Finiquito(s) Detectados'}
            </span>
            <div className="space-y-0.5 text-[11px]">
              {supplementalsList.map((sup, idx) => (
                <div key={idx}>
                  • <strong>{sup.employeeFullName}</strong>: {formatCurrency(sup.invoicedAmount)} ({sup.paymentReference || (sup.checkNumber ? `${t('ronos.payroll.check_number') || 'Cheque #'} ${sup.checkNumber}` : (t('ronos.payroll.off_cycle_payment') || 'Pago Fuera de Ciclo'))} · {copy('Pago adicional', 'Additional payment')})
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. PAGOS CONFIRMADOS: PERSONAL OPERATIVO DE TIENDA                      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-confirmed-crew"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden"
      >
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 id="heading-confirmed-crew" className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {copy('Detalle por colaborador', 'Employee detail')}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {copy('Revisa horas, conceptos pagados y evidencia disponible.', 'Review hours, paid earnings and available evidence.')}
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-500 self-start sm:self-auto">
            {storeCrew.length} {t('ronos.payroll.employees_count') || 'colaboradores'}
          </span>
        </div>

        {/* Toolbar de Búsqueda y Filtros de Nómina */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('ronos.payroll.search_placeholder') || 'Buscar por nombre o PIN...'}
              className="w-full min-h-[44px] pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                filterType === 'all'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t('ronos.payroll.filter_all') || 'Todos'}
            </button>
            <button
              type="button"
              onClick={() => setFilterType('ot')}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                filterType === 'ot'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              }`}
            >
              {t('ronos.payroll.filter_ot') || 'Con Horas Extras'}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={payrollLoading}
              aria-label="Refrescar nómina"
              className="min-h-[44px] min-w-[44px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${payrollLoading ? 'animate-spin text-[#0288d1]' : ''}`} />
            </button>
          </div>
        </div>

        {/* VISTA ESCRITORIO: MÁXIMO 5 COLUMNAS INICIALES */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4">{t('ronos.payroll.col_employee') || 'Colaborador'}</th>
                <th className="py-3 px-3 text-center">{t('ronos.payroll.col_type') || 'Clasificación'}</th>
                <th className="py-3 px-3 text-center">{t('ronos.payroll.col_hours') || 'Horas'}</th>
                <th className="py-3 px-3 text-right">{copy('Cálculo RONOS', 'RONOS calculation')}</th>
                <th className="py-3 px-4 text-center">{t('ronos.payroll.col_status') || 'Detalle'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payrollLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0288d1]" />
                    <span>{t('ronos.payroll.calculating_payroll') || 'Calculando nómina...'}</span>
                  </td>
                </tr>
              ) : !payrollData ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                    <span>{t('ronos.payroll.error_loading_data') || 'No se pudieron cargar los datos de nómina.'}</span>
                  </td>
                </tr>
              ) : storeCrew.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    {t('ronos.payroll.no_employees_found') || 'No se encontraron colaboradores para los filtros seleccionados.'}
                  </td>
                </tr>
              ) : (
                storeCrew.map((emp) => {
                  const isExpanded = expandedEmployeeId === employeeKey(emp)

                  return (
                    <React.Fragment key={employeeKey(emp)}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <span>{emp.fullName}</span>
                            {emp.pin && <span className="text-[10px] font-mono text-slate-400 font-normal">#{emp.pin}</span>}
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal block">
                            {emp.jobTitle || 'Crew'} {emp.siteName ? `· ${emp.siteName}` : ''}
                          </span>
                          {(emp.excludedFromPayroll || emp.payrollSource === 'simplify_only') && <span className="block text-xs font-normal text-amber-700 dark:text-amber-300 mt-1">{sourceNote(emp)}</span>}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {emp.isSalaried ? (t('ronos.payroll.salaried_label') || 'Salariado') : (t('ronos.payroll.hourly_label') || 'Por Hora')}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-slate-800 dark:text-slate-200 font-bold">
                          {emp.totalHours.toFixed(2)}h
                          {(emp.overtimeHours || 0) > 0 && (
                            <span className="text-amber-600 font-normal block text-[10px]">
                              +{emp.overtimeHours?.toFixed(2)}h OT
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-slate-900 dark:text-slate-100">
                          {amount(emp.calculationComplete === false ? null : emp.totalInvoicedAmount)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExpand(employeeKey(emp))}
                            className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <span>{isExpanded ? (t('ronos.payroll.hide_details') || 'Ocultar') : (t('ronos.payroll.expand_details') || 'Desglose')}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>

                      {/* FILA EXPANDIBLE DE DETALLES */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/40">
                          <td colSpan={5} className="p-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase font-bold block">{copy('Sueldo recalculado', 'Recalculated gross pay')}</span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white">{amount(emp.calculationComplete === false ? null : emp.totalGrossPay)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase font-bold block">{copy('Cargo de agencia estimado', 'Estimated agency charge')}</span>
                                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{amount(emp.calculationComplete === false ? null : emp.cingularFeeAmount)}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase font-bold block">{t('ronos.payroll.col_rate') || 'Tarifa Base'}</span>
                                <span className="font-mono text-slate-700 dark:text-slate-300">${emp.payRate.toFixed(2)}/h</span>
                              </div>
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase font-bold block">{copy('Tarifa de facturación estimada', 'Estimated billing rate')}</span>
                                <span className="font-mono font-bold text-[#0288d1] dark:text-sky-400">${emp.billRate.toFixed(2)}/h</span>
                              </div>
                            </div>
                            <EmployeeEvidence emp={emp} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* VISTA MÓVIL: TARJETAS LEGIBLES (CONTROLES >= 44px) */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {payrollLoading ? (
            <div className="py-8 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0288d1]" />
              <span className="text-xs">{t('ronos.payroll.calculating_payroll') || 'Calculando nómina...'}</span>
            </div>
          ) : !payrollData ? (
            <div className="py-8 text-center text-slate-400">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
              <span className="text-xs">{t('ronos.payroll.error_loading_data') || 'No se pudieron cargar los datos de nómina.'}</span>
            </div>
          ) : storeCrew.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              {t('ronos.payroll.no_employees_found') || 'No se encontraron colaboradores para los filtros seleccionados.'}
            </div>
          ) : (
            storeCrew.map((emp) => {
              const isExpanded = expandedEmployeeId === employeeKey(emp)

            return (
              <div key={employeeKey(emp)} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{emp.fullName}</span>
                      {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                    </div>
                    <span className="text-[11px] text-slate-500">{emp.jobTitle || 'Crew'}</span>
                  </div>
                  <span className="text-base font-mono font-black text-slate-900 dark:text-slate-100">
                    {amount(emp.calculationComplete === false ? null : emp.totalInvoicedAmount)}
                  </span>
                </div>

                {(emp.excludedFromPayroll || emp.payrollSource === 'simplify_only') && <p className="text-xs text-amber-700 dark:text-amber-300">{sourceNote(emp)}</p>}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
                  <span>{t('ronos.payroll.hours_label') || 'Horas:'} <strong>{emp.totalHours.toFixed(2)}h</strong></span>
                  <span className="text-slate-500">${emp.payRate.toFixed(2)}/h</span>
                </div>

                <button
                  type="button"
                  onClick={() => toggleExpand(employeeKey(emp))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>{isExpanded ? (t('ronos.payroll.hide_details') || 'Ocultar Desglose') : (t('ronos.payroll.toggle_details') || 'Ver Desglose')}</span>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {isExpanded && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold block">{copy('Sueldo recalculado', 'Recalculated gross pay')}</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white">{amount(emp.calculationComplete === false ? null : emp.totalGrossPay)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold block">{copy('Cargo de agencia estimado', 'Estimated agency charge')}</span>
                      <span className="font-mono font-bold text-amber-600">{amount(emp.calculationComplete === false ? null : emp.cingularFeeAmount)}</span>
                    </div>
                    <div className="col-span-2"><EmployeeEvidence emp={emp} /></div>
                  </div>
                )}
              </div>
            )
          }))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. PAGOS ADMINISTRATIVOS DE SUPERVISORES (RECIBO OFICIAL CERTIFICADO)   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {adminSupervisors.length > 0 && (
        <section
          aria-labelledby="heading-admin-supervisors"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-purple-200 dark:border-purple-900/50 shadow-xs overflow-hidden"
        >
          <div className="p-4 border-b border-purple-100 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 id="heading-admin-supervisors" className="text-xs font-black uppercase tracking-wider text-purple-900 dark:text-purple-200">
                {t('ronos.payroll.admin_payments') || 'Pagos Administrativos de Supervisores'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {copy('Pagos asignados a esta tienda; revisa la evidencia de cada recibo.', 'Payments assigned to this store; review each paystub’s evidence.')}
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950 px-2.5 py-1 rounded-lg self-start sm:self-auto">
              {t('ronos.payroll.admin_certified_badge') || 'Nómina Asumida en Esta Tienda'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">{t('ronos.payroll.col_employee') || 'Supervisor'}</th>
                  <th className="py-3 px-3">{t('ronos.payroll.col_type') || 'Puesto'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.payroll.col_hours') || 'Horas'}</th>
                  <th className="py-3 px-3 text-right">{t('ronos.payroll.col_gross_pay') || 'Salario'}</th>
                  <th className="py-3 px-4 text-right font-black text-emerald-600 dark:text-emerald-400">{copy('Cálculo RONOS', 'RONOS calculation')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {adminSupervisors.map((sup, idx) => (
                  <tr key={`sup-${sup.employeeUserId}-${idx}`} className="hover:bg-purple-50/30 dark:hover:bg-purple-950/20">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      <div>{sup.fullName}</div>
                      <p className="text-xs font-normal text-slate-500 mt-1">{sourceNote(sup)}</p>
                      {sup.auditNote && <p className="text-xs font-normal text-amber-700 dark:text-amber-300 mt-1">{sup.auditNote}</p>}
                      {sup.humanLabel && (
                        <div className="text-[10px] text-purple-700 dark:text-purple-300 font-normal">
                          {sup.humanLabel}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-500">
                      {sup.jobTitle || 'District Supervisor'}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                      {sup.salaryHours && sup.salaryHours > 0 ? `${sup.salaryHours.toFixed(1)}h` : `${sup.totalHours.toFixed(1)}h`}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-800 dark:text-slate-200">
                      {formatCurrency(sup.totalGrossPay)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                      {amount(sup.calculationComplete === false ? null : sup.totalInvoicedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3.1 BANNER INFORMATIVO: SUPERVISIÓN OPERATIVA (NÓMINA EN OTRA TIENDA)    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {payrollData?.operationalSupervisors && payrollData.operationalSupervisors.length > 0 && (
        <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wide">
                {t('ronos.payroll.operational_supervisors_title') || 'Supervisión Operativa de Sucursal'}
              </h4>
              <div className="text-xs text-indigo-800/80 dark:text-indigo-300/80 mt-0.5 space-y-0.5">
                {payrollData.operationalSupervisors.map((opSup, idx) => (
                  <p key={`op-sup-${idx}`}>
                    <strong className="font-semibold text-indigo-950 dark:text-indigo-100">{opSup.supervisorName}</strong>: {opSup.humanLabel} ({t('ronos.payroll.zero_cost_note') || 'Cero impacto en esta tienda: $0.00 facturados / 0.0h'}).
                  </p>
                ))}
              </div>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-900/40 px-2.5 py-1 rounded-lg self-start sm:self-auto shrink-0">
            $0.00 / 0.0h {t('ronos.payroll.invoiced_label') || 'Facturado'}
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4. RECIBOS PENDIENTES CON TEXTO REGLAMENTARIO OBLIGATORIO               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {pendingPaystubs.length > 0 && (
        <section
          aria-labelledby="heading-pending-receipts"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-900/60 shadow-xs p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div>
              <h3 id="heading-pending-receipts" className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {t('ronos.payroll.pending_receipts') || 'Recibos Pendientes de Comprobación'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {pendingPaystubs.length} {t('ronos.payroll.pending_stubs_notice') || 'pagos registrados en Simplify HR sin comprobante checador asociado.'}
              </p>
            </div>
          </div>

          {/* TEXTO REGLAMENTARIO OBLIGATORIO */}
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1">
            <span className="font-bold uppercase tracking-wider text-[11px] block">
              {copy('Qué falta revisar', 'What needs review')}
            </span>
            <p className="leading-relaxed">
              {t('ronos.payroll.reconciliation_notice_desc') || 'Existe un pago en Simplify HR, pero aún no hay evidencia suficiente para identificar su tarjeta RONOS. No se vuelve a pagar ni se modifica dinero desde esta pantalla.'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">{t('ronos.payroll.col_receipt') || 'Recibo'}</th>
                  <th className="py-2.5 px-3">{t('ronos.payroll.col_employee') || 'Colaborador'}</th>
                  <th className="py-2.5 px-3 text-right">{t('ronos.payroll.col_hours') || 'Horas'}</th>
                  <th className="py-2.5 px-3 text-right">{copy('Sueldo bruto del recibo', 'Paystub gross pay')}</th>
                  <th className="py-2.5 px-3">{t('ronos.payroll.col_validation_suggestion') || 'Sugerencia de Validación'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pendingPaystubs.map((stub, idx) => (
                  <tr key={`${stub.paystubId}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                      #{idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                      {stub.employeeName || (t('ronos.payroll.employee_unknown') || 'Colaborador no especificado')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {stub.hours > 0 ? `${stub.hours.toFixed(2)}h` : '0.00h'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatCurrency(stub.grossWages)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {stub.suggestedRonosMatch ? (
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {t('ronos.payroll.suggested_match') || 'Coincidencia sugerida:'} {stub.suggestedRonosMatch}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">{t('ronos.payroll.validate_in_store') || 'Validar en tienda'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
