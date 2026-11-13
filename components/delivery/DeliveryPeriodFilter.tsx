/**
 * @module components/delivery/DeliveryPeriodFilter
 * @description Selector unificado de periodo (Por Semana / Por Día / Rango) para el módulo de
 *              Conciliación de Plataformas Delivery (`/admin/conciliar-delivery`), replicando la
 *              experiencia visual y operativa del selector del módulo de Ventas (`DateRangeFilter`).
 *
 * @businessRules
 * 1. Regla del Día Laboral (6:00 AM – 5:59 AM PT):
 *    - El cálculo de "Hoy", "Ayer", "Esta semana" y "Semana pasada" se evalúa estrictamente en
 *      `America/Los_Angeles`; si la hora local PT es anterior a las 6:00 AM, el día operativo
 *      corresponde al día calendario previo.
 * 2. Periodo por Defecto = "Semana pasada" (`last_week`):
 *    - En conciliación delivery, contabilidad audita principalmente cortes semanales cerrados
 *      (Lunes → Domingo), por lo que inicia en `last_week` y permite avanzar/retroceder semana por
 *      semana o día por día con flechas laterales (`<` / `>`).
 * 3. Modos de Selección en Calendario Dual:
 *    - `week` (Por Semana): El calendario inicia en Lunes (`weekStartsOn: 1`); pasar el cursor o
 *      hacer clic sobre cualquier día resalta y selecciona automáticamente su semana operativa
 *      completa (Lunes → Domingo).
 *    - `day` (Por Día): Hacer clic sobre una fecha selecciona únicamente ese día operativo
 *      (`startDate === endDate`).
 *    - `range` (Rango libre): Permite elegir fecha inicial y fecha final personalizadas.
 *
 * @dataFlow
 * - Recibe `(period, startDate, endDate, onChange)` desde `app/admin/conciliar-delivery/page.tsx`
 *   y emite `(nextPeriod, nextStartYmd, nextEndYmd)` en formato `YYYY-MM-DD`.
 *
 * @notes
 * - 100% bilingüe (ES/EN) mediante `useLanguage()` (`deliveryReconciliation.*` y `sales.*`) y `date-fns/locale`.
 * - Incluye soporte móvil en pantalla completa vía `createPortal` y cierre con tecla `Escape` o clic externo.
 * - Fix 2026-11-12: `parseLocalYmd` con rollover calendar-overflow rechazado (`2026-02-30` -> `null`), rangos comparados por string local `YYYY-MM-DD` sin desfase `00:00:00`/`12:00:00`, paso `<`/`>` funcional en `Mes`, bloqueo de rango futuro, `resetDraftAndClose()` completo y accesibilidad ARIA/inputs móviles.
 */

'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isWithinInterval,
  subDays,
  addDays,
  subWeeks,
  differenceInCalendarDays,
} from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export type DeliveryPeriodPreset =
  | 'last_week'
  | 'week'
  | 'two_weeks_ago'
  | 'today'
  | 'yesterday'
  | 'month'
  | 'last_month'
  | 'selected_week'
  | 'selected_day'
  | 'custom'

type PickerSelectionMode = 'week' | 'day' | 'range'

interface DeliveryPeriodFilterProps {
  period: DeliveryPeriodPreset
  startDate: string
  endDate: string
  onChange: (period: DeliveryPeriodPreset, start: string, end: string) => void
  disabled?: boolean
  className?: string
  align?: 'left' | 'right'
}

/**
 * Retorna un `Date` local (año, mes, día a mediodía local para evitar saltos DST)
 * correspondiente al día operativo actual en `America/Los_Angeles` (regla 6:00 AM – 5:59 AM PT).
 */
export function getLaOperationalTodayLocal(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const getNum = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
  const year = getNum('year')
  const month = getNum('month')
  const day = getNum('day')
  const hour = getNum('hour')
  const base = new Date(year, month - 1, day, 12, 0, 0)
  if (hour < 6) {
    base.setDate(base.getDate() - 1)
  }
  return base
}

export function formatLocalYmd(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalYmd(str: string): Date | null {
  if (!str) return null
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(year, month - 1, day, 12, 0, 0)
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null
  }
  return d
}

