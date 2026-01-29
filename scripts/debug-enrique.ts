
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
const TARGET_NAME = 'Enrique' // Navarrete

// Helpers (Frontend Logic Copy)
const calcDuration = (s: any) => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    let rawDuration = (end.getTime() - start.getTime()) / 36e5
    if (rawDuration < 0) rawDuration += 24
    // Frontend Deduction
    return (rawDuration > 5) ? rawDuration - 0.5 : Math.max(0, rawDuration)
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

async function debugEnrique() {
    console.log("🕵️ DEBUGGING EMPLOYEE: Enrique Navarrete")

    // 1. Find Employee
    const { data: emps } = await supabase.from('toast_employees')
        .select('*').ilike('first_name', `%${TARGET_NAME}%`)

    if (!emps || emps.length === 0) { console.log("No Enrique found"); return }
    const emp = emps.find(e => e.last_name.includes("Navarrete")) || emps[0]
    console.log(`Found: ${emp.first_name} ${emp.last_name} (${emp.id})`)

    // 2. Find Shifts
    const { data: shifts } = await supabase.from('shifts')
        .select('*')
        .eq('employee_id', emp.id)
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', TARGET_WEEK)
        .lte('shift_date', TARGET_END)
        .order('start_time')

    console.log(`Found ${shifts?.length} shifts for him.`)

    // 3. Calculate Logic (Step by Step)
    let dailyHours = 0
    let regularHoursAccum = 0
    let totalPaid = 0
    let totalHoursVis = 0
    let lastDate = ""
    let rate = 16.00
    if (emp.wage_data?.[0]?.wage) rate = emp.wage_data[0].wage

    console.log(`Rate: $${rate}/hr`)
    console.log("---------------------------------------------------------------")
    console.log("Date       | Raw Dur | Ded | Net Dur | DailyOT | WeekOT | Cost")
    console.log("---------------------------------------------------------------")

    let totalSchedCost = 0

    shifts?.forEach(s => {
        const start = new Date(s.start_time)
        const end = new Date(s.end_time)
        let rawD = (end.getTime() - start.getTime()) / 36e5

        let ded = 0
        if (rawD > 5) ded = 0.5

        const netD = Math.max(0, rawD - ded)

        // Accumulators
        if (s.shift_date !== lastDate) { dailyHours = 0; lastDate = s.shift_date }

        let dOT = 0
        const prevDaily = dailyHours
        dailyHours += netD

        if (prevDaily >= 8) dOT = netD
        else if (prevDaily + netD > 8) dOT = (prevDaily + netD) - 8

        const dReg = netD - dOT

        let wOT = 0
        if (regularHoursAccum >= 40) wOT = dReg
        else if (regularHoursAccum + dReg > 40) wOT = (regularHoursAccum + dReg) - 40

        regularHoursAccum += (dReg - wOT)

        const totalOT = dOT + wOT
        const regPaid = netD - totalOT
        const cost = (regPaid * rate) + (totalOT * rate * 1.5)

        console.log(`${s.shift_date} | ${rawD.toFixed(2)}    | ${ded}   | ${netD.toFixed(2)}    | ${dOT.toFixed(2)}    | ${wOT.toFixed(2)}   | $${cost.toFixed(2)}`)

        totalSchedCost += cost
        totalHoursVis += netD
    })

    console.log("---------------------------------------------------------------")
    console.log(`TOTALS     |         |     | ${totalHoursVis.toFixed(2)}    |         |        | $${totalSchedCost.toFixed(2)}`)
    console.log(`EXPECTED   |         |     | 48.50      |         |        | $1,155.22`) // From User Image

    const diffH = totalHoursVis - 48.50
    const diffC = totalSchedCost - 1155.22
    console.log(`\nDIFF: ${diffH.toFixed(2)} hours | $${diffC.toFixed(2)}`)
}

debugEnrique()
