/**
 * @module ventas/reportes/page
 * @description Weekly Operations Report, DSR Labor Log, and Monthly Sales Dashboard for Tacos Gavilan stores.
 * @businessRules
 * - Business day runs 6:00 AM to 5:59 AM next day in America/Los_Angeles.
 * - AM Shift (Apertura) spans 6:00 AM to 4:59 PM (hours 6..16 LA).
 * - PM Shift (Cierre) spans 5:00 PM to 5:59 AM next day (hours 17..23, 0..5 LA).
 * - Inverse color rules for Labor % and Hours differences: negative is green (savings) and positive is red (over-budget).
 * - All weekly and monthly percentages/averages (Labor %, Avg Order, SOS Time) use true weighted ratios (sum/sum), never simple means.
 * - sales_daily_cache stores Drive-Thru car count in guest_count and SOS seconds in ebt_count; EBT dollars live strictly in ebt_amount.
 * @dataFlow
 * - Client -> GET /api/reports/weekly-ops & paginated sales_daily_cache -> Operations Grid, Labor Log, & Monthly Reports.
 * @notes
 * - 2026-11-23 Deep Audit Fix: Wrapped hooks inside ProtectedRoute, removed 145 lines of dead calculateWeekStats & dead handleAutoFill,
 *   fixed UTC/DST preset & month shifts, fixed America/Los_Angeles AM/PM punch/leader windows, fixed weighted Labor % / Avg Order / SOS Time,
 *   stopped SOS seconds (ebt_count) from leaking into EBT column, fixed Monthly Footer Avg Order dead branch, added cross-month Sunday Week Sales,
 *   ignored pre-seeded $0 future rows, fixed AbortController & error banners, added formula-safe CSV Export & Print, and full ES/EN i18n.
 */
'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { FileText, Calendar, Store, Calculator, Clock, Download, Printer, AlertCircle } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useSmartProjections } from '@/app/planificador/hooks/useSmartProjections'
import { useLanguage } from '@/lib/i18n'
import {
    getBusinessDateLA,
    getLANowParts,
    getMondayIso,
    addDaysIso,
    buildLAInstant,
    formatSignedUSD,
    escapeCsvCell
} from '@/lib/inventory/food-cost-sales-resolver'

// 1. STRUCTURE DEFINITION (Matches Excel Rows)
const REPORT_STRUCTURE = [
    { id: 'section_sales', label: 'Ventas', type: 'header' },
    { id: 'projected_sales', label: 'Projected Sales', type: 'currency' },
    { id: 'actual_sales', label: 'Actual Sales (TOAST)', type: 'currency', autoFill: true },
    { id: 'diff_sales', label: '+ or - Sales', type: 'currency', computed: true, isDiff: true },

    { id: 'section_hours', label: 'Horas', type: 'header' },
    { id: 'scheduled_hours', label: 'Total Scheduled Hours', type: 'number' },
    { id: 'actual_hours', label: 'Actual Hours (DSR)', type: 'number' },
    { id: 'diff_hours', label: '+ or - Hours', type: 'number', computed: true, isDiff: true, inverseColor: true }, // Negative is Green (Under budget)
    { id: 'overtime_hours', label: 'Over Time Hrs', type: 'number' },

    { id: 'section_kpi', label: 'KPIs', type: 'header' },
    { id: 'target_avg_order', label: 'Target Avg Order', type: 'currency' },
    { id: 'actual_avg_order', label: 'Actual Avg Order', type: 'currency' },
    { id: 'diff_avg_order', label: 'Avg Order + or -', type: 'currency', computed: true, isDiff: true },

    { id: 'section_labor', label: 'Labor %', type: 'header' },
    { id: 'projected_labor', label: 'Projected Labor %', type: 'percent' },
    { id: 'actual_labor', label: 'Actual Labor %', type: 'percent', autoFill: true },
    { id: 'diff_labor', label: '+ or - LABOR', type: 'percent', computed: true, isDiff: true, inverseColor: true }, // Positive is Bad (Red)

    { id: 'section_ops', label: 'Operaciones', type: 'header' },
    { id: 'daily_cars', label: 'Daily Cars', type: 'number' },
    { id: 'sos_time', label: 'SOS Time', type: 'time' }, // "3:29"
    { id: 'morning_leader', label: 'Morning Leader', type: 'text' },
    { id: 'late_leader', label: 'Late Leader', type: 'text' },
]


const MONTHLY_STRUCTURE = [
    { id: 'date', label: 'DATE', type: 'date', width: '100px' },
    { id: 'actual_sales', label: 'SALE', type: 'currency', width: '120px' },
    { id: 'open_sales', label: 'OPEN', type: 'currency', width: '100px' },
    { id: 'close_sales', label: 'CLOSE', type: 'currency', width: '100px' },
    { id: 'actual_avg_order', label: 'Order', type: 'currency', width: '100px' },
    { id: 'uber_post', label: 'Uber/Post', type: 'currency', width: '100px' },
    { id: 'doordash', label: 'Doordash', type: 'currency', width: '100px' },
    { id: 'grubhub', label: 'Grubhub', type: 'currency', width: '100px' },
    { id: 'ebt', label: 'EBT', type: 'currency', width: '80px' },
    { id: 'daily_cars', label: 'CARS', type: 'number', width: '80px' },
    { id: 'sos_time', label: 'TIME', type: 'time', width: '80px' },
    { id: 'week_sales', label: 'Week SALES', type: 'currency', width: '120px' },
]

const DAYS = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
]

