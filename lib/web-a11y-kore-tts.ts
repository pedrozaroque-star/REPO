/**
 * @module lib/web-a11y-kore-tts
 * @description Motor backend de síntesis neuronal femenina (`Kore`) para el lector de Accesibilidad Web
 * oficial de Tacos Gavilan (`tacosgavilan.com` y visor ejecutivo `/nueva-web`).
 *
 * @businessRules
 * - **Voz Oficial Única Femenina (`Kore`)**: Utiliza exclusivamente `resolvePhoneFemaleVoice('Kore')`
 *   sobre `getPhoneAgentSpeech` (`gemini-3.8-flash-tts` primario + compuerta acústica matemática YIN
 *   `F0 >= 148 Hz`), bloqueando al 100% cualquier deriva hacia voces masculinas o robóticas.
 * - **Marca y Moneda Oficial**: Garantiza estrictamente el nombre `Tacos Gavilan` (jamás `"Tacos El Gavilan"`)
 *   y pronunciación de todos los precios en dólares y centavos estadounidenses (`USD`, nunca `"pesos"` ni `"MXN"`).
 * - **Sucursales de Los Ángeles (#5, #6 y #7) frente al Cliente**: Convierte cualquier mención interna,
 *   con paréntesis o de tarjeta web (`LA Broadway`, `Los Angeles Vernon & Broadway`, `Los Ángeles (Vernon y Broadway)`, etc.)
 *   a su locución natural con entrecalles oficiales:
 *   * #5: `Los Ángeles, en la esquina de Vernon y Broadway` / `Los Angeles, at the corner of Vernon and Broadway`
 *   * #6: `Los Ángeles, en la esquina de Central y Washington` / `Los Angeles, at the corner of Central and Washington`
 *   * #7: `Los Ángeles, en la esquina de Slauson y Broadway` / `Los Angeles, at the corner of Slauson and Broadway`
 * - **Estrategia Dual de Caché Cross-Lambda en Supabase Storage**:
 *   * Textos canónicos/estáticos cortos (`<= 600` caracteres): `ephemeral: false` (`order-ready-tts/phone_v6/Kore/{lang}/{hash}.wav`),
 *     compartiendo caché permanente en RAM y Supabase Storage (`< 90 ms` cross-Lambda, `0 ms` en RAM caliente).
 *   * Bloques dinámicos largos (`601..900` caracteres): `ephemeral: true` (`order-ready-tts/phone_v6_tmp/Kore/{lang}/{hash}.wav`),
 *     con retención automática de 24h depurada por `/api/cron/retention-cleanup`.
 * - **Límite por Bloque**: Recorta limpiamente en frontera de oración hasta `MAX_WEB_A11Y_TTS_CHARS = 900` caracteres.
 *
 * @dataFlow
 * - `GET/POST /api/web-a11y/tts` (o proxy `tacosgavilan.com/api/a11y-tts`)
 *   -> `validateAndPrepareWebA11yInput()` (detección `es`|`en`, sanitización anti-script/binario, normalización fonética web + tiendas LA + días/horarios/USD)
 *   -> `synthesizeWebA11yKoreSpeech()` (`isPhoneSpeechInRamCache` -> `warmPhoneSpeechFromStorageOnly` -> `getPhoneAgentSpeech` con `Kore`)
 *   -> `Buffer` `audio/wav` PCM 24 kHz 16-bit mono.
 *
 * @notes
 * - Creado el 2026-11-21 sin modificar `lib/order-ready-tts.ts` ni `lib/phone-speech-format.ts`, reutilizando
 *   íntegramente su pool de llaves `AQ.` / Tier 1, deduplicación `inflight` y verificación acústica femenina YIN.
 */

import {
  getPhoneAgentSpeech,
  isPhoneSpeechInRamCache,
  normalizePhoneTtsInput,
  PhoneFemaleVoiceId,
  resolvePhoneFemaleVoice,
  warmPhoneSpeechFromStorageOnly
} from '@/lib/order-ready-tts'
import { sanitizeCustomerStoreReferencesInText } from '@/lib/customer-store-names'

export type WebA11yLang = 'es' | 'en'

