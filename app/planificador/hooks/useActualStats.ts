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
            .select('business_date, net_sales')
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

    // 1. Initial Load
    useEffect(() => {
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

            // Sales (Static)
            sales.forEach((row: any) => {
                const date = row.business_date
                if (newStats[date]) newStats[date].sales = Number(row.net_sales)
            })

            // Labor Calculation with OT Rules (Daily > 8, Weekly > 40)
            const empWeeklyHours: Record<string, number> = {} // Track regular hours per employee

            // Group punches by employee to calculate weekly OT correctly
            // Punches must be sorted by date for weekly accumulation
            const sortedPunches = [...punches].sort((a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime())
            const punchesByEmp: Record<string, any[]> = {}

            sortedPunches.forEach(p => {
                const empId = p.employee_toast_guid
                if (!punchesByEmp[empId]) punchesByEmp[empId] = []
                punchesByEmp[empId].push(p)
            })

            // Iterate by Employee
            Object.values(punchesByEmp).forEach(empPunches => {
                let weeklyRegularParams = 0

                empPunches.forEach(p => {
                    const date = p.business_date
                    if (!newStats[date]) return

                    // 1. Calculate Duration
                    let totalHours = 0
                    if (p.regular_hours || p.overtime_hours) {
                        // Trust API if available (backup)
                        totalHours = (Number(p.regular_hours) || 0) + (Number(p.overtime_hours) || 0)
                    }

                    if (totalHours === 0 && p.clock_in) {
                        // Calculate manually
                        const start = new Date(p.clock_in).getTime()
                        const end = p.clock_out ? new Date(p.clock_out).getTime() : now
                        if (end > start) {
                            totalHours = (end - start) / (1000 * 60 * 60)
                        }
                    }

                    if (totalHours > 0) {
                        let regular = 0
                        let overtime = 0

                        // 2. Apply Daily Rule (> 8h is OT)
                        if (totalHours > 8) {
                            regular = 8
                            overtime = totalHours - 8
                        } else {
                            regular = totalHours
                        }

                        // 3. Apply Weekly Rule (> 40h Regular is OT)
                        if (weeklyRegularParams + regular > 40) {
                            const availableRegular = Math.max(0, 40 - weeklyRegularParams)
                            const shiftOT = regular - availableRegular

                            regular = availableRegular
                            overtime += shiftOT // Add to existing daily OT
                        }

                        // Accumulate weekly regular hours
                        weeklyRegularParams += regular

                        // 4. Update Stats for this Day
                        newStats[date].labor.hours += totalHours

                        const rate = wages[p.employee_toast_guid] || 16.00
                        const otRate = rate * 1.5

                        // Cost Calculation
                        const regCost = regular * rate
                        const otCost = overtime * otRate

                        newStats[date].labor.cost += (regCost + otCost)
                    }
                })
            })
            setActuals(newStats)
        }

        // Run immediately
        calculateStats()

        // Loop
        const interval = setInterval(calculateStats, 60000) // Update every minute
        return () => clearInterval(interval)
    }, [punches, sales, wages, weekStart])

    return { actuals, loading, refetch: fetchRawData }
}
