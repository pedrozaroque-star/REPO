/**
 * @module lib/phone-caller-id
 * @description Identificador de Llamadas (Caller ID / CNAM + Directorio Interno Tacos Gavilan + Caché 30 días),
 * generador inteligente de resúmenes de llamada (`buildMeaningfulCallSummary`) y detector de detalles post-recado
 * (`extractSubstantivePostCallbackUserTurns`) para la Contestadora IA Multi-Sucursal.
 *
 * @businessRules
 * - **Resolución de Identidad en 3 Niveles (prioridad por precisión y latencia cero)**:
 *   1. Directorio interno Tacos Gavilan vía RPC `resolve_phone_caller_directory` (`public.users` con nombres reales,
 *      `public.toast_employees`, `public.stores`, `public.suppliers`, `public.gavilan_pos_loyalty_accounts`,
 *      clientes recurrentes en `public.phone_callback_requests`, y caché CNAM vigente `public.phone_caller_id_cache`).
 *   2. Parámetro `CallerName` entregado directamente por Twilio en el webhook entrante (`VoiceCallerIdLookup = true`),
 *      sanitizado con `cleanAndHumanizeCnam` para descartar etiquetas basura (`WIRELESS CALLER`, ciudades, spam, etc.).
 *   3. Respaldo opcional con Twilio Lookup v2 (`Fields=caller_name`, timeout acotado de 650 ms) solo si los niveles 1 y 2
 *      no resolvieron nada, guardando en `phone_caller_id_cache` por 30 días (incluyendo misses negativos para no repetir cobros).
 * - **Higiene estricta de CNAM**: convierte formato `APELLIDO,NOMBRE` (`MONAE,DEJA` -> `Deja Monae`) para consumidores,
 *   descarta `WIRELESS CALLER`, `CELL PHONE`, `UNKNOWN`, `SPAM RISK`, números telefónicos crudos y nombres de ciudad/estado.
 * - **Privacidad por Diseño (CCPA/CPRA — Zero-Leak)**: el nombre resuelto (`caller_name` / `caller_name_source`) se guarda
 *   ÚNICAMENTE para visibilidad interna de gerentes/admins en `/admin/llamadas` y JAMÁS se inyecta en el prompt verbal de Kore
 *   ni se pronuncia al aire (Kore siempre pide el nombre de viva voz y solo confirma los últimos 4 dígitos del teléfono `7-0-4-3`).
 * - **Resúmenes legibles de llamada**: reemplaza el patrón truncado `último turno -> última respuesta` por un resumen
 *   útil del motivo real o del recado registrado para `/admin/llamadas`.
 *
 * @dataFlow
 * - Twilio `POST` / `/api/phone/incoming` / `/api/phone/respond` / `phone-live-bridge` -> `resolvePhoneCallerIdentity`
 *   -> `public.resolve_phone_caller_directory` + `public.phone_caller_id_cache` -> `public.phone_calls` (`caller_name`, `caller_name_source`).
 *
 * @notes
 * - Creado en respuesta a la auditoría de la llamada real Central #6 (22/11/26, 3:12 a.m.):
 *   elimina la fricción de dictar 10 dígitos cuando Twilio ya entrega Caller ID, habilita CNAM + directorio de empleados/clientes,
 *   y previene pérdida de notas post-recado (`"sin queso en el Taco Plate"`).
 */

import { supabaseAdmin } from '@/lib/supabase'

export type PhoneCallerNameSource =
  | 'employee'
  | 'store'
  | 'vendor'
  | 'loyalty'
  | 'returning_caller'
  | 'twilio_cnam'
  | 'twilio_lookup'
  | 'spoken'

export interface ResolvedCallerIdentity {
  phoneDigits10: string | null
  phoneE164: string | null
  last4: string | null
  last4Spoken: string | null
  displayName: string | null
  rawCnam: string | null
  source: PhoneCallerNameSource | null
  callerType: 'customer' | 'employee' | 'vendor' | 'delivery_driver' | 'corporate'
  roleHint: string | null
  matchedStoreId: number | null
  highConfidenceName: boolean
}

export interface MinimalTranscriptEntry {
  role: 'user' | 'assistant' | 'tool' | string
  text: string
  timestamp?: string
  toolName?: string
}

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
])