export const MAX_WEB_A11Y_TTS_CHARS = 900
export const MAX_WEB_A11Y_RAW_INPUT_CHARS = 12000
export const CANONICAL_STATIC_CACHE_MAX_CHARS = 600
export const WEB_A11Y_VOICE_ID: PhoneFemaleVoiceId = resolvePhoneFemaleVoice('Kore')

export type WebA11yCacheStatus = 'HIT-RAM' | 'HIT-STORAGE' | 'MISS'

export interface PreparedWebA11yInput {
  ok: true
  lang: WebA11yLang
  normalizedText: string
  ephemeral: boolean
  wasTruncated: boolean
}

export interface InvalidWebA11yInput {
  ok: false
  code: 'EMPTY_TEXT' | 'PAYLOAD_TOO_LARGE' | 'FORBIDDEN_CONTENT' | 'UNPRONOUNCEABLE_TEXT'
  message: string
}

export type WebA11yInputValidationResult = PreparedWebA11yInput | InvalidWebA11yInput

export interface WebA11ySpeechResult {
  wav: Buffer
  lang: WebA11yLang
  voice: PhoneFemaleVoiceId
  normalizedText: string
  ephemeral: boolean
  wasTruncated: boolean
  cacheStatus: WebA11yCacheStatus
  durationMs: number
}

const CONTROL_OR_BINARY_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/
const FORBIDDEN_SCRIPT_PAYLOAD_RE =
  /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon(?:error|load|click|mouseover|focus)\s*=/i

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&#10;': '. ',
  '&#13;': ' ',
  '&quot;': '"',
  '&#34;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&ndash;': '–',
  '&#8211;': '–',
  '&mdash;': '—',
  '&#8212;': '—',
  '&middot;': '·',
  '&bull;': '•',
  '&lt;': ' ',
  '&gt;': ' '
}

const ES_DAY_ABBREV_MAP: Record<string, string> = {
  lun: 'Lunes',
  mar: 'Martes',
  mie: 'Miércoles',
  mié: 'Miércoles',
  jue: 'Jueves',
  vie: 'Viernes',
  sab: 'Sábado',
  sáb: 'Sábado',
  dom: 'Domingo'
}

const EN_DAY_ABBREV_MAP: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  wed: 'Wednesday',
  weds: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
}

/**
 * Resuelve el idioma de síntesis (`es` | `en`).
 * Si se recibe explícitamente `es*` o `en*`, lo respeta; de lo contrario detecta heurísticamente por léxico y tildes.
 */
export function resolveWebA11yLang(rawLang: string | null | undefined, sampleText?: string): WebA11yLang {
  const cleanLang = String(rawLang || '')
    .trim()
    .toLowerCase()
  if (cleanLang === 'en' || cleanLang.startsWith('en-') || cleanLang.startsWith('en_')) {
    return 'en'
  }
  if (cleanLang === 'es' || cleanLang.startsWith('es-') || cleanLang.startsWith('es_')) {
    return 'es'
  }

  const text = String(sampleText || '').trim()
  if (!text) return 'es'

  if (/[áéíóúñ¿¡]/i.test(text)) {
    return 'es'
  }

  const esHits = (
    text.match(
      /\b(el|la|los|las|de|del|en|con|para|por|nuestro|nuestra|nuestros|nuestras|sucursales|ubicaciones|horario|ordenar|menú|menu|platillos|carnes|frijoles|arroz|bebidas|accesibilidad|bienvenido|esquina|abierto|todos|días|dias|personas)\b/gi
    ) || []
  ).length
  const enHits = (
    text.match(
      /\b(the|and|with|for|from|our|your|locations|hours|order|online|menu|meats|beans|rice|drinks|accessibility|welcome|corner|open|daily|people|fresh|authentic|since|serving|choose|close)\b/gi
    ) || []
  ).length

  return enHits > esHits ? 'en' : 'es'
}

function decodeBasicHtmlEntities(input: string): string {
  return input.replace(/&(?:amp|nbsp|#160|#10|#13|quot|#34|#39|apos|ndash|#8211|mdash|#8212|middot|bull|lt|gt);/gi, (m) => {
    return HTML_ENTITY_MAP[m.toLowerCase()] ?? ' '
  })
}

