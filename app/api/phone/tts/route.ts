/**
 * @module api/phone/tts
 * @description Endpoint de generación y entrega de audio neuronal WAV (`Kore` / `Aoede` / `Zephyr` / `Puck` / `Orus`)
 * para la Contestadora IA de Tacos Gavilan (usado tanto por Twilio `<Play>` como por el Simulador en Navegador).
 *
 * @businessRules
 * - Utiliza `getPhoneAgentSpeech()` de `lib/order-ready-tts.ts` con caché permanente en Supabase Storage
 *   (`order-ready-tts/phone/{voice}/{lang}/{hash}.wav`).
 * - Las respuestas frecuentes (saludos de las 15 sucursales, horarios, precios de Fiesta Platters) se sirven en 0ms desde caché.
 *
 * @dataFlow
 * - Twilio `<Play>` o Simulador Web -> GET/POST `/api/phone/tts` -> `getPhoneAgentSpeech()` -> `audio/wav`.
 *
 * @notes
 * - Soporta textos de hasta 600 caracteres con tono cálido de recepcionista telefónica.
 */

import { NextResponse } from 'next/server'
import { getPhoneAgentSpeech, isValidVoice, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const text = (searchParams.get('text') || '').trim()
  const lang = (searchParams.get('lang') === 'en' ? 'en' : 'es') as 'en' | 'es'
  const rawVoice = searchParams.get('voice') || 'Kore'
  const voice: VoiceId = isValidVoice(rawVoice) ? rawVoice : 'Kore'

  if (!text || text.length > 600) {
    return NextResponse.json(
      { error: 'Parámetro text requerido (1 a 600 caracteres)' },
      { status: 400 }
    )
  }

  try {
    const wav = await getPhoneAgentSpeech(text, lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    })
  } catch (err: any) {
    console.error('[api/phone/tts] Error:', err?.message)
    return NextResponse.json(
      { error: err?.message || 'Error al generar audio telefónico' },
      { status: 502 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const text = String(body?.text || '').trim()
    const lang = (body?.lang === 'en' ? 'en' : 'es') as 'en' | 'es'
    const rawVoice = body?.voice || 'Kore'
    const voice: VoiceId = isValidVoice(rawVoice) ? rawVoice : 'Kore'

    if (!text || text.length > 600) {
      return NextResponse.json(
        { error: 'Parámetro text requerido (1 a 600 caracteres)' },
        { status: 400 }
      )
    }

    const wav = await getPhoneAgentSpeech(text, lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=86400'
      }
    })
  } catch (err: any) {
    console.error('[api/phone/tts] POST Error:', err?.message)
    return NextResponse.json(
      { error: err?.message || 'Error al generar audio telefónico' },
      { status: 502 }
    )
  }
}
