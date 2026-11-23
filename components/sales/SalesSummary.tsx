/**
 * @module components/sales/SalesSummary
 * @description KPI Summary cards for Net Sales, Average Ticket, Labor Cost %, and Food Cost % / Prime Cost.
 * @businessRules
 * - Calculates Average Ticket = Net Sales / Order Count safely with 0 division guard.
 * - Displays Prime Cost = Labor % + Food Cost % only when valid Food Cost % > 0 is loaded.
 * - Unified semantic styling badges using shared thresholds: critical (>35%), warning (32-35%), and healthy (<=32%).
 * @dataFlow
 * - Props (data, foodCost) -> Framer Motion Cards -> UI Grid.
 * @notes
 * - RESPONSIVE: el monto principal usa `FitValue` (container query) para no salirse de la tarjeta en teléfonos; 2 columnas en vertical, 3-4 en horizontal y escritorio.
 * - [2026-11-23] Guardias contra `0.0%` falso verde (`costPercentage > 0`), `Number.isFinite`, claves `id` estables y grid dinámico 3 vs 4 columnas.
 */
'use client'

import React from 'react'
import { DollarSign, ShoppingBag, Clock, UtensilsCrossed, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import { FOOD_COST_HEALTHY_MAX, FOOD_COST_WARNING_MAX, formatSignedUSD } from '@/lib/inventory/food-cost-sales-resolver'
import FitValue from './FitValue'

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

const formatCurrency = (value: number) => formatSignedUSD(value, { decimals: 2 })

export default function SalesSummary({ data, foodCost }: SummaryProps) {
    const { t } = useLanguage()

    const netSales = Number.isFinite(Number(data?.netSales)) ? Number(data?.netSales) : 0
    const grossSales = Number.isFinite(Number(data?.grossSales)) ? Number(data?.grossSales) : 0
    const orderCount = Number.isFinite(Number(data?.orderCount)) ? Number(data?.orderCount) : 0
    const guestCount = Number.isFinite(Number(data?.guestCount)) ? Number(data?.guestCount) : 0
    const laborCost = Number.isFinite(Number(data?.laborCost)) ? Number(data?.laborCost) : 0
    const rawLaborPct = Number(data?.laborPercentage ?? 0)
    const laborPercentage = Number.isFinite(rawLaborPct) ? rawLaborPct : 0

    // Calculate derived metrics
    const avgTicket = orderCount > 0 ? netSales / orderCount : 0

    // Food Cost data — strictly require totalCost > 0 AND costPercentage > 0 (never render fake green 0.0%)
    const rawFcPct = Number(foodCost?.costPercentage ?? 0)
    const fcPct = Number.isFinite(rawFcPct) ? rawFcPct : 0
    const rawFcCost = Number(foodCost?.totalCost ?? 0)
    const fcCost = Number.isFinite(rawFcCost) ? rawFcCost : 0
    const hasFoodCost = Boolean(foodCost && !foodCost.loading && fcCost > 0 && fcPct > 0)
    const isFcHigh = fcPct > FOOD_COST_WARNING_MAX
    const isFcWarning = fcPct > FOOD_COST_HEALTHY_MAX && fcPct <= FOOD_COST_WARNING_MAX

    // Prime Cost = Labor % + Food Cost %
    const primeCostPct = hasFoodCost ? laborPercentage + fcPct : 0

    const cards = [
        {
            id: 'net_sales',
            title: t('sales.summary.net_sales'),
            value: formatCurrency(netSales),
            subValue: `${t('sales.summary.gross')}: ${formatCurrency(grossSales)}`,
            icon: DollarSign,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
        },
        {
            id: 'avg_ticket',
            title: t('sales.summary.avg_ticket'),
            value: formatCurrency(avgTicket),
            subValue: `${orderCount.toLocaleString('en-US')} ${t('sales.summary.orders')} · ${guestCount.toLocaleString('en-US')} ${t('sales.summary.guests')}`,
            icon: ShoppingBag,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20'
        },
        {
            id: 'labor_cost',
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

    const foodCostCard = hasFoodCost ? {
        id: 'food_cost',
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
        id: 'food_cost',
        title: t('sales.summary.food_cost'),
        value: '...',
        subValue: t('sales.summary.fc_loading'),
        icon: UtensilsCrossed,
        color: 'text-slate-400',
        bg: 'bg-slate-500/10',
        border: 'border-slate-500/20'
    } : null

    const allCards = foodCostCard ? [...cards, foodCostCard] : cards
    const gridColsClass = allCards.length === 3
        ? 'grid-cols-2 sm:landscape:grid-cols-3 lg:grid-cols-3'
        : 'grid-cols-2 sm:landscape:grid-cols-4 lg:grid-cols-4'

    return (
        <div className={`grid ${gridColsClass} gap-2.5 sm:gap-4 short:gap-2 mb-4 sm:mb-6 short:mb-3`}>
            {allCards.map((card, index) => (
                <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`relative min-w-0 p-3 sm:p-5 short:p-2.5 rounded-2xl sm:rounded-3xl short:rounded-2xl border ${card.border} ${card.bg} backdrop-blur-xl overflow-hidden shadow-lg shadow-black/5`}
                >
                    <div className="flex justify-between items-start mb-1 sm:mb-2 short:mb-0.5">
                        <div className={`p-2 sm:p-2.5 short:p-1.5 rounded-xl sm:rounded-2xl short:rounded-lg bg-white/20 dark:bg-white/5 ${card.color}`}>
                            <card.icon className="w-4 h-4 sm:w-5 sm:h-5 short:w-3.5 short:h-3.5" />
                        </div>
                    </div>

                    <div className="mt-1 sm:mt-2 short:mt-0.5 relative z-10 min-w-0">
                        <p className="text-[10px] sm:text-sm short:text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider sm:tracking-widest short:tracking-wider mb-1 short:mb-0.5 leading-tight break-words">
                            {card.title}
                        </p>
                        <h3 className="text-slate-900 dark:text-white">
                            <FitValue
                                text={card.value}
                                maxPx={30}
                                minPx={13}
                                className={`font-semibold tracking-tighter lg:[--fit-max:36px] short:[--fit-max:24px] ${
                                    card.icon === AlertTriangle ? 'text-rose-500 dark:text-rose-400' : ''
                                }`}
                            />
                        </h3>
                        {card.subValue && (
                            <p className="text-[11px] sm:text-sm short:text-[11px] text-slate-600 dark:text-slate-400 font-mono font-bold mt-1 short:mt-0.5 break-words leading-snug">
                                {card.subValue}
                            </p>
                        )}
                        {'secondarySubValue' in card && card.secondarySubValue && (
                            <p className={`text-[11px] sm:text-xs short:text-[11px] font-semibold mt-0.5 break-words leading-snug ${
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
