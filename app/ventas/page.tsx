'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calendar, CalendarDays, ChevronDown, ChevronUp, DollarSign, Store, Users, Clock, RefreshCw, Filter, TrendingUp, TrendingDown, Eye, Download, WifiOff, ClipboardList, ShieldCheck, CheckCircle, ArrowUpDown, ChevronLeft, ChevronRight, Info, X, Zap } from 'lucide-react'
import SalesSummary from '@/components/sales/SalesSummary'
import SurpriseLoader from '@/components/SurpriseLoader'
import SalesCharts from '@/components/sales/SalesCharts'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'

// Helper to filter a single row by a time range
// Returns null for hourly rows outside the range (to be filtered out)
const applyTimeFilterToRow = (row: any, timeFilter: string): any | null => {
    if (timeFilter === 'all') return row

    const [startH, endH] = timeFilter.split('-').map(Number)
    let hours: number[] = []

    if (startH > endH) {
        // Wrapping range (e.g. 23-4 = 23,0,1,2,3)
        for (let i = startH; i < 24; i++) hours.push(i)
        for (let i = 0; i < endH; i++) hours.push(i)
    } else {
        for (let i = startH; i < endH; i++) hours.push(i)
    }

    // CASE 1: Hourly row (single-day view) — periodStart contains time like "2026-05-15 11:00"
    const periodStart = row.periodStart || ''
    if (periodStart.includes(':')) {
        const hourStr = periodStart.split(' ')[1]?.split(':')[0]
        const rowHour = parseInt(hourStr || '0')
        // Exclude this row entirely if outside the time range
        return hours.includes(rowHour) ? row : null
    }

    // CASE 2: Daily row (multi-day view) — extract hourly subtotals from JSONB
    let netSales = 0
    let laborCost = 0
    let orderCount = 0

    hours.forEach(h => {
        netSales += (row.hourlySales?.[h] || 0)
        laborCost += (row.hourlyLabor?.[h] || 0)
        orderCount += (row.hourlyTickets?.[h] || 0)
    })

    // Proportional estimate for fields without hourly breakdown
    const totalNetSales = row.netSales || 0
    const proportion = totalNetSales > 0 ? netSales / totalNetSales : 0

    return {
        ...row,
        netSales,
        laborCost,
        orderCount,
        grossSales: (row.grossSales || 0) * proportion,
        discounts: (row.discounts || 0) * proportion,
        tips: (row.tips || 0) * proportion,
        taxes: (row.taxes || 0) * proportion,
        guestCount: Math.round((row.guestCount || 0) * proportion),
        totalHours: (row.totalHours || 0) * proportion
    }
}

