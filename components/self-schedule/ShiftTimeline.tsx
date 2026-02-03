'use client'

import { useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ShiftSlot } from './ShiftSlot'
import { format, addDays } from 'date-fns'
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

interface ShiftTimelineProps {
    shifts: OpenShift[]
    myClaimIds: Set<string>
    storeMap: Map<string, string>
    weekStart: Date
    onSlotClick: (shift: OpenShift) => void
}

export function ShiftTimeline({ shifts, myClaimIds, storeMap, weekStart, onSlotClick }: ShiftTimelineProps) {
    const { language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // Generate 7 days from week start
    const days = useMemo(() => {
        const result: Date[] = []
        for (let i = 0; i < 7; i++) {
            result.push(addDays(weekStart, i))
        }
        return result
    }, [weekStart])

    // Hours to display (6 AM to 10 PM)
    const HOUR_START = 6
    const HOUR_END = 22
    const TOTAL_HOURS = HOUR_END - HOUR_START

    const hours = useMemo(() => {
        const result: number[] = []
        for (let h = HOUR_START; h < HOUR_END; h++) {
            result.push(h)
        }
        return result
    }, [])

    // Group shifts by date
    const shiftsByDate = useMemo(() => {
        const map = new Map<string, OpenShift[]>()
        shifts.forEach(shift => {
            const key = shift.shift_date
            if (!map.has(key)) {
                map.set(key, [])
            }
            map.get(key)!.push(shift)
        })
        return map
    }, [shifts])

    const formatHour = (hour: number) => {
        if (hour === 0) return '12 AM'
        if (hour === 12) return '12 PM'
        if (hour > 12) return `${hour - 12} PM`
        return `${hour} AM`
    }

    return (
        <div className="overflow-x-auto">
            <div style={{ minWidth: '1400px' }}>
                {/* Header - Hours */}
                <div
                    className="sticky top-0 bg-white dark:bg-zinc-900 z-10 border-b border-zinc-200 dark:border-zinc-700"
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `140px repeat(${TOTAL_HOURS}, 1fr)`
                    }}
                >
                    <div className="p-3 font-semibold text-zinc-500 dark:text-zinc-400">
                        {language === 'es' ? 'Día' : 'Day'}
                    </div>
                    {hours.map(hour => (
                        <div
                            key={hour}
                            className="p-2 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 border-l border-zinc-100 dark:border-zinc-800"
                        >
                            {formatHour(hour)}
                        </div>
                    ))}
                </div>

                {/* Rows - Days */}
                {days.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd')
                    const isToday = dateStr === format(new Date(), 'yyyy-MM-dd')
                    const isPast = day < new Date(new Date().setHours(0, 0, 0, 0))
                    const dayShifts = shiftsByDate.get(dateStr) || []

                    return (
                        <div
                            key={dateStr}
                            className={`
                                border-b border-zinc-100 dark:border-zinc-800
                                ${isToday ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}
                                ${isPast ? 'opacity-50' : ''}
                            `}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: `140px repeat(${TOTAL_HOURS}, 1fr)`,
                                minHeight: '90px'
                            }}
                        >
                            {/* Day label */}
                            <div className="p-3 font-medium flex flex-col justify-center border-r border-zinc-100 dark:border-zinc-800">
                                <div className={`
                                    text-sm capitalize
                                    ${isToday ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-zinc-700 dark:text-zinc-300'}
                                `}>
                                    {format(day, 'EEEE', { locale })}
                                </div>
                                <div className="text-xs text-zinc-500">
                                    {format(day, 'MMM d', { locale })}
                                </div>
                                {isToday && (
                                    <span className="inline-block mt-1 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full w-fit">
                                        {language === 'es' ? 'Hoy' : 'Today'}
                                    </span>
                                )}
                            </div>

                            {/* Hour cells with shifts aligned by actual column span */}
                            {hours.map(hour => {
                                const currentHour = new Date().getHours()
                                const isCurrentHour = isToday && hour === currentHour

                                // Find any shift that STARTS at this hour
                                const shiftStartingHere = dayShifts.find(s => s.start_hour === hour)

                                // If there's a shift starting here, render it spanning columns
                                if (shiftStartingHere) {
                                    const shift = shiftStartingHere
                                    const isMyShift = myClaimIds.has(shift.id)
                                    const spanHours = Math.min(shift.end_hour, HOUR_END) - shift.start_hour

                                    return (
                                        <div
                                            key={hour}
                                            className={`
                                                p-1 border-l border-zinc-100 dark:border-zinc-800
                                                ${isCurrentHour ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}
                                                flex items-center
                                            `}
                                            style={{
                                                gridColumn: `span ${spanHours}`
                                            }}
                                        >
                                            <ShiftSlot
                                                shift={shift}
                                                storeName={storeMap.get(shift.store_id) || 'Unknown'}
                                                isMyShift={isMyShift}
                                                onClick={() => onSlotClick(shift)}
                                                showSpan
                                            />
                                        </div>
                                    )
                                }

                                // Check if this hour is WITHIN a shift (not start) - skip rendering
                                const shiftCoveringHour = dayShifts.find(s =>
                                    hour > s.start_hour && hour < s.end_hour
                                )
                                if (shiftCoveringHour) {
                                    return null // This cell is consumed by the spanning shift
                                }

                                // Empty cell
                                return (
                                    <div
                                        key={hour}
                                        className={`
                                            border-l border-zinc-100 dark:border-zinc-800
                                            ${isCurrentHour ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}
                                        `}
                                    />
                                )
                            })}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
