/**
 * @module api/order-ready/tts
 * @description Sirve el audio (WAV) de la voz femenina natural para anunciar una orden lista ("Order 141 is ready." / "Orden 141, ya está.").
 *
 * @businessRules
 * - Parámetros: `n` (1-4 dígitos) y `lang` (`en` | `es`). Cualquier otro valor responde 400 para no gastar la API de Gemini.
 * - Respuesta cacheable por un año (`immutable`): el audio de un número+idioma nunca cambia.
 *
 * @dataFlow
 * - Order Ready Board -> GET /api/order-ready/tts -> lib/order-ready-tts (Storage cache o Gemini TTS) -> audio/wav.
 *
 * @notes
 * - Si falla (502), el tablero usa la voz del navegador como respaldo.
 */

import { NextResponse } from 'next/server'
import { getOrderReadySpeech, isValidTtsRequest } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const n = searchParams.get('n')
  const lang = searchParams.get('lang')

  if (!isValidTtsRequest(n, lang)) {
    return NextResponse.json({ error: 'Parámetros inválidos: n (1-4 dígitos) y lang (en|es)' }, { status: 400 })
  }

  try {
    const wav = await getOrderReadySpeech(n, lang as 'en' | 'es')
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable'
      }
    })
  } catch (err: any) {
    console.error('[order-ready/tts] error:', err?.message)
    return NextResponse.json({ error: err?.message || 'TTS failed' }, { status: 502 })
  }
}
