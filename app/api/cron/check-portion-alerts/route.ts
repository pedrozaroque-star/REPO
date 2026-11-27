/**
 * @module app/api/cron/check-portion-alerts/route
 * @description Cron diario automatizado (`53 17 * * *` UTC — 09:53 AM PST / 10:53 AM PDT, justo después de
 *   `/api/cron/sync-pmix` y `/api/cron/sync-food-cost`) que ejecuta el Balance de Masas Telescópico de 7 días
 *   en las 15 sucursales para Carne Asada (prioridad #1) y las otras 7 proteínas activas, persiste alertas
 *   idempotentes en `public.portion_control_alerts` y marca vencimientos SLA (>24h) en base de datos para
 *   el panel web `/admin/food-cost/meats`.
 *
 * @businessRules
 *   - **Política Anti-Saturación de Correos (2026-11-27)**: Los correos diarios automáticos por proteína
 *     (`#3` Alerta diaria de porciones 7d y `#7` SLA vencido >24h) permanecen **desactivados permanentemente**
 *     en este cron (en producción habrían enviado ~94 correos en 48 horas por las 8 carnes). Este cron opera
 *     en modo **solo base de datos / panel web**. El único correo semanal de sobrantes vive en
 *     `/api/cron/weekly-sobrantes-digest` (Lunes 10:00 AM LA, ES + EN).
 *   - **Idempotencia Estricta**: Gracias a `UNIQUE(store_id, period_start, period_end, meat_key)`, jamás
 *     duplica filas en `public.portion_control_alerts`.
 *   - **Modo Seguro de Pruebas**: Soporta `?dry_run=true` (cero escrituras y cero envíos) y solo permite envío
 *     manual de prueba si un admin envía explícitamente `?send_emails=true&manual_email_override=true&test_to=...`
 *     (restringido estrictamente a `@tacosgavilan.com`).
 *
 * @dataFlow
 *   Vercel Cron (`53 17 * * *`) → `GET/POST /api/cron/check-portion-alerts`
 *   → `scanPortionControlAlerts({ sendEmails: false })` + `enforceOverduePortionAlerts({ sendEmails: false })`
 *   → `public.portion_control_alerts` (panel web `/admin/food-cost/meats`).
 *
 * @notes
 *   - Protegido con `verifyStaffAuth(..., { allowedRoles: ['admin', 'supervisor'], allowCron: true })`.
 *   - [2026-11-27] El correo ejecutivo "Resumen Semanal de Sobrantes" (Lunes–Domingo, desglose Supervisor/Sucursal/Día,
 *     ES + EN) se movió a `/api/cron/weekly-sobrantes-digest` (lunes 10:00 AM hora California).
 *   - [2026-11-27] Bloqueo permanente anti-saturación: las ejecuciones automáticas de este cron NUNCA despachan
 *     correos `#3` ni `#7`, incluso si `PORTION_ALERTS_LIVE_RECIPIENTS=true` llegara a activarse.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
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
    const sendEmailsParam = url.searchParams.get('send_emails') === 'true'
    const manualEmailOverride = url.searchParams.get('manual_email_override') === 'true'
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

    // Candado anti-saturación permanente: el cron diario NUNCA dispara correos automáticos #3/#7.
    // Solo se permite un envío de prueba explícito si se pasa `send_emails=true&manual_email_override=true&test_to=...`.
    const allowSafePreviewEmail = Boolean(!dryRun && sendEmailsParam && manualEmailOverride && rawTestTo && testCheck.email)

    // Pre-cargar UNA SOLA VEZ `loadToastMeatContext` (fragmentado <= 15 filas/lote) para compartirlo
    // entre `scanPortionControlAlerts` y el resto del flujo (corta RAM/IO a la mitad).
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

    const result = await scanPortionControlAlerts({
      storeId,
      startDate: resolvedStart,
      endDate: resolvedEnd,
      spanDays,
      meatKey,
      dryRun,
      sendEmails: allowSafePreviewEmail,
      forceResend,
      testTo: allowSafePreviewEmail ? testCheck.email : null,
      toastMeatCtx: sharedToastMeatCtx,
      reconcileQbInvoices: false,
    })

    const overdueEnforcement = await enforceOverduePortionAlerts({
      dryRun,
      sendEmails: allowSafePreviewEmail,
      storeId,
      testTo: allowSafePreviewEmail ? testCheck.email : null,
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
