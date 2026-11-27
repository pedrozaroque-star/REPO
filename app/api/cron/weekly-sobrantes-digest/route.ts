/**
 * @module app/api/cron/weekly-sobrantes-digest/route
 * @description Cron semanal automatizado (todos los **lunes a las 10:00 AM** hora de Los Ángeles,
 *   California — `3 18 * * 1` UTC en PST y `23 17 * * 1` UTC en PDT, con filtro estricto `laDow === 1`
 *   y `laHour === 10`) que audita la semana completa inmediata anterior (**Lunes a Domingo**) en las
 *   15 sucursales de Tacos Gavilan y envía el **Resumen Semanal de Sobrantes** desglosado por
 *   **Supervisor → Sucursal → Día** desde `noreply@tacosgavilan.com` (`Sistema de Monitoreo`).
 *
 * @businessRules
 *   - **Ventana semanal fija (Lunes a Domingo)**: calcula automáticamente la semana cerrada inmediata
 *     anterior (`getPreviousCompletedWeekMonSunLA`), p. ej. el lunes `30 Nov` audita `Lun 23 Nov al Dom 29 Nov`.
 *   - **Horario exacto PST/PDT**: las dos entradas de `vercel.json` (`23 17 * * 1` y `3 18 * * 1`) se
 *     filtran por `laDow === 1 && laHour === 10` en `America/Los_Angeles` para disparar una sola vez cada
 *     lunes a las 10:00 AM todo el año, siempre después de que `sync-pmix` terminó de guardar el domingo.
 *   - **Idempotencia estricta**: persiste la última semana despachada en `public.integrations`
 *     (`service_name = 'sobrantes_weekly_digest_state'`) evitando envíos duplicados salvo `?force_resend=true`.
 *   - **Protección de servidores (`server-db-protection.md`)**: `force-dynamic`, `maxDuration = 300`,
 *     rango máximo `<= 35` días, `loadToastMeatContext` fragmentado (`<= 15` filas/lote en `pmix_daily_cache`).
 *   - **Seguridad Fail-Closed**: protegido con `verifyStaffAuth(..., { allowedRoles: ['admin', 'supervisor'], allowCron: true })`
 *     y `validateTestToEmail` (restringido a `@tacosgavilan.com`).
 *
 * @dataFlow
 *   Vercel Cron (`23 17 * * 1` / `3 18 * * 1`) → `GET/POST /api/cron/weekly-sobrantes-digest`
 *   → `loadToastMeatContext()` + `computeToastVsFridgeForIngredient()`
 *   → `sendSobrantesExecutiveDigest()` (`noreply@tacosgavilan.com`)
 *   → `public.integrations` (`sobrantes_weekly_digest_state`).
 *
 * @notes
 *   - [2026-11-27] Creado para separar el Resumen Semanal de Sobrantes (lunes 10:00 AM, Lun–Dom,
 *     desglose Supervisor/Sucursal/Día) del monitoreo diario de `/api/cron/check-portion-alerts`.
 */

import { NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { ACTIVE_PROTEIN_IDS, type ActiveProteinKey } from '@/lib/inventory/meat-allocation'
import {
  addDaysIso,
  diffCalendarDays,
  getLANowParts,
  isValidIsoDate,
} from '@/lib/inventory/food-cost-sales-resolver'
import {
  computeToastVsFridgeForIngredient,
  loadToastMeatContext,
} from '@/lib/inventory/toast-meat-sold-resolver'
import { validateTestToEmail } from '@/lib/inventory/portion-control-alerts'
import {
  buildSobrantesExecutiveEmailHtml,
  getPreviousCompletedWeekMonSunLA,
  sendSobrantesExecutiveDigest,
} from '@/lib/inventory/sobrantes-executive-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DIGEST_STATE_SERVICE_NAME = 'sobrantes_weekly_digest_state'
const MAX_DIGEST_SPAN_DAYS = 35

const PROTEIN_DISPLAY_NAMES: Record<ActiveProteinKey, string> = {
  asada: 'Carne Asada',
  pastor: 'Carne al Pastor',
  pollo: 'Pollo',
  cabeza: 'Cabeza',
  lengua: 'Lengua',
  carnitas: 'Carnitas',
  buche: 'Buche',
  chorizo: 'Chorizo',
}

interface DigestStatePayload {
  lastSentKey?: string
  lastSentAt?: string
  lastMessageId?: string
  lastRecipient?: string
}

async function readDigestState(): Promise<DigestStatePayload | null> {
  try {
    const supabase = await getSupabaseAdminClient()
    const { data } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('service_name', DIGEST_STATE_SERVICE_NAME)
      .maybeSingle()
    if (!data?.access_token) return null
    return JSON.parse(String(data.access_token)) as DigestStatePayload
  } catch {
    return null
  }
}

async function persistDigestState(payload: DigestStatePayload): Promise<void> {
  const supabase = await getSupabaseAdminClient()
  const nowIso = new Date().toISOString()
  const serialized = JSON.stringify(payload)
  const { data: existing } = await supabase
    .from('integrations')
    .select('id')
    .eq('service_name', DIGEST_STATE_SERVICE_NAME)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('integrations')
      .update({
        realm_id: payload.lastSentKey || null,
        access_token: serialized,
        refresh_token: serialized,
        token_type: 'JSON',
        updated_at: nowIso,
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('integrations').insert({
      service_name: DIGEST_STATE_SERVICE_NAME,
      realm_id: payload.lastSentKey || null,
      access_token: serialized,
      refresh_token: serialized,
      token_type: 'JSON',
      expires_at: '2036-12-31T00:00:00.000Z',
      updated_at: nowIso,
    })
  }
}

async function handleWeeklySobrantesDigest(req: Request) {
  const auth = verifyStaffAuth(req, { allowedRoles: ['admin', 'supervisor'], allowCron: true })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
  }

  const startedAt = Date.now()
  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dry_run') === 'true'
    const forceResend = url.searchParams.get('force_resend') === 'true' || url.searchParams.get('force') === 'true'
    const rawStart = url.searchParams.get('start_date')?.trim() || null
    const rawEnd = url.searchParams.get('end_date')?.trim() || null
    const rawMeat = (url.searchParams.get('meat_key')?.trim().toLowerCase() || 'asada') as ActiveProteinKey
    const rawTestTo = url.searchParams.get('test_to')?.trim() || null

    if (!(rawMeat in ACTIVE_PROTEIN_IDS)) {
      return NextResponse.json(
        { success: false, error: `Proteína inválida: ${rawMeat}` },
        { status: 400 }
      )
    }

    const testCheck = validateTestToEmail(rawTestTo)
    if (!testCheck.valid) {
      return NextResponse.json({ success: false, error: testCheck.error }, { status: 400 })
    }

    const isManualOverride = Boolean(dryRun || forceResend || rawStart || rawEnd || rawTestTo)
    const nowLA = getLANowParts(new Date())
    const laDow = new Date(`${nowLA.calendarDate}T12:00:00Z`).getUTCDay() // 1 = Lunes

    // Guard DST PST/PDT: en ejecuciones automáticas de Vercel Cron solo despacha el lunes entre 10:00–10:59 AM LA
    if (!isManualOverride && (laDow !== 1 || nowLA.hour !== 10)) {
      return NextResponse.json(
        {
          success: true,
          skipped: true,
          reason: `Fuera de ventana automática Lunes 10:00 AM LA (actual: ${nowLA.calendarDate} dow=${laDow} hour=${nowLA.hour}).`,
          elapsedMs: Date.now() - startedAt,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const defaultWeek = getPreviousCompletedWeekMonSunLA()
    const startDate = rawStart && isValidIsoDate(rawStart) ? rawStart : defaultWeek.startDate
    const endDate = rawEnd && isValidIsoDate(rawEnd) ? rawEnd : defaultWeek.endDate

    if (startDate > endDate) {
      return NextResponse.json(
        { success: false, error: `Rango inválido: start_date (${startDate}) > end_date (${endDate})` },
        { status: 400 }
      )
    }
    const spanDays = diffCalendarDays(startDate, endDate) + 1
    if (spanDays > MAX_DIGEST_SPAN_DAYS) {
      return NextResponse.json(
        { success: false, error: `Rango de ${spanDays} días excede el límite seguro (${MAX_DIGEST_SPAN_DAYS} días).` },
        { status: 400 }
      )
    }

    const idempotencyKey = `${startDate}..${endDate}::${rawMeat}`
    if (!dryRun && !forceResend && !rawTestTo) {
      const prevState = await readDigestState()
      if (prevState?.lastSentKey === idempotencyKey) {
        return NextResponse.json(
          {
            success: true,
            skippedDuplicate: true,
            idempotencyKey,
            lastSentAt: prevState.lastSentAt || null,
            lastMessageId: prevState.lastMessageId || null,
            elapsedMs: Date.now() - startedAt,
          },
          { headers: { 'Cache-Control': 'no-store' } }
        )
      }
    }

    const ingredientName = PROTEIN_DISPLAY_NAMES[rawMeat]
    const ctx = await loadToastMeatContext({
      minDate: addDaysIso(startDate, -4),
      maxDate: endDate,
      reconcileQbInvoices: true,
    })

    const meter = await computeToastVsFridgeForIngredient({
      inventoryItemId: ACTIVE_PROTEIN_IDS[rawMeat],
      proteinKey: rawMeat,
      startDate,
      endDate,
      ctx,
    })

    if (dryRun) {
      const preview = buildSobrantesExecutiveEmailHtml({
        ingredientName,
        startDate,
        endDate,
        meter,
        recipientEmail: testCheck.email || 'carlos@tacosgavilan.com',
      })
      return NextResponse.json(
        {
          success: true,
          dryRun: true,
          startDate,
          endDate,
          meatKey: rawMeat,
          subject: preview.subject,
          shortageCount: preview.shortageCount,
          totalMissingBags: preview.totalMissingBags,
          totalShortageUsd: preview.totalShortageUsd,
          htmlBytes: preview.htmlBytes,
          storesEvaluated: meter.storesSummaries.length,
          elapsedMs: Date.now() - startedAt,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const sent = await sendSobrantesExecutiveDigest({
      ingredientName,
      startDate,
      endDate,
      meter,
      rawTestTo: testCheck.email,
    })

    if (!rawTestTo) {
      await persistDigestState({
        lastSentKey: idempotencyKey,
        lastSentAt: new Date().toISOString(),
        lastMessageId: sent.mailRes.messageId,
        lastRecipient: sent.to,
      }).catch((err) => {
        console.warn('[WeeklySobrantesDigest] No se pudo guardar estado de idempotencia:', err)
      })
    }

    return NextResponse.json(
      {
        success: true,
        sent: true,
        startDate,
        endDate,
        meatKey: rawMeat,
        to: sent.to,
        fromEmail: sent.mailRes.fromEmail,
        providerUsed: sent.mailRes.providerUsed,
        messageId: sent.mailRes.messageId,
        subject: sent.subject,
        shortageCount: sent.shortageCount,
        totalMissingBags: sent.totalMissingBags,
        totalShortageUsd: sent.totalShortageUsd,
        htmlBytes: sent.htmlBytes,
        elapsedMs: Date.now() - startedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    console.error('[CRON /api/cron/weekly-sobrantes-digest] Error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return handleWeeklySobrantesDigest(req)
}

export async function POST(req: Request) {
  return handleWeeklySobrantesDigest(req)
}
