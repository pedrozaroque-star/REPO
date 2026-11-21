/**
 * @module api/cron/monitor-system-health/route
 * @description Endpoint de cron de Vercel y diagnóstico administrativo para monitorear el estado de salud de Supabase y Vercel.
 * Realiza pruebas de latencia, verifica capacidad de almacenamiento vs Spend Cap (8 GB),
 * frescura de Toast y disponibilidad general. Notifica vía email a carlos@tacosgavilan.com si se cruzan umbrales.
 *
 * @businessRules
 * - Acceso Fail-Closed: requiere **O BIEN** header `Authorization: Bearer <CRON_SECRET>` válido (solo cuando `process.env.CRON_SECRET` no está vacío y coincide exactamente) **O BIEN** sesión JWT administrativa válida (`verifyStaffAuth` con `allowedRoles: ['admin']`).
 * - Cuando ninguno es válido (incluso si `CRON_SECRET` no está definido), devuelve `401` / `403`, bloqueando abuso anónimo de `?forceEmail=true`.
 * - Monitorea umbrales de 6.0 GB (Preventivo) y 7.2 GB (Crítico) contra el límite fijo de 8 GB de Spend Cap.
 *
 * @dataFlow
 * - Vercel Cron (`Bearer CRON_SECRET`) o `/admin/salud-sistema` (`Admin JWT`) -> GET `/api/cron/monitor-system-health` -> `lib/system-health-sentinel.ts` -> Response JSON.
 *
 * @notes
 * - Endurecido 2026-11-20: soporte dual Cron + Admin JWT con bloqueo estricto fail-closed cuando `CRON_SECRET` está ausente.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkAndNotifySystemHealth } from '@/lib/system-health-sentinel'
import { verifyStaffAuth } from '@/lib/auth-server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    try {
        const cronSecret = (process.env.CRON_SECRET || '').trim()
        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
        const cronHeader = req.headers.get('x-cron-auth') || authHeader

        const isAuthorizedCron =
            cronSecret.length > 0 &&
            (cronHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)

        if (!isAuthorizedCron) {
            const staffAuth = verifyStaffAuth(req, { allowedRoles: ['admin'], allowCron: false })
            if (!staffAuth.authorized) {
                return NextResponse.json(
                    {
                        success: false,
                        error: staffAuth.error || 'No autorizado'
                    },
                    { status: staffAuth.status || 401 }
                )
            }
        }

        const { searchParams } = new URL(req.url)
        const forceEmail = searchParams.get('forceEmail') === 'true'

        const report = await checkAndNotifySystemHealth(forceEmail)

        return NextResponse.json({
            success: true,
            status: report.overallStatus,
            report
        })
    } catch (error: any) {
        console.error('[CRON MONITOR SYSTEM HEALTH] Error:', error.message)
        return NextResponse.json(
            {
                success: false,
                error: error.message
            },
            { status: 500 }
        )
    }
}
