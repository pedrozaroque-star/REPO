
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const LYNWOOD_GUID = '80a1ec95-bc73-402e-8884-e5abbe9343e6'
const TARGET_WEEK = '2026-01-26' // Lunes

async function run() {
    console.log(`🔎 CONSULTANDO PROYECCIÓN SEMANA: ${TARGET_WEEK} (LYNWOOD)...\n`)

    const { data: budget, error } = await supabase
        .from('weekly_budgets')
        .select('*')
        .eq('store_id', LYNWOOD_GUID)
        .eq('week_start', TARGET_WEEK)
        .single()

    if (error || !budget) {
        console.error("❌ No se encontró presupuesto para esta semana.")
        return
    }

    const projections = budget.sales_projections || {}
    const snapshot = projections._snapshot

    // DESGLOSE DIARIO DE VENTAS
    // Filtramos claves que sean fechas (evitamos _snapshot)
    const days = Object.keys(projections)
        .filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/))
        .sort()

    const tableData = days.map(date => {
        const dObj = new Date(date + 'T12:00:00') // Force noon to avoid TZ shift
        const dayName = dObj.toLocaleDateString('es-ES', { weekday: 'long' })
        const sales = Number(projections[date])
        return {
            'Día': dayName.charAt(0).toUpperCase() + dayName.slice(1),
            'Fecha': date,
            'Venta Proyectada': `$${sales.toLocaleString()}`
        }
    })

    console.table(tableData)
    console.log("-".repeat(60))

    // TOTALES
    if (snapshot) {
        console.log("📊 RESUMEN OFICIAL (SNAPSHOT):")
        console.log(`   💰 Ventas Totales:   $${snapshot.total_sales.toLocaleString()}`)
        console.log(`   👷 Costo Laboral:    $${snapshot.total_labor_cost.toLocaleString()}`)
        console.log(`   ⏱️ Horas Planif.:    ${snapshot.total_hours.toLocaleString()} hrs`)
        console.log(`   📉 Labor %:          ${snapshot.labor_pct}%`)
    } else {
        // Fallback si no hubiera snapshot (pero debería haber)
        const totalSales = days.reduce((acc, d) => acc + Number(projections[d]), 0)
        console.log("📊 RESUMEN (Calculado al vuelo):")
        console.log(`   💰 Ventas Totales:   $${totalSales.toLocaleString()}`)
        console.log("   (Snapshot de Labor no encontrado en este registro)")
    }
}

run()
