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
 * - OPTIMIZACIÓN EDGE CDN (2026-11-19): GET usa `public, max-age=31536000, s-maxage=31536000, immutable` cuando proviene de caché o sesión autorizada.
 * - BLINDAJE DE CUOTA GEMINI TTS (2026-11-21): `POST` exige sesión (`getOrderReadyAccess` o `verifyStaffAuth`); `GET` sin sesión únicamente entrega clips previamente cacheados en Supabase Storage / anuncios guardados en `order_ready_settings` y bloquea (`401`) la síntesis libre de texto arbitrario.
 */

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyStaffAuth } from '@/lib/auth-server'
import { getOrderReadyAccess } from '@/lib/order-ready-access'
import { AVAILABLE_VOICES, getAnnouncementSpeech, isValidAnnouncementRequest, VoiceId } from '@/lib/order-ready-tts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const STORAGE_BUCKET = 'order-ready-tts'
const MAX_IP_BUCKETS = 2000
const ipHits = new Map<string, number[]>()

function extractClientIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || ''
  const firstVercel = vercelFwd.split(',')[0]?.trim()
  if (firstVercel) return firstVercel.slice(0, 64)
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  const fwd = headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown'
}

function checkBoundedIpRateLimit(ip: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  if (ipHits.size >= MAX_IP_BUCKETS && !ipHits.has(ip)) {
    for (const [k, arr] of ipHits) {
      const active = arr.filter((t) => now - t < windowMs)
      if (active.length === 0) ipHits.delete(k)
      else ipHits.set(k, active)
    }
    if (ipHits.size >= MAX_IP_BUCKETS) {
      const oldestKey = ipHits.keys().next().value
      if (oldestKey) ipHits.delete(oldestKey)
    }
  }
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    ipHits.set(ip, recent)
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000))
    return { allowed: false, retryAfterSec }
  }
  recent.push(now)
  ipHits.set(ip, recent)
  return { allowed: true, retryAfterSec: 0 }
}

function resolveValidVoice(voice?: string | null): VoiceId {
  const found = AVAILABLE_VOICES.find((v) => v.id === voice)
  return found ? found.id : 'Kore'
}

function buildAnnouncementStoragePath(text: string, lang: 'en' | 'es', voice: VoiceId): string {
  const clean = text.trim().slice(0, 500)
  const hash = createHash('md5').update(`${voice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  return `announcements/${voice}/${lang}/${hash}.wav`
}

async function hasAnnouncementStaffAccess(request: Request): Promise<boolean> {
  const access = await getOrderReadyAccess(request)
  if (access) return true
  const staff = verifyStaffAuth(request, { allowCron: false })
  return staff.authorized
}

export async function GET(request: Request) {
  const ip = extractClientIp(request.headers)
  const rl = checkBoundedIpRateLimit(`ann-get:${ip}`, 40, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfterSeconds: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const { searchParams } = new URL(request.url)
  const text = searchParams.get('text')
  const lang = (searchParams.get('lang') || 'es') as 'en' | 'es'
  const voice = resolveValidVoice(searchParams.get('voice'))

  if (!isValidAnnouncementRequest(text, lang, voice)) {
    return NextResponse.json(
      { error: 'Parámetros inválidos: text (1-500 caracteres), lang (en|es) y voice válida' },
      { status: 400 }
    )
  }

  const cleanText = (text as string).trim().slice(0, 500)

  try {
    const isAuthorized = await hasAnnouncementStaffAccess(request)
    if (!isAuthorized) {
      // Modo TV público sin sesión: entregar ÚNICAMENTE audio ya existente en caché de Storage (cero síntesis Gemini de texto libre)
      const storagePath = buildAnnouncementStoragePath(cleanText, lang, voice)
      const hit = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath)
      if (!hit.data) {
        return NextResponse.json(
          { error: 'No autenticado: se requiere sesión de personal para sintetizar un anuncio nuevo' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } }
        )
      }
      const cachedWav = Buffer.from(await hit.data.arrayBuffer())
      return new Response(new Uint8Array(cachedWav), {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(cachedWav.length),
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable'
        }
      })
    }

    const wav = await getAnnouncementSpeech(cleanText, lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable'
      }
    })
  } catch (err: any) {
    console.error('[order-ready/announcement-tts] error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al generar TTS para el anuncio' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  try {
    const ip = extractClientIp(request.headers)
    const rl = checkBoundedIpRateLimit(`ann-post:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', retryAfterSeconds: rl.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      )
    }

    const isAuthorized = await hasAnnouncementStaffAccess(request)
    if (!isAuthorized) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const text = body?.text
    const lang = (body?.lang || 'es') as 'en' | 'es'
    const voice = resolveValidVoice(body?.voice)

    if (!isValidAnnouncementRequest(text, lang, voice)) {
      return NextResponse.json(
        { error: 'Parámetros inválidos: text (1-500 caracteres), lang (en|es) y voice válida' },
        { status: 400 }
      )
    }

    const wav = await getAnnouncementSpeech(String(text).trim().slice(0, 500), lang, voice)
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store'
      }
    })
  } catch (err: any) {
    console.error('[order-ready/announcement-tts] error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Error al procesar anuncio' }, { status: 502 })
  }
}
