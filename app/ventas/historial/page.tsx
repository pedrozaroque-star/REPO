
'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, Download, TrendingUp, TrendingDown, Award, AlertCircle } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute from '@/components/ProtectedRoute' // 🔒 SECURITY IMPORT

function HistoryPageContent() {
    const router = useRouter()
    const currentYear = new Date().getFullYear()
    const [year, setYear] = useState(currentYear)
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<any[]>([])
    // Totales verticales (por mes)
    const [monthTotals, setMonthTotals] = useState<number[]>(Array(12).fill(0))
    const [grandTotal, setGrandTotal] = useState(0)

    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
    const [years, setYears] = useState<number[]>([new Date().getFullYear()])

    useEffect(() => {
        // Cargar años disponibles primero
        const fetchYears = async () => {
            try {
                // 🔒 SECURITY INJECTION
                const token = localStorage.getItem('teg_token')
                const res = await fetch('/api/ventas/yearly?mode=years', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })

                const list = await res.json()
                if (Array.isArray(list) && list.length > 0) {
                    setYears(list)
                    // Si el año actual no está en la lista (ej. estamos en 2026 pero solo hay 2025), seleccionar el primero
                    if (!list.includes(year)) {
                        setYear(list[0])
                    }
                }
            } catch (e) {
                console.error("Error fetching years", e)
            }
        }
        fetchYears()
    }, [])

    useEffect(() => {
        fetchData()
    }, [year])

    const fetchData = async () => {
        setLoading(true)
        try {
            // 🔒 SECURITY INJECTION
            const token = localStorage.getItem('teg_token')
            const res = await fetch(`/api/ventas/yearly?year=${year}&t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const json = await res.json()
            const rows = json.data || (Array.isArray(json) ? json : [])

            if (json.meta) {
                console.log("📊 API Debug:", json.meta)
            }

            if (Array.isArray(rows)) {
                setData(rows)

                // Calcular totales verticales
                const mTotals = Array(12).fill(0)
                let gTotal = 0
                rows.forEach((row: any) => {
                    row.months.forEach((val: number, idx: number) => {
                        mTotals[idx] += val
                    })
                    gTotal += row.total
                })
                setMonthTotals(mTotals)
                setGrandTotal(gTotal)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(val)
    }

    // Función para determinar estilos de celda
    const getCellStyle = (val: number, rowMonths: number[]) => {
        // Filtrar ceros para no falsear el mínimo si la tienda no abrió
        const validValues = rowMonths.filter(v => v > 0)
        const max = Math.max(...validValues)
        const min = Math.min(...validValues)

        if (val === 0) return 'text-slate-300 dark:text-slate-700'

        if (val === max) return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold border-2 border-emerald-500/20'
        if (val === min) return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 font-bold border-2 border-rose-500/10'

        return 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
    }

    return (
        <div className="min-h-screen bg-slate-50/50 dark:bg-[#0a0a0a] p-4 md:p-8">
            <div className="max-w-[1600px] mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.back()}
                            className="p-3 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors group"
                        >
                            <ArrowLeft className="text-slate-700 dark:text-slate-300 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                                <Award className="text-yellow-500 fill-yellow-500/20" />
                                Historial Anual
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">
                                Matriz de rendimiento mensual
                            </p>
                        </div>
                    </div>

                    <div className="w-full xl:w-auto overflow-x-auto pb-2 xl:pb-0 scrollbar-hide">
                        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900/50 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-md">
                            {years.map(y => (
                                <button
                                    key={y}
                                    onClick={() => setYear(y)}
                                    className={`
                                        relative px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap
                                        ${year === y
                                            ? 'bg-white dark:bg-emerald-500 text-slate-900 dark:text-white shadow-lg shadow-black/5 dark:shadow-emerald-500/20 scale-100 ring-1 ring-black/5 dark:ring-transparent'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5'
                                        }
                                    `}
                                >
                                    {y}
                                    {y === new Date().getFullYear() && (
                                        <span className="absolute top-2 right-2 flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="h-96 flex flex-col items-center justify-center">
                        <SurpriseLoader />
                        <p className="mt-4 text-slate-400 animate-pulse">Consultando Archivos Históricos...</p>
                    </div>
                ) : (
                    <>
                        {data.length > 0 && (
                            <div className="flex gap-8 text-lg md:text-xl font-bold text-slate-700 dark:text-slate-300 justify-end items-center mb-4 px-2">
                                <div className="flex items-center gap-3">
                                    <span className="w-6 h-6 bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-500 rounded-full shadow-sm"></span>
                                    <span>Mejor Mes</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="w-6 h-6 bg-rose-100 dark:bg-rose-900/40 border-2 border-rose-500 rounded-full shadow-sm"></span>
                                    <span>Peor Mes</span>
                                </div>
                            </div>
                        )}
                        <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/5">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs md:text-sm">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase text-[10px] md:text-xs tracking-wider font-bold">
                                            <th className="px-3 py-3 text-left border-b dark:border-slate-800 sticky left-0 bg-slate-100 dark:bg-slate-950 z-20 w-48 md:w-56 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Sucursal</th>
                                            {months.map(m => (
                                                <th key={m} className="px-1 py-3 text-center border-b border-r border-slate-100 dark:border-slate-800 dark:border-r-slate-800/50 min-w-[80px] last:border-r-0">{m}</th>
                                            ))}
                                            <th className="px-3 py-3 text-right border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 font-medium text-slate-900 dark:text-white min-w-[100px]">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {data.map((row, idx) => (
                                            <tr key={idx} className="group transition-all hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-default">
                                                {/* Sticky Cell con highlight sincronizado */}
                                                <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-200 border-r dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 z-10 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm md:text-base truncate max-w-[250px] transition-colors" title={row.name}>
                                                    {formatStoreName(row.name)}
                                                </td>
                                                {row.months.map((val: number, mIdx: number) => (
                                                    <td key={mIdx} className="p-0.5 border-r border-slate-100 dark:border-slate-800/50 last:border-r-0">
                                                        <div className={`w-full h-full flex items-center justify-center px-1.5 py-1.5 rounded-md transition-all text-[11px] md:text-[13px] ${getCellStyle(val, row.months)} group-hover:scale-105 group-hover:shadow-sm`}>
                                                            {val === 0 ? '-' : formatCurrency(val)}
                                                        </div>
                                                    </td>
                                                ))}
                                                <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900/30 border-l dark:border-slate-800 text-sm md:text-base group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
                                                    {formatCurrency(row.total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-900 dark:bg-black text-white font-medium text-[10px] md:text-xs">
                                            <td className="px-3 py-3 sticky left-0 bg-slate-900 dark:bg-black z-20 border-t border-slate-700 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">GLOBAL</td>
                                            {monthTotals.map((t, idx) => (
                                                <td key={idx} className="px-1 py-3 text-right border-t border-slate-700">
                                                    {t > 0 ? (
                                                        <span className="opacity-90">{formatCurrency(t)}</span>
                                                    ) : <span className="opacity-20">-</span>}
                                                </td>
                                            ))}
                                            <td className="px-3 py-3 text-right text-emerald-400 font-medium text-lg md:text-xl border-t border-slate-700 bg-slate-800/50">
                                                {formatCurrency(grandTotal)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </>
                )}

            </div>

            {/* SECCIÓN DE ANÁLISIS PROFUNDO (BUSINESS INTELLIGENCE) */}
            {!loading && data.length > 0 && (
                <div className="space-y-6 mt-12 border-t pt-8 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-xl">
                            <TrendingUp className="text-blue-600 dark:text-blue-400" size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Análisis de Crecimiento</h2>
                            <p className="text-slate-500 dark:text-slate-400">Comparativa vs. Año Anterior ({year - 1})</p>
                        </div>
                    </div>

                    <AnalysisSection currentData={data} year={year} />
                </div>
            )}
        </div>
    )
}

// COMPONENTE DE ANÁLISIS AISLADO PARA LIMPIEZA
function AnalysisSection({ currentData, year }: { currentData: any[], year: number }) {
    const [prevData, setPrevData] = useState<any[]>([])
    const [loadingPrev, setLoadingPrev] = useState(true)

    useEffect(() => {
        const fetchPrev = async () => {
            setLoadingPrev(true)
            try {
                // Determine logic
                const now = new Date()
                const isCurrentYear = year === now.getFullYear()
                let url = `/api/ventas/yearly?year=${year - 1}`

                if (isCurrentYear) {
                    const limitDate = new Date(year - 1, now.getMonth(), now.getDate() - 1)
                    const limitStr = limitDate.toISOString().split('T')[0]
                    url += `&limit_date=${limitStr}`
                }

                // 🔒 SECURITY INJECTION HERE TOO
                const token = localStorage.getItem('teg_token')
                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })

                const json = await res.json()
                const rows = json.data || (Array.isArray(json) ? json : [])
                setPrevData(rows)
            } catch (err) {
                console.error("Error fetching prev year", err)
            } finally {
                setLoadingPrev(false)
            }
        }
        fetchPrev()
    }, [year])

    if (loadingPrev) return <div className="text-slate-400 animate-pulse py-10">Calculando variaciones anuales...</div>

    // LÓGICA DE COMPARACIÓN (Restored)
    const now = new Date()
    const isCurrentYear = year === now.getFullYear()

    let comparisonLabel = `Vs. Total ${year - 1}`
    if (isCurrentYear) {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        comparisonLabel = `Vs. ${year - 1} (YTD exacto al ${yesterday.getDate()} de ${monthNames[yesterday.getMonth()]})`
    }

    const comparison = currentData.map(curr => {
        const prev = prevData.find(p => p.name === curr.name)
        const prevTotal = prev ? prev.total : 0

        const diff = curr.total - prevTotal
        const percent = prevTotal === 0 ? (curr.total > 0 ? 100 : 0) : (diff / prevTotal) * 100
        return {
            name: curr.name,
            curr: curr.total,
            prev: prevTotal,
            diff,
            percent
        }
    }).sort((a, b) => b.percent - a.percent)



    const globalCurr = comparison.reduce((sum, item) => sum + item.curr, 0)
    const globalPrev = comparison.reduce((sum, item) => sum + item.prev, 0)
    const globalDiff = globalCurr - globalPrev
    const globalPercent = globalPrev === 0 ? 0 : (globalDiff / globalPrev) * 100

    const bestStore = comparison[0]
    const worstStore = comparison[comparison.length - 1]

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)
    const formatPercent = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(2)}%`

    return (
        <div className="space-y-8">
            {/* 1. TARJETAS DE KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Global Growth */}
                <div className={`p-6 rounded-3xl border ${globalDiff >= 0 ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-500/20' : 'bg-rose-50 border-rose-100 dark:bg-rose-900/10 dark:border-rose-500/20'}`}>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1">Crecimiento Global</h3>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-4xl font-extrabold ${globalDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatPercent(globalPercent)}
                        </span>
                        <span className="text-sm font-semibold opacity-70 flex items-center">
                            ({formatCurrency(globalDiff)})
                        </span>
                    </div>
                    <p className="text-sm mt-2 opacity-70">{comparisonLabel}</p>
                </div>

                {/* MVP Store */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <TrendingUp size={64} className="text-emerald-500" />
                    </div>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1 flex items-center gap-2">
                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded text-xs font-bold">MVP</span>
                        Mayor Crecimiento
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{formatStoreName(bestStore?.name || '-')}</span>
                        <span className="text-emerald-500 font-bold">{formatPercent(bestStore?.percent || 0)}</span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>

                {/* Alert Store */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AlertCircle size={64} className="text-rose-500" />
                    </div>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1 flex items-center gap-2">
                        <span className="bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded text-xs font-bold">ALERTA</span>
                        Mayor Caída
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{formatStoreName(worstStore?.name || '-')}</span>
                        <span className="text-rose-500 font-bold">{formatPercent(worstStore?.percent || 0)}</span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>
            </div>

            {/* 2. TABLA COMPARATIVA DETALLADA */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-black/5 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">Desglose por Sucursal (Año vs Año)</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase text-xs font-bold">
                            <tr>
                                <th className="px-6 py-3 text-left">Sucursal</th>
                                <th className="px-6 py-3 text-right">Venta {year - 1}</th>
                                <th className="px-6 py-3 text-right">Venta {year}</th>
                                <th className="px-6 py-3 text-right">Diferencia $</th>
                                <th className="px-6 py-3 text-right">Crecimiento %</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {comparison.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">{formatStoreName(item.name)}</td>
                                    <td className="px-6 py-3 text-right text-slate-500 dark:text-slate-400">{formatCurrency(item.prev)}</td>
                                    <td className="px-6 py-3 text-right font-bold text-slate-900 dark:text-white">{formatCurrency(item.curr)}</td>
                                    <td className={`px-6 py-3 text-right font-medium ${item.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {item.diff > 0 ? '+' : ''}{formatCurrency(item.diff)}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                        <span className={`px-2 py-1 rounded-lg font-bold text-xs ${item.percent >= 0
                                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                            : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                            }`}>
                                            {formatPercent(item.percent)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

// 🔒 SECURITY WRAPPER 
export default function HistoryPage() {
    return (
        <ProtectedRoute role="admin">
            <HistoryPageContent />
        </ProtectedRoute>
    )
}
