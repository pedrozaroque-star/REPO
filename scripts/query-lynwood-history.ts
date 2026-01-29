
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const WEEKS = [
    '2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29',
    '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'
]

// --- HELPERS FROM PREVIOUS SCRIPTS ---
const bankersRound = (num: number) => {
    const n = num * 100
    const i = Math.round(n)
    const remainder = Math.abs(n) % 1
    if (Math.abs(remainder - 0.5) < 0.0000001) {
        const floor = Math.floor(n)
        return (floor % 2 === 0 ? floor : floor + 1) / 100
    }
    return Math.round(n) / 100
}

const calcDuration = (s: any) => {
    if (!s.start_time || !s.end_time) return 0
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    if (rawDuration < 0) rawDuration += 24
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
}

const calculateWeekStats = (shifts: any[], employees: any[], jobs: any[]) => {
    let totalSchedCost = 0
    let totalSchedHours = 0
    const shiftStats: Record<string, any> = {}

    // Note: This logic suffers from "Invisible Shifts" issue in backend context for unknown reasons.
    // It captures ~25-30% of shifts compared to Frontend.

    employees.forEach(emp => {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        empShifts.forEach(s => {
            const duration = calcDuration(s)
            // simplified cost for summary (ignoring heavy OT logic for speed in summary)
            let rate = 16.00
            if (emp.wage_data?.[0]?.wage) rate = emp.wage_data[0].wage
            const cost = duration * rate
            shiftStats[s.id] = { duration, cost, hours: duration }
        })
    })

    shifts.forEach(s => {
        const stat = shiftStats[s.id]
        if (stat) {
            const job = jobs.find(j => j.id === s.job_id)
            const title = (job?.title || '').toLowerCase()
            const isManager = title.includes('manager') && !title.includes('assist') && !title.includes('asst') && !title.includes('shift')
            if (!isManager) {
                totalSchedHours += stat.hours
                totalSchedCost += stat.cost
            }
        }
    })
    return { totalSchedHours, totalSchedCost }
}

async function run() {
    console.log("📊 GENERATING HISTORY REPORT FOR LYNWOOD...\n")

    const { data: employees } = await supabase.from('toast_employees').select('*')
    const { data: jobs } = await supabase.from('toast_jobs').select('*')

    // Filter employees for Lynwood just like App
    const lynwoodEmps = (employees || []).filter((e: any) => {
        if (Array.isArray(e.store_ids)) return e.store_ids.includes(LYNWOOD_GUID)
        if (typeof e.store_ids === 'string') return e.store_ids.includes(LYNWOOD_GUID)
        return false
    })

    for (const weekStart of WEEKS) {
        const endDate = new Date(weekStart); endDate.setDate(endDate.getDate() + 6)
        const endStr = endDate.toISOString().split('T')[0]

        // 1. Fetch Budget
        const { data: budget } = await supabase.from('weekly_budgets')
            .select('*').eq('store_id', LYNWOOD_GUID).eq('week_start', weekStart).single()

        // 2. Fetch Shifts (Visible to Backend)
        const { data: shifts } = await supabase.from('shifts')
            .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', weekStart).lte('shift_date', endStr)

        let sales = 0
        let laborCost = 0
        let hours = 0
        let source = "Estimated (Algo)"

        // Check for Snapshot (Manual Override)
        if (budget?.sales_projections?._snapshot) {
            const snap = budget.sales_projections._snapshot
            sales = snap.total_sales
            laborCost = snap.total_labor_cost
            hours = snap.total_hours
            source = "✅ Manual Snapshot (Exact)"
        } else {
            // Calculate from Projections + Visible Shifts
            if (budget?.sales_projections) {
                sales = Object.values(budget.sales_projections).reduce((a: any, b: any) => a + Number(b), 0) as number
            }
            const stats = calculateWeekStats(shifts || [], lynwoodEmps, jobs || [])
            laborCost = stats.totalSchedCost
            hours = stats.totalSchedHours
        }

        const laborPct = sales > 0 ? (laborCost / sales) * 100 : 0

        console.log(`📅 WEEK: ${weekStart}  [${source}]`)
        console.table([{
            'Sales ($)': `$${sales.toLocaleString()}`,
            'Labor ($)': `$${laborCost.toLocaleString()}`,
            'Hours': hours.toFixed(1),
            'Labor %': `${laborPct.toFixed(1)}%`,
            'Visible Shifts': shifts?.length || 0
        }])

        if (source.includes("Algo")) {
            console.log(`   ⚠️ Note: Labor shown is based on backend-visible shifts only. Frontend may show higher/correct values.`)
        }
        console.log("-".repeat(60))
    }
}

run()
