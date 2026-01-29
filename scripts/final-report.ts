
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

async function generateFinalReport() {
    console.log(`\n📊 REPORTE FINAL LYNWOOD (Semana ${TARGET_WEEK})\n`)

    // 1. VENTAS (Fuente: weekly_budgets)
    const { data: budget } = await supabase.from('weekly_budgets')
        .select('sales_projections').eq('store_id', LYNWOOD_GUID).eq('week_start', TARGET_WEEK).single()

    // 2. TURNOS (Fuente: shifts)
    const { data: shifts } = await supabase.from('shifts')
        .select('*').eq('store_id', LYNWOOD_GUID).gte('shift_date', TARGET_WEEK).lte('shift_date', TARGET_END)

    // 3. EMPLEADOS (Para Wages)
    const { data: emps } = await supabase.from('toast_employees').select('id, wage_data, job_ids')

    // CALCULO
    let totalSales = 0
    if (budget?.sales_projections) {
        totalSales = Object.values(budget.sales_projections).reduce((a: any, b: any) => a + Number(b), 0) as number
    }

    let totalHours = 0
    let totalLabor = 0

    shifts?.forEach(s => {
        // Horas
        const start = new Date(s.start_time)
        const end = new Date(s.end_time)
        let hours = (end.getTime() - start.getTime()) / 36e5

        // Regla de Breaks (Ajuste para coincidir con Frontend)
        // Frontend parece deducir 30min si > 5h
        // Si hay una discrepancia de 40h en 160 turnos... es aprox 15 min extra por turno?
        // O tal vez el frontend deduce 1 hora para turnos largos?

        // Simulación Standard CA
        if (hours > 5) hours -= 0.5
        hours = Math.max(0, hours)

        totalHours += hours

        // Costo (Wage)
        const emp = emps?.find(e => e.id === s.employee_id)
        let rate = 16.00
        if (emp?.wage_data?.[0]?.wage) rate = emp.wage_data[0].wage

        let cost = hours * rate
        // OT simplificado (>8h en el dia = 1.5x)
        if (hours > 8) {
            const otResults = (hours - 8) * rate * 0.5 // Add the extra 0.5x
            cost += otResults
        }

        totalLabor += cost
    })

    const laborPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0

    // IMPRESION DE TABLA
    console.log("-----------------------------------------")
    console.log(`METRICA           | VALOR (BD)`)
    console.log("-----------------------------------------")
    console.log(`Ventas Proyectadas| $${totalSales.toLocaleString()}`)
    console.log(`Labor $ (Est.)    | $${totalLabor.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`Horas (Est.)      | ${totalHours.toFixed(1)}`)
    console.log(`Labor %           | ${laborPct.toFixed(1)}%`)
    console.log("-----------------------------------------")
    console.log(`*Basado en ${shifts?.length} turnos guardados y salarios actuales.`)
}

generateFinalReport()
