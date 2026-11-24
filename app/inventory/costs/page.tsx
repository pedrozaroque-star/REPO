'use client'

/**
 * @module app/inventory/costs/page
 * @description Reporte teórico de márgenes y costos por platillo (`/inventory/costs`) para Tacos Gavilan.
 *   Muestra Food Cost ($ y %) y Empaque ($ y %) estrictamente separados con el semáforo oficial unificado.
 *
 * @businessRules
 * - Semáforo canónico (`getFoodCostStatus` de `lib/inventory/food-cost-sales-resolver.ts`):
 *   • `<= 32%`: Saludable (Verde)
 *   • `> 32%` y `<= 35%`: Alerta (Ámbar)
 *   • `> 35%`: Crítico (Rojo)
 * - `foodCostPercent` refleja exclusivamente materia prima alimentaria (`foodCost / price * 100`);
 *   el empaque (`packagingCost` / `packagingPercent`) se reporta en su propia columna.
 * - Guardia estricta contra `0/0` (`NaN%`) cuando `totalItems === 0` o `mappedItems === 0`.
 *
 * @dataFlow
 * - `GET /api/inventory/costs` -> filtros / ordenamiento client-side -> tabla bilingüe.
 *
 * @notes
 * - [2026-11-23] Unificados umbrales `<=32% / 32-35% / >35%`, separadas columnas Food Cost vs Empaque y blindado `0/0`.
 */

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import { getFoodCostStatus } from '@/lib/inventory/food-cost-sales-resolver'
import {
    TrendingUp,
    Search,
    RefreshCw,
    ChevronDown,
    ChevronUp
} from 'lucide-react'

interface CostItem {
    guid: string
    name: string
    group_name: string
    price: number
    foodCost?: number
    theoreticalCost: number
    packagingCost?: number
    foodCostPercent: number
    packagingPercent?: number
    margin: number
    hasRecipe: boolean
    ingredientsCount: number
    missingPrices: number
}

