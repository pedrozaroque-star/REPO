'use client'

import React from 'react'
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Cell,
    Legend
} from 'recharts'
import { format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { useLanguage } from '@/lib/i18n'

interface ChartsProps {
    trendData: any[]
    storeData: any[]
    period?: string // 'today' | 'yesterday' | 'week' | 'month' | etc.
}

// Custom Tooltip for Combined Chart
const CombinedTooltip = ({ active, payload, label, language, t }: any) => {
    if (active && payload && payload.length) {
        let formattedLabel = label
        const locale = language === 'es' ? es : enUS
        try {
            if (label.includes(' ')) {
                // Hourly: "2026-01-17 08:00" -> "08:00"
                formattedLabel = `${t('sales.charts.hour')}: ${label.split(' ')[1]}`
            } else {
                const dateFormat = language === 'es' ? "EEEE dd 'de' MMMM" : "EEEE, MMMM dd"
                formattedLabel = format(new Date(label), dateFormat, { locale })
            }
        } catch (e) { }

        const actual = payload.find((p: any) => p.dataKey === 'amount')
        const projected = payload.find((p: any) => p.dataKey === 'projected')

        return (
            <div className="bg-white/95 dark:bg-slate-950/95 border border-black/10 dark:border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl min-w-[180px]">
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">
                    {formattedLabel}
                </p>

                {actual && (
                    <div className="flex items-center justify-between gap-4 mb-2">
                        <span className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                            <span className="w-3 h-3 bg-emerald-500 rounded"></span>
                            {t('sales.charts.actual')}
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            ${actual.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                )}

                {projected && projected.value > 0 && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                            <span className="w-3 h-3 bg-indigo-500 rounded-full border-2 border-indigo-300"></span>
                            {t('sales.charts.projected')}
                        </span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            ${projected.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                )}
            </div>
        )
    }
    return null
}

// Original Tooltip for Store Ranking
const StoreTooltip = ({ active, payload, label, language, t }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/90 dark:bg-slate-950 border border-black/10 dark:border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl">
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">{label}</p>
                <div className="text-slate-900 dark:text-white font-mono font-bold text-xl flex items-center gap-2">
                    <span className="w-2 h-2 bg-sky-500 rounded-full animate-pulse"></span>
                    ${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>
        )
    }
    return null
}

export default function SalesCharts({ trendData, storeData, period }: ChartsProps) {
    const { t, language } = useLanguage()
    const locale = language === 'es' ? es : enUS

    // Check if trend data has projections
    const hasProjections = trendData.some(d => d.projected && d.projected > 0)

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

            {/* SALES TREND CHART - Now with Bars + Line */}
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
                        {t('sales.charts.sales_trend')}
                    </h3>
                    {hasProjections && (
                        <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 bg-emerald-500 rounded"></span>
                                <span className="text-slate-600 dark:text-slate-400 font-medium">{t('sales.charts.actual')}</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 bg-indigo-500 rounded-full"></span>
                                <span className="text-slate-600 dark:text-slate-400 font-medium">{t('sales.charts.projected')}</span>
                            </span>
                        </div>
                    )}
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={trendData}>
                            <defs>
                                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.4} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
                            <XAxis
                                dataKey="time"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 600, opacity: 1 }}
                                dy={10}
                                interval="preserveStartEnd"
                                tickFormatter={(val) => {
                                    try {
                                        if (val.includes(' ')) {
                                            const hour = parseInt(val.split(' ')[1])
                                            const ampm = hour >= 12 ? 'PM' : 'AM'
                                            const h12 = hour % 12 || 12
                                            return `${h12} ${ampm}`
                                        }
                                        const d = new Date(val)
                                        return format(d, 'dd MMM', { locale })
                                    } catch (e) {
                                        return val
                                    }
                                }}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 600, opacity: 1 }}
                                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                            />
                            <Tooltip
                                content={<CombinedTooltip language={language} t={t} />}
                                cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                            />

                            {/* BARS for Actual Sales */}
                            <Bar
                                dataKey="amount"
                                fill="url(#colorActual)"
                                radius={[4, 4, 0, 0]}
                                barSize={period === 'today' || period === 'yesterday' ? 20 : 30}
                            />

                            {/* LINE for Projections */}
                            {hasProjections && (
                                <Line
                                    type="monotone"
                                    dataKey="projected"
                                    stroke="#6366f1"
                                    strokeWidth={3}
                                    dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
                                    activeDot={{ r: 6, stroke: '#6366f1', strokeWidth: 2, fill: '#fff' }}
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* TOP 5 STORES - Unchanged */}
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-sky-500 rounded-full"></span>
                        {t('sales.charts.top_5_stores')}
                    </h3>
                </div>
                <div className="h-[350px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={storeData.slice(0, 5)} layout="vertical" margin={{ left: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="currentColor" strokeOpacity={0.1} />
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                axisLine={false}
                                tickLine={false}
                                width={120}
                                tick={{ fill: 'currentColor', fontSize: 13, fontWeight: 600, opacity: 1 }}
                            />
                            <Tooltip
                                cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                                contentStyle={{ backgroundColor: 'transparent', border: 'none' }}
                                content={<StoreTooltip language={language} t={t} />}
                            />
                            <Bar dataKey="amount" radius={[0, 6, 6, 0]} barSize={24}>
                                {storeData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={index < 3 ? '#3b82f6' : '#94a3b8'}
                                        fillOpacity={index < 3 ? 1 : 0.3}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    )
}
