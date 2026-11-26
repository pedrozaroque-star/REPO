/**
 * @module api/phone/live-session
 * @description Inicia una sesión en vivo (`gemini-3.8-live` con audio bidireccional nativo) para el Simulador
 * Telefónico de `/admin/llamadas` en cualquiera de las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Control de acceso RBAC vía `authorizePhoneModuleRequest(request, { permission: 'simulate' })`:
 *   `admin`/`supervisor` pueden simular las 15 tiendas; `manager`/`general_manager`/`asistente` únicamente sus tiendas permitidas.
 * - Devuelve un token efímero bloqueado (`v1beta/auth_tokens` con `bidiGenerateContentSetup`) sin exponer jamás API keys al navegador.
 * - Registra la llamada en `public.phone_calls` con `source = 'simulator'` y prefijo `SIM_LIVE_`.
 * - Anti-abuso: máximo 10 inicios de sesión por minuto por usuario.
 *
 * @dataFlow
 * - `POST /api/phone/live-session` `{ storeId, lang }` -> `createPhoneKoreLiveSimulatorSession` ->
 *   `{ ok: true, callSid, token, wsUrl, setup, greetingText, greetingPcmBase64, greetingSampleRate, storeDisplayName }`.
 *
 * @notes
 * - El cliente envía `{ setup }` como primer frame en `ws.onopen` (exigido por el protocolo Gemini Live) y siembra el
 *   saludo con `clientContent` (`turnComplete: false`) mientras reproduce `greetingPcmBase64` en `< 30 ms`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'
import { getInternalStoreNameById } from '@/lib/store-display'
import { KoreTokenError } from '@/lib/drive-thru-kore'
import { createPhoneKoreLiveSimulatorSession } from '@/lib/phone-live-kore'
import type { PhoneLang } from '@/lib/phone-agent'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }
const RATE_WINDOW_MS = 60_000
const RATE_MAX_PER_WINDOW = 10
const startsByUser = new Map<string, number[]>()

function allowRate(userId: string, now = Date.now()): boolean {
  const recent = (startsByUser.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX_PER_WINDOW) {
    startsByUser.set(userId, recent)
    return false
  }
  recent.push(now)
  startsByUser.set(userId, recent)
  return true
}

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

    const rawStoreId = body.storeId ?? body.store_id
    const storeId =
      typeof rawStoreId === 'number'
        ? rawStoreId
        : /^\d+$/.test(String(rawStoreId ?? '').trim())
          ? Number(rawStoreId)
          : NaN

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return NextResponse.json({ ok: false, error: 'storeId inválido.' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    if (!auth.user.isGlobalAdmin && !auth.user.allowedStoreIds.includes(storeId)) {
      return NextResponse.json(
        { ok: false, error: `Acceso denegado: tu cuenta solo tiene autorización sobre la sucursal ${getInternalStoreNameById(auth.user.assignedStoreId) || 'asignada'}.` },
        { status: 403, headers: NO_STORE_HEADERS }
      )
    }

    if (!allowRate(auth.user.id)) {
      return NextResponse.json(
        { ok: false, error: 'Demasiadas sesiones seguidas. Espera unos segundos e intenta de nuevo.' },
        { status: 429, headers: NO_STORE_HEADERS }
      )
    }

    const lang: PhoneLang = body.lang === 'en' ? 'en' : 'es'
    const session = await createPhoneKoreLiveSimulatorSession({ storeId, lang })

    return NextResponse.json({ ok: true, ...session }, { status: 200, headers: NO_STORE_HEADERS })
  } catch (err: unknown) {
    const status = err instanceof KoreTokenError ? err.status : 500
    const errMsg = err instanceof Error ? err.message : String(err || 'No se pudo iniciar la sesión Kore 3.8 Live.')
    console.error('[api/phone/live-session] Error:', errMsg)
    return NextResponse.json(
      { ok: false, error: errMsg },
      { status, headers: NO_STORE_HEADERS }
    )
  }
}
