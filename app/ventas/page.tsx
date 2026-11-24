/**
 * @module ventas/page
 * @description Main Sales Analytics Dashboard for Tacos Gavilan, featuring real-time Toast POS monitoring, intraday smart projections, labor/food cost reconciliation, hourly curves, and multi-store rankings.
 * @businessRules
 * - Business day spans 6:00 AM to 5:59 AM next day (PST/PDT America/Los_Angeles).
 * - Net Sales formula: Sum(Item.Price) - Sum(Item.Discounts) - Sum(Item.Refunds) - Sum(UnlinkedRefunds) - Sum(CrossDateRefunds).
 * - Supports instant Stale-While-Revalidate caching with silent live updates.
 * - Dynamic dining options mapping and delivery channel segregation (Uber, DoorDash, Grubhub).
 * @dataFlow
 * - Client -> /api/ventas (Toast + Supabase Cache) -> Live Projections -> Food Cost Sync -> Recharts Dashboard.
 * @notes Self-heals historical discrepancies silently via /api/integrity/verify-day. Validates food cost cache store completeness (>= 14 stores, FC% > 0, and 0 broken stores with cost > 0 & sales <= 0) before accepting cache. [2026-11-23] Guarded against fake green 0.0% FC badges and fixed double $$ typo in mobile store cards.
 */
