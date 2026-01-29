
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// INITIALIZE SERVICE CLIENT (Bypasses RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    if (Math.abs(remainder - 0.5) < 0.0000001) { return (Math.floor(n) % 2 === 0 ? Math.floor(n) : Math.floor(n) + 1) / 100 }
    return Math.round(n) / 100
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('storeId')
    const startStr = searchParams.get('start')
    const endStr = searchParams.get('end')
    const lookbackStr = searchParams.get('lookback')

    if (!storeId || !startStr || !endStr) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    try {
        // 1. Initial Fetch (Shifts first to identify necessary employees)
        const [historyRes, shiftRes, punchRes, budgetRes, lookbackRes, jobsRes] = await Promise.all([
            // History
            supabaseAdmin.from('sales_daily_cache').select('*').eq('store_id', storeId).gte('business_date', startStr).lte('business_date', endStr),
            // Shifts (Raw) - Restore Filter & Boost Limit
            supabaseAdmin.from('shifts').select('*').eq('store_id', storeId).gte('shift_date', startStr).lte('shift_date', endStr).limit(5000),
            // Punches
            supabaseAdmin.from('punches').select('*').eq('store_id', storeId).gte('business_date', startStr).lte('business_date', endStr),
            // Budget
            supabaseAdmin.from('weekly_budgets').select('sales_projections, week_start').eq('store_id', storeId).gte('week_start', lookbackStr || startStr).lte('week_start', new Date(new Date(endStr).setDate(new Date(endStr).getDate() + 14)).toISOString().split('T')[0]),
            // Lookback
            supabaseAdmin.from('sales_daily_cache').select('business_date, net_sales, order_count').eq('store_id', storeId).gte('business_date', lookbackStr || startStr).lte('business_date', startStr),
            // Jobs
            supabaseAdmin.from('toast_jobs').select('*')
        ])

        const shifts = shiftRes.data || []

        // 2. Fetch Targeted Employees (Avoid 1000 limit)
        const empIds = [...new Set(shifts.map((s: any) => s.employee_id).filter(Boolean))]
        let emps: any[] = []
        if (empIds.length > 0) {
            const { data } = await supabaseAdmin.from('toast_employees').select('*').in('id', empIds)
            emps = data || []
        }
        const employeeRes = { data: emps }

        // --- SERVER SIDE CALCULATION (Replica of Loop) ---
        const shiftStats: Record<string, any> = {}

        emps.forEach((emp: any) => {
            const name = (emp.first_name + ' ' + (emp.last_name || '')).toLowerCase()
            if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return
            if (emp.deleted_at && emp.deleted_at.length > 5) return
            if (name.includes('carlos velazquez')) return

            const empShifts = shifts.filter((s: any) => s.employee_id === emp.id)
            if (empShifts.length === 0) return

            // Sort by time
            const sorted = [...empShifts].sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

            let dailyAcc = 0
            let lastDate = ""
            let weeklyAcc = 0
            let rate = 16.00
            if (emp.wage_data && emp.wage_data[0] && emp.wage_data[0].wage) rate = emp.wage_data[0].wage // Simplified

            sorted.forEach((s: any) => {
                if (s.shift_date !== lastDate) { dailyAcc = 0; lastDate = s.shift_date }
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
                    shiftStats[s.id] = { duration: dur, hours: dur, regularHours: reg, otHours: totOT, cost: cost }
                }
            })
        })

        // Unassigned Shifts
        shifts.filter((s: any) => !s.employee_id).forEach((s: any) => {
            const dur = calcDuration(s)
            if (s.id) {
                shiftStats[s.id] = { duration: dur, hours: dur, regularHours: dur, otHours: 0, cost: bankersRound(dur * 16.00) }
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
            shiftStats,
            meta: {
                shiftCount: shiftRes.data?.length || 0,
                checkStart: startStr,
                checkEnd: endStr,
                checkStore: storeId,
                envUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 20) + '...',
                firstShift: shiftRes.data?.[0] ? { id: shiftRes.data[0].id, date: shiftRes.data[0].shift_date } : 'None',
                firstCalc: shiftRes.data?.[0] ? {
                    id: shiftRes.data[0].id,
                    start: shiftRes.data[0].start_time,
                    end: shiftRes.data[0].end_time,
                    calcDur: calcDuration(shiftRes.data[0]),
                    rawDiff: (new Date(shiftRes.data[0].end_time).getTime() - new Date(shiftRes.data[0].start_time).getTime()) / 36e5
                } : 'None'
            }
        })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
