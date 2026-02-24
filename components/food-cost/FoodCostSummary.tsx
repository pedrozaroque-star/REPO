'use client'

import React from 'react'
import { DollarSign, Tag, TrendingUp, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

interface FoodCostSummaryProps {
    data: {
        totalSales: number
        totalCost: number
        totalQuantity: number
        totalExtras: number
        totalDiscounts: number
    }
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value)
}

export default function FoodCostSummary({ data }: FoodCostSummaryProps) {
    const { t } = useLanguage()

    const costPercentage = data.totalSales > 0 ? (data.totalCost / data.totalSales) * 100 : 0
    const isCostHigh = costPercentage > 35

    const cards = [
        {
            title: t('food_cost.table.net_sales'),
            value: formatCurrency(data.totalSales),
            subValue: `${data.totalQuantity.toLocaleString('en-US')} ${t('sales.summary.orders')}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
        },
        {
            title: `${t('food_cost.table.theo_cost')} Total`,
            value: formatCurrency(data.totalCost),
            subValue: `Base + Modifiers`,
            icon: Tag,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20'
        },
        {
            title: t('food_cost.table.cost_pct'),
            value: `${costPercentage.toFixed(1)}%`,
            subValue: isCostHigh ? 'Critical Level' : 'Healthy Range',
            icon: isCostHigh ? AlertTriangle : TrendingUp,
            color: isCostHigh ? 'text-rose-500' : 'text-emerald-500',
            bg: isCostHigh ? 'bg-rose-500/10' : 'bg-emerald-500/10',
            border: isCostHigh ? 'border-rose-500/20' : 'border-emerald-500/20'
        },
        {
            title: `${t('food_cost.table.extras')} / ${t('food_cost.table.discounts')}`,
            value: `+${formatCurrency(data.totalExtras)}`,
            subValue: `Desc: -${formatCurrency(data.totalDiscounts)}`,
            icon: DollarSign,
            color: 'text-purple-400',
            bg: 'bg-purple-500/10',
            border: 'border-purple-500/20'
        }
    ]

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {cards.map((card, index) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`relative p-5 rounded-3xl border ${card.border} ${card.bg} backdrop-blur-xl overflow-hidden shadow-lg shadow-black/5 flex flex-col`}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className={`p-2.5 rounded-2xl bg-white/20 dark:bg-white/5 ${card.color}`}>
                            <card.icon size={20} />
                        </div>
                    </div>

                    <div className="mt-2 relative z-10">
                        <p className="text-[10px] sm:text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-1 truncate">
                            {card.title}
                        </p>
                        <h3 className={`text-2xl sm:text-3xl lg:text-4xl font-semibold text-slate-900 dark:text-white tracking-tighter truncate ${card.icon === AlertTriangle ? 'text-rose-500 dark:text-rose-400' : ''}`}>
                            {card.value}
                        </h3>
                        {card.subValue && (
                            <p className={`text-xs font-mono font-bold mt-1 ${card.icon === AlertTriangle ? 'text-rose-500 dark:text-rose-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                {card.subValue}
                            </p>
                        )}
                    </div>

                    {/* Decorative glow */}
                    <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full blur-3xl opacity-20 dark:opacity-30 ${card.color.replace('text-', 'bg-')}`} />
                </motion.div>
            ))}
        </div>
    )
}
