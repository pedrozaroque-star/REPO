import { NextResponse } from 'next/server'
import { generateSmartForecast } from '@/lib/intelligence'
import { fetchToastData } from '@/lib/toast-api'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get('store_id')

    if (!storeId) {
        return NextResponse.json({ error: 'Missing store_id' }, { status: 400 })
    }

    try {
        // Necesitamos el external_id para Toast/sales_daily_cache
        const { data: storeInfo, error: storeErr } = await supabase
            .from('stores')
            .select('external_id')
            .eq('id', storeId)
            .single()

        if (storeErr || !storeInfo?.external_id) {
            return NextResponse.json({ error: 'Store external_id no encontrado' }, { status: 400 })
        }

        const externalId = storeInfo.external_id;

        // Obtenemos la fecha actual en hora del Pacífico (LA)
        const d = new Date()
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        })
        const todayStr = formatter.format(d) // YYYY-MM-DD local a CA

        // Invocamos a intelligence.ts (El pronóstico inteligente base de 4 semanas)
        const forecast = await generateSmartForecast(externalId, todayStr)

        let intradayAccelerator = 1.0;
        try {
            // "Ritmo Intraday": Llamada EN VIVO a Toast para ver ventas de HOY
            const liveData = await fetchToastData({
                storeIds: externalId,
                startDate: todayStr,
                endDate: todayStr,
                groupBy: 'day',
                skipCache: true
            });
            
            if (liveData.rows && liveData.rows.length > 0) {
                const liveSales = liveData.rows[0].netSales || 0;
                
                const laTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
                const laDate = new Date(laTimeStr)
                const currentLAHour = laDate.getHours()
                
                let expectedSalesUntilNow = 0;
                forecast.hours.forEach(h => {
                     if (h.hour < currentLAHour) {
                         expectedSalesUntilNow += h.projected_sales
                     } else if (h.hour === currentLAHour) {
                         const currentMinutes = laDate.getMinutes()
                         const fraction = currentMinutes / 60.0
                         expectedSalesUntilNow += (h.projected_sales * fraction)
                     }
                })
                
                // Aplicar el Ritmo Intraday solo si ya pasaron las horas tímidas de la mañana
                if (expectedSalesUntilNow > 500 && liveSales > 0) {
                    let rawFactor = liveSales / expectedSalesUntilNow;
                    // Limites de seguridad: no dejar que el acelerador exija el doble de carne ni corte a la mitad de golpe
                    rawFactor = Math.max(0.60, Math.min(rawFactor, 1.60));
                    intradayAccelerator = rawFactor;
                }
            }
        } catch (e) {
            console.error("No se pudo obtener Toast en vivo para Ritmo Intraday:", e)
            // Si falla Toast por algun rate limit, silenciosamente cae en el promedio de tendencia 4 semanas intacto
        }

        const finalGrowthFactor = (forecast.growth_factor_applied || 1.0) * intradayAccelerator;

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
