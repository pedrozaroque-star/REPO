/**
 * @module api/web-a11y/tts
 * @description Endpoint público endurecido (`GET`, `POST`, `OPTIONS`) que sirve audio neuronal `audio/wav` (24 kHz)
 * con la voz femenina oficial **`Kore`** para el widget y lector de Accesibilidad Web de Tacos Gavilan
 * (`https://tacosgavilan.com` y visor ejecutivo `/nueva-web`).
 *
 * @businessRules
 * - **Voz Oficial Única**: Siempre sintetiza con `Kore` (`X-Tts-Voice: Kore`), validada por compuerta acústica femenina YIN (`F0 >= 148 Hz`).
 * - **Protección Anti-Abuso y CORS Estricto**:
 *   1. Límite por IP confiable (`x-vercel-forwarded-for` / `x-real-ip`) de `45 req / min` en `Map` LRU acotado (`3,000` entradas).
 *   2. Validación estricta de `Origin` / `Referer` permitiendo únicamente `https://tacosgavilan.com`, `https://www.tacosgavilan.com`,
 *      `https://*.vercel.app`, `http://localhost:*`, `http://127.0.0.1:*` y peticiones `same-origin`, reflejando `Access-Control-Allow-Origin`
 *      solo a orígenes autorizados con `Vary: Origin`.
 *   3. Sanitización contra payloads vacíos, binarios o scripts ejecutables (`400`) y recorte natural en frontera de oración hasta `900` caracteres por bloque.
 * - **Caché CDN y Respaldo Limpio**:
 *   * `GET` determinista `(lang, text)` entrega `200 audio/wav` con `Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400`.
 *   * Ante límite de tasa (`429`) o indisponibilidad temporal de Gemini (`503`), responde JSON `{ error, fallback: true }` para que el cliente active
 *     suavemente el respaldo femenino local sin interrumpir la experiencia de accesibilidad.
 *
 * @dataFlow
 * - Widget Web (`compliance-a11y.js` o proxy `tacosgavilan.com/api/a11y-tts`)
 *   -> `GET / POST /api/web-a11y/tts`
 *   -> `validateAndPrepareWebA11yInput()` + `synthesizeWebA11yKoreSpeech()` (`lib/web-a11y-kore-tts.ts`)
 *   -> `200 audio/wav` (`X-Tts-Voice: Kore`).
 *
 * @notes
 * - Desplegado con afinidad regional `sfo1` (cercano a Supabase `us-west-1`) para lecturas de caché Storage en `< 90 ms`.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  MAX_WEB_A11Y_TTS_CHARS,
  synthesizeWebA11yKoreSpeech,
  validateAndPrepareWebA11yInput
} from '@/lib/web-a11y-kore-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const preferredRegion = 'sfo1'

const MAX_IP_BUCKETS = 3000
const RATE_LIMIT_PER_MIN = 45
const RATE_WINDOW_MS = 60_000
const MAX_POST_BODY_BYTES = 16_384

const gWebA11y = globalThis as unknown as {
  __tegWebA11yIpBuckets?: Map<string, number[]>
}

const ipRateBuckets: Map<string, number[]> =
  gWebA11y.__tegWebA11yIpBuckets || (gWebA11y.__tegWebA11yIpBuckets = new Map<string, number[]>())

function getTrustedClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.replace(/^::ffff:/i, '').slice(0, 64)

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.replace(/^::ffff:/i, '').slice(0, 64)

  const isVercelProd = process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production'
  if (!isVercelProd) {
    const fwd = headers.get('x-forwarded-for') || ''
    const firstFwd = fwd.split(',')[0]?.trim()
    if (firstFwd) return firstFwd.replace(/^::ffff:/i, '').slice(0, 64)
    return '127.0.0.1'
  }

  return 'unknown'
}

function checkWebA11yRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  if (!ipRateBuckets.has(ip) && ipRateBuckets.size >= MAX_IP_BUCKETS) {
    for (const [key, timestamps] of ipRateBuckets) {
      const active = timestamps.filter((t) => now - t < RATE_WINDOW_MS)
      if (active.length === 0) ipRateBuckets.delete(key)
      else ipRateBuckets.set(key, active)
    }
    while (ipRateBuckets.size >= MAX_IP_BUCKETS) {
      const oldestKey = ipRateBuckets.keys().next().value
      if (oldestKey === undefined) break
      ipRateBuckets.delete(oldestKey)
    }
  }

  const hits = (ipRateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  // Refrescar orden LRU
  ipRateBuckets.delete(ip)

  if (hits.length >= RATE_LIMIT_PER_MIN) {
    ipRateBuckets.set(ip, hits)
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000))
    return { allowed: false, retryAfterSec }
  }

  hits.push(now)
  ipRateBuckets.set(ip, hits)
  return { allowed: true, retryAfterSec: 0 }
}

function isAllowedOriginUrl(candidateOrigin: string, requestOrigin: string): string | null {
  try {
    const parsed = new URL(candidateOrigin)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null
    }

    if (parsed.origin === requestOrigin) {
      return parsed.origin
    }

    const host = parsed.hostname.toLowerCase()

    if (parsed.protocol === 'https:') {
      if (host === 'tacosgavilan.com' || host === 'www.tacosgavilan.com') {
        return parsed.origin
      }
      if (host.endsWith('.vercel.app') && host.length > '.vercel.app'.length && !host.includes('..')) {
        return parsed.origin
      }
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      return parsed.origin
    }

    return null
  } catch {
    return null
  }
}

interface OriginSecurityCheck {
  allowed: boolean
  corsOrigin: string | null
  reason?: string
}

function verifyRequestOriginAndCors(request: NextRequest): OriginSecurityCheck {
  let requestOrigin = ''
  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    requestOrigin = ''
  }

  const rawOrigin = request.headers.get('origin')?.trim()
  if (rawOrigin) {
    const matched = isAllowedOriginUrl(rawOrigin, requestOrigin)
    if (!matched) {
      return { allowed: false, corsOrigin: null, reason: 'ORIGIN_NOT_ALLOWED' }
    }
    return { allowed: true, corsOrigin: matched }
  }

  const rawReferer = request.headers.get('referer')?.trim()
  if (rawReferer) {
    try {
      const refParsed = new URL(rawReferer)
      const matched = isAllowedOriginUrl(refParsed.origin, requestOrigin)
      if (!matched) {
        return { allowed: false, corsOrigin: null, reason: 'REFERER_NOT_ALLOWED' }
      }
      return { allowed: true, corsOrigin: null }
    } catch {
      return { allowed: false, corsOrigin: null, reason: 'REFERER_NOT_ALLOWED' }
    }
  }

  const secFetchSite = (request.headers.get('sec-fetch-site') || '').trim().toLowerCase()
  if (secFetchSite === 'cross-site') {
    return { allowed: false, corsOrigin: null, reason: 'CROSS_SITE_NOT_ALLOWED' }
  }

  return { allowed: true, corsOrigin: null }
}

function buildCorsHeaders(corsOrigin: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...(extra || {})
  }

  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept, X-Requested-With'
    headers['Access-Control-Expose-Headers'] = 'X-Tts-Voice, X-Tts-Lang, X-Tts-Cache, X-Tts-Chars, Retry-After'
    headers['Access-Control-Max-Age'] = '86400'
  }

  return headers
}

async function handleTtsSynthesis(
  request: NextRequest,
  rawText: unknown,
  rawLang: unknown,
  corsOrigin: string | null,
  isDeterministicGet: boolean
): Promise<Response> {
  const clientIp = getTrustedClientIp(request.headers)
  const rl = checkWebA11yRateLimit(clientIp)
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'RATE_LIMITED',
        fallback: true,
        retryAfterSeconds: rl.retryAfterSec
      },
      {
        status: 429,
        headers: buildCorsHeaders(corsOrigin, {
          'Cache-Control': 'no-store',
          'Retry-After': String(rl.retryAfterSec)
        })
      }
    )
  }

  const prepared = validateAndPrepareWebA11yInput(rawText, rawLang, MAX_WEB_A11Y_TTS_CHARS)
  if (!prepared.ok) {
    return NextResponse.json(
      {
        error: prepared.code,
        message: prepared.message,
        fallback: true
      },
      {
        status: 400,
        headers: buildCorsHeaders(corsOrigin, {
          'Cache-Control': 'no-store'
        })
      }
    )
  }

  try {
    const result = await synthesizeWebA11yKoreSpeech(prepared.normalizedText, prepared.lang, {
      signal: request.signal,
      maxChars: MAX_WEB_A11Y_TTS_CHARS,
      preparedInput: prepared
    })

    const cacheControl = isDeterministicGet
      ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
      : 'private, max-age=86400'

    return new Response(new Uint8Array(result.wav), {
      status: 200,
      headers: buildCorsHeaders(corsOrigin, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(result.wav.length),
        'Cache-Control': cacheControl,
        'X-Tts-Voice': result.voice,
        'X-Tts-Lang': result.lang,
        'X-Tts-Cache': result.cacheStatus,
        'X-Tts-Chars': String(result.normalizedText.length)
      })
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || 'TTS synthesis failed')
    const isQuota = /GEMINI_TTS_QUOTA_EXHAUSTED|RESOURCE_EXHAUSTED|429/i.test(msg)
    console.error('[api/web-a11y/tts] Error:', msg)

    return NextResponse.json(
      {
        error: isQuota ? 'TTS_QUOTA_EXHAUSTED' : 'TTS_UNAVAILABLE',
        fallback: true
      },
      {
        status: 503,
        headers: buildCorsHeaders(corsOrigin, {
          'Cache-Control': 'no-store',
          ...(isQuota ? { 'Retry-After': '300' } : {})
        })
      }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  const sec = verifyRequestOriginAndCors(request)
  if (!sec.allowed) {
    return NextResponse.json(
      { error: sec.reason || 'ORIGIN_NOT_ALLOWED', fallback: true },
      {
        status: 403,
        headers: buildCorsHeaders(null, { 'Cache-Control': 'no-store' })
      }
    )
  }

  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(sec.corsOrigin)
  })
}

export async function GET(request: NextRequest) {
  const sec = verifyRequestOriginAndCors(request)
  if (!sec.allowed) {
    return NextResponse.json(
      { error: sec.reason || 'ORIGIN_NOT_ALLOWED', fallback: true },
      {
        status: 403,
        headers: buildCorsHeaders(null, { 'Cache-Control': 'no-store' })
      }
    )
  }

  const { searchParams } = new URL(request.url)
  const rawText = searchParams.get('text')
  const rawLang = searchParams.get('lang')

  return handleTtsSynthesis(request, rawText, rawLang, sec.corsOrigin, true)
}

export async function POST(request: NextRequest) {
  const sec = verifyRequestOriginAndCors(request)
  if (!sec.allowed) {
    return NextResponse.json(
      { error: sec.reason || 'ORIGIN_NOT_ALLOWED', fallback: true },
      {
        status: 403,
        headers: buildCorsHeaders(null, { 'Cache-Control': 'no-store' })
      }
    )
  }

  const contentLength = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_POST_BODY_BYTES) {
    return NextResponse.json(
      { error: 'PAYLOAD_TOO_LARGE', fallback: true },
      {
        status: 413,
        headers: buildCorsHeaders(sec.corsOrigin, { 'Cache-Control': 'no-store' })
      }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'INVALID_JSON', fallback: true },
      {
        status: 400,
        headers: buildCorsHeaders(sec.corsOrigin, { 'Cache-Control': 'no-store' })
      }
    )
  }

  const record = body as Record<string, unknown>
  return handleTtsSynthesis(request, record.text, record.lang, sec.corsOrigin, false)
}
