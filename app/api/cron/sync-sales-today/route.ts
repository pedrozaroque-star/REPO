/**
 * @module api/cron/sync-sales-today/route
 * @description Periodic cron job running every 5 minutes during operating hours (6:00 AM to 4:59 AM next day) to synchronize intraday live sales from Toast POS into Supabase sales_daily_cache.
 * @businessRules
 * - Business day starts at 6:00 AM and ends at 5:59 AM next day (PST/PDT America/Los_Angeles).
 * - Skips only 5:00 AM (shift handover downtime) and starts syncing immediately at 6:00 AM.
 * - Uses Full Precision mode for exact penny parity with Toast.
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/sync-sales-today -> Toast API -> sales_daily_cache (Supabase) -> Response.
 */

import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        
        const currentHour = laNow.getHours()

        // Restricción de horario: Correr entre las 6 AM y las 4:59 AM del día siguiente.
        // Omitimos únicamente las 5 AM (cierre/transición de jornada).
        if (currentHour === 5) {
            console.log(`⏳ [CRON TODAY] Ejecución omitida. Fuera de horario operativo (5:00am-5:59am). Hora actual LA: ${currentHour}:00`)
            return NextResponse.json({ success: true, message: 'Skipped: Outside operating hours (5 AM rollover)' })
        }

        // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el "hoy" operativo del día anterior
        if (currentHour < 6) {
            laNow.setDate(laNow.getDate() - 1)
        }

        const y = laNow.getFullYear()
        const m = String(laNow.getMonth() + 1).padStart(2, '0')
        const day = String(laNow.getDate()).padStart(2, '0')
        const todayStr = `${y}-${m}-${day}`

        console.log(`⏰ [CRON TODAY] Iniciando sincronización de ventas intra-día para: ${todayStr}`)

        // Ejecutar sincronización en FULL MODE para asegurar precisión
        const { rows, connectionError } = await fetchToastData({
            storeIds: 'all',
            startDate: todayStr,
            endDate: todayStr,
            groupBy: 'day',
            skipCache: true,
            fastMode: false,
            readOnly: true
        })

        if (connectionError) {
            console.error(`❌ [CRON TODAY] Error conectando a Toast para ${todayStr}: ${connectionError}`)
            return NextResponse.json({ success: false, error: connectionError }, { status: 502 })
        }

        // --- SAVE TO SUPABASE ---
        if (rows.length > 0) {
            const supabase = await getSupabaseAdminClient()

            const dbRows = rows.map(r => ({
                store_id: r.storeId,
                store_name: r.storeName || 'Unknown Store',
                business_date: todayStr,
                net_sales: r.netSales,
                gross_sales: r.grossSales,
                discounts: r.discounts,
                tips: r.tips,
                taxes: r.taxes,
                service_charges: r.serviceCharges,
                order_count: r.orderCount,
                guest_count: r.guestCount,
                labor_cost: r.laborCost,
                labor_hours: r.totalHours,
                hourly_data: r.hourlySales || {},
                hourly_tickets: r.hourlyTickets || {},
                hourly_labor: r.hourlyLabor || {},
                uber_sales: r.uberSales || 0,
                doordash_sales: r.doordashSales || 0,
                grubhub_sales: r.grubhubSales || 0,
                ebt_count: r.ebtCount || 0,
                ebt_amount: r.ebtAmount || 0,
                updated_at: new Date().toISOString()
            }))

            const { error: upsertError } = await supabase
                .from('sales_daily_cache')
                .upsert(dbRows, { onConflict: 'store_id,business_date' })

            if (upsertError) {
                console.error(`❌ [CRON TODAY] DB Save Error para ${todayStr}:`, upsertError)
                return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
            }
            console.log(`💾 [CRON TODAY] Guardado en DB para ${todayStr}: ${dbRows.length} filas.`)
        }

        console.log(`✅ [CRON TODAY] Sincronización de 'Hoy' completada.`)

        return NextResponse.json({
            success: true,
            date: todayStr,
            stores_synced: rows.length
        })

    } catch (error: any) {
        console.error('CRON TODAY Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
