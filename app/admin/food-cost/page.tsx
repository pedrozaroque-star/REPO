'use client'

/**
 * @module app/admin/food-cost/page
 * @description Dashboard principal de Food Cost — Reporte General por Sucursal de Tacos Gavilan.
 *   Muestra Food Cost puro ($ y %), Empaque / Desechables ($ y %) separado y consumo de Carne Asada (lbs y $),
 *   con gráficas comparativas y tabla ordenable de las 15 sucursales.
 *
 * @businessRules
 *   - Regla de las 6:00 AM (`America/Los_Angeles`) vía `getBusinessDateLA()`.
 *   - Semáforo corporativo unificado (`getFoodCostStatus`): Saludable `<= 32%` (verde), Alerta `> 32%–35%` (ámbar), Crítico `> 35%` (rojo).
 *   - Paridad de Ventas Netas (`salesNetSales`): Se aplica tanto en vista de todas las tiendas (`all`) como al seleccionar una sola tienda,
 *     ÚNICAMENTE cuando NO hay término de búsqueda (`!filterTerm.trim()`), evitando distorsionar el denominador al buscar un platillo específico.
 *   - Food Cost y Empaque se reportan por separado sin mezclar desechables dentro de Food Cost %.
 *
 * @dataFlow
 *   `GET /api/inventory/food-cost?storeId=all` + `GET /api/inventory/anomalies` -> Agregación por sucursal -> `FoodCostSummary` + `FoodCostCharts` + Tabla / CSV.
 *
 * @notes
 *   - [2026-11-23] Unificados umbrales `<=32% / 32-35% / >35%`, separados Food Cost vs Empaque + Carne Asada,
 *     corregido denominador con filtro de búsqueda y tienda individual, y habilitada exportación CSV sanitizada.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp, Store, RefreshCw, Download, ArrowUpDown, Search, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import SurpriseLoader from '@/components/SurpriseLoader'
import FoodCostSummary from '@/components/food-cost/FoodCostSummary'
import FoodCostCharts from '@/components/food-cost/FoodCostCharts'
import PortionControlAlertsPanel from '@/components/food-cost/PortionControlAlertsPanel'
import { formatStoreName } from '@/lib/supabase'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import FoodCostNavigationTabs from '@/components/food-cost/FoodCostNavigationTabs'
import { useLanguage } from '@/lib/i18n'
import {
    getBusinessDateLA,
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
    total_cogs?: number
    meat_cost?: number
    asada_raw_lbs?: number
    asada_cost?: number
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
    store_name?: string
    store_id?: string
    total_meat_lbs?: number
}

type SortKey =
    | 'storeName'
    | 'quantity'
    | 'totalSales'
    | 'totalCost'
    | 'totalPackagingCost'
    | 'costPercent'
    | 'packagingPercent'
    | 'missing_prices'
    | 'totalDiscounts'
    | 'totalMeatLbs'
    | 'totalAsadaLbs'

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

export default function FoodCostPage() {
    const { t } = useLanguage()
    const urlParams = useSearchParams()

    const [loading, setLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState('')
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'last_week' | 'last_7' | 'last_month'>(() => {
        const p = urlParams.get('period')
        if (p && ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'custom', 'last_week', 'last_7', 'last_month'].includes(p)) {
            return p as any
        }
        if (urlParams.get('startDate') && urlParams.get('endDate')) return 'custom'
        return 'today'
    })
    const [startDate, setStartDate] = useState(() => urlParams.get('startDate') || getBusinessDateLA())
    const [endDate, setEndDate] = useState(() => urlParams.get('endDate') || getBusinessDateLA())
    const [selectedStore, setSelectedStore] = useState<string>(() => urlParams.get('store') || urlParams.get('storeId') || 'all')
    const [filterTerm, setFilterTerm] = useState('')

    const [data, setData] = useState<FoodCostItem[] | null>(null)
    const [storeList, setStoreList] = useState<string[]>([])
    const [salesNetSales, setSalesNetSales] = useState<Record<string, number> | null>(null)
    const [anomalies, setAnomalies] = useState<any[]>([])

    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' } | null>({ key: 'costPercent', direction: 'desc' })

    const requestSort = (key: SortKey) => {
        let direction: 'asc' | 'desc' = 'desc'
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc'
        }
        setSortConfig({ key, direction })
    }

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/inventory/anomalies')
                if (res.ok) {
                    const json = await res.json()
                    setAnomalies(json.data || [])
                }
            } catch {}
        })()
    }, [])

    const resolveAnomaly = async (id: string) => {
        try {
            await fetch('/api/inventory/anomalies', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            })
            setAnomalies(prev => prev.filter(a => a.id !== id))
        } catch {}
    }

    const refreshData = React.useCallback(async () => {
        setLoading(true)
        setLoadingMessage(t('sales.loading_fetching'))
        try {
            const queryStart = startDate || getBusinessDateLA()
            const queryEnd = endDate || queryStart

            setLoadingMessage(t('sales.loading_processing'))
            const res = await fetch(`/api/inventory/food-cost?storeId=all&startDate=${queryStart}&endDate=${queryEnd}`)
            const json = await res.json()

            if (json.data) {
                setData(json.data)

                if (json.salesNetSales && Object.keys(json.salesNetSales).length > 0) {
                    setSalesNetSales(json.salesNetSales)
                } else {
                    setSalesNetSales(null)
                }

                const stores = Array.from(new Set(json.data.map((r: FoodCostItem) => r.store_name || t('sales.unknown_store')))) as string[]
                const sortedStores = stores.sort()
                setStoreList(sortedStores)

                setSelectedStore(prev => {
                    if (prev === 'all' || sortedStores.includes(prev)) return prev
                    const normPrev = formatStoreName(prev).toLowerCase().trim()
                    const matchedRow = json.data.find((r: FoodCostItem) =>
                        r.store_id === prev ||
                        r.store_name === prev ||
                        formatStoreName(r.store_name || '').toLowerCase().trim() === normPrev ||
                        (r.store_name || '').toLowerCase().includes(normPrev)
                    )
                    return matchedRow?.store_name || prev
                })
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
    }, [endDate, startDate, t])

    useEffect(() => {
        refreshData()
    }, [refreshData])

    const { summaryData, storeTableData } = useMemo(() => {
        if (!data) return { summaryData: null, storeTableData: [] }

        let filtered = data
        if (selectedStore !== 'all') {
            const normSelected = formatStoreName(selectedStore).toLowerCase().trim()
            filtered = filtered.filter(item => {
                const rawName = item.store_name || t('sales.unknown_store')
                return rawName === selectedStore ||
                    item.store_id === selectedStore ||
                    formatStoreName(rawName).toLowerCase().trim() === normSelected
            })
        }

        const trimmedFilter = filterTerm.trim()
        const hasSearchFilter = Boolean(trimmedFilter)
        if (hasSearchFilter) {
            const lowerFact = trimmedFilter.toLowerCase()
            filtered = filtered.filter(item =>
                (item.name?.toLowerCase().includes(lowerFact)) ||
                (item.group_name?.toLowerCase().includes(lowerFact)) ||
                (item.guid?.toLowerCase().includes(lowerFact))
            )
        }

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

        const storeMap = new Map<string, {
            store_id: string
            totalSales: number
            totalCost: number
            totalPackagingCost: number
            quantity: number
            missing_prices: boolean
            totalDiscounts: number
            totalMeatLbs: number
            totalAsadaLbs: number
            totalAsadaCost: number
        }>()

        filtered.forEach(item => {
            const foodCost = Number(item.food_cost ?? item.total_cost ?? 0)
            const pkgCost = Number(item.packaging_cost ?? 0)
            const asadaLbs = Number(item.asada_raw_lbs ?? 0)
            const asadaCost = Number(item.asada_cost ?? 0)

            sumData.totalSales += item.net_sales
            sumData.totalCost += foodCost
            sumData.totalPackagingCost += pkgCost
            sumData.totalAsadaLbs += asadaLbs
            sumData.totalAsadaCost += asadaCost
            sumData.totalQuantity += item.quantity
            sumData.totalExtras += (item.total_modifier_cost * item.quantity)
            sumData.totalDiscounts += (item.discounts || 0)
            sumData.totalMeatLbs += (item.total_meat_lbs || 0)

            const sn = item.store_name || t('sales.unknown_store')
            if (!storeMap.has(sn)) {
                storeMap.set(sn, {
                    store_id: item.store_id || 'all',
                    totalSales: 0,
                    totalCost: 0,
                    totalPackagingCost: 0,
                    quantity: 0,
                    missing_prices: false,
                    totalDiscounts: 0,
                    totalMeatLbs: 0,
                    totalAsadaLbs: 0,
                    totalAsadaCost: 0
                })
            }
            const s = storeMap.get(sn)!
            s.totalSales += item.net_sales
            s.totalCost += foodCost
            s.totalPackagingCost += pkgCost
            s.quantity += item.quantity
            s.totalDiscounts += (item.discounts || 0)
            s.totalMeatLbs += (item.total_meat_lbs || 0)
            s.totalAsadaLbs += asadaLbs
            s.totalAsadaCost += asadaCost
            if (item.missing_prices) s.missing_prices = true
        })

        const chartArr = Array.from(storeMap.entries()).map(([sn, vals]) => {
            // Apply authoritative salesNetSales for BOTH all-stores AND single-store views,
            // ONLY when no product search filter is active (!hasSearchFilter) so product searches aren't diluted!
            const authSales = (!hasSearchFilter && salesNetSales) ? salesNetSales[vals.store_id] : undefined
            const displaySales = (authSales !== undefined && authSales > 0) ? authSales : vals.totalSales
            return {
                store_id: vals.store_id,
                storeName: sn,
                totalSales: displaySales,
                totalCost: vals.totalCost,
                totalPackagingCost: vals.totalPackagingCost,
                quantity: vals.quantity,
                totalDiscounts: vals.totalDiscounts,
                totalMeatLbs: vals.totalMeatLbs,
                totalAsadaLbs: vals.totalAsadaLbs,
                totalAsadaCost: vals.totalAsadaCost,
                missing_prices: vals.missing_prices,
                costPercent: calculateSafeFoodCostPct(vals.totalCost, displaySales),
                packagingPercent: calculateSafePackagingCostPct(vals.totalPackagingCost, displaySales)
            }
        })

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

        // Keep summary totalSales aligned with store table rows (both All Stores and Single Store) when not filtering by product name
        if (!hasSearchFilter && chartArr.length > 0) {
            const alignedTotal = chartArr.reduce((s, st) => s + st.totalSales, 0)
            if (alignedTotal > 0) {
                sumData.totalSales = alignedTotal
            }
        }

        return {
            summaryData: sumData,
            storeTableData: chartArr
        }
    }, [data, selectedStore, filterTerm, sortConfig, salesNetSales, t])

    const handleExportCSV = () => {
        if (!storeTableData || storeTableData.length === 0) return
        const headers = [
            escapeCsvCell(t('food_cost.filters.store')),
            escapeCsvCell(t('food_cost.table.quantity')),
            escapeCsvCell(t('food_cost.asada_lbs_col')),
            escapeCsvCell(`${t('food_cost.asada_label')} ($)`),
            escapeCsvCell(t('food_cost.meat_lbs_col')),
            escapeCsvCell(t('food_cost.table.discounts')),
            escapeCsvCell(t('food_cost.table.net_sales')),
            escapeCsvCell(t('food_cost.food_cost_label')),
            escapeCsvCell('Food Cost %'),
            escapeCsvCell(t('food_cost.packaging_col')),
            escapeCsvCell(t('food_cost.pkg_pct_col'))
        ]

        const rows = storeTableData.map(st => [
            escapeCsvCell(formatStoreName(st.storeName)),
            st.quantity.toFixed(0),
            st.totalAsadaLbs.toFixed(2),
            st.totalAsadaCost.toFixed(2),
            st.totalMeatLbs.toFixed(2),
            st.totalDiscounts.toFixed(2),
            st.totalSales.toFixed(2),
            st.totalCost.toFixed(2),
            `${st.costPercent.toFixed(2)}%`,
            st.totalPackagingCost.toFixed(2),
            `${st.packagingPercent.toFixed(2)}%`
        ])

        if (summaryData) {
            const totFcPct = calculateSafeFoodCostPct(summaryData.totalCost, summaryData.totalSales)
            const totPkgPct = calculateSafePackagingCostPct(summaryData.totalPackagingCost, summaryData.totalSales)
            rows.push([
                escapeCsvCell(`${t('food_cost.subtotal')} (${storeTableData.length})`),
                summaryData.totalQuantity.toFixed(0),
                summaryData.totalAsadaLbs.toFixed(2),
                summaryData.totalAsadaCost.toFixed(2),
                summaryData.totalMeatLbs.toFixed(2),
                summaryData.totalDiscounts.toFixed(2),
                summaryData.totalSales.toFixed(2),
                summaryData.totalCost.toFixed(2),
                `${totFcPct.toFixed(2)}%`,
                summaryData.totalPackagingCost.toFixed(2),
                `${totPkgPct.toFixed(2)}%`
            ])
        }

        const csvString = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `Tacos_Gavilan_Food_Cost_${startDate}_${endDate}.csv`)
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

    const subtotalFcPct = summaryData ? calculateSafeFoodCostPct(summaryData.totalCost, summaryData.totalSales) : 0
    const subtotalPkgPct = summaryData ? calculateSafePackagingCostPct(summaryData.totalPackagingCost, summaryData.totalSales) : 0

    return (
        <div className="min-h-screen bg-transparent text-slate-900 dark:text-white font-sans pb-24">
            <div className="w-full mx-auto px-4 md:px-6 py-8 relative z-10">

                <FoodCostNavigationTabs preserveParams={{ startDate, endDate, period, store: selectedStore }} />

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

                {/* ═══ ANOMALY ALERT BANNER ═══ */}
                {anomalies.length > 0 && (
                    <div className="mt-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle size={20} className="text-rose-600 dark:text-rose-400" />
                            <span className="font-bold text-rose-700 dark:text-rose-300 text-sm">
                                🚨 {anomalies.length} {t('food_cost.anomalies_detected')}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {anomalies.slice(0, 5).map((a: any) => (
                                <div key={a.id} className="flex items-center justify-between bg-white/80 dark:bg-slate-900/60 rounded-xl px-3 py-2 text-sm">
                                    <div>
                                        <span className={`font-mono font-bold mr-2 ${a.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}`}>
                                            {Number(a.food_cost_percent).toFixed(0)}%
                                        </span>
                                        <span className="text-slate-700 dark:text-slate-300 font-medium">{a.item_name}</span>
                                        <span className="text-slate-400 ml-2 text-xs">({a.business_date})</span>
                                    </div>
                                    <button
                                        onClick={() => resolveAnomaly(a.id)}
                                        className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900 transition-colors"
                                    >
                                        ✓ {t('food_cost.resolve')}
                                    </button>
                                </div>
                            ))}
                            {anomalies.length > 5 && (
                                <p className="text-xs text-rose-500 dark:text-rose-400 pl-2">
                                    ... {t('food_cost.and_more').replace('{count}', String(anomalies.length - 5))}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {loading && !data.length ? (
                    <div className="mt-8 flex flex-col items-center justify-center gap-4">
                        <SurpriseLoader />
                        <p className="text-slate-500 dark:text-slate-400 text-sm animate-pulse">{loadingMessage}</p>
                    </div>
                ) : (
                    <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

                        {/* Summary Widget */}
                        <FoodCostSummary data={summaryData!} />

                        {/* Portion Control & Escalera de Mando Panel */}
                        <div className="mt-8">
                            <PortionControlAlertsPanel
                                storeId={selectedStore !== 'all' ? (storeTableData[0]?.store_id || selectedStore) : undefined}
                                startDate={startDate}
                                endDate={endDate}
                            />
                        </div>

                        {/* Charts Widget (only show if viewing "all" to compare stores) */}
                        {selectedStore === 'all' && (
                            <FoodCostCharts data={storeTableData} />
                        )}

                        {/* Store Table */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5 mt-8">

                            {/* Table Header Controls */}
                            <div className="px-4 md:px-6 py-4 border-b border-black/5 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-base md:text-lg">
                                    <Store size={18} className="text-blue-500" />
                                    {t('food_cost.by_store')}
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
                                            <span>{t('food_cost.stores_count')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleExportCSV}
                                            disabled={storeTableData.length === 0}
                                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:opacity-80 disabled:opacity-40 flex items-center gap-1 uppercase tracking-wider whitespace-nowrap bg-blue-50 dark:bg-blue-500/10 px-3 py-1.5 rounded-lg cursor-pointer"
                                        >
                                            <Download size={14} /> {t('sales.export_csv')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* MOBILE: Card-based layout */}
                            <div className="md:hidden divide-y divide-black/5 dark:divide-slate-800">
                                {storeTableData.map((item, idx) => {
                                    const costColor = getFcBadgeClasses(item.costPercent)
                                    return (
                                        <div
                                            key={`mobile-${item.store_id}_${idx}`}
                                            className="px-4 py-3.5 active:bg-black/5 dark:active:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => window.open(`/admin/food-cost/${item.store_id}?startDate=${startDate}&endDate=${endDate}&period=${period}`, '_blank')}
                                        >
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
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {item.totalSales > 0 ? (
                                                        <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${costColor}`}>
                                                            {item.costPercent.toFixed(1)}%
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/20 uppercase">
                                                            N/A
                                                        </span>
                                                    )}
                                                    {item.packagingPercent > 0 && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20">
                                                            +{item.packagingPercent.toFixed(1)}% Pkg
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-4 gap-x-2 text-[11px]">
                                                <div>
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">{t('sales.sales_label')}</span>
                                                    <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                                                        ${item.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Food</span>
                                                    <p className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs mt-0.5">
                                                        ${item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">{t('food_cost.packaging_col')}</span>
                                                    <p className="font-mono font-bold text-sky-600 dark:text-sky-400 text-xs mt-0.5">
                                                        ${item.totalPackagingCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Asada</span>
                                                    <p className="font-mono font-bold text-orange-600 dark:text-orange-400 text-xs mt-0.5">
                                                        {item.totalAsadaLbs.toFixed(1)} lb
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
                                                {t('food_cost.subtotal')} ({storeTableData.length})
                                            </span>
                                            {summaryData.totalSales > 0 && (
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono border ${getFcBadgeClasses(subtotalFcPct)}`}>
                                                        {subtotalFcPct.toFixed(1)}%
                                                    </span>
                                                    {subtotalPkgPct > 0 && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20">
                                                            +{subtotalPkgPct.toFixed(1)}% Pkg
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-4 gap-x-2 text-[11px]">
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">{t('sales.sales_label')}</span>
                                                <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                                                    ${summaryData.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Food</span>
                                                <p className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs mt-0.5">
                                                    ${summaryData.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </p>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">{t('food_cost.packaging_col')}</span>
                                                <p className="font-mono font-bold text-sky-600 dark:text-sky-400 text-xs mt-0.5">
                                                    ${summaryData.totalPackagingCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider font-medium">Asada</span>
                                                <p className="font-mono font-bold text-orange-600 dark:text-orange-400 text-xs mt-0.5">
                                                    {summaryData.totalAsadaLbs.toFixed(1)} lb
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

                            {/* DESKTOP: Full table */}
                            <div className="hidden md:block overflow-x-auto max-h-[800px] overflow-y-auto relative styled-scrollbar">
                                <table className="w-full min-w-[900px] text-sm md:text-base text-left border-collapse whitespace-nowrap">
                                    <thead className="bg-slate-100/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 text-slate-700 dark:text-slate-400 text-[10px] md:text-xs uppercase font-semibold tracking-widest border-b border-black/5 dark:border-slate-800">
                                        <tr>
                                            <th className="px-3 py-2 md:px-4 md:py-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group sticky left-0 z-30 bg-slate-100/95 dark:bg-slate-950/95 backdrop-blur-md" onClick={() => requestSort('storeName')}>
                                                <div className="flex items-center gap-1">
                                                    {t('food_cost.filters.store')}
                                                    {sortConfig?.key === 'storeName' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('quantity')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {t('food_cost.table.quantity')}
                                                    {sortConfig?.key === 'quantity' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalAsadaLbs')}>
                                                <div className="flex items-center justify-end gap-1 text-orange-600 dark:text-orange-400">
                                                    {t('food_cost.asada_lbs_col')}
                                                    {sortConfig?.key === 'totalAsadaLbs' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-orange-500" /> : <ChevronDown size={14} className="text-orange-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalMeatLbs')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {t('food_cost.meat_lbs_col')}
                                                    {sortConfig?.key === 'totalMeatLbs' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-orange-500" /> : <ChevronDown size={14} className="text-orange-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalDiscounts')}>
                                                <div className="flex items-center justify-end gap-1 text-slate-500">
                                                    {t('food_cost.table.discounts')}
                                                    {sortConfig?.key === 'totalDiscounts' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalSales')}>
                                                <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                    {t('food_cost.table.net_sales')}
                                                    {sortConfig?.key === 'totalSales' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalCost')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    FOOD COST $
                                                    {sortConfig?.key === 'totalCost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-blue-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('costPercent')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    FOOD %
                                                    {sortConfig?.key === 'costPercent' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-rose-500" /> : <ChevronDown size={14} className="text-rose-500" />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('totalPackagingCost')}>
                                                <div className="flex items-center justify-end gap-1 text-sky-600 dark:text-sky-400">
                                                    {t('food_cost.packaging_col')}
                                                    {sortConfig?.key === 'totalPackagingCost' ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                                </div>
                                            </th>
                                            <th className="px-3 py-2 md:px-4 md:py-3 text-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('missing_prices')}>
                                                <div className="flex items-center justify-center gap-1">
                                                    {t('food_cost.table.status')}
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
                                                    {item.totalAsadaLbs > 0 ? item.totalAsadaLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-xs md:text-sm text-slate-600 dark:text-slate-400">
                                                    {item.totalMeatLbs > 0 ? item.totalMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
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
                                                        <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${getFcBadgeClasses(item.costPercent)}`}>
                                                            {item.costPercent.toFixed(1)}%
                                                        </span>
                                                    ) : item.totalCost > 0 ? (
                                                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-500/20 uppercase">
                                                            {t('food_cost.zero_sales')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-600 font-mono">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-xs md:text-sm text-sky-600 dark:text-sky-400">
                                                    {item.totalPackagingCost > 0 ? (
                                                        <span>
                                                            ${item.totalPackagingCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            {item.packagingPercent > 0 && <span className="ml-1 text-[11px] opacity-80">({item.packagingPercent.toFixed(1)}%)</span>}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-center">
                                                    {item.missing_prices ? (
                                                        <span title={t('food_cost.missing_price')} className="flex items-center justify-center">
                                                            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
                                                        </span>
                                                    ) : (
                                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto opacity-50 group-hover:opacity-100 transition-opacity" />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}

                                        {/* Subtotals Row */}
                                        {storeTableData.length > 0 && summaryData && (
                                            <tr className="bg-slate-50 dark:bg-slate-900 font-bold border-t-2 border-slate-200 dark:border-slate-700 sticky bottom-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-slate-900 dark:text-white uppercase tracking-wider text-[10px] md:text-sm sticky left-0 z-30 bg-slate-50 dark:bg-slate-900">
                                                    <div className="flex items-center gap-2">{t('food_cost.subtotal')} ({storeTableData.length})</div>
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-slate-900 dark:text-white text-xs md:text-sm">
                                                    {summaryData.totalQuantity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono font-bold text-orange-600 dark:text-orange-400 text-xs md:text-sm">
                                                    {summaryData.totalAsadaLbs > 0 ? summaryData.totalAsadaLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-slate-700 dark:text-slate-300 text-xs md:text-sm">
                                                    {summaryData.totalMeatLbs > 0 ? summaryData.totalMeatLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-rose-500 font-mono text-xs md:text-sm">
                                                    {summaryData.totalDiscounts > 0 ? `-$${summaryData.totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono text-xs md:text-sm">
                                                    ${summaryData.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right text-slate-900 dark:text-white font-mono text-xs md:text-sm">
                                                    ${summaryData.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right">
                                                    {summaryData.totalSales > 0 ? (
                                                        <span className={`px-2 py-1 rounded text-xs font-bold font-mono border ${getFcBadgeClasses(subtotalFcPct)}`}>
                                                            {subtotalFcPct.toFixed(1)}%
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-3 py-3 md:px-4 md:py-4 text-right font-mono text-sky-600 dark:text-sky-400 text-xs md:text-sm">
                                                    {summaryData.totalPackagingCost > 0 ? (
                                                        <span>
                                                            ${summaryData.totalPackagingCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            {subtotalPkgPct > 0 && <span className="ml-1 text-[11px] opacity-80">({subtotalPkgPct.toFixed(1)}%)</span>}
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
