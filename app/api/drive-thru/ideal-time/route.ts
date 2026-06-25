/**
 * @module api/drive-thru/ideal-time
 * @description Endpoint GET para obtener el tiempo ideal calculado dinámicamente
 *   basado en los datos históricos de Drive-Thru de los últimos 30 días.
 *   Retorna percentiles (P25=excelente, P50=bueno, P75=caution, P90=crítico)
 *   y desglose por daypart (breakfast, lunch, afternoon, dinner, late).
 *
 * @businessRules
 * - **Umbral default global**: 210 segundos (3:30) = meta verde.
 * - **Cálculo dinámico**: Se analizan los últimos 30 días de datos para determinar
 *   los percentiles reales de velocidad por tienda o globalmente.
 * - P25 = Excelente, P50 = Bueno, P75 = Precaución, P90 = Crítico
 *
 * @dataFlow
 * - GET /api/drive-thru/ideal-time?storeId=UUID
 *   → getIdealTime(storeId) de @/lib/drive-thru-api
 *   → Consulta dt_halfhour_stats últimos 30 días
 *   → Calcula percentiles y desglose por daypart
 *   → Retorna { storeId, percentiles, byDaypart }
 *
 * @notes
 * - storeId es opcional — si no se provee, calcula para todas las tiendas DT.
 * - No requiere autenticación CRON_SECRET (es endpoint público interno).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getIdealTime } from '@/lib/drive-thru-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        // ─── Parámetros ───
        const storeId = searchParams.get('storeId') || undefined

        // ─── Obtener ideal time ───
        const result = await getIdealTime(storeId)

        return NextResponse.json({
            storeId: storeId || 'all',
            ...result
        })

    } catch (error: any) {
        console.error('[DT Ideal Time] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