export default function CostReportPage() {
    const [items, setItems] = useState<CostItem[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')
    const [sortConfig, setSortConfig] = useState<{ key: keyof CostItem | '', direction: 'asc' | 'desc' }>({ key: 'foodCostPercent', direction: 'desc' })
    const { t } = useLanguage()

    useEffect(() => {
        fetchReport()
    }, [])

    async function fetchReport() {
        setLoading(true)
        try {
            const res = await fetch('/api/inventory/costs')
            const json = await res.json()
            if (json.data) {
                setItems(json.data)
            }
        } catch (e) {
            console.error('Error loading report', e)
        } finally {
            setLoading(false)
        }
    }

    const sortData = (data: CostItem[]) => {
        if (!sortConfig.key) return data

        return [...data].sort((a, b) => {
            const valA = a[sortConfig.key as keyof CostItem] ?? 0
            const valB = b[sortConfig.key as keyof CostItem] ?? 0

            if (valA < valB) {
                return sortConfig.direction === 'asc' ? -1 : 1
            }
            if (valA > valB) {
                return sortConfig.direction === 'asc' ? 1 : -1
            }
            return 0
        })
    }

    const requestSort = (key: keyof CostItem) => {
        let direction: 'asc' | 'desc' = 'asc'
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc'
        }
        setSortConfig({ key, direction })
    }

    const filteredItems = items.filter(item =>
        item.name.toLowerCase().includes(filter.toLowerCase()) ||
        item.group_name?.toLowerCase().includes(filter.toLowerCase())
    )

    const sortedItems = sortData(filteredItems)

    // KPI Calculations (strictly guarded against 0/0 NaN%)
    const totalItems = items.length
    const mappedWithPrice = items.filter(i => i.hasRecipe && i.price > 0 && i.foodCostPercent > 0)
    const mappedItems = items.filter(i => i.hasRecipe).length
    const avgFoodCost = mappedWithPrice.length > 0
        ? mappedWithPrice.reduce((acc, curr) => acc + (curr.foodCostPercent || 0), 0) / mappedWithPrice.length
        : 0
    const itemsWithPkg = items.filter(i => (i.packagingPercent ?? 0) > 0)
    const avgPkgCost = itemsWithPkg.length > 0
        ? itemsWithPkg.reduce((acc, curr) => acc + (curr.packagingPercent || 0), 0) / itemsWithPkg.length
        : 0
    const coveragePct = totalItems > 0 ? Math.round((mappedItems / totalItems) * 100) : 0
    const avgStatus = getFoodCostStatus(avgFoodCost)

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">

            <FoodCostNavigationTabs />

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <TrendingUp className="text-emerald-500" />
                        {t('inventory_costs.title')}
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        {t('inventory_costs.subtitle')}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-white dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-3">
                        <div className="text-right">
                            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t('inventory_costs.avg_cost')}</p>
                            <p className={`text-lg font-bold ${
                                avgStatus === 'critical' ? 'text-rose-600' : avgStatus === 'warning' ? 'text-amber-500' : 'text-emerald-500'
                            }`}>
                                {avgFoodCost.toFixed(1)}%
                            </p>
                        </div>
                        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                        <div className="text-right">
                            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t('inventory_costs.avg_packaging')}</p>
                            <p className="text-lg font-bold text-sky-600 dark:text-sky-400">
                                {avgPkgCost.toFixed(1)}%
                            </p>
                        </div>
                        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700"></div>
                        <div className="text-right">
                            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t('inventory_costs.recipe_coverage')}</p>
                            <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                {coveragePct}%
                            </p>
                        </div>
                    </div>
                    <button onClick={fetchReport} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title={t('sales.refresh')}>
                        <RefreshCw size={20} className={`text-slate-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                    type="text"
                    placeholder={t('inventory_costs.search_placeholder')}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
            </div>

            {/* Main Table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th onClick={() => requestSort('name')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center gap-1">{t('inventory_costs.col_item')} {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('price')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-end gap-1">{t('inventory_costs.col_sale_price')} {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('theoreticalCost')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-end gap-1">{t('inventory_costs.col_theo_cost')} {sortConfig.key === 'theoreticalCost' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('packagingCost')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-end gap-1">{t('inventory_costs.col_packaging')} {sortConfig.key === 'packagingCost' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('margin')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-end gap-1">{t('inventory_costs.col_margin')} {sortConfig.key === 'margin' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('foodCostPercent')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-center gap-1">{t('inventory_costs.col_food_cost')} {sortConfig.key === 'foodCostPercent' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th onClick={() => requestSort('packagingPercent')} className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center justify-center gap-1">{t('inventory_costs.col_packaging_pct')} {sortConfig.key === 'packagingPercent' && (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</div>
                                </th>
                                <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-300 text-center">{t('inventory_costs.col_status')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-48"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16 ml-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16 ml-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16 ml-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16 ml-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12 mx-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-12 mx-auto"></div></td>
                                        <td className="px-5 py-4"><div className="h-6 bg-slate-200 dark:bg-slate-700 rounded-full w-20 mx-auto"></div></td>
                                    </tr>
                                ))
                            ) : sortedItems.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                        {t('inventory_costs.no_data')}
                                    </td>
                                </tr>
                            ) : (
                                sortedItems.map((item, idx) => {
                                    const foodCostVal = item.foodCost ?? item.theoreticalCost ?? 0
                                    const pkgCostVal = item.packagingCost ?? 0
                                    const pkgPctVal = item.packagingPercent ?? 0
                                    const itemStatus = getFoodCostStatus(item.foodCostPercent)

                                    let badgeColor = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    let badgeText = t('inventory_costs.badge_no_recipe')

                                    if (item.hasRecipe) {
                                        if (item.missingPrices > 0) {
                                            badgeColor = 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                                            badgeText = t('inventory_costs.badge_missing_price')
                                        } else if (itemStatus === 'critical') {
                                            badgeColor = 'bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800'
                                            badgeText = t('inventory_costs.badge_critical')
                                        } else if (itemStatus === 'warning') {
                                            badgeColor = 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                                            badgeText = t('inventory_costs.badge_warning')
                                        } else {
                                            badgeColor = 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
                                            badgeText = t('inventory_costs.badge_optimal')
                                        }
                                    }

                                    return (
                                        <tr key={`${item.guid}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                            <td className="px-5 py-4">
                                                <div className="font-medium text-slate-900 dark:text-white">{item.name}</div>
                                                <div className="text-xs text-slate-400">{item.group_name}</div>
                                            </td>
                                            <td className="px-5 py-4 text-right font-mono text-slate-600 dark:text-slate-300">
                                                ${(item.price || 0).toFixed(2)}
                                            </td>
                                            <td className="px-5 py-4 text-right font-mono">
                                                {item.hasRecipe && foodCostVal > 0 ? (
                                                    <span className="text-slate-900 dark:text-white font-medium">${foodCostVal.toFixed(2)}</span>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-right font-mono">
                                                {pkgCostVal > 0 ? (
                                                    <span className="text-sky-600 dark:text-sky-400 font-medium">${pkgCostVal.toFixed(2)}</span>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-right font-mono">
                                                {item.hasRecipe && (foodCostVal > 0 || pkgCostVal > 0) ? (
                                                    <span className={item.margin < 0 ? 'text-rose-500 font-bold' : 'text-emerald-600 dark:text-emerald-400'}>
                                                        ${item.margin.toFixed(2)}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300">-</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-center font-mono">
                                                {item.hasRecipe && foodCostVal > 0 && item.price > 0 ? (
                                                    <span className={`font-bold ${
                                                        itemStatus === 'critical'
                                                            ? 'text-rose-600 dark:text-rose-400'
                                                            : itemStatus === 'warning'
                                                                ? 'text-amber-600 dark:text-amber-400'
                                                                : 'text-emerald-600 dark:text-emerald-400'
                                                    }`}>
                                                        {item.foodCostPercent.toFixed(1)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-center font-mono">
                                                {pkgPctVal > 0 && item.price > 0 ? (
                                                    <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                                                        {pkgPctVal.toFixed(1)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-center">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
                                                    {badgeText}
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
