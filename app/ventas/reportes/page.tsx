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
    const [saving, setSaving] = useState(false)

    // Config State
    const [selectedStore, setSelectedStore] = useState('')
    const [weekDate, setWeekDate] = useState('') // "2026-01-12" (Monday)
    const [stores, setStores] = useState<any[]>([])

    // Data State (Grid)
    // Structure: { monday: { projected_sales: 100, ... }, tuesday: { ... } }
    const [gridData, setGridData] = useState<Record<string, Record<string, any>>>({})

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
    useEffect(() => {
        if (!weekDate || !selectedStore) return
        setLoading(true)

        const fetchReport = async () => {
            const supabase = await getSupabaseClient()

            // 1. Fetch Saved Report (Manual Inputs like Projected, Notes)
            const { data: savedReport } = await supabase
                .from('weekly_operations_reports')
                .select('*')
                .eq('store_id', selectedStore)
                .eq('week_start_date', weekDate)
                .maybeSingle()

            // 2. Fetch Historical System Data
            // CRITICAL FIX: Resolve Store GUID from numeric ID
            // The 'sales_daily_cache' uses Toast GUIDs, but 'stores' table uses numeric IDs (14, 15...)
            console.log(`🔍 [REPORT] Resolving GUID for Store ID: ${selectedStore}`)

            // A. Get Store Name to lookup in map
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            const storeName = storeObj?.name || ''

            // B. Reverse Lookup in Hardcoded Map (Quickest Fix)
            const STORE_GUID_MAP: Record<string, string> = {
                'Rialto': 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
                'Azusa': 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
                'Norwalk': '42ed15a6-106b-466a-9076-1e8f72451f6b',
                'Downey': 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
                'LA Broadway': '475bc112-187d-4b9c-884d-1f6a041698ce',
                'Bell': 'a83901db-2431-4283-834e-9502a2ba4b3b',
                'Hollywood': '5fbb58f5-283c-4ea4-9415-04100ee6978b',
                'Huntington Park': '47256ade-2cd4-4073-9632-84567ad9e2c8',
                'LA Central': '8685e942-3f07-403a-afb6-faec697cd2cb',
                'La Puente': '3a803939-eb13-4def-a1a4-462df8e90623',
                'Lynwood': '80a1ec95-bc73-402e-8884-e5abbe9343e6',
                'Santa Ana': '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
                'Slauson': '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
                'South Gate': '95866cfc-eeb8-4af9-9586-f78931e1ea04',
                'West Covina': '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'
            }

            // Fallback: Check if store table has a 'toast_guid' column (ideal) or use Map
            let queryId = selectedStore

            // Try exact match first
            if (STORE_GUID_MAP[storeName]) {
                queryId = STORE_GUID_MAP[storeName]
            } else {
                // Try fuzzy match (e.g. "Tacos Gavilan Lynwood" -> "Lynwood")
                const key = Object.keys(STORE_GUID_MAP).find(k => storeName.includes(k))
                if (key) {
                    queryId = STORE_GUID_MAP[key]
                    console.log(`✅ [REPORT] Fuzzy Mapped '${storeName}' -> '${key}' -> GUID ${queryId}`)
                } else {
                    console.warn(`⚠️ [REPORT] No GUID mapping found for '${storeName}'. Trying raw ID.`)
                }
            }

            // Calculate Sunday date
            const start = new Date(weekDate + 'T00:00:00')
            const end = new Date(start)
            end.setDate(start.getDate() + 6)
            const endStr = end.toISOString().split('T')[0]

            console.log(`🔍 [REPORT] Fetching history for GUID ${queryId} from ${weekDate} to ${endStr}`)

            const { data: history, error: histError } = await supabase
                .from('sales_daily_cache')
                .select('*')
                .eq('store_id', queryId) // Use GUID here
                .gte('business_date', weekDate)
                .lte('business_date', endStr)

            if (histError) console.error("❌ [REPORT] History Error:", histError)
            console.log(`✅ [REPORT] Found ${history?.length || 0} rows in history:`, history)

            // 3. Fetch Scheduled Shifts (Planned Hours)
            const { data: shifts, error: shiftError } = await supabase
                .from('shifts')
                .select('*')
                .eq('store_id', queryId) // Use GUID
                .gte('shift_date', weekDate)
                .lte('shift_date', endStr)

            if (shiftError) console.error("❌ [REPORT] Shift Error:", shiftError)
            console.log(`✅ [REPORT] Found ${shifts?.length || 0} shifts`)

            // 4. Merge Strategies
            const newGrid: any = {}

            DAYS.forEach((day, i) => {
                const d = new Date(weekDate + 'T00:00:00')
                d.setDate(d.getDate() + i)
                const dateStr = d.toISOString().split('T')[0]

                // A. Base from Saved Report (or empty)
                let cellData = savedReport?.daily_data?.[dateStr] || {}

                // B. Calculate Scheduled Hours AND Overtime from Shifts (Planificador)
                const daysShifts = shifts?.filter((s: any) => s.shift_date === dateStr) || []

                let totalSched = 0
                let totalOT = 0

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

                    cellData = {
                        ...cellData,
                        scheduled_hours: totalSched.toFixed(2),
                        over_time_hours: totalOT > 0 ? totalOT.toFixed(2) : '', // New Field
                        actual_sales: sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        actual_hours: hours.toFixed(2),
                        actual_labor: laborPct,
                        actual_avg_order: orders > 0 ? (sales / orders).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00',
                        daily_cars: ''
                    }
                } else {
                    cellData = {
                        ...cellData,
                        scheduled_hours: totalSched.toFixed(2),
                        over_time_hours: totalOT > 0 ? totalOT.toFixed(2) : ''
                    }
                }


                newGrid[day.key] = cellData
            })

            setGridData(newGrid)
            setLoading(false)
        }

        fetchReport()
    }, [selectedStore, weekDate])


    const handleSaveReport = async () => {
        if (!selectedStore || !weekDate) {
            alert('Selecciona Tienda y Semana primero')
            return
        }
        setSaving(true)

        try {
            // Transform Grid to JSONB
            const dailyData: any = {}

            DAYS.forEach((day, i) => {
                const start = new Date(weekDate + 'T00:00:00')
                const date = new Date(start)
                date.setDate(start.getDate() + i)
                const dateStr = date.toISOString().split('T')[0]

                dailyData[dateStr] = gridData[day.key] || {}
            })

            const supabase = await getSupabaseClient()

            // Get Current User
            const { data: { user } } = await supabase.auth.getUser()

            const { error } = await supabase
                .from('weekly_operations_reports')
                .upsert({
                    store_id: selectedStore,
                    week_start_date: weekDate,
                    daily_data: dailyData,
                    status: 'draft',
                    updated_at: new Date().toISOString(),
                    created_by: user?.id
                }, { onConflict: 'store_id, week_start_date' })

            if (error) throw error

            alert('Reporte guardado exitosamente ✅')

        } catch (e: any) {
            console.error(e)
            alert('Error al guardar: ' + e.message)
        } finally {
            setSaving(false)
        }
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
            formatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        } else if (row.type === 'percent') {
            formatted = num.toFixed(2)
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

    // PROJECTION LOGIC
    const handleGenerateProjections = async () => {
        if (!selectedStore || !weekDate) {
            alert('Select Store and Week first')
            return
        }

        const confirmProj = confirm('¿Generar proyecciones basadas en las últimas 4 semanas?\nEsto sobrescribirá los campos "Projected".')
        if (!confirmProj) return

        setLoading(true)
        try {
            const supabase = await getSupabaseClient()

            // 1. Resolve Store GUID (Reusing logic - ideally refactor to helper)
            let queryId = selectedStore
            const storeObj = stores.find(s => String(s.id) === String(selectedStore))
            const storeName = storeObj?.name || ''
            const STORE_GUID_MAP: Record<string, string> = {
                'Rialto': 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
                'Azusa': 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
                'Norwalk': '42ed15a6-106b-466a-9076-1e8f72451f6b',
                'Downey': 'b7f63b01-f089-4ad7-a346-afdb1803dc1a',
                'LA Broadway': '475bc112-187d-4b9c-884d-1f6a041698ce',
                'Bell': 'a83901db-2431-4283-834e-9502a2ba4b3b',
                'Hollywood': '5fbb58f5-283c-4ea4-9415-04100ee6978b',
                'Huntington Park': '47256ade-2cd4-4073-9632-84567ad9e2c8',
                'LA Central': '8685e942-3f07-403a-afb6-faec697cd2cb',
                'La Puente': '3a803939-eb13-4def-a1a4-462df8e90623',
                'Lynwood': '80a1ec95-bc73-402e-8884-e5abbe9343e6',
                'Santa Ana': '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
                'Slauson': '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
                'South Gate': '95866cfc-eeb8-4af9-9586-f78931e1ea04',
                'West Covina': '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02'
            }
            if (STORE_GUID_MAP[storeName]) queryId = STORE_GUID_MAP[storeName]
            else {
                const key = Object.keys(STORE_GUID_MAP).find(k => storeName.includes(k))
                if (key) queryId = STORE_GUID_MAP[key]
            }

            // 2. Identify Past 4 Weeks dates
            // Logic: For each day of current week (Mon-Sun), find the previous 4 instances.
            // Actually simpler: Fetch ALL sales for store in range [WeekStart - 28 days, WeekStart - 1 day]
            // Then manually filter by weekday.
            // Example:
            // Target Week Start: Jan 20 (Mon)
            // Lookback Start: Jan 20 - 28 days = Dec 23.
            // Lookback End: Jan 19.

            const targetStart = new Date(weekDate + 'T00:00:00')
            const lookbackStart = new Date(targetStart)
            lookbackStart.setDate(targetStart.getDate() - 28) // 4 weeks back

            const lookbackEnd = new Date(targetStart)
            lookbackEnd.setDate(targetStart.getDate() - 1) // Up to yesterday

            const startStr = lookbackStart.toISOString().split('T')[0]
            const endStr = lookbackEnd.toISOString().split('T')[0]

            const { data: history, error } = await supabase
                .from('sales_daily_cache')
                .select('*')
                .eq('store_id', queryId)
                .gte('business_date', startStr)
                .lte('business_date', endStr)

            if (error) throw error

            // 3. Compute Averages per Weekday
            const averages: Record<string, number> = {}

            DAYS.forEach((day, index) => {
                // Determine weekday integer (0=Sun, 1=Mon... but JS Date getDay() is 0=Sun)
                // Our DAYS array starts Monday (index 0).
                // So Monday is getDay() === 1.
                // Tuesday is getDay() === 2.
                // Sunday is getDay() === 0.
                const targetDayIndex = (index + 1) % 7

                // Filter history for this weekday
                const daySales = history?.filter((h: any) => {
                    const d = new Date(h.business_date + 'T00:00:00')
                    return d.getDay() === targetDayIndex
                }).map((h: any) => h.net_sales || 0) || []

                // Average using whatever data we have (1 to 4 points)
                if (daySales.length > 0) {
                    const sum = daySales.reduce((a: number, b: number) => a + b, 0)
                    averages[day.key] = sum / daySales.length
                } else {
                    averages[day.key] = 0
                }
            })

            // 4. Update Grid
            setGridData(prev => {
                const next = { ...prev }
                DAYS.forEach(day => {
                    const avgSales = averages[day.key] || 0
                    // Default Labor % Target: 24% (Can make configurable later)
                    const targetLaborPct = 24
                    const targetLaborCost = avgSales * (targetLaborPct / 100)

                    next[day.key] = {
                        ...next[day.key],
                        projected_sales: avgSales > 0 ? avgSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                        projected_labor: avgSales > 0 ? targetLaborPct.toFixed(2) : ''
                        // note: We could also set 'projected_hours' if we had Avg Wage.
                        // For now just Sales and Labor %.
                    }
                })
                return next
            })

            alert('Proyecciones generadas (Promedio 4 Semanas) 📈')

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
                                <h1 className="text-lg font-bold text-slate-900 dark:text-white">Weekly Operations Report</h1>
                                <p className="text-xs text-slate-500">Edición Digital</p>
                            </div>
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

                            <input
                                type="date"
                                value={weekDate}
                                onChange={(e) => setWeekDate(e.target.value)}
                                className="px-3 py-2 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex-1"></div>

                        {/* Actions */}
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
                            <button
                                onClick={handleSaveReport}
                                disabled={saving}
                                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 hover:scale-105 disabled:opacity-50 disabled:scale-100"
                            >
                                <Save size={18} /> {saving ? 'Guardando...' : 'Guardar Reporte'}
                            </button>
                        </div>
                    </div>

                    {/* THE GRID */}
                    {selectedStore && weekDate ? (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl overflow-x-auto">
                            <table className="w-full text-xs md:text-sm border-collapse">
                                <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-center font-bold uppercase tracking-wider">
                                        <th className="p-3 border-r dark:border-slate-800 min-w-[200px] text-left pl-6 sticky left-0 bg-slate-100 dark:bg-slate-950 z-20">Concepto</th>
                                        {DAYS.map((day, i) => {
                                            // Calculate Date Logic
                                            const start = new Date(weekDate + 'T00:00:00')
                                            const current = new Date(start)
                                            current.setDate(start.getDate() + i)
                                            const dateStr = current.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })

                                            return (
                                                <th key={day.key} className="p-2 border-r dark:border-slate-800 min-w-[100px]">
                                                    <div className="flex flex-col">
                                                        <span>{day.label}</span>
                                                        <span className="text-[10px] opacity-70 font-normal">{dateStr}</span>
                                                    </div>
                                                </th>
                                            )
                                        })}
                                        <th className="p-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100 min-w-[120px]">Week Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {REPORT_STRUCTURE.map((row, idx) => {
                                        if (row.type === 'header') {
                                            return (
                                                <tr key={row.id} className="bg-slate-50 dark:bg-slate-800/50">
                                                    <td colSpan={9} className="px-6 py-2 font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest text-[11px]">
                                                        {row.label}
                                                    </td>
                                                </tr>
                                            )
                                        }

                                        const isComputed = row.computed
                                        const isInverse = row.inverseColor

                                        return (
                                            <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                                {/* Label Column */}
                                                <td className="px-6 py-2 font-medium text-slate-700 dark:text-slate-300 border-r dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors z-10 border-b border-slate-100 dark:border-slate-800">
                                                    {row.label}
                                                </td>

                                                {/* Days Columns */}
                                                {DAYS.map(day => {
                                                    const value = getCellValue(day.key, row.id)

                                                    if (isComputed) {
                                                        const style = getComputedStyle(value, isInverse)
                                                        return (
                                                            <td key={day.key} className="p-0 border-r border-b border-slate-100 dark:border-slate-800">
                                                                <div className={`w-full h-full py-3 px-2 text-center text-xs ${style}`}>
                                                                    {row.type === 'currency' && value ? '$' : ''}{value}{row.type === 'percent' && value ? '%' : ''}
                                                                </div>
                                                            </td>
                                                        )
                                                    }

                                                    return (
                                                        <td key={day.key} className="p-0 border-r border-b border-slate-100 dark:border-slate-800">
                                                            <input
                                                                type="text"
                                                                value={value}
                                                                onChange={(e) => handleInputChange(day.key, row.id, e.target.value)}
                                                                onBlur={(e) => handleInputBlur(day.key, row.id, e.target.value)}
                                                                className="w-full h-full py-3 px-2 text-right bg-transparent border-none outline-none focus:bg-indigo-50 dark:focus:bg-indigo-900/30 font-mono text-xs text-slate-800 dark:text-slate-200 transition-all placeholder:text-transparent"
                                                                placeholder="-"
                                                            />
                                                        </td>
                                                    )
                                                })}

                                                {/* Total Column */}
                                                <td className="px-4 py-2 text-right font-bold text-slate-900 dark:text-white bg-indigo-50/30 dark:bg-indigo-900/10 border-b border-slate-100 dark:border-slate-800">
                                                    {calculateWeekTotal(row.id, row.type)}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
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
