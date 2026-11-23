/**
 * @module api/cron/sync-sales-today/route
 * @description Periodic cron job running every 5 minutes during operating hours (6:00 AM to 4:59 AM next day) to synchronize intraday live sales from Toast POS into Supabase sales_daily_cache.
 * @businessRules
 * - Business day starts at 6:00 AM and ends at 5:59 AM next day (PST/PDT America/Los_Angeles).
 * - Skips dead hours 4:15 AM - 6:59 AM LA (`?force=1` overrides).
 * - Late-night throttle (1:00 AM - 4:14 AM LA): runs every 30 min (`laMinute % 30 < 10`, preserving the final 4:00 AM sweep; `?force=1` overrides).
 * - Uses Full Precision mode for exact penny parity with Toast.
 * @dataFlow
 * - Vercel Cron -> GET /api/cron/sync-sales-today -> Toast API -> sales_daily_cache (Supabase) -> Response.
 * @notes
 * - 2026-11-19 (Paquete 2A): Conservado salto de ventana muerta `4:15–6:59 AM LA` y agregado throttle de 30 min en madrugada (`1:00–4:14 AM LA`, `laMinute % 30 < 10`, conservando barrida final 4:00 AM) con soporte `?force=1`.
 * - Blindaje Fail-Closed (`verifyStaffAuth`): exige `CRON_SECRET` o sesión `admin`/`supervisor`.
 * - [2026-11-23] Tolerancia a fallos parciales: filtra filas con `hasError` y protege ventas positivas existentes contra sobrescrituras en `$0`, permitiendo guardar las sucursales sanas aunque 1 tienda sufra un 429/timeout de Toast API.
 */

import { NextResponse } from 'next/server'
import { fetchToastData } from '@/lib/toast-api'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { shouldAllowSalesCacheUpsert } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 

export async function GET(request: Request) {
    try {
        const auth = await verifyStaffAuth(request, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const { searchParams } = new URL(request.url)
        const forceRun = searchParams.get('force') === '1' || searchParams.get('force') === 'true'

        const now = new Date()
        const laParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(now)
        const getPart = (type: string) => laParts.find(p => p.type === type)?.value || '0'
        const laYear = parseInt(getPart('year'), 10)
        const laMonth = parseInt(getPart('month'), 10)
        const laDay = parseInt(getPart('day'), 10)
        const rawHour = parseInt(getPart('hour'), 10)
        const currentHour = rawHour === 24 ? 0 : rawHour
        const currentMinute = parseInt(getPart('minute'), 10)

        // Restricción de horario: Omitimos la ventana muerta real sin ventas (4:15 AM - 6:59 AM LA),
        // salvo override manual ?force=1.
        if (!forceRun && ((currentHour === 4 && currentMinute >= 15) || currentHour === 5 || currentHour === 6)) {
            console.log(`⏳ [CRON TODAY] Ejecución omitida en ventana sin ventas (4:15am-6:59am). Hora actual LA: ${currentHour}:${String(currentMinute).padStart(2, '0')}`)
            return NextResponse.json({ success: true, skipped: true, message: 'Skipped: Dead hours (4:15 AM - 6:59 AM LA)' })
        }

        // Madrugada (1:00 AM - 4:14 AM LA): correr cada 30 min (laMinute % 30 < 10), conservando barrida final de las 4:00 AM
        const isLateNightWindow = currentHour >= 1 && (currentHour < 4 || (currentHour === 4 && currentMinute < 15))
        if (!forceRun && isLateNightWindow && currentMinute % 30 >= 10) {
            console.log(`⏳ [CRON TODAY] Ejecución omitida en throttle de madrugada (1:00am-4:14am, cada 30 min). Hora actual LA: ${currentHour}:${String(currentMinute).padStart(2, '0')}`)
            return NextResponse.json({ success: true, skipped: true, message: 'Skipped: Late-night 30m throttle (1:00 AM - 4:14 AM LA)' })
        }

        // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el "hoy" operativo del día anterior
        const bizDateUtc = new Date(Date.UTC(laYear, laMonth - 1, laDay))
        if (currentHour < 6) {
            bizDateUtc.setUTCDate(bizDateUtc.getUTCDate() - 1)
        }

        const y = bizDateUtc.getUTCFullYear()
        const m = String(bizDateUtc.getUTCMonth() + 1).padStart(2, '0')
        const day = String(bizDateUtc.getUTCDate()).padStart(2, '0')
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

        const supabase = await getSupabaseAdminClient()
        const existingSalesMap = new Map<string, number>()
        if (rows.length > 0) {
            const { data: existingRows } = await supabase
                .from('sales_daily_cache')
                .select('store_id, net_sales')
                .eq('business_date', todayStr)
            existingRows?.forEach((er: any) => {
                existingSalesMap.set(er.store_id, Number(er.net_sales) || 0)
            })
        }

        // Tolerancia a fallos parciales: guarda sucursales sanas y bloquea filas con hasError o $0 sobre ventas previas
        const safeRows = rows.filter(r =>
            shouldAllowSalesCacheUpsert(r, existingSalesMap.get(r.storeId))
        )

        if (connectionError && safeRows.length === 0) {
            console.error(`❌ [CRON TODAY] Error conectando a Toast para ${todayStr}: ${connectionError}`)
            return NextResponse.json({ success: false, error: connectionError }, { status: 502 })
        }

        // --- SAVE TO SUPABASE ---
        if (safeRows.length > 0) {
            const dbRows = safeRows.map(r => ({
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
            const skippedCount = rows.length - safeRows.length
            console.log(`💾 [CRON TODAY] Guardado en DB para ${todayStr}: ${dbRows.length} filas${skippedCount > 0 ? ` (${skippedCount} omitidas por error/anti-cero)` : ''}.`)
        }

        console.log(`✅ [CRON TODAY] Sincronización de 'Hoy' completada.`)

        return NextResponse.json({
            success: true,
            date: todayStr,
            stores_synced: safeRows.length,
            skipped_errored: rows.length - safeRows.length,
            ...(connectionError ? { partial_error: connectionError } : {})
        })

    } catch (error: any) {
        console.error('CRON TODAY Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
