/**
 * @module api/drive-thru/reports
 * @description Endpoint GET para generar reportes analíticos de Drive-Thru agrupados por período
 *   (día, semana ISO, o mes). Permite a los gerentes evaluar tendencias históricas de velocidad DT.
 *
 * @businessRules
 * - **Agrupación (groupBy)**:
 *   - `day`: Agrupa por business_date (ej: "2026-06-25")
 *   - `week`: Agrupa por semana ISO (ej: "2026-W26")
 *   - `month`: Agrupa por año-mes (ej: "2026-06")
 * - **Métricas por grupo por tienda**:
 *   - total_orders: Suma de order_count
 *   - avg_duration: Promedio ponderado de duración (seconds)
 *   - min_duration: Mínimo avg_duration de los slots del período
 *   - max_duration: Máximo avg_duration de los slots del período
 *   - cars_per_hour_avg: (total_orders / horas_operativas) promedio de coches por hora
 *   - pct_within_goal: Porcentaje de órdenes con avg ≤ 210s (umbral verde)
 * - **Umbral verde (goal)**: ≤ 210 segundos (3.5 minutos).
 * - **Summary global**: Incluye overall_avg, total_cars, y pct_within_goal para TODO el rango.
 *
 * @dataFlow
 * - GET /api/drive-thru/reports?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&storeId=UUID&groupBy=day
 *   → Consulta Supabase `dt_halfhour_stats` en rango [startDate, endDate]
 *   → Agrupa por período según groupBy
 *   → Calcula métricas por tienda por período
 *   → Retorna { periods[], summary }
 *
 * @notes
 * - startDate y endDate son obligatorios.
 * - storeId es opcional (default 'all' = todas las tiendas).
 * - groupBy es opcional (default 'day').
 * - No requiere autenticación CRON_SECRET (es endpoint público interno).
 * - El pct_within_goal se calcula usando los slots donde avg_duration ≤ 210 como proporción de order_count.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Umbral verde (goal) en segundos */
const GOAL_THRESHOLD_SECONDS = 210

/**
 * Calcula la clave de período según el tipo de agrupación.
 * @param businessDate - Fecha en formato YYYY-MM-DD
 * @param groupBy - Tipo de agrupación: 'day' | 'week' | 'month'
 * @returns Clave del período (ej: "2026-06-25", "2026-W26", "2026-06")
 */
function getPeriodKey(businessDate: string, groupBy: string): string {
    if (groupBy === 'month') {
        // YYYY-MM
        return businessDate.substring(0, 7)
    }
    if (groupBy === 'week') {
        // ISO Week: YYYY-Www
        const d = new Date(businessDate + 'T12:00:00Z')
        const dayOfWeek = d.getUTCDay() || 7 // Lunes=1, Domingo=7
        d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek) // Jueves de la semana ISO
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
        const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
        return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
    }
    // day: retorna la fecha tal cual
    return businessDate
}

