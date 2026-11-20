/**
 * @module components/ronos/StoreAttendanceTab
 * @description Pestaña de Control de Asistencia y Reloj Checador en Tienda (Timecards & Daily Clock)
 *   con validación cruzada Planificador (`shifts`) + Toast POS (`punches`) + RONOS bajo las reglas
 *   oficiales de Cingular HR / `NHP TEG SPANISH.pdf` (`lib/ronos-attendance-policy.ts`).
 *
 * @businessRules
 *   - Día laboral oficial: 6:00 AM a 5:59 AM del siguiente día (`America/Los_Angeles`).
 *   - Puntualidad estricta de ±3 min respecto al turno publicado del Planificador:
 *     * A Tiempo (±3 min) -> badge emerald.
 *     * Entrada Temprana No Autorizada (>3 min antes, ej. 8:56 AM para turno 9:00 AM) -> badge amber/rose.
 *     * Cobertura / Emergencia Autorizada (exento por solicitud gerencial) -> badge sky/indigo con razón explícita.
 *     * Tardanza (>3 min después, ej. 9:04 AM para turno 9:00 AM) -> badge rose.
 *     * Salida Temprana sin Autorización -> badge amber.
 *     * Reparar Ponchada (Discrepancia Toast POS vs RONOS / Ponchada Incompleta) -> badge purple/rose.
 *     * Infracciones de Lunch (Exceso >30m, Lunch Corto <30m, 5ta Hora >5.0h, Lunch Omitido >6h) -> badges claros sin revelar márgenes internos.
 *     * Exento (Manager / Supervisor Asalariado) -> badge slate neutro, sin alertas disciplinarias.
 *   - Permite ejecutar vista previa (`dry_run=true`) o despacho de auditoría NHP diaria (`/api/cron/sync-ronos-violations`) para la fecha y sucursal activas.
 *
 * @dataFlow
 *   Recibe `storeData` enriquecido desde `/api/ronos/punches?companyId=...` y consulta `/api/cron/sync-ronos-violations`.
 *
 * @notes
 *   - Cumple con estándar Mobile-First con controles táctiles >= 44px en modo claro y oscuro.
 *   - Bilingüe completo (i18n) vía `useLanguage()` sin textos hardcodeados visibles.
 */

'use client'

