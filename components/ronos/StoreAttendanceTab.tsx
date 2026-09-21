/**
 * @module components/ronos/StoreAttendanceTab
 * @description Pestaña de Control de Asistencia y Reloj Checador en Tienda (Timecards & Daily Clock).
 *   - Tienda obligatoria: "Todas las tiendas" solo muestra excepciones.
 *   - Alterna entre "En vivo hoy" e "Historial semanal" con controles ergonómicos.
 *   - 6 estados operativos simples: En turno, En descanso, Salió, Ponchada incompleta, Descanso por revisar, Sin información.
 *   - Máximo 5 columnas iniciales en escritorio; tarjetas táctiles en móvil.
 *
 * @businessRules
 *   - Día laboral oficial: 6:00 AM a 5:59 AM del siguiente día.
 *   - Descanso obligatorio de 30 minutos antes de la 5ta hora de turno continuo.
 *
 * @dataFlow
 *   Recibe storeData originado en /api/ronos/punches?companyId=...
 *
 * @notes
 *   - Cumple con estándar Mobile-First con controles táctiles >= 44px.
 *   - Bilingüe completo (i18n) sin textos hardcodeados ni jerga técnica.
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
  RefreshCw,
  Search,
  Eye,
  AlertTriangle,
  ArrowRight,
  UserCheck,
  CheckCircle2
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { StoreAuditData, EmployeeTimecard, StoreOption } from './types'
import EmployeeDetailView from './EmployeeDetailView'
import { getPacificBusinessDate, detectTodayAnomalies } from './helpers'

interface StoreAttendanceTabProps {
  storeData: StoreAuditData | null
  loading: boolean
  selectedCompanyId: number
  stores: StoreOption[]
  selectedEmployeeDetail: EmployeeTimecard | null
  onSelectEmployee: (emp: EmployeeTimecard | null) => void
  onOpenPhoto: (photoUrl: string, title: string, employeeName: string, timestamp: string) => void
  onOpenEmail: (employee: EmployeeTimecard) => void
  onSelectStore?: (companyId: number) => void
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
  const { t } = useLanguage()

  // Selector de vista: 'live_today' (En vivo hoy) vs 'weekly_history' (Historial semanal)
  const [attendanceViewMode, setAttendanceViewMode] = useState<'live_today' | 'weekly_history'>('live_today')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterExceptionsOnly, setFilterExceptionsOnly] = useState(false)

  // Temporizador en vivo para refrescar cálculos dependientes de la hora (minutos en descanso, anomalías >14h)
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  const activeStoreName = useMemo(() => {
    if (selectedCompanyId === 0) {
      return t('ronos.all_stores') || 'Todas las Tiendas (Cadena)'
    }
    const st = stores.find(s => s.ronosCompanyId === selectedCompanyId)
    return st ? `${st.tegName} (#${st.tegStoreId})` : storeData?.storeName || 'Sucursal'
  }, [selectedCompanyId, stores, storeData?.storeName, t])

  // Cálculo de roster de hoy con los 6 estados claros y separación estricta hoy vs historial
  const todayLiveRoster = useMemo(() => {
    if (!storeData?.employees || !Array.isArray(storeData.employees)) {
      return {
        inShift: [],
        onLunch: [],
        clockedOut: [],
        openToday: [],
        historicalBroken: [],
        pendingWeeklyReview: []
      }
    }

    const currentWorkDate = getPacificBusinessDate(currentTimeMs)
    const inShift: { emp: EmployeeTimecard; lastPunchTime: string; photoUrl?: string | null }[] = []
    const onLunch: { emp: EmployeeTimecard; lunchStartTime: string; minutes: number }[] = []
    const clockedOut: { emp: EmployeeTimecard; clockOutTime: string }[] = []

    // Detección estricta: anomalías de hoy vs tarjetas históricas de días anteriores
    const { openToday, historicalBroken, pendingWeeklyReview } = detectTodayAnomalies(storeData.employees, currentWorkDate, currentTimeMs)

    for (const emp of storeData.employees) {
      if (!emp?.days || !Array.isArray(emp.days)) continue
      const todayDay = emp.days.find(d => d?.date?.substring(0, 10) === currentWorkDate)
      if (!todayDay?.punches || !Array.isArray(todayDay.punches)) continue

      const validPunches = todayDay.punches.filter(p => {
        if (!p || typeof p !== 'object') return false
        const raw = p.timestampIso || p.punchTime
        if (raw == null || raw === '') return false
        const pMs = new Date(raw).getTime()
        return !isNaN(pMs) && pMs > 86400000 && pMs <= currentTimeMs
      })
      if (validPunches.length === 0) continue

      const sorted = [...validPunches].sort((a, b) => {
        const timeA = new Date(a.timestampIso || a.punchTime).getTime()
        const timeB = new Date(b.timestampIso || b.punchTime).getTime()
        return timeA - timeB
      })

      const lastPunch = sorted[sorted.length - 1]
      const pType = Number(lastPunch?.punchType)

      if (pType === 1 || pType === 4) {
        inShift.push({ emp, lastPunchTime: lastPunch.punchTime || 'En turno', photoUrl: lastPunch.photoUrl })
      } else if (pType === 3) {
        const lunchMs = new Date(lastPunch.timestampIso || lastPunch.punchTime).getTime()
        const elapsedMins = Math.max(0, Math.round((currentTimeMs - lunchMs) / 60000))
        onLunch.push({ emp, lunchStartTime: lastPunch.punchTime || 'En comida', minutes: elapsedMins })
      } else if (pType === 2) {
        clockedOut.push({ emp, clockOutTime: lastPunch.punchTime || 'Salida' })
      }
    }

    return { inShift, onLunch, clockedOut, openToday, historicalBroken, pendingWeeklyReview }
  }, [storeData, currentTimeMs])

  // Filtrado de empleados para historial semanal
  const filteredEmployees = useMemo(() => {
    if (!Array.isArray(storeData?.employees)) return []

    return storeData.employees.filter((emp) => {
      // 1. Buscador
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim()
        const matchName = emp.fullName.toLowerCase().includes(q)
        const matchPin = (emp.pin || '').includes(q)
        const matchJob = (emp.jobTitle || '').toLowerCase().includes(q)
        if (!matchName && !matchPin && !matchJob) return false
      }

      // 2. Filtro solo excepciones
      if (filterExceptionsOnly) {
        const hasIssue = emp.brokenHours || (emp.mealPenaltyCount || 0) > 0
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
        onOpenEmail={onOpenEmail}
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
        {/* Banner claro de regla de negocio */}
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

        {/* Selector Visual de Tiendas para Saltar Rápidamente */}
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
  const totalEmployees = storeData?.employees?.length || 0
  const brokenCount = storeData?.brokenTimecardsCount || 0
  const mealCount = storeData?.mealPenaltiesCount || 0
  const todayTotalPunchesCount =
    todayLiveRoster.inShift.length +
    todayLiveRoster.onLunch.length +
    todayLiveRoster.clockedOut.length +
    todayLiveRoster.openToday.length

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

        {/* Toggle con botones de mínimo 44px de área táctil */}
        <div
          role="group"
          aria-label="Modo de asistencia"
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

          {/* CONTENEDOR DE REGISTROS DE HOY EN CHECADOR */}
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
              {todayLiveRoster.inShift.length === 0 && todayLiveRoster.onLunch.length === 0 && todayLiveRoster.clockedOut.length === 0 ? (
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
                  {todayLiveRoster.inShift.map(({ emp, lastPunchTime, photoUrl }) => (
                    <div key={`in-${emp.employeeUserId}`} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10 transition-colors">
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
                  ))}

                  {/* EN DESCANSO */}
                  {todayLiveRoster.onLunch.map(({ emp, lunchStartTime, minutes }) => (
                    <div key={`lunch-${emp.employeeUserId}`} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-colors">
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
                  ))}

                  {/* SALIÓ */}
                  {todayLiveRoster.clockedOut.map(({ emp, clockOutTime }) => (
                    <div key={`out-${emp.employeeUserId}`} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 opacity-80 hover:opacity-100 transition-opacity">
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

          {/* VISTA ESCRITORIO: MÁXIMO 5 COLUMNAS INICIALES */}
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">{t('ronos.attendance.col_employee') || 'Colaborador'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.attendance.col_hours') || 'Total Horas'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.attendance.col_reg_ot') || 'Regulares / Extras'}</th>
                  <th className="py-3 px-3 text-center">{t('ronos.attendance.col_status') || 'Estado'}</th>
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

                    return (
                      <tr key={emp.employeeUserId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
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
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isBroken
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : mealIssues > 0
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}>
                            {isBroken
                              ? (t('ronos.attendance.status_incomplete') || 'Incompleta')
                              : mealIssues > 0
                              ? `${mealIssues} ${t('ronos.attendance.status_break_review') || 'Descanso por revisar'}`
                              : (t('ronos.summary.in_order') || 'En regla')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => onSelectEmployee(emp)}
                            className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 text-[#0288d1] dark:text-sky-300 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <span>{t('ronos.attendance.kardex_btn') || 'Kardex'}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
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
                        isBroken
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : mealIssues > 0
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}>
                        {isBroken
                          ? (t('ronos.attendance.status_incomplete') || 'Incompleta')
                          : mealIssues > 0
                          ? (t('ronos.attendance.status_break_review') || 'Descanso >5h')
                          : (t('ronos.summary.in_order') || 'En regla')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800 font-mono">
                      <span>Total: <strong className="text-slate-900 dark:text-white">{(emp.totalWeeklyHours || 0).toFixed(2)}h</strong></span>
                      <span className="text-slate-500">Reg: {(emp.regularHours || 0).toFixed(2)}h</span>
                      {(emp.overtimeHours || 0) > 0 && <span className="text-amber-600 font-bold">OT: {emp.overtimeHours?.toFixed(2)}h</span>}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEmployee(emp)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#0288d1] font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span>{t('ronos.attendance.kardex_btn') || 'Ver Kardex Semanal'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
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