const CNAM_GARBAGE_EXACT = new Set([
  'WIRELESS CALLER',
  'WIRELESS',
  'CELL PHONE',
  'CELLULAR',
  'CELLULAR CALLER',
  'MOBILE CALLER',
  'MOBILE',
  'UNKNOWN',
  'UNKNOWN CALLER',
  'UNAVAILABLE',
  'ANONYMOUS',
  'RESTRICTED',
  'PRIVATE',
  'PRIVATE CALLER',
  'PRIVATE NUMBER',
  'NO CALLER ID',
  'OUT OF AREA',
  'TOLL FREE',
  'TOLL-FREE',
  'TOLL FREE CALL',
  'PAYPHONE',
  'PAY PHONE',
  'SPAM',
  'SPAM RISK',
  'SCAM LIKELY',
  'POTENTIAL SPAM',
  'SUSPECTED SPAM',
  'TELEMARKETER',
  'ROBOCALL',
  'CUSTOMER',
  'CLIENTE',
  'CALLER',
  'USER',
  'USUARIO',
  'NONE',
  'N/A',
  'NA',
  'NULL',
  'UNDEFINED',
  'CALIFORNIA',
  'LOS ANGELES',
  'HUNTINGTON PARK',
  'LYNWOOD',
  'DOWNEY',
  'COMPTON',
  'VERNON',
  'BELL',
  'BELL GARDENS',
  'SOUTH GATE',
  'RIALTO',
  'SANTA ANA',
  'LONG BEACH',
  'ANAHEIM',
  'ONTARIO',
  'FONTANA',
  'RIVERSIDE',
  'PASADENA',
  'INGLEWOOD',
  'HAWTHORNE',
  'GARDENA',
  'CARSON',
  'TORRANCE',
  'PARAMOUNT',
  'NORWALK',
  'WHITTIER',
  'MONTEBELLO',
  'ALHAMBRA',
  'EL MONTE',
  'POMONA',
  'CORONA',
  'WALNUT PARK',
  'PICO RIVERA',
  'MAYWOOD',
  'CUDAHY',
  'SAN BERNARDINO',
  'ORANGE COUNTY',
  'UNITED STATES'
])

const CNAM_GARBAGE_SUBSTRING_RE =
  /\b(wireless\s+caller|cell\s+phone|mobile\s+caller|spam\s+risk|scam\s+likely|potential\s+spam|suspected\s+spam|telemarketer|robocall|unavailable|anonymous|restricted|private\s+caller|out\s+of\s+area|toll[\s-]free|no\s+caller\s+id|unknown\s+name)\b/i

const KEEP_UPPER_WORDS = new Set(['LLC', 'INC', 'USA', 'US', 'TV', 'II', 'III', 'IV'])

export function normalizeUsPhoneDigits10(phone: string | null | undefined): string | null {
  const raw = String(phone || '').trim()
  if (!raw) return null
  if (/^(anonymous|restricted|unavailable|unknown|private|blocked|simulator|simulador)/i.test(raw)) {
    return null
  }
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return null
  const area = Number(ten.slice(0, 3))
  const exch = Number(ten.slice(3, 6))
  if (area < 200 || exch < 200 || exch === 555) return null
  if (/^(\d)\1{9}$/.test(ten)) return null
  return ten
}

export function formatUsPhoneE164(phone: string | null | undefined): string | null {
  const ten = normalizeUsPhoneDigits10(phone)
  return ten ? `+1${ten}` : null
}

export function formatLast4ForSpeech(phone: string | null | undefined): string | null {
  const ten = normalizeUsPhoneDigits10(phone)
  if (!ten) return null
  return ten.slice(-4).split('').join('-')
}

function titleCaseToken(token: string): string {
  const clean = token.trim()
  if (!clean) return ''
  const upper = clean.toUpperCase()
  if (KEEP_UPPER_WORDS.has(upper)) return upper
  if (clean.length === 1) return upper
  // Mantener McX / O'X bien capitalizado
  if (/^MC[A-Z]{2,}$/.test(upper)) {
    return 'Mc' + upper[2] + upper.slice(3).toLowerCase()
  }
  if (/^O'[A-Z]{2,}$/.test(upper)) {
    return "O'" + upper[2] + upper.slice(3).toLowerCase()
  }
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
}

function titleCasePhrase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split('-')
        .map((part) => titleCaseToken(part))
        .join('-')
    )
    .join(' ')
}

/**
 * Limpia y humaniza una cadena CNAM de Twilio (`"MONAE,DEJA"` -> `"Deja Monae"`, `"DOORDASH INC"` -> `"Doordash INC"`).
 * Devuelve `null` para etiquetas genéricas de operadoras (`WIRELESS CALLER`, ciudades, spam, números crudos).
 */
