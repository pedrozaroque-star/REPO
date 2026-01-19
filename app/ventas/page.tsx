'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, ChevronDown, DollarSign, Store, Users, Clock, RefreshCw, Filter, TrendingUp, TrendingDown, Eye, Download, WifiOff } from 'lucide-react'
import SalesSummary from '@/components/sales/SalesSummary'
import SurpriseLoader from '@/components/SurpriseLoader'
import SalesCharts from '@/components/sales/SalesCharts'
import { formatStoreName } from '@/lib/supabase'

export default function SalesPage() {
    const [loading, setLoading] = useState(false)
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [data, setData] = useState<any>(null)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
    const [loadingMessage, setLoadingMessage] = useState('')
    const [connError, setConnError] = useState<string | null>(null)

    const refreshData = async () => {
        setLoading(true)
        setLoadingMessage('Conectando con Toast API...')
        try {
            const now = new Date()
            if (now.getHours() < 6) now.setDate(now.getDate() - 1)
            const today = now

            let start = new Date(today)
            let end = new Date(today)
            let groupBy = 'day'

            if (period === 'custom') {
                const s = new Date(startDate + 'T00:00:00')
                const e = new Date(endDate + 'T00:00:00')
                start = s
                end = e
                const diff = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)
                groupBy = diff > 31 ? 'week' : 'day'
            } else if (period === 'today') {
                start = today
                end = today
                groupBy = 'day'
            } else if (period === 'yesterday') {
                const y = new Date(today)
                y.setDate(y.getDate() - 1)
                start = y
                end = y
                groupBy = 'day'
            } else if (period === 'week') {
                const day = today.getDay()
                const diff = today.getDate() - day + (day === 0 ? -6 : 1)
                start = new Date(today.setDate(diff))
                end = new Date()
                groupBy = 'day'
            } else if (period === 'month') {
                // Últimos 2 meses (60 días atrás) hasta hoy, agrupado por SEMANA
                const twoMonthsAgo = new Date(today)
                twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60)
                start = twoMonthsAgo
                groupBy = 'week'
            }

            const formatDate = (d: Date) => {
                const year = d.getFullYear()
                const month = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                return `${year}-${month}-${day}`
            }

            const query = new URLSearchParams({
                storeIds: 'all',
                startDate: formatDate(start),
                endDate: formatDate(end),
                groupBy: groupBy
            })

            setLoadingMessage('Obteniendo datos de 15 tiendas...')
            const res = await fetch(`/api/ventas?${query}`)
            setLoadingMessage('Procesando información...')
            setLoadingMessage('Procesando información...')
            const json = await res.json()

            if (json.meta?.connectionError) {
                setConnError(json.meta.connectionError)
            } else {
                setConnError(null)
            }

            if (json.data) {
                const rows = json.data

                // Calculate Summary Totals
                const summary = rows.reduce((acc: any, row: any) => ({
                    netSales: acc.netSales + row.netSales,
                    grossSales: acc.grossSales + (row.grossSales || 0),
                    discounts: acc.discounts + (row.discounts || 0),
                    tips: acc.tips + (row.tips || 0),
                    taxes: acc.taxes + (row.taxes || 0),
                    orderCount: acc.orderCount + row.orderCount,
                    guestCount: acc.guestCount + row.guestCount,
                    totalHours: acc.totalHours + row.totalHours,
                    laborCost: acc.laborCost + row.laborCost
                }), { netSales: 0, grossSales: 0, discounts: 0, tips: 0, taxes: 0, orderCount: 0, guestCount: 0, totalHours: 0, laborCost: 0 })

                summary.laborPercentage = summary.netSales > 0 ? (summary.laborCost / summary.netSales) * 100 : 0

                // Store Data
                const storeMap = new Map()
                rows.forEach((row: any) => {
                    if (!storeMap.has(row.storeName)) {
                        storeMap.set(row.storeName, {
                            name: row.storeName,
                            storeName: row.storeName,
                            amount: 0,
                            netSales: 0,
                            orderCount: 0,
                            guestCount: 0,
                            laborCost: 0,
                            laborPercentage: 0,
                            totalHours: 0
                        })
                    }
                    const s = storeMap.get(row.storeName)
                    s.amount += row.netSales
                    s.netSales += row.netSales
                    s.orderCount += row.orderCount
                    s.guestCount += row.guestCount
                    s.laborCost += row.laborCost
                    s.totalHours += row.totalHours
                })

                const storeData = Array.from(storeMap.values())
                    .map((s: any) => ({
                        ...s,
                        laborPercentage: s.netSales > 0 ? (s.laborCost / s.netSales) * 100 : 0
                    }))
                    .sort((a: any, b: any) => b.amount - a.amount)

                // Trend Data
                const trendMap = new Map()
                rows.forEach((row: any) => {
                    const key = row.periodStart
                    if (!trendMap.has(key)) trendMap.set(key, 0)
                    trendMap.set(key, trendMap.get(key) + row.netSales)
                })
                const trendData = Array.from(trendMap.entries())
                    .map(([time, amount]) => ({ time, amount }))
                    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

                setData({ summary, trendData, storeData, rows })
            }

        } catch (e) {
            console.error('Error fetching sales data:', e)
        } finally {
            setLastUpdated(new Date())
            setLoading(false)
            setLoadingMessage('')
        }
    }

    useEffect(() => {
        if (period !== 'custom') {
            refreshData()
        }
    }, [period])

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

                {/* Header Content */}
                <div className="relative z-10 space-y-6">

                    {/* Connection Error Banner */}
                    {connError && (
                        <div className="bg-rose-500 text-white px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg animate-in slide-in-from-top-2">
                            <WifiOff size={20} className="stroke-2" />
                            <div>
                                <p className="font-bold text-sm">Conexión con Toast Interrumpida</p>
                                <p className="text-xs opacity-90">Mostrando datos almacenados en caché o limitados. {connError}</p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-sm">
                                    LIVE API CONNECTED
                                </span>
                                <span className="text-xs text-slate-600 dark:text-slate-500 flex items-center gap-1 font-medium italic opacity-80">
                                    <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                                    Updated: {lastUpdated.toLocaleTimeString()}
                                </span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                Dashboard de Ventas
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 mt-1">
                                Monitoreo en tiempo real de 15 sucursales (Toast API)
                            </p>
                        </div>

                        <div className="flex items-center gap-2 bg-white/70 dark:bg-slate-900/80 p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5">
                            <div className="flex bg-slate-100 dark:bg-slate-800/50 rounded-xl p-1">
                                {(['today', 'yesterday', 'week', 'month', 'custom'] as const).map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => setPeriod(p)}
                                        className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${period === p
                                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-md'
                                            : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5'
                                            }`}
                                    >
                                        {p === 'today' ? 'Hoy' : p === 'yesterday' ? 'Ayer' : p === 'week' ? 'Semana' : p === 'month' ? 'Mes' : 'Rango'}
                                    </button>
                                ))}
                            </div>

                            {period === 'custom' && (
                                <div className="flex items-center gap-2 px-2 animate-in fade-in slide-in-from-right-2 duration-300">
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="bg-slate-100 dark:bg-slate-800/50 border border-black/5 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    />
                                    <span className="text-slate-400 text-xs">al</span>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="bg-slate-100 dark:bg-slate-800/50 border border-black/5 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    />
                                </div>
                            )}

                            <div className="w-[1px] h-6 bg-slate-700 mx-1"></div>

                            <button
                                onClick={() => window.location.href = '/ventas/historial'}
                                className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-200 font-medium transition-colors mr-2 border border-black/5 dark:border-slate-700"
                            >
                                <Clock size={18} />
                                <span>Historial Anual</span>
                            </button>

                            <button onClick={refreshData} disabled={loading} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
                                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="mt-4 animate-in fade-in duration-500 flex flex-col items-center gap-4">
                        <SurpriseLoader />
                        {loadingMessage && (
                            <p className="text-slate-500 dark:text-slate-400 text-sm animate-pulse">
                                {loadingMessage}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <SalesSummary data={data.summary} />
                        <SalesCharts trendData={data.trendData} storeData={data.storeData} />

                        {/* Table */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5">
                            <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 flex justify-between items-center">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
                                    <Store size={18} className="text-emerald-500" />
                                    Detalle por Sucursal
                                </h3>
                                <button className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80 flex items-center gap-1 uppercase tracking-wider">
                                    <Download size={14} /> Exportar CSV
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-base text-left">
                                    <thead className="bg-slate-100 dark:bg-slate-950/50 text-slate-700 dark:text-slate-400 text-xs uppercase font-semibold tracking-widest border-b border-black/5 dark:border-slate-800">
                                        <tr>
                                            <th className="px-6 py-4 w-12 text-center">#</th>
                                            <th className="px-6 py-4">Sucursal</th>
                                            <th className="px-6 py-4 text-right">Ventas Netas</th>
                                            <th className="px-6 py-4 text-right">Órdenes</th>
                                            <th className="px-6 py-4 text-right">Ticket Promedio</th>
                                            <th className="px-6 py-4 text-right">Labor %</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5 dark:divide-slate-800">
                                        {data.storeData.map((store: any, idx: number) => {
                                            const orders = store.orderCount || 1
                                            const laborPct = store.laborPercentage.toFixed(2)

                                            return (
                                                <tr key={idx} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors group">
                                                    <td className="px-6 py-4 text-center text-slate-400 font-mono text-sm">
                                                        {idx + 1}
                                                    </td>
                                                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white text-lg">
                                                        {formatStoreName(store.name || store.storeName)}
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-lg">
                                                        ${store.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-slate-700 dark:text-white font-medium">
                                                        {orders.toLocaleString('en-US')}
                                                    </td>
                                                    <td className="px-6 py-4 text-right text-slate-500 dark:text-slate-300">
                                                        ${(store.amount / orders).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <span className={`px-2.5 py-1 rounded-lg font-bold text-lg inline-flex items-center gap-1 ${Number(laborPct) < 21.5
                                                            ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                            : Number(laborPct) > 23
                                                                ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 animate-pulse'
                                                                : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                                            }`}>
                                                            {laborPct}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}
