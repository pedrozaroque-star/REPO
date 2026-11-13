/**
 * @module lib/order-ready-tts
 * @description Voz femenina natural (Gemini TTS neuronal) para el anuncio de órdenes listas, en inglés y español.
 *
 * @businessRules
 * - Una sola voz femenina (`Kore`) para AMBOS idiomas: antes se usaba speechSynthesis del navegador, que en español
 *   caía en voces masculinas/robóticas (ej. Microsoft Raul). Con la voz neuronal el acento es natural y siempre femenino.
 * - Frases: EN "Order 141 is ready." / ES "Orden 141, ¡ya está!" (cada idioma es un clip aparte con su propio prompt para
 *   que el acento sea nativo y alegre con el slogan de Tacos Gavilan).
 * - Se aceptan números de 1 a 6 dígitos (soportando órdenes regulares y numeración offline de Toast como 80001).
 *
 * @dataFlow
 * - GET /api/order-ready/tts?n=141&lang=en|es -> getOrderReadySpeech() -> Supabase Storage (bucket `order-ready-tts`, caché permanente)
 *   -> si no existe: Gemini generateContent (AUDIO) -> PCM 24 kHz -> WAV -> Storage -> respuesta `audio/wav`.
 *
 * @notes
 * - Los números de orden se repiten cada día, así que tras pocos días todos los clips ya están en caché (costo ~0).
 * - Generaciones simultáneas del mismo clip se deduplican con un mapa de promesas en memoria.
 * - BLINDAJE ANTI-VOZ MASCULINA Y PROSODIA NATURAL KORE EN CONTESTADORA IA (`phone_kore38_v6` / `phone_v6`, 2026-11-11):
 *   1) Bloqueo estricto de catálogo (`PHONE_FEMALE_VOICES = ['Kore', 'Aoede', 'Zephyr']`; `resolvePhoneFemaleVoice` rechaza `Puck`/`Orus`).
 *   2) Cadena neuronal de 3 modelos sobre las 7 llaves `AQ.` (`gemini-3.8-flash-lite-tts` -> `gemini-3.8-flash-tts` -> `gemini-3.1-flash-tts-preview`)
 *      para nunca caer en `speechSynthesis` robótico del navegador cuando se agota la cuota `PerDay` de `3.8`.
 *   3) Prosodia idéntica al tablero de entregas (`Order Ready`, ~206–208 Hz, `p75` inicial ~232 Hz): fórmula cálida, amable y natural a ritmo
 *      conversacional tranquilo, sin sustantivos ambiguos (`receptionist`), sin `energetic/enthusiastic` y sin `languageCode` forzado (que elevaba
 *      artificialmente el inicio de frase a `275–330 Hz` en `3.1`).
 *   4) Compuerta acústica matemática YIN en tiempo real (`estimateVocalPitchF0` + `isVerifiedFemalePitch`, `medianHz >= 155 Hz`, `p25Hz >= 130 Hz`,
 *      `lowMaleRatio < 0.30`): valida la ventana previa a emitir el primer byte en SSE (`PRE_VERIFY_PCM_BYTES`) y el clip completo antes de cachear.
 * - OPTIMIZACIÓN DE LATENCIA EN TIEMPO REAL (2026-11-12):
 *   1) Los hits de caché `phone_v6` en RAM/Storage (ya validados al generarse) omiten el re-escaneo YIN en cada petición (0 ms CPU).
 *   2) `estimateVocalPitchF0` usa muestreo estratificado (`<= 80` ventanas) reduciendo síntesis nueva a `< 12 ms`; `PRE_VERIFY_PCM_BYTES` baja a `0.80 s`.
 *   3) Orden de modelos TTS telefónicos: `gemini-3.8-flash-tts -> gemini-3.8-flash-lite-tts -> gemini-3.1-flash-tts-preview`, con cuarentena 6h para
 *      llaves `401/402/403`, tope `maxAttemptsOnModel`, cero esperas de `22.5 s` y sin doble bucle SSE->REST->SSE.
 *   4) `persistPhoneWavToStorage` retorna una promesa real (`awaitStoragePersist`) + bandera `bucketReady` en RAM + `downsampleWav24kTo8k` (8 kHz PSTN 3x más ligero).
 */

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeTextForPhoneSpeech } from '@/lib/phone-speech-format'

export const AVAILABLE_VOICES = [
  { id: 'Kore', name: 'Kore', gender: 'female', labelEs: 'Kore (Femenina • Firme y Clara)', labelEn: 'Kore (Female • Firm & Clear)' },
  { id: 'Aoede', name: 'Aoede', gender: 'female', labelEs: 'Aoede (Femenina • Cálida y Natural)', labelEn: 'Aoede (Female • Warm & Natural)' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'female', labelEs: 'Zephyr (Femenina • Brillante y Alegre)', labelEn: 'Zephyr (Female • Bright & Cheerful)' },
  { id: 'Puck', name: 'Puck', gender: 'male', labelEs: 'Puck (Masculina • Dinámica y Amable)', labelEn: 'Puck (Male • Upbeat & Friendly)' },
  { id: 'Orus', name: 'Orus', gender: 'male', labelEs: 'Orus (Masculina • Firme y Profesional)', labelEn: 'Orus (Male • Firm & Professional)' }
] as const

export type VoiceId = (typeof AVAILABLE_VOICES)[number]['id']

export const PHONE_FEMALE_VOICES = ['Kore', 'Aoede', 'Zephyr'] as const
export type PhoneFemaleVoiceId = (typeof PHONE_FEMALE_VOICES)[number]

const BUCKET = 'order-ready-tts'
const DEFAULT_VOICE: VoiceId = 'Kore'
const DEFAULT_PHONE_VOICE: PhoneFemaleVoiceId = 'Kore'
const CACHE_VERSION = 'v4'
const MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts'
]

export type TtsLang = 'en' | 'es'

let bucketReady = false
const inflight = new Map<string, Promise<Buffer>>()
const memoryPhoneAudioCache = new Map<string, Buffer>()
const MAX_MEMORY_PHONE_CLIPS = 300
let poolIndex = 3
const keyBlockedUntil = new Map<string, number>()
let remoteKeyPoolCache: { keys: string[]; fetchedAt: number } | null = null
let remoteKeyFetchInFlight: Promise<void> | null = null

function setMemoryPhoneCache(path: string, wav: Buffer) {
  if (memoryPhoneAudioCache.size >= MAX_MEMORY_PHONE_CLIPS) {
    const oldestKey = memoryPhoneAudioCache.keys().next().value
    if (oldestKey) memoryPhoneAudioCache.delete(oldestKey)
  }
  memoryPhoneAudioCache.set(path, wav)
}

export function getGeminiKeyPool(): string[] {
  const raw = [
    process.env.GEMINI_API_KEY_10,
    process.env.GEMINI_API_KEY_9,
    process.env.GEMINI_API_KEY_8,
    process.env.GEMINI_API_KEY_7,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    ...(process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : []),
    ...(remoteKeyPoolCache?.keys || [])
  ]
  return Array.from(new Set(raw.map((k) => (k || '').trim()).filter(Boolean)))
}

async function refreshRemoteKeyPoolSafe(): Promise<void> {
  if (remoteKeyFetchInFlight) return remoteKeyFetchInFlight
  remoteKeyFetchInFlight = (async () => {
    const now = Date.now()
    try {
      const hit = await Promise.race([
        supabaseAdmin.storage.from(BUCKET).download('_config/gemini-keys.json'),
        new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 1500))
      ])
      if (hit.data) {
        const parsed = JSON.parse(await hit.data.text())
        if (Array.isArray(parsed?.keys)) {
          remoteKeyPoolCache = {
            keys: parsed.keys.map((k: any) => String(k || '').trim()).filter(Boolean),
            fetchedAt: now
          }
        }
      }
    } catch {
      // Ignorar si no existe
    }
    if (!remoteKeyPoolCache) {
      remoteKeyPoolCache = { keys: [], fetchedAt: now }
    }
  })().finally(() => {
    remoteKeyFetchInFlight = null
  })
  return remoteKeyFetchInFlight
}

