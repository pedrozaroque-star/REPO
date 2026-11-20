/**
 * @module api/cron/learn-kore-drive-thru
 * @description Cron diario de Aprendizaje Continuo para "Kore Drive-Thru" (`25 13 * * *` UTC = 5:25 AM PST / 6:25 AM PDT).
 * Analiza todas las simulaciones pendientes en `dt_kore_sim_sessions` (`analyzed_at IS NULL`) y las preguntas sin
 * respuesta recientes en `phone_calls` (`unanswered_question`), generando reglas operativas e ítems de revisión en
 * `dt_kore_learning_items` e invalidando la caché en memoria para las siguientes sesiones de voz.
 *
 * @businessRules
 * - **Fail-closed auth**: exige `Authorization: Bearer <CRON_SECRET>` válido (comparación en tiempo constante) O una
 *   sesión administrativa autenticada con permiso global (`admin` / `supervisor` vía `authorizePhoneModuleRequest`).
 *   Si ninguna credencial es válida, rechaza con `401`/`403` incluso en entornos sin `CRON_SECRET`.
 * - **Idempotencia**: seguro de ejecutar múltiples veces al día; nunca borra sesiones reales ni duplica hallazgos.
 *
 * @dataFlow
 * - Vercel Cron (`25 13 * * *`) o Admin -> `GET / POST /api/cron/learn-kore-drive-thru`
 *   -> `analyzeUnprocessedKoreSessions({ includePhoneCalls: true, triggerSource: 'cron_daily' })` -> JSON resumen.
 *
 * @notes
 * - Configurado en `vercel.json` preservando intactos todos los crons críticos (`/api/cron/sync-sales`, `/api/cron/sync-labor`, etc.).
 */

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCronSecret } from '@/lib/auth-server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { analyzeUnprocessedKoreSessions, getKoreLearningDashboard } from '@/lib/drive-thru-kore-learning'
import { prewarmAllKoreFastClips } from '@/lib/drive-thru-kore-fast-clips'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function hasValidCronBearer(request: NextRequest): boolean {
  const secret = getCronSecret()
  if (!secret) return false
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return false
  const provided = authHeader.slice(7).trim()
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handleRun(request: NextRequest) {
  try {
    if (!hasValidCronBearer(request)) {
      const auth = await authorizePhoneModuleRequest(request, { permission: 'manage_global' })
      if (!auth.authorized || !auth.user) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401, headers: NO_STORE_HEADERS })
      }
    }

    const storeParam = request.nextUrl.searchParams.get('storeId')
    const storeId = storeParam && /^\d+$/.test(storeParam) ? Number(storeParam) : null

    const [summary, fastClipsPrewarm] = await Promise.all([
      analyzeUnprocessedKoreSessions({
        storeId,
        limit: 40,
        includePhoneCalls: true,
        triggerSource: 'cron_daily'
      }),
      prewarmAllKoreFastClips({
        storeIds: storeId ? [storeId] : undefined,
        concurrency: 4,
        maxClipsToSynthesize: 30
      }).catch((e: any) => ({ error: String(e?.message || e).slice(0, 180) }))
    ])
    const dashboard = await getKoreLearningDashboard(storeId)

    return NextResponse.json(
      {
        ok: true,
        ranAt: new Date().toISOString(),
        summary,
        fastClipsPrewarm,
        stats: dashboard.stats
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: any) {
    console.error('[CRON learn-kore-drive-thru] Error:', String(err?.message || err).slice(0, 300))
    return NextResponse.json(
      { ok: false, error: 'Error ejecutando el aprendizaje continuo de Kore Drive-Thru.' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function GET(request: NextRequest) {
  return handleRun(request)
}

export async function POST(request: NextRequest) {
  return handleRun(request)
}