export function getPresetBounds(
  preset: DeliveryPeriodPreset,
  now: Date = new Date()
): { start: string; end: string } {
  const today = getLaOperationalTodayLocal(now)
  let s = today
  let e = today

  if (preset === 'today') {
    s = today
    e = today
  } else if (preset === 'yesterday') {
    s = subDays(today, 1)
    e = subDays(today, 1)
  } else if (preset === 'week') {
    s = startOfWeek(today, { weekStartsOn: 1 })
    e = endOfWeek(today, { weekStartsOn: 1 })
  } else if (preset === 'last_week') {
    const prev = subWeeks(today, 1)
    s = startOfWeek(prev, { weekStartsOn: 1 })
    e = endOfWeek(prev, { weekStartsOn: 1 })
  } else if (preset === 'two_weeks_ago') {
    const prev2 = subWeeks(today, 2)
    s = startOfWeek(prev2, { weekStartsOn: 1 })
    e = endOfWeek(prev2, { weekStartsOn: 1 })
  } else if (preset === 'month') {
    s = startOfMonth(today)
    e = endOfMonth(today)
  } else if (preset === 'last_month') {
    const prevMonth = subMonths(today, 1)
    s = startOfMonth(prevMonth)
    e = endOfMonth(prevMonth)
  }

  return { start: formatLocalYmd(s), end: formatLocalYmd(e) }
}

/**
 * Detecta automáticamente si un par `(start, end)` coincide exactamente con alguno de los
 * periodos canónicos (Semana pasada, Esta semana, Hoy, Ayer, etc.), o si es una semana Lun→Dom
 * o un día individual.
 */
export function classifyDeliveryPeriod(
  startStr: string,
  endStr: string,
  now: Date = new Date()
): DeliveryPeriodPreset {
  const canonicalChecks: DeliveryPeriodPreset[] = [
    'last_week',
    'week',
    'two_weeks_ago',
    'today',
    'yesterday',
    'month',
    'last_month',
  ]
  for (const preset of canonicalChecks) {
    const b = getPresetBounds(preset, now)
    if (b.start === startStr && b.end === endStr) {
      return preset
    }
  }
  if (startStr === endStr) {
    return 'selected_day'
  }
  const s = parseLocalYmd(startStr)
  const e = parseLocalYmd(endStr)
  if (s && e && s.getDay() === 1 && e.getDay() === 0 && differenceInCalendarDays(e, s) === 6) {
    return 'selected_week'
  }
  return 'custom'
}

