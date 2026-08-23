/**
 * @module components/sales/DateRangeFilter
 * @description Date Range and Presets Picker for the Sales Dashboard, supporting full-screen mobile view, dual-month desktop calendar, and preset shortcuts.
 * @businessRules
 * - 6:00 AM rule shifts the base "Today" calculation to the previous calendar day when local hour is before 6:00 AM.
 * - Supports presets: Today, Yesterday, This Week, Last Week, Last 7 Days, This Month, Last Month, Quarter, Custom.
 * - Dynamic bilingual locale formatting (ES/EN) for day headers and months.
 * @dataFlow
 * - Props (period, startDate, endDate, onChange) -> Local State / Date Picker -> onChange(period, startStr, endStr).
 */
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, subDays, addDays, subWeeks, startOfYear } from 'date-fns'
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
    const localeObj = language === 'es' ? es : enUS
    const [isOpen, setIsOpen] = useState(false)
    const [viewDate, setViewDate] = useState(new Date())
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
            const target = event.target as HTMLElement
            if (target.closest?.('[data-date-filter-portal]')) return
            if (containerRef.current && !containerRef.current.contains(target)) {
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
        // 🕐 BUSINESS DAY ADJUSTMENT: 6:00 AM Rule
        if (today.getHours() < 6) {
            today.setDate(today.getDate() - 1)
        }

        let s = today
        let e = today

        if (p === 'today') {
            s = today
            e = today
        } else if (p === 'yesterday') {
            s = subDays(today, 1)
            e = subDays(today, 1)
        } else if (p === 'week') {
            s = startOfWeek(today, { weekStartsOn: 1 })
            e = today
        } else if (p === 'last_week') {
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
        } else if (p === 'quarter') {
            const currentMonth = today.getMonth()
            const startMonth = Math.floor(currentMonth / 3) * 3
            s = new Date(today.getFullYear(), startMonth, 1)
            e = today
        }

        setTempStart(s)
        setTempEnd(e)

        onChange(p, formatDateISO(s), formatDateISO(e))
        setIsOpen(false)
    }

    const handleApply = () => {
        if (tempStart && tempEnd) {
            onChange('custom', formatDateISO(tempStart), formatDateISO(tempEnd))
            setIsOpen(false)
        }
    }

    const handleDateClick = (day: Date) => {
        if (!tempStart || (tempStart && tempEnd)) {
            setTempStart(day)
            setTempEnd(null)
        } else if (tempStart && !tempEnd) {
            if (isBefore(day, tempStart)) {
                setTempStart(day)
                setTempEnd(null)
            } else {
                setTempEnd(day)
            }
        }
    }

    function isBefore(date1: Date, date2: Date) {
        return date1.getTime() < date2.getTime()
    }

    // Days of week array localized
    const weekDays = Array.from({ length: 7 }).map((_, i) => {
        const d = addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), i)
        return format(d, 'cccccc', { locale: localeObj })
    })

    const renderMonth = (monthDate: Date) => {
        const monthStart = startOfMonth(monthDate)
        const monthEnd = endOfMonth(monthStart)
        const startDateGrid = startOfWeek(monthStart, { weekStartsOn: 0 })
        const endDateGrid = endOfWeek(monthEnd, { weekStartsOn: 0 })

        const days = eachDayOfInterval({ start: startDateGrid, end: endDateGrid })

        return (
            <div className="grid grid-cols-7 gap-1">
                {days.map((day, idx) => {
                    const isCurrentMonth = isSameMonth(day, monthDate)
                    const isStart = tempStart && isSameDay(day, tempStart)
                    const isEnd = tempEnd && isSameDay(day, tempEnd)
                    const isInRange = tempStart && tempEnd && isWithinInterval(day, { start: tempStart, end: tempEnd })
                    const isHovered = tempStart && !tempEnd && hoverDate && isWithinInterval(day, {
                        start: tempStart < hoverDate ? tempStart : hoverDate,
                        end: tempStart < hoverDate ? hoverDate : tempStart
                    })

                    return (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => handleDateClick(day)}
                            onMouseEnter={() => setHoverDate(day)}
                            className={`h-9 w-full rounded-md text-xs font-semibold flex items-center justify-center transition-all ${!isCurrentMonth ? 'opacity-20 text-slate-400 pointer-events-none' : ''
                                } ${isStart || isEnd
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold z-10 shadow-sm'
                                    : isInRange || isHovered
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-none'
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                        >
                            {format(day, 'd')}
                        </button>
                    )
                })}
            </div>
        )
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
            'last_month': t('sales.last_month'),
            'quarter': t('sales.quarter')
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

            {/* Dropdown Content */}
            {isOpen && (
                <>
                    {/* Mobile Portal */}
                    {typeof document !== 'undefined' && createPortal(
                        <div data-date-filter-portal className="md:hidden fixed inset-0 z-[9999] bg-white dark:bg-slate-900 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}>
                            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    <CalendarIcon size={20} className="text-slate-500" />
                                    {t('sales.select_dates')}
                                </h2>
                                <button onClick={() => setIsOpen(false)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                                <div className="grid grid-cols-4 gap-2 mb-4">
                                    {[
                                        { id: 'today', label: t('sales.today') },
                                        { id: 'yesterday', label: t('sales.yesterday') },
                                        { id: 'week', label: t('sales.this_week') },
                                        { id: 'last_week', label: t('sales.last_week') },
                                        { id: 'last_7', label: t('sales.last_7') },
                                        { id: 'month', label: t('sales.current_month') },
                                        { id: 'last_month', label: t('sales.last_month') },
                                        { id: 'quarter', label: t('sales.quarter') },
                                        { id: 'custom', label: t('sales.custom_date') },
                                    ].map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                if (item.id !== 'custom') {
                                                    handlePreset(item.id as Period)
                                                }
                                            }}
                                            className={`px-2 py-2.5 rounded-xl text-[11px] font-bold transition-all text-center leading-tight ${period === item.id
                                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-md'
                                                : 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:bg-slate-200'
                                                }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="mb-3">
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full active:scale-90 transition-transform">
                                            <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
                                        </button>
                                        <span className="font-black text-base capitalize text-slate-900 dark:text-white">{format(viewDate, 'MMMM yyyy', { locale: localeObj })}</span>
                                        <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full active:scale-90 transition-transform">
                                            <ChevronRight size={20} className="text-slate-600 dark:text-slate-400" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-7 mb-1 text-center text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                                        {weekDays.map((d, i) => <div key={i} className="capitalize">{d}</div>)}
                                    </div>
                                    {renderMonth(viewDate)}
                                </div>

                                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                    <div className="flex flex-col gap-1.5 flex-1">
                                        <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest">{t('sales.start_date')}</label>
                                        <input type="date" value={tempStart ? formatDateISO(tempStart) : ''} onChange={(e) => setTempStart(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-slate-50 dark:bg-slate-800 w-full font-semibold" />
                                    </div>
                                    <div className="flex flex-col gap-1.5 flex-1">
                                        <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest">{t('sales.end_date')}</label>
                                        <input type="date" value={tempEnd ? formatDateISO(tempEnd) : ''} onChange={(e) => setTempEnd(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-slate-50 dark:bg-slate-800 w-full font-semibold" />
                                    </div>
                                </div>
                            </div>

                            <div className="shrink-0 flex gap-3 px-4 py-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <button onClick={() => setIsOpen(false)} className="flex-1 px-4 py-3.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:scale-95 transition-transform">
                                    {t('sales.cancel')}
                                </button>
                                <button onClick={handleApply} className="flex-1 px-4 py-3.5 rounded-xl text-sm font-bold bg-slate-900 dark:bg-blue-600 text-white active:scale-95 transition-transform shadow-lg">
                                    {t('sales.apply')}
                                </button>
                            </div>
                        </div>,
                        document.body
                    )}

                    {/* Desktop Dropdown */}
                    <div className="hidden md:flex absolute top-full right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                        <div className="w-40 border-r border-slate-100 dark:border-slate-800 p-2 flex flex-col gap-1 bg-slate-50/50 dark:bg-slate-900/50">
                            {[
                                { id: 'today', label: t('sales.today') },
                                { id: 'yesterday', label: t('sales.yesterday') },
                                { id: 'week', label: t('sales.this_week') },
                                { id: 'last_week', label: t('sales.last_week') },
                                { id: 'last_7', label: t('sales.last_7') },
                                { id: 'month', label: t('sales.current_month') },
                                { id: 'last_month', label: t('sales.last_month') },
                                { id: 'quarter', label: t('sales.quarter') },
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
                                onClick={() => {}}
                                className={`text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${period === 'custom'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                            >
                                {t('sales.custom_date')}
                            </button>
                        </div>
                        
                        <div className="p-4 flex flex-col gap-4">
                            <div className="flex gap-4 sm:gap-8">
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-2">
                                        <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><ChevronLeft size={16} /></button>
                                        <span className="font-semibold text-sm capitalize">{format(viewDate, 'MMMM yyyy', { locale: localeObj })}</span>
                                        <div className="w-6"></div>
                                    </div>
                                    <div className="grid grid-cols-7 mb-1 text-center text-xs text-slate-400 font-medium">
                                        {weekDays.map((d, i) => <div key={i} className="capitalize">{d}</div>)}
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
                                        {weekDays.map((d, i) => <div key={i} className="capitalize">{d}</div>)}
                                    </div>
                                    {renderMonth(addMonths(viewDate, 1))}
                                </div>
                            </div>
                            <div className="flex flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.start_date')}</label>
                                        <input type="date" value={tempStart ? formatDateISO(tempStart) : ''} onChange={(e) => setTempStart(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] uppercase font-bold text-slate-400">{t('sales.end_date')}</label>
                                        <input type="date" value={tempEnd ? formatDateISO(tempEnd) : ''} onChange={(e) => setTempEnd(parseDate(e.target.value))} className="border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800" />
                                    </div>
                                </div>
                                <div className="flex gap-2 self-end">
                                    <button onClick={() => setIsOpen(false)} className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">{t('sales.cancel')}</button>
                                    <button onClick={handleApply} className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm">{t('sales.apply')}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
