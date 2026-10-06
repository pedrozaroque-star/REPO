/**
 * @module components/sales/SalesCharts
 * @description Clean, executive-grade composed chart displaying actual sales, smart projected pace, and labor cost curves with pure visual elegance, subtle gradients, and zero UI clutter.
 * @businessRules
 * - Day rollover boundary is 6:00 AM PST/PDT.
 * - Displays projectedToDate vs totalProjected based on active period filter.
 * - Dynamic tooltip with bilingual labels and variance percentage.
 * @dataFlow
 * - Props (trendData, period) -> ResponsiveContainer -> ComposedChart.
 * @notes
 * - RESPONSIVE (móvil/horizontal): `useViewportSize` detecta teléfono vertical (<640px) y horizontal bajo (alto <500px) => modo `isCompact`:
 *   eje Y de 38px, etiquetas del eje X con `minTickGap` (se omiten en vez de encimarse), sin puntos fijos en líneas, barras más finas y alto dinámico.
 * - Los montos de las tarjetas inferiores usan `FitValue` (autoajuste por container query) y el badge de % va en su propia línea.
 * - El formateo del eje Y ya no redondea miles (1500 => "$1.5k", antes "$2k").
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
import FitValue from './FitValue'
import { 
    TrendingUp, 
    ArrowUpRight, 
    ArrowDownRight, 
    Flame, 
    Target,
    DollarSign,
    Zap,
    Gauge
} from 'lucide-react'

interface ChartsProps {
    trendData?: any[]
    period?: string
}

// Helper to format hours in compact 12-hour am/pm format (e.g., 7am, 12pm, 1pm)
const formatHourAMPM = (timeStr?: string) => {
    if (!timeStr || typeof timeStr !== 'string') return ''
    const hourPart = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr
    const [hStr] = hourPart.split(':')
    const h = parseInt(hStr, 10)
    if (isNaN(h)) return timeStr
    const period = h >= 12 ? 'pm' : 'am'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}${period}`
}

// Custom Tooltip for Combined Chart
const CombinedTooltip = ({ active, payload, label, language, t }: any) => {
    if (active && payload && payload.length) {
        let formattedLabel = label
        const locale = language === 'es' ? es : enUS
        try {
            if (label.includes(' ')) {
                formattedLabel = `${t('sales.charts.hour')}: ${formatHourAMPM(label)}`
            } else {
                const [year, month, day] = label.split('-').map(Number)
                const localDate = new Date(year, month - 1, day)
                const dateFormat = language === 'es' ? "EEEE dd 'de' MMMM" : "EEEE, MMMM dd"
                formattedLabel = format(localDate, dateFormat, { locale })
            }
        } catch (e) { }

        const actual = payload.find((p: any) => p.dataKey === 'amount')
        const projected = payload.find((p: any) => p.dataKey === 'projected')
        const labor = payload.find((p: any) => p.dataKey === 'laborCost')

        let varianceElement = null
        if (actual && projected && projected.value > 0) {
            const diff = actual.value - projected.value
            const percentDiff = (diff / projected.value) * 100
            const isPositive = diff >= 0

            varianceElement = (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        {t('sales.variance_short')}
                    </span>
                    <div className={`flex items-center gap-1 font-mono font-bold text-xs ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        <span>
                            {isPositive ? '+' : ''}${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${isPositive ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'}`}>
                            {isPositive ? '+' : ''}{percentDiff.toFixed(1)}%
                        </span>
                    </div>
                </div>
            )
        }

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
                                ${actual.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}

                    {projected && projected.value > 0 && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full border border-indigo-300 shadow-sm"></span>
                                {t('sales.charts.projected')}
                            </span>
                            <span className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                                ${projected.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                ${Number(labor.value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                <span className="text-[10px] ml-1.5 opacity-90 font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                                    {Number(labor.payload?.laborPercentage || 0).toFixed(1)}%
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

// Tamaño real de la ventana. Se actualiza en resize y al rotar el teléfono (vertical <-> horizontal).
// Valor inicial de escritorio para SSR; se corrige en el primer efecto del cliente.
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

export default function SalesCharts({ trendData = [], period = 'today' }: ChartsProps) {
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // Responsive: teléfono vertical (<640px) o teléfono horizontal (ancho > alto y alto < 500px)
    const { w: vw, h: vh } = useViewportSize()
    const isNarrow = vw < 640
    const isShortLandscape = vw > vh && vh < 500
    const isCompact = isNarrow || isShortLandscape
    const chartHeight = isShortLandscape
        ? Math.round(Math.min(340, Math.max(220, vh * 0.72)))
        : isNarrow ? 280 : vw >= 768 ? 370 : 340

    // Data checks
    const hasProjections = trendData.some(d => d.projected && d.projected > 0)
    const hasLabor = trendData.some(d => d.laborCost && d.laborCost > 0)

    // Intelligence: Peak Hour calculation
    const peakHour = useMemo(() => {
        if (!trendData || trendData.length === 0) return null
        return trendData.reduce((max, d) => (d.amount > (max?.amount || 0) ? d : max), trendData[0])
    }, [trendData])

    // Etiqueta del pico: vista por hora ("2026-10-04 14:00") => "2pm"; vista por día ("2026-09-12") => "sáb 12"
    const peakIsHourly = typeof peakHour?.time === 'string' && peakHour.time.includes(' ')
    const peakLabel = useMemo(() => {
        const time = peakHour?.time
        if (typeof time !== 'string') return ''
        if (time.includes(' ')) return formatHourAMPM(time)
        try {
            const [year, month, day] = time.split('-').map(Number)
            return format(new Date(year, month - 1, day), 'EEE dd', { locale })
        } catch (e) {
            return time
        }
    }, [peakHour, locale])

    // Intelligence: Current Hour Reference Line
    const currentHourKey = useMemo(() => {
        if (period !== 'today') return null
        const now = new Date()
        const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:00`
        const match = trendData.find(d => d.time === nowStr)
        return match ? match.time : null
    }, [trendData, period])

    return (
        <div className="w-full mb-8">
            {/* MAIN CARD CONTAINER */}
            <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl sm:rounded-3xl p-3 sm:p-6 md:p-8 backdrop-blur-xl shadow-sm">
                
                {/* HEADER SECTION: CLEAN TITLE & ELEGANT LEGEND */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
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
                                        <span>{peakIsHourly ? t('sales.charts.peak_hour') : t('sales.charts.peak_day')}: <strong>{peakLabel}</strong> (${(peakHour.amount / 1000).toFixed(1)}k)</span>
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                {period === 'today' ? t('sales.charts.subtitle_today') : t('sales.charts.subtitle_range')}
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

                {/* CHART CANVAS — el alto se adapta: vertical (280), horizontal en teléfono (~72% del alto visible), escritorio (340/370) */}
                <div className="w-full" style={{ height: chartHeight }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                            data={trendData} 
                            margin={isCompact ? { top: 12, right: 8, left: 0, bottom: 0 } : { top: 15, right: 15, left: -15, bottom: 5 }}
                            barCategoryGap={isCompact ? '10%' : '20%'}
                        >
                            <defs>
                                {/* Emerald Bar Gradient */}
                                <linearGradient id="salesBarGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                                    <stop offset="100%" stopColor="#059669" stopOpacity={0.75} />
                                </linearGradient>
                                {/* Soft Area Underlay */}
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
                                // preserveStartEnd + minTickGap: en teléfono se omiten etiquetas intermedias
                                // en vez de encimarse (24 horas en ~330px no caben todas).
                                interval="preserveStartEnd"
                                minTickGap={isCompact ? 14 : 8}
                                tickMargin={6}
                                tickFormatter={(val) => {
                                    try {
                                        if (val.includes(' ')) {
                                            return formatHourAMPM(val)
                                        }
                                        const [year, month, day] = val.split('-').map(Number)
                                        const localDate = new Date(year, month - 1, day)
                                        return format(localDate, 'EEE dd', { locale })
                                    } catch (e) {
                                        return val
                                    }
                                }}
                            />

                            {/* Primary Y Axis ($ Sales & Labor Cost) */}
                            <YAxis
                                yAxisId="left"
                                axisLine={false}
                                tickLine={false}
                                width={isCompact ? 38 : undefined}
                                tick={{ fill: 'currentColor', fontSize: isCompact ? 10 : 11, fontWeight: 600 }}
                                className="text-slate-400 font-mono"
                                tickFormatter={(val) => {
                                    if (val < 1000) return `$${val}`
                                    const k = val / 1000
                                    return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`
                                }}
                            />

                            <Tooltip
                                content={<CombinedTooltip language={language} t={t} />}
                                cursor={{ fill: 'rgba(15, 23, 42, 0.04)', radius: 8 }}
                                allowEscapeViewBox={{ x: false, y: false }}
                                wrapperStyle={{ outline: 'none', zIndex: 30 }}
                            />

                            {/* Current Hour Reference Line */}
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
                                        className: 'font-mono'
                                    }} 
                                />
                            )}

                            {/* Area Glow under actual curve */}
                            <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="amount"
                                fill="url(#salesAreaGlow)"
                                stroke="none"
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
                <div className="mt-4 sm:mt-6 pt-4 sm:pt-5 border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-2 sm:landscape:grid-cols-4 md:grid-cols-4 gap-2.5 sm:gap-3.5 md:gap-4">
                    {(() => {
                        const now = new Date();
                        const bizNow = new Date(now);
                        if (bizNow.getHours() < 6) bizNow.setDate(bizNow.getDate() - 1);
                        const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:00`;
                        const nowDateStr = `${bizNow.getFullYear()}-${String(bizNow.getMonth() + 1).padStart(2, '0')}-${String(bizNow.getDate()).padStart(2, '0')}`;
                        const currentMinuteRatio = now.getMinutes() / 60;

                        const totalActual = trendData.reduce((sum, d) => sum + (d.amount || 0), 0)
                        const totalProjected = hasProjections ? trendData.reduce((sum, d) => sum + (d.projected || 0), 0) : 0
                        const projectedToDate = hasProjections ? trendData.reduce((sum, d) => {
                            if (d.time?.includes(' ')) {
                                if (d.time < nowStr) return sum + (d.projected || 0);
                                if (d.time === nowStr) return sum + ((d.projected || 0) * currentMinuteRatio);
                                return sum;
                            } else {
                                if (d.time < nowDateStr) {
                                    return sum + (d.projected || 0);
                                } else if (d.time === nowDateStr) {
                                    const currentBizHour = now.getHours() < 6 ? now.getHours() + 24 : now.getHours();
                                    const elapsedHours = currentBizHour - 6;
                                    const elapsedFraction = elapsedHours < 0 ? 0 : Math.min((elapsedHours + currentMinuteRatio) / 24, 1);
                                    return sum + ((d.projected || 0) * elapsedFraction);
                                }
                                return sum;
                            }
                        }, 0) : 0;

                        const isCurrentPeriod = ['today', 'week', 'month', 'last_7', 'quarter'].includes(period || '');
                        const baseProjected = isCurrentPeriod ? projectedToDate : totalProjected;
                        const diff = totalActual - baseProjected
                        const percentDiff = baseProjected > 0 ? (diff / baseProjected) * 100 : 0
                        const isPositive = diff >= 0

                        return (
                            <>
                                {hasProjections && isCurrentPeriod && (
                                    <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center min-w-0">
                                        <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                            <Target size={13} className="text-indigo-500 shrink-0" />
                                            <span>{t('sales.proj_to_date_label')}</span>
                                        </div>
                                        <FitValue
                                            text={`$${projectedToDate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                            maxPx={20}
                                            minPx={12}
                                            className="md:[--fit-max:24px] font-bold text-slate-900 dark:text-white font-mono tracking-tight"
                                        />
                                    </div>
                                )}

                                <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center min-w-0">
                                    <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                        <DollarSign size={13} className="text-emerald-500 shrink-0" />
                                        <span>{t('sales.charts.actual')}</span>
                                    </div>
                                    <FitValue
                                        text={`$${totalActual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                        maxPx={20}
                                        minPx={12}
                                        className="md:[--fit-max:24px] font-bold text-emerald-600 dark:text-emerald-400 font-mono tracking-tight"
                                    />
                                </div>

                                {hasProjections && (
                                    <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center min-w-0">
                                        <div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1 leading-tight">
                                            <Zap size={13} className="text-slate-400 shrink-0" />
                                            <span>{t('sales.charts.projected')}</span>
                                        </div>
                                        <FitValue
                                            text={`$${totalProjected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                            maxPx={20}
                                            minPx={12}
                                            className="md:[--fit-max:24px] font-bold text-slate-800 dark:text-slate-200 font-mono tracking-tight"
                                        />
                                    </div>
                                )}

                                {hasProjections && (
                                    <div className={`rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center border min-w-0 ${isPositive ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-800/40' : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-800/40'}`}>
                                        <p className={`text-[10px] sm:text-[11px] uppercase tracking-wider font-bold mb-1 leading-tight ${isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                            {t('sales.variance_label')}
                                        </p>
                                        <FitValue
                                            text={`${isPositive ? '+' : '-'}$${Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                            maxPx={20}
                                            minPx={12}
                                            className={`md:[--fit-max:24px] font-bold font-mono ${isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
                                        />
                                        {/* El badge de % va en su propia línea: junto al monto no cabe en pantallas angostas */}
                                        <span className={`inline-block mt-1 text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${isPositive ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200'}`}>
                                            {isPositive ? '+' : ''}{percentDiff.toFixed(1)}%
                                        </span>
                                    </div>
                                )}
                            </>
                        )
                    })()}
                </div>
            </div>
        </div>
    )
}
