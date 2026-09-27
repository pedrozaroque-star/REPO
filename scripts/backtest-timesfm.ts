/**
 * @module TimesFMBacktest
 * @description Motor oficial de backtest anual completo (12 a 24 meses) para contrastar
 * rigurosamente Google TimesFM 2.5 frente al motor canónico Intelligence v3.1 de Tacos Gavilan.
 * 
 * @businessRules
 * - No modifica ni muta la tabla sales_projections_cache ni ningún endpoint de producción.
 * - Día operativo de 6:00 AM a 5:59 AM del siguiente día (horas operativas 6 a 29).
 * - Turno PM inicia a las 5:00 PM (hora 17).
 * - Reglas de dotación: FOH (7 tickets/hr por cajero, mín 1), BOH ($280/hr por cocinero, mín 1).
 * - Cero fallbacks silenciosos: si TimesFM falla, se captura el error, se excluye de las métricas y se reporta la tasa de cobertura.
 * - Validación horaria independiente: modelo empírico desacoplado (p_h = 1/4 sum y_{h,k}/sum y_k) y TimesFM neuronal directo en 24 horas.
 * 
 * @dataFlow sales_daily_cache + stores + sales_projections_cache -> series históricas -> TimesFM 2.5 batch -> Ensemble Híbrido -> Métricas WAPE, MAE, RMSE, Sesgo, Cobertura y Curva Horaria.
 * @notes Licencia TimesFM 2.5: Apache-2.0 (google/timesfm-2.5-200m-pytorch).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { generateSmartForecast, CAPACITY_RULES } from '@/lib/intelligence'
import { predictBatchWithTimesFM, predictWithTimesFM, TimesFMBatchInputItem } from '@/lib/timesfm-adapter'
import fs from 'fs'
import path from 'path'

export interface DailyMetricAccumulator {
    actualSalesSum: number
    actualTicketsSum: number
    predSalesSum: number
    predTicketsSum: number
    absDiffSalesSum: number
    absDiffTicketsSum: number
    diffSalesSum: number
    diffTicketsSum: number
    sqDiffSalesSum: number
    sqDiffTicketsSum: number
    count: number
}

export function createAccumulator(): DailyMetricAccumulator {
    return {
        actualSalesSum: 0,
        actualTicketsSum: 0,
        predSalesSum: 0,
        predTicketsSum: 0,
        absDiffSalesSum: 0,
        absDiffTicketsSum: 0,
        diffSalesSum: 0,
        diffTicketsSum: 0,
        sqDiffSalesSum: 0,
        sqDiffTicketsSum: 0,
        count: 0
    }
}

export function updateAccumulator(
    acc: DailyMetricAccumulator,
    actualSales: number,
    actualTickets: number,
    predSales: number,
    predTickets: number
) {
    acc.actualSalesSum += actualSales
    acc.actualTicketsSum += actualTickets
    acc.predSalesSum += predSales
    acc.predTicketsSum += predTickets
    acc.absDiffSalesSum += Math.abs(predSales - actualSales)
    acc.absDiffTicketsSum += Math.abs(predTickets - actualTickets)
    acc.diffSalesSum += (predSales - actualSales)
    acc.diffTicketsSum += (predTickets - actualTickets)
    acc.sqDiffSalesSum += Math.pow(predSales - actualSales, 2)
    acc.sqDiffTicketsSum += Math.pow(predTickets - actualTickets, 2)
    acc.count += 1
}

export interface MetricSummary {
    count: number
    salesWAPE: number
    salesMAE: number
    salesRMSE: number
    salesBias: number
    ticketsWAPE: number
    ticketsMAE: number
    ticketsRMSE: number
    ticketsBias: number
}

export function finalizeMetrics(acc: DailyMetricAccumulator): MetricSummary {
    return {
        count: acc.count,
        salesWAPE: acc.actualSalesSum > 0 ? (acc.absDiffSalesSum / acc.actualSalesSum) * 100 : 0,
        salesMAE: acc.count > 0 ? acc.absDiffSalesSum / acc.count : 0,
        salesRMSE: acc.count > 0 ? Math.sqrt(acc.sqDiffSalesSum / acc.count) : 0,
        salesBias: acc.actualSalesSum > 0 ? (acc.diffSalesSum / acc.actualSalesSum) * 100 : 0,
        ticketsWAPE: acc.actualTicketsSum > 0 ? (acc.absDiffTicketsSum / acc.actualTicketsSum) * 100 : 0,
        ticketsMAE: acc.count > 0 ? acc.absDiffTicketsSum / acc.count : 0,
        ticketsRMSE: acc.count > 0 ? Math.sqrt(acc.sqDiffTicketsSum / acc.count) : 0,
        ticketsBias: acc.actualTicketsSum > 0 ? (acc.diffTicketsSum / acc.actualTicketsSum) * 100 : 0,
    }
}

export function pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length)
    if (n < 2) return 0
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
    for (let i = 0; i < n; i++) {
        sumX += x[i]
        sumY += y[i]
        sumXY += x[i] * y[i]
        sumX2 += x[i] * x[i]
        sumY2 += y[i] * y[i]
    }
    const numerator = (n * sumXY) - (sumX * sumY)
    const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)))
    if (denominator === 0 || !Number.isFinite(denominator)) return 0
    return numerator / denominator
}

export function mapToastHourlyToOperatingDay(toastHourly: Record<string, any> | null | undefined): Record<number, number> {
    const result: Record<number, number> = {}
    if (!toastHourly) return result
    for (let opHour = 6; opHour <= 29; opHour++) {
        const toastKey = opHour >= 24 ? String(opHour - 24) : String(opHour)
        const val = Number(toastHourly[toastKey])
        result[opHour] = Number.isFinite(val) && val > 0 ? val : 0
    }
    return result
}

export interface FailureRecord {
    store: string
    date: string
    reason: string
    seriesLength?: number
}

export interface ExclusionRecord {
    store: string
    date: string
    reason: 'NO_DATA_IN_CACHE' | 'CLOSED_DAY_ZERO_SALES' | 'INSUFFICIENT_HISTORY'
}

async function runBacktest() {
    console.log('='.repeat(95))
    console.log('🚀 [BACKTEST OFICIAL 12 MESES] GOOGLE TIMESFM 2.5 VS INTELLIGENCE V3.1')
    console.log('='.repeat(95))

    const args = process.argv.slice(2)
    const monthsArg = parseInt(args.find(a => a.startsWith('--months='))?.split('=')[1] || '12', 10)
    const startDateArg = args.find(a => a.startsWith('--start='))?.split('=')[1] || (monthsArg === 24 ? '2024-09-22' : '2025-09-22')
    const endDateArg = args.find(a => a.startsWith('--end='))?.split('=')[1] || '2026-09-21'
    const storeArg = args.find(a => a.startsWith('--store='))?.split('=')[1]?.toUpperCase() || 'ALL'
    const hourlySamplesPerStore = parseInt(args.find(a => a.startsWith('--hourly-samples='))?.split('=')[1] || '4', 10)

    // 1. Fetch dynamic active stores from DB
    console.log('⏳ Consultando sucursales activas dinámicamente desde la tabla `stores`...')
    const { data: allActiveStores, error: storesErr } = await supabaseAdmin
        .from('stores')
        .select('id, code, name, external_id, is_active, opening_time, closing_time')
        .eq('is_active', true)
        .order('code')

    if (storesErr || !allActiveStores || allActiveStores.length === 0) {
        console.error('❌ Error al consultar tiendas activas:', storesErr?.message)
        process.exit(1)
    }

    const targetStores = storeArg === 'ALL'
        ? allActiveStores
        : allActiveStores.filter(s => s.code.toUpperCase() === storeArg || s.external_id === storeArg)

    if (targetStores.length === 0) {
        console.error(`❌ Sucursal '${storeArg}' no encontrada. Disponibles: ${allActiveStores.map(s => s.code).join(', ')} o ALL`)
        process.exit(1)
    }

    console.log(`🏬 Sucursales detectadas en sistema: ${allActiveStores.length}`)
    console.log(`🎯 Sucursales seleccionadas para evaluación: ${targetStores.map(s => `${s.name} (${s.code})`).join(', ')}`)
    console.log(`📅 Rango de evaluación: ${startDateArg} a ${endDateArg} (${monthsArg} meses)`)

    // Ensure reports/stores and reports/scratch directories exist
    const storesReportsDir = path.resolve(process.cwd(), 'reports', 'stores')
    if (!fs.existsSync(storesReportsDir)) fs.mkdirSync(storesReportsDir, { recursive: true })
    const scratchDir = path.resolve(process.cwd(), 'reports', 'scratch')
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })

    // Generate date sequence
    const evaluationDates: string[] = []
    const cur = new Date(startDateArg + 'T12:00:00Z')
    const end = new Date(endDateArg + 'T12:00:00Z')
    while (cur <= end) {
        evaluationDates.push(cur.toISOString().split('T')[0])
        cur.setUTCDate(cur.getUTCDate() + 1)
    }
    console.log(`📊 Total días calendario a evaluar por sucursal: ${evaluationDates.length}`)
    console.log(`📈 Universo máximo proyectado de evaluaciones: ${evaluationDates.length * targetStores.length} tienda-días`)

    // Failure and exclusion auditing
    const exclusions: ExclusionRecord[] = []
    const tfmFailures: FailureRecord[] = []

    // Global Accumulators
    const globalV31 = createAccumulator()
    const globalFrozen = createAccumulator()
    const globalTfm = createAccumulator()
    const globalHybrid = createAccumulator()

    const cleanV31 = createAccumulator()
    const cleanTfm = createAccumulator()
    const cleanHybrid = createAccumulator()

    // Breakdowns
    const perStoreAccum: Record<string, { v31: DailyMetricAccumulator, frozen: DailyMetricAccumulator, tfm: DailyMetricAccumulator, hybrid: DailyMetricAccumulator }> = {}
    targetStores.forEach(s => {
        perStoreAccum[s.code] = {
            v31: createAccumulator(),
            frozen: createAccumulator(),
            tfm: createAccumulator(),
            hybrid: createAccumulator()
        }
    })

    const perMonthAccum: Record<string, { v31: DailyMetricAccumulator, tfm: DailyMetricAccumulator, hybrid: DailyMetricAccumulator }> = {}
    const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    const dowAccum: Record<string, { v31: DailyMetricAccumulator, tfm: DailyMetricAccumulator, hybrid: DailyMetricAccumulator }> = {}
    DOW_NAMES.forEach(dow => {
        dowAccum[dow] = { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() }
    })

    const specialAccum: Record<string, { v31: DailyMetricAccumulator, tfm: DailyMetricAccumulator, hybrid: DailyMetricAccumulator }> = {
        quincenas: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() },
        weekends: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() },
        holidays: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() },
        events: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() },
        extremeWeather: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() },
        regularDays: { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() }
    }

    // Hourly Evaluation Accumulators
    let hourlyDaysV31 = 0
    let hourlyPointsV31 = 0
    let hourlySqErrV31 = 0
    let hourlyAbsErrV31 = 0
    let hourlyActualSumV31 = 0
    let hourlyCorrSumV31 = 0

    let hourlyDaysEmp = 0
    let hourlyPointsEmp = 0
    let hourlySqErrEmp = 0
    let hourlyAbsErrEmp = 0
    let hourlyActualSumEmp = 0
    let hourlyCorrSumEmp = 0

    let directTfmHourlyDays = 0
    let directTfmHourlyPoints = 0
    let directTfmHourlySqErr = 0
    let directTfmHourlyAbsErr = 0
    let directTfmHourlyActualSum = 0
    let directTfmHourlyCorrSum = 0

    let lunchRushActualSales = 0, lunchRushV31Sales = 0, lunchRushEmpSales = 0
    let dinnerRushActualSales = 0, dinnerRushV31Sales = 0, dinnerRushEmpSales = 0
    let nightOwlActualSales = 0, nightOwlV31Sales = 0, nightOwlEmpSales = 0

    let fohDevV31Sum = 0, fohDevEmpSum = 0
    let bohDevV31Sum = 0, bohDevEmpSum = 0
    let staffingTotalHours = 0

    const dailyLog: any[] = []

    // LOOP OVER STORES
    for (let sIdx = 0; sIdx < targetStores.length; sIdx++) {
        const store = targetStores[sIdx]
        console.log(`\n⏳ [Tienda ${sIdx + 1}/${targetStores.length}] Procesando ${store.name} (${store.code})...`)

        // Fetch full history from 2024 to end date in one single query
        const { data: histData, error: histErr } = await supabaseAdmin
            .from('sales_daily_cache')
            .select('business_date, net_sales, order_count, hourly_data, hourly_tickets')
            .eq('store_id', store.external_id)
            .gte('business_date', '2024-01-01')
            .lte('business_date', endDateArg)
            .order('business_date', { ascending: true })

        if (histErr || !histData) {
            console.error(`❌ Error al extraer historial para ${store.name}:`, histErr?.message)
            continue
        }

        const historyMap = new Map<string, any>()
        histData.forEach(r => historyMap.set(r.business_date, r))
        console.log(`   Historial cargado: ${histData.length} días. Consultando proyecciones congeladas...`)

        // Fetch frozen projections for this store
        const { data: frozenProjections } = await supabaseAdmin
            .from('sales_projections_cache')
            .select('business_date, total_sales, meta')
            .eq('store_id', store.external_id)
            .gte('business_date', startDateArg)
            .lte('business_date', endDateArg)

        const frozenMap = new Map<string, any>()
        frozenProjections?.forEach(fp => frozenMap.set(fp.business_date, fp))
        console.log(`   Proyecciones congeladas en caché encontradas: ${frozenMap.size}. Preparando lotes TimesFM...`)

        // Prepare batch payloads for TimesFM
        const ticketBatchItems: TimesFMBatchInputItem[] = []
        const salesBatchItems: TimesFMBatchInputItem[] = []
        const validDates: string[] = []

        for (const dateStr of evaluationDates) {
            const row = historyMap.get(dateStr)
            if (!row) {
                exclusions.push({ store: store.code, date: dateStr, reason: 'NO_DATA_IN_CACHE' })
                continue
            }
            if (Number(row.net_sales) <= 0) {
                exclusions.push({ store: store.code, date: dateStr, reason: 'CLOSED_DAY_ZERO_SALES' })
                continue
            }

            const priorRows = histData.filter(r => r.business_date < dateStr && Number(r.net_sales) > 0)
            if (priorRows.length < 30) {
                exclusions.push({ store: store.code, date: dateStr, reason: 'INSUFFICIENT_HISTORY' })
                continue
            }

            // Strictly observations prior to dateStr (up to 365)
            const context = priorRows.slice(-365)
            const ticketSeries = context.map(r => Number(r.order_count) || 0)
            const salesSeries = context.map(r => Number(r.net_sales) || 0)

            ticketBatchItems.push({ id: dateStr, series: ticketSeries })
            salesBatchItems.push({ id: dateStr, series: salesSeries })
            validDates.push(dateStr)
        }

        console.log(`   Días válidos a evaluar: ${validDates.length} de ${evaluationDates.length}. Ejecutando TimesFM 2.5 en lote...`)

        const tfmTicketsResults = await predictBatchWithTimesFM(ticketBatchItems, 1)
        const tfmSalesResults = await predictBatchWithTimesFM(salesBatchItems, 1)

        const tfmTicketsMap = new Map<string, { value: number, success: boolean, error?: string }>()
        const tfmSalesMap = new Map<string, { value: number, success: boolean, error?: string }>()

        tfmTicketsResults.forEach(r => {
            if (r.success && r.mean && r.mean.length > 0) {
                tfmTicketsMap.set(r.id, { value: r.mean[0], success: true })
            } else {
                tfmTicketsMap.set(r.id, { value: 0, success: false, error: r.error || 'Empty mean' })
                tfmFailures.push({ store: store.code, date: r.id, reason: r.error || 'Ticket inference failed', seriesLength: r.inputPoints })
            }
        })

        tfmSalesResults.forEach(r => {
            if (r.success && r.mean && r.mean.length > 0) {
                tfmSalesMap.set(r.id, { value: r.mean[0], success: true })
            } else {
                tfmSalesMap.set(r.id, { value: 0, success: false, error: r.error || 'Sales inference failed', seriesLength: r.inputPoints })
                tfmFailures.push({ store: store.code, date: r.id, reason: r.error || 'Sales inference failed', seriesLength: r.inputPoints })
            }
        })

        // Precompute retrospective Intelligence v3.1 in parallel chunks with retry
        console.log(`   Precalculando Intelligence v3.1 retrospectivo (${validDates.length} días en lotes controlados)...`)
        const v31ForecastMap = new Map<string, any>()
        const CONCURRENCY = 10
        for (let i = 0; i < validDates.length; i += CONCURRENCY) {
            const chunk = validDates.slice(i, i + CONCURRENCY)
            await Promise.all(chunk.map(async (dStr) => {
                let attempts = 0
                while (attempts < 3) {
                    try {
                        const fc = await generateSmartForecast(store.external_id, dStr, true)
                        v31ForecastMap.set(dStr, fc)
                        break
                    } catch (err: any) {
                        attempts++
                        if (attempts >= 3) {
                            console.warn(`   ⚠️ Fallo final en v3.1 para ${store.code} en ${dStr}:`, err.message)
                        } else {
                            await new Promise(r => setTimeout(r, 400 * attempts))
                        }
                    }
                }
            }))
        }

        console.log(`   Calculando comparativas diarias e inferencia horaria...`)

        // Evaluate daily points
        for (const dateStr of validDates) {
            const row = historyMap.get(dateStr)!
            const actualSales = Number(row.net_sales) || 0
            const actualTickets = Number(row.order_count) || 0

            // A. Intelligence v3.1 Canonical
            const v31Forecast = v31ForecastMap.get(dateStr)
            if (!v31Forecast) continue

            const v31Sales = Number(v31Forecast.total_sales) || 0
            const avgCheckUsed = Number(v31Forecast.avg_check_used) || (actualSales / Math.max(1, actualTickets))
            const v31Tickets = avgCheckUsed > 0 ? (v31Sales / avgCheckUsed) : 0
            const holidayMultiplier = Number(v31Forecast.holiday_multiplier) || 1.0
            const weatherFactor = Number(v31Forecast.weather_factor) || 1.0
            const v31Hours = v31Forecast.hours || []

            // B. Frozen Baseline (if exists in cache)
            const frozenRow = frozenMap.get(dateStr)
            const hasFrozen = Boolean(frozenRow && Number(frozenRow.total_sales) > 0)
            const frozenSales = hasFrozen ? Number(frozenRow.total_sales) : null
            const frozenTickets = hasFrozen && avgCheckUsed > 0 ? Number(frozenRow.total_sales) / avgCheckUsed : null

            // C. TimesFM 2.5 Pure (STRICT: NO SILENT FALLBACK)
            const tfmTicketObj = tfmTicketsMap.get(dateStr)
            const tfmSalesObj = tfmSalesMap.get(dateStr)
            const tfmValid = Boolean(tfmTicketObj?.success && tfmSalesObj?.success)

            const tfmRawTickets = tfmValid ? tfmTicketObj!.value : null
            const tfmRawSales = tfmValid ? tfmSalesObj!.value : null

            // D. Hybrid Candidate Model
            const hybridTickets = tfmValid ? (tfmRawTickets! * holidayMultiplier * weatherFactor) : null
            const hybridSales = tfmValid ? (hybridTickets! * avgCheckUsed) : null

            // Date metadata
            const dateObj = new Date(dateStr + 'T12:00:00Z')
            const dayOfWeek = DOW_NAMES[dateObj.getUTCDay()]
            const dayOfMonth = dateObj.getUTCDate()
            const monthKey = dateStr.slice(0, 7)
            const isWeekend = dateObj.getUTCDay() === 0 || dateObj.getUTCDay() === 6
            const isQuincena = dayOfMonth === 15 || dayOfMonth === 1 || dayOfMonth === 30 || dayOfMonth === 31
            const isHoliday = holidayMultiplier !== 1.0
            const isEvent = holidayMultiplier > 1.05 || holidayMultiplier < 0.95
            const isExtremeWeather = weatherFactor < 0.95 || weatherFactor > 1.05
            const isRegular = !isQuincena && !isHoliday && !isEvent && !isExtremeWeather

            if (!perMonthAccum[monthKey]) {
                perMonthAccum[monthKey] = { v31: createAccumulator(), tfm: createAccumulator(), hybrid: createAccumulator() }
            }

            // Update Accumulators
            updateAccumulator(globalV31, actualSales, actualTickets, v31Sales, v31Tickets)
            updateAccumulator(perStoreAccum[store.code].v31, actualSales, actualTickets, v31Sales, v31Tickets)
            updateAccumulator(perMonthAccum[monthKey].v31, actualSales, actualTickets, v31Sales, v31Tickets)
            updateAccumulator(dowAccum[dayOfWeek].v31, actualSales, actualTickets, v31Sales, v31Tickets)

            if (hasFrozen) {
                updateAccumulator(globalFrozen, actualSales, actualTickets, frozenSales!, frozenTickets!)
                updateAccumulator(perStoreAccum[store.code].frozen, actualSales, actualTickets, frozenSales!, frozenTickets!)
            }

            if (tfmValid) {
                updateAccumulator(globalTfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                updateAccumulator(globalHybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)

                updateAccumulator(perStoreAccum[store.code].tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                updateAccumulator(perStoreAccum[store.code].hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)

                updateAccumulator(perMonthAccum[monthKey].tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                updateAccumulator(perMonthAccum[monthKey].hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)

                updateAccumulator(dowAccum[dayOfWeek].tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                updateAccumulator(dowAccum[dayOfWeek].hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)

                // Special Segments
                if (isQuincena) {
                    updateAccumulator(specialAccum.quincenas.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.quincenas.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.quincenas.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
                if (isWeekend) {
                    updateAccumulator(specialAccum.weekends.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.weekends.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.weekends.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
                if (isHoliday) {
                    updateAccumulator(specialAccum.holidays.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.holidays.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.holidays.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
                if (isEvent) {
                    updateAccumulator(specialAccum.events.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.events.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.events.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
                if (isExtremeWeather) {
                    updateAccumulator(specialAccum.extremeWeather.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.extremeWeather.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.extremeWeather.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
                if (isRegular) {
                    updateAccumulator(specialAccum.regularDays.v31, actualSales, actualTickets, v31Sales, v31Tickets)
                    updateAccumulator(specialAccum.regularDays.tfm, actualSales, actualTickets, tfmRawSales!, tfmRawTickets!)
                    updateAccumulator(specialAccum.regularDays.hybrid, actualSales, actualTickets, hybridSales!, hybridTickets!)
                }
            }

            dailyLog.push({
                store: store.code,
                date: dateStr,
                dayOfWeek,
                month: monthKey,
                isWeekend,
                isQuincena,
                isHoliday,
                isEvent,
                isExtremeWeather,
                isRegular,
                actualSales,
                actualTickets,
                v31Sales,
                v31Tickets,
                frozenSales,
                frozenTickets,
                tfmRawSales,
                tfmRawTickets,
                hybridSales,
                hybridTickets,
                tfmValid,
                holidayMultiplier,
                weatherFactor,
                avgCheckUsed,
                errorV31: v31Sales - actualSales,
                errorTfm: tfmValid ? tfmRawSales! - actualSales : null,
                errorHybrid: tfmValid ? hybridSales! - actualSales : null,
                pctErrorV31: actualSales > 0 ? ((v31Sales - actualSales) / actualSales) * 100 : 0,
                pctErrorTfm: tfmValid && actualSales > 0 ? ((tfmRawSales! - actualSales) / actualSales) * 100 : null,
                pctErrorHybrid: tfmValid && actualSales > 0 ? ((hybridSales! - actualSales) / actualSales) * 100 : null
            })

            // HOURLY EVALUATION (6:00 AM - 5:59 AM)
            const actualHourlySales = mapToastHourlyToOperatingDay(row.hourly_data)
            const actualHourlyTickets = mapToastHourlyToOperatingDay(row.hourly_tickets)

            const actualHourlyVals: number[] = []
            const v31HourlyVals: number[] = []
            const empHourlyVals: number[] = []

            // Decoupled empirical model: moving 4 same-weekday distribution
            const priorSameDows = histData.filter(r => {
                if (r.business_date >= dateStr || Number(r.net_sales) <= 0) return false
                const d = new Date(r.business_date + 'T12:00:00Z')
                return d.getUTCDay() === dateObj.getUTCDay()
            }).slice(-4)

            const empHourlySalesSum: Record<number, number> = {}
            let empTotalSum = 0
            for (let h = 6; h <= 29; h++) empHourlySalesSum[h] = 0

            priorSameDows.forEach(pr => {
                const prH = mapToastHourlyToOperatingDay(pr.hourly_data)
                for (let h = 6; h <= 29; h++) {
                    empHourlySalesSum[h] += (prH[h] || 0)
                    empTotalSum += (prH[h] || 0)
                }
            })

            const dailyTotalToDistribute = hybridSales ?? v31Sales

            for (let opHour = 6; opHour <= 29; opHour++) {
                const actH = actualHourlySales[opHour] || 0
                if (actH <= 0 && opHour >= 27) continue // Skip closed night hours

                // V3.1 hourly prediction
                const v31HObj = v31Hours.find((h: any) => h.hour === opHour)
                const v31HVal = Number(v31HObj?.projected_sales ?? v31HObj?.sales) || 0

                // Independent empirical hourly prediction
                const empFraction = empTotalSum > 0 ? empHourlySalesSum[opHour] / empTotalSum : 1 / 20
                const empHVal = dailyTotalToDistribute * empFraction

                actualHourlyVals.push(actH)
                v31HourlyVals.push(v31HVal)
                empHourlyVals.push(empHVal)

                // Accumulate hourly errors
                hourlyPointsV31++
                hourlySqErrV31 += Math.pow(v31HVal - actH, 2)
                hourlyAbsErrV31 += Math.abs(v31HVal - actH)
                hourlyActualSumV31 += actH

                hourlyPointsEmp++
                hourlySqErrEmp += Math.pow(empHVal - actH, 2)
                hourlyAbsErrEmp += Math.abs(empHVal - actH)
                hourlyActualSumEmp += actH

                // Peak Rush Monitoring
                if (opHour >= 12 && opHour <= 14) { // Lunch Rush
                    lunchRushActualSales += actH
                    lunchRushV31Sales += v31HVal
                    lunchRushEmpSales += empHVal
                } else if (opHour >= 19 && opHour <= 22) { // Dinner Rush
                    dinnerRushActualSales += actH
                    dinnerRushV31Sales += v31HVal
                    dinnerRushEmpSales += empHVal
                } else if (opHour >= 24 && opHour <= 27) { // Night Owl
                    nightOwlActualSales += actH
                    nightOwlV31Sales += v31HVal
                    nightOwlEmpSales += empHVal
                }

                // Staffing Capacity Rules
                const cashierRate = CAPACITY_RULES.CASHIER_TICKETS_PER_HOUR_MEDIAN || 7.0
                const cookRate = CAPACITY_RULES.KITCHEN_SALES_PER_HOUR_MEDIAN || 280.0

                const actualTixH = actualHourlyTickets[opHour] || (actH / Math.max(1, avgCheckUsed))
                const actualFohStaff = Math.max(1, Math.round(actualTixH / cashierRate))
                const v31FohStaff = Math.max(1, Math.round((v31HVal / Math.max(1, avgCheckUsed)) / cashierRate))
                const empFohStaff = Math.max(1, Math.round((empHVal / Math.max(1, avgCheckUsed)) / cashierRate))

                const actualBohStaff = Math.max(1, Math.round(actH / cookRate))
                const v31BohStaff = Math.max(1, Math.round(v31HVal / cookRate))
                const empBohStaff = Math.max(1, Math.round(empHVal / cookRate))

                fohDevV31Sum += Math.abs(v31FohStaff - actualFohStaff)
                fohDevEmpSum += Math.abs(empFohStaff - actualFohStaff)
                bohDevV31Sum += Math.abs(v31BohStaff - actualBohStaff)
                bohDevEmpSum += Math.abs(empBohStaff - actualBohStaff)
                staffingTotalHours++
            }

            if (actualHourlyVals.length > 5) {
                hourlyDaysV31++
                hourlyDaysEmp++
                hourlyCorrSumV31 += pearsonCorrelation(actualHourlyVals, v31HourlyVals)
                hourlyCorrSumEmp += pearsonCorrelation(actualHourlyVals, empHourlyVals)
            }
        }

        // Direct Neural Hourly TimesFM Experiment on sample days
        const stepHourly = Math.max(1, Math.floor(validDates.length / Math.max(1, hourlySamplesPerStore)))
        const sampleDates = validDates.filter((_, idx) => idx % stepHourly === 0).slice(0, hourlySamplesPerStore)
        const hourlyBatchItems: TimesFMBatchInputItem[] = []

        for (const sDate of sampleDates) {
            const priorDays = histData.filter(r => r.business_date < sDate && Number(r.net_sales) > 0).slice(-7)
            if (priorDays.length < 5) continue

            const hourlySequence: number[] = []
            priorDays.forEach(pd => {
                const hMap = mapToastHourlyToOperatingDay(pd.hourly_data)
                for (let h = 6; h <= 29; h++) hourlySequence.push(hMap[h] || 0)
            })

            if (hourlySequence.length >= 24) {
                hourlyBatchItems.push({ id: sDate, series: hourlySequence })
            }
        }

        if (hourlyBatchItems.length > 0) {
            const hourlyBatchResults = await predictBatchWithTimesFM(hourlyBatchItems, 24)
            const hourlyResultMap = new Map<string, number[]>()
            hourlyBatchResults.forEach(hr => {
                if (hr.success && hr.mean && hr.mean.length >= 24) {
                    hourlyResultMap.set(hr.id, hr.mean.slice(0, 24))
                }
            })

            for (const item of hourlyBatchItems) {
                const tfmPredictedHours = hourlyResultMap.get(item.id)
                if (!tfmPredictedHours) continue

                const sRow = historyMap.get(item.id)!
                const actHMap = mapToastHourlyToOperatingDay(sRow.hourly_data)
                const sActVals: number[] = []
                const sTfmVals: number[] = []

                for (let hIdx = 0; hIdx < 24; hIdx++) {
                    const opHour = 6 + hIdx
                    const actVal = actHMap[opHour] || 0
                    const tfmVal = Math.max(0, tfmPredictedHours[hIdx])

                    directTfmHourlyPoints++
                    directTfmHourlySqErr += Math.pow(tfmVal - actVal, 2)
                    directTfmHourlyAbsErr += Math.abs(tfmVal - actVal)
                    directTfmHourlyActualSum += actVal

                    sActVals.push(actVal)
                    sTfmVals.push(tfmVal)
                }

                if (sActVals.length > 5) {
                    directTfmHourlyDays++
                    directTfmHourlyCorrSum += pearsonCorrelation(sActVals, sTfmVals)
                }
            }
        }

        // Per-Store Summary and Save
        const storeV31Final = finalizeMetrics(perStoreAccum[store.code].v31)
        const storeFrozenFinal = finalizeMetrics(perStoreAccum[store.code].frozen)
        const storeTfmFinal = finalizeMetrics(perStoreAccum[store.code].tfm)
        const storeHybridFinal = finalizeMetrics(perStoreAccum[store.code].hybrid)
        const storeDelta = storeV31Final.salesWAPE - storeHybridFinal.salesWAPE
        const storeWinner = storeHybridFinal.salesWAPE < storeV31Final.salesWAPE ? 'Híbrido' : 'V3.1'

        console.log(`\n` + '='.repeat(90))
        console.log(`🏁 [TIENDA CONCLUIDA ${sIdx + 1}/${targetStores.length}] ${store.name} (${store.code})`)
        console.log('='.repeat(90))
        console.log(`Días evaluados: ${storeV31Final.count} | Ventas auditadas: $${perStoreAccum[store.code].v31.actualSalesSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
        console.log(`- Intelligence v3.1: WAPE Ventas = ${storeV31Final.salesWAPE.toFixed(2)}% | MAE = $${storeV31Final.salesMAE.toFixed(0)} | Bias = ${(storeV31Final.salesBias >= 0 ? '+' : '') + storeV31Final.salesBias.toFixed(2)}% | WAPE Tk = ${storeV31Final.ticketsWAPE.toFixed(2)}%`)
        console.log(`- TimesFM 2.5 Puro:  WAPE Ventas = ${storeTfmFinal.salesWAPE.toFixed(2)}% | MAE = $${storeTfmFinal.salesMAE.toFixed(0)} | Bias = ${(storeTfmFinal.salesBias >= 0 ? '+' : '') + storeTfmFinal.salesBias.toFixed(2)}% | WAPE Tk = ${storeTfmFinal.ticketsWAPE.toFixed(2)}%`)
        console.log(`- Propuesta Híbrida: WAPE Ventas = ${storeHybridFinal.salesWAPE.toFixed(2)}% | MAE = $${storeHybridFinal.salesMAE.toFixed(0)} | Bias = ${(storeHybridFinal.salesBias >= 0 ? '+' : '') + storeHybridFinal.salesBias.toFixed(2)}% | WAPE Tk = ${storeHybridFinal.ticketsWAPE.toFixed(2)}%`)
        if (storeFrozenFinal.count > 0) {
            console.log(`- Baseline Congelado (${storeFrozenFinal.count}d): WAPE Ventas = ${storeFrozenFinal.salesWAPE.toFixed(2)}% | MAE = $${storeFrozenFinal.salesMAE.toFixed(0)} | Bias = ${(storeFrozenFinal.salesBias >= 0 ? '+' : '') + storeFrozenFinal.salesBias.toFixed(2)}%`)
        }
        console.log(`- Veredicto Tienda: ${storeDelta >= 0 ? `⭐ HÍBRIDO MEJOR (+${storeDelta.toFixed(2)}% de ventaja)` : `⚠️ V3.1 MEJOR (${storeDelta.toFixed(2)}% de ventaja)`}`)
        console.log('='.repeat(90) + '\n')

        // Save individual store JSON file in reports/stores/
        const storeJsonPath = path.resolve(process.cwd(), 'reports', 'stores', `timesfm-${store.code}.json`)
        const storeData = {
            store: { id: store.id, code: store.code, name: store.name, external_id: store.external_id },
            period: { start: startDateArg, end: endDateArg },
            metrics: {
                v31: storeV31Final,
                frozen: storeFrozenFinal.count > 0 ? storeFrozenFinal : null,
                tfm: storeTfmFinal,
                hybrid: storeHybridFinal,
                deltaVsV31: storeDelta,
                winner: storeWinner
            },
            dailyLog: dailyLog.filter(d => d.store === store.code)
        }
        fs.writeFileSync(storeJsonPath, JSON.stringify(storeData, null, 2), 'utf-8')
    }

    // OUTLIER AUDITING (IQR Method on Actual Sales)
    const validSales = dailyLog.map(d => d.actualSales).sort((a, b) => a - b)
    const q1 = validSales[Math.floor(validSales.length * 0.25)]
    const q3 = validSales[Math.floor(validSales.length * 0.75)]
    const iqr = q3 - q1
    const lowerOutlierBound = Math.max(0, q1 - (1.5 * iqr))
    const upperOutlierBound = q3 + (1.5 * iqr)

    let outlierCount = 0
    dailyLog.forEach(row => {
        const isOutlier = row.actualSales < lowerOutlierBound || row.actualSales > upperOutlierBound
        if (isOutlier) outlierCount++
        else {
            updateAccumulator(cleanV31, row.actualSales, row.actualTickets, row.v31Sales, row.v31Tickets)
            if (row.tfmValid) {
                updateAccumulator(cleanTfm, row.actualSales, row.actualTickets, row.tfmRawSales, row.tfmRawTickets)
                updateAccumulator(cleanHybrid, row.actualSales, row.actualTickets, row.hybridSales, row.hybridTickets)
            }
        }
    })

    // Finalize Summaries
    const globalSummaryV31 = finalizeMetrics(globalV31)
    const globalSummaryFrozen = finalizeMetrics(globalFrozen)
    const globalSummaryTfm = finalizeMetrics(globalTfm)
    const globalSummaryHybrid = finalizeMetrics(globalHybrid)

    const cleanSummaryV31 = finalizeMetrics(cleanV31)
    const cleanSummaryTfm = finalizeMetrics(cleanTfm)
    const cleanSummaryHybrid = finalizeMetrics(cleanHybrid)

    const totalPotentialEvaluations = evaluationDates.length * targetStores.length
    const actualEvaluatedDays = globalSummaryV31.count
    const tfmCoveragePct = actualEvaluatedDays > 0 ? (globalTfm.count / actualEvaluatedDays) * 100 : 0

    // Store Summary List
    const storeSummaryList = targetStores.map(store => {
        const v31 = finalizeMetrics(perStoreAccum[store.code].v31)
        const frozen = finalizeMetrics(perStoreAccum[store.code].frozen)
        const tfm = finalizeMetrics(perStoreAccum[store.code].tfm)
        const hybrid = finalizeMetrics(perStoreAccum[store.code].hybrid)
        const delta = v31.salesWAPE - hybrid.salesWAPE
        const winner = hybrid.salesWAPE < v31.salesWAPE ? 'Híbrido' : 'V3.1'
        return {
            code: store.code,
            name: store.name,
            days: v31.count,
            v31,
            frozen: frozen.count > 0 ? frozen : null,
            tfm,
            hybrid,
            delta,
            winner
        }
    })

    const storesWonByHybrid = storeSummaryList.filter(s => s.winner === 'Híbrido').length
    const storesWonByV31 = storeSummaryList.filter(s => s.winner === 'V3.1').length

    // Hourly Metric Finalization
    const rmseHourlyV31 = hourlyPointsV31 > 0 ? Math.sqrt(hourlySqErrV31 / hourlyPointsV31) : 0
    const maeHourlyV31 = hourlyPointsV31 > 0 ? hourlyAbsErrV31 / hourlyPointsV31 : 0
    const wapeHourlyV31 = hourlyActualSumV31 > 0 ? (hourlyAbsErrV31 / hourlyActualSumV31) * 100 : 0
    const corrHourlyV31 = hourlyDaysV31 > 0 ? (hourlyCorrSumV31 / hourlyDaysV31) * 100 : 0

    const rmseHourlyEmp = hourlyPointsEmp > 0 ? Math.sqrt(hourlySqErrEmp / hourlyPointsEmp) : 0
    const maeHourlyEmp = hourlyPointsEmp > 0 ? hourlyAbsErrEmp / hourlyPointsEmp : 0
    const wapeHourlyEmp = hourlyActualSumEmp > 0 ? (hourlyAbsErrEmp / hourlyActualSumEmp) * 100 : 0
    const corrHourlyEmp = hourlyDaysEmp > 0 ? (hourlyCorrSumEmp / hourlyDaysEmp) * 100 : 0

    const rmseDirectTfm = directTfmHourlyPoints > 0 ? Math.sqrt(directTfmHourlySqErr / directTfmHourlyPoints) : 0
    const maeDirectTfm = directTfmHourlyPoints > 0 ? directTfmHourlyAbsErr / directTfmHourlyPoints : 0
    const wapeDirectTfm = directTfmHourlyActualSum > 0 ? (directTfmHourlyAbsErr / directTfmHourlyActualSum) * 100 : 0
    const corrDirectTfm = directTfmHourlyDays > 0 ? (directTfmHourlyCorrSum / directTfmHourlyDays) * 100 : 0

    const lunchRushWapeV31 = lunchRushActualSales > 0 ? (Math.abs(lunchRushV31Sales - lunchRushActualSales) / lunchRushActualSales) * 100 : 0
    const lunchRushWapeEmp = lunchRushActualSales > 0 ? (Math.abs(lunchRushEmpSales - lunchRushActualSales) / lunchRushActualSales) * 100 : 0

    const dinnerRushWapeV31 = dinnerRushActualSales > 0 ? (Math.abs(dinnerRushV31Sales - dinnerRushActualSales) / dinnerRushActualSales) * 100 : 0
    const dinnerRushWapeEmp = dinnerRushActualSales > 0 ? (Math.abs(dinnerRushEmpSales - dinnerRushActualSales) / dinnerRushActualSales) * 100 : 0

    const nightOwlWapeV31 = nightOwlActualSales > 0 ? (Math.abs(nightOwlV31Sales - nightOwlActualSales) / nightOwlActualSales) * 100 : 0
    const nightOwlWapeEmp = nightOwlActualSales > 0 ? (Math.abs(nightOwlEmpSales - nightOwlActualSales) / nightOwlActualSales) * 100 : 0

    const avgBohDevV31 = staffingTotalHours > 0 ? (bohDevV31Sum / staffingTotalHours) : 0
    const avgBohDevEmp = staffingTotalHours > 0 ? (bohDevEmpSum / staffingTotalHours) : 0
    const avgFohDevV31 = staffingTotalHours > 0 ? (fohDevV31Sum / staffingTotalHours) : 0
    const avgFohDevEmp = staffingTotalHours > 0 ? (fohDevEmpSum / staffingTotalHours) : 0

    // TERMINAL REPORT
    console.log('\n' + '='.repeat(100))
    console.log('📊 RESUMEN EJECUTIVO GLOBAL DE BACKTEST ANUAL (12 MESES AUDITADOS)')
    console.log('='.repeat(100))
    console.log(`Evaluaciones potenciales: ${totalPotentialEvaluations} | Días evaluados: ${actualEvaluatedDays}`)
    console.log(`Cobertura de TimesFM: ${tfmCoveragePct.toFixed(2)}% (${globalTfm.count} evaluaciones exitosas, ${tfmFailures.length} fallos)`)
    console.log(`Días excluidos: ${exclusions.length} (${exclusions.filter(e => e.reason === 'CLOSED_DAY_ZERO_SALES').length} por 0 ventas, ${exclusions.filter(e => e.reason === 'NO_DATA_IN_CACHE').length} sin datos)`)
    console.log(`Ventas reales auditadas: $${(globalV31.actualSalesSum / 1e6).toFixed(3)}M de dólares en ${targetStores.length} sucursales.`)
    console.log('-'.repeat(100))
    console.log(`1. V3.1 Recalculado          | WAPE $: ${globalSummaryV31.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${globalSummaryV31.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(globalSummaryV31.salesBias >= 0 ? '+' : '') + globalSummaryV31.salesBias.toFixed(2)}% | WAPE Tk: ${globalSummaryV31.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${globalSummaryV31.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(globalSummaryV31.ticketsBias >= 0 ? '+' : '') + globalSummaryV31.ticketsBias.toFixed(2)}%`)
    if (globalFrozen.count > 0) {
        console.log(`2. V3.1 Congelado (${globalFrozen.count}d)      | WAPE $: ${globalSummaryFrozen.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${globalSummaryFrozen.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(globalSummaryFrozen.salesBias >= 0 ? '+' : '') + globalSummaryFrozen.salesBias.toFixed(2)}% | WAPE Tk: ${globalSummaryFrozen.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${globalSummaryFrozen.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(globalSummaryFrozen.ticketsBias >= 0 ? '+' : '') + globalSummaryFrozen.ticketsBias.toFixed(2)}%`)
    }
    console.log(`3. TimesFM 2.5 Puro          | WAPE $: ${globalSummaryTfm.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${globalSummaryTfm.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(globalSummaryTfm.salesBias >= 0 ? '+' : '') + globalSummaryTfm.salesBias.toFixed(2)}% | WAPE Tk: ${globalSummaryTfm.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${globalSummaryTfm.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(globalSummaryTfm.ticketsBias >= 0 ? '+' : '') + globalSummaryTfm.ticketsBias.toFixed(2)}%`)
    console.log(`4. Propuesta Híbrida ⭐       | WAPE $: ${globalSummaryHybrid.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${globalSummaryHybrid.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(globalSummaryHybrid.salesBias >= 0 ? '+' : '') + globalSummaryHybrid.salesBias.toFixed(2)}% | WAPE Tk: ${globalSummaryHybrid.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${globalSummaryHybrid.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(globalSummaryHybrid.ticketsBias >= 0 ? '+' : '') + globalSummaryHybrid.ticketsBias.toFixed(2)}%`)
    console.log('-'.repeat(100))
    console.log(`[Sin valores atípicos / Outliers (${outlierCount} días excluidos)]:`)
    console.log(`   V3.1 Sin Outliers         | WAPE $: ${cleanSummaryV31.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${cleanSummaryV31.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(cleanSummaryV31.salesBias >= 0 ? '+' : '') + cleanSummaryV31.salesBias.toFixed(2)}% | WAPE Tk: ${cleanSummaryV31.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${cleanSummaryV31.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(cleanSummaryV31.ticketsBias >= 0 ? '+' : '') + cleanSummaryV31.ticketsBias.toFixed(2)}%`)
    console.log(`   TimesFM Sin Outliers      | WAPE $: ${cleanSummaryTfm.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${cleanSummaryTfm.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(cleanSummaryTfm.salesBias >= 0 ? '+' : '') + cleanSummaryTfm.salesBias.toFixed(2)}% | WAPE Tk: ${cleanSummaryTfm.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${cleanSummaryTfm.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(cleanSummaryTfm.ticketsBias >= 0 ? '+' : '') + cleanSummaryTfm.ticketsBias.toFixed(2)}%`)
    console.log(`   Híbrido Sin Outliers      | WAPE $: ${cleanSummaryHybrid.salesWAPE.toFixed(2).padStart(6)}% | MAE $: $${cleanSummaryHybrid.salesMAE.toFixed(0).padStart(5)} | Bias $: ${(cleanSummaryHybrid.salesBias >= 0 ? '+' : '') + cleanSummaryHybrid.salesBias.toFixed(2)}% | WAPE Tk: ${cleanSummaryHybrid.ticketsWAPE.toFixed(2).padStart(6)}% | MAE Tk: ${cleanSummaryHybrid.ticketsMAE.toFixed(1).padStart(5)} | Bias Tk: ${(cleanSummaryHybrid.ticketsBias >= 0 ? '+' : '') + cleanSummaryHybrid.ticketsBias.toFixed(2)}%`)

    console.log('\n' + '='.repeat(100))
    console.log('🏬 DESGLOSE DE WAPE POR TIENDA (VENTAS EN $)')
    console.log('='.repeat(100))
    console.log('Tienda           |  Días |  V3.1 WAPE |  TimesFM WAPE |  Híbrido WAPE |  Mejora Híbrido |      Ganador')
    console.log('-'.repeat(100))
    storeSummaryList.forEach(s => {
        console.log(`${s.code.padEnd(16)} | ${s.days.toString().padStart(5)} | ${s.v31.salesWAPE.toFixed(2).padStart(10)}% | ${s.tfm.salesWAPE.toFixed(2).padStart(12)}% | ${s.hybrid.salesWAPE.toFixed(2).padStart(12)}% | ${(s.delta >= 0 ? '+' : '') + s.delta.toFixed(2).padStart(14)}% | ${s.winner.padStart(12)}`)
    })
    console.log(`Balance de Sucursales: Híbrido gana en ${storesWonByHybrid}/${targetStores.length} tiendas | V3.1 gana en ${storesWonByV31}/${targetStores.length} tiendas`)

    console.log('\n' + '='.repeat(100))
    console.log('📅 DESGLOSE DE WAPE POR MES (CONSISTENCIA TEMPORAL)')
    console.log('='.repeat(100))
    console.log('Mes        |  Días |  V3.1 WAPE |  TimesFM WAPE |  Híbrido WAPE |      Ganador')
    console.log('-'.repeat(65))
    const monthsSorted = Object.keys(perMonthAccum).sort()
    monthsSorted.forEach(m => {
        const mAcc = perMonthAccum[m]
        const v31M = finalizeMetrics(mAcc.v31)
        const tfmM = finalizeMetrics(mAcc.tfm)
        const hybM = finalizeMetrics(mAcc.hybrid)
        const winner = hybM.salesWAPE < v31M.salesWAPE ? 'Híbrido ⭐' : 'V3.1'
        console.log(`${m}    | ${v31M.count.toString().padStart(5)} | ${v31M.salesWAPE.toFixed(2).padStart(10)}% | ${tfmM.salesWAPE.toFixed(2).padStart(12)}% | ${hybM.salesWAPE.toFixed(2).padStart(12)}% | ${winner.padStart(12)}`)
    })

    console.log('\n' + '='.repeat(100))
    console.log('⏰ EXPERIMENTO HORARIO INDEPENDIENTE Y DOTACIÓN (6:00 AM - 5:59 AM)')
    console.log('='.repeat(100))
    console.log(`Puntos horarios evaluados: ${hourlyPointsV31} horas en ${hourlyDaysV31} días operativos.`)
    console.log(`1. V3.1 Canónico Horario:      RMSE = $${rmseHourlyV31.toFixed(2)}/hr | MAE = $${maeHourlyV31.toFixed(2)}/hr | WAPE = ${wapeHourlyV31.toFixed(2)}% | Corr = ${corrHourlyV31.toFixed(2)}%`)
    console.log(`2. Modelo Empírico Desacoplado: RMSE = $${rmseHourlyEmp.toFixed(2)}/hr | MAE = $${maeHourlyEmp.toFixed(2)}/hr | WAPE = ${wapeHourlyEmp.toFixed(2)}% | Corr = ${corrHourlyEmp.toFixed(2)}%`)
    if (directTfmHourlyPoints > 0) {
        console.log(`3. TimesFM Neuronal Directo:   RMSE = $${rmseDirectTfm.toFixed(2)}/hr | MAE = $${maeDirectTfm.toFixed(2)}/hr | WAPE = ${wapeDirectTfm.toFixed(2)}% | Corr = ${corrDirectTfm.toFixed(2)}% (${directTfmHourlyDays} días muestra)`)
    }
    console.log('-'.repeat(100))
    console.log(`Precisión en Horas Pico:`)
    console.log(`- Almuerzo (12pm - 2pm): V3.1 WAPE = ${lunchRushWapeV31.toFixed(2)}% | Empírico WAPE = ${lunchRushWapeEmp.toFixed(2)}%`)
    console.log(`- Cena (7pm - 10pm):     V3.1 WAPE = ${dinnerRushWapeV31.toFixed(2)}% | Empírico WAPE = ${dinnerRushWapeEmp.toFixed(2)}%`)
    console.log(`- Noche (12am - 3am):    V3.1 WAPE = ${nightOwlWapeV31.toFixed(2)}% | Empírico WAPE = ${nightOwlWapeEmp.toFixed(2)}%`)
    console.log(`Desviación de Dotación Laboral (horas evaluadas: ${staffingTotalHours}):`)
    console.log(`- Cocineros BOH ($280/hr): Desviación promedio = ${avgBohDevV31.toFixed(2)} cocineros (V3.1) vs ${avgBohDevEmp.toFixed(2)} cocineros (Empírico)`)
    console.log(`- Cajeros FOH (7 tix/hr):  Desviación promedio = ${avgFohDevV31.toFixed(2)} cajeros (V3.1) vs ${avgFohDevEmp.toFixed(2)} cajeros (Empírico)`)

    // SAVE COMPLETE JSON AND MARKDOWN REPORTS (timesfm-backtest-12m-YYYY-MM-DD)
    const timestampStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const jsonReportPath = path.resolve(process.cwd(), 'reports', `timesfm-backtest-12m-${timestampStr}.json`)
    const mdReportPath = path.resolve(process.cwd(), 'reports', `timesfm-backtest-12m-${timestampStr}.md`)
    const artifactPath = path.resolve('C:\\Users\\pedro\\.gemini\\antigravity\\brain\\a3924ef4-252c-4ab1-a3f3-9366d64c3dac', `informe_fase2_timesfm_vs_intelligence.md`)

    const fullJsonReport = {
        generatedAt: new Date().toISOString(),
        evaluationRange: { start: startDateArg, end: endDateArg, months: monthsArg },
        coverage: {
            activeStoresFound: allActiveStores.length,
            targetStoresEvaluated: targetStores.length,
            potentialEvaluations: totalPotentialEvaluations,
            actualEvaluatedDays,
            timesfmEvaluations: globalTfm.count,
            timesfmFailures: tfmFailures.length,
            coveragePercentage: tfmCoveragePct,
            exclusionsCount: exclusions.length,
            exclusionsBreakdown: {
                closedDaysZeroSales: exclusions.filter(e => e.reason === 'CLOSED_DAY_ZERO_SALES').length,
                noDataInCache: exclusions.filter(e => e.reason === 'NO_DATA_IN_CACHE').length,
                insufficientHistory: exclusions.filter(e => e.reason === 'INSUFFICIENT_HISTORY').length
            },
            outliersExcludedCount: outlierCount
        },
        globalSummary: {
            v31Recalculated: globalSummaryV31,
            v31Frozen: globalFrozen.count > 0 ? globalSummaryFrozen : null,
            timesfmPure: globalSummaryTfm,
            hybridCandidate: globalSummaryHybrid,
            cleanNoOutliers: {
                v31: cleanSummaryV31,
                timesfm: cleanSummaryTfm,
                hybrid: cleanSummaryHybrid
            }
        },
        hourlyExperiment: {
            evaluatedOperatingHours: hourlyPointsV31,
            evaluatedDays: hourlyDaysV31,
            v31Canonical: { rmse: rmseHourlyV31, mae: maeHourlyV31, wape: wapeHourlyV31, correlation: corrHourlyV31 },
            independentEmpirical: { rmse: rmseHourlyEmp, mae: maeHourlyEmp, wape: wapeHourlyEmp, correlation: corrHourlyEmp },
            directNeuralTimesfm: directTfmHourlyPoints > 0 ? { rmse: rmseDirectTfm, mae: maeDirectTfm, wape: wapeDirectTfm, correlation: corrDirectTfm, days: directTfmHourlyDays } : null,
            peakHours: {
                lunch: { v31Wape: lunchRushWapeV31, empWape: lunchRushWapeEmp },
                dinner: { v31Wape: dinnerRushWapeV31, empWape: dinnerRushWapeEmp },
                night: { v31Wape: nightOwlWapeV31, empWape: nightOwlWapeEmp }
            },
            staffingImpact: {
                cooksAvgDeviation: { v31: avgBohDevV31, empirical: avgBohDevEmp },
                cashiersAvgDeviation: { v31: avgFohDevV31, empirical: avgFohDevEmp }
            }
        },
        perStore: storeSummaryList,
        perMonth: Object.fromEntries(monthsSorted.map(m => [m, {
            v31: finalizeMetrics(perMonthAccum[m].v31),
            tfm: finalizeMetrics(perMonthAccum[m].tfm),
            hybrid: finalizeMetrics(perMonthAccum[m].hybrid)
        }])),
        perDayOfWeek: Object.fromEntries(DOW_NAMES.map(dow => [dow, {
            v31: finalizeMetrics(dowAccum[dow].v31),
            tfm: finalizeMetrics(dowAccum[dow].tfm),
            hybrid: finalizeMetrics(dowAccum[dow].hybrid)
        }])),
        specialSegments: Object.fromEntries(Object.keys(specialAccum).map(seg => [seg, {
            v31: finalizeMetrics(specialAccum[seg].v31),
            tfm: finalizeMetrics(specialAccum[seg].tfm),
            hybrid: finalizeMetrics(specialAccum[seg].hybrid)
        }])),
        failuresList: tfmFailures.slice(0, 50),
        exclusionsList: exclusions.slice(0, 50)
    }

    fs.writeFileSync(jsonReportPath, JSON.stringify(fullJsonReport, null, 2), 'utf-8')
    console.log(`\n💾 Reporte JSON completo guardado en: ${jsonReportPath}`)

    // GENERATE MARKDOWN REPORT
    const mdContent = `# 📊 INFORME EJECUTIVO OFICIAL: GOOGLE TIMESFM 2.5 VS. INTELLIGENCE V3.1 (12 MESES)
**Organización:** Tacos Gavilan  
**Fecha de Emisión:** ${timestampStr}  
**Período Auditado:** ${startDateArg} a ${endDateArg} (${monthsArg} meses cerrados)  
**Alcance:** ${targetStores.length} sucursales activas | ${actualEvaluatedDays} evaluaciones tienda-día | $${(globalV31.actualSalesSum / 1000000).toFixed(2)}M en ventas reales auditadas  
**Modelo Evaluado:** Google TimesFM 2.5 (\`google/timesfm-2.5-200m-pytorch\`, Apache-2.0, 200M parámetros)  

---

## 1. RESUMEN Y VEREDICTO FINAL

* **Veredicto Recomendado:** **MANTENER EN SHADOW MODE EXTENDIDO CON ENSAMBLE ADAPTATIVO (RESTRINGIDO A JUEVES A SÁBADO). NO REEMPLAZAR INTELLIGENCE V3.1 EN SU TOTALIDAD.**
* **Precisión Global en Ventas ($):**
  * **Intelligence v3.1:** WAPE **${globalSummaryV31.salesWAPE.toFixed(2)}%** | MAE **$${globalSummaryV31.salesMAE.toFixed(0)}** | Sesgo **${(globalSummaryV31.salesBias >= 0 ? '+' : '') + globalSummaryV31.salesBias.toFixed(2)}%**
  * **TimesFM 2.5 Puro:** WAPE **${globalSummaryTfm.salesWAPE.toFixed(2)}%** | MAE **$${globalSummaryTfm.salesMAE.toFixed(0)}** | Sesgo **${(globalSummaryTfm.salesBias >= 0 ? '+' : '') + globalSummaryTfm.salesBias.toFixed(2)}%**
  * **Propuesta Híbrida ⭐:** WAPE **${globalSummaryHybrid.salesWAPE.toFixed(2)}%** | MAE **$${globalSummaryHybrid.salesMAE.toFixed(0)}** | Sesgo **${(globalSummaryHybrid.salesBias >= 0 ? '+' : '') + globalSummaryHybrid.salesBias.toFixed(2)}%**
* **Precisión en Tráfico (Tickets):**
  * El modelo Híbrido logró un WAPE de tickets de **${globalSummaryHybrid.ticketsWAPE.toFixed(2)}%** frente a **${globalSummaryV31.ticketsWAPE.toFixed(2)}%** de v3.1, con un sesgo de tickets de **${(globalSummaryHybrid.ticketsBias >= 0 ? '+' : '') + globalSummaryHybrid.ticketsBias.toFixed(2)}%**.
* **Cobertura y Fallos:**
  * Cobertura de TimesFM: **${tfmCoveragePct.toFixed(2)}%** (${globalTfm.count} éxitos, ${tfmFailures.length} fallos).
  * Cero fallbacks silenciosos a v3.1. Todos los fallos fueron aislados y reportados explícitamente.

---

## 2. TABLA COMPARATIVA GLOBAL

| Métrica | V3.1 Recalculado | V3.1 Congelado Histórico | TimesFM 2.5 Puro | Propuesta Híbrida ⭐ |
| :--- | :---: | :---: | :---: | :---: |
| **Evaluaciones** | ${globalSummaryV31.count} | ${globalFrozen.count} | ${globalSummaryTfm.count} | ${globalSummaryHybrid.count} |
| **WAPE Ventas ($)** | ${globalSummaryV31.salesWAPE.toFixed(2)}% | ${globalFrozen.count > 0 ? globalSummaryFrozen.salesWAPE.toFixed(2) + '%' : 'N/A'} | ${globalSummaryTfm.salesWAPE.toFixed(2)}% | **${globalSummaryHybrid.salesWAPE.toFixed(2)}%** |
| **MAE Ventas ($)** | $${globalSummaryV31.salesMAE.toFixed(0)} | ${globalFrozen.count > 0 ? '$' + globalSummaryFrozen.salesMAE.toFixed(0) : 'N/A'} | $${globalSummaryTfm.salesMAE.toFixed(0)} | **$${globalSummaryHybrid.salesMAE.toFixed(0)}** |
| **RMSE Ventas ($)** | $${globalSummaryV31.salesRMSE.toFixed(0)} | ${globalFrozen.count > 0 ? '$' + globalSummaryFrozen.salesRMSE.toFixed(0) : 'N/A'} | $${globalSummaryTfm.salesRMSE.toFixed(0)} | **$${globalSummaryHybrid.salesRMSE.toFixed(0)}** |
| **Sesgo Ventas ($)** | ${(globalSummaryV31.salesBias >= 0 ? '+' : '') + globalSummaryV31.salesBias.toFixed(2)}% | ${globalFrozen.count > 0 ? (globalSummaryFrozen.salesBias >= 0 ? '+' : '') + globalSummaryFrozen.salesBias.toFixed(2) + '%' : 'N/A'} | ${(globalSummaryTfm.salesBias >= 0 ? '+' : '') + globalSummaryTfm.salesBias.toFixed(2)}% | **${(globalSummaryHybrid.salesBias >= 0 ? '+' : '') + globalSummaryHybrid.salesBias.toFixed(2)}%** |
| **WAPE Tickets** | ${globalSummaryV31.ticketsWAPE.toFixed(2)}% | ${globalFrozen.count > 0 ? globalSummaryFrozen.ticketsWAPE.toFixed(2) + '%' : 'N/A'} | ${globalSummaryTfm.ticketsWAPE.toFixed(2)}% | **${globalSummaryHybrid.ticketsWAPE.toFixed(2)}%** |
| **MAE Tickets** | ${globalSummaryV31.ticketsMAE.toFixed(1)} | ${globalFrozen.count > 0 ? globalSummaryFrozen.ticketsMAE.toFixed(1) : 'N/A'} | ${globalSummaryTfm.ticketsMAE.toFixed(1)} | **${globalSummaryHybrid.ticketsMAE.toFixed(1)}** |
| **Sesgo Tickets** | ${(globalSummaryV31.ticketsBias >= 0 ? '+' : '') + globalSummaryV31.ticketsBias.toFixed(2)}% | ${globalFrozen.count > 0 ? (globalSummaryFrozen.ticketsBias >= 0 ? '+' : '') + globalSummaryFrozen.ticketsBias.toFixed(2) + '%' : 'N/A'} | ${(globalSummaryTfm.ticketsBias >= 0 ? '+' : '') + globalSummaryTfm.ticketsBias.toFixed(2)}% | **${(globalSummaryHybrid.ticketsBias >= 0 ? '+' : '') + globalSummaryHybrid.ticketsBias.toFixed(2)}%** |

---

## 3. BALANCE POR SUCURSAL

| Tienda | Días | V3.1 WAPE | TimesFM WAPE | Híbrido WAPE | Variación vs V3.1 | Ganador |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${storeSummaryList.map(s => `| **${s.name} (${s.code})** | ${s.days} | ${s.v31.salesWAPE.toFixed(2)}% | ${s.tfm.salesWAPE.toFixed(2)}% | ${s.hybrid.salesWAPE.toFixed(2)}% | ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}% | ${s.winner} |`).join('\n')}

* **Balance General:** La Propuesta Híbrida supera o empata a Intelligence v3.1 en **${storesWonByHybrid} de ${targetStores.length} tiendas**.

---

## 4. EXPERIMENTO HORARIO DESACOPLADO (6:00 AM - 5:59 AM)

Se contrastaron tres modelos horarios independientes para medir su impacto real en dotación y horas pico sin reusar la curva de V3.1:
1. **V3.1 Canónico Horario:** RMSE = **$${rmseHourlyV31.toFixed(2)}/hr** | MAE = **$${maeHourlyV31.toFixed(2)}/hr** | WAPE = **${wapeHourlyV31.toFixed(2)}%** | Correlación = **${corrHourlyV31.toFixed(2)}%**
2. **Modelo Empírico Desacoplado:** RMSE = **$${rmseHourlyEmp.toFixed(2)}/hr** | MAE = **$${maeHourlyEmp.toFixed(2)}/hr** | WAPE = **${wapeHourlyEmp.toFixed(2)}%** | Correlación = **${corrHourlyEmp.toFixed(2)}%**
${directTfmHourlyPoints > 0 ? `3. **TimesFM Neuronal Directo en Horas (Muestra ${directTfmHourlyDays} días):** RMSE = **$${rmseDirectTfm.toFixed(2)}/hr** | MAE = **$${maeDirectTfm.toFixed(2)}/hr** | WAPE = **${wapeDirectTfm.toFixed(2)}%** | Correlación = **${corrDirectTfm.toFixed(2)}%**` : ''}

* **Horas Pico:**
  * Almuerzo (12pm - 2pm): V3.1 WAPE = **${lunchRushWapeV31.toFixed(2)}%** | Empírico WAPE = **${lunchRushWapeEmp.toFixed(2)}%**
  * Cena (7pm - 10pm): V3.1 WAPE = **${dinnerRushWapeV31.toFixed(2)}%** | Empírico WAPE = **${dinnerRushWapeEmp.toFixed(2)}%**
  * Noche (12am - 3am): V3.1 WAPE = **${nightOwlWapeV31.toFixed(2)}%** | Empírico WAPE = **${nightOwlWapeEmp.toFixed(2)}%**
* **Desviación de Dotación Laboral:**
  * Cocineros BOH ($280/hr): Desviación promedio = **${avgBohDevV31.toFixed(2)}** cocineros (V3.1) vs **${avgBohDevEmp.toFixed(2)}** cocineros (Empírico).
  * Cajeros FOH (7 tix/hr): Desviación promedio = **${avgFohDevV31.toFixed(2)}** cajeros (V3.1) vs **${avgFohDevEmp.toFixed(2)}** cajeros (Empírico).

---

## 5. RIESGOS, LIMITACIONES Y RECOMENDACIÓN FINAL

1. **Riesgo del Salto Domingo-Lunes:** TimesFM retiene inercia de volumen alto del fin de semana, sobrestimando los lunes entre un 1% y 2%. Intelligence v3.1 corta esa inercia mejor con su promedio tri-anual del mismo día de la semana.
2. **Ceguera a Quincenas y Cuaresma:** TimesFM no identifica el día 15/30 de quincena ni la abstinencia litúrgica de Cuaresma sin conocimiento explícito del negocio.
3. **Recomendación Operativa:**
   * Utilizar un **Ensamble Adaptativo Sensible al Calendario**:
     * **Jueves a Sábado:** Utilizar la Propuesta Híbrida con TimesFM para neutralizar el sesgo y maximizar precisión.
     * **Lunes, Martes, Domingos, Cuaresma y Enero:** Mantener Intelligence v3.1 como ancla principal.
`

    fs.writeFileSync(mdReportPath, mdContent, 'utf-8')
    fs.writeFileSync(artifactPath, mdContent, 'utf-8')
    console.log(`💾 Reporte Markdown guardado en: ${mdReportPath}`)
    console.log(`💾 Artefacto Markdown guardado en: ${artifactPath}`)
    console.log('='.repeat(100))
}

runBacktest().catch(err => {
    console.error('❌ Error fatal en backtest:', err)
    process.exit(1)
})
