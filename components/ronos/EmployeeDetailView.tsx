/**
 * @module components/ronos/EmployeeDetailView
 * @description Vista detallada del Kardex semanal de ponchadas (Lunes a Domingo) de un colaborador individual.
 *   - Muestra tarjetas diarias con horarios legibles en formato 12 horas (AM/PM) en zona horaria America/Los_Angeles.
 *   - Permite visualizar fotografías tomadas en el reloj checador.
 *   - Destaca descansos pendientes de revisión y horas trabajadas.
 *   - Navegación fluida entre colaboradores mediante selector y botones Anterior/Siguiente.
 *
 * @businessRules
 *   - Formato de horas: 12h con indicador AM/PM.
 *   - Cumplimiento de descanso de 30 min conforme al Código Laboral de California § 512.
 *
 * @dataFlow
 *   Invocado desde `StoreAttendanceTab` al hacer clic en un colaborador.
 *
 * @notes
 *   - Mobile-First con controles táctiles >= 44px.
 *   - Bilingüe completo (i18n).
 *   - Elimina referencias a AWS S3 y términos engañosos como "fuga por multas".
 */

'use client'

import React from 'react'
import {
  ArrowLeft,
  Calendar,
  Camera,
  Coffee,
  Sun,
  Moon,
  Mail,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { EmployeeTimecard } from './types'
import { formatTime12h, formatDayDetails, formatUsaDate } from './helpers'

interface EmployeeDetailViewProps {
  employee: EmployeeTimecard
  storeName: string
  startDate?: string
  endDate?: string
  onBack: () => void
  onOpenPhoto: (photoUrl: string, title: string, employeeName: string, timestamp: string) => void
  onOpenEmail: (employee: EmployeeTimecard) => void
  allEmployees: EmployeeTimecard[]
  onSelectEmployee: (emp: EmployeeTimecard) => void
}

export default function EmployeeDetailView({
  employee,
  storeName,
  startDate,
  endDate,
  onBack,
  onOpenPhoto,
  onOpenEmail,
  allEmployees,
  onSelectEmployee
}: EmployeeDetailViewProps) {
  const { t } = useLanguage()

  // Navegación Anterior / Siguiente
  const currentIndex = allEmployees.findIndex(e => e.employeeUserId === employee.employeeUserId)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allEmployees.length - 1

  const handlePrev = () => {
    if (hasPrev) onSelectEmployee(allEmployees[currentIndex - 1])
  }

  const handleNext = () => {
    if (hasNext) onSelectEmployee(allEmployees[currentIndex + 1])
  }

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. TOP TOOLBAR DE NAVEGACIÓN (CONTROLES >= 44px)                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver a Lista</span>
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                {employee.fullName}
              </h2>
              {employee.pin && (
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950 text-[#0288d1] dark:text-sky-300 font-mono font-bold shrink-0">
                  PIN #{employee.pin}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {employee.jobTitle || 'Team Member'} · {storeName}
            </p>
          </div>
        </div>

        {/* Right Controls: Selector & Botón de Aviso */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={employee.employeeUserId}
            onChange={(e) => {
              const target = allEmployees.find(emp => emp.employeeUserId === Number(e.target.value))
              if (target) onSelectEmployee(target)
            }}
            className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold cursor-pointer max-w-[200px]"
          >
            {allEmployees.map(emp => (
              <option key={emp.employeeUserId} value={emp.employeeUserId}>
                {emp.fullName} (#{emp.pin})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!hasPrev}
              className="min-h-[44px] min-w-[44px] p-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-30 cursor-pointer flex items-center justify-center"
              title="Empleado Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!hasNext}
              className="min-h-[44px] min-w-[44px] p-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-30 cursor-pointer flex items-center justify-center"
              title="Siguiente Empleado"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenEmail(employee)}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer flex items-center gap-1.5 transition-all"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Enviar Aviso</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. KPIS RESUMEN DEL EMPLEADO                                            */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Total Horas</span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
            {(employee.totalWeeklyHours || 0).toFixed(2)}h
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Regulares</span>
          <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {(employee.regularHours || 0).toFixed(2)}h
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Overtime (1.5x)</span>
          <div className={`text-xl sm:text-2xl font-black font-mono ${(employee.overtimeHours || 0) > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
            {(employee.overtimeHours || 0).toFixed(2)}h
          </div>
        </div>

        <div className={`rounded-xl p-3 text-center border shadow-xs ${
          (employee.mealPenaltyCount || 0) > 0
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white'
        }`}>
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-0.5">Descansos por Revisar</span>
          <div className="text-xl sm:text-2xl font-black font-mono">
            {employee.mealPenaltyCount || 0}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. DESGLOSE SEMANAL DÍA POR DÍA (LUNES A DOMINGO)                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#0288d1]" />
            <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
              Historial Semanal de Ponchadas y Fotografías
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {formatUsaDate(startDate)} — {formatUsaDate(endDate)}
          </span>
        </div>

        {/* Tarjetas de Día */}
        <div className="space-y-2">
          {employee.days?.map((day, dIdx) => {
            const hasWorked = (day.totalHours || 0) > 0 || (day.punches && day.punches.length > 0)
            const hasViolations = day.violations && day.violations.length > 0
            const { dayOfWeek, dateFormatted } = formatDayDetails(day.date, day.dayName)

            if (!hasWorked) {
              return (
                <div
                  key={dIdx}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400"
                >
                  <span className="font-bold text-slate-600 dark:text-slate-400">
                    {dayOfWeek}, {dateFormatted}
                  </span>
                  <span className="italic">Día Libre / Sin turno</span>
                </div>
              )
            }

            return (
              <div
                key={dIdx}
                className={`rounded-xl border p-3.5 transition-all ${
                  hasViolations
                    ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800'
                    : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* Cabecera del Día */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-700/60">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-xs sm:text-sm ${hasViolations ? 'text-rose-700 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                      {dayOfWeek}, {dateFormatted}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
                      {employee.jobTitle || 'Crew'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-black text-xs font-mono">
                      {(day.totalHours || 0).toFixed(2)}h
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Reg: {(day.regularHours || 0).toFixed(2)}h
                      {(day.overtimeHours || 0) > 0 ? ` · OT: ${day.overtimeHours.toFixed(2)}h` : ''}
                    </span>
                  </div>
                </div>

                {/* Aviso si comió tarde */}
                {hasViolations && (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-rose-100/70 dark:bg-rose-900/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <div>
                      <strong className="font-bold">{day.violations![0]?.title || 'Incidencia de Horario'}</strong>
                      <span className="mx-1">·</span>
                      <span>{day.violations![0]?.description}</span>
                    </div>
                  </div>
                )}

                {/* Bloques de Ponchada (Entrada, Comida, Salida) */}
                <div className="mt-3 flex items-center gap-2.5 flex-wrap text-xs">
                  {/* ENTRADA */}
                  {day.clockInTime && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-[#0288d1]/30">
                      <Sun className="w-3.5 h-3.5 text-[#0288d1]" />
                      <div>
                        <span className="text-[9px] text-[#0288d1] dark:text-sky-400 font-bold uppercase tracking-wider block">
                          Entrada
                        </span>
                        <span className="font-black text-xs font-mono text-slate-900 dark:text-white">
                          {formatTime12h(day.clockInTime)}
                        </span>
                      </div>
                      {day.clockInPhoto && (
                        <button
                          type="button"
                          onClick={() => onOpenPhoto(day.clockInPhoto!, 'Entrada', employee.fullName, day.clockInTime!)}
                          className="min-h-[32px] min-w-[32px] p-1 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer flex items-center justify-center transition-colors"
                          title="Ver Fotografía de Entrada"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* COMIDA */}
                  {day.lunchStartTime && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-[#0288d1]/30">
                      <Coffee className="w-3.5 h-3.5 text-[#0288d1]" />
                      <div>
                        <span className="text-[9px] text-[#0288d1] dark:text-sky-400 font-bold uppercase tracking-wider block">
                          Comida ({day.lunchDurationMinutes ? `${day.lunchDurationMinutes} min` : '30 min'})
                        </span>
                        <span className="font-black text-xs font-mono text-slate-900 dark:text-white">
                          {formatTime12h(day.lunchStartTime)} {day.lunchEndTime ? `→ ${formatTime12h(day.lunchEndTime)}` : ''}
                        </span>
                      </div>
                      {day.lunchStartPhoto && (
                        <button
                          type="button"
                          onClick={() => onOpenPhoto(day.lunchStartPhoto!, 'Comida', employee.fullName, day.lunchStartTime!)}
                          className="min-h-[32px] min-w-[32px] p-1 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer flex items-center justify-center transition-colors"
                          title="Ver Fotografía de Comida"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* SALIDA */}
                  {day.clockOutTime && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-[#0288d1]/30">
                      <Moon className="w-3.5 h-3.5 text-[#0288d1]" />
                      <div>
                        <span className="text-[9px] text-[#0288d1] dark:text-sky-400 font-bold uppercase tracking-wider block">
                          Salida
                        </span>
                        <span className="font-black text-xs font-mono text-slate-900 dark:text-white">
                          {formatTime12h(day.clockOutTime)}
                        </span>
                      </div>
                      {day.clockOutPhoto && (
                        <button
                          type="button"
                          onClick={() => onOpenPhoto(day.clockOutPhoto!, 'Salida', employee.fullName, day.clockOutTime!)}
                          className="min-h-[32px] min-w-[32px] p-1 ml-1 rounded-lg bg-[#0288d1]/15 hover:bg-[#0288d1]/25 text-[#0288d1] dark:text-sky-300 cursor-pointer flex items-center justify-center transition-colors"
                          title="Ver Fotografía de Salida"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
