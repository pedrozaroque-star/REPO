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

    // 1. Initial Load & Reset on Change
    useEffect(() => {
        setActuals({}) // Reset immediately to avoid stale data from previous store
        setLoading(true)
        // ⚡ FORCE LIVE REFRESH ON STORE CHANGE ⚡
        // This ensures "Today's" sales are accurate immediately
        forceRefresh()

        // 🔄 Poll for Live Data every 2 minutes
        const pollInterval = setInterval(() => {
            console.log('🔄 Auto-Refreshing Live Stats (2m Timer)...')
            forceRefresh()
        }, 2 * 60 * 1000)

        return () => clearInterval(pollInterval)
    }, [forceRefresh])

    // 2. Interval Effect: Recalculate 'actuals' every 60s using raw data + NOW
    useEffect(() => {
        const calculateStats = () => {
            const now = new Date().getTime()
            const newStats: Record<string, { sales: number, labor: { cost: number, hours: number } }> = {}

            // Init
            const days = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(weekStart, i)))

            days.forEach(dStr => {
                newStats[dStr] = { sales: 0, labor: { cost: 0, hours: 0 } }
            })

            // 1. Fill Sales from Cache
            sales.forEach((row: any) => {
                if (newStats[row.business_date]) {
                    newStats[row.business_date].sales = Number(row.net_sales)
                    // Default labor to cache, will override with punches if available
                    newStats[row.business_date].labor.cost = Number(row.labor_cost) || 0
                    newStats[row.business_date].labor.hours = Number(row.labor_hours) || 0
                }
            })

            // 2. Calculate Labor from Punches (Preferred Source for ALL days)
            // This fixes discrepancies where cache is stale but punches are correct (e.g. after sync-labor)

            days.forEach(dayStr => {
                const dayPunches = punches.filter(p => p.business_date === dayStr)

                if (dayPunches.length > 0) {
                    let dayCost = 0
                    let dayHours = 0

                    dayPunches.forEach(p => {
                        let totalHours = 0
                        // Use calculated fields if available, otherwise calc from timestamps (live punches)
                        // FORCE LIVE CALC FOR OPEN PUNCHES
                        // If clock_out is missing, it's an active shift. Ignore stored hours (which might be 0 or stale) and calc from NOW.
                        if (!p.clock_out && p.clock_in) {
                            const start = new Date(p.clock_in).getTime()
                            // Ensure we don't calc negative if system time is off, but generally NOW > Start
                            if (now > start) {
                                totalHours = (now - start) / (1000 * 60 * 60)
                            }
                        }
                        // For CLOSED punches, prefer the official precise calculations from Toast/DB
                        else if (p.regular_hours !== null || p.overtime_hours !== null) {
                            totalHours = (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0)
                        } else if (p.clock_in) {
                            // Fallback for closed shifts without DB hours
                            const start = new Date(p.clock_in).getTime()
                            const end = p.clock_out ? new Date(p.clock_out).getTime() : now
                            if (end > start) totalHours = (end - start) / (1000 * 60 * 60)
                        }

                        if (totalHours > 0) {
                            dayHours += totalHours

                            // Cost Calc - Prefer the actual wage from the punch record (synced from Toast)
                            const wage = (Number(p.hourly_wage) > 0) ? Number(p.hourly_wage) : (wages[p.employee_toast_guid] || 16.00)

                            // Simple OT Logic for estimation

                            // Case 1: Open Punch (Live Calculation)
                            if (!p.clock_out && p.clock_in) {
                                // Apply California OT Rules (simplistic: >8h daily)
                                const reg = Math.min(8, totalHours)
                                const ot = Math.max(0, totalHours - 8)
                                dayCost += (reg * wage) + (ot * wage * 1.5)
                            }
                            // Case 2: Closed Punch with DB Hours (Official)
                            else if ((Number(p.regular_hours) || 0) > 0 || (Number(p.overtime_hours) || 0) > 0) {
                                dayCost += (Number(p.regular_hours || 0) * wage) + (Number(p.overtime_hours || 0) * wage * 1.5)
                            }
                            // Case 3: Fallback (Closed but no DB hours yet? Calc from totalHours)
                            else {
                                const reg = Math.min(8, totalHours)
                                const ot = Math.max(0, totalHours - 8)
                                dayCost += (reg * wage) + (ot * wage * 1.5)
                            }
                        }
                    })

                    // ⚡ SMART OVERWRITE ⚡
                    // Only use punch-based calculation to overwrite the cache if:
                    // 1. We are looking at "Today" (where cache is stale/incomplete)
                    // 2. The cache is totally empty for that day (cost <= 0)
                    const nowStr = formatDateISO(new Date())
                    const isToday = dayStr === nowStr
                    const cacheIsMaybeMissing = newStats[dayStr].labor.cost <= 0

                    if (isToday || cacheIsMaybeMissing) {
                        newStats[dayStr].labor.hours = dayHours
                        newStats[dayStr].labor.cost = dayCost
                    }
                }
            })

            setActuals(newStats)
        }

        // Run immediately
        calculateStats()

        // Loop
        const interval = setInterval(calculateStats, 60000) // Update every minute
        return () => clearInterval(interval)
    }, [punches, sales, wages, weekStart])



    return { actuals, loading, refetch: forceRefresh }
}