'use client'

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Calendar, CalendarDays, ChevronDown, ChevronUp, DollarSign, Store, Users, Clock, RefreshCw, Filter, TrendingUp, TrendingDown, Eye, Download, WifiOff, ClipboardList, ShieldCheck, CheckCircle, ArrowUpDown, ChevronLeft, ChevronRight, Info, X, Zap, Lock } from 'lucide-react'
import SalesSummary from '@/components/sales/SalesSummary'
import SurpriseLoader from '@/components/SurpriseLoader'
import SalesCharts from '@/components/sales/SalesCharts'
import FitValue from '@/components/sales/FitValue'
import { formatStoreName } from '@/lib/supabase'
import ProtectedRoute, { useAuth } from '@/components/ProtectedRoute'
import DateRangeFilter from '@/components/sales/DateRangeFilter'
import { useLanguage } from '@/lib/i18n'
import {
    FOOD_COST_HEALTHY_MAX,
    FOOD_COST_WARNING_MAX,
    addDaysIso,
    diffCalendarDays,
    escapeCsvCell,
    formatSignedUSD,
    getBusinessDateLA,
    getLANowParts,
    getMondayIso,
    isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'

// Helper to filter a single row by a time range
// Returns null for hourly rows outside the range (to be filtered out)
const applyTimeFilterToRow = (row: any, timeFilter: string): any | null => {
    if (timeFilter === 'all') return row

    const [startH, endH] = timeFilter.split('-').map(Number)
    if (Number.isNaN(startH) || Number.isNaN(endH)) return row
    const hours: number[] = []

    if (startH === endH) {
        hours.push(startH)
    } else if (startH > endH) {
        // Wrapping range (e.g. 23-6 = 23,0,1,2,3,4,5)
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
    const hasHourlyTickets = Boolean(row.hourlyTickets && Object.keys(row.hourlyTickets).length > 0)

    hours.forEach(h => {
        netSales += Number(row.hourlySales?.[h] || 0)
        laborCost += Number(row.hourlyLabor?.[h] || 0)
        if (hasHourlyTickets) {
            orderCount += Number(row.hourlyTickets?.[h] || 0)
        }
    })

    // Proportional estimate for fields without hourly breakdown
    const totalNetSales = Number(row.netSales || 0)
    const proportion = totalNetSales > 0 ? netSales / totalNetSales : 0
    if (!hasHourlyTickets) {
        orderCount = Math.round(Number(row.orderCount || 0) * proportion)
    }

    // Scale projectedSales & projectedHourly to the filtered hours window
    let projectedSales = Number(row.projectedSales || 0)
    let projectedHourly = row.projectedHourly
    if (row.projectedHourly && Object.keys(row.projectedHourly).length > 0) {
        const filteredProjHourly: Record<number, number> = {}
        let sumProj = 0
        hours.forEach(h => {
            const v = Number(row.projectedHourly[h] ?? row.projectedHourly[h < 6 ? h + 24 : h] ?? 0)
            filteredProjHourly[h] = v
            sumProj += v
        })
        projectedSales = sumProj
        projectedHourly = filteredProjHourly
    } else if (projectedSales > 0) {
        projectedSales = projectedSales * proportion
    }

    return {
        ...row,
        netSales,
        laborCost,
        orderCount,
        projectedSales,
        projectedHourly,
        grossSales: Number(row.grossSales || 0) * proportion,
        discounts: Number(row.discounts || 0) * proportion,
        tips: Number(row.tips || 0) * proportion,
        taxes: Number(row.taxes || 0) * proportion,
        guestCount: Math.round(Number(row.guestCount || 0) * proportion),
        totalHours: Number(row.totalHours || 0) * proportion
    }
}

// Monto para la tabla: con centavos solo en pantallas grandes (lg+). En horizontal de teléfono/tablet
// se redondea a dólares enteros para que las 9-10 columnas quepan sin scroll lateral enorme.
// (Math.abs===0 evita mostrar "-0" cuando el valor negativo se redondea a cero.)
const MoneyCell = ({ value, prefix = '' }: { value: number; prefix?: string }) => {
    const safe = Number.isFinite(value) ? value : 0
    const showPlus = prefix === '+'
    return (
        <>
            <span className="lg:hidden">{formatSignedUSD(safe, { decimals: 0, showPlus })}</span>
            <span className="hidden lg:inline">{formatSignedUSD(safe, { decimals: 2, showPlus })}</span>
        </>
    )
}

function SalesPageContent() {
    const router = useRouter()
    const urlParams = useSearchParams()
    const [loading, setLoading] = useState(false)
    const [period, setPeriod] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom' | 'last_week' | 'last_7' | 'last_month'>(() => {
        const p = urlParams.get('period')
        if (p && ['today','yesterday','week','month','quarter','custom','last_week','last_7','last_month'].includes(p)) return p as any
        if (urlParams.get('startDate') && urlParams.get('endDate')) return 'custom'
        return 'today'
    })
    const getLocalDateString = () => getBusinessDateLA()

    const resolvePeriodDates = (p: string, curStart: string, curEnd: string): { s: string; e: string } => {
        const todayIso = getBusinessDateLA()
        if (p === 'today') return { s: todayIso, e: todayIso }
        if (p === 'yesterday') {
            const y = addDaysIso(todayIso, -1)
            return { s: y, e: y }
        }
        if (p === 'week') return { s: getMondayIso(todayIso), e: todayIso }
        if (p === 'last_week') {
            if (isValidIsoDate(curStart) && isValidIsoDate(curEnd) && curStart !== todayIso) return { s: curStart, e: curEnd }
            const lastMon = addDaysIso(getMondayIso(todayIso), -7)
            return { s: lastMon, e: addDaysIso(lastMon, 6) }
        }
        if (p === 'last_7') return { s: addDaysIso(todayIso, -6), e: todayIso }
        if (p === 'month') return { s: `${todayIso.slice(0, 7)}-01`, e: todayIso }
        if (p === 'last_month') {
            if (isValidIsoDate(curStart) && isValidIsoDate(curEnd) && curStart !== todayIso) return { s: curStart, e: curEnd }
            const [y, m] = todayIso.split('-').map(Number)
            const prevY = m === 1 ? y - 1 : y
            const prevM = m === 1 ? 12 : m - 1
            const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate()
            const mm = String(prevM).padStart(2, '0')
            return { s: `${prevY}-${mm}-01`, e: `${prevY}-${mm}-${String(lastDay).padStart(2, '0')}` }
        }
        if (p === 'quarter') {
            const [y, m] = todayIso.split('-').map(Number)
            const qStartM = Math.floor((m - 1) / 3) * 3 + 1
            return { s: `${y}-${String(qStartM).padStart(2, '0')}-01`, e: todayIso }
        }
        return {
            s: isValidIsoDate(curStart) ? curStart : todayIso,
            e: isValidIsoDate(curEnd) ? curEnd : todayIso,
        }
    }

    const initialDates = (() => {
        const uS = urlParams.get('startDate') || ''
        const uE = urlParams.get('endDate') || ''
        if (isValidIsoDate(uS) && isValidIsoDate(uE)) return { s: uS, e: uE }
        return resolvePeriodDates(period, uS, uE)
    })()

    const [startDate, setStartDate] = useState(() => initialDates.s)
    const [endDate, setEndDate] = useState(() => initialDates.e)
    const [isLiveSyncing, setIsLiveSyncing] = useState(false)
    const [data, setData] = useState<any>(null)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
    const [loadingMessage, setLoadingMessage] = useState('')
    const [connError, setConnError] = useState<string | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [integrityStatus, setIntegrityStatus] = useState<'idle' | 'verifying' | 'fixed' | 'ok'>('idle')
    const [selectedStore, setSelectedStore] = useState<string>(() => urlParams.get('store') || urlParams.get('storeId') || 'all') // Store filter for KPIs and Trend
    const [storeList, setStoreList] = useState<string[]>([]) // Available stores
    const [dayOfWeekFilter, setDayOfWeekFilter] = useState<number | null>(null) // null = all days, 0=Sun, 1=Mon...6=Sat
    const [timeFilter, setTimeFilter] = useState<string>('all') // 'all', '6-11', '11-16', '16-23', '23-4', 'custom'
    const [customHourStart, setCustomHourStart] = useState(6)
    const [customHourEnd, setCustomHourEnd] = useState(14)
    const [showWelcomeModal, setShowWelcomeModal] = useState(false)
    const [showMobileFormula, setShowMobileFormula] = useState(false)
    const { user } = useAuth()
    const { t, language } = useLanguage()
    const normalizedRole = (user?.role || '').trim().toLowerCase()
    const isAdmin = normalizedRole === 'admin' || normalizedRole === 'administrador'
    const canAutoVerifyIntegrity = isAdmin || normalizedRole === 'supervisor'
    const getAuthHeaders = (): Record<string, string> => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
        return token && token !== 'null' && token !== 'undefined' ? { Authorization: `Bearer ${token}` } : {}
    }

    // Food Cost Integration State
    const [foodCostData, setFoodCostData] = useState<{
        totalCost: number,
        totalSales: number,
        costPercentage: number,
        totalPackagingCost?: number,
        packagingPercentage?: number,
        byStore?: Record<string, { totalCost: number, netSales: number, costPercentage: number, totalPackagingCost?: number, packagingPercentage?: number }>,
        byStoreName?: Record<string, { totalCost: number, netSales: number, costPercentage: number, totalPackagingCost?: number, packagingPercentage?: number }>
    } | null>(null)
    const [foodCostLoading, setFoodCostLoading] = useState(false)

    // AbortController: cancels in-flight HTTP requests when user changes filter
    const abortControllerRef = useRef<AbortController | null>(null)




    const shiftDate = (days: number) => {
        if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) return
        setPeriod('custom')
        setDayOfWeekFilter(null)
        setStartDate(addDaysIso(startDate, days))
        setEndDate(addDaysIso(endDate, days))
    }

    const todayStr = getBusinessDateLA()
    const isTodayOrFuture = endDate >= todayStr
    // Unified active-period flag across Table, Mobile Cards, CSV, and SalesCharts
    const isActivePeriod = isValidIsoDate(startDate) && isValidIsoDate(endDate) && startDate <= todayStr && endDate >= todayStr

    // Auto-clear dayOfWeekFilter if range becomes single-day or no longer contains that weekday
    useEffect(() => {
        if (dayOfWeekFilter === null) return
        if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate === endDate) {
            setDayOfWeekFilter(null)
            return
        }
        const totalSpan = diffCalendarDays(startDate, endDate)
        if (totalSpan >= 6) return
        const present = new Set<number>()
        for (let i = 0; i <= totalSpan; i++) {
            const iso = addDaysIso(startDate, i)
            const [y, m, d] = iso.split('-').map(Number)
            present.add(new Date(Date.UTC(y, m - 1, d)).getUTCDay())
        }
        if (!present.has(dayOfWeekFilter)) {
            setDayOfWeekFilter(null)
        }
    }, [startDate, endDate, dayOfWeekFilter])

    const handleStoreClick = (storeId: string) => {
        if (!storeId) return
        const url = `/planificador?store=${encodeURIComponent(storeId)}&date=${encodeURIComponent(startDate)}`
        window.open(url, '_blank', 'noopener,noreferrer')
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

    const isSubDayOrDowFiltered = dayOfWeekFilter !== null || timeFilter !== 'all'

    const getValidStoreFC = (storeId?: string, storeName?: string) => {
        if (!foodCostData || isSubDayOrDowFiltered) return null
        const fc =
            (storeId ? foodCostData.byStore?.[storeId] : undefined) ||
            (storeName ? foodCostData.byStoreName?.[storeName] : undefined)
        if (!fc || fc.netSales <= 0 || fc.totalCost <= 0 || fc.costPercentage <= 0) return null
        return fc
    }

    // Helper: redistribute hourly rows using REAL hourlyLabor & hourlyTickets before time filtering
    const filterAndRedistributeRows = (rawRows: any[], groupByMode: string, dowFilter: number | null, resolvedTime: string) => {
        let filteredRows = rawRows

        if (dowFilter !== null && groupByMode !== 'week') {
            filteredRows = filteredRows.filter((r: any) => {
                if (!r.periodStart) return false
                const [datePart, timePart] = String(r.periodStart).split(' ')
                let bizDate = datePart
                if (timePart) {
                    const hr = parseInt(timePart.split(':')[0], 10)
                    if (!Number.isNaN(hr) && hr < 6) bizDate = addDaysIso(datePart, -1)
                }
                const [y, m, d] = bizDate.split('-').map(Number)
                return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dowFilter
            })
        }

        if (resolvedTime !== 'all') {
            const [sH, eH] = resolvedTime.split('-').map(Number)
            const allowedHours = new Set<number>()
            if (!Number.isNaN(sH) && !Number.isNaN(eH)) {
                if (sH === eH) allowedHours.add(sH)
                else if (sH > eH) {
                    for (let i = sH; i < 24; i++) allowedHours.add(i)
                    for (let i = 0; i < eH; i++) allowedHours.add(i)
                } else {
                    for (let i = sH; i < eH; i++) allowedHours.add(i)
                }
            }

            if (groupByMode === 'hour') {
                const storeGroups = new Map<string, any[]>()
                filteredRows.forEach((r: any) => {
                    if (!storeGroups.has(r.storeId)) storeGroups.set(r.storeId, [])
                    storeGroups.get(r.storeId)!.push(r)
                })
                const redistributed: any[] = []
                storeGroups.forEach((rows) => {
                    const concRow = rows.find((r: any) => (r.orderCount || 0) > 0 || (r.laborCost || 0) > 0 || (r.hourlyLabor && Object.keys(r.hourlyLabor).length > 0))
                    const totalSales = rows.reduce((sum: number, r: any) => sum + Number(r.netSales || 0), 0)
                    const hLaborMap = concRow?.hourlyLabor && Object.keys(concRow.hourlyLabor).length > 0 ? concRow.hourlyLabor : null
                    const hTicketsMap = concRow?.hourlyTickets && Object.keys(concRow.hourlyTickets).length > 0 ? concRow.hourlyTickets : null

                    // Filter projectedHourly & compute filtered projectedSales for this store
                    let filteredProjHourly = concRow?.projectedHourly
                    let filteredProjSales = Number(concRow?.projectedSales || 0)
                    if (concRow?.projectedHourly && Object.keys(concRow.projectedHourly).length > 0 && allowedHours.size > 0) {
                        const subProj: Record<number, number> = {}
                        let sumP = 0
                        allowedHours.forEach((h) => {
                            const val = Number(concRow.projectedHourly[h] ?? concRow.projectedHourly[h < 6 ? h + 24 : h] ?? 0)
                            subProj[h] = val
                            sumP += val
                        })
                        filteredProjHourly = subProj
                        filteredProjSales = sumP
                    }

                    rows.forEach((r: any) => {
                        const hr = parseInt(String(r.periodStart || '').split(' ')[1]?.split(':')[0] || '0', 10)
                        const proportion = totalSales > 0 ? Number(r.netSales || 0) / totalSales : (rows.length > 0 ? 1 / rows.length : 0)
                        const realHourLabor = hLaborMap ? Number(hLaborMap[hr] || 0) : (concRow ? Number(concRow.laborCost || 0) * proportion : 0)
                        const realHourOrders = hTicketsMap ? Number(hTicketsMap[hr] || 0) : (concRow ? Math.round(Number(concRow.orderCount || 0) * proportion) : 0)
                        redistributed.push({
                            ...r,
                            orderCount: realHourOrders,
                            guestCount: concRow ? Math.round(Number(concRow.guestCount || 0) * proportion) : 0,
                            laborCost: realHourLabor,
                            totalHours: concRow ? Number(concRow.totalHours || 0) * proportion : 0,
                            grossSales: concRow ? Number(concRow.grossSales || 0) * proportion : 0,
                            discounts: concRow ? Number(concRow.discounts || 0) * proportion : 0,
                            tips: concRow ? Number(concRow.tips || 0) * proportion : 0,
                            taxes: concRow ? Number(concRow.taxes || 0) * proportion : 0,
                            hourlyLabor: hLaborMap || r.hourlyLabor,
                            projectedSales: filteredProjSales,
                            projectedHourly: filteredProjHourly,
                        })
                    })
                })
                filteredRows = redistributed
            }
            filteredRows = filteredRows.map((r: any) => applyTimeFilterToRow(r, resolvedTime)).filter(Boolean)
        }

        return filteredRows
    }

    const sortedStoreData = useMemo(() => {
        if (!data?.storeData) return []
        let sourceData = [...data.storeData]

        const resolvedTime = timeFilter === 'custom' ? `${customHourStart}-${customHourEnd}` : timeFilter

        // Delegate filtered store re-aggregation to processData so projectedToDate, manualOverride & real hourlyLabor stay intact
        if ((dayOfWeekFilter !== null || resolvedTime !== 'all') && data.rawRows) {
            const filteredRows = filterAndRedistributeRows(data.rawRows, data.groupByMode, dayOfWeekFilter, resolvedTime)
            sourceData = processData(filteredRows, data.groupByMode, startDate).storeData
        }

        const sortableItems = [...sourceData]
        if (sortConfig !== null) {
            sortableItems.sort((a: any, b: any) => {
                let aValue: any = a[sortConfig.key]
                let bValue: any = b[sortConfig.key]

                if (sortConfig.key === 'diff') {
                    aValue = Number(a.amount || 0) - (isActivePeriod ? Number(a.projectedToDate || 0) : Number(a.projectedSales || 0))
                    bValue = Number(b.amount || 0) - (isActivePeriod ? Number(b.projectedToDate || 0) : Number(b.projectedSales || 0))
                } else if (sortConfig.key === 'avgTicket') {
                    aValue = Number(a.orderCount || 0) > 0 ? Number(a.amount || 0) / Number(a.orderCount) : 0
                    bValue = Number(b.orderCount || 0) > 0 ? Number(b.amount || 0) / Number(b.orderCount) : 0
                } else if (sortConfig.key === 'name') {
                    aValue = (a.name || a.storeName || '').toLowerCase()
                    bValue = (b.name || b.storeName || '').toLowerCase()
                } else if (sortConfig.key === 'laborPercentage') {
                    aValue = Number(a.laborPercentage || 0)
                    bValue = Number(b.laborPercentage || 0)
                } else if (sortConfig.key === 'foodCostPct') {
                    const missingSentinel = sortConfig.direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
                    const fcA = getValidStoreFC(a.storeId, a.storeName || a.name)
                    const fcB = getValidStoreFC(b.storeId, b.storeName || b.name)
                    aValue = fcA ? fcA.costPercentage : missingSentinel
                    bValue = fcB ? fcB.costPercentage : missingSentinel
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
                return 0
            })
        }
        return sortableItems
    }, [data, sortConfig, dayOfWeekFilter, timeFilter, customHourStart, customHourEnd, foodCostData, isActivePeriod, startDate])

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

        const laNow = getLANowParts()
        const nowStr = laNow.hourKey
        const nowDateStr = laNow.businessDate
        const currentMinuteRatio = laNow.minuteRatio
        const currentBizHour = laNow.hour < 6 ? laNow.hour + 24 : laNow.hour
        const elapsedTodayFraction = Math.min(Math.max((currentBizHour - 6 + currentMinuteRatio) / 24, 0), 1)

        const computeHourlyProjToDate = (projectedHourly: Record<string, any>, baseDateStr: string) => {
            const nextDateStr = addDaysIso(baseDateStr, 1)
            let acc = 0
            Object.entries(projectedHourly).forEach(([h, amount]) => {
                let hourInt = parseInt(h, 10)
                if (Number.isNaN(hourInt)) return
                let isNext = hourInt < 6
                if (hourInt >= 24) {
                    hourInt -= 24
                    isNext = true
                }
                const dStr = isNext ? nextDateStr : baseDateStr
                const timeStr = `${dStr} ${String(hourInt).padStart(2, '0')}:00`
                if (timeStr < nowStr) acc += Number(amount) || 0
                else if (timeStr === nowStr) acc += (Number(amount) || 0) * currentMinuteRatio
            })
            return acc
        }

        // Store Data (keyed by storeId when available to avoid name-variation splits)
        const storeMap = new Map()
        rows.forEach((row: any) => {
            const storeName = row.storeName || t('sales.unknown_store')
            const storeKey = row.storeId || storeName
            if (!storeMap.has(storeKey)) {
                storeMap.set(storeKey, {
                    name: storeName,
                    storeName: storeName,
                    storeId: row.storeId,
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

            let rowProjToDate = 0
            const hasHourlyProj = Boolean(row.projectedHourly && Object.keys(row.projectedHourly).length > 0)
            if (groupByMode === 'hour' && hasHourlyProj) {
                rowProjToDate = computeHourlyProjToDate(row.projectedHourly, referenceDate)
            } else if (groupByMode === 'week' && row.periodStart && isValidIsoDate(row.periodStart)) {
                const daysSinceMon = diffCalendarDays(row.periodStart, nowDateStr)
                if (daysSinceMon >= 7) {
                    rowProjToDate = Number(row.projectedSales || 0)
                } else if (daysSinceMon >= 0) {
                    rowProjToDate = Number(row.projectedSales || 0) * Math.min((daysSinceMon + elapsedTodayFraction) / 7, 1)
                }
            } else {
                if (row.periodStart && row.periodStart < nowDateStr) {
                    rowProjToDate = Number(row.projectedSales || 0)
                } else if (!row.periodStart || row.periodStart === nowDateStr) {
                    // Use exact projectedHourly curve for Today inside week/month views when available
                    rowProjToDate = hasHourlyProj
                        ? computeHourlyProjToDate(row.projectedHourly, nowDateStr)
                        : Number(row.projectedSales || 0) * elapsedTodayFraction
                }
            }

            const s = storeMap.get(storeKey)
            s.amount += (row.netSales || 0)
            s.netSales += (row.netSales || 0)
            s.orderCount += (row.orderCount || 0)
            s.guestCount += (row.guestCount || 0)
            s.laborCost += (row.laborCost || 0)
            s.totalHours += (row.totalHours || 0)
            const rowIsManual = row.projectionMeta?.manual_override === true
            const rowAiBase = Number(row.projectionMeta?.ai_base_sales ?? row.projectedSales ?? 0)
            if (groupByMode === 'hour') {
                s.projectedSales = (row.projectedSales || 0)
                s.projectedToDate = rowProjToDate
                s.manualOverride = rowIsManual
                s.aiBaseSales = rowAiBase
                s.overriddenBy = row.projectionMeta?.overridden_by || null
            } else {
                s.projectedSales += (row.projectedSales || 0)
                s.projectedToDate += rowProjToDate
                s.aiBaseSales = (s.aiBaseSales || 0) + rowAiBase
                if (rowIsManual) {
                    s.manualOverrideDays = (s.manualOverrideDays || 0) + 1
                    s.overriddenBy = row.projectionMeta?.overridden_by || s.overriddenBy || null
                }
            }
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
            // Full 24h Tacos Gavilan business day: 6:00 AM -> 5:59 AM next day
            const baseDateStr = referenceDate
            const nextDateStr = addDaysIso(baseDateStr, 1)

            const hoursOfInterest = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

            hoursOfInterest.forEach(h => {
                const isNextDay = h < 6
                const dateP = isNextDay ? nextDateStr : baseDateStr
                const timeKey = `${dateP} ${h.toString().padStart(2, '0')}:00`
                trendMap.set(timeKey, { amount: 0, labor: 0 })
                projMap.set(timeKey, 0)
            })

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

            })

            // Collect unique store projections to prevent summing 24 times in hourly mode
            const seenStoresForProj = new Set<string>()
            rows.forEach((row: any) => {
                if (row.projectedHourly && !seenStoresForProj.has(row.storeId)) {
                    seenStoresForProj.add(row.storeId)
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
                        const currentVal = projMap.get(key) || 0
                        projMap.set(key, currentVal + (Number(amount) || 0))
                    })
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
            .sort((a, b) => String(a.time).localeCompare(String(b.time)))

        return { summary, trendData, storeData, rows }
    }

    const refreshData = async (forceLive = false, isBackground = false, externalSignal?: AbortSignal): Promise<boolean> => {
        const signal = externalSignal || abortControllerRef.current?.signal

        if (!isBackground) {
            setLoading(true)
            setLoadingMessage(t('sales.loading_connecting'))
        } else {
            setIsLiveSyncing(true)
        }
        try {
            const { s: startIso, e: endIso } = resolvePeriodDates(period, startDate, endDate)
            const diff = diffCalendarDays(startIso, endIso)
            let groupBy = 'day'

            if (period === 'today' || period === 'yesterday' || diff === 0) {
                groupBy = 'hour'
            } else if (period === 'quarter') {
                groupBy = (dayOfWeekFilter !== null || timeFilter !== 'all') ? 'day' : 'week'
            } else if (diff > 31 && dayOfWeekFilter === null && timeFilter === 'all') {
                groupBy = 'week'
            } else {
                groupBy = 'day'
            }

            if (startIso !== startDate) setStartDate(startIso)
            if (endIso !== endDate) setEndDate(endIso)

            const query = new URLSearchParams({
                storeIds: 'all',
                startDate: startIso,
                endDate: endIso,
                groupBy: groupBy
            })

            if (forceLive === true) {
                query.append('skipCache', 'true')
            }

            if (!isBackground) setLoadingMessage(t('sales.loading_fetching'))
            const res = await fetch(`/api/ventas?${query}`, {
                headers: getAuthHeaders(),
                signal
            })

            if (signal?.aborted) return false

            if (res.status === 401 || res.status === 403) {
                if (!isBackground) setLoadingMessage(t('sales.access_denied'))
                return false
            }

            if (!res.ok) {
                setConnError(`HTTP ${res.status}`)
                return false
            }

            if (!isBackground) setLoadingMessage(t('sales.loading_processing'))
            const json = await res.json()
            if (signal?.aborted) return false

            if (json.meta?.connectionError) {
                setConnError(json.meta.connectionError)
            } else {
                setConnError(null)
            }

            if (json.data) {
                const effectiveGroupBy = json.meta?.effectiveGroupBy || groupBy
                const processed = processData(json.data, effectiveGroupBy, startIso)
                setData({ ...processed, rawRows: json.data, groupByMode: effectiveGroupBy })
                const uniqueStores = [...new Set(json.data.map((r: any) => r.storeName || t('sales.unknown_store')))] as string[]
                const sortedStores = uniqueStores.sort()
                setStoreList(sortedStores)
                setSelectedStore(prev => {
                    if (prev === 'all' || sortedStores.includes(prev)) return prev
                    const normPrev = formatStoreName(prev).toLowerCase().trim()
                    const matchedRow = json.data.find((r: any) =>
                        r.storeId === prev ||
                        r.storeName === prev ||
                        formatStoreName(r.storeName || '').toLowerCase().trim() === normPrev ||
                        (r.storeName || '').toLowerCase().includes(normPrev)
                    )
                    return matchedRow?.storeName || prev
                })
                return true
            } else {
                setData(null)
                setStoreList([])
                return false
            }

        } catch (e: any) {
            if (e?.name === 'AbortError') return false
            console.error('Error fetching sales data:', e)
            return false
        } finally {
            if (!signal?.aborted) {
                setLastUpdated(new Date())
                if (!isBackground) {
                    setLoading(false)
                    setLoadingMessage('')
                } else {
                    setIsLiveSyncing(false)
                }
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
            const authHeaders = getAuthHeaders()
            // Step 1: Try Cache (instant ~50ms)
            const cacheRes = await fetch(`/api/inventory/food-cost-cache?startDate=${sDate}&endDate=${eDate}`, { headers: authHeaders, signal })
            if (!cacheRes.ok) {
                if (!signal?.aborted) setFoodCostData(null)
                return
            }
            const cacheJson = await cacheRes.json()

            // Pure UTC calendar day count (immune to DST 23h/25h transitions)
            const rangeDays = diffCalendarDays(sDate, eDate) + 1

            const cachedStoreEntries = Object.values(cacheJson.byStore || {}) as Array<{ totalCost: number, netSales: number, costPercentage: number }>
            const cachedStoresCount = cachedStoreEntries.length
            const hasBrokenStoreFC = (cacheJson.invalidStoresCount || 0) > 0 ||
                cachedStoreEntries.some(s => (s.totalCost || 0) > 0 && (s.netSales || 0) <= 0)

            // Cache is considered complete only if:
            // 1) All days in range are represented
            // 2) At least 14 stores are present (out of 15 active stores in Tacos Gavilan)
            // 3) Food cost percentage > 0 and totalSales > 0
            // 4) Zero stores have broken cost > 0 with netSales <= 0 (prevents stale/0% LA Central badge)
            const isCacheComplete = cacheJson.daysWithData >= rangeDays &&
                cachedStoresCount >= 14 &&
                cacheJson.costPercentage > 0 &&
                cacheJson.totalSales > 0 &&
                !hasBrokenStoreFC

            if (cacheJson.totalCost > 0) {
                if (signal?.aborted) return
                // Cache hit (full or partial) — use pre-calculated data immediately for instant display
                setFoodCostData({
                    totalCost: cacheJson.totalFoodCost ?? cacheJson.totalCost,
                    totalSales: cacheJson.totalSales,
                    costPercentage: cacheJson.costPercentage,
                    totalPackagingCost: cacheJson.totalPackagingCost ?? 0,
                    packagingPercentage: cacheJson.packagingPercentage ?? 0,
                    byStore: cacheJson.byStore || {},
                    byStoreName: cacheJson.byStoreName || {}
                })
                console.log(`[FoodCost] ⚡ Cache hit: ${cacheJson.daysWithData}/${cacheJson.totalDaysInRange} days (${cachedStoresCount} stores, FC: ${cacheJson.costPercentage}%)`)

                // If cache is complete (all days covered AND all stores present with valid sales/FC), we're done
                if (isCacheComplete) {
                    return
                }
                console.log(`[FoodCost] ⚠️ Cache is partial (${cachedStoresCount}/15 stores, FC: ${cacheJson.costPercentage}%). Refreshing live calculation...`)
            }

            // Step 2A: Single-day cache miss or partial cache — direct full calculation (proven, fast path)
            // This handles "Today" and "Yesterday" reliably by reading the API response directly
            if (sDate === eDate) {
                console.log(`[FoodCost] 🔄 Cache miss or partial for ${sDate}, falling back to full calculation...`)
                const fullRes = await fetch(`/api/inventory/food-cost?storeId=all&startDate=${sDate}&endDate=${eDate}`, { headers: authHeaders, signal })
                if (!fullRes.ok) {
                    if (!signal?.aborted) setFoodCostData(null)
                    return
                }
                const fullJson = await fullRes.json()

                if (signal?.aborted) return

                if (fullJson.data && fullJson.data.length > 0) {
                    const authSalesByStore: Record<string, number> = fullJson.salesNetSales || {}
                    const storeMap: Record<string, { totalCost: number, netSales: number, costPercentage: number, totalPackagingCost: number, packagingPercentage: number }> = {}
                    const storeNameMap: Record<string, { totalCost: number, netSales: number, costPercentage: number, totalPackagingCost: number, packagingPercentage: number }> = {}
                    const nameByStoreId: Record<string, string> = {}

                    fullJson.data.forEach((item: any) => {
                        const sid = item.store_id || 'unknown'
                        const sname = item.store_name || sid
                        nameByStoreId[sid] = sname
                        if (!storeMap[sid]) storeMap[sid] = { totalCost: 0, netSales: 0, costPercentage: 0, totalPackagingCost: 0, packagingPercentage: 0 }
                        storeMap[sid].totalCost += Number(item.food_cost ?? item.total_cost ?? 0)
                        storeMap[sid].totalPackagingCost += Number(item.packaging_cost ?? 0)
                        storeMap[sid].netSales += Number(item.net_sales || 0)
                    })

                    let totalCost = 0
                    let totalPkg = 0
                    let totalSales = 0
                    Object.entries(storeMap).forEach(([sid, s]) => {
                        const authSales = Number(authSalesByStore[sid] || 0)
                        if (authSales > 0) s.netSales = authSales
                        s.costPercentage = s.netSales > 0 ? (s.totalCost / s.netSales) * 100 : 0
                        s.packagingPercentage = s.netSales > 0 && s.totalPackagingCost > 0 ? (s.totalPackagingCost / s.netSales) * 100 : 0
                        const sname = nameByStoreId[sid] || sid
                        storeNameMap[sname] = { ...s }
                        // Isolate broken stores (cost > 0 && sales <= 0) from global KPI ratio
                        if (!(s.totalCost > 0 && s.netSales <= 0)) {
                            totalCost += s.totalCost
                            totalPkg += s.totalPackagingCost
                            totalSales += s.netSales
                        }
                    })

                    const costPct = totalSales > 0 ? (totalCost / totalSales) * 100 : 0
                    const pkgPct = totalSales > 0 && totalPkg > 0 ? (totalPkg / totalSales) * 100 : 0
                    setFoodCostData({
                        totalCost,
                        totalSales,
                        costPercentage: costPct,
                        totalPackagingCost: totalPkg,
                        packagingPercentage: pkgPct,
                        byStore: storeMap,
                        byStoreName: storeNameMap
                    })
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

                // For each date without complete cache, trigger full calculation (auto-caches via write-through)
                let filledAny = false
                for (const date of allDates) {
                    if (signal?.aborted) return
                    const dayCheck = await fetch(`/api/inventory/food-cost-cache?startDate=${date}&endDate=${date}`, { headers: authHeaders, signal })
                    if (dayCheck.ok) {
                        const dayJson = await dayCheck.json()
                        const dayStoreEntries = Object.values(dayJson.byStore || {}) as Array<{ totalCost: number, netSales: number }>
                        const dayStoresCount = dayStoreEntries.length
                        const dayHasBrokenStore = (dayJson.invalidStoresCount || 0) > 0 ||
                            dayStoreEntries.some(s => (s.totalCost || 0) > 0 && (s.netSales || 0) <= 0)
                        if (dayJson.totalCost > 0 && dayStoresCount >= 14 && dayJson.costPercentage > 0 && !dayHasBrokenStore) {
                            continue
                        }
                    }

                    if (signal?.aborted) return
                    console.log(`[FoodCost] 🔄 Gap-fill: calculating ${date}...`)
                    try {
                        const calcRes = await fetch(`/api/inventory/food-cost?storeId=all&startDate=${date}&endDate=${date}`, { headers: authHeaders, signal })
                        if (calcRes.ok) filledAny = true
                    } catch (dayErr: any) {
                        if (dayErr?.name === 'AbortError') throw dayErr
                        console.warn(`[FoodCost] ⚠️ Failed to calculate ${date}:`, dayErr)
                    }
                }

                if (signal?.aborted) return
                // Re-read cache with all gaps filled
                if (filledAny || !(cacheJson.totalCost > 0)) {
                    const finalRes = await fetch(`/api/inventory/food-cost-cache?startDate=${sDate}&endDate=${eDate}`, { headers: authHeaders, signal })
                    if (!finalRes.ok) {
                        if (!signal?.aborted) setFoodCostData(null)
                        return
                    }
                    const finalJson = await finalRes.json()

                    if (signal?.aborted) return

                    if (finalJson.totalCost > 0) {
                        setFoodCostData({
                            totalCost: finalJson.totalFoodCost ?? finalJson.totalCost,
                            totalSales: finalJson.totalSales,
                            costPercentage: finalJson.costPercentage,
                            totalPackagingCost: finalJson.totalPackagingCost ?? 0,
                            packagingPercentage: finalJson.packagingPercentage ?? 0,
                            byStore: finalJson.byStore || {},
                            byStoreName: finalJson.byStoreName || {}
                        })
                        console.log(`[FoodCost] ✅ Gap-fill complete: ${finalJson.daysWithData}/${finalJson.totalDaysInRange} days`)
                        return
                    }
                }
            }

            // Step 3: No data available (long ranges without cache, or calculation returned empty)
            if (!(cacheJson.totalCost > 0)) {
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
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        const controller = new AbortController()
        abortControllerRef.current = controller
        const { s: effectiveStart, e: effectiveEnd } = resolvePeriodDates(period, startDate, endDate)

        const loadAndSync = async () => {
            const ok = await refreshData(false, false, controller.signal)
            if (ok && !controller.signal.aborted && period === 'today') {
                await refreshData(true, true, controller.signal)
            }
        }
        loadAndSync()

        // Parallel Food Cost Fetch using resolved period dates (avoids stale-date fetch on URL load)
        fetchFoodCost(effectiveStart, effectiveEnd, controller.signal)

        setIntegrityStatus('idle')

        return () => {
            controller.abort()
        }
    }, [period, startDate, endDate, dayOfWeekFilter !== null, timeFilter !== 'all'])

    // INTEGRITY CHECK HOOK (admins & supervisors only, strictly on closed Yesterday, preserving hourly chart & projections)
    useEffect(() => {
        if (!canAutoVerifyIntegrity || !data || loading || verifying) return
        if (period !== 'yesterday' || integrityStatus !== 'idle') return

        const controller = new AbortController()
        const runVerify = async () => {
            setVerifying(true)
            setIntegrityStatus('verifying')
            try {
                const res = await fetch('/api/integrity/verify-day', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getAuthHeaders(),
                    },
                    body: JSON.stringify({ date: startDate, storeIds: 'all' }),
                    signal: controller.signal,
                })
                if (controller.signal.aborted) return
                if (!res.ok) {
                    setIntegrityStatus('idle')
                    return
                }
                const json = await res.json()
                if (controller.signal.aborted) return

                if (json.status === 'corrected') {
                    console.log('🛠️ [AUTO-HEAL] Discrepancias corregidas. Re-cargando vista horaria y proyecciones...')
                    setIntegrityStatus('fixed')
                    // Re-fetch cleanly from newly healed cache so hourly breakdown + projections remain intact
                    await refreshData(false, true, controller.signal)
                } else if (json.status === 'ok') {
                    setIntegrityStatus('ok')
                } else {
                    setIntegrityStatus('idle')
                }
            } catch (e: any) {
                if (e?.name !== 'AbortError') {
                    console.warn('Integrity check skipped', e)
                    setIntegrityStatus('idle')
                }
            } finally {
                if (!controller.signal.aborted) setVerifying(false)
            }
        }

        const timer = setTimeout(runVerify, 2000)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [canAutoVerifyIntegrity, data, loading, period, startDate, integrityStatus])

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

    const { filteredSummary, filteredTrendData, filteredProjectedToDate } = useMemo(() => {
        if (!data || !data.rawRows) {
            return { filteredSummary: defaultSummary, filteredTrendData: [], filteredProjectedToDate: null }
        }

        const storeRows = selectedStore === 'all'
            ? data.rawRows
            : data.rawRows.filter((r: any) => {
                const rawName = r.storeName || t('sales.unknown_store')
                return rawName === selectedStore || r.storeId === selectedStore || formatStoreName(rawName).toLowerCase().trim() === formatStoreName(selectedStore).toLowerCase().trim()
            })

        const resolvedTime = timeFilter === 'custom' ? `${customHourStart}-${customHourEnd}` : timeFilter
        const filteredRows = filterAndRedistributeRows(storeRows, data.groupByMode, dayOfWeekFilter, resolvedTime)
        const reprocessed = processData(filteredRows, data.groupByMode, startDate)
        const sumProjToDate = reprocessed.storeData.reduce((acc: number, s: any) => acc + Number(s.projectedToDate || 0), 0)

        return {
            filteredSummary: reprocessed.summary,
            filteredTrendData: reprocessed.trendData,
            filteredProjectedToDate: sumProjToDate > 0 ? sumProjToDate : null,
        }
    }, [data, selectedStore, startDate, dayOfWeekFilter, timeFilter, customHourStart, customHourEnd])

    // 🍽️ FILTERED FOOD COST: Recompute food cost for selected store (hidden when sub-day/weekday filter is active to avoid invalid Prime Cost)
    const filteredFoodCost = useMemo(() => {
        if (dayOfWeekFilter !== null || timeFilter !== 'all') return null
        if (!foodCostData || foodCostLoading) {
            return foodCostLoading ? { totalCost: 0, costPercentage: 0, loading: true } : null
        }

        if (selectedStore !== 'all') {
            const matchedStore = data?.storeData?.find((s: any) =>
                s.storeId === selectedStore ||
                s.storeName === selectedStore ||
                s.name === selectedStore ||
                formatStoreName(s.storeName || s.name || '').toLowerCase().trim() === formatStoreName(selectedStore).toLowerCase().trim()
            )
            const storeFC = getValidStoreFC(matchedStore?.storeId || selectedStore, matchedStore?.storeName || selectedStore)
            if (storeFC) {
                return {
                    totalCost: storeFC.totalCost,
                    costPercentage: storeFC.costPercentage,
                    totalPackagingCost: storeFC.totalPackagingCost ?? 0,
                    packagingPercentage: storeFC.packagingPercentage ?? 0,
                    loading: false
                }
            }
            return null
        }

        if (foodCostData.totalCost <= 0 || foodCostData.costPercentage <= 0) return null
        return {
            totalCost: foodCostData.totalCost,
            costPercentage: foodCostData.costPercentage,
            totalPackagingCost: foodCostData.totalPackagingCost ?? 0,
            packagingPercentage: foodCostData.packagingPercentage ?? 0,
            loading: false
        }
    }, [foodCostData, foodCostLoading, selectedStore, data?.storeData, dayOfWeekFilter, timeFilter])

    // CSV Export Handler (sanitized anti-formula-injection, UTF-8 BOM, i18n headers, aligned Difference + Food Cost %)
    const handleExportCSV = () => {
        if (!sortedStoreData || sortedStoreData.length === 0) return
        const headers = [
            escapeCsvCell(t('sales.store')),
            escapeCsvCell(t('sales.table.proj_to_date')),
            escapeCsvCell(t('sales.table.actual')),
            escapeCsvCell(t('sales.table.projected_col')),
            escapeCsvCell(t('sales.table.variance')),
            escapeCsvCell(t('sales.orders')),
            escapeCsvCell(t('sales.avg_ticket')),
            escapeCsvCell(t('sales.labor_pct')),
            escapeCsvCell(t('sales.labor_cost_legend')),
            escapeCsvCell(t('sales.food_label')),
        ]
        const rows = sortedStoreData.map((s: any) => {
            const amt = Number(s.amount || s.netSales || 0)
            const orders = Number(s.orderCount || 0)
            const avgTicket = orders > 0 ? amt / orders : 0
            const projToDate = Number(s.projectedToDate || 0)
            const projFull = Number(s.projectedSales || 0)
            const diffBase = isActivePeriod ? projToDate : projFull
            const storeFC = getValidStoreFC(s.storeId, s.storeName || s.name)
            return [
                escapeCsvCell(formatStoreName(s.name || s.storeName)),
                projToDate.toFixed(2),
                amt.toFixed(2),
                projFull.toFixed(2),
                (amt - diffBase).toFixed(2),
                orders,
                avgTicket.toFixed(2),
                Number(s.laborPercentage || 0).toFixed(2),
                Number(s.laborCost || 0).toFixed(2),
                storeFC ? storeFC.costPercentage.toFixed(1) : '',
            ]
        })
        const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', `ventas_${startDate}_${endDate}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

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

    const timelineData = filteredTrendData || []

    return (
        <div className="min-h-screen bg-transparent text-slate-900 dark:text-white font-sans pb-24">
            <div className="w-full mx-auto px-0 md:px-6 py-4 md:py-8 relative z-10">

                {/* Header Content */}
                <div className="relative z-10 space-y-6">

                    {/* Welcome Modal */}
                    {showWelcomeModal && (
                        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                            <div className="bg-white dark:bg-slate-900 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 relative">
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
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shadow-sm ${connError
                                    ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30'
                                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
                                }`}>
                                    {connError ? t('sales.connection_interrupted') : t('sales.live_connected')}
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
                                        <span>{t('sales.updated')}: {lastUpdated.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                    )}
                                </span>
                                {data?.rawRows?.some((r: any) => r.projectionMeta) && (
                                    <div className="w-full md:w-auto flex flex-col md:flex-row md:items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-xl md:rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium shadow-sm md:ml-1 mt-1 md:mt-0 max-w-full">
                                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                                            <TrendingUp size={14} className="shrink-0 mt-0.5 md:mt-0" />
                                            <span className={`min-w-0 break-words ${showMobileFormula ? '' : 'line-clamp-2 md:line-clamp-none'}`}>
                                            {(() => {
                                                let targetRows = data.rawRows;
                                                if (selectedStore !== 'all') {
                                                    const normSel = formatStoreName(selectedStore).toLowerCase().trim()
                                                    targetRows = targetRows.filter((r: any) =>
                                                        r.storeName === selectedStore ||
                                                        r.name === selectedStore ||
                                                        r.storeId === selectedStore ||
                                                        formatStoreName(r.storeName || r.name || '').toLowerCase().trim() === normSel
                                                    );
                                                }
                                                const projectionFingerprint = (r: any) => {
                                                    // In hourly mode, midnight–5:59 AM belongs to the selected
                                                    // business day, even though periodStart has next calendar date.
                                                    const date = data.groupByMode === 'hour'
                                                        ? startDate
                                                        : String(r.periodStart || startDate).slice(0, 10);
                                                    const meta = r.projectionMeta || {};
                                                    // Toast can expose the same store through two identifiers. V3.1
                                                    // metadata is identical for both rows, so it is the stable identity.
                                                    if (meta.model === 'Intelligence v3.1') {
                                                        return `${date}|${Number(r.projectedSales || 0).toFixed(4)}|${Number(meta.base_tickets || 0).toFixed(4)}|${Number(meta.avg_check_used || 0).toFixed(4)}`;
                                                    }
                                                    return `${date}|${r.storeId || r.storeName || r.name}`;
                                                };
                                                const uniqueProjectionRows = new Map<string, any>();
                                                targetRows.filter((r: any) => r.projectionMeta).forEach((r: any) => {
                                                    const key = projectionFingerprint(r);
                                                    if (!uniqueProjectionRows.has(key)) uniqueProjectionRows.set(key, r);
                                                });
                                                const rowsWithMeta = Array.from(uniqueProjectionRows.values());
                                                if (rowsWithMeta.length === 0) {
                                                    return (
                                                        <>
                                                            <strong>{t('sales.projection.title')}:</strong> {t('sales.projection.calculated_using')}{t('sales.projection.last_year_sales_fallback')}
                                                        </>
                                                    );
                                                }
                                                
                                                let totalBase = 0;
                                                let sumGrowth = 0;
                                                let countGrowth = 0;
                                                let hasWeather = false;
                                                let weatherPenalty = 0;
                                                let totalTickets = 0;
                                                let sumAvgCheck = 0;
                                                let countAvgCheck = 0;
                                                let sumTicketGrowth = 0;
                                                let countTicketGrowth = 0;
                                                let maxEventMult = 1.0;
                                                let isV3 = false;
                                                let confidenceLow = 0;
                                                let confidenceHigh = 0;
                                                let totalEventBoostDollars = 0;
                                                const storesWithEvents: string[] = [];
                                                const detectedEvents: string[] = [];
                                                
                                                rowsWithMeta.forEach((r: any) => {
                                                    const m = r.projectionMeta;
                                                    if (m.model === 'Intelligence v3.1' && m.base_tickets && Number(m.base_tickets) > 0) {
                                                        totalTickets += Number(m.base_tickets);
                                                        isV3 = true;
                                                    }
                                                    if (m.avg_check_used && Number(m.avg_check_used) > 0) {
                                                        const wTickets = Number(m.base_tickets || 0)
                                                        sumAvgCheck += wTickets > 0 ? Number(m.avg_check_used) * wTickets : Number(m.avg_check_used)
                                                        countAvgCheck += wTickets > 0 ? wTickets : 1
                                                    }
                                                    if (m.ticket_growth_factor) {
                                                        sumTicketGrowth += (Number(m.ticket_growth_factor) - 1) * 100;
                                                        countTicketGrowth++;
                                                    }
                                                    if (m.holiday_multiplier && Number(m.holiday_multiplier) > 1.0) {
                                                        const storeMult = Number(m.holiday_multiplier);
                                                        if (storeMult > maxEventMult) {
                                                            maxEventMult = storeMult;
                                                        }
                                                        const storeBase = Number(m.base_sales) || (Number(r.projectedSales) / storeMult);
                                                        totalEventBoostDollars += storeBase * (storeMult - 1);
                                                        const storeName = r.storeName || '';
                                                        if (storeName && !storesWithEvents.includes(storeName)) {
                                                            storesWithEvents.push(storeName);
                                                        }
                                                    }
                                                    if (m.methodology) {
                                                        const match = String(m.methodology).match(/event\(s\):\s*(.+)$/i);
                                                        if (match && match[1]) {
                                                            match[1].split(',').forEach((name: string) => {
                                                                const trimmed = name.trim();
                                                                if (trimmed && !detectedEvents.includes(trimmed)) {
                                                                    detectedEvents.push(trimmed);
                                                                }
                                                            });
                                                        }
                                                    }
                                                    if (m.base_sales) totalBase += m.base_sales;
                                                    if (m.growth_factor) {
                                                        sumGrowth += (m.growth_factor - 1) * 100;
                                                        countGrowth++;
                                                    }
                                                    if (m.weather_adjusted || (m.weather_factor && Number(m.weather_factor) < 1.0)) {
                                                        hasWeather = true;
                                                        if (m.weather_factor) {
                                                            weatherPenalty = Math.round((1 - Number(m.weather_factor)) * 100);
                                                        }
                                                    }
                                                    if (Number.isFinite(Number(m.confidence_low))) confidenceLow += Number(m.confidence_low);
                                                    if (Number.isFinite(Number(m.confidence_high))) confidenceHigh += Number(m.confidence_high);
                                                });
                                                
                                                let explanation = "";
                                                if (isV3 && totalTickets > 0 && countAvgCheck > 0) {
                                                    const avgCheck = sumAvgCheck / countAvgCheck;
                                                    // Explain the business formula in the same order it is calculated.
                                                    explanation = ` ~${Math.round(totalTickets).toLocaleString()} ${t('sales.projection.expected_guests')} × $${avgCheck.toFixed(2)} ${t('sales.projection.avg_check_label')}`;
                                                    if (countTicketGrowth > 0 && Math.abs(sumTicketGrowth / countTicketGrowth) >= 0.1) {
                                                        const avgTrafficGrowth = sumTicketGrowth / countTicketGrowth;
                                                        explanation += ` (${t('sales.projection.traffic_growth_label')}: ${avgTrafficGrowth >= 0 ? '+' : ''}${avgTrafficGrowth.toFixed(1)}%)`;
                                                    }
                                                    const effectiveEventBoostPct = selectedStore === 'all'
                                                        ? (totalBase > 0 ? (totalEventBoostDollars / totalBase) * 100 : 0)
                                                        : (maxEventMult > 1.0 ? (maxEventMult - 1) * 100 : 0);

                                                    if (effectiveEventBoostPct >= 0.5) {
                                                        const eventNamesLabel = detectedEvents.length > 0
                                                            ? ` (${detectedEvents.slice(0, 2).join(', ')}${detectedEvents.length > 2 ? ` +${detectedEvents.length - 2}` : ''})`
                                                            : '';
                                                        explanation += ` 🌟 +${effectiveEventBoostPct.toFixed(1)}% ${t('sales.projection.event_boost')}${eventNamesLabel}`;
                                                    } else if (effectiveEventBoostPct >= 0.1 && selectedStore === 'all' && storesWithEvents.length > 0) {
                                                        const localStoreLabel = storesWithEvents.length <= 2 ? storesWithEvents.join(', ') : `${storesWithEvents.length} ${t('sales.stores_count')}`;
                                                        const eventNamesLabel = detectedEvents.length > 0 ? ` (${detectedEvents[0]})` : '';
                                                        explanation += ` 🌟 ${t('sales.local_event_in')} ${localStoreLabel}: +${((maxEventMult - 1) * 100).toFixed(1)}%${eventNamesLabel}`;
                                                    }
                                                    if (hasWeather) {
                                                        explanation += ` 🌧️ -${weatherPenalty || 5}% ${t('sales.projection.weather_adjusted_label')}`;
                                                    }
                                                } else {
                                                    if (totalBase > 0) {
                                                        explanation += ` ${t('sales.projection.base_of')} $${totalBase.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
                                                    } else {
                                                        explanation += ` ${t('sales.projection.the_sales')}`;
                                                    }
                                                    
                                                    const d = new Date(startDate + 'T12:00:00');
                                                    d.setDate(d.getDate() - 364);
                                                    const lastYearStr = d.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', { 
                                                        weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' 
                                                    });
                                                    
                                                    explanation += ` ${t('sales.projection.last_year_same_day')} (${lastYearStr})`;
                                                    
                                                    if (countGrowth > 0) {
                                                        const avgGrowth = sumGrowth / countGrowth;
                                                        explanation += `${t('sales.projection.adjusted_trend')}${avgGrowth > 0 ? '+' : ''}${avgGrowth.toFixed(1)}%)`;
                                                    }
                                                    if (hasWeather) {
                                                        explanation += `${t('sales.projection.weather_penalty')}`;
                                                    }
                                                }
                                                
                                                const uniqueStoreProjs = new Map<string, number>()
                                                targetRows.forEach((r: any) => {
                                                    const key = projectionFingerprint(r);
                                                    if (!uniqueStoreProjs.has(key)) {
                                                        uniqueStoreProjs.set(key, r.projectedSales || 0)
                                                    }
                                                })
                                                const totalProj = Array.from(uniqueStoreProjs.values()).reduce((sum, v) => sum + v, 0);
                                                if (totalProj > 0) {
                                                    explanation += ` ${t('sales.projection.total_projected')}: $${totalProj.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}.`;
                                                    if (confidenceLow > 0 && confidenceHigh >= confidenceLow) {
                                                        explanation += ` ${t('sales.projection.operating_range')}: $${confidenceLow.toLocaleString('en-US', {maximumFractionDigits: 0})}–$${confidenceHigh.toLocaleString('en-US', {maximumFractionDigits: 0})}.`;
                                                    }
                                                } else {
                                                    explanation += ".";
                                                }
                                                
                                                return (
                                                    <>
                                                        <strong>{isV3 ? t('sales.projection.guest_centric_title') : t('sales.projection.title')}:</strong>{isV3 ? explanation : ` ${t('sales.projection.calculated_using')}${explanation}`}
                                                    </>
                                                );
                                            })()}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowMobileFormula(prev => !prev)}
                                            className="md:hidden self-start text-[11px] font-bold text-indigo-600 dark:text-indigo-300 underline decoration-indigo-300 underline-offset-2 pl-5"
                                        >
                                            {showMobileFormula ? t('sales.hide_formula') : t('sales.show_formula')}
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                    {t('sales.title')}
                                </h1>
                                <button 
                                    onClick={() => setShowWelcomeModal(true)}
                                    className="p-1.5 text-blue-500 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-full transition-colors cursor-pointer"
                                    title={t('sales.lightning_mode_help')}
                                >
                                    <Info size={18} />
                                </button>
                            </div>
                            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mt-1">
                                {t('sales.subtitle')}
                            </p>
                        </div>

                        {/* Dynamic Date Label & Filter */}
                        <div className="flex flex-wrap items-center justify-center gap-2 bg-white/70 dark:bg-slate-900/80 p-2 md:p-1.5 rounded-2xl border border-black/5 dark:border-slate-800 backdrop-blur-xl shadow-lg shadow-black/5 w-full md:w-auto z-30">

                            <div className="flex items-center justify-center gap-1 mx-1 w-full sm:w-auto">
                                <button 
                                    onClick={() => shiftDate(-1)}
                                    className="p-2 md:p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                                    title={t('sales.prev_day')}
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
                                        // Reset day-of-week filter whenever switching to any single-day view
                                        if (['today', 'yesterday'].includes(p) || s === e) {
                                            setDayOfWeekFilter(null)
                                        }
                                    }}
                                />
                                <button 
                                    onClick={() => shiftDate(1)}
                                    disabled={isTodayOrFuture}
                                    className="p-2 md:p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                    title={t('sales.next_day')}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Store Filter */}
                            {storeList.length > 0 && (
                                <div className="relative min-w-0 flex-1 sm:flex-none basis-[160px] sm:basis-auto">
                                    <select
                                        value={selectedStore}
                                        onChange={(e) => setSelectedStore(e.target.value)}
                                        className="appearance-none pl-8 pr-8 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-base md:text-xs font-medium transition-colors border border-black/5 dark:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/50 w-full sm:min-w-[180px] sm:w-auto"
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
                                    <div className="relative min-w-0 flex-1 sm:flex-none basis-[145px] sm:basis-auto">
                                        <select
                                            value={dayOfWeekFilter === null ? 'all' : String(dayOfWeekFilter)}
                                            onChange={(e) => setDayOfWeekFilter(e.target.value === 'all' ? null : Number(e.target.value))}
                                            disabled={!isMultiDay}
                                            className={`appearance-none pl-8 pr-8 py-2 rounded-xl text-base md:text-xs font-medium transition-colors border cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50 w-full sm:w-auto ${
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
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0 w-full sm:w-auto">
                                <div className="relative flex-1 sm:flex-none min-w-0">
                                    <select
                                        value={timeFilter}
                                        onChange={(e) => {
                                            const val = e.target.value
                                            if (val === 'custom') {
                                                setTimeFilter('custom')
                                            } else {
                                                setTimeFilter(val)
                                            }
                                        }}
                                        className={`appearance-none pl-8 pr-8 py-2 rounded-xl text-base md:text-xs font-medium transition-colors border cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50 w-full sm:w-auto ${
                                            timeFilter !== 'all'
                                                ? 'bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-500/30'
                                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-black/5 dark:border-slate-700'
                                        }`}
                                    >
                                        <option value="all">{t('sales.time_filter.all_hours')}</option>
                                        <option value="6-11">{t('sales.time_filter.breakfast')}</option>
                                        <option value="11-16">{t('sales.time_filter.lunch')}</option>
                                        <option value="16-23">{t('sales.time_filter.dinner')}</option>
                                        <option value="23-6">{t('sales.time_filter.late_night')}</option>
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
                                            className="appearance-none px-2 py-2 rounded-lg text-base md:text-xs font-medium bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-500/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50"
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
                                            className="appearance-none px-2 py-2 rounded-lg text-base md:text-xs font-medium bg-fuchsia-50 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-200 dark:border-fuchsia-500/30 cursor-pointer focus:outline-none focus:ring-2 focus:ring-fuchsia-500/50"
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

                            <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => router.push('/ventas/historial')}
                                    className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 transition-colors border border-black/5 dark:border-slate-700 shrink-0 min-h-[38px]"
                                    title={t('sales.history')}
                                >
                                    <Clock size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    <span className="text-[11px] sm:text-xs font-medium">{t('sales.history')}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => router.push('/ventas/reportes')}
                                    className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-700 dark:text-slate-300 transition-colors border border-black/5 dark:border-slate-700 shrink-0 min-h-[38px]"
                                    title={t('sales.reports')}
                                >
                                    <ClipboardList size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    <span className="text-[11px] sm:text-xs font-medium">{t('sales.reports')}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => refreshData(true)}
                                    disabled={loading || isLiveSyncing}
                                    className={`p-2 min-h-[38px] min-w-[38px] flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors border border-black/5 dark:border-slate-700 shrink-0 ${isLiveSyncing ? 'opacity-70 cursor-wait' : ''}`}
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
                        <SalesCharts
                            trendData={timelineData}
                            period={period}
                            groupByMode={data?.groupByMode}
                            projectedToDateOverride={filteredProjectedToDate}
                            isCurrentPeriodOverride={isActivePeriod}
                        />

                        {/* Table Container (wraps header + mobile cards + desktop table cleanly) */}
                        <div className="bg-white/60 dark:bg-slate-900/50 border border-black/5 dark:border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl shadow-xl shadow-black/5">
                            <div className="px-6 py-4 border-b border-black/5 dark:border-slate-800 flex justify-between items-center">
                                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 text-lg">
                                    <Store size={18} className="text-emerald-500" />
                                    {t('sales.detail_by_store')}
                                </h3>
                                <button
                                    type="button"
                                    onClick={handleExportCSV}
                                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:opacity-80 flex items-center gap-1 uppercase tracking-wider transition-opacity cursor-pointer"
                                >
                                    <Download size={14} /> {t('sales.export_csv')}
                                </button>
                            </div>

                        {/* Mobile Card View (Visible ONLY on small screens) */}
                        <div className="md:hidden flex flex-col gap-3 p-3 sm:p-4 bg-slate-50/50 dark:bg-slate-900/20">
                            {sortedStoreData.length > 0 && (
                                <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-800 px-3 py-2 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-xs">
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0 flex items-center gap-1">
                                        <ArrowUpDown size={13} /> {t('sales.sort_by')}
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                                        <select
                                            value={sortConfig?.key || 'amount'}
                                            onChange={(e) => setSortConfig({ key: e.target.value, direction: sortConfig?.direction || 'desc' })}
                                            className="bg-slate-100 dark:bg-slate-700/60 text-slate-800 dark:text-slate-200 rounded-xl px-2.5 py-1.5 text-base sm:text-xs font-bold border border-slate-200 dark:border-slate-600 focus:outline-none min-w-0 max-w-[180px]"
                                        >
                                            <option value="amount">{t('sales.sales_label')}</option>
                                            {isActivePeriod && <option value="projectedToDate">{t('sales.table.proj_to_date')}</option>}
                                            <option value="projectedSales">{t('sales.table.projected_col')}</option>
                                            <option value="diff">{t('sales.variance_short')}</option>
                                            <option value="orderCount">{t('sales.orders_label')}</option>
                                            <option value="avgTicket">{t('sales.ticket_label')}</option>
                                            <option value="laborPercentage">{t('sales.labor_label')}</option>
                                            {!isSubDayOrDowFiltered && foodCostData?.byStore && Object.keys(foodCostData.byStore).length > 0 && (
                                                <option value="foodCostPct">{t('sales.food_label')}</option>
                                            )}
                                            <option value="name">{t('sales.store')} (A–Z)</option>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => setSortConfig(prev => ({ key: prev?.key || 'amount', direction: prev?.direction === 'asc' ? 'desc' : 'asc' }))}
                                            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 active:scale-95 transition-transform"
                                            aria-label={t('sales.table.toggle_sort')}
                                        >
                                            {sortConfig?.direction === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {sortedStoreData.length === 0 && (
                                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                    {t('sales.table.no_store_data')}
                                </div>
                            )}

                            {sortedStoreData.map((store: any, idx: number) => {
                                const actualOrders = Number(store.orderCount || 0)
                                const storeAmount = Number(store.amount || 0)
                                const avgTicket = actualOrders > 0 ? storeAmount / actualOrders : 0
                                const laborPct = Number(store.laborPercentage || 0).toFixed(2)
                                const storeFC = getValidStoreFC(store.storeId, store.storeName || store.name)
                                const fcPct = storeFC ? storeFC.costPercentage : null
                                const projToDateVal = Number(store.projectedToDate || 0)
                                const projectedTotal = Number(store.projectedSales || 0)
                                const baselineProj = isActivePeriod ? projToDateVal : projectedTotal
                                const varianceVal = storeAmount - baselineProj

                                return (
                                    <div
                                        key={store.storeId || store.name || idx}
                                        onClick={() => handleStoreClick(store.storeId)}
                                        className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col gap-3 cursor-pointer hover:ring-2 hover:ring-emerald-500/30 transition-all active:scale-[0.98]"
                                    >
                                        <div className="flex flex-wrap justify-between items-start gap-x-2 gap-y-1.5 border-b border-slate-100 dark:border-slate-700 pb-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-slate-400 font-mono text-xs font-bold shrink-0">#{idx + 1}</span>
                                                <h4 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg leading-tight break-words min-w-0">
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
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            window.open(`/admin/food-cost?store=${encodeURIComponent(store.storeId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, '_blank', 'noopener,noreferrer')
                                                        }}
                                                        className={`px-2 py-0.5 rounded-md text-xs font-bold underline decoration-dotted underline-offset-2 ${fcPct <= FOOD_COST_HEALTHY_MAX
                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                                            : fcPct > FOOD_COST_WARNING_MAX
                                                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                                                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                                                            }`}
                                                    >
                                                        {t('sales.food_label')}: {fcPct.toFixed(1)}%{storeFC && (storeFC.packagingPercentage ?? 0) > 0 ? ` (+${storeFC.packagingPercentage!.toFixed(1)}% ${t('sales.summary.packaging_sub')})` : ''}
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* FitValue: cada cifra se autoajusta a su columna (nunca se sale del cuadro) */}
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider truncate">{t('sales.sales_label')}</span>
                                                <FitValue
                                                    text={formatSignedUSD(storeAmount, { decimals: 0 })}
                                                    maxPx={18}
                                                    minPx={12}
                                                    className="text-emerald-600 dark:text-emerald-400 font-bold"
                                                />
                                            </div>
                                            <div className="flex flex-col min-w-0 border-l border-slate-100 dark:border-slate-700 pl-2">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider text-center truncate">{t('sales.orders_label')}</span>
                                                <FitValue
                                                    text={actualOrders.toLocaleString('en-US')}
                                                    maxPx={16}
                                                    minPx={12}
                                                    className="text-slate-700 dark:text-slate-300 font-semibold text-center"
                                                />
                                            </div>
                                            <div className="flex flex-col min-w-0 border-l border-slate-100 dark:border-slate-700 pl-2">
                                                <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider text-right truncate">{t('sales.ticket_label')}</span>
                                                <FitValue
                                                    text={formatSignedUSD(avgTicket, { decimals: 2 })}
                                                    maxPx={16}
                                                    minPx={12}
                                                    className="text-slate-500 dark:text-slate-400 font-medium text-right"
                                                />
                                            </div>
                                        </div>

                                        {/* Projected & Variance Strip (Matching Desktop Table including Proj. to Date) */}
                                        {(projectedTotal > 0 || baselineProj > 0) && (
                                            <div className={`grid ${isActivePeriod ? 'grid-cols-3' : 'grid-cols-2'} gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/70 text-xs`}>
                                                {isActivePeriod && (
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-[9px] uppercase font-bold text-cyan-600/80 dark:text-cyan-400/80 truncate">{t('sales.table.proj_to_date')}</span>
                                                        <span className="font-mono font-bold truncate text-cyan-600 dark:text-cyan-400">
                                                            {formatSignedUSD(projToDateVal, { decimals: 0 })}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex flex-col min-w-0 ${isActivePeriod ? 'border-l border-slate-100 dark:border-slate-700 pl-2' : ''}`}>
                                                    <span className="text-[9px] uppercase font-bold text-slate-400 truncate">{t('sales.table.projected_col')}</span>
                                                    <span
                                                        className={`font-mono font-bold truncate inline-flex items-center gap-1 ${(store.manualOverride || store.manualOverrideDays > 0) ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`}
                                                        title={(store.manualOverride || store.manualOverrideDays > 0) ? `${t('sales.table.manual_override_tooltip')} (${t('sales.table.ai_original')}: ${formatSignedUSD(Math.round(Number(store.aiBaseSales || 0)), { decimals: 0 })})` : undefined}
                                                    >
                                                        {(store.manualOverride || store.manualOverrideDays > 0) && <Lock size={11} className="shrink-0" />}
                                                        {formatSignedUSD(projectedTotal, { decimals: 0 })}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col items-end min-w-0 border-l border-slate-100 dark:border-slate-700 pl-2">
                                                    <span className="text-[9px] uppercase font-bold text-slate-400 truncate">{t('sales.variance_short')}</span>
                                                    <span className={`font-mono font-bold truncate ${Math.round(varianceVal) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {formatSignedUSD(varianceVal, { decimals: 0, showPlus: true })}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        {/* Desktop Table View (Hidden on mobile) */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm lg:text-base text-left">
                                <thead className="bg-slate-100 dark:bg-slate-950/50 text-slate-700 dark:text-slate-400 text-[10px] lg:text-xs uppercase font-semibold tracking-wider lg:tracking-widest border-b border-black/5 dark:border-slate-800">
                                    <tr>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 w-12 text-center">#</th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('name')}>
                                            <div className="flex items-center gap-1">
                                                {t('sales.store')}
                                                {sortConfig?.key === 'name' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        {isActivePeriod && (
                                            <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedToDate')}>
                                                <div className="flex items-center justify-end gap-1 text-cyan-500">
                                            {t('sales.table.proj_to_date')}
                                                    {sortConfig?.key === 'projectedToDate' ? (
                                                        sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                    ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                                </div>
                                            </th>
                                        )}
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('amount')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.table.actual')}
                                                {sortConfig?.key === 'amount' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-emerald-500" /> : <ChevronDown size={14} className="text-emerald-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('projectedSales')}>
                                            <div className="flex items-center justify-end gap-1 text-indigo-500">
                                                {t('sales.table.projected_col')}
                                                {sortConfig?.key === 'projectedSales' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('diff')}>
                                            <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                                                {t('sales.table.variance')}
                                                {sortConfig?.key === 'diff' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                            </div>
                                        </th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('orderCount')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.orders')}
                                                {sortConfig?.key === 'orderCount' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('avgTicket')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.avg_ticket')}
                                                {sortConfig?.key === 'avgTicket' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('laborPercentage')}>
                                            <div className="flex items-center justify-end gap-1">
                                                {t('sales.labor_pct')}
                                                {sortConfig?.key === 'laborPercentage' ? (
                                                    sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-indigo-500" /> : <ChevronDown size={14} className="text-indigo-500" />
                                                ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30" />}
                                            </div>
                                        </th>
                                        {!isSubDayOrDowFiltered && foodCostData?.byStore && Object.keys(foodCostData.byStore).length > 0 && (
                                            <th className="px-2.5 py-3 lg:px-6 lg:py-4 text-right cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors group" onClick={() => requestSort('foodCostPct')}>
                                                <div className="flex items-center justify-end gap-1 text-teal-600 dark:text-teal-400">
                                                    {t('sales.food_label')}
                                                    {sortConfig?.key === 'foodCostPct' ? (
                                                        sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                    ) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-30 text-slate-400" />}
                                                </div>
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5 dark:divide-slate-800">
                                    {sortedStoreData.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                                                {t('sales.table.no_store_data')}
                                            </td>
                                        </tr>
                                    )}
                                    {sortedStoreData.map((store: any, idx: number) => {
                                        const storeAmount = Number(store.amount || 0)
                                        const actualOrders = Number(store.orderCount || 0)
                                        const avgTicket = actualOrders > 0 ? storeAmount / actualOrders : 0
                                        const laborPct = Number(store.laborPercentage || 0).toFixed(2)
                                        const diffVal = storeAmount - (isActivePeriod ? Number(store.projectedToDate || 0) : Number(store.projectedSales || 0))
                                        const isSelectedRow = selectedStore !== 'all' && (
                                            store.storeId === selectedStore ||
                                            store.storeName === selectedStore ||
                                            store.name === selectedStore ||
                                            formatStoreName(store.storeName || store.name || '').toLowerCase().trim() === formatStoreName(selectedStore).toLowerCase().trim()
                                        )

                                        return (
                                            <tr
                                                key={store.storeId || store.name || idx}
                                                onClick={() => handleStoreClick(store.storeId)}
                                                className={`hover:bg-black/5 dark:hover:bg-white/5 transition-colors group cursor-pointer ${isSelectedRow ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : ''}`}
                                            >
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-center text-slate-400 font-mono text-sm">
                                                    {idx + 1}
                                                </td>
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 font-semibold text-slate-900 dark:text-white text-sm lg:text-lg">
                                                    {formatStoreName(store.name || store.storeName)}
                                                </td>
                                                {isActivePeriod && (
                                                    <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right text-cyan-600 dark:text-cyan-400 font-mono font-bold text-sm lg:text-lg whitespace-nowrap">
                                                        <MoneyCell value={Number(store.projectedToDate || 0)} />
                                                    </td>
                                                )}
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right text-emerald-600 dark:text-emerald-400 font-mono font-bold text-sm lg:text-lg whitespace-nowrap">
                                                    <MoneyCell value={storeAmount} />
                                                </td>
                                                <td
                                                    className={`px-2.5 py-3 lg:px-6 lg:py-4 text-right font-mono font-bold text-sm lg:text-lg whitespace-nowrap ${(store.manualOverride || store.manualOverrideDays > 0) ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-500 dark:text-indigo-400'}`}
                                                    title={(store.manualOverride || store.manualOverrideDays > 0) ? `${t('sales.table.manual_override_tooltip')}${store.overriddenBy ? ` ${t('sales.table.manual_override_by')} ${store.overriddenBy}` : ''} (${t('sales.table.ai_original')}: ${formatSignedUSD(Math.round(Number(store.aiBaseSales || 0)), { decimals: 0 })})` : undefined}
                                                >
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        {(store.manualOverride || store.manualOverrideDays > 0) && <Lock size={13} className="shrink-0" />}
                                                        <MoneyCell value={Number(store.projectedSales || 0)} />
                                                    </span>
                                                </td>
                                                <td className={`px-2.5 py-3 lg:px-6 lg:py-4 text-right font-mono font-bold text-sm lg:text-lg whitespace-nowrap ${Math.round(diffVal * 100) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    <MoneyCell
                                                        value={diffVal}
                                                        prefix={Math.round(diffVal * 100) >= 0 ? '+' : ''}
                                                    />
                                                </td>
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right text-slate-700 dark:text-white font-medium">
                                                    {actualOrders.toLocaleString('en-US')}
                                                </td>
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right text-slate-500 dark:text-slate-300">
                                                    {formatSignedUSD(avgTicket, { decimals: 2 })}
                                                </td>
                                                <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right">
                                                    <span className={`px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg font-bold text-sm lg:text-lg inline-flex items-center gap-1 ${Number(laborPct) < 21.5
                                                        ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                        : Number(laborPct) > 23
                                                            ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 animate-pulse'
                                                            : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                                        }`}>
                                                        {laborPct}%
                                                    </span>
                                                </td>
                                                {!isSubDayOrDowFiltered && foodCostData?.byStore && Object.keys(foodCostData.byStore).length > 0 && (
                                                    <td className="px-2.5 py-3 lg:px-6 lg:py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                        {(() => {
                                                            const storeFC = getValidStoreFC(store.storeId, store.storeName || store.name)
                                                            if (!storeFC) {
                                                                return <span className="text-slate-400 text-sm">—</span>
                                                            }
                                                            const fcPct = storeFC.costPercentage
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => window.open(`/admin/food-cost?store=${encodeURIComponent(store.storeId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, '_blank', 'noopener,noreferrer')}
                                                                    className={`px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg font-bold text-sm lg:text-lg inline-flex items-center gap-1 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-teal-400/50 transition-all ${
                                                                    fcPct <= FOOD_COST_HEALTHY_MAX
                                                                        ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                                        : fcPct > FOOD_COST_WARNING_MAX
                                                                            ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                                            : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                                                }`}
                                                                    title={(storeFC.packagingPercentage ?? 0) > 0 ? `${t('sales.summary.packaging_sub')}: ${storeFC.packagingPercentage!.toFixed(1)}%` : undefined}
                                                                >
                                                                    <span>{fcPct.toFixed(1)}%</span>
                                                                    {(storeFC.packagingPercentage ?? 0) > 0 && (
                                                                        <span className="text-[10px] font-semibold opacity-75">+{storeFC.packagingPercentage!.toFixed(1)}%</span>
                                                                    )}
                                                                </button>
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
                    </div>
                )}
            </div>
        </div>
    )
}

export default function SalesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin', 'supervisor', 'manager']}>
            <Suspense fallback={<SurpriseLoader />}>
                <SalesPageContent />
            </Suspense>
        </ProtectedRoute>
    )
}
