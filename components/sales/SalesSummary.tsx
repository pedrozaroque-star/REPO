/**
 * @module components/sales/SalesSummary
 * @description KPI Summary cards for Net Sales, Average Ticket, Labor Cost %, and Food Cost % / Prime Cost.
 * @businessRules
 * - Calculates Average Ticket = Net Sales / Order Count safely with 0 division guard.
 * - Displays Prime Cost = Labor % + Food Cost % when food cost theoretical data is loaded.
 * - Semantic styling badges for critical (>35%), warning (32-35%), and healthy (<32%) food costs.
 * @dataFlow
 * - Props (data, foodCost) -> Framer Motion Cards -> UI Grid.
 */
'use client'

import React from 'react'
import { DollarSign, ShoppingBag, Clock, UtensilsCrossed, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'

interface SummaryProps {
    data?: {
        netSales?: number
        grossSales?: number
        discounts?: number
        tips?: number
        taxes?: number
        orderCount?: number
        guestCount?: number
        laborCost?: number
        laborPercentage?: number
    } | null
    foodCost?: {
        totalCost: number
        costPercentage: number
        loading: boolean
    } | null
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value)
}

export default function SalesSummary({ data, foodCost }: SummaryProps) {
    const { t } = useLanguage()

    const netSales = data?.netSales ?? 0
    const grossSales = data?.grossSales ?? 0
    const orderCount = data?.orderCount ?? 0
    const guestCount = data?.guestCount ?? 0
    const laborCost = data?.laborCost ?? 0
    const laborPercentage = Number(data?.laborPercentage ?? 0)

    // Calculate derived metrics
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0

    // Food Cost data
    const hasFoodCost = foodCost && !foodCost.loading && foodCost.totalCost > 0
    const fcPct = foodCost?.costPercentage ?? 0
    const fcCost = foodCost?.totalCost ?? 0
    const isFcHigh = fcPct > 35
    const isFcWarning = fcPct > 32 && fcPct <= 35

    // Prime Cost = Labor % + Food Cost %
    const primeCostPct = hasFoodCost ? laborPercentage + fcPct : 0

    const cards = [
        {
            title: t('sales.summary.net_sales'),
            value: formatCurrency(netSales),
            subValue: `${t('sales.summary.gross')}: ${formatCurrency(grossSales)}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
        },
        {
            title: t('sales.summary.avg_ticket'),
            value: formatCurrency(avgTicket),
            subValue: `${orderCount.toLocaleString('en-US')} ${t('sales.summary.orders')} · ${guestCount.toLocaleString('en-US')} ${t('sales.summary.guests')}`,
            icon: ShoppingBag,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20'
        },
        {
            title: t('sales.summary.labor_cost'),
            value: `${laborPercentage.toFixed(2)}%`,
            subValue: formatCurrency(laborCost),
            secondarySubValue: hasFoodCost ? `${t('sales.prime_cost')}: ${primeCostPct.toFixed(1)}%` : undefined,
            status: 'prime',
            icon: Clock,
            color: 'text-orange-400',
            bg: 'bg-orange-500/10',
            border: 'border-orange-500/20'
        }
    ]

    // Build the Food Cost card dynamically based on data availability
    const foodCostCard = hasFoodCost ? {
        title: t('sales.summary.food_cost'),
        value: `${fcPct.toFixed(1)}%`,
        subValue: `${t('sales.summary.theo_cost')}: ${formatCurrency(fcCost)}`,
        secondarySubValue: isFcHigh ? t('sales.summary.fc_critical') : isFcWarning ? t('sales.summary.fc_warning') : t('sales.summary.fc_healthy'),
        status: isFcHigh ? 'critical' : isFcWarning ? 'warning' : 'healthy',
        icon: isFcHigh ? AlertTriangle : UtensilsCrossed,
        color: isFcHigh ? 'text-rose-500' : isFcWarning ? 'text-yellow-500' : 'text-teal-500',
        bg: isFcHigh ? 'bg-rose-500/10' : isFcWarning ? 'bg-yellow-500/10' : 'bg-teal-500/10',
        border: isFcHigh ? 'border-rose-500/20' : isFcWarning ? 'border-yellow-500/20' : 'border-teal-500/20'
    } : foodCost?.loading ? {
        title: t('sales.summary.food_cost'),
        value: '...',
        subValue: t('sales.summary.fc_loading'),
        icon: UtensilsCrossed,
        color: 'text-slate-400',
        bg: 'bg-slate-500/10',
        border: 'border-slate-500/20'
    } : null

    // Combine cards: 3 base + food cost = always 4 cards
    const allCards = foodCostCard ? [...cards, foodCostCard] : cards

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {allCards.map((card, index) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`relative p-5 rounded-3xl border ${card.border} ${card.bg} backdrop-blur-xl overflow-hidden shadow-lg shadow-black/5`}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className={`p-2.5 rounded-2xl bg-white/20 dark:bg-white/5 ${card.color}`}>
                            <card.icon size={20} />
                        </div>
                    </div>

                    <div className="mt-2 relative z-10">
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-1">
                            {card.title}
                        </p>
                        <h3 className={`text-3xl lg:text-4xl font-semibold text-slate-900 dark:text-white tracking-tighter ${
                            card.icon === AlertTriangle ? 'text-rose-500 dark:text-rose-400' : ''
                        }`}>
                            {card.value}
                        </h3>
                        {card.subValue && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-mono font-bold mt-1">
                                {card.subValue}
                            </p>
                        )}
                        {'secondarySubValue' in card && card.secondarySubValue && (
                            <p className={`text-xs font-semibold mt-0.5 ${
                                card.status === 'critical'
                                    ? 'text-rose-500 dark:text-rose-400' 
                                    : card.status === 'prime'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : card.status === 'warning'
                                            ? 'text-yellow-600 dark:text-yellow-400'
                                            : 'text-emerald-600 dark:text-emerald-400'
                            }`}>
                                {card.secondarySubValue}
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
