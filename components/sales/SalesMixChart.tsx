
'use client'

import React from 'react'
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
    Legend
} from 'recharts'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

export default function SalesMixChart({ data }: { data: any[] }) {
    // data format: [{ name: 'Dine In', value: 1200 }, ...]

    return (
        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
            <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2 mb-6">
                <span className="w-1.5 h-6 bg-purple-500 rounded-full"></span>
                Canales de Venta (Mix)
            </h3>

            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px', color: '#fff' }}
                            itemStyle={{ color: '#fff' }}
                            formatter={(value: any) => [`$${value.toLocaleString()}`, 'Venta']}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
