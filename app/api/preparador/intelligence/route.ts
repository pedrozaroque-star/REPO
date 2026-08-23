/**
 * @module preparador-intelligence
 * @description API endpoint que calcula el factor de aceleración inteligente intraday (Ritmo Intraday)
 *   y los multiplicadores por días festivos y clima para el módulo de Preparador.
 * @businessRules
 *   - Día laboral Gavilán: 6:00 AM a 5:59 AM del siguiente día (America/Los_Angeles).
 *   - Acelerador Intraday: Compara ventas reales de Toast de hoy vs curva proyectada de 4 semanas.
 *   - Límites de seguridad: El factor de aceleración se acota entre 0.60 (-40%) y 1.60 (+60%).
 *   - Umbral de activación: Requiere al menos $500 en ventas esperadas para evitar ruido matutino.
 * @dataFlow Toast API /sales -> forecast hours comparison -> final growth factor JSON response.
 * @notes Horas de madrugada (0:00 a 5:59 AM) se mapean como horas 24 a 29 en la curva proyectada de 30h.
 */
import { NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('store_id')

    if (!storeId) {
        return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
    }

    try {
        const supabase = await getSupabaseAdminClient()

        // Necesitamos el external_id para Toast/sales_daily_cache
        const { data: storeInfo, error: storeErr } = await supabase
            .from('stores')
            .select('external_id')
            .eq('id', storeId)
            .single()

        if (storeErr || !storeInfo?.external_id) {
            return NextResponse.json({ error: 'Store external_id no encontrado' }, { status: 400 })
        }

        const externalId = storeInfo.external_id

        // Obtenemos la hora y fecha actual en hora del Pacífico (LA) respetando la regla de las 6:00 AM
        const now = new Date()
        const formatterTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        })
        const timeParts = formatterTime.format(now).split(':')
        let currentLAHour = parseInt(timeParts[0], 10)
        const currentLAMinutes = parseInt(timeParts[1], 10)
        if (currentLAHour === 24) currentLAHour = 0

        // Si la hora es antes de las 6:00 AM, el día laboral corresponde a la fecha de ayer
        const dateToFormat = new Date(now)
        if (currentLAHour < 6) {
            dateToFormat.setUTCDate(dateToFormat.getUTCDate() - 1)
        }
        const formatterDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        })
        const realTodayStr = formatterDate.format(dateToFormat)
        
        const dateParam = searchParams.get('date')
        const todayStr = dateParam || realTodayStr
        const isToday = todayStr === realTodayStr

        // Invocamos a intelligence.ts (El pronóstico inteligente base de 4 semanas)
        const forecast = await generateSmartForecast(externalId, todayStr)

        let intradayAccelerator = 1.0
        try {
            if (isToday) {
                // "Ritmo Intraday": Llamada EN VIVO a Toast para ver ventas de HOY
                const liveData = await fetchToastData({
                    storeIds: externalId,
                    startDate: todayStr,
                    endDate: todayStr,
                    groupBy: 'day',
                    skipCache: true
                })
            
                if (liveData.rows && liveData.rows.length > 0) {
                    const liveSales = liveData.rows[0].netSales || 0
                    
                    // En la curva de 30 horas de generateSmartForecast, las horas 0:00 a 5:59 AM corresponden a 24 a 29
                    let adjustedHour = currentLAHour
                    if (adjustedHour < 6) adjustedHour += 24
                    
                    let expectedSalesUntilNow = 0
                    forecast.hours.forEach(h => {
                         if (h.hour < adjustedHour) {
                             expectedSalesUntilNow += h.projected_sales
                         } else if (h.hour === adjustedHour) {
                             const fraction = currentLAMinutes / 60.0
                             expectedSalesUntilNow += (h.projected_sales * fraction)
                         }
                    })
                    
                    // Aplicar el Ritmo Intraday solo si ya pasaron las horas tímidas de la mañana ($500 threshold)
                    if (expectedSalesUntilNow > 500 && liveSales > 0) {
                        let rawFactor = liveSales / expectedSalesUntilNow
                        // Limites de seguridad: no dejar que el acelerador exija el doble de carne ni corte a la mitad de golpe
                        rawFactor = Math.max(0.60, Math.min(rawFactor, 1.60))
                        intradayAccelerator = rawFactor
                    }
                }
            }
        } catch (e) {
            console.error("No se pudo obtener Toast en vivo para Ritmo Intraday:", e)
            // Si falla Toast por rate limit, silenciosamente cae en el promedio de tendencia 4 semanas intacto
        }

        // Apply preparation-only holiday multipliers
        const { getHolidayImpact } = await import('@/lib/holidays')
        const holidayImpact = getHolidayImpact(todayStr)
        let holidayMultiplier = 1.0
        if (holidayImpact === 'HIGH') {
            holidayMultiplier = 1.20 // +20% boost
        } else if (holidayImpact === 'LOW') {
            holidayMultiplier = 0.85 // -15% drop
        }

        const finalGrowthFactor = (forecast.growth_factor_applied || 1.0) * intradayAccelerator * holidayMultiplier

        // Devolvemos sólo los parámetros vitales para el Front-End del preparador
        return NextResponse.json({
            store_id: storeId,
            target_date: todayStr,
            growth_factor: finalGrowthFactor,
            weather_adjustment: forecast.weather_adjustment || false,
            intraday_factor: intradayAccelerator // Debug info
        })

    } catch (error: any) {
        console.error("Error in /api/preparador/intelligence:", error)
        return NextResponse.json({ 
            error: 'Failed to generate intelligence',
            details: error.message 
        }, { status: 500 })
    }
}
