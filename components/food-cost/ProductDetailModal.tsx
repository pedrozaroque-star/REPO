'use client'

import React, { useEffect, useState } from 'react'
import { X, ChefHat, DollarSign, TrendingDown, Sparkles, AlertTriangle, Package } from 'lucide-react'

interface RecipeBreakdownItem {
    itemName: string
    quantity: number
    unit: string
    yieldPercent: number
    cost: number
    isMissingPrice: boolean
}

interface ProductItem {
    guid: string
    name: string
    group_name?: string
    quantity: number
    net_sales: number
    gross_sales: number
    discounts: number
    unit_price: number
    total_modifier_cost: number // extras revenue per unit
    unit_cost: number
    total_cost: number
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
    modifier_guids?: string[]
}

interface ProductDetailModalProps {
    item: ProductItem | null
    onClose: () => void
}

export default function ProductDetailModal({ item, onClose }: ProductDetailModalProps) {
    const [recipeData, setRecipeData] = useState<{
        has_recipe: boolean
        breakdown: RecipeBreakdownItem[]
        total_cost: number
        match_method: string
        missing_prices: number
    } | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!item) return
        setLoading(true)
        const params = new URLSearchParams()
        params.append('guid', item.guid)
        params.append('name', item.name)
        params.append('quantity', item.quantity.toString())

        if (item.modifier_guids && item.modifier_guids.length > 0) {
            params.append('modifiers', item.modifier_guids.join(','))
        }

        fetch(`/api/inventory/recipe-detail?${params.toString()}`)
            .then(r => r.json())
            .then(data => setRecipeData(data))
            .catch(() => setRecipeData(null))
            .finally(() => setLoading(false))
    }, [item])

    if (!item) return null

    // Revenue breakdown (per unit)
    const pricePerUnit = item.unit_price
    const discountPerUnit = item.quantity > 0 ? item.discounts / item.quantity : 0
    const extrasPerUnit = item.total_modifier_cost
    const netPerUnit = item.quantity > 0 ? item.net_sales / item.quantity : 0
    const costPerUnit = item.unit_cost
    const profitPerUnit = netPerUnit - costPerUnit

    // Totals
    const totalExtras = extrasPerUnit * item.quantity
    const totalProfit = item.net_sales - item.total_cost

    const profitMargin = item.net_sales > 0 ? (totalProfit / item.net_sales) * 100 : 0
    const costPercent = item.food_cost_percent

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Modal */}
            <div
                className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-800 dark:to-slate-950 px-5 py-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="font-bold text-white text-base md:text-lg leading-tight truncate">{item.name}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded">{item.group_name || 'N/A'}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{item.guid.slice(0, 8)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors shrink-0 mt-0.5">
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="overflow-y-auto flex-1 styled-scrollbar">
                    {/* ═══ Revenue Section ═══ */}
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
                            <DollarSign size={13} /> Revenue per Unit (Ingreso por Unidad)
                        </h3>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-600 dark:text-slate-400">Precio Base</span>
                                <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                                    ${pricePerUnit.toFixed(2)}
                                </span>
                            </div>
                            {discountPerUnit > 0 && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
                                        <TrendingDown size={13} className="text-rose-400" /> Descuentos
                                    </span>
                                    <span className="font-mono font-bold text-rose-500 text-sm">
                                        -${discountPerUnit.toFixed(2)}
                                    </span>
                                </div>
                            )}
                            {extrasPerUnit > 0 && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1">
                                        <Sparkles size={13} className="text-blue-400" /> Extras / Modifiers
                                    </span>
                                    <span className="font-mono font-bold text-blue-500 text-sm">
                                        +${extrasPerUnit.toFixed(2)}
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200 dark:border-slate-700">
                                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">= Venta Neta / Unit</span>
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                    ${netPerUnit.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ═══ Recipe Section ═══ */}
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
                            <ChefHat size={13} /> Receta — Costo Teórico / Unit
                        </h3>

                        {loading ? (
                            <div className="flex items-center gap-2 py-4 text-slate-400">
                                <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"></div>
                                <span className="text-sm">Cargando receta...</span>
                            </div>
                        ) : recipeData?.has_recipe ? (
                            <div className="space-y-1.5">
                                {recipeData.breakdown.map((ing, i) => (
                                    <div key={i} className="flex justify-between items-center py-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <Package size={12} className={ing.isMissingPrice ? 'text-yellow-400' : 'text-slate-400'} />
                                            <div className="min-w-0">
                                                <span className={`text-sm truncate block ${ing.isMissingPrice ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                                    {ing.itemName}
                                                </span>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                                    {ing.quantity.toFixed(2)} {ing.unit}
                                                    {ing.yieldPercent < 100 && ` (${ing.yieldPercent}% yield)`}
                                                </span>
                                            </div>
                                        </div>
                                        <span className={`font-mono text-xs font-bold shrink-0 ${ing.isMissingPrice ? 'text-yellow-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {ing.isMissingPrice ? '⚠ $0.00' : `$${ing.cost.toFixed(4)}`}
                                        </span>
                                    </div>
                                ))}
                                <div className="flex justify-between items-center pt-2 mt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">= Costo por Unidad</span>
                                    <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                                        ${costPerUnit.toFixed(2)}
                                    </span>
                                </div>
                                {recipeData.missing_prices > 0 && (
                                    <div className="flex items-center gap-1.5 mt-1 text-yellow-600 dark:text-yellow-400 text-[10px] font-medium">
                                        <AlertTriangle size={11} />
                                        {recipeData.missing_prices} ingrediente(s) sin precio
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="py-4 text-center">
                                <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
                                    <AlertTriangle size={14} /> Sin receta asignada
                                </span>
                            </div>
                        )}
                    </div>

                    {/* ═══ Profit Summary ═══ */}
                    <div className="px-5 py-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center gap-1.5">
                            📊 Resumen de Rentabilidad ({item.quantity.toLocaleString()} vendidos)
                        </h3>

                        <div className="grid grid-cols-2 gap-3">
                            {/* Total Revenue */}
                            <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-3 border border-emerald-100 dark:border-emerald-500/20">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70">Venta Neta</span>
                                <p className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-lg mt-0.5">
                                    ${item.net_sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                            </div>
                            {/* Total Cost */}
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500/70">Costo Total</span>
                                <p className="font-mono font-bold text-slate-800 dark:text-slate-200 text-lg mt-0.5">
                                    ${item.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                            </div>
                            {/* Profit */}
                            <div className={`rounded-xl p-3 border ${totalProfit >= 0
                                ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20'
                                : 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20'
                                }`}>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500/70">Ganancia</span>
                                <p className={`font-mono font-bold text-lg mt-0.5 ${totalProfit >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                    ${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                            </div>
                            {/* Cost % */}
                            <div className={`rounded-xl p-3 border ${costPercent > 40
                                ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'
                                : costPercent > 30
                                    ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20'
                                    : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20'
                                }`}>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500/70">Food Cost %</span>
                                <p className={`font-mono font-bold text-lg mt-0.5 ${costPercent > 40 ? 'text-rose-700 dark:text-rose-400' : costPercent > 30 ? 'text-yellow-700 dark:text-yellow-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                    {costPercent.toFixed(1)}%
                                </p>
                            </div>
                        </div>

                        {/* Extras & Discounts totals bar */}
                        {(item.discounts > 0 || totalExtras > 0) && (
                            <div className="mt-3 flex items-center gap-3 text-[10px] font-medium">
                                {item.discounts > 0 && (
                                    <span className="text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-2 py-1 rounded border border-rose-200 dark:border-rose-500/20">
                                        Desc: -${item.discounts.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                )}
                                {totalExtras > 0 && (
                                    <span className="text-blue-500 bg-blue-50 dark:bg-blue-500/10 px-2 py-1 rounded border border-blue-200 dark:border-blue-500/20">
                                        Extras: +${totalExtras.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
