
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-26'
const TARGET_END = '2026-02-01'

// --- LOGICA EXACTA ---
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

async function run() {
    console.log(`\n📊 REPORTE DEPURADO LYNWOOD (Semana abslutamente real)\n`)
    console.log("   Excluyendo: Camilo, Anabel, Willian y Deleted employees.")

    // 1. Fetch Sales Budget
    const { data: budget } = await supabase.from('weekly_budgets')
        .select('sales_projections').eq('store_id', LYNWOOD_GUID).eq('week_start', TARGET_WEEK).single()

    // 2. Fetch Active Employees (Filter out deleted ones)
    const { data: emps } = await supabase.from('toast_employees').select('*')
    // Filter logic: Must not be deleted.
    // Also manual filter for names user mentioned just in case 'deleted_at' is null
    console.log(`Total DB Employees: ${emps?.length}`)
    const activeEmps = emps?.filter(e => {
        // Safe check for Deleted At (it might be a soft delete logic)
        if (e.deleted_at && e.deleted_at.length > 5) return false

        const first = e.first_name || ''
        const last = e.last_name || ''
        const name = (first + ' ' + last).toLowerCase()

        if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return false
        return true
    })
    console.log(`Active (Filtered) Employees: ${activeEmps?.length}`)

    const activeIds = activeEmps?.map(e => e.id) || []

    // 3. Fetch Shifts (Fetch ALL for store, filter in memory to avoid Supabase URL limit)
    const { data: rawShifts } = await supabase.from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', TARGET_WEEK)
        .lte('shift_date', TARGET_END)

    // In-Memory Filter
    const activeIdSet = new Set(activeIds)
    const shifts = rawShifts?.filter(s => activeIdSet.has(s.employee_id))

    // 4. Calculate Stats
    let totalH = 0
    let totalC = 0

    // Group logic for Weekly OT
    activeEmps?.forEach(emp => {
        const empShifts = shifts?.filter(s => s.employee_id === emp.id) || []
        if (empShifts.length === 0) return

        const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

        let dailyAcc = 0
        let lastDate = ""
        let weeklyAcc = 0

        let rate = 16.00
        if (emp.wage_data?.[0]?.wage) rate = emp.wage_data[0].wage

        sorted.forEach(s => {
            if (s.shift_date !== lastDate) { dailyAcc = 0; lastDate = s.shift_date }

            const dur = calcDuration(s)

            // Daily OT
            let dOT = 0
            if (dailyAcc >= 8) dOT = dur
            else if (dailyAcc + dur > 8) dOT = (dailyAcc + dur) - 8
            dailyAcc += dur
            const dReg = dur - dOT

            // Weekly OT
            let wOT = 0
            if (weeklyAcc >= 40) wOT = dReg
            else if (weeklyAcc + dReg > 40) wOT = (weeklyAcc + dReg) - 40
            weeklyAcc += (dReg - wOT)

            const totOT = dOT + wOT
            const reg = dur - totOT

            const cost = (reg * rate) + (totOT * rate * 1.5)

            totalH += dur
            totalC += bankersRound(cost)
        })
    })

    let totalSales = 0
    if (budget?.sales_projections) {
        totalSales = Object.values(budget.sales_projections).reduce((a: any, b: any) => a + Number(b), 0)
    }
    const pct = totalSales > 0 ? (totalC / totalSales) * 100 : 0

    console.log("-----------------------------------------")
    console.log(`METRICA           | VALOR (DEPURADO)`)
    console.log("-----------------------------------------")
    console.log(`Ventas Proyectadas| $${totalSales.toLocaleString()}`)
    console.log(`Labor $           | $${totalC.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`Horas             | ${totalH.toFixed(1)}`)
    console.log(`Labor %           | ${pct.toFixed(1)}%`)
    console.log("-----------------------------------------")
}

run()