/**
 * Convierte todas las variantes de las 3 sucursales de Los Ángeles (#5, #6 y #7) —incluyendo encabezados
 * web sin paréntesis (`Los Angeles Central & Washington`) y formatos display con paréntesis
 * (`Los Ángeles (Vernon y Broadway)`)— a la locución natural hablada con entrecalles, sin tocar domicilios
 * postales reales (`4380 S. Broadway`, `1900 S. Central Ave.`, `5833 S. Broadway`).
 */
function normalizeLosAngelesWebStoreCorners(input: string, lang: WebA11yLang): string {
  let out = sanitizeCustomerStoreReferencesInText(input, lang)

  if (lang === 'es') {
    out = out
      .replace(
        /(\ben\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:en\s+)?(?:la\s+)?esquina\s+de\s+)|[-–—,:]\s*|\s+)(?:Vernon\s*(?:&|y|and)\s*Broadway|Broadway\s*(?:&|y|and)\s*Vernon)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep ? `${prep}Los Ángeles, esquina de Vernon y Broadway` : 'Los Ángeles, en la esquina de Vernon y Broadway'
      )
      .replace(
        /(\ben\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:en\s+)?(?:la\s+)?esquina\s+de\s+)|[-–—,:]\s*|\s+)(?:Central\s*(?:&|y|and)\s*Washington|Washington\s*(?:&|y|and)\s*Central)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep
            ? `${prep}Los Ángeles, esquina de Central y Washington`
            : 'Los Ángeles, en la esquina de Central y Washington'
      )
      .replace(
        /(\ben\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:en\s+)?(?:la\s+)?esquina\s+de\s+)|[-–—,:]\s*|\s+)(?:Slauson\s*(?:&|y|and)\s*Broadway|Broadway\s*(?:&|y|and)\s*Slauson)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep
            ? `${prep}Los Ángeles, esquina de Slauson y Broadway`
            : 'Los Ángeles, en la esquina de Slauson y Broadway'
      )
  } else {
    out = out
      .replace(
        /(\bin\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:at\s+)?(?:the\s+)?corner\s+of\s+)|[-–—,:]\s*|\s+)(?:Vernon\s*(?:&|and|y)\s*Broadway|Broadway\s*(?:&|and|y)\s*Vernon)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep
            ? `${prep}Los Angeles, at the corner of Vernon and Broadway`
            : 'Los Angeles, at the corner of Vernon and Broadway'
      )
      .replace(
        /(\bin\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:at\s+)?(?:the\s+)?corner\s+of\s+)|[-–—,:]\s*|\s+)(?:Central\s*(?:&|and|y)\s*Washington|Washington\s*(?:&|and|y)\s*Central)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep
            ? `${prep}Los Angeles, at the corner of Central and Washington`
            : 'Los Angeles, at the corner of Central and Washington'
      )
      .replace(
        /(\bin\s+)?\bLos\s+[AÁaá]ngeles\s*(?:\(\s*|(?:,\s*(?:at\s+)?(?:the\s+)?corner\s+of\s+)|[-–—,:]\s*|\s+)(?:Slauson\s*(?:&|and|y)\s*Broadway|Broadway\s*(?:&|and|y)\s*Slauson)(?:\s*\))?/gi,
        (_m, prep?: string) =>
          prep
            ? `${prep}Los Angeles, at the corner of Slauson and Broadway`
            : 'Los Angeles, at the corner of Slauson and Broadway'
      )
  }

  return out
}

/**
 * Expande abreviaturas de días de la semana únicamente en contextos reales de horarios (`Dom – Mié`, `Vie – Sáb`,
 * `Sun – Wed`, `Fri – Sat`, `Dom: 8:00 AM`), evitando falsos positivos como `"Sunset"` o `"Mar y Tierra"`.
 */
