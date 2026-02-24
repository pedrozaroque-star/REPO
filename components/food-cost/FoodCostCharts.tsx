'use client'

import React, { useMemo } from 'react'
import {
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    Cell
} from 'recharts'
import { formatStoreName } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'

interface StoreCostData {
    storeName: string
    totalSales: number
    totalCost: number
    costPercent: number
    quantity: number
}

interface ChartsProps {
    data: StoreCostData[]
}

interface CustomTooltipProps {
    active?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: any[]
    label?: string
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload as StoreCostData
        const isHigh = data.costPercent > 35

        return (
            <div className="bg-white/95 dark:bg-slate-950/95 border border-black/10 dark:border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl min-w-[200px]">
                <p className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">
                    {formatStoreName(label)}
                </p>

                <div className="flex items-center justify-between gap-4 mb-2">
                    <span className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                        <span className={`w-3 h-3 rounded ${isHigh ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                        Cost %
                    </span>
                    <span className={`font-mono font-bold ${isHigh ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {data.costPercent.toFixed(1)}%
                    </span>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Ventas
                    </span>
                    <div className="flex items-center gap-2 font-mono font-bold text-slate-700 dark:text-slate-300">
                        ${data.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-4 mt-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Costo
                    </span>
                    <div className="flex items-center gap-2 font-mono font-bold text-slate-700 dark:text-slate-300">
                        ${data.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                </div>
            </div>
        )
    }
    return null
}

export default function FoodCostCharts({ data }: ChartsProps) {
    const { t } = useLanguage()

    // Sort data primarily by lowest cost percent
    const chartData = useMemo(() => {
        return [...data].sort((a, b) => a.costPercent - b.costPercent)
    }, [data])

    if (!chartData || chartData.length === 0) return null

    return (
        <div className="w-full mb-8">
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
                    <h3 className="text-sm sm:text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
                        {t('food_cost.table.cost_pct')} {t('sales.detail_by_store').toLowerCase()}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] sm:text-xs">
                        <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded"></span>
                            <span className="text-slate-600 dark:text-slate-400 font-medium">&lt; 35% (Healthy)</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-rose-500 rounded"></span>
                            <span className="text-slate-600 dark:text-slate-400 font-medium">&gt; 35% (High)</span>
                        </span>
                    </div>
                </div>

                <div className="overflow-x-auto w-full styled-scrollbar z-20 relative pb-4">
                    <div className="h-[380px] min-w-[1100px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 20, right: 60, left: -20, bottom: 60 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.1} />
                                <XAxis
                                    dataKey="storeName"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 600, opacity: 1 }}
                                    dy={10}
                                    interval={0}
                                    angle={-35}
                                    textAnchor="end"
                                    tickFormatter={(val) => formatStoreName(val).substring(0, 12) + (formatStoreName(val).length > 12 ? '...' : '')}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'currentColor', fontSize: 12, fontWeight: 600, opacity: 1 }}
                                    tickFormatter={(value) => `${value}%`}
                                    domain={[0, 'auto']}
                                />

                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
                                />

                                <Bar
                                    dataKey="costPercent"
                                    radius={[4, 4, 0, 0]}
                                    barSize={40}
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.costPercent > 35 ? '#f43f5e' : '#10b981'} fillOpacity={0.8} />
                                    ))}
                                </Bar>

                                <ReferenceLine y={35} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={1.5} label={{ position: 'right', value: 'Crit: 35%', fill: '#f43f5e', fontSize: 11, fontWeight: 'bold' }} />
                                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5} label={{ position: 'right', value: 'Target: 30%', fill: '#10b981', fontSize: 11, fontWeight: 'bold' }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}
