/**
 * @module api/drive-thru/leaderboard
 * @description Endpoint GET que retorna el leaderboard (ranking) de Drive-Thru para todas las tiendas.
 *   Muestra el promedio de tiempo DT por tienda, ordenado del más rápido al más lento.
 *
 * @businessRules
 * - **Umbrales de velocidad**: 🟢 ≤210s (3.5 min), 🟡 211-300s (5 min), 🔴 >300s
 * - **Business Date**: Día laboral 6 AM → 5:59 AM siguiente (zona America/Los_Angeles).
 * - **Slot (opcional)**: Si se provee un slot (ej: "14:30"), el leaderboard se filtra solo a esa media hora.
 *   Si no se provee, se usa el acumulado del día completo.
 * - **Global Avg**: Promedio ponderado de duración entre TODAS las tiendas (total_duration / total_cars).
 * - **Total Cars**: Suma de order_count de todas las tiendas para la fecha/slot indicado.
 *
 * @dataFlow
 * - GET /api/drive-thru/leaderboard?date=YYYY-MM-DD&slot=HH:MM
 *   → getLeaderboard(date, slot) de @/lib/drive-thru-api
 *   → Consulta dt_halfhour_stats agrupando por store
 *   → Retorna entries[] ordenados por avg_duration ASC
 *
 * @notes
 * - No requiere autenticación CRON_SECRET (es endpoint público interno).
 * - Si date no se provee, se usa la fecha de hoy según regla de las 6 AM.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard } from '@/lib/drive-thru-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        // ─── Parámetros ───
        // date: YYYY-MM-DD, default = hoy según regla 6 AM
        let date = searchParams.get('date')
        if (!date) {
            const now = new Date()
            const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
            const currentHour = laNow.getHours()
            if (currentHour < 6) {
                laNow.setDate(laNow.getDate() - 1)
            }
            const y = laNow.getFullYear()
            const m = String(laNow.getMonth() + 1).padStart(2, '0')
            const d = String(laNow.getDate()).padStart(2, '0')
            date = `${y}-${m}-${d}`
        }

        // slot: HH:MM (opcional), ej: "14:30"
        const slot = searchParams.get('slot') || undefined

        // ─── Obtener leaderboard ───
        const entries = await getLeaderboard(date, slot)

        // ─── Calcular globalAvg y totalCars ───
        let totalDuration = 0
        let totalCars = 0

        for (const entry of entries) {
            totalCars += entry.order_count
            totalDuration += entry.avg_duration_sec * entry.order_count
        }

        const globalAvg = totalCars > 0 ? Math.round(totalDuration / totalCars) : 0

        return NextResponse.json({
            entries,
            globalAvg,
            totalCars,
            date,
            slot: slot || null
        })

    } catch (error: any) {
        console.error('[DT Leaderboard] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
