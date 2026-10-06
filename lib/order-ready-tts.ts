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
const MODELS = ['gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts']
const CACHE_VERSION = 'v4'

export type TtsLang = 'en' | 'es'

let bucketReady = false
const inflight = new Map<string, Promise<Buffer>>()
let poolIndex = 0
const keyBlockedUntil = new Map<string, number>()

export function getGeminiKeyPool(): string[] {
  const raw = [
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

/**
 * Frase concisa para el mostrador con el slogan institucional de Tacos Gavilan: ¡Ya está!
 * IMPORTANTE: Gemini 3.8 Flash TTS lee el campo 'text' de forma ESTRICTAMENTE LITERAL (verbatim).
 * NO incluir instrucciones descriptivas en este string; la modulación de alegría va en speech_metadata.style.
 */
function buildPrompt(n: string, lang: TtsLang): string {
  const spoken = String(parseInt(n, 10))
  if (lang === 'en') {
    return `Order ${spoken} is ready.`
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

async function generateWithGemini(n: string, lang: TtsLang, voice: VoiceId): Promise<Buffer> {
  const allKeys = getGeminiKeyPool()
  if (allKeys.length === 0) throw new Error('No hay ninguna GEMINI_API_KEY configurada')

  const textToSpeak = buildPrompt(n, lang)

  // Priorizar llaves que no estén temporalmente bloqueadas por 429
  const now = Date.now()
  const unblockedKeys = allKeys.filter((k) => (keyBlockedUntil.get(k) || 0) <= now)
  const candidateKeys = unblockedKeys.length > 0 ? unblockedKeys : allKeys

  // Rotación balanceada (round-robin)
  const startIndex = (poolIndex++) % candidateKeys.length
  const rotatedKeys = [
    ...candidateKeys.slice(startIndex),
    ...candidateKeys.slice(0, startIndex)
  ]

  let lastErr = ''

  for (const key of rotatedKeys) {
    let keyExhausted = false
    for (const model of MODELS) {
      if (keyExhausted) break
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [{
                  text: textToSpeak,
                  ...(model.includes('3.8')
                    ? {
                        speech_metadata: {
                          style:
                            lang === 'es'
                              ? 'cheerful, energetic and enthusiastic counter announcement, saying the company slogan "¡ya está!" with joyful energy'
                              : 'cheerful, upbeat and friendly counter announcement'
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
            lastErr = `${model}: respuesta sin audio`
          } else {
            const errText = await res.text()
            lastErr = `${model} (key ...${key.slice(-4)}): ${res.status} ${errText.slice(0, 160)}`
            if (res.status === 429) {
              if (/per_model_per_day|PerProjectPerModel/i.test(errText)) {
                // Cuota de ESTE modelo agotada: intentar el siguiente modelo en la lista sin descartar la llave
                break
              }
              if (/PerDay/i.test(errText)) {
                // Cuota diaria de la llave: bloquearla temporalmente y pasar a la siguiente llave del pool
                keyBlockedUntil.set(key, Date.now() + 15 * 60 * 1000)
                keyExhausted = true
                break
              }
              await new Promise((r) => setTimeout(r, 1200))
            } else {
              break
            }
          }
        } catch (fetchErr: any) {
          lastErr = `${model}: ${fetchErr.message}`
          break
        }
      }
    }
  }

  throw new Error(`Gemini TTS falló (${lastErr})`)
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
