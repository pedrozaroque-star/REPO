/**
 * @module api/cron/sync-drive-thru
 * @description Cron job de Vercel que sincroniza datos de Drive-Thru desde Toast API hacia las tablas
 *   `dt_orders` y `dt_halfhour_stats` en Supabase. Se ejecuta cada 15 minutos durante horario operativo.
 *   Adicionalmente, a las 7:00 AM (primera corrida del día, minuto < 15) ejecuta auto-detección de tiendas DT una sola vez.
 *
 * @businessRules
 * - **Día Laboral (Business Date)**: Comienza a las 6:00 AM y termina a las 5:59 AM del día siguiente
 *   (zona horaria America/Los_Angeles). Si la hora actual es < 6 AM, el business date es el día anterior.
 * - **Horas Muertas**: Se omite la ejecución de 4:15 AM a 6:59 AM LA (ventana sin ventas, override con `?date=YYYY-MM-DD` o `?force=1`).
 * - **Drive-Thru Detection**: Las órdenes DT se identifican por dining option name que contiene "drive" (case-insensitive).
 * - **Umbrales de velocidad**: 🟢 ≤210s, 🟡 211-300s, 🔴 >300s
 * - **Media hora (Half-hour slots)**: Se agrupan en intervalos de 30 min: "06:00", "06:30", "07:00", etc.
 * - **Auto-detección (7:00 AM)**: Analiza sales_daily_cache y dt_orders una sola vez por mañana (`currentHour === 7 && currentMinute < 15`) para detectar
 *   automáticamente nuevas tiendas con Drive-Thru. Si una nueva sucursal empieza a
 *   recibir órdenes DT, se marca has_drive_thru=true automáticamente. Si una tienda
 *   deja de tener actividad DT por 30+ días, se desactiva automáticamente.
 *
 * @dataFlow
 * - Vercel Cron → GET /api/cron/sync-drive-thru
 *   → [7:00-7:14 AM only] autoDetectDTStores() → actualiza stores.has_drive_thru
 *   → syncDriveThruData(businessDate) → Toast API ordersBulk
 *   → Filtra DT orders → Calcula duración → Upsert dt_orders + dt_halfhour_stats
 *
 * @notes
 * - Requiere que `syncDriveThruData` y `autoDetectDTStores` estén en `@/lib/drive-thru-api`.
 * - El maxDuration de 300s es el máximo permitido en Vercel Pro.
 * - Autenticación vía CRON_SECRET header (Bearer token).
 * - 2026-11-19 (Paquete 2A): Alineadas horas muertas a `4:15–6:59 AM LA` con soporte `?force=1` y corregido disparo de `autoDetectDTStores()` a `currentHour === 7 && currentMinute < 15` (1×/mañana en lugar de 6×).
 */
import { NextResponse } from 'next/server'
import { syncDriveThruData, autoDetectDTStores } from '@/lib/drive-thru-api'

export const dynamic = 'force-dynamic'

// Timeout máximo para Vercel Pro — procesamos lo que podamos en ese lapso
export const maxDuration = 300

export async function GET(request: Request) {
    try {
        // ─── Verificar firma de autorización (Vercel Cron) ───
        const authHeader = request.headers.get('authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            if (process.env.CRON_SECRET) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
        }

        // ─── Calcular businessDate con regla de las 6 AM (zona LA) ───
        const url = new URL(request.url)
        const forceDateParam = url.searchParams.get('date')
        const forceRun = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true'
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

        let todayStr: string

        if (forceDateParam && /^\d{4}-\d{2}-\d{2}$/.test(forceDateParam)) {
            // Manual override — skip dead hours check, use provided date
            todayStr = forceDateParam
            console.log(`⏰ [⏰ CRON DT] Manual override: syncing ${todayStr}`)
        } else {
            // Omitir horas muertas: 4:15 AM - 6:59 AM LA (ventana sin ventas)
            if (!forceRun && ((currentHour === 4 && currentMinute >= 15) || currentHour === 5 || currentHour === 6)) {
                console.log(`⏳ [⏰ CRON DT] Ejecución omitida. Hora muerta (4:15 AM - 6:59 AM LA). Hora actual LA: ${currentHour}:${String(currentMinute).padStart(2, '0')}`)
                return NextResponse.json({
                    success: true,
                    skipped: true,
                    message: 'Skipped: Dead hours (4:15 AM - 6:59 AM LA)',
                    hour: currentHour,
                    minute: currentMinute
                })
            }

            // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el día operativo anterior
            const bizDateUtc = new Date(Date.UTC(laYear, laMonth - 1, laDay))
            if (currentHour < 6) {
                bizDateUtc.setUTCDate(bizDateUtc.getUTCDate() - 1)
            }

            const y = bizDateUtc.getUTCFullYear()
            const m = String(bizDateUtc.getUTCMonth() + 1).padStart(2, '0')
            const day = String(bizDateUtc.getUTCDate()).padStart(2, '0')
            todayStr = `${y}-${m}-${day}`
        }

        console.log(`⏰ [⏰ CRON DT] Iniciando sincronización Drive-Thru para: ${todayStr} (hora LA: ${currentHour}:${String(currentMinute).padStart(2, '0')})`)

        // ─── Auto-detección de nuevas tiendas DT (1 vez por mañana: 7:00-7:14 AM LA) ───
        let autoDetect = null
        if (currentHour === 7 && currentMinute < 15) {
            console.log('[⏰ CRON DT] 🔍 Ejecutando auto-detección de tiendas DT...')
            autoDetect = await autoDetectDTStores()
            if (autoDetect.activated.length > 0) {
                console.log(`[⏰ CRON DT] 🟢 Nuevas tiendas DT detectadas: ${autoDetect.activated.join(', ')}`)
            }
            if (autoDetect.deactivated.length > 0) {
                console.log(`[⏰ CRON DT] 🔴 Tiendas DT desactivadas: ${autoDetect.deactivated.join(', ')}`)
            }
        }

        // ─── Ejecutar sincronización DT ───
        const result = await syncDriveThruData(todayStr)

        console.log(`✅ [⏰ CRON DT] Sincronización completada para ${todayStr}. Órdenes almacenadas: ${result.stored}`)

        return NextResponse.json({
            success: true,
            date: todayStr,
            stored: result.stored,
            stats: result.stats,
            errors: result.errors,
            auto_detect: autoDetect,
            processed_at: new Date().toISOString()
        })

    } catch (error: any) {
        console.error(`💥 [⏰ CRON DT] Error crítico:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
