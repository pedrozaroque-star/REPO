/**
 * @module lib/phone-speech-format
 * @description Normalizador fonético y formateador bilingüe (ES/EN) de domicilios, vialidades,
 * códigos postales, teléfonos, precios y unidades para la Contestadora IA Multi-Sucursal (15 Tiendas)
 * de Tacos Gavilan.
 *
 * @businessRules
 * - En el Sur de California, los nombres propios de calles se dicen en inglés natural sin abreviar
 *   puntos cardinales ni tipos de vía (`101 S. Azusa Ave.` -> `101 South Azusa Avenue`,
 *   `115 E. Baseline Rd.` -> `115 East Baseline Road`, `1258 E. 17th St.` -> `1258 East Seventeenth Street`,
 *   `3220 E. Imperial Hwy.` -> `3220 East Imperial Highway`), evitando que el TTS en español lea
 *   `"S."` como `"ese"`, `"Ave."` como `"ave"` (pájaro), `"17th St."` como `"diecisiete te hache ese te"`,
 *   `"Hwy."` como `"hache doble u i griega"` o `"CA"` como `"ca"`.
 * - En español (`lang === 'es'`), `Los Angeles` lleva siempre tilde (`Los Ángeles`) para pronunciación esdrújula correcta.
 * - Los números telefónicos de 10 dígitos de EE. UU. se locutan dígito por dígito en bloques `3-3-4`
 *   (`(626) 917-2662` -> `seis dos seis, nueve uno siete, dos seis seis dos` en ES /
 *   `six two six, nine one seven, two six six two` en EN) para que jamás se lean como miles (`"dos mil seiscientos..."`).
 * - Los códigos postales de 5 dígitos tras `California` (cuando se incluyen) se leen dígito por dígito
 *   (`91791` -> `nueve uno siete nueve uno` / `nine one seven nine one`).
 * - Módulo 100% puro e isomórfico (sin dependencias de Node ni servidor) para usarse tanto en backend
 *   (`lib/phone-agent.ts`, `lib/order-ready-tts.ts`) como en cliente (`app/admin/llamadas/page.tsx`).
 *
 * @dataFlow
 * - `stores.address` / respuesta LLM -> `formatAddressForDisplayAndPrompt()` (texto limpio legible y sin puntos falsos)
 *   -> `normalizeTextForPhoneSpeech()` (locución fonética previa a Gemini TTS `Kore 3.8` o `speechSynthesis`).
 *
 * @notes
 * - Eliminar los puntos de abreviaturas (`S.`, `E.`, `Ave.`, `Rd.`, `Blvd.`, `St.`, `Hwy.`) impide además que
 *   `splitPhoneReplyForStreaming` parta el audio en dos clips a mitad de una dirección.
 * - Incluye también el filtro isomórfico anti-voces masculinas (`isForbiddenMaleBrowserVoice` / `pickStrictFemaleBrowserVoice`)
 *   para el respaldo `speechSynthesis` del navegador en Windows/macOS/Chrome/Edge.
 * - FIX 2026-11-17 (Moneda Estricta EE. UU. y Locución Exacta de Horarios AM/PM sin Inversión a PM):
 *   1) Convierte todo precio a dólares y centavos (`$2.29` / `$2.29 dólares` / `$2.29 pesos` -> `2 dólares con 29 centavos`; `$0.75` -> `75 centavos`),
 *   consumiendo sufijos redundantes para jamás duplicar `"dólares"` ni pronunciar `"pesos"` o `"0 dólares"`.
 *   2) Convierte todas las horas `AM`/`PM` (`11:00 AM a 3:00 AM`, `10:00 AM a 1:00 AM`, `4:00 PM`, `12:00 AM`) a locución natural explícita
 *   (`de 11 de la mañana a 3 de la mañana`, `4 de la tarde`, `12 de la medianoche` en ES; `3 in the morning` / `12 midnight` en EN) para evitar
 *   que el modelo neuronal Gemini TTS invierta el segundo `"AM"` en `"pe eme"` (`3 PM`) en cierres después de medianoche.
 *   3) Aplica `sanitizeCustomerStoreReferencesInText` y convierte `&` -> `"y"` / `"and"` para que las 3 sucursales de Los Ángeles (#5, #6 y #7)
 *   siempre se pronuncien como `Los Ángeles` con sus entrecalles (`Vernon y Broadway`, `Central y Washington`, `Slauson y Broadway`).
 * - FIX 2026-11-18: Consume sufijos redundantes `dollars`/`USD` en montos `$0.XX` en inglés, normaliza `"in pesos"`,
 *   soporta precios de 4-5 dígitos sin coma seguidos de `dólares` y expande `CA` sin coma previa antes de código postal.
 */

