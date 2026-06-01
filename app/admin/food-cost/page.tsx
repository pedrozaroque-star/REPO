'use client'

/**
 * @module FoodCostDashboard
 * @description Dashboard principal de Food Cost — Reporte General.
 *   Muestra el costo teórico de alimentos por tienda con KPIs, gráficas y tabla comparativa.
 *   Al hacer clic en una tienda, abre la vista detallada por producto (/admin/food-cost/[storeId]).
 *
 * @businessRules
 *   - Usa datos del food_cost_daily_cache (pre-calculado) + cálculo en vivo vía API.
 *   - Las ventas netas (net_sales) se toman de sales_daily_cache para paridad con el módulo de Ventas.
 *   - La tabla "Food Cost by Store" agrega items por store_name y muestra FC%, meat lbs, discounts.
 *   - Cada fila de tienda es clickeable → abre window.open() con los mismos filtros de fecha.
 *   - Soporta periodos: today, yesterday, week, month, quarter, last_week, last_7, last_month, custom.
 *
 * @dataFlow
 *   /api/inventory/food-cost?storeId=all → datos por item
 *   /api/sales/net-sales → ventas netas autoritativas por tienda (KPI parity)
 *   Agregación client-side: items → storeMap → chartArr + storeTableData
 *
 * @notes
 *   - El FC% total puede no coincidir exactamente con la suma de porcentajes individuales
 *     porque el net_sales se overridea desde sales_daily_cache (not from PMIX).
 */
import React, { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp, Store, RefreshCw, Download, ArrowUpDown, Search, CheckCircle2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'
import FoodCostSummary from '@/components/food-cost/FoodCostSummary'
import FoodCostCharts from '@/components/food-cost/FoodCostCharts'
import { formatStoreName } from '@/lib/supabase'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

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
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
    store_name?: string
    store_id?: string
    total_meat_lbs?: number
}

type SortKey = 'storeName' | 'quantity' | 'totalSales' | 'totalCost' | 'costPercent' | 'missing_prices' | 'totalDiscounts' | 'totalMeatLbs'