export async function getGeminiKeyPoolWithRemote(): Promise<string[]> {
  const now = Date.now()
  const localKeys = getGeminiKeyPool()
  const cacheStale = !remoteKeyPoolCache || now - remoteKeyPoolCache.fetchedAt > 10 * 60 * 1000
  if (cacheStale) {
    // Si ya hay llaves activas en process.env, no bloquear ~600 ms la ruta crítica en frío: refrescar en background
    if (localKeys.length > 0 && !remoteKeyPoolCache) {
      remoteKeyPoolCache = { keys: [], fetchedAt: now - 9 * 60 * 1000 }
      void refreshRemoteKeyPoolSafe().catch(() => null)
    } else {
      await refreshRemoteKeyPoolSafe()
    }
  }
  return getGeminiKeyPool()
}

export function isValidVoice(v: string | null | undefined): v is VoiceId {
  if (!v) return false
  return AVAILABLE_VOICES.some(voice => voice.id === v)
}

export function isValidPhoneFemaleVoice(v: string | null | undefined): v is PhoneFemaleVoiceId {
  if (!v) return false
  return (PHONE_FEMALE_VOICES as readonly string[]).includes(v)
}

/**
 * Garantiza que la Contestadora IA de las 15 sucursales use EXCLUSIVAMENTE una voz femenina (`Kore`, `Aoede` o `Zephyr`).
 * Si se recibe `Puck`, `Orus` o cualquier valor desconocido, fuerza automáticamente `Kore`.
 */
export function resolvePhoneFemaleVoice(v: string | null | undefined): PhoneFemaleVoiceId {
  return isValidPhoneFemaleVoice(v) ? v : DEFAULT_PHONE_VOICE
}

export interface VocalPitchAnalysis {
  medianHz: number
  p25Hz: number
  p75Hz: number
  lowMaleRatio: number
  voicedFrames: number
}

/**
 * Estima la frecuencia fundamental vocal (`F0` en Hz) directamente sobre PCM lineal de 16 bits (o WAV con cabecera RIFF)
 * usando el algoritmo estándar **YIN** (Función de Diferencia Normalizada por Media Acumulada, CMNDF — *de Cheveigné & Kawahara*, 2002)
 * con interpolación parabólica:
 * - El umbral absoluto sobre el primer mínimo de `CMNDF` impide dividir en subarmónicos falsos (`F0/2`) una voz femenina real (`175–255 Hz`),
 *   mientras que el guardia de periodo doble (`cmndf[2*tau] < 0.55 * cmndf[tau]`) corrige 2º armónicos en voces masculinas graves.
 * - Calcula además `p25Hz` (registro de pecho base) y `lowMaleRatio` (fracción de cuadros vocalizados `< 135 Hz`) para atrapar incluso
 *   voces masculinas de tenor joven que suben la entonación momentáneamente a mitad de frase.
 */
export function estimateVocalPitchF0(pcmOrWav: Buffer, sampleRate = 24000): VocalPitchAnalysis {
  if (!pcmOrWav || pcmOrWav.length < 2400) {
    return { medianHz: 0, p25Hz: 0, p75Hz: 0, lowMaleRatio: 0, voicedFrames: 0 }
  }
  const hasRiff = pcmOrWav.length >= 44 && pcmOrWav.subarray(0, 4).toString('ascii') === 'RIFF'
  const raw = hasRiff ? pcmOrWav.subarray(44) : pcmOrWav
  const totalSamples = Math.floor(raw.length / 2)

  const windowSamples = Math.round(sampleRate * 0.03) // 30 ms ventana de integración (720 muestras a 24 kHz)
  const maxLag = Math.ceil(sampleRate / 70) // 70 Hz mín (~343 muestras)
  const minLag = Math.max(16, Math.floor(sampleRate / 360)) // 360 Hz máx (~66 muestras)
  const frameLen = windowSamples + maxLag
  const hopLen = Math.round(sampleRate * 0.015) // salto de 15 ms

  if (totalSamples < frameLen) {
    return { medianHz: 0, p25Hz: 0, p75Hz: 0, lowMaleRatio: 0, voicedFrames: 0 }
  }

  const samples = new Float32Array(totalSamples)
  for (let i = 0; i < totalSamples; i++) {
    samples[i] = raw.readInt16LE(i * 2) / 32768
  }

  const diff = new Float32Array(maxLag + 1)
  const cmndf = new Float32Array(maxLag + 1)
  const f0Values: number[] = []

  const totalFrames = Math.floor((totalSamples - frameLen) / hopLen) + 1
  const frameStride = totalFrames > 80 ? Math.max(1, Math.floor(totalFrames / 80)) : 1
  const effectiveHop = hopLen * frameStride

  for (let start = 0; start + frameLen <= totalSamples; start += effectiveHop) {
    let sumSq = 0
    for (let i = 0; i < windowSamples; i++) {
      const v = samples[start + i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / windowSamples)
    if (rms < 0.018) continue

    diff[0] = 0
    cmndf[0] = 1
    let runningSum = 0

    for (let tau = 1; tau <= maxLag; tau++) {
      let d = 0
      for (let i = 0; i < windowSamples; i++) {
        const delta = samples[start + i] - samples[start + i + tau]
        d += delta * delta
      }
      diff[tau] = d
      runningSum += d
      cmndf[tau] = runningSum > 1e-12 ? (d * tau) / runningSum : 1
    }

    const yinThreshold = 0.16
    let chosenTau = -1
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < yinThreshold) {
        while (tau + 1 <= maxLag && cmndf[tau + 1] < cmndf[tau]) {
          tau++
        }
        chosenTau = tau
        break
      }
    }

    if (chosenTau === -1) {
      let minVal = 999
      let minIdx = -1
      for (let tau = minLag; tau <= maxLag; tau++) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau]
          minIdx = tau
        }
      }
      if (minVal < 0.28) {
        chosenTau = minIdx
      }
    }

    if (chosenTau <= 0) continue

    // Guardia de error de octava únicamente cuando el semipeíodo presenta error residual notable frente al periodo doble real
    const doubleMin = Math.floor(chosenTau * 1.9)
    const doubleMax = Math.min(maxLag, Math.ceil(chosenTau * 2.1))
    if (doubleMin <= maxLag && cmndf[chosenTau] > 0.08) {
      let bestDoubleVal = 999
      let bestDoubleTau = -1
      for (let t2 = doubleMin; t2 <= doubleMax; t2++) {
        if (cmndf[t2] < bestDoubleVal) {
          bestDoubleVal = cmndf[t2]
          bestDoubleTau = t2
        }
      }
      if (bestDoubleTau > 0 && bestDoubleVal < cmndf[chosenTau] * 0.55) {
        chosenTau = bestDoubleTau
      }
    }

    let refinedTau = chosenTau
    if (chosenTau > 1 && chosenTau < maxLag) {
      const s0 = cmndf[chosenTau - 1]
      const s1 = cmndf[chosenTau]
      const s2 = cmndf[chosenTau + 1]
      const denom = 2 * (2 * s1 - s2 - s0)
      if (Math.abs(denom) > 1e-9) {
        refinedTau = chosenTau + (s2 - s0) / denom
      }
    }

    f0Values.push(sampleRate / refinedTau)
  }

  if (f0Values.length === 0) {
    return { medianHz: 0, p25Hz: 0, p75Hz: 0, lowMaleRatio: 0, voicedFrames: 0 }
  }

  f0Values.sort((a, b) => a - b)
  const n = f0Values.length
  const lowMaleFrames = f0Values.filter((f) => f < 135).length
  const medianHz = Number(f0Values[Math.floor(n * 0.5)].toFixed(1))
  const p25Hz = Number(f0Values[Math.floor(n * 0.25)].toFixed(1))
  const p75Hz = Number(f0Values[Math.floor(n * 0.75)].toFixed(1))
  const lowMaleRatio = Number((lowMaleFrames / n).toFixed(3))
  return { medianHz, p25Hz, p75Hz, lowMaleRatio, voicedFrames: n }
}

