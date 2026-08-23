/**
 * @module ventas/historial/page
 * @description Annual Historical Sales Matrix and Business Intelligence Growth Analysis for Tacos Gavilan.
 * @businessRules
 * - Provides month-by-month sales matrix across all 15 active store locations.
 * - Supports YTD comparisons vs previous calendar year with exact-day alignment.
 * - Prevents growth distortion by tracking newly opened and closed stores symmetrically.
 * - Exportable to CSV with formatted currency and totals.
 * @dataFlow
 * - Client -> GET /api/ventas/yearly -> Supabase sales_daily_cache -> History Matrix UI & YTD BI Analysis.
 */
'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, TrendingUp, Award, AlertCircle } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'

function HistoryPageContent() {
    const { t, language } = useLanguage()
    const router = useRouter()
    const currentYear = new Date().getFullYear()
    const [year, setYear] = useState(currentYear)
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<any[]>([])
    // Totales verticales (por mes)
    const [monthTotals, setMonthTotals] = useState<number[]>(Array(12).fill(0))
    const [grandTotal, setGrandTotal] = useState(0)

    const months = language === 'es' 
        ? ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'] 
        : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    
    const [years, setYears] = useState<number[]>([new Date().getFullYear()])

    useEffect(() => {
        const fetchYears = async () => {
            try {
                const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
                const res = await fetch('/api/ventas/yearly?mode=years', {
                    headers: { 'Authorization': `Bearer ${token || ''}` }
                })
                const list = await res.json()
                if (Array.isArray(list) && list.length > 0) {
                    setYears(list)
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
        const controller = new AbortController()
        fetchData(controller.signal)
        return () => controller.abort()
    }, [year])

    const fetchData = async (signal?: AbortSignal) => {
        setLoading(true)
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const res = await fetch(`/api/ventas/yearly?year=${year}&t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token || ''}` },
                signal
            })
            const json = await res.json()
            const rows = json.data || (Array.isArray(json) ? json : [])

            if (Array.isArray(rows)) {
                setData(rows)

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
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                console.error(error)
            }
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

    // Export CSV Handler
    const handleExportCSV = () => {
        if (!data || data.length === 0) return
        const headers = [t('sales.history_page.store'), ...months, t('sales.history_page.total')]
        const rows = data.map(row => [
            `"${formatStoreName(row.name)}"`,
            ...row.months.map((m: number) => m.toFixed(2)),
            row.total.toFixed(2)
        ])
        rows.push([`"${t('sales.history_page.global')}"`, ...monthTotals.map(t => t.toFixed(2)), grandTotal.toFixed(2)])

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', `historial_ventas_${year}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    // Función para determinar estilos de celda
    const getCellStyle = (val: number, rowMonths: number[]) => {
        const validValues = rowMonths.filter(v => v > 0)
        if (validValues.length === 0 || val === 0) return 'text-slate-300 dark:text-slate-700'
        if (validValues.length === 1) return 'text-slate-600 dark:text-slate-300'

        const max = Math.max(...validValues)
        const min = Math.min(...validValues)

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
                            className="p-3 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors group cursor-pointer"
                        >
                            <ArrowLeft className="text-slate-700 dark:text-slate-300 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                                <Award className="text-yellow-500 fill-yellow-500/20" />
                                {t('sales.history_page.title')}
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 font-medium">
                                {t('sales.history_page.subtitle')}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 w-full xl:w-auto">
                        <button
                            onClick={handleExportCSV}
                            disabled={loading || data.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                        >
                            <Download size={15} />
                            {t('sales.history_page.export_csv')}
                        </button>

                        <div className="overflow-x-auto pb-2 xl:pb-0 scrollbar-hide">
                            <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900/50 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-md">
                                {years.map(y => (
                                    <button
                                        key={y}
                                        onClick={() => setYear(y)}
                                        className={`
                                            relative px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap cursor-pointer
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
                </div>

                {loading ? (
                    <div className="h-96 flex flex-col items-center justify-center">
                        <SurpriseLoader />
                        <p className="mt-4 text-slate-400 animate-pulse">{t('sales.history_page.loading')}</p>
                    </div>
                ) : (
                    <>
                        {data.length > 0 && (
                            <div className="flex gap-8 text-sm font-bold text-slate-700 dark:text-slate-300 justify-end items-center mb-4 px-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-500 rounded-full shadow-sm"></span>
                                    <span>{t('sales.history_page.best_month')}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 bg-rose-100 dark:bg-rose-900/40 border-2 border-rose-500 rounded-full shadow-sm"></span>
                                    <span>{t('sales.history_page.worst_month')}</span>
                                </div>
                            </div>
                        )}
                        <div className="hidden md:block bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/5">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs md:text-sm">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase text-[10px] md:text-xs tracking-wider font-bold">
                                            <th className="px-3 py-3 text-left border-b dark:border-slate-800 sticky left-0 bg-slate-100 dark:bg-slate-950 z-20 w-48 md:w-56 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{t('sales.history_page.store')}</th>
                                            {months.map(m => (
                                                <th key={m} className="px-1 py-3 text-center border-b border-r border-slate-100 dark:border-slate-800 dark:border-r-slate-800/50 min-w-[80px] last:border-r-0">{m}</th>
                                            ))}
                                            <th className="px-3 py-3 text-right border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 font-medium text-slate-900 dark:text-white min-w-[100px]">{t('sales.history_page.total')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {data.map((row, idx) => (
                                            <tr key={idx} className="group transition-all hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-default">
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
                                            <td className="px-3 py-3 sticky left-0 bg-slate-900 dark:bg-black z-20 border-t border-slate-700 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">{t('sales.history_page.global')}</td>
                                            {monthTotals.map((tot, idx) => (
                                                <td key={idx} className="px-1 py-3 text-right border-t border-slate-700">
                                                    {tot > 0 ? (
                                                        <span className="opacity-90">{formatCurrency(tot)}</span>
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

                        {/* MOBILE CARD VIEW FOR HISTORY MATRIX */}
                        <div className="md:hidden space-y-4">
                            {data.map((row, idx) => (
                                <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                                    <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                                            {formatStoreName(row.name)}
                                        </h3>
                                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-lg text-xs font-bold">
                                            {formatCurrency(row.total)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        {row.months.map((val: number, mIdx: number) => (
                                            <div key={mIdx} className={`rounded-lg p-1.5 flex flex-col ${getCellStyle(val, row.months)}`}>
                                                <span className="text-[10px] uppercase font-bold opacity-60">{months[mIdx]}</span>
                                                <span className="text-xs font-semibold">
                                                    {val === 0 ? '-' : (val / 1000).toFixed(1) + 'k'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-3 pt-2 text-right text-xs text-slate-400">
                                        {t('sales.history_page.values_in_k')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* SECCIÓN DE ANÁLISIS PROFUNDO (BUSINESS INTELLIGENCE) */}
            {!loading && data.length > 0 && (
                <div className="max-w-[1600px] mx-auto space-y-6 mt-12 border-t pt-8 border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-xl">
                            <TrendingUp className="text-blue-600 dark:text-blue-400" size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('sales.history_page.analysis.title')}</h2>
                            <p className="text-slate-500 dark:text-slate-400">{t('sales.history_page.analysis.subtitle')} ({year - 1})</p>
                        </div>
                    </div>

                    <AnalysisSection currentData={data} year={year} />
                </div>
            )}
        </div>
    )
}

function AnalysisSection({ currentData, year }: { currentData: any[], year: number }) {
    const { t, language } = useLanguage()
    const [prevData, setPrevData] = useState<any[]>([])
    const [loadingPrev, setLoadingPrev] = useState(true)

    useEffect(() => {
        const fetchPrev = async () => {
            setLoadingPrev(true)
            try {
                const now = new Date()
                const isCurrentYear = year === now.getFullYear()
                let url = `/api/ventas/yearly?year=${year - 1}`

                if (isCurrentYear) {
                    const targetDate = new Date(now)
                    if (targetDate.getMonth() === 0 && targetDate.getDate() === 1) {
                        // On Jan 1st, compare up to Jan 1st
                    } else {
                        targetDate.setDate(targetDate.getDate() - 1)
                    }
                    const mPad = String(targetDate.getMonth() + 1).padStart(2, '0')
                    const dPad = String(targetDate.getDate()).padStart(2, '0')
                    const limitStr = `${year - 1}-${mPad}-${dPad}`
                    url += `&limit_date=${limitStr}`
                }

                const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token || ''}` }
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

    if (loadingPrev) return <div className="text-slate-400 animate-pulse py-10">{t('sales.history_page.loading')}</div>

    const now = new Date()
    const isCurrentYear = year === now.getFullYear()

    const targetDate = new Date(now)
    if (!(targetDate.getMonth() === 0 && targetDate.getDate() === 1)) {
        targetDate.setDate(targetDate.getDate() - 1)
    }
    const monthNamesEs = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    const monthNamesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const monthName = language === 'es' ? monthNamesEs[targetDate.getMonth()] : monthNamesEn[targetDate.getMonth()]

    const comparisonLabel = isCurrentYear
        ? language === 'es'
            ? `Vs. ${year - 1} (YTD exacto al ${targetDate.getDate()} de ${monthName})`
            : `Vs. ${year - 1} (Exact YTD as of ${monthName} ${targetDate.getDate()})`
        : `Vs. Total ${year - 1}`

    // Unify all stores (both current and previous year) to prevent financial skew
    const allStoreNames = Array.from(new Set([...currentData.map(d => d.name), ...prevData.map(d => d.name)]))

    const comparison = allStoreNames.map(name => {
        const curr = currentData.find(c => c.name === name)
        const prev = prevData.find(p => p.name === name)
        const currTotal = curr ? Number(curr.total || 0) : 0
        const prevTotal = prev ? Number(prev.total || 0) : 0
        const diff = currTotal - prevTotal
        const percent = prevTotal === 0 ? (currTotal > 0 ? 100 : 0) : (diff / prevTotal) * 100
        const isNew = prevTotal === 0 && currTotal > 0
        const isClosed = currTotal === 0 && prevTotal > 0

        return {
            name,
            curr: currTotal,
            prev: prevTotal,
            diff,
            percent,
            isNew,
            isClosed
        }
    }).sort((a, b) => b.percent - a.percent)

    const globalCurr = comparison.reduce((sum, item) => sum + item.curr, 0)
    const globalPrev = comparison.reduce((sum, item) => sum + item.prev, 0)
    const globalDiff = globalCurr - globalPrev
    const globalPercent = globalPrev === 0 ? (globalCurr > 0 ? 100 : 0) : (globalDiff / globalPrev) * 100

    const bestStore = comparison.length > 0 ? comparison[0] : null
    const activeStores = comparison.filter(s => !s.isClosed)
    const worstStore = activeStores.length > 1 ? activeStores[activeStores.length - 1] : (comparison.length > 1 ? comparison[comparison.length - 1] : null)

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)
    const formatPercent = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(2)}%`

    return (
        <div className="space-y-8">
            {/* 1. TARJETAS DE KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Global Growth */}
                <div className={`p-6 rounded-3xl border ${globalDiff >= 0 ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-500/20' : 'bg-rose-50 border-rose-100 dark:bg-rose-900/10 dark:border-rose-500/20'}`}>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1">{t('sales.history_page.analysis.growth_card')}</h3>
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
                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded text-xs font-bold">{t('sales.history_page.analysis.mvp_card.badge')}</span>
                        {t('sales.history_page.analysis.mvp_card.label')}
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{formatStoreName(bestStore?.name || '-')}</span>
                        <span className="text-emerald-500 font-bold">{bestStore ? formatPercent(bestStore.percent) : '0%'}</span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>

                {/* Alert Store */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AlertCircle size={64} className="text-rose-500" />
                    </div>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1 flex items-center gap-2">
                        <span className="bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded text-xs font-bold">{t('sales.history_page.analysis.alert_card.badge')}</span>
                        {t('sales.history_page.analysis.alert_card.label')}
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{formatStoreName(worstStore?.name || '-')}</span>
                        <span className="text-rose-500 font-bold">{worstStore ? formatPercent(worstStore.percent) : '0%'}</span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>
            </div>

            {/* 2. TABLA COMPARATIVA DETALLADA */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-black/5 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('sales.history_page.analysis.table_title')}</h3>
                </div>

                {/* DESKTOP TABLE */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase text-xs font-bold">
                            <tr>
                                <th className="px-6 py-3 text-left">{t('sales.history_page.analysis.columns.store')}</th>
                                <th className="px-6 py-3 text-right">{t('sales.history_page.analysis.columns.sales_prev')} {year - 1}</th>
                                <th className="px-6 py-3 text-right">{t('sales.history_page.analysis.columns.sales_curr')} {year}</th>
                                <th className="px-6 py-3 text-right">{t('sales.history_page.analysis.columns.diff')}</th>
                                <th className="px-6 py-3 text-right">{t('sales.history_page.analysis.columns.growth')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {comparison.map((item, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                        {formatStoreName(item.name)}
                                        {item.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold">{t('sales.history_page.new_store')}</span>}
                                        {item.isClosed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-bold">{t('sales.history_page.closed_store')}</span>}
                                    </td>
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

                {/* MOBILE LIST */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {comparison.map((item, idx) => (
                        <div key={idx} className="p-4 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <h4 className="font-bold text-slate-900 dark:text-white">
                                    {formatStoreName(item.name)}
                                    {item.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold">{t('sales.history_page.new_store')}</span>}
                                    {item.isClosed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-bold">{t('sales.history_page.closed_store')}</span>}
                                </h4>
                                <span className={`px-2 py-1 rounded-lg font-bold text-xs ${item.percent >= 0
                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                    }`}>
                                    {formatPercent(item.percent)}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <div className="text-slate-500">
                                    <span className="text-xs uppercase tracking-wider block opacity-70">{year - 1}</span>
                                    {formatCurrency(item.prev)}
                                </div>
                                <div className="text-right">
                                    <span className="text-xs uppercase tracking-wider block opacity-70 text-slate-500">{year}</span>
                                    <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(item.curr)}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default function HistoryPage() {
    return (
        <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager']}>
            <HistoryPageContent />
        </ProtectedRoute>
    )
}
