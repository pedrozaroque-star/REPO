'use client'

/**
 * @module app/admin/food-cost/[storeId]/page
 * @description Detalle de Food Cost y Empaque a nivel producto para una sucursal específica de Tacos Gavilan.
 *
 * @businessRules
 * - Regla de las 6:00 AM (`America/Los_Angeles`) vía `getBusinessDateLA()`.
 * - Semáforo corporativo canónico (`getFoodCostStatus`): `<= 32%` verde, `> 32%–35%` ámbar, `> 35%` rojo crítico.
 * - Paridad con Resumen General: cuando no hay búsqueda de producto (`!filterTerm.trim()`), aplica `salesNetSales[storeIdParam]`
 *   al resumen de la tienda para cuadrar 1:1 con `/admin/food-cost`.
 * - Separa `Food Cost` (`total_cost`) y `Empaque` (`packaging_cost`) y pasa `storeName` real al `ProductDetailModal`.
 *
 * @dataFlow
 * - `GET /api/inventory/food-cost?storeId=X&startDate=Y&endDate=Z` -> `FoodCostSummary` + Tabla de productos + `ProductDetailModal`.
 *
 * @notes
 * - [2026-11-23] Corregido `useEffect` en rangos `custom`, fecha inicial LA 6:00 AM, hijack de `quantity desc`,
 *   botón Volver cuando se abre vía `_blank`, paridad `salesNetSales` y separación de Empaque.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp, Store, RefreshCw, ArrowUpDown, Search, CheckCircle2, ArrowLeft, Download } from 'lucide-react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'
import FoodCostSummary from '@/components/food-cost/FoodCostSummary'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import ProductDetailModal from '@/components/food-cost/ProductDetailModal'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { formatStoreName } from '@/lib/supabase'
import { useLanguage } from '@/lib/i18n'
import {
    getBusinessDateLA,
    addDaysIso,
    getMondayIso,
    getFoodCostStatus,
    calculateSafeFoodCostPct,
    calculateSafePackagingCostPct,
    escapeCsvCell,
} from '@/lib/inventory/food-cost-sales-resolver'

interface FoodCostItem {
    guid: string
    name: string
    group_name?: string
    quantity: number
    net_sales: number
    gross_sales: number
    discounts: number
    voided_quantity: number
    unit_price: number
    base_unit_cost: number
    total_modifier_cost: number
    unit_cost: number
    total_cost: number
    food_cost?: number
    packaging_cost?: number
    packaging_cost_percent?: number
    asada_raw_lbs?: number
    asada_cost?: number
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
    store_name?: string
    total_meat_lbs: number
    modifier_guids?: string[]
}

function getFcBadgeClasses(pct: number): string {
    const status = getFoodCostStatus(pct)
    if (status === 'critical') {
        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
    }
    if (status === 'warning') {
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
    }
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
}

function resolveInitialRange(periodParam: string | null, startParam: string | null, endParam: string | null): { start: string; end: string } {
    if (startParam && endParam) return { start: startParam, end: endParam }
    const today = getBusinessDateLA()
    const [y, m] = today.split('-').map(Number)
    switch (periodParam) {
        case 'yesterday': {
            const yest = addDaysIso(today, -1)
            return { start: yest, end: yest }
        }
        case 'week':
            return { start: getMondayIso(today), end: today }
        case 'last_week': {
            const thisMon = getMondayIso(today)
            return { start: addDaysIso(thisMon, -7), end: addDaysIso(thisMon, -1) }
        }
        case 'last_7':
            return { start: addDaysIso(today, -6), end: today }
        case 'month':
            return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: today }
        case 'last_month': {
            const prevMonthEnd = addDaysIso(`${y}-${String(m).padStart(2, '0')}-01`, -1)
            const [py, pm] = prevMonthEnd.split('-').map(Number)
            return { start: `${py}-${String(pm).padStart(2, '0')}-01`, end: prevMonthEnd }
        }
        case 'quarter': {
            const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1
            return { start: `${y}-${String(qStartMonth).padStart(2, '0')}-01`, end: today }
        }
        default:
            return { start: today, end: today }
    }
}

export default function StoreFoodCostDetail() {
    const { t } = useLanguage()
    const router = useRouter()
    const params = useParams()
    const searchParams = useSearchParams()

    const [loading, setLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState('')
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    const storeIdParam = params.storeId as string

    const initialRange = resolveInitialRange(
        searchParams.get('period'),
        searchParams.get('startDate'),
        searchParams.get('endDate')
    )

    const [period, setPeriod] = useState(searchParams.get('period') || 'today')
    const [startDate, setStartDate] = useState(initialRange.start)
    const [endDate, setEndDate] = useState(initialRange.end)
    const [filterTerm, setFilterTerm] = useState('')
    const [selectedProduct, setSelectedProduct] = useState<FoodCostItem | null>(null)

    const [data, setData] = useState<FoodCostItem[] | null>(null)
    const [storeName, setStoreName] = useState<string>('')
    const [salesNetSales, setSalesNetSales] = useState<Record<string, number> | null>(null)

    type SortKey = keyof FoodCostItem
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>({ key: 'total_cost', direction: 'desc' })

    const requestSort = (key: SortKey) => {
        let direction: 'asc' | 'desc' = 'desc'
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc'
        }
        setSortConfig({ key, direction })
    }

    const refreshData = React.useCallback(async () => {
        if (!storeIdParam || !startDate || !endDate) return
        setLoading(true)
        setLoadingMessage(t('sales.loading_fetching'))
        try {
            setLoadingMessage(t('sales.loading_processing'))
            const res = await fetch(`/api/inventory/food-cost?storeId=${encodeURIComponent(storeIdParam)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`)
            const json = await res.json()

            if (json.salesNetSales && Object.keys(json.salesNetSales).length > 0) {
                setSalesNetSales(json.salesNetSales)
            } else {
                setSalesNetSales(null)
            }

            if (json.data && json.data.length > 0) {
                setData(json.data)
                setStoreName(json.data[0].store_name || storeIdParam)
            } else {
                setData([])
            }
        } catch (e) {
            console.error('Error fetching food cost data:', e)
        } finally {
            setLastUpdated(new Date())
            setLoading(false)
            setLoadingMessage('')
        }
    }, [endDate, startDate, storeIdParam, t])

    // Trigger refresh whenever period, startDate, or endDate changes (including 2nd+ custom date selections!)
    useEffect(() => {
        if (period !== 'custom' || (startDate && endDate)) {
            refreshData()
        }
    }, [period, startDate, endDate, refreshData])

    const { filteredTableData, summaryData, tablePmixSales } = useMemo(() => {
        if (!data) return { filteredTableData: [], summaryData: null, tablePmixSales: 0 }

        let filtered = data
        const trimmedFilter = filterTerm.trim()
        if (trimmedFilter) {
            const lowerFact = trimmedFilter.toLowerCase()
            filtered = filtered.filter(item =>
                (item.name?.toLowerCase().includes(lowerFact)) ||
                (item.group_name?.toLowerCase().includes(lowerFact)) ||
                (item.guid?.toLowerCase().includes(lowerFact))
            )
        }

        const sortedData = [...filtered].sort((a, b) => {
            if (!sortConfig) return 0
            const aVal = a[sortConfig.key] ?? 0
            const bVal = b[sortConfig.key] ?? 0

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
            }
            if (typeof aVal === 'boolean') {
                return sortConfig.direction === 'asc' ? (Number(aVal) - Number(bVal)) : (Number(bVal) - Number(aVal))
            }
            return sortConfig.direction === 'asc' ? ((aVal as number) - (bVal as number)) : ((bVal as number) - (aVal as number))
        })

        let pmixSales = 0
        const sumData = {
            totalSales: 0,
            totalCost: 0,
            totalPackagingCost: 0,
            totalAsadaLbs: 0,
            totalAsadaCost: 0,
            totalQuantity: 0,
            totalExtras: 0,
            totalDiscounts: 0,
            totalMeatLbs: 0
        }

        sortedData.forEach(item => {
            const foodCost = Number(item.food_cost ?? item.total_cost ?? 0)
            const pkgCost = Number(item.packaging_cost ?? 0)
            pmixSales += item.net_sales
            sumData.totalCost += foodCost
            sumData.totalPackagingCost += pkgCost
            sumData.totalAsadaLbs += Number(item.asada_raw_lbs ?? 0)
            sumData.totalAsadaCost += Number(item.asada_cost ?? 0)
            sumData.totalQuantity += item.quantity
            sumData.totalExtras += (item.total_modifier_cost * item.quantity)
            sumData.totalDiscounts += (item.discounts || 0)
            sumData.totalMeatLbs += (item.total_meat_lbs || 0)
        })

        // Use authoritative store salesNetSales when no search filter is active so KPI summary matches Overview 1:1
        let resolvedStoreSales = pmixSales
        if (!trimmedFilter && salesNetSales) {
            const directAuth = salesNetSales[storeIdParam]
            const fallbackSingleAuth = Object.keys(salesNetSales).length === 1 ? Object.values(salesNetSales)[0] : undefined
            const authVal = directAuth ?? fallbackSingleAuth
            if (authVal !== undefined && authVal > 0) {
                resolvedStoreSales = authVal
            }
        }
        sumData.totalSales = resolvedStoreSales

        return {
            filteredTableData: sortedData,
            summaryData: sumData,
            tablePmixSales: pmixSales
        }
    }, [data, filterTerm, sortConfig, salesNetSales, storeIdParam])

    const handleBack = () => {
        if (typeof window !== 'undefined' && !window.opener && window.history.length > 1) {
            router.back()
            return
        }
        router.push(`/admin/food-cost?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&period=${encodeURIComponent(period)}`)
    }

    const handleExportCSV = () => {
        if (!filteredTableData || filteredTableData.length === 0) return
        const headers = [
            escapeCsvCell('Group'),
            escapeCsvCell(t('food_cost.table.product')),
            escapeCsvCell(t('food_cost.table.quantity')),
            escapeCsvCell(t('food_cost.meat_lbs_col')),
            escapeCsvCell(t('food_cost.table.price')),
            escapeCsvCell(t('food_cost.table.discounts')),
            escapeCsvCell(t('food_cost.table.extras')),
            escapeCsvCell(t('food_cost.table.net_sales')),
            escapeCsvCell(t('food_cost.table.unit_cost')),
            escapeCsvCell('Food Cost $'),
            escapeCsvCell('Food Cost %'),
            escapeCsvCell(t('food_cost.packaging_col'))
        ]

        const rows = filteredTableData.map(item => [
            escapeCsvCell(item.group_name || 'N/A'),
            escapeCsvCell(item.name),
            item.quantity.toFixed(0),
            (item.total_meat_lbs || 0).toFixed(2),
            item.unit_price.toFixed(2),
            (item.discounts || 0).toFixed(2),
            (item.total_modifier_cost * item.quantity).toFixed(2),
            item.net_sales.toFixed(2),
            item.unit_cost.toFixed(2),
            (item.food_cost ?? item.total_cost).toFixed(2),
            `${item.food_cost_percent.toFixed(2)}%`,
            (item.packaging_cost ?? 0).toFixed(2)
        ])

        const csvString = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `Tacos_Gavilan_${formatStoreName(storeName || storeIdParam)}_Food_Cost_${startDate}_${endDate}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    if (!data) return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
            <SurpriseLoader />
            {loadingMessage && (
                <p className="text-slate-500 dark:text-slate-400 text-sm animate-pulse">
                    {loadingMessage}
                </p>
            )}
        </div>
    )

    const subtotalSalesForTable = summaryData ? summaryData.totalSales : tablePmixSales
    const subtotalFcPct = summaryData ? calculateSafeFoodCostPct(summaryData.totalCost, subtotalSalesForTable) : 0
    const subtotalPkgPct = summaryData ? calculateSafePackagingCostPct(summaryData.totalPackagingCost, subtotalSalesForTable) : 0

    return (
        <div className="min-h-screen bg-transparent text-slate-900 dark:text-white font-sans pb-24">
            <div className="w-full mx-auto px-4 md:px-6 py-8 relative z-10">

                <FoodCostNavigationTabs preserveParams={{ startDate, endDate, period, storeId: storeIdParam }} />

                {/* Back button */}
                <button
                    type="button"
                    onClick={handleBack}
                    className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors uppercase tracking-wider cursor-pointer"
                >
                    <ArrowLeft size={16} /> {t('food_cost.back_to_stores')}
                </button>

                {/* Header Context */}
                <div className="relative z-10 space-y-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-sm">
                                    {t('sales.live_connected')}
                                </span>
                                <span className="text-xs text-slate-600 dark:text-slate-500 flex items-center gap-1 font-medium italic opacity-80">
                                    <span>{t('sales.updated')}: {lastUpdated.toLocaleTimeString()}</span>
                                </span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                                {formatStoreName(storeName || storeIdParam)}
                                <span className="text-2xl text-slate-400 font-light">Food Cost</span>
                            </h1>
                        </div>

                        {/* Floating Glass Filter Bar */}
                        <div className="flex flex-col sm:flex-row items-center gap-2 bg-white/70 dark:bg-slate-900/80 p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5 w-full md:w-auto z-50">
                            <DateRangeFilter
                                period={period as 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'}
                                startDate={startDate}
                                endDate={endDate}
                                onChange={(p, s, e) => {
                                    setPeriod(p as 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month')
                                    setStartDate(s)
                                    setEndDate(e)
                                }}
                            />

                            <div className="hidden sm:block w-[1px] h-6 bg-slate-300 dark:bg-slate-700 mx-1"></div>

                            <button
                                onClick={refreshData}
                                disabled={loading}
                                className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors border border-black/5 dark:border-slate-700 shrink-0"
                                title={t('sales.refresh')}
                            >
                                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>
                </div>

                {loading && !data.length ? (
                    <div className="mt-8 flex flex-col items-center justify-center gap-4">
                        <SurpriseLoader />
                        <p className="text-slate-500 dark:text-slate-400 text-sm animate-pulse">{loadingMessage}</p>
                    </div>
                ) : (
                    <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

                        {/* Summary Widget */}
                        <FoodCostSummary data={summaryData!} />

                        {/* Modern Table Product Level */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5 mt-8">

                            {/* Table Header Controls */}
                            <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
                                    <Store size={18} className="text-blue-500" />
                                    {t('food_cost.product_detail_title')}
                                </h3>

                                <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                                    <div className="relative w-full sm:w-64">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        <input
                                            type="text"
                                            placeholder={t('food_cost.search')}
                                            value={filterTerm}
                                            onChange={(e) => setFilterTerm(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 bg-white/70 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            <span className="bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
                                                {filteredTableData.length}
                                            </span>
                                            <span>{t('food_cost.products_count')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleExportCSV}
                                            disabled={filteredTableData.length === 0}
                                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:opacity-80 disabled:opacity-40 flex items-center gap-1 uppercase tracking-wider whitespace-nowrap bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-lg cursor-pointer"
                                        >
                                            <Download size={14} /> {t('sales.export_csv')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto max-h-[800px] overflow-y-auto relative styled-scrollbar">
                                <table className="w-full text-base text-left border-collapse">
                                    <thead className="bg-slate-100/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 text-slate-700 dark:text-slate-400 text-[10px] md:text-xs uppercase font-semibold tracking-widest border-b border-black/5 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('group_name')}>
                                                <div className="flex items-center gap-1">
                                                    Group
                                                    {sortConfig?.key === 'group_name' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('name')}>
                                                <div className="flex items-center gap-1">
                                                    {t('food_cost.table.product')}
                                                    {sortConfig?.key === 'name' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('quantity')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {t('food_cost.table.quantity')}
                                                    {sortConfig?.key === 'quantity' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('total_meat_lbs')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {t('food_cost.meat_lbs_col')}
                                                    {sortConfig?.key === 'total_meat_lbs' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-orange-500" /> : <ChevronDown size={14} className="text-orange-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('unit_price')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    {t('food_cost.table.price')}
                                                    {sortConfig?.key === 'unit_price' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('discounts')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    {t('food_cost.table.discounts')}
                                                    {sortConfig?.key === 'discounts' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('total_modifier_cost')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    {t('food_cost.table.extras')}
                                                    {sortConfig?.key === 'total_modifier_cost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('net_sales')}>
                                                <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                    {t('food_cost.table.net_sales')}
                                                    {sortConfig?.key === 'net_sales' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('unit_cost')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    U. COST
                                                    {sortConfig?.key === 'unit_cost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('total_cost')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    FOOD $
                                                    {sortConfig?.key === 'total_cost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('food_cost_percent')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    FOOD %
                                                    {sortConfig?.key === 'food_cost_percent' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-rose-500" /> : <ChevronDown size={14} className="text-rose-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('packaging_cost')}>
                                                <div className="flex items-center justify-end gap-1 text-sky-600 dark:text-sky-400">
                                                    {t('food_cost.packaging_col')}
                                                    {sortConfig?.key === 'packaging_cost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-4 py-3 text-center">{t('food_cost.table.status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5 dark:divide-slate-800">
                                        {filteredTableData.map((item, idx) => {
                                            const lineExtras = (item.total_modifier_cost || 0) * item.quantity
                                            const pkgCost = Number(item.packaging_cost ?? 0)
                                            return (
                                                <tr
                                                    key={`${item.guid}_${item.group_name || 'Uncategorized'}_${idx}`}
                                                    className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                                                    onClick={() => setSelectedProduct(item)}
                                                >
                                                    <td className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                                        {item.group_name || 'N/A'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight">{item.name}</span>
                                                            <span className="text-[10px] text-slate-400 font-mono mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{item.guid.slice(0, 8)}...</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-sm text-slate-700 dark:text-slate-300">
                                                        {item.quantity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-xs text-orange-600 dark:text-orange-400">
                                                        {(item.total_meat_lbs || 0) > 0 ? item.total_meat_lbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                                                        ${item.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-rose-500 dark:text-rose-400 font-mono text-xs">
                                                        {item.discounts > 0 ? `-$${item.discounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                                                        {lineExtras > 0 ? `+$${lineExtras.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-sm">
                                                        ${item.net_sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                                                        ${item.unit_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white text-sm">
                                                        ${(item.food_cost ?? item.total_cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {item.net_sales > 0 ? (
                                                            <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${getFcBadgeClasses(item.food_cost_percent)}`}>
                                                                {item.food_cost_percent.toFixed(1)}%
                                                            </span>
                                                        ) : item.total_cost > 0 ? (
                                                            <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/20 uppercase">
                                                                {t('food_cost.zero_sales')}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600 font-mono">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-xs text-sky-600 dark:text-sky-400">
                                                        {pkgCost > 0 ? `$${pkgCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {item.has_recipe ? (
                                                            item.missing_prices ? (
                                                                <span title={t('food_cost.missing_price')} className="flex items-center justify-center">
                                                                    <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
                                                                </span>
                                                            ) : (
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto opacity-50 group-hover:opacity-100 transition-opacity" />
                                                            )
                                                        ) : (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100/50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                                                {t('food_cost.no_recipe')}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}

                                        {/* Subtotals Row */}
                                        {filteredTableData.length > 0 && summaryData && (
                                            <tr className="bg-slate-50 dark:bg-slate-900 font-bold border-t-2 border-slate-200 dark:border-slate-700 sticky bottom-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                                                <td className="px-4 py-4 text-slate-900 dark:text-white uppercase tracking-wider text-sm flex items-center gap-2">
                                                    {t('food_cost.subtotal')} ({filteredTableData.length})
                                                </td>
                                                <td></td>
                                                <td className="px-4 py-4 text-right font-mono text-slate-900 dark:text-white">
                                                    {summaryData.totalQuantity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-4 py-4 text-right font-mono font-bold text-orange-600 dark:text-orange-400">
                                                    {summaryData.totalMeatLbs > 0 ? summaryData.totalMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                </td>
                                                <td></td>
                                                <td className="px-4 py-4 text-right text-rose-500 font-mono">
                                                    {summaryData.totalDiscounts > 0 ? `-$${summaryData.totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">
                                                    {summaryData.totalExtras > 0 ? `+$${summaryData.totalExtras.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                </td>
                                                <td className="px-4 py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono">
                                                    ${subtotalSalesForTable.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td></td>
                                                <td className="px-4 py-4 text-right text-slate-900 dark:text-white font-mono">
                                                    ${summaryData.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    {subtotalSalesForTable > 0 ? (
                                                        <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${getFcBadgeClasses(subtotalFcPct)}`}>
                                                            {subtotalFcPct.toFixed(1)}%
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-4 text-right font-mono text-xs text-sky-600 dark:text-sky-400">
                                                    {summaryData.totalPackagingCost > 0 ? (
                                                        <span>
                                                            ${summaryData.totalPackagingCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            {subtotalPkgPct > 0 && <span className="ml-1 opacity-80">({subtotalPkgPct.toFixed(1)}%)</span>}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-4 text-center"></td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>

                                {filteredTableData.length === 0 && !loading && (
                                    <div className="p-16 text-center">
                                        <p className="text-slate-500 dark:text-slate-400">{t('food_cost.no_data')}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                )}
            </div>

            <style jsx global>{`
                .styled-scrollbar::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                .styled-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .styled-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(148, 163, 184, 0.3);
                    border-radius: 20px;
                }
                .dark .styled-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(51, 65, 85, 0.5);
                }
                .styled-scrollbar::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(148, 163, 184, 0.5);
                }
            `}</style>

            {/* Product Detail Modal */}
            <ProductDetailModal
                item={selectedProduct}
                storeId={storeIdParam}
                storeName={formatStoreName(storeName || storeIdParam)}
                startDate={startDate}
                endDate={endDate}
                onClose={() => setSelectedProduct(null)}
            />
        </div>
    )
}