function SalesPageContent() {
    const urlParams = useSearchParams()
    const [loading, setLoading] = useState(false)
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'>(() => {
        const p = urlParams.get('period')
        if (p && ['today','yesterday','week','month','quarter','custom','last_week','last_7','last_month'].includes(p)) return p as any
        // If startDate/endDate are passed, treat as custom
        if (urlParams.get('startDate') && urlParams.get('endDate')) return 'custom'
        return 'today'
    })
    const getLocalDateString = () => {
        const d = new Date()
        if (d.getHours() < 6) d.setDate(d.getDate() - 1)
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const [startDate, setStartDate] = useState(() => urlParams.get('startDate') || getLocalDateString())
    const [endDate, setEndDate] = useState(() => urlParams.get('endDate') || getLocalDateString())
    const [isLiveSyncing, setIsLiveSyncing] = useState(false)
    const [data, setData] = useState<any>(null)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
    const [loadingMessage, setLoadingMessage] = useState('')
    const [connError, setConnError] = useState<string | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [integrityStatus, setIntegrityStatus] = useState<'idle' | 'verifying' | 'fixed' | 'ok'>('idle')
    const [selectedStore, setSelectedStore] = useState<string>('all') // Store filter for KPIs and Trend
    const [storeList, setStoreList] = useState<string[]>([]) // Available stores
    const [dayOfWeekFilter, setDayOfWeekFilter] = useState<number | null>(null) // null = all days, 0=Sun, 1=Mon...6=Sat
    const [timeFilter, setTimeFilter] = useState<string>('all') // 'all', '6-11', '11-16', '16-23', '23-4', 'custom'
    const [customHourStart, setCustomHourStart] = useState(6)
    const [customHourEnd, setCustomHourEnd] = useState(14)
    const [showWelcomeModal, setShowWelcomeModal] = useState(false)
    const { user } = useAuth()
    const { t, language } = useLanguage()
    const isAdmin = user?.role === 'admin'

    // Food Cost Integration State
    const [foodCostData, setFoodCostData] = useState<{ totalCost: number, totalSales: number, costPercentage: number, byStore?: Record<string, { totalCost: number, netSales: number, costPercentage: number }>, byStoreName?: Record<string, { totalCost: number, netSales: number, costPercentage: number }> } | null>(null)
    const [foodCostLoading, setFoodCostLoading] = useState(false)

    // AbortController: cancels in-flight HTTP requests when user changes filter
    const abortControllerRef = useRef<AbortController | null>(null)




    const shiftDate = (days: number) => {
        const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
        const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
        
        const currentStart = new Date(sYear, sMonth - 1, sDay);
        const currentEnd = new Date(eYear, eMonth - 1, eDay);
        
        currentStart.setDate(currentStart.getDate() + days);
        currentEnd.setDate(currentEnd.getDate() + days);
        
        const formatD = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        
        setPeriod('custom');
        setStartDate(formatD(currentStart));
        setEndDate(formatD(currentEnd));
    }

    const todayStr = (() => {
        const d = new Date();
        if (d.getHours() < 6) d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const isTodayOrFuture = endDate >= todayStr;

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
        let sourceData = [...data.storeData]

        // Resolve 'custom' to actual hour range
        const resolvedTime = timeFilter === 'custom' ? `${customHourStart}-${customHourEnd}` : timeFilter

        // 📅 When day-of-week or time filter is active, re-aggregate store data from filtered raw rows
        if ((dayOfWeekFilter !== null || resolvedTime !== 'all') && data.rawRows) {
            let filteredRows = data.rawRows

            if (dayOfWeekFilter !== null) {
                filteredRows = filteredRows.filter((r: any) => {
                    if (!r.periodStart) return false
                    const dateStr = r.periodStart.split(' ')[0]
                    const d = new Date(dateStr + 'T12:00:00')
                    return d.getDay() === dayOfWeekFilter
                })
            }

            if (resolvedTime !== 'all') {
                filteredRows = filteredRows.map((r: any) => applyTimeFilterToRow(r, resolvedTime)).filter(Boolean)
            }
            // Re-aggregate by store from the filtered rows
            const storeMap = new Map<string, any>()
            filteredRows.forEach((row: any) => {
                const storeName = row.storeName || 'Unknown'
                if (!storeMap.has(storeName)) {
                    storeMap.set(storeName, {
                        name: storeName, storeName, storeId: row.storeId,
                        amount: 0, netSales: 0, orderCount: 0, guestCount: 0,
                        laborCost: 0, laborPercentage: 0, totalHours: 0,
                        projectedSales: 0, projectedToDate: 0
                    })
                }
                const s = storeMap.get(storeName)
                s.amount += (row.netSales || 0)
                s.netSales += (row.netSales || 0)
                s.orderCount += (row.orderCount || 0)
                s.guestCount += (row.guestCount || 0)
                s.laborCost += (row.laborCost || 0)
                s.totalHours += (row.totalHours || 0)
                s.projectedSales += (row.projectedSales || 0)
            })
            sourceData = Array.from(storeMap.values()).map((s: any) => ({
                ...s,
                laborPercentage: s.netSales > 0 ? (s.laborCost / s.netSales) * 100 : 0
            }))
        }

        let sortableItems = [...sourceData]
        if (sortConfig !== null) {
            sortableItems.sort((a: any, b: any) => {
                let aValue: any = a[sortConfig.key]
                let bValue: any = b[sortConfig.key]

                // Handle derived columns
                if (sortConfig.key === 'diff') {
                    const isCurrentPeriod = ['today', 'week', 'month'].includes(period)
                    aValue = a.amount - (isCurrentPeriod ? (a.projectedToDate || 0) : (a.projectedSales || 0))
                    bValue = b.amount - (isCurrentPeriod ? (b.projectedToDate || 0) : (b.projectedSales || 0))
                } else if (sortConfig.key === 'avgTicket') {
                    aValue = a.amount / (a.orderCount || 1)
                    bValue = b.amount / (b.orderCount || 1)
                } else if (sortConfig.key === 'name') {
                    aValue = (a.name || a.storeName || '').toLowerCase()
                    bValue = (b.name || b.storeName || '').toLowerCase()
                } else if (sortConfig.key === 'laborPercentage') {
                    aValue = Number(a.laborPercentage)
                    bValue = Number(b.laborPercentage)
                } else if (sortConfig.key === 'foodCostPct') {
                    aValue = foodCostData?.byStore?.[a.storeId]?.costPercentage || 0
                    bValue = foodCostData?.byStore?.[b.storeId]?.costPercentage || 0
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
    }, [data, sortConfig, dayOfWeekFilter, timeFilter, customHourStart, customHourEnd, foodCostData])

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
                    const currentBizHour = now.getHours() < 6 ? now.getHours() + 24 : now.getHours();
                    const elapsedHours = currentBizHour - 6;
                    const elapsedFraction = elapsedHours < 0 ? 0 : Math.min((elapsedHours + currentMinuteRatio) / 24, 1);
                    rowProjToDate = (row.projectedSales || 0) * elapsedFraction;
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

            // ⚠️ CRITICAL — DO NOT SIMPLIFY THIS SECTION ⚠️
            // In hourly mode, the API concentrates ALL laborCost on the FIRST row (i=0, hour 7AM) per store.
            // Using row.laborCost directly would create a massive spike at 7AM and zero everywhere else.
            // MUST use the hourlyLabor JSONB map to distribute labor correctly across hours.
            // See: .agent/workflows/regression-prevention.md (Labor Bug Mayo 2026)
            //
            // Pre-pass: Collect hourlyLabor maps from the concentrated rows (i=0 per store)
            const storeHourlyLaborMaps = new Map<string, Record<number, number>>()
            rows.forEach((row: any) => {
                if (row.hourlyLabor && Object.keys(row.hourlyLabor).length > 0 && !storeHourlyLaborMaps.has(row.storeId)) {
                    storeHourlyLaborMaps.set(row.storeId, row.hourlyLabor)
                }
            })

            rows.forEach((row: any) => {
                // For hourly rows, use periodStart to match the correct time bucket
                // Each row represents one hour for one store, with netSales = that hour's sales
                const rowPeriod = row.periodStart || ''
                if (rowPeriod && trendMap.has(rowPeriod)) {
                    const bucket = trendMap.get(rowPeriod)!
                    bucket.amount += (row.netSales || 0)

                    // 🛠️ FIX: Use hourlyLabor JSONB to distribute labor per hour
                    // instead of using row.laborCost which is concentrated in i=0 (7AM row)
                    const hourlyLaborMap = storeHourlyLaborMaps.get(row.storeId)
                    if (hourlyLaborMap) {
                        // Extract hour from periodStart (e.g., "2026-05-16 08:00" → 8)
                        const hourStr = rowPeriod.split(' ')[1]?.split(':')[0]
                        const hour = parseInt(hourStr || '0')
                        bucket.labor += (hourlyLaborMap[hour] || 0)
                    } else {
                        // Fallback: if no hourlyLabor map exists, use the concentrated laborCost
                        // (This happens when cache is missing hourly_labor)
                        bucket.labor += (row.laborCost || 0)
                    }
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

    const refreshData = async (forceLive = false, isBackground = false) => {
        // Use the current abort signal (set by useEffect)
        const signal = abortControllerRef.current?.signal

        if (!isBackground) {
            setLoading(true)
            setLoadingMessage(t('sales.loading_connecting'))
        } else {
            setIsLiveSyncing(true)
        }
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
                } else if (diff > 31 && dayOfWeekFilter === null && timeFilter === 'all') {
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
                // Últimos 90 días, agrupado por SEMANA (or day if day-of-week/time filter active)
                const quarterAgo = new Date(today)
                quarterAgo.setDate(quarterAgo.getDate() - 90)
                start = quarterAgo
                groupBy = (dayOfWeekFilter !== null || timeFilter !== 'all') ? 'day' : 'week'
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

            if (forceLive === true) {
                query.append('skipCache', 'true')
            }

            if (!isBackground) setLoadingMessage(t('sales.loading_fetching'))
            // Get Token
            const token = localStorage.getItem('teg_token')

            const res = await fetch(`/api/ventas?${query}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                signal // Attach abort signal — request is cancelled if user changes filter
            })

            if (res.status === 401 || res.status === 403) {
                if (!isBackground) setLoadingMessage(t('sales.access_denied'))
                setLoading(false)
                setIsLiveSyncing(false)
                return
            }

            if (!isBackground) setLoadingMessage(t('sales.loading_processing'))
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

        } catch (e: any) {
            // AbortError is expected when user changes filter — silently ignore
            if (e?.name === 'AbortError') return
            console.error('Error fetching sales data:', e)
        } finally {
            setLastUpdated(new Date())
            if (!isBackground) {
                setLoading(false)
                setLoadingMessage('')
            } else {
                setIsLiveSyncing(false)
            }
        }
    }

    // ═══ FOOD COST: CACHE-FIRST STRATEGY ═══
    // 1. Try reading pre-calculated data from Supabase cache (instant ~50ms)
    // 2. If cache miss + single day: fall back to full calculation (which also populates cache)
    // 3. If cache miss + multi-day: show nothing (user visits /admin/food-cost to populate)
    const fetchFoodCost = async (sDate: string, eDate: string, signal?: AbortSignal) => {
        setFoodCostLoading(true)
        try {
            // Step 1: Try Cache (instant ~50ms)
            const cacheRes = await fetch(`/api/inventory/food-cost-cache?startDate=${sDate}&endDate=${eDate}`, { signal })
            const cacheJson = await cacheRes.json()

            // Calculate how many days are in this range
            const rangeDays = Math.floor(
                (new Date(eDate + 'T00:00:00').getTime() - new Date(sDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
            ) + 1

            if (cacheJson.totalCost > 0) {
                if (signal?.aborted) return
                // Cache hit (full or partial) — use pre-calculated data immediately
                setFoodCostData({
                    totalCost: cacheJson.totalCost,
                    totalSales: cacheJson.totalSales,
                    costPercentage: cacheJson.costPercentage,
                    byStore: cacheJson.byStore || {},
                    byStoreName: cacheJson.byStoreName || {}
                })
                console.log(`[FoodCost] ⚡ Cache hit: ${cacheJson.daysWithData}/${cacheJson.totalDaysInRange} days`)

                // If cache is complete (all days covered), we're done
                if (cacheJson.daysWithData >= rangeDays) {
                    return
                }
                // Otherwise, fall through to fill remaining gaps (below)
            }

            // Step 2A: Single-day cache miss — direct full calculation (proven, fast path)
            // This handles "Today" and "Yesterday" reliably by reading the API response directly
            if (sDate === eDate) {
                console.log(`[FoodCost] 🔄 Cache miss for ${sDate}, falling back to full calculation...`)
                const fullRes = await fetch(`/api/inventory/food-cost?storeId=all&startDate=${sDate}&endDate=${eDate}`, { signal })
                const fullJson = await fullRes.json()
                
                if (signal?.aborted) return

                if (signal?.aborted) return

                if (fullJson.data && fullJson.data.length > 0) {
                    let totalCost = 0
                    let totalSales = 0
                    const storeMap: Record<string, { totalCost: number, netSales: number, costPercentage: number }> = {}
                    fullJson.data.forEach((item: any) => {
                        totalCost += item.total_cost || 0
                        totalSales += item.net_sales || 0
                        const sid = item.store_id || 'unknown'
                        if (!storeMap[sid]) storeMap[sid] = { totalCost: 0, netSales: 0, costPercentage: 0 }
                        storeMap[sid].totalCost += item.total_cost || 0
                        storeMap[sid].netSales += item.net_sales || 0
                    })
                    Object.values(storeMap).forEach(s => {
                        s.costPercentage = s.netSales > 0 ? (s.totalCost / s.netSales) * 100 : 0
                    })
                    const costPct = totalSales > 0 ? (totalCost / totalSales) * 100 : 0
                    setFoodCostData({ totalCost, totalSales, costPercentage: costPct, byStore: storeMap, byStoreName: storeMap })
                    console.log(`[FoodCost] ✅ Calculated & cached for ${sDate}`)
                    return
                }
                setFoodCostData(null)
                return
            }

            // Step 2B: Multi-day cache miss — fill gaps day by day
            // Only for short ranges (≤14 days) to avoid overloading Toast API
            if (rangeDays <= 14) {
                // Build list of all dates in range
                const allDates: string[] = []
                const cursor = new Date(sDate + 'T12:00:00')
                const endCursor = new Date(eDate + 'T12:00:00')
                while (cursor <= endCursor) {
                    allDates.push(cursor.toISOString().split('T')[0])
                    cursor.setDate(cursor.getDate() + 1)
                }

                // For each date without cache, trigger full calculation (auto-caches via write-through)
                let filledAny = false
                for (const date of allDates) {
                    // Quick check: does this specific day have cache?
                    const dayCheck = await fetch(`/api/inventory/food-cost-cache?startDate=${date}&endDate=${date}`)
                    const dayJson = await dayCheck.json()
                    if (dayJson.totalCost > 0) {
                        continue // Already cached, skip
                    }

                    // Cache miss for this day — calculate (also writes to cache via write-through)
                    console.log(`[FoodCost] 🔄 Gap-fill: calculating ${date}...`)
                    try {
                        await fetch(`/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`, { signal })
                        filledAny = true
                    } catch (dayErr) {
                        console.warn(`[FoodCost] ⚠️ Failed to calculate ${date}:`, dayErr)
                    }
                }

                // Re-read cache with all gaps filled
                if (filledAny || cacheJson.totalCost === 0) {
                    const finalRes = await fetch(`/api/inventory/food-cost-cache?startDate=${sDate}&endDate=${eDate}`, { signal })
                    const finalJson = await finalRes.json()

                    if (signal?.aborted) return

                    if (finalJson.totalCost > 0) {
                        setFoodCostData({
                            totalCost: finalJson.totalCost,
                            totalSales: finalJson.totalSales,
                            costPercentage: finalJson.costPercentage,
                            byStore: finalJson.byStore || {},
                            byStoreName: finalJson.byStoreName || {}
                        })
                        console.log(`[FoodCost] ✅ Gap-fill complete: ${finalJson.daysWithData}/${finalJson.totalDaysInRange} days`)
                        return
                    }
                }
            }

            // Step 3: No data available (long ranges without cache, or calculation returned empty)
            if (cacheJson.totalCost === 0) {
                if (!signal?.aborted) setFoodCostData(null)
                console.log(`[FoodCost] ℹ️ No cached data for ${rangeDays}-day range.`)
            }
        } catch (e: any) {
            if (e.name === 'AbortError') return
            console.error('Error fetching food cost data:', e)
            setFoodCostData(null)
        } finally {
            if (!signal?.aborted) setFoodCostLoading(false)
        }
    }

    useEffect(() => {
        // Cancel any in-flight requests from the previous filter
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        // Create a new controller for this filter's requests
        abortControllerRef.current = new AbortController()

        const loadAndSync = async () => {
            // 1. Initial Load (Fast from Cache if available)
            await refreshData(false, false)
            
            // 2. Background Sync for "Today" (Stale-While-Revalidate pattern)
            if (period === 'today') {
                refreshData(true, true)
            }
        }
        loadAndSync()
        
        // 3. Parallel Food Cost Fetch (non-blocking)
        if (abortControllerRef.current) {
            fetchFoodCost(startDate, endDate, abortControllerRef.current.signal)
        }
        
        setIntegrityStatus('idle') // Reset status on new fetch

        // Cleanup: cancel requests if component unmounts
        return () => {
            abortControllerRef.current?.abort()
        }
    }, [period, startDate, endDate, dayOfWeekFilter !== null, timeFilter !== 'all']) // Only re-fetch on groupBy-affecting transitions; day/hour changes are client-side via useMemo

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
        let filteredRows = selectedStore === 'all'
            ? data.rawRows
            : data.rawRows.filter((r: any) => (r.storeName || t('sales.unknown_store')) === selectedStore)

        // 📅 DAY-OF-WEEK FILTER: Filter rows to only include a specific day of the week
        if (dayOfWeekFilter !== null) {
            filteredRows = filteredRows.filter((r: any) => {
                if (!r.periodStart) return false
                const dateStr = r.periodStart.split(' ')[0] // Safety: handle "2026-05-06" or "2026-05-06 00:00"
                const d = new Date(dateStr + 'T12:00:00') // Use noon to avoid timezone edge cases
                return d.getDay() === dayOfWeekFilter
            })
        }

        // 🕒 TIME FILTER: Filter hourly data within rows
        const resolvedTime = timeFilter === 'custom' ? `${customHourStart}-${customHourEnd}` : timeFilter
        if (resolvedTime !== 'all') {
            // For hourly rows (single-day view), redistribute concentrated values
            // before filtering. Orders, guests, labor, gross are ALL on the i=0 row (hour 7).
            // We need to spread them proportionally across all hours by netSales share.
            if (data.groupByMode === 'hour') {
                const storeGroups = new Map<string, any[]>()
                filteredRows.forEach((r: any) => {
                    if (!storeGroups.has(r.storeId)) storeGroups.set(r.storeId, [])
                    storeGroups.get(r.storeId)!.push(r)
                })

                const redistributed: any[] = []
                storeGroups.forEach((rows) => {
                    // Find the concentrated row (has orderCount > 0 or laborCost > 0)
                    const concRow = rows.find((r: any) => (r.orderCount || 0) > 0 || (r.laborCost || 0) > 0)
                    const totalSales = rows.reduce((sum: number, r: any) => sum + (r.netSales || 0), 0)

                    rows.forEach((r: any) => {
                        const proportion = totalSales > 0 ? (r.netSales || 0) / totalSales : 0
                        redistributed.push({
                            ...r,
                            orderCount: concRow ? Math.round((concRow.orderCount || 0) * proportion) : 0,
                            guestCount: concRow ? Math.round((concRow.guestCount || 0) * proportion) : 0,
                            laborCost: concRow ? (concRow.laborCost || 0) * proportion : 0,
                            totalHours: concRow ? (concRow.totalHours || 0) * proportion : 0,
                            grossSales: concRow ? (concRow.grossSales || 0) * proportion : 0,
                            discounts: concRow ? (concRow.discounts || 0) * proportion : 0,
                            tips: concRow ? (concRow.tips || 0) * proportion : 0,
                            taxes: concRow ? (concRow.taxes || 0) * proportion : 0,
                        })
                    })
                })
                filteredRows = redistributed
            }

            filteredRows = filteredRows.map((r: any) => applyTimeFilterToRow(r, resolvedTime)).filter(Boolean)
        }

        // ALWAYS Reprocess data to ensure correct Date Reference in trendMap
        const reprocessed = processData(filteredRows, data.groupByMode, startDate)

        return {
            filteredSummary: reprocessed.summary,
            filteredTrendData: reprocessed.trendData,
            storeRanking: data.storeData || [] // Always full data for Top 5 and Detail
        }
    }, [data, selectedStore, startDate, dayOfWeekFilter, timeFilter, customHourStart, customHourEnd]) // Include timeFilter + custom hours in dependency array

    // 🍽️ FILTERED FOOD COST: Recompute food cost for selected store
    const filteredFoodCost = useMemo(() => {
        if (!foodCostData || foodCostLoading) {
            return foodCostLoading ? { totalCost: 0, costPercentage: 0, loading: true } : null
        }

        // When a specific store is selected, look up by storeName first (ventas uses storeName as filter key)
        if (selectedStore !== 'all') {
            // Try byStoreName first (name-based lookup from cache API)
            const storeFC = foodCostData.byStoreName?.[selectedStore] || foodCostData.byStore?.[selectedStore]
            if (storeFC) {
                return {
                    totalCost: storeFC.totalCost,
                    costPercentage: storeFC.costPercentage,
                    loading: false
                }
            }
            // Store not found in food cost data — no FC for this store
            return null
        }

        // "All" stores — use the raw aggregated data
        return {
            totalCost: foodCostData.totalCost,
            costPercentage: foodCostData.costPercentage,
            loading: false
        }
    }, [foodCostData, foodCostLoading, selectedStore])

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

                    {/* Welcome Modal */}
                    {showWelcomeModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
                                <button 
                                    onClick={() => setShowWelcomeModal(false)}
                                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer"
                                >
                                    <X size={20} />
                                </button>
                                <div className="p-8">
                                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                                        <Zap size={32} />
                                    </div>
                                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                                        {t('sales.welcome_modal.title')}
                                    </h2>
                                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
                                        {t('sales.welcome_modal.part1')} <strong className="text-slate-900 dark:text-white font-semibold">{t('sales.welcome_modal.today_highlight')}</strong>
                                        {t('sales.welcome_modal.part2')} <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">{t('sales.welcome_modal.instant_highlight')}</strong>
                                        {t('sales.welcome_modal.part3')} <br/><br/>
                                        {t('sales.welcome_modal.part4')} <strong className="text-blue-600 dark:text-blue-400 font-semibold">{t('sales.welcome_modal.live_highlight')}</strong>
                                        {t('sales.welcome_modal.part5')}
                                    </p>
                                    <button 
                                        onClick={() => setShowWelcomeModal(false)}
                                        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 cursor-pointer"
                                    >
                                        {t('sales.welcome_modal.button')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

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
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
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
                                {data?.groupByMode === 'hour' && data?.rawRows?.some((r: any) => r.projectionMeta) && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium shadow-sm ml-1 mt-1 md:mt-0 max-w-full">
                                        <TrendingUp size={14} className="shrink-0" />
                                        <span>
                                            <strong>{t('sales.projection.title')}:</strong> {t('sales.projection.calculated_using')}
                                            {(() => {
                                                let targetRows = data.rawRows;
                                                if (selectedStore !== 'all') {
                                                    targetRows = targetRows.filter((r: any) => r.storeName === selectedStore || r.name === selectedStore || r.storeId === selectedStore);
                                                }
                                                const rowsWithMeta = targetRows.filter((r: any) => r.projectionMeta);
                                                if (rowsWithMeta.length === 0) return t('sales.projection.last_year_sales_fallback');
                                                
                                                let totalBase = 0;
                                                let sumGrowth = 0;
                                                let countGrowth = 0;
                                                let hasWeather = false;
                                                
                                                rowsWithMeta.forEach((r: any) => {
                                                    const m = r.projectionMeta;
                                                    if (m.base_sales) totalBase += m.base_sales;
                                                    if (m.growth_factor) {
                                                        sumGrowth += (m.growth_factor - 1) * 100;
                                                        countGrowth++;
                                                    }
                                                    if (m.weather_adjusted) hasWeather = true;
                                                });
                                                
                                                let explanation = "";
                                                if (totalBase > 0) {
                                                    explanation += `${t('sales.projection.base_of')} $${totalBase.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
                                                } else {
                                                    explanation += `${t('sales.projection.the_sales')}`;
                                                }
                                                
                                                const d = new Date(startDate + 'T12:00:00');
                                                d.setDate(d.getDate() - 364);
                                                const lastYearStr = d.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', { 
                                                    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' 
                                                });
                                                
                                                explanation += `${t('sales.projection.last_year_same_day')} (${lastYearStr})`;
                                                
                                                if (countGrowth > 0) {
                                                    const avgGrowth = sumGrowth / countGrowth;
                                                    explanation += `${t('sales.projection.adjusted_trend')}${avgGrowth > 0 ? '+' : ''}${avgGrowth.toFixed(1)}%)`;
                                                }
                                                if (hasWeather) {
                                                    explanation += `${t('sales.projection.weather_penalty')}`;
                                                }
                                                
                                                const totalProj = targetRows.reduce((sum: number, r: any) => sum + (r.projectedSales || 0), 0);
                                                if (totalProj > 0) {
                                                    explanation += ` ➔ ${t('sales.projection.total_projected')}: $${totalProj.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}.`;
                                                } else {
                                                    explanation += ".";
                                                }
                                                
                                                return explanation;
                                            })()}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                    {t('sales.title')}
                                </h1>
                                <button 
                                    onClick={() => setShowWelcomeModal(true)}
                                    className="p-1.5 text-blue-500 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-full transition-colors cursor-pointer"
                                    title="¿Cómo funciona el modo Relámpago?"
                                >
                                    <Info size={18} />
                                </button>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 mt-1">
                                {t('sales.subtitle')}
                            </p>
                        </div>

                        {/* Dynamic Date Label & Filter */}
                        <div className="flex flex-wrap items-center justify-center gap-2 bg-white/70 dark:bg-slate-900/80 p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5 w-full md:w-auto z-50">

                            <div className="flex items-center gap-1 mx-1">
                                <button 
                                    onClick={() => shiftDate(-1)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                                    title="Día Anterior"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <DateRangeFilter
                                    period={period}
                                    startDate={startDate}
                                    endDate={endDate}
                                    onChange={(p, s, e) => {
                                        setPeriod(p as any)
                                        setStartDate(s)
                                        setEndDate(e)
                                        // Reset day-of-week filter when switching to single-day views
                                        if (['today', 'yesterday'].includes(p)) {
                                            setDayOfWeekFilter(null)
                                        }
                                    }}
                                />
                                <button 
                                    onClick={() => shiftDate(1)}
                                    disabled={isTodayOrFuture}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                    title="Día Siguiente"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Store Filter */}
                            {storeList.length > 0 && (
                                <div className="relative min-w-0">
                                    <select
                                        value={selectedStore}
                                        onChange={(e) => setSelectedStore(e.target.value)}
                                        className="appearance-none pl-8 pr-8 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-black/5 dark:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50 max-w-[160px] truncate"
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

                            {/* Day-of-Week Comparison Filter — always visible, disabled for single-day */}
                            {(() => {
                                const isMultiDay = startDate !== endDate
                                // Calculate which days of the week exist in the date range
                                const daysInRange = new Set<number>()
                                if (isMultiDay) {
                                    const [sY, sM, sD] = startDate.split('-').map(Number)
                                    const [eY, eM, eD] = endDate.split('-').map(Number)
                                    const cur = new Date(sY, sM - 1, sD)
                                    const end = new Date(eY, eM - 1, eD)
                                    // If range covers 7+ days, all days exist
                                    const diffDays = Math.round((end.getTime() - cur.getTime()) / 86400000)
                                    if (diffDays >= 6) {
                                        for (let i = 0; i < 7; i++) daysInRange.add(i)
                                    } else {
                                        while (cur <= end) {
                                            daysInRange.add(cur.getDay())
                                            cur.setDate(cur.getDate() + 1)
                                        }
                                    }
                                }
                                const dayOptions = [
                                    { value: '1', label: t('sales.day_filter.monday') },
                                    { value: '2', label: t('sales.day_filter.tuesday') },
                                    { value: '3', label: t('sales.day_filter.wednesday') },
                                    { value: '4', label: t('sales.day_filter.thursday') },
                                    { value: '5', label: t('sales.day_filter.friday') },
                                    { value: '6', label: t('sales.day_filter.saturday') },
                                    { value: '0', label: t('sales.day_filter.sunday') },
                                ]
                                return (
                                    <div className="relative min-w-0">
                                        <select
                                            value={dayOfWeekFilter === null ? 'all' : String(dayOfWeekFilter)}
                                            onChange={(e) => setDayOfWeekFilter(e.target.value === 'all' ? null : Number(e.target.value))}
                                            disabled={!isMultiDay}
                                            className={`appearance-none pl-8 pr-8 py-2 rounded-xl text-xs font-medium transition-colors border cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                                                !isMultiDay
                                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 border-black/5 dark:border-slate-700 opacity-50 cursor-not-allowed'
                                                    : dayOfWeekFilter !== null
                                                        ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30'
                                                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-black/5 dark:border-slate-700'
                                            }`}
                                        >
                                            <option value="all">{t('sales.day_filter.all_days')}</option>
                                            {dayOptions.filter(d => daysInRange.has(Number(d.value))).map(d => (
                                                <option key={d.value} value={d.value}>{d.label}</option>
                                            ))}
                                        </select>
                                        <CalendarDays size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${dayOfWeekFilter !== null && isMultiDay ? 'text-indigo-500' : 'text-slate-400'}`} />
                                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                )
                            })()}

                            {/* Time Comparison Filter */}
                            <div className="flex items-center gap-1.5 min-w-0">
                                <div className="relative">
                                    <select
                                        value={timeFilter}
                                        onChange={(e) => {
                                            const val = e.target.value
                                            if (val === 'custom') {
                                                setTimeFilter(`${customHourStart}-${customHourEnd}`)
                                                // We'll show the pickers via a separate flag
                                                setTimeFilter('custom')
                                            } else {
                                                setTimeFilter(val)
                                            }
                                        }}
                                        className={`appearance-none pl-8 pr-8 py-2 rounded-xl text-xs font-medium transition-colors border cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50 ${
                                            timeFilter !== 'all'
                                                ? 'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-500/30'
                                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-black/5 dark:border-slate-700'
                                        }`}
                                    >
                                        <option value="all">{t('sales.time_filter.all_hours')}</option>
                                        <option value="6-11">{t('sales.time_filter.breakfast')}</option>
                                        <option value="11-16">{t('sales.time_filter.lunch')}</option>
                                        <option value="16-23">{t('sales.time_filter.dinner')}</option>
                                        <option value="23-4">{t('sales.time_filter.late_night')}</option>
                                        <option value="custom">{t('sales.time_filter.custom')}</option>
                                    </select>
                                    <Clock size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${timeFilter !== 'all' ? 'text-fuchsia-500' : 'text-slate-400'}`} />
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                                {timeFilter === 'custom' && (
                                    <div className="flex items-center gap-1">
                                        <select
                                            value={customHourStart}
                                            onChange={(e) => {
                                                const newStart = Number(e.target.value)
                                                setCustomHourStart(newStart)
                                                setTimeFilter('custom')
                                            }}
                                            className="appearance-none px-2 py-2 rounded-lg text-xs font-medium bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-500/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50"
                                        >
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>
                                                    {i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`}
                                                </option>
                                            ))}
                                        </select>
                                        <span className="text-slate-400 text-xs">→</span>
                                        <select
                                            value={customHourEnd}
                                            onChange={(e) => {
                                                const newEnd = Number(e.target.value)
                                                setCustomHourEnd(newEnd)
                                                setTimeFilter('custom')
                                            }}
                                            className="appearance-none px-2 py-2 rounded-lg text-xs font-medium bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-500/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50"
                                        >
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>
                                                    {i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="hidden lg:block w-[1px] h-6 bg-slate-300 dark:bg-slate-700 mx-1"></div>

                            {isLiveSyncing && (
                                <div className="hidden sm:flex items-center gap-2 px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-medium animate-pulse">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    {t('sales.syncing_live')}
                                </div>
                            )}

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
                                    onClick={() => refreshData(true)}
                                    disabled={loading || isLiveSyncing}
                                    className={`p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors border border-black/5 dark:border-slate-700 shrink-0 ${isLiveSyncing ? 'opacity-70 cursor-wait' : ''}`}
                                    title={isLiveSyncing ? t('sales.syncing_latest') : t('sales.refresh')}
                                >
                                    <RefreshCw size={18} className={(loading || isLiveSyncing) ? 'animate-spin text-emerald-500' : ''} />
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
                        <SalesSummary data={summary} foodCost={filteredFoodCost} />
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
                                const storeFC = foodCostData?.byStore?.[store.storeId]
                                const fcPct = storeFC?.costPercentage ?? null

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
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${Number(laborPct) < 21.5
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                                    : Number(laborPct) > 23
                                                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                                                        : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                                                    }`}>
                                                    {t('sales.labor_label')}: {laborPct}%
                                                </span>
                                                {fcPct !== null && (
                                                    <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${fcPct < 32
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                                        : fcPct > 36
                                                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                                                        }`}>
                                                        Food: {fcPct.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
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
                                        {['today', 'week', 'month'].includes(period) && (
                                            <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedToDate')}>
                                                <div className="flex items-center justify-end gap-1 text-cyan-500">
                                            {t('sales.table.proj_to_date')}
                                                    {sortConfig?.key === 'projectedToDate' ? (
                                                        sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                    ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                                </div>
                                            </th>
                                        )}
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('amount')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.table.actual')}
                                                {sortConfig?.key === 'amount' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedSales')}>
                                            <div className="flex items-center justify-end gap-1 text-indigo-500">
                                                {t('sales.table.projected_col')}
                                                {sortConfig?.key === 'projectedSales' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('diff')}>
                                            <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                {t('sales.table.variance')}
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
                                        {foodCostData?.byStore && Object.keys(foodCostData.byStore).length > 0 && (
                                            <th className="px-6 py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('foodCostPct')}>
                                                <div className="flex items-center justify-end gap-1 text-teal-600 dark:text-teal-400">
                                                    Food Cost
                                                    {sortConfig?.key === 'foodCostPct' ? (
                                                        sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                    ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                                </div>
                                            </th>
                                        )}
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
                                                {['today', 'week', 'month'].includes(period) && (
                                                    <td className="px-6 py-4 text-right text-cyan-600 dark:text-cyan-400 font-mono font-bold text-lg">
                                                        ${(store.projectedToDate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                )}
                                                <td className="px-6 py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-lg">
                                                    ${store.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-6 py-4 text-right text-indigo-500 dark:text-indigo-400 font-mono font-bold text-lg">
                                                    ${(store.projectedSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className={`px-6 py-4 text-right font-mono font-bold text-lg ${store.amount - (['today', 'week', 'month'].includes(period) ? (store.projectedToDate || 0) : (store.projectedSales || 0)) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {store.amount - (['today', 'week', 'month'].includes(period) ? (store.projectedToDate || 0) : (store.projectedSales || 0)) >= 0 ? '+' : ''}
                                                    ${(store.amount - (['today', 'week', 'month'].includes(period) ? (store.projectedToDate || 0) : (store.projectedSales || 0))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                                {foodCostData?.byStore && Object.keys(foodCostData.byStore).length > 0 && (
                                                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                        {(() => {
                                                            const storeFC = foodCostData.byStore[store.storeId]
                                                            if (!storeFC) return <span className="text-slate-400 text-sm">—</span>
                                                            const fcPct = storeFC.costPercentage
                                                            return (
                                                                <span
                                                                    onClick={() => window.open(`/admin/food-cost?store=${store.storeId}&startDate=${startDate}&endDate=${endDate}`, '_blank')}
                                                                    className={`px-2.5 py-1 rounded-lg font-bold text-lg inline-flex items-center gap-1 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-teal-400/50 transition-all ${
                                                                    fcPct < 30
                                                                        ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                                        : fcPct > 35
                                                                            ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                                            : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                                                }`}>
                                                                    {fcPct.toFixed(1)}%
                                                                </span>
                                                            )
                                                        })()}
                                                    </td>
                                                )}
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
        <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager']}>
            <SalesPageContent />
        </ProtectedRoute>
    )
}
