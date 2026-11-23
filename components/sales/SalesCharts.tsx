/**
 * @module components/sales/SalesCharts
 * @description Clean, executive-grade composed chart displaying actual sales, smart projected pace, and labor cost curves with pure visual elegance, subtle gradients, and zero UI clutter.
 * @businessRules
 * - Day rollover boundary is 6:00 AM PST/PDT (`America/Los_Angeles`), independent of user browser timezone.
 * - Displays `projectedToDate` vs `totalProjected` aligned with active period (`today`, `week`, `month`, `last_7`, `quarter`, or custom range containing today).
 * - Handles hourly, daily, and weekly (`quarter`) buckets accurately without counting future days in current week as elapsed.
 * - Dynamic tooltip with bilingual labels, proper signed USD formatting (`-$`), and null-safe Labor %.
 * @dataFlow
 * - Props (`trendData`, `period`, `groupByMode`, `projectedToDateOverride`, `isCurrentPeriodOverride`) -> ResponsiveContainer -> ComposedChart.
 * @notes
 * - RESPONSIVE (móvil/horizontal): `useViewportSize` detecta teléfono vertical (<640px) y horizontal bajo (alto <500px) => modo `isCompact`.
 * - [2026-11-23] FIX CRÍTICO: (1) `currentHourKey` y `projectedToDate` migrados a `getLANowParts()` (`America/Los_Angeles`); (2) Soporte correcto de buckets semanales (`groupByMode === 'week'`); (3) Formato monetario con signo `formatSignedUSD` (`-$150.50`, eje Y negativo `-$1.5k`); (4) Tooltip muestra `—` cuando `laborPercentage == null` y oculta `<Area>` con `tooltipType="none"`; (5) Etiqueta de pico precisa (`$450` cuando `< $1k` y `Semana Pico` en vista semanal); (6) Badge `%` muestra `—` cuando `baseProjected <= 0` y grid footer dinámico.
 */
'use client'

import React, { useMemo, useState, useEffect } from 'react'
import {
    ComposedChart,
    Bar,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { useLanguage } from '@/lib/i18n'
import { diffCalendarDays, formatSignedUSD, getLANowParts } from '@/lib/inventory/food-cost-sales-resolver'
import FitValue from './FitValue'
import {
    TrendingUp,
    ArrowUpRight,
    ArrowDownRight,
    Flame,
    Target,
    DollarSign,
    Zap,
} from 'lucide-react'

interface ChartsProps {
    trendData?: any[]
    period?: string
    groupByMode?: 'hour' | 'day' | 'week' | 'month' | 'year'
    projectedToDateOverride?: number | null
    isCurrentPeriodOverride?: boolean
}

// Helper to format hours in compact 12-hour am/pm format (e.g., 7am, 12pm, 1pm)
const formatHourAMPM = (timeStr?: string) => {
    if (!timeStr || typeof timeStr !== 'string') return ''
    const hourPart = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr
    const [hStr] = hourPart.split(':')
    const h = parseInt(hStr, 10)
    if (isNaN(h)) return timeStr
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}${ampm}`
}

// Custom Tooltip for Combined Chart
const CombinedTooltip = ({ active, payload, label, language, t }: any) => {
    if (active && payload && payload.length) {
        let formattedLabel = label
        const locale = language === 'es' ? es : enUS
        try {
            if (typeof label === 'string' && label.includes(' ')) {
                formattedLabel = `${t('sales.charts.hour')}: ${formatHourAMPM(label)}`
            } else if (typeof label === 'string') {
                const [year, month, day] = label.split('-').map(Number)
                const localDate = new Date(year, month - 1, day)
                const dateFormat = language === 'es' ? "EEEE dd 'de' MMMM" : 'EEEE, MMMM dd'
                formattedLabel = format(localDate, dateFormat, { locale })
            }
        } catch { }

        const actual = payload.find((p: any) => p.dataKey === 'amount')
        const projected = payload.find((p: any) => p.dataKey === 'projected')
        const labor = payload.find((p: any) => p.dataKey === 'laborCost')

        let varianceElement = null
        if (actual && projected && Number(projected.value) > 0) {
            const diff = Number(actual.value || 0) - Number(projected.value || 0)
            const percentDiff = (diff / Number(projected.value)) * 100
            const isPositive = Math.round(diff * 100) >= 0

            varianceElement = (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        {t('sales.variance_short')}
                    </span>
                    <div className={`flex items-center gap-1 font-mono font-bold text-xs ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        <span>{formatSignedUSD(diff, { decimals: 2, showPlus: true })}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${isPositive ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'}`}>
                            {isPositive ? '+' : ''}{percentDiff.toFixed(1)}%
                        </span>
                    </div>
                </div>
            )
        }

        const rawLaborPct = labor?.payload?.laborPercentage
        const hasValidLaborPct = rawLaborPct !== null && rawLaborPct !== undefined && Number.isFinite(Number(rawLaborPct))

        return (
            <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 p-3 sm:p-4 rounded-2xl shadow-xl backdrop-blur-2xl min-w-[200px] sm:min-w-[240px] max-w-[88vw]">
                <p className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-3 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {formattedLabel}
                </p>

                <div className="space-y-2.5">
                    {actual && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm shadow-sm"></span>
                                {t('sales.charts.actual')}
                            </span>
                            <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                                {formatSignedUSD(Number(actual.value || 0), { decimals: 2 })}
                            </span>
                        </div>
                    )}

                    {projected && Number(projected.value) > 0 && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full border border-indigo-300 shadow-sm"></span>
                                {t('sales.charts.projected')}
                            </span>
                            <span className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                                {formatSignedUSD(Number(projected.value || 0), { decimals: 2 })}
                            </span>
                        </div>
                    )}

                    {labor && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full border border-amber-300 shadow-sm"></span>
                                {t('sales.labor_label')}
                            </span>
                            <span className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400 flex items-center">
                                {formatSignedUSD(Number(labor.value || 0), { decimals: 0 })}
                                <span className="text-[10px] ml-1.5 opacity-90 font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                                    {hasValidLaborPct ? `${Number(rawLaborPct).toFixed(1)}%` : '—'}
                                </span>
                            </span>
                        </div>
                    )}
                </div>

                {varianceElement}
            </div>
        )
    }
    return null
}

