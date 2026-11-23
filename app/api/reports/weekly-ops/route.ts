/**
 * @module api/reports/weekly-ops/route
 * @description Aggregates weekly operations data, including scheduled shifts vs. actual punches, budget vs. actual sales, and overtime cost calculations.
 * @businessRules
 * - California restaurant labor compliance: 30 min unpaid meal break deduction on shifts > 5 hours.
 * - Overtime calculation: Daily OT > 8 hours, Weekly OT > 40 hours with 1.5x pay rate.
 * - Fast food standard wage fallback of $20.00/hr (AB 1228) when employee wage data is missing.
 * - Live-verified authentication (`getServerUser`) for store managers, supervisors, and admins.
 * - Paginates `shifts`, `punches`, and `sales_daily_cache` deterministically to eliminate PostgREST's 1,000-row truncation in `"Todas las Tiendas"` (`all`) mode.
 * @dataFlow
 * - Client (Weekly Ops Report) -> GET /api/reports/weekly-ops -> Supabase (shifts, punches, sales_daily_cache, weekly_budgets, toast_employees, toast_jobs, sales_projections_cache) -> JSON.
 * @notes
 * - [2026-11-23] FIX CRÍTICO: (1) Paginación `.range()` real para `shifts`, `punches` y `lookback` (en modo `all` se perdían ~49% de 1,943 shifts y ~48% de 1,914 punches por límite 1,000 de PostgREST); (2) Lookback cambiado de `.lte` a `.lt('business_date', startStr)` evitando autocontaminación del lunes; (3) Proyección mínima de `toast_employees` eliminando fuga de PII (`passcode`, `phone`, `email`) + fix columna inexistente `deleted_at` -> `deleted === true` + chunking `.in()`; (4) Orden determinista `updated_at DESC` en `weekly_budgets` y fecha UTC pura `addDaysIso(endStr, 14)`; (5) Auth live vía `getServerUser`.
 */