import { sanitizeCustomerStoreReferencesInText } from '@/lib/customer-store-names'

export type SpeechLang = 'es' | 'en'

const DIGIT_WORDS_ES: Record<string, string> = {
  '0': 'cero',
  '1': 'uno',
  '2': 'dos',
  '3': 'tres',
  '4': 'cuatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'siete',
  '8': 'ocho',
  '9': 'nueve',
}

const DIGIT_WORDS_EN: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
}

const ORDINAL_ONES_EN: Record<number, string> = {
  1: 'First',
  2: 'Second',
  3: 'Third',
  4: 'Fourth',
  5: 'Fifth',
  6: 'Sixth',
  7: 'Seventh',
  8: 'Eighth',
  9: 'Ninth',
  10: 'Tenth',
  11: 'Eleventh',
  12: 'Twelfth',
  13: 'Thirteenth',
  14: 'Fourteenth',
  15: 'Fifteenth',
  16: 'Sixteenth',
  17: 'Seventeenth',
  18: 'Eighteenth',
  19: 'Nineteenth',
}

const CARDINAL_TENS_EN: Record<number, string> = {
  20: 'Twenty',
  30: 'Thirty',
  40: 'Forty',
  50: 'Fifty',
  60: 'Sixty',
  70: 'Seventy',
  80: 'Eighty',
  90: 'Ninety',
}

const ORDINAL_TENS_EN: Record<number, string> = {
  20: 'Twentieth',
  30: 'Thirtieth',
  40: 'Fortieth',
  50: 'Fiftieth',
  60: 'Sixtieth',
  70: 'Seventieth',
  80: 'Eightieth',
  90: 'Ninetieth',
}

const CARDINAL_ONES_EN: Record<number, string> = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
}

/**
 * Convierte un ordinal numérico en inglés (`1st`, `2nd`, `3rd`, `17th`, `42nd`, `103rd`)
 * a su palabra inglesa completa (`First`, `Second`, `Third`, `Seventeenth`, `Forty-Second`, `One Hundred Third`)
 * para evitar que el TTS en español deletree `"17th"` como `"diecisiete te hache"`.
 */
export function numberToEnglishOrdinalWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 299) return null
  if (n >= 100) {
    const hundreds = Math.floor(n / 100)
    const rem = n % 100
    const hundredPrefix = `${CARDINAL_ONES_EN[hundreds]} Hundred`
    if (rem === 0) return `${hundredPrefix}th`
    const remOrd = numberToEnglishOrdinalWords(rem)
    return remOrd ? `${hundredPrefix} ${remOrd}` : null
  }
  if (ORDINAL_ONES_EN[n]) return ORDINAL_ONES_EN[n]
  const tens = Math.floor(n / 10) * 10
  const ones = n % 10
  if (ones === 0) return ORDINAL_TENS_EN[tens] || null
  const tensWord = CARDINAL_TENS_EN[tens]
  const onesOrd = ORDINAL_ONES_EN[ones]
  if (!tensWord || !onesOrd) return null
  return `${tensWord}-${onesOrd}`
}

const DIRECTIONAL_MAP: Record<string, string> = {
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
  NE: 'Northeast',
  NW: 'Northwest',
  SE: 'Southeast',
  SW: 'Southwest',
}

const SENTENCE_NEXT_WORD_LOOKAHEAD =
  String.raw`(?=\s+(?:Hoy|Mañana|También|Además|Si|Sí|No|Por|Gracias|Recuerda|Puedes|Abierto|Cerrado|Contamos|Nuestro|Nuestra|Nuestros|Nuestras|En|Aquí|Abrimos|Cerramos|Visítanos|Aceptamos|Llama|Para|Estamos|Tenemos|Today|Tomorrow|We|Our|You|Please|Thank|If|Yes|No|Open|Closed|Stop|Call|Visit|Here|Right)\b|\s*[¡¿]|\s*$)`