function useViewportSize() {
    const [size, setSize] = useState({ w: 1024, h: 768 })
    useEffect(() => {
        const update = () => setSize({ w: window.innerWidth, h: window.innerHeight })
        update()
        window.addEventListener('resize', update)
        window.addEventListener('orientationchange', update)
        return () => {
            window.removeEventListener('resize', update)
            window.removeEventListener('orientationchange', update)
        }
    }, [])
    return size
}

export default function SalesCharts({
    trendData = [],
    period = 'today',
    groupByMode,
    projectedToDateOverride,
    isCurrentPeriodOverride,
}: ChartsProps) {
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    const { w: vw, h: vh } = useViewportSize()
    const isNarrow = vw < 640
    const isShortLandscape = vw > vh && vh < 500
    const isCompact = isNarrow || isShortLandscape
    const chartHeight = isShortLandscape
        ? Math.round(Math.min(340, Math.max(220, vh * 0.72)))
        : isNarrow ? 280 : vw >= 768 ? 370 : 340

    // Refresh LA clock every 60s so "● AHORA" marker never gets stale on open screens
    const [clockTick, setClockTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setClockTick((c) => c + 1), 60_000)
        return () => clearInterval(id)
    }, [])

    const hasProjections = trendData.some(d => d.projected && d.projected > 0)
    const hasLabor = trendData.some(d => d.laborCost && d.laborCost > 0)

    const peakHour = useMemo(() => {
        if (!trendData || trendData.length === 0) return null
        return trendData.reduce((max, d) => (d.amount > (max?.amount || 0) ? d : max), trendData[0])
    }, [trendData])

    const peakIsHourly = typeof peakHour?.time === 'string' && peakHour.time.includes(' ')
    const isWeeklyView = groupByMode === 'week' || (!peakIsHourly && period === 'quarter' && trendData.length > 0 && trendData.length <= 16)

    const peakLabel = useMemo(() => {
        const time = peakHour?.time
        if (typeof time !== 'string') return ''
        if (time.includes(' ')) return formatHourAMPM(time)
        try {
            const [year, month, day] = time.split('-').map(Number)
            return format(new Date(year, month - 1, day), 'EEE dd', { locale })
        } catch {
            return time
        }
    }, [peakHour, locale])

    const peakAmountFormatted = useMemo(() => {
        const amt = Number(peakHour?.amount || 0)
        if (amt >= 1000) return `$${(amt / 1000).toFixed(1)}k`
        return formatSignedUSD(amt, { decimals: 0 })
    }, [peakHour])

    const laNow = useMemo(() => getLANowParts(new Date()), [trendData, period, clockTick])

    // Current Hour Reference Line strictly in America/Los_Angeles
    const currentHourKey = useMemo(() => {
        if (!peakIsHourly) return null
        const match = trendData.find(d => d.time === laNow.hourKey)
        return match ? match.time : null
    }, [trendData, peakIsHourly, laNow.hourKey])

    const peakTitle = peakIsHourly
        ? t('sales.charts.peak_hour')
        : isWeeklyView
            ? t('sales.charts.peak_week')
            : t('sales.charts.peak_day')

    return (
        <div className="w-full mb-8 short:mb-4">
            {/* MAIN CARD CONTAINER */}
            <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl sm:rounded-3xl p-3 sm:p-6 md:p-8 short:p-3 backdrop-blur-xl shadow-sm">

                {/* HEADER SECTION: CLEAN TITLE & ELEGANT LEGEND */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6 short:mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shadow-sm shrink-0">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <div className="flex items-center flex-wrap gap-2">
                                <h3 className="text-lg md:text-xl text-slate-900 dark:text-white font-bold tracking-tight">
                                    {t('sales.charts.sales_trend')}
                                </h3>
                                {peakHour && peakHour.amount > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/40">
                                        <Flame size={12} className="text-amber-500 fill-amber-500" />
                                        <span>{peakTitle}: <strong>{peakLabel}</strong> ({peakAmountFormatted})</span>
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                {peakIsHourly ? t('sales.charts.subtitle_today') : t('sales.charts.subtitle_range')}
                            </p>
                        </div>
                    </div>

                    {/* MINIMALIST LEGEND */}
                    <div className="flex items-center flex-wrap gap-2 text-xs font-medium">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300">
                            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm shadow-sm"></span>
                            <span className="font-semibold">{t('sales.charts.actual')}</span>
                        </div>
                        {hasProjections && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/40 text-indigo-800 dark:text-indigo-300">
                                <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full border border-indigo-300 shadow-sm"></span>
                                <span className="font-semibold">{t('sales.charts.projected')}</span>
                            </div>
                        )}
                        {hasLabor && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 text-amber-800 dark:text-amber-300">
                                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full border border-amber-300 shadow-sm"></span>
                                <span className="font-semibold">{t('sales.labor_cost_legend')}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* CHART CANVAS */}
                <div className="w-full" style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            data={trendData}
                            margin={isCompact ? { top: 12, right: 8, left: 0, bottom: 0 } : { top: 15, right: 15, left: -15, bottom: 5 }}
                            barCategoryGap={isCompact ? '10%' : '20%'}
                        >
                            <defs>
                                <linearGradient id="salesBarGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                                    <stop offset="100%" stopColor="#059669" stopOpacity={0.75} />
                                </linearGradient>
                                <linearGradient id="salesAreaGlow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.00} />
                                </linearGradient>
                            </defs>

                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200/70 dark:text-slate-800/70" />

                            <XAxis
                                dataKey="time"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: 'currentColor', fontSize: isCompact ? 10 : 11, fontWeight: 500 }}
                                className="text-slate-500 dark:text-slate-400"
                                interval="preserveStartEnd"
                                minTickGap={isCompact ? 14 : 8}
                                tickMargin={6}
                                tickFormatter={(val) => {
                                    try {
                                        if (typeof val === 'string' && val.includes(' ')) {
                                            return formatHourAMPM(val)
                                        }
                                        const [year, month, day] = String(val).split('-').map(Number)
                                        const localDate = new Date(year, month - 1, day)
                                        return format(localDate, 'EEE dd', { locale })
                                    } catch {
                                        return val
                                    }
                                }}
                            />

                            {/* Primary Y Axis ($ Sales & Labor Cost) */}
                            <YAxis
                                yAxisId="left"
                                axisLine={false}
                                tickLine={false}
                                width={isCompact ? 42 : undefined}
                                tick={{ fill: 'currentColor', fontSize: isCompact ? 10 : 11, fontWeight: 600 }}
                                className="text-slate-400 font-mono"
                                tickFormatter={(val) => {
                                    const num = Number(val || 0)
                                    const sign = num < 0 ? '-' : ''
                                    const abs = Math.abs(num)
                                    if (abs < 1000) return `${sign}$${abs}`
                                    const k = abs / 1000
                                    return `${sign}$${Number.isInteger(k) ? k : k.toFixed(1)}k`
                                }}
                            />

                            <Tooltip
                                content={<CombinedTooltip language={language} t={t} />}
                                cursor={{ fill: 'rgba(15, 23, 42, 0.04)', radius: 8 }}
                                allowEscapeViewBox={{ x: false, y: false }}
                                wrapperStyle={{ outline: 'none', zIndex: 30 }}
                            />

                            {currentHourKey && (
                                <ReferenceLine
                                    x={currentHourKey}
                                    yAxisId="left"
                                    stroke="#10b981"
                                    strokeDasharray="3 3"
                                    strokeWidth={2}
                                    label={{
                                        value: `● ${t('sales.charts.now_marker')}`,
                                        position: 'insideTop',
                                        fill: '#10b981',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        className: 'font-mono',
                                    }}
                                />
                            )}

                            {/* Area Glow under actual curve (hidden from tooltip to avoid duplicate amount entry) */}
                            <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="amount"
                                fill="url(#salesAreaGlow)"
                                stroke="none"
                                tooltipType="none"
                            />

                            {/* Actual Sales Gradient Bars */}
                            <Bar
                                yAxisId="left"
                                dataKey="amount"
                                fill="url(#salesBarGradient)"
                                radius={isCompact ? [4, 4, 1, 1] : [6, 6, 2, 2]}
                                maxBarSize={isCompact ? 26 : 36}
                            />

                            {/* Projected Sales Spline LINE */}
                            {hasProjections && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="projected"
                                    stroke="#6366f1"
                                    strokeWidth={isCompact ? 2 : 2.5}
                                    strokeDasharray="4 4"
                                    dot={isCompact ? false : { fill: '#6366f1', strokeWidth: 1.5, r: 3 }}
                                    activeDot={{ r: 5.5, stroke: '#6366f1', strokeWidth: 2, fill: '#fff' }}
                                />
                            )}

                            {/* Labor Cost Spline LINE */}
                            {hasLabor && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="laborCost"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    dot={isCompact ? false : { fill: '#f59e0b', strokeWidth: 1.5, r: 2.5 }}
                                    activeDot={{ r: 5, stroke: '#f59e0b', strokeWidth: 2, fill: '#fff' }}
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* UNIFIED NEUTRAL STATS FOOTER CARDS */}
                {(() => {
                    const currentBizHour = laNow.hour < 6 ? laNow.hour + 24 : laNow.hour
                    const elapsedTodayFraction = Math.min(Math.max((currentBizHour - 6 + laNow.minuteRatio) / 24, 0), 1)

                    const totalActual = trendData.reduce((sum, d) => sum + Number(d.amount || 0), 0)
                    const totalProjected = hasProjections ? trendData.reduce((sum, d) => sum + Number(d.projected || 0), 0) : 0

                    const computedProjectedToDate = hasProjections
                        ? trendData.reduce((sum, d) => {
                            const projVal = Number(d.projected || 0)
                            if (typeof d.time === 'string' && d.time.includes(' ')) {
                                if (d.time < laNow.hourKey) return sum + projVal
                                if (d.time === laNow.hourKey) return sum + projVal * laNow.minuteRatio
                                return sum
                            }
                            if (typeof d.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.time)) {
                                if (isWeeklyView) {
                                    // Each bucket represents a 7-day ISO week starting at Monday `d.time`
                                    const daysSinceMonday = diffCalendarDays(d.time, laNow.businessDate)
                                    if (daysSinceMonday >= 7) return sum + projVal
                                    if (daysSinceMonday >= 0) {
                                        const weekFraction = Math.min((daysSinceMonday + elapsedTodayFraction) / 7, 1)
                                        return sum + projVal * weekFraction
                                    }
                                    return sum
                                }
                                if (d.time < laNow.businessDate) return sum + projVal
                                if (d.time === laNow.businessDate) return sum + projVal * elapsedTodayFraction
                            }
                            return sum
                        }, 0)
                        : 0

                    const projectedToDate =
                        typeof projectedToDateOverride === 'number' && Number.isFinite(projectedToDateOverride) && projectedToDateOverride > 0
                            ? projectedToDateOverride
                            : computedProjectedToDate

                    const isCurrentPeriod =
                        typeof isCurrentPeriodOverride === 'boolean'
                            ? isCurrentPeriodOverride
                            : ['today', 'week', 'month', 'last_7', 'quarter'].includes(period || '')

                    const baseProjected = isCurrentPeriod ? projectedToDate : totalProjected
                    const diff = totalActual - baseProjected
                    const hasBaseProjected = baseProjected > 0
                    const percentDiff = hasBaseProjected ? (diff / baseProjected) * 100 : 0
                    const isPositive = Math.round(diff * 100) >= 0

                    const visibleCardsCount =
                        1 + // Actual
                        (hasProjections && isCurrentPeriod ? 1 : 0) +
                        (hasProjections ? 2 : 0) // Projected + Variance

                    const footerGridCols =
                        visibleCardsCount === 1
                            ? 'grid-cols-1 max-w-xs mx-auto'
                            : visibleCardsCount === 3
                                ? 'grid-cols-2 sm:landscape:grid-cols-3 md:grid-cols-3'
                                : 'grid-cols-2 sm:landscape:grid-cols-4 md:grid-cols-4'

                    return (
                        <div className={`mt-4 sm:mt-6 short:mt-3 pt-4 sm:pt-5 short:pt-3 border-t border-slate-200/80 dark:border-slate-800 grid ${footerGridCols} gap-2.5 sm:gap-3.5 md:gap-4`}>
                            {hasProjections && isCurrentPeriod && (
                                <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 short:p-2 text-center min-w-0">
                                    <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                        <Target size={13} className="text-indigo-500 shrink-0" />
                                        <span>{t('sales.proj_to_date_label')}</span>
                                    </div>
                                    <FitValue
                                        text={formatSignedUSD(projectedToDate, { decimals: 2 })}
                                        maxPx={20}
                                        minPx={12}
                                        className="md:[--fit-max:24px] font-bold text-slate-900 dark:text-white font-mono tracking-tight"
                                    />
                                </div>
                            )}

                            <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 short:p-2 text-center min-w-0">
                                <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                    <DollarSign size={13} className="text-emerald-500 shrink-0" />
                                    <span>{t('sales.charts.actual')}</span>
                                </div>
                                <FitValue
                                    text={formatSignedUSD(totalActual, { decimals: 2 })}
                                    maxPx={20}
                                    minPx={12}
                                    className="md:[--fit-max:24px] font-bold text-emerald-600 dark:text-emerald-400 font-mono tracking-tight"
                                />
                            </div>

                            {hasProjections && (
                                <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 short:p-2 text-center min-w-0">
                                    <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                        <Zap size={13} className="text-slate-400 shrink-0" />
                                        <span>{t('sales.charts.projected')}</span>
                                    </div>
                                    <FitValue
                                        text={formatSignedUSD(totalProjected, { decimals: 2 })}
                                        maxPx={20}
                                        minPx={12}
                                        className="md:[--fit-max:24px] font-bold text-slate-800 dark:text-slate-200 font-mono tracking-tight"
                                    />
                                </div>
                            )}

                            {hasProjections && (
                                <div className={`rounded-xl sm:rounded-2xl p-3 sm:p-4 short:p-2 text-center border min-w-0 ${isPositive ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/40' : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-800/40'}`}>
                                    <p className={`text-[10px] sm:text-[11px] uppercase tracking-wider font-bold mb-1 leading-tight ${isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                        {t('sales.variance_label')}
                                    </p>
                                    <FitValue
                                        text={formatSignedUSD(diff, { decimals: 2, showPlus: true })}
                                        maxPx={20}
                                        minPx={12}
                                        className={`md:[--fit-max:24px] font-bold font-mono ${isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
                                    />
                                    <span className={`inline-block mt-1 text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${isPositive ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200'}`}>
                                        {hasBaseProjected ? `${isPositive ? '+' : ''}${percentDiff.toFixed(1)}%` : '—'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )
                })()}
            </div>
        </div>
    )
}
