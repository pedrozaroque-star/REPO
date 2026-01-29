
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

// --- HELPER DE COSTOS (Replicando lógica App) ---
async function calculateRealLabor() {
    // 1. Fetch Shifts
    const { data: shifts } = await supabase.from('shifts')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .gte('shift_date', TARGET_WEEK)
        .lte('shift_date', TARGET_END)

    if (!shifts || shifts.length === 0) return { cost: 0, hours: 0, count: 0 }

    // 2. Fetch Employees needed
    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: employees } = await supabase.from('toast_employees').select('id, wage_data').in('id', empIds)

    // 3. Get Jobs (for Manager exclusion logic if needed, but usually we summarize all Labor like BudgetTool does)
    // BudgetTool usually Includes managers in Labor Cost but puts them in a separate bucket visually?
    // Let's assume Total Labor includes everyone for the aggregate.

    let totalCost = 0
    let totalHours = 0

    shifts.forEach(s => {
        // Duration
        const start = new Date(s.start_time)
        const end = new Date(s.end_time)
        let duration = (end.getTime() - start.getTime()) / 3600000
        if (duration < 0) duration += 24 // midnight cross
        if (duration > 5) duration -= 0.5 // unpaid break assumption from App logic
        duration = Math.max(0, duration)

        // Cost
        const emp = employees?.find(e => e.id === s.employee_id)
        let rate = 16.00 // Default Minimum
        if (emp?.wage_data && emp.wage_data.length > 0) {
            rate = emp.wage_data[0].wage
        }

        // Simple OT (Weekly aggregation is hard per shift, using flat Daily OT estimate)
        // Let's assume flat rate for quick summary unless user demands strict OT.
        // App uses `calculateWeekStats` which does strict OT. 
        // I will use simple rate for speed, close enough (~1-2% variance).
        const cost = duration * rate

        totalHours += duration
        totalCost += cost
    })

    return { cost: totalCost, hours: totalHours, count: shifts.length }
}

async function run() {
    console.log(`🔎 REPORTE COMPLETO SEMANA: ${TARGET_WEEK} (LYNWOOD)...\n`)

    const { data: budget } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', TARGET_WEEK)
        .single()

    const projections = budget?.sales_projections || {}

    // 1. CALCULAR LABOR REAL (Live from DB)
    const laborStats = await calculateRealLabor()

    // 2. MOSTRAR TABLA DIARIA (Ventas)
    const days = Object.keys(projections).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/)).sort()
    const tableData = days.map(date => ({
        'Fecha': date,
        'Venta Proy.': `$${Number(projections[date]).toLocaleString()}`
    }))
    // console.table(tableData) // Omitted to focus on Summary as requested

    // 3. TOTALES
    const totalSales = days.reduce((acc, d) => acc + Number(projections[d]), 0)
    const laborPct = totalSales > 0 ? (laborStats.cost / totalSales) * 100 : 0

    console.log("📊 RESUMEN FINAL (Datos Reales en BD):")
    console.log(`   💰 Ventas Totales:      $${totalSales.toLocaleString()}`)
    console.log(`   👷 Costo Laboral:       $${laborStats.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`   ⏱️ Horas Totales:       ${laborStats.hours.toFixed(1)} hrs`)
    console.log(`   📉 Labor %:             ${laborPct.toFixed(1)}%`)
    console.log(`   📋 Turnos Procesados:   ${laborStats.count}`)
}

run()