export function cleanAndHumanizeCnam(
  rawName: string | null | undefined,
  callerType?: string | null
): string | null {
  const collapsed = String(rawName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return null

  // Descartar si son puros dígitos/teléfono o tiene menos de 2 letras
  const lettersOnly = collapsed.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (lettersOnly.length < 2) return null
  const digitsOnly = collapsed.replace(/\D/g, '')
  if (digitsOnly.length >= 7) return null

  const upper = collapsed.toUpperCase()
  if (CNAM_GARBAGE_EXACT.has(upper)) return null
  if (CNAM_GARBAGE_SUBSTRING_RE.test(collapsed)) return null

  // Descartar formato "CIUDAD ST" (ej. "LOS ANGELES CA", "HUNTINGTON PK CA", "BELL GARDENS CA") sin coma
  if (!collapsed.includes(',')) {
    const parts = upper.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1]
      const cityPart = parts.slice(0, -1).join(' ')
      if (
        US_STATE_CODES.has(lastPart) &&
        (CNAM_GARBAGE_EXACT.has(cityPart) ||
          parts.length >= 3 ||
          /^(LOS|SAN|SANTA|SOUTH|NORTH|EAST|WEST|NEW|FORT|MOUNT|LAKE|LONG|EL|LA|LAS|BELL|HUNTINGTON|HUNT|DOWNEY|LYNWOOD|COMPTON|VERNON|RIALTO|ONTARIO|FONTANA|CARSON|NORWALK|PASADENA|INGLEWOOD|GARDENA|TORRANCE|WHITTIER|POMONA|CORONA|ANAHEIM|RIVERSIDE)\b/.test(
            cityPart
          ))
      ) {
        return null
      }
    }
  } else {
    // Descartar "LOS ANGELES, CA" cuando la parte previa a la coma es ciudad conocida y la segunda es estado US
    const commaParts = upper.split(',').map((p) => p.trim())
    if (commaParts.length === 2 && US_STATE_CODES.has(commaParts[1]) && CNAM_GARBAGE_EXACT.has(commaParts[0])) {
      return null
    }
  }

  const isBusiness = String(callerType || '').toUpperCase() === 'BUSINESS'

  // Si es consumidor en formato "APELLIDO,NOMBRE" o "APELLIDO, NOMBRE M" -> invertir a "Nombre M Apellido"
  if (!isBusiness) {
    const lastFirstMatch = collapsed.match(
      /^([A-Za-zÀ-ÿ'-]{2,})\s*,\s*([A-Za-zÀ-ÿ'-]{2,}(?:\s+[A-Za-zÀ-ÿ'.-]{1,})?)$/
    )
    if (lastFirstMatch) {
      const last = lastFirstMatch[1].trim()
      const first = lastFirstMatch[2].trim()
      const combined = `${titleCasePhrase(first)} ${titleCasePhrase(last)}`.replace(/\s+/g, ' ').trim()
      if (CNAM_GARBAGE_EXACT.has(combined.toUpperCase())) return null
      return combined.slice(0, 80)
    }
  }

  // Si viene todo en mayúsculas o todo en minúsculas, aplicar Title Case limpio
  const isAllUpper = collapsed === collapsed.toUpperCase() && /[A-Z]/.test(collapsed)
  const isAllLower = collapsed === collapsed.toLowerCase() && /[a-z]/.test(collapsed)
  const formatted = isAllUpper || isAllLower ? titleCasePhrase(collapsed) : collapsed

  if (CNAM_GARBAGE_EXACT.has(formatted.toUpperCase())) return null
  return formatted.slice(0, 80)
}

async function upsertCallerIdCache(params: {
  phoneDigits10: string
  phoneE164: string
  rawCnam: string | null
  displayName: string | null
  callerType: string | null
  source: 'twilio_cnam' | 'twilio_lookup'
}): Promise<void> {
  try {
    const now = Date.now()
    const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin.from('phone_caller_id_cache').upsert(
      {
        phone_digits: params.phoneDigits10,
        phone_e164: params.phoneE164,
        raw_cnam: params.rawCnam,
        display_name: params.displayName,
        caller_type: params.callerType,
        source: params.source,
        looked_up_at: new Date(now).toISOString(),
        expires_at: expiresAt
      },
      { onConflict: 'phone_digits' }
    )
  } catch {
    // No bloquear nunca una llamada por fallo de caché CNAM
  }
}

async function lookupTwilioCnamV2(
  phoneE164: string,
  timeoutMs = 650
): Promise<{ rawCnam: string | null; callerType: string | null } | null> {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim()
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim()
  if (!sid || !token) return null

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(250, timeoutMs))
  try {
    const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneE164)}?Fields=caller_name`,
      {
        method: 'GET',
        headers: { Authorization: auth },
        signal: ctrl.signal
      }
    )
    if (!res.ok) return null
    const data: any = await res.json().catch(() => null)
    const cn = data?.caller_name
    if (!cn || typeof cn !== 'object') return null
    const rawCnam = typeof cn.caller_name === 'string' && cn.caller_name.trim() ? cn.caller_name.trim() : null
    const callerType = typeof cn.caller_type === 'string' && cn.caller_type.trim() ? cn.caller_type.trim() : null
    return { rawCnam, callerType }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function normalizeCallerType(raw: string | null | undefined): ResolvedCallerIdentity['callerType'] {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'employee' || v === 'vendor' || v === 'delivery_driver' || v === 'corporate') return v
  return 'customer'
}

/**
 * Resuelve la identidad del llamante en 3 niveles (Directorio Interno -> Webhook Twilio CNAM -> Twilio Lookup v2 + caché 30d).
 */
export async function resolvePhoneCallerIdentity(params: {
  phone: string | null | undefined
  twilioCallerName?: string | null
  allowTwilioLookup?: boolean
  lookupTimeoutMs?: number
  blockedTenDigits?: Set<string>
}): Promise<ResolvedCallerIdentity> {
  const ten = normalizeUsPhoneDigits10(params.phone)
  if (!ten || (params.blockedTenDigits && params.blockedTenDigits.has(ten))) {
    return {
      phoneDigits10: null,
      phoneE164: null,
      last4: null,
      last4Spoken: null,
      displayName: null,
      rawCnam: null,
      source: null,
      callerType: 'customer',
      roleHint: null,
      matchedStoreId: null,
      highConfidenceName: false
    }
  }

  const phoneE164 = `+1${ten}`
  const last4 = ten.slice(-4)
  const last4Spoken = last4.split('').join('-')
  const rawWebhookCnam = String(params.twilioCallerName || '').trim() || null
  const cleanedWebhookCnam = rawWebhookCnam ? cleanAndHumanizeCnam(rawWebhookCnam) : null

  // Si Twilio entregó CallerName en webhook, guardar en caché 30 días en segundo plano (incluso si fue basura)
  if (rawWebhookCnam) {
    void upsertCallerIdCache({
      phoneDigits10: ten,
      phoneE164,
      rawCnam: rawWebhookCnam,
      displayName: cleanedWebhookCnam,
      callerType: null,
      source: 'twilio_cnam'
    })
  }

  // Nivel 1: Directorio interno Tacos Gavilan + historial recurrente + caché CNAM (1 solo RPC < 15ms)
  let dirRow: any = null
  try {
    const { data, error } = await supabaseAdmin.rpc('resolve_phone_caller_directory', { p_digits10: ten })
    if (!error && Array.isArray(data) && data.length > 0) {
      dirRow = data[0]
    }
  } catch {
    dirRow = null
  }

  if (dirRow && typeof dirRow.display_name === 'string' && dirRow.display_name.trim().length >= 2) {
    const src = String(dirRow.source || 'returning_caller') as PhoneCallerNameSource
    const highConfidence =
      src === 'employee' || src === 'store' || src === 'vendor' || src === 'loyalty' || src === 'returning_caller'
    return {
      phoneDigits10: ten,
      phoneE164,
      last4,
      last4Spoken,
      displayName: dirRow.display_name.trim(),
      rawCnam: rawWebhookCnam,
      source: src,
      callerType: normalizeCallerType(dirRow.caller_type),
      roleHint: dirRow.role_hint ? String(dirRow.role_hint) : null,
      matchedStoreId: dirRow.matched_store_id ? Number(dirRow.matched_store_id) : null,
      highConfidenceName: highConfidence
    }
  }

  // Nivel 2: Twilio Webhook CallerName (0 ms)
  if (cleanedWebhookCnam) {
    return {
      phoneDigits10: ten,
      phoneE164,
      last4,
      last4Spoken,
      displayName: cleanedWebhookCnam,
      rawCnam: rawWebhookCnam,
      source: 'twilio_cnam',
      callerType: 'customer',
      roleHint: 'twilio_cnam',
      matchedStoreId: null,
      highConfidenceName: false
    }
  }

  // Nivel 3: Respaldo Twilio Lookup v2 (solo si no hubo caché negativa reciente y está habilitado)
  if (params.allowTwilioLookup && !rawWebhookCnam) {
    let hasRecentNegativeCache = false
    try {
      const { data: cacheRow } = await supabaseAdmin
        .from('phone_caller_id_cache')
        .select('phone_digits, expires_at')
        .eq('phone_digits', ten)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      hasRecentNegativeCache = Boolean(cacheRow)
    } catch {
      hasRecentNegativeCache = false
    }

    if (!hasRecentNegativeCache) {
      const lookedUp = await lookupTwilioCnamV2(phoneE164, params.lookupTimeoutMs ?? 650)
      if (lookedUp) {
        const cleanedLookup = cleanAndHumanizeCnam(lookedUp.rawCnam, lookedUp.callerType)
        void upsertCallerIdCache({
          phoneDigits10: ten,
          phoneE164,
          rawCnam: lookedUp.rawCnam,
          displayName: cleanedLookup,
          callerType: lookedUp.callerType,
          source: 'twilio_lookup'
        })
        if (cleanedLookup) {
          return {
            phoneDigits10: ten,
            phoneE164,
            last4,
            last4Spoken,
            displayName: cleanedLookup,
            rawCnam: lookedUp.rawCnam,
            source: 'twilio_lookup',
            callerType: String(lookedUp.callerType || '').toUpperCase() === 'BUSINESS' ? 'vendor' : 'customer',
            roleHint: 'twilio_lookup',
            matchedStoreId: null,
            highConfidenceName: false
          }
        }
      }
    }
  }

  return {
    phoneDigits10: ten,
    phoneE164,
    last4,
    last4Spoken,
    displayName: null,
    rawCnam: rawWebhookCnam,
    source: null,
    callerType: 'customer',
    roleHint: null,
    matchedStoreId: null,
    highConfidenceName: false
  }
}

/**
 * Detecta si un turno de usuario es solo despedida, cortesía o confirmación vacía (sin contenido nuevo sustantivo).
 */
export function isTrivialAckOrFarewellTurn(text: string): boolean {
  const norm = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm || norm.length <= 2) return true
  if (
    /^(ok|okay|okey|si|yes|yeah|yep|yup|no|nope|nah|gracias|muchas gracias|muchisimas gracias|thank you|thanks|thanks a lot|thank you so much|perfecto|perfect|excelente|entendido|claro|listo|esta bien|all good|sounds good|got it|alright|all right|bye|goodbye|good bye|adios|hasta luego|nos vemos|que tenga buen dia|que tengas buen dia|have a good day|have a good night|have a great day|buenas noches|buenos dias|buenas tardes|hola|hello|hi|hey|eso es todo|eso seria todo|seria todo|es todo|nada mas|eso seria todo gracias|seria todo gracias|no eso seria todo|no seria todo|no gracias eso seria todo|no nada mas|nada mas gracias|ningun detalle adicional|sin detalles adicionales|thats all|that is all|thats it|nothing else|im good|i am good|no gracias|no thank you|no thanks|ok gracias|okay gracias|ok thanks|okay thanks|okay thank you|ok thank you|si gracias|yes thank you|yes thanks|no eso es todo|no thats all|no nothing else|alright bye|okay bye|ok bye|gracias adios|thanks bye|thank you bye|bye bye)$/.test(
      norm
    )
  ) {
    return true
  }
  // Cadenas cortas compuestas solo de cortesías / despedidas
  const words = norm.split(' ').filter(Boolean)
  const fillerWords = new Set([
    'ok', 'okay', 'okey', 'si', 'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah',
    'gracias', 'muchas', 'muchisimas', 'thank', 'thanks', 'you', 'so', 'much',
    'bye', 'goodbye', 'adios', 'hasta', 'luego', 'eso', 'es', 'seria', 'serian',
    'todo', 'nada', 'mas', 'that', 'thats', 'is', 'all', 'nothing', 'else',
    'perfect', 'perfecto', 'good', 'great', 'alright', 'right', 'fine', 'awesome',
    'cool', 'bien', 'listo', 'claro', 'entendido', 'vale', 'sale', 'hola', 'hello',
    'hi', 'hey', 'uh', 'um', 'ah', 'ningun', 'ninguna', 'detalle', 'detalles',
    'adicional', 'adicionales'
  ])
  if (words.length <= 7 && words.every((w) => fillerWords.has(w))) {
    return true
  }
  return false
}

function normPhoneTextBasic(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ORDER_ITEM_NOUN_RE =
  /\b(tacos?|burritos?|mulitas?|quesadillas?|tortas?|sopes?|nachos?|platos?|plates?|combos?|flan(?:es)?|cheesecakes?|aguas?|horchatas?|jamaicas?|pinas?|tamarindos?|sodas?|cocas?|cokes?|sprites?|fantas?|cafes?|coffees?|champurrados?|arroz|rice|frijol(?:es)?|beans?|carnes?|meats?|asadas?|pastor(?:es)?|pollos?|chicken|cabezas?|lenguas?|buches?|chorizos?|carnitas|huevos?|eggs?|desayunos?|breakfast|tortillas?|salsas?|guacamole|guac|crema|queso|cheese|cebolla|onion|cilantro|limon(?:es)?|limes?|chiles?|jalapenos?|chips|bebidas?|drinks?|platters?|charolas?|trays?|postres?|desserts?|bolsas?|bags?|utensilios|servilletas|napkins|cupon|gift\s*card)\b/i

const CONCRETE_ORDER_DEFECT_RE =
  /\b(crud[oa]s?|raw|fri[oa]s?|cold|quemad[oa]s?|burnt|echad[oa]\s+a\s+perder|spoiled|pelo|cabello|hair|plastico|plastic|doble\s+cobro|charged\s+twice|overcharged|cobro\s+de\s+mas|cobro\s+extra|me\s+cobraron|mal\s+estado|acido|rancio|caducado|enferm|food\s+poison|equivocad[oa]\s+de\s+carne|wrong\s+meat|sin\s+queso|no\s+cheese|con\s+queso|sin\s+cebolla|no\s+onion|sin\s+cilantro|no\s+cilantro|en\s+vez\s+de|instead\s+of|me\s+dieron\s+otra\s+orden|someone\s+else'?s\s+order)\b/i

const REFUSE_DETAIL_RE =
  /\b(no\s+quiero\s+decir|solo\s+quiero\s+hablar\s+con\s+el\s+gerente|prefiero\s+decirle\s+al\s+gerente|just\s+(?:want\s+to\s+)?(?:speak|talk)\s+to\s+(?:the\s+)?manager|tell\s+(?:the\s+)?manager\s+directly|prefer\s+to\s+tell\s+(?:the\s+)?manager)\b/i

/** Valida que un reclamo `missing_or_wrong_item` especifique qué platillo faltó o qué estuvo mal antes de crear el recado. */
export function hasSpecificOrderIssueDetails(summary: string, userContext: string): boolean {
  const combined = normPhoneTextBasic(`${summary || ''} ${userContext || ''}`)
  if (!combined) return false
  if (ORDER_ITEM_NOUN_RE.test(combined)) return true
  if (CONCRETE_ORDER_DEFECT_RE.test(combined)) return true
  if (REFUSE_DETAIL_RE.test(combined)) return true
  return false
}

/** Detecta si el cliente confirmó durante la llamada que encontró su comida o pidió cancelar la alerta. */
export function isFoundItemOrCancelResolution(summary: string, userText: string): boolean {
  const combined = normPhoneTextBasic(`${summary || ''} ${userText || ''}`)
  if (!combined) return false
  return /\b(ya\s+encontre|ya\s+lo\s+encontre|ya\s+la\s+encontre|lo\s+encontre|la\s+encontre|encontro\s+su|encontro\s+la|encontro\s+el|found\s+my|i\s+found\s+it|found\s+the|found\s+my\s+food|found\s+my\s+plate|found\s+my\s+order|here\s+in\s+my\s+car|aqui\s+en\s+mi\s+carro|esta\s+en\s+mi\s+carro|never\s*mind\s+i\s+found|cancel\s+(?:the\s+)?(?:callback|alert|request)|cancelar\s+(?:el\s+)?(?:recado|alerta)|ya\s+no\s+hace\s+falta|ya\s+no\s+necesito\s+(?:que\s+me\s+llamen|el\s+recado)|everything\s+is\s+here|esta\s+todo\s+completo)\b/i.test(
    combined
  )
}

function isVagueDraftSegment(seg: string): boolean {
  const norm = normPhoneTextBasic(seg)
  if (!norm) return true
  if (norm.length < 95 && !ORDER_ITEM_NOUN_RE.test(norm) && !CONCRETE_ORDER_DEFECT_RE.test(norm)) {
    if (/(reporta\s+problema|problema\s+en\s+drive|problema\s+con\s+su\s+orden|solicita\s+hablar|sin\s+numero\s+de\s+ticket|sin\s+especificar)/i.test(norm)) {
      return true
    }
  }
  return false
}

function extractSegmentTokens(seg: string): string[] {
  const stop = new Set([
    'cliente', 'reporta', 'solicita', 'hablar', 'gerente', 'orden', 'pedido', 'tienda', 'sucursal',
    'ticket', 'numero', 'para', 'con', 'sin', 'que', 'por', 'del', 'las', 'los', 'una', 'uno', 'esta',
    'nota', 'adicional', 'hoy', 'ayer', 'drive', 'thru'
  ])
  return Array.from(new Set(normPhoneTextBasic(seg).split(' ').filter((w) => w.length >= 4 && !stop.has(w))))
}

/**
 * Fusiona resúmenes de un mismo recado sin duplicar etiquetas (`[SIN TICKET]`, `[Llamó a #...]`)
 * ni apilar borradores redundantes, reemplazando borradores vagos por el detalle más completo.
 */
export function mergeCallbackReasonSummaries(prevSummary: string, nextSummary: string): string {
  const rawPrev = String(prevSummary || '').replace(/\s+/g, ' ').trim()
  const rawNext = String(nextSummary || '').replace(/\s+/g, ' ').trim()
  if (!rawPrev) return rawNext.slice(0, 2000)
  if (!rawNext) return rawPrev.slice(0, 2000)

  const routeTags: string[] = []
  const statusTags: string[] = []
  const seenTagNorms = new Set<string>()

  const stripAndCollectTags = (input: string): string =>
    input
      .replace(/\[[^\]]+\]/g, (m) => {
        const cleanTag = m.replace(/\s+/g, ' ').trim()
        const normTag = normPhoneTextBasic(cleanTag)
        if (!seenTagNorms.has(normTag)) {
          seenTagNorms.add(normTag)
          if (/^\[llam[oó]\s+a\s+#/i.test(cleanTag)) {
            routeTags.push(cleanTag)
          } else {
            statusTags.push(cleanTag)
          }
        }
        return ' '
      })
      .replace(/\s+/g, ' ')
      .trim()

  const prevBody = stripAndCollectTags(rawPrev)
  const nextBody = stripAndCollectTags(rawNext)
  const rawSegments = [
    ...prevBody.split('|').map((s) => s.trim()),
    ...nextBody.split('|').map((s) => s.trim())
  ].filter(Boolean)

  const kept: string[] = []
  for (const cand of rawSegments) {
    if (/^nota adicional del cliente:\s*(ning[uú]n\s+detalle|sin\s+detalles|nada|none)\b/i.test(cand)) continue
    const normCand = normPhoneTextBasic(cand)
    if (!normCand) continue
    const candTokens = extractSegmentTokens(cand)

    let handled = false
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i]
      const normEx = normPhoneTextBasic(existing)
      if (normCand === normEx || normEx.includes(normCand)) {
        handled = true
        break
      }
      if (normCand.includes(normEx)) {
        kept[i] = cand
        handled = true
        break
      }
      if (isVagueDraftSegment(existing) && !isVagueDraftSegment(cand) && cand.length >= 24) {
        kept[i] = cand
        handled = true
        break
      }
      if (isVagueDraftSegment(cand) && !isVagueDraftSegment(existing)) {
        handled = true
        break
      }
      const exTokens = extractSegmentTokens(existing)
      const minLen = Math.min(candTokens.length, exTokens.length)
      if (minLen >= 2) {
        const exSet = new Set(exTokens)
        let overlap = 0
        for (const t of candTokens) {
          if (exSet.has(t)) overlap++
        }
        if (overlap / minLen >= 0.6) {
          if (cand.length > existing.length) kept[i] = cand
          handled = true
          break
        }
      }
    }
    if (!handled) kept.push(cand)
  }

  const hasValidatedTicket = statusTags.some((t) => /validado en pos/i.test(t))
  const finalStatusTags = statusTags.filter((t) => !(hasValidatedTicket && /(sin ticket|pendiente validar)/i.test(t)))
  const prefix = routeTags.length > 0 ? `${routeTags[routeTags.length - 1]} ` : ''
  const body = kept.join(' | ').trim()
  const suffix = finalStatusTags.length > 0 ? ` ${finalStatusTags.join(' ')}` : ''
  return `${prefix}${body}${suffix}`.replace(/\s+/g, ' ').trim().slice(0, 2000)
}

