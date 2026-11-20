/**
 * @module api/cron/learn-phone-agent
 * @description Cron diario de Aprendizaje Continuo y Pre-Calentamiento de Audio Neuronal (`35 13 * * *` UTC = 5:35 AM PST / 6:35 AM PDT)
 * para la Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan.
 *
 * Escanea llamadas pendientes en `public.phone_calls` (`analyzed_at IS NULL`, priorizando llamadas reales `source = 'twilio'`),
 * eleva dudas reales de negocio a la bandeja de Carlos (`needs_owner_input`), pre-calienta hasta 8 respuestas frecuentes
 * en Supabase Storage (`phone_v6/Kore/*.wav`, `~80 ms` en llamadas subsecuentes), agrupa telemetría de latencia alta
 * (`> 3500 ms`) e invalida la caché SWR en memoria.
 *
 * @businessRules
 * - **Fail-closed auth**: exige `Authorization: Bearer <CRON_SECRET>` válido (comparación en tiempo constante `timingSafeEqual`)
 *   O una sesión administrativa autenticada con permiso global (`manage_global` vía `authorizePhoneModuleRequest`).
 *   Rechaza con `401`/`403` si ninguna credencial es válida, incluso si `CRON_SECRET` no estuviera definido.
 * - **Idempotencia e inmutabilidad**: jamás altera `transcript` en `phone_calls` ni duplica filas en `phone_learning_items`.
 *
 * @dataFlow
 * - Vercel Cron (`35 13 * * *`) o Admin -> `GET / POST /api/cron/learn-phone-agent`
 *   -> `analyzeUnprocessedPhoneCalls({ limit: 80, prewarmAudio: true, triggerSource: 'cron_daily' })`
 *   + `getPhoneLearningDashboard()` -> JSON `{ ok, ranAt, summary, stats }`.
 *
 * @notes
 * - `preferredRegion = 'sfo1'` y `maxDuration = 60` para baja latencia con Supabase `us-west-1`.
 * - Registrado en `vercel.json` preservando intactos los 37 crons previos (`/api/cron/sync-sales`, `/api/cron/sync-labor`, etc.).
 */

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCronSecret } from '@/lib/auth-server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import {
  analyzeUnprocessedPhoneCalls,
  getPhoneLearningDashboard
} from '@/lib/phone-agent-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const preferredRegion = 'sfo1'

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
        return (
          auth.response ||
          NextResponse.json(
            { error: auth.error || 'No autorizado' },
            { status: auth.status || 401, headers: NO_STORE_HEADERS }
          )
        )
      }
    }

    const storeParam = request.nextUrl.searchParams.get('storeId')
    const storeId = storeParam && /^\d+$/.test(storeParam) && Number(storeParam) > 0 ? Number(storeParam) : null

    const summary = await analyzeUnprocessedPhoneCalls({
      storeId,
      limit: 80,
      prewarmAudio: true,
      triggerSource: 'cron_daily'
    })
    const dashboard = await getPhoneLearningDashboard(storeId)

    return NextResponse.json(
      {
        ok: true,
        ranAt: new Date().toISOString(),
        summary,
        stats: dashboard.stats
      },
      { headers: NO_STORE_HEADERS }
    )
  } catch (err: any) {
    console.error('[CRON learn-phone-agent] Error:', String(err?.message || err).slice(0, 300))
    return NextResponse.json(
      { ok: false, error: 'Error ejecutando el aprendizaje continuo de la Contestadora IA.' },
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
