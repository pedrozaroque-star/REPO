/**
 * @module components/sales/SalesCharts
 * @description Executive-grade composed sales intelligence chart with ambient glow, interactive series toggles (Actual, Proj, Labor $, Labor %), dynamic view modes (Hybrid / Bars / Spline Glow), live "NOW" time marker, peak-hour intelligence pill, and glassmorphism hover insights.
 * @businessRules
 * - Day rollover boundary is 6:00 AM PST/PDT.
 * - Displays projectedToDate vs totalProjected based on active period filter.
 * - Dynamic tooltip with bilingual labels, hourly pace progress, and variance percentage.
 * @dataFlow
 * - Props (trendData, period) -> Local State (chartMode, series toggles) -> ResponsiveContainer -> ComposedChart.
 */
'use client'

import React, { useState, useMemo } from 'react'
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
    Cell,
} from 'recharts'
import { format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { useLanguage } from '@/lib/i18n'
import { 
    TrendingUp, 
    ArrowUpRight, 
    ArrowDownRight, 
    Flame, 
    BarChart3, 
    LineChart as LineChartIcon, 
    Layers,
    Target,
    DollarSign,
    Zap,
    Percent,
    Eye,
    EyeOff,
    Sparkles
} from 'lucide-react'

interface ChartsProps {
    trendData?: any[]
    period?: string
}

type ChartViewMode = 'hybrid' | 'bars' | 'area'

// Helper to format hours in compact 12-hour am/pm format (e.g., 7am, 12pm, 1pm)
const formatHourAMPM = (timeStr: string) => {
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
        const laborPct = payload.find((p: any) => p.dataKey === 'laborPercentage')

        let varianceElement = null
        let progressPct = 0
        if (actual && projected && projected.value > 0) {
            const diff = actual.value - projected.value
            const percentDiff = (diff / projected.value) * 100
            const isPositive = diff >= 0
            progressPct = Math.min(Math.round((actual.value / projected.value) * 100), 200)

            varianceElement = (
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-4">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {t('sales.variance_short')}
                        </span>
                        <div className={`flex items-center gap-1 font-mono font-bold text-xs ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            <span>
                                {isPositive ? '+' : ''}${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${isPositive ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'}`}>
                                {isPositive ? '+' : ''}{percentDiff.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                    {/* Progress bar toward projection */}
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                            className={`h-full rounded-full transition-all duration-300 ${isPositive ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-indigo-500 shadow-sm shadow-indigo-500/50'}`} 
                            style={{ width: `${Math.min(progressPct, 100)}%` }}
                        />
                    </div>
                </div>
            )
        }

        return (
            <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-2xl backdrop-blur-2xl min-w-[230px]">
                <p className="text-slate-500 dark:text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-3 border-b border-slate-100 dark:border-slate-800 pb-2">
                    {formattedLabel}
                </p>

                <div className="space-y-2.5">
                    {actual && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-gradient-to-tr from-emerald-600 to-teal-400 rounded-sm shadow-sm"></span>
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
                                <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full border-2 border-indigo-200 dark:border-indigo-800 shadow-sm"></span>
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
                                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-amber-200 dark:border-amber-800 shadow-sm"></span>
                                {t('sales.labor_label')}
                            </span>
                            <span className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400 flex items-center">
                                ${Number(labor.value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                <span className="text-[10px] ml-1.5 opacity-85 font-medium px-1.5 py-0.5 rounded-md bg-amber-100/80 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                                    {Number(labor.payload?.laborPercentage || 0).toFixed(1)}%
                                </span>
                            </span>
                        </div>
                    )}

                    {laborPct && (
                        <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="w-2.5 h-2.5 bg-fuchsia-500 rounded-full border-2 border-fuchsia-200 dark:border-fuchsia-800 shadow-sm"></span>
                                Labor %
                            </span>
                            <span className="font-mono font-bold text-sm text-fuchsia-600 dark:text-fuchsia-400">
                                {Number(laborPct.value || 0).toFixed(1)}%
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

export default function SalesCharts({ trendData = [], period = 'today' }: ChartsProps) {
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // View mode state
    const [viewMode, setViewMode] = useState<ChartViewMode>('hybrid')

    // Interactive Series Visibility Toggles
    const [showActual, setShowActual] = useState(true)
    const [showProjected, setShowProjected] = useState(true)
    const [showLaborCost, setShowLaborCost] = useState(true)
    const [showLaborPct, setShowLaborPct] = useState(false)
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

    // Data checks
    const hasProjections = trendData.some(d => d.projected && d.projected > 0)
    const hasLabor = trendData.some(d => d.laborCost && d.laborCost > 0)

    // Intelligence: Peak Hour calculation
    const peakHour = useMemo(() => {
        if (!trendData || trendData.length === 0) return null
        return trendData.reduce((max, d) => (d.amount > (max?.amount || 0) ? d : max), trendData[0])
    }, [trendData])

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
            {/* MAIN CONTAINER WITH LUXURY MESH GRADIENT & SHADOWS */}
            <div className="relative overflow-hidden bg-gradient-to-b from-white/95 via-slate-50/75 to-white/90 dark:from-slate-900/95 dark:via-slate-900/85 dark:to-slate-950/90 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 md:p-8 backdrop-blur-3xl shadow-2xl shadow-slate-200/50 dark:shadow-black/50">
                {/* AMBIENT GLOW BACKDROPS */}
                <div className="absolute -top-12 right-1/4 w-96 h-96 bg-emerald-500/10 dark:bg-emerald-500/15 rounded-full blur-3xl pointer-events-none -z-10 animate-pulse" />
                <div className="absolute -bottom-12 left-1/4 w-96 h-96 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

                {/* TOP HEADER & INTELLIGENCE CONTROLS */}
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/30 text-white shrink-0">
                            <TrendingUp size={24} />
                        </div>
                        <div>
                            <div className="flex items-center flex-wrap gap-2.5">
                                <h3 className="text-lg md:text-xl text-slate-900 dark:text-white font-black tracking-tight">
                                    {t('sales.charts.sales_trend')}
                                </h3>
                                {peakHour && peakHour.amount > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-amber-500/15 to-orange-500/15 dark:from-amber-500/25 dark:to-orange-500/25 text-amber-700 dark:text-amber-300 border border-amber-300/70 dark:border-amber-700/50 shadow-sm">
                                        <Flame size={13} className="text-amber-500 fill-amber-500" />
                                        <span>Hora Pico: <strong>{formatHourAMPM(peakHour.time)}</strong> (${(peakHour.amount / 1000).toFixed(1)}k)</span>
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                {period === 'today' ? 'Monitoreo intradía en tiempo real de ventas, meta inteligente y mano de obra' : 'Evolución periódica de ventas consolidadas'}
                            </p>
                        </div>
                    </div>

                    {/* CONTROLS: INTERACTIVE VIEW SWITCHER + CLICKABLE LEGEND TOGGLES */}
                    <div className="flex items-center flex-wrap gap-2.5 w-full xl:w-auto justify-between xl:justify-end">
                        {/* 3-Way Mode Switcher */}
                        <div className="flex items-center p-1 rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/70 text-xs font-semibold shadow-inner">
                            <button
                                onClick={() => setViewMode('hybrid')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${viewMode === 'hybrid' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm font-bold scale-[1.02]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <Layers size={13} />
                                <span>Híbrido</span>
                            </button>
                            <button
                                onClick={() => setViewMode('bars')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${viewMode === 'bars' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm font-bold scale-[1.02]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <BarChart3 size={13} />
                                <span>Barras</span>
                            </button>
                            <button
                                onClick={() => setViewMode('area')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${viewMode === 'area' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm font-bold scale-[1.02]' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                            >
                                <LineChartIcon size={13} />
                                <span>Curvas</span>
                            </button>
                        </div>

                        {/* Clickable Legend Series Toggles */}
                        <div className="flex items-center flex-wrap gap-1.5 text-xs font-semibold">
                            {/* Actual Sales Toggle */}
                            <button
                                onClick={() => setShowActual(!showActual)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${showActual ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/60 text-emerald-700 dark:text-emerald-300 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 line-through opacity-60'}`}
                                title="Alternar visibilidad de Ventas Reales"
                            >
                                <span className={`w-2.5 h-2.5 rounded-sm shadow-sm ${showActual ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                                <span>{t('sales.charts.actual')}</span>
                            </button>

                            {/* Projected Sales Toggle */}
                            {hasProjections && (
                                <button
                                    onClick={() => setShowProjected(!showProjected)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${showProjected ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/60 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 line-through opacity-60'}`}
                                    title="Alternar visibilidad de Proyección"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full border-2 shadow-sm ${showProjected ? 'bg-indigo-500 border-indigo-200 dark:border-indigo-700' : 'bg-slate-400 border-slate-300'}`}></span>
                                    <span>{t('sales.charts.projected')}</span>
                                </button>
                            )}

                            {/* Labor $ Toggle */}
                            {hasLabor && (
                                <button
                                    onClick={() => setShowLaborCost(!showLaborCost)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${showLaborCost ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 line-through opacity-60'}`}
                                    title="Alternar visibilidad de Costo Laboral"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full border-2 shadow-sm ${showLaborCost ? 'bg-amber-500 border-amber-200 dark:border-amber-700' : 'bg-slate-400 border-slate-300'}`}></span>
                                    <span>{t('sales.labor_cost_legend')}</span>
                                </button>
                            )}

                            {/* Labor % Toggle (Bonus Feature) */}
                            {hasLabor && (
                                <button
                                    onClick={() => setShowLaborPct(!showLaborPct)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${showLaborPct ? 'bg-fuchsia-50 dark:bg-fuchsia-950/40 border-fuchsia-300 dark:border-fuchsia-700/60 text-fuchsia-700 dark:text-fuchsia-300 shadow-sm font-bold' : 'bg-slate-50/70 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700'}`}
                                    title="Alternar curva de Labor % en eje secundario"
                                >
                                    <Percent size={12} className={showLaborPct ? 'text-fuchsia-600 dark:text-fuchsia-400' : 'text-slate-400'} />
                                    <span>Labor %</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* CHART CANVAS */}
                <div className="h-[330px] md:h-[360px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                            data={trendData} 
                            margin={{ top: 15, right: showLaborPct ? 20 : 15, left: -15, bottom: 5 }}
                            onMouseMove={(state: any) => {
                                if (state && typeof state.activeTooltipIndex === 'number') {
                                    setHoveredIndex(state.activeTooltipIndex)
                                }
                            }}
                            onMouseLeave={() => setHoveredIndex(null)}
                        >
                            <defs>
                                {/* Emerald Bar Gradient */}
                                <linearGradient id="salesBarGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.98} />
                                    <stop offset="100%" stopColor="#047857" stopOpacity={0.78} />
                                </linearGradient>
                                {/* Hovered Bar Highlight Gradient */}
                                <linearGradient id="salesBarHoverGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#34d399" stopOpacity={1.0} />
                                    <stop offset="100%" stopColor="#059669" stopOpacity={0.9} />
                                </linearGradient>
                                {/* Emerald Area Ambient Glow */}
                                <linearGradient id="salesAreaGlow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.38} />
                                    <stop offset="70%" stopColor="#10b981" stopOpacity={0.08} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.00} />
                                </linearGradient>
                                {/* Projected Area Ambient Glow */}
                                <linearGradient id="projAreaGlow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.22} />
                                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.00} />
                                </linearGradient>
                                {/* Filter for soft line glow */}
                                <filter id="glow-indigo" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#6366f1" floodOpacity="0.35" />
                                </filter>
                                <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#f59e0b" floodOpacity="0.35" />
                                </filter>
                            </defs>

                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200/80 dark:text-slate-800/80" />
                            
                            <XAxis
                                dataKey="time"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }}
                                className="text-slate-500 dark:text-slate-400 font-medium"
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
                                tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }}
                                className="text-slate-400 font-mono"
                                tickFormatter={(val) => `$${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                            />

                            {/* Secondary Y Axis (Labor % if toggled) */}
                            {showLaborPct && (
                                <YAxis
                                    yAxisId="pct"
                                    orientation="right"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#d946ef', fontSize: 11, fontWeight: 700 }}
                                    domain={[0, 40]}
                                    tickFormatter={(val) => `${val}%`}
                                />
                            )}

                            <Tooltip
                                content={<CombinedTooltip language={language} t={t} />}
                                cursor={{ fill: 'rgba(16, 185, 129, 0.05)', radius: 10 }}
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
                                        value: '● AHORA', 
                                        position: 'top', 
                                        fill: '#10b981', 
                                        fontSize: 10, 
                                        fontWeight: 800,
                                        className: 'font-mono'
                                    }} 
                                />
                            )}

                            {/* Area Glow under actual curve when in Area or Hybrid mode */}
                            {showActual && (viewMode === 'area' || viewMode === 'hybrid') && (
                                <Area
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="amount"
                                    fill="url(#salesAreaGlow)"
                                    stroke="none"
                                />
                            )}

                            {/* Actual Sales Gradient BARS */}
                            {showActual && (viewMode === 'hybrid' || viewMode === 'bars') && (
                                <Bar
                                    yAxisId="left"
                                    dataKey="amount"
                                    radius={[8, 8, 2, 2]}
                                    maxBarSize={36}
                                >
                                    {trendData.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`}
                                            fill={hoveredIndex === index ? 'url(#salesBarHoverGradient)' : 'url(#salesBarGradient)'}
                                            className="transition-all duration-200"
                                        />
                                    ))}
                                </Bar>
                            )}

                            {/* Actual Sales Spline Line (in Area Mode) */}
                            {showActual && viewMode === 'area' && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="amount"
                                    stroke="#10b981"
                                    strokeWidth={3.5}
                                    dot={{ fill: '#10b981', strokeWidth: 2, r: 3.5 }}
                                    activeDot={{ r: 7, stroke: '#10b981', strokeWidth: 3, fill: '#fff' }}
                                />
                            )}

                            {/* Projected Sales Spline LINE */}
                            {hasProjections && showProjected && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="projected"
                                    stroke="#6366f1"
                                    strokeWidth={3}
                                    strokeDasharray="5 5"
                                    dot={{ fill: '#6366f1', strokeWidth: 2, r: 3.5 }}
                                    activeDot={{ r: 6.5, stroke: '#6366f1', strokeWidth: 2.5, fill: '#fff' }}
                                    filter="url(#glow-indigo)"
                                />
                            )}

                            {/* Labor Cost Spline LINE */}
                            {hasLabor && showLaborCost && (
                                <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="laborCost"
                                    stroke="#f59e0b"
                                    strokeWidth={2.5}
                                    dot={{ fill: '#f59e0b', strokeWidth: 2, r: 3 }}
                                    activeDot={{ r: 6, stroke: '#f59e0b', strokeWidth: 2, fill: '#fff' }}
                                    filter="url(#glow-amber)"
                                />
                            )}

                            {/* Labor % Secondary Spline LINE */}
                            {hasLabor && showLaborPct && (
                                <Line
                                    yAxisId="pct"
                                    type="monotone"
                                    dataKey="laborPercentage"
                                    stroke="#d946ef"
                                    strokeWidth={2}
                                    strokeDasharray="3 3"
                                    dot={{ fill: '#d946ef', strokeWidth: 1.5, r: 2.5 }}
                                    activeDot={{ r: 5, stroke: '#d946ef', strokeWidth: 2, fill: '#fff' }}
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* HIGH-DEFINITION GLASSMORPHISM STATS CARDS FOOTER */}
                <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-3.5 md:gap-4">
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

                        const isCurrentPeriod = ['today', 'week', 'month'].includes(period || '');
                        const baseProjected = isCurrentPeriod ? projectedToDate : totalProjected;
                        const diff = totalActual - baseProjected
                        const percentDiff = baseProjected > 0 ? (diff / baseProjected) * 100 : 0
                        const isPositive = diff >= 0

                        return (
                            <>
                                {hasProjections && isCurrentPeriod && (
                                    <div className="relative overflow-hidden bg-gradient-to-br from-sky-50/80 via-white to-sky-50/40 dark:from-sky-950/30 dark:via-slate-900/80 dark:to-slate-900/50 border border-sky-200/80 dark:border-sky-800/40 rounded-2xl p-4 text-center shadow-sm group hover:border-sky-300 transition-all">
                                        <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-sky-700 dark:text-sky-400 font-bold mb-1">
                                            <Target size={14} className="text-sky-500" />
                                            <span>{t('sales.proj_to_date_label')}</span>
                                        </div>
                                        <p className="text-xl md:text-2xl font-black text-sky-700 dark:text-sky-300 font-mono tracking-tight">
                                            ${projectedToDate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                )}

                                <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 dark:from-emerald-950/30 dark:via-slate-900/80 dark:to-slate-900/50 border border-emerald-200/80 dark:border-emerald-800/40 rounded-2xl p-4 text-center shadow-sm group hover:border-emerald-300 transition-all">
                                    <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold mb-1">
                                        <DollarSign size={14} className="text-emerald-500" />
                                        <span>{t('sales.charts.actual')}</span>
                                    </div>
                                    <p className="text-xl md:text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono tracking-tight">
                                        ${totalActual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>

                                {hasProjections && (
                                    <div className="relative overflow-hidden bg-gradient-to-br from-indigo-50/80 via-white to-indigo-50/40 dark:from-indigo-950/30 dark:via-slate-900/80 dark:to-slate-900/50 border border-indigo-200/80 dark:border-indigo-800/40 rounded-2xl p-4 text-center shadow-sm group hover:border-indigo-300 transition-all">
                                        <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-indigo-700 dark:text-indigo-400 font-bold mb-1">
                                            <Zap size={14} className="text-indigo-500" />
                                            <span>{t('sales.charts.projected')}</span>
                                        </div>
                                        <p className="text-xl md:text-2xl font-black text-indigo-700 dark:text-indigo-300 font-mono tracking-tight">
                                            ${totalProjected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </div>
                                )}

                                {hasProjections && (
                                    <div className={`relative overflow-hidden rounded-2xl p-4 text-center border shadow-sm transition-all ${isPositive ? 'bg-gradient-to-br from-emerald-50/90 via-teal-50/40 to-white dark:from-emerald-950/40 dark:via-slate-900/80 dark:to-slate-900/50 border-emerald-300/80 dark:border-emerald-800/60' : 'bg-gradient-to-br from-rose-50/90 via-orange-50/40 to-white dark:from-rose-950/40 dark:via-slate-900/80 dark:to-slate-900/50 border-rose-300/80 dark:border-rose-800/60'}`}>
                                        <p className={`text-[11px] uppercase tracking-wider font-bold mb-1 ${isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                            {t('sales.variance_label')}
                                        </p>
                                        <p className={`text-xl md:text-2xl font-black font-mono flex items-center justify-center gap-1.5 leading-none ${isPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                                            <span>
                                                {isPositive ? '+' : ''}${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md shadow-sm ${isPositive ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200' : 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200'}`}>
                                                {isPositive ? '+' : ''}{percentDiff.toFixed(1)}%
                                            </span>
                                        </p>
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
