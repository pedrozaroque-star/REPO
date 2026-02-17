import { useState, useEffect, useCallback } from 'react'
import { getSupabaseClient } from '@/lib/supabase'
import { addDays, formatDateISO } from '../lib/utils'

export function useActualStats(storeGuid: string | undefined, weekStart: Date) {
    const [actuals, setActuals] = useState<Record<string, { sales: number, labor: { cost: number, hours: number } }>>({})
    const [loading, setLoading] = useState(false)

    // Raw Data State for Live Calc
    const [punches, setPunches] = useState<any[]>([])
    const [sales, setSales] = useState<any[]>([])
    const [wages, setWages] = useState<Record<string, number>>({})

    const fetchRawData = useCallback(async () => {
        if (!storeGuid) return
        setLoading(true)
        const supabase = await getSupabaseClient()

        const startStr = formatDateISO(weekStart)
        const endStr = formatDateISO(addDays(weekStart, 6))

        // 1. Fetch Sales (Daily Cache)
        const { data: salesData } = await supabase
            .from('sales_daily_cache')
            .select('business_date, net_sales, labor_cost, labor_hours')
            .eq('store_id', storeGuid)
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        // 2. Fetch Labor (Punches) - Include clock_in/out for manual calc fallback
        const { data: punchData, error: punchError } = await supabase
            .from('punches')
            .select('business_date, regular_hours, overtime_hours, employee_toast_guid, clock_in, clock_out')
            .eq('store_id', storeGuid)
            .gte('business_date', startStr)
            .lte('business_date', endStr)

        if (punchError) console.error('Error loading punches', punchError)

        // We need employee rates to calculate cost.
        const { data: empData } = await supabase
            .from('toast_employees')
            .select('toast_guid, wage_data')
            .eq('deleted', false)

        const wageMap: Record<string, number> = {}
        if (empData) {
            empData.forEach((e: any) => {
                // Try to get wage, robustly
                let wage = 16.00
                if (e.wage_data && Array.isArray(e.wage_data) && e.wage_data.length > 0) {
                    wage = Number(e.wage_data[0].wage) || 16.00
                }
                wageMap[e.toast_guid] = wage
            })
        }

        setSales(salesData || [])
        setPunches(punchData || [])
        setWages(wageMap)
        setLoading(false)
    }, [storeGuid, weekStart])

    // 1. Initial Load & Reset on Change
    useEffect(() => {
        setActuals({}) // Reset immediately to avoid stale data from previous store
        setLoading(true)
        fetchRawData()
    }, [fetchRawData])

    // 2. Interval Effect: Recalculate 'actuals' every 60s using raw data + NOW
    useEffect(() => {
        const calculateStats = () => {
            const now = new Date().getTime()
            const newStats: Record<string, { sales: number, labor: { cost: number, hours: number } }> = {}

            // Init
            for (let i = 0; i < 7; i++) {
                newStats[formatDateISO(addDays(weekStart, i))] = { sales: 0, labor: { cost: 0, hours: 0 } }
            }

            // Sales & Labor (Cache Priority)
            sales.forEach((row: any) => {
                const date = row.business_date
                if (newStats[date]) {
                    newStats[date].sales = Number(row.net_sales)

                    // Use Cached Labor if available (PERFECT MATCH with Sales Page)
                    // But ONLY if it's NOT today (Today is calculated live below)
                    // Determine "Today" in LA Time
                    const nowObj = new Date()
                    const laTimeStr = nowObj.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
                    const laTime = new Date(laTimeStr)

                    if (laTime.getHours() < 4) laTime.setDate(laTime.getDate() - 1)
                    const y = laTime.getFullYear()
                    const m = String(laTime.getMonth() + 1).padStart(2, '0')
                    const d = String(laTime.getDate()).padStart(2, '0')
                    const todayStr = `${y}-${m}-${d}`

                    if (date !== todayStr) {
                        newStats[date].labor.cost = Number(row.labor_cost) || 0
                        newStats[date].labor.hours = Number(row.labor_hours) || 0
                    }
                }
            })

            // Labor Live Calculation (ONLY FOR TODAY)
            // We calculate punches ONLY for the current business day to get real-time stats
            const nowObj2 = new Date()
            const laTimeStr2 = nowObj2.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
            const laTime2 = new Date(laTimeStr2)

            if (laTime2.getHours() < 4) laTime2.setDate(laTime2.getDate() - 1)
            const y2 = laTime2.getFullYear()
            const m2 = String(laTime2.getMonth() + 1).padStart(2, '0')
            const d2 = String(laTime2.getDate()).padStart(2, '0')
            const todayStr2 = `${y2}-${m2}-${d2}`

            // Filter punches for TODAY only
            const todayPunches = punches.filter(p => p.business_date === todayStr2)

            if (todayPunches.length > 0) {
                // ... (Manual Calc Logic for TODAY only) ...
                // Reuse existing logic but scoped only to today's punches
                // Note: We don't need complex weekly OT calc for just "today's snapshot",
                // simple daily estimate is enough for live dashboard.

                let todayCost = 0
                let todayHours = 0

                todayPunches.forEach(p => {
                    let totalHours = 0
                    if (p.regular_hours || p.overtime_hours) {
                        totalHours = (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0)
                    } else if (p.clock_in) {
                        const start = new Date(p.clock_in).getTime()
                        const end = p.clock_out ? new Date(p.clock_out).getTime() : nowObj2.getTime()
                        if (end > start) totalHours = (end - start) / (1000 * 60 * 60)
                    }

                    if (totalHours > 0) {
                        todayHours += totalHours

                        // Simple 8h OT Rule for Live View
                        const regular = Math.min(8, totalHours)
                        const overtime = Math.max(0, totalHours - 8)

                        const rate = wages[p.employee_toast_guid] || 16.00
                        const otRate = rate * 1.5

                        todayCost += (regular * rate) + (overtime * otRate)
                    }
                })

                if (newStats[todayStr2]) {
                    newStats[todayStr2].labor.cost = todayCost
                    newStats[todayStr2].labor.hours = todayHours
                }
            }

            setActuals(newStats)
        }

        // Run immediately
        calculateStats()

        // Loop
        const interval = setInterval(calculateStats, 60000) // Update every minute
        return () => clearInterval(interval)
    }, [punches, sales, wages, weekStart])

    // Force Live Sync
    const forceRefresh = useCallback(async () => {
        if (!storeGuid) return
        setLoading(true)
        try {
            // 1. Fetch Live Data (Overlay Layer) - Read Only Sales, Write Labor
            const res = await fetch('/api/sync/sales-live', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storeId: storeGuid })
            })
            const json = await res.json()

            // 2. Refresh DB Data (Base Layer) - Get new Punches from DB
            await fetchRawData()

            if (json.success && json.sales_data) {
                // Determine Date from API or fallback to JS logic
                // The API logic for "today" is robust, but let's re-calculate client side to be safe 
                // or rely on what matches the current view.
                // Ideally API sends back the date it queried.
                // Assuming json.message contains date or we compute it.

                // My debug script showed API doesn't return date explicitly in top level, 
                // but let's re-use the "getBusinessDate" logic roughly or just update "Today".

                const now = new Date()
                const laTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
                if (laTime.getHours() < 4) laTime.setDate(laTime.getDate() - 1)
                const y = laTime.getFullYear()
                const m = String(laTime.getMonth() + 1).padStart(2, '0')
                const d = String(laTime.getDate()).padStart(2, '0')
                const todayStr = `${y}-${m}-${d}`

                setSales(prev => {
                    // Remove existing entry for today (stale DB data)
                    const others = prev.filter(r => r.business_date !== todayStr)
                    // Add fresh Live entry
                    return [...others, {
                        business_date: todayStr,
                        net_sales: json.sales_data
                    }]
                })
            }

        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }, [storeGuid, fetchRawData])

    return { actuals, loading, refetch: forceRefresh }
}