function expandScheduleDayAbbreviations(input: string, lang: WebA11yLang): string {
  let out = input
  if (lang === 'es') {
    out = out.replace(
      /\b(Lun|Mar|Mi[eé]|Jue|Vie|S[aá]b|Dom)\.?\s*(?:([-–—])|\b(a|al|y)\b)\s*(Lun|Mar|Mi[eé]|Jue|Vie|S[aá]b|Dom)\.?(?=\s*[:.,;)]|\s+\d|\s|$)/gi,
      (_m, d1: string, dash: string | undefined, conj: string | undefined, d2: string) => {
        const w1 = ES_DAY_ABBREV_MAP[d1.toLowerCase()] || d1
        const w2 = ES_DAY_ABBREV_MAP[d2.toLowerCase()] || d2
        const connector = dash ? 'a' : (conj || 'a').toLowerCase() === 'y' ? 'y' : 'a'
        return `${w1} ${connector} ${w2}`
      }
    )
    out = out.replace(
      /\b(Lun|Mar|Mi[eé]|Jue|Vie|S[aá]b|Dom)\.?\s*:\s*(?=\d{1,2}(?::\d{2})?\s*[AaPp])/gi,
      (_m, d1: string) => `${ES_DAY_ABBREV_MAP[d1.toLowerCase()] || d1}: `
    )
  } else {
    out = out.replace(
      /\b(Mon|Tues?|Wed(?:s)?|Thu(?:rs?)?|Fri|Sat|Sun)\.?\s*(?:([-–—])|\b(to|through|thru|and)\b|(&))\s*(Mon|Tues?|Wed(?:s)?|Thu(?:rs?)?|Fri|Sat|Sun)\.?(?=\s*[:.,;)]|\s+\d|\s|$)/gi,
      (_m, d1: string, dash: string | undefined, wordConj: string | undefined, amp: string | undefined, d2: string) => {
        const w1 = EN_DAY_ABBREV_MAP[d1.toLowerCase()] || d1
        const w2 = EN_DAY_ABBREV_MAP[d2.toLowerCase()] || d2
        const connector = amp || (wordConj && wordConj.toLowerCase() === 'and') ? 'and' : dash ? 'through' : 'to'
        return `${w1} ${connector} ${w2}`
      }
    )
    out = out.replace(
      /\b(Mon|Tues?|Wed(?:s)?|Thu(?:rs?)?|Fri|Sat|Sun)\.?\s*:\s*(?=\d{1,2}(?::\d{2})?\s*[AaPp])/gi,
      (_m, d1: string) => `${EN_DAY_ABBREV_MAP[d1.toLowerCase()] || d1}: `
    )
  }
  return out
}

/**
 * Recorta un texto limpio sobre frontera natural de oración (`. `, `! `, `? `, `; `) o palabra sin exceder `maxChars`.
 */
export function truncateAtNaturalBoundary(text: string, maxChars = MAX_WEB_A11Y_TTS_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean

  const slice = clean.slice(0, maxChars)
  const minSentenceCut = Math.floor(maxChars * 0.45)

  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('." '),
    slice.lastIndexOf('!" '),
    slice.lastIndexOf('?" ')
  )
  if (sentenceEnd >= minSentenceCut) {
    const cutChar = slice[sentenceEnd]
    const includeLen = cutChar === '"' ? sentenceEnd + 2 : sentenceEnd + 1
    return slice.slice(0, includeLen).trim()
  }

  const clauseEnd = Math.max(slice.lastIndexOf('; '), slice.lastIndexOf(': '), slice.lastIndexOf(', '))
  if (clauseEnd >= Math.floor(maxChars * 0.6)) {
    return slice.slice(0, clauseEnd).trim() + '.'
  }

  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()
}

/**
 * Normaliza un bloque de texto extraído del DOM web para locución natural con `Kore`:
 * - Limpia entidades HTML, separadores `·`/`•`, emojis decorativos de UI y saltos de línea múltiples.
 * - Impone marca oficial `Tacos Gavilan` y entrecalles habladas en sucursales #5, #6 y #7 de Los Ángeles.
 * - Expande `FWY` -> `Freeway`, rangos de personas (`15 – 20 People`), días abreviados (`Dom – Mié` / `Sun – Wed`),
 *   precios USD, horarios `AM`/`PM`, teléfonos `3-3-4` y vialidades vía `normalizePhoneTtsInput`.
 */
