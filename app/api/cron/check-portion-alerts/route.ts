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
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  isPortionAlertsWeeklyTestMode,
  scanPortionControlAlerts,
  validateTestToEmail,
} from '@/lib/inventory/portion-control-alerts'
import { enforceOverduePortionAlerts } from '@/lib/inventory/portion-discipline-policy'
import { ACTIVE_PROTEIN_IDS } from '@/lib/inventory/meat-allocation'
import { computeToastVsFridgeForIngredient } from '@/lib/inventory/toast-meat-sold-resolver'
import { sendSobrantesExecutiveDigest } from '@/lib/inventory/sobrantes-executive-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
    const spanDays = Number(url.searchParams.get('span_days')) || 7
    const meatKey = url.searchParams.get('meat_key')?.trim() || null
    const rawTestTo = url.searchParams.get('test_to')?.trim() || null

    const testCheck = validateTestToEmail(rawTestTo)
    if (!testCheck.valid) {
      return NextResponse.json({ error: testCheck.error }, { status: 400 })
    }

    const weeklyTestMode = isPortionAlertsWeeklyTestMode()
    const result = await scanPortionControlAlerts({
      storeId,
      startDate,
      endDate,
      spanDays,
      meatKey,
      dryRun,
      sendEmails: weeklyTestMode ? false : sendEmails,
      forceResend,
      testTo: testCheck.email,
    })

    let executiveDigestSent = false
    if (weeklyTestMode && sendEmails && !dryRun) {
      const asadaMeter = await computeToastVsFridgeForIngredient({
        inventoryItemId: ACTIVE_PROTEIN_IDS.asada,
        proteinKey: 'asada',
        startDate: result.periodStart,
        endDate: result.periodEnd,
      })
      await sendSobrantesExecutiveDigest({
        ingredientName: 'Carne Asada',
        startDate: result.periodStart,
        endDate: result.periodEnd,
        meter: asadaMeter,
        rawTestTo: testCheck.email,
      })
      executiveDigestSent = true
    }

    const overdueEnforcement = await enforceOverduePortionAlerts({
      dryRun,
      sendEmails: weeklyTestMode ? false : sendEmails,
      storeId,
      testTo: testCheck.email,
    })

    const sentCount = result.emailsDispatched.filter((e) => e.sent).length + (executiveDigestSent ? 1 : 0)
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
