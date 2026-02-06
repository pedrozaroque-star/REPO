/**
 * 📊 DEMAND VS SHIFTS ANALYSIS SCRIPT
 * 
 * Compara el mapa de demanda (forecast) con los turnos publicados (open_shifts)
 * para verificar si la cobertura es adecuada.
 * 
 * Usage: npx ts-node scripts/analyze-demand-vs-shifts.ts
 */

import { createClient } from '@supabase/supabase-js'
import { generateSmartForecast } from '../lib/intelligence'
import { format, addDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// Configuration
const STORE_NAME = 'Lynwood'
const WEEK_START = '2026-02-09' // Monday Feb 9

interface HourCoverage {
    hour: number
    demand: number
    coverage: number
    diff: number
    status: 'OK' | 'OVER' | 'UNDER'
}

interface DayAnalysis {
    date: string
    dayName: string
    kitchen: {
        hours: HourCoverage[]
        totalDemand: number
        totalCoverage: number
        avgDiff: number
        criticalHours: number[] // Hours with UNDER coverage
    }
    cashier: {
        hours: HourCoverage[]
        totalDemand: number
        totalCoverage: number
        avgDiff: number
        criticalHours: number[]
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('📊 ANÁLISIS: MAPA DE DEMANDA vs TURNOS PUBLICADOS')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`🏪 Tienda: ${STORE_NAME}`)
    console.log(`📅 Semana: ${WEEK_START}`)
    console.log('')

    // Get store ID
    const { data: store } = await supabase
        .from('stores')
        .select('external_id, name')
        .ilike('name', `%${STORE_NAME}%`)
        .single()

    if (!store) {
        console.error('❌ Tienda no encontrada')
        process.exit(1)
    }

    console.log(`✅ Store ID: ${store.external_id}`)
    console.log('')

    // Get published shifts for this week
    const { data: shifts, error } = await supabase
        .from('open_shifts')
        .select('*')
        .eq('store_id', store.external_id)
        .eq('week_start', WEEK_START)

    if (error) {
        console.error('❌ Error fetching shifts:', error)
        process.exit(1)
    }

    console.log(`📋 Turnos publicados encontrados: ${shifts?.length || 0}`)
    console.log('')

    // Analyze each day
    const weekStartDate = parseISO(WEEK_START)
    const analyses: DayAnalysis[] = []

    for (let i = 0; i < 7; i++) {
        const date = addDays(weekStartDate, i)
        const dateStr = format(date, 'yyyy-MM-dd')
        const dayName = format(date, 'EEEE d', { locale: es })

        console.log('───────────────────────────────────────────────────────────────')
        console.log(`📅 ${dayName.toUpperCase()} (${dateStr})`)
        console.log('───────────────────────────────────────────────────────────────')

        // Get demand forecast for this day
        const forecast = await generateSmartForecast(store.external_id, dateStr)

        if (!forecast || !forecast.hours) {
            console.log('⚠️ No hay forecast para este día')
            continue
        }

        // Get shifts for this day
        const dayShifts = shifts?.filter(s => s.shift_date === dateStr) || []
        const kitchenShifts = dayShifts.filter(s => s.position_type === 'kitchen')
        const cashierShifts = dayShifts.filter(s => s.position_type === 'cashier')

        console.log(`   Turnos cocina: ${kitchenShifts.length} | Turnos cajeros: ${cashierShifts.length}`)
        console.log('')

        // Analyze kitchen coverage hour by hour
        const kitchenAnalysis = analyzePosition(forecast.hours, kitchenShifts, 'kitchen')
        const cashierAnalysis = analyzePosition(forecast.hours, cashierShifts, 'cashier')

        // Print kitchen analysis
        console.log('   🍳 COCINA:')
        printHourlyTable(kitchenAnalysis.hours)
        console.log(`   Total Demanda: ${kitchenAnalysis.totalDemand} | Cobertura: ${kitchenAnalysis.totalCoverage} | Promedio Diff: ${kitchenAnalysis.avgDiff.toFixed(1)}`)
        if (kitchenAnalysis.criticalHours.length > 0) {
            console.log(`   ⚠️ Horas críticas (UNDER): ${kitchenAnalysis.criticalHours.map(h => formatHour(h)).join(', ')}`)
        }
        console.log('')

        // Print cashier analysis
        console.log('   💵 CAJEROS:')
        printHourlyTable(cashierAnalysis.hours)
        console.log(`   Total Demanda: ${cashierAnalysis.totalDemand} | Cobertura: ${cashierAnalysis.totalCoverage} | Promedio Diff: ${cashierAnalysis.avgDiff.toFixed(1)}`)
        if (cashierAnalysis.criticalHours.length > 0) {
            console.log(`   ⚠️ Horas críticas (UNDER): ${cashierAnalysis.criticalHours.map(h => formatHour(h)).join(', ')}`)
        }
        console.log('')

        analyses.push({
            date: dateStr,
            dayName,
            kitchen: kitchenAnalysis,
            cashier: cashierAnalysis
        })
    }

    // Print summary
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('📊 RESUMEN SEMANAL')
    console.log('═══════════════════════════════════════════════════════════════')

    let totalKitchenDemand = 0
    let totalKitchenCoverage = 0
    let totalCashierDemand = 0
    let totalCashierCoverage = 0
    let allKitchenCritical: string[] = []
    let allCashierCritical: string[] = []

    for (const day of analyses) {
        totalKitchenDemand += day.kitchen.totalDemand
        totalKitchenCoverage += day.kitchen.totalCoverage
        totalCashierDemand += day.cashier.totalDemand
        totalCashierCoverage += day.cashier.totalCoverage

        if (day.kitchen.criticalHours.length > 0) {
            allKitchenCritical.push(`${day.dayName}: ${day.kitchen.criticalHours.map(h => formatHour(h)).join(', ')}`)
        }
        if (day.cashier.criticalHours.length > 0) {
            allCashierCritical.push(`${day.dayName}: ${day.cashier.criticalHours.map(h => formatHour(h)).join(', ')}`)
        }
    }

    console.log('')
    console.log('🍳 COCINA:')
    console.log(`   Demanda Total Semana: ${totalKitchenDemand} personas-hora`)
    console.log(`   Cobertura Total: ${totalKitchenCoverage} personas-hora`)
    console.log(`   Diferencia: ${totalKitchenCoverage - totalKitchenDemand} (${((totalKitchenCoverage / totalKitchenDemand - 1) * 100).toFixed(1)}%)`)

    if (allKitchenCritical.length > 0) {
        console.log('   ⚠️ Días con horas críticas:')
        allKitchenCritical.forEach(c => console.log(`      - ${c}`))
    } else {
        console.log('   ✅ Sin horas críticas')
    }

    console.log('')
    console.log('💵 CAJEROS:')
    console.log(`   Demanda Total Semana: ${totalCashierDemand} personas-hora`)
    console.log(`   Cobertura Total: ${totalCashierCoverage} personas-hora`)
    console.log(`   Diferencia: ${totalCashierCoverage - totalCashierDemand} (${((totalCashierCoverage / totalCashierDemand - 1) * 100).toFixed(1)}%)`)

    if (allCashierCritical.length > 0) {
        console.log('   ⚠️ Días con horas críticas:')
        allCashierCritical.forEach(c => console.log(`      - ${c}`))
    } else {
        console.log('   ✅ Sin horas críticas')
    }

    console.log('')
    console.log('═══════════════════════════════════════════════════════════════')
}

function analyzePosition(
    forecastHours: { hour: number; required_kitchen: number; required_foh: number }[],
    shifts: any[],
    position: 'kitchen' | 'cashier'
): { hours: HourCoverage[]; totalDemand: number; totalCoverage: number; avgDiff: number; criticalHours: number[] } {
    const hours: HourCoverage[] = []
    let totalDemand = 0
    let totalCoverage = 0
    const criticalHours: number[] = []

    // Check each hour from 8am to 4am (8-28)
    for (let h = 8; h <= 28; h++) {
        const actualHour = h >= 24 ? h - 24 : h
        const forecastHour = forecastHours.find(f => f.hour === actualHour)

        if (!forecastHour) continue

        const demand = position === 'kitchen' ? forecastHour.required_kitchen : forecastHour.required_foh

        if (demand === 0) continue

        // Calculate coverage at this hour
        let coverage = 0
        for (const shift of shifts) {
            const startHour = shift.start_hour
            let endHour = shift.end_hour

            // Handle next-day hours (e.g., end_hour = 2 means 2am = 26)
            if (endHour <= startHour) {
                endHour += 24
            }

            // Check if this shift covers hour h
            if (h >= startHour && h < endHour) {
                coverage += shift.required_count
            }
        }

        const diff = coverage - demand
        const status: 'OK' | 'OVER' | 'UNDER' = diff === 0 ? 'OK' : diff > 0 ? 'OVER' : 'UNDER'

        if (status === 'UNDER') {
            criticalHours.push(h)
        }

        hours.push({ hour: h, demand, coverage, diff, status })
        totalDemand += demand
        totalCoverage += coverage
    }

    const avgDiff = hours.length > 0
        ? hours.reduce((sum, h) => sum + h.diff, 0) / hours.length
        : 0

    return { hours, totalDemand, totalCoverage, avgDiff, criticalHours }
}

function formatHour(h: number): string {
    const actualHour = h >= 24 ? h - 24 : h
    const suffix = h >= 12 && h < 24 ? 'pm' : 'am'
    const displayHour = actualHour === 0 ? 12 : actualHour > 12 ? actualHour - 12 : actualHour
    return `${displayHour}${suffix}`
}

function printHourlyTable(hours: HourCoverage[]) {
    // Print header
    let headerLine = '       '
    let demandLine = '   Dem:'
    let coverLine = '   Cov:'
    let statusLine = '       '

    for (const h of hours) {
        headerLine += formatHour(h.hour).padStart(4)
        demandLine += h.demand.toString().padStart(4)
        coverLine += h.coverage.toString().padStart(4)

        let statusChar = '✅'
        if (h.status === 'UNDER') statusChar = '❌'
        else if (h.status === 'OVER') statusChar = '⬆️'
        statusLine += statusChar.padStart(4)
    }

    console.log(headerLine)
    console.log(demandLine)
    console.log(coverLine)
    console.log(statusLine)
}

main().catch(console.error)