function formatSosSeconds(sec: number): string {
    const rounded = Math.round(sec)
    if (!Number.isFinite(rounded) || rounded <= 0) return ''
    const m = Math.floor(rounded / 60)
    const s = rounded % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

function getIsoWeekdayUTC(isoDate: string): number {
    const [y, m, d] = isoDate.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function formatUsDateFromIso(isoDate: string): string {
    const [y, m, d] = isoDate.split('-')
    if (!y || !m || !d) return isoDate
    return `${m}/${d}/${y}`
}

function getMonthStartIso(year: number, month1Based: number): string {
    return `${year}-${String(month1Based).padStart(2, '0')}-01`
}

function getPreviousMonthStartIso(businessDateIso: string): string {
    const [y, m] = businessDateIso.split('-').map(Number)
    if (m === 1) return getMonthStartIso(y - 1, 12)
    return getMonthStartIso(y, m - 1)
}

function ReportesPageContent() {
    const { t, language } = useLanguage()
    const [loading, setLoading] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    // Config State
    const [selectedStore, setSelectedStore] = useState('')
    const [weekDate, setWeekDate] = useState('') // "YYYY-MM-DD" (Monday for ops/labor, YYYY-MM-01 for monthly)
    const [datePreset, setDatePreset] = useState('')
    const [stores, setStores] = useState<any[]>([])

    // Data State (Grid)
    const [gridData, setGridData] = useState<Record<string, Record<string, any>>>({})
    const [monthlyData, setMonthlyData] = useState<Record<string, any>>({}) // Key: "YYYY-MM-DD"

    // Tab State
    const [activeTab, setActiveTab] = useState<'ops' | 'labor' | 'monthly'>('ops')
    const [laborLogData, setLaborLogData] = useState<any[]>([])

    const weeklyAbortRef = useRef<AbortController | null>(null)
    const monthlyReqIdRef = useRef<number>(0)

    // Load Active Stores Only
    useEffect(() => {
        let cancelled = false
        const loadStores = async () => {
            const supabase = await getSupabaseClient()
            const { data } = await supabase
                .from('stores')
                .select('id, name, external_id, is_active')
                .eq('is_active', true)
                .order('name')
            if (!cancelled && data) setStores(data)
        }
        loadStores()
        return () => { cancelled = true }
    }, [])

    // Memoized Monday string & Date object so useSmartProjections never churns on re-renders
    const mondayIso = useMemo(() => {
        if (!weekDate) return ''
        return getMondayIso(weekDate)
    }, [weekDate])

    const smartProjDate = useMemo(() => {
        const baseIso = mondayIso || getMondayIso(getBusinessDateLA())
        return new Date(baseIso + 'T12:00:00')
    }, [mondayIso])

    const selectedStoreExternalId = useMemo(() => {
        if (!selectedStore || selectedStore === 'all') return undefined
        return stores.find(s => String(s.id) === String(selectedStore))?.external_id
    }, [selectedStore, stores])

    // Initialize empty grid when Store/Week changes
    useEffect(() => {
        if (!weekDate || !selectedStore) return
        const initData: Record<string, Record<string, any>> = {}
        DAYS.forEach((day) => {
            initData[day.key] = {}
            REPORT_STRUCTURE.forEach(row => {
                if (row.type !== 'header') initData[day.key][row.id] = ''
            })
        })
        setGridData(initData)
    }, [selectedStore, weekDate])

    // Client-side Smart Projections fallback (only called if single-store DB cache misses a day)
    const { calculateProjections } = useSmartProjections(selectedStoreExternalId, smartProjDate)


    // Load Weekly Operations & Labor Log data from /api/reports/weekly-ops
    const fetchReport = useCallback(async () => {
        if (!weekDate || !selectedStore || stores.length === 0) return

        // Cancel any in-flight weekly request to prevent race conditions
        if (weeklyAbortRef.current) weeklyAbortRef.current.abort()
        const controller = new AbortController()
        weeklyAbortRef.current = controller

        setLoading(true)
        setErrorMsg(null)
        try {
            let queryId = ''
            if (selectedStore === 'all') {
                queryId = 'all'
            } else {
                const storeObj = stores.find(s => String(s.id) === String(selectedStore))
                if (!storeObj?.external_id) {
                    setLoading(false)
                    return
                }
                queryId = storeObj.external_id
            }

            // Strict pure-UTC Monday -> Sunday dates
            const startStr = getMondayIso(weekDate)
            const endStr = addDaysIso(startStr, 6)
            const lookbackStr = addDaysIso(startStr, -35)

            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const apiUrl = `/api/reports/weekly-ops?storeId=${encodeURIComponent(queryId)}&start=${startStr}&end=${endStr}&lookback=${lookbackStr}`
            const apiResponse = await fetch(apiUrl, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                signal: controller.signal
            })

            if (!apiResponse.ok) {
                throw new Error(`HTTP ${apiResponse.status}`)
            }

            const apiData = await apiResponse.json()
            if (apiData.error) throw new Error(apiData.error)
            if (controller.signal.aborted) return

            const history = Array.isArray(apiData.history) ? apiData.history : []
            const lookbackHistory = Array.isArray(apiData.lookback) ? apiData.lookback : []
            const rawAllShifts = Array.isArray(apiData.shifts) ? apiData.shifts : []
            const shifts = selectedStore === 'all' ? rawAllShifts : rawAllShifts.filter((s: any) => s.store_id === queryId)

            const punchesRaw = Array.isArray(apiData.punches) ? apiData.punches : []
            const employees = Array.isArray(apiData.employees) ? apiData.employees : []
            const jobs = Array.isArray(apiData.jobs) ? apiData.jobs : []
            const budgets = Array.isArray(apiData.budgets) ? apiData.budgets : []
            const projectionsCache = Array.isArray(apiData.projectionsCache) ? apiData.projectionsCache : []
            const apiShiftStats = apiData.shiftStats || {}

            // Required dates (Mon -> Sun) via pure ISO day arithmetic
            const requiredKeys: string[] = Array.from({ length: 7 }, (_, i) => addDaysIso(startStr, i))

            const finalProjections: Record<string, string> = {}

            if (selectedStore === 'all') {
                stores.forEach(store => {
                    const sId = store.external_id
                    if (!sId) return

                    requiredKeys.forEach(dateKey => {
                        let val = 0
                        let foundSrc = 'none'

                        const projCacheRow = projectionsCache.find((p: any) =>
                            p.store_id === sId && p.business_date === dateKey
                        )

                        if (projCacheRow && projCacheRow.total_sales !== null && projCacheRow.total_sales !== undefined && Number(projCacheRow.total_sales) >= 0) {
                            val = Number(projCacheRow.total_sales)
                            foundSrc = 'cache'
                        } else {
                            const budgetRow = budgets.find((b: any) =>
                                b.store_id === sId &&
                                b.sales_projections &&
                                b.sales_projections[dateKey] !== undefined &&
                                b.sales_projections[dateKey] !== ''
                            )

                            if (budgetRow) {
                                const parsed = parseFloat(budgetRow.sales_projections[dateKey])
                                if (Number.isFinite(parsed) && parsed >= 0) {
                                    val = parsed
                                    foundSrc = 'db'
                                }
                            } else {
                                const targetDow = getIsoWeekdayUTC(dateKey)
                                const historyRows = lookbackHistory.filter((h: any) =>
                                    h.store_id === sId &&
                                    h.business_date < startStr &&
                                    getIsoWeekdayUTC(h.business_date) === targetDow &&
                                    Number(h.net_sales) > 100
                                )
                                const recent = historyRows
                                    .sort((a: any, b: any) => String(b.business_date).localeCompare(String(a.business_date)))
                                    .slice(0, 4)

                                if (recent.length > 0) {
                                    const sum = recent.reduce((acc: number, r: any) => acc + (Number(r.net_sales) || 0), 0)
                                    val = sum / recent.length
                                    foundSrc = `avg(${recent.length})`
                                }
                            }
                        }

                        if (val > 0 || foundSrc === 'cache' || foundSrc === 'db') {
                            const current = parseFloat(finalProjections[dateKey] || '0')
                            finalProjections[dateKey] = String(current + val)
                        }
                    })
                })
            } else {
                const mergedDbProjections: Record<string, string> = {}

                projectionsCache.forEach((p: any) => {
                    if (p.total_sales !== null && p.total_sales !== undefined && Number(p.total_sales) >= 0) {
                        mergedDbProjections[p.business_date] = String(p.total_sales)
                    }
                })

                budgets.forEach((b: any) => {
                    if (b.sales_projections) {
                        Object.keys(b.sales_projections).forEach(key => {
                            if (mergedDbProjections[key] === undefined && b.sales_projections[key] !== '') {
                                mergedDbProjections[key] = String(b.sales_projections[key])
                            }
                        })
                    }
                })

                const missingKeys = requiredKeys.filter(key => mergedDbProjections[key] === undefined || mergedDbProjections[key] === '')
                Object.assign(finalProjections, mergedDbProjections)

                if (missingKeys.length > 0 && calculateProjections) {
                    try {
                        const calculated = await calculateProjections()
                        if (controller.signal.aborted) return
                        if (calculated && Object.keys(calculated).length > 0) {
                            missingKeys.forEach(key => {
                                if (calculated[key] !== undefined && calculated[key] !== '' && Number(calculated[key]) >= 0) {
                                    finalProjections[key] = String(calculated[key])
                                }
                            })
                        }
                    } catch (calcError) {
                        console.error('[REPORT] Failed to backfill projections:', calcError)
                    }
                }
            }

            const salesProjections = finalProjections

            // Store Manager detection (single store only — never show random store's manager in 'all' mode)
            let globalManagerName = ''
            if (selectedStore !== 'all') {
                const managerShift = shifts.find((s: any) => {
                    const j = jobs.find((job: any) => job.id === s.job_id)
                    const title = String(j?.title || '').trim().toLowerCase()
                    return (title === 'manager' || title === 'general manager' || title === 'store manager') && !title.includes('asst')
                })
                const managerEmp = managerShift ? employees.find((e: any) => e.id === managerShift.employee_id) : null
                globalManagerName = managerEmp
                    ? (managerEmp.chosen_name || `${managerEmp.first_name || ''} ${managerEmp.last_name || ''}`.trim())
                    : ''
            }

            const newGrid: Record<string, Record<string, any>> = {}
            const weekLaborLog: any[] = []
            const todayLA = getBusinessDateLA()

            DAYS.forEach((day, i) => {
                const dateStr = requiredKeys[i]
                const targetDayIndex = getIsoWeekdayUTC(dateStr)

                // Filter out pre-seeded $0 future cache rows so future days remain blank
                const rawDayHistories = history.filter((h: any) => h.business_date === dateStr)
                const dayHistories = rawDayHistories.filter((h: any) =>
                    Number(h.net_sales || 0) > 0 ||
                    Number(h.labor_hours || 0) > 0 ||
                    Number(h.order_count || 0) > 0 ||
                    Number(h.guest_count || 0) > 0
                )

                // --- LABOR LOG CALCULATION (Exact America/Los_Angeles AM/PM Split) ---
                const hourlySalesSum: Record<string, number> = {}
                dayHistories.forEach((h: any) => {
                    const hourly = h.hourly_data || {}
                    Object.keys(hourly).forEach(k => {
                        hourlySalesSum[k] = (hourlySalesSum[k] || 0) + Number(hourly[k] || 0)
                    })
                })

                let morningSales = 0
                for (let h = 6; h <= 16; h++) morningSales += Number(hourlySalesSum[h] || 0)

                let nightSales = 0
                for (let h = 17; h <= 23; h++) nightSales += Number(hourlySalesSum[h] || 0)
                for (let h = 0; h <= 5; h++) nightSales += Number(hourlySalesSum[h] || 0)

                const dayTotalNetSales = dayHistories.reduce((a: number, b: any) => a + Number(b.net_sales || 0), 0)
                const totalLaborLogSales = (morningSales + nightSales) > 0 ? (morningSales + nightSales) : dayTotalNetSales

                const dayPunches = punchesRaw.filter((p: any) => p.business_date === dateStr)
                let morningLaborCost = 0
                let nightLaborCost = 0

                // Exact PST/PDT windows via buildLAInstant
                const amStart = buildLAInstant(dateStr, 6, 0)
                const amEnd = buildLAInstant(dateStr, 17, 0)
                const pmStart = amEnd
                const pmEnd = buildLAInstant(addDaysIso(dateStr, 1), 6, 0)

                const intersectMs = (s1: Date, e1: Date, s2: Date, e2: Date) => {
                    const s = Math.max(s1.getTime(), s2.getTime())
                    const e = Math.min(e1.getTime(), e2.getTime())
                    return Math.max(0, e - s)
                }

                dayPunches.forEach((p: any) => {
                    const emp = employees.find((e: any) => e.toast_guid === p.employee_toast_guid)
                    const wageEntry = emp?.wage_data?.find((w: any) => w.job_guid === p.job_toast_guid) || emp?.wage_data?.[0]

                    // Priority: punch hourly_wage -> employee wage_data -> CA fast-food $20.00 floor
                    const punchWage = p.hourly_wage !== null && p.hourly_wage !== undefined ? Number(p.hourly_wage) : NaN
                    const empWage = wageEntry?.wage !== null && wageEntry?.wage !== undefined ? Number(wageEntry.wage) : NaN
                    const hourlyRate = Number.isFinite(punchWage) && punchWage > 0
                        ? punchWage
                        : (Number.isFinite(empWage) && empWage > 0 ? empWage : 20.00)

                    const reg = Number(p.regular_hours || 0)
                    const ot = Number(p.overtime_hours || 0)
                    const totalPunchCost = (reg * hourlyRate) + (ot * hourlyRate * 1.5)
                    if (totalPunchCost <= 0) return

                    if (p.clock_in && p.clock_out) {
                        const start = new Date(p.clock_in)
                        const end = new Date(p.clock_out)
                        const totalMs = end.getTime() - start.getTime()
                        if (!Number.isFinite(totalMs) || totalMs <= 0) return

                        const amMs = intersectMs(start, end, amStart, amEnd)
                        const pmMs = intersectMs(start, end, pmStart, pmEnd)
                        const totalIntersect = amMs + pmMs

                        if (totalIntersect > 0) {
                            morningLaborCost += totalPunchCost * (amMs / totalIntersect)
                            nightLaborCost += totalPunchCost * (pmMs / totalIntersect)
                        } else {
                            const startLAHour = getLANowParts(start).hour
                            if (startLAHour >= 6 && startLAHour < 17) morningLaborCost += totalPunchCost
                            else nightLaborCost += totalPunchCost
                        }
                    } else {
                        morningLaborCost += totalPunchCost * 0.5
                        nightLaborCost += totalPunchCost * 0.5
                    }
                })

                const morningPct = morningSales > 0 ? (morningLaborCost / morningSales) * 100 : 0
                const nightPct = nightSales > 0 ? (nightLaborCost / nightSales) * 100 : 0
                const totalPct = totalLaborLogSales > 0 ? ((morningLaborCost + nightLaborCost) / totalLaborLogSales) * 100 : 0

                weekLaborLog.push({
                    date: dateStr,
                    dayKey: day.key,
                    dayLabel: day.label,
                    morning: morningPct.toFixed(2),
                    night: nightPct.toFixed(2),
                    total: totalPct.toFixed(2),
                    morningSales,
                    nightSales,
                    totalSales: totalLaborLogSales,
                    morningLaborCost,
                    nightLaborCost
                })

                // --- OPERATIONS REPORT GRID ---
                const daysShifts = shifts.filter((s: any) => s.shift_date === dateStr)
                let totalSched = 0
                let totalOT = 0
                let totalSchedCost = 0

                daysShifts.forEach((s: any) => {
                    const stat = apiShiftStats[s.id]
                    if (stat) {
                        totalSched += Number(stat.hours || 0)
                        totalOT += Number(stat.otHours || 0)
                        totalSchedCost += Number(stat.cost || 0)
                    }
                })

                // Leaders in America/Los_Angeles (AM: 6:00-16:59, PM: 17:00-05:59) — single store only
                let morningLeaderName = ''
                let lateLeaderName = ''
                if (selectedStore !== 'all') {
                    const getJobTitle = (jid: string) => String(jobs.find((j: any) => j.id === jid)?.title || '').trim()
                    const isLeaderJob = (title: string) => /^(asst.?s*manager|assistants*manager|shifts*lead(er)?)$/i.test(title)
                    const getEmpName = (eid: string) => {
                        const e = employees.find((emp: any) => emp.id === eid)
                        return e ? (e.chosen_name || e.first_name || '') : ''
                    }

                    const amAsst = daysShifts.find((s: any) => {
                        if (!isLeaderJob(getJobTitle(s.job_id)) || !s.start_time) return false
                        const laHr = getLANowParts(new Date(s.start_time)).hour
                        return laHr >= 6 && laHr < 17
                    })
                    const pmAsst = daysShifts.find((s: any) => {
                        if (!isLeaderJob(getJobTitle(s.job_id)) || !s.start_time) return false
                        const laHr = getLANowParts(new Date(s.start_time)).hour
                        return laHr >= 17 || laHr < 6
                    })

                    morningLeaderName = amAsst ? getEmpName(amAsst.employee_id) : globalManagerName
                    lateLeaderName = pmAsst ? getEmpName(pmAsst.employee_id) : globalManagerName
                }

                // Projection for this day (preserves $0 on closed holidays)
                const rawProj = salesProjections[dateStr]
                const hasProj = rawProj !== undefined && rawProj !== '' && Number.isFinite(Number(rawProj))
                const projSales = hasProj ? Number(rawProj) : 0

                // Target Avg Order: last 4 DISTINCT prior matching weekdays across all included stores
                const priorMatching = lookbackHistory.filter((h: any) =>
                    h.business_date < dateStr &&
                    getIsoWeekdayUTC(h.business_date) === targetDayIndex &&
                    Number(h.order_count || 0) > 0
                )
                const distinctPriorDates: string[] = Array.from(
                    new Set<string>(priorMatching.map((h: any) => String(h.business_date)))
                )
                    .sort((a, b) => b.localeCompare(a))
                    .slice(0, 4)
                const recentDateSet = new Set(distinctPriorDates)
                const matchingHistory = priorMatching.filter((h: any) => recentDateSet.has(String(h.business_date)))

                const targetSalesSum = matchingHistory.reduce((a: number, b: any) => a + Number(b.net_sales || 0), 0)
                const targetOrdersSum = matchingHistory.reduce((a: number, b: any) => a + Number(b.order_count || 0), 0)
                const projAvg = targetOrdersSum > 0 ? targetSalesSum / targetOrdersSum : 0
                const projLaborPct = projSales > 0 ? ((totalSchedCost / projSales) * 100).toFixed(2) : ''

                // Actual Overtime: when punches exist for the day, show real OT (even 0.00); fall back to scheduled OT only for future/unpunched days
                const hasPunchesForDay = dayPunches.length > 0
                const actualOT = dayPunches.reduce((sum: number, p: any) => sum + Number(p.overtime_hours || 0), 0)
                const otDisplay = hasPunchesForDay
                    ? actualOT.toFixed(2)
                    : (dateStr <= todayLA && dayHistories.length > 0 ? '0.00' : (totalOT > 0 ? totalOT.toFixed(2) : ''))

                // Aggregated Actuals + Drive-Thru Cars (guest_count) & SOS Time (ebt_count seconds weighted by guest_count)
                const sysData = dayHistories.length > 0 ? dayHistories.reduce((acc: any, b: any) => {
                    const cars = Number(b.guest_count || 0)
                    const sosSec = Number(b.ebt_count || 0)
                    acc.net_sales += Number(b.net_sales || 0)
                    acc.labor_hours += Number(b.labor_hours || 0)
                    acc.labor_cost += Number(b.labor_cost || 0)
                    acc.order_count += Number(b.order_count || 0)
                    acc.cars += cars
                    if (cars > 0 && sosSec > 0) {
                        acc.sos_weighted_sec += sosSec * cars
                        acc.sos_cars += cars
                    }
                    return acc
                }, { net_sales: 0, labor_hours: 0, labor_cost: 0, order_count: 0, cars: 0, sos_weighted_sec: 0, sos_cars: 0 }) : null

                const avgSosSec = sysData && sysData.sos_cars > 0 ? sysData.sos_weighted_sec / sysData.sos_cars : 0
                const carsDisplay = sysData && sysData.cars > 0
                    ? sysData.cars.toLocaleString('en-US')
                    : (dateStr <= todayLA ? t('sales.reports_page.pending') : '')
                const sosDisplay = avgSosSec > 0
                    ? formatSosSeconds(avgSosSec)
                    : (dateStr <= todayLA ? t('sales.reports_page.pending') : '')

                const cellData: Record<string, any> = {
                    projected_sales: hasProj ? formatSignedUSD(projSales, { decimals: 2 }) : '',
                    projected_labor: projLaborPct ? projLaborPct + '%' : '',
                    target_avg_order: projAvg > 0 ? formatSignedUSD(projAvg, { decimals: 2 }) : '',
                    scheduled_hours: totalSched > 0 ? totalSched.toFixed(2) : '',
                    overtime_hours: otDisplay,
                    morning_leader: morningLeaderName,
                    late_leader: lateLeaderName,
                    daily_cars: carsDisplay,
                    sos_time: sosDisplay,
                    actual_sales: '',
                    actual_hours: '',
                    actual_labor: '',
                    actual_avg_order: '',
                    // Raw weighted accumulators for mathematically exact Weekly Summary
                    _projSales: projSales,
                    _schedCost: totalSchedCost,
                    _targetSales: targetSalesSum,
                    _targetOrders: targetOrdersSum,
                    _netSales: 0,
                    _laborCost: 0,
                    _orderCount: 0,
                    _cars: sysData ? sysData.cars : 0,
                    _sosWeightedSec: sysData ? sysData.sos_weighted_sec : 0,
                    _sosCars: sysData ? sysData.sos_cars : 0
                }

                if (sysData) {
                    const sales = sysData.net_sales
                    const hours = sysData.labor_hours
                    const laborCost = sysData.labor_cost
                    const orders = sysData.order_count
                    const laborPct = sales > 0 ? ((laborCost / sales) * 100).toFixed(2) : '0.00'

                    cellData.actual_sales = formatSignedUSD(sales, { decimals: 2 })
                    cellData.actual_hours = hours.toFixed(2)
                    cellData.actual_labor = laborPct + '%'
                    cellData.actual_avg_order = orders > 0 ? formatSignedUSD(sales / orders, { decimals: 2 }) : '$0.00'
                    cellData._netSales = sales
                    cellData._laborCost = laborCost
                    cellData._orderCount = orders
                }

                newGrid[day.key] = cellData
            })

            setGridData(newGrid)
            setLaborLogData(weekLaborLog)
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                console.error('[REPORT] Error loading weekly report:', err)
                setErrorMsg(t('sales.reports_page.alerts.load_error'))
            }
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false)
            }
        }
    }, [selectedStore, weekDate, stores, calculateProjections, t])

    useEffect(() => {
        if (activeTab === 'ops' || activeTab === 'labor') {
            fetchReport()
        }
        return () => {
            if (weeklyAbortRef.current) weeklyAbortRef.current.abort()
        }
    }, [activeTab, fetchReport])


    // --- MONTHLY REPORT LOGIC (Pure UTC month bounds + 6-day lookback for complete first-Sunday Week Sales + paginated fetch) ---
    const fetchMonthlyReport = useCallback(async () => {
        if (!weekDate || !selectedStore || stores.length === 0) return

        const reqId = ++monthlyReqIdRef.current
        const targetMonth = weekDate.substring(0, 7) // "YYYY-MM"
        const [y, m] = targetMonth.split('-').map(Number)
        if (!Number.isFinite(y) || !Number.isFinite(m)) return

        const daysInMon = new Date(Date.UTC(y, m, 0)).getUTCDate()
        const startStr = getMonthStartIso(y, m)
        const endStr = `${y}-${String(m).padStart(2, '0')}-${String(daysInMon).padStart(2, '0')}`
        // Fetch 6 prior days so the first Sunday of the month has a complete 7-day Week SALES total
        const fetchStartStr = addDaysIso(startStr, -6)

        setLoading(true)
        setErrorMsg(null)
        try {
            const supabase = await getSupabaseClient()
            let queryId: string | null = null
            if (selectedStore !== 'all') {
                const storeObj = stores.find(s => String(s.id) === String(selectedStore))
                if (!storeObj?.external_id) {
                    if (reqId === monthlyReqIdRef.current) setLoading(false)
                    return
                }
                queryId = storeObj.external_id
            }

            // Paginated fetch to guard against 1,000-row PostgREST cap
            const salesData: any[] = []
            const PAGE_SIZE = 1000
            let offset = 0
            while (true) {
                let q = supabase
                    .from('sales_daily_cache')
                    .select('business_date, store_id, net_sales, order_count, guest_count, hourly_data, uber_sales, doordash_sales, grubhub_sales, ebt_amount, ebt_count')
                    .gte('business_date', fetchStartStr)
                    .lte('business_date', endStr)
                    .order('business_date', { ascending: true })
                    .order('store_id', { ascending: true })
                    .range(offset, offset + PAGE_SIZE - 1)
                if (queryId) q = q.eq('store_id', queryId)

                const { data, error } = await q
                if (error) throw error
                if (!data || data.length === 0) break
                salesData.push(...data)
                if (data.length < PAGE_SIZE) break
                offset += PAGE_SIZE
            }

            if (reqId !== monthlyReqIdRef.current) return

            // Build net_sales lookup for all dates including the 6 leading days (filtering pre-seeded $0 rows)
            const salesByDate = new Map<string, number>()
            salesData.forEach((r: any) => {
                const hasRealData = Number(r.net_sales || 0) > 0 || Number(r.order_count || 0) > 0 || Number(r.guest_count || 0) > 0 || Number(r.ebt_amount || 0) > 0
                if (!hasRealData) return
                salesByDate.set(r.business_date, (salesByDate.get(r.business_date) || 0) + Number(r.net_sales || 0))
            })

            const newMonthly: Record<string, any> = {}

            for (let d = 1; d <= daysInMon; d++) {
                const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                const dayRows = salesData.filter((s: any) =>
                    s.business_date === dateKey &&
                    (Number(s.net_sales || 0) > 0 || Number(s.order_count || 0) > 0 || Number(s.guest_count || 0) > 0 || Number(s.ebt_amount || 0) > 0)
                )

                const sysData = {
                    net_sales: 0,
                    order_count: 0,
                    guest_count: 0,
                    act_avg_order: 0,
                    open_sales: 0,
                    close_sales: 0,
                    uber_sales: 0,
                    doordash_sales: 0,
                    grubhub_sales: 0,
                    ebt_amount: 0,
                    drivethru_time_sum: 0,
                    drivethru_cars_with_sos: 0,
                    avg_sos_sec: 0
                }

                if (dayRows.length > 0) {
                    dayRows.forEach(r => {
                        const cars = Number(r.guest_count || 0)
                        const sosSec = Number(r.ebt_count || 0)
                        sysData.net_sales += Number(r.net_sales || 0)
                        sysData.order_count += Number(r.order_count || 0)
                        sysData.guest_count += cars
                        sysData.uber_sales += Number(r.uber_sales || 0)
                        sysData.doordash_sales += Number(r.doordash_sales || 0)
                        sysData.grubhub_sales += Number(r.grubhub_sales || 0)
                        sysData.ebt_amount += Number(r.ebt_amount || 0)

                        // Accumulate weighted SOS seconds (ebt_count stores avg seconds per car)
                        if (cars > 0 && sosSec > 0) {
                            sysData.drivethru_time_sum += sosSec * cars
                            sysData.drivethru_cars_with_sos += cars
                        }

                        const hourly = r.hourly_data || {}
                        let openSales = 0
                        for (let h = 6; h <= 16; h++) openSales += Number(hourly[h] || 0)
                        let closeSales = 0
                        for (let h = 17; h <= 23; h++) closeSales += Number(hourly[h] || 0)
                        for (let h = 0; h <= 5; h++) closeSales += Number(hourly[h] || 0)

                        sysData.open_sales += openSales
                        sysData.close_sales += closeSales
                    })

                    sysData.act_avg_order = sysData.order_count > 0 ? (sysData.net_sales / sysData.order_count) : 0
                    sysData.avg_sos_sec = sysData.drivethru_cars_with_sos > 0
                        ? (sysData.drivethru_time_sum / sysData.drivethru_cars_with_sos)
                        : 0
                }

                // Compute complete 7-day Sunday Week SALES (Mon..Sun including prior month overlap)
                let weekSalesDisplay = ''
                if (getIsoWeekdayUTC(dateKey) === 0) {
                    let weekSum = 0
                    for (let i = 0; i < 7; i++) {
                        weekSum += salesByDate.get(addDaysIso(dateKey, -i)) || 0
                    }
                    if (weekSum > 0) weekSalesDisplay = formatSignedUSD(weekSum, { decimals: 2 })
                }

                const fmtCur = (val: number) => val !== 0 ? formatSignedUSD(val, { decimals: 2 }) : ''

                newMonthly[dateKey] = {
                    date: dateKey,
                    actual_sales: dayRows.length > 0 ? fmtCur(sysData.net_sales) : '',
                    open_sales: dayRows.length > 0 ? fmtCur(sysData.open_sales) : '',
                    close_sales: dayRows.length > 0 ? fmtCur(sysData.close_sales) : '',
                    actual_avg_order: dayRows.length > 0 ? fmtCur(sysData.act_avg_order) : '',
                    uber_post: dayRows.length > 0 ? fmtCur(sysData.uber_sales) : '',
                    doordash: dayRows.length > 0 ? fmtCur(sysData.doordash_sales) : '',
                    grubhub: dayRows.length > 0 ? fmtCur(sysData.grubhub_sales) : '',
                    // Strictly EBT dollars (never leak ebt_count SOS seconds into EBT!)
                    ebt: dayRows.length > 0 && sysData.ebt_amount > 0 ? fmtCur(sysData.ebt_amount) : '',
                    daily_cars: dayRows.length > 0 && sysData.guest_count > 0 ? String(sysData.guest_count) : '',
                    sos_time: dayRows.length > 0 && sysData.avg_sos_sec > 0 ? formatSosSeconds(sysData.avg_sos_sec) : '',
                    week_sales: weekSalesDisplay,
                    // Raw accumulators for exact weighted monthly totals
                    _netSales: sysData.net_sales,
                    _orderCount: sysData.order_count,
                    _sosWeightedSec: sysData.drivethru_time_sum,
                    _sosCars: sysData.drivethru_cars_with_sos
                }
            }

            setMonthlyData(newMonthly)
        } catch (err: any) {
            if (reqId === monthlyReqIdRef.current) {
                console.error('[REPORT] Error loading monthly report:', err)
                setErrorMsg(t('sales.reports_page.alerts.load_error'))
            }
        } finally {
            if (reqId === monthlyReqIdRef.current) {
                setLoading(false)
            }
        }
    }, [weekDate, selectedStore, stores, t])

    useEffect(() => {
        if (activeTab === 'monthly') {
            fetchMonthlyReport()
        }
    }, [activeTab, fetchMonthlyReport])

    const handleMonthlyInputChange = (dateKey: string, colId: string, val: string) => {
        setMonthlyData(prev => ({
            ...prev,
            [dateKey]: {
                ...prev[dateKey],
                [colId]: val,
                ...(colId === 'actual_sales' ? { _netSales: undefined } : {}),
                ...(colId === 'actual_avg_order' ? { _orderCount: undefined } : {}),
                ...(colId === 'sos_time' || colId === 'daily_cars' ? { _sosWeightedSec: undefined, _sosCars: undefined } : {})
            }
        }))
    }

    // CALCULATION LOGIC
    const parseNumber = (val: string | number) => {
        if (val === null || val === undefined || val === '') return 0
        if (typeof val === 'number') return Number.isFinite(val) ? val : 0
        const clean = String(val).replace(/[^0-9.-]+/g, '')
        const parsed = parseFloat(clean)
        return Number.isFinite(parsed) ? parsed : 0
    }

    const isPendingLabel = (val: any) => {
        const s = String(val || '').trim().toLowerCase()
        return s === 'pendiente' || s === 'pending' || s === String(t('sales.reports_page.pending') || '').trim().toLowerCase()
    }

    const getCellValue = (dayKey: string, rowId: string) => {
        const dayData = gridData[dayKey] || {}
        const getRaw = (id: string) => dayData[id] || ''

        if (rowId === 'diff_sales') {
            const proj = parseNumber(getRaw('projected_sales'))
            const act = parseNumber(getRaw('actual_sales'))
            if (act === 0 || proj === 0) return ''
            return formatSignedUSD(act - proj, { decimals: 2, showPlus: true })
        }
        if (rowId === 'diff_hours') {
            const sched = parseNumber(getRaw('scheduled_hours'))
            const act = parseNumber(getRaw('actual_hours'))
            if (act === 0 || sched === 0) return ''
            const diff = act - sched
            return `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`
        }
        if (rowId === 'diff_avg_order' || rowId === 'diff_avg') {
            const target = parseNumber(getRaw('target_avg_order'))
            const act = parseNumber(getRaw('actual_avg_order'))
            if (act === 0 || target === 0) return ''
            return formatSignedUSD(act - target, { decimals: 2, showPlus: true })
        }
        if (rowId === 'diff_labor') {
            const proj = parseNumber(getRaw('projected_labor'))
            const act = parseNumber(getRaw('actual_labor'))
            if (act === 0 || proj === 0) return ''
            const diff = act - proj
            return `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`
        }

        return dayData[rowId] || ''
    }

    const handleInputChange = (dayKey: string, rowId: string, val: string) => {
        setGridData(prev => ({
            ...prev,
            [dayKey]: {
                ...prev[dayKey],
                [rowId]: val,
                // Invalidate cached raw accumulators when user edits dependent cell manually
                ...(rowId === 'actual_sales' ? { _netSales: undefined } : {}),
                ...(rowId === 'projected_sales' ? { _projSales: undefined } : {}),
                ...(rowId === 'actual_labor' ? { _laborCost: undefined } : {}),
                ...(rowId === 'projected_labor' ? { _schedCost: undefined } : {}),
                ...(rowId === 'actual_avg_order' ? { _orderCount: undefined } : {}),
                ...(rowId === 'target_avg_order' ? { _targetSales: undefined, _targetOrders: undefined } : {}),
                ...(rowId === 'sos_time' || rowId === 'daily_cars' ? { _sosWeightedSec: undefined, _sosCars: undefined } : {})
            }
        }))
    }

    // Format on Blur (preserves pending labels & proper -$ sign)
    const handleInputBlur = (dayKey: string, rowId: string, val: string) => {
        const trimmed = String(val || '').trim()
        if (!trimmed || isPendingLabel(trimmed)) return

        const row = REPORT_STRUCTURE.find(r => r.id === rowId)
        if (!row || row.type === 'text' || row.type === 'time') return

        const num = parseNumber(trimmed)
        if (!Number.isFinite(num)) return

        let formatted = trimmed
        if (row.type === 'currency') {
            formatted = formatSignedUSD(num, { decimals: 2 })
        } else if (row.type === 'percent') {
            formatted = num.toFixed(2) + '%'
        } else if (row.type === 'number') {
            formatted = num.toLocaleString('en-US', { maximumFractionDigits: 2 })
        }

        if (formatted !== val) {
            handleInputChange(dayKey, rowId, formatted)
        }
    }

    // Styles for computed cells
    const getComputedStyle = (val: string | number, inverse: boolean = false) => {
        if (val === '' || val === null || val === undefined) return 'text-slate-400'
        const num = parseNumber(val)
        if (num === 0) return 'text-slate-400'

        if (inverse) {
            return num < 0 ? 'text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-600 font-bold bg-rose-50 dark:bg-rose-900/20'
        }
        return num > 0 ? 'text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-600 font-bold bg-rose-50 dark:bg-rose-900/20'
    }

    // --- TRANSLATION HELPERS ---
    const getRowLabel = (rowId: string, fallback: string) => {
        const map: Record<string, string> = {
            section_sales: 'sales_header',
            projected_sales: 'proj_sales',
            actual_sales: 'act_sales',
            diff_sales: 'diff_sales',
            section_hours: 'hours_header',
            scheduled_hours: 'sched_hours',
            actual_hours: 'act_hours',
            diff_hours: 'diff_hours',
            overtime_hours: 'ot_hours',
            section_kpi: 'kpi_header',
            target_avg_order: 'target_avg',
            actual_avg_order: 'act_avg',
            diff_avg_order: 'diff_avg',
            section_labor: 'labor_header',
            projected_labor: 'proj_labor',
            actual_labor: 'act_labor',
            diff_labor: 'diff_labor',
            section_ops: 'ops_header',
            daily_cars: 'daily_cars',
            sos_time: 'sos_time',
            morning_leader: 'morning_leader',
            late_leader: 'late_leader'
        }
        const key = map[rowId]
        return key ? t(`sales.reports_page.structure.${key}`) : fallback
    }

    const getMonthlyLabel = (colId: string, fallback: string) => {
        const map: Record<string, string> = {
            date: 'date',
            actual_sales: 'sale',
            open_sales: 'open',
            close_sales: 'close',
            actual_avg_order: 'order',
            uber_post: 'uber',
            doordash: 'doordash',
            grubhub: 'grubhub',
            ebt: 'ebt',
            daily_cars: 'cars',
            sos_time: 'time',
            week_sales: 'week_sales'
        }
        const key = map[colId]
        return key ? t(`sales.reports_page.monthly_cols.${key}`) : fallback
    }

    const getDayLabel = (key: string) => {
        return t(`sales.reports_page.days.${key.toLowerCase()}`)
    }

    // True Weighted Weekly Summary
    const calculateWeekTotal = (rowId: string, type: string) => {
        if (type === 'text' || type === 'header') return ''

        if (rowId === 'sos_time') {
            let totalSec = 0
            let totalCars = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                if (typeof cell._sosWeightedSec === 'number' && typeof cell._sosCars === 'number' && cell._sosCars > 0) {
                    totalSec += cell._sosWeightedSec
                    totalCars += cell._sosCars
                }
            })
            return totalCars > 0 ? formatSosSeconds(totalSec / totalCars) : ''
        }

        if (type === 'time') return ''

        if (rowId === 'actual_avg_order') {
            let totalSales = 0
            let totalOrders = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                const sales = typeof cell._netSales === 'number' ? cell._netSales : parseNumber(cell.actual_sales)
                const orders = typeof cell._orderCount === 'number'
                    ? cell._orderCount
                    : (() => {
                        const avg = parseNumber(cell.actual_avg_order)
                        return avg > 0 && sales > 0 ? sales / avg : 0
                    })()
                if (sales > 0 && orders > 0) {
                    totalSales += sales
                    totalOrders += orders
                }
            })
            return totalOrders > 0 ? formatSignedUSD(totalSales / totalOrders, { decimals: 2 }) : '$0.00'
        }

        if (rowId === 'target_avg_order') {
            let totalTargetSales = 0
            let totalTargetOrders = 0
            let fallbackSum = 0
            let fallbackDays = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                if (typeof cell._targetSales === 'number' && typeof cell._targetOrders === 'number' && cell._targetOrders > 0) {
                    totalTargetSales += cell._targetSales
                    totalTargetOrders += cell._targetOrders
                } else {
                    const v = parseNumber(cell.target_avg_order)
                    if (v > 0) {
                        fallbackSum += v
                        fallbackDays++
                    }
                }
            })
            if (totalTargetOrders > 0) return formatSignedUSD(totalTargetSales / totalTargetOrders, { decimals: 2 })
            return fallbackDays > 0 ? formatSignedUSD(fallbackSum / fallbackDays, { decimals: 2 }) : '$0.00'
        }

        if (rowId === 'diff_avg_order') {
            let actSales = 0
            let actOrders = 0
            let tgtSales = 0
            let tgtOrders = 0
            let fallbackDiffSum = 0
            let activeDays = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                const sales = typeof cell._netSales === 'number' ? cell._netSales : parseNumber(cell.actual_sales)
                const tgtAvg = parseNumber(cell.target_avg_order)
                const actAvg = parseNumber(cell.actual_avg_order)
                if (sales <= 0 || tgtAvg <= 0 || actAvg <= 0) return
                activeDays++
                fallbackDiffSum += (actAvg - tgtAvg)
                if (typeof cell._orderCount === 'number' && cell._orderCount > 0) {
                    actSales += sales
                    actOrders += cell._orderCount
                }
                if (typeof cell._targetSales === 'number' && typeof cell._targetOrders === 'number' && cell._targetOrders > 0) {
                    tgtSales += cell._targetSales
                    tgtOrders += cell._targetOrders
                }
            })
            if (activeDays === 0) return '$0.00'
            const diff = (actOrders > 0 && tgtOrders > 0)
                ? (actSales / actOrders) - (tgtSales / tgtOrders)
                : (fallbackDiffSum / activeDays)
            return formatSignedUSD(diff, { decimals: 2, showPlus: true })
        }

        if (rowId === 'actual_labor') {
            let totalSales = 0
            let totalLaborCost = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                const sales = typeof cell._netSales === 'number' ? cell._netSales : parseNumber(cell.actual_sales)
                const cost = typeof cell._laborCost === 'number'
                    ? cell._laborCost
                    : (sales * parseNumber(cell.actual_labor)) / 100
                if (sales > 0) {
                    totalSales += sales
                    totalLaborCost += cost
                }
            })
            return totalSales > 0 ? ((totalLaborCost / totalSales) * 100).toFixed(2) + '%' : '0.00%'
        }

        if (rowId === 'projected_labor') {
            let totalProjSales = 0
            let totalSchedCost = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                const proj = typeof cell._projSales === 'number' ? cell._projSales : parseNumber(cell.projected_sales)
                const cost = typeof cell._schedCost === 'number'
                    ? cell._schedCost
                    : (proj * parseNumber(cell.projected_labor)) / 100
                if (proj > 0) {
                    totalProjSales += proj
                    totalSchedCost += cost
                }
            })
            return totalProjSales > 0 ? ((totalSchedCost / totalProjSales) * 100).toFixed(2) + '%' : '0.00%'
        }

        if (rowId === 'diff_labor') {
            // Apples-to-apples weighted Labor % diff strictly over days with BOTH actual and projected sales
            let actSales = 0
            let actCost = 0
            let projSales = 0
            let schedCost = 0
            DAYS.forEach(d => {
                const cell = gridData[d.key] || {}
                const s = typeof cell._netSales === 'number' ? cell._netSales : parseNumber(cell.actual_sales)
                const p = typeof cell._projSales === 'number' ? cell._projSales : parseNumber(cell.projected_sales)
                if (s <= 0 || p <= 0) return
                const c = typeof cell._laborCost === 'number' ? cell._laborCost : (s * parseNumber(cell.actual_labor)) / 100
                const sc = typeof cell._schedCost === 'number' ? cell._schedCost : (p * parseNumber(cell.projected_labor)) / 100
                actSales += s
                actCost += c
                projSales += p
                schedCost += sc
            })
            if (actSales <= 0 || projSales <= 0) return '0.00%'
            const diff = ((actCost / actSales) * 100) - ((schedCost / projSales) * 100)
            return `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`
        }

        let sum = 0
        DAYS.forEach(day => {
            sum += parseNumber(getCellValue(day.key, rowId))
        })

        if (type === 'percent') return sum.toFixed(2) + '%'
        if (type === 'currency') {
            return formatSignedUSD(sum, { decimals: 2, showPlus: rowId === 'diff_sales' })
        }
        const formattedNum = sum.toLocaleString('en-US', { maximumFractionDigits: 2 })
        return rowId === 'diff_hours' && sum > 0 ? `+${formattedNum}` : formattedNum
    }

    // Weighted Labor Log Weekly Summary (shared between desktop & mobile)
    const weeklyLaborLogSummary = useMemo(() => {
        let sumMorningSales = 0
        let sumMorningCost = 0
        let sumNightSales = 0
        let sumNightCost = 0
        let sumTotalSales = 0
        let sumTotalCost = 0

        laborLogData.forEach((d: any) => {
            sumMorningSales += Number(d.morningSales || 0)
            sumMorningCost += Number(d.morningLaborCost || 0)
            sumNightSales += Number(d.nightSales || 0)
            sumNightCost += Number(d.nightLaborCost || 0)
            sumTotalSales += Number(d.totalSales || 0)
            sumTotalCost += Number(d.morningLaborCost || 0) + Number(d.nightLaborCost || 0)
        })

        return {
            avgMorning: sumMorningSales > 0 ? (sumMorningCost / sumMorningSales) * 100 : 0,
            avgNight: sumNightSales > 0 ? (sumNightCost / sumNightSales) * 100 : 0,
            avgTotal: sumTotalSales > 0 ? (sumTotalCost / sumTotalSales) * 100 : 0
        }
    }, [laborLogData])

    // Shared Monthly Footer/Summary calculator (fixes dead actual_avg_order branch + adds weighted SOS Time)
    const getMonthlyFooterValue = useCallback((colId: string, colType: string): string => {
        const rows = Object.values(monthlyData) as any[]
        if (colId === 'week_sales') return '—'

        if (colId === 'actual_avg_order') {
            let totalSales = 0
            let totalOrders = 0
            let fallbackSum = 0
            let fallbackCount = 0
            rows.forEach((r) => {
                const sales = typeof r._netSales === 'number' ? r._netSales : parseNumber(r.actual_sales)
                const orders = typeof r._orderCount === 'number' ? r._orderCount : 0
                if (sales > 0 && orders > 0) {
                    totalSales += sales
                    totalOrders += orders
                } else {
                    const avg = parseNumber(r.actual_avg_order)
                    if (avg > 0) {
                        fallbackSum += avg
                        fallbackCount++
                    }
                }
            })
            if (totalOrders > 0) return formatSignedUSD(totalSales / totalOrders, { decimals: 2 })
            return fallbackCount > 0 ? formatSignedUSD(fallbackSum / fallbackCount, { decimals: 2 }) : '-'
        }

        if (colId === 'sos_time') {
            let totalSec = 0
            let totalCars = 0
            rows.forEach((r) => {
                if (typeof r._sosWeightedSec === 'number' && typeof r._sosCars === 'number' && r._sosCars > 0) {
                    totalSec += r._sosWeightedSec
                    totalCars += r._sosCars
                }
            })
            return totalCars > 0 ? formatSosSeconds(totalSec / totalCars) : '-'
        }

        let sum = 0
        rows.forEach((r) => {
            const rawVal = r[colId]
            if (rawVal !== '' && rawVal !== null && rawVal !== undefined) {
                sum += parseNumber(rawVal)
            }
        })

        if (colType === 'currency') return formatSignedUSD(sum, { decimals: 2 })
        if (colType === 'number') return Math.round(sum).toLocaleString('en-US')
        return '-'
    }, [monthlyData])

    // Export CSV across all 3 tabs (formula-safe UTF-8 BOM)
    const handleExportCSV = () => {
        if (!selectedStore || !weekDate) return
        const storeLabel = selectedStore === 'all'
            ? t('sales.reports_page.controls.all_stores')
            : formatStoreName(stores.find(s => String(s.id) === String(selectedStore))?.name || selectedStore)
        const safeStoreSlug = storeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')

        let lines: string[][] = []
        let filename = ''

        if (activeTab === 'ops') {
            const monIso = getMondayIso(weekDate)
            const headers = [
                t('sales.reports_page.concept'),
                ...DAYS.map((d, i) => `${getDayLabel(d.key)} (${formatUsDateFromIso(addDaysIso(monIso, i))})`),
                t('sales.reports_page.weekly_summary')
            ]
            lines.push(headers)
            REPORT_STRUCTURE.filter(r => r.type !== 'header').forEach(row => {
                lines.push([
                    getRowLabel(row.id, row.label),
                    ...DAYS.map(d => String(getCellValue(d.key, row.id) || '')),
                    String(calculateWeekTotal(row.id, row.type) || '')
                ])
            })
            filename = `ops_${safeStoreSlug}_${monIso}.csv`
        } else if (activeTab === 'labor') {
            const monIso = getMondayIso(weekDate)
            lines.push([
                t('sales.reports_page.labor_table.day'),
                t('sales.reports_page.monthly_cols.date'),
                t('sales.reports_page.labor_table.morning'),
                t('sales.reports_page.labor_table.night'),
                t('sales.reports_page.labor_table.total')
            ])
            laborLogData.forEach((d: any) => {
                lines.push([
                    getDayLabel(d.dayKey || d.dayLabel),
                    formatUsDateFromIso(d.date),
                    `${d.morning}%`,
                    `${d.night}%`,
                    `${d.total}%`
                ])
            })
            lines.push([
                t('sales.reports_page.weekly_summary'),
                '',
                `${weeklyLaborLogSummary.avgMorning.toFixed(2)}%`,
                `${weeklyLaborLogSummary.avgNight.toFixed(2)}%`,
                `${weeklyLaborLogSummary.avgTotal.toFixed(2)}%`
            ])
            filename = `labor_log_${safeStoreSlug}_${monIso}.csv`
        } else {
            const monthKey = weekDate.substring(0, 7)
            lines.push(MONTHLY_STRUCTURE.map(col => getMonthlyLabel(col.id, col.label)))
            Object.keys(monthlyData).sort().forEach(dateKey => {
                const row = monthlyData[dateKey]
                lines.push([
                    formatUsDateFromIso(dateKey),
                    ...MONTHLY_STRUCTURE.slice(1).map(col => String(row[col.id] || ''))
                ])
            })
            lines.push([
                t('sales.reports_page.controls.total_label'),
                ...MONTHLY_STRUCTURE.slice(1).map(col => getMonthlyFooterValue(col.id, col.type))
            ])
            filename = `monthly_${safeStoreSlug}_${monthKey}.csv`
        }

        const csvContent = lines.map(row => row.map(cell => escapeCsvCell(cell)).join(',')).join('\n')
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', filename)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    const handleWeekDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.value) {
            setWeekDate('')
            setDatePreset('')
            return
        }

        setDatePreset('custom')
        if (activeTab === 'monthly') {
            setWeekDate(e.target.value + '-01')
            return
        }

        setWeekDate(getMondayIso(e.target.value))
    }

    const activePeriodLabel = useMemo(() => {
        if (!weekDate) return ''
        if (activeTab === 'monthly') {
            const [y, m] = weekDate.split('-').map(Number)
            const d = new Date(Date.UTC(y, m - 1, 15))
            return d.toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        }
        const mon = getMondayIso(weekDate)
        const sun = addDaysIso(mon, 6)
        return `${mon.slice(5).replace('-', '/')} – ${sun.slice(5).replace('-', '/')}`
    }, [weekDate, activeTab, language])

    return (
        <div className="min-h-screen bg-slate-50/50 dark:bg-[#0a0a0a] p-2 md:p-6 pb-32">
            <div className="max-w-[1800px] mx-auto space-y-6">

                    {/* Header Controls */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center gap-4 sticky top-0 z-30">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                                <FileText size={24} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {activeTab === 'ops' ? t('sales.reports_page.title') : activeTab === 'labor' ? t('sales.reports_page.tabs.labor') : t('sales.reports_page.tabs.monthly')}
                                </h1>
                                <p className="text-xs text-slate-500">{t('sales.reports_page.subtitle')}</p>
                            </div>
                        </div>

                        {/* Tab Switcher */}
                        <div className="flex w-full md:w-auto justify-center md:justify-start overflow-x-auto bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 md:ml-4">
                            <button
                                onClick={() => setActiveTab('ops')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'ops' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {t('sales.reports_page.tabs.ops')}
                            </button>
                            <button
                                onClick={() => setActiveTab('labor')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'labor' ? 'bg-white dark:bg-slate-800 text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {t('sales.reports_page.tabs.labor')}
                            </button>
                            <button
                                onClick={() => setActiveTab('monthly')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'monthly' ? 'bg-white dark:bg-slate-800 text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {t('sales.reports_page.tabs.monthly')}
                            </button>
                        </div>

                        <div className="h-8 w-[1px] bg-slate-200 dark:bg-slate-800 hidden md:block mx-2"></div>

                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                            <select
                                value={selectedStore}
                                onChange={(e) => setSelectedStore(e.target.value)}
                                className={`px-3 py-2 border rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${selectedStore === 'all'
                                    ? 'bg-indigo-600 text-white border-indigo-500'
                                    : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                                    }`}
                            >
                                <option value="" className="text-slate-500 bg-white">{t('sales.reports_page.controls.select_store')}</option>
                                <option value="all" className="bg-indigo-600 text-white font-black uppercase tracking-wider">🌟 {t('sales.reports_page.controls.all_stores')}</option>
                                {stores.map(s => <option key={s.id} value={s.id} className="text-slate-900 bg-white">{formatStoreName(s.name)}</option>)}
                            </select>



                            <div className="flex items-center bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-1">
                                <select
                                    value={datePreset}
                                    className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none px-3 py-1.5 cursor-pointer max-w-[160px]"
                                    onChange={(e) => {
                                        const val = e.target.value
                                        setDatePreset(val)
                                        if (!val || val === 'custom') return

                                        // Always compute from LA 6:00 AM business date (zero UTC/DST drift)
                                        const todayLA = getBusinessDateLA()
                                        const thisMonday = getMondayIso(todayLA)
                                        const [laYear, laMonth] = todayLA.split('-').map(Number)

                                        let newDate = ''
                                        if (val === 'this_week') {
                                            newDate = thisMonday
                                            if (activeTab === 'monthly') setActiveTab('ops')
                                        } else if (val === 'last_week') {
                                            newDate = addDaysIso(thisMonday, -7)
                                            if (activeTab === 'monthly') setActiveTab('ops')
                                        } else if (val === 'this_month') {
                                            newDate = getMonthStartIso(laYear, laMonth)
                                            setActiveTab('monthly')
                                        } else if (val === 'last_month') {
                                            newDate = getPreviousMonthStartIso(todayLA)
                                            setActiveTab('monthly')
                                        }

                                        if (newDate) setWeekDate(newDate)
                                    }}
                                >
                                    <option value="" disabled hidden>{t('sales.select_dates')}</option>
                                    <option value="this_week">{t('sales.this_week')}</option>
                                    <option value="last_week">{t('sales.last_week')}</option>
                                    <option value="this_month">{t('sales.current_month')}</option>
                                    <option value="last_month">{t('sales.last_month')}</option>
                                    <option value="custom" disabled hidden>{activePeriodLabel || t('sales.custom_date')}</option>
                                </select>

                                <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>

                                <div className="relative group px-2 flex items-center gap-1.5">
                                    <Calendar size={18} className="text-slate-400 group-hover:text-indigo-500 transition-colors cursor-pointer shrink-0" />
                                    {activePeriodLabel && (
                                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap hidden sm:inline">
                                            {activePeriodLabel}
                                        </span>
                                    )}
                                    {activeTab === 'monthly' ? (
                                        <input
                                            type="month"
                                            value={weekDate ? weekDate.substring(0, 7) : ''}
                                            onChange={handleWeekDateChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            title={t('sales.reports_page.controls.select_month')}
                                        />
                                    ) : (
                                        <input
                                            type="date"
                                            value={weekDate}
                                            onChange={handleWeekDateChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            title={t('sales.reports_page.controls.select_specific_date')}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1"></div>

                        {/* Actions (Refresh + CSV Export + Print) */}
                        <div className="flex flex-wrap items-center gap-2 print:hidden">
                            <button
                                type="button"
                                onClick={() => activeTab === 'monthly' ? fetchMonthlyReport() : fetchReport()}
                                disabled={loading || !selectedStore || !weekDate}
                                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-bold hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                <Calculator size={15} /> {t('sales.refresh')}
                            </button>
                            <button
                                type="button"
                                onClick={handleExportCSV}
                                disabled={loading || !selectedStore || !weekDate}
                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                <Download size={15} /> {t('sales.reports_page.controls.export_csv')}
                            </button>
                            <button
                                type="button"
                                onClick={() => window.print()}
                                disabled={loading || !selectedStore || !weekDate}
                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                <Printer size={15} /> {t('sales.reports_page.controls.print_report')}
                            </button>
                        </div>
                    </div>

                    {errorMsg && (
                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-sm font-medium">
                            <AlertCircle size={18} className="shrink-0" />
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    {loading ? (
                        <div className="h-96 flex flex-col items-center justify-center text-slate-400 animate-pulse bg-white/50 dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-slate-800">
                            <Clock size={48} className="mb-4 animate-spin" />
                            <p className="font-bold">{t('sales.reports_page.controls.processing_data')}</p>
                            <p className="text-xs">{t('sales.reports_page.controls.syncing_sales_labor')}</p>
                        </div>
                    ) : selectedStore && weekDate ? (
                        activeTab === 'ops' ? (
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 pb-4">
                                {/* DESKTOP TABLE VIEW */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800/50">
                                                <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-wider border-r dark:border-slate-700 sticky left-0 bg-slate-50 dark:bg-slate-800 z-20 border-b border-slate-200 dark:border-slate-700">
                                                    {t('sales.reports_page.concept')}
                                                </th>
                                                {DAYS.map((day, i) => {
                                                    const [y, m, dayNum] = weekDate.split('-').map(Number);
                                                    const d = new Date(Date.UTC(y, m - 1, dayNum, 12, 0, 0));
                                                    const currentDay = d.getUTCDay()
                                                    const distToMon = currentDay === 0 ? -6 : (1 - currentDay)
                                                    d.setUTCDate(d.getUTCDate() + distToMon)
                                                    d.setUTCDate(d.getUTCDate() + i);

                                                    const dayData = gridData[day.key]
                                                    const infoTags = dayData?.weather_notes || []

                                                    return (
                                                        <th key={day.key} className="px-4 py-4 text-center border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700 min-w-[120px]">
                                                            <span className="block text-[13px] font-bold text-slate-900 dark:text-white uppercase leading-tight font-sans">
                                                                {getDayLabel(day.key)}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 font-normal font-sans">
                                                                {(`${d.getUTCMonth() + 1}`).padStart(2, '0')}/{(`${d.getUTCDate()}`).padStart(2, '0')}/{d.getUTCFullYear()}
                                                            </span>
                                                            {infoTags.length > 0 && (
                                                                <div className="flex flex-col gap-0.5 mt-1.5 align-middle items-center justify-center">
                                                                    {infoTags.map((tag: string, idx: number) => (
                                                                        <span key={idx} className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px] mx-auto block text-center">
                                                                            {tag}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </th>
                                                    )
                                                })}
                                                <th className="px-4 py-4 text-center bg-indigo-50/50 dark:bg-indigo-900/20 border-b border-slate-200 dark:border-slate-700">
                                                    <span className="block text-[13px] font-black text-indigo-600 dark:text-indigo-400 font-sans uppercase">
                                                        {t('sales.reports_page.weekly_summary')}
                                                    </span>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {REPORT_STRUCTURE.map(row => {
                                                if (row.type === 'header') {
                                                    return (
                                                        <tr key={row.id} className="bg-slate-100/50 dark:bg-white/5">
                                                            <td colSpan={DAYS.length + 2} className="px-6 py-1.5 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                                                                {getRowLabel(row.id, row.label)}
                                                            </td>
                                                        </tr>
                                                    )
                                                }

                                                const isComputed = row.computed
                                                const isInverse = row.inverseColor
                                                const isProjected = row.id.startsWith('projected_') || row.id.startsWith('target_') || row.id === 'scheduled_hours'

                                                return (
                                                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                                        <td className="px-6 py-2 font-medium text-slate-700 dark:text-slate-300 border-r dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors z-10 border-b border-slate-100 dark:border-slate-800">
                                                            {getRowLabel(row.id, row.label)}
                                                        </td>

                                                        {DAYS.map(day => {
                                                            const value = getCellValue(day.key, row.id)
                                                            const isPending = isPendingLabel(value)

                                                            if (isComputed) {
                                                                const style = getComputedStyle(value, isInverse)
                                                                return (
                                                                    <td key={day.key} className="p-0 border-r border-b border-slate-100 dark:border-slate-800">
                                                                        <div className={`w-full h-full py-3 px-2 text-center text-xs md:text-sm font-sans ${style} ${isProjected ? 'font-bold' : 'font-medium'}`}>
                                                                            {value}
                                                                        </div>
                                                                    </td>
                                                                )
                                                            }

                                                            return (
                                                                <td key={day.key} className={`p-0 border-r border-b border-slate-100 dark:border-slate-800 ${isPending ? 'bg-yellow-100 dark:bg-yellow-900/30' : ''}`}>
                                                                    <input
                                                                        type="text"
                                                                        value={value}
                                                                        onChange={(e) => handleInputChange(day.key, row.id, e.target.value)}
                                                                        onBlur={(e) => handleInputBlur(day.key, row.id, e.target.value)}
                                                                        className={`w-full h-full py-3 px-2 text-center bg-transparent border-none outline-none focus:bg-indigo-50 dark:focus:bg-indigo-900/30 font-sans text-xs md:text-sm text-slate-800 dark:text-slate-200 transition-all placeholder:text-transparent ${isProjected ? 'font-bold text-indigo-700 dark:text-indigo-400' : ''} ${isPending ? 'text-yellow-800 dark:text-yellow-200 font-bold italic' : ''}`}
                                                                        placeholder="-"
                                                                    />
                                                                </td>
                                                            )
                                                        })}

                                                        {(() => {
                                                            const totalString = calculateWeekTotal(row.id, row.type)
                                                            const totalValue = parseNumber(totalString)
                                                            const totalStyle = isComputed ? getComputedStyle(totalValue, isInverse) : ''

                                                            return (
                                                                <td className={`px-4 py-2 text-center font-bold font-sans text-xs md:text-sm border-b border-slate-100 dark:border-slate-800 ${totalStyle || 'bg-indigo-50/30 dark:bg-indigo-900/10'} ${isProjected ? 'text-indigo-900 dark:text-indigo-100 italic' : (totalStyle ? '' : 'text-slate-900 dark:text-white')}`}>
                                                                    {totalString}
                                                                </td>
                                                            )
                                                        })()}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* MOBILE CARD VIEW */}
                                <div className="md:hidden flex flex-col gap-4 p-3 bg-slate-50 dark:bg-black/20">
                                    {DAYS.map((day, i) => {
                                        const [y, m, dayNum] = weekDate.split('-').map(Number);
                                        const d = new Date(Date.UTC(y, m - 1, dayNum, 12, 0, 0));
                                        const currentDay = d.getUTCDay()
                                        const distToMon = currentDay === 0 ? -6 : (1 - currentDay)
                                        d.setUTCDate(d.getUTCDate() + distToMon)
                                        d.setUTCDate(d.getUTCDate() + i);
                                        const dateLabel = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

                                        return (
                                            <div key={day.key} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                                                <div className="bg-slate-100 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                                    <h3 className="font-black text-slate-700 dark:text-white uppercase">{getDayLabel(day.key)}</h3>
                                                    <span className="text-xs font-bold text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">{dateLabel}</span>
                                                </div>
                                                <div className="p-0">
                                                    {REPORT_STRUCTURE.map(row => {
                                                        if (row.type === 'header') {
                                                            return (
                                                                <div key={row.id} className="bg-indigo-50/50 dark:bg-indigo-900/10 px-4 py-1.5 text-[10px] font-black text-indigo-400 uppercase tracking-widest border-y border-indigo-100 dark:border-indigo-900/20 mt-2 first:mt-0">
                                                                    {getRowLabel(row.id, row.label)}
                                                                </div>
                                                            )
                                                        }

                                                        const value = getCellValue(day.key, row.id)
                                                        const isComputed = row.computed
                                                        const isInverse = row.inverseColor
                                                        const isProjected = row.id.startsWith('projected_') || row.id.startsWith('target_') || row.id === 'scheduled_hours'

                                                        let displayValue: React.ReactNode = value
                                                        if (isComputed) {
                                                            const style = getComputedStyle(value, isInverse)
                                                            displayValue = <span className={`px-1.5 py-0.5 rounded ${style}`}>{value}</span>
                                                        } else {
                                                            displayValue = (
                                                                <input
                                                                    type="text"
                                                                    value={value}
                                                                    onChange={(e) => handleInputChange(day.key, row.id, e.target.value)}
                                                                    onBlur={(e) => handleInputBlur(day.key, row.id, e.target.value)}
                                                                    className={`text-right bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 outline-none focus:border-indigo-500 w-24 ${isProjected ? 'font-bold text-indigo-700 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}
                                                                    placeholder="-"
                                                                />
                                                            )
                                                        }

                                                        return (
                                                            <div key={row.id} className="flex justify-between items-center px-4 py-2 border-b border-slate-50 dark:border-slate-800/50 last:border-0 text-sm">
                                                                <span className="text-slate-600 dark:text-slate-400 font-medium text-xs">{getRowLabel(row.id, row.label)}</span>
                                                                <div className="font-semibold">{displayValue}</div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {/* WEEK TOTAL CARD */}
                                    <div className="bg-indigo-900 text-white rounded-xl shadow-lg border border-indigo-800 overflow-hidden mt-4">
                                        <div className="px-4 py-3 border-b border-indigo-800 bg-indigo-950/50">
                                            <h3 className="font-black uppercase tracking-wider text-center">{t('sales.reports_page.weekly_summary')}</h3>
                                        </div>
                                        <div className="p-4 space-y-2">
                                            {REPORT_STRUCTURE.filter(r => r.type !== 'header').map(row => {
                                                const totalString = calculateWeekTotal(row.id, row.type)
                                                if (!totalString || totalString === '$0.00' || totalString === '0.00') return null
                                                return (
                                                    <div key={row.id} className="flex justify-between items-center border-b border-indigo-800/50 last:border-0 pb-1 last:pb-0 text-sm">
                                                        <span className="text-indigo-300 font-medium">{getRowLabel(row.id, row.label)}</span>
                                                        <span className="font-bold">{totalString}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : activeTab === 'labor' ? (
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                                {/* DESKTOP TABLE */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800/50">
                                                <th className="px-6 py-6 text-left text-xs font-black text-slate-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    {t('sales.reports_page.labor_table.day')}
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    {t('sales.reports_page.labor_table.morning')}
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    {t('sales.reports_page.labor_table.night')}
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                                                    {t('sales.reports_page.labor_table.total')}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {laborLogData.map((day, idx) => {
                                                const mNum = Number(day.morning)
                                                const nNum = Number(day.night)
                                                const tNum = Number(day.total)
                                                const threshold = 21.5

                                                return (
                                                    <tr key={day.date} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-4 border-r dark:border-slate-800">
                                                            <div className="flex flex-col">
                                                                <span className="font-bold text-slate-900 dark:text-white text-sm md:text-base leading-tight">{getDayLabel(day.dayKey || day.dayLabel)}</span>
                                                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                                                    {formatUsDateFromIso(day.date)}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-center border-r dark:border-slate-800 bg-indigo-50/20 dark:bg-indigo-900/10">
                                                            <span className={`text-sm font-bold ${mNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
                                                                {day.morning}%
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-center border-r dark:border-slate-800 bg-indigo-50/20 dark:bg-indigo-900/10">
                                                            <span className={`text-sm font-bold ${nNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
                                                                {day.night}%
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <span className={`text-sm font-black ${tNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                                                                {day.total}%
                                                            </span>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                        <tfoot>
                                            {(() => {
                                                const { avgMorning, avgNight, avgTotal } = weeklyLaborLogSummary
                                                const threshold = 21.5

                                                return (
                                                    <tr className="bg-slate-50 dark:bg-slate-800/80">
                                                        <td className="px-6 py-6 font-black text-indigo-600 dark:text-indigo-400 uppercase text-xs border-r dark:border-slate-700">
                                                            {t('sales.reports_page.weekly_summary')}
                                                        </td>
                                                        <td className="px-6 py-6 text-center text-lg font-black border-r dark:border-slate-700">
                                                            <span className={avgMorning > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-700 dark:text-indigo-400'}>
                                                                {avgMorning.toFixed(2)}%
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-6 text-center text-lg font-black border-r dark:border-slate-700">
                                                            <span className={avgNight > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-700 dark:text-indigo-400'}>
                                                                {avgNight.toFixed(2)}%
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-6 text-center text-lg font-black">
                                                            <span className={avgTotal > threshold ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}>
                                                                {avgTotal.toFixed(2)}%
                                                            </span>
                                                        </td>
                                                    </tr>
                                                )
                                            })()}
                                        </tfoot>
                                    </table>
                                </div>

                                {/* MOBILE CARD VIEW */}
                                <div className="md:hidden flex flex-col gap-3 p-3 bg-slate-50 dark:bg-black/20">
                                    {laborLogData.map((day, idx) => {
                                        const mNum = Number(day.morning)
                                        const nNum = Number(day.night)
                                        const tNum = Number(day.total)
                                        const threshold = 21.5
                                        const dateObj = new Date(day.date + 'T12:00:00')

                                        return (
                                            <div key={day.date} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-4">
                                                <div className="flex justify-between items-center mb-3">
                                                    <div>
                                                        <h3 className="font-black text-slate-800 dark:text-white text-lg">{getDayLabel(day.dayKey || day.dayLabel)}</h3>
                                                        <p className="text-xs text-slate-400 font-bold">{formatUsDateFromIso(day.date)}</p>
                                                    </div>
                                                    <div className={`text-xl font-black ${tNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}>
                                                        {day.total}%
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-2 rounded-lg text-center">
                                                        <span className="text-xs font-bold text-indigo-400 uppercase block mb-1">{t('sales.reports_page.labor_table.morning')}</span>
                                                        <span className={`text-lg font-bold ${mNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                                            {day.morning}%
                                                        </span>
                                                    </div>
                                                    <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-2 rounded-lg text-center">
                                                        <span className="text-xs font-bold text-indigo-400 uppercase block mb-1">{t('sales.reports_page.labor_table.night')}</span>
                                                        <span className={`text-lg font-bold ${nNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                                            {day.night}%
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {/* WEEK SUMMARY CARD */}
                                    <div className="bg-slate-800 text-white rounded-xl shadow-lg border border-slate-700 p-4 mt-2">
                                        {(() => {
                                            const { avgMorning, avgNight, avgTotal } = weeklyLaborLogSummary
                                            const threshold = 21.5

                                            return (
                                                <div className="flex justify-between items-center text-center">
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">{t('sales.reports_page.labor_table.morning')}</span>
                                                        <span className={`font-bold text-lg ${avgMorning > threshold ? 'text-red-400' : 'text-indigo-200'}`}>{avgMorning.toFixed(2)}%</span>
                                                    </div>
                                                    <div className="w-[1px] h-8 bg-slate-600"></div>
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">{t('sales.reports_page.labor_table.night')}</span>
                                                        <span className={`font-bold text-lg ${avgNight > threshold ? 'text-red-400' : 'text-indigo-200'}`}>{avgNight.toFixed(2)}%</span>
                                                    </div>
                                                    <div className="w-[1px] h-8 bg-slate-600"></div>
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">{t('sales.reports_page.weekly_summary')}</span>
                                                        <span className={`font-black text-xl ${avgTotal > threshold ? 'text-red-400' : 'text-white'}`}>{avgTotal.toFixed(2)}%</span>
                                                    </div>
                                                </div>
                                            )
                                        })()}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            // MONTHLY TAB VIEW
                            // MONTHLY TAB VIEW
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                                {/* DESKTOP TABLE */}
                                <div className="hidden md:block max-h-[800px] overflow-x-auto overflow-y-auto custom-scrollbar">
                                    <table className="w-full border-collapse relative">
                                        <thead className="sticky top-0 z-20 shadow-sm">
                                            <tr className="bg-orange-100 dark:bg-orange-900/30">
                                                {MONTHLY_STRUCTURE.map(col => (
                                                    <th key={col.id} className="p-3 text-center text-[10px] font-black text-orange-800 dark:text-orange-200 uppercase tracking-wider border border-orange-200 dark:border-orange-800/50" style={{ width: col.width }}>
                                                        {getMonthlyLabel(col.id, col.label)}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {/* Sort keys to ensure dates order */}
                                            {Object.keys(monthlyData).sort().map((dateKey, idx) => {
                                                const row = monthlyData[dateKey]
                                                // Format Date for display (MM/DD/YY)
                                                // Format Date for display (MM/DD/YY) or (DD/MM/YY)
                                                const [y, m, d] = dateKey.split('-')
                                                const dateDisp = `${m}/${d}/${y}`
                                                const dayOfWeek = new Date(dateKey + 'T12:00:00').getDay()
                                                const isSunday = dayOfWeek === 0 // 0 is Sunday
                                                const isWeekend = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0 // Fri, Sat, Sun

                                                return (
                                                    <tr key={dateKey} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${isWeekend ? 'bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200' : ''} ${isSunday ? 'border-b-4 border-indigo-200' : ''}`}>
                                                        <td className="p-2 text-center text-xs font-bold text-slate-500 border-r border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                                                            {dateDisp}
                                                        </td>
                                                        {MONTHLY_STRUCTURE.slice(1).map(col => (
                                                            <td key={col.id} className="p-1 border border-slate-100 dark:border-slate-800">
                                                                <input
                                                                    type="text"
                                                                    value={row[col.id] || ''}
                                                                    onChange={(e) => handleMonthlyInputChange(dateKey, col.id, e.target.value)}
                                                                    className="w-full h-full p-1 text-center bg-transparent text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-orange-500/50 rounded"
                                                                />
                                                            </td>
                                                        ))}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                        {/* Footer - Monthly Totals (True Weighted Avg Order & SOS Time) */}
                                        <tfoot className="sticky bottom-0 bg-slate-100 dark:bg-slate-800 z-20 font-bold border-t-2 border-slate-200 dark:border-slate-700">
                                            <tr>
                                                <td className="p-3 text-center text-xs">{t('sales.reports_page.controls.total_label')}</td>
                                                {MONTHLY_STRUCTURE.slice(1).map(col => (
                                                    <td key={col.id} className="p-2 text-center text-xs font-mono">
                                                        {getMonthlyFooterValue(col.id, col.type)}
                                                    </td>
                                                ))}
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* MOBILE CARD VIEW */}
                                <div className="md:hidden flex flex-col gap-4 p-3 bg-slate-50 dark:bg-black/20">
                                    {Object.keys(monthlyData).sort().map((dateKey, idx) => {
                                        const row = monthlyData[dateKey]
                                        const [y, m, d] = dateKey.split('-')
                                        const dateDisp = `${m}/${d}/${y}`
                                        const dateObj = new Date(dateKey + 'T12:00:00Z')
                                        const dayOfWeek = dateObj.toLocaleDateString(language === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', timeZone: 'UTC' })
                                        const isSunday = getIsoWeekdayUTC(dateKey) === 0

                                        return (
                                            <div key={dateKey} className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden ${isSunday ? 'ring-2 ring-indigo-200 dark:ring-indigo-900' : ''}`}>
                                                <div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-2 border-b border-orange-100 dark:border-orange-800/30 flex justify-between items-center">
                                                    <h3 className="font-black text-orange-900 dark:text-orange-200 capitalize">{dayOfWeek} {dateDisp}</h3>
                                                    {row.week_sales && (
                                                        <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                                                            {t('sales.reports_page.controls.week_label')}: {row.week_sales}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                                    {MONTHLY_STRUCTURE.slice(1).map(col => {
                                                        if (col.id === 'week_sales') return null // Handled in header

                                                        return (
                                                            <div key={col.id} className="flex flex-col">
                                                                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-0.5">{getMonthlyLabel(col.id, col.label)}</label>
                                                                <input
                                                                    type="text"
                                                                    value={row[col.id] || ''}
                                                                    onChange={(e) => handleMonthlyInputChange(dateKey, col.id, e.target.value)}
                                                                    className="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 text-sm font-semibold text-slate-800 dark:text-slate-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none transition-all"
                                                                    placeholder="-"
                                                                />
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {/* MONTHLY SUMMARY CARD */}
                                    <div className="bg-orange-900 text-white rounded-xl shadow-lg border border-orange-800 p-4 mt-4">
                                        <h3 className="font-black uppercase text-center mb-4 border-b border-orange-800 pb-2">{t('sales.reports_page.monthly_totals')}</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {MONTHLY_STRUCTURE.slice(1).map(col => {
                                                if (col.id === 'week_sales') return null
                                                const disp = getMonthlyFooterValue(col.id, col.type)
                                                if (col.id === 'sos_time' && (!disp || disp === '-')) return null

                                                return (
                                                    <div key={col.id} className="flex justify-between items-center text-sm border-b border-orange-800/50 pb-1 gap-2">
                                                        <span className="text-orange-300 font-medium truncate">{getMonthlyLabel(col.id, col.label)}</span>
                                                        <span className="font-bold font-mono shrink-0">{disp}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="h-96 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/50 px-4 text-center">
                            <Store size={48} className="mb-4 text-slate-300" />
                            <p className="font-medium">
                                {!selectedStore ? t('sales.reports_page.controls.select_store') : t('sales.reports_page.controls.select_date_prompt')}
                            </p>
                        </div>
                    )}
                </div>
            </div>
    )
}

export default function ReportesPage() {
    return (
        <ProtectedRoute allowedRoles={['admin', 'manager', 'supervisor']}>
            <ReportesPageContent />
        </ProtectedRoute>
    )
}