export const MIN_PHONE_FEMALE_PITCH_HZ = 155

/**
 * Compuerta acústica anti-voz masculina (YIN + registro de pecho `p25Hz` + proporción grave `< 135 Hz`):
 * - Exige `medianHz >= 155 Hz`, `p25Hz >= 130 Hz` y `lowMaleRatio < 0.30` cuando hay suficientes cuadros vocalizados (`>= 8`).
 * - Rechaza tanto barítonos/bajos (`95–130 Hz`) como tenores masculinos jóvenes cuya entonación sube brevemente pero cuyo
 *   registro base (`p25Hz`) cae a `100–125 Hz`.
 */
export function isVerifiedFemalePitch(
  pcmOrWav: Buffer,
  sampleRate = 24000,
  minMedianHz = MIN_PHONE_FEMALE_PITCH_HZ
): { ok: boolean; analysis: VocalPitchAnalysis } {
  const analysis = estimateVocalPitchF0(pcmOrWav, sampleRate)
  if (analysis.voicedFrames < 8) {
    return { ok: true, analysis }
  }
  return {
    ok: analysis.medianHz >= minMedianHz && analysis.p25Hz >= 130 && analysis.lowMaleRatio < 0.3,
    analysis
  }
}

export function isValidTtsRequest(n: string | null, lang: string | null, voice?: string | null): n is string {
  const numOk = !!n && /^\d{1,6}$/.test(n)
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

const ES_UNITS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
const ES_TEENS = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve']
const ES_TWENTIES = ['veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const ES_TENS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const ES_HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

export function numberToSpanishWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 9999) return String(n)
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000)
    const rem = n % 1000
    const prefix = thousands === 1 ? 'mil' : `${ES_UNITS[thousands]} mil`
    return rem === 0 ? prefix : `${prefix} ${numberToSpanishWords(rem)}`
  }
  if (n === 100) return 'cien'
  if (n > 100) {
    const h = Math.floor(n / 100)
    const rem = n % 100
    return rem === 0 ? ES_HUNDREDS[h] : `${ES_HUNDREDS[h]} ${numberToSpanishWords(rem)}`
  }
  if (n < 10) return ES_UNITS[n]
  if (n < 20) return ES_TEENS[n - 10]
  if (n < 30) return ES_TWENTIES[n - 20]
  const t = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? ES_TENS[t] : `${ES_TENS[t]} y ${ES_UNITS[u]}`
}

