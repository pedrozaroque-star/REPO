'use client'

/**
 * @module components/food-cost/FoodCostCharts
 * @description Gráfica comparativa de barras de Food Cost % por sucursal para Tacos Gavilan.
 *
 * @businessRules
 * - Usa los umbrales canónicos corporativos (`lib/inventory/food-cost-sales-resolver.ts`):
 *   • `<= 32%` (`healthy`): Verde esmeralda (`#10b981`)
 *   • `> 32%` y `<= 35%` (`warning`): Ámbar (`#f59e0b`)
 *   • `> 35%` (`critical`): Rojo (`#f43f5e`)
 * - Líneas de referencia en `30%` (Meta), `32%` (Alerta) y `35%` (Crítico).
 *
 * @dataFlow
 * - `StoreCostData[]` desde `/admin/food-cost/page.tsx` -> Recharts `ComposedChart`.
 *
 * @notes
 * - [2026-11-23] Unificado semáforo de 3 niveles (`<=32% / 32-35% / >35%`) y tooltip con desglose de Empaque separado.
 */

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
import {
    FOOD_COST_TARGET_PCT,
    FOOD_COST_HEALTHY_MAX_PCT,
    FOOD_COST_WARNING_MAX_PCT,
    getFoodCostStatus,
} from '@/lib/inventory/food-cost-sales-resolver'

export interface StoreCostData {
    storeName: string
    totalSales: number
    totalCost: number
    totalPackagingCost?: number
    costPercent: number
    packagingPercent?: number
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

const getStatusHex = (pct: number): string => {
    const status = getFoodCostStatus(pct)
    if (status === 'critical') return '#f43f5e'
    if (status === 'warning') return '#f59e0b'
    return '#10b981'
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    const { t } = useLanguage()
    if (active && payload && payload.length) {
        const data = payload[0].payload as StoreCostData
        const status = getFoodCostStatus(data.costPercent)
        const dotClass = status === 'critical' ? 'bg-rose-500' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
        const textClass = status === 'critical'
            ? 'text-rose-600 dark:text-rose-400'
            : status === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'

        return (
            <div className="bg-white/95 dark:bg-slate-950/95 border border-black/10 dark:border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl min-w-[220px]">
                <p className="text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">
                    {formatStoreName(label)}
                </p>

                <div className="flex items-center justify-between gap-4 mb-1.5">
                    <span className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                        <span className={`w-3 h-3 rounded ${dotClass}`}></span>
                        Food Cost %
                    </span>
                    <span className={`font-mono font-bold ${textClass}`}>
                        {data.costPercent.toFixed(1)}%
                    </span>
                </div>

                {(data.packagingPercent ?? 0) > 0 && (
                    <div className="flex items-center justify-between gap-4 mb-2">
                        <span className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                            <span className="w-3 h-3 rounded bg-sky-500"></span>
                            {t('food_cost.pkg_pct_col')}
                        </span>
                        <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                            {(data.packagingPercent ?? 0).toFixed(1)}%
                        </span>
                    </div>
                )}

                <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {t('food_cost.table.net_sales')}
                    </span>
                    <div className="flex items-center gap-2 font-mono font-bold text-slate-700 dark:text-slate-300">
                        ${data.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-4 mt-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Food Cost
                    </span>
                    <div className="flex items-center gap-2 font-mono font-bold text-slate-700 dark:text-slate-300">
                        ${data.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                </div>
                {(data.totalPackagingCost ?? 0) > 0 && (
                    <div className="flex items-center justify-between gap-4 mt-1">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            {t('food_cost.packaging_col')}
                        </span>
                        <div className="flex items-center gap-2 font-mono font-bold text-sky-600 dark:text-sky-400">
                            ${(data.totalPackagingCost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                    </div>
                )}
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
                            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('food_cost.chart_healthy')}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-amber-500 rounded"></span>
                            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('food_cost.chart_warning')}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-rose-500 rounded"></span>
                            <span className="text-slate-600 dark:text-slate-400 font-medium">{t('food_cost.chart_critical')}</span>
                        </span>
                    </div>
                </div>

                <div className="overflow-x-auto w-full styled-scrollbar z-20 relative pb-4">
                    <div className="h-[380px] min-w-[1100px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 20, right: 75, left: -20, bottom: 60 }}>
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
                                        <Cell key={`cell-${index}`} fill={getStatusHex(entry.costPercent)} fillOpacity={0.85} />
                                    ))}
                                </Bar>

                                <ReferenceLine
                                    y={FOOD_COST_WARNING_MAX_PCT}
                                    stroke="#f43f5e"
                                    strokeDasharray="4 4"
                                    strokeWidth={1.5}
                                    label={{ position: 'right', value: t('food_cost.chart_crit_label'), fill: '#f43f5e', fontSize: 11, fontWeight: 'bold' }}
                                />
                                <ReferenceLine
                                    y={FOOD_COST_HEALTHY_MAX_PCT}
                                    stroke="#f59e0b"
                                    strokeDasharray="4 4"
                                    strokeWidth={1.2}
                                    label={{ position: 'right', value: t('food_cost.chart_warn_label'), fill: '#f59e0b', fontSize: 10, fontWeight: 'bold' }}
                                />
                                <ReferenceLine
                                    y={FOOD_COST_TARGET_PCT}
                                    stroke="#10b981"
                                    strokeDasharray="4 4"
                                    strokeWidth={1.5}
                                    label={{ position: 'right', value: t('food_cost.chart_target_label'), fill: '#10b981', fontSize: 11, fontWeight: 'bold' }}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}
