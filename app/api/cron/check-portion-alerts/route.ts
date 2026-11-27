/**
 * @module app/api/cron/check-portion-alerts/route
 * @description Cron diario automatizado (`15 19 * * *` UTC — 11:15 AM PST / 12:15 PM PDT, justo después de
 *   `/api/cron/sync-pmix` y `/api/cron/sync-food-cost`) que ejecuta el Balance de Masas Telescópico de 7 días
 *   en las 15 sucursales para Carne Asada (prioridad #1) y las otras 7 proteínas activas, persiste alertas
 *   idempotentes en `public.portion_control_alerts` y despacha avisos ejecutivos a la Escalera de Mando.
 *
 * @businessRules
 *   - **Idempotencia Estricta**: Gracias a `UNIQUE(store_id, period_start, period_end, meat_key)` y la verificación
 *     de `email_sent_at`, jamás envía correos duplicados para la misma ventana medida.
 *   - **Modo Seguro de Pruebas**: Soporta `?dry_run=true` (cero escrituras y cero envíos) y `?test_to=...`
 *     (restringido estrictamente a `@tacosgavilan.com`).
 *
 * @dataFlow
 *   Vercel Cron (`15 19 * * *`) → `GET/POST /api/cron/check-portion-alerts`
 *   → `scanPortionControlAlerts()` + `enforceOverduePortionAlerts()` (SLA obligatorio 24h).
 *
 * @notes
 *   - Protegido con `verifyStaffAuth(..., { allowedRoles: ['admin', 'supervisor'], allowCron: true })`.
 *   - [2026-11-27] El correo ejecutivo "Resumen Semanal de Sobrantes" (Lunes–Domingo, desglose Supervisor/Sucursal/Día)
 *     se movió a su propio cron semanal `/api/cron/weekly-sobrantes-digest` (lunes 10:00 AM hora California).
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  isPortionAlertsWeeklyTestMode,
  scanPortionControlAlerts,
  validateTestToEmail,
} from '@/lib/inventory/portion-control-alerts'
import { enforceOverduePortionAlerts } from '@/lib/inventory/portion-discipline-policy'
import { loadToastMeatContext } from '@/lib/inventory/toast-meat-sold-resolver'
import { addDaysIso, getBusinessDateLA, isValidIsoDate } from '@/lib/inventory/food-cost-sales-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleCheckPortionAlerts(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  const startedAt = Date.now()
  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dry_run') === 'true'
    const sendEmailsParam = url.searchParams.get('send_emails')
    const sendEmails = sendEmailsParam !== null ? sendEmailsParam !== 'false' : !dryRun
    const forceResend = url.searchParams.get('force_resend') === 'true'
    const storeId = url.searchParams.get('store_id')?.trim() || null
    const endDate = url.searchParams.get('date')?.trim() || url.searchParams.get('end_date')?.trim() || null
    const startDate = url.searchParams.get('start_date')?.trim() || null
    const spanDays = Math.max(1, Math.min(35, Number(url.searchParams.get('span_days')) || 7))
    const meatKey = url.searchParams.get('meat_key')?.trim() || null
    const rawTestTo = url.searchParams.get('test_to')?.trim() || null

    const testCheck = validateTestToEmail(rawTestTo)
    if (!testCheck.valid) {
      return NextResponse.json({ error: testCheck.error }, { status: 400 })
    }

    // Pre-cargar UNA SOLA VEZ `loadToastMeatContext` (fragmentado <= 15 filas/lote) para compartirlo
    // entre `scanPortionControlAlerts` y `computeToastVsFridgeForIngredient` (corta RAM/IO a la mitad).
    const todayLA = getBusinessDateLA()
    const yesterdayLA = addDaysIso(todayLA, -1)
    const resolvedEnd = endDate && isValidIsoDate(endDate) && endDate <= yesterdayLA ? endDate : yesterdayLA
    const rawStart = startDate && isValidIsoDate(startDate) && startDate <= resolvedEnd ? startDate : addDaysIso(resolvedEnd, -(spanDays - 1))
    const minAllowedStart = addDaysIso(resolvedEnd, -34)
    const resolvedStart = rawStart < minAllowedStart ? minAllowedStart : rawStart

    const parsedStoreNum = storeId && /^\d+$/.test(storeId) ? [Number(storeId)] : undefined
    const sharedToastMeatCtx = await loadToastMeatContext({
      storeNumericIds: parsedStoreNum,
      minDate: addDaysIso(resolvedStart, -3),
      maxDate: resolvedEnd,
      reconcileQbInvoices: true,
    })

    const weeklyTestMode = isPortionAlertsWeeklyTestMode()
    const result = await scanPortionControlAlerts({
      storeId,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      spanDays,
      meatKey,
      dryRun,
      sendEmails: weeklyTestMode ? false : sendEmails,
      forceResend,
      testTo: testCheck.email,
      toastMeatCtx: sharedToastMeatCtx,
      reconcileQbInvoices: false,
    })

    const overdueEnforcement = await enforceOverduePortionAlerts({
      dryRun,
      sendEmails: weeklyTestMode ? false : sendEmails,
      storeId,
      testTo: testCheck.email,
    })

    const sentCount = result.emailsDispatched.filter((e) => e.sent).length
    const skippedDuplicates = result.emailsDispatched.filter((e) => e.skippedDuplicate).length
    const overdueEmailsSentCount = overdueEnforcement.emailsDispatched.filter((e) => e.sent).length

    return NextResponse.json(
      {
        success: true,
        elapsedMs: Date.now() - startedAt,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        dryRun: result.dryRun,
        evaluatedSpans: result.evaluatedSpans,
        triggeredCount: result.triggeredAlerts.length,
        persistedCount: result.persistedCount,
        emailsSentCount: sentCount,
        skippedDuplicatesCount: skippedDuplicates,
        overdueDetectedCount: overdueEnforcement.overdueDetectedCount,
        overdueEscalatedCount: overdueEnforcement.overdueEscalatedCount,
        overdueEmailsSentCount,
        overdueEnforcement,
        triggeredAlerts: result.triggeredAlerts,
        emailsDispatched: result.emailsDispatched,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    console.error('[CRON /api/cron/check-portion-alerts] Error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return handleCheckPortionAlerts(req)
}

export async function POST(req: Request) {
  return handleCheckPortionAlerts(req)
}
