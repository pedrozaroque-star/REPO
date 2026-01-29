
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

// --- CONFIG ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing Env Vars")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// --- HELPERS ---
const formatDateISO = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

const addDays = (date: Date, days: number) => {
    const res = new Date(date)
    res.setDate(res.getDate() + days)
    return res
}

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

    employees.forEach(emp => {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
        let regularHoursAccumulator = 0
        let dailyHoursAccumulator = 0
        let lastShiftDate = ""

        sorted.forEach(s => {
            const duration = calcDuration(s)
            if (s.shift_date !== lastShiftDate) { dailyHoursAccumulator = 0; lastShiftDate = s.shift_date }
            let dailyOT = 0
            const hoursBefore = dailyHoursAccumulator
            dailyHoursAccumulator += duration
            if (hoursBefore >= 8) dailyOT = duration
            else if (hoursBefore + duration > 8) dailyOT = (hoursBefore + duration) - 8
            const dailyReg = duration - dailyOT
            let weeklyOT = 0
            if (regularHoursAccumulator >= 40) weeklyOT = dailyReg
            else if (regularHoursAccumulator + dailyReg > 40) weeklyOT = (regularHoursAccumulator + dailyReg) - 40
            regularHoursAccumulator += (dailyReg - weeklyOT)
            let rate = 16.00
            if (emp.wage_data && Array.isArray(emp.wage_data)) {
                const wEntry = emp.wage_data.find((w: any) => {
                    const j = jobs.find(job => job.id === s.job_id)
                    return j && (w.job_guid === j.guid || w.job_guid === j.id)
                })
                if (wEntry) rate = wEntry.wage
                else if (emp.wage_data.length > 0) rate = emp.wage_data[0].wage
            }
            const totalOT = dailyOT + weeklyOT
            const regPaid = duration - totalOT
            const cost = (regPaid * rate) + (totalOT * rate * 1.5)
            shiftStats[s.id] = { duration, cost: bankersRound(cost), hours: duration }
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
    console.log("🚀 Starting HISTORY Publisher (Silent Mode)...")

    const { data: stores } = await supabase.from('stores').select('*')
    if (!stores) return

    const weeks = [
        '2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29',
        '2026-01-05', '2026-01-12',
        // SKIPPING Jan 19 (Manual Fix)
        '2026-01-26', '2026-02-02'
    ]

    const { data: employees } = await supabase.from('toast_employees').select('*')
    const { data: jobs } = await supabase.from('toast_jobs').select('*')

    // Cache helper
    let cache: any[] = []
    let events: any[] = []

    for (const store of stores) {
        console.log(`\n🏢 Processing Store: ${store.name}`)
        const storeGuid = store.external_id

        // Load history once per store
        const { data: h } = await supabase.from('sales_daily_cache').select('business_date, net_sales').eq('store_id', storeGuid)
        cache = h || []
        const { data: e } = await supabase.from('calendar_events').select('*').or(`store_id.eq.${storeGuid},store_id.is.null`)
        events = e || []

        for (const weekStartStr of weeks) {
            const endStr = formatDateISO(addDays(new Date(weekStartStr + 'T12:00:00'), 6))

            // 1. Force Publish ALL Shifts found
            const { data: shifts } = await supabase.from('shifts')
                .select('*')
                .eq('store_id', storeGuid)
                .gte('shift_date', weekStartStr)
                .lte('shift_date', endStr)

            if (!shifts || shifts.length === 0) continue

            // Update status
            const shiftIds = shifts.map(s => s.id)
            await supabase.from('shifts').update({ status: 'published' }).in('id', shiftIds)

            // 2. Smart Projections (Simplified Algo)
            let salesProjections: Record<string, string> = {}
            const targetStart = new Date(weekStartStr + 'T00:00:00')

            for (let i = 0; i < 7; i++) {
                const dayDate = addDays(targetStart, i)
                const dateStr = formatDateISO(dayDate)
                const dayIndex = dayDate.getDay() // 0=Sun

                // Recent History (Last 8 weeks)
                const recent = cache
                    .filter((c: any) => new Date(c.business_date).getDay() === dayIndex)
                    .filter((c: any) => c.business_date < weekStartStr)
                    .sort((a, b) => b.business_date.localeCompare(a.business_date))
                    .slice(0, 4)

                const avg = recent.length > 0 ? recent.reduce((a, b) => a + Number(b.net_sales), 0) / recent.length : 0

                if (avg > 0) salesProjections[dateStr] = Math.round(avg).toString()
                else salesProjections[dateStr] = "0"
            }

            // 3. Save Budget
            await supabase.from('weekly_budgets').upsert({
                store_id: storeGuid,
                week_start: weekStartStr,
                sales_projections: salesProjections,
                updated_at: new Date().toISOString()
            }, { onConflict: 'store_id,week_start' })

            console.log(`   📅 Week ${weekStartStr}: Published & Projected.`)
        }
    }
    console.log("✨ Done.")
}

run()
