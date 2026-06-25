/**
 * @module api/drive-thru/lookup
 * @description Endpoint GET para listar órdenes individuales Drive-Thru con soporte para
 *   listado completo por fecha y búsqueda por número de orden. Al hacer clic en una orden
 *   el frontend usa /api/toast-order-detail para mostrar el ticket/recibo.
 *
 * @businessRules
 * - **Modo lista (sin orderNumber)**: Lista TODAS las órdenes DT de una fecha, filtradas
 *   opcionalmente por tienda. Paginación con limit/offset para rendimiento.
 * - **Modo búsqueda (con orderNumber)**: Busca coincidencia en `dt_orders.order_number`.
 * - **Filtros opcionales**: storeId (UUID de tienda) y date (YYYY-MM-DD, business_date).
 * - **Límite default**: 200 órdenes. Soporta paginación con offset.
 * - **Ordenamiento**: Por `opened_at` descendente (la orden más reciente primero).
 * - **Retorna order_guid**: Necesario para que el frontend pueda llamar a
 *   /api/toast-order-detail?guid=X&storeId=X y mostrar el ticket/recibo.
 *
 * @dataFlow
 * - GET /api/drive-thru/lookup?date=YYYY-MM-DD&storeId=UUID&orderNumber=123&limit=200&offset=0
 *   → Consulta Supabase `dt_orders` con filtros aplicados
 *   → Ordena por opened_at DESC
 *   → Retorna { orders[], count, total }
 *
 * @notes
 * - No requiere autenticación CRON_SECRET (es endpoint público interno).
 * - Si no se pasa date ni orderNumber, usa la fecha laboral actual (regla 6 AM).
 * - order_guid se retorna para poder abrir el ticket en Toast.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams

        // ─── Parámetros ───
        const orderNumber = searchParams.get('orderNumber') || undefined
        const storeId = searchParams.get('storeId') || undefined
        const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 1000)
        const offset = parseInt(searchParams.get('offset') || '0')

        // Date: si no viene, calcular fecha laboral actual
        let date = searchParams.get('date') || undefined
        if (!date && !orderNumber) {
            const now = new Date()
            const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
            if (laNow.getHours() < 6) laNow.setDate(laNow.getDate() - 1)
            date = laNow.getFullYear() + '-' +
                String(laNow.getMonth() + 1).padStart(2, '0') + '-' +
                String(laNow.getDate()).padStart(2, '0')
        }

        // ─── Consultar Supabase ───
        const { createClient } = require('@supabase/supabase-js')
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Primero: contar total de resultados
        let countQuery = supabase
            .from('dt_orders')
            .select('*', { count: 'exact', head: true })

        if (orderNumber) countQuery = countQuery.eq('order_number', orderNumber)
        if (storeId) countQuery = countQuery.eq('store_id', storeId)
        if (date) countQuery = countQuery.eq('business_date', date)

        const { count: total } = await countQuery

        // Segundo: obtener datos paginados
        let query = supabase
            .from('dt_orders')
            .select('id, store_id, store_name, business_date, order_guid, order_number, opened_at, closed_at, duration_seconds, half_hour_slot, hour, net_sales')

        if (orderNumber) query = query.eq('order_number', orderNumber)
        if (storeId) query = query.eq('store_id', storeId)
        if (date) query = query.eq('business_date', date)

        query = query
            .order('opened_at', { ascending: false })
            .range(offset, offset + limit - 1)

        const { data: orders, error } = await query

        if (error) {
            console.error('[DT Lookup] Supabase error:', error.message)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({
            orders: orders || [],
            count: (orders || []).length,
            total: total || 0,
            date: date || null,
            offset,
            limit
        })

    } catch (error: any) {
        console.error('[DT Lookup] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
