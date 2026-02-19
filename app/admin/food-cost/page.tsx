'use client'

import { useState, useEffect } from 'react'
import { Loader2, Download, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

interface FoodCostItem {
    guid: string
    name: string
    group_name?: string
    quantity: number
    net_sales: number
    gross_sales: number
    discounts: number // Added
    voided_quantity: number
    unit_price: number // Real List Price
    unit_cost: number
    total_cost: number
    food_cost_percent: number
    has_recipe: boolean
    missing_prices: boolean
}

export default function FoodCostPage() {
    const { t } = useLanguage()
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<FoodCostItem[]>([])
    const [stores, setStores] = useState<{ id: string, name: string, external_id: string }[]>([])
    // Default West Covina (external_id is likely the GUID)
    // If we load stores, we can default to the first one or keep this hardcoded default if it matches external_id format.
    const [storeId, setStoreId] = useState('5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02')

    // Correctly get local date YYYY-MM-DD
    const getLocalDate = () => {
        const d = new Date()
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    const [startDate, setStartDate] = useState(getLocalDate())
    const [endDate, setEndDate] = useState(getLocalDate())
    const [period, setPeriod] = useState('today')
    const [sortConfig, setSortConfig] = useState<{ key: keyof FoodCostItem; direction: 'asc' | 'desc' }>({ key: 'quantity', direction: 'desc' })

    useEffect(() => {
        const fetchStores = async () => {
            try {
                const res = await fetch('/api/stores')
                const json = await res.json()
                if (Array.isArray(json)) {
                    setStores(json)
                }
            } catch (e) {
                console.error("Failed to fetch stores", e)
            }
        }
        fetchStores()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/inventory/food-cost?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}`)
            const json = await res.json()
            if (json.data) {
                setData(json.data)
            } else {
                console.error(json.error)
            }
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    const handleSort = (key: keyof FoodCostItem) => {
        let direction: 'asc' | 'desc' = 'desc'
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc'
        }
        setSortConfig({ key, direction })
    }

    const sortedData = [...data].sort((a, b) => {
        const aVal = a[sortConfig.key]
        const bVal = b[sortConfig.key]

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortConfig.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal)
        }

        // Number comparison
        // Handle boolean
        if (typeof aVal === 'boolean') {
            return sortConfig.direction === 'asc'
                ? (Number(aVal) - Number(bVal))
                : (Number(bVal) - Number(aVal))
        }

        return sortConfig.direction === 'asc'
            ? (Number(aVal) - Number(bVal))
            : (Number(bVal) - Number(aVal))
    })

    const totalSales = data.reduce((acc, item) => acc + item.net_sales, 0)
    const totalCost = data.reduce((acc, item) => acc + item.total_cost, 0)
    const totalFC = totalSales > 0 ? (totalCost / totalSales) * 100 : 0

    const [filterTerm, setFilterTerm] = useState('')

    const filteredData = sortedData.filter(item =>
        item.name.toLowerCase().includes(filterTerm.toLowerCase()) ||
        item.guid.toLowerCase().includes(filterTerm.toLowerCase())
    )

    const filteredTotals = filteredData.reduce((acc, item) => {
        acc.quantity += item.quantity
        acc.net_sales += item.net_sales
        acc.discounts += (item.discounts || 0)
        acc.total_cost += item.total_cost
        return acc
    }, { quantity: 0, net_sales: 0, discounts: 0, total_cost: 0 })

    const filteredFC = filteredTotals.net_sales > 0
        ? (filteredTotals.total_cost / filteredTotals.net_sales) * 100
        : 0

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('food_cost.title')}</h1>
                    <p className="text-slate-500">{t('food_cost.subtitle')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                    <select
                        value={storeId}
                        onChange={(e) => setStoreId(e.target.value)}
                        className="p-2 border rounded bg-transparent dark:text-white dark:border-slate-600"
                    >
                        <option value="all">{t('sales.all_stores')}</option>
                        {stores.map(s => <option key={s.id} value={s.external_id || s.id}>{s.name}</option>)}
                    </select>

                    <DateRangeFilter
                        period={period}
                        startDate={startDate}
                        endDate={endDate}
                        onChange={(p, start, end) => {
                            setPeriod(p as any) // Assuming 'Period' type might differ slightly, casting for safety
                            setStartDate(start)
                            setEndDate(end)
                        }}
                    />

                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium flex items-center gap-2 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('food_cost.generate')}
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-medium text-slate-500 uppercase">{t('food_cost.table.net_sales')}</h3>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                        ${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-medium text-slate-500 uppercase">{t('food_cost.table.theo_cost')} Total</h3>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                        ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-medium text-slate-500 uppercase">{t('food_cost.table.cost_pct')}</h3>
                    <div className="flex items-center gap-3 mt-2">
                        <p className={`text-3xl font-bold ${totalFC > 35 ? 'text-red-500' : 'text-emerald-500'}`}>
                            {totalFC.toFixed(1)}%
                        </p>
                        {totalFC > 35 && <AlertTriangle className="w-6 h-6 text-red-500" />}
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

                {/* Search Bar */}
                {/* Search Bar & Stats */}
                <div className="p-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-lg">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder={t('food_cost.search')}
                            value={filterTerm}
                            onChange={(e) => setFilterTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-full text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                            {filteredData.length}
                        </span>
                        <span>results</span>
                    </div>
                </div>

                <div className="overflow-x-auto max-h-[600px] overflow-y-auto relative">
                    <table className="w-full text-sm text-left relative border-collapse">
                        <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-900 text-slate-500 uppercase tracking-wider font-semibold border-b dark:border-slate-700 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
                            <tr>
                                <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('group_name')}>Group</th>
                                <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('name')}>{t('food_cost.table.product')}</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('quantity')}>{t('food_cost.table.quantity')}</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('unit_price')}>Price</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('discounts')}>Disc ($)</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('net_sales')}>{t('food_cost.table.net_sales')}</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('unit_cost')}>Unit Cost</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('total_cost')}>Total Cost</th>
                                <th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => handleSort('food_cost_percent')}>{t('food_cost.table.cost_pct')}</th>
                                <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredData.map((item, idx) => (
                                <tr key={`${item.guid}_${item.group_name || idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-750/50 transition-colors">
                                    <td className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                        {item.group_name || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100">
                                        <div className="flex flex-col">
                                            <span>{item.name}</span>
                                            <span className="text-xs text-slate-400 font-mono">{item.guid.slice(0, 8)}...</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium">{item.quantity}</td>
                                    <td className="px-6 py-4 text-right text-slate-600 dark:text-slate-300">
                                        ${item.unit_price.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right text-amber-600 dark:text-amber-500 font-mono">
                                        {item.discounts > 0 ? `-$${item.discounts.toFixed(2)}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-600 dark:text-slate-300">
                                        ${item.net_sales.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right text-slate-600 dark:text-slate-300">
                                        ${item.unit_cost.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium text-slate-900 dark:text-white">
                                        ${item.total_cost.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {item.net_sales > 0 ? (
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${item.food_cost_percent > 40 ? 'bg-red-100 text-red-700' :
                                                item.food_cost_percent > 30 ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                {item.food_cost_percent.toFixed(1)}%
                                            </span>
                                        ) : item.total_cost > 0 ? (
                                            <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100" title="Costo sin venta (impacta al total)">
                                                Sin Venta
                                            </span>
                                        ) : (
                                            <span className="text-slate-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.has_recipe ? (
                                            item.missing_prices ? (
                                                <span title="Receta incompleta (falta precio costo)" className="text-yellow-500">Inventory Missing $</span>
                                            ) : (
                                                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
                                            )
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                                                Sin Receta
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}

                        </tbody>
                        {filteredData.length > 0 && (
                            <tfoot className="sticky bottom-0 z-20 bg-slate-50 dark:bg-slate-900 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 border-slate-200 dark:border-slate-700">
                                <tr className="font-bold">
                                    <td className="px-6 py-4 text-slate-900 dark:text-white align-middle">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                            <span>SUBTOTAL</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-slate-900 dark:text-white align-middle"></td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-700 dark:text-slate-300">{filteredTotals.quantity.toLocaleString()}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-500 dark:text-slate-400">
                                        -
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-amber-600 dark:text-amber-500 font-bold">
                                        -${filteredTotals.discounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-900 dark:text-white">${filteredTotals.net_sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-6 py-4 text-right">-</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-900 dark:text-white">${filteredTotals.total_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-6 py-4 text-right">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${filteredFC > 35
                                            ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50'
                                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/50'
                                            }`}>
                                            {filteredFC.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-6 py-4"></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>

                    {
                        data.length === 0 && !loading && (
                            <div className="p-12 text-center text-slate-500">
                                {t('food_cost.no_data')}
                            </div>
                        )
                    }
                </div >
            </div >
        </div >
    )
}
