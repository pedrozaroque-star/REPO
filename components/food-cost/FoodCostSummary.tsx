'use client'

/**
 * @module components/food-cost/FoodCostSummary
 * @description Tarjetas ejecutivas de resumen para el módulo Food Cost de Tacos Gavilan.
 *   Muestra Ventas Netas, Food Cost puro ($ y %), Empaque / Desechables ($ y %) separado,
 *   consumo de Carne Asada (lbs crudas y $ USD), y Extras / Descuentos.
 *
 * @businessRules
 * - Semáforo corporativo oficial (`getFoodCostStatus` de `lib/inventory/food-cost-sales-resolver.ts`):
 *   • Saludable (`<= 32%`): Verde esmeralda
 *   • Alerta (`> 32%` y `<= 35%`): Ámbar
 *   • Crítico (`> 35%`): Rojo (`rose`)
 * - Food Cost y Empaque/Packaging se muestran estrictamente por separado (nunca mezclados).
 * - Protegido contra divisiones `0/0`, `NaN` e `Infinity`.
 *
 * @dataFlow
 * - Props (`data`) desde `/admin/food-cost` o `/admin/food-cost/[storeId]` -> Tarjetas KPI animadas.
 *
 * @notes
 * - [2026-11-23] Unificados umbrales `<=32% / 32-35% / >35%`, separado Empaque de Food Cost y añadida tarjeta dedicada de Carne Asada.
 */

import React from 'react'
import { DollarSign, ShoppingBag, TrendingUp, AlertTriangle, Beef, UtensilsCrossed } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLanguage } from '@/lib/i18n'
import {
    calculateSafeFoodCostPct,
    calculateSafePackagingCostPct,
    getFoodCostStatus,
} from '@/lib/inventory/food-cost-sales-resolver'

export interface FoodCostSummaryData {
    totalSales: number
    totalCost: number
    totalPackagingCost?: number
    totalAsadaLbs?: number
    totalAsadaCost?: number
    totalMeatLbs?: number
    totalQuantity: number
    totalExtras: number
    totalDiscounts: number
}

interface FoodCostSummaryProps {
    data: FoodCostSummaryData
}

const formatCurrency = (value: number) => {
    const safe = Number.isFinite(value) ? value : 0
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(safe)
}

export default function FoodCostSummary({ data }: FoodCostSummaryProps) {
    const { t } = useLanguage()

    const safeSales = Number.isFinite(data.totalSales) ? data.totalSales : 0
    const safeFoodCost = Number.isFinite(data.totalCost) ? data.totalCost : 0
    const safePackagingCost = Number.isFinite(data.totalPackagingCost ?? 0) ? (data.totalPackagingCost ?? 0) : 0
    const safeAsadaLbs = Number.isFinite(data.totalAsadaLbs ?? 0) ? (data.totalAsadaLbs ?? 0) : 0
    const safeAsadaCost = Number.isFinite(data.totalAsadaCost ?? 0) ? (data.totalAsadaCost ?? 0) : 0
    const safeMeatLbs = Number.isFinite(data.totalMeatLbs ?? 0) ? (data.totalMeatLbs ?? 0) : 0
    const safeQty = Number.isFinite(data.totalQuantity) ? data.totalQuantity : 0
    const safeExtras = Number.isFinite(data.totalExtras) ? data.totalExtras : 0
    const safeDiscounts = Number.isFinite(data.totalDiscounts) ? data.totalDiscounts : 0

    const costPercentage = calculateSafeFoodCostPct(safeFoodCost, safeSales)
    const packagingPercentage = calculateSafePackagingCostPct(safePackagingCost, safeSales)
    const fcStatus = safeSales > 0 && safeFoodCost > 0 ? getFoodCostStatus(costPercentage) : 'healthy'

    const fcStyles = fcStatus === 'critical'
        ? {
            label: t('food_cost.critical_range'),
            icon: AlertTriangle,
            color: 'text-rose-500',
            valueColor: 'text-rose-600 dark:text-rose-400',
            subColor: 'text-rose-600 dark:text-rose-400',
            bg: 'bg-rose-500/10',
            border: 'border-rose-500/25'
        }
        : fcStatus === 'warning'
            ? {
                label: t('food_cost.warning_range'),
                icon: AlertTriangle,
                color: 'text-amber-500',
                valueColor: 'text-amber-600 dark:text-amber-400',
                subColor: 'text-amber-600 dark:text-amber-400',
                bg: 'bg-amber-500/10',
                border: 'border-amber-500/25'
            }
            : {
                label: t('food_cost.healthy_range'),
                icon: TrendingUp,
                color: 'text-emerald-500',
                valueColor: 'text-slate-900 dark:text-white',
                subColor: 'text-emerald-600 dark:text-emerald-400',
                bg: 'bg-emerald-500/10',
                border: 'border-emerald-500/20'
            }

    const cards = [
        {
            id: 'net_sales',
            title: t('food_cost.table.net_sales'),
            value: formatCurrency(safeSales),
            subValue: `${safeQty.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${t('food_cost.units_sold')}`,
            secondarySub: safeDiscounts > 0 ? `Desc: -${formatCurrency(safeDiscounts)}` : undefined,
            icon: DollarSign,
            color: 'text-emerald-500',
            valueColor: 'text-slate-900 dark:text-white',
            subColor: 'text-slate-600 dark:text-slate-400',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
        },
        {
            id: 'food_cost',
            title: t('food_cost.food_cost_label'),
            value: safeSales > 0 ? `${costPercentage.toFixed(1)}%` : formatCurrency(safeFoodCost),
            subValue: formatCurrency(safeFoodCost),
            secondarySub: safeSales > 0 && safeFoodCost > 0 ? fcStyles.label : undefined,
            icon: fcStyles.icon,
            color: fcStyles.color,
            valueColor: fcStyles.valueColor,
            subColor: fcStyles.subColor,
            bg: fcStyles.bg,
            border: fcStyles.border
        },
        {
            id: 'packaging_cost',
            title: t('food_cost.packaging_label'),
            value: safeSales > 0 ? `${packagingPercentage.toFixed(1)}%` : formatCurrency(safePackagingCost),
            subValue: formatCurrency(safePackagingCost),
            secondarySub: safeExtras > 0 ? `Extras: +${formatCurrency(safeExtras)}` : undefined,
            icon: ShoppingBag,
            color: 'text-sky-500',
            valueColor: 'text-slate-900 dark:text-white',
            subColor: 'text-sky-600 dark:text-sky-400',
            bg: 'bg-sky-500/10',
            border: 'border-sky-500/20'
        },
        {
            id: 'carne_asada',
            title: t('food_cost.asada_label'),
            value: `${safeAsadaLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs`,
            subValue: formatCurrency(safeAsadaCost),
            secondarySub: safeMeatLbs > 0
                ? `Total 8 carnes: ${safeMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs`
                : `${(safeAsadaLbs / 10).toFixed(1)} bolsas (10 lb)`,
            icon: Beef,
            color: 'text-orange-500',
            valueColor: 'text-slate-900 dark:text-white',
            subColor: 'text-orange-600 dark:text-orange-400',
            bg: 'bg-orange-500/10',
            border: 'border-orange-500/20'
        }
    ]

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {cards.map((card, index) => (
                <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
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
                        <h3 className={`text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tighter truncate ${card.valueColor}`}>
                            {card.value}
                        </h3>
                        {card.subValue && (
                            <p className={`text-xs font-mono font-bold mt-1 ${card.subColor}`}>
                                {card.subValue}
                            </p>
                        )}
                        {card.secondarySub && (
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                {card.secondarySub}
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
