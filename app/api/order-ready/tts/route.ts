/**
 * @module api/order-ready/tts
 * @description Sirve el audio (WAV) de la voz femenina natural para anunciar una orden lista ("Order 141 is ready." / "Orden 141, ya está.").
 *
 * @businessRules
 * - Parámetros: `n` (1-6 dígitos) y `lang` (`en` | `es`). Cualquier otro valor responde 400 para no gastar la API de Gemini.
 * - Respuesta cacheable por un año (`immutable`): el audio de un número+idioma nunca cambia.
 * - Límite de tasa por IP (`40 req / min` sobre `x-vercel-forwarded-for` / `x-real-ip` con `Map` acotado) para proteger la cuota de Gemini TTS.
 *
 * @dataFlow
 * - Order Ready Board -> GET /api/order-ready/tts -> lib/order-ready-tts (Storage cache o Gemini TTS) -> audio/wav.
 *
 * @notes
 * - Si falla (502/429), el tablero usa la voz del navegador como respaldo.
 */

import { NextResponse } from 'next/server'
import { getOrderReadySpeechWithMeta, isValidTtsRequest, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_TTS_IP_BUCKETS = 2000
const RATE_LIMIT_PER_MIN = 40
const RATE_WINDOW_MS = 60_000
const ttsIpBuckets = new Map<string, number[]>()

function getTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkTtsIpRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  if (ttsIpBuckets.size >= MAX_TTS_IP_BUCKETS && !ttsIpBuckets.has(ip)) {
    for (const [k, hits] of ttsIpBuckets) {
      const valid = hits.filter((t) => now - t < RATE_WINDOW_MS)
      if (valid.length === 0) ttsIpBuckets.delete(k)
      else ttsIpBuckets.set(k, valid)
    }
    if (ttsIpBuckets.size >= MAX_TTS_IP_BUCKETS) {
      const oldest = ttsIpBuckets.keys().next().value
      if (oldest) ttsIpBuckets.delete(oldest)
    }
  }

  const hits = (ttsIpBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_PER_MIN) {
    ttsIpBuckets.set(ip, hits)
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000))
    return { allowed: false, retryAfterSec }
  }
  hits.push(now)
  ttsIpBuckets.set(ip, hits)
  return { allowed: true, retryAfterSec: 0 }
}

export async function GET(request: Request) {
  const clientIp = getTrustedClientIp(request.headers)
  const rl = checkTtsIpRateLimit(clientIp)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', fallback: true, retryAfterSeconds: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const { searchParams } = new URL(request.url)
  const n = searchParams.get('n')
  const lang = searchParams.get('lang')
  const voice = (searchParams.get('voice') || 'Kore') as VoiceId

  if (!isValidTtsRequest(n, lang, voice)) {
    return NextResponse.json(
      { error: 'Parámetros inválidos: n (1-6 dígitos), lang (en|es) y voice opcional (Kore, Aoede, Zephyr, Puck, Orus)' },
      { status: 400 }
    )
  }

  try {
    const { wav, isFallback } = await getOrderReadySpeechWithMeta(n, lang as 'en' | 'es', voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': isFallback
          ? 'no-store'
          : 'public, max-age=31536000, s-maxage=31536000, immutable'
      }
    })
  } catch (err: any) {
    const isQuota = err?.message?.includes('GEMINI_TTS_QUOTA_EXHAUSTED') || err?.message?.includes('429')
    console.error('[order-ready/tts] error:', err?.message)
    return NextResponse.json(
      {
        error: isQuota ? 'TTS_QUOTA_EXHAUSTED' : (err?.message || 'TTS failed'),
        fallback: true
      },
      {
        status: isQuota ? 503 : 502,
        headers: isQuota ? { 'Retry-After': '900' } : undefined
      }
    )
  }
}
