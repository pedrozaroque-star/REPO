/**
 * @module api/order-ready/announcement-tts
 * @description Genera y sirve el audio neuronal (WAV) de anuncios personalizados para el comedor de Tacos Gavilan.
 *
 * @businessRules
 * - Acepta anuncios de hasta 500 caracteres en inglés ('en') o español ('es').
 * - Voces neuronales seleccionables: Kore, Aoede, Zephyr (femeninas) o Puck, Orus (masculinas).
 * - Cacheado permanente e inmutable en Supabase Storage (bucket `order-ready-tts/announcements/{voice}/{lang}/{hash}.wav`).
 * - Si un anuncio ya fue generado, se entrega instantáneamente desde Storage sin consumir cuota de Gemini.
 *
 * @dataFlow
 * - Order Ready Board -> GET / POST /api/order-ready/announcement-tts -> getAnnouncementSpeech() -> Supabase Storage / Gemini TTS -> audio/wav.
 *
 * @notes
 * - Soporta tanto GET (útil para etiquetas <audio src="...">) como POST (para envío estructurado JSON).
 * - En caso de caída de API (502), el cliente web cae al sintetizador local del navegador con filtro estricto anti-Raul.
 */

import { NextResponse } from 'next/server'
import { getAnnouncementSpeech, isValidAnnouncementRequest, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const text = searchParams.get('text')
  const lang = (searchParams.get('lang') || 'es') as 'en' | 'es'
  const voice = (searchParams.get('voice') || 'Kore') as VoiceId

  if (!isValidAnnouncementRequest(text, lang, voice)) {
    return NextResponse.json(
      { error: 'Parámetros inválidos: text (1-500 caracteres), lang (en|es) y voice válida' },
      { status: 400 }
    )
  }

  try {
    const wav = await getAnnouncementSpeech(text as string, lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=2592000, immutable'
      }
    })
  } catch (err: any) {
    console.error('[order-ready/announcement-tts] error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al generar TTS para el anuncio' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const text = body?.text
    const lang = (body?.lang || 'es') as 'en' | 'es'
    const voice = (body?.voice || 'Kore') as VoiceId

    if (!isValidAnnouncementRequest(text, lang, voice)) {
      return NextResponse.json(
        { error: 'Parámetros inválidos: text (1-500 caracteres), lang (en|es) y voice válida' },
        { status: 400 }
      )
    }

    const wav = await getAnnouncementSpeech(text, lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=2592000, immutable'
      }
    })
  } catch (err: any) {
    console.error('[order-ready/announcement-tts] error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al procesar anuncio' }, { status: 502 })
  }
}