/**
 * Extrae los turnos sustantivos que el cliente dijo DESPUÉS de la última invocación exitosa de `create_manager_callback`.
 * Se usa como red de seguridad para jamás perder detalles posteriores (ej. "Just tell them no cheese" / "for the taco plate").
 */
export function extractSubstantivePostCallbackUserTurns(transcript: MinimalTranscriptEntry[]): string[] {
  let lastCallbackIdx = -1
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i]
    if (
      entry?.role === 'tool' &&
      entry.toolName === 'create_manager_callback' &&
      (String(entry.text || '').includes('"success":true') || String(entry.text || '').includes('"success": true'))
    ) {
      lastCallbackIdx = i
    }
  }
  if (lastCallbackIdx < 0) return []

  const extras: string[] = []
  for (let i = lastCallbackIdx + 1; i < transcript.length; i++) {
    const entry = transcript[i]
    if (entry?.role !== 'user') continue
    const txt = String(entry.text || '').replace(/\s+/g, ' ').trim()
    if (!txt || isTrivialAckOrFarewellTurn(txt)) continue
    // Ignorar ruido puro de 1 dígito o signos
    if (txt.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').length < 3) continue
    extras.push(txt)
  }
  return extras
}

const INTENT_SUMMARY_PREFIX_ES: Record<string, string> = {
  hours_location: 'Horario / Ubicación',
  menu_prices: 'Menú / Precios',
  breakfast_hours: 'Desayunos',
  payment_ebt: 'Pago / EBT',
  catering_platter: 'Charolas Fiesta Platter',
  delivery_issue: 'Orden Delivery',
  condiments_note: 'Nota de Empaque',
  complaint_missing_item: 'Reclamo de Orden',
  missing_or_wrong_item: 'Reclamo de Orden',
  wrong_store_order: 'Sucursal Equivocada',
  lost_item: 'Objeto Olvidado',
  lost_and_found: 'Objeto Olvidado',
  employee_callout: 'Aviso de Empleado',
  vendor_arrival: 'Proveedor',
  billing_refund: 'Cobro / Reembolso',
  manager_callback: 'Recado al Gerente',
  unanswered_inquiry: 'Consulta Pendiente',
  order_attempt: 'Intento de Orden por Teléfono'
}

