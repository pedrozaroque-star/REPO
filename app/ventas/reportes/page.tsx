'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Plus, Save, Calendar, Store, Calculator, Clock, CheckCircle } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useSmartProjections } from '@/app/planificador/hooks/useSmartProjections'

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
    { id: 'ebt', label: 'EBT', type: 'number', width: '80px' },
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

export default function ReportesPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)

    // Config State
    const [selectedStore, setSelectedStore] = useState('')
    const [weekDate, setWeekDate] = useState('') // "2026-01-12" (Monday)
    const [stores, setStores] = useState<any[]>([])

    // Data State (Grid)
    // Structure: { monday: { projected_sales: 100, ... }, tuesday: { ... } }
    const [gridData, setGridData] = useState<Record<string, Record<string, any>>>({})
    const [monthlyData, setMonthlyData] = useState<Record<string, any>>({}) // Key: "YYYY-MM-DD"


    // Projection Optimization State
    const [targetLaborPct, setTargetLaborPct] = useState(24)
    const [targetSPLH, setTargetSPLH] = useState(65)

    // Tab State
    const [activeTab, setActiveTab] = useState<'ops' | 'labor' | 'monthly'>('ops')
    const [laborLogData, setLaborLogData] = useState<any[]>([])

    // Load Stores
    useEffect(() => {
        const loadStores = async () => {
            const supabase = await getSupabaseClient()
            const { data } = await supabase.from('stores').select('*').order('name')
            if (data) setStores(data)
        }
        loadStores()
    }, [])

    // Initialize Grid when Week/Store changes
    useEffect(() => {
        if (!weekDate || !selectedStore) return

        // FIX: Ensure we align to Monday even if weekDate is off
        const [y, m, tempD] = weekDate.split('-').map(Number)
        const dateBase = new Date(y, m - 1, tempD, 12, 0, 0, 0)
        const currentDay = dateBase.getDay()
        const distToMon = currentDay === 0 ? -6 : (1 - currentDay)
        dateBase.setDate(dateBase.getDate() + distToMon)
        // dateBase is now strictly Monday 12:00 PM

        const initData: any = {}
        DAYS.forEach((day, i) => {
            initData[day.key] = {}

            // Calculate specific date for this column
            const colDate = new Date(dateBase)
            colDate.setDate(colDate.getDate() + i)
            const dStr = colDate.toISOString().split('T')[0]

            // Store it for fetch reference?
            // Actually, fetchReport uses weekDate directly. 
            // If fetchReport uses Raw weekDate (might be Tuesday), it fetches wrong range.
            // But fetchReport is triggered manually or by tab change.
            // We should auto-correct weekDate state if possible, but that causes loop.
            // Instead, we trust fetchReport will use the same "Snap to Monday" logic.

            REPORT_STRUCTURE.forEach(row => {
                if (row.type !== 'header') initData[day.key][row.id] = ''
            })
        })
        setGridData(initData)

        // Trigger fetch if auto-loading is desired? 
        // Currently fetch is manual button in logic, but let's leave it be.
    }, [selectedStore, weekDate])

    // --- HOOKS ---
    // Initialize Smart Projections logic (Client Side Fallback)
    const { calculateProjections } = useSmartProjections(selectedStore ? stores.find(s => String(s.id) === String(selectedStore))?.external_id : undefined, weekDate ? new Date(weekDate) : new Date())

    // --- REPLICATED LOGIC FROM PLANNER (useWeeklyStats) ---
    const bankersRound = (num: number) => {
        const n = num * 100;
        const i = Math.round(n);
        const remainder = Math.abs(n) % 1;
        if (Math.abs(remainder - 0.5) < 0.0000001) {
            const floor = Math.floor(n);
            return (floor % 2 === 0 ? floor : floor + 1) / 100;
        }
        return Math.round(n) / 100;
    }

    const calcDuration = (s: any) => {
        if (!s.start_time || !s.end_time) return 0;
        const start = new Date(s.start_time);
        const end = new Date(s.end_time);
        let rawDuration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        if (rawDuration < 0) rawDuration += 24;
        // CA Meal Break: required after 5 hours
        return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration);
    }

    const calculateWeekStats = (shifts: any[], employees: any[], jobs: any[]) => {
        const shiftStats: Record<string, any> = {};

        employees.forEach(emp => {
            const empShifts = shifts.filter(s => s.employee_id === emp.id);
            const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

            let regularHoursAccumulator = 0;
            let dailyHoursAccumulator = 0;
            let lastShiftDate = "";

            sorted.forEach(s => {
                const duration = calcDuration(s);
                if (s.shift_date !== lastShiftDate) {
                    dailyHoursAccumulator = 0;
                    lastShiftDate = s.shift_date;
                }

                // 1. Daily OT
                let dailyOT = 0;
                const hoursBeforeThisShift = dailyHoursAccumulator;
                dailyHoursAccumulator += duration;

                if (hoursBeforeThisShift >= 8) {
                    dailyOT = duration;
                } else if (hoursBeforeThisShift + duration > 8) {
                    dailyOT = (hoursBeforeThisShift + duration) - 8;
                }
                const dailyRegular = duration - dailyOT;

                // 2. Weekly OT
                let weeklyOT = 0;
                if (regularHoursAccumulator >= 40) {
                    weeklyOT = dailyRegular;
                } else if (regularHoursAccumulator + dailyRegular > 40) {
                    weeklyOT = (regularHoursAccumulator + dailyRegular) - 40;
                }
                regularHoursAccumulator += (dailyRegular - weeklyOT);

                // Wage Lookup (Simplified to match Script Logic)
                let rate = 16.00;
                if (emp.wage_data && emp.wage_data.length > 0) {
                    // Script blindly takes index 0. We do the same to ensure numbers match.
                    rate = emp.wage_data[0].wage;
                }

                const totalShiftOT = dailyOT + weeklyOT;
                const regularPaid = duration - totalShiftOT;
                const cost = (regularPaid * rate) + (totalShiftOT * rate * 1.5);
                const roundedCost = bankersRound(cost);

                if (s.id) {
                    shiftStats[s.id] = {
                        duration,
                        cost: roundedCost,
                        hours: duration, // alias
                        regularHours: regularPaid,
                        otHours: totalShiftOT
                    };
                }
            });
        });

        // 2. Process Unassigned Shifts (Open Shifts)
        const unassigned = shifts.filter(s => !s.employee_id);
        unassigned.forEach(s => {
            const duration = calcDuration(s);
            // Default rate for open shifts (Budget placeholder)
            const rate = 16.00;
            const cost = bankersRound(duration * rate);

            if (s.id) {
                shiftStats[s.id] = {
                    duration,
                    cost,
                    hours: duration,
                    regularHours: duration,
                    otHours: 0
                }
            }
        });

        return shiftStats;
    }


    // Load Data if exists
    const fetchReport = React.useCallback(async () => {
        if (!weekDate || !selectedStore || stores.length === 0) return
        setLoading(true)
        const supabase = await getSupabaseClient()

        // 2. Resolve Store GUID from numeric ID
        let queryId = ''
        if (selectedStore === 'all') {
            queryId = 'all'
        } else {
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            if (!storeObj?.external_id) {
                console.warn(`⚠️ [REPORT] Waiting for store external_id for '${storeObj?.name || 'Unknown'}'...`)
                setLoading(false)
                return
            }
            queryId = storeObj.external_id
        }

        // Calculate Sunday date (End of Week)
        // ensure we start from MONDAY
        const [y, m, tempD] = weekDate.split('-').map(Number)
        const dateBase = new Date(Date.UTC(y, m - 1, tempD, 12, 0, 0))
        const currentDay = dateBase.getUTCDay()
        const distToMon = currentDay === 0 ? -6 : (1 - currentDay)
        dateBase.setUTCDate(dateBase.getUTCDate() + distToMon)

        // dateBase is now strictly Monday 12:00 PM. Format to YYYY-MM-DD
        const startStr = dateBase.toISOString().split('T')[0]
        const start = new Date(startStr + 'T00:00:00')
        const end = new Date(start)
        end.setDate(start.getDate() + 7)  // Extend by 7 days to fully cover Sunday midnight if needed, but normally +6 is correct for inclusive.
        // Wait, inclusive LTE requires the date strictly.
        // Pure UTC Calculation for End Date (Start + 6 days)
        const [uY, uM, uD] = startStr.split('-').map(Number)
        const utcStartObj = new Date(Date.UTC(uY, uM - 1, uD))
        const utcEndObj = new Date(utcStartObj)
        utcEndObj.setUTCDate(utcEndObj.getUTCDate() + 6)

        const endStr = utcEndObj.toISOString().split('T')[0]

        // Calculate 4 Weeks Lookback Date for Average Calc
        const lookbackStart = new Date(start)
        lookbackStart.setDate(start.getDate() - 35) // 5 Weeks back to be safe
        const lookbackStr = lookbackStart.toISOString().split('T')[0]

        // --- API CALL (BYPASS RLS) ---
        // Use Server-Side API to fetch data with Service Role Key to avoid RLS filtering drafts/unassigned shifts
        const apiUrl = `/api/reports/weekly-ops?storeId=${queryId}&start=${startStr}&end=${endStr}&lookback=${lookbackStr}`
        const apiResponse = await fetch(apiUrl)
        const apiData = await apiResponse.json()

        if (apiData.error) throw new Error(apiData.error)

        const history = apiData.history
        const lookbackHistory = apiData.lookback || []
        const rawAllShifts = apiData.shifts || []
        // With 'all', we don't filter by store_id
        const shifts = selectedStore === 'all' ? rawAllShifts : rawAllShifts.filter((s: any) => s.store_id === queryId)

        const punchesRaw = apiData.punches
        const employees = apiData.employees
        const jobs = apiData.jobs || []
        const budgets = apiData.budgets || []
        const apiShiftStats = apiData.shiftStats || {}

        // --- PRE-CALCULATE WEEKLY STATS (Planner Logic) ---
        // --- PRE-CALCULATE WEEKLY STATS (Planner Logic) ---
        // This ensures OT (daily/weekly) and Meal Breaks are handled exactly like the Budget Tool

        // --- 🚨 CRITICAL FILTERING MATCHING PLANNER AUDIT 🚨 ---
        // 1. Exclude Deleted/Inactive Employees (Camilo, Anabel, Willian, DeletedAt)
        // 2. Exclude Salary Managers (Carlos Velazquez) from Hourly Scheduled Hours/Cost

        const validEmployees = (employees || []).filter((e: any) => {
            // Exclude Soft Delete
            if (e.deleted_at && e.deleted_at.length > 5) return false

            // Exclude Specific Ghosts
            const name = (e.first_name + ' ' + (e.last_name || '')).toLowerCase()
            if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return false

            return true
        })

        // Filter Shifts: Robust Logic matching Script
        const validShifts = shifts.filter((s: any) => {
            // 1. Keep Open Shifts
            if (!s.employee_id) return true

            // 2. Check against RAW list to detect Missing/Filtered
            const rawEmp = employees?.find((e: any) => e.id === s.employee_id)
            if (!rawEmp) {
                // Employee missing from download (RLS? Fetch Limit?). 
                // SAFEGUARD: Include mismatch shifts so we don't lose hours.
                return true
            }

            // 3. Check against FILTERED list
            const isValid = validEmployees.find((e: any) => e.id === s.employee_id)
            if (!isValid) {
                // Employee was explicitly filtered (Ghost/Deleted). Exclude Shift.
                return false
            }

            // 4. Exclude Salary Managers (Carlos Velazquez) specifically
            const name = (rawEmp.first_name + ' ' + (rawEmp.last_name || '')).toLowerCase()
            if (name.includes('carlos velazquez')) return false

            return true
        })

        const weekShiftStats = calculateWeekStats(validShifts, validEmployees, jobs);
        console.log("📊 [REPORT] Calculated Shift Stats for", Object.keys(weekShiftStats).length, "shifts");

        // --- ROBUST PROJECTION MERGING ---
        // 2. Determine Required Dates for this Report Week (Mon -> Sun)
        const requiredKeys: string[] = [];
        const [yStart, mStart, dStart] = startStr.split('-').map(Number); // Use startStr instead of weekDate!

        for (let i = 0; i < 7; i++) {
            const d = new Date(yStart, mStart - 1, dStart + i);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            requiredKeys.push(`${year}-${month}-${day}`);
        }

        let finalProjections: Record<string, string> = {};

        if (selectedStore === 'all') {
            console.log("🧩 [REPORT] Calculating Aggregate Projections for ALL Stores...");

            // Loop through ALL known stores to ensure we cover gaps
            stores.forEach(store => {
                const sId = store.external_id;
                if (!sId) return;

                requiredKeys.forEach(dateKey => {
                    let val = 0;
                    let foundSrc = 'none';

                    // A. Try DB Budget
                    // budgets array contains rows with { sales_projections: { 'YYYY-MM-DD': '123' }, store_id: ... }
                    const budgetRow = budgets.find((b: any) =>
                        b.store_id === sId &&
                        b.sales_projections &&
                        b.sales_projections[dateKey]
                    );

                    if (budgetRow) {
                        val = parseFloat(budgetRow.sales_projections[dateKey]);
                        foundSrc = 'db';
                    } else {
                        // B. Fallback: Average of Lookback (Same Day of Week)
                        // lookbackHistory contains { business_date, net_sales, store_id }
                        const targetDow = new Date(dateKey + 'T12:00:00').getDay();
                        const historyRows = lookbackHistory.filter((h: any) =>
                            h.store_id === sId &&
                            new Date(h.business_date + 'T12:00:00').getDay() === targetDow &&
                            Number(h.net_sales) > 100 // Basic validity check
                        );

                        // Sort desc by date and take recent 4
                        const recent = historyRows.sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime()).slice(0, 4);

                        if (recent.length > 0) {
                            const sum = recent.reduce((acc: number, r: any) => acc + (Number(r.net_sales) || 0), 0);
                            val = sum / recent.length;
                            foundSrc = `avg(${recent.length})`;
                        }
                    }

                    // Accumulate
                    if (val > 0) {
                        const current = parseFloat(finalProjections[dateKey] || '0');
                        finalProjections[dateKey] = String(current + val);
                    }
                });
            });

        } else {
            // SINGLE STORE LOGIC (Existing)

            // 1. Flatten found budgets
            let mergedDbProjections: Record<string, string> = {};
            if (budgets && Array.isArray(budgets)) {
                budgets.forEach((b: any) => {
                    if (b.sales_projections) {
                        Object.keys(b.sales_projections).forEach(key => {
                            mergedDbProjections[key] = b.sales_projections[key];
                        });
                    }
                });
            }

            const missingKeys = requiredKeys.filter(key => !mergedDbProjections[key]);
            const needsBackfill = missingKeys.length > 0;
            finalProjections = { ...mergedDbProjections };

            if (needsBackfill && calculateProjections) {
                console.log(`⚠️ [REPORT] Missing Projections for: ${missingKeys.join(', ')}. Auto-Calculating full week...`)
                const calculated = await calculateProjections()
                if (calculated && Object.keys(calculated).length > 0) {
                    finalProjections = { ...calculated, ...mergedDbProjections }; // DB overwrites Calc
                }
            }
        }

        const salesProjections = finalProjections

        console.log("🔍 [DEBUG] Final Used Projections:", salesProjections)
        console.log("🔍 [DEBUG] Query Keys:", { queryId, weekDate })

        // Find Store Manager (any shift with Title "Manager" in this store this week)
        const managerShift = shifts?.find((s: any) => {
            const j = jobs.find((job: any) => job.id === s.job_id)
            return j?.title === 'Manager'
        })
        const managerEmp = managerShift ? employees.find((e: any) => e.id === managerShift.employee_id) : null
        const globalManagerName = managerEmp
            ? (managerEmp.chosen_name || `${managerEmp.first_name} ${managerEmp.last_name || ''}`)
            : ''

        console.log(`✅ [REPORT] Data Loaded: ${history?.length || 0} history, ${shifts?.length || 0} shifts, ${punchesRaw?.length || 0} punches`)
        console.log(`👤 [REPORT] Detected Manager: ${globalManagerName || 'None'}`)

        // 5. Merge Strategies
        const newGrid: any = {}
        const weekLaborLog: any[] = []

        DAYS.forEach((day, i) => {
            // CRITICAL: Use local date formatting to avoid UTC offset issues
            // weekDate is already "YYYY-MM-DD", so we parse it properly
            // Calculate Current Date Key using CORRECTED startStr (Monday)
            // This ensures Body alignment matches Header alignment
            const [sY, sM, sD] = startStr.split('-').map(Number)
            const current = new Date(Date.UTC(sY, sM - 1, sD + i, 12, 0, 0))
            const dateStr = current.toISOString().split('T')[0]

            // --- LABOR LOG CALCULATION (AM/PM SPLIT) ---
            // AGGREGATION: Find ALL matching history records for this date
            const dayHistories = history?.filter((h: any) => h.business_date === dateStr) || []

            // Calc Hourly Sales Sum for AM/PM split logic
            let hourlySalesSum: Record<string, number> = {}
            dayHistories.forEach((h: any) => {
                const hourly = h.hourly_data || {}
                Object.keys(hourly).forEach(k => {
                    hourlySalesSum[k] = (hourlySalesSum[k] || 0) + Number(hourly[k] || 0)
                })
            })

            const hourlySales = hourlySalesSum

            // Morning Sales (6 AM to 4:59 PM -> indices 6-16)
            let morningSales = 0
            for (let h = 6; h <= 16; h++) morningSales += Number(hourlySales[h] || 0)

            // Night Sales (5 PM to 5:59 AM next day -> indices 17-23, 0-5)
            let nightSales = 0
            for (let h = 17; h <= 23; h++) nightSales += Number(hourlySales[h] || 0)
            for (let h = 0; h <= 5; h++) nightSales += Number(hourlySales[h] || 0)

            // Labor Cost Split
            const dayPunches = punchesRaw?.filter((p: any) => p.business_date === dateStr) || []
            const targetDayIndex = new Date(dateStr + 'T12:00:00').getDay()
            let morningLaborCost = 0
            let nightLaborCost = 0

            dayPunches.forEach((p: any) => {
                const emp = employees?.find((e: any) => e.toast_guid === p.employee_toast_guid)
                const wageEntry = emp?.wage_data?.find((w: any) => w.job_guid === p.job_toast_guid) || emp?.wage_data?.[0]
                const hourlyRate = wageEntry?.wage || 16.5 // Default fallback

                const reg = Number(p.regular_hours || 0)
                const ot = Number(p.overtime_hours || 0)
                const totalPunchCost = (reg * hourlyRate) + (ot * hourlyRate * 1.5)

                // Temporal split logic
                if (p.clock_in && p.clock_out) {
                    const start = new Date(p.clock_in)
                    const end = new Date(p.clock_out)
                    const totalMs = end.getTime() - start.getTime()
                    if (totalMs <= 0) return

                    // AM Window: [BusinessDate 06:00, BusinessDate 17:00]
                    const amStart = new Date(dateStr + 'T06:00:00')
                    const amEnd = new Date(dateStr + 'T17:00:00')

                    // PM Window: [BusinessDate 17:00, BusinessDate+1 06:00]
                    const pmStart = new Date(dateStr + 'T17:00:00')
                    const pmEnd = new Date(amStart)
                    pmEnd.setDate(pmEnd.getDate() + 1)

                    const intersect = (s1: Date, e1: Date, s2: Date, e2: Date) => {
                        const s = Math.max(s1.getTime(), s2.getTime())
                        const e = Math.min(e1.getTime(), e2.getTime())
                        return Math.max(0, e - s)
                    }

                    const amMs = intersect(start, end, amStart, amEnd)
                    const pmMs = intersect(start, end, pmStart, pmEnd)
                    const totalIntersect = amMs + pmMs

                    if (totalIntersect > 0) {
                        morningLaborCost += totalPunchCost * (amMs / totalMs)
                        nightLaborCost += totalPunchCost * (pmMs / totalMs)
                    } else {
                        // If entirely outside both (rare for business day logic), assume PM if h < 6, else AM
                        if (start.getHours() < 6) nightLaborCost += totalPunchCost
                        else morningLaborCost += totalPunchCost
                    }
                } else {
                    // Fallback if no timestamps
                    morningLaborCost += totalPunchCost * 0.5
                    nightLaborCost += totalPunchCost * 0.5
                }
            })

            const morningPct = morningSales > 0 ? (morningLaborCost / morningSales) * 100 : 0
            const nightPct = nightSales > 0 ? (nightLaborCost / nightSales) * 100 : 0
            const totalPct = (morningSales + nightSales) > 0 ? ((morningLaborCost + nightLaborCost) / (morningSales + nightSales)) * 100 : 0

            weekLaborLog.push({
                date: dateStr,
                dayLabel: day.label,
                morning: morningPct.toFixed(2),
                night: nightPct.toFixed(2),
                total: totalPct.toFixed(2)
            })

            // --- OPERATIONS REPORT (Existing Grid) ---

            // A. Base (pure defaults)
            let cellData: any = {}

            // B. Calculate Scheduled Hours AND Overtime from Shifts (Planificador)
            const daysShifts = shifts?.filter((s: any) => s.shift_date === dateStr) || []

            let totalSched = 0
            let totalOT = 0
            let totalSchedCost = 0

            // Find Leaders for this day (In-Memory Lookup)
            const getJobTitle = (jid: string) => jobs?.find((j: any) => j.id === jid)?.title || ''
            const getEmpName = (eid: string) => {
                const e = employees?.find((emp: any) => emp.id === eid)
                return e ? (e.chosen_name || e.first_name) : ''
            }

            const amAsst = daysShifts.find((s: any) =>
                getJobTitle(s.job_id) === 'Asst Manager' &&
                new Date(s.start_time).getHours() < 12
            )
            const pmAsst = daysShifts.find((s: any) =>
                getJobTitle(s.job_id) === 'Asst Manager' &&
                new Date(s.start_time).getHours() >= 12
            )

            const morningLeaderName = amAsst ? getEmpName(amAsst.employee_id) : globalManagerName
            const lateLeaderName = pmAsst ? getEmpName(pmAsst.employee_id) : globalManagerName

            // USE ACCURATE STATS (SERVER SIDE VERIFIED)
            daysShifts.forEach((s: any) => {
                const stat = apiShiftStats[s.id];
                if (stat) {
                    // If server calculated stats for this shift, use them directly
                    totalSched += stat.hours;
                    totalOT += stat.otHours;
                    totalSchedCost += stat.cost;
                }
            })

            // Get Projection for this day (Planificador saves keys as YYYY-MM-DD, and value as string "12345")
            // salesProjections is { "2026-01-26": "12500", ... }
            let rawProj = salesProjections[dateStr]
            const projSales = Number(rawProj || 0)


            // --- TARGET AVG ORDER CALCULATION ---
            // Heuristic: Average Ticket of the last 4 matching weekdays from FULL history cache (including lookback)
            const matchingHistory = (lookbackHistory || []).filter((h: any) => {
                // Ensure valid date parsing
                const hd = new Date(h.business_date + 'T12:00:00')
                return hd.getDay() === targetDayIndex && Number(h.order_count) > 0
            })
                // Sort recent first
                .sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())
                // Take last 4 weeks
                .slice(0, 4)

            let targetAvgOrder = 0
            if (matchingHistory.length > 0) {
                const totalSales = matchingHistory.reduce((a: number, b: any) => a + (Number(b.net_sales) || 0), 0)
                const totalOrders = matchingHistory.reduce((a: number, b: any) => a + (Number(b.order_count) || 0), 0)
                if (totalOrders > 0) targetAvgOrder = totalSales / totalOrders
            }

            const projAvg = targetAvgOrder
            const projLaborPct = projSales > 0 ? ((totalSchedCost / projSales) * 100).toFixed(2) : ''


            // D. Get Actual Overtime from Punches
            const actualOT = dayPunches.reduce((sum: number, p: any) => sum + (Number(p.overtime_hours) || 0), 0)

            // C. Overlay System Data (AGGREGATED)
            // We already have dayHistories from Labor Log section
            const sysData = dayHistories.length > 0 ? {
                net_sales: dayHistories.reduce((a: number, b: any) => a + (b.net_sales || 0), 0),
                labor_hours: dayHistories.reduce((a: number, b: any) => a + (b.labor_hours || 0), 0),
                labor_cost: dayHistories.reduce((a: number, b: any) => a + (b.labor_cost || 0), 0),
                order_count: dayHistories.reduce((a: number, b: any) => a + (b.order_count || 0), 0),
            } : null

            // Formatter
            const formatCurrency = (val: number) => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

            // 1. ALWAYS Assign Projections (Base Layer)
            cellData = {
                ...cellData,
                projected_sales: projSales > 0 ? formatCurrency(projSales) : '',
                projected_labor: projLaborPct ? projLaborPct + '%' : '',
                target_avg_order: projAvg > 0 ? formatCurrency(projAvg) : '',
                scheduled_hours: totalSched.toFixed(2),
                overtime_hours: actualOT > 0 ? actualOT.toFixed(2) : (totalOT > 0 ? totalOT.toFixed(2) : ''),
                morning_leader: cellData.morning_leader || morningLeaderName,
                late_leader: cellData.late_leader || lateLeaderName,
                daily_cars: cellData.daily_cars || 'pendiente',
                sos_time: cellData.sos_time || 'pendiente'
            }

            // 2. Overlay Actuals (If available)
            if (sysData) {
                const sales = sysData.net_sales || 0
                const hours = sysData.labor_hours || 0
                const laborCost = sysData.labor_cost || 0
                const orders = sysData.order_count || 0
                const laborPct = sales > 0 ? ((laborCost / sales) * 100).toFixed(2) : '0.00'

                cellData = {
                    ...cellData,
                    actual_sales: formatCurrency(sales),
                    actual_hours: hours.toFixed(2),
                    actual_labor: laborPct + '%',
                    actual_avg_order: orders > 0 ? formatCurrency(sales / orders) : '$0.00',
                }
            } else {
                // Explicit empties for Actuals
                cellData = {
                    ...cellData,
                    actual_sales: '',
                    actual_hours: '',
                    actual_labor: '',
                    actual_avg_order: '',
                }
            }
            newGrid[day.key] = cellData
        })



        setGridData(newGrid)
        setLaborLogData(weekLaborLog)
        setLoading(false)
    }, [selectedStore, weekDate, stores])

    useEffect(() => {
        fetchReport()
    }, [fetchReport])


    // --- MONTHLY REPORT LOGIC ---

    const fetchMonthlyReport = async () => {
        if (!weekDate || !selectedStore) return

        // Derive Month from weekDate (assuming weekDate represents the month we want? No, user usually selects a month)
        // Ideally we need a Month Picker. For now, we'll use the Month of the selected WeekDate.
        const targetMonth = weekDate.substring(0, 7) // "2026-01"
        const [y, m] = targetMonth.split('-').map(Number)

        // Calc start/end of month
        const startOfMonth = new Date(y, m - 1, 1)
        const endOfMonth = new Date(y, m, 0)

        const startStr = startOfMonth.toISOString().split('T')[0]
        const endStr = endOfMonth.toISOString().split('T')[0]

        setLoading(true)
        const supabase = await getSupabaseClient()
        // 2. Resolve Store Query
        let salesData: any[] = []

        if (selectedStore === 'all') {
            const { data, error } = await supabase
                .from('sales_daily_cache')
                .select('*')
                .gte('business_date', startStr)
                .lte('business_date', endStr)

            if (!error && data) salesData = data
        } else {
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            if (!storeObj?.external_id) {
                setLoading(false)
                return
            }
            const queryId = storeObj.external_id

            // Fetch Sales Cache for Month
            const { data, error } = await supabase
                .from('sales_daily_cache')
                .select('*')
                .eq('store_id', queryId)
                .gte('business_date', startStr)
                .lte('business_date', endStr)

            if (!error && data) salesData = data
        }

        const newMonthly: any = {}
        const daysInMon = endOfMonth.getDate()

        for (let d = 1; d <= daysInMon; d++) {
            const dateObj = new Date(y, m - 1, d)
            const dateKey = dateObj.toISOString().split('T')[0]

            // Find rows for this date
            const dayRows = salesData.filter((s: any) => s.business_date === dateKey)

            // AGGREGATE IF MULTIPLE ROWS (ALL STORES)
            let sysData = {
                net_sales: 0,
                order_count: 0,
                act_avg_order: 0,
                open_sales: 0,
                close_sales: 0,
                uber_sales: 0,
                doordash_sales: 0,
                grubhub_sales: 0,
                ebt_count: 0
            }

            if (dayRows.length > 0) {
                dayRows.forEach(r => {
                    sysData.net_sales += (r.net_sales || 0)
                    sysData.order_count += (r.order_count || 0)
                    sysData.open_sales += (r.open_sales || 0)
                    sysData.close_sales += (r.close_sales || 0)
                    sysData.uber_sales += (r.uber_sales || 0)
                    sysData.doordash_sales += (r.doordash_sales || 0)
                    sysData.grubhub_sales += (r.grubhub_sales || 0)
                    sysData.ebt_count += (r.ebt_count || 0)
                })
                // Recalc Avg Order globally
                sysData.act_avg_order = sysData.order_count > 0 ? (sysData.net_sales / sysData.order_count) : 0
            }


            // Default Structure
            newMonthly[dateKey] = {
                date: dateKey,
                actual_sales: '',
                open_sales: '',
                close_sales: '',
                actual_avg_order: '',
                uber_post: '',
                doordash: '',
                grubhub: '',
                ebt: '',
                daily_cars: '',
                sos_time: '',
                week_sales: '',
            }

            if (dayRows.length > 0) {
                // Populate from Cache if available
                const formatCurrency = (val: number) => val ? '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''

                newMonthly[dateKey] = {
                    ...newMonthly[dateKey],
                    actual_sales: formatCurrency(sysData.net_sales),
                    daily_cars: sysData.order_count || '',
                    actual_avg_order: formatCurrency(sysData.act_avg_order),

                    // New Fields
                    open_sales: formatCurrency(sysData.open_sales),
                    close_sales: formatCurrency(sysData.close_sales),
                    uber_post: formatCurrency(sysData.uber_sales),
                    doordash: formatCurrency(sysData.doordash_sales),
                    grubhub: formatCurrency(sysData.grubhub_sales),
                    ebt: sysData.ebt_count || ''
                }
            }
        }
        setMonthlyData(newMonthly)

        // Compute Weekly Totals (Post-Process)
        setMonthlyData(prev => {
            const next = { ...prev }
            Object.keys(next).sort().forEach(dateKey => {
                const date = new Date(dateKey + 'T12:00:00')
                if (date.getDay() === 0) { // Sunday
                    let sum = 0
                    for (let i = 0; i < 7; i++) {
                        const d = new Date(date)
                        d.setDate(d.getDate() - i)
                        const k = d.toISOString().split('T')[0]
                        if (next[k]) {
                            const val = parseFloat(String(next[k].actual_sales).replace(/[^0-9.-]+/g, "") || '0')
                            sum += val
                        }
                    }
                    next[dateKey] = {
                        ...next[dateKey],
                        week_sales: sum > 0 ? '$' + sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
                    }
                }
            })
            return next
        })
        setLoading(false)
    }

    // Effect for Monthly
    useEffect(() => {
        if (activeTab === 'monthly') {
            fetchMonthlyReport()
        }
    }, [activeTab, selectedStore, weekDate])


    const handleMonthlyAutoFill = async () => {
        if (!selectedStore || !weekDate) {
            alert('Selecciona Tienda y una fecha dentro del mes deseado')
            return
        }
        const confirmFill = confirm('¿Conectar a Toast y obtener reporte mensual completo (Ventas, Apps, EBT)?\nEsto puede tardar unos segundos.')
        if (!confirmFill) return

        setLoading(true)
        try {
            // Determine Month Range
            const targetMonth = weekDate.substring(0, 7) // "2026-01"
            const [y, m] = targetMonth.split('-').map(Number)

            const startOfMonth = new Date(y, m - 1, 1)
            const endOfMonth = new Date(y, m, 0)

            const startStr = startOfMonth.toISOString().split('T')[0]
            const endStr = endOfMonth.toISOString().split('T')[0]

            const res = await fetch(`/api/ventas/autofill?storeId=${selectedStore}&start=${startStr}&end=${endStr}`)
            const json = await res.json()
            if (json.error) throw new Error(json.error)

            // Merge
            setMonthlyData(prev => {
                const next = { ...prev }
                Object.keys(json.data).forEach(dateStr => {
                    // Update matching date
                    const row = json.data[dateStr]

                    // Helper: Format
                    const fmt = (val: any, pre: string = '') => {
                        const n = parseFloat(val)
                        if (isNaN(n)) return ''
                        // Show 0.00 to indicate successful fetch
                        return pre + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    }

                    if (!next[dateStr]) next[dateStr] = { date: dateStr } // Init if missing

                    next[dateStr] = {
                        ...next[dateStr],
                        actual_sales: fmt(row.actual_sales, '$'),
                        open_sales: fmt(row.open_sales, '$'),
                        close_sales: fmt(row.close_sales, '$'),
                        actual_avg_order: fmt(row.actual_avg_order, '$'),
                        uber_post: fmt(row.uber_post, '$'),
                        doordash: fmt(row.doordash, '$'),
                        grubhub: fmt(row.grubhub, '$'),
                        ebt: row.ebt === '0' ? '' : row.ebt,
                        daily_cars: row.daily_cars === '0' ? '' : row.daily_cars,
                    }
                })

                // Re-calc Weekly Totals
                Object.keys(next).sort().forEach(dateKey => {
                    const date = new Date(dateKey + 'T12:00:00')
                    if (date.getDay() === 0) { // Sunday
                        let sum = 0
                        for (let i = 0; i < 7; i++) {
                            const d = new Date(date)
                            d.setDate(d.getDate() - i)
                            const k = d.toISOString().split('T')[0]
                            if (next[k]) {
                                const val = parseFloat(String(next[k].actual_sales).replace(/[^0-9.-]+/g, "") || '0')
                                sum += val
                            }
                        }
                        next[dateKey] = {
                            ...next[dateKey],
                            week_sales: sum > 0 ? '$' + sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
                        }
                    }
                })

                return next
            })
            alert('Reporte Mensual actualizado 📊')

        } catch (e: any) {
            console.error(e)
            alert('Error: ' + e.message)
        } finally {
            setLoading(false)
        }
    }



    const saveMonthlyReport = async () => {
        if (!selectedStore || !weekDate) return
        setLoading(true)
        try {
            const supabase = await getSupabaseClient()
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            const storeId = storeObj?.external_id

            if (!storeId) throw new Error("Store ID not found")

            // Current Month Range
            const targetMonth = weekDate.substring(0, 7) // "2026-01"
            const upsertData = Object.values(monthlyData)
                .filter((row: any) => row.date.startsWith(targetMonth)) // Safety filter
                .map((row: any) => {
                    const sales = parseNumber(row.actual_sales)
                    // If no sales, probably empty row, but we might want to save manual entries?
                    // Let's save if date is valid.

                    return {
                        store_id: storeId,
                        store_name: storeObj.name,
                        business_date: row.date,
                        net_sales: sales,
                        order_count: parseNumber(row.daily_cars),

                        // New Columns
                        uber_sales: parseNumber(row.uber_post),
                        doordash_sales: parseNumber(row.doordash),
                        grubhub_sales: parseNumber(row.grubhub),
                        ebt_count: parseNumber(row.ebt),
                        open_sales: parseNumber(row.open_sales),
                        close_sales: parseNumber(row.close_sales),

                        updated_at: new Date().toISOString()
                    }
                })

            const { error } = await supabase.from('sales_daily_cache').upsert(upsertData, { onConflict: 'store_id,business_date' })
            if (error) throw error

            alert('Reporte Mensual Guardado en Supabase 💾')
        } catch (e: any) {
            console.error(e)
            alert('Error guardando: ' + e.message)
        } finally {
            setLoading(false)
        }
    }


    const handleMonthlyInputChange = (dateKey: string, colId: string, val: string) => {
        setMonthlyData(prev => ({
            ...prev,
            [dateKey]: {
                ...prev[dateKey],
                [colId]: val
            }
        }))
    }



    const handleAutoFill = async () => {
        if (!selectedStore || !weekDate) {
            alert('Selecciona Tienda y Semana primero')
            return
        }

        const confirmFill = confirm('¿Conectar a Toast y sobrescribir datos reales (Ventas, Labor, etc)?')
        if (!confirmFill) return

        setLoading(true)
        try {
            // Calculate End Date (Sunday)
            const start = new Date(weekDate + 'T00:00:00')
            const end = new Date(start)
            end.setDate(start.getDate() + 6)
            const endStr = end.toISOString().split('T')[0]

            const res = await fetch(`/api/ventas/autofill?storeId=${selectedStore}&start=${weekDate}&end=${endStr}`)
            const json = await res.json()

            if (json.error) throw new Error(json.error)

            // Merge with current grid
            setGridData(prev => {
                const next = { ...prev }
                Object.keys(json.data).forEach(dateStr => {
                    // Find which "dayKey" this date belongs to
                    // Logic: Compare dateStr with calculated dates for monday..sunday
                    DAYS.forEach((day, i) => {
                        const d = new Date(weekDate + 'T00:00:00')
                        d.setDate(d.getDate() + i)
                        const dStr = d.toISOString().split('T')[0]

                        if (dStr === dateStr) {
                            // Found match, update fields
                            // Only update ACTUAL fields, keep projected/scheduled intact
                            next[day.key] = {
                                ...next[day.key],
                                ...json.data[dateStr]
                            }
                        }
                    })
                })
                return next
            })
            alert('Datos sincronizados con Toast exitosamente 🍞✅')

        } catch (e: any) {
            console.error(e)
            alert('Error al sincronizar: ' + e.message)
        } finally {
            setLoading(false)
        }
    }


    // CALCULATION LOGIC
    const parseNumber = (val: string | number) => {
        if (!val) return 0
        if (typeof val === 'number') return val
        // Remove commas, currency symbols, and %
        const clean = String(val).replace(/,/g, '').replace(/\$/g, '').replace(/%/g, '')
        return parseFloat(clean) || 0
    }

    const getCellValue = (dayKey: string, rowId: string) => {
        const dayData = gridData[dayKey] || {}

        const getRaw = (id: string) => dayData[id] || ''

        // Computed Rows
        if (rowId === 'diff_sales') {
            const proj = parseNumber(getRaw('projected_sales'))
            const act = parseNumber(getRaw('actual_sales'))
            if (act === 0 || proj === 0) return ''
            return (act - proj).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
        if (rowId === 'diff_hours') {
            const sched = parseNumber(getRaw('scheduled_hours'))
            const act = parseNumber(getRaw('actual_hours'))
            if (act === 0 || sched === 0) return ''
            return (act - sched).toFixed(2) // Hours usually 2 digits
        }
        if (rowId === 'diff_avg_order' || rowId === 'diff_avg') {
            const target = parseNumber(getRaw('target_avg_order'))
            const act = parseNumber(getRaw('actual_avg_order'))
            if (act === 0 || target === 0) return ''
            return (act - target).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
        if (rowId === 'diff_labor') {
            const proj = parseNumber(getRaw('projected_labor'))
            const act = parseNumber(getRaw('actual_labor'))
            if (act === 0 || proj === 0) return ''
            return (act - proj).toFixed(2)
        }

        return dayData[rowId] || ''
    }

    const handleInputChange = (dayKey: string, rowId: string, val: string) => {
        setGridData(prev => ({
            ...prev,
            [dayKey]: {
                ...prev[dayKey],
                [rowId]: val
            }
        }))
    }

    // Format on Blur
    const handleInputBlur = (dayKey: string, rowId: string, val: string) => {
        const num = parseNumber(val)
        if (num === 0 && val === '') return

        // Check Row Type to decide formatting
        const row = REPORT_STRUCTURE.find(r => r.id === rowId)
        if (!row) return

        let formatted = val
        if (row.type === 'currency') {
            formatted = '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        } else if (row.type === 'percent') {
            formatted = num.toFixed(2) + '%'
        } else if (row.type === 'number') {
            // Check if it's integer-like or float
            formatted = num.toLocaleString('en-US', { maximumFractionDigits: 2 })
        }

        if (formatted !== val) {
            handleInputChange(dayKey, rowId, formatted)
        }
    }

    // Styles for computed cells
    const getComputedStyle = (val: string | number, inverse: boolean = false) => {
        if (!val) return 'text-slate-400'
        const num = parseNumber(val)
        if (num === 0) return 'text-slate-400'

        if (inverse) {
            // Negative is Good (Green), Positive is Bad (Red) -- e.g. Labor % or Hours
            return num < 0 ? 'text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-600 font-bold bg-rose-50 dark:bg-rose-900/20'
        }
        // Positive is Good (Green) -- e.g. Sales
        return num > 0 ? 'text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-600 font-bold bg-rose-50 dark:bg-rose-900/20'
    }



    // ... (rest of the file)
    // We need to find where the grid is rendered to add the visual.
    // Looking at the file content provided previously, the render logic is likely below.
    // I entered 'replace_file_content' but I can't see the render logic in lines 850-950.
    // I will cancel this replace and view the render logic first.


    const calculateWeekTotal = (rowId: string, type: string) => {
        if (type === 'text' || type === 'time' || type === 'header') return ''
        let sum = 0
        let count = 0
        DAYS.forEach(day => {
            const val = parseNumber(getCellValue(day.key, rowId))
            if (val !== 0) {
                sum += val
                count++
            }
        })

        if (type === 'percent' && count > 0) return (sum / count).toFixed(2) + '%'
        if (type === 'currency') return '$' + sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return sum.toLocaleString('en-US', { maximumFractionDigits: 2 })
    }


    const handleWeekDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.value) {
            setWeekDate('')
            return
        }

        // If Monthly Tab, we allow any date selection but we treat it as month selection.
        if (activeTab === 'monthly') {
            // Just take the value as is (YYYY-MM) and append -01
            const val = e.target.value // "2026-01"
            setWeekDate(val + '-01')
            return
        }

        const selectedDate = new Date(e.target.value + 'T12:00:00') // Use noon to avoid timezone rolling
        const day = selectedDate.getDay()
        // 0=Sun, 1=Mon...6=Sat
        // If Sunday(0), back 6 days. Else back (day-1) days.
        // Target: Monday
        const diff = selectedDate.getDate() - day + (day === 0 ? -6 : 1)
        selectedDate.setDate(diff)
        const mondayStr = selectedDate.toISOString().split('T')[0]
        setWeekDate(mondayStr)
    }

    return (
        <ProtectedRoute allowedRoles={['admin', 'manager', 'supervisor']}>
            <div className="min-h-screen bg-slate-50/50 dark:bg-[#0a0a0a] p-2 md:p-6 pb-32">
                {/* 🚨 DEBUG PANEL TO DIAGNOSE DATA LOSS 🚨 */}
                {/* DEBUG PANEL REMOVED */}
                <div className="max-w-[1800px] mx-auto space-y-6">

                    {/* Header Controls */}
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center gap-4 sticky top-0 z-30">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                                <FileText size={24} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {activeTab === 'ops' ? 'Weekly Operations Report' : 'Week Labor Log'}
                                </h1>
                                <p className="text-xs text-slate-500">Edición Digital</p>
                            </div>
                        </div>

                        {/* Tab Switcher */}
                        <div className="flex w-full md:w-auto justify-center md:justify-start overflow-x-auto bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 md:ml-4">
                            <button
                                onClick={() => setActiveTab('ops')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'ops' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Operations
                            </button>
                            <button
                                onClick={() => setActiveTab('labor')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'labor' ? 'bg-white dark:bg-slate-800 text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Labor Log
                            </button>
                            <button
                                onClick={() => setActiveTab('monthly')}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'monthly' ? 'bg-white dark:bg-slate-800 text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Monthly
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
                                <option value="" className="text-slate-500 bg-white">Seleccionar Tienda</option>
                                <option value="all" className="bg-indigo-600 text-white font-black uppercase tracking-wider">🌟 TODAS LAS TIENDAS</option>
                                {stores.map(s => <option key={s.id} value={s.id} className="text-slate-900 bg-white">{formatStoreName(s.name)}</option>)}
                            </select>



                            <div className="flex items-center bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-1">
                                <select
                                    className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none px-3 py-1.5 cursor-pointer max-w-[140px]"
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === 'custom') return;

                                        const now = new Date();
                                        const getMonday = (d: Date) => {
                                            const day = d.getDay();
                                            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                                            const monday = new Date(d);
                                            monday.setDate(diff);
                                            return monday;
                                        };

                                        let newDate = '';
                                        if (val === 'this_week') {
                                            const m = getMonday(new Date());
                                            newDate = m.toISOString().split('T')[0];
                                            setActiveTab('ops'); // Auto-switch to Ops for weekly views
                                        } else if (val === 'last_7_days') { // Last 7 Days logic (Custom range? Standardizing to Last Week for now or literally last 7 days?) 
                                            // For 'Last 7 Days', usually implies rolling window. But report structure is fixed Mon-Sun.
                                            // Let's treat it as 'Last Week' alias or previous 7 days from today?
                                            // User asked for "Last 7 Days". Let's map it to "Last Week" logic for grid consistency or implement rolling?
                                            // Grid is Mon-Sun. Let's map to Last Week to keep grid safe.
                                            const d = new Date();
                                            d.setDate(d.getDate() - 7);
                                            const m = getMonday(d);
                                            newDate = m.toISOString().split('T')[0];
                                            setActiveTab('ops');
                                        } else if (val === 'last_week') {
                                            // FIXED: Get PREVIOUS week's Monday
                                            // 1. Get THIS week's Monday
                                            const thisMonday = getMonday(new Date());
                                            // 2. Go back 7 days to get LAST week's Monday
                                            thisMonday.setDate(thisMonday.getDate() - 7);
                                            // Format in local time to avoid UTC offset
                                            const y = thisMonday.getFullYear();
                                            const month = String(thisMonday.getMonth() + 1).padStart(2, '0');
                                            const day = String(thisMonday.getDate()).padStart(2, '0');
                                            newDate = `${y}-${month}-${day}`;
                                            setActiveTab('ops');
                                        } else if (val === 'this_month') {
                                            const y = now.getFullYear();
                                            const m = String(now.getMonth() + 1).padStart(2, '0');
                                            newDate = `${y}-${m}-01`;
                                            setActiveTab('monthly');
                                        } else if (val === 'last_month') {
                                            now.setMonth(now.getMonth() - 1); // Go back 1 month
                                            const y = now.getFullYear();
                                            const m = String(now.getMonth() + 1).padStart(2, '0');
                                            newDate = `${y}-${m}-01`;
                                            setActiveTab('monthly');
                                        }

                                        if (newDate) setWeekDate(newDate);
                                    }}
                                    defaultValue="custom"
                                >
                                    <option value="custom" disabled hidden>Select Range</option>
                                    <option value="this_week">This Week</option>
                                    <option value="last_7_days">Last 7 Days</option>
                                    <option value="last_week">Last Week</option>
                                    <option value="this_month">This Month</option>
                                    <option value="last_month">Last Month</option>
                                    <option value="custom">Custom Date</option>
                                </select>

                                <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1"></div>

                                <div className="relative group px-2">
                                    <Calendar size={18} className="text-slate-400 group-hover:text-indigo-500 transition-colors cursor-pointer" />
                                    {activeTab === 'monthly' ? (
                                        <input
                                            type="month"
                                            value={weekDate ? weekDate.substring(0, 7) : ''}
                                            onChange={handleWeekDateChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            title="Seleccionar Mes"
                                        />
                                    ) : (
                                        <input
                                            type="date"
                                            value={weekDate}
                                            onChange={handleWeekDateChange}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            title="Seleccionar Fecha Específica"
                                        />
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1"></div>

                        {/* Actions */}
                        {activeTab === 'ops' && (
                            <div className="flex items-center gap-2">
                                {/* Buttons Removed as requested */}
                            </div>
                        )}

                        {activeTab === 'labor' && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={fetchReport}
                                    disabled={loading || !selectedStore || !weekDate}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-bold hover:bg-emerald-200 transition-colors disabled:opacity-50"
                                >
                                    <Calculator size={16} /> Actualizar Datos
                                </button>
                            </div>
                        )}

                        {activeTab === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={saveMonthlyReport}
                                    disabled={loading || !selectedStore || !weekDate || selectedStore === 'all'}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors disabled:opacity-50"
                                >
                                    <Save size={16} /> Save
                                </button>
                                <button
                                    onClick={handleMonthlyAutoFill}
                                    disabled={loading || !selectedStore || !weekDate || selectedStore === 'all'}
                                    className="flex items-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-xl text-xs font-bold hover:bg-orange-200 transition-colors disabled:opacity-50"
                                >
                                    <Clock size={16} /> Sync Toast Month
                                </button>
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="h-96 flex flex-col items-center justify-center text-slate-400 animate-pulse bg-white/50 dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-slate-800">
                            <Clock size={48} className="mb-4 animate-spin" />
                            <p className="font-bold">Procesando datos del sistema...</p>
                            <p className="text-xs">Sincronizando Ventas y Labor AM/PM</p>
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
                                                    Concepto
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
                                                                {day.label}
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
                                                        Week Total
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
                                                                {row.label}
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
                                                            {row.label}
                                                        </td>

                                                        {DAYS.map(day => {
                                                            const value = getCellValue(day.key, row.id)
                                                            const isPending = value === 'pendiente'

                                                            if (isComputed) {
                                                                const style = getComputedStyle(value, isInverse)
                                                                let displayValue = value
                                                                if (row.type === 'currency' && value && !String(value).includes('$')) {
                                                                    displayValue = '$' + value
                                                                } else if (row.type === 'percent' && value && !String(value).includes('%')) {
                                                                    displayValue = value + '%'
                                                                }

                                                                return (
                                                                    <td key={day.key} className="p-0 border-r border-b border-slate-100 dark:border-slate-800">
                                                                        <div className={`w-full h-full py-3 px-2 text-center text-xs md:text-sm font-sans ${style} ${isProjected ? 'font-bold' : 'font-medium'}`}>
                                                                            {displayValue}
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
                                        const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

                                        return (
                                            <div key={day.key} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                                                <div className="bg-slate-100 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                                    <h3 className="font-black text-slate-700 dark:text-white uppercase">{day.label}</h3>
                                                    <span className="text-xs font-bold text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">{dateLabel}</span>
                                                </div>
                                                <div className="p-0">
                                                    {REPORT_STRUCTURE.map(row => {
                                                        if (row.type === 'header') {
                                                            return (
                                                                <div key={row.id} className="bg-indigo-50/50 dark:bg-indigo-900/10 px-4 py-1.5 text-[10px] font-black text-indigo-400 uppercase tracking-widest border-y border-indigo-100 dark:border-indigo-900/20 mt-2 first:mt-0">
                                                                    {row.label}
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
                                                            if (row.type === 'currency' && value && !String(value).includes('$')) displayValue = '$' + value
                                                            else if (row.type === 'percent' && value && !String(value).includes('%')) displayValue = value + '%'

                                                            displayValue = <span className={style}>{displayValue}</span>
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
                                                                <span className="text-slate-600 dark:text-slate-400 font-medium text-xs">{row.label}</span>
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
                                            <h3 className="font-black uppercase tracking-wider text-center">Resumen Semanal</h3>
                                        </div>
                                        <div className="p-4 space-y-2">
                                            {REPORT_STRUCTURE.filter(r => r.type !== 'header').map(row => {
                                                const totalString = calculateWeekTotal(row.id, row.type)
                                                if (!totalString || totalString === '$0.00' || totalString === '0.00') return null
                                                return (
                                                    <div key={row.id} className="flex justify-between items-center border-b border-indigo-800/50 last:border-0 pb-1 last:pb-0 text-sm">
                                                        <span className="text-indigo-300 font-medium">{row.label}</span>
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
                                <div className="hidden md:block">
                                    <table className="w-full border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800/50">
                                                <th className="px-6 py-6 text-left text-xs font-black text-slate-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    Day
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    Morning (AM)
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700">
                                                    Night (PM)
                                                </th>
                                                <th className="px-6 py-6 text-center text-[13px] font-black text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                                                    Day Total
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
                                                                <span className="font-bold text-slate-900 dark:text-white text-sm md:text-base leading-tight">{day.dayLabel}</span>
                                                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                                                    {(() => {
                                                                        const dateObj = new Date(day.date + 'T12:00:00');
                                                                        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                                                                        const dd = String(dateObj.getDate()).padStart(2, '0');
                                                                        const yyyy = dateObj.getFullYear();
                                                                        return `${mm}/${dd}/${yyyy}`;
                                                                    })()}
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
                                                const avgMorning = (laborLogData.reduce((a, b) => a + Number(b.morning), 0) / (laborLogData.length || 1))
                                                const avgNight = (laborLogData.reduce((a, b) => a + Number(b.night), 0) / (laborLogData.length || 1))
                                                const avgTotal = (laborLogData.reduce((a, b) => a + Number(b.total), 0) / (laborLogData.length || 1))
                                                const threshold = 21.5

                                                return (
                                                    <tr className="bg-slate-50 dark:bg-slate-800/80">
                                                        <td className="px-6 py-6 font-black text-indigo-600 dark:text-indigo-400 uppercase text-xs border-r dark:border-slate-700">
                                                            Week Total
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
                                                        <h3 className="font-black text-slate-800 dark:text-white text-lg">{day.dayLabel}</h3>
                                                        <p className="text-xs text-slate-400 font-bold">{dateObj.toLocaleDateString()}</p>
                                                    </div>
                                                    <div className={`text-xl font-black ${tNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}>
                                                        {day.total}%
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-2 rounded-lg text-center">
                                                        <span className="text-xs font-bold text-indigo-400 uppercase block mb-1">Morning</span>
                                                        <span className={`text-lg font-bold ${mNum > threshold ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                                            {day.morning}%
                                                        </span>
                                                    </div>
                                                    <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-2 rounded-lg text-center">
                                                        <span className="text-xs font-bold text-indigo-400 uppercase block mb-1">Night</span>
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
                                            const avgMorning = (laborLogData.reduce((a, b) => a + Number(b.morning), 0) / (laborLogData.length || 1))
                                            const avgNight = (laborLogData.reduce((a, b) => a + Number(b.night), 0) / (laborLogData.length || 1))
                                            const avgTotal = (laborLogData.reduce((a, b) => a + Number(b.total), 0) / (laborLogData.length || 1))
                                            const threshold = 21.5

                                            return (
                                                <div className="flex justify-between items-center text-center">
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">Avg Morning</span>
                                                        <span className={`font-bold text-lg ${avgMorning > threshold ? 'text-red-400' : 'text-indigo-200'}`}>{avgMorning.toFixed(2)}%</span>
                                                    </div>
                                                    <div className="w-[1px] h-8 bg-slate-600"></div>
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">Avg Night</span>
                                                        <span className={`font-bold text-lg ${avgNight > threshold ? 'text-red-400' : 'text-indigo-200'}`}>{avgNight.toFixed(2)}%</span>
                                                    </div>
                                                    <div className="w-[1px] h-8 bg-slate-600"></div>
                                                    <div>
                                                        <span className="text-xs text-slate-400 uppercase font-bold block">Week Total</span>
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
                                <div className="hidden md:block max-h-[800px] overflow-y-auto">
                                    <table className="w-full border-collapse relative">
                                        <thead className="sticky top-0 z-20 shadow-sm">
                                            <tr className="bg-orange-100 dark:bg-orange-900/30">
                                                {MONTHLY_STRUCTURE.map(col => (
                                                    <th key={col.id} className="p-3 text-center text-[10px] font-black text-orange-800 dark:text-orange-200 uppercase tracking-wider border border-orange-200 dark:border-orange-800/50" style={{ width: col.width }}>
                                                        {col.label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {/* Sort keys to ensure dates order */}
                                            {Object.keys(monthlyData).sort().map((dateKey, idx) => {
                                                const row = monthlyData[dateKey]
                                                // Format Date for display (MM/DD/YY)
                                                // Format Date for display (MM/DD/YY)
                                                const [y, m, d] = dateKey.split('-')
                                                const dateDisp = `${m}/${d}/${y.substring(2)}`
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
                                        {/* Footer - Monthly Totals */}
                                        <tfoot className="sticky bottom-0 bg-slate-100 dark:bg-slate-800 z-20 font-bold border-t-2 border-slate-200">
                                            <tr>
                                                <td className="p-3 text-center text-xs">TOTAL</td>
                                                {MONTHLY_STRUCTURE.slice(1).map(col => {
                                                    // Simple Sum Logic
                                                    let sum = 0
                                                    let count = 0
                                                    Object.values(monthlyData).forEach((r: any) => {
                                                        const val = parseFloat(String(r[col.id] || '').replace(/[^0-9.-]+/g, ""))
                                                        if (!isNaN(val)) {
                                                            sum += val
                                                            count++
                                                        }
                                                    })

                                                    // Format
                                                    let disp = ''
                                                    if (col.type === 'currency' || col.label.includes('Sales')) disp = '$' + sum.toLocaleString('en-US', { maximumFractionDigits: 2 })
                                                    else if (col.type === 'number') disp = sum.toLocaleString('en-US')
                                                    else if (col.id === 'actual_avg_order') disp = count > 0 ? '$' + (sum / count).toFixed(2) : '-'

                                                    return (
                                                        <td key={col.id} className="p-2 text-center text-xs">
                                                            {disp}
                                                        </td>
                                                    )
                                                })}
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* MOBILE CARD VIEW */}
                                <div className="md:hidden flex flex-col gap-4 p-3 bg-slate-50 dark:bg-black/20">
                                    {Object.keys(monthlyData).sort().map((dateKey, idx) => {
                                        const row = monthlyData[dateKey]
                                        const [y, m, d] = dateKey.split('-')
                                        const dateDisp = `${m}/${d}/${y.substring(2)}`
                                        const dateObj = new Date(dateKey + 'T12:00:00')
                                        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' })
                                        const isSunday = dateObj.getDay() === 0

                                        return (
                                            <div key={dateKey} className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden ${isSunday ? 'ring-2 ring-indigo-200 dark:ring-indigo-900' : ''}`}>
                                                <div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-2 border-b border-orange-100 dark:border-orange-800/30 flex justify-between items-center">
                                                    <h3 className="font-black text-orange-900 dark:text-orange-200">{dayOfWeek} {dateDisp}</h3>
                                                    {row.week_sales && (
                                                        <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                                                            Week: {row.week_sales}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                                    {MONTHLY_STRUCTURE.slice(1).map(col => {
                                                        if (col.id === 'week_sales') return null // Handled in header

                                                        return (
                                                            <div key={col.id} className="flex flex-col">
                                                                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-0.5">{col.label}</label>
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
                                        <h3 className="font-black uppercase text-center mb-4 border-b border-orange-800 pb-2">Monthly Totals</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {MONTHLY_STRUCTURE.slice(1).map(col => {
                                                // Reuse Sum Logic
                                                let sum = 0
                                                let count = 0
                                                Object.values(monthlyData).forEach((r: any) => {
                                                    const val = parseFloat(String(r[col.id] || '').replace(/[^0-9.-]+/g, ""))
                                                    if (!isNaN(val)) {
                                                        sum += val
                                                        count++
                                                    }
                                                })
                                                let disp = ''
                                                if (col.type === 'currency' || col.label.includes('Sales')) disp = '$' + sum.toLocaleString('en-US', { maximumFractionDigits: 2 })
                                                else if (col.type === 'number') disp = sum.toLocaleString('en-US')
                                                else if (col.id === 'actual_avg_order') disp = count > 0 ? '$' + (sum / count).toFixed(2) : '-'

                                                if (col.id === 'week_sales') return null

                                                return (
                                                    <div key={col.id} className="flex justify-between items-center text-sm border-b border-orange-800/50 pb-1">
                                                        <span className="text-orange-300 font-medium">{col.label}</span>
                                                        <span className="font-bold">{disp}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="h-96 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/50">
                            <Store size={48} className="mb-4 text-slate-300" />
                            <p className="font-medium">Selecciona una Tienda y la Semana para comenzar</p>
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    )
}
