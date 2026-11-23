/**
 * @module ventas/historial/page
 * @description Annual Historical Sales Matrix and Business Intelligence Growth Analysis for Tacos Gavilan.
 * @businessRules
 * - Provides month-by-month sales matrix across all active store locations (LA 6:00 AM business day calendar).
 * - Supports symmetrical closed-day YTD comparisons vs previous calendar year (excluding current live intraday day
 *   from both years and clamping Feb 29 on non-leap years) so YoY percentages are mathematically apples-to-apples.
 * - Matches stores by canonical store_id (with normalized name fallback) to prevent skew on store renames.
 * - Excludes newly opened / closed stores from MVP/Alert rankings and reports Same-Store Growth alongside Global Growth.
 * - Excludes the current in-progress calendar month from "Worst Month" red highlighting.
 * - Exportable to formula-safe CSV (UTF-8 BOM) and printable directly via window.print().
 * @dataFlow
 * - Client -> GET /api/ventas/yearly -> Supabase sales_daily_cache -> History Matrix UI & Symmetrical YTD BI Analysis.
 * @notes
 * - 2026-11-23 Deep Audit Fix: Fixed asymmetric YTD (live current year vs closed prior year), UTC year mismatch after 4 PM PST,
 *   fake "+100% New Store" on earliest historical year, AbortController race conditions, negative/positive diff formatting,
 *   mobile Global totals & Diff parity, CSV injection escaping, and in-progress month false "Worst Month" highlight.
 */
'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, Printer, TrendingUp, Award, AlertCircle, Info } from 'lucide-react'
import SurpriseLoader from '@/components/SurpriseLoader'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import {
    getBusinessDateLA,
    addDaysIso,
    formatSignedUSD,
    escapeCsvCell
} from '@/lib/inventory/food-cost-sales-resolver'

interface YearlyStoreRow {
    store_id?: string
    name: string
    months: number[]
    total: number
}

function getDaysInMonthUTC(year: number, month1Based: number): number {
    return new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
}

