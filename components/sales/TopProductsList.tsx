/**
 * @module components/sales/TopProductsList
 * @description Renders the Top 10 best-selling products ranked by sales amount with animated percentage progress bars and units sold count.
 * @businessRules
 * - Automatically slices to the top 10 products.
 * - Safeguards against division by zero (0/0 -> 100% or NaN) when amounts are zero.
 * - Full bilingual support (ES/EN) via useLanguage.
 * @dataFlow
 * - Props (data) -> Framer Motion Progress Bars -> List UI.
 */
'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

export default function TopProductsList({ data }: { data?: any[] }) {
    const { t } = useLanguage()

    const safeData = (data || []).slice(0, 10)

    if (safeData.length === 0) {
        return (
            <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5 flex items-center justify-center">
                <p className="text-slate-400">{t('sales.no_products_data')}</p>
            </div>
        )
    }

    const maxAmt = Math.max(...safeData.map(d => Number(d.amt || 0)), 1)

    return (
        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl shadow-black/5">
            <h3 className="text-lg text-slate-900 dark:text-white font-semibold flex items-center gap-2 mb-6">
                <span className="w-1.5 h-6 bg-orange-500 rounded-full"></span>
                {t('sales.top_products_title')}
            </h3>

            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {safeData.map((item, idx) => {
                    const amt = Number(item.amt || 0)
                    const widthPct = Math.min(Math.max((amt / maxAmt) * 100, 0), 100)

                    return (
                        <div key={idx} className="relative group">
                            <div className="flex justify-between items-center mb-1 text-sm font-medium">
                                <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                                    <span className="bg-slate-200 dark:bg-slate-800 w-5 h-5 flex items-center justify-center rounded-full text-[10px] text-slate-500">
                                        {idx + 1}
                                    </span>
                                    {item.name}
                                </span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                    ${amt.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                            </div>

                            {/* Progress Bar Background */}
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${widthPct}%` }}
                                    transition={{ duration: 0.8, delay: idx * 0.05 }}
                                    className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full"
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 text-right">
                                {item.qty} {t('sales.units_sold')}
                            </p>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
