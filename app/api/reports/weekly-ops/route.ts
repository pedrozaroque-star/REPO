/**
 * @module api/reports/weekly-ops/route
 * @description Aggregates weekly operations data, including scheduled shifts vs. actual punches, budget vs. actual sales, and overtime cost calculations.
 * @businessRules
 * - California restaurant labor compliance: 30 min unpaid meal break deduction on shifts > 5 hours.
 * - Overtime calculation: Daily OT > 8 hours, Weekly OT > 40 hours with 1.5x pay rate.
 * - Fast food standard wage fallback of \$20.00/hr (AB 1228) when employee wage data is missing.
 * - Authenticated access for store managers, supervisors, and admins.
 * @dataFlow
 * - Client (Weekly Ops Report) -> GET /api/reports/weekly-ops -> Supabase (shifts, punches, sales_daily_cache, weekly_budgets) -> JSON.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyAuthToken } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

const bankersRound = (num: number) => {
    const n = num * 100
    const i = Math.round(n)
    const remainder = Math.abs(n) % 1
    if (Math.abs(remainder - 0.5) < 0.0000001) { 
        return (Math.floor(n) % 2 === 0 ? Math.floor(n) : Math.floor(n) + 1) / 100 
    }
    return Math.round(n) / 100
}

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK 🛡️
        const authHeader = request.headers.get('Authorization')
        if (!authHeader) {
            return NextResponse.json({ error: 'Missing Authorization Header' }, { status: 401 })
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        const user = verifyAuthToken(token)
        if (!user) {
            return NextResponse.json({ error: 'Invalid Token' }, { status: 401 })
        }

        if (user.user_role !== 'admin' && user.user_role !== 'supervisor' && user.user_role !== 'manager') {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const storeId = searchParams.get('storeId')
        const startStr = searchParams.get('start')
        const endStr = searchParams.get('end')
        const lookbackStr = searchParams.get('lookback')

        if (!storeId || !startStr || !endStr) {
            return NextResponse.json({ error: 'Missing params (storeId, start, end)' }, { status: 400 })
        }

        const isAll = storeId === 'all'
        const supabase = await getSupabaseAdminClient()

        // Helper to apply store filter conditionally
        const withStore = (query: any) => isAll ? query : query.eq('store_id', storeId)

        // 1. Initial Fetch
        const [historyRes, shiftRes, punchRes, budgetRes, lookbackRes, jobsRes, projCacheRes] = await Promise.all([
            withStore(supabase.from('sales_daily_cache').select('*')).gte('business_date', startStr).lte('business_date', endStr),
            withStore(supabase.from('shifts').select('*')).gte('shift_date', startStr).lte('shift_date', endStr).limit(10000),
            withStore(supabase.from('punches').select('*')).gte('business_date', startStr).lte('business_date', endStr),
            withStore(supabase.from('weekly_budgets').select('sales_projections, week_start, store_id')).gte('week_start', lookbackStr || startStr).lte('week_start', new Date(new Date(endStr).setDate(new Date(endStr).getDate() + 14)).toISOString().split('T')[0]),
            withStore(supabase.from('sales_daily_cache').select('business_date, net_sales, order_count, store_id')).gte('business_date', lookbackStr || startStr).lte('business_date', startStr),
            supabase.from('toast_jobs').select('*'),
            withStore(supabase.from('sales_projections_cache').select('business_date, total_sales, store_id')).gte('business_date', startStr).lte('business_date', endStr)
        ])

        const shifts = shiftRes.data || []

        // 2. Fetch Targeted Employees (From both shifts and punches)
        const shiftEmpIds = [...new Set(shifts.map((s: any) => s.employee_id).filter(Boolean))]
        const punchEmpGuids = [...new Set((punchRes.data || []).map((p: any) => p.employee_toast_guid).filter(Boolean))]
        let emps: any[] = []
        if (shiftEmpIds.length > 0 || punchEmpGuids.length > 0) {
            if (shiftEmpIds.length > 0 && punchEmpGuids.length > 0) {
                const [byIds, byGuids] = await Promise.all([
                    supabase.from('toast_employees').select('*').in('id', shiftEmpIds),
                    supabase.from('toast_employees').select('*').in('toast_guid', punchEmpGuids)
                ])
                const combined = [...(byIds.data || []), ...(byGuids.data || [])]
                const seen = new Set()
                emps = combined.filter((e: any) => {
                    if (seen.has(e.id)) return false
                    seen.add(e.id)
                    return true
                })
            } else if (shiftEmpIds.length > 0) {
                const { data } = await supabase.from('toast_employees').select('*').in('id', shiftEmpIds)
                emps = data || []
            } else {
                const { data } = await supabase.from('toast_employees').select('*').in('toast_guid', punchEmpGuids)
                emps = data || []
            }
        }
        const employeeRes = { data: emps }

        // 3. Server-Side Calculations
        const shiftStats: Record<string, any> = {}

        emps.forEach((emp: any) => {
            const name = (emp.first_name + ' ' + (emp.last_name || '')).toLowerCase()
            if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return
            if (emp.deleted_at && emp.deleted_at.length > 5) return
            if (name.includes('carlos velazquez')) return

            const empShifts = shifts.filter((s: any) => s.employee_id === emp.id)
            if (empShifts.length === 0) return

            const sorted = [...empShifts].sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

            let dailyAcc = 0
            let lastDate = ""
            let weeklyAcc = 0
            let rate = 20.00 // Standard CA fast food minimum wage fallback (AB 1228)
            if (emp.wage_data && emp.wage_data[0] && emp.wage_data[0].wage) {
                rate = Number(emp.wage_data[0].wage) || 20.00
            }

            sorted.forEach((s: any) => {
                if (s.shift_date !== lastDate) { 
                    dailyAcc = 0
                    lastDate = s.shift_date 
                }
                const dur = calcDuration(s)

                // Daily OT > 8
                let dOT = 0
                if (dailyAcc >= 8) dOT = dur
                else if (dailyAcc + dur > 8) dOT = (dailyAcc + dur) - 8
                dailyAcc += dur

                const dReg = dur - dOT

                // Weekly OT > 40
                let wOT = 0
                if (weeklyAcc >= 40) wOT = dReg
                else if (weeklyAcc + dReg > 40) wOT = (weeklyAcc + dReg) - 40
                weeklyAcc += (dReg - wOT)

                const totOT = dOT + wOT
                const reg = dur - totOT
                const cost = bankersRound((reg * rate) + (totOT * rate * 1.5))

                if (s.id) {
                    shiftStats[s.id] = { duration: dur, hours: dur, regularHours: reg, otHours: totOT, cost }
                }
            })
        })

        // Unassigned Shifts
        shifts.filter((s: any) => !s.employee_id).forEach((s: any) => {
            const dur = calcDuration(s)
            if (s.id) {
                shiftStats[s.id] = { duration: dur, hours: dur, regularHours: dur, otHours: 0, cost: bankersRound(dur * 20.00) }
            }
        })

        return NextResponse.json({
            history: historyRes.data || [],
            shifts: shiftRes.data || [],
            punches: punchRes.data || [],
            employees: employeeRes.data || [],
            budgets: budgetRes.data || [],
            lookback: lookbackRes.data || [],
            jobs: jobsRes.data || [],
            projectionsCache: projCacheRes.data || [],
            shiftStats,
            meta: {
                shiftCount: shiftRes.data?.length || 0,
                checkStart: startStr,
                checkEnd: endStr,
                checkStore: storeId
            }
        })

    } catch (error: any) {
        console.error("Weekly Ops API Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
