'use client'

import { useMemo } from 'react'
import { useLanguage } from '@/lib/i18n'
import { format, parseISO, addDays } from 'date-fns'
import { es, enUS } from 'date-fns/locale'

interface HourlyDemand {
    hour: number
    required_kitchen: number
    required_foh: number
    projected_sales: number
}

interface DayData {
    date: string
    hours: HourlyDemand[]
    prepHour: number  // When prep starts (1 hour before opening)
    closeHour: number
}

interface DemandMapProps {
    weekStart: Date
    days: DayData[]
    storeName: string
}

// DemandMap shows GROSS demand (total staff needed including leadership)
// The shift generator subtracts leadership when calculating pool needs
// This keeps the visualization simple and consistent with intelligence model output

export function DemandMap({ weekStart, days, storeName }: DemandMapProps) {
    const { language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // Find global max for color scaling
    const maxKitchen = useMemo(() => {
        let max = 0
        for (const day of days) {
            for (const hour of day.hours) {
                if (hour.required_kitchen > max) max = hour.required_kitchen
            }
        }
        return max || 1
    }, [days])

    const maxFoh = useMemo(() => {
        let max = 0
        for (const day of days) {
            for (const hour of day.hours) {
                if (hour.required_foh > max) max = hour.required_foh
            }
        }
        return max || 1
    }, [days])

    // Get color intensity based on staffing needs
    const getKitchenColor = (count: number) => {
        const intensity = count / maxKitchen
        if (intensity >= 0.8) return 'bg-red-600 text-white'
        if (intensity >= 0.6) return 'bg-red-500 text-white'
        if (intensity >= 0.4) return 'bg-orange-500 text-white'
        if (intensity >= 0.2) return 'bg-orange-400 text-white'
        if (count > 0) return 'bg-orange-300 text-zinc-800'
        return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
    }

    const getFohColor = (count: number) => {
        const intensity = count / maxFoh
        if (intensity >= 0.8) return 'bg-pink-600 text-white'
        if (intensity >= 0.6) return 'bg-pink-500 text-white'
        if (intensity >= 0.4) return 'bg-rose-500 text-white'
        if (intensity >= 0.2) return 'bg-rose-400 text-white'
        if (count > 0) return 'bg-rose-300 text-zinc-800'
        return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
    }

    const formatHour = (hour: number) => {
        // Handle overnight hours (>= 24)
        const normalizedHour = hour >= 24 ? hour - 24 : hour
        if (normalizedHour === 0) return '12a'
        if (normalizedHour === 12) return '12p'
        if (normalizedHour > 12) return `${normalizedHour - 12}p`
        return `${normalizedHour}a`
    }


    // Generate hours for the grid based on store hours
    // Find the latest closing hour across all days (add 1 for wash crew)
    const latestClose = useMemo(() => {
        let maxClose = 21 // Default to 9pm
        for (const day of days) {
            // closeHour can be > 24 (e.g., 25 = 1AM next day)
            const closeWithWash = day.closeHour + 1
            if (closeWithWash > maxClose) maxClose = closeWithWash
        }
        return maxClose
    }, [days])

    // Generate all hours from prep to closing + wash
    // Use the earliest prepHour from all days
    const allHours = useMemo(() => {
        const hours = []
        // Find earliest prep hour
        const earliestPrep = days.length > 0
            ? Math.min(...days.map(d => d.prepHour))
            : 7  // Default to 7am if no data
        const end = Math.min(latestClose, 30) // Cap at 6AM next day
        for (let h = earliestPrep; h <= end; h++) {
            hours.push(h)
        }
        return hours
    }, [days, latestClose])

    // Generate all 7 days of the week
    // Synthesize overnight hours (24-30) by copying the last hour (23) data
    const weekDays = useMemo(() => {
        const result = []
        for (let i = 0; i < 7; i++) {
            const date = addDays(weekStart, i)
            const dateStr = format(date, 'yyyy-MM-dd')
            const dayData = days.find(d => d.date === dateStr)

            let hours = dayData?.hours || []

            // Synthesize overnight hours if store closes after midnight
            // closeHour = actual closing (e.g., 25 = 1AM)
            // closeHour + 1 = wash crew only (e.g., 26 = 2AM)
            const WASH_CREW_SIZE = 3

            if (dayData && dayData.closeHour >= 24) {
                // Find the last hour data (hour 23 or the last available)
                const lastHourData = hours.find(h => h.hour === 23) ||
                    hours[hours.length - 1]

                if (lastHourData) {
                    // Add hours from 24 to closeHour (still taking orders)
                    // and closeHour+1 (wash crew only)
                    const washHour = dayData.closeHour + 1

                    for (let h = 24; h <= washHour; h++) {
                        // Check if this hour doesn't already exist
                        if (!hours.find(existing => existing.hour === h)) {
                            const isWashOnly = h > dayData.closeHour

                            hours = [...hours, {
                                hour: h,
                                // Wash hour: only kitchen crew needed, no FOH
                                // Before close: reduced demand (late night)
                                required_kitchen: isWashOnly
                                    ? WASH_CREW_SIZE
                                    : Math.max(2, Math.ceil(lastHourData.required_kitchen * 0.6)),
                                required_foh: isWashOnly
                                    ? 0
                                    : Math.max(1, Math.ceil(lastHourData.required_foh * 0.5)),
                                projected_sales: isWashOnly
                                    ? 0
                                    : lastHourData.projected_sales * 0.4
                            }]
                        }
                    }
                }
            }

            result.push({
                date,
                dateStr,
                dayName: format(date, 'EEE', { locale }),
                dayNum: format(date, 'd'),
                hours
            })
        }
        return result
    }, [weekStart, days, locale])

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">
                            🗺️ {language === 'es' ? 'Mapa de Demanda' : 'Demand Map'}
                        </h2>
                        <p className="text-indigo-200 text-sm mt-1">
                            📍 {storeName} • {format(weekStart, 'd MMM', { locale })} - {format(addDays(weekStart, 6), 'd MMM', { locale })}
                        </p>
                    </div>
                    <div className="flex gap-4 text-sm text-white">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-orange-500"></div>
                            <span>🍳 {language === 'es' ? 'Cocina' : 'Kitchen'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-pink-500"></div>
                            <span>💵 {language === 'es' ? 'Cajeros' : 'Cashiers'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Kitchen Demand Grid */}
            <div className="p-4">
                <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                    🍳 {language === 'es' ? 'COCINEROS REQUERIDOS' : 'KITCHEN STAFF REQUIRED'}
                </h3>
                <div className="overflow-x-auto">
                    <div className="min-w-[700px]">
                        {/* Hour headers */}
                        <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `80px repeat(${allHours.length}, 1fr)` }}>
                            <div className="text-xs text-zinc-400 font-medium"></div>
                            {allHours.map(hour => (
                                <div key={hour} className="text-xs text-zinc-500 text-center font-medium">
                                    {formatHour(hour)}
                                </div>
                            ))}
                        </div>

                        {/* Day rows - Kitchen */}
                        {weekDays.map(day => (
                            <div key={day.dateStr} className="grid gap-1 mb-1" style={{ gridTemplateColumns: `80px repeat(${allHours.length}, 1fr)` }}>
                                <div className="text-xs font-bold text-zinc-600 dark:text-zinc-400 flex items-center">
                                    <span className="capitalize">{day.dayName}</span>
                                    <span className="text-zinc-400 ml-1">{day.dayNum}</span>
                                </div>
                                {allHours.map(hour => {
                                    const hourData = day.hours.find(h => h.hour === hour)
                                    const count = hourData?.required_kitchen || 0
                                    return (
                                        <div
                                            key={hour}
                                            className={`h-8 rounded-md flex items-center justify-center text-xs font-bold transition-all ${getKitchenColor(count)}`}
                                            title={`${day.dayName} ${formatHour(hour)}: ${count} cocineros (total)`}
                                        >
                                            {count > 0 ? count : ''}
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Divider */}
            <div className="border-t border-zinc-200 dark:border-zinc-800"></div>

            {/* Cashier Demand Grid */}
            <div className="p-4">
                <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                    💵 {language === 'es' ? 'CAJEROS REQUERIDOS' : 'CASHIERS REQUIRED'}
                </h3>
                <div className="overflow-x-auto">
                    <div className="min-w-[700px]">
                        {/* Hour headers */}
                        <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `80px repeat(${allHours.length}, 1fr)` }}>
                            <div className="text-xs text-zinc-400 font-medium"></div>
                            {allHours.map(hour => (
                                <div key={hour} className="text-xs text-zinc-500 text-center font-medium">
                                    {formatHour(hour)}
                                </div>
                            ))}
                        </div>

                        {/* Day rows - Cashiers */}
                        {weekDays.map(day => (
                            <div key={day.dateStr} className="grid gap-1 mb-1" style={{ gridTemplateColumns: `80px repeat(${allHours.length}, 1fr)` }}>
                                <div className="text-xs font-bold text-zinc-600 dark:text-zinc-400 flex items-center">
                                    <span className="capitalize">{day.dayName}</span>
                                    <span className="text-zinc-400 ml-1">{day.dayNum}</span>
                                </div>
                                {allHours.map(hour => {
                                    const hourData = day.hours.find(h => h.hour === hour)
                                    const count = hourData?.required_foh || 0
                                    return (
                                        <div
                                            key={hour}
                                            className={`h-8 rounded-md flex items-center justify-center text-xs font-bold transition-all ${getFohColor(count)}`}
                                            title={`${day.dayName} ${formatHour(hour)}: ${count} cajeros (total)`}
                                        >
                                            {count > 0 ? count : ''}
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Summary Footer */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800 px-6 py-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-6 text-sm">
                        <div>
                            <span className="text-zinc-500">{language === 'es' ? 'Max Cocineros/hora:' : 'Max Kitchen/hour:'}</span>
                            <span className="font-bold text-orange-600 ml-2">{maxKitchen}</span>
                        </div>
                        <div>
                            <span className="text-zinc-500">{language === 'es' ? 'Max Cajeros/hora:' : 'Max Cashiers/hour:'}</span>
                            <span className="font-bold text-pink-600 ml-2">{maxFoh}</span>
                        </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400">
                            {language === 'es' ? 'Bajo' : 'Low'}
                        </span>
                        <span className="px-2 py-1 rounded bg-orange-300 text-zinc-800">
                            ↑
                        </span>
                        <span className="px-2 py-1 rounded bg-orange-500 text-white">
                            ↑↑
                        </span>
                        <span className="px-2 py-1 rounded bg-red-600 text-white">
                            🔥 {language === 'es' ? 'RUSH' : 'RUSH'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}
