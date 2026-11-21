/**
 * @module api/phone/live-tool
 * @description Ejecuta en el servidor las herramientas `BLOCKING` invocadas en tiempo real por `gemini-3.8-live`
 * durante una sesión del Simulador Telefónico en `/admin/llamadas`.
 *
 * @businessRules
 * - Restringido estrictamente a llamadas con prefijo `SIM_LIVE_` y `source = 'simulator'`.
 * - Cualquier recado creado con `create_manager_callback` se guarda con `source = 'simulator'` en `phone_callback_requests`,
 *   manteniendo 100% aisladas las pantallas reales `/order-ready-board` de las tiendas.
 * - Valida RBAC y pertenencia de sucursal con `authorizePhoneModuleRequest`.
 *
 * @dataFlow
 * - `KorePhoneLiveSimulator` (`toolCall`) -> `POST /api/phone/live-tool` -> `executePhoneKoreLiveTool` -> `{ ok: true, response, callbackCreated, shouldEndCall }`.
 *
 * @notes
 * - Devuelve siempre un objeto JSON válido en `response` para alimentar `toolResponse.functionResponses` de Gemini Live.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { executePhoneKoreLiveTool, sanitizeKoreThirdLanguageInput } from '@/lib/phone-live-kore'
import type { PhoneLang } from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 20
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
      return NextResponse.json({ ok: false, error: 'callSid de simulador inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const storeId = Number(body.storeId)
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'storeId inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(storeId)) {
      return NextResponse.json({ ok: false, error: 'Sin acceso a esta sucursal.' }, { status: 403, headers: NO_STORE_HEADERS })
    }

    const lang: PhoneLang = body.lang === 'en' ? 'en' : 'es'
    const toolName = String(body.toolName || '').trim()
    const rawToolArgs = body.toolArgs
    const toolArgs =
      rawToolArgs && typeof rawToolArgs === 'object' && !Array.isArray(rawToolArgs)
        ? (rawToolArgs as Record<string, unknown>)
        : {}
    const recentUserTranscript = String(body.recentUserTranscript || '')
    const thirdLanguage = sanitizeKoreThirdLanguageInput(body.thirdLanguage)

    const result = await executePhoneKoreLiveTool({
      callSid,
      storeId,
      lang,
      source: 'simulator',
      toolName,
      toolArgs,
      recentUserTranscript,
      thirdLanguage
    })

    return NextResponse.json({ ok: true, ...result }, { status: 200, headers: NO_STORE_HEADERS })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err || 'Error interno al ejecutar herramienta.')
    console.error('[api/phone/live-tool] Error:', errMsg)
    return NextResponse.json(
      {
        ok: false,
        response: { ok: false, error: errMsg },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
