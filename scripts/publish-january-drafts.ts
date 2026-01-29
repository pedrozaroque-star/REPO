
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

// --- CONFIG ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '' // MUST BE SERVICE ROLE KEY to update drafts/force writes

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing Env Vars")
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// --- HELPERS (Replicated from useWeeklyStats & useSmartProjections) ---
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

const getMonday = (d: Date) => {
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const m = new Date(d)
    m.setDate(diff)
    return m
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
    // Returns { cost: number, hours: number } aggregated for budget
    let totalSchedCost = 0
    let totalSchedHours = 0
    const shiftStats: Record<string, any> = {}

    // 1. Calculate Shift Stats (OT, Cost)
    employees.forEach(emp => {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

        let regularHoursAccumulator = 0
        let dailyHoursAccumulator = 0
        let lastShiftDate = ""

        sorted.forEach(s => {
            const duration = calcDuration(s)
            if (s.shift_date !== lastShiftDate) {
                dailyHoursAccumulator = 0
                lastShiftDate = s.shift_date
            }

            // Daily OT
            let dailyOT = 0
            const hoursBeforeThisShift = dailyHoursAccumulator
            dailyHoursAccumulator += duration

            if (hoursBeforeThisShift >= 8) dailyOT = duration
            else if (hoursBeforeThisShift + duration > 8) dailyOT = (hoursBeforeThisShift + duration) - 8

            const dailyRegular = duration - dailyOT

            // Weekly OT
            let weeklyOT = 0
            if (regularHoursAccumulator >= 40) weeklyOT = dailyRegular
            else if (regularHoursAccumulator + dailyRegular > 40) weeklyOT = (regularHoursAccumulator + dailyRegular) - 40

            regularHoursAccumulator += (dailyRegular - weeklyOT)

            // Wage
            let rate = 16.00
            if (emp.wage_data && Array.isArray(emp.wage_data)) {
                const wEntry = emp.wage_data.find((w: any) => {
                    const j = jobs.find(job => job.id === s.job_id)
                    return j && (w.job_guid === j.guid || w.job_guid === j.id)
                })
                if (wEntry) rate = wEntry.wage
                else if (emp.wage_data.length > 0) rate = emp.wage_data[0].wage
            }

            const totalShiftOT = dailyOT + weeklyOT
            const regularPaid = duration - totalShiftOT
            const cost = (regularPaid * rate) + (totalShiftOT * rate * 1.5)
            const roundedCost = bankersRound(cost)

            shiftStats[s.id] = { duration, cost: roundedCost, hours: duration, otHours: totalShiftOT }
        })
    })

    // 2. Aggregate for Budget (Excluding Managers)
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

    return { totalSchedHours, totalSchedCost, shiftStats }
}


