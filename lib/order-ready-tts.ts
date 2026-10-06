/**
 * @module lib/order-ready-tts
 * @description Voz femenina natural (Gemini TTS neuronal) para el anuncio de órdenes listas, en inglés y español.
 *
 * @businessRules
 * - Una sola voz femenina (`Kore`) para AMBOS idiomas: antes se usaba speechSynthesis del navegador, que en español
 *   caía en voces masculinas/robóticas (ej. Microsoft Raul). Con la voz neuronal el acento es natural y siempre femenino.
 * - Frases: EN "Order 141 is ready." / ES "Orden 141, ya está." (cada idioma es un clip aparte con su propio prompt para
 *   que el acento sea nativo).
 * - Solo se aceptan números de 1 a 4 dígitos (evita abuso de la API de pago).
 *
 * @dataFlow
 * - GET /api/order-ready/tts?n=141&lang=en|es -> getOrderReadySpeech() -> Supabase Storage (bucket `order-ready-tts`, caché permanente)
 *   -> si no existe: Gemini generateContent (AUDIO) -> PCM 24 kHz -> WAV -> Storage -> respuesta `audio/wav`.
 *
 * @notes
 * - Los números de orden se repiten cada día, así que tras pocos días todos los clips ya están en caché (costo ~0).
 * - Generaciones simultáneas del mismo clip se deduplican con un mapa de promesas en memoria.
 * - Si Gemini falla, el cliente cae a la voz del navegador (speechSynthesis) como respaldo.
 */

import { supabaseAdmin } from '@/lib/supabase'

export const AVAILABLE_VOICES = [
  { id: 'Kore', name: 'Kore', gender: 'female', labelEs: 'Kore (Femenina • Firme y Clara)', labelEn: 'Kore (Female • Firm & Clear)' },
  { id: 'Aoede', name: 'Aoede', gender: 'female', labelEs: 'Aoede (Femenina • Cálida y Natural)', labelEn: 'Aoede (Female • Warm & Natural)' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'female', labelEs: 'Zephyr (Femenina • Brillante y Alegre)', labelEn: 'Zephyr (Female • Bright & Cheerful)' },
  { id: 'Puck', name: 'Puck', gender: 'male', labelEs: 'Puck (Masculina • Dinámica y Amable)', labelEn: 'Puck (Male • Upbeat & Friendly)' },
  { id: 'Orus', name: 'Orus', gender: 'male', labelEs: 'Orus (Masculina • Firme y Profesional)', labelEn: 'Orus (Male • Firm & Professional)' }
] as const

export type VoiceId = (typeof AVAILABLE_VOICES)[number]['id']

const BUCKET = 'order-ready-tts'
const DEFAULT_VOICE: VoiceId = 'Kore'
const MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']
const CACHE_VERSION = 'v2'

export type TtsLang = 'en' | 'es'

let bucketReady = false
const inflight = new Map<string, Promise<Buffer>>()

export function isValidVoice(v: string | null | undefined): v is VoiceId {
  if (!v) return false
  return AVAILABLE_VOICES.some(voice => voice.id === v)
}

export function isValidTtsRequest(n: string | null, lang: string | null, voice?: string | null): n is string {
  const numOk = !!n && /^\d{1,4}$/.test(n)
  const langOk = lang === 'en' || lang === 'es'
  const voiceOk = !voice || isValidVoice(voice)
  return numOk && langOk && voiceOk
}

function buildPrompt(n: string, lang: TtsLang, voice: VoiceId): string {
  const spoken = String(parseInt(n, 10))
  const isFemale = voice === 'Kore' || voice === 'Aoede' || voice === 'Zephyr'
  if (lang === 'en') {
    const tone = isFemale ? 'a friendly young woman' : 'a friendly young man'
    return `Say warmly, clearly and naturally, like ${tone} working at a restaurant counter: Order ${spoken} is ready.`
  } else {
    const tone = isFemale ? 'una joven' : 'un joven'
    return `Di con voz cálida, clara y natural de ${tone} que atiende en el mostrador de un restaurante mexicano: Orden ${spoken}, ya está.`
  }
}

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = (sampleRate * channels * bitDepth) / 8
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE((channels * bitDepth) / 8, 32)
  header.writeUInt16LE(bitDepth, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
  // "already exists" es el caso normal después de la primera vez
  if (!error || /already exists|duplicate/i.test(error.message)) bucketReady = true
}

async function generateWithGemini(n: string, lang: TtsLang, voice: VoiceId): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')

  let lastErr = ''
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(n, lang, voice) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          }
        })
      })
      if (res.ok) {
        const json: any = await res.json()
        const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)
        if (part) return pcmToWav(Buffer.from(part.inlineData.data, 'base64'))
        lastErr = `${model}: respuesta sin audio`
      } else {
        lastErr = `${model}: ${res.status} ${(await res.text()).slice(0, 160)}`
        if (res.status === 429) await new Promise(r => setTimeout(r, 1500))
        else break
      }
    }
  }
  throw new Error(`Gemini TTS falló (${lastErr})`)
}

export async function getOrderReadySpeech(n: string, lang: TtsLang, voice: VoiceId = DEFAULT_VOICE): Promise<Buffer> {
  const num = String(parseInt(n, 10))
  const selectedVoice = isValidVoice(voice) ? voice : DEFAULT_VOICE
  const path = `${CACHE_VERSION}/${selectedVoice}/${lang}/${num}.wav`

  // 1. Intentar caché v2 en Storage
  const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (hit.data) return Buffer.from(await hit.data.arrayBuffer())

  // Si es Kore, revisar la caché previa v1 para reutilizar clips ya generados
  if (selectedVoice === 'Kore') {
    const legacyHit = await supabaseAdmin.storage.from(BUCKET).download(`v1/${lang}/${num}.wav`)
    if (legacyHit.data) {
      const buf = Buffer.from(await legacyHit.data.arrayBuffer())
      // Migrar en segundo plano al nuevo path
      void supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: 'audio/wav', upsert: true }).catch(() => {})
      return buf
    }
  }

  const existing = inflight.get(path)
  if (existing) return existing

  const job = (async () => {
    const wav = await generateWithGemini(num, lang, selectedVoice)
    try {
      await ensureBucket()
      await supabaseAdmin.storage.from(BUCKET).upload(path, wav, { contentType: 'audio/wav', upsert: true })
    } catch (e) {
      console.warn('[order-ready-tts] no se pudo cachear en Storage:', e)
    }
    return wav
  })()

  inflight.set(path, job)
  try {
    return await job
  } finally {
    inflight.delete(path)
  }
}
