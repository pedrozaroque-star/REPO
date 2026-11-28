/**
 * @module api/cron/sync-holiday-hours/route
 * @description Cron mensual perpetuo de Vercel (`17 11 1 * *`, día 1 de cada mes 3:17 AM PT) y endpoint
 * administrativo para mantener los 7 días festivos oficiales de las 15 sucursales de Tacos Gavilan
 * sincronizados automáticamente en Google Business Profile, Grubhub, DoorDash y Uber Eats para los próximos
 * 11 meses (ventana rodante de 330 días, siempre < 365d para respetar límites de API, cálculo perpetuo 2023–2099).
 *
 * @businessRules
 * - Acceso Fail-Closed: requiere `Authorization: Bearer <CRON_SECRET>` válido o sesión JWT administrativa (`admin`).
 * - Idempotente: audita primero el estado vivo de cada plataforma y solo ejecuta escrituras cuando falta una fecha
 *   o difiere del horario oficial de `lib/holidays.ts` + `public.stores.weekly_hours`.
 * - Soporta `?dryRun=true`, `?horizonDays=30..360` y `?platforms=gbp,grubhub,doordash,ubereats`.
 * - Notifica por correo vía `noreply@tacosgavilan.com` a `carlos@tacosgavilan.com` ante sesiones caducadas
 *   (DoorDash/Uber Eats) o recordatorio preventivo en octubre/febrero para Apple Business Connect y Bing Places.
 *
 * @dataFlow
 * - Vercel Cron (`17 11 1 * *`) -> GET `/api/cron/sync-holiday-hours` -> `lib/holiday-platform-sync.ts`
 *   -> Google Business Profile API + Grubhub CatalogEdit API + DoorDash Merchant API + Uber Eats Manager API.
 *
 * @notes
 * - Creado 2026-11-27 para garantizar operación perpetua año tras año sin depender de cargas manuales.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
    syncUpcomingHolidaysAcrossPlatforms,
    type SupportedPlatform,
} from '@/lib/holiday-platform-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const VALID_PLATFORMS = new Set<SupportedPlatform>(['gbp', 'grubhub', 'doordash', 'ubereats'])

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
                    { success: false, error: staffAuth.error || 'No autorizado' },
                    { status: staffAuth.status || 401 }
                )
            }
        }

        const { searchParams } = new URL(req.url)
        const dryRun = searchParams.get('dryRun') === 'true'
        const rawHorizon = Number(searchParams.get('horizonDays') || '330')
        const horizonDays = Number.isFinite(rawHorizon) ? Math.min(360, Math.max(30, Math.trunc(rawHorizon))) : 330
        const rawPlatforms = searchParams.get('platforms')
        const platforms = rawPlatforms
            ? rawPlatforms
                .split(',')
                .map((p) => p.trim().toLowerCase() as SupportedPlatform)
                .filter((p) => VALID_PLATFORMS.has(p))
            : undefined

        const report = await syncUpcomingHolidaysAcrossPlatforms({
            dryRun,
            horizonDays,
            platforms,
        })

        return NextResponse.json({
            success: true,
            report,
        })
    } catch (error: any) {
        console.error('[CRON SYNC HOLIDAY HOURS] Error:', error?.message || error)
        return NextResponse.json(
            { success: false, error: error?.message || 'Internal error' },
            { status: 500 }
        )
    }
}
