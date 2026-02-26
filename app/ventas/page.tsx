'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Calendar, ChevronDown, ChevronUp, DollarSign, Store, Users, Clock, RefreshCw, Filter, TrendingUp, TrendingDown, Eye, Download, WifiOff, ClipboardList, ShieldCheck, CheckCircle, ArrowUpDown } from 'lucide-react'
import SalesSummary from '@/components/sales/SalesSummary'
import SurpriseLoader from '@/components/SurpriseLoader'
import SalesCharts from '@/components/sales/SalesCharts'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

function SalesPageContent() {
    const [loading, setLoading] = useState(false)
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'>('today')
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
    const [verifying, setVerifying] = useState(false)
    const [integrityStatus, setIntegrityStatus] = useState<'idle' | 'verifying' | 'fixed' | 'ok'>('idle')
    const [selectedStore, setSelectedStore] = useState<string>('all') // Store filter for KPIs and Trend
    const [storeList, setStoreList] = useState<string[]>([]) // Available stores
    const { user } = useAuth()
    const { t } = useLanguage()
    const isAdmin = user?.role === 'admin'

    const handleStoreClick = (storeId: string) => {
        if (!storeId) return
        const url = `/planificador?store=${storeId}&date=${startDate}`
        window.open(url, '_blank')
    }

    // Sort Config
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'amount', direction: 'desc' })

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc'
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc'
        }
        setSortConfig({ key, direction })
    }

    const sortedStoreData = useMemo(() => {
        if (!data?.storeData) return []
        let sortableItems = [...data.storeData]
        if (sortConfig !== null) {
            sortableItems.sort((a: any, b: any) => {
                let aValue: any = a[sortConfig.key]
                let bValue: any = b[sortConfig.key]

                // Handle derived columns
                if (sortConfig.key === 'diff') {
                    aValue = a.amount - (a.projectedToDate || 0)
                    bValue = b.amount - (b.projectedToDate || 0)
                } else if (sortConfig.key === 'avgTicket') {
                    aValue = a.amount / (a.orderCount || 1)
                    bValue = b.amount / (b.orderCount || 1)
                } else if (sortConfig.key === 'name') {
                    aValue = (a.name || a.storeName || '').toLowerCase()
                    bValue = (b.name || b.storeName || '').toLowerCase()
                } else if (sortConfig.key === 'laborPercentage') {
                    aValue = Number(a.laborPercentage)
                    bValue = Number(b.laborPercentage)
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1
                }
                return 0
            })
        }
        return sortableItems
    }, [data, sortConfig])

    // Helper to process raw rows into UI Data Structure
    const processData = (rows: any[], groupByMode: string, referenceDate: string) => {
        // Calculate Summary Totals
        const summary = rows.reduce((acc: any, row: any) => ({
            netSales: acc.netSales + (row.netSales || 0),
            grossSales: acc.grossSales + (row.grossSales || 0),
            discounts: acc.discounts + (row.discounts || 0),
            tips: acc.tips + (row.tips || 0),
            taxes: acc.taxes + (row.taxes || 0),
            orderCount: acc.orderCount + (row.orderCount || 0),
            guestCount: acc.guestCount + (row.guestCount || 0),
            totalHours: acc.totalHours + (row.totalHours || 0),
            laborCost: acc.laborCost + (row.laborCost || 0)
        }), { netSales: 0, grossSales: 0, discounts: 0, tips: 0, taxes: 0, orderCount: 0, guestCount: 0, totalHours: 0, laborCost: 0 })

        summary.laborPercentage = summary.netSales > 0 ? (summary.laborCost / summary.netSales) * 100 : 0

        const now = new Date();
        const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:00`;
        const nowDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const currentMinuteRatio = now.getMinutes() / 60;

        // Store Data
        const storeMap = new Map()
        rows.forEach((row: any) => {
            const storeName = row.storeName || t('sales.unknown_store')
            if (!storeMap.has(storeName)) {
                storeMap.set(storeName, {
                    name: storeName,
                    storeName: storeName,
                    storeId: row.storeId, // Toast GUID
                    amount: 0,
                    netSales: 0,
                    orderCount: 0,
                    guestCount: 0,
                    laborCost: 0,
                    laborPercentage: 0,
                    totalHours: 0,
                    projectedSales: 0,
                    projectedToDate: 0
                })
            }

            let rowProjToDate = 0;
            if (groupByMode === 'hour' && row.projectedHourly) {
                const baseDateStr = referenceDate;
                const nextDate = new Date(baseDateStr + 'T00:00:00');
                nextDate.setDate(nextDate.getDate() + 1);
                const nextDateStr = nextDate.toISOString().split('T')[0];

                Object.entries(row.projectedHourly).forEach(([h, amount]) => {
                    let hourInt = parseInt(h);
                    let isNext = hourInt < 6;
                    if (hourInt >= 24) {
                        hourInt -= 24;
                        isNext = true;
                    }
                    const dStr = isNext ? nextDateStr : baseDateStr;
                    const timeStr = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`;

                    if (timeStr < nowStr) {
                        rowProjToDate += Number(amount) || 0;
                    } else if (timeStr === nowStr) {
                        rowProjToDate += (Number(amount) || 0) * currentMinuteRatio;
                    }
                });
            } else {
                if (row.periodStart && row.periodStart < nowDateStr) {
                    rowProjToDate = row.projectedSales || 0;
                } else if (!row.periodStart || row.periodStart === nowDateStr) {
                    rowProjToDate = row.projectedSales || 0;
                }
            }

            const s = storeMap.get(storeName)
            s.amount += (row.netSales || 0)
            s.netSales += (row.netSales || 0)
            s.orderCount += (row.orderCount || 0)
            s.guestCount += (row.guestCount || 0)
            s.laborCost += (row.laborCost || 0)
            s.totalHours += (row.totalHours || 0)
            s.projectedSales += (row.projectedSales || 0)
            s.projectedToDate += rowProjToDate
        })

        const storeData = Array.from(storeMap.values())
            .map((s: any) => ({
                ...s,
                laborPercentage: s.netSales > 0 ? (s.laborCost / s.netSales) * 100 : 0
            }))
            .sort((a: any, b: any) => b.amount - a.amount)

        // Trend Data
        const trendMap = new Map<string, { amount: number, labor: number }>()
        const projMap = new Map<string, number>()

        if (groupByMode === 'hour') {
            // 1. Initialize hours using the reference date
            // Use the passed referenceDate instead of potentially stale startDate state
            const baseDateStr = referenceDate
            const nextDate = new Date(baseDateStr + 'T00:00:00')
            nextDate.setDate(nextDate.getDate() + 1)
            const nextDateStr = nextDate.toISOString().split('T')[0]

            // Horas de interés: 7, 8... 23, 0, 1... 5
            const hoursOfInterest = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

            hoursOfInterest.forEach(h => {
                const isNextDay = h < 6
                const dateP = isNextDay ? nextDateStr : baseDateStr
                const timeKey = `${dateP} ${h.toString().padStart(2, '0')}:00`
                trendMap.set(timeKey, { amount: 0, labor: 0 })
                projMap.set(timeKey, 0) // Initialize projections too
            })

            // Collect hourly projections from historical data (same day of week)
            // Using rows that have projectedHourly data
            const hourlyProjCounts: Record<string, { sum: number, count: number }> = {}

            rows.forEach((row: any) => {
                if (row.hourlySales) {
                    Object.entries(row.hourlySales).forEach(([h, amount]) => {
                        const hourInt = parseInt(h)
                        const isNext = hourInt < 6
                        const dStr = isNext ? nextDateStr : baseDateStr
                        const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                        const bucket = trendMap.get(key)
                        if (bucket) {
                            bucket.amount += (Number(amount) || 0)
                        }
                    })
                }

                // Aggregate Hourly Labor
                if (row.hourlyLabor) {
                    Object.entries(row.hourlyLabor).forEach(([h, cost]) => {
                        const hourInt = parseInt(h)
                        const isNext = hourInt < 6
                        const dStr = isNext ? nextDateStr : baseDateStr
                        const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                        const bucket = trendMap.get(key)
                        if (bucket) {
                            bucket.labor += (Number(cost) || 0)
                        }
                    })
                }

                // Use projected hourly if available from API response
                if (row.projectedHourly) {
                    Object.entries(row.projectedHourly).forEach(([h, amount]) => {
                        let hourInt = parseInt(h)
                        let isNext = hourInt < 6

                        // Handle extended hours (24, 25, 26, etc)
                        if (hourInt >= 24) {
                            hourInt -= 24
                            isNext = true
                        }

                        const dStr = isNext ? nextDateStr : baseDateStr
                        const key = `${dStr} ${hourInt.toString().padStart(2, '0')}:00`
                        if (!hourlyProjCounts[key]) hourlyProjCounts[key] = { sum: 0, count: 0 }
                        hourlyProjCounts[key].sum += Number(amount) || 0
                        hourlyProjCounts[key].count += 1
                    })
                }
            })

            // SUM all store projections per hour (not average!)
            Object.entries(hourlyProjCounts).forEach(([key, data]) => {
                if (data.sum > 0) {
                    projMap.set(key, data.sum) // Use sum, not average - we want total across all stores
                }
            })
        } else {
            rows.forEach((row: any) => {
                const key = row.periodStart
                if (!trendMap.has(key)) trendMap.set(key, { amount: 0, labor: 0 })
                const bucket = trendMap.get(key)!
                bucket.amount += (row.netSales || 0)
                bucket.labor += (row.laborCost || 0)

                // Aggregate projections by day if available
                if (row.projectedSales) {
                    const currentProj = projMap.get(key) || 0
                    projMap.set(key, currentProj + Number(row.projectedSales))
                }
            })
        }

        const trendData = Array.from(trendMap.entries())
            .map(([time, val]) => ({
                time,
                amount: val.amount,
                laborCost: val.labor,
                laborPercentage: val.amount > 0 ? (val.labor / val.amount) * 100 : null, // Null if 0 to avoid drawing line at 0
                projected: projMap.get(time) || 0 // Add projected field
            }))
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

        return { summary, trendData, storeData, rows }
    }

    const refreshData = async () => {
        setLoading(true)
        setLoadingMessage(t('sales.loading_connecting'))
        try {
            const now = new Date()
            if (now.getHours() < 6) now.setDate(now.getDate() - 1)
            const today = now

            let start = new Date(today)
            let end = new Date(today)
            let groupBy = 'day'

            if (period === 'custom' || period === 'last_week' || period === 'last_7' || period === 'last_month') {
                // For these presets, we TRUST the startDate/endDate passed from the filter component
                const s = new Date(startDate + 'T00:00:00')
                const e = new Date(endDate + 'T00:00:00')
                start = s
                end = e
                const diff = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)
                // Single day = hourly view, multi-day = daily or weekly
                if (diff === 0) {
                    groupBy = 'hour'
                } else if (diff > 31) {
                    groupBy = 'week'
                } else {
                    groupBy = 'day'
                }
            } else if (period === 'today') {
                start = today
                end = today
                groupBy = 'hour'
            } else if (period === 'yesterday') {
                const y = new Date(today)
                y.setDate(y.getDate() - 1)
                start = y
                end = y
                groupBy = 'hour'
            } else if (period === 'week') {
                const day = today.getDay()
                const diff = today.getDate() - day + (day === 0 ? -6 : 1)
                start = new Date(today.setDate(diff))
                end = new Date()
                groupBy = 'day'
            } else if (period === 'month') {
                start = new Date(today.getFullYear(), today.getMonth(), 1)
                groupBy = 'day'
            } else if (period === 'quarter') {
                // Últimos 90 días, agrupado por SEMANA
                const quarterAgo = new Date(today)
                quarterAgo.setDate(quarterAgo.getDate() - 90)
                start = quarterAgo
                groupBy = 'week'
            }

            const formatDate = (d: Date) => {
                const year = d.getFullYear()
                const month = String(d.getMonth() + 1).padStart(2, '0')
                const day = String(d.getDate()).padStart(2, '0')
                return `${year}-${month}-${day}`
            }

            // Adjust for ISO string part
            setStartDate(formatDate(start))
            setEndDate(formatDate(end))

            const query = new URLSearchParams({
                storeIds: 'all',
                startDate: formatDate(start),
                endDate: formatDate(end),
                groupBy: groupBy
            })

            setLoadingMessage(t('sales.loading_fetching'))
            // Get Token
            const token = localStorage.getItem('teg_token')

            const res = await fetch(`/api/ventas?${query}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (res.status === 401 || res.status === 403) {
                setLoadingMessage(t('sales.access_denied'))
                setLoading(false)
                return
            }

            setLoadingMessage(t('sales.loading_processing'))
            const json = await res.json()

            if (json.meta?.connectionError) {
                setConnError(json.meta.connectionError)
            } else {
                setConnError(null)
            }

            if (json.data) {
                const processed = processData(json.data, groupBy, formatDate(start))
                setData({ ...processed, rawRows: json.data, groupByMode: groupBy })
                // Extract unique store names for filter dropdown
                const uniqueStores = [...new Set(json.data.map((r: any) => r.storeName || t('sales.unknown_store')))] as string[]
                setStoreList(uniqueStores.sort())
            } else {
                setData(null)
                setStoreList([])
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
            setIntegrityStatus('idle') // Reset status on new fetch
        }
    }, [period]) // Removed startDate/endDate from dep array to avoid double fetch on custom change

    // INTEGRITY CHECK HOOK
    useEffect(() => {
        if (!data || loading || verifying) return

        // Only run for Recent History (Yesterday) - User requested to SKIP Today to keep it volatile
        if (period === 'yesterday') {
            // Only run if we haven't verified yet this session
            if (integrityStatus === 'idle') {
                const runVerify = async () => {
                    setVerifying(true)
                    setIntegrityStatus('verifying')
                    try {
                        // Use startDate because in 'yesterday' mode, startDate is set correctly to Y-M-D
                        const res = await fetch('/api/integrity/verify-day', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ date: startDate, storeIds: 'all' })
                        })
                        const json = await res.json()

                        if (json.status === 'corrected' && json.freshData) {
                            console.log("🛠️ [AUTO-HEAL] Discrepancias corregidas. Actualizando UI silenciosamente...")
                            setIntegrityStatus('fixed')
                            // SILENT UPDATE: Update data directly without full reload/spinner
                            // FIX: Process data to generate storeData/trendData needed by UI
                            const freshProcessed = processData(json.freshData.data, 'hour', startDate) // integrity check forces hour/day view
                            setData(freshProcessed)
                            setLastUpdated(new Date())
                        } else {
                            setIntegrityStatus('ok')
                        }
                    } catch (e) {
                        console.warn("Integrity check skipped", e)
                        setIntegrityStatus('idle')
                    } finally {
                        setVerifying(false)
                    }
                }

                // Small delay to allow render
                const timer = setTimeout(runVerify, 2000)
                return () => clearTimeout(timer)
            }
        }
    }, [data, loading, period, startDate])

    // 🔍 FILTERED DATA: Compute filtered summary and trend for selected store
    // This useMemo MUST be before any early returns to maintain hooks order
    const defaultSummary = {
        netSales: 0,
        grossSales: 0,
        discounts: 0,
        tips: 0,
        taxes: 0,
        orderCount: 0,
        guestCount: 0,
        totalHours: 0,
        laborCost: 0,
        laborPercentage: 0
    }

    const { filteredSummary, filteredTrendData, storeRanking } = useMemo(() => {
        if (!data || !data.rawRows) {
            return { filteredSummary: defaultSummary, filteredTrendData: [], storeRanking: [] }
        }

        // Filter rows by selected store - if 'all', use all rows
        const filteredRows = selectedStore === 'all'
            ? data.rawRows
            : data.rawRows.filter((r: any) => (r.storeName || t('sales.unknown_store')) === selectedStore)

        // ALWAYS Reprocess data to ensure correct Date Reference in trendMap
        // (Even if 'all', we must regenerate trendData if startDate changed but data didn't re-fetch yet, though typically they update together)
        const reprocessed = processData(filteredRows, data.groupByMode, startDate)

        return {
            filteredSummary: reprocessed.summary,
            filteredTrendData: reprocessed.trendData,
            storeRanking: data.storeData || [] // Always full data for Top 5 and Detail
        }
    }, [data, selectedStore, startDate]) // Include startDate in dependency array

    // Early return for loading state
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

    // Use filtered data for KPIs
    const summary = filteredSummary

    // We don't really use these consts anymore in the JSX since we pass 'summary' object directly
    // but leaving them for clarity if logic needs them later
    const totalSales = summary.netSales || 0
    const totalGuests = summary.guestCount || 0
    const totalLabor = summary.laborCost || 0
    const laborPercent = summary.laborPercentage || 0

    // Chart Data: Filtered for Trend, Full for Store charts
    const timelineData = filteredTrendData || []

    const getDateLabel = () => {
        if (!startDate || !endDate) return ''

        const parseDate = (str: string) => {
            const [y, m, d] = str.split('-').map(Number)
            return new Date(y, m - 1, d)
        }

        const start = parseDate(startDate)
        const end = parseDate(endDate)

        const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' } // e.g. 19 Ene
        const startStr = start.toLocaleDateString('es-ES', options)
        const endStr = end.toLocaleDateString('es-ES', options)

        if (period === 'today') return `${t('sales.today')}, ${startStr}`
        if (period === 'yesterday') return `${t('sales.yesterday')}, ${startStr}`
        if (period === 'week') return `${t('sales.this_week')} (${startStr} - ${endStr})`
        if (period === 'month') return `${t('sales.current_month')} (${startStr} - ${endStr})`
        if (period === 'quarter') return `${t('sales.quarter')} (${startStr} - ${endStr})`
        if (startDate === endDate) return startStr

        return `${startStr} - ${endStr}`
    }

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
                                <p className="font-bold text-sm">{t('sales.connection_interrupted')}</p>
                                <p className="text-xs opacity-90">{t('sales.cache_warning')} {connError}</p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-sm">
                                    {t('sales.live_connected')}
                                </span>
                                <span className="text-xs text-slate-600 dark:text-slate-500 flex items-center gap-1 font-medium italic opacity-80">
                                    <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                                    {verifying ? (
                                        <span className="text-indigo-600 dark:text-indigo-400 animate-pulse flex items-center gap-1">
                                            <ShieldCheck size={10} /> {t('sales.validating')}
                                        </span>
                                    ) : integrityStatus === 'fixed' ? (
                                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                            <CheckCircle size={10} /> {t('sales.corrected')}
                                        </span>
                                    ) : (
                                        <span>{t('sales.updated')}: {lastUpdated.toLocaleTimeString()}</span>
                                    )}
                                </span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                {t('sales.title')}
                            </h1>
                            <p className="text-slate-500 dark:text-slate-400 mt-1">
                                {t('sales.subtitle')}
                            </p>
                        </div>

                        {/* Dynamic Date Label & Filter */}
                        <div className="flex flex-col sm:flex-row items-center gap-2 bg-white/70 dark:bg-slate-900/80 p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5 w-full md:w-auto z-50">

                            <DateRangeFilter
                                period={period}
                                startDate={startDate}
                                endDate={endDate}
                                onChange={(p, s, e) => {
                                    setPeriod(p as any)
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

                            <div className="flex items-center gap-2">
                                {isAdmin && (
                                    <button
                                        onClick={() => window.location.href = '/ventas/historial'}
                                        className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 transition-colors border border-black/5 dark:border-slate-700 shrink-0"
                                        title={t('sales.history')}
                                    >
                                        <Clock size={18} />
                                        <span className="hidden sm:inline text-xs font-medium">{t('sales.history')}</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => window.location.href = '/ventas/reportes'}
                                    className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 transition-colors border border-black/5 dark:border-slate-700 shrink-0"
                                    title={t('sales.reports')}
                                >
                                    <ClipboardList size={18} />
                                    <span className="hidden sm:inline text-xs font-medium">{t('sales.reports')}</span>
                                </button>

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
                        <SalesSummary data={summary} />
                        <SalesCharts trendData={timelineData} period={period} />

                        {/* Table */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5">
                            <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 flex justify-between items-center">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
                                    <Store size={18} className="text-emerald-500" />
                                    {t('sales.detail_by_store')}
                                </h3>
                                <button className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80 flex items-center gap-1 uppercase tracking-wider">
                                    <Download size={14} /> {t('sales.export_csv')}
                                </button>
                            </div>

                        </div>

                        {/* Mobile Card View (Visible ONLY on small screens) */}
                        <div className="md:hidden flex flex-col gap-3 p-4 bg-slate-50/50 dark:bg-slate-900/20">
                            {data.storeData.map((store: any, idx: number) => {
                                const orders = store.orderCount || 1
                                const laborPct = store.laborPercentage.toFixed(2)
                                const avgTicket = store.amount / orders

                                return (
                                    <div
                                        key={idx}
                                        onClick={() => handleStoreClick(store.storeId)}
                                        className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col gap-3 cursor-pointer hover:ring-2 hover:ring-emerald-500/30 transition-all active:scale-[0.98]"
                                    >
                                        <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-700 pb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-slate-400 font-mono text-xs font-bold">#{idx + 1}</span>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-lg">
                                                    {formatStoreName(store.name || store.storeName)}
                                                </h4>
                                            </div>
                                            <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${Number(laborPct) < 21.5
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                                : Number(laborPct) > 23
                                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                                                }`}>
                                                {t('sales.labor_label')}: {laborPct}%
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{t('sales.sales_label')}</span>
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                                                    ${store.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                                </span>
                                            </div>
                                            <div className="flex flex-col text-center border-l border-slate-100 dark:border-slate-700 pl-2">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{t('sales.orders_label')}</span>
                                                <span className="text-slate-700 dark:text-slate-300 font-semibold">
                                                    {orders.toLocaleString('en-US')}
                                                </span>
                                            </div>
                                            <div className="flex flex-col text-right border-l border-slate-100 dark:border-slate-700 pl-2">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{t('sales.ticket_label')}</span>
                                                <span className="text-slate-500 dark:text-slate-400 font-medium">
                                                    ${avgTicket.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Desktop Table View (Hidden on mobile) */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-base text-left">
                                <thead className="bg-slate-100 dark:bg-slate-950/50 text-slate-700 dark:text-slate-400 text-xs uppercase font-semibold tracking-widest border-b border-black/5 dark:border-slate-800">
                                    <tr>
                                        <th className="px-6 py-4 w-12 text-center">#</th>
                                        <th className="px-6 py-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('name')}>
                                            <div className="flex items-center gap-1">
                                                {t('sales.store')}
                                                {sortConfig?.key === 'name' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedToDate')}>
                                            <div className="flex items-center justify-end gap-1 text-cyan-500">
                                                {t('sales.charts.projectedToDate') ? t('sales.charts.projectedToDate').toUpperCase() : 'PROJ. TO DATE'}
                                                {sortConfig?.key === 'projectedToDate' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('amount')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.net_sales')}
                                                {sortConfig?.key === 'amount' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedSales')}>
                                            <div className="flex items-center justify-end gap-1 text-indigo-500">
                                                {t('sales.projected').toUpperCase()}
                                                {sortConfig?.key === 'projectedSales' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('diff')}>
                                            <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                {t('sales.difference').toUpperCase()}
                                                {sortConfig?.key === 'diff' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('orderCount')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.orders')}
                                                {sortConfig?.key === 'orderCount' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('avgTicket')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.avg_ticket')}
                                                {sortConfig?.key === 'avgTicket' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('laborPercentage')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.labor_pct')}
                                                {sortConfig?.key === 'laborPercentage' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5 dark:divide-slate-800">
                                    {sortedStoreData.map((store: any, idx: number) => {
                                        const orders = store.orderCount || 1
                                        const laborPct = store.laborPercentage.toFixed(2)

                                        return (
                                            <tr
                                                key={idx}
                                                onClick={() => handleStoreClick(store.storeId)}
                                                className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors group cursor-pointer"
                                            >
                                                <td className="px-6 py-4 text-center text-slate-400 font-mono text-sm">
                                                    {idx + 1}
                                                </td>
                                                <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white text-lg">
                                                    {formatStoreName(store.name || store.storeName)}
                                                </td>
                                                <td className="px-6 py-4 text-right text-cyan-600 dark:text-cyan-400 font-mono font-bold text-lg">
                                                    ${(store.projectedToDate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-lg">
                                                    ${store.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-4 text-right text-indigo-500 dark:text-indigo-400 font-mono font-bold text-lg">
                                                    ${(store.projectedSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className={`px-6 py-4 text-right font-mono font-bold text-lg ${store.amount - (store.projectedToDate || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {store.amount - (store.projectedToDate || 0) >= 0 ? '+' : ''}
                                                    ${(store.amount - (store.projectedToDate || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                )}
            </div>
        </div>
    )
}

export default function SalesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin', 'supervisor']}>
            <SalesPageContent />
        </ProtectedRoute>
    )
}