const STREET_TYPE_ENTRIES: Array<[RegExp, string]> = [
  [new RegExp(String.raw`\bAve\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Avenue.'],
  [/\bAve\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Avenue'],
  [/\bAve(?=\s*[,;:.!?)]|\s+(?:in|en|suite|ste|apt|unit|local|[A-Z])|$)/g, 'Avenue'],
  [new RegExp(String.raw`\bBlvd\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Boulevard.'],
  [/\bBlvd\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Boulevard'],
  [/\bBlvd(?=\s*[,;:.!?)]|\s|$)/gi, 'Boulevard'],
  [new RegExp(String.raw`\bRd\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Road.'],
  [/\bRd\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Road'],
  [/\bRd(?=\s*[,;:.!?)]|\s|$)/g, 'Road'],
  [new RegExp(String.raw`\bHwy\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Highway.'],
  [/\bHwy\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Highway'],
  [/\bHwy(?=\s*[,;:.!?)]|\s|$)/gi, 'Highway'],
  [new RegExp(String.raw`\bPkwy\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Parkway.'],
  [/\bPkwy\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Parkway'],
  [/\bPkwy(?=\s*[,;:.!?)]|\s|$)/gi, 'Parkway'],
  [new RegExp(String.raw`\bFwy\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Freeway.'],
  [/\bFwy\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Freeway'],
  [/\bFwy(?=\s*[,;:.!?)]|\s|$)/gi, 'Freeway'],
  [new RegExp(String.raw`\bLn\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Lane.'],
  [/\bLn\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Lane'],
  [new RegExp(String.raw`\bCt\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Court.'],
  [/\bCt\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Court'],
  [new RegExp(String.raw`\bCir\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Circle.'],
  [/\bCir\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Circle'],
  [new RegExp(String.raw`\bPl\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'gi'), 'Place.'],
  [/\bPl\.(?=\s*[,;:.!?)]|\s|$)/gi, 'Place'],
  [/\bBldg\.(?=\s|$)/gi, 'Building'],
]

/**
 * Expande abreviaturas viales estadounidenses dentro de cualquier dirección o frase:
 * - Direcciones cardinales tras número vial (`101 S. Azusa` -> `101 South Azusa`, `1258 E. 17th` -> `1258 East 17th`)
 *   o con punto antes de nombre propio (`en S. Broadway` -> `en South Broadway`).
 * - Calles ordinales (`17th St.` / `17th Street` -> `Seventeenth Street`).
 * - Sufijos de calle (`Ave.`, `Blvd.`, `Rd.`, `Hwy.`, `St.`, `Dr.`, `Pkwy.`, `Fwy.`, `Ln.`, `Ct.`, `Cir.`, `Pl.`, `Ste.`).
 * - Estado `, CA` -> `, California` y `Los Angeles` -> `Los Ángeles` en español.
 */
export function expandStreetAbbreviationsInText(
  input: string,
  lang: SpeechLang,
  options?: { stripZipAfterState?: boolean }
): string {
  if (!input) return ''
  let out = String(input)

  // 1. Convertir referencias internas a las sucursales de Los Ángeles (#5, #6 y #7) al formato de cliente con entrecalles
  out = sanitizeCustomerStoreReferencesInText(out, lang)

  // 2. Expandir puntos cardinales después de un número de inmueble (ej. "101 S. Azusa", "115 E Baseline", "3220 E. Imperial")
  out = out.replace(
    /\b(\d{1,6})\s+(NE|NW|SE|SW|N|S|E|W)\.(?=\s+[A-Za-z0-9])/g,
    (_m, num: string, dir: string) => `${num} ${DIRECTIONAL_MAP[dir.toUpperCase()] || dir}`
  )
  out = out.replace(
    /\b(\d{1,6})\s+(NE|NW|SE|SW|N|S|E|W)(?=\s+(?:[A-Z][a-z]+|\d{1,3}(?:st|nd|rd|th)\b))/g,
    (_m, num: string, dir: string) => `${num} ${DIRECTIONAL_MAP[dir.toUpperCase()] || dir}`
  )

  // También cuando se menciona la calle sin número únicamente en contexto vial (después de preposición o seguida de tipo de vía, evitando iniciales como "Juan S. Hernández")
  out = out.replace(
    /(\b(?:en|por|sobre|calle|esquina|on|at|near|off|from)\s+)(NE|NW|SE|SW|N|S|E|W)\.\s+(?=[A-Z][a-z]{2,}|\d{1,3}(?:st|nd|rd|th)\b)/gi,
    (_m, prep: string, dir: string) => `${prep}${DIRECTIONAL_MAP[dir.toUpperCase()] || dir} `
  )
  out = out.replace(
    /(?:^|(\s))(NE|NW|SE|SW|N|S|E|W)\.\s+(?=(?:[A-Z][a-z]{2,}|\d{1,3}(?:st|nd|rd|th)\b)\s+(?:Ave\.?|St\.?|Blvd\.?|Rd\.?|Hwy\.?|Fwy\.?|Pkwy\.?|Ln\.?|Ct\.?|Cir\.?|Pl\.?|Dr\.?|Avenue|Street|Boulevard|Road|Highway|Freeway|Parkway|Lane|Court|Circle|Place|Drive)\b)/g,
    (_m, space: string | undefined, dir: string) => `${space || ''}${DIRECTIONAL_MAP[dir.toUpperCase()] || dir} `
  )

  // 3. Expandir sufijos viales inequívocos (Ave., Blvd., Rd., Hwy., Pkwy., Fwy., Ln., Ct., Cir., Pl.)
  for (const [pattern, replacement] of STREET_TYPE_ENTRIES) {
    out = out.replace(pattern, replacement)
  }

  // 4. Expandir `St.` / `St` ÚNICAMENTE en direcciones viales reales (no en santos/hospitales como "St. Francis" o "St. Jude")
  const NON_STREET_PREFIX_WORDS = new Set([
    'en', 'de', 'a', 'por', 'con', 'sin', 'para', 'del', 'al', 'la', 'el',
    'near', 'at', 'in', 'by', 'from', 'to', 'the', 'our', 'visit', 'opposite', 'across', 'hospital'
  ])
  out = out.replace(
    new RegExp(
      String.raw`\b(\d{1,3}(?:st|nd|rd|th)|\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]{1,24})\s+St\.` +
        SENTENCE_NEXT_WORD_LOOKAHEAD,
      'g'
    ),
    '$1 Street.'
  )
  out = out.replace(
    /\b(\d{1,3}(?:st|nd|rd|th)|\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]{1,24})\s+St\.(?=\s*[,;:.!?)]|\s|$)/g,
    '$1 Street'
  )
  out = out.replace(
    new RegExp(String.raw`\b([A-Z][a-zA-Z0-9'-]{1,24})\s+St\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'g'),
    (full, streetWord: string) =>
      NON_STREET_PREFIX_WORDS.has(streetWord.toLowerCase()) ? full : `${streetWord} Street.`
  )
  out = out.replace(
    /\b([A-Z][a-zA-Z0-9'-]{1,24})\s+St\.(?=\s*[,;:!?)]|\s+[a-záéíóúñ]|\s*$)/g,
    (full, streetWord: string) =>
      NON_STREET_PREFIX_WORDS.has(streetWord.toLowerCase()) ? full : `${streetWord} Street`
  )
  out = out.replace(
    /\b(\d{1,3}(?:st|nd|rd|th))\s+St\b/gi,
    '$1 Street'
  )
  out = out.replace(
    /\b(\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]+)\s+St(?=\s*[,;:.!?)]|$)/g,
    '$1 Street'
  )

  // 5. Expandir `Dr.` / `Dr` cuando va DESPUÉS del nombre de la calle (ej. "100 Harbor Dr.,", nunca al inicio "Dr. Pérez")
  out = out.replace(
    new RegExp(String.raw`\b(\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]+)\s+Dr\.` + SENTENCE_NEXT_WORD_LOOKAHEAD, 'g'),
    '$1 Drive.'
  )
  out = out.replace(
    /\b(\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]+)\s+Dr\.(?=\s*[,;:.!?)]|\s|$)/g,
    '$1 Drive'
  )
  out = out.replace(
    /\b(\d{1,6}\s+(?:(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest)\s+)?[A-Z][a-zA-Z0-9'-]+)\s+Dr(?=\s*[,;:.!?)]|$)/g,
    '$1 Drive'
  )

  // 6. Expandir `Ste.` / `Ste` seguido de identificador de local (ej. "Ste. 104", "Ste B")
  out = out.replace(/\bSte\.?\s+([A-Za-z0-9-]+)\b/gi, 'Suite $1')

  // 7. Expandir ordinales viales en inglés (`17th Street` -> `Seventeenth Street`, `17th y Grand` -> `Seventeenth y Grand`)
  out = out.replace(
    /\b(\d{1,3})(st|nd|rd|th)\b(?=\s+(?:Street|Avenue|Boulevard|Road|Drive|Place|Lane|Way|Court|Circle)\b|\s+(?:y|and|&)\s+[A-Z])/gi,
    (full, digits: string) => {
      const word = numberToEnglishOrdinalWords(Number(digits))
      return word || full
    }
  )

  // 8. Limpiar doble puntuación residual que quedaba de `Ave.,` o `Rd..`
  out = out.replace(/\.,/g, ',').replace(/,\s*,/g, ',')

  // 9. Expandir `, CA 91791` y `, CA` -> `, California` (incluso cuando stripZipAfterState es true y no venía ZIP)
  if (options?.stripZipAfterState) {
    out = out.replace(/(?:,\s*|\s+)CA\s+\d{5}(?:-\d{4})?\b/g, ', California')
  }
  out = out
    .replace(/(?:,\s*|\s+)CA(?=\s+\d{5}\b)/g, ', California')
    .replace(/,\s*CA(?=\s*[,;:.!?)]|\s|$)/g, ', California')

  // 10. En español, asegurar tilde en `Los Ángeles` para acentuación esdrújula natural
  if (lang === 'es') {
    out = out.replace(/\bLos\s+Angeles\b/g, 'Los Ángeles')
  }

  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Formatea el domicilio de una sucursal para inyectarlo en el prompt del agente IA y mostrarlo limpio:
 * por defecto omite el código postal de 5 dígitos para que la contestadora diga
 * `"101 South Azusa Avenue, West Covina, California"` de manera conversacional y natural.
 */
export function formatStoreAddressForAgent(
  rawAddress: string | null | undefined,
  lang: SpeechLang = 'es',
  options?: { includeZip?: boolean }
): string {
  const raw = String(rawAddress || '').trim()
  if (!raw) return ''
  return expandStreetAbbreviationsInText(raw, lang, {
    stripZipAfterState: options?.includeZip !== true,
  })
}

/**
 * Extrae el código postal de 5 dígitos de una dirección postal estadounidense (si existe).
 */
export function extractZipCodeFromAddress(rawAddress: string | null | undefined): string | null {
  const m = String(rawAddress || '').match(/\b(\d{5})(?:-\d{4})?\s*$/)
  return m?.[1] || null
}

/**
 * Convierte una cadena de dígitos en palabras habladas separadas (`"91791"` -> `"nueve uno siete nueve uno"`).
 */
export function digitsToSpokenWords(digits: string, lang: SpeechLang): string {
  const map = lang === 'es' ? DIGIT_WORDS_ES : DIGIT_WORDS_EN
  return digits
    .split('')
    .map((d) => map[d] || d)
    .join(' ')
}

/**
 * Convierte un número telefónico de EE. UU. de 10 dígitos a locución telefónica natural `3-3-4`:
 * `(626) 917-2662` -> `"seis dos seis, nueve uno siete, dos seis seis dos"` (ES) /
 * `"six two six, nine one seven, two six six two"` (EN).
 */
export function formatPhoneForSpeech(rawPhone: string | null | undefined, lang: SpeechLang): string {
  const raw = String(rawPhone || '').trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return raw
  const area = digitsToSpokenWords(ten.slice(0, 3), lang)
  const prefix = digitsToSpokenWords(ten.slice(3, 6), lang)
  const line = digitsToSpokenWords(ten.slice(6, 10), lang)
  return `${area}, ${prefix}, ${line}`
}

/**
 * Normalizador fonético maestro previo a síntesis de voz (Gemini TTS `Kore 3.8` y fallback `speechSynthesis`).
 * Mantiene intacto el sentido exacto del mensaje pero expande abreviaturas, códigos postales, teléfonos,
 * dominios web, unidades y símbolos `$` para que la voz suene 100% humana y natural.
 */
export function normalizeTextForPhoneSpeech(rawText: string, lang: SpeechLang): string {
  if (!rawText) return ''
  let text = sanitizeCustomerStoreReferencesInText(
    String(rawText).replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan'),
    lang
  ).replace(/([\p{L}\p{N}])\s*&\s*([\p{L}\p{N}])/gu, lang === 'es' ? '$1 y $2' : '$1 and $2')

  // 1. Expandir todas las abreviaturas viales, ordinales de calles, `, CA` y `Los Ángeles`
  text = expandStreetAbbreviationsInText(text, lang, { stripZipAfterState: false })

  // 2. Si quedó un código postal de 5 dígitos tras `California` (ej. cuando el cliente pidió el zip code),
  //    pronunciarlo dígito por dígito en vez de "noventa y un mil setecientos noventa y uno"
  text = text.replace(/\bCalifornia(?:,)?\s+(\d{5})\b/g, (_m, zip: string) => {
    return `California, ${digitsToSpokenWords(zip, lang)}`
  })
  if (lang === 'es') {
    text = text.replace(/\b(código postal|zip code)\s+(\d{5})\b/gi, (_m, label: string, zip: string) => {
      return `${label} ${digitsToSpokenWords(zip, 'es')}`
    })
  } else {
    text = text.replace(/\b(zip code|postal code)\s+(\d{5})\b/gi, (_m, label: string, zip: string) => {
      return `${label} ${digitsToSpokenWords(zip, 'en')}`
    })
  }

  // 3. Pronunciar números telefónicos de 10 dígitos dígito por dígito en cadencia 3-3-4 (incluyendo +1E164 corrido)
  text = text.replace(
    /(^|[^\w+])(?:\+1[-.\s]?)?\(([2-9]\d{2})\)\s*([2-9]\d{2})[-.\s](\d{4})\b/g,
    (_m, lead: string, a: string, b: string, c: string) => `${lead}${formatPhoneForSpeech(`${a}${b}${c}`, lang)}`
  )
  text = text.replace(
    /(^|[^\w+])(?:\+?1[-.\s]?)?([2-9]\d{2})[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})\b/g,
    (_m, lead: string, a: string, b: string, c: string) => `${lead}${formatPhoneForSpeech(`${a}${b}${c}`, lang)}`
  )

  // 4. Evitar que se deletreen URLs técnicas largas y pronunciar `tacosgavilan.com` con naturalidad
  const spokenDomain = lang === 'es' ? 'tacos gavilan punto com' : 'tacos gavilan dot com'
  text = text.replace(/https?:\/\/order\.online\/[^\s,;:!?)]+/gi, spokenDomain)
  text = text.replace(
    /(?:https?:\/\/)?(?:www\.)?tacosgavilan\.com\/contact\b/gi,
    lang === 'es' ? 'tacos gavilan punto com diagonal contact' : 'tacos gavilan dot com slash contact'
  )
  text = text.replace(/(?:https?:\/\/)?(?:www\.)?tacosgavilan\.com\b/gi, spokenDomain)

  // 5. Normalizar precios exclusivamente a dólares y centavos estadounidenses (USD) — jamás "pesos"
  if (lang === 'es') {
    const formatSpokenUsdEs = (dollarsStr: string, centsStr?: string): string => {
      const dollars = Number(dollarsStr.replace(/,/g, ''))
      const normalizedCentsStr = centsStr ? (centsStr.length === 1 ? `${centsStr}0` : centsStr) : ''
      const cents = normalizedCentsStr ? Number(normalizedCentsStr) : 0
      if (dollars === 0 && cents > 0) {
        return `${cents} ${cents === 1 ? 'centavo' : 'centavos'}`
      }
      const dollarWord = dollars === 1 ? 'dólar' : 'dólares'
      if (!normalizedCentsStr || cents === 0) {
        return `${dollars} ${dollarWord}`
      }
      const centWord = cents === 1 ? 'centavo' : 'centavos'
      return `${dollars} ${dollarWord} con ${cents} ${centWord}`
    }

    text = text.replace(
      /\$\s*(\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.(\d{1,2}))?(?:\s*(?:d[oó]lares?(?:\s+estadounidenses?)?|usd|pesos?(?:\s+mexicanos?)?|mxn|centavos?))?\b/gi,
      (_m, dollarsStr: string, centsStr?: string) => formatSpokenUsdEs(dollarsStr, centsStr)
    )
    text = text.replace(
      /(^|[^\w$.])(\d{1,3}(?:,\d{3})+|\d{1,5})\.(\d{2})\s*(?:d[oó]lares?(?:\s+estadounidenses?)?|usd|pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, lead: string, dollarsStr: string, centsStr: string) => `${lead}${formatSpokenUsdEs(dollarsStr, centsStr)}`
    )
    text = text.replace(
      /\b(d[oó]lares?)\s+(?:con|y)\s+(\d{1,2})\s+pesos?\b/gi,
      (_m, dw: string, cStr: string) => {
        const c = Number(cStr)
        return `${dw} con ${c} ${c === 1 ? 'centavo' : 'centavos'}`
      }
    )
    text = text.replace(
      /(^|[^\w$.])(\d{1,5})\s*(?:pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, lead: string, dollarsStr: string) => `${lead}${formatSpokenUsdEs(dollarsStr)}`
    )
    text = text.replace(/\ben\s+pesos(?:\s+mexicanos?)?\b/gi, 'en dólares')
  } else {
    text = text.replace(
      /\$\s*((?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.\d{1,2})?)\s*(?:pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, amt: string) => `$${amt}`
    )
    text = text.replace(
      /(^|[^\w$.])((?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.\d{1,2})?)\s*(?:pesos?(?:\s+mexicanos?)?|mxn)\b/gi,
      (_m, lead: string, amt: string) => `${lead}$${amt}`
    )
    text = text.replace(
      /\$\s*0\.(\d{1,2})(?:\s*(?:dollars?(?:\s+usd)?|usd|cents?|pesos?(?:\s+mexicanos?)?|mxn))?\b/gi,
      (_m, centsStr: string) => {
        const normalizedCents = centsStr.length === 1 ? `${centsStr}0` : centsStr
        const c = Number(normalizedCents)
        return c > 0 ? `${c} ${c === 1 ? 'cent' : 'cents'}` : '$0.00'
      }
    )
    text = text.replace(
      /(\$\s*(?:\d{1,3}(?:,\d{3})+|\d{1,5})(?:\.\d{1,2})?)\s*(?:dollars?(?:\s+usd)?|usd)\b/gi,
      '$1'
    )
    text = text.replace(/\bin\s+pesos(?:\s+mexicanos?)?\b/gi, 'in US dollars')
  }

  // 5b. Convertir horarios de 12 horas (`11:00 AM a 3:00 AM`, `10:00 AM-1:00 AM`, `4:00 PM`, `12:00 AM`) a locución hablada
  //     100% explícita para impedir que Gemini TTS invierta el segundo `"AM"` en `"pe eme"` (`3 PM`) en cierres nocturnos.
  const MERIDIEM_TOKEN = String.raw`(?:([AaPp])\.[Mm]\.(?=\s+[a-záéíóúñ]|\s*[,;:!?)]|\s*$)|([AaPp])\.[Mm](?=\.)|([AaPp])\s*[Mm]\b)`
  text = text.replace(
    new RegExp(String.raw`(\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:[AaPp]\.[Mm]\.?|[AaPp]\s*[Mm]\b))\s*[-–]\s*(?=(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[AaPp])`, 'g'),
    lang === 'es' ? '$1 a ' : '$1 to '
  )
  if (lang === 'es') {
    text = text.replace(
      new RegExp(
        String.raw`\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*` +
          MERIDIEM_TOKEN +
          String.raw`(?:\s+de\s+la\s+(?:mañana|madrugada|tarde|noche|medianoche)|\s+del\s+mediod[ií]a)?`,
        'g'
      ),
      (_m, hourStr: string, minStr: string | undefined, m1?: string, m2?: string, m3?: string) => {
        const h = Number(hourStr)
        const m = minStr ? Number(minStr) : 0
        const merChar = m1 || m2 || m3 || 'a'
        const isPm = merChar.toLowerCase() === 'p'
        const minPhrase = m === 0 ? '' : m === 30 ? ' y media' : ` con ${m}`
        let period: string
        if (!isPm) {
          period = h === 12 ? (m === 0 ? 'de la medianoche' : 'de la madrugada') : 'de la mañana'
        } else {
          period = h === 12 ? (m === 0 ? 'del mediodía' : 'de la tarde') : h <= 6 ? 'de la tarde' : 'de la noche'
        }
        return `${h}${minPhrase} ${period}`
      }
    )
  } else {
    text = text.replace(
      new RegExp(
        String.raw`\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*` +
          MERIDIEM_TOKEN +
          String.raw`(?!\s*(?:midnight|noon))(?:\s+in\s+the\s+(?:morning|afternoon|evening)|\s+at\s+night)?`,
        'g'
      ),
      (_m, hourStr: string, minStr: string | undefined, m1?: string, m2?: string, m3?: string) => {
        const h = Number(hourStr)
        const m = minStr ? Number(minStr) : 0
        const merChar = m1 || m2 || m3 || 'a'
        const isPm = merChar.toLowerCase() === 'p'
        const minPart = m === 0 ? '' : `:${String(m).padStart(2, '0')}`
        if (!isPm) {
          if (h === 12 && m === 0) return '12 midnight'
          if (h === 12 || (h >= 1 && h <= 4)) return `${h}${minPart} in the morning`
          return `${h}${minPart} A M`
        }
        if (h === 12 && m === 0) return '12 noon'
        return `${h}${minPart} P M`
      }
    )
  }

  // 6. Expandir unidades de peso/medida y símbolo `#` antes de dígitos
  if (lang === 'es') {
    text = text
      .replace(/\b1\s*lbs?\b/gi, '1 libra')
      .replace(/\b(\d+(?:\.\d+)?)\s*lbs?\b/gi, '$1 libras')
      .replace(/\b1\s*oz\b/gi, '1 onza')
      .replace(/\b(\d+(?:\.\d+)?)\s*oz\b/gi, '$1 onzas')
      .replace(/\b(\d+)\s*hrs?\b/gi, '$1 horas')
      .replace(/(^|\s)#(\d+)\b/g, '$1número $2')
  } else {
    text = text
      .replace(/\b1\s*lbs?\b/gi, '1 pound')
      .replace(/\b(\d+(?:\.\d+)?)\s*lbs?\b/gi, '$1 pounds')
      .replace(/\b1\s*oz\b/gi, '1 ounce')
      .replace(/\b(\d+(?:\.\d+)?)\s*oz\b/gi, '$1 ounces')
      .replace(/\b(\d+)\s*hrs?\b/gi, '$1 hours')
      .replace(/(^|\s)#(\d+)\b/g, '$1number $2')
  }

  return text.replace(/\s+/g, ' ').trim()
}

export interface BrowserSpeechVoiceLike {
  name: string
  lang: string
  voiceURI?: string
}

const FORBIDDEN_MALE_BROWSER_VOICE_RE =
  /\b(raul|jorge|alonso|alvaro|pablo|diego|carlos|juan|andres|tomas|lorenzo|gonzalo|dario|emilio|rodrigo|mateo|sebastian|alejandro|fernando|miguel|ricardo|gerardo|enrique|david|mark|guy|christopher|eric|brian|andrew|steffan|roger|ryan|daniel|george|oliver|thomas|james|liam|orus|puck|male|hombre|masculin|masculino|masc)\b/i

const EXPLICIT_FEMALE_BROWSER_VOICE_RE =
  /\b(sabina|paulina|dalia|elena|paloma|helena|laura|monica|francisca|elvira|beatriz|camila|catalina|salome|ximena|larissa|paola|sofia|valentina|isabella|lucia|carmen|rosa|teresa|andrea|natalia|gabriela|daniela|mariana|fernanda|aria|jenny|zira|samantha|victoria|ava|emma|michelle|sonia|libby|maisie|natasha|clara|molly|female|femenina|femenino|mujer)\b|google\s+espa[nñ]ol|google\s+us\s+english/i

/**
 * Determina si una voz `speechSynthesis` del navegador pertenece a una voz masculina conocida
 * (ej. `Microsoft Jorge Online (Natural)`, `Microsoft Alonso`, `Microsoft Alvaro`, `Microsoft Raul`, `Microsoft David`, `Microsoft Mark`).
 */
export function isForbiddenMaleBrowserVoice(name?: string | null, voiceURI?: string | null): boolean {
  const combined = `${name || ''} ${voiceURI || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (!combined.trim()) return false
  return FORBIDDEN_MALE_BROWSER_VOICE_RE.test(combined)
}

/**
 * Selecciona ÚNICAMENTE una voz femenina verificada del navegador para el idioma solicitado.
 * - NUNCA selecciona voces masculinas con la palabra `"Natural"` (como `Microsoft Jorge Online (Natural)`).
 * - Si el sistema operativo (ej. Windows sin paquete de voz en español, donde solo existen `David`, `Mark` y `Zira`)
 *   NO cuenta con ninguna voz femenina verificada para ese idioma, devuelve `null` para impedir que Windows
 *   lea el texto con la voz masculina por defecto (`Microsoft David`).
 */
export function pickStrictFemaleBrowserVoice<T extends BrowserSpeechVoiceLike>(
  voices: readonly T[],
  lang: SpeechLang
): T | null {
  if (!Array.isArray(voices) || voices.length === 0) return null
  const langPrefix = lang === 'en' ? 'en' : 'es'

  const safeCandidates = voices.filter(
    (v) =>
      v &&
      String(v.lang || '')
        .toLowerCase()
        .startsWith(langPrefix) &&
      !isForbiddenMaleBrowserVoice(v.name, v.voiceURI)
  )

  const verifiedFemale = safeCandidates.find((v) => {
    const normName = `${v.name || ''} ${v.voiceURI || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    return EXPLICIT_FEMALE_BROWSER_VOICE_RE.test(normName)
  })

  return verifiedFemale || null
}
