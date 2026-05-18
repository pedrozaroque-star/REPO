import React, { useState, useEffect, useRef } from 'react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, subDays, addDays, startOfWeek as startOfWeekFns, endOfWeek as endOfWeekFns, startOfMonth as startOfMonthFns, endOfMonth as endOfMonthFns, subWeeks, subMonths as subMonthsFns, startOfYear, isAfter, isBefore } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

type Period = 'today' | 'yesterday' | 'week' | 'last_week' | 'last_7' | 'month' | 'last_month' | 'quarter' | 'custom'

interface DateRangeFilterProps {
    period: string
    startDate: string
    endDate: string
    onChange: (period: Period | string, start: string, end: string) => void
    className?: string
}

export default function DateRangeFilter({ period, startDate, endDate, onChange, className }: DateRangeFilterProps) {
    const { t, language } = useLanguage()
    const localeObj = language === 'es' ? es : enUS // Locale for date-fns
    const [isOpen, setIsOpen] = useState(false)
    const [viewDate, setViewDate] = useState(new Date()) // Controls the left calendar month
    const [tempStart, setTempStart] = useState<Date | null>(null)
    const [tempEnd, setTempEnd] = useState<Date | null>(null)
    const [hoverDate, setHoverDate] = useState<Date | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Sync external state to internal temp state when opening or when props change
    useEffect(() => {
        if (startDate) setTempStart(parseDate(startDate))
        if (endDate) setTempEnd(parseDate(endDate))
    }, [startDate, endDate])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [containerRef])

    const parseDate = (str: string) => {
        if (!str) return null
        const [y, m, d] = str.split('-').map(Number)
        return new Date(y, m - 1, d)
    }

    const formatDateISO = (d: Date) => {
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const handlePreset = (p: Period) => {
        const today = new Date()
        // Business logic adjustment: if hour < 6, today is technically yesterday in business terms, 
        // BUT for the calendar utility usually we want literal dates. 
        // However, the parent component handles the "business day" logic offset for defaults.
        // We will stick to standard date-fns logic here and let parent handle specific fetch offsets if needed,
        // OR we replicate the logic if we want exact match. 
        // Given the instructions said "don't remove existing filters", I should try to match their behavior.
        // The parent determines defaults. Here we just set standard ranges.

        // Let's use standard calendar days for the UI interaction.
        let s = today
        let e = today

        if (p === 'today') {
            s = today
            e = today
        } else if (p === 'yesterday') {
            s = subDays(today, 1)
            e = subDays(today, 1)
        } else if (p === 'week') {
            // This week: Monday to Today
            s = startOfWeek(today, { weekStartsOn: 1 })
            e = today
        } else if (p === 'last_week') {
            // Last week: Previous Monday to Previous Sunday
            const lastWeek = subWeeks(today, 1)
            s = startOfWeek(lastWeek, { weekStartsOn: 1 })
            e = endOfWeek(lastWeek, { weekStartsOn: 1 })
        } else if (p === 'last_7') {
            s = subDays(today, 6)
            e = today
        } else if (p === 'month') {
            s = startOfMonth(today)
            e = today
        } else if (p === 'last_month') {
            const lastMonth = subMonths(today, 1)
            s = startOfMonth(lastMonth)
            e = endOfMonth(lastMonth)
        }

        setTempStart(s)
        setTempEnd(e)

        // Logic for parent compatibility:
        // We ALWAYS send the preset name (e.g. 'last_week') back to the parent.
        // It is the parent's responsibility to handle the 'custom' logic on its side if it doesn't recognize the token,
        // OR we simply trust that we are sending valid start/end dates anyway.
        // By sending 'p', the UI will correctly display "Last Week" instead of "Custom".

        onChange(p, formatDateISO(s), formatDateISO(e))
        setIsOpen(false)
    }

    const handleApply = () => {
        if (tempStart && tempEnd) {
            // Determine if it matches a preset? No, just send 'custom' if manual.
            let pStr = 'custom'
            // If explicit logic matches a preset we could send it, but 'custom' is safer for general range.
            onChange('custom', formatDateISO(tempStart), formatDateISO(tempEnd))
            setIsOpen(false)
        }
    }

    const selectDate = (day: Date) => {
        if (!tempStart || (tempStart && tempEnd)) {
            setTempStart(day)
            setTempEnd(null)
        } else if (tempStart && !tempEnd) {
            if (isBefore(day, tempStart)) {
                setTempStart(day)
                setTempEnd(tempStart)
            } else {
                setTempEnd(day)
            }
        }
    }

    const getDayClass = (day: Date, monthDate: Date) => {
        const isSelected = (tempStart && isSameDay(day, tempStart)) || (tempEnd && isSameDay(day, tempEnd))
        const isInRange = tempStart && tempEnd && isWithinInterval(day, { start: tempStart, end: tempEnd })
        const isCurrentMonth = isSameMonth(day, monthDate)

        let classes = "w-8 h-8 flex items-center justify-center text-xs rounded-full cursor-pointer transition-all relative z-10 "

        if (isSelected) {
            classes += "bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold "
        } else if (isInRange) {
            classes += "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white first:rounded-l-full last:rounded-r-full rounded-none "
        } else {
            classes += "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 "
        }

        if (!isCurrentMonth) {
            classes += "opacity-30 "
        }

        return classes
    }

    const renderMonth = (mDate: Date) => {
        const monthStart = startOfMonth(mDate)
        const monthEnd = endOfMonth(mDate)
        const startDate = startOfWeek(monthStart)
        const endDate = endOfWeek(monthEnd)

        const dateFormat = "d"
        const rows = []
        let days = []
        let day = startDate
        let formattedDate = ""

        while (day <= endDate) {
            for (let i = 0; i < 7; i++) {
                formattedDate = format(day, dateFormat)
                const cloneDay = day
                days.push(
                    <div
                        key={day.toISOString()}
                        className={`p-1 relative aspect-square flex items-center justify-center ${tempStart && tempEnd && isWithinInterval(cloneDay, { start: tempStart, end: tempEnd }) && !isSameDay(cloneDay, tempStart) && !isSameDay(cloneDay, tempEnd)
                            ? 'bg-slate-50 dark:bg-slate-800/50'
                            : ''
                            } ${tempStart && isSameDay(cloneDay, tempStart) && tempEnd ? 'bg-gradient-to-r from-transparent to-slate-50 dark:to-slate-800/50 rounded-l-full' : ''
                            } ${tempEnd && isSameDay(cloneDay, tempEnd) && tempStart ? 'bg-gradient-to-l from-transparent to-slate-50 dark:to-slate-800/50 rounded-r-full' : ''
                            }`}
                        onClick={() => selectDate(cloneDay)}
                        onMouseEnter={() => setHoverDate(cloneDay)}
                    >
                        <div className={getDayClass(cloneDay, mDate)}>
                            {formattedDate}
                        </div>
                    </div>
                )
                day = addDays(day, 1)
            }
            rows.push(
                <div className="grid grid-cols-7 mb-1" key={day.toISOString()}>
                    {days}
                </div>
            )
            days = []
        }
        return <div className="p-2">{rows}</div>
    }

    // Header label logic
    const getButtonLabel = () => {
        if (!tempStart || !tempEnd) return t('sales.select_dates')

        const startStr = format(tempStart, 'MMM d, yyyy', { locale: localeObj })
        const endStr = format(tempEnd, 'MMM d, yyyy', { locale: localeObj })

        const periodLabels: Record<string, string> = {
            'today': t('sales.today'),
            'yesterday': t('sales.yesterday'),
            'week': t('sales.this_week'),
            'last_week': t('sales.last_week'),
            'last_7': t('sales.last_7'),
            'month': t('sales.current_month'),
            'last_month': t('sales.last_month')
        }

        const pLabel = periodLabels[period] || t('sales.custom_date')
        return (
            <div className="flex flex-col items-start leading-tight">
                <span className="font-semibold text-sm">{pLabel}</span>
                <span className="text-[10px] opacity-70 font-normal">{startStr} - {endStr}</span>
            </div>
        )
    }

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
                <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-md">
                    <CalendarIcon size={16} className="text-slate-600 dark:text-slate-400" />
                </div>
                {getButtonLabel()}
                <ChevronDown size={16} className={`ml-2 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Content — fullscreen overlay on mobile, absolute dropdown on desktop */}
            {isOpen && (
                <>
                    {/* Mobile: fixed fullscreen overlay with scroll */}
                    <div className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
                    <div className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200">
                        {/* Drag handle */}
                        <div className="flex justify-center py-2 shrink-0">
                            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
                            {/* Presets grid on mobile */}
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                {[
                                    { id: 'today', label: t('sales.today') },
                                    { id: 'yesterday', label: t('sales.yesterday') },
                                    { id: 'week', label: t('sales.this_week') },
                                    { id: 'last_week', label: t('sales.last_week') },
                                    { id: 'last_7', label: t('sales.last_7') },
                                    { id: 'month', label: t('sales.current_month') },
                                    { id: 'last_month', label: t('sales.last_month') },
                                    { id: 'custom', label: t('sales.custom_date') },
                                ].map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => item.id !== 'custom' ? handlePreset(item.id as Period) : null}
                                        className={`text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${period === item.id
                                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                            : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100'
                                            }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            {/* Calendar */}
                            <div>
                                <div className="flex items-center justify-between mb-2 px-2">
                                    <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                                        <ChevronLeft size={18} />
                                    </button>
                                    <span className="font-semibold text-sm capitalize">{format(viewDate, 'MMMM yyyy', { locale: localeObj })}</span>
                                    <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-7 mb-1 text-center text-xs text-slate-400 font-medium">
                                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
                                </div>
                                {renderMonth(viewDate)}
                            </div>
                            {/* Date inputs */}
                            <div className="flex items-center gap-2 mt-4">
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.start_date')}</label>
                                    <input type="date" value={tempStart ? formatDateISO(tempStart) : ''} onChange={(e) => setTempStart(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-2 text-sm bg-transparent w-full" />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.end_date')}</label>
                                    <input type="date" value={tempEnd ? formatDateISO(tempEnd) : ''} onChange={(e) => setTempEnd(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-2 text-sm bg-transparent w-full" />
                                </div>
                            </div>
                            {/* Action buttons */}
                            <div className="flex gap-3 mt-4">
                                <button onClick={() => setIsOpen(false)} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 transition-colors">
                                    {t('sales.cancel')}
                                </button>
                                <button onClick={handleApply} className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 transition-opacity">
                                    {t('sales.apply')}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Desktop: original absolute dropdown */}
                    <div className="hidden md:flex absolute top-full right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                        {/* Sidebar Presets */}
                        <div className="w-40 border-r border-slate-100 dark:border-slate-800 p-2 flex flex-col gap-1 bg-slate-50/50 dark:bg-slate-900/50">
                            {[
                                { id: 'today', label: t('sales.today') },
                                { id: 'yesterday', label: t('sales.yesterday') },
                                { id: 'week', label: t('sales.this_week') },
                                { id: 'last_week', label: t('sales.last_week') },
                                { id: 'last_7', label: t('sales.last_7') },
                                { id: 'month', label: t('sales.current_month') },
                                { id: 'last_month', label: t('sales.last_month') },
                            ].map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => handlePreset(item.id as Period)}
                                    className={`text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${period === item.id
                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                            <button
                                className={`text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${period === 'custom'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                            >
                                {t('sales.custom_date')}
                            </button>
                        </div>
                        {/* Calendar Area */}
                        <div className="p-4 flex flex-col gap-4">
                            <div className="flex gap-4 sm:gap-8">
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-2">
                                        <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><ChevronLeft size={16} /></button>
                                        <span className="font-semibold text-sm capitalize">{format(viewDate, 'MMMM yyyy', { locale: localeObj })}</span>
                                        <div className="w-6"></div>
                                    </div>
                                    <div className="grid grid-cols-7 mb-1 text-center text-xs text-slate-400 font-medium">
                                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
                                    </div>
                                    {renderMonth(viewDate)}
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-2">
                                        <div className="w-6"></div>
                                        <span className="font-semibold text-sm capitalize">{format(addMonths(viewDate, 1), 'MMMM yyyy', { locale: localeObj })}</span>
                                        <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><ChevronRight size={16} /></button>
                                    </div>
                                    <div className="grid grid-cols-7 mb-1 text-center text-xs text-slate-400 font-medium">
                                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
                                    </div>
                                    {renderMonth(addMonths(viewDate, 1))}
                                </div>
                            </div>
                            <div className="flex flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.start_date')}</label>
                                        <input type="date" value={tempStart ? formatDateISO(tempStart) : ''} onChange={(e) => setTempStart(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-sm bg-transparent w-32" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.end_date')}</label>
                                        <input type="date" value={tempEnd ? formatDateISO(tempEnd) : ''} onChange={(e) => setTempEnd(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-sm bg-transparent w-32" />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setIsOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">{t('sales.cancel')}</button>
                                    <button onClick={handleApply} className="px-6 py-2 rounded-lg text-sm font-bold bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 transition-opacity">{t('sales.apply')}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