function clampIsoToYear(isoDate: string, targetYear: number): string {
    const [, mStr, dStr] = isoDate.split('-')
    const m = parseInt(mStr, 10)
    const d = parseInt(dStr, 10)
    const maxDay = getDaysInMonthUTC(targetYear, m)
    const safeDay = Math.min(d, maxDay)
    return `${targetYear}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function HistoryPageContent() {
    const { t, language } = useLanguage()
    const router = useRouter()

    const businessDateLA = useMemo(() => getBusinessDateLA(), [])
    const currentBusinessYear = useMemo(() => parseInt(businessDateLA.slice(0, 4), 10), [businessDateLA])
    const currentBusinessMonthIdx = useMemo(() => parseInt(businessDateLA.slice(5, 7), 10) - 1, [businessDateLA])

    const [year, setYear] = useState<number>(currentBusinessYear)
    const [loading, setLoading] = useState<boolean>(true)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [data, setData] = useState<YearlyStoreRow[]>([])
    const [monthTotals, setMonthTotals] = useState<number[]>(Array(12).fill(0))
    const [grandTotal, setGrandTotal] = useState<number>(0)
    const [years, setYears] = useState<number[]>([currentBusinessYear])

    const months = language === 'es'
        ? ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
        : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

    useEffect(() => {
        const controller = new AbortController()
        const fetchYears = async () => {
            try {
                const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
                const res = await fetch('/api/ventas/yearly?mode=years', {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    signal: controller.signal
                })
                if (!res.ok) return
                const list = await res.json()
                if (Array.isArray(list) && list.length > 0) {
                    const numericYears = list.map((y: unknown) => Number(y)).filter((y: number) => Number.isFinite(y))
                    if (numericYears.length > 0) {
                        setYears(numericYears)
                        setYear(prev => (numericYears.includes(prev) ? prev : numericYears[0]))
                    }
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError') {
                    console.error('Error fetching years', e)
                }
            }
        }
        fetchYears()
        return () => controller.abort()
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        const fetchData = async () => {
            setLoading(true)
            setErrorMsg(null)
            try {
                const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
                const res = await fetch(`/api/ventas/yearly?year=${year}&t=${Date.now()}`, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                    signal: controller.signal
                })
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`)
                }
                const json = await res.json()
                const rawRows = json.data || (Array.isArray(json) ? json : [])

                if (Array.isArray(rawRows)) {
                    const normalized: YearlyStoreRow[] = rawRows.map((row: any) => {
                        const safeMonths = Array.from({ length: 12 }, (_, idx) => Number(row.months?.[idx] || 0))
                        const safeTotal = Number(row.total ?? safeMonths.reduce((a, b) => a + b, 0))
                        return {
                            store_id: row.store_id ? String(row.store_id) : undefined,
                            name: String(row.name || ''),
                            months: safeMonths,
                            total: Number.isFinite(safeTotal) ? safeTotal : 0
                        }
                    })
                    setData(normalized)

                    const mTotals = Array(12).fill(0)
                    let gTotal = 0
                    normalized.forEach((row) => {
                        row.months.forEach((val, idx) => {
                            mTotals[idx] += val
                        })
                        gTotal += row.total
                    })
                    setMonthTotals(mTotals)
                    setGrandTotal(gTotal)
                }
            } catch (error: any) {
                if (error?.name !== 'AbortError') {
                    console.error('Error fetching yearly history:', error)
                    setErrorMsg(t('sales.history_page.error_loading'))
                    setData([])
                    setMonthTotals(Array(12).fill(0))
                    setGrandTotal(0)
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }
        fetchData()
        return () => controller.abort()
    }, [year, t])

    const formatCurrency = (val: number) => formatSignedUSD(val, { decimals: 2 })

    // Export CSV Handler (formula-safe & UTF-8 BOM)
    const handleExportCSV = () => {
        if (!data || data.length === 0) return
        const headers = [t('sales.history_page.store'), ...months, t('sales.history_page.total')]
        const rows = data.map(row => [
            escapeCsvCell(formatStoreName(row.name)),
            ...row.months.map((m) => Number(m || 0).toFixed(2)),
            Number(row.total || 0).toFixed(2)
        ])
        rows.push([
            escapeCsvCell(t('sales.history_page.global')),
            ...monthTotals.map((tot) => Number(tot || 0).toFixed(2)),
            Number(grandTotal || 0).toFixed(2)
        ])

        const csvContent = [
            headers.map(h => escapeCsvCell(h)).join(','),
            ...rows.map(r => r.join(','))
        ].join('\n')
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', language === 'es' ? `historial_ventas_${year}.csv` : `sales_history_${year}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    // Determine cell highlight (excludes incomplete current month from "Worst Month" red alert)
    const getCellStyle = (val: number, rowMonths: number[], mIdx: number) => {
        const isCurrentInProgressMonth = year === currentBusinessYear && mIdx === currentBusinessMonthIdx
        if (!Number.isFinite(val) || val <= 0) return 'text-slate-300 dark:text-slate-700'

        const completedValues = rowMonths
            .map((v, idx) => ({ v, idx }))
            .filter(({ v, idx }) => v > 0 && !(year === currentBusinessYear && idx === currentBusinessMonthIdx))
            .map(({ v }) => v)

        const allPositiveValues = rowMonths.filter(v => v > 0)
        if (allPositiveValues.length <= 1) {
            return isCurrentInProgressMonth
                ? 'bg-sky-50/70 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 font-medium border border-sky-300/40 dark:border-sky-700/40'
                : 'text-slate-600 dark:text-slate-300'
        }

        const max = Math.max(...allPositiveValues)
        if (val === max) {
            return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold border-2 border-emerald-500/20'
        }

        if (isCurrentInProgressMonth) {
            return 'bg-sky-50/70 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 font-medium border border-sky-300/40 dark:border-sky-700/40'
        }

        if (completedValues.length >= 2) {
            const minCompleted = Math.min(...completedValues)
            if (val === minCompleted) {
                return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 font-bold border-2 border-rose-500/10'
            }
        }

        return 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
    }

    return (
        <div className="min-h-screen bg-slate-50/50 dark:bg-[#0a0a0a] p-4 md:p-8">
            <div className="max-w-[1600px] mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            aria-label={t('sales.history_page.back_aria')}
                            className="p-3 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors group cursor-pointer print:hidden"
                        >
                            <ArrowLeft className="text-slate-700 dark:text-slate-300 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
                                <Award className="text-yellow-500 fill-yellow-500/20 shrink-0" />
                                {t('sales.history_page.title')}
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm sm:text-base">
                                {t('sales.history_page.subtitle')}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto print:hidden">
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            disabled={loading || data.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                        >
                            <Download size={15} />
                            {t('sales.history_page.export_csv')}
                        </button>

                        <button
                            type="button"
                            onClick={() => window.print()}
                            disabled={loading || data.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                        >
                            <Printer size={15} />
                            {t('sales.history_page.print_report')}
                        </button>

                        <div className="overflow-x-auto pb-1 xl:pb-0 scrollbar-hide max-w-full">
                            <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900/50 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-md">
                                {years.map(y => (
                                    <button
                                        key={y}
                                        type="button"
                                        onClick={() => setYear(y)}
                                        className={`
                                            relative px-5 sm:px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap cursor-pointer
                                            ${year === y
                                                ? 'bg-white dark:bg-emerald-500 text-slate-900 dark:text-white shadow-lg shadow-black/5 dark:shadow-emerald-500/20 scale-100 ring-1 ring-black/5 dark:ring-transparent'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/5'
                                            }
                                        `}
                                    >
                                        {y}
                                        {y === currentBusinessYear && (
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

                {errorMsg && (
                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-sm font-medium">
                        <AlertCircle size={18} className="shrink-0" />
                        <span>{errorMsg}</span>
                    </div>
                )}

                {loading ? (
                    <div className="h-96 flex flex-col items-center justify-center">
                        <SurpriseLoader />
                        <p className="mt-4 text-slate-400 animate-pulse">{t('sales.history_page.loading')}</p>
                    </div>
                ) : data.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-3xl p-12 text-center shadow-sm">
                        <Info size={32} className="mx-auto text-slate-400 mb-3" />
                        <p className="text-slate-600 dark:text-slate-300 font-semibold">{t('sales.history_page.no_data')}</p>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap gap-4 sm:gap-8 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 justify-end items-center mb-4 px-2">
                            <div className="flex items-center gap-2">
                                <span className="w-4 h-4 bg-emerald-100 dark:bg-emerald-900/40 border-2 border-emerald-500 rounded-full shadow-sm"></span>
                                <span>{t('sales.history_page.best_month')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-4 h-4 bg-rose-100 dark:bg-rose-900/40 border-2 border-rose-500 rounded-full shadow-sm"></span>
                                <span>{t('sales.history_page.worst_month')}</span>
                            </div>
                            {year === currentBusinessYear && (
                                <div className="flex items-center gap-2">
                                    <span className="w-4 h-4 bg-sky-50 dark:bg-sky-900/30 border-2 border-sky-400 rounded-full shadow-sm"></span>
                                    <span>{t('sales.history_page.in_progress_month')}</span>
                                </div>
                            )}
                        </div>

                        {/* DESKTOP MATRIX */}
                        <div className="hidden md:block bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/5">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs md:text-sm">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase text-[10px] md:text-xs tracking-wider font-bold">
                                            <th className="px-3 py-3 text-left border-b dark:border-slate-800 sticky left-0 bg-slate-100 dark:bg-slate-950 z-20 w-48 md:w-56 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{t('sales.history_page.store')}</th>
                                            {months.map((m, mIdx) => (
                                                <th key={m} className="px-1 py-3 text-center border-b border-r border-slate-100 dark:border-slate-800 dark:border-r-slate-800/50 min-w-[80px] last:border-r-0">
                                                    <span>{m}</span>
                                                    {year === currentBusinessYear && mIdx === currentBusinessMonthIdx && (
                                                        <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-sky-500 align-middle" title={t('sales.history_page.in_progress_month')} />
                                                    )}
                                                </th>
                                            ))}
                                            <th className="px-3 py-3 text-right border-b dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 font-medium text-slate-900 dark:text-white min-w-[100px]">{t('sales.history_page.total')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {data.map((row) => (
                                            <tr key={row.store_id || row.name} className="group transition-all hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-default">
                                                <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-200 border-r dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 z-10 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm md:text-base truncate max-w-[250px] transition-colors" title={formatStoreName(row.name)}>
                                                    {formatStoreName(row.name)}
                                                </td>
                                                {row.months.map((val, mIdx) => (
                                                    <td key={mIdx} className="p-0.5 border-r border-slate-100 dark:border-slate-800/50 last:border-r-0">
                                                        <div
                                                            className={`w-full h-full flex items-center justify-center px-1.5 py-1.5 rounded-md transition-all text-[11px] md:text-[13px] ${getCellStyle(val, row.months, mIdx)} group-hover:scale-105 group-hover:shadow-sm`}
                                                            title={year === currentBusinessYear && mIdx === currentBusinessMonthIdx ? t('sales.history_page.in_progress_month') : undefined}
                                                        >
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

                        {/* MOBILE CARD VIEW FOR HISTORY MATRIX (Includes Global Totals Card) */}
                        <div className="md:hidden space-y-4">
                            <div className="bg-slate-900 dark:bg-slate-950 text-white rounded-2xl p-4 shadow-md border border-slate-800">
                                <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
                                    <h3 className="font-bold text-base uppercase tracking-wider text-slate-200">
                                        {t('sales.history_page.global')} ({year})
                                    </h3>
                                    <span className="bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-lg text-sm font-bold font-mono">
                                        {formatCurrency(grandTotal)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    {monthTotals.map((tot, mIdx) => (
                                        <div key={mIdx} className="rounded-lg p-1.5 flex flex-col bg-slate-800/70">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">{months[mIdx]}</span>
                                            <span className="text-xs font-semibold text-white font-mono">
                                                {tot === 0 ? '-' : (tot >= 1000 ? `${(tot / 1000).toFixed(1)}k` : formatSignedUSD(tot, { decimals: 0 }))}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {data.map((row) => (
                                <div key={row.store_id || row.name} className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                                    <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-2 gap-2">
                                        <h3 className="font-bold text-lg text-slate-800 dark:text-white truncate">
                                            {formatStoreName(row.name)}
                                        </h3>
                                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-lg text-xs font-bold shrink-0 font-mono">
                                            {formatCurrency(row.total)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        {row.months.map((val, mIdx) => (
                                            <div key={mIdx} className={`rounded-lg p-1.5 flex flex-col ${getCellStyle(val, row.months, mIdx)}`}>
                                                <span className="text-[10px] uppercase font-bold opacity-60">{months[mIdx]}</span>
                                                <span className="text-xs font-semibold font-mono">
                                                    {val === 0 ? '-' : (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : formatSignedUSD(val, { decimals: 0 }))}
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

                    <AnalysisSection
                        currentData={data}
                        year={year}
                        businessDateLA={businessDateLA}
                        currentBusinessYear={currentBusinessYear}
                    />
                </div>
            )}
        </div>
    )
}

interface AnalysisSectionProps {
    currentData: YearlyStoreRow[]
    year: number
    businessDateLA: string
    currentBusinessYear: number
}

function AnalysisSection({ currentData, year, businessDateLA, currentBusinessYear }: AnalysisSectionProps) {
    const { t, language } = useLanguage()
    const [currYtdData, setCurrYtdData] = useState<YearlyStoreRow[]>(currentData)
    const [prevData, setPrevData] = useState<YearlyStoreRow[]>([])
    const [loadingPrev, setLoadingPrev] = useState<boolean>(true)
    const [errorPrev, setErrorPrev] = useState<string | null>(null)

    const isCurrentYear = year === currentBusinessYear
    const lastClosedDate = useMemo(() => addDaysIso(businessDateLA, -1), [businessDateLA])
    const isJan1Building = isCurrentYear && parseInt(lastClosedDate.slice(0, 4), 10) < year

    useEffect(() => {
        if (isJan1Building) {
            setCurrYtdData([])
            setPrevData([])
            setErrorPrev(null)
            setLoadingPrev(false)
            return
        }

        const controller = new AbortController()
        const fetchComparisonYears = async () => {
            setLoadingPrev(true)
            setErrorPrev(null)
            try {
                const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
                const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {}

                let prevUrl = `/api/ventas/yearly?year=${year - 1}`
                let currPromise: Promise<YearlyStoreRow[]>

                if (isCurrentYear) {
                    const prevLimitStr = clampIsoToYear(lastClosedDate, year - 1)
                    prevUrl += `&limit_date=${prevLimitStr}`
                    const currUrl = `/api/ventas/yearly?year=${year}&limit_date=${lastClosedDate}`

                    currPromise = fetch(currUrl, { headers, signal: controller.signal }).then(async (res) => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`)
                        const json = await res.json()
                        return Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : [])
                    })
                } else {
                    currPromise = Promise.resolve(currentData)
                }

                const prevPromise = fetch(prevUrl, { headers, signal: controller.signal }).then(async (res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    const json = await res.json()
                    return Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : [])
                })

                const [resolvedCurr, resolvedPrev] = await Promise.all([currPromise, prevPromise])
                if (!controller.signal.aborted) {
                    setCurrYtdData(resolvedCurr)
                    setPrevData(resolvedPrev)
                }
            } catch (err: any) {
                if (err?.name !== 'AbortError') {
                    console.error('Error fetching comparison years:', err)
                    setErrorPrev(t('sales.history_page.error_loading'))
                    setPrevData([])
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingPrev(false)
                }
            }
        }
        fetchComparisonYears()
        return () => controller.abort()
    }, [year, isCurrentYear, isJan1Building, lastClosedDate, currentData, t])

    if (loadingPrev) {
        return <div className="text-slate-400 animate-pulse py-10">{t('sales.history_page.loading')}</div>
    }

    if (isJan1Building) {
        return (
            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-3xl p-8 flex items-center gap-4 text-sky-800 dark:text-sky-300">
                <Info size={24} className="shrink-0" />
                <p className="font-medium">{t('sales.history_page.ytd_building')}</p>
            </div>
        )
    }

    if (errorPrev) {
        return (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-sm font-medium">
                <AlertCircle size={18} className="shrink-0" />
                <span>{errorPrev}</span>
            </div>
        )
    }

    if (prevData.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 rounded-3xl p-8 flex items-center gap-4 text-slate-600 dark:text-slate-400">
                <Info size={24} className="shrink-0 text-slate-400" />
                <p className="font-medium">{t('sales.history_page.no_prev_year_data')}</p>
            </div>
        )
    }

    const [, mStr, dStr] = lastClosedDate.split('-')
    const monthNamesEs = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthIdx = Math.max(0, Math.min(11, parseInt(mStr, 10) - 1))
    const dayNum = parseInt(dStr, 10)
    const monthName = language === 'es' ? monthNamesEs[monthIdx] : monthNamesEn[monthIdx]
    const formattedCutoff = language === 'es' ? `${dayNum} ${monthName}` : `${monthName} ${dayNum}`

    const comparisonLabel = isCurrentYear
        ? `Vs. ${year - 1} (${t('sales.history_page.ytd_exact')} ${formattedCutoff})`
        : `${t('sales.history_page.vs_total')} ${year - 1}`

    // Match stores canonically by store_id (fallback to normalized name)
    const storeMap = new Map<string, { key: string; name: string; curr: number; prev: number }>()
    const getStoreKey = (row: YearlyStoreRow) =>
        row.store_id ? `id:${row.store_id}` : `name:${row.name.trim().toLowerCase()}`

    currYtdData.forEach((row) => {
        const key = getStoreKey(row)
        const existing = storeMap.get(key)
        const val = Number(row.total || 0)
        if (existing) {
            existing.curr += val
        } else {
            storeMap.set(key, { key, name: row.name, curr: val, prev: 0 })
        }
    })

    prevData.forEach((row) => {
        const key = getStoreKey(row)
        const existing = storeMap.get(key)
        const val = Number(row.total || 0)
        if (existing) {
            existing.prev += val
        } else {
            storeMap.set(key, { key, name: row.name, curr: 0, prev: val })
        }
    })

    const comparison = Array.from(storeMap.values()).map((entry) => {
        const diff = entry.curr - entry.prev
        const isNew = entry.prev <= 0 && entry.curr > 0
        const isClosed = entry.curr <= 0 && entry.prev > 0
        const percent = entry.prev > 0 ? (diff / entry.prev) * 100 : null

        return {
            key: entry.key,
            name: entry.name,
            curr: entry.curr,
            prev: entry.prev,
            diff,
            percent,
            isNew,
            isClosed
        }
    }).sort((a, b) => {
        // Comparable stores sorted by growth % desc, then new stores by sales desc, then closed stores
        const rank = (x: typeof a) => (!x.isNew && !x.isClosed ? 0 : x.isNew ? 1 : 2)
        if (rank(a) !== rank(b)) return rank(a) - rank(b)
        if (a.percent !== null && b.percent !== null) return b.percent - a.percent
        return b.curr - a.curr
    })

    const globalCurr = comparison.reduce((sum, item) => sum + item.curr, 0)
    const globalPrev = comparison.reduce((sum, item) => sum + item.prev, 0)
    const globalDiff = globalCurr - globalPrev
    const globalPercent = globalPrev > 0 ? (globalDiff / globalPrev) * 100 : 0

    const comparableStores = comparison.filter(s => !s.isNew && !s.isClosed && s.prev > 0 && s.percent !== null)
    const sameStoreCurr = comparableStores.reduce((sum, item) => sum + item.curr, 0)
    const sameStorePrev = comparableStores.reduce((sum, item) => sum + item.prev, 0)
    const sameStorePercent = sameStorePrev > 0 ? ((sameStoreCurr - sameStorePrev) / sameStorePrev) * 100 : null

    const bestStore = comparableStores.length > 0 ? comparableStores[0] : null
    const worstStore = comparableStores.length > 1 ? comparableStores[comparableStores.length - 1] : null
    const allPositive = Boolean(worstStore && worstStore.percent !== null && worstStore.percent >= 0)

    const formatWholeUSD = (val: number, showPlus = false) => formatSignedUSD(val, { decimals: 0, showPlus })
    const formatPercent = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(2)}%`

    return (
        <div className="space-y-8">
            {/* 1. TARJETAS DE KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Global Growth */}
                <div className={`p-6 rounded-3xl border ${globalDiff >= 0 ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-500/20' : 'bg-rose-50 border-rose-100 dark:bg-rose-900/10 dark:border-rose-500/20'}`}>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1">{t('sales.history_page.analysis.growth_card')}</h3>
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className={`text-3xl sm:text-4xl font-extrabold ${globalDiff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatPercent(globalPercent)}
                        </span>
                        <span className={`text-sm font-semibold font-mono ${globalDiff >= 0 ? 'text-emerald-700/80 dark:text-emerald-300/80' : 'text-rose-700/80 dark:text-rose-300/80'}`}>
                            {formatWholeUSD(globalDiff, true)}
                        </span>
                    </div>
                    {sameStorePercent !== null && comparableStores.length !== comparison.length && (
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1.5">
                            {t('sales.history_page.same_store_growth')}: <span className={sameStorePercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{formatPercent(sameStorePercent)}</span>
                        </p>
                    )}
                    <p className="text-xs sm:text-sm mt-2 opacity-70">{comparisonLabel}</p>
                </div>

                {/* MVP Store (Strictly Comparable Stores) */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <TrendingUp size={64} className="text-emerald-500" />
                    </div>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1 flex items-center gap-2">
                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded text-xs font-bold">{t('sales.history_page.analysis.mvp_card.badge')}</span>
                        {t('sales.history_page.analysis.mvp_card.label')}
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{bestStore ? formatStoreName(bestStore.name) : '-'}</span>
                        <span className={`font-bold ${bestStore && (bestStore.percent ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {bestStore && bestStore.percent !== null ? formatPercent(bestStore.percent) : 'N/A'}
                        </span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>

                {/* Alert Store (Adapts cleanly when all comparable stores are growing) */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-black/5 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AlertCircle size={64} className={allPositive ? 'text-amber-500' : 'text-rose-500'} />
                    </div>
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium mb-1 flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${allPositive
                            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300'
                            }`}>
                            {t('sales.history_page.analysis.alert_card.badge')}
                        </span>
                        {allPositive ? t('sales.history_page.all_positive_growth') : t('sales.history_page.analysis.alert_card.label')}
                    </h3>
                    <div className="mt-2">
                        <span className="text-xl font-bold text-slate-900 dark:text-white block">{worstStore ? formatStoreName(worstStore.name) : '-'}</span>
                        <span className={`font-bold ${allPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                            {worstStore && worstStore.percent !== null ? formatPercent(worstStore.percent) : 'N/A'}
                        </span>
                        <p className="text-xs text-slate-400 font-normal mt-1">{comparisonLabel}</p>
                    </div>
                </div>
            </div>

            {/* 2. TABLA COMPARATIVA DETALLADA */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-black/5 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-wrap justify-between items-center gap-2">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">{t('sales.history_page.analysis.table_title')}</h3>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{comparisonLabel}</span>
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
                            {comparison.map((item) => (
                                <tr key={item.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                                    <td className="px-6 py-3 font-semibold text-slate-800 dark:text-slate-200">
                                        {formatStoreName(item.name)}
                                        {item.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold">{t('sales.history_page.new_store')}</span>}
                                        {item.isClosed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-bold">{t('sales.history_page.closed_store')}</span>}
                                    </td>
                                    <td className="px-6 py-3 text-right text-slate-500 dark:text-slate-400 font-mono">{formatWholeUSD(item.prev)}</td>
                                    <td className="px-6 py-3 text-right font-bold text-slate-900 dark:text-white font-mono">{formatWholeUSD(item.curr)}</td>
                                    <td className={`px-6 py-3 text-right font-medium font-mono ${item.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {formatWholeUSD(item.diff, true)}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                        {item.isNew ? (
                                            <span className="px-2 py-1 rounded-lg font-bold text-xs bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                                                {t('sales.history_page.new_badge')}
                                            </span>
                                        ) : (
                                            <span className={`px-2 py-1 rounded-lg font-bold text-xs ${(item.percent ?? 0) >= 0
                                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                                : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                                }`}>
                                                {item.percent !== null ? formatPercent(item.percent) : 'N/A'}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* MOBILE LIST (Includes $ Diff parity) */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {comparison.map((item) => (
                        <div key={item.key} className="p-4 flex flex-col gap-2">
                            <div className="flex justify-between items-center gap-2">
                                <h4 className="font-bold text-slate-900 dark:text-white truncate">
                                    {formatStoreName(item.name)}
                                    {item.isNew && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold">{t('sales.history_page.new_store')}</span>}
                                    {item.isClosed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-bold">{t('sales.history_page.closed_store')}</span>}
                                </h4>
                                {item.isNew ? (
                                    <span className="px-2 py-1 rounded-lg font-bold text-xs bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 shrink-0">
                                        {t('sales.history_page.new_badge')}
                                    </span>
                                ) : (
                                    <span className={`px-2 py-1 rounded-lg font-bold text-xs shrink-0 ${(item.percent ?? 0) >= 0
                                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                        }`}>
                                        {item.percent !== null ? formatPercent(item.percent) : 'N/A'}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="text-slate-500">
                                    <span className="text-[10px] uppercase tracking-wider block opacity-70">{year - 1}</span>
                                    <span className="font-mono">{formatWholeUSD(item.prev)}</span>
                                </div>
                                <div className="text-center">
                                    <span className="text-[10px] uppercase tracking-wider block opacity-70 text-slate-500">{year}</span>
                                    <span className="font-bold text-slate-800 dark:text-white font-mono">{formatWholeUSD(item.curr)}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] uppercase tracking-wider block opacity-70 text-slate-500">{t('sales.history_page.analysis.columns.diff')}</span>
                                    <span className={`font-bold font-mono ${item.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {formatWholeUSD(item.diff, true)}
                                    </span>
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