export default function DeliveryPeriodFilter({
  period,
  startDate,
  endDate,
  onChange,
  disabled = false,
  className = '',
  align = 'right',
}: DeliveryPeriodFilterProps) {
  const { t, language } = useLanguage()
  const localeObj = language === 'es' ? es : enUS

  const [isOpen, setIsOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState<PickerSelectionMode>('week')
  const [viewDate, setViewDate] = useState<Date>(() => {
    const parsed = parseLocalYmd(startDate)
    return parsed || getLaOperationalTodayLocal()
  })
  const [tempStart, setTempStart] = useState<Date | null>(() => parseLocalYmd(startDate))
  const [tempEnd, setTempEnd] = useState<Date | null>(() => parseLocalYmd(endDate))
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const syncDraftFromCommitted = React.useCallback(() => {
    const ps = parseLocalYmd(startDate)
    const pe = parseLocalYmd(endDate)
    setTempStart(ps)
    setTempEnd(pe)
    setHoverDate(null)
    if (ps && pe) {
      if (startDate === endDate) {
        setSelectionMode('day')
      } else if (ps.getDay() === 1 && pe.getDay() === 0 && differenceInCalendarDays(pe, ps) === 6) {
        setSelectionMode('week')
      } else {
        setSelectionMode('range')
      }
      setViewDate(startOfMonth(ps))
    }
  }, [startDate, endDate])

  const resetDraftAndClose = React.useCallback(() => {
    syncDraftFromCommitted()
    setIsOpen(false)
  }, [syncDraftFromCommitted])

  // Sincronizar selección temporal y modo sugerido al cambiar props externas
  useEffect(() => {
    syncDraftFromCommitted()
  }, [syncDraftFromCommitted])

  // Si se deshabilita el selector (ej. sincronización en curso), descartar borradores y cerrar
  useEffect(() => {
    if (disabled && isOpen) {
      resetDraftAndClose()
    }
  }, [disabled, isOpen, resetDraftAndClose])

  // Cerrar con clic fuera o tecla Escape descartando cambios no aplicados
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (target.closest?.('[data-delivery-date-portal]')) return
      if (containerRef.current && !containerRef.current.contains(target)) {
        resetDraftAndClose()
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        resetDraftAndClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, resetDraftAndClose])

  const isDayView = startDate === endDate
  const isWeekView = useMemo(() => {
    const s = parseLocalYmd(startDate)
    const e = parseLocalYmd(endDate)
    return Boolean(s && e && s.getDay() === 1 && e.getDay() === 0 && differenceInCalendarDays(e, s) === 6)
  }, [startDate, endDate])
  const isMonthView = useMemo(() => {
    const s = parseLocalYmd(startDate)
    const e = parseLocalYmd(endDate)
    if (!s || !e || s.getDate() !== 1 || !isSameMonth(s, e)) return false
    const todayYmd = getPresetBounds('today').end
    const monthEndYmd = formatLocalYmd(endOfMonth(s))
    return endDate === monthEndYmd || (endDate === todayYmd && !isDayView)
  }, [startDate, endDate, isDayView])

  // Determinar si el botón ">" (siguiente periodo) debe deshabilitarse al llegar al periodo actual
  const canStepForward = useMemo(() => {
    const currentWeekEnd = getPresetBounds('week').end
    const todayYmd = getPresetBounds('today').end
    if (isDayView) {
      return endDate < todayYmd
    }
    if (isMonthView) {
      const currentMonthStart = getPresetBounds('month').start
      return startDate < currentMonthStart
    }
    if (isWeekView) {
      return endDate < currentWeekEnd
    }
    return endDate < todayYmd
  }, [startDate, endDate, isDayView, isMonthView, isWeekView])

  const handleStepPeriod = (direction: -1 | 1) => {
    const s = parseLocalYmd(startDate)
    const e = parseLocalYmd(endDate)
    if (!s || !e) return
    const todayYmd = getPresetBounds('today').end
    if (isMonthView) {
      const targetMonthStart = startOfMonth(direction > 0 ? addMonths(s, 1) : subMonths(s, 1))
      const nextStartStr = formatLocalYmd(targetMonthStart)
      if (direction > 0 && nextStartStr > todayYmd) return
      const fullMonthEndStr = formatLocalYmd(endOfMonth(targetMonthStart))
      const nextEndStr = fullMonthEndStr > todayYmd ? todayYmd : fullMonthEndStr
      const nextPeriod = classifyDeliveryPeriod(nextStartStr, nextEndStr)
      onChange(nextPeriod, nextStartStr, nextEndStr)
      return
    }
    const spanDays = isWeekView ? 7 : isDayView ? 1 : Math.max(1, differenceInCalendarDays(e, s) + 1)
    const nextStart = addDays(s, direction * spanDays)
    const nextEnd = addDays(e, direction * spanDays)
    const nextStartStr = formatLocalYmd(nextStart)
    let nextEndStr = formatLocalYmd(nextEnd)
    if (direction > 0 && !isWeekView && nextStartStr > todayYmd) return
    if (direction > 0 && !isWeekView && nextEndStr > todayYmd) {
      nextEndStr = todayYmd
    }
    const nextPeriod = classifyDeliveryPeriod(nextStartStr, nextEndStr)
    onChange(nextPeriod, nextStartStr, nextEndStr)
  }

  const handlePresetClick = (preset: DeliveryPeriodPreset) => {
    const bounds = getPresetBounds(preset)
    const ps = parseLocalYmd(bounds.start)
    const pe = parseLocalYmd(bounds.end)
    setTempStart(ps)
    setTempEnd(pe)
    onChange(preset, bounds.start, bounds.end)
    setIsOpen(false)
  }

  const handleCalendarDayClick = (day: Date) => {
    const normalizedDay = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0)
    if (selectionMode === 'week') {
      const weekMonday = startOfWeek(normalizedDay, { weekStartsOn: 1 })
      const weekSunday = endOfWeek(normalizedDay, { weekStartsOn: 1 })
      setTempStart(weekMonday)
      setTempEnd(weekSunday)
      return
    }
    if (selectionMode === 'day') {
      setTempStart(normalizedDay)
      setTempEnd(normalizedDay)
      return
    }
    // Modo 'range' (Rango libre de dos clics, comparando YMD local para evitar diferencias 00:00 vs 12:00)
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(normalizedDay)
      setTempEnd(null)
    } else if (tempStart && !tempEnd) {
      if (formatLocalYmd(normalizedDay) < formatLocalYmd(tempStart)) {
        setTempStart(normalizedDay)
        setTempEnd(null)
      } else {
        setTempEnd(normalizedDay)
      }
    }
  }

  const handleApply = () => {
    if (!tempStart) return
    const rawEnd = tempEnd || tempStart
    const [finalStart, finalEnd] =
      rawEnd.getTime() < tempStart.getTime() ? [rawEnd, tempStart] : [tempStart, rawEnd]
    const sStr = formatLocalYmd(finalStart)
    const eStr = formatLocalYmd(finalEnd)
    const nextPeriod = classifyDeliveryPeriod(sStr, eStr)
    onChange(nextPeriod, sStr, eStr)
    setIsOpen(false)
  }

  // Encabezados de días de la semana iniciando en Lunes (Lun -> Dom)
  const weekDays = useMemo(() => {
    const baseMonday = startOfWeek(new Date(2026, 0, 5, 12, 0, 0), { weekStartsOn: 1 })
    return Array.from({ length: 7 }).map((_, i) =>
      format(addDays(baseMonday, i), 'cccccc', { locale: localeObj })
    )
  }, [localeObj])

  const renderMonth = (monthDate: Date) => {
    const monthStart = startOfMonth(monthDate)
    const monthEnd = endOfMonth(monthStart)
    const startDateGrid = startOfWeek(monthStart, { weekStartsOn: 1 })
    const endDateGrid = endOfWeek(monthEnd, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start: startDateGrid, end: endDateGrid })

    const tempStartYmd = tempStart ? formatLocalYmd(tempStart) : null
    const tempEndYmd = tempEnd ? formatLocalYmd(tempEnd) : null
    const hoverYmd = hoverDate ? formatLocalYmd(hoverDate) : null
    const hoveredWeekBounds =
      selectionMode === 'week' && hoverDate
        ? {
            start: formatLocalYmd(startOfWeek(hoverDate, { weekStartsOn: 1 })),
            end: formatLocalYmd(endOfWeek(hoverDate, { weekStartsOn: 1 })),
          }
        : null

    return (
      <div className="grid grid-cols-7 gap-y-1 gap-x-0.5">
        {days.map((day, idx) => {
          const dayYmd = formatLocalYmd(day)
          const isCurrentMonth = isSameMonth(day, monthDate)
          const isStart = Boolean(tempStartYmd && dayYmd === tempStartYmd)
          const isEnd = Boolean(tempEndYmd && dayYmd === tempEndYmd)
          const rangeMinYmd =
            tempStartYmd && tempEndYmd ? (tempStartYmd <= tempEndYmd ? tempStartYmd : tempEndYmd) : null
          const rangeMaxYmd =
            tempStartYmd && tempEndYmd ? (tempStartYmd <= tempEndYmd ? tempEndYmd : tempStartYmd) : null
          const isInSelectedRange = Boolean(rangeMinYmd && rangeMaxYmd && dayYmd >= rangeMinYmd && dayYmd <= rangeMaxYmd)
          const isHoveredWeek = Boolean(
            hoveredWeekBounds && dayYmd >= hoveredWeekBounds.start && dayYmd <= hoveredWeekBounds.end
          )
          const hoverMinYmd =
            selectionMode === 'range' && tempStartYmd && !tempEndYmd && hoverYmd
              ? tempStartYmd <= hoverYmd
                ? tempStartYmd
                : hoverYmd
              : null
          const hoverMaxYmd =
            selectionMode === 'range' && tempStartYmd && !tempEndYmd && hoverYmd
              ? tempStartYmd <= hoverYmd
                ? hoverYmd
                : tempStartYmd
              : null
          const isHoveredRange = Boolean(hoverMinYmd && hoverMaxYmd && dayYmd >= hoverMinYmd && dayYmd <= hoverMaxYmd)

          // En modo semana permitimos también ver/clicar los días de borde de la semana aunque caigan en el mes contiguo
          const mutedOutOfMonth = !isCurrentMonth && !isInSelectedRange && !isHoveredWeek

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleCalendarDayClick(day)}
              onDoubleClick={() => {
                if (selectionMode === 'range') return
                if (selectionMode === 'week') {
                  const wm = startOfWeek(day, { weekStartsOn: 1 })
                  const ws = endOfWeek(day, { weekStartsOn: 1 })
                  const sStr = formatLocalYmd(wm)
                  const eStr = formatLocalYmd(ws)
                  setTempStart(wm)
                  setTempEnd(ws)
                  onChange(classifyDeliveryPeriod(sStr, eStr), sStr, eStr)
                  setIsOpen(false)
                } else if (selectionMode === 'day') {
                  const norm = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0)
                  const dStr = formatLocalYmd(norm)
                  setTempStart(norm)
                  setTempEnd(norm)
                  onChange(classifyDeliveryPeriod(dStr, dStr), dStr, dStr)
                  setIsOpen(false)
                }
              }}
              onMouseEnter={() => setHoverDate(day)}
              onMouseLeave={() => setHoverDate(null)}
              className={`h-8 w-8 sm:w-9 text-xs font-semibold flex items-center justify-center transition-all ${
                mutedOutOfMonth ? 'opacity-30 text-slate-400' : ''
              } ${
                isStart && isEnd
                  ? 'bg-indigo-600 text-white rounded-lg font-extrabold shadow-sm z-10'
                  : isStart
                  ? 'bg-slate-900 text-white dark:bg-indigo-500 dark:text-white rounded-l-lg font-extrabold shadow-sm z-10'
                  : isEnd
                  ? 'bg-slate-900 text-white dark:bg-indigo-500 dark:text-white rounded-r-lg font-extrabold shadow-sm z-10'
                  : isInSelectedRange
                  ? 'bg-indigo-500/15 dark:bg-indigo-500/25 text-indigo-950 dark:text-indigo-100 rounded-none font-bold'
                  : isHoveredWeek || isHoveredRange
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-md'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md'
              }`}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    )
  }

  const periodLabels: Record<DeliveryPeriodPreset, string> = {
    last_week: t('deliveryReconciliation.period_last_week'),
    week: t('deliveryReconciliation.period_this_week'),
    two_weeks_ago: t('deliveryReconciliation.period_two_weeks_ago'),
    today: t('deliveryReconciliation.period_today'),
    yesterday: t('deliveryReconciliation.period_yesterday'),
    month: t('deliveryReconciliation.period_current_month'),
    last_month: t('deliveryReconciliation.period_last_month'),
    selected_week: t('deliveryReconciliation.period_selected_week'),
    selected_day: t('deliveryReconciliation.period_selected_day'),
    custom: t('deliveryReconciliation.period_custom_range'),
  }

  const renderButtonSummary = () => {
    const ps = parseLocalYmd(startDate)
    const pe = parseLocalYmd(endDate)
    if (!ps || !pe) {
      return <span className="font-bold text-xs md:text-sm">{t('sales.select_dates')}</span>
    }
    const startFmt = format(ps, 'MMM d, yyyy', { locale: localeObj })
    const endFmt = format(pe, 'MMM d, yyyy', { locale: localeObj })
    const resolvedPeriod = classifyDeliveryPeriod(startDate, endDate)
    const topLabel = periodLabels[period] || periodLabels[resolvedPeriod]
    const subLabel = startDate === endDate ? startFmt : `${startFmt} – ${endFmt}`

    return (
      <div className="flex flex-col items-start leading-tight min-w-0 text-left">
        <span className="font-extrabold text-xs md:text-sm text-slate-900 dark:text-white truncate max-w-full">
          {topLabel}
        </span>
        <span className="text-[10.5px] text-slate-500 dark:text-slate-400 font-mono font-semibold truncate max-w-full">
          {subLabel}
        </span>
      </div>
    )
  }

  const modeHintText =
    selectionMode === 'week'
      ? t('deliveryReconciliation.picker_hint_week')
      : selectionMode === 'day'
      ? t('deliveryReconciliation.picker_hint_day')
      : t('deliveryReconciliation.picker_hint_range')

  const presetGroups: Array<{
    sectionLabel: string
    items: Array<{ id: DeliveryPeriodPreset; label: string }>
  }> = [
    {
      sectionLabel: t('deliveryReconciliation.picker_section_weeks'),
      items: [
        { id: 'last_week', label: t('deliveryReconciliation.period_last_week') },
        { id: 'week', label: t('deliveryReconciliation.period_this_week') },
        { id: 'two_weeks_ago', label: t('deliveryReconciliation.period_two_weeks_ago') },
      ],
    },
    {
      sectionLabel: t('deliveryReconciliation.picker_section_days'),
      items: [
        { id: 'today', label: t('deliveryReconciliation.period_today') },
        { id: 'yesterday', label: t('deliveryReconciliation.period_yesterday') },
      ],
    },
    {
      sectionLabel: t('deliveryReconciliation.picker_section_months'),
      items: [
        { id: 'month', label: t('deliveryReconciliation.period_current_month') },
        { id: 'last_month', label: t('deliveryReconciliation.period_last_month') },
      ],
    },
  ]

  const renderModeSwitcher = () => (
    <div className="space-y-1.5">
      <div className="inline-flex w-full sm:w-auto rounded-xl p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold">
        {(
          [
            { id: 'week', label: t('deliveryReconciliation.picker_mode_week') },
            { id: 'day', label: t('deliveryReconciliation.picker_mode_day') },
            { id: 'range', label: t('deliveryReconciliation.picker_mode_range') },
          ] as Array<{ id: PickerSelectionMode; label: string }>
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setSelectionMode(m.id)
              if (m.id === 'week' && tempStart) {
                setTempStart(startOfWeek(tempStart, { weekStartsOn: 1 }))
                setTempEnd(endOfWeek(tempStart, { weekStartsOn: 1 }))
              } else if (m.id === 'day' && tempStart) {
                setTempEnd(tempStart)
              }
            }}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg transition-all ${
              selectionMode === m.id
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{modeHintText}</p>
    </div>
  )

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Barra compacta estilo Módulo de Ventas: [ < ] [ Selector Unificado ] [ > ] */}
      <div className="flex items-center gap-1 w-full">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleStepPeriod(-1)}
          title={
            isDayView
              ? t('deliveryReconciliation.picker_prev_day_tooltip')
              : isMonthView
              ? t('deliveryReconciliation.picker_prev_month_tooltip')
              : t('deliveryReconciliation.picker_prev_week_tooltip')
          }
          aria-label={
            isDayView
              ? t('deliveryReconciliation.picker_prev_day_tooltip')
              : isMonthView
              ? t('deliveryReconciliation.picker_prev_month_tooltip')
              : t('deliveryReconciliation.picker_prev_week_tooltip')
          }
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          id="conciliar-filter-period"
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              resetDraftAndClose()
            } else {
              syncDraftFromCommitted()
              setIsOpen(true)
            }
          }}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={t('deliveryReconciliation.filter_3_period')}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl px-2.5 py-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-700 shrink-0">
              <CalendarIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            {renderButtonSummary()}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        <button
          type="button"
          disabled={disabled || !canStepForward}
          onClick={() => handleStepPeriod(1)}
          title={
            isDayView
              ? t('deliveryReconciliation.picker_next_day_tooltip')
              : isMonthView
              ? t('deliveryReconciliation.picker_next_month_tooltip')
              : t('deliveryReconciliation.picker_next_week_tooltip')
          }
          aria-label={
            isDayView
              ? t('deliveryReconciliation.picker_next_day_tooltip')
              : isMonthView
              ? t('deliveryReconciliation.picker_next_month_tooltip')
              : t('deliveryReconciliation.picker_next_week_tooltip')
          }
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isOpen && (
        <>
          {/* Vista Móvil a Pantalla Completa (Portal idéntico a Ventas) */}
          {typeof document !== 'undefined' &&
            createPortal(
              <div
                data-delivery-date-portal
                role="dialog"
                aria-modal="true"
                aria-label={t('deliveryReconciliation.picker_dialog_aria')}
                className="md:hidden fixed inset-0 z-[9999] bg-white dark:bg-slate-900 flex flex-col"
              >
                <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-indigo-600" />
                    {t('deliveryReconciliation.filter_3_period')}
                  </h2>
                  <button
                    type="button"
                    onClick={resetDraftAndClose}
                    aria-label={t('deliveryReconciliation.modal_close')}
                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {presetGroups
                      .flatMap((g) => g.items)
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handlePresetClick(item.id)}
                          className={`px-2 py-2.5 rounded-xl text-xs font-bold transition-all text-center ${
                            period === item.id
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                  </div>

                  {renderModeSwitcher()}

                  <div>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <button
                        type="button"
                        onClick={() => setViewDate(subMonths(viewDate, 1))}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                      >
                        <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                      </button>
                      <span className="font-extrabold text-sm capitalize text-slate-900 dark:text-white">
                        {format(viewDate, 'MMMM yyyy', { locale: localeObj })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setViewDate(addMonths(viewDate, 1))}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                      >
                        <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 mb-1 text-center text-[11px] text-slate-400 font-bold uppercase">
                      {weekDays.map((d, i) => (
                        <div key={i} className="capitalize">
                          {d}
                        </div>
                      ))}
                    </div>
                    {renderMonth(viewDate)}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="delivery-picker-mobile-start" className="text-[10px] uppercase font-bold text-slate-400">
                        {t('sales.start_date')}
                      </label>
                      <input
                        id="delivery-picker-mobile-start"
                        name="mobile_start_date"
                        type="date"
                        aria-label={t('deliveryReconciliation.picker_from_date_aria')}
                        value={tempStart ? formatLocalYmd(tempStart) : ''}
                        onChange={(e) => {
                          const parsed = parseLocalYmd(e.target.value)
                          if (!parsed) return
                          if (selectionMode === 'day') {
                            setTempStart(parsed)
                            setTempEnd(parsed)
                          } else if (selectionMode === 'week') {
                            setTempStart(startOfWeek(parsed, { weekStartsOn: 1 }))
                            setTempEnd(endOfWeek(parsed, { weekStartsOn: 1 }))
                          } else {
                            setTempStart(parsed)
                            if (tempEnd && formatLocalYmd(parsed) > formatLocalYmd(tempEnd)) {
                              setTempEnd(parsed)
                            }
                          }
                        }}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                    {selectionMode !== 'day' && (
                      <div className="flex flex-col gap-1">
                        <label htmlFor="delivery-picker-mobile-end" className="text-[10px] uppercase font-bold text-slate-400">
                          {t('sales.end_date')}
                        </label>
                        <input
                          id="delivery-picker-mobile-end"
                          name="mobile_end_date"
                          type="date"
                          aria-label={t('deliveryReconciliation.picker_to_date_aria')}
                          min={tempStart ? formatLocalYmd(tempStart) : undefined}
                          value={tempEnd ? formatLocalYmd(tempEnd) : ''}
                          onChange={(e) => {
                            const parsed = parseLocalYmd(e.target.value)
                            if (!parsed) return
                            setSelectionMode('range')
                            setTempEnd(parsed)
                          }}
                          className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex gap-3 px-4 py-3.5 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={resetDraftAndClose}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
                  >
                    {t('deliveryReconciliation.picker_cancel_btn')}
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-extrabold bg-indigo-600 text-white shadow-md"
                  >
                    {t('deliveryReconciliation.picker_apply_btn')}
                  </button>
                </div>
              </div>,
              document.body
            )}

          {/* Dropdown de Escritorio Dual-Month estilo Ventas */}
          <div
            role="dialog"
            aria-modal="false"
            aria-label={t('deliveryReconciliation.picker_dialog_aria')}
            className={`hidden md:flex absolute top-full ${align === 'left' ? 'left-0' : 'right-0'} mt-2 z-50 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex-row overflow-x-auto`}
          >
            {/* Columna izquierda de Presets */}
            <div className="w-44 border-r border-slate-100 dark:border-slate-800 p-2.5 flex flex-col gap-2 bg-slate-50/70 dark:bg-slate-900/70 shrink-0">
              {presetGroups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className={
                    gIdx > 0 ? 'pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-0.5' : 'space-y-0.5'
                  }
                >
                  <div className="px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    {group.sectionLabel}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePresetClick(item.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        period === item.id
                          ? 'bg-slate-900 text-white dark:bg-indigo-600 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Área principal: Selector de Modo (Semana / Día / Rango) + 2 Meses + Pie Aplicar */}
            <div className="p-4 flex flex-col gap-3.5">
              {renderModeSwitcher()}

              <div className="flex gap-5">
                <div>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <button
                      type="button"
                      onClick={() => setViewDate(subMonths(viewDate, 1))}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-bold text-xs capitalize text-slate-800 dark:text-slate-100">
                      {format(viewDate, 'MMMM yyyy', { locale: localeObj })}
                    </span>
                    <div className="w-5" />
                  </div>
                  <div className="grid grid-cols-7 mb-1 text-center text-[11px] text-slate-400 font-bold">
                    {weekDays.map((d, i) => (
                      <div key={i} className="capitalize w-8 sm:w-9">
                        {d}
                      </div>
                    ))}
                  </div>
                  {renderMonth(viewDate)}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="w-5" />
                    <span className="font-bold text-xs capitalize text-slate-800 dark:text-slate-100">
                      {format(addMonths(viewDate, 1), 'MMMM yyyy', { locale: localeObj })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setViewDate(addMonths(viewDate, 1))}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 mb-1 text-center text-[11px] text-slate-400 font-bold">
                    {weekDays.map((d, i) => (
                      <div key={i} className="capitalize w-8 sm:w-9">
                        {d}
                      </div>
                    ))}
                  </div>
                  {renderMonth(addMonths(viewDate, 1))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="delivery-picker-start"
                      className="text-[10px] uppercase font-bold text-slate-400"
                    >
                      {t('sales.start_date')}
                    </label>
                    <input
                      id="delivery-picker-start"
                      name="start_date"
                      type="date"
                      aria-label={t('deliveryReconciliation.picker_from_date_aria')}
                      value={tempStart ? formatLocalYmd(tempStart) : ''}
                      onChange={(e) => {
                        const parsed = parseLocalYmd(e.target.value)
                        if (!parsed) return
                        if (selectionMode === 'day') {
                          setTempStart(parsed)
                          setTempEnd(parsed)
                        } else if (selectionMode === 'week') {
                          setTempStart(startOfWeek(parsed, { weekStartsOn: 1 }))
                          setTempEnd(endOfWeek(parsed, { weekStartsOn: 1 }))
                        } else {
                          setTempStart(parsed)
                          if (tempEnd && formatLocalYmd(parsed) > formatLocalYmd(tempEnd)) {
                            setTempEnd(parsed)
                          }
                        }
                      }}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  {selectionMode !== 'day' && (
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="delivery-picker-end"
                        className="text-[10px] uppercase font-bold text-slate-400"
                      >
                        {t('sales.end_date')}
                      </label>
                      <input
                        id="delivery-picker-end"
                        name="end_date"
                        type="date"
                        aria-label={t('deliveryReconciliation.picker_to_date_aria')}
                        min={tempStart ? formatLocalYmd(tempStart) : undefined}
                        value={tempEnd ? formatLocalYmd(tempEnd) : ''}
                        onChange={(e) => {
                          const parsed = parseLocalYmd(e.target.value)
                          if (!parsed) return
                          setSelectionMode('range')
                          setTempEnd(parsed)
                        }}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-2 self-end">
                  <button
                    type="button"
                    onClick={resetDraftAndClose}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('deliveryReconciliation.picker_cancel_btn')}
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-slate-900 dark:bg-indigo-600 text-white shadow-sm hover:opacity-95"
                  >
                    {t('deliveryReconciliation.picker_apply_btn')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