function isNavigationOrFragmentTurn(text: string): boolean {
  const norm = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm || norm.length < 3) return true
  if (isTrivialAckOrFarewellTurn(norm)) return true
  // Fragmentos de dígitos sueltos al dictar teléfono (ej. "3 2 3", "513", "704")
  if (/^[\d\s.]{1,12}$/.test(norm)) return true
  return false
}

/**
 * Construye un resumen real, conciso y útil para `phone_calls.summary` en `/admin/llamadas`
 * en lugar de truncar solo el último intercambio (`"Gracias, bye -> ¡Hasta luego!"`).
 */
export function buildMeaningfulCallSummary(params: {
  transcript: MinimalTranscriptEntry[]
  callbackSummary?: string | null
  callbackCallerName?: string | null
  callbackTicket?: string | null
  primaryIntent?: string | null
  unansweredQuestion?: string | null
}): string {
  const transcript = Array.isArray(params.transcript) ? params.transcript : []
  const userTurns = transcript.filter((t) => t?.role === 'user' && String(t.text || '').trim().length > 0)

  if (userTurns.length === 0) {
    return 'Llamada finalizada durante el saludo inicial.'
  }

  // 1. Si hubo recado al gerente, el resumen real del recado es la mejor descripción ejecutiva de la llamada
  const cbSummary = String(params.callbackSummary || '').replace(/\s+/g, ' ').trim()
  if (cbSummary) {
    const who = String(params.callbackCallerName || '').trim()
    const tk = String(params.callbackTicket || '').trim()
    const whoPrefix = who ? `Recado (${who}): ` : 'Recado al gerente: '
    const tkSuffix = tk && !cbSummary.toLowerCase().includes(tk.toLowerCase()) ? ` [${tk}]` : ''
    return `${whoPrefix}${cbSummary}${tkSuffix}`.slice(0, 320)
  }

  // 2. Si hubo duda sin respuesta registrada
  const unanswered = String(params.unansweredQuestion || '').replace(/\s+/g, ' ').trim()
  if (unanswered) {
    return `Consulta pendiente: ${unanswered}`.slice(0, 320)
  }

  // 3. Seleccionar turnos sustantivos (saltando "hola", "ok", "gracias", "bye" y fragmentos numéricos)
  const substantiveEntries: Array<{ idx: number; text: string }> = []
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i]
    if (entry?.role !== 'user') continue
    const txt = String(entry.text || '').replace(/\s+/g, ' ').trim()
    if (!txt || isNavigationOrFragmentTurn(txt)) continue
    substantiveEntries.push({ idx: i, text: txt })
  }

  const intentKey = String(params.primaryIntent || '').trim().toLowerCase()
  const intentPrefix = INTENT_SUMMARY_PREFIX_ES[intentKey] ? `${INTENT_SUMMARY_PREFIX_ES[intentKey]}: ` : ''

  if (substantiveEntries.length === 0) {
    const firstU = userTurns[0].text.replace(/\s+/g, ' ').trim()
    const assistantTurns = transcript.filter((t) => t?.role === 'assistant' && String(t.text || '').trim().length > 0)
    const lastA = assistantTurns[assistantTurns.length - 1]?.text?.replace(/\s+/g, ' ').trim() || ''
    return `${intentPrefix}${firstU.slice(0, 120)}${lastA ? ` -> ${lastA.slice(0, 140)}` : ''}`.slice(0, 320)
  }

  // Tomar el primer turno sustantivo y, si hubo un segundo tema/aclaración importante distinto, combinarlo brevemente
  const primaryUser = substantiveEntries[0]
  let topicText = primaryUser.text
  if (substantiveEntries.length > 1) {
    const extraTopics: string[] = []
    for (const s of substantiveEntries.slice(1)) {
      if (s.text.length < 4) continue
      if (topicText.toLowerCase().includes(s.text.toLowerCase())) continue
      extraTopics.push(s.text)
      if (extraTopics.length >= 2) break
    }
    if (extraTopics.length > 0 && topicText.length < 90) {
      topicText = `${topicText} / ${extraTopics.join(' / ')}`
    }
  }

  // Buscar la respuesta inmediata de Kore al turno sustantivo principal
  let matchedReply = ''
  for (let j = primaryUser.idx + 1; j < transcript.length; j++) {
    if (transcript[j]?.role === 'assistant' && String(transcript[j].text || '').trim()) {
      matchedReply = String(transcript[j].text).replace(/\s+/g, ' ').trim()
      break
    }
    if (transcript[j]?.role === 'user') break
  }

  const cleanTopic = topicText.slice(0, 145)
  const cleanReply = matchedReply.slice(0, 150)
  return `${intentPrefix}${cleanTopic}${cleanReply ? ` -> ${cleanReply}` : ''}`.slice(0, 320)
}