export function normalizeWebA11ySpeechText(
  rawText: string,
  lang: WebA11yLang,
  maxChars = MAX_WEB_A11Y_TTS_CHARS
): string {
  if (!rawText) return ''

  let text = decodeBasicHtmlEntities(String(rawText))

  // Eliminar etiquetas HTML residuales inocuas (tras haber rechazado scripts/iframes en validación)
  text = text.replace(/<[^>]{1,160}>/g, ' ')

  // Convertir saltos de línea y viñetas visuales (`·`, `•`, `|`) en pausas prosódicas limpias
  text = text
    .replace(/\r?\n+/g, '. ')
    .replace(/\s*[·•▪▸►│|]\s*/g, '. ')

  // Retirar glifos/emojis puramente decorativos de botones o badges para evitar lecturas como "triángulo derecho"
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[🌶🔥⭐🌟📍📞🕐🕒▶⏸⏹⏮⏭↗↘↙↖→←↑↓✓✔✕✖🔊🔉🔈🎧]/gu, ' ')

  // Marca oficial estricta: jamás "Tacos El Gavilan"
  text = text.replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')

  // Expandir `10 FWY` / `605 FWY` antes del pase vial
  text = text.replace(/\b(\d{1,3})\s+FWY\b/gi, '$1 Freeway').replace(/\bFWY\b/g, 'Freeway')

  // Sucursales #5, #6 y #7 de Los Ángeles -> locución hablada con entrecalles
  text = normalizeLosAngelesWebStoreCorners(text, lang)

  // Expandir días de la semana abreviados en horarios y rangos numéricos de platillos/personas
  text = expandScheduleDayAbbreviations(text, lang)
  if (lang === 'es') {
    text = text.replace(
      /\b(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*(personas|invitados|tacos|piezas|porciones)\b/gi,
      '$1 a $2 $3'
    )
  } else {
    text = text
      .replace(/\b(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*(people|guests|servings|tacos|pieces)\b/gi, '$1 to $2 $3')
      .replace(/(^|\s)[Ww]\/(?=\s*[A-Za-z])/g, '$1with ')
  }

  // Limpiar puntuación duplicada (`. .`, `..`, `,.`) generada al colapsar saltos de línea del DOM
  text = text
    .replace(/([.!?])\s*\./g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()

  // Pre-acotar antes de expansión fonética para evitar trabajo excesivo en bloques gigantes,
  // y luego aplicar el normalizador fonético maestro + recorte final en frontera de oración <= maxChars.
  const preBounded = text.length > maxChars + 350 ? truncateAtNaturalBoundary(text, maxChars + 350) : text
  const phonetic = normalizePhoneTtsInput(preBounded, lang, maxChars + 250)
  return truncateAtNaturalBoundary(phonetic, maxChars)
}

/**
 * Valida seguridad, longitud y pronunciabilidad de una solicitud de lectura web y devuelve el texto normalizado.
 */
export function validateAndPrepareWebA11yInput(
  rawText: unknown,
  rawLang?: unknown,
  maxChars = MAX_WEB_A11Y_TTS_CHARS
): WebA11yInputValidationResult {
  if (typeof rawText !== 'string') {
    return {
      ok: false,
      code: 'EMPTY_TEXT',
      message: 'El parámetro text es obligatorio y debe ser texto.'
    }
  }

  const trimmed = rawText.trim()
  if (!trimmed) {
    return {
      ok: false,
      code: 'EMPTY_TEXT',
      message: 'El parámetro text no puede estar vacío.'
    }
  }

  if (trimmed.length > MAX_WEB_A11Y_RAW_INPUT_CHARS) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: `El texto excede el máximo permitido de ${MAX_WEB_A11Y_RAW_INPUT_CHARS} caracteres.`
    }
  }

  if (CONTROL_OR_BINARY_RE.test(trimmed) || FORBIDDEN_SCRIPT_PAYLOAD_RE.test(trimmed)) {
    return {
      ok: false,
      code: 'FORBIDDEN_CONTENT',
      message: 'El texto contiene caracteres binarios o etiquetas ejecutables no permitidas.'
    }
  }

  const lang = resolveWebA11yLang(typeof rawLang === 'string' ? rawLang : null, trimmed)
  const unclippedProbe = normalizeWebA11ySpeechText(trimmed, lang, maxChars + 120)
  if (!unclippedProbe || !/[\p{L}\p{N}]/u.test(unclippedProbe)) {
    return {
      ok: false,
      code: 'UNPRONOUNCEABLE_TEXT',
      message: 'El texto no contiene palabras ni números pronunciables.'
    }
  }

  const normalizedText =
    unclippedProbe.length > maxChars ? truncateAtNaturalBoundary(unclippedProbe, maxChars) : unclippedProbe

  if (!normalizedText || !/[\p{L}\p{N}]/u.test(normalizedText)) {
    return {
      ok: false,
      code: 'UNPRONOUNCEABLE_TEXT',
      message: 'El texto normalizado quedó vacío.'
    }
  }

  const wasTruncated = trimmed.length > maxChars || unclippedProbe.length > maxChars
  const ephemeral = normalizedText.length > CANONICAL_STATIC_CACHE_MAX_CHARS

  return {
    ok: true,
    lang,
    normalizedText,
    ephemeral,
    wasTruncated
  }
}

