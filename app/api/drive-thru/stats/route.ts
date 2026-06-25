/**
 * @module api/drive-thru/stats
 * @description Endpoint GET que retorna las estadísticas de Drive-Thru por media hora (half-hour slots)
 *   para una tienda específica en una fecha dada.
 *
 * @businessRules
 * - **Media hora (Half-hour slots)**: Cada slot es un intervalo de 30 minutos: "06:00", "06:30", "07:00", etc.
 * - **Umbrales de velocidad**: 🟢 ≤210s, 🟡 211-300s, 🔴 >300s
 * - **dayTotal**: Suma de order_count de todos los slots del día.
 * - **dayAvg**: Promedio ponderado de duración del día = Σ(avg_duration × order_count) / Σ(order_count).
 * - **Orden**: Los slots se retornan ordenados por slot_index ASC (cronológico).
 *
 * @dataFlow
 * - GET /api/drive-thru/stats?storeId=UUID&date=YYYY-MM-DD
 *   → Consulta Supabase `dt_halfhour_stats` WHERE store_id = storeId AND business_date = date
 *   → Ordena por slot_index ASC
 *   → Calcula dayTotal y dayAvg
 *   → Retorna { slots[], dayTotal, dayAvg, date, storeId }
 *
 * @notes
 * - storeId es obligatorio. Si no se provee, retorna 400.
 * - date es opcional; default = hoy según regla de las 6 AM.
 * - No requiere autenticación CRON_SECRET (es endpoint público interno).
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        // ─── Parámetros ───
        const storeId = searchParams.get('storeId')
        if (!storeId) {
            return NextResponse.json(
                { error: 'Missing required parameter: storeId' },
                { status: 400 }
            )
        }

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

        // ─── Consultar Supabase ───
        const { createClient } = require('@supabase/supabase-js')
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const { data: slots, error } = await supabase
            .from('dt_halfhour_stats')
            .select('*')
            .eq('store_id', storeId)
            .eq('business_date', date)
            .order('slot_index', { ascending: true })

        if (error) {
            console.error('[DT Stats] Supabase error:', error.message)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // ─── Calcular dayTotal y dayAvg (promedio ponderado) ───
        let dayTotal = 0
        let weightedSum = 0

        for (const slot of (slots || [])) {
            const count = Number(slot.order_count) || 0
            const avg = Number(slot.avg_duration_sec) || 0
            dayTotal += count
            weightedSum += avg * count
        }

        const dayAvg = dayTotal > 0 ? Math.round(weightedSum / dayTotal) : 0

        // Mapear campos de base de datos a los nombres esperados por el frontend
        const mappedSlots = (slots || []).map((slot: any) => ({
            slot_label: slot.slot,
            slot_index: slot.slot_index,
            order_count: slot.order_count,
            avg_duration: slot.avg_duration_sec,
            min_duration: slot.min_duration_sec,
            max_duration: slot.max_duration_sec,
            store_id: slot.store_id,
            store_name: slot.store_name,
            business_date: slot.business_date
        }))

        return NextResponse.json({
            slots: mappedSlots,
            dayTotal,
            dayAvg,
            date,
            storeId
        })

    } catch (error: any) {
        console.error('[DT Stats] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
