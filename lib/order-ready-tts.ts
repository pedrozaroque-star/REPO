/**
 * @module lib/order-ready-tts
 * @description Voz femenina natural (Gemini TTS neuronal) para el anuncio de órdenes listas, en inglés y español.
 *
 * @businessRules
 * - Una sola voz femenina (`Kore`) para AMBOS idiomas: antes se usaba speechSynthesis del navegador, que en español
 *   caía en voces masculinas/robóticas (ej. Microsoft Raul). Con la voz neuronal el acento es natural y siempre femenino.
 * - Frases: EN "Order 141 is ready." / ES "Orden 141, ¡ya está!" (cada idioma es un clip aparte con su propio prompt para
 *   que el acento sea nativo y alegre con el slogan de Tacos Gavilan).
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

import { createHash } from 'node:crypto'
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
const CACHE_VERSION = 'v4'
const MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts'
]

export type TtsLang = 'en' | 'es'

let bucketReady = false
const inflight = new Map<string, Promise<Buffer>>()
let poolIndex = 0
const keyBlockedUntil = new Map<string, number>()

export function getGeminiKeyPool(): string[] {
  const raw = [
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    ...(process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [])
  ]
  return Array.from(new Set(raw.map((k) => (k || '').trim()).filter(Boolean)))
}

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

export function isValidAnnouncementRequest(text: string | null | undefined, lang: string | null | undefined, voice?: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 500) return false
  const langOk = !lang || lang === 'en' || lang === 'es'
  const voiceOk = !voice || isValidVoice(voice)
  return langOk && voiceOk
}

/**
 * REGLA ABSOLUTA TACOS GAVILAN: Bloqueo 100% infranqueable de Microsoft Raúl (o cualquier voz con Raúl/Raul).
 * Normaliza acentos diacríticos (NFD) para que "Raúl", "RAÚL", "Raul", "raùl" se conviertan a "raul"
 * y sean interceptados sin importar mayúsculas, minúsculas, diacríticos o nombres de proveedor.
 */
export function isForbiddenRaulVoice(voiceName: string | null | undefined, voiceURI?: string | null): boolean {
  if (!voiceName && !voiceURI) return false
  const target = `${voiceName || ''} ${voiceURI || ''}`.trim()
  if (!target) return false
  const normalized = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return (
    normalized.includes('raul') ||
    /ra[uú]l/i.test(target) ||
    /microsoft ra[uú]l/i.test(target) ||
    /es-mx-ra[uú]l/i.test(target)
  )
}

function buildPrompt(n: string, lang: TtsLang): string {
  const spoken = String(parseInt(n, 10))
  if (lang === 'en') {
    return `Order ${spoken}, is ready!`
  } else {
    return `Orden ${spoken}, ¡ya está!`
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

function ensureWav(data: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === 'RIFF') {
    return data
  }
  return pcmToWav(data, sampleRate, channels, bitDepth)
}

async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
  // "already exists" es el caso normal después de la primera vez
  if (!error || /already exists|duplicate/i.test(error.message)) bucketReady = true
}

