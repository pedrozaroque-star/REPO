/**
 * @module app/api/cron/audit-employee-emails/route
 * @description Endpoint de Vercel Cron ejecutado automáticamente todos los sábados por la tarde
 * hora de Los Ángeles, California (`0 22 * * 6` UTC -> 2:00 PM PST / 3:00 PM PDT) para sincronizar
 * el padrón de empleados desde Toast POS en las 15 sucursales, verificar la existencia y validez real
 * de todos los correos de empleados activos, y despachar alertas automáticas de corrección a cada
 * Store Manager involucrado (CC Supervisor de Zona) más un resumen ejecutivo a `carlos@tacosgavilan.com`.
 *
 * @businessRules
 * - Programación semanal: Sábados por la tarde hora LA California (`0 22 * * 6` en `vercel.json`),
 *   justo antes de la publicación dominical/semanal de horarios en `/planificador`.
 * - Seguridad estricta (`AGENTS.md`): Exige `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron o
 *   runner autorizado) o sesión JWT activa de administrador / Dirección (`getServerUser`). Nunca
 *   confía en query params públicos sin autenticar.
 * - Idempotencia diaria: Si el runner local con puerto 25 ya ejecutó y despachó la auditoría del mismo
 *   sábado (`lastDispatchedDateLA`), el cron en la nube omite reenvíos duplicados salvo `?force=true`.
 *
 * @dataFlow
 * - `GET` / `POST` `/api/cron/audit-employee-emails` -> Auth (`CRON_SECRET` | `getServerUser`) ->
 *   `runEmployeeEmailAudit()` (`lib/employee-email-auditor.ts`) -> Toast Sync + Verificación Multicapa +
 *   Envío Gmail OAuth (`carlos@tacosgavilan.com`) -> JSON Response.
 *
 * @notes
 * - Soporta parámetros autenticados `?dry_run=true`, `?force=true`, `?skip_toast_sync=true` y `?test_to=...`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth-server'
import { runEmployeeEmailAudit } from '@/lib/employee-email-auditor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function isAuthorizedRequest(req: NextRequest): Promise<boolean> {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        return true
    }

    const user = await getServerUser(req)
    if (user) {
        const role = String(user.role || '').toLowerCase()
        const email = String(user.email || '').toLowerCase()
        if (role === 'admin' || email === 'carlos@tacosgavilan.com') {
            return true
        }
    }

    // If neither CRON_SECRET is configured in local dev nor session exists, reject in production
    if (!cronSecret && process.env.NODE_ENV !== 'production') {
        return true
    }

    return false
}

async function handleAudit(req: NextRequest) {
    try {
        const authorized = await isAuthorizedRequest(req)
        if (!authorized) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const dryRun = searchParams.get('dry_run') === 'true'
        const force = searchParams.get('force') === 'true'
        const skipToastSync = searchParams.get('skip_toast_sync') === 'true'
        const seedCacheOnly = searchParams.get('seed_cache_only') === 'true'
        const testTo = searchParams.get('test_to')

        const report = await runEmployeeEmailAudit({
            dryRun,
            force,
            syncToastFirst: !skipToastSync,
            seedCacheOnly,
            testTo,
        })

        return NextResponse.json({
            success: true,
            report,
        })
    } catch (error: any) {
        console.error('[CRON AUDIT EMPLOYEE EMAILS] Fatal error:', error)
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Internal Server Error',
            },
            { status: 500 }
        )
    }
}

export async function GET(req: NextRequest) {
    return handleAudit(req)
}

export async function POST(req: NextRequest) {
    return handleAudit(req)
}
