/**
 * @module app/api/cron/check-missing-meat-modifiers/route
 * @description Cron diario automatizado (`20 18 * * *` UTC — 10:20 AM PST / 11:20 AM PDT, justo después de
 *   `/api/cron/sync-pmix` y `/api/cron/sync-labor`) que audita todas las órdenes cerradas del día laboral anterior
 *   (`06:00 AM` a `05:59 AM` LA) donde se cobró `Side Order Carne` o `2 / 6 / 12 lb Meat` SIN especificar el tipo
 *   de carne en Toast POS, y notifica obligatoriamente al General Manager con copia al Supervisor, al Asistente del
 *   turno exacto (`AM` o `PM`) y a la Cajera involucrada.
 *
 * @businessRules
 *   - En ejecución automática de Vercel Cron corre por defecto en `mode=live_escalera` (con idempotencia estricta en
 *     `public.missing_meat_modifier_alerts` para no duplicar correos).
 *   - Soporta `?mode=preview_carlos` para enviar vista previa consolidada únicamente a `carlos@tacosgavilan.com`,
 *     `?dry_run=true`, `?date=YYYY-MM-DD`, `?store_id=...` y `?force_resend=true`.
 *
 * @dataFlow
 *   Vercel Cron (`20 18 * * *`) o invocación manual admin → `scanAndNotifyMissingMeatModifiers()` → `sendSystemEmail()`.
 *
 * @notes
 *   - Protegido con `verifyStaffAuth(..., { allowedRoles: ['admin', 'supervisor'], allowCron: true })`.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import {
  scanAndNotifyMissingMeatModifiers,
  type MissingMeatDeliveryMode,
} from '@/lib/inventory/missing-meat-modifier-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function handleMissingMeatCron(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  const startedAt = Date.now()
  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dry_run') === 'true'
    const forceResend = url.searchParams.get('force_resend') === 'true'
    const businessDate = url.searchParams.get('date')?.trim() || null
    const storeId = url.searchParams.get('store_id')?.trim() || null
    const rawMode = url.searchParams.get('mode')?.trim()
    const deliveryMode: MissingMeatDeliveryMode =
      rawMode === 'preview_carlos'
        ? 'preview_carlos'
        : rawMode === 'sample_single_to_carlos'
          ? 'sample_single_to_carlos'
          : 'live_escalera'
    const previewToParam = url.searchParams.get('preview_to')?.trim()
    const previewCcParam = url.searchParams.get('preview_cc')?.trim()
    const previewTo = previewToParam
      ? previewToParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined
    const previewCc = previewCcParam
      ? previewCcParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined

    const result = await scanAndNotifyMissingMeatModifiers({
      businessDate,
      storeId,
      dryRun,
      deliveryMode,
      forceResend,
      previewTo,
      previewCc,
    })

    return NextResponse.json(
      {
        success: true,
        elapsedMs: Date.now() - startedAt,
        ...result,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    console.error('[CRON /api/cron/check-missing-meat-modifiers] Error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return handleMissingMeatCron(req)
}

export async function POST(req: Request) {
  return handleMissingMeatCron(req)
}
