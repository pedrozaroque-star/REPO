
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

// --- LOGICA EXACTA DEL FRONTEND (useWeeklyStats) ---
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

const calculateFullStats = (shifts: any[], employees: any[], jobs: any[]) => {
    let totalSchedCost = 0
    let totalSchedHours = 0

    // Agrupar turnos por empleado para calcular OT Semanal correctamente
    employees.forEach(emp => {
        const empShifts = shifts.filter(s => s.employee_id === emp.id)
        if (empShifts.length === 0) return

        // Ordenar cronológicamente
        const sorted = [...empShifts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())

        let regularHoursAccumulator = 0
        let dailyHoursAccumulator = 0
        let lastShiftDate = ""

        // Calcular Tarifa (Wage)
        // Lógica Frontend: Busca wage_data[0] o wage especifico por job
        let rate = 16.00 // Default CA Min Wage (aprox)
        if (emp.wage_data && emp.wage_data.length > 0) {
            // Simplificado: Tomar el primero si no hay job match, o buscar match
            // Asumimos match por default o wage base
            rate = emp.wage_data[0].wage
        }

        sorted.forEach(s => {
            const duration = calcDuration(s)

            // Reset daily accumulator if new day
            // Note: Frontend uses simplified logic comparing ISO date strings
            if (s.shift_date !== lastShiftDate) {
                dailyHoursAccumulator = 0
                lastShiftDate = s.shift_date
            }

            // --- 1. OT DIARIO ---
            let dailyOT = 0
            const hoursBeforeThisShift = dailyHoursAccumulator
            dailyHoursAccumulator += duration

            if (hoursBeforeThisShift >= 8) {
                // Ya pasamos las 8h antes de empezar este turno -> Todo es OT
                dailyOT = duration
            } else if (hoursBeforeThisShift + duration > 8) {
                // Cruzamos las 8h durante este turno
                dailyOT = (hoursBeforeThisShift + duration) - 8
            }

            const dailyRegular = duration - dailyOT

            // --- 2. OT SEMANAL ---
            let weeklyOT = 0
            // Solo las horas regulares cuentan para el acumulado semanal de 40h
            // (El OT diario ya se pagó a 1.5x, no cuenta doble)
            if (regularHoursAccumulator >= 40) {
                weeklyOT = dailyRegular
            } else if (regularHoursAccumulator + dailyRegular > 40) {
                weeklyOT = (regularHoursAccumulator + dailyRegular) - 40
            }

            // Sumar al acumulado semanal
            regularHoursAccumulator += (dailyRegular - weeklyOT) // Solo sumamos lo que quedó como regular

            // --- 3. COSTO FINAL DEL TURNO ---
            const totalShiftOT = dailyOT + weeklyOT
            const regularPaid = duration - totalShiftOT // Lo que no es OT, es regular

            const cost = (regularPaid * rate) + (totalShiftOT * rate * 1.5)
            const roundedCost = bankersRound(cost)

            // Acumular Totales Globales
            // (Excluir Managers del costo? No, BudgetTool incluye todo. Vamos a incluir todo)
            totalSchedHours += duration
            totalSchedCost += roundedCost
        })
    })

    return { totalSchedHours, totalSchedCost }
}

async function run() {
    console.log(`\n📊 REPORTE STRICT-MODE LYNWOOD (Semana ${TARGET_WEEK})\n`)

    const { data: budget } = await supabase.from('weekly_budgets')
        .select('sales_projections').eq('store_id', LYNWOOD_GUID).eq('week_start', TARGET_WEEK).single()

    // Fetch Data
    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    const empIds = [...new Set(shifts?.map(s => s.employee_id))]
    const { data: emps } = await supabase.from('toast_employees').select('*').in('id', empIds)
    const { data: jobs } = await supabase.from('toast_jobs').select('*')

    // --- LÓGICA DE FILTRADO FRONTEND (page.tsx) ---
    // El frontend solo considera empleados cuya "Home Store" incluye Lynwood.
    // Si un empleado foráneo tiene turno, el frontend lo ignora para el budget (posible bug del frontend o feature).
    const storeEmployees = (emps || []).filter((e: any) => {
        if (!e.store_ids) return false
        const stores = Array.isArray(e.store_ids) ? e.store_ids : JSON.stringify(e.store_ids)
        return stores.includes(LYNWOOD_GUID)
    })

    // Calc using FILTERED employees (This implicitly filters shifts too in the next function)
    const stats = calculateFullStats(shifts || [], storeEmployees, jobs || [])

    let totalSales = 0
    if (budget?.sales_projections) {
        totalSales = Object.values(budget.sales_projections).reduce((a: any, b: any) => a + Number(b), 0) as number
    }

    // Filter Managers?
    // Tu screenshot dice: $23,902.
    // Si mi cálculo da algo similar, estamos bien.
    // Si da mucho más, es que tal vez los Managers NO se suman al Labor Cost visible, o solo parcialmente.
    // Voy a imprimir el total crudo.

    const laborPct = totalSales > 0 ? (stats.totalSchedCost / totalSales) * 100 : 0

    console.log("-----------------------------------------")
    console.log(`METRICA           | VALOR (CALCULADO)`)
    console.log("-----------------------------------------")
    console.log(`Ventas Proyectadas| $${totalSales.toLocaleString()}`)
    console.log(`Labor $ (Strict)  | $${stats.totalSchedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`Horas (Strict)    | ${stats.totalSchedHours.toFixed(1)}`)
    console.log(`Labor %           | ${laborPct.toFixed(1)}%`)
    console.log("-----------------------------------------")
}

run()
