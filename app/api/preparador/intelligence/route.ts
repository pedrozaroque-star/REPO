/**
 * @module preparador-intelligence
 * @description API endpoint que calcula el factor de aceleración inteligente intraday (Ritmo Intraday)
 *   y los multiplicadores por días festivos y clima para el módulo de Preparador.
 * @businessRules
 *   - Día laboral Gavilán: 6:00 AM a 5:59 AM del siguiente día (America/Los_Angeles).
 *   - Acelerador Intraday: Compara ventas reales de Toast de hoy vs curva proyectada de 4 semanas.
 *   - Límites de seguridad: El factor de aceleración se acota entre 0.60 (-40%) y 1.60 (+60%).
 *   - Umbral de activación: Requiere al menos $500 en ventas esperadas para evitar ruido matutino.
 * @dataFlow sales_daily_cache (fresco <= 20 min) / Toast API fallback -> forecast hours comparison -> final growth factor JSON response.
 * @notes
 *   - Horas de madrugada (0:00 a 5:59 AM) se mapean como horas 24 a 29 en la curva proyectada de 30h.
 *   - Optimización 2026-11-19 (Paquete 2B):
 *     1) `Cache-Control: private, max-age=300, stale-while-revalidate=300` en respuestas exitosas autenticadas.
 *     2) Caché en RAM de 15 minutos para `stores.external_id`.
 *     3) Salvaguarda Caveat D para Ritmo Intraday: valida `sales_daily_cache.updated_at` antes de llamar a Toast;
 *        si la fila de hoy existe, tiene `net_sales > 0` y su `updated_at` tiene `<= 20 min`, lee directamente
 *        del caché en DB (sin llamada a Toast ni doble auth/query vía `fetchToastData`, que omitiría hoy por dirty window);
 *        si falta o tiene `> 20 min`, cae automáticamente a `fetchToastData(..., { skipCache: true })`.
 *   - Protegido con `verifyStaffAuth`.
 */
import { NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const STORE_EXT_ID_CACHE_TTL_MS = 15 * 60 * 1000
const SALES_CACHE_MAX_AGE_MS = 20 * 60 * 1000

const storeExternalIdCache = new Map<string, { externalId: string; cachedAt: number }>()

async function getStoreExternalIdCached(
    supabase: Awaited<ReturnType<typeof getSupabaseAdminClient>>,
    storeId: string
): Promise<string | null> {
    const key = String(storeId).trim()
    const now = Date.now()
    const hit = storeExternalIdCache.get(key)
    if (hit && now - hit.cachedAt < STORE_EXT_ID_CACHE_TTL_MS) {
        return hit.externalId
    }

    const { data: storeInfo, error: storeErr } = await supabase
        .from('stores')
        .select('external_id')
        .eq('id', storeId)
        .single()

    if (storeErr || !storeInfo?.external_id) {
        return null
    }

    const externalId = String(storeInfo.external_id)
    storeExternalIdCache.set(key, { externalId, cachedAt: now })
    return externalId
}

export async function GET(request: Request) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('store_id')

    if (!storeId) {
        return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
    }

    try {
        const supabase = await getSupabaseAdminClient()

        // Necesitamos el external_id para Toast/sales_daily_cache (cacheado 15 min en RAM)
        const externalId = await getStoreExternalIdCached(supabase, storeId)

        if (!externalId) {
            return NextResponse.json({ error: 'Store external_id no encontrado' }, { status: 400 })
        }

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

        // Invocamos a intelligence.ts con usePureAiBaseline: true para aislar la parrilla de ajustes manuales de presupuesto en Planificador
        const forecast = await generateSmartForecast(externalId, todayStr, false, { usePureAiBaseline: true })

        let intradayAccelerator = 1.0
        try {
            if (isToday) {
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
                if (expectedSalesUntilNow > 500) {
                    // Caveat D: verificar frescura de sales_daily_cache (<= 20 min) antes de pegar en vivo a Toast.
                    // Evita llamar a Toast cuando sync-sales-today ya mantiene el caché al día; si falta o está
                    // obsoleto (> 20 min), cae al fallback en vivo `fetchToastData(..., { skipCache: true })`.
                    let liveSales = 0
                    let usedFreshCache = false

                    const { data: cacheRow } = await supabase
                        .from('sales_daily_cache')
                        .select('net_sales, updated_at')
                        .eq('store_id', externalId)
                        .eq('business_date', todayStr)
                        .maybeSingle()

                    const updatedAtMs = cacheRow?.updated_at ? Date.parse(String(cacheRow.updated_at)) : NaN
                    const cacheAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY
                    if (cacheRow && cacheAgeMs >= 0 && cacheAgeMs <= SALES_CACHE_MAX_AGE_MS && Number(cacheRow.net_sales) > 0) {
                        liveSales = Number(cacheRow.net_sales)
                        usedFreshCache = true
                    }

                    if (!usedFreshCache) {
                        const liveData = await fetchToastData({
                            storeIds: externalId,
                            startDate: todayStr,
                            endDate: todayStr,
                            groupBy: 'day',
                            skipCache: true
                        })
                        if (liveData.rows && liveData.rows.length > 0) {
                            liveSales = liveData.rows[0].netSales || 0
                        }
                    }

                    if (liveSales > 0) {
                        let rawFactor = liveSales / expectedSalesUntilNow
                        // Límites de seguridad: no dejar que el acelerador exija el doble de carne ni corte a la mitad de golpe
                        rawFactor = Math.max(0.60, Math.min(rawFactor, 1.60))
                        intradayAccelerator = rawFactor
                    }
                }
            }
        } catch (e) {
            console.error('No se pudo obtener Toast en vivo para Ritmo Intraday:', e)
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
        return NextResponse.json(
            {
                store_id: storeId,
                target_date: todayStr,
                growth_factor: finalGrowthFactor,
                weather_adjustment: forecast.weather_adjustment || false,
                intraday_factor: intradayAccelerator // Debug info
            },
            {
                headers: {
                    'Cache-Control': 'private, max-age=300, stale-while-revalidate=300'
                }
            }
        )

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('Error in /api/preparador/intelligence:', error)
        return NextResponse.json({
            error: 'Failed to generate intelligence',
            details: message
        }, { status: 500 })
    }
}