import React, { useState, useMemo, useEffect } from 'react'
import {
  Building2,
  Clock,
  Coffee,
  Sun,
  Moon,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Eye,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Wrench,
  CalendarClock,
  Mail,
  Send,
  FileSearch,
  X
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import {
  StoreAuditData,
  EmployeeTimecard,
  StoreOption,
  EmployeeDayPunch,
  DailyViolation,
  RonosDayAttendanceEvaluation
} from './types'
import EmployeeDetailView from './EmployeeDetailView'
import { getPacificBusinessDate, detectTodayAnomalies, formatTime12h, getPunchIsoString, formatUsaDate } from './helpers'

interface StoreAttendanceTabProps {
  storeData: StoreAuditData | null
  loading: boolean
  selectedCompanyId: number
  stores: StoreOption[]
  selectedEmployeeDetail: EmployeeTimecard | null
  onSelectEmployee: (emp: EmployeeTimecard | null) => void
  onOpenPhoto: (photoUrl: string, title: string, employeeName: string, timestamp: string) => void
  onOpenEmail: (employee: EmployeeTimecard, dayContext?: { date: string; violation?: DailyViolation }) => void
  onSelectStore?: (companyId: number) => void
}

function getPreferredViolationDay(employee: EmployeeTimecard): { date: string; violation?: DailyViolation } | undefined {
  for (const day of employee.days || []) {
    const active = (day.violations || []).filter(v => v && v.isViolation !== false)
    if (active.length > 0) {
      return { date: (day.date || '').slice(0, 10), violation: active[0] }
    }
  }
  return undefined
}

interface DailyCronAuditStoreOutcome {
  ronosCompanyId: number
  storeName: string
  violationsCount: number
  employeesWithViolationsCount?: number
  skippedAlreadyNotified?: number
  authorizedCallInsCount: number
  exemptSalariedCount?: number
  emailsSent: number
  recordsInserted: number
  error?: string
  sample?: Array<{
    employeeUserId: number
    employee: string
    punctualityStatus: string
    violationTypes: string[]
    scheduledShift: string | null
    ronosClockIn: string | null
    ronosClockOut: string | null
    toastClockIn: string | null
    toastClockOut: string | null
    deliverableEmail: string | null
    emailReason: string
  }>
  authorizedCallInsSample?: Array<{
    employee: string
    scheduledStart: string | null
    ronosClockIn: string | null
    exemptionReason: string | null
    signals: string[]
  }>
}

interface DailyCronAuditResponse {
  success: boolean
  dry_run?: boolean
  business_date?: string
  total_violations?: number
  total_authorized_early_call_ins?: number
  emails_sent?: number
  records_inserted?: number
  stores_processed?: DailyCronAuditStoreOutcome[]
  error?: string
}

function getPreviousBusinessDate(dateIso: string): string {
  const parts = dateIso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return dateIso
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function StoreAttendanceTab({
  storeData,
  loading,
  selectedCompanyId,
  stores,
  selectedEmployeeDetail,
  onSelectEmployee,
  onOpenPhoto,
  onOpenEmail,
  onSelectStore
}: StoreAttendanceTabProps) {
  const { t, language } = useLanguage()

  // Selector de vista: 'live_today' (En vivo hoy) vs 'weekly_history' (Historial semanal)
  const [attendanceViewMode, setAttendanceViewMode] = useState<'live_today' | 'weekly_history'>('live_today')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterExceptionsOnly, setFilterExceptionsOnly] = useState(false)
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(null)

  // Temporizador en vivo para refrescar cálculos dependientes de la hora (minutos en descanso, anomalías >14h)
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  const currentWorkDate = useMemo(() => getPacificBusinessDate(currentTimeMs), [currentTimeMs])
  const [auditDate, setAuditDate] = useState<string>(() => getPreviousBusinessDate(getPacificBusinessDate()))

  // Ajustar fecha de auditoría al rango de la semana seleccionada si cambia storeData
  useEffect(() => {
    if (!storeData?.startDate || !storeData?.endDate) return
    const s = storeData.startDate.slice(0, 10)
    const e = storeData.endDate.slice(0, 10)
    const defaultPrev = getPreviousBusinessDate(currentWorkDate)
    if (defaultPrev >= s && defaultPrev <= e) {
      setAuditDate(defaultPrev)
    } else if (currentWorkDate >= s && currentWorkDate <= e) {
      setAuditDate(currentWorkDate)
    } else {
      setAuditDate(e)
    }
  }, [storeData?.startDate, storeData?.endDate, currentWorkDate])

  // Estado del panel de auditoría diaria NHP (/api/cron/sync-ronos-violations)
  const [nhpAuditLoading, setNhpAuditLoading] = useState(false)
  const [nhpDispatching, setNhpDispatching] = useState(false)
  const [nhpAuditError, setNhpAuditError] = useState<string | null>(null)
  const [nhpAuditResult, setNhpAuditResult] = useState<DailyCronAuditResponse | null>(null)

  // Limpiar resultados de auditoría al cambiar de sucursal
  useEffect(() => {
    setNhpAuditResult(null)
    setNhpAuditError(null)
  }, [selectedCompanyId])

  const activeStoreName = useMemo(() => {
    if (selectedCompanyId === 0) {
      return t('ronos.all_stores') || 'Todas las Tiendas (Cadena)'
    }
    const st = stores.find(s => s.ronosCompanyId === selectedCompanyId)
    return st ? `${st.tegName} (#${st.tegStoreId})` : storeData?.storeName || 'Sucursal'
  }, [selectedCompanyId, stores, storeData?.storeName, t])

  const runDailyNhpAudit = async (dryRun: boolean) => {
    if (!selectedCompanyId || selectedCompanyId <= 0) return
    if (!dryRun) {
      const confirmMsg = (
        t('ronos.attendance.nhp_dispatch_confirm', { date: formatUsaDate(auditDate) }) ||
        `¿Enviar avisos oficiales de puntualidad, comida y reparación de ponchadas para el ${formatUsaDate(auditDate)}?`
      )
      if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) {
        return
      }
    }

    if (dryRun) {
      setNhpAuditLoading(true)
    } else {
      setNhpDispatching(true)
    }
    setNhpAuditError(null)

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/cron/sync-ronos-violations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company_id: selectedCompanyId,
          date: auditDate,
          dry_run: dryRun,
          force: true
        })
      })
      const json: DailyCronAuditResponse = await res.json().catch(() => ({ success: false }))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('ronos.attendance.nhp_error_audit') || 'No se pudo ejecutar la auditoría NHP diaria.')
      }
      setNhpAuditResult(json)
    } catch (err: any) {
      setNhpAuditError(err?.message || t('ronos.attendance.nhp_error_audit') || 'No se pudo ejecutar la auditoría NHP diaria.')
    } finally {
      setNhpAuditLoading(false)
      setNhpDispatching(false)
    }
  }

  // Helpers de etiquetas y estilos visuales NHP
  const getPunctualityBadgeSpec = (ev?: RonosDayAttendanceEvaluation | null) => {
    if (!ev) return null
    if (ev.isExemptSalaried || ev.punctualityStatus === 'EXEMPT_SALARIED') {
      return {
        label: t('ronos.attendance.nhp_badge_exempt') || 'Exento (Manager / Supervisor Asalariado)',
        className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        icon: 'shield' as const
      }
    }
    switch (ev.punctualityStatus) {
      case 'ON_TIME':
        return {
          label: t('ronos.attendance.nhp_badge_on_time') || 'A Tiempo (±3 min)',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
          icon: 'check' as const
        }
      case 'AUTHORIZED_EARLY_CALL_IN':
        return {
          label: t('ronos.attendance.nhp_badge_early_call_in') || 'Cobertura / Emergencia Autorizada',
          className: 'bg-sky-50 text-indigo-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
          icon: 'shield' as const
        }
      case 'UNAUTHORIZED_EARLY_IN':
        return {
          label: `${t('ronos.attendance.nhp_badge_early_unauth') || 'Entrada Temprana No Autorizada'}${ev.diffMinutesFromSchedule !== null ? ` (${Math.abs(ev.diffMinutesFromSchedule)}m)` : ''}`,
          className: 'bg-amber-50 text-rose-700 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
          icon: 'alert' as const
        }
      case 'LATE_CLOCK_IN':
        return {
          label: `${t('ronos.attendance.nhp_badge_late') || 'Tardanza (>3 min)'}${ev.diffMinutesFromSchedule !== null ? ` (+${ev.diffMinutesFromSchedule}m)` : ''}`,
          className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
          icon: 'alert' as const
        }
      case 'REPAIR_RONOS_PUNCH':
        return {
          label: t('ronos.attendance.nhp_badge_repair') || 'Reparar Ponchada (Toast vs RONOS)',
          className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
          icon: 'wrench' as const
        }
      case 'NO_SHOW':
        return {
          label: t('ronos.attendance.nhp_badge_no_show') || 'Inasistencia (No Show)',
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800',
          icon: 'alert' as const
        }
      case 'REST_OR_PTO':
        return {
          label: language === 'en' ? ev.punctualityLabelEn : ev.punctualityLabelEs,
          className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
          icon: 'clock' as const
        }
      case 'UNSCHEDULED_WORKED':
        return {
          label: t('ronos.attendance.nhp_badge_unscheduled') || 'Turno Trabajado (Sin Planificador)',
          className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
          icon: 'clock' as const
        }
      case 'NO_SHIFT_NO_PUNCH':
        if (ev.scheduledShift?.hasPublishedShift) {
          return {
            label: t('ronos.attendance.nhp_badge_upcoming') || 'Turno Programado (Próximo)',
            className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
            icon: 'clock' as const
          }
        }
        return null
      default:
        return null
    }
  }

  const getViolationBadgeSpec = (v: DailyViolation) => {
    switch (v.type) {
      case 'REPAIR_RONOS_PUNCH':
        return {
          label: t('ronos.attendance.nhp_badge_repair') || 'Reparar Ponchada (Toast vs RONOS)',
          className: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
        }
      case 'BROKEN_TIMECARD':
      case 'MISSING_PUNCH':
        return {
          label: t('ronos.attendance.nhp_badge_broken_card') || 'Ponchada Incompleta',
          className: 'bg-purple-50 text-rose-700 border-purple-200 dark:bg-purple-950/40 dark:text-rose-300 dark:border-purple-800'
        }
      case 'UNAUTHORIZED_EARLY_IN':
        return {
          label: `${t('ronos.attendance.nhp_badge_early_unauth') || 'Entrada Temprana No Autorizada'}${v.minutes ? ` (${v.minutes}m)` : ''}`,
          className: 'bg-amber-100 text-rose-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
        }
      case 'LATE_CLOCK_IN':
        return {
          label: `${t('ronos.attendance.nhp_badge_late') || 'Tardanza (>3 min)'}${v.minutes ? ` (+${v.minutes}m)` : ''}`,
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }
      case 'EARLY_CLOCK_OUT':
        return {
          label: `${t('ronos.attendance.nhp_badge_early_out') || 'Salida Temprana sin Autorización'}${v.minutes ? ` (-${v.minutes}m)` : ''}`,
          className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
        }
      case 'NO_SHOW':
        return {
          label: t('ronos.attendance.nhp_badge_no_show') || 'Inasistencia (No Show)',
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }
      case 'MEDICAL_NOTE_REQUIRED':
        return {
          label: t('ronos.attendance.nhp_badge_medical_note') || 'Justificante Médico Requerido (3+ días)',
          className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
        }
      case 'LONG_LUNCH':
        return {
          label: `${t('ronos.attendance.nhp_badge_long_lunch') || 'Exceso de Lunch (>30m)'}${v.minutes ? ` (${Math.floor(v.minutes)}m)` : ''}`,
          className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
        }
      case 'MEAL_PENALTY_SHORT':
        return {
          label: `${t('ronos.attendance.nhp_badge_short_lunch') || 'Lunch Corto (<30m)'}${v.minutes ? ` (${Math.floor(v.minutes)}m)` : ''}`,
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }
      case 'MEAL_PENALTY_LATE':
        return {
          label: t('ronos.attendance.nhp_badge_late_lunch') || '5ta Hora (>5.0h)',
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }
      case 'MEAL_PENALTY_MISSED':
        return {
          label: t('ronos.attendance.nhp_badge_missed_lunch') || 'Lunch Omitido (>6h)',
          className: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
        }
      default:
        return {
          label: v.title || v.type,
          className: v.severity === 'critical'
            ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
            : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
        }
    }
  }

  // Renderiza la comparativa compacta Planificador · Toast POS · RONOS para un día específico
  const renderDayCrossRefRow = (day: EmployeeDayPunch, emp: EmployeeTimecard) => {
    const ev = day.nhpEvaluation
    const sched = ev?.scheduledShift || day.scheduledShift
    const toast = ev?.toastSummary || day.toastSummary
    const badgeSpec = getPunctualityBadgeSpec(ev)
    const activeViolations = (day.violations || []).filter(v => v && v.isViolation !== false)

    const ronosIn = ev?.ronosSummary?.clockInLA || (day.clockInTime ? formatTime12h(day.clockInTime) : null)
    const ronosOut = ev?.ronosSummary?.clockOutLA || (day.clockOutTime ? formatTime12h(day.clockOutTime) : null)
    const ronosLunchIn = ev?.ronosSummary?.lunchStartLA || (day.lunchStartTime ? formatTime12h(day.lunchStartTime) : null)
    const ronosLunchOut = ev?.ronosSummary?.lunchEndLA || (day.lunchEndTime ? formatTime12h(day.lunchEndTime) : null)

    const hasAnyContent =
      Boolean(sched?.hasPublishedShift) ||
      Boolean(toast?.hasToastPunches) ||
      Boolean(ronosIn || ronosOut || (day.totalHours || 0) > 0) ||
      activeViolations.length > 0 ||
      Boolean(ev?.isExemptSalaried)

    if (!hasAnyContent) return null

    return (
      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
        {/* Fuentes cruzadas: Planificador, Toast POS, RONOS */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* Horario Publicado (Planificador) */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
            <CalendarClock className="w-3 h-3 text-[#0288d1] shrink-0" />
            <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('ronos.attendance.nhp_source_planner') || 'Planificador'}:
            </span>
            <span>
              {sched?.hasPublishedShift
                ? `${sched.startTimeLA || '--'} – ${sched.endTimeLA || '--'}`
                : (t('ronos.attendance.nhp_no_shift') || 'Sin turno publicado')}
            </span>
          </span>

          {/* Ponchadas Toast POS */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 font-mono">
            <Clock className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              {t('ronos.attendance.nhp_source_toast') || 'Toast POS'}:
            </span>
            <span>
              {toast?.hasToastPunches
                ? `${toast.clockInLA || '--'} – ${toast.clockOutLA || '--'}${toast.lunchStartLA ? ` (L: ${toast.lunchStartLA}-${toast.lunchEndLA || '--'})` : ''}`
                : (t('ronos.attendance.nhp_no_toast') || 'Sin ponchada Toast')}
            </span>
          </span>

          {/* Ponchadas RONOS */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-50/70 dark:bg-sky-950/30 text-sky-900 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800/60 font-mono">
            <Clock className="w-3 h-3 text-sky-500 shrink-0" />
            <span className="font-sans font-bold text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-400">
              {t('ronos.attendance.nhp_source_ronos') || 'RONOS'}:
            </span>
            <span>
              {ronosIn || ronosOut
                ? `${ronosIn || '--'} – ${ronosOut || '--'}${ronosLunchIn ? ` (L: ${ronosLunchIn}-${ronosLunchOut || '--'})` : ''}`
                : (t('ronos.attendance.nhp_no_ronos') || 'Sin ponchada RONOS')}
            </span>
          </span>
        </div>

        {/* Badges de Reglas NHP + Exención / Discrepancia */}
        <div className="flex flex-wrap items-center gap-1.5">
          {badgeSpec && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeSpec.className}`}>
              {badgeSpec.icon === 'check' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
              {badgeSpec.icon === 'shield' && <ShieldCheck className="w-3 h-3 shrink-0" />}
              {badgeSpec.icon === 'wrench' && <Wrench className="w-3 h-3 shrink-0" />}
              {badgeSpec.icon === 'alert' && <AlertTriangle className="w-3 h-3 shrink-0" />}
              {badgeSpec.icon === 'clock' && <Clock className="w-3 h-3 shrink-0" />}
              <span>{badgeSpec.label}</span>
            </span>
          )}

          {activeViolations.map((v, idx) => {
            if (ev?.punctualityStatus === v.type) return null
            const vSpec = getViolationBadgeSpec(v)
            return (
              <span
                key={`${v.type}-${idx}`}
                title={v.description}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${vSpec.className}`}
              >
                {v.type === 'REPAIR_RONOS_PUNCH' || v.type === 'BROKEN_TIMECARD' ? (
                  <Wrench className="w-3 h-3 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                )}
                <span>{vSpec.label}</span>
              </span>
            )
          })}

          {ev?.isAuthorizedEarlyCallIn && ev.exemptionReason && (
            <span className="text-[11px] text-sky-700 dark:text-sky-300 font-medium">
              {t('ronos.attendance.nhp_exemption_reason_prefix') || 'No penalizado:'} {ev.exemptionReason}
              {ev.earlyCallInSignals?.length > 0 ? ` (${ev.earlyCallInSignals[0]})` : ''}
            </span>
          )}

          {ev?.hasToastRonosDiscrepancy && ev.discrepancyDetails?.length > 0 && (
            <span className="text-[11px] text-purple-700 dark:text-purple-300 font-medium">
              {t('ronos.attendance.nhp_toast_vs_ronos_detail') || 'Toast POS vs RONOS:'} {ev.discrepancyDetails[0]}
            </span>
          )}

          {!ev?.isExemptSalaried && activeViolations.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenEmail(emp, { date: day.date?.slice(0, 10) || currentWorkDate, violation: activeViolations[0] })}
              className="min-h-[44px] px-3 py-1 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{t('ronos.attendance.nhp_notify_btn') || 'Notificar'}</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  // Cálculo de roster de hoy con los 6 estados claros + cruces Planificador / Toast / RONOS
  const todayLiveRoster = useMemo(() => {
    if (!storeData?.employees || !Array.isArray(storeData.employees)) {
      return {
        inShift: [] as { emp: EmployeeTimecard; lastPunchTime: string; photoUrl?: string | null; todayDay?: EmployeeDayPunch }[],
        onLunch: [] as { emp: EmployeeTimecard; lunchStartTime: string; minutes: number; todayDay?: EmployeeDayPunch }[],
        clockedOut: [] as { emp: EmployeeTimecard; clockOutTime: string; todayDay?: EmployeeDayPunch }[],
        todaySpecialEval: [] as { emp: EmployeeTimecard; todayDay: EmployeeDayPunch }[],
        openToday: [],
        historicalBroken: [],
        pendingWeeklyReview: []
      }
    }

    const inShift: { emp: EmployeeTimecard; lastPunchTime: string; photoUrl?: string | null; todayDay?: EmployeeDayPunch }[] = []
    const onLunch: { emp: EmployeeTimecard; lunchStartTime: string; minutes: number; todayDay?: EmployeeDayPunch }[] = []
    const clockedOut: { emp: EmployeeTimecard; clockOutTime: string; todayDay?: EmployeeDayPunch }[] = []
    const todaySpecialEval: { emp: EmployeeTimecard; todayDay: EmployeeDayPunch }[] = []

    const { openToday, historicalBroken, pendingWeeklyReview } = detectTodayAnomalies(storeData.employees, currentWorkDate, currentTimeMs)

    for (const emp of storeData.employees) {
      if (!emp?.days || !Array.isArray(emp.days)) continue
      const todayDay = emp.days.find(d => d?.date?.substring(0, 10) === currentWorkDate)
      if (!todayDay) continue

      const validPunches = (todayDay.punches || []).filter(p => {
        if (!p || typeof p !== 'object') return false
        const raw = getPunchIsoString(p)
        if (raw == null || raw === '') return false
        const pMs = new Date(raw).getTime()
        return !isNaN(pMs) && pMs > 86400000 && pMs <= currentTimeMs
      })

      if (validPunches.length === 0) {
        // Detectar empleados con turno publicado hoy o ponchada solo en Toast POS sin ponchada aún en RONOS
        const ev = todayDay.nhpEvaluation
        if (
          ev?.hasToastRonosDiscrepancy ||
          ev?.punctualityStatus === 'REPAIR_RONOS_PUNCH' ||
          ev?.punctualityStatus === 'NO_SHOW' ||
          todayDay.scheduledShift?.hasPublishedShift ||
          todayDay.toastSummary?.hasToastPunches
        ) {
          todaySpecialEval.push({ emp, todayDay })
        }
        continue
      }

      const sorted = [...validPunches].sort((a, b) => {
        const timeA = new Date(getPunchIsoString(a)).getTime()
        const timeB = new Date(getPunchIsoString(b)).getTime()
        return timeA - timeB
      })

      const lastPunch = sorted[sorted.length - 1]
      const lastRaw = getPunchIsoString(lastPunch)
      const formattedLastTime = formatTime12h(lastRaw) || lastRaw
      const pType = Number(lastPunch?.punchType)
      const punchPhoto = lastPunch.photoUrl || (lastPunch as any).photoURL || todayDay.clockInPhoto || null

      if (pType === 1 || pType === 4) {
        inShift.push({ emp, lastPunchTime: formattedLastTime || 'En turno', photoUrl: punchPhoto, todayDay })
      } else if (pType === 3) {
        const lunchMs = new Date(lastRaw).getTime()
        const elapsedMins = Math.max(0, Math.round((currentTimeMs - lunchMs) / 60000))
        onLunch.push({ emp, lunchStartTime: formattedLastTime || 'En comida', minutes: elapsedMins, todayDay })
      } else if (pType === 2) {
        clockedOut.push({ emp, clockOutTime: formattedLastTime || 'Salida', todayDay })
      }
    }

    return { inShift, onLunch, clockedOut, todaySpecialEval, openToday, historicalBroken, pendingWeeklyReview }
  }, [storeData, currentWorkDate, currentTimeMs])

  // Filtrado de empleados para historial semanal (incluye alertas NHP)
  const filteredEmployees = useMemo(() => {
    if (!Array.isArray(storeData?.employees)) return []

    return storeData.employees.filter((emp) => {
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim()
        const matchName = emp.fullName.toLowerCase().includes(q)
        const matchPin = (emp.pin || '').includes(q)
        const matchJob = (emp.jobTitle || '').toLowerCase().includes(q)
        if (!matchName && !matchPin && !matchJob) return false
      }

      if (filterExceptionsOnly) {
        const hasNhpIssues = (emp.nhpSummary?.totalActiveViolationsCount || 0) > 0
        const hasDayViolations = (emp.days || []).some(d => (d.violations || []).some(v => v.isViolation !== false))
        const hasIssue = emp.brokenHours || (emp.mealPenaltyCount || 0) > 0 || hasNhpIssues || hasDayViolations
        if (!hasIssue) return false
      }

      return true
    })
  }, [storeData?.employees, searchTerm, filterExceptionsOnly])

  // Si hay un empleado seleccionado, mostrar su Kardex detallado
  if (selectedEmployeeDetail) {
    return (
      <EmployeeDetailView
        employee={selectedEmployeeDetail}
        storeName={activeStoreName}
        startDate={storeData?.startDate}
        endDate={storeData?.endDate}
        onBack={() => onSelectEmployee(null)}
        onOpenPhoto={onOpenPhoto}
        onOpenEmail={(emp) => onOpenEmail(emp, getPreferredViolationDay(emp))}
        allEmployees={storeData?.employees || []}
        onSelectEmployee={onSelectEmployee}
      />
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGLA: "TODAS LAS TIENDAS" (0) SOLO MUESTRA EXCEPCIONES Y PIDE SELECCIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  if (selectedCompanyId === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-sky-200 dark:border-sky-800 p-5 shadow-xs">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-950 text-[#0288d1] flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                {t('ronos.attendance.store_required') || 'Selección de sucursal requerida'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
                {t('ronos.attendance.store_required_desc') || 'Para consultar el checador en vivo o el historial completo de colaboradores, selecciona una tienda específica. En esta vista general solo se muestran excepciones que requieren atención inmediata.'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            {t('ronos.attendance.select_store_prompt') || 'Selecciona una sucursal para checador completo:'}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {stores.map(st => (
              <button
                key={st.ronosCompanyId}
                type="button"
                onClick={() => onSelectStore ? onSelectStore(st.ronosCompanyId) : null}
                className="min-h-[44px] p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#0288d1] dark:hover:border-sky-500 bg-slate-50 dark:bg-slate-800/60 hover:bg-sky-50/50 dark:hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-between text-left group"
              >
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-mono text-slate-400 font-bold block">#{st.tegStoreId}</span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-[#0288d1] truncate block">
                    {st.tegName}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#0288d1] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISTA DE TIENDA ESPECÍFICA (CHEQUEO EN VIVO O HISTORIAL SEMANAL)
  // ═══════════════════════════════════════════════════════════════════════════
  const todayTotalPunchesCount =
    todayLiveRoster.inShift.length +
    todayLiveRoster.onLunch.length +
    todayLiveRoster.clockedOut.length +
    todayLiveRoster.openToday.length
  const nhpStoreSummary = storeData?.nhpAuditSummary
  const storeCronOutcome = nhpAuditResult?.stores_processed?.find(
    s => s.ronosCompanyId === selectedCompanyId
  ) || nhpAuditResult?.stores_processed?.[0]

  return (
    <div className="space-y-4">
      {/* 1. BARRA DE CONTROL: TOGGLE "EN VIVO HOY" VS "HISTORIAL SEMANAL" */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
            {activeStoreName}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {attendanceViewMode === 'live_today'
              ? (t('ronos.attendance.live_desc') || 'Personal en turno adentro, descansos y salidas de hoy.')
              : (t('ronos.attendance.history_desc') || 'Historial semanal consolidado con horas regulares y descansos.')}
          </p>
        </div>

        <div
          role="group"
          aria-label={t('ronos.attendance.title') || 'Modo de asistencia'}
          className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto"
        >
          <button
            type="button"
            onClick={() => setAttendanceViewMode('live_today')}
            className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              attendanceViewMode === 'live_today'
                ? 'bg-white dark:bg-slate-900 text-[#0288d1] dark:text-sky-300 shadow-xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-emerald-500" />
            <span>{t('ronos.attendance.toggle_live') || 'En Vivo Hoy'}</span>
          </button>
          <button
            type="button"
            onClick={() => setAttendanceViewMode('weekly_history')}
            className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              attendanceViewMode === 'weekly_history'
                ? 'bg-white dark:bg-slate-900 text-[#0288d1] dark:text-sky-300 shadow-xs font-black'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-sky-500" />
            <span>{t('ronos.attendance.toggle_history') || 'Historial Semanal'}</span>
          </button>
        </div>
      </div>

      {/* 1B. PANEL DE AUDITORÍA DIARIA NHP & REPARACIÓN DE PONCHADAS (DRY-RUN / DISPATCH) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 flex items-center justify-center shrink-0 border border-sky-200 dark:border-sky-800">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white">
                {t('ronos.attendance.nhp_audit_title') || 'Auditoría NHP & Validación Cruzada (Planificador · Toast · RONOS)'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('ronos.attendance.nhp_audit_subtitle') || 'Reglas Cingular HR / NHP (±3 min puntualidad, 30 min comida / 5ta hora, reparación RONOS).'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="nhp-audit-date" className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {t('ronos.attendance.nhp_audit_date_label') || 'Fecha auditada'}:
              </label>
              <input
                id="nhp-audit-date"
                type="date"
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
                className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => runDailyNhpAudit(true)}
              disabled={nhpAuditLoading || nhpDispatching || loading}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-sky-300 dark:border-sky-700 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 text-[#0288d1] dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              <FileSearch className="w-4 h-4" />
              <span>
                {nhpAuditLoading
                  ? (t('ronos.attendance.nhp_preview_loading') || 'Auditando...')
                  : (t('ronos.attendance.nhp_preview_btn') || 'Vista Previa NHP')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => runDailyNhpAudit(false)}
              disabled={nhpAuditLoading || nhpDispatching || loading}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0288d1] hover:bg-[#0277bd] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {nhpDispatching
                  ? (t('ronos.attendance.nhp_dispatch_loading') || 'Enviando avisos...')
                  : (t('ronos.attendance.nhp_dispatch_btn') || 'Enviar Avisos NHP')}
              </span>
            </button>
          </div>
        </div>

        {/* KPIs Semanales de Cumplimiento NHP (cuando storeData incluye nhpAuditSummary) */}
        {nhpStoreSummary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block">
                {t('ronos.attendance.nhp_kpi_violations') || 'Infracciones NHP'}
              </span>
              <span className={`text-base font-black font-mono ${nhpStoreSummary.totalViolations > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {nhpStoreSummary.totalViolations}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/70 dark:border-rose-900/50">
              <span className="text-[10px] font-bold uppercase text-rose-600 dark:text-rose-400 block">
                {t('ronos.attendance.nhp_kpi_punctuality') || 'Puntualidad ±3m'}
              </span>
              <span className="text-base font-black font-mono text-rose-700 dark:text-rose-300">
                {nhpStoreSummary.punctualityViolations}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200/70 dark:border-purple-900/50">
              <span className="text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400 block">
                {t('ronos.attendance.nhp_kpi_repairs') || 'Reparar Ponchada'}
              </span>
              <span className="text-base font-black font-mono text-purple-700 dark:text-purple-300">
                {nhpStoreSummary.repairViolations}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50">
              <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400 block">
                {t('ronos.attendance.nhp_kpi_meals') || 'Comidas 30m/5h'}
              </span>
              <span className="text-base font-black font-mono text-amber-800 dark:text-amber-300">
                {nhpStoreSummary.mealViolations}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/20 border border-sky-200/70 dark:border-sky-900/50">
              <span className="text-[10px] font-bold uppercase text-sky-700 dark:text-sky-400 block">
                {t('ronos.attendance.nhp_kpi_call_ins') || 'Coberturas Exentas'}
              </span>
              <span className="text-base font-black font-mono text-sky-700 dark:text-sky-300">
                {nhpStoreSummary.authorizedEarlyCallIns}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 block">
                {t('ronos.attendance.nhp_kpi_salaried') || 'Exentos Asalariados'}
              </span>
              <span className="text-base font-black font-mono text-slate-700 dark:text-slate-300">
                {nhpStoreSummary.exemptSalariedCount}
              </span>
            </div>
          </div>
        )}

        {/* Error de auditoría */}
        {nhpAuditError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{nhpAuditError}</span>
            </div>
            <button
              type="button"
              onClick={() => setNhpAuditError(null)}
              aria-label={t('ronos.attendance.nhp_close_panel') || 'Ocultar resumen'}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Resultado de Vista Previa o Despacho NHP */}
        {nhpAuditResult && storeCronOutcome && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                  nhpAuditResult.dry_run
                    ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                }`}>
                  {nhpAuditResult.dry_run
                    ? (t('ronos.attendance.nhp_preview_title') || 'Resumen de Auditoría Diaria NHP')
                    : (t('ronos.attendance.nhp_dispatch_done', { date: formatUsaDate(nhpAuditResult.business_date) }) || `Despacho completado para ${formatUsaDate(nhpAuditResult.business_date)}`)}
                </span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                  {formatUsaDate(nhpAuditResult.business_date)}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  · {t('ronos.attendance.nhp_kpi_violations') || 'Infracciones NHP'}: <strong className="text-slate-900 dark:text-white">{storeCronOutcome.violationsCount}</strong>
                  {' '}· {t('ronos.attendance.nhp_kpi_call_ins') || 'Coberturas Exentas'}: <strong className="text-sky-700 dark:text-sky-300">{storeCronOutcome.authorizedCallInsCount}</strong>
                  {!nhpAuditResult.dry_run && (
                    <> · {t('ronos.attendance.nhp_kpi_emails_sent') || 'Correos Enviados'}: <strong className="text-emerald-600 dark:text-emerald-400">{storeCronOutcome.emailsSent}</strong></>
                  )}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setNhpAuditResult(null)}
                className="min-h-[44px] px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
              >
                {t('ronos.attendance.nhp_close_panel') || 'Ocultar resumen'}
              </button>
            </div>

            {storeCronOutcome.error && (
              <div className="text-rose-600 dark:text-rose-400 font-semibold">
                {storeCronOutcome.error}
              </div>
            )}

            {(!storeCronOutcome.sample || storeCronOutcome.sample.length === 0) &&
            (!storeCronOutcome.authorizedCallInsSample || storeCronOutcome.authorizedCallInsSample.length === 0) && (
              <div className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t('ronos.attendance.nhp_no_audit_issues') || 'Sin infracciones NHP ni discrepancias Toast vs RONOS para esta fecha.'}</span>
              </div>
            )}

            {storeCronOutcome.sample && storeCronOutcome.sample.length > 0 && (
              <div className="space-y-1.5">
                {storeCronOutcome.sample.map((s) => (
                  <div
                    key={`nhp-sample-${s.employeeUserId}`}
                    className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold text-slate-900 dark:text-white truncate">{s.employee}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {t('ronos.attendance.nhp_source_planner') || 'Planificador'}: {s.scheduledShift || '--'} ·{' '}
                        {t('ronos.attendance.nhp_source_ronos') || 'RONOS'}: {s.ronosClockIn || '--'}-{s.ronosClockOut || '--'} ·{' '}
                        {t('ronos.attendance.nhp_source_toast') || 'Toast POS'}: {s.toastClockIn || '--'}-{s.toastClockOut || '--'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 shrink-0">
                      {s.violationTypes.map((vt) => {
                        const vSpec = getViolationBadgeSpec({
                          type: vt,
                          title: vt,
                          description: '',
                          severity: 'warning'
                        })
                        return (
                          <span key={vt} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${vSpec.className}`}>
                            {vSpec.label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {storeCronOutcome.authorizedCallInsSample && storeCronOutcome.authorizedCallInsSample.length > 0 && (
              <div className="space-y-1.5">
                {storeCronOutcome.authorizedCallInsSample.map((c, idx) => (
                  <div
                    key={`nhp-callin-${idx}`}
                    className="p-2.5 rounded-lg bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="text-[11px] text-sky-900 dark:text-sky-200 space-y-0.5">
                      <div>
                        <strong>{c.employee}</strong> · {t('ronos.attendance.nhp_source_planner') || 'Planificador'}: {c.scheduledStart || '--'} →{' '}
                        {t('ronos.attendance.nhp_source_ronos') || 'RONOS'}: {c.ronosClockIn || '--'}
                      </div>
                      {c.exemptionReason && (
                        <div className="text-[10px] text-sky-700 dark:text-sky-300">
                          {t('ronos.attendance.nhp_exemption_reason_prefix') || 'No penalizado:'} {c.exemptionReason}
                          {c.signals?.length > 0 ? ` (${c.signals[0]})` : ''}
                        </div>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 dark:bg-sky-900/60 text-indigo-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700 inline-flex items-center gap-1 shrink-0">
                      <ShieldCheck className="w-3 h-3" />
                      <span>{t('ronos.attendance.nhp_badge_early_call_in') || 'Cobertura / Emergencia Autorizada'}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. KPIS DE ESTADOS OPERATIVOS SIMPLES (44px TOUCH AREA) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* En Turno */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {t('ronos.attendance.status_in_shift') || 'En turno'}
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {todayLiveRoster.inShift.length}
          </div>
        </div>

        {/* En Descanso */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {t('ronos.attendance.status_on_break') || 'En descanso'}
            </span>
            <Coffee className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 font-mono">
            {todayLiveRoster.onLunch.length}
          </div>
        </div>

        {/* Salió */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {t('ronos.attendance.status_clocked_out') || 'Salió'}
            </span>
            <Moon className="w-3.5 h-3.5" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {todayLiveRoster.clockedOut.length}
          </div>
        </div>

        {/* Abiertas Hoy */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className={`flex items-center justify-between mb-1 ${
            todayLiveRoster.openToday.length > 0
              ? 'text-rose-600'
              : todayTotalPunchesCount > 0
                ? 'text-emerald-600'
                : 'text-slate-400'
          }`}>
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {t('ronos.attendance.kpi_open_today') || 'Abiertas Hoy'}
            </span>
            {todayLiveRoster.openToday.length > 0 ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : todayTotalPunchesCount > 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
          </div>
          <div className={`text-2xl font-black font-mono ${
            todayLiveRoster.openToday.length > 0
              ? 'text-rose-600'
              : todayTotalPunchesCount > 0
                ? 'text-emerald-600'
                : 'text-slate-400'
          }`}>
            {todayLiveRoster.openToday.length}
          </div>
        </div>
      </div>

      {/* 3A. MODO "EN VIVO HOY" */}
      {attendanceViewMode === 'live_today' && (
        <div className="space-y-4">
          {/* BANNER / LISTA DE ABIERTAS HOY */}
          {todayLiveRoster.openToday.length === 0 ? (
            todayTotalPunchesCount === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-200 block">
                      {t('ronos.attendance.no_punches_today') || 'Sin ponchadas registradas hoy'}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('ronos.attendance.no_punches_today_desc') || 'Aún no se han registrado entradas para esta sucursal en la jornada laboral de hoy.'}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                  0
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-black text-emerald-950 dark:text-emerald-200 block">
                      {t('ronos.attendance.open_today_zero') || '0 abiertas hoy · Checador al día'}
                    </span>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      {t('ronos.attendance.open_today_desc') || 'Anomalías verificadas en el día laboral vigente (6:00 AM a 5:59 AM).'}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                  0
                </span>
              </div>
            )
          ) : (
            <div className="p-4 rounded-2xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-black text-rose-950 dark:text-rose-200 block">
                      {t('ronos.attendance.open_today_title') || 'Abiertas Hoy'}
                    </span>
                    <span className="text-[11px] text-rose-700 dark:text-rose-400">
                      {t('ronos.attendance.open_today_desc') || 'Anomalías verificadas en el día laboral vigente (6:00 AM a 5:59 AM).'}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-black bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300">
                  {todayLiveRoster.openToday.length}
                </span>
              </div>

              <div className="space-y-2">
                {todayLiveRoster.openToday.map(anomaly => (
                  <div
                    key={`open-${anomaly.emp.employeeUserId}-${anomaly.reason}`}
                    className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{anomaly.emp.fullName}</span>
                        {anomaly.emp.pin && <span className="text-[10px] font-mono text-slate-400">#{anomaly.emp.pin}</span>}
                      </div>
                      <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium block">
                        {anomaly.reason === 'out_without_in'
                          ? (t('ronos.attendance.out_without_in') || 'Salida registrada sin entrada previa')
                          : anomaly.reason === 'lunch_without_return'
                          ? (t('ronos.attendance.lunch_without_return') || 'En comida por más de 2 horas sin regreso')
                          : (t('ronos.attendance.shift_over_14h') || 'Turno continuo mayor a 14 horas sin salida')}
                        {anomaly.time ? ` · ${anomaly.time}` : ''}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEmployee(anomaly.emp)}
                      className="min-h-[44px] px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                    >
                      <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONTENEDOR DE REGISTROS DE HOY EN CHECADOR (CON CRUCE PLANIFICADOR · TOAST · RONOS) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {t('ronos.attendance.today_clock_records') || 'Registros de Hoy en Checador'}
              </span>
              <span className="text-xs font-mono font-bold text-slate-400">
                {todayLiveRoster.inShift.length + todayLiveRoster.onLunch.length + todayLiveRoster.clockedOut.length} {t('ronos.attendance.registered_count') || 'registrados'}
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {todayLiveRoster.inShift.length === 0 &&
              todayLiveRoster.onLunch.length === 0 &&
              todayLiveRoster.clockedOut.length === 0 &&
              todayLiveRoster.todaySpecialEval.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-1">
                  {!storeData || !storeData.employees ? (
                    <>
                      <AlertTriangle className="w-6 h-6 mx-auto text-amber-500" />
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        {t('ronos.attendance.no_data_loaded') || 'Sin conexión al checador'}
                      </p>
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        {t('ronos.attendance.no_data_loaded_desc') || 'No se recibieron datos del reloj checador. Verifica la conexión o reintenta.'}
                      </p>
                    </>
                  ) : (
                    <>
                      <Clock className="w-6 h-6 mx-auto opacity-40 text-[#0288d1]" />
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                        {t('ronos.attendance.no_punches_today') || 'Aún no hay ponchadas registradas el día de hoy.'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {t('ronos.attendance.workday_note') || 'El día laboral oficial inicia a las 6:00 AM.'}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* EN TURNO */}
                  {todayLiveRoster.inShift.map(({ emp, lastPunchTime, photoUrl, todayDay }) => (
                    <div key={`in-${emp.employeeUserId}`} className="p-3.5 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">{emp.fullName}</span>
                              {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                              {emp.jobTitle || 'Crew'} · {t('ronos.attendance.entry_label') || 'Entrada'}: {lastPunchTime}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          {photoUrl && (
                            <button
                              type="button"
                              onClick={() => onOpenPhoto(photoUrl, t('ronos.attendance.entry_photo') || 'Foto de Entrada', emp.fullName, lastPunchTime)}
                              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{t('ronos.attendance.view_photo') || 'Foto'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectEmployee(emp)}
                            className="min-h-[44px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {todayDay && renderDayCrossRefRow(todayDay, emp)}
                    </div>
                  ))}

                  {/* EN DESCANSO */}
                  {todayLiveRoster.onLunch.map(({ emp, lunchStartTime, minutes, todayDay }) => (
                    <div key={`lunch-${emp.employeeUserId}`} className="p-3.5 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">{emp.fullName}</span>
                              {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                            </div>
                            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold block truncate">
                              {t('ronos.attendance.lunch_elapsed_desc', { time: lunchStartTime, min: minutes }) || `En comida desde las ${lunchStartTime} (${minutes} min)`}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectEmployee(emp)}
                          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                        >
                          <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {todayDay && renderDayCrossRefRow(todayDay, emp)}
                    </div>
                  ))}

                  {/* SALIÓ */}
                  {todayLiveRoster.clockedOut.map(({ emp, clockOutTime, todayDay }) => (
                    <div key={`out-${emp.employeeUserId}`} className="p-3.5 opacity-90 hover:opacity-100 transition-opacity">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{emp.fullName}</span>
                              {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                            </div>
                            <span className="text-[11px] text-slate-400 block truncate">
                              {t('ronos.attendance.shift_ended_desc', { time: clockOutTime }) || `Turno finalizado a las ${clockOutTime}`}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectEmployee(emp)}
                          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                        >
                          <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {todayDay && renderDayCrossRefRow(todayDay, emp)}
                    </div>
                  ))}

                  {/* TURNOS PROGRAMADOS / TOAST POS SIN PONCHADA EN RONOS HOY */}
                  {todayLiveRoster.todaySpecialEval.map(({ emp, todayDay }) => (
                    <div key={`spec-${emp.employeeUserId}`} className="p-3.5 bg-purple-50/20 dark:bg-purple-950/10">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">{emp.fullName}</span>
                              {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                              {emp.jobTitle || 'Crew'}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectEmployee(emp)}
                          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                        >
                          <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {renderDayCrossRefRow(todayDay, emp)}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* HISTORIAL DEL PERÍODO POR REVISAR (BLOQUE NEUTRO INDEPENDIENTE) */}
          {todayLiveRoster.historicalBroken.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                      {t('ronos.attendance.historical_review_title') || 'Historial del Período por Revisar'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('ronos.attendance.historical_review_desc') || 'Tarjetas con ponchadas incompletas de días previos en esta semana laboral.'}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {todayLiveRoster.historicalBroken.length}
                </span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {todayLiveRoster.historicalBroken.map(item => (
                  <div
                    key={`hist-${item.emp.employeeUserId}`}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.emp.fullName}</span>
                        {item.emp.pin && <span className="text-[10px] font-mono text-slate-400">#{item.emp.pin}</span>}
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {item.dates.join(', ')} · {item.brokenDaysCount} {item.brokenDaysCount === 1 ? (t('ronos.attendance.day_incomplete_singular') || 'día con tarjeta incompleta') : (t('ronos.attendance.days_incomplete_plural') || 'días con tarjetas incompletas')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEmployee(item.emp)}
                      className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                    >
                      <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* REVISIONES SEMANALES PENDIENTES */}
          {todayLiveRoster.pendingWeeklyReview && todayLiveRoster.pendingWeeklyReview.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-violet-200 dark:border-violet-900/60 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                      {t('ronos.attendance.weekly_review_title') || 'Revisiones Semanales Pendientes'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('ronos.attendance.weekly_review_desc') || 'Colaboradores con bandera semanal de horas rotas sin detalle de día específico.'}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                  {todayLiveRoster.pendingWeeklyReview.length}
                </span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {todayLiveRoster.pendingWeeklyReview.map(item => (
                  <div
                    key={`weekly-review-${item.emp.employeeUserId}`}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.emp.fullName}</span>
                        {item.emp.pin && <span className="text-[10px] font-mono text-slate-400">#{item.emp.pin}</span>}
                      </div>
                      <span className="text-[11px] text-violet-600 dark:text-violet-400 block">
                        {item.note}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEmployee(item.emp)}
                      className="min-h-[44px] px-3 py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 text-xs font-bold inline-flex items-center gap-1 self-end sm:self-auto cursor-pointer shrink-0"
                    >
                      <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3B. MODO "HISTORIAL SEMANAL" */}
      {attendanceViewMode === 'weekly_history' && (
        <div className="space-y-3">
          {/* Toolbar de Búsqueda y Filtro de Excepciones */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('ronos.attendance.search_placeholder') || 'Buscar por nombre o PIN...'}
                className="w-full min-h-[44px] pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setFilterExceptionsOnly(prev => !prev)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 self-stretch sm:self-auto shrink-0 ${
                filterExceptionsOnly
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{filterExceptionsOnly ? (t('ronos.attendance.filter_all') || 'Ver Todos') : (t('ronos.attendance.filter_exceptions') || 'Solo Excepciones')}</span>
            </button>
          </div>

          {/* VISTA ESCRITORIO: TABLA CON CRUCE NHP EXPANDIBLE POR DÍA */}
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">{t('ronos.attendance.col_employee') || 'Colaborador'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.attendance.col_hours') || 'Total Horas'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.attendance.col_reg_ot') || 'Regulares / Extras'}</th>
                  <th className="py-3 px-3">{t('ronos.attendance.nhp_col_policy') || 'Estado NHP / Alertas'}</th>
                  <th className="py-3 px-4 text-center">{t('ronos.attendance.col_action') || 'Acción'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      {t('ronos.attendance.no_employees_found') || 'No se encontraron colaboradores para los filtros seleccionados.'}
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const isBroken = emp.brokenHours
                    const mealIssues = emp.mealPenaltyCount || 0
                    const nhp = emp.nhpSummary
                    const isExpanded = expandedEmployeeId === emp.employeeUserId
                    const daysWithActivity = (emp.days || []).filter(d =>
                      Boolean(
                        d.scheduledShift?.hasPublishedShift ||
                        d.toastSummary?.hasToastPunches ||
                        d.clockInTime ||
                        d.clockOutTime ||
                        (d.totalHours || 0) > 0 ||
                        (d.violations && d.violations.length > 0)
                      )
                    )

                    return (
                      <React.Fragment key={emp.employeeUserId}>
                        <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <span>{emp.fullName}</span>
                              {emp.pin && <span className="text-[10px] font-mono text-slate-400 font-normal">#{emp.pin}</span>}
                            </div>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal block">
                              {emp.jobTitle || 'Crew'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-bold text-slate-900 dark:text-white">
                            {(emp.totalWeeklyHours || 0).toFixed(2)}h
                          </td>
                          <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-400">
                            {(emp.regularHours || 0).toFixed(2)}h {(emp.overtimeHours || 0) > 0 && <span className="text-amber-600 font-bold ml-1">+{emp.overtimeHours?.toFixed(2)}h OT</span>}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap items-center gap-1">
                              {nhp?.isExemptSalaried || emp.isSalaried ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                                  <ShieldCheck className="w-3 h-3" />
                                  <span>{t('ronos.attendance.nhp_badge_exempt') || 'Exento (Manager / Supervisor Asalariado)'}</span>
                                </span>
                              ) : (
                                <>
                                  {(nhp?.punctualityViolationsCount || 0) > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>{nhp!.punctualityViolationsCount} {t('ronos.attendance.nhp_kpi_punctuality') || 'Puntualidad ±3m'}</span>
                                    </span>
                                  )}
                                  {(nhp?.repairViolationsCount || 0) > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                      <Wrench className="w-3 h-3" />
                                      <span>{nhp!.repairViolationsCount} {t('ronos.attendance.nhp_kpi_repairs') || 'Reparar Ponchada'}</span>
                                    </span>
                                  )}
                                  {((nhp?.mealViolationsCount || 0) > 0 || mealIssues > 0) && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                      <Coffee className="w-3 h-3" />
                                      <span>{Math.max(nhp?.mealViolationsCount || 0, mealIssues)} {t('ronos.attendance.status_break_review') || 'Descanso por revisar'}</span>
                                    </span>
                                  )}
                                  {(nhp?.authorizedEarlyCallInsCount || 0) > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-indigo-700 dark:bg-sky-950 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                      <ShieldCheck className="w-3 h-3" />
                                      <span>{nhp!.authorizedEarlyCallInsCount} {t('ronos.attendance.nhp_kpi_call_ins') || 'Cobertura'}</span>
                                    </span>
                                  )}
                                  {isBroken && !(nhp?.repairViolationsCount) && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                      {t('ronos.attendance.status_incomplete') || 'Incompleta'}
                                    </span>
                                  )}
                                  {!isBroken &&
                                    mealIssues === 0 &&
                                    (nhp?.totalActiveViolationsCount || 0) === 0 &&
                                    (nhp?.authorizedEarlyCallInsCount || 0) === 0 && (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                        {t('ronos.summary.in_order') || 'En regla'}
                                      </span>
                                    )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              {daysWithActivity.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedEmployeeId(isExpanded ? null : emp.employeeUserId)}
                                  className="min-h-[44px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <span>
                                    {isExpanded
                                      ? (t('ronos.attendance.nhp_hide_daily_breakdown') || 'Ocultar días')
                                      : (t('ronos.attendance.nhp_show_daily_breakdown') || 'Desglose diario')}
                                  </span>
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onSelectEmployee(emp)}
                                className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && daysWithActivity.length > 0 && (
                          <tr className="bg-slate-50/80 dark:bg-slate-900/80">
                            <td colSpan={5} className="p-3.5 space-y-2">
                              {daysWithActivity.map((day, dIdx) => (
                                <div
                                  key={`${emp.employeeUserId}-${day.date}-${dIdx}`}
                                  className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                                >
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-900 dark:text-white">
                                      {day.dayName} · {formatUsaDate(day.date)}
                                    </span>
                                    <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                                      {(day.totalHours || 0).toFixed(2)}h
                                    </span>
                                  </div>
                                  {renderDayCrossRefRow(day, emp)}
                                </div>
                              ))}
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
          <div className="md:hidden space-y-2">
            {filteredEmployees.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                {t('ronos.attendance.no_employees_found') || 'No se encontraron colaboradores.'}
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isBroken = emp.brokenHours
                const mealIssues = emp.mealPenaltyCount || 0
                const nhp = emp.nhpSummary
                const isExpanded = expandedEmployeeId === emp.employeeUserId
                const daysWithActivity = (emp.days || []).filter(d =>
                  Boolean(
                    d.scheduledShift?.hasPublishedShift ||
                    d.toastSummary?.hasToastPunches ||
                    d.clockInTime ||
                    d.clockOutTime ||
                    (d.totalHours || 0) > 0 ||
                    (d.violations && d.violations.length > 0)
                  )
                )

                return (
                  <div
                    key={emp.employeeUserId}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">{emp.fullName}</span>
                          {emp.pin && <span className="text-[10px] font-mono text-slate-400">#{emp.pin}</span>}
                        </div>
                        <span className="text-[11px] text-slate-500">{emp.jobTitle || 'Crew'}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        nhp?.isExemptSalaried || emp.isSalaried
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : isBroken || (nhp?.repairViolationsCount || 0) > 0
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            : (nhp?.punctualityViolationsCount || 0) > 0
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : mealIssues > 0 || (nhp?.mealViolationsCount || 0) > 0
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}>
                        {nhp?.isExemptSalaried || emp.isSalaried
                          ? (t('ronos.attendance.nhp_badge_exempt') || 'Exento')
                          : (nhp?.repairViolationsCount || 0) > 0
                            ? `${nhp!.repairViolationsCount} ${t('ronos.attendance.nhp_kpi_repairs') || 'Reparar'}`
                            : (nhp?.punctualityViolationsCount || 0) > 0
                              ? `${nhp!.punctualityViolationsCount} ${t('ronos.attendance.nhp_kpi_punctuality') || 'Puntualidad'}`
                              : isBroken
                                ? (t('ronos.attendance.status_incomplete') || 'Incompleta')
                                : mealIssues > 0 || (nhp?.mealViolationsCount || 0) > 0
                                  ? (t('ronos.attendance.status_break_review') || 'Descanso >5h')
                                  : (t('ronos.summary.in_order') || 'En regla')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
                      <span>Total: <strong className="text-slate-900 dark:text-white">{(emp.totalWeeklyHours || 0).toFixed(2)}h</strong></span>
                      <span className="text-slate-500">Reg: {(emp.regularHours || 0).toFixed(2)}h</span>
                      {(emp.overtimeHours || 0) > 0 && <span className="text-amber-600 font-bold">OT: {emp.overtimeHours?.toFixed(2)}h</span>}
                    </div>

                    {isExpanded && daysWithActivity.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {daysWithActivity.map((day, dIdx) => (
                          <div
                            key={`mob-${emp.employeeUserId}-${day.date}-${dIdx}`}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
                          >
                            <div className="flex items-center justify-between text-[11px] font-bold">
                              <span>{day.dayName} · {formatUsaDate(day.date)}</span>
                              <span className="font-mono">{(day.totalHours || 0).toFixed(2)}h</span>
                            </div>
                            {renderDayCrossRefRow(day, emp)}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {daysWithActivity.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedEmployeeId(isExpanded ? null : emp.employeeUserId)}
                          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <span>
                            {isExpanded
                              ? (t('ronos.attendance.nhp_hide_daily_breakdown') || 'Ocultar días')
                              : (t('ronos.attendance.nhp_show_daily_breakdown') || 'Desglose diario')}
                          </span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectEmployee(emp)}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#0288d1] font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>{t('ronos.attendance.kardex_btn') || 'Ver Kardex Semanal'}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