// --- MAIN SCRIPT ---
async function run() {
    console.log("🚀 Starting January Draft Publisher...")

    // 1. Get Active Stores
    const { data: stores, error } = await supabase.from('stores').select('*')

    if (error) {
        console.error("❌ Error fetching stores:", error)
        return
    }
    if (!stores || stores.length === 0) {
        console.warn("⚠️ No stores found.")
        return
    }

    console.log(`✅ Found ${stores.length} stores.`)

    // 2. Define January 2026 Weeks (Mondays)
    // Jan 2026 starts on Thursday. So first full week logic or standard iso weeks?
    // Teg uses "Monday to Sunday". 
    // Jan 1st is in week of Mon Dec 29, 2025.
    // Weeks: Dec 29, Jan 5, Jan 12, Jan 19, Jan 26.
    const weeks = ['2025-12-29', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']

    // 3. Get Metadata
    const { data: employees } = await supabase.from('toast_employees').select('*')
    const { data: jobs } = await supabase.from('toast_jobs').select('*')

    if (!employees || !jobs) {
        console.error("❌ Failed to load metadata")
        return
    }

    for (const store of stores) {
        console.log(`\n🏢 Processing Store: ${store.name} (${store.id})`)
        const storeGuid = store.external_id

        for (const weekStartStr of weeks) {
            // Check for drafts in this week
            const endStr = formatDateISO(addDays(new Date(weekStartStr + 'T12:00:00'), 6))

            const { data: shifts } = await supabase.from('shifts')
                .select('*')
                .eq('store_id', store.external_id) // Shifts use external_id as store_id usually? Or internal? 
                // CHECK SCHEMA: shifts.store_id is typically the external GUID in this project based on previous context.
                // Wait, useWeeklyStats used `storeGuid`. 
                // Let's verify. In `app/planificador/page.tsx`: 
                // .eq('store_id', storeGuid) where storeGuid is `currentStore?.external_id`. 
                // YES, shifts use GUID.
                .gte('shift_date', weekStartStr)
                .lte('shift_date', endStr)

            if (!shifts || shifts.length === 0) continue

            const drafts = shifts
            if (drafts.length === 0) {
                // console.log(`   Week ${weekStartStr}: No drafts.`)
                continue
            }

            console.log(`   📅 Week ${weekStartStr}: Processing ${drafts.length} shifts (Repairing Budget)...`)

            // A. Calculate Budget Stats (Cost & Hours) using ALL shifts (draft + published) -> Final state
            const { totalSchedCost, totalSchedHours } = calculateWeekStats(shifts, employees, jobs)

            // B. Get Sales Projections (Try DB first, else simple calc)
            // We need a projection for EACH DAY to sum up.
            let salesProjections: Record<string, string> = {}

            // --- SMART PROJECTIONS LOGIC (Replicated) ---
            // If we have an existing budget WITH data, keep it? 
            // The user complained about "zeros", so if it's all zeros, we should recalculate.
            // Let's force recalculate if total is 0 or missing.
            let needsRecalc = true
            /*
            if (existingBudget?.sales_projections) {
                const total = Object.values(existingBudget.sales_projections).reduce((a: any, b: any) => a + Number(b), 0)
                if (total > 1000) { // arbitrary threshold to trust existing
                    salesProjections = existingBudget.sales_projections
                    needsRecalc = false
                }
            }
            */
            // User explicitly asked to use the calculator, implying overriding current zeros.

            if (needsRecalc) {
                console.log(`      🧠 Calculating Smart Projections for ${weekStartStr}...`)

                // A. Define Ranges
                const targetStart = new Date(weekStartStr + 'T00:00:00')
                const lookbackStart = addDays(targetStart, -56)
                const lookbackEnd = addDays(targetStart, -1)
                const seasonalStart = addDays(targetStart, -364)
                const seasonalEnd = addDays(seasonalStart, 7)

                // B. Fetch History (Lookback + Seasonal)
                // Need parallel fetch for speed
                const [{ data: history }, { data: events }] = await Promise.all([
                    supabase
                        .from('sales_daily_cache')
                        .select('business_date, net_sales, order_count')
                        .eq('store_id', storeGuid)
                        .or(`and(business_date.gte.${formatDateISO(lookbackStart)},business_date.lte.${formatDateISO(lookbackEnd)}),and(business_date.gte.${formatDateISO(seasonalStart)},business_date.lte.${formatDateISO(seasonalEnd)})`),

                    supabase
                        .from('calendar_events')
                        .select('*')
                        .or(`store_id.eq.${storeGuid},store_id.is.null`)
                        .gte('date', weekStartStr)
                        .lte('date', formatDateISO(addDays(targetStart, 6)))
                ])

                const eventsList = events || []
                const historyList = history || []

                // Holiday Logic (Inlined for script)
                const checkHoliday = (d: Date) => {
                    const m = d.getMonth(); const date = d.getDate(); const year = d.getFullYear()
                    // Fixed
                    if (m === 11 && date === 24) return { factor: 0.4 } // Xmas Eve
                    if (m === 11 && date === 25) return { factor: 0.0 } // Xmas
                    if (m === 11 && date === 31) return { factor: 0.4 } // NYE
                    if (m === 0 && date === 1) return { factor: 0.9 } // NY Day
                    if (m === 1 && date === 14) return { factor: 1.05 } // Val
                    if (m === 4 && date === 5) return { factor: 1.25 } // 5 Mayo
                    if (m === 6 && date === 4) return { factor: 0.80 } // 4 July
                    if (m === 4 && date === 10) return { factor: 0.93 } // Mothers Day
                    // Super Bowl (2nd Sun Feb)
                    if (m === 1) {
                        const firstDay = new Date(year, 1, 1).getDay();
                        const offset = (0 - firstDay + 7) % 7;
                        const secondSunDate = 1 + offset + 7;
                        if (date === secondSunDate) return { factor: 0.85 }
                    }
                    return { factor: 1.0 }
                }

                // D. Calculate Day by Day
                for (let i = 0; i < 7; i++) {
                    const dayDate = addDays(targetStart, i)
                    const dateStr = formatDateISO(dayDate)
                    const targetDayIndex = dayDate.getDay() // 0=Sun

                    // Factors
                    let weatherFactor = 1.0
                    let eventFactor = 1.0

                    const dayEvents = eventsList.filter((e: any) => e.date === dateStr)
                    dayEvents.forEach((e: any) => { eventFactor *= (Number(e.impact_multiplier) || 1.0) })

                    const hRule = checkHoliday(dayDate)
                    if (hRule.factor === 0.0) eventFactor = 0.0
                    else if (dayEvents.length === 0) eventFactor = hRule.factor

                    // Base Algorithm
                    const todayStr = formatDateISO(new Date())
                    const recentRows = historyList
                        .filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                        .filter((h: any) => h.business_date >= formatDateISO(lookbackStart) && h.business_date <= formatDateISO(lookbackEnd))
                        .sort((a: any, b: any) => new Date(b.business_date).getTime() - new Date(a.business_date).getTime())

                    const seasonalRow = historyList
                        .filter((h: any) => new Date(h.business_date + 'T00:00:00').getDay() === targetDayIndex)
                        .find((h: any) => h.business_date >= formatDateISO(seasonalStart) && h.business_date <= formatDateISO(seasonalEnd))

                    // Weighted Recent
                    const weights = [0.40, 0.20, 0.15, 0.10, 0.05, 0.05, 0.03, 0.02]
                    let wRecent = 0, tW = 0
                    recentRows.forEach((r: any, idx: number) => {
                        if (idx < weights.length) {
                            wRecent += (Number(r.net_sales) || 0) * weights[idx]
                            tW += weights[idx]
                        }
                    })
                    const finalRecent = tW > 0 ? wRecent / tW : 0

                    // Trend
                    let trend = 1.0
                    if (recentRows.length >= 6) {
                        const p1 = recentRows.slice(0, 2).reduce((a: any, b: any) => a + Number(b.net_sales), 0) / 2
                        const p2 = recentRows.slice(2, 6).reduce((a: any, b: any) => a + Number(b.net_sales), 0) / 4
                        if (p2 > 0) {
                            const raw = p1 / p2
                            trend = 1.0 + (raw - 1.0) * 0.5
                            trend = Math.max(0.90, Math.min(1.10, trend))
                        }
                    }

                    // Seasonal
                    const sSales = Number(seasonalRow?.net_sales) || 0
                    const isSeasonalValid = sSales > 0 && sSales > (finalRecent * 0.5)

                    let proj = 0
                    if (isSeasonalValid) {
                        proj = (finalRecent * 0.7 + sSales * 0.3) * (finalRecent > 0 ? trend : 1)
                    } else {
                        proj = finalRecent * trend
                    }

                    // Cap
                    const baseMax = Math.max(finalRecent, sSales)
                    if (baseMax > 0 && proj > baseMax * 1.25) proj = baseMax * 1.25

                    // Apply Factors
                    proj = proj * weatherFactor * eventFactor

                    if (proj > 0) {
                        salesProjections[dateStr] = Math.round(proj).toString() // NO CENTS
                    } else {
                        // Fallback: Use simple recent avg if strict algo failed
                        if (finalRecent > 0) salesProjections[dateStr] = Math.round(finalRecent).toString()
                        else salesProjections[dateStr] = "0"
                    }
                }
            }

            const totalProjectedSales = Object.values(salesProjections).reduce((a, b) => a + Number(b), 0)
            const laborPct = totalProjectedSales > 0 ? (totalSchedCost / totalProjectedSales) * 100 : 0
            console.log(`      💰 Proj Sales: $${totalProjectedSales.toFixed(0)} | Cost: $${totalSchedCost.toFixed(0)} | Hours: ${totalSchedHours.toFixed(1)} | Labor: ${laborPct.toFixed(1)}%`)


            // C. Update/Insert Weekly Budget
            const budgetPayload = {
                store_id: storeGuid,
                week_start: weekStartStr,
                sales_projections: salesProjections,
                // We don't explicitly store calculated cost/hours in DB columns (usually only projections), 
                // but if we did, we'd add them here. The table seems to only store 'sales_projections'.
                // Wait, user said "calculos... para que nos de total". BudgetTool calculates on fly usually.
                // But saving the SNAPSHOT is key.
                updated_at: new Date().toISOString()
            }

            const { error: upsertErr } = await supabase.from('weekly_budgets').upsert(budgetPayload, { onConflict: 'store_id,week_start' })
            if (upsertErr) console.error("      ❌ Budget Save Error:", upsertErr.message)
            else console.log("      ✅ Budget Saved")

            // D. Publish Drafts
            const draftIds = drafts.map(s => s.id)
            const { error: updateErr } = await supabase.from('shifts')
                .update({ status: 'published' })
                .in('id', draftIds)

            if (updateErr) console.error("      ❌ Publish Error:", updateErr.message)
            else console.log("      ✅ Drafts Published")
        }
    }

    console.log("\n✨ Done.")
}

run()
