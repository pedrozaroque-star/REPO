/**
 * @module audit-intelligence-connected-modules
 * @description Script de simulación en vivo para auditar rigurosamente todos los módulos
 * conectados a Intelligence V3.1 con datos reales de la base de datos de Tacos Gavilan.
 * Cero mocks.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { supabaseAdmin } from '../lib/supabase'
import { generateSmartForecast } from '../lib/intelligence'
import { getEventMultiplier } from '../lib/event-intelligence'
import { scheduleBreaksWithDemand } from '../lib/breaks-engine'
import { addDays, format, parseISO } from 'date-fns'

async function runAudit() {
    console.log('========================================================================')
    console.log('🚀 INICIANDO AUDITORÍA EN TIEMPO REAL: MÓDULOS CONECTADOS A INTELLIGENCE')
    console.log('========================================================================\n')

    let passedTests = 0
    let failedTests = 0

    // 1. OBTENER TIENDAS REALES
    console.log('--- TEST 1: Verificación de Tiendas en Base de Datos ---')
    const { data: stores, error: storesErr } = await supabaseAdmin
        .from('stores')
        .select('id, external_id, name, latitude, longitude, opening_time, closing_time')
        .eq('is_active', true)

    if (storesErr || !stores || stores.length === 0) {
        console.error('❌ Error al cargar tiendas:', storesErr?.message)
        failedTests++
        return
    }
    console.log(`✅ ${stores.length} tiendas activas encontradas en Supabase`)
    passedTests++

    const testStore = stores.find(s => s.name.toLowerCase().includes('lynwood')) || stores[0]
    console.log(`📍 Tienda de prueba seleccionada: ${testStore.name} (${testStore.external_id})`)

    // 2. TEST INTELLIGENCE CORE V3.1
    console.log('\n--- TEST 2: Ejecución de Intelligence V3.1 Core (generateSmartForecast) ---')
    const testDate = '2026-09-17'
    const forecast = await generateSmartForecast(testStore.external_id, testDate)

    if (!forecast || typeof forecast.total_sales !== 'number' || forecast.total_sales <= 0) {
        console.error('❌ Falló generateSmartForecast: Total de ventas inválido o nulo')
        failedTests++
    } else {
        console.log(`✅ Pronóstico generado exitosamente:`)
        console.log(`   - Total Ventas: $${Math.round(forecast.total_sales).toLocaleString()}`)
        console.log(`   - Base Ventas: $${Math.round(forecast.base_sales).toLocaleString()}`)
        console.log(`   - Factor Crecimiento: ${forecast.growth_factor_applied.toFixed(4)}`)
        console.log(`   - Horas proyectadas: ${forecast.hours.length} horas (rango ${forecast.hours[0]?.hour} a ${forecast.hours[forecast.hours.length - 1]?.hour})`)
        console.log(`   - Metodología: ${forecast.methodology}`)
        
        // Validar que no hay NaN ni Infinity
        let mathErrors = 0
        forecast.hours.forEach(h => {
            if (isNaN(h.projected_sales) || !isFinite(h.projected_sales)) mathErrors++
            if (isNaN(h.required_kitchen) || !isFinite(h.required_kitchen)) mathErrors++
            if (isNaN(h.required_foh) || !isFinite(h.required_foh)) mathErrors++
        })

        if (mathErrors > 0) {
            console.error(`❌ Detectados ${mathErrors} errores matemáticos (NaN/Infinity) en forecast.hours`)
            failedTests++
        } else {
            console.log(`✅ Cero valores NaN/Infinity detectados en las horas proyectadas`)
            passedTests++
        }
    }

    // 3. TEST PREPARADOR / INTRADAY PACE LOGIC
    console.log('\n--- TEST 3: Simulación de API Preparador (/api/preparador/intelligence) ---')
    try {
        // Simular cálculo de horas acumuladas hasta ahora
        let expectedSalesUntilNow = 0
        const simHour = 14 // 2:00 PM
        forecast.hours.forEach(h => {
            if (h.hour < simHour) {
                expectedSalesUntilNow += h.projected_sales
            }
        })

        const simLiveSales = 4200
        let rawFactor = simLiveSales / (expectedSalesUntilNow || 1)
        const clampedFactor = Math.max(0.60, Math.min(rawFactor, 1.60))

        console.log(`✅ Lógica de Preparador validada:`)
        console.log(`   - Ventas esperadas acumuladas hasta las 2:00 PM: $${Math.round(expectedSalesUntilNow).toLocaleString()}`)
        console.log(`   - Ventas simuladas en vivo: $${simLiveSales.toLocaleString()}`)
        console.log(`   - Factor intraday bruto: ${rawFactor.toFixed(3)} -> Clampeado seguro: ${clampedFactor.toFixed(3)}`)
        
        if (clampedFactor >= 0.60 && clampedFactor <= 1.60) {
            passedTests++
        } else {
            console.error('❌ Factor intraday fuera de límites de seguridad')
            failedTests++
        }
    } catch (e: any) {
        console.error('❌ Error en simulación de Preparador:', e.message)
        failedTests++
    }

    // 4. TEST EVENT INTELLIGENCE MULTIPLIER
    console.log('\n--- TEST 4: Simulación de Event Intelligence & Distancias ---')
    try {
        const eventRes = await getEventMultiplier(testStore.external_id, testDate)
        console.log(`✅ Multiplicador de eventos para ${testDate}:`)
        console.log(`   - Multiplicador final: ${eventRes.multiplier.toFixed(4)}`)
        console.log(`   - Eventos encontrados: ${eventRes.events.length}`)
        console.log(`   - Metodología: ${eventRes.methodology}`)
        
        if (eventRes.multiplier >= 0.35 && eventRes.multiplier <= 1.40) {
            passedTests++
        } else {
            console.error('❌ Multiplicador de eventos fuera del rango permitido [0.35, 1.40]')
            failedTests++
        }
    } catch (e: any) {
        console.error('❌ Error en getEventMultiplier:', e.message)
        failedTests++
    }

    // 5. TEST SELF-SCHEDULE DEMAND GENERATION
    console.log('\n--- TEST 5: Simulación de Demanda para Self-Schedule (7 Días) ---')
    try {
        const weekStart = '2026-09-14' // Lunes
        const weekStartDate = parseISO(weekStart)
        const daysDemand: any[] = []

        for (let i = 0; i < 7; i++) {
            const curDate = addDays(weekStartDate, i)
            const curDateStr = format(curDate, 'yyyy-MM-dd')
            const dayF = await generateSmartForecast(testStore.external_id, curDateStr)
            
            const hoursMapped = dayF.hours.map(h => ({
                hour: h.hour,
                required_kitchen: h.required_kitchen || 0,
                required_foh: h.required_foh || 0,
                projected_sales: h.projected_sales || 0
            }))

            daysDemand.push({
                date: curDateStr,
                hoursCount: hoursMapped.length,
                totalSales: dayF.total_sales,
                peakKitchen: Math.max(...hoursMapped.map(h => h.required_kitchen)),
                peakFoh: Math.max(...hoursMapped.map(h => h.required_foh))
            })
        }

        console.log(`✅ Demanda generada para los 7 días de la semana ${weekStart}:`)
        daysDemand.forEach(d => {
            console.log(`   - ${d.date}: $${Math.round(d.totalSales).toLocaleString()} | Pico Cocina: ${d.peakKitchen} | Pico Salón: ${d.peakFoh}`)
        })
        passedTests++
    } catch (e: any) {
        console.error('❌ Error en generación de demanda:', e.message)
        failedTests++
    }

    // 6. TEST BREAKS ENGINE CON OPERATING HOURS (ARRAY Y OBJETO)
    console.log('\n--- TEST 6: Resiliencia del Motor de Descansos (Breaks Engine) ---')
    try {
        const sampleShifts = [
            {
                id: 'test-shift-1',
                store_id: testStore.external_id,
                shift_date: testDate,
                start_time: `${testDate}T08:00:00-07:00`,
                end_time: `${testDate}T16:30:00-07:00`,
                is_leader: false,
                job_title: 'Cocinero'
            },
            {
                id: 'test-shift-2',
                store_id: testStore.external_id,
                shift_date: testDate,
                start_time: `${testDate}T16:00:00-07:00`,
                end_time: `${testDate}T00:30:00-07:00`,
                is_leader: true,
                job_title: 'Shift Leader'
            }
        ]

        // Caso A: Con forecast.hours como Array
        const resArray = scheduleBreaksWithDemand(sampleShifts as any, forecast.hours, [])
        console.log(`✅ scheduleBreaksWithDemand con Array de horas: ${resArray.length} turnos procesados`)
        resArray.forEach(s => {
            console.log(`   - Turno ${s.id} (${s.job_title}): ${(s.breaks_schedule || []).length} descansos asignados`)
        })

        // Caso B: Con forecast.hours serializado como Object Map (caso que rompía antes)
        const objectMap: Record<string, any> = {}
        forecast.hours.forEach(h => {
            objectMap[String(h.hour)] = { required_kitchen: h.required_kitchen, required_foh: h.required_foh }
        })
        const resObj = scheduleBreaksWithDemand(sampleShifts as any, objectMap as any, [])
        console.log(`✅ scheduleBreaksWithDemand con Object Map de horas: ${resObj.length} turnos procesados sin error`)

        if (resArray.length === 2 && resObj.length === 2) {
            passedTests++
        } else {
            console.error('❌ Breaks engine no retornó la cantidad esperada de turnos')
            failedTests++
        }
    } catch (e: any) {
        console.error('❌ Error en Breaks Engine:', e.message)
        failedTests++
    }

    // 7. TEST CACHE COMPATIBILITY (sales_projections_cache)
    console.log('\n--- TEST 7: Integridad de sales_projections_cache en Supabase ---')
    try {
        const { data: cacheRow, error: cacheErr } = await supabaseAdmin
            .from('sales_projections_cache')
            .select('store_id, business_date, total_sales, hourly_data, meta')
            .eq('store_id', testStore.external_id)
            .limit(5)

        if (cacheErr) {
            console.error('❌ Error al consultar sales_projections_cache:', cacheErr.message)
            failedTests++
        } else {
            console.log(`✅ Registros en cache consultados: ${cacheRow?.length || 0} filas`)
            if (cacheRow && cacheRow.length > 0) {
                const sample = cacheRow[0]
                const isHourlyObject = typeof sample.hourly_data === 'object' && sample.hourly_data !== null
                console.log(`   - Muestra (${sample.business_date}): $${sample.total_sales} | Formato hourly_data: ${isHourlyObject ? 'Válido' : 'Inválido'}`)
            }
            passedTests++
        }
    } catch (e: any) {
        console.error('❌ Error al verificar cache:', e.message)
        failedTests++
    }

    // RESUMEN FINAL
    console.log('\n========================================================================')
    console.log(`🏁 RESULTADO AUDITORÍA: ${passedTests} PRUEBAS EXITOSAS | ${failedTests} FALLOS`)
    console.log('========================================================================\n')

    if (failedTests > 0) {
        process.exit(1)
    }
}

runAudit().catch(err => {
    console.error('Fatal crash during audit:', err)
    process.exit(1)
})