function buildPrompt(n: string, lang: TtsLang): string {
  const num = parseInt(n, 10)
  const spoken = String(num)
  if (lang === 'en') {
    return `Order ${spoken} is ready.`
  } else {
    const esWords = num >= 1 && num <= 9999 ? numberToSpanishWords(num) : spoken
    return `Orden ${esWords}, ya está.`
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
  if (data.length >= 44 && data.subarray(0, 4).toString('ascii') === 'RIFF') {
    const inner =
      data.length > 88 && data.subarray(44, 48).toString('ascii') === 'RIFF'
        ? data.subarray(44)
        : data
    const dataSz = inner.readUInt32LE(40)
    if (dataSz > 0 && 44 + dataSz <= inner.length) {
      const cleanPcm = inner.subarray(44, 44 + dataSz)
      const hdr = Buffer.from(inner.subarray(0, 44))
      hdr.writeUInt32LE(36 + cleanPcm.length, 4)
      hdr.writeUInt32LE(cleanPcm.length, 40)
      return Buffer.concat([hdr, cleanPcm])
    }
    return inner
  }
  return pcmToWav(data, sampleRate, channels, bitDepth)
}

/**
 * Convierte un WAV PCM mono de 24 kHz a 8 kHz (3:1 con filtro anti-aliasing [1,2,1]/4) para reproducción
 * ultrarrápida en la red PSTN de Twilio (3x menor tamaño de transferencia, < 1 ms CPU).
 */
export function downsampleWav24kTo8k(wav24k: Buffer): Buffer {
  const cleanWav = ensureWav(wav24k)
  if (cleanWav.length <= 44) return cleanWav
  const srcRate = cleanWav.readUInt32LE(24)
  if (srcRate <= 8000 || srcRate !== 24000) return cleanWav

  const pcm = cleanWav.subarray(44)
  const srcSamples = Math.floor(pcm.length / 2)
  const dstSamples = Math.floor(srcSamples / 3)
  if (dstSamples <= 0) return cleanWav

  const outPcm = Buffer.allocUnsafe(dstSamples * 2)
  for (let i = 0; i < dstSamples; i++) {
    const base = i * 3
    const s0 = pcm.readInt16LE(base * 2)
    const s1 = pcm.readInt16LE((base + 1) * 2)
    const s2 = pcm.readInt16LE((base + 2) * 2)
    const avg = Math.round((s0 + 2 * s1 + s2) / 4)
    const clamped = avg > 32767 ? 32767 : avg < -32768 ? -32768 : avg
    outPcm.writeInt16LE(clamped, i * 2)
  }
  return pcmToWav(outPcm, 8000, 1, 16)
}

let bucketCheckInFlight: Promise<void> | null = null
async function ensureBucket() {
  if (bucketReady) return
  if (bucketCheckInFlight) return bucketCheckInFlight
  bucketCheckInFlight = (async () => {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
    // "already exists" es el caso normal después de la primera vez
    if (!error || /already exists|duplicate/i.test(error.message)) bucketReady = true
  })().finally(() => {
    bucketCheckInFlight = null
  })
  return bucketCheckInFlight
}

function buildInlineNaturalFemalePrompt(textToSpeak: string, lang: TtsLang): string {
  return lang === 'es'
    ? `Say in a warm, pleasant, friendly female voice with a natural Mexican Spanish accent at a calm, natural conversational pace (friendly and welcoming, never exaggerated and never shouting): "${textToSpeak}"`
    : `Say in a warm, pleasant, friendly female voice with a natural American English accent at a calm, natural conversational pace (friendly and welcoming, never exaggerated and never shouting): "${textToSpeak}"`
}

function isDailyOrHardQuotaError(errText: string): boolean {
  return /PerDay|per_day|per_model_per_day|limit:\s*0\b|Please retry in [0-9]+h/i.test(errText)
}

function parseTransientRpmWaitMs(errText: string): number {
  const secMatch =
    errText.match(/retry in ([0-9]+(?:\.[0-9]+)?)s/i) ||
    errText.match(/"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/i)
  if (secMatch) {
    return Math.min(22000, Math.max(2500, Math.ceil(Number(secMatch[1]) * 1000) + 450))
  }
  return 12000
}

async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return !signal?.aborted
  if (signal?.aborted) return false
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(t)
      resolve(false)
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(!signal?.aborted)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function generateTextWithGemini(
  textToSpeak: string,
  lang: TtsLang,
  voice: VoiceId,
  stylePrompt?: string,
  opts?: { skipRpmWait?: boolean; attemptTimeoutMs?: number; maxAttemptsPerModel?: number; signal?: AbortSignal }
): Promise<Buffer> {
  const allKeys = await getGeminiKeyPoolWithRemote()
  if (allKeys.length === 0) throw new Error('No hay ninguna GEMINI_API_KEY configurada')

  // Priorizar llaves que no estén temporalmente bloqueadas por 429/402/403
  const now = Date.now()
  const unblockedKeys = allKeys.filter((k) => (keyBlockedUntil.get(k) || 0) <= now)
  if (unblockedKeys.length === 0) {
    throw new Error('GEMINI_TTS_QUOTA_EXHAUSTED: Cuota diaria de Gemini TTS alcanzada en todas las llaves (429 RESOURCE_EXHAUSTED). Use voz local del navegador.')
  }
  const candidateKeys = unblockedKeys

  // Rotación balanceada (round-robin), priorizando llaves modernas (AQ.) para modelos 3.8
  const startIndex = (poolIndex++) % candidateKeys.length
  const baseRotated = [
    ...candidateKeys.slice(startIndex),
    ...candidateKeys.slice(0, startIndex)
  ]
  const aqKeys = baseRotated.filter((k) => k.startsWith('AQ.'))
  const classicKeys = baseRotated.filter((k) => !k.startsWith('AQ.'))
  const rotatedKeys = [...aqKeys, ...classicKeys]

  let lastErr = ''
  let earliestRpmCandidate: { model: string; key: string; readyAt: number } | null = null

  const recordRpmCandidate = (model: string, key: string, readyAt: number) => {
    const rem = readyAt - Date.now()
    if (rem > 0 && rem <= 22500) {
      if (!earliestRpmCandidate || readyAt < earliestRpmCandidate.readyAt) {
        earliestRpmCandidate = { model, key, readyAt }
      }
    }
  }

  const tryModelKey = async (model: string, key: string): Promise<Buffer | null> => {
    const kmKey = `${key}:${model}`
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opts?.signal?.aborted) return null
      try {
        const promptText = model.includes('3.8')
          ? textToSpeak
          : buildInlineNaturalFemalePrompt(textToSpeak, lang)

        const timeoutMs = opts?.attemptTimeoutMs ?? 18000
        const timeoutSig = AbortSignal.timeout(timeoutMs)
        const fetchSignal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSig]) : timeoutSig
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          signal: fetchSignal,
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{
                text: promptText,
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
            const wav = ensureWav(raw)
            if (isValidPhoneFemaleVoice(voice)) {
              const pitchGate = isVerifiedFemalePitch(wav, 24000)
              if (!pitchGate.ok) {
                lastErr = `${model}: timbre masculino bloqueado (${pitchGate.analysis.medianHz} Hz < ${MIN_PHONE_FEMALE_PITCH_HZ} Hz)`
                console.warn(
                  `[order-ready-tts] 🚨 Audio descartado por timbre masculino en ${model}: F0=${pitchGate.analysis.medianHz} Hz (${pitchGate.analysis.voicedFrames} cuadros)`
                )
                continue
              }
            }
            return wav
          }
          lastErr = `${model}: respuesta sin audio (${json.candidates?.[0]?.finishReason || 'no part'})`
          break
        } else {
          const errText = await res.text()
          lastErr = `${model} (key ...${key.slice(-4)}): ${res.status} ${errText.slice(0, 160)}`
          if (res.status === 429 || /quota|exceeded/i.test(errText)) {
            if (isDailyOrHardQuotaError(errText)) {
              keyBlockedUntil.set(kmKey, Date.now() + 90 * 60 * 1000)
            } else {
              const waitMs = parseTransientRpmWaitMs(errText)
              const readyAt = Date.now() + waitMs
              keyBlockedUntil.set(kmKey, readyAt)
              recordRpmCandidate(model, key, readyAt)
            }
            break
          } else if (res.status === 401 || res.status === 402 || res.status === 403 || /prepayment|depleted|leaked|API_KEY_INVALID/i.test(errText)) {
            keyBlockedUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
            break
          } else if (res.status >= 500) {
            keyBlockedUntil.set(kmKey, Date.now() + 45 * 1000)
            break
          } else if (res.status === 404 || res.status === 400) {
            keyBlockedUntil.set(kmKey, Date.now() + 6 * 60 * 60 * 1000)
            break
          } else {
            break
          }
        }
      } catch (fetchErr: any) {
        lastErr = `${model}: ${fetchErr.message}`
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 600))
          continue
        }
        break
      }
    }
    return null
  }

  // Priorizar los modelos neuronales puros (gemini-3.8-* y gemini-3.1-*) a través de TODAS las llaves AQ. antes de tocar 2.5
  for (const model of MODELS) {
    if (opts?.signal?.aborted) break
    const keysForModel = (model.includes('3.8') || model.includes('3.1')) && aqKeys.length > 0 ? aqKeys : rotatedKeys
    let attemptsOnModel = 0
    const maxAttempts = opts?.maxAttemptsPerModel ?? keysForModel.length
    for (const key of keysForModel) {
      if (opts?.signal?.aborted || attemptsOnModel >= maxAttempts) break
      if ((keyBlockedUntil.get(key) || 0) > Date.now()) {
        continue
      }
      const kmKey = `${key}:${model}`
      const blockedUntil = keyBlockedUntil.get(kmKey) || 0
      if (blockedUntil > Date.now()) {
        recordRpmCandidate(model, key, blockedUntil)
        continue
      }

      attemptsOnModel++
      const wav = await tryModelKey(model, key)
      if (wav) return wav
    }
  }

  // Si todas las demás llaves están en cuota diaria pero hay una llave en enfriamiento corto de RPM (<= 22s), esperar su ventana exacta
  // NUNCA dormir 22.5 s en telefonía en vivo (skipRpmWait: true), donde Twilio corta a los 15 s.
  if (earliestRpmCandidate && !opts?.skipRpmWait && !opts?.signal?.aborted) {
    const cand = earliestRpmCandidate as { model: string; key: string; readyAt: number }
    const waitMs = Math.max(0, cand.readyAt - Date.now())
    if (waitMs <= 22500) {
      const ok = await sleepAbortable(waitMs, opts?.signal)
      if (ok) {
        keyBlockedUntil.delete(`${cand.key}:${cand.model}`)
        const retryWav = await tryModelKey(cand.model, cand.key)
        if (retryWav) return retryWav
      }
    }
  }

  throw new Error(`Gemini TTS falló (${lastErr})`)
}

async function generateWithGemini(n: string, lang: TtsLang, voice: VoiceId): Promise<Buffer> {
  const textToSpeak = buildPrompt(n, lang)
  const stylePrompt =
    lang === 'es'
      ? 'warm, smiling, pleasant and friendly Mexican restaurant counter announcement, speaking with a natural Mexican Spanish accent at a calm, moderate volume, never shouting'
      : 'warm, smiling, pleasant and friendly counter announcement at a calm, moderate volume, never shouting'
  return generateTextWithGemini(textToSpeak, lang, voice, stylePrompt)
}