/** Estructura interna para acumular métricas por tienda dentro de un período */
interface StoreAccumulator {
    store_id: string
    store_name: string
    total_orders: number
    weighted_duration: number    // Σ(avg_duration × order_count)
    min_duration: number
    max_duration: number
    orders_within_goal: number   // Órdenes en slots con avg ≤ 210s
    total_slot_orders: number    // Total de órdenes para calcular cars_per_hour
    unique_slots: Set<string>    // Slots únicos para calcular horas operativas
}

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        // ─── Parámetros obligatorios ───
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: 'Missing required parameters: startDate and endDate' },
                { status: 400 }
            )
        }

        // Parámetros opcionales
        const storeId = searchParams.get('storeId') || 'all'
        const groupBy = searchParams.get('groupBy') || 'day'

        if (!['day', 'week', 'month'].includes(groupBy)) {
            return NextResponse.json(
                { error: "Invalid groupBy value. Must be 'day', 'week', or 'month'" },
                { status: 400 }
            )
        }

        // ─── Consultar Supabase con paginación ───
        const { createClient } = require('@supabase/supabase-js')
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        let allRows: any[] = []
        let page = 0
        const pageSize = 1000
        let hasMore = true
        let queryError = null

        while (hasMore) {
            let query = supabase
                .from('dt_halfhour_stats')
                .select('store_id, store_name, business_date, slot, order_count, avg_duration_sec, min_duration_sec, max_duration_sec')
                .gte('business_date', startDate)
                .lte('business_date', endDate)

            // Filtro de tienda
            if (storeId !== 'all') {
                query = query.eq('store_id', storeId)
            }

            const { data, error } = await query
                .order('business_date', { ascending: true })
                .order('slot_index', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1)

            if (error) {
                queryError = error
                break
            }

            if (data && data.length > 0) {
                const mapped = data.map((r: any) => ({
                    store_id: r.store_id,
                    store_name: r.store_name,
                    business_date: r.business_date,
                    slot_label: r.slot,
                    order_count: r.order_count,
                    avg_duration: r.avg_duration_sec,
                    min_duration: r.min_duration_sec,
                    max_duration: r.max_duration_sec
                }))
                allRows = allRows.concat(mapped)
                if (data.length < pageSize) {
                    hasMore = false
                } else {
                    page++
                }
            } else {
                hasMore = false
            }
        }

        if (queryError) {
            console.error('[DT Reports] Supabase error:', queryError.message)
            return NextResponse.json({ error: queryError.message }, { status: 500 })
        }

        const rows = allRows;

        if (rows.length === 0) {
            return NextResponse.json({
                periods: [],
                summary: {
                    overall_avg: 0,
                    total_cars: 0,
                    pct_within_goal: 0
                }
            })
        }

        // ─── Agrupar datos ───
        // Estructura: Map<periodKey, Map<storeId, StoreAccumulator>>
        const periodMap = new Map<string, Map<string, StoreAccumulator>>()

        // Acumuladores globales para el summary
        let globalWeightedDuration = 0
        let globalTotalCars = 0
        let globalOrdersWithinGoal = 0

        for (const row of rows) {
            const periodKey = getPeriodKey(row.business_date, groupBy)
            const orderCount = Number(row.order_count) || 0
            const avgDur = Number(row.avg_duration) || 0
            const minDur = Number(row.min_duration) || 0
            const maxDur = Number(row.max_duration) || 0

            // Acumular global
            globalTotalCars += orderCount
            globalWeightedDuration += avgDur * orderCount
            if (avgDur <= GOAL_THRESHOLD_SECONDS && orderCount > 0) {
                globalOrdersWithinGoal += orderCount
            }

            // Obtener/crear mapa de tiendas para este período
            if (!periodMap.has(periodKey)) {
                periodMap.set(periodKey, new Map<string, StoreAccumulator>())
            }
            const storeMap = periodMap.get(periodKey)!

            // Obtener/crear acumulador de la tienda
            if (!storeMap.has(row.store_id)) {
                storeMap.set(row.store_id, {
                    store_id: row.store_id,
                    store_name: row.store_name || 'Unknown',
                    total_orders: 0,
                    weighted_duration: 0,
                    min_duration: Infinity,
                    max_duration: 0,
                    orders_within_goal: 0,
                    total_slot_orders: 0,
                    unique_slots: new Set<string>()
                })
            }

            const acc = storeMap.get(row.store_id)!
            acc.total_orders += orderCount
            acc.weighted_duration += avgDur * orderCount
            acc.total_slot_orders += orderCount

            if (minDur > 0 && minDur < acc.min_duration) {
                acc.min_duration = minDur
            }
            if (maxDur > acc.max_duration) {
                acc.max_duration = maxDur
            }

            if (avgDur <= GOAL_THRESHOLD_SECONDS && orderCount > 0) {
                acc.orders_within_goal += orderCount
            }

            // Track slots únicos para calcular horas operativas
            const slotKey = `${row.business_date}_${row.slot_label}`
            acc.unique_slots.add(slotKey)
        }

        // ─── Construir respuesta ───
        const periods = Array.from(periodMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([period, storeMap]) => {
                const stores = Array.from(storeMap.values()).map(acc => {
                    const avgDuration = acc.total_orders > 0
                        ? Math.round(acc.weighted_duration / acc.total_orders)
                        : 0

                    // Horas operativas = slots únicos × 0.5 horas
                    const operativeHours = acc.unique_slots.size * 0.5
                    const carsPerHourAvg = operativeHours > 0
                        ? Math.round((acc.total_orders / operativeHours) * 10) / 10
                        : 0

                    const pctWithinGoal = acc.total_orders > 0
                        ? Math.round((acc.orders_within_goal / acc.total_orders) * 1000) / 10
                        : 0

                    return {
                        store_id: acc.store_id,
                        store_name: acc.store_name,
                        total_orders: acc.total_orders,
                        avg_duration: avgDuration,
                        min_duration: acc.min_duration === Infinity ? 0 : acc.min_duration,
                        max_duration: acc.max_duration,
                        cars_per_hour_avg: carsPerHourAvg,
                        pct_within_goal: pctWithinGoal
                    }
                })

                return { period, stores }
            })

        // Summary global
        const overallAvg = globalTotalCars > 0
            ? Math.round(globalWeightedDuration / globalTotalCars)
            : 0
        const pctWithinGoal = globalTotalCars > 0
            ? Math.round((globalOrdersWithinGoal / globalTotalCars) * 1000) / 10
            : 0

        return NextResponse.json({
            periods,
            summary: {
                overall_avg: overallAvg,
                total_cars: globalTotalCars,
                pct_within_goal: pctWithinGoal
            }
        })

    } catch (error: any) {
        console.error('[DT Reports] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