const MAX_COMBINED_LONG_WAV_CACHE = 60
const combinedLongWavRamCache = new Map<string, Buffer>()

function extract24kMonoPcm(wav: Buffer): Buffer {
  if (wav.length > 44 && wav.subarray(0, 4).toString('ascii') === 'RIFF') {
    const dataSz = wav.readUInt32LE(40)
    const raw = dataSz > 0 && 44 + dataSz <= wav.length ? wav.subarray(44, 44 + dataSz) : wav.subarray(44)
    return raw.length % 2 === 0 ? raw : raw.subarray(0, raw.length - 1)
  }
  return wav.length % 2 === 0 ? wav : wav.subarray(0, wav.length - 1)
}

function buildWavFrom24kMonoPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24000, 24)
  header.writeUInt32LE(48000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function splitLongBlockIntoTwoSegments(text: string): [string, string] | null {
  if (text.length <= 500) return null
  const mid = Math.floor(text.length / 2)
  const minIdx = Math.floor(text.length * 0.28)
  const maxIdx = Math.floor(text.length * 0.72)

  let bestCut = -1
  let bestDist = Infinity
  const sentenceRe = /[.!?]+(?=\s)/g
  let m: RegExpExecArray | null
  while ((m = sentenceRe.exec(text)) !== null) {
    const endPos = m.index + m[0].length
    if (endPos >= minIdx && endPos <= maxIdx) {
      const dist = Math.abs(endPos - mid)
      if (dist < bestDist) {
        bestDist = dist
        bestCut = endPos
      }
    }
  }

  if (bestCut === -1) {
    const clauseRe = /[;:,](?=\s)/g
    while ((m = clauseRe.exec(text)) !== null) {
      const endPos = m.index + m[0].length
      if (endPos >= minIdx && endPos <= maxIdx) {
        const dist = Math.abs(endPos - mid)
        if (dist < bestDist) {
          bestDist = dist
          bestCut = endPos
        }
      }
    }
  }

  if (bestCut === -1) return null
  const first = text.slice(0, bestCut).trim()
  const second = text.slice(bestCut).trim()
  if (first.length < 80 || second.length < 80) return null
  return [first, second]
}

async function synthesizeSingleSegment(
  segmentText: string,
  lang: WebA11yLang,
  ephemeral: boolean,
  signal?: AbortSignal
): Promise<{ wav: Buffer; cacheStatus: WebA11yCacheStatus }> {
  const voice = WEB_A11Y_VOICE_ID

  if (isPhoneSpeechInRamCache(segmentText, lang, voice, ephemeral)) {
    const wav = await getPhoneAgentSpeech(segmentText, lang, voice, false, {
      ephemeral,
      skipStorageLookup: true,
      skipStoragePersist: true,
      awaitStoragePersist: false,
      signal
    })
    return { wav, cacheStatus: 'HIT-RAM' }
  }

  if (!ephemeral) {
    const storageHit = await warmPhoneSpeechFromStorageOnly(segmentText, lang, voice)
    if (storageHit) {
      const wav = await getPhoneAgentSpeech(segmentText, lang, voice, false, {
        ephemeral: false,
        skipStorageLookup: true,
        skipStoragePersist: true,
        awaitStoragePersist: false,
        signal
      })
      return { wav, cacheStatus: 'HIT-STORAGE' }
    }
  }

  const beforeSynthMs = Date.now()
  const wav = await getPhoneAgentSpeech(segmentText, lang, voice, false, {
    ephemeral,
    skipStorageLookup: !ephemeral,
    skipStoragePersist: false,
    awaitStoragePersist: true,
    skipSseAttempt: false,
    fastLivePhone: false,
    // CRÍTICO: mantener allowFallbackAfterFastSse en false para NO activar el tope Twilio de 4.8s SSE / 4.2s REST en párrafos web largos
    allowFallbackAfterFastSse: false,
    maxTotalMs: 26000,
    signal
  })
  const synthElapsedMs = Date.now() - beforeSynthMs
  return {
    wav,
    cacheStatus: ephemeral && synthElapsedMs < 350 ? 'HIT-STORAGE' : 'MISS'
  }
}

/**
 * Sintetiza o recupera desde caché (RAM 0 ms -> Supabase Storage < 90 ms -> Gemini TTS `Kore 3.8`)
 * el audio WAV mono de 24 kHz con voz femenina verificada `Kore`.
 */
export async function synthesizeWebA11yKoreSpeech(
  rawText: string,
  rawLang?: string | null,
  options?: {
    signal?: AbortSignal
    maxChars?: number
    preparedInput?: PreparedWebA11yInput
  }
): Promise<WebA11ySpeechResult> {
  const startedAt = Date.now()
  const prepared: WebA11yInputValidationResult =
    options?.preparedInput ??
    validateAndPrepareWebA11yInput(rawText, rawLang, options?.maxChars ?? MAX_WEB_A11Y_TTS_CHARS)
  if (!prepared.ok) {
    throw new Error(`${prepared.code}: ${prepared.message}`)
  }

  const { lang, normalizedText, ephemeral, wasTruncated } = prepared
  const voice = WEB_A11Y_VOICE_ID

  const splitPair = splitLongBlockIntoTwoSegments(normalizedText)
  if (splitPair) {
    const combinedKey = `${voice}:${lang}:${normalizedText.toLowerCase()}`
    const memCombined = combinedLongWavRamCache.get(combinedKey)
    if (memCombined && memCombined.length > 44) {
      combinedLongWavRamCache.delete(combinedKey)
      combinedLongWavRamCache.set(combinedKey, memCombined)
      return {
        wav: memCombined,
        lang,
        voice,
        normalizedText,
        ephemeral,
        wasTruncated,
        cacheStatus: 'HIT-RAM',
        durationMs: Date.now() - startedAt
      }
    }

    const [part1, part2] = await Promise.all([
      synthesizeSingleSegment(splitPair[0], lang, ephemeral, options?.signal),
      synthesizeSingleSegment(splitPair[1], lang, ephemeral, options?.signal)
    ])

    const pcm1 = extract24kMonoPcm(part1.wav)
    const pcm2 = extract24kMonoPcm(part2.wav)
    const silence120ms = Buffer.alloc(5760) // 120ms * 24000 Hz * 2 bytes
    const mergedWav = buildWavFrom24kMonoPcm(Buffer.concat([pcm1, silence120ms, pcm2]))

    if (combinedLongWavRamCache.size >= MAX_COMBINED_LONG_WAV_CACHE) {
      const oldest = combinedLongWavRamCache.keys().next().value
      if (oldest) combinedLongWavRamCache.delete(oldest)
    }
    combinedLongWavRamCache.set(combinedKey, mergedWav)

    const mergedCacheStatus: WebA11yCacheStatus =
      part1.cacheStatus === 'HIT-RAM' && part2.cacheStatus === 'HIT-RAM'
        ? 'HIT-RAM'
        : part1.cacheStatus !== 'MISS' && part2.cacheStatus !== 'MISS'
          ? 'HIT-STORAGE'
          : 'MISS'

    return {
      wav: mergedWav,
      lang,
      voice,
      normalizedText,
      ephemeral,
      wasTruncated,
      cacheStatus: mergedCacheStatus,
      durationMs: Date.now() - startedAt
    }
  }

  const single = await synthesizeSingleSegment(normalizedText, lang, ephemeral, options?.signal)
  return {
    wav: single.wav,
    lang,
    voice,
    normalizedText,
    ephemeral,
    wasTruncated,
    cacheStatus: single.cacheStatus,
    durationMs: Date.now() - startedAt
  }
}