async function generateTextWithGemini(
  textToSpeak: string,
  lang: TtsLang,
  voice: VoiceId,
  stylePrompt?: string
): Promise<Buffer> {
  const allKeys = getGeminiKeyPool()
  if (allKeys.length === 0) throw new Error('No hay ninguna GEMINI_API_KEY configurada')

  // Priorizar llaves que no estén temporalmente bloqueadas por 429
  const now = Date.now()
  const unblockedKeys = allKeys.filter((k) => (keyBlockedUntil.get(k) || 0) <= now)
  if (unblockedKeys.length === 0) {
    throw new Error('GEMINI_TTS_QUOTA_EXHAUSTED: Cuota diaria de Gemini TTS alcanzada en todas las llaves (429 RESOURCE_EXHAUSTED). Use voz local del navegador.')
  }
  const candidateKeys = unblockedKeys

  // Rotación balanceada (round-robin)
  const startIndex = (poolIndex++) % candidateKeys.length
  const rotatedKeys = [
    ...candidateKeys.slice(startIndex),
    ...candidateKeys.slice(0, startIndex)
  ]

  let lastErr = ''

  for (const key of rotatedKeys) {
    let allModels429 = true

    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [{
                  text: textToSpeak,
                  ...(model.includes('3.8') && stylePrompt
                    ? {
                        speech_metadata: {
                          style: stylePrompt
                        }
                      }
                    : {})
                }]
              }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voice
                    }
                  }
                }
              }
            })
          })

          if (res.ok) {
            const json: any = await res.json()
            const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)
            if (part) {
              const raw = Buffer.from(part.inlineData.data, 'base64')
              return ensureWav(raw)
            }
            lastErr = `${model}: respuesta sin audio (${json.candidates?.[0]?.finishReason || 'no part'})`
            allModels429 = false
            break
          } else {
            const errText = await res.text()
            lastErr = `${model} (key ...${key.slice(-4)}): ${res.status} ${errText.slice(0, 160)}`
            if (res.status === 429 || /quota|exceeded/i.test(errText)) {
              // Cuota de este modelo agotada: intentar el siguiente modelo en la lista sin descartar la llave
              break
            } else {
              allModels429 = false
              break
            }
          }
        } catch (fetchErr: any) {
          lastErr = `${model}: ${fetchErr.message}`
          if (attempt === 0) {
            // Reintentar intento 2 tras 600ms si hubo caída de socket (ECONNRESET) o timeout
            await new Promise((r) => setTimeout(r, 600))
            continue
          }
          allModels429 = false
          break
        }
      }
    }

    if (allModels429) {
      // Si todos los modelos arrojaron 429, enfriar la llave 60s para restablecer el límite por minuto (RPM)
      keyBlockedUntil.set(key, Date.now() + 60 * 1000)
    }
  }

  throw new Error(`Gemini TTS falló (${lastErr})`)
}

async function generateWithGemini(n: string, lang: TtsLang, voice: VoiceId): Promise<Buffer> {
  const textToSpeak = buildPrompt(n, lang)
  const stylePrompt =
    lang === 'es'
      ? 'cheerful, energetic, warm and enthusiastic Mexican restaurant counter announcement, speaking with a warm natural Mexican Spanish accent and saying the company slogan "¡ya está!" with joyful energy'
      : 'cheerful, upbeat, warm and friendly counter announcement'
  return generateTextWithGemini(textToSpeak, lang, voice, stylePrompt)
}

export async function getOrderReadySpeech(n: string, lang: TtsLang, voice: VoiceId = DEFAULT_VOICE): Promise<Buffer> {
  const num = String(parseInt(n, 10))
  const selectedVoice = isValidVoice(voice) ? voice : DEFAULT_VOICE
  const path = `${CACHE_VERSION}/${selectedVoice}/${lang}/${num}.wav`

  // 1. Intentar caché v3 en Storage
  const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (hit.data) return Buffer.from(await hit.data.arrayBuffer())

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

/**
 * Genera o recupera desde caché de Storage el audio de un anuncio personalizado para el comedor de Tacos Gavilan.
 */
export async function getAnnouncementSpeech(text: string, lang: TtsLang, voice: VoiceId = DEFAULT_VOICE): Promise<Buffer> {
  const clean = text.trim().slice(0, 500)
  if (!clean) throw new Error('Texto de anuncio vacío')

  const selectedVoice = isValidVoice(voice) ? voice : DEFAULT_VOICE
  const hash = createHash('md5').update(`${selectedVoice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  const path = `announcements/${selectedVoice}/${lang}/${hash}.wav`

  // 1. Intentar caché en Storage
  const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (hit.data) return Buffer.from(await hit.data.arrayBuffer())

  const existing = inflight.get(path)
  if (existing) return existing

  const job = (async () => {
    const stylePrompt =
      lang === 'es'
        ? 'clear, polite, professional, warm and pleasant dining room public announcement for restaurant customers'
        : 'clear, polite, professional, warm and pleasant dining room public announcement for restaurant customers'
    const wav = await generateTextWithGemini(clean, lang, selectedVoice, stylePrompt)
    try {
      await ensureBucket()
      await supabaseAdmin.storage.from(BUCKET).upload(path, wav, { contentType: 'audio/wav', upsert: true })
    } catch (e) {
      console.warn('[order-ready-tts] no se pudo cachear anuncio en Storage:', e)
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
