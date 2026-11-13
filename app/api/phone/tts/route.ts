/**
 * @module api/phone/tts
 * @description Endpoint de generación y entrega de audio neuronal WAV exclusivamente femenino (`Kore` / `Aoede` / `Zephyr`)
 * para la Contestadora IA de Tacos Gavilan (usado tanto por Twilio `<Play>` como por el Simulador en Navegador).
 *
 * @businessRules
 * - Utiliza `getPhoneAgentSpeech()` de `lib/order-ready-tts.ts` (`phone_kore38_v6`, bloqueo estricto femenino `resolvePhoneFemaleVoice`,
 *   compuerta acústica `F0 >= 155 Hz` y normalizador fonético `lib/phone-speech-format.ts`) con caché permanente en Supabase Storage (`order-ready-tts/phone_v6/{voice}/{lang}/{hash}.wav`).
 * - Las respuestas repetidas (saludos de las 15 sucursales, avisos festivos, despedidas) se sirven desde caché sin regenerarse.
 *
 * @dataFlow
 * - Twilio `<Play>` o Simulador Web -> GET `/api/phone/tts?lang&voice&text&sig` -> `getPhoneAgentSpeech()` -> `audio/wav`.
 *
 * @notes
 * - Soporta textos de hasta 1400 caracteres (con recorte limpio interno tras validar HMAC si supera el límite) y `?rate=8000` para PSTN Twilio.
 * - SEGURIDAD: GET exige firma criptográfica HMAC `sig` generada por `buildPhoneTtsUrl` (validada con el parámetro `voice` original); POST exige sesión autorizada RBAC.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  downsampleWav24kTo8k,
  getPhoneAgentSpeech,
  MAX_PHONE_TTS_CHARS,
  normalizePhoneTtsInput,
  resolvePhoneFemaleVoice,
  VoiceId
} from '@/lib/order-ready-tts'
import { verifyPhoneTtsSignature } from '@/lib/phone-agent'
import { authorizePhoneModuleRequest } from '@/lib/phone-agent-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_TTS_ROUTE_CHARS = Math.max(1400, MAX_PHONE_TTS_CHARS)

async function renderWav(text: string, lang: 'en' | 'es', voice: VoiceId, rate: 8000 | 24000 = 24000, signal?: AbortSignal) {
  const safeText = text.length > MAX_TTS_ROUTE_CHARS ? normalizePhoneTtsInput(text, lang, MAX_TTS_ROUTE_CHARS) : text
  const rawWav = await getPhoneAgentSpeech(safeText, lang, voice, false, { signal })
  const wav = rate === 8000 ? downsampleWav24kTo8k(rawWav) : rawWav
  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wav.length),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400'
    }
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const text = (searchParams.get('text') || '').trim()
  const rawLang = searchParams.get('lang') === 'en' ? 'en' : 'es'
  const lang = rawLang as 'en' | 'es'
  const rawVoice = searchParams.get('voice') || 'Kore'
  const voice: VoiceId = resolvePhoneFemaleVoice(rawVoice)
  const rate: 8000 | 24000 = searchParams.get('rate') === '8000' ? 8000 : 24000

  if (!text) {
    return NextResponse.json({ error: 'Parámetro text requerido' }, { status: 400 })
  }

  const sigOk = verifyPhoneTtsSignature(text, searchParams.get('lang') || '', rawVoice, searchParams.get('sig'))
  if (!sigOk) {
    return NextResponse.json({ error: 'Firma de audio inválida' }, { status: 403 })
  }

  try {
    return await renderWav(text, lang, voice, rate, request.signal)
  } catch (err: any) {
    console.error('[api/phone/tts] Error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al generar audio telefónico' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizePhoneModuleRequest(request, { permission: 'read_dashboard' })
  if (!auth.authorized) {
    return auth.response || NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status || 401 })
  }

  try {
    const body = await request.json()
    const text = String(body?.text || '').trim()
    const lang = (body?.lang === 'en' ? 'en' : 'es') as 'en' | 'es'
    const rawVoice = body?.voice || 'Kore'
    const voice: VoiceId = resolvePhoneFemaleVoice(rawVoice)
    const rate: 8000 | 24000 = body?.rate === 8000 || body?.rate === '8000' ? 8000 : 24000

    if (!text) {
      return NextResponse.json({ error: 'Parámetro text requerido' }, { status: 400 })
    }

    return await renderWav(text, lang, voice, rate, request.signal)
  } catch (err: any) {
    console.error('[api/phone/tts] POST Error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al generar audio telefónico' }, { status: 502 })
  }
}