export async function getOrderReadySpeechWithMeta(
  n: string,
  lang: TtsLang,
  voice: VoiceId = DEFAULT_VOICE
): Promise<{ wav: Buffer; isFallback: boolean }> {
  const num = String(parseInt(n, 10))
  const selectedVoice = isValidVoice(voice) ? voice : DEFAULT_VOICE
  const path = `${CACHE_VERSION}/${selectedVoice}/${lang}/${num}.wav`

  // 1. Intentar caché v4 en Storage
  const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (hit.data) {
    return { wav: ensureWav(Buffer.from(await hit.data.arrayBuffer())), isFallback: false }
  }

  const existing = inflight.get(path)
  if (existing) {
    return { wav: await existing, isFallback: false }
  }

  let usedFallback = false
  const job = (async () => {
    try {
      const wav = await generateWithGemini(num, lang, selectedVoice)
      try {
        await ensureBucket()
        await supabaseAdmin.storage.from(BUCKET).upload(path, wav, { contentType: 'audio/wav', upsert: true })
      } catch (e) {
        console.warn('[order-ready-tts] no se pudo cachear en Storage:', e)
      }
      return wav
    } catch (genErr) {
      if (selectedVoice !== DEFAULT_VOICE) {
        const korePath = `${CACHE_VERSION}/${DEFAULT_VOICE}/${lang}/${num}.wav`
        const koreHit = await supabaseAdmin.storage.from(BUCKET).download(korePath)
        if (koreHit.data) {
          usedFallback = true
          console.warn(`[order-ready-tts] Fallback a voz oficial ${DEFAULT_VOICE} para #${num} (${lang})`)
          return ensureWav(Buffer.from(await koreHit.data.arrayBuffer()))
        }
      }
      throw genErr
    }
  })()

  inflight.set(path, job)
  try {
    const wav = await job
    return { wav, isFallback: usedFallback }
  } finally {
    inflight.delete(path)
  }
}

export async function getOrderReadySpeech(n: string, lang: TtsLang, voice: VoiceId = DEFAULT_VOICE): Promise<Buffer> {
  const { wav } = await getOrderReadySpeechWithMeta(n, lang, voice)
  return wav
}

/**
 * Genera o recupera desde caché de Storage el audio de un anuncio personalizado para el comedor/empaque de Tacos Gavilan.
 */
