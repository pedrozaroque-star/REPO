'use client'

import React from 'react'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell
} from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface ChartsProps {
    trendData: any[]
    storeData: any[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        let formattedLabel = label
        try {
            if (label.includes(' ')) {
                // Hourly: "2026-01-17 08:00" -> "08:00"
                formattedLabel = `Hora: ${label.split(' ')[1]}`
            } else {
                formattedLabel = format(new Date(label), "EEEE dd 'de' MMMM", { locale: es })
            }
        } catch (e) { }

        return (
            <div className="bg-white/90 dark:bg-slate-950 border border-black/10 dark:border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl">
                <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">{formattedLabel}</p>
                <div className="text-slate-900 dark:text-white font-mono font-bold text-xl flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    ${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            </div>
        )
    }
    return null
}

export default function SalesCharts({ trendData, storeData }: ChartsProps) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
                        Tendencia de Ventas
                    </h3>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData}>
                            <defs>
                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
                                        return format(d, 'dd MMM', { locale: es })
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
                                content={<CustomTooltip />}
                                cursor={{ stroke: 'currentColor', strokeOpacity: 0.1, strokeWidth: 2 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="amount"
                                stroke="#10b981"
                                strokeWidth={4}
                                fillOpacity={1}
                                fill="url(#colorSales)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                        <span className="w-1.5 h-6 bg-sky-500 rounded-full"></span>
                        Top 5 Ventas por Tienda
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
                                content={<CustomTooltip />}
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
