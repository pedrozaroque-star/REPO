'use client'

import { useMemo } from 'react'
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
        if (hour === 0) return '12:00 AM'
        if (hour === 12) return '12:00 PM'
        if (hour > 12) return `${hour - 12}:00 PM`
        return `${hour}:00 AM`
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
                        {/* Date Header */}
                        <div className={`
                            flex items-center gap-3 mb-3 px-4 py-2 rounded-xl
                            ${isToday
                                ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}
                        `}>
                            <span className="text-2xl">📅</span>
                            <div>
                                <span className="font-bold capitalize">
                                    {format(date, 'EEEE', { locale })}
                                </span>
                                <span className="mx-2">•</span>
                                <span className="font-medium">
                                    {format(date, 'd MMMM', { locale })}
                                </span>
                                {isToday && (
                                    <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
                                        {language === 'es' ? 'HOY' : 'TODAY'}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Shifts for this day */}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                                            <div className="flex items-center justify-between text-white">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-2xl">
                                                        {shift.position_type === 'kitchen' ? '🍳' : '💵'}
                                                    </span>
                                                    <span className="font-bold uppercase text-sm">
                                                        {shift.position_type === 'kitchen'
                                                            ? (language === 'es' ? 'Cocinero' : 'Cook')
                                                            : (language === 'es' ? 'Cajero' : 'Cashier')}
                                                    </span>
                                                </div>
                                                {isMyShift && (
                                                    <span className="bg-white/20 px-2 py-1 rounded-full text-xs font-bold">
                                                        ✓ {language === 'es' ? 'TU TURNO' : 'YOUR SHIFT'}
                                                    </span>
                                                )}
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
                                                    <div className="font-bold text-zinc-800 dark:text-white">
                                                        {formatHour(shift.start_hour)} - {formatHour(shift.end_hour)}
                                                    </div>
                                                    <div className="text-sm text-zinc-500">
                                                        {getDuration(shift.start_hour, shift.end_hour)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Store */}
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                                                    📍
                                                </div>
                                                <div className="font-medium text-zinc-700 dark:text-zinc-300">
                                                    {storeName}
                                                </div>
                                            </div>

                                            {/* Availability */}
                                            <div className={`
                                                flex items-center justify-between p-3 rounded-xl
                                                ${isFull
                                                    ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500'
                                                    : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'}
                                            `}>
                                                <span className="text-sm font-medium">
                                                    {isFull
                                                        ? (language === 'es' ? '❌ Sin espacios' : '❌ No spots left')
                                                        : `✓ ${shift.available_spots} ${language === 'es' ? 'espacio(s) disponible(s)' : 'spot(s) available'}`
                                                    }
                                                </span>
                                                <span className="text-xs opacity-60">
                                                    {shift.claimed_count}/{shift.required_count}
                                                </span>
                                            </div>

                                            {/* Action Button */}
                                            {isMyShift ? (
                                                <button
                                                    onClick={() => onDropShift(shift)}
                                                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-sm hover:from-orange-600 hover:to-red-600 transition-all flex items-center justify-center gap-2"
                                                >
                                                    🗑️ {language === 'es' ? 'SOLTAR TURNO' : 'DROP SHIFT'}
                                                </button>
                                            ) : isFull ? (
                                                <button
                                                    disabled
                                                    className="w-full py-3 px-4 rounded-xl bg-zinc-200 dark:bg-zinc-700 text-zinc-400 font-bold text-sm cursor-not-allowed"
                                                >
                                                    {language === 'es' ? 'LLENO' : 'FULL'}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => onClaimShift(shift)}
                                                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
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
