'use client'

/**
 * @module components/self-schedule/ShiftPool
 * @description Lista tipo acordeón por día de turnos abiertos y tomados en Auto-Programación (/mis-horarios).
 * @businessRules
 * - Expande automáticamente el día actual (America/Los_Angeles) y cualquier día donde el empleado ya tenga un turno reclamado.
 * - Maneja turnos nocturnos (>= 24h) y resalta horas pico (🔥 RUSH).
 * @dataFlow
 * - OpenShift[] + myClaimIds desde app/mis-horarios/page.tsx -> interacción claim/drop hacia ClaimModal y DropModal.
 * @notes Mobile fix: acordeón sin sticky collision, tarjetas expandidas w-full en móviles y badge RUSH dentro del header sin solapar ✓ TU TURNO.
 */

import { useMemo, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { format, parseISO } from 'date-fns'
import { es, enUS } from 'date-fns/locale'

interface OpenShift {
    id: string
    store_id: string
    shift_date: string
    start_hour: number
    end_hour: number
    position_type: string
    required_count: number
    claimed_count: number
    available_spots: number
    is_available: boolean
    shift_claims?: any[]
}

interface ShiftPoolProps {
    shifts: OpenShift[]
    myClaimIds: Set<string>
    storeMap: Map<string, string>
    onClaimShift: (shift: OpenShift) => void
    onDropShift: (shift: OpenShift) => void
}

export function ShiftPool({ shifts, myClaimIds, storeMap, onClaimShift, onDropShift }: ShiftPoolProps) {
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    const formatHour = (hour: number) => {
        // Handle overnight hours (e.g., 25 = 1AM, 26 = 2AM, etc.)
        const normalizedHour = hour >= 24 ? hour - 24 : hour

        if (normalizedHour === 0) return '12:00 AM'
        if (normalizedHour === 12) return '12:00 PM'
        if (normalizedHour > 12) return `${normalizedHour - 12}:00 PM`
        return `${normalizedHour}:00 AM`
    }

    const getDuration = (start: number, end: number) => {
        const hours = end - start
        return language === 'es' ? `${hours}h` : `${hours}hrs`
    }

    // Determine if shift is during peak hours (11-2 or 5-9)
    const isPeakShift = (start: number, end: number) => {
        return (start >= 11 && start < 14) || (start >= 17 && start < 21) ||
            (end > 11 && end <= 14) || (end > 17 && end <= 21)
    }

    // Group shifts by date
    const shiftsByDate = useMemo(() => {
        const grouped = new Map<string, OpenShift[]>()

        // Sort shifts by date, then by start hour
        const sorted = [...shifts].sort((a, b) => {
            if (a.shift_date !== b.shift_date) {
                return a.shift_date.localeCompare(b.shift_date)
            }
            return a.start_hour - b.start_hour
        })

        for (const shift of sorted) {
            const date = shift.shift_date
            if (!grouped.has(date)) {
                grouped.set(date, [])
            }
            grouped.get(date)!.push(shift)
        }

        return grouped
    }, [shifts])

    // Pure derived defaults: auto-expand Today (LA tz) and any day containing a claimed shift
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const defaultExpandedDays = useMemo(() => {
        const set = new Set<string>()
        for (const [dateStr, dayShifts] of shiftsByDate.entries()) {
            if (dateStr === todayStr || dayShifts.some(s => myClaimIds.has(s.id))) {
                set.add(dateStr)
            }
        }
        return set
    }, [shiftsByDate, myClaimIds, todayStr])

    const [manualExpandedDays, setManualExpandedDays] = useState<Set<string>>(new Set())
    const [manualCollapsedDays, setManualCollapsedDays] = useState<Set<string>>(new Set())

    // Which shift is fully expanded (showing full card)
    const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null)

    const isDayExpanded = (dateStr: string) => {
        if (manualExpandedDays.has(dateStr)) return true
        if (manualCollapsedDays.has(dateStr)) return false
        return defaultExpandedDays.has(dateStr)
    }

    const toggleDay = (dateStr: string) => {
        const currentlyOpen = isDayExpanded(dateStr)
        if (currentlyOpen) {
            setManualExpandedDays(prev => {
                const next = new Set(prev)
                next.delete(dateStr)
                return next
            })
            setManualCollapsedDays(prev => new Set(prev).add(dateStr))
            setExpandedShiftId(null)
        } else {
            setManualCollapsedDays(prev => {
                const next = new Set(prev)
                next.delete(dateStr)
                return next
            })
            setManualExpandedDays(prev => new Set(prev).add(dateStr))
        }
    }

    const toggleShift = (shiftId: string) => {
        setExpandedShiftId(prev => prev === shiftId ? null : shiftId)
    }

    if (shifts.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="text-6xl mb-4">📭</div>
                <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300">
                    {language === 'es' ? 'No hay turnos disponibles' : 'No shifts available'}
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                    {language === 'es'
                        ? 'Los turnos aparecerán aquí cuando el manager los publique.'
                        : 'Shifts will appear here when the manager publishes them.'}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {Array.from(shiftsByDate.entries()).map(([dateStr, dayShifts]) => {
                const date = parseISO(dateStr)
                const isToday = dateStr === todayStr
                const isPast = dateStr < todayStr
                const dayOpen = isDayExpanded(dateStr)
                const dayHasMyShift = dayShifts.some(s => myClaimIds.has(s.id))

                return (
                    <div key={dateStr} className={`${isPast ? 'opacity-50' : ''}`}>
                        {/* Date Header - Clickable accordion */}
                        <button
                            onClick={() => toggleDay(dateStr)}
                            className={`
                                w-full
                                flex flex-wrap items-center gap-2 sm:gap-3 
                                mt-4 first:mt-0 mb-2 
                                mx-0 px-3.5 sm:px-4 py-3 sm:py-2.5 
                                rounded-xl shadow-md
                                transition-all duration-200 active:scale-[0.98]
                                ${isToday
                                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-blue-500/30'
                                    : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750'}
                            `}
                        >
                            {/* Expand/Collapse arrow */}
                            <span className={`text-base sm:text-lg transition-transform duration-200 ${dayOpen ? 'rotate-90' : ''}`}>
                                ▶
                            </span>
                            <span className="text-xl sm:text-2xl">📅</span>
                            <div className="flex-1 text-left min-w-0">
                                <span className="font-bold capitalize text-base sm:text-lg">
                                    {format(date, 'EEEE', { locale })}
                                </span>
                                <span className="mx-1.5 sm:mx-2 opacity-50">•</span>
                                <span className="font-medium text-sm sm:text-base">
                                    {format(date, 'd MMM', { locale })}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {dayHasMyShift && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isToday ? 'bg-emerald-400/30 text-white' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'}`}>
                                        ✓ {t('self_schedule.your_shift_day')}
                                    </span>
                                )}
                                {isToday && (
                                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold animate-pulse">
                                        {language === 'es' ? 'HOY' : 'TODAY'}
                                    </span>
                                )}
                                {/* Available spots badge - shows TOTAL spots, not shift count */}
                                {(() => {
                                    const totalSpots = dayShifts.reduce((sum, s) => sum + s.available_spots, 0)
                                    return (
                                        <span className={`
                                            px-2 py-0.5 rounded-full text-xs font-bold
                                            ${isToday ? 'bg-white/20' : totalSpots > 0 ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-100 dark:bg-zinc-700'}
                                        `}>
                                            {totalSpots} {language === 'es' ? (totalSpots === 1 ? 'espacio' : 'espacios') : (totalSpots === 1 ? 'spot' : 'spots')}
                                        </span>
                                    )
                                })()}
                            </div>
                        </button>

                        {/* Shifts for this day - 2 levels: thumbnails then full card */}
                        <div className={`
                            overflow-hidden transition-all duration-300 ease-in-out
                            ${dayOpen ? 'max-h-[3000px] opacity-100 py-2' : 'max-h-0 opacity-0'}
                        `}>
                            {/* Level 2: Thumbnails - small pills with just time */}
                            <div className="flex flex-wrap gap-2 px-1">
                                {dayShifts.map(shift => {
                                    const isMyShift = myClaimIds.has(shift.id)
                                    const isFull = shift.claimed_count >= shift.required_count
                                    const isPeak = isPeakShift(shift.start_hour, shift.end_hour)
                                    const isExpanded = expandedShiftId === shift.id

                                    return (
                                        <div key={shift.id} className={`flex flex-col ${isExpanded ? 'w-full sm:w-auto' : ''}`}>
                                            {/* Thumbnail chip */}
                                            <button
                                                onClick={() => toggleShift(shift.id)}
                                                className={`
                                                    px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold
                                                    border-2 transition-all duration-200
                                                    flex items-center gap-1.5 self-start
                                                    ${isExpanded ? 'ring-2 ring-offset-1 ring-blue-400 scale-105' : 'hover:scale-105'}
                                                    ${isMyShift
                                                        ? 'bg-blue-500 border-blue-600 text-white'
                                                        : isFull
                                                            ? 'bg-zinc-200 dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 text-zinc-500'
                                                            : shift.position_type === 'kitchen'
                                                                ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-400 text-orange-700 dark:text-orange-300'
                                                                : 'bg-pink-50 dark:bg-pink-900/30 border-pink-400 text-pink-700 dark:text-pink-300'}
                                                `}
                                            >
                                                {isPeak && !isFull && <span>🔥</span>}
                                                {isMyShift && <span>✓</span>}
                                                <span>{formatHour(shift.start_hour)}-{formatHour(shift.end_hour)}</span>
                                                {!isFull && (
                                                    <span className="text-[10px] opacity-70">
                                                        ({shift.available_spots})
                                                    </span>
                                                )}
                                            </button>

                                            {/* Level 3: Expanded full card */}
                                            {isExpanded && (
                                                <div className={`
                                                    relative mt-2 rounded-2xl overflow-hidden shadow-xl
                                                    transition-all duration-300 animate-in slide-in-from-top-2
                                                    ${isMyShift ? 'ring-2 ring-blue-500' : ''}
                                                    w-full sm:w-80
                                                `}>
                                                    {/* Card Header */}
                                                    <div className={`
                                                        px-4 py-3
                                                        ${isMyShift
                                                            ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                                                            : isFull
                                                                ? 'bg-zinc-400 dark:bg-zinc-600'
                                                                : shift.position_type === 'kitchen'
                                                                    ? 'bg-gradient-to-r from-red-500 to-orange-500'
                                                                    : 'bg-gradient-to-r from-pink-500 to-rose-500'}
                                                    `}>
                                                        <div className="flex items-center justify-between text-white gap-2">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-2xl">
                                                                    {shift.position_type === 'kitchen' ? '🍳' : '💵'}
                                                                </span>
                                                                <span className="font-bold uppercase text-sm truncate">
                                                                    {shift.position_type === 'kitchen'
                                                                        ? (language === 'es' ? 'Cocinero' : 'Cook')
                                                                        : (language === 'es' ? 'Cajero' : 'Cashier')}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                {isPeak && !isFull && (
                                                                    <span className="bg-orange-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
                                                                        🔥 RUSH
                                                                    </span>
                                                                )}
                                                                {isMyShift && (
                                                                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-[11px] font-bold">
                                                                        ✓ {language === 'es' ? 'TU TURNO' : 'YOUR SHIFT'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Card Body */}
                                                    <div className="bg-white dark:bg-zinc-800 p-4 space-y-3">
                                                        {/* Time */}
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                                                                🕐
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-lg text-zinc-800 dark:text-white">
                                                                    {formatHour(shift.start_hour)} - {formatHour(shift.end_hour)}
                                                                </div>
                                                                <div className="text-sm text-zinc-500">
                                                                    {getDuration(shift.start_hour, shift.end_hour)}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Availability */}
                                                        <div className={`
                                                            flex items-center justify-between p-3 rounded-xl text-sm
                                                            ${isFull
                                                                ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500'
                                                                : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'}
                                                        `}>
                                                            <span className="font-medium">
                                                                {isFull
                                                                    ? (language === 'es' ? '❌ Sin espacios' : '❌ No spots left')
                                                                    : `✓ ${shift.available_spots} ${language === 'es' ? 'disponible(s)' : 'available'}`
                                                                }
                                                            </span>
                                                            <span className="opacity-60">
                                                                {shift.claimed_count}/{shift.required_count}
                                                            </span>
                                                        </div>

                                                        {/* Action Button */}
                                                        {isMyShift ? (
                                                            <button
                                                                onClick={() => onDropShift(shift)}
                                                                className="w-full py-4 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-base hover:from-orange-600 hover:to-red-600 transition-all flex items-center justify-center gap-2 active:scale-95"
                                                            >
                                                                🗑️ {language === 'es' ? 'SOLTAR TURNO' : 'DROP SHIFT'}
                                                            </button>
                                                        ) : isFull ? (
                                                            <button
                                                                disabled
                                                                className="w-full py-4 px-4 rounded-xl bg-zinc-200 dark:bg-zinc-700 text-zinc-400 font-bold cursor-not-allowed"
                                                            >
                                                                {language === 'es' ? 'LLENO' : 'FULL'}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => onClaimShift(shift)}
                                                                className="w-full py-4 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-base hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 active:scale-95"
                                                            >
                                                                ✨ {language === 'es' ? 'TOMAR TURNO' : 'CLAIM SHIFT'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