export default function FoodCostPage() {
    const { t } = useLanguage()
    const router = useRouter()
    const urlParams = useSearchParams()

    // UI State
    const [loading, setLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState('')
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    // Filter State
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'>(() => {
        if (urlParams.get('startDate') && urlParams.get('endDate')) return 'custom'
        return 'today'
    })
    const [startDate, setStartDate] = useState(() => {
        if (urlParams.get('startDate')) return urlParams.get('startDate')!
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        if (urlParams.get('endDate')) return urlParams.get('endDate')!
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [selectedStore, setSelectedStore] = useState<string>('all')
    const [filterTerm, setFilterTerm] = useState('')

    // Data State
    const [data, setData] = useState<FoodCostItem[] | null>(null)
    const [storeList, setStoreList] = useState<string[]>([])
    // Authoritative net_sales from sales_daily_cache (parity with Ventas page)
    // Only used for KPI totals — individual product data stays untouched
    const [salesNetSales, setSalesNetSales] = useState<Record<string, number> | null>(null)

    // We now sort by the aggregated store metrics
    type SortKey = 'storeName' | 'quantity' | 'totalSales' | 'totalCost' | 'costPercent' | 'missing_prices' | 'totalDiscounts' | 'totalMeatLbs'
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>({ key: 'costPercent', direction: 'desc' })

    const requestSort = (key: SortKey) => {
        let direction: 'asc' | 'desc' = 'desc'
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc'
        }
        setSortConfig({ key, direction })
    }

    const refreshData = React.useCallback(async () => {
        setLoading(true)
        setLoadingMessage(t('sales.loading_fetching'))
        try {
            const now = new Date()
            if (now.getHours() < 6) now.setDate(now.getDate() - 1)
            const today = now

            let start = new Date(today)
            let end = new Date(today)

            if (period === 'custom' || period === 'last_week' || period === 'last_7' || period === 'last_month') {
                start = new Date(startDate + 'T00:00:00')
                end = new Date(endDate + 'T00:00:00')
            } else if (period === 'today') {
                start = today
                end = today
            } else if (period === 'yesterday') {
                const y = new Date(today)
                y.setDate(y.getDate() - 1)
                start = y
                end = y
            } else if (period === 'week') {
                const day = today.getDay()
                const diff = today.getDate() - day + (day === 0 ? -6 : 1)
                start = new Date(today.setDate(diff))
                end = new Date()
            } else if (period === 'month') {
                start = new Date(today.getFullYear(), today.getMonth(), 1)
            } else if (period === 'quarter') {
                const quarterAgo = new Date(today)
                quarterAgo.setDate(quarterAgo.getDate() - 90)
                start = quarterAgo
            }

            const formatDate = (d: Date) => {
                const year = d.getFullYear()
                const month = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                return `${year}-${month}-${day}`
            }

            setStartDate(formatDate(start))
            setEndDate(formatDate(end))

            setLoadingMessage(t('sales.loading_processing'))
            const res = await fetch(`/api/inventory/food-cost?storeId=all&startDate=${formatDate(start)}&endDate=${formatDate(end)}`)
            const json = await res.json()

            if (json.data) {
                setData(json.data)

                // Store authoritative net_sales from sales_daily_cache (for KPI parity with Ventas)
                // This does NOT alter individual product data — only used for top-level summary
                if (json.salesNetSales && Object.keys(json.salesNetSales).length > 0) {
                    setSalesNetSales(json.salesNetSales)
                } else {
                    setSalesNetSales(null)
                }

                // Extract unique stores
                const stores = Array.from(new Set(json.data.map((r: FoodCostItem) => r.store_name || t('sales.unknown_store')))) as string[]
                setStoreList(stores.sort())
            } else {
                setData([])
                setStoreList([])
                setSalesNetSales(null)
            }
        } catch (e) {
            console.error('Error fetching food cost data:', e)
        } finally {
            setLastUpdated(new Date())
            setLoading(false)
            setLoadingMessage('')
        }
    }, [endDate, period, startDate, t])

    useEffect(() => {
        if (period !== 'custom') {
            refreshData()
        }
    }, [period, refreshData])

    // Memoized Data Processing
    const { summaryData, storeTableData } = useMemo(() => {
        if (!data) return { summaryData: null, storeTableData: [] }

        // 1. Filter raw data based on selected store and search term
        let filtered = data
        if (selectedStore !== 'all') {
            filtered = filtered.filter(item => (item.store_name || t('sales.unknown_store')) === selectedStore)
        }
        if (filterTerm) {
            const lowerFact = filterTerm.toLowerCase()
            filtered = filtered.filter(item =>
                (item.name?.toLowerCase().includes(lowerFact)) ||
                (item.group_name?.toLowerCase().includes(lowerFact)) ||
                (item.guid?.toLowerCase().includes(lowerFact))
            )
        }

        // 2. Compute Summary from filtered
        const sumData = {
            totalSales: 0,
            totalCost: 0,
            totalQuantity: 0,
            totalExtras: 0,
            totalDiscounts: 0,
            totalMeatLbs: 0
        }
        filtered.forEach(item => {
            sumData.totalSales += item.net_sales
            sumData.totalCost += item.total_cost
            sumData.totalQuantity += item.quantity
            sumData.totalExtras += (item.total_modifier_cost * item.quantity)
            sumData.totalDiscounts += (item.discounts || 0)
            sumData.totalMeatLbs += (item.total_meat_lbs || 0)
        })

        // 3. Compute Store Aggregations for the Chart and Table
        const storeMap = new Map<string, { store_id: string, totalSales: number, totalCost: number, quantity: number, missing_prices: boolean, totalDiscounts: number, totalMeatLbs: number }>()

        filtered.forEach(item => {
            const sn = item.store_name || t('sales.unknown_store')
            if (!storeMap.has(sn)) storeMap.set(sn, { store_id: item.store_id || 'all', totalSales: 0, totalCost: 0, quantity: 0, missing_prices: false, totalDiscounts: 0, totalMeatLbs: 0 })
            const s = storeMap.get(sn)!
            s.totalSales += item.net_sales
            s.totalCost += item.total_cost
            s.quantity += item.quantity
            s.totalDiscounts += (item.discounts || 0)
            s.totalMeatLbs += (item.total_meat_lbs || 0)
            if (item.missing_prices) s.missing_prices = true
        })

        const chartArr = Array.from(storeMap.entries()).map(([sn, vals]) => {
            // Use authoritative sales from sales_daily_cache when available (KPI parity with Ventas)
            const authSales = (salesNetSales && selectedStore === 'all') ? salesNetSales[vals.store_id] : undefined
            const displaySales = authSales !== undefined ? authSales : vals.totalSales
            return {
                store_id: vals.store_id,
                storeName: sn,
                totalSales: displaySales,
                totalCost: vals.totalCost,
                quantity: vals.quantity,
                totalDiscounts: vals.totalDiscounts,
                totalMeatLbs: vals.totalMeatLbs,
                missing_prices: vals.missing_prices,
                costPercent: displaySales > 0 ? (vals.totalCost / displaySales) * 100 : 0
            }
        })

        // 4. Sort aggregated store data
        chartArr.sort((a, b) => {
            if (!sortConfig) return 0
            const aVal = a[sortConfig.key]
            const bVal = b[sortConfig.key]

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
            }
            if (typeof aVal === 'boolean') {
                return sortConfig.direction === 'asc' ? (Number(aVal) - Number(bVal)) : (Number(bVal) - Number(aVal))
            }
            return sortConfig.direction === 'asc' ? ((aVal as number) - (bVal as number)) : ((bVal as number) - (aVal as number))
        })

        // Override summary totalSales with authoritative values when viewing all stores
        if (salesNetSales && selectedStore === 'all') {
            const authTotal = Object.values(salesNetSales).reduce((s, v) => s + v, 0)
            if (authTotal > 0) {
                sumData.totalSales = authTotal
            }
        }

        return {
            summaryData: sumData,
            storeTableData: chartArr
        }

    }, [data, selectedStore, filterTerm, sortConfig, salesNetSales, t])

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

    return (
        <div className="min-h-screen bg-transparent text-slate-900 dark:text-white font-sans pb-24">
            <div className="w-full mx-auto px-4 md:px-6 py-8 relative z-10">

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
                            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                {t('food_cost.title')}
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 mt-1">
                                {t('food_cost.subtitle')}
                            </p>
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

                            {/* Store Filter */}
                            {storeList.length > 0 && (
                                <div className="relative">
                                    <select
                                        value={selectedStore}
                                        onChange={(e) => setSelectedStore(e.target.value)}
                                        className="appearance-none pl-8 pr-8 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-black/5 dark:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                    >
                                        <option value="all">{t('sales.all_stores')}</option>
                                        {storeList.map((store) => (
                                            <option key={store} value={store}>
                                                {formatStoreName(store)}
                                            </option>
                                        ))}
                                    </select>
                                    <Store size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            )}

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

                        {/* Charts Widget (only show if viewing "all" to compare stores) */}
                        {selectedStore === 'all' && (
                            <FoodCostCharts data={storeTableData} />
                        )}

                        {/* Modern Table grouped by store */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5 mt-8">

                            {/* Table Header Controls */}
                            <div className="px-4 md:px-6 py-4 border-b border-black/5 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-base md:text-lg">
                                    <Store size={18} className="text-blue-500" />
                                    Food Cost by Store
                                </h3>

                                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
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
                                                {storeTableData.length}
                                            </span>
                                            <span>stores</span>
                                        </div>
                                        <button className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:opacity-80 flex items-center gap-1 uppercase tracking-wider whitespace-nowrap bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-lg">
                                            <Download size={14} /> {t('sales.export_csv')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* ═══════════════════════════════════════════════════ */}
                            {/* MOBILE: Card-based layout (visible below md)       */}
                            {/* ═══════════════════════════════════════════════════ */}
                            <div className="md:hidden divide-y divide-black/5 dark:divide-slate-800">
                                {storeTableData.map((item, idx) => {
                                    const costColor = item.costPercent > 32 ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20'
                                        : item.costPercent > 30 ? 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20'
                                            : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                                    return (
                                        <div
                                            key={`mobile-${item.store_id}_${idx}`}
                                            className="px-4 py-3.5 active:bg-black/5 dark:active:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => window.open(`/admin/food-cost/${item.store_id}?startDate=${startDate}&endDate=${endDate}&period=${period}`, '_blank')}
                                        >
                                            {/* Row 1: Store name + Cost % badge */}
                                            <div className="flex items-center justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></div>
                                                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">
                                                        {formatStoreName(item.storeName)}
                                                    </span>
                                                    {item.missing_prices && (
                                                        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0"></span>
                                                    )}
                                                </div>
                                                {item.totalSales > 0 ? (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border shrink-0 ${costColor}`}>
                                                        {item.costPercent.toFixed(1)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/20 uppercase shrink-0">
                                                        N/A
                                                    </span>
                                                )}
                                            </div>
                                            {/* Row 2: Key metrics in a compact grid */}
                                            <div className="grid grid-cols-3 gap-x-3 text-[11px]">
                                                <div>
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Ventas</span>
                                                    <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                                                        ${item.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Costo</span>
                                                    <p className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs mt-0.5">
                                                        ${item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Qty</span>
                                                    <p className="font-mono font-bold text-slate-600 dark:text-slate-400 text-xs mt-0.5">
                                                        {item.quantity.toLocaleString('en-US')}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* Mobile Subtotal */}
                                {storeTableData.length > 0 && summaryData && (
                                    <div className="px-4 py-3.5 bg-slate-50 dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-700">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <span className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                                                Subtotal ({storeTableData.length})
                                            </span>
                                            {summaryData.totalSales > 0 && (
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${(summaryData.totalCost / summaryData.totalSales * 100) > 32 ? 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20'
                                                    : (summaryData.totalCost / summaryData.totalSales * 100) > 30 ? 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-500/10 dark:border-yellow-500/20'
                                                        : 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                                                    }`}>
                                                    {(summaryData.totalCost / summaryData.totalSales * 100).toFixed(1)}%
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-x-3 text-[11px]">
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Ventas</span>
                                                <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                                                    ${summaryData.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Costo</span>
                                                <p className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs mt-0.5">
                                                    ${summaryData.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Qty</span>
                                                <p className="font-mono font-bold text-slate-600 dark:text-slate-400 text-xs mt-0.5">
                                                    {summaryData.totalQuantity.toLocaleString('en-US')}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {storeTableData.length === 0 && !loading && (
                                    <div className="p-12 text-center">
                                        <p className="text-slate-500 dark:text-slate-400">{t('food_cost.no_data')}</p>
                                    </div>
                                )}
                            </div>

                            {/* ═══════════════════════════════════════════════════ */}
                            {/* DESKTOP: Full table (visible at md and above)      */}
                            {/* ═══════════════════════════════════════════════════ */}
                            <div className="hidden md:block overflow-x-auto max-h-[800px] overflow-y-auto relative styled-scrollbar">
                                <table className="w-full min-w-[700px] text-sm md:text-base text-left border-collapse whitespace-nowrap">
                                    <thead className="bg-slate-100/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 text-slate-700 dark:text-slate-400 text-[10px] md:text-xs uppercase font-semibold tracking-widest border-b border-black/5 dark:border-slate-800">
                                        <tr>
                                            <th className="px-3 py-2 md:px-4 md:py-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group sticky left-0 z-30 bg-slate-100/95 dark:bg-slate-950/95 backdrop-blur-md" onClick={() => requestSort('storeName')}>
                                                <div className="flex items-center gap-1">
                                                    Store
                                                    {sortConfig?.key === 'storeName' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('quantity')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {t('food_cost.table.quantity')}
                                                    {sortConfig?.key === 'quantity' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalMeatLbs')}>
                                                <div className="flex items-center justify-end gap-1 w-full" title="Total Asada, Pollo, Pastor, Cabeza, Lengua, Buche, Carnitas, Chorizo items (raw lbs)">
                                                    LIBRAS (CARNE)
                                                    {sortConfig?.key === 'totalMeatLbs' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-orange-500" /> : <ChevronDown size={14} className="text-orange-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalDiscounts')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    DISCOUNTS
                                                    {sortConfig?.key === 'totalDiscounts' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-slate-700 dark:text-slate-300" /> : <ChevronDown size={14} className="text-slate-700 dark:text-slate-300" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalSales')}>
                                                <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                    {t('food_cost.table.net_sales').toUpperCase()}
                                                    {sortConfig?.key === 'totalSales' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalCost')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    T. COST
                                                    {sortConfig?.key === 'totalCost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('costPercent')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    COST %
                                                    {sortConfig?.key === 'costPercent' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-rose-500" /> : <ChevronDown size={14} className="text-rose-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('missing_prices')}>
                                                <div className="flex items-center justify-center gap-1">
                                                    Status
                                                    {sortConfig?.key === 'missing_prices' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5 dark:divide-slate-800">
                                        {storeTableData.map((item, idx) => (
                                            <tr
                                                key={`${item.store_id}_${idx}`}
                                                className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                                                onClick={() => {
                                                    // Pass dates as URL params to maintain context
                                                    window.open(`/admin/food-cost/${item.store_id}?startDate=${startDate}&endDate=${endDate}&period=${period}`, '_blank')
                                                }}
                                            >
                                                <td className="px-3 py-3 md:px-4 md:py-4 sticky left-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm group-hover:bg-slate-50 dark:group-hover:bg-slate-800/90 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 group-hover:scale-150 transition-transform"></div>
                                                        <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs md:text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                            {formatStoreName(item.storeName)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono font-bold text-xs md:text-sm text-slate-700 dark:text-slate-300">
                                                    {item.quantity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono font-bold text-xs md:text-sm text-orange-600 dark:text-orange-400">
                                                    {item.totalMeatLbs > 0 ? item.totalMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-rose-500 dark:text-rose-400 font-mono text-xs md:text-sm">
                                                    {item.totalDiscounts > 0 ? `-$${item.totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-xs md:text-sm">
                                                    ${item.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono font-bold text-slate-900 dark:text-white text-xs md:text-sm">
                                                    ${item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right">
                                                    {item.totalSales > 0 ? (
                                                        <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${item.costPercent > 32 ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20' :
                                                            item.costPercent > 30 ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20' :
                                                                'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                                                            }`}>
                                                            {item.costPercent.toFixed(1)}%
                                                        </span>
                                                    ) : item.totalCost > 0 ? (
                                                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/20 uppercase">
                                                            Zero Sales
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-600 font-mono">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-center">
                                                    {item.missing_prices ? (
                                                        <span title="Inventory Missing Price" className="flex items-center justify-center">
                                                            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
                                                        </span>
                                                    ) : (
                                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto opacity-50 group-hover:opacity-100 transition-opacity" />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}

                                        {/* Subtotals Row */}
                                        {storeTableData.length > 0 && (
                                            <tr className="bg-slate-50 dark:bg-slate-900 font-bold border-t-2 border-slate-200 dark:border-slate-700 sticky bottom-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-slate-900 dark:text-white uppercase tracking-wider text-[10px] md:text-sm sticky left-0 z-30 bg-slate-50 dark:bg-slate-900">
                                                    <div className="flex items-center gap-2">Subtotal ({storeTableData.length})</div>
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-slate-900 dark:text-white text-xs md:text-sm">
                                                    {summaryData?.totalQuantity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono font-bold text-orange-600 dark:text-orange-400 text-xs md:text-sm">
                                                    {(summaryData?.totalMeatLbs || 0) > 0 ? summaryData!.totalMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-rose-500 font-mono text-xs md:text-sm">
                                                    {(summaryData?.totalDiscounts || 0) > 0 ? `-$${summaryData!.totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono text-xs md:text-sm">
                                                    ${summaryData?.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-slate-900 dark:text-white font-mono text-xs md:text-sm">
                                                    ${summaryData?.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right">
                                                    {summaryData && summaryData.totalSales > 0 ? (
                                                        <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${(summaryData.totalCost / summaryData.totalSales * 100) > 32 ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20' :
                                                            (summaryData.totalCost / summaryData.totalSales * 100) > 30 ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20' :
                                                                'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                                                            }`}>
                                                            {(summaryData.totalCost / summaryData.totalSales * 100).toFixed(1)}%
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-center"></td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>

                                {storeTableData.length === 0 && !loading && (
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
        </div>
    )
}
