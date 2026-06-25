/**
 * @module api/cron/sync-drive-thru
 * @description Cron job de Vercel que sincroniza datos de Drive-Thru desde Toast API hacia las tablas
 *   `dt_orders` y `dt_halfhour_stats` en Supabase. Se ejecuta cada 5 minutos durante horario operativo.
 *   Adicionalmente, a las 7 AM (primera corrida del día) ejecuta auto-detección de tiendas DT.
 *
 * @businessRules
 * - **Día Laboral (Business Date)**: Comienza a las 6:00 AM y termina a las 5:59 AM del día siguiente
 *   (zona horaria America/Los_Angeles). Si la hora actual es < 6 AM, el business date es el día anterior.
 * - **Horas Muertas**: Se omite la ejecución a las 5 AM y 6 AM (cierre/apertura del día operativo).
 * - **Drive-Thru Detection**: Las órdenes DT se identifican por dining option name que contiene "drive" (case-insensitive).
 * - **Umbrales de velocidad**: 🟢 ≤210s, 🟡 211-300s, 🔴 >300s
 * - **Media hora (Half-hour slots)**: Se agrupan en intervalos de 30 min: "06:00", "06:30", "07:00", etc.
 * - **Auto-detección (7 AM)**: Analiza sales_daily_cache y dt_orders para detectar
 *   automáticamente nuevas tiendas con Drive-Thru. Si una nueva sucursal empieza a
 *   recibir órdenes DT, se marca has_drive_thru=true automáticamente. Si una tienda
 *   deja de tener actividad DT por 30+ días, se desactiva automáticamente.
 *
 * @dataFlow
 * - Vercel Cron → GET /api/cron/sync-drive-thru
 *   → [7 AM only] autoDetectDTStores() → actualiza stores.has_drive_thru
 *   → syncDriveThruData(businessDate) → Toast API ordersBulk
 *   → Filtra DT orders → Calcula duración → Upsert dt_orders + dt_halfhour_stats
 *
 * @notes
 * - Requiere que `syncDriveThruData` y `autoDetectDTStores` estén en `@/lib/drive-thru-api`.
 * - El maxDuration de 300s es el máximo permitido en Vercel Pro.
 * - Autenticación vía CRON_SECRET header (Bearer token).
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
        const now = new Date()
        const laNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
        const currentHour = laNow.getHours()

        let todayStr: string

        if (forceDateParam && /^\d{4}-\d{2}-\d{2}$/.test(forceDateParam)) {
            // Manual override — skip dead hours check, use provided date
            todayStr = forceDateParam
            console.log(`⏰ [⏰ CRON DT] Manual override: syncing ${todayStr}`)
        } else {
            // Omitir horas muertas: 5 AM y 6 AM (cierre/apertura del día)
            if (currentHour === 5 || currentHour === 6) {
                console.log(`⏳ [⏰ CRON DT] Ejecución omitida. Hora muerta (5-6 AM). Hora actual LA: ${currentHour}:00`)
                return NextResponse.json({
                    success: true,
                    message: 'Skipped: Dead hours (5-6 AM)',
                    hour: currentHour
                })
            }

            // Regla de las 6 AM: si es antes de las 6 AM, sigue siendo el día operativo anterior
            if (currentHour < 6) {
                laNow.setDate(laNow.getDate() - 1)
            }

            const y = laNow.getFullYear()
            const m = String(laNow.getMonth() + 1).padStart(2, '0')
            const day = String(laNow.getDate()).padStart(2, '0')
            todayStr = `${y}-${m}-${day}`
        }

        console.log(`⏰ [⏰ CRON DT] Iniciando sincronización Drive-Thru para: ${todayStr} (hora LA: ${currentHour}:00)`)

        // ─── Auto-detección de nuevas tiendas DT (solo a las 7 AM) ───
        let autoDetect = null
        if (currentHour === 7) {
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
