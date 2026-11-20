/**
 * @module api/phone/live-end
 * @description Consolida y cierra una sesión en vivo (`SIM_LIVE_...`) del Simulador Telefónico en `public.phone_calls`
 * con su transcripción completa, duración real, resumen e intención para la Bitácora y el Aprendizaje Continuo IA.
 *
 * @businessRules
 * - Restringido estrictamente a `callSid` de simulador (`SIM_LIVE_...` o `TEST_SMOKE_...`).
 * - Respeta RBAC por sucursal (`authorizePhoneModuleRequest`).
 * - Preserva `status = 'callback_requested'` cuando se registró un recado durante la llamada.
 *
 * @dataFlow
 * - `KorePhoneLiveSimulator` (colgar / auto-cierre / desmontaje con `keepalive`) -> `POST /api/phone/live-end` -> `finalizePhoneKoreLiveCall`
 *   -> `after(() => analyzeUnprocessedPhoneCalls(...))` en segundo plano.
 *
 * @notes
 * - Compatible con `fetch(..., { keepalive: true })` al cerrar pestaña o cambiar de módulo.
 * - Al igual que Kore Drive-Thru (`POST /api/drive-thru/kore/sessions`), ejecuta aprendizaje continuo post-llamada en `after()`.
 */

import { after, NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { finalizePhoneKoreLiveCall } from '@/lib/phone-live-kore'
import { analyzeUnprocessedPhoneCalls } from '@/lib/phone-agent-learning'
import type { PhoneLang, TranscriptEntry } from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizePhoneModuleRequest(request, { permission: 'simulate' })
    if (!auth.authorized || !auth.user) {
      return (
        auth.response ||
        NextResponse.json({ ok: false, error: auth.error || 'No autenticado.' }, { status: auth.status || 401, headers: NO_STORE_HEADERS })
      )
    }

    const rawBody: unknown = await request.json().catch(() => null)
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ ok: false, error: 'Cuerpo JSON inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }
    const body = rawBody as Record<string, unknown>

    const callSid = String(body.callSid || '').trim()
    if (!/^SIM_LIVE_/i.test(callSid) && !/^TEST_SMOKE_/i.test(callSid)) {
      return NextResponse.json({ ok: false, error: 'callSid inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const storeId = Number(body.storeId)
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'storeId inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(storeId)) {
      return NextResponse.json({ ok: false, error: 'Sin acceso a esta sucursal.' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    const lang: PhoneLang = body.lang === 'en' ? 'en' : 'es'
    const durationSeconds = Number(body.durationSeconds || 0)
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as TranscriptEntry[]

    const res = await finalizePhoneKoreLiveCall({
      callSid,
      storeId,
      source: 'simulator',
      lang,
      durationSeconds,
      transcript
    })

    const isSmokeCall =
      /^TEST_SMOKE_/i.test(callSid) ||
      transcript.some((t) => /\bTEST_SMOKE_\w*/i.test(String(t?.text || '')))
    const hasUserTurns = transcript.some((t) => t?.role === 'user' && String(t?.text || '').trim().length > 0)
    if (!isSmokeCall && hasUserTurns) {
      after(async () => {
        try {
          await analyzeUnprocessedPhoneCalls({
            storeId,
            limit: 4,
            prewarmAudio: false,
            triggerSource: 'simulator_call'
          })
        } catch (err) {
          console.warn('[api/phone/live-end after-learn]', err)
        }
      })
    }

    return NextResponse.json(res, { status: 200, headers: NO_STORE_HEADERS })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err || 'No se pudo cerrar la sesión Live.')
    console.error('[api/phone/live-end] Error:', errMsg)
    return NextResponse.json(
      { ok: false, error: errMsg },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
