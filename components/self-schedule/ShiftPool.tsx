'use client'

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
    const { language } = useLanguage()
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

    // Accordion state - which days are expanded
    // By default, today and next day are expanded
    const [expandedDays, setExpandedDays] = useState<Set<string>>(() => {
        const today = format(new Date(), 'yyyy-MM-dd')
        const tomorrow = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')
        return new Set([today, tomorrow])
    })

    const toggleDay = (dateStr: string) => {
        setExpandedDays(prev => {
            const next = new Set(prev)
            if (next.has(dateStr)) {
                next.delete(dateStr)
            } else {
                next.add(dateStr)
            }
            return next
        })
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
                const isToday = dateStr === format(new Date(), 'yyyy-MM-dd')
                const isPast = date < new Date(new Date().setHours(0, 0, 0, 0))

                return (
                    <div key={dateStr} className={`${isPast ? 'opacity-50' : ''}`}>
                        {/* Date Header - Clickable accordion */}
                        <button
                            onClick={() => toggleDay(dateStr)}
                            className={`
                                w-full
                                sticky top-0 z-10
                                flex items-center gap-2 sm:gap-3 
                                mt-4 first:mt-0 mb-2 
                                mx-0 px-4 py-3 sm:py-2 
                                rounded-xl shadow-md
                                transition-all duration-200 active:scale-[0.98]
                                ${isToday
                                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-blue-500/30'
                                    : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750'}
                            `}
                        >
                            {/* Expand/Collapse arrow */}
                            <span className={`text-lg transition-transform duration-200 ${expandedDays.has(dateStr) ? 'rotate-90' : ''}`}>
                                ▶
                            </span>
                            <span className="text-xl sm:text-2xl">📅</span>
                            <div className="flex-1 text-left">
                                <span className="font-bold capitalize text-base sm:text-lg">
                                    {format(date, 'EEEE', { locale })}
                                </span>
                                <span className="mx-2 opacity-50">•</span>
                                <span className="font-medium text-sm sm:text-base">
                                    {format(date, 'd MMM', { locale })}
                                </span>
                            </div>
                            {isToday && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold animate-pulse">
                                    {language === 'es' ? 'HOY' : 'TODAY'}
                                </span>
                            )}
                            {/* Shift count badge */}
                            <span className={`
                                px-2 py-0.5 rounded-full text-xs font-bold
                                ${isToday ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-700'}
                            `}>
                                {dayShifts.length} {language === 'es' ? (dayShifts.length === 1 ? 'turno' : 'turnos') : (dayShifts.length === 1 ? 'shift' : 'shifts')}
                            </span>
                        </button>

                        {/* Shifts for this day - Collapsible */}
                        <div className={`
                            grid gap-3 sm:grid-cols-2 lg:grid-cols-3
                            overflow-hidden transition-all duration-300 ease-in-out
                            ${expandedDays.has(dateStr) ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}
                        `}>
                            {dayShifts.map(shift => {
                                const isMyShift = myClaimIds.has(shift.id)
                                const isFull = shift.claimed_count >= shift.required_count
                                const isPeak = isPeakShift(shift.start_hour, shift.end_hour)
                                const storeName = storeMap.get(shift.store_id) || 'Unknown'

                                return (
                                    <div
                                        key={shift.id}
                                        className={`
                                            relative rounded-2xl overflow-hidden shadow-lg
                                            transition-all duration-300 transform
                                            ${isMyShift
                                                ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-900'
                                                : 'hover:scale-[1.02]'}
                                            ${isFull && !isMyShift ? 'opacity-60' : ''}
                                        `}
                                    >
                                        {/* Peak Badge */}
                                        {isPeak && !isFull && (
                                            <div className="absolute top-2 right-2 z-10">
                                                <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg">
                                                    🔥 {language === 'es' ? 'RUSH' : 'RUSH'}
                                                </span>
                                            </div>
                                        )}

                                        {/* Card Header - More compact */}
                                        <div className={`
                                            px-3 py-2 sm:px-4 sm:py-3
                                            ${isMyShift
                                                ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                                                : isFull
                                                    ? 'bg-zinc-400 dark:bg-zinc-600'
                                                    : shift.position_type === 'kitchen'
                                                        ? 'bg-gradient-to-r from-red-500 to-orange-500'
                                                        : 'bg-gradient-to-r from-pink-500 to-rose-500'}
                                        `}>
                                            <div className="flex items-center justify-between text-white">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg sm:text-2xl">
                                                        {shift.position_type === 'kitchen' ? '🍳' : '💵'}
                                                    </span>
                                                    <span className="font-bold uppercase text-xs sm:text-sm">
                                                        {shift.position_type === 'kitchen'
                                                            ? (language === 'es' ? 'Cocinero' : 'Cook')
                                                            : (language === 'es' ? 'Cajero' : 'Cashier')}
                                                    </span>
                                                </div>
                                                {isMyShift && (
                                                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
                                                        ✓ {language === 'es' ? 'TU TURNO' : 'YOUR SHIFT'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Card Body - Simplified for mobile */}
                                        <div className="bg-white dark:bg-zinc-800 p-3 sm:p-4 space-y-2 sm:space-y-3">
                                            {/* Time - More prominent */}
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-sm sm:text-base">
                                                    🕐
                                                </div>
                                                <div>
                                                    <div className="font-bold text-base sm:text-lg text-zinc-800 dark:text-white">
                                                        {formatHour(shift.start_hour)} - {formatHour(shift.end_hour)}
                                                    </div>
                                                    <div className="text-xs sm:text-sm text-zinc-500">
                                                        {getDuration(shift.start_hour, shift.end_hour)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Store - Hidden on mobile if there's only one store */}
                                            <div className="hidden sm:flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                                                    📍
                                                </div>
                                                <div className="font-medium text-zinc-700 dark:text-zinc-300">
                                                    {storeName}
                                                </div>
                                            </div>

                                            {/* Availability - Compact */}
                                            <div className={`
                                                flex items-center justify-between p-2 sm:p-3 rounded-lg sm:rounded-xl text-xs sm:text-sm
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

                                            {/* Action Button - Larger touch target */}
                                            {isMyShift ? (
                                                <button
                                                    onClick={() => onDropShift(shift)}
                                                    className="w-full py-3 sm:py-4 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm sm:text-base hover:from-orange-600 hover:to-red-600 transition-all flex items-center justify-center gap-2 active:scale-95"
                                                >
                                                    🗑️ {language === 'es' ? 'SOLTAR TURNO' : 'DROP SHIFT'}
                                                </button>
                                            ) : isFull ? (
                                                <button
                                                    disabled
                                                    className="w-full py-3 sm:py-4 px-4 rounded-xl bg-zinc-200 dark:bg-zinc-700 text-zinc-400 font-bold text-sm cursor-not-allowed"
                                                >
                                                    {language === 'es' ? 'LLENO' : 'FULL'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => onClaimShift(shift)}
                                                    className="w-full py-3 sm:py-4 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm sm:text-base hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 active:scale-95"
                                                >
                                                    ✨ {language === 'es' ? 'TOMAR TURNO' : 'CLAIM SHIFT'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