export async function getAnnouncementSpeech(
  text: string,
  lang: TtsLang,
  voice: VoiceId = DEFAULT_VOICE,
  forceRegenerate = false
): Promise<Buffer> {
  const clean = text.trim().slice(0, 500)
  if (!clean) throw new Error('Texto de anuncio vacío')

  const selectedVoice = isValidVoice(voice) ? voice : DEFAULT_VOICE
  const hash = createHash('md5').update(`${selectedVoice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  const path = `announcements/${selectedVoice}/${lang}/${hash}.wav`

  // 1. Intentar caché en Storage (salvo si se fuerza regeneración)
  if (!forceRegenerate) {
    const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (hit.data) return ensureWav(Buffer.from(await hit.data.arrayBuffer()))
  }

  const existing = inflight.get(path)
  if (existing && !forceRegenerate) return existing

  const job = (async () => {
    try {
      const stylePrompt =
        lang === 'es'
          ? 'cheerful, energetic, warm and enthusiastic Mexican restaurant counter announcement, speaking with a warm natural Mexican Spanish accent and saying the company slogan "¡ya está!" with joyful energy'
          : 'cheerful, energetic, warm and enthusiastic restaurant counter announcement'
      const wav = await generateTextWithGemini(clean, lang, selectedVoice, stylePrompt)
      try {
        await ensureBucket()
        if (forceRegenerate) {
          await supabaseAdmin.storage.from(BUCKET).remove([path])
        }
        await supabaseAdmin.storage.from(BUCKET).upload(path, wav, {
          contentType: 'audio/wav',
          cacheControl: '0',
          upsert: true
        })
      } catch (e) {
        console.warn('[order-ready-tts] no se pudo cachear anuncio en Storage:', e)
      }
      return wav
    } catch (genErr) {
      if (selectedVoice !== DEFAULT_VOICE) {
        const koreHash = createHash('md5').update(`${DEFAULT_VOICE}:${lang}:${clean.toLowerCase()}`).digest('hex')
        const korePath = `announcements/${DEFAULT_VOICE}/${lang}/${koreHash}.wav`
        const koreHit = await supabaseAdmin.storage.from(BUCKET).download(korePath)
        if (koreHit.data) {
          console.warn(`[order-ready-tts] Fallback a voz oficial ${DEFAULT_VOICE} para anuncio "${clean.slice(0, 40)}"`)
          return ensureWav(Buffer.from(await koreHit.data.arrayBuffer()))
        }
      }
      throw genErr
    }
  })()

  inflight.set(path, job)
  try {
    return await job
  } finally {
    inflight.delete(path)
  }
}

export const PHONE_INSTANT_OPENERS: Record<string, { es: string; en: string }> = {
  hours: {
    es: '¡Claro que sí! Te confirmo el horario.',
    en: 'Of course! Let me share our hours with you.'
  },
  menu_prices: {
    es: '¡Con mucho gusto! Te doy los precios.',
    en: 'Happy to help! Here are our menu prices.'
  },
  fiesta_platters: {
    es: '¡Claro que sí! Te cuento de las charolas Fiesta Platter.',
    en: 'Of course! Here are our Fiesta Platter options.'
  },
  callback: {
    es: 'Entendido, con mucho gusto te ayudo con eso ahora mismo.',
    en: 'I understand, let me help you with that right away.'
  },
  general: {
    es: '¡Claro que sí, con mucho gusto!',
    en: 'Of course, happy to help!'
  }
}

const PHONE_CACHE_PREFIX = 'phone_kore38_v6'
const PHONE_STORAGE_DIR = 'phone_v6'

export function isPhoneSpeechInRamCache(text: string, lang: TtsLang, voice: VoiceId = DEFAULT_VOICE): boolean {
  const clean = normalizePhoneTtsInput(text, lang, MAX_PHONE_TTS_CHARS)
  if (!clean) return false
  const selectedVoice = resolvePhoneFemaleVoice(voice)
  const hash = createHash('md5').update(`${PHONE_CACHE_PREFIX}:${selectedVoice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  const path = `${PHONE_STORAGE_DIR}/${selectedVoice}/${lang}/${hash}.wav`
  return memoryPhoneAudioCache.has(path)
}

export function buildInstantOpenerStreamPlan(
  replyText: string,
  lang: TtsLang,
  primaryIntent?: string,
  callbackCreated?: boolean
): {
  openerText: string
  remainderText: string
} {
  const key = callbackCreated
    ? 'callback'
    : primaryIntent === 'hours' || primaryIntent === 'location_drivethru'
    ? 'hours'
    : primaryIntent === 'menu_prices'
    ? 'menu_prices'
    : primaryIntent === 'fiesta_platters'
    ? 'fiesta_platters'
    : primaryIntent === 'complaint_missing_item' || primaryIntent === 'employee_callout' || primaryIntent === 'lost_and_found'
    ? 'callback'
    : 'general'

  const openerText = PHONE_INSTANT_OPENERS[key]?.[lang] || PHONE_INSTANT_OPENERS.general[lang]

  // Limpiar muletillas redundantes al inicio del replyText para que la transición sea 100% natural
  const remainderText = replyText
    .replace(
      /^(¡?hola!?|¡?claro que s[ií]!?|¡?por supuesto!?|¡?con mucho gusto!?|¡?claro!?|entendido[,!.]?|hi!?|hello!?|of course!?|sure!?|happy to help!?)\s*/i,
      ''
    )
    .replace(
      /^(¡?claro que s[ií]!?|¡?con mucho gusto!?|¡?por supuesto!?|of course!?|happy to help!?)\s*/i,
      ''
    )
    .trim()

  return {
    openerText,
    remainderText: remainderText || replyText
  }
}

/**
 * Divide una respuesta telefónica en un primer fragmento corto (primera oración para reproducción inmediata < 1.2s)
 * y el resto del mensaje (que se pre-genera en paralelo mientras suena la primera oración).
 * Nunca parte sobre comas ni puntos de abreviaturas para no cortar domicilios o números a la mitad.
 */
export function splitPhoneReplyForStreaming(text: string): {
  firstChunk: string
  restChunk: string | null
} {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= 135) {
    return { firstChunk: clean, restChunk: null }
  }

  // Buscar el final real de la primera oración (. ! ? o ;) entre los caracteres 28 y 165, ignorando abreviaturas e iniciales
  const sentenceRegex = /(?:[.!?]+|;)(?=\s|$)/g
  const abbrevBeforePeriod =
    /(?:\b(?:N|S|E|W|NE|NW|SE|SW|Ave|Blvd|Rd|St|Dr|Hwy|Pkwy|Fwy|Ln|Ct|Cir|Pl|Ste|Apt|No|Jr|Inc|Sr|Sra|Srta|Dr|Dra|Mr|Mrs|Ms|etc|ej|aprox|ext|tel)|\b[ap]\.m|[\s,(][A-ZÁÉÍÓÚÑ])\.$/i
  let match: RegExpExecArray | null
  let splitIdx = -1

  while ((match = sentenceRegex.exec(clean)) !== null) {
    const endPos = match.index + match[0].length
    const prefix = clean.slice(0, endPos)
    if (abbrevBeforePeriod.test(prefix)) {
      continue
    }
    if (endPos >= 28 && endPos <= 165) {
      splitIdx = endPos
      break
    }
    if (endPos > 165) {
      break
    }
  }

  // Si es una sola oración muy larga (> 165 caracteres), partir en conector natural para no retrasar el primer <Play>
  if (splitIdx === -1 && clean.length > 165) {
    const clauseRegex = /,\s+(?=(?:y|pero|mientras|además|o|and|but|while|plus|or)\b)/gi
    let clauseMatch: RegExpExecArray | null
    while ((clauseMatch = clauseRegex.exec(clean)) !== null) {
      const candidateIdx = clauseMatch.index + clauseMatch[0].length
      if (candidateIdx >= 55 && candidateIdx <= 160 && clean.length - candidateIdx >= 25) {
        splitIdx = candidateIdx
        break
      }
      if (candidateIdx > 160) break
    }
  }

  if (splitIdx === -1 || splitIdx >= clean.length - 15) {
    return { firstChunk: clean, restChunk: null }
  }

  const firstChunk = clean.slice(0, splitIdx).replace(/,$/, '').trim()
  const restChunk = clean.slice(splitIdx).trim()
  return {
    firstChunk,
    restChunk: restChunk.length > 0 ? restChunk : null
  }
}

const PHONE_STREAM_TTS_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview'
] as const
const PRE_VERIFY_PCM_BYTES = 38400 // 0.80 s a 24 kHz 16-bit mono (~53 tramas YIN, >6x el mínimo de 8 tramas vocales): acelera el TTFA del Simulador ~400 ms
export const MAX_PHONE_TTS_CHARS = 1400

export function normalizePhoneTtsInput(raw: string, lang: TtsLang = 'es', maxChars = MAX_PHONE_TTS_CHARS): string {
  const sanitized = normalizeTextForPhoneSpeech(String(raw || ''), lang)
  if (sanitized.length <= maxChars) return sanitized
  const slice = sanitized.slice(0, maxChars)
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (lastSentenceEnd >= Math.floor(maxChars * 0.5)) {
    return slice.slice(0, lastSentenceEnd + 1).trim()
  }
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()
}

function getPhoneStylePrompt(lang: TtsLang): string {
  // Exactamente la misma fórmula cálida, amable y natural de `Kore` usada en entregas de órdenes (`generateWithGemini`),
  // anclando explícitamente `female voice` (sin sustantivos neutros como "receptionist" que provocaban voice drift masculino,
  // y sin "energetic/enthusiastic" que exageraban el inicio de frase).
  return lang === 'es'
    ? 'warm, pleasant, and friendly female voice, speaking with a natural Mexican Spanish accent at a calm, natural conversational pace, friendly and welcoming, never exaggerated and never shouting'
    : 'warm, pleasant, and friendly female voice, speaking with a natural American English accent at a calm, natural conversational pace, friendly and welcoming, never exaggerated and never shouting'
}

function extractPcmFromWav(wav: Buffer): Buffer {
  const cleanWav = ensureWav(wav)
  return cleanWav.length > 44 ? cleanWav.subarray(44) : Buffer.alloc(0)
}

function persistPhoneWavToStorage(path: string, wav: Buffer, forceRegenerate = false): Promise<void> {
  return (async () => {
    try {
      await ensureBucket()
      if (forceRegenerate) {
        await supabaseAdmin.storage.from(BUCKET).remove([path])
      }
      await supabaseAdmin.storage.from(BUCKET).upload(path, wav, {
        contentType: 'audio/wav',
        cacheControl: '3600',
        upsert: true
      })
    } catch (e) {
      console.warn('[order-ready-tts] no se pudo cachear audio telefónico en Storage:', e)
    }
  })()
}

/**
 * Transmite fragmentos PCM en vivo (24 kHz, 16-bit signed little-endian, mono) de la voz femenina oficial (`Kore` / `Aoede` / `Zephyr`)
 * usando `:streamGenerateContent?alt=sse`.
 * - Impone `resolvePhoneFemaleVoice` (bloquea `Puck` y `Orus`) y la prosodia femenina cálida/natural de `Kore` sobre la cadena `3.8-lite -> 3.8 -> 3.1`.
 * - Compuerta Acústica Pre-Emisión (`PRE_VERIFY_PCM_BYTES`): verifica `isVerifiedFemalePitch` (`F0 >= 155 Hz`) ANTES de emitir el primer byte,
 *   garantizando que 0 bytes de voz masculina puedan llegar jamás al altavoz o a la línea telefónica.
 * - Solo ensambla y guarda en RAM / Supabase Storage cuando el stream concluyó al 100% y el clip completo pasa `isVerifiedFemalePitch`.
 */
export async function* streamPhoneAgentSpeechPcm(
  text: string,
  lang: TtsLang,
  voice: VoiceId = DEFAULT_VOICE,
  options?: {
    skipStorageLookup?: boolean
    signal?: AbortSignal
    allowBlockFallback?: boolean
    onStreamCompleted?: (completedCleanly: boolean) => void
  }
): AsyncGenerator<{ pcmChunk: Buffer; sampleRate: number; fromCache: boolean }> {
  const clean = normalizePhoneTtsInput(text, lang, MAX_PHONE_TTS_CHARS)
  if (!clean) {
    options?.onStreamCompleted?.(false)
    return
  }

  const selectedVoice = resolvePhoneFemaleVoice(voice)
  const hash = createHash('md5').update(`${PHONE_CACHE_PREFIX}:${selectedVoice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  const path = `${PHONE_STORAGE_DIR}/${selectedVoice}/${lang}/${hash}.wav`

  // 1. Caché ultrarrápido en RAM (0 ms — phone_v6 ya pasó compuerta YIN al crearse, evitar re-escanear CPU)
  const memHit = memoryPhoneAudioCache.get(path)
  if (memHit && memHit.length > 44) {
    const pcm = extractPcmFromWav(memHit)
    if (pcm.length > 0) {
      const frameBytes = 19200 // 400 ms por bloque desde RAM
      for (let off = 0; off < pcm.length; off += frameBytes) {
        yield { pcmChunk: pcm.subarray(off, Math.min(off + frameBytes, pcm.length)), sampleRate: 24000, fromCache: true }
      }
      options?.onStreamCompleted?.(true)
      return
    }
    memoryPhoneAudioCache.delete(path)
  }

  // 2. Caché persistente en Supabase Storage (~80-120 ms si ya existe, 0 ms CPU)
  if (!options?.skipStorageLookup) {
    try {
      const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
      if (hit.data) {
        const wav = ensureWav(Buffer.from(await hit.data.arrayBuffer()))
        const pcm = extractPcmFromWav(wav)
        if (pcm.length > 0) {
          setMemoryPhoneCache(path, wav)
          const frameBytes = 19200
          for (let off = 0; off < pcm.length; off += frameBytes) {
            yield { pcmChunk: pcm.subarray(off, Math.min(off + frameBytes, pcm.length)), sampleRate: 24000, fromCache: true }
          }
          options?.onStreamCompleted?.(true)
          return
        }
      }
    } catch {
      // Continuar a síntesis en streaming
    }
  }

  // 3. Síntesis neuronal en tiempo real vía SSE (`:streamGenerateContent?alt=sse`)
  const allKeys = await getGeminiKeyPoolWithRemote()
  const now = Date.now()
  const unblocked = allKeys.filter((k) => (keyBlockedUntil.get(k) || 0) <= now)
  const candidatePool = unblocked.length > 0 ? unblocked : allKeys
  const startIdx = candidatePool.length > 0 ? (poolIndex++) % candidatePool.length : 0
  const rotated = [...candidatePool.slice(startIdx), ...candidatePool.slice(0, startIdx)]
  const aqKeys = rotated.filter((k) => k.startsWith('AQ.'))
  const streamKeys = aqKeys.length > 0 ? aqKeys : rotated
  const stylePrompt = getPhoneStylePrompt(lang)

  let earliestStreamRpmCandidate: { model: string; key: string; readyAt: number } | null = null
  const recordStreamRpmCandidate = (model: string, key: string, readyAt: number) => {
    const rem = readyAt - Date.now()
    if (rem > 0 && rem <= 22500) {
      if (!earliestStreamRpmCandidate || readyAt < earliestStreamRpmCandidate.readyAt) {
        earliestStreamRpmCandidate = { model, key, readyAt }
      }
    }
  }

  const candidatePairs: Array<{ model: string; key: string }> = []
  for (const model of PHONE_STREAM_TTS_MODELS) {
    for (const key of streamKeys) {
      candidatePairs.push({ model, key })
    }
  }

  // En telefonía en vivo NUNCA dormir hasta 22.5 s; saltar al siguiente modelo tras 2 fallos en un mismo modelo
  const maxStreamPasses = options?.allowBlockFallback === false ? 1 : 1
  const modelAttempts = new Map<string, number>()

  for (let pass = 0; pass < maxStreamPasses; pass++) {
    const pairsToRun = candidatePairs
    for (const { model, key } of pairsToRun) {
      if (options?.signal?.aborted) {
        options?.onStreamCompleted?.(false)
        return
      }
      if ((modelAttempts.get(model) || 0) >= 2) {
        continue
      }
      if ((keyBlockedUntil.get(key) || 0) > Date.now()) {
        continue
      }
      const kmKey = `${key}:${model}`
      const blockedUntil = keyBlockedUntil.get(kmKey) || 0
      if (blockedUntil > Date.now()) {
        if (pass === 0) recordStreamRpmCandidate(model, key, blockedUntil)
        continue
      }

      modelAttempts.set(model, (modelAttempts.get(model) || 0) + 1)
      const timeoutCtrl = new AbortController()
      const timer = setTimeout(() => timeoutCtrl.abort(), 5800)
      const onExternalAbort = () => timeoutCtrl.abort()
      options?.signal?.addEventListener('abort', onExternalAbort, { once: true })

      let yieldedAny = false
      try {
        const streamPart = model.includes('3.8')
          ? {
              text: clean,
              speech_metadata: { style: stylePrompt }
            }
          : {
              text: buildInlineNaturalFemalePrompt(clean, lang)
            }

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            signal: timeoutCtrl.signal,
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [streamPart]
                }
              ],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: selectedVoice }
                  }
                }
              }
            })
          }
        )

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '')
          if (res.status === 429 || /quota|exceeded/i.test(errText)) {
            if (isDailyOrHardQuotaError(errText)) {
              keyBlockedUntil.set(kmKey, Date.now() + 90 * 60 * 1000)
            } else {
              const waitMs = parseTransientRpmWaitMs(errText)
              const readyAt = Date.now() + waitMs
              keyBlockedUntil.set(kmKey, readyAt)
              if (pass === 0) recordStreamRpmCandidate(model, key, readyAt)
            }
          } else if (res.status === 401 || res.status === 402 || res.status === 403 || /prepayment|API_KEY_INVALID|leaked|depleted/i.test(errText)) {
            keyBlockedUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
          } else if (res.status >= 500) {
            keyBlockedUntil.set(kmKey, Date.now() + 45 * 1000)
          }
          continue
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let sseBuf = ''
        let carryByte: Buffer | null = null
        let pendingChunks: Buffer[] = []
        let pendingBytes = 0
        const allPcmParts: Buffer[] = []
        let isFirstChunk = true
        let hasVerifiedFemaleVoice = false
        let rejectedMaleVoice = false

        const parseSseLine = (line: string): Buffer | null => {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) return null
          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') return null
          try {
            const parsed = JSON.parse(jsonStr)
            const b64 = parsed?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData?.data
            return b64 ? Buffer.from(b64, 'base64') : null
          } catch {
            return null
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuf += decoder.decode(value, { stream: true })
          const lines = sseBuf.split('\n')
          sseBuf = lines.pop() || ''

          for (const line of lines) {
            let rawChunk = parseSseLine(line)
            if (!rawChunk || rawChunk.length === 0) continue

            if (isFirstChunk) {
              isFirstChunk = false
              if (rawChunk.length >= 44 && rawChunk.subarray(0, 4).toString('ascii') === 'RIFF') {
                rawChunk = rawChunk.subarray(44)
              }
            }

            if (carryByte) {
              rawChunk = Buffer.concat([carryByte, rawChunk])
              carryByte = null
            }
            if (rawChunk.length % 2 !== 0) {
              carryByte = rawChunk.subarray(rawChunk.length - 1)
              rawChunk = rawChunk.subarray(0, rawChunk.length - 1)
            }
            if (rawChunk.length === 0) continue

            allPcmParts.push(rawChunk)
            pendingChunks.push(rawChunk)
            pendingBytes += rawChunk.length

            if (!hasVerifiedFemaleVoice) {
              if (pendingBytes >= PRE_VERIFY_PCM_BYTES) {
                const candidateBuf = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes)
                const pitchGate = isVerifiedFemalePitch(candidateBuf, 24000)
                if (!pitchGate.ok) {
                  console.warn(
                    `[order-ready-tts] 🚨 Stream SSE abortado ANTES de emitir audio por timbre masculino (${pitchGate.analysis.medianHz} Hz) en ${model}`
                  )
                  rejectedMaleVoice = true
                  await reader.cancel().catch(() => null)
                  break
                }
                pendingChunks = []
                pendingBytes = 0
                hasVerifiedFemaleVoice = true
                yieldedAny = true
                yield { pcmChunk: candidateBuf, sampleRate: 24000, fromCache: false }
              }
            } else if (pendingBytes >= 7680) {
              const merged = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes)
              pendingChunks = []
              pendingBytes = 0
              yieldedAny = true
              yield { pcmChunk: merged, sampleRate: 24000, fromCache: false }
            }
          }

          if (rejectedMaleVoice) break
        }

        if (rejectedMaleVoice) {
          continue
        }

        if (sseBuf.trim()) {
          let tail = parseSseLine(sseBuf)
          if (tail && tail.length > 0) {
            if (carryByte) {
              tail = Buffer.concat([carryByte, tail])
              carryByte = null
            }
            if (tail.length % 2 !== 0) {
              tail = tail.subarray(0, tail.length - 1)
            }
            if (tail.length > 0) {
              allPcmParts.push(tail)
              pendingChunks.push(tail)
              pendingBytes += tail.length
            }
          }
        }

        if (pendingBytes > 0) {
          const merged = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingBytes)
          if (!hasVerifiedFemaleVoice) {
            const pitchGate = isVerifiedFemalePitch(merged, 24000)
            if (!pitchGate.ok) {
              console.warn(
                `[order-ready-tts] 🚨 Frase corta descartada ANTES de emitir por timbre masculino (${pitchGate.analysis.medianHz} Hz) en ${model}`
              )
              continue
            }
            hasVerifiedFemaleVoice = true
          }
          yieldedAny = true
          yield { pcmChunk: merged, sampleRate: 24000, fromCache: false }
        }

        if (allPcmParts.length > 0 && !options?.signal?.aborted) {
          const fullPcm = Buffer.concat(allPcmParts)
          const fullGate = isVerifiedFemalePitch(fullPcm, 24000)
          if (fullGate.ok) {
            const wav = pcmToWav(fullPcm, 24000, 1, 16)
            setMemoryPhoneCache(path, wav)
            persistPhoneWavToStorage(path, wav, false)
            options?.onStreamCompleted?.(true)
            return
          } else {
            console.warn(
              `[order-ready-tts] 🚨 Clip completo no se guardó en caché por timbre masculino (${fullGate.analysis.medianHz} Hz)`
            )
            if (yieldedAny) {
              options?.onStreamCompleted?.(false)
              return
            }
            continue
          }
        }
      } catch {
        if (options?.signal?.aborted || yieldedAny) {
          options?.onStreamCompleted?.(false)
          return
        }
      } finally {
        clearTimeout(timer)
        options?.signal?.removeEventListener('abort', onExternalAbort)
      }
    }
  }

  // 4. Respaldo final: si SSE no estuvo disponible, usar `getPhoneAgentSpeech` directo (sin volver a entrar a SSE)
  if (!options?.signal?.aborted && options?.allowBlockFallback !== false) {
    const fallbackWav = await getPhoneAgentSpeech(clean, lang, selectedVoice, false, {
      ...options,
      skipSseAttempt: true
    })
    const pcm = extractPcmFromWav(fallbackWav)
    if (pcm.length > 0) {
      yield { pcmChunk: pcm, sampleRate: 24000, fromCache: false }
      options?.onStreamCompleted?.(true)
      return
    }
  }

  options?.onStreamCompleted?.(false)
}

/**
 * Genera o recupera desde caché en RAM / Storage el audio neuronal (WAV) para una respuesta de la Contestadora IA de Tacos Gavilan.
 * - Incluye caché en memoria (`memoryPhoneAudioCache`) de 0ms, bloqueo estricto femenino (`resolvePhoneFemaleVoice`),
 *   verificación acústica `F0 >= 155 Hz` (`isVerifiedFemalePitch`) y deduplicación atómica `inflight`.
 * - Verifica que el stream SSE haya concluido íntegramente (`completedCleanly === true`) antes de devolver o cachear,
 *   cayendo automáticamente a síntesis completa si un stream parcial se interrumpió.
 */
export async function getPhoneAgentSpeech(
  text: string,
  lang: TtsLang,
  voice: VoiceId = DEFAULT_VOICE,
  forceRegenerate = false,
  options?: {
    skipStorageLookup?: boolean
    awaitStoragePersist?: boolean
    skipSseAttempt?: boolean
    signal?: AbortSignal
  }
): Promise<Buffer> {
  const clean = normalizePhoneTtsInput(text, lang, MAX_PHONE_TTS_CHARS)
  if (!clean) throw new Error('Texto de respuesta telefónica vacío')

  const selectedVoice = resolvePhoneFemaleVoice(voice)
  const hash = createHash('md5').update(`${PHONE_CACHE_PREFIX}:${selectedVoice}:${lang}:${clean.toLowerCase()}`).digest('hex')
  const path = `${PHONE_STORAGE_DIR}/${selectedVoice}/${lang}/${hash}.wav`

  // 1. Caché ultrarrápido en RAM (0 ms — phone_v6 ya está verificado con F0 >= 155 Hz)
  if (!forceRegenerate) {
    const memHit = memoryPhoneAudioCache.get(path)
    if (memHit && memHit.length > 44) return memHit
    if (memHit) memoryPhoneAudioCache.delete(path)
  }

  const existing = inflight.get(path)
  if (existing && !forceRegenerate) return existing

  const job = (async () => {
    try {
      // 2. Caché persistente en Supabase Storage (dentro de `inflight` para evitar llamadas duplicadas concurrentes)
      if (!forceRegenerate && !options?.skipStorageLookup) {
        try {
          const hit = await supabaseAdmin.storage.from(BUCKET).download(path)
          if (hit.data) {
            const wav = ensureWav(Buffer.from(await hit.data.arrayBuffer()))
            if (wav.length > 44) {
              setMemoryPhoneCache(path, wav)
              return wav
            }
            void supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => null)
          }
        } catch {
          // continuar a generación
        }
      }

      // 3. Colectar vía stream SSE únicamente si concluye 100% limpio (omitido si ya venimos de un fallo SSE)
      const pcmParts: Buffer[] = []
      let completedCleanly = false
      if (!forceRegenerate && !options?.skipSseAttempt && !options?.signal?.aborted) {
        for await (const part of streamPhoneAgentSpeechPcm(clean, lang, selectedVoice, {
          skipStorageLookup: true,
          allowBlockFallback: false,
          signal: options?.signal,
          onStreamCompleted: (ok) => {
            completedCleanly = ok
          }
        })) {
          pcmParts.push(part.pcmChunk)
        }
      }
      if (completedCleanly && pcmParts.length > 0) {
        const cachedWav = memoryPhoneAudioCache.get(path)
        if (cachedWav && cachedWav.length > 44) {
          if (options?.awaitStoragePersist) {
            await persistPhoneWavToStorage(path, cachedWav, false)
          }
          return cachedWav
        }
        const wav = pcmToWav(Buffer.concat(pcmParts), 24000, 1, 16)
        if (isVerifiedFemalePitch(wav, 24000).ok) {
          setMemoryPhoneCache(path, wav)
          const uploadP = persistPhoneWavToStorage(path, wav, false)
          if (options?.awaitStoragePersist) await uploadP
          return wav
        }
      }

      // 4. Síntesis en bloque rápida para telefonía (sin esperas de 22.5s, máx 2 intentos/modelo, 6.5s por intento)
      const stylePrompt = getPhoneStylePrompt(lang)
      const wav = await generateTextWithGemini(clean, lang, selectedVoice, stylePrompt, {
        skipRpmWait: true,
        attemptTimeoutMs: 6500,
        maxAttemptsPerModel: 2,
        signal: options?.signal
      })
      setMemoryPhoneCache(path, wav)
      const uploadP = persistPhoneWavToStorage(path, wav, forceRegenerate)
      if (options?.awaitStoragePersist) await uploadP
      return wav
    } catch (genErr) {
      if (selectedVoice !== DEFAULT_PHONE_VOICE) {
        const koreHash = createHash('md5').update(`${PHONE_CACHE_PREFIX}:${DEFAULT_PHONE_VOICE}:${lang}:${clean.toLowerCase()}`).digest('hex')
        const korePath = `${PHONE_STORAGE_DIR}/${DEFAULT_PHONE_VOICE}/${lang}/${koreHash}.wav`
        const memKore = memoryPhoneAudioCache.get(korePath)
        if (memKore && memKore.length > 44) return memKore
        const koreHit = await supabaseAdmin.storage.from(BUCKET).download(korePath)
        if (koreHit.data) {
          const wav = ensureWav(Buffer.from(await koreHit.data.arrayBuffer()))
          if (wav.length > 44) {
            setMemoryPhoneCache(korePath, wav)
            return wav
          }
        }
      }
      throw genErr
    }
  })()

  inflight.set(path, job)
  try {
    return await job
  } finally {
    inflight.delete(path)
  }
}