import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { getServerUser } from '@/lib/auth-server'
import { addDaysIso, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'

const WEEKLY_OPS_ALLOWED_ROLES = ['admin', 'administrador', 'supervisor', 'manager', 'gerente', 'general_manager']
const PAGE_SIZE = 1000

const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    return rawDuration > 5 ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

const bankersRound = (num: number) => {
    const n = num * 100
    const remainder = Math.abs(n) % 1
    if (Math.abs(remainder - 0.5) < 0.0000001) {
        return (Math.floor(n) % 2 === 0 ? Math.floor(n) : Math.floor(n) + 1) / 100
    }
    return Math.round(n) / 100
}

async function fetchAllPaginated(
    buildQuery: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>
): Promise<{ data: any[]; error: any }> {
    const out: any[] = []
    let page = 0
    while (true) {
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        const { data, error } = await buildQuery(from, to)
        if (error) return { data: out, error }
        if (!data || data.length === 0) break
        out.push(...data)
        if (data.length < PAGE_SIZE) break
        page++
    }
    return { data: out, error: null }
}

async function fetchEmployeesInChunks(
    supabase: any,
    column: 'id' | 'toast_guid',
    values: string[]
): Promise<any[]> {
    const out: any[] = []
    const CHUNK = 200
    for (let i = 0; i < values.length; i += CHUNK) {
        const slice = values.slice(i, i + CHUNK)
        const { data } = await supabase
            .from('toast_employees')
            .select('id, toast_guid, first_name, last_name, wage_data, deleted')
            .in(column, slice)
        if (data) out.push(...data)
    }
    return out
}

export async function GET(request: Request) {
    try {
        // 🛡️ SECURITY CHECK (live-verified active staff + cookie/header support)
        const user = await getServerUser(request)
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const role = (user.role || '').trim().toLowerCase()
        if (!WEEKLY_OPS_ALLOWED_ROLES.includes(role)) {
            return NextResponse.json({ error: 'Forbidden: Admins, Supervisors & Managers Only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const storeId = (searchParams.get('storeId') || '').trim()
        const startStr = (searchParams.get('start') || '').trim()
        const endStr = (searchParams.get('end') || '').trim()
        const rawLookback = (searchParams.get('lookback') || '').trim()

        if (!storeId || !startStr || !endStr) {
            return NextResponse.json({ error: 'Missing params (storeId, start, end)' }, { status: 400 })
        }
        if (!isValidIsoDate(startStr) || !isValidIsoDate(endStr) || startStr > endStr) {
            return NextResponse.json({ error: 'Invalid date range (YYYY-MM-DD required, start <= end)' }, { status: 400 })
        }

        const lookbackStr = rawLookback && isValidIsoDate(rawLookback) ? rawLookback : startStr
        const budgetEndStr = addDaysIso(endStr, 14)

        const isAll = storeId.toLowerCase() === 'all'
        const supabase = await getSupabaseAdminClient()

        // Helper to apply store filter conditionally
        const withStore = (query: any) => (isAll ? query : query.eq('store_id', storeId))

        // 1. Initial Fetch (paginated on high-volume tables so "all" mode never truncates at 1,000 rows)
        const [historyRes, shiftRes, punchRes, budgetRes, lookbackRes, jobsRes, projCacheRes] = await Promise.all([
            fetchAllPaginated((from, to) =>
                withStore(supabase.from('sales_daily_cache').select('*'))
                    .gte('business_date', startStr)
                    .lte('business_date', endStr)
                    .order('business_date', { ascending: true })
                    .order('store_id', { ascending: true })
                    .range(from, to)
            ),
            fetchAllPaginated((from, to) =>
                withStore(supabase.from('shifts').select('*'))
                    .gte('shift_date', startStr)
                    .lte('shift_date', endStr)
                    .order('shift_date', { ascending: true })
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
            fetchAllPaginated((from, to) =>
                withStore(supabase.from('punches').select('*'))
                    .gte('business_date', startStr)
                    .lte('business_date', endStr)
                    .order('business_date', { ascending: true })
                    .order('toast_id', { ascending: true })
                    .range(from, to)
            ),
            withStore(supabase.from('weekly_budgets').select('sales_projections, week_start, store_id, updated_at'))
                .gte('week_start', lookbackStr)
                .lte('week_start', budgetEndStr)
                .order('updated_at', { ascending: false })
                .limit(1000),
            // Strictly BEFORE startStr (.lt) to eliminate Monday self-leakage into 4-week lookback average
            fetchAllPaginated((from, to) =>
                withStore(supabase.from('sales_daily_cache').select('business_date, net_sales, order_count, store_id'))
                    .gte('business_date', lookbackStr)
                    .lt('business_date', startStr)
                    .order('business_date', { ascending: true })
                    .order('store_id', { ascending: true })
                    .range(from, to)
            ),
            supabase.from('toast_jobs').select('id, guid, title'),
            fetchAllPaginated((from, to) =>
                withStore(supabase.from('sales_projections_cache').select('business_date, total_sales, store_id, meta'))
                    .gte('business_date', startStr)
                    .lte('business_date', endStr)
                    .order('business_date', { ascending: true })
                    .order('store_id', { ascending: true })
                    .range(from, to)
            ),
        ])

        const shifts = shiftRes.data || []

        // 2. Fetch Targeted Employees (minimal columns only — NO passcode/phone/email PII — chunked to avoid URL limits)
        const shiftEmpIds = [...new Set(shifts.map((s: any) => s.employee_id).filter(Boolean).map(String))]
        const punchEmpGuids = [...new Set((punchRes.data || []).map((p: any) => p.employee_toast_guid).filter(Boolean).map(String))]
        let emps: any[] = []
        if (shiftEmpIds.length > 0 || punchEmpGuids.length > 0) {
            const [byIds, byGuids] = await Promise.all([
                shiftEmpIds.length > 0 ? fetchEmployeesInChunks(supabase, 'id', shiftEmpIds) : Promise.resolve([]),
                punchEmpGuids.length > 0 ? fetchEmployeesInChunks(supabase, 'toast_guid', punchEmpGuids) : Promise.resolve([]),
            ])
            const combined = [...byIds, ...byGuids]
            const seen = new Set<string>()
            emps = combined.filter((e: any) => {
                const key = String(e.id)
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })
        }

        // 3. Server-Side Shift Cost Calculations
        const shiftStats: Record<string, any> = {}

        emps.forEach((emp: any) => {
            if (emp.deleted === true) return
            const name = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase()
            if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return
            if (name.includes('carlos velazquez')) return

            const empShifts = shifts.filter((s: any) => s.employee_id === emp.id)
            if (empShifts.length === 0) return

            const sorted = [...empShifts].sort(
                (a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
            )

            let dailyAcc = 0
            let lastDate = ''
            let weeklyAcc = 0
            let rate = 20.0 // Standard CA fast food minimum wage fallback (AB 1228)
            if (emp.wage_data && emp.wage_data[0] && emp.wage_data[0].wage !== undefined && emp.wage_data[0].wage !== null) {
                const parsedWage = Number(emp.wage_data[0].wage)
                if (Number.isFinite(parsedWage) && parsedWage >= 0) rate = parsedWage
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
                else if (dailyAcc + dur > 8) dOT = dailyAcc + dur - 8
                dailyAcc += dur

                const dReg = dur - dOT

                // Weekly OT > 40
                let wOT = 0
                if (weeklyAcc >= 40) wOT = dReg
                else if (weeklyAcc + dReg > 40) wOT = weeklyAcc + dReg - 40
                weeklyAcc += dReg - wOT

                const totOT = dOT + wOT
                const reg = dur - totOT
                const cost = bankersRound(reg * rate + totOT * rate * 1.5)

                if (s.id) {
                    shiftStats[s.id] = { duration: dur, hours: dur, regularHours: reg, otHours: totOT, cost }
                }
            })
        })

        // Unassigned Shifts
        shifts
            .filter((s: any) => !s.employee_id)
            .forEach((s: any) => {
                const dur = calcDuration(s)
                if (s.id) {
                    shiftStats[s.id] = { duration: dur, hours: dur, regularHours: dur, otHours: 0, cost: bankersRound(dur * 20.0) }
                }
            })

        return NextResponse.json({
            history: historyRes.data || [],
            shifts,
            punches: punchRes.data || [],
            employees: emps,
            budgets: budgetRes.data || [],
            lookback: lookbackRes.data || [],
            jobs: jobsRes.data || [],
            projectionsCache: projCacheRes.data || [],
            shiftStats,
            meta: {
                shiftCount: shifts.length,
                punchCount: (punchRes.data || []).length,
                checkStart: startStr,
                checkEnd: endStr,
                checkStore: storeId,
            },
        })
    } catch (error: any) {
        console.error('Weekly Ops API Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
