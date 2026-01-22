'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Plus, Save, Calendar, Store, Calculator, Clock, CheckCircle } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'

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

        // Check if report exists in DB (TODO: Fetch implementation)
        // For now, init empty
        const initData: any = {}
        DAYS.forEach(day => {
            initData[day.key] = {}
            REPORT_STRUCTURE.forEach(row => {
                if (row.type !== 'header') initData[day.key][row.id] = ''
            })
        })
        setGridData(initData)

        // Try to Auto-Fill from Toast API (Mock Check)
        // In real impl, we would fetch /api/ventas?start=...&end=...&store=...
    }, [selectedStore, weekDate])


    // Load Data if exists
    const fetchReport = React.useCallback(async () => {
        if (!weekDate || !selectedStore || stores.length === 0) return
        setLoading(true)
        const supabase = await getSupabaseClient()

        // 2. Resolve Store GUID from numeric ID
        // CRITICAL FIX: Use the external_id from the 'stores' table as the Toast GUID
        const storeObj = stores.find(s => String(s.id) === String(selectedStore))

        if (!storeObj?.external_id) {
            console.warn(`⚠️ [REPORT] Waiting for store external_id for '${storeObj?.name || 'Unknown'}'...`)
            setLoading(false)
            return
        }
        const queryId = storeObj.external_id

        // Calculate Sunday date
        const start = new Date(weekDate + 'T00:00:00')
        const end = new Date(start)
        end.setDate(start.getDate() + 6)
        const endStr = end.toISOString().split('T')[0]

        console.log(`🔍 [REPORT] Fetching history/punches for GUID: ${queryId} from ${weekDate} to ${endStr}`)

        const [historyRes, shiftRes, punchRes, employeeRes] = await Promise.all([
            supabase.from('sales_daily_cache').select('*').eq('store_id', queryId).gte('business_date', weekDate).lte('business_date', endStr),
            supabase.from('shifts').select('*, toast_employees(first_name, last_name, chosen_name), toast_jobs(title)').eq('store_id', queryId).gte('shift_date', weekDate).lte('shift_date', endStr),
            supabase.from('punches').select('*').eq('store_id', queryId).gte('business_date', weekDate).lte('business_date', endStr),
            supabase.from('toast_employees').select('id, toast_guid, wage_data')
        ])

        const history = historyRes.data
        const shifts = shiftRes.data
        const punchesRaw = punchRes.data
        const employees = employeeRes.data

        if (historyRes.error) console.error("❌ [REPORT] History Error:", historyRes.error)
        if (shiftRes.error) console.error("❌ [REPORT] Shift Error:", shiftRes.error)
        if (punchRes.error) console.error("❌ [REPORT] Punch Error:", punchRes.error)

        // Find Store Manager (any shift with Title "Manager" in this store this week)
        const managerShift = shifts?.find((s: any) => s.toast_jobs?.title === 'Manager')
        const globalManagerName = managerShift
            ? (managerShift.toast_employees?.chosen_name || `${managerShift.toast_employees?.first_name} ${managerShift.toast_employees?.last_name || ''}`)
            : ''

        console.log(`✅ [REPORT] Data Loaded: ${history?.length || 0} history, ${shifts?.length || 0} shifts, ${punchesRaw?.length || 0} punches`)
        console.log(`👤 [REPORT] Detected Manager: ${globalManagerName || 'None'}`)

        // 5. Merge Strategies
        const newGrid: any = {}
        const weekLaborLog: any[] = []

        DAYS.forEach((day, i) => {
            const d = new Date(weekDate + 'T00:00:00')
            d.setDate(d.getDate() + i)
            const dateStr = d.toISOString().split('T')[0]

            // --- LABOR LOG CALCULATION (AM/PM SPLIT) ---
            const dayHistory = history?.find((h: any) => h.business_date === dateStr)
            const hourlySales = dayHistory?.hourly_data || {}

            // Morning Sales (6 AM to 4:59 PM -> indices 6-16)
            let morningSales = 0
            for (let h = 6; h <= 16; h++) morningSales += Number(hourlySales[h] || 0)

            // Night Sales (5 PM to 5:59 AM next day -> indices 17-23, 0-5)
            let nightSales = 0
            for (let h = 17; h <= 23; h++) nightSales += Number(hourlySales[h] || 0)
            for (let h = 0; h <= 5; h++) nightSales += Number(hourlySales[h] || 0)

            // Labor Cost Split
            const dayPunches = punchesRaw?.filter((p: any) => p.business_date === dateStr) || []
            let morningLaborCost = 0
            let nightLaborCost = 0

            dayPunches.forEach((p: any) => {
                const emp = employees?.find(e => e.toast_guid === p.employee_toast_guid)
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

            // Find Leaders for this day
            const amAsst = daysShifts.find((s: any) =>
                s.toast_jobs?.title === 'Asst Manager' &&
                new Date(s.start_time).getHours() < 12
            )
            const pmAsst = daysShifts.find((s: any) =>
                s.toast_jobs?.title === 'Asst Manager' &&
                new Date(s.start_time).getHours() >= 12
            )

            const morningLeaderName = amAsst
                ? (amAsst.toast_employees?.chosen_name || amAsst.toast_employees?.first_name)
                : globalManagerName

            const lateLeaderName = pmAsst
                ? (pmAsst.toast_employees?.chosen_name || pmAsst.toast_employees?.first_name)
                : globalManagerName

            daysShifts.forEach((s: any) => {
                let duration = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / (1000 * 60 * 60)

                // FIX: Handle overnight/UTC date mismatches where end < start
                if (duration < 0) {
                    duration += 24
                }

                // Safety Cap: Ignore shifts > 20h (likely data error) or <= 0
                if (duration > 0 && duration < 24) {
                    totalSched += duration
                    // Simple Daily OT Rule: Anything > 8 hours in a shift is OT
                    if (duration > 8) {
                        totalOT += (duration - 8)
                    }
                }
            })

            // D. Get Actual Overtime from Punches
            const actualOT = dayPunches.reduce((sum: number, p: any) => sum + (Number(p.overtime_hours) || 0), 0)

            // C. Overlay System Data
            const sysData = history?.find((h: any) =>
                h.business_date === dateStr ||
                (h.business_date && h.business_date.startsWith(dateStr))
            )

            if (sysData) {
                const sales = sysData.net_sales || 0
                const hours = sysData.labor_hours || 0
                const laborCost = sysData.labor_cost || 0
                const orders = sysData.order_count || 0
                const laborPct = sales > 0 ? ((laborCost / sales) * 100).toFixed(2) : '0.00'

                const formatCurrency = (val: number) => '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

                cellData = {
                    ...cellData,
                    scheduled_hours: totalSched.toFixed(2),
                    overtime_hours: actualOT > 0 ? actualOT.toFixed(2) : (totalOT > 0 ? totalOT.toFixed(2) : ''),
                    actual_sales: formatCurrency(sales),
                    actual_hours: hours.toFixed(2),
                    actual_labor: laborPct + '%',
                    actual_avg_order: orders > 0 ? formatCurrency(sales / orders) : '$0.00',
                    morning_leader: cellData.morning_leader || morningLeaderName,
                    late_leader: cellData.late_leader || lateLeaderName,
                    daily_cars: cellData.daily_cars || 'pendiente',
                    sos_time: cellData.sos_time || 'pendiente'
                }
            } else {
                cellData = {
                    ...cellData,
                    scheduled_hours: totalSched.toFixed(2),
                    overtime_hours: actualOT > 0 ? actualOT.toFixed(2) : (totalOT > 0 ? totalOT.toFixed(2) : ''),
                    morning_leader: cellData.morning_leader || morningLeaderName,
                    late_leader: cellData.late_leader || lateLeaderName,
                    daily_cars: cellData.daily_cars || 'pendiente',
                    sos_time: cellData.sos_time || 'pendiente'
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
        // 2. Resolve Store GUID
        const storeObj = stores.find(s => String(s.id) === String(selectedStore))
        if (!storeObj?.external_id) {
            setLoading(false)
            return
        }
        const queryId = storeObj.external_id

        // Fetch Sales Cache for Month
        const { data: sales, error } = await supabase
            .from('sales_daily_cache')
            .select('*')
            .eq('store_id', queryId)
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        if (error) console.error("Monthly Fetch Error", error)

        const newMonthly: any = {}
        const daysInMon = endOfMonth.getDate()

        for (let d = 1; d <= daysInMon; d++) {
            const dateObj = new Date(y, m - 1, d)
            const dateKey = dateObj.toISOString().split('T')[0]

            const sysData = sales?.find((s: any) => s.business_date === dateKey)

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

            if (sysData) {
                // Populate from Cache if available
                const formatCurrency = (val: number) => val ? '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''

                newMonthly[dateKey] = {
                    ...newMonthly[dateKey],
                    actual_sales: formatCurrency(sysData.net_sales),
                    daily_cars: sysData.order_count || '',
                    actual_avg_order: sysData.act_avg_order ? formatCurrency(sysData.act_avg_order) : (sysData.order_count > 0 ? formatCurrency(sysData.net_sales / sysData.order_count) : ''),

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

    // PROJECTION LOGIC (7shifts Style - Multi-Algorithm Engine)
    const handleGenerateProjections = async () => {
        if (!selectedStore || !weekDate) {
            alert('Selecciona Tienda y Semana primero')
            return
        }

        const confirmProj = confirm('¿Generar proyecciones inteligentes?\n\n' +
            'Utilizaremos:\n' +
            '1. Promedio Ponderado (últimas 8 semanas)\n' +
            '2. Tendencia de Crecimiento reciente\n' +
            '3. Estacionalidad (mismo periodo año anterior)\n\n' +
            'Esto sobrescribirá los campos "Projected".'
        )
        if (!confirmProj) return

        setLoading(true)
        try {
            const supabase = await getSupabaseClient()

            // 1. Resolve Store GUID
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            const queryId = storeObj?.external_id || selectedStore

            console.log(`🔍 [PROJECTION] Using GUID: ${queryId}`)

            // 2. Fetch Data (Recent 8 weeks + Last year same week)
            const targetStart = new Date(weekDate + 'T00:00:00')

            // Lookback: Last 56 days (8 weeks)
            const lookbackStart = new Date(targetStart)
            lookbackStart.setDate(targetStart.getDate() - 56)
            const lookbackEnd = new Date(targetStart)
            lookbackEnd.setDate(targetStart.getDate() - 1)

            // Seasonality: Last year (approx 364 days ago for same weekday alignment)
            const seasonalStart = new Date(targetStart)
            seasonalStart.setDate(targetStart.getDate() - 364)
            const seasonalEnd = new Date(seasonalStart)
            seasonalEnd.setDate(seasonalStart.getDate() + 7)

            const { data: history, error } = await supabase
                .from('sales_daily_cache')
                .select('business_date, net_sales, order_count')
                .eq('store_id', queryId)
                .or(`and(business_date.gte.${lookbackStart.toISOString().split('T')[0]},business_date.lte.${lookbackEnd.toISOString().split('T')[0]}),and(business_date.gte.${seasonalStart.toISOString().split('T')[0]},business_date.lte.${seasonalEnd.toISOString().split('T')[0]})`)

            if (error) throw error

            // 3. Compute Averages per Weekday
            const projections: Record<string, { sales: number, avgOrder: number }> = {}

            DAYS.forEach((day, index) => {
                const targetDayIndex = (index + 1) % 7 // 1=Mon, 2=Tue... 0=Sun

                // Filter components
                const recentRows = history
                    ?.filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                    .filter((h: any) => h.business_date >= lookbackStart.toISOString().split('T')[0] && h.business_date <= lookbackEnd.toISOString().split('T')[0])
                    .sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime()) || []

                const seasonalRow = history
                    ?.filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                    .find((h: any) => h.business_date >= seasonalStart.toISOString().split('T')[0] && h.business_date <= seasonalEnd.toISOString().split('T')[0])

                // A. Component 1: Recent Weighted
                const weights = [0.40, 0.20, 0.15, 0.10, 0.05, 0.05, 0.03, 0.02]
                let wRecentSales = 0, wRecentAvg = 0, tWeight = 0

                recentRows.forEach((row, i) => {
                    if (i < weights.length) {
                        const sales = Number(row.net_sales) || 0
                        const orders = Number(row.order_count) || 0
                        const avg = orders > 0 ? (sales / orders) : 0

                        wRecentSales += sales * weights[i]
                        wRecentAvg += avg * weights[i]
                        tWeight += weights[i]
                    }
                })

                const finalRecentSales = tWeight > 0 ? wRecentSales / tWeight : 0
                const finalRecentAvg = tWeight > 0 ? wRecentAvg / tWeight : 0

                // B. Component 2: Seasonal
                const sSales = Number(seasonalRow?.net_sales) || 0
                const sOrders = Number(seasonalRow?.order_count) || 0
                const sAvg = sOrders > 0 ? (sSales / sOrders) : 0

                // C. Component 3: Trend (Sales only)
                const firstPeriod = recentRows.slice(0, 2).reduce((a, b) => a + Number(b.net_sales), 0) / 2
                const secondPeriod = recentRows.slice(2, 6).reduce((a, b) => a + Number(b.net_sales), 0) / 4
                let trendFactor = 1.0
                if (secondPeriod > 0) {
                    trendFactor = Math.max(0.9, Math.min(1.1, firstPeriod / secondPeriod))
                }

                // D. Ensemble
                let projSales = 0, projAvg = 0
                if (sSales > 0) {
                    projSales = (finalRecentSales * 0.7 + sSales * 0.3) * (finalRecentSales > 0 ? trendFactor : 1)
                    projAvg = (finalRecentAvg * 0.7 + sAvg * 0.3)
                } else {
                    projSales = finalRecentSales * trendFactor
                    projAvg = finalRecentAvg
                }

                projections[day.key] = { sales: projSales, avgOrder: projAvg }
            })

            // 4. Update Grid
            setGridData(prev => {
                const next = { ...prev }
                DAYS.forEach(day => {
                    const data = projections[day.key]

                    next[day.key] = {
                        ...next[day.key],
                        projected_sales: data.sales > 0 ? '$' + data.sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                        projected_labor: data.sales > 0 ? targetLaborPct.toFixed(2) + '%' : '',
                        target_avg_order: data.avgOrder > 0 ? '$' + data.avgOrder.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
                    }
                })
                return next
            })

            alert(`✅ Proyecciones Inteligentes Generadas\n\n- Ventas y Avg Order proyectados.\n- Labor Target: ${targetLaborPct}%\n- SPLH Goal: $${targetSPLH}`)

        } catch (e: any) {
            console.error(e)
            alert('Error generando proyecciones: ' + e.message)
        } finally {
            setLoading(false)
        }
    }

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
                        <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-800 ml-4">
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
                                className="px-3 py-2 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">Seleccionar Tienda</option>
                                {stores.map(s => <option key={s.id} value={s.id}>{formatStoreName(s.name)}</option>)}
                            </select>

                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                                <span className="text-[10px] font-bold text-slate-400 upper">LABOR %</span>
                                <input
                                    type="number"
                                    value={targetLaborPct}
                                    onChange={(e) => setTargetLaborPct(Number(e.target.value))}
                                    className="w-10 bg-transparent text-sm font-black text-indigo-600 outline-none"
                                />
                            </div>

                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                                <span className="text-[10px] font-bold text-slate-400 upper">SPLH GOAL</span>
                                <input
                                    type="number"
                                    value={targetSPLH}
                                    onChange={(e) => setTargetSPLH(Number(e.target.value))}
                                    className="w-10 bg-transparent text-sm font-black text-emerald-600 outline-none"
                                />
                            </div>

                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Calendar size={14} className="text-slate-400" />
                                </div>
                                {activeTab === 'monthly' ? (
                                    <input
                                        type="month"
                                        id="month-picker"
                                        value={weekDate ? weekDate.substring(0, 7) : ''}
                                        onChange={handleWeekDateChange}
                                        onClick={(e) => (e.target as any).showPicker?.()}
                                        className="absolute inset-0 opacity-0 cursor-pointer z-20 w-full h-full"
                                    />
                                ) : (
                                    <input
                                        type="date"
                                        id="week-picker"
                                        value={weekDate}
                                        onChange={handleWeekDateChange}
                                        onClick={(e) => (e.target as any).showPicker?.()}
                                        className="absolute inset-0 opacity-0 cursor-pointer z-20 w-full h-full"
                                    />
                                )}
                                <div className="pl-9 pr-3 py-2 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-black text-slate-700 dark:text-slate-200 flex items-center min-w-[140px] group-hover:bg-slate-200 dark:group-hover:bg-slate-900 transition-colors focus-within:ring-2 focus-within:ring-indigo-500">
                                    {weekDate ? (
                                        (() => {
                                            if (activeTab === 'monthly') {
                                                const [y, m] = weekDate.split('-')
                                                const date = new Date(parseInt(y), parseInt(m) - 1);
                                                return date.toLocaleString('default', { month: 'long', year: 'numeric' });
                                            }
                                            const [y, m, d] = weekDate.split('-');
                                            return `${m}/${d}/${y}`;
                                        })()
                                    ) : (
                                        <span className="text-slate-400 font-bold uppercase text-[10px]">{activeTab === 'monthly' ? 'Pick Mo.' : 'Week'}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1"></div>

                        {/* Actions */}
                        {activeTab === 'ops' && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleGenerateProjections}
                                    disabled={loading || !selectedStore || !weekDate}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-200 transition-colors disabled:opacity-50"
                                >
                                    <Store size={16} /> Auto-Project
                                </button>
                                <button
                                    onClick={handleAutoFill}
                                    disabled={loading || !selectedStore || !weekDate}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs font-bold hover:bg-emerald-200 transition-colors disabled:opacity-50"
                                >
                                    <Calculator size={16} /> Auto-Fill (Toast)
                                </button>
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
                                    disabled={loading || !selectedStore || !weekDate}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors disabled:opacity-50"
                                >
                                    <Save size={16} /> Save
                                </button>
                                <button
                                    onClick={handleMonthlyAutoFill}
                                    disabled={loading || !selectedStore || !weekDate}
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
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-800/50">
                                            <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-wider border-r dark:border-slate-700 sticky left-0 bg-slate-50 dark:bg-slate-800 z-20 border-b border-slate-200 dark:border-slate-700">
                                                Concepto
                                            </th>
                                            {DAYS.map((day, i) => {
                                                const d = new Date(weekDate + 'T12:00:00')
                                                d.setDate(d.getDate() + i)
                                                return (
                                                    <th key={day.key} className="px-4 py-4 text-center border-r dark:border-slate-700 border-b border-slate-200 dark:border-slate-700 min-w-[120px]">
                                                        <span className="block text-[13px] font-bold text-slate-900 dark:text-white uppercase leading-tight font-sans">
                                                            {day.label}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400 font-normal font-sans">
                                                            {(`${d.getMonth() + 1}`).padStart(2, '0')}/{(`${d.getDate()}`).padStart(2, '0')}/{d.getFullYear()}
                                                        </span>
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
                                            const isDiff = row.isDiff
                                            const isInverse = row.inverseColor
                                            const isProjected = row.id.startsWith('projected_') || row.id.startsWith('target_') || row.id === 'scheduled_hours'

                                            return (
                                                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                                    {/* Label Column */}
                                                    <td className="px-6 py-2 font-medium text-slate-700 dark:text-slate-300 border-r dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors z-10 border-b border-slate-100 dark:border-slate-800">
                                                        {row.label}
                                                    </td>

                                                    {/* Days Columns */}
                                                    {DAYS.map(day => {
                                                        const value = getCellValue(day.key, row.id)
                                                        const isPending = value === 'pendiente'

                                                        if (isComputed) {
                                                            const style = getComputedStyle(value, isInverse)
                                                            // Ensure value doesn't double-dip on symbols
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

                                                    {/* Total Column */}
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
                        ) : activeTab === 'labor' ? (
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
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
                        ) : (
                            // MONTHLY TAB VIEW
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                                <div className="max-h-[800px] overflow-y-auto">
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
