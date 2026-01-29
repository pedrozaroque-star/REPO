
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
    console.log(`\n📊 REPORTE DEPURADO 2.1 (Excluyendo Salario/Manager)\n`)

    const { data: budget } = await supabase.from('weekly_budgets')
        .select('sales_projections').eq('store_id', LYNWOOD_GUID).eq('week_start', TARGET_WEEK).single()

    // 2. Fetch ALL Shifts
    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    if (!shifts) return
    console.log(`\n🔎 [SCRIPT] Total Shifts Found: ${shifts.length}\n`)

    // 2. Fetch Employees
    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: emps } = await supabase.from('toast_employees').select('*').in('id', empIds)

    let totalH = 0
    let totalC = 0

    emps?.forEach(emp => {
        // --- EXCLUSIONES ---
        const name = (emp.first_name + ' ' + emp.last_name).toLowerCase()
        if (name.includes('camilo') || name.includes('anabel') || name.includes('willian')) return
        if (emp.deleted_at && emp.deleted_at.length > 5) return

        // EXCLUIR MANAGER (Carlos Velazquez) DEL CÁLCULO HORARIO
        // Para simular lo que hace la pantalla (al parecer los Managers Salaried no suman al 'Hours' total del widget)
        if (name.includes('carlos velazquez')) {
            // console.log("Skipping Manager (Salary): Carlos Velazquez")
            return
        }
        // -------------------

        const empShifts = shifts.filter(s => s.employee_id === emp.id)
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

            // Logic
            let dOT = 0
            if (dailyAcc >= 8) dOT = dur
            else if (dailyAcc + dur > 8) dOT = (dailyAcc + dur) - 8
            dailyAcc += dur
            const dReg = dur - dOT

            let wOT = 0
            if (weeklyAcc >= 40) wOT = dReg
            else if (weeklyAcc + dReg > 40) wOT = (weeklyAcc + dReg) - 40
            weeklyAcc += (dReg - wOT)

            const totOT = dOT + wOT
            const reg = dur - totOT
            const cost = (reg * rate) + (totOT * rate * 1.5)

            if (s.id === 'e59318f5-d6d8-44fe-a3a7-ad5512fd1910') {
                console.log(`FOUND TARGET SHIFT: ${s.id}`)
                console.log(`Start: ${s.start_time}, End: ${s.end_time}`)
                console.log(`Dur: ${dur}, Cost: ${cost}`)
            }

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
    console.log(`METRICA           | VALOR (FINAL)`)
    console.log("-----------------------------------------")
    console.log(`Ventas Proyectadas| $${totalSales.toLocaleString()}`)
    console.log(`Labor $           | $${totalC.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`Horas             | ${totalH.toFixed(1)}`)
    console.log(`Labor %           | ${pct.toFixed(1)}%`)
    console.log("-----------------------------------------")
}

run()
