/**
 * @module components/sales/SalesMixChart
 * @description Donut Pie Chart displaying sales distribution by channel (Dine In, Drive Thru, Delivery, Takeout).
 * @businessRules
 * - Renders donut pie with proportional segments and currency tooltips.
 * - Bilingual support (ES/EN) via useLanguage.
 * - Handles empty or zero-value states gracefully.
 * @dataFlow
 * - Props (data) -> Recharts PieChart -> UI Card.
 */
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
import { useLanguage } from '@/lib/i18n'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

export default function SalesMixChart({ data }: { data?: any[] }) {
    const { t } = useLanguage()

    if (!data || data.length === 0 || data.every(d => Number(d.value || 0) === 0)) {
        return (
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
                <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2 mb-6">
                    <span className="w-1.5 h-6 bg-purple-500 rounded-full"></span>
                    {t('sales.sales_mix_title')}
                </h3>
                <div className="h-[240px] flex items-center justify-center">
                    <p className="text-slate-400 text-sm">{t('sales.no_sales_mix_data')}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
            <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2 mb-6">
                <span className="w-1.5 h-6 bg-purple-500 rounded-full"></span>
                {t('sales.sales_mix_title')}
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
                            {data.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', color: '#fff' }}
                            itemStyle={{ color: '#fff' }}
                            formatter={(value: any) => [`$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, t('sales.sales_mix_tooltip')]}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
