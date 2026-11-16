/**
 * @module lib/phone-agent
 * @description Motor central de la Contestadora IA Multi-Sucursal (15 tiendas) de Tacos Gavilan.
 * Gestiona la evaluación de horarios (incluyendo cierres de madrugada después de medianoche y días festivos),
 * búsqueda de precios en vivo en `app_menu_cache`, cotizador de Fiesta Platters, Base de Conocimiento Editable
 * (`phone_knowledge_base`), creación de alertas prioritarias en vivo para gerentes (`phone_callback_requests`),
 * bitácora de llamadas (`phone_calls`), validación criptográfica de webhooks de Twilio e instrucciones de desvío
 * condicional para líneas fijas Spectrum Business y celulares Android con AT&T.
 *
 * @businessRules
 * - **Un Solo Módulo Unificado (15 Sucursales)**: Todas las 15 tiendas usan el mismo motor identificando la sucursal
 *   por `store_id` o por el número receptor de Twilio (`twilio_phone_number`).
 * - **Día Laboral y Zona Horaria Oficial**: Toda evaluación de tiempo opera en `America/Los_Angeles`. El día laboral
 *   de Tacos Gavilan inicia a las 6:00 AM y termina a las 5:59:59 AM del día siguiente; el turno PM inicia a las 5:00 PM.
 * - **Horarios Nocturnos (After-Midnight Spillover)**: Si un cliente llama en la madrugada (ej. sábado a la 1:30 AM),
 *   el sistema evalúa primero si el turno nocturno del día calendario anterior (viernes que cierra a las 3:00 AM)
 *   sigue abierto antes de evaluar la apertura matutina del día actual.
 * - **6 Categorías Reales de Llamadas**:
 *   1. Clientes pre-visita (horarios, dirección, Drive-Thru, precios del menú, carnes, Fiesta Platters, formas de pago).
 *   2. Clientes que desean ordenar por teléfono (se canalizan a ordenar en línea en `tacosgavilan.com` o en sucursal).
 *   3. Clientes post-orden con incidencias (faltantes, quejas, objetos olvidados -> recado prioritario en vivo al Manager).
 *   4. Repartidores de Delivery (Uber Eats, DoorDash, Grubhub -> instrucciones de recolección o alerta a tienda).
 *   5. Empleados y Recursos Humanos (avisos de retardo/falta -> alerta prioritaria al Manager; bolsa de trabajo -> información).
 *   6. Proveedores, Técnicos, Corporativo y Filtro Anti-Spam.
 * - **Cumplimiento Legal de California (AB 2905 & Penal Code §632)**: El saludo inicial informa que contesta la
 *   asistente virtual de Tacos Gavilan y que la llamada se transcribe para mejorar el servicio.
 *
 * @dataFlow
 * - Twilio Webhook (`/api/phone/incoming`, `/api/phone/respond`) o Simulador Web (`/api/phone/simulate`)
 *   -> `processPhoneAgentTurn()` -> Gemini Function Calling (`stores`, `app_menu_cache`, `phone_knowledge_base`,
 *   `phone_special_hours`) -> Persistencia en `phone_calls` / `phone_callback_requests` -> Audio WAV (`getPhoneAgentSpeech`
 *   con voz `Kore` cacheada en Supabase Storage).
 *
 * @notes
 * - Soporta las 4 tiendas con línea fija Spectrum Business (Rialto #1, Hollywood #8, Lynwood #14, Downey #16) y las
 *   11 tiendas con celular Android AT&T (West Covina #3, Azusa #4, Broadway #5, Central #6, Slauson #7,
 *   Santa Ana #9, La Puente #10, Huntington Park #11, Norwalk #12, Bell #13, South Gate #15).
 * - FIX 2026-11-06 (texto/audio cortado "...en la su"): los Gemini 3.x cuentan los thinking tokens dentro de
 *   `maxOutputTokens` (antes 180). Ahora `thinkingLevel: 'minimal'` en TODOS los modelos + `maxOutputTokens: 1024`
 *   + `clampPhoneReplyLength()` que recorta solo en fin de oración (máx. 480 caracteres, límite TTS 600).
 * - AUDITORÍA 2026-11-09:
 *   * CRÍTICO: `stores.weekly_hours` es un ARREGLO `[{day,open,close}]` y Rialto #1, West Covina #3 y Azusa #4 vienen
 *     en orden [1..6,0]; se indexaba por posición y la IA daba el horario de OTRO día. Ahora `normalizeWeeklyHours()`.
 *   * Se eliminaron las "respuestas canónicas" fijas: guardaban recados con datos de demo (Juan Hernández 562-555-0188,
 *     Roberto Gómez 323-555-0144) en lugar de los datos reales del cliente e inventaban datos (suadero, horario de
 *     entrevistas 2-4 PM). Todo vuelve a salir de datos vivos + Base de Conocimiento Editable.
 *   * Catálogo de precios generado EN VIVO desde `app_menu_cache` (`buildLiveMenuCatalogText`), antes escrito a mano.
 *   * `sanitizePhoneReplyText` ya no convierte el condicional "Si ..." en afirmación ni mutila "Claro que no".
 *   * Failover con presupuesto global de 13 s por turno (Twilio corta a ~15 s), 404 = salta el MODELO (no la llave),
 *     429 = siguiente modelo, 400 = error determinista sin reintentos.
 *   * Herramientas en paralelo, try/catch por herramienta, anti-duplicado de recados por llamada y estado
 *     `callback_requested` persistente aunque el cliente se despida después.
 *   * Idioma final = idioma real del texto hablado (`detectPhoneTextLanguage`), así voz, bitácora y `<Gather>` coinciden.
 *   * Firma de Twilio: en despliegues de Vercel sin `TWILIO_AUTH_TOKEN` se RECHAZA el webhook (antes se aceptaba todo).
 *   * Se quitó el broadcast público `phone_callback_alert` (sin receptores; exponía nombre/teléfono del cliente).
 *   * STREAMING EN TIEMPO REAL (`streamPhoneAgentSpeechPcm` + `deferDbFlush` + `prewarm`): El audio de la voz `Kore 3.8`
 *     ahora se transmite por fragmentos PCM 24kHz vía `:streamGenerateContent?alt=sse` (~600 ms al primer sonido en vez de
 *     ~3,200 ms, y 0–90 ms desde caché), reduciendo la latencia total percibida de ~5.2 s a ~1.4 s sin cambiar de voz.
 *   * CALENDARIO FESTIVO EN TIEMPO REAL (`lib/holidays.ts` + `phone_special_hours`): Integra las 7 fechas oficiales anuales
 *     validadas contra Toast POS 2023–2026 (Viernes Santo y Navidad cerrados todo el día; Thanksgiving, Nochebuena y Fin de Año
 *     con cierre temprano 4:00 PM; Año Nuevo y Viernes después de Thanksgiving con apertura tarde 11:00 AM), respetando
 *     prioridad 1 = override por tienda en DB, prioridad 2 = regla global en DB, prioridad 3 = cálculo perpetuo multianual.
 * - AUDITORÍA PROFUNDA PRE-PRODUCCIÓN 2026-11-11:
 *   * URLs reales verificadas `order.online` para las 15 sucursales.
 *   * Separación estricta `source: 'twilio' | 'simulator'` en `phone_callback_requests` para no contaminar tablets en tienda.
 *   * Cero desvío/transferencia a celulares personales de gerentes (`shouldTransferToPhone = null`, escalación en PC de tienda), gramática `"a la 1:00 AM"`, lookahead +7 días
 *     en cierres festivos consecutivos, preservación legal CIPA + tecla `9` en saludos personalizados, herramientas
 *     declaradas completas (`get_fiesta_platter_packages` >40 invitados y `get_store_hours_and_status`), filtro de
 *     sustantivos del menú (`Piña`, `Jalapeño`) en `detectPhoneTextLanguage`, y pronunciación vial/telefónica natural
 *     en las 15 sucursales (`lib/phone-speech-format.ts`: sin abreviaturas `S.`, `E.`, `Ave.`, `Rd.`, `Blvd.`, `17th St.`, `Hwy.`, `CA`).
 * - FIX 2026-11-12 (Ingredientes Reales, Regular vs Super y Torta Cubana/Milanesa): `buildLiveMenuCatalogText` y
 *   `menuPreContext` ahora propagan las descripciones reales de Toast POS (`app_menu_cache.description`) al prompt,
 *   `normalizeToastMenuPrep` solo colapsa prefijos de carne estándar simples (preservando especialidades como
 *   `Torta Cubana` `Breaded Steak + Ham + Wiener`, `Torta Milanesa` y `Plato Milanesa` en `Variantes`),
 *   `searchStoreMenuPrices` añade sinónimos bilingües (`milanesa`/`breaded`, `jamon`/`ham`, `salchicha`/`wiener`),
 *   `phone_knowledge_base` respalda Regular vs Super y carnes exactas de Torta Cubana/Milanesa sin alucinaciones,
 *   y `callGeminiPhoneWithFailover` itera model-first (`gemini-3-flash-preview` -> `gemini-3.1-flash-lite-preview`,
 *   omitiendo `gemini-3.6-flash` por timeouts) con enfriamiento `(llave, modelo)` (`keyModelCooldownUntil`) y `MAX_ATTEMPTS = 14`.
 * - FIX 2026-11-12 (Horarios Semanales Reales, Comparativa Determinista, Anclaje de Fecha y Failover GA Rápido):
 *   1) Cada tienda tiene horarios distintos (ej. entre las 6 Drive-Thru, `#6 LA Central` abre 8:00 AM y cierra hasta 4:00 AM
 *   Vie-Sáb / 3:00 AM Jue / 2:00 AM Dom-Mié, mientras `#10 La Puente` cierra 2:00 AM Vie-Sáb / 12:00 AM Dom-Jue y `#3 West Covina`
 *   cierra 3:00 AM Vie-Sáb / 1:00 AM Dom-Jue). `buildCompactWeeklyHours`, `buildCrossStoreHoursComparison`,
 *   `loadAllActiveStoresDirectory` (preservando `weekly_hours`), `storesDirectoryBlock` y `find_other_stores` exponen
 *   tanto el horario semanal compacto individual como los ganadores exactos de apertura más temprana / cierre más tarde
 *   por día (Todas las 15 sucursales vs Drive-Thru), impidiendo generalizaciones o errores de comparación del LLM.
 *   2) `calendarDateLine` ancla las fechas exactas YYYY-MM-DD de HOY y MAÑANA en California y etiqueta festivos futuros
 *   (`[FECHA FUTURA - NO aplica hoy ni mañana]`) para evitar que un viernes normal aplique erróneamente Black Friday.
 *   3) `MODERN_CHAT_MODELS` / `CLASSIC_CHAT_MODELS` priorizan `gemini-3.5-flash-lite` (GA ~0.4-0.85s, 7/7 llaves activas) ->
 *   `gemini-3-flash-preview` -> `gemini-3.1-flash-lite-preview`, con límite `maxAttemptsOnThisModel` y salto rápido ante `503`/`429`
 *   para no agotar los 13s del webhook quemando llaves de un solo modelo caído o sin cuota.
 */

import twilio from 'twilio'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getGeminiKeyPoolWithRemote, VoiceId, resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
import { PARTY_TRAY_GUIDELINES } from '@/lib/inventory/party-tray-guidelines'
import { getOfficialStoreHolidaySchedule, getUpcomingOfficialStoreHolidays } from '@/lib/holidays'
import { extractPhoneDigits, isFictitiousNanpPhone, normalizeUsPhoneE164 } from '@/lib/phone-agent-access'
import {
  expandStreetAbbreviationsInText,
  extractZipCodeFromAddress,
  formatStoreAddressForAgent
} from '@/lib/phone-speech-format'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Orden validado con benchmark en vivo (2026-11-12):
// - gemini-3.5-flash-lite (~0.41-0.85s, 7/7 llaves activas GA, soporta thinking minimal + functionCall) como primario.
// - gemini-3-flash-preview y gemini-3.1-flash-lite-preview como respaldos automáticos con salto rápido si hay 429/503.
// ('gemini-3.6-flash' y 'gemini-3.8-flash' se omiten: sufrieron 429/503 y 3.8 rechaza thinking minimal).
const MODERN_CHAT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview'
]
const CLASSIC_CHAT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview'
]

const keyQuarantineUntil = new Map<string, number>()
const modelUnavailableUntil = new Map<string, number>()
const keyModelCooldownUntil = new Map<string, number>()
let keyRoundRobin = 0

// Cachés en RAM con SWR (Stale-While-Revalidate) y Singleflight para mantener ~0 ms de latencia DB por turno
interface StoreMenuCacheEntry {
  items: any[]
  compactCatalogEs: string
  compactCatalogEn: string
  fetchedAt: number
}
const storeMenuRamCache = new Map<number, StoreMenuCacheEntry>()
const storeMenuInFlight = new Map<number, Promise<StoreMenuCacheEntry | null>>()
const storeContextRamCache = new Map<number, { data: any; fetchedAt: number }>()
const storeContextInFlight = new Map<number, Promise<any>>()
let specialHoursRamCache: { rows: any[]; fetchedAt: number } | null = null
let specialHoursInFlight: Promise<any[]> | null = null
let allKbRamCache: { rows: any[]; fetchedAt: number } | null = null
let allKbInFlight: Promise<any[]> | null = null
const crossStoreCmpRamCache = new Map<string, { text: string; fetchedAt: number }>()

interface PhoneRoutingDirectoryEntry {
  fetchedAt: number
  configs: Array<{ store_id: number; twilio_phone_number: string | null }>
  activeStores: Array<{ id: number; phone: string | null; is_active: boolean | null }>
}
let phoneRoutingDirCache: PhoneRoutingDirectoryEntry | null = null
let phoneRoutingDirInFlight: Promise<PhoneRoutingDirectoryEntry> | null = null

export function invalidatePhoneRoutingDirectoryCache() {
  phoneRoutingDirCache = null
}

export function invalidateStorePhoneContextCache(storeId?: number) {
  crossStoreCmpRamCache.clear()
  specialHoursRamCache = null
  allKbRamCache = null
  invalidatePhoneRoutingDirectoryCache()
  if (storeId && Number.isFinite(storeId)) {
    const id = Number(storeId)
    storeContextRamCache.delete(id)
    storeMenuRamCache.delete(id)
    allStoresDirectoryCache = null
  } else {
    allStoresDirectoryCache = null
    storeContextRamCache.clear()
    storeMenuRamCache.clear()
  }
}

export type PhoneLang = 'es' | 'en'
export type CarrierType = 'spectrum_landline' | 'att_wireless'

export interface StoreScheduleDay {
  open: string
  close: string
}

export interface StoreOpenEvaluation {
  storeId: number
  storeName: string
  isOpenNow: boolean
  activeScheduleDate: string
  activeDayLabelEs: string
  activeDayLabelEn: string
  todayOpen: string
  todayClose: string
  todayOpenFormattedEs: string
  todayCloseFormattedEs: string
  todayOpenFormattedEn: string
  todayCloseFormattedEn: string
  isAfterMidnightSpillover: boolean
  isSpecialHolidaySchedule: boolean
  specialHolidayName: string | null
  statusMessageEs: string
  statusMessageEn: string
  closedGreetingPromptEs?: string | null
  closedGreetingPromptEn?: string | null
  weeklySummaryEs: string
  weeklySummaryEn: string
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool'
  text: string
  timestamp: string
  toolName?: string
}

const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const OFFICIAL_STORE_URLS: Record<number, string> = {
  1: 'https://order.online/store/tacos-gavilan-rialto-841931',
  3: 'https://order.online/store/tacos-gavilan-west-covina-725035',
  4: 'https://order.online/store/tacos-gavilan-azusa-718169',
  5: 'https://order.online/store/tacos-gavilan-los-angeles-260769',
  6: 'https://order.online/store/tacos-gavilan-los-angeles-260847',
  7: 'https://order.online/store/tacos-gavilan-slauson-broadway-23989119',
  8: 'https://order.online/store/tacos-gavilan-los-angeles-551916',
  9: 'https://order.online/store/tacos-gavilan-santa-ana-724574',
  10: 'https://order.online/store/tacos-gavilan-la-puente-963464',
  11: 'https://order.online/store/tacos-gavilan-huntington-park-260849',
  12: 'https://order.online/store/tacos-gavilan-norwalk-1327857',
  13: 'https://order.online/store/tacos-gavilan-bell-260912',
  14: 'https://order.online/store/tacos-gavilan-lynwood-727877',
  15: 'https://order.online/store/tacos-gavilan-south-gate-846517',
  16: 'https://order.online/store/tacos-gavilan-downey-302620'
}

export const OFFICIAL_ORDER_FALLBACK_URL = 'https://order.online/business/-137616'

/**
 * Normaliza texto eliminando tildes/acentos y convirtiendo a minúsculas para búsquedas tolerantes.
 */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return ''
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[/\-+&]/g, ' ')
    .replace(/[¿?¡!.,;:()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

/**
 * Limpia el nombre oficial de la sucursal eliminando el prefijo "Tacos Gavilan" (y guiones separadores)
 * y el prefijo "LA " para que las sucursales #5 y #6 se muestren y pronuncien siempre como "Broadway" y "Central",
 * preservando "La Puente" (#10) intacto.
 */
export function cleanPhoneStoreName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .replace(/^Tacos\s+(?:El\s+)?Gavil[aá]n\s*[-–—:]?\s*/i, '')
    .replace(/^[-–—:]+\s*/, '')
    .replace(/^LA\s+(Broadway|Central)\b/i, '$1')
    .trim()
}

/**
 * Convierte una hora en formato "HH:MM" (24h) a minutos desde las 00:00.
 */
function isClosedTimeToken(raw: unknown): boolean {
  const s = String(raw || '').trim().toLowerCase()
  return !s || s === 'closed' || s === 'cerrado' || s === 'cerrada' || s === 'off'
}

export function parseTimeToMinutes(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 480
  if (isClosedTimeToken(hhmm)) return 480
  const parts = hhmm.trim().split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return 480
  return h * 60 + m
}

/**
 * Formatea una hora "HH:MM" (24h) en formato limpio de 12 horas (ej. "8:00 AM", "12:00 AM", "12:00 PM")
 * sin paréntesis hablados para que el motor TTS pronuncie las horas con total fluidez.
 */
export function formatTime12h(hhmm: string | null | undefined, lang: PhoneLang = 'es'): string {
  if (!hhmm) return ''
  if (isClosedTimeToken(hhmm)) return lang === 'en' ? 'Closed' : 'Cerrado'
  const parts = hhmm.trim().split(':')
  const hRaw = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (!Number.isFinite(hRaw) || !Number.isFinite(m) || hRaw < 0 || hRaw > 24 || m < 0 || m > 59 || (hRaw === 24 && m > 0)) return hhmm

  const h = hRaw === 24 ? 0 : hRaw
  const minStr = String(m).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${minStr} ${period}`
}

const PACIFIC_PARTS_DTF = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/**
 * Extrae las partes de fecha y hora en la zona horaria oficial `America/Los_Angeles` usando formatter singleton.
 */
export function getPacificDateParts(now: Date = new Date()): {
  dateStr: string
  yesterdayDateStr: string
  dayOfWeek: number
  yesterdayDayOfWeek: number
  hour: number
  minute: number
  currentMinutes: number
} {
  const parts = PACIFIC_PARTS_DTF.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''

  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute'))

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  }
  const dayOfWeek = weekdayMap[get('weekday')] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const yesterdayDayOfWeek = (dayOfWeek + 6) % 7

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const yesterdayUtc = new Date(Date.UTC(year, month - 1, day))
  yesterdayUtc.setUTCDate(yesterdayUtc.getUTCDate() - 1)
  const yesterdayDateStr = yesterdayUtc.toISOString().slice(0, 10)

  return {
    dateStr,
    yesterdayDateStr,
    dayOfWeek,
    yesterdayDayOfWeek,
    hour,
    minute,
    currentMinutes: hour * 60 + minute
  }
}

/**
 * Normaliza `stores.weekly_hours` a un mapa indexado por día de la semana (0=Domingo ... 6=Sábado).
 * En la base de datos real `weekly_hours` es un ARREGLO `[{ day, open, close }]` cuyo orden NO es uniforme:
 * Rialto #1, West Covina #3 y Azusa #4 vienen en orden [1,2,3,4,5,6,0]. Indexar el arreglo por posición
 * desfasaba un día completo el horario de esas 3 tiendas, por eso SIEMPRE se indexa por el campo `day`.
 */
const DAY_KEY_ALIASES: Record<string, number> = {
  '0': 0, sunday: 0, sun: 0, domingo: 0, dom: 0,
  '1': 1, monday: 1, mon: 1, lunes: 1, lun: 1,
  '2': 2, tuesday: 2, tue: 2, tues: 2, martes: 2, mar: 2,
  '3': 3, wednesday: 3, wed: 3, miercoles: 3, mie: 3,
  '4': 4, thursday: 4, thu: 4, thur: 4, thurs: 4, jueves: 4, jue: 4,
  '5': 5, friday: 5, fri: 5, viernes: 5, vie: 5,
  '6': 6, saturday: 6, sat: 6, sabado: 6, sab: 6,
}

function resolveDayIndex(rawDay: unknown): number | null {
  if (typeof rawDay === 'number' && Number.isInteger(rawDay) && rawDay >= 0 && rawDay <= 6) {
    return rawDay
  }
  const normalized = String(rawDay ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  return Object.prototype.hasOwnProperty.call(DAY_KEY_ALIASES, normalized) ? DAY_KEY_ALIASES[normalized] : null
}

export function normalizeWeeklyHours(raw: unknown): Record<string, StoreScheduleDay> {
  let source: unknown = raw
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return {}
    }
  }
  const toSlot = (entry: any): StoreScheduleDay | null => {
    if (!entry) return null
    if (entry.is_closed === true || isClosedTimeToken(entry.open) || isClosedTimeToken(entry.close)) {
      return { open: 'CLOSED', close: 'CLOSED' }
    }
    if (entry.open && entry.close) {
      return { open: String(entry.open).trim(), close: String(entry.close).trim() }
    }
    return null
  }
  const out: Record<string, StoreScheduleDay> = {}
  if (Array.isArray(source)) {
    for (const row of source) {
      const day = resolveDayIndex(row?.day)
      const slot = toSlot(row)
      if (day !== null && slot) {
        out[String(day)] = slot
      }
    }
    return out
  }
  if (source && typeof source === 'object') {
    for (const [k, v] of Object.entries(source as Record<string, any>)) {
      const day = resolveDayIndex(k)
      const slot = toSlot(v)
      if (day !== null && slot) {
        out[String(day)] = slot
      }
    }
  }
  return out
}

/**
 * Extrae la etiqueta de festividad en el idioma solicitado cuando el nombre viene bilingüe ("Español / English").
 */
export function localizeHolidayLabel(rawName: string | null | undefined, lang: PhoneLang, eventDate?: string): string {
  if (eventDate) {
    const official = getOfficialStoreHolidaySchedule(eventDate)
    if (official && (!rawName || rawName === official.holiday_name)) {
      return lang === 'en' ? official.holiday_name_en : official.holiday_name_es
    }
  }
  if (!rawName) return ''
  const parts = String(rawName)
    .split(/\s+\/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return lang === 'en' ? parts[1] : parts[0]
  }
  return String(rawName).trim()
}

function normalizeHhMm(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Fusiona los días festivos configurados en `phone_special_hours` (override por sucursal > regla global)
 * con las 7 fechas oficiales perpetuas de `lib/holidays.ts`, calculando las horas reales de apertura y cierre
 * para la sucursal consultada (`weeklyHours`). Respeta estrictamente el límite superior `<= endDateStr`.
 */
export function buildEffectiveUpcomingHolidaysForStore(params: {
  storeId: number
  weeklyHours: unknown
  specialHours?: Array<{
    store_id: number | null
    event_date: string
    holiday_name: string
    is_closed: boolean
    open_time: string | null
    close_time: string | null
  }>
  fromDateStr: string
  daysAhead?: number
}) {
  const { storeId, specialHours = [], fromDateStr, daysAhead = 180 } = params
  const wh = normalizeWeeklyHours(params.weeklyHours)
  const officialUpcoming = getUpcomingOfficialStoreHolidays(fromDateStr, daysAhead)
  const endUtc = new Date(`${fromDateStr}T12:00:00Z`)
  endUtc.setUTCDate(endUtc.getUTCDate() + Math.max(1, Math.trunc(daysAhead)))
  const endDateStr = Number.isNaN(endUtc.getTime()) ? '9999-12-31' : endUtc.toISOString().slice(0, 10)

  const allDates = new Set<string>()
  const numericStoreId = Number(storeId)
  for (const s of specialHours) {
    if (
      s?.event_date &&
      s.event_date >= fromDateStr &&
      s.event_date <= endDateStr &&
      (s.store_id === null || Number(s.store_id) === numericStoreId)
    ) {
      allDates.add(s.event_date)
    }
  }
  for (const off of officialUpcoming) {
    allDates.add(off.event_date)
  }

  const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b))

  return sortedDates.map((dStr) => {
    const dow = new Date(`${dStr}T12:00:00Z`).getUTCDay()
    const regular = wh[String(dow)] || { open: '10:00', close: '00:00' }
    const regularClosed = isClosedTimeToken(regular.open) || isClosedTimeToken(regular.close)

    const storeSpecific = specialHours.find(
      (s) => s.event_date === dStr && s.store_id !== null && Number(s.store_id) === numericStoreId
    )
    const globalRow = !storeSpecific ? specialHours.find((s) => s.event_date === dStr && s.store_id === null) : null
    const dbMatch = storeSpecific || globalRow || null

    if (dbMatch) {
      const openOverride = normalizeHhMm(dbMatch.open_time)
      const closeOverride = normalizeHhMm(dbMatch.close_time)
      const isClosed = Boolean(dbMatch.is_closed) || (!openOverride && !closeOverride && regularClosed)
      let effectiveOpen = regular.open
      if (!isClosed && openOverride) {
        effectiveOpen =
          !storeSpecific && !regularClosed && parseTimeToMinutes(openOverride) < parseTimeToMinutes(regular.open)
            ? regular.open
            : openOverride
      }
      const effectiveClose = isClosed ? 'CLOSED' : closeOverride || regular.close
      return {
        event_date: dStr,
        holiday_name: dbMatch.holiday_name,
        holiday_name_es: localizeHolidayLabel(dbMatch.holiday_name, 'es', dStr),
        holiday_name_en: localizeHolidayLabel(dbMatch.holiday_name, 'en', dStr),
        is_closed: isClosed,
        open_time: openOverride,
        close_time: closeOverride,
        effective_open: effectiveOpen,
        effective_close: effectiveClose,
        is_early_close_only: !isClosed && !openOverride && Boolean(closeOverride),
        is_late_open_only: !isClosed && Boolean(openOverride) && !closeOverride,
        source: storeSpecific ? ('store_override' as const) : ('global_db' as const)
      }
    }

    const official = getOfficialStoreHolidaySchedule(dStr)!
    const isClosed = official.is_closed
    let effectiveOpen = regular.open
    if (!isClosed && official.open_time) {
      effectiveOpen =
        parseTimeToMinutes(official.open_time) > parseTimeToMinutes(regular.open) ? official.open_time : regular.open
    }
    const effectiveClose = isClosed ? 'CLOSED' : official.close_time || regular.close

    return {
      event_date: dStr,
      holiday_name: official.holiday_name,
      holiday_name_es: official.holiday_name_es,
      holiday_name_en: official.holiday_name_en,
      is_closed: isClosed,
      open_time: official.open_time,
      close_time: official.close_time,
      effective_open: isClosed ? 'CLOSED' : effectiveOpen,
      effective_close: effectiveClose,
      is_early_close_only: !isClosed && !official.open_time && Boolean(official.close_time),
      is_late_open_only: !isClosed && Boolean(official.open_time) && !official.close_time,
      source: 'official_calendar' as const
    }
  })
}

/**
 * Evalúa con precisión si una sucursal está abierta o cerrada en un instante dado (`now`),
 * contemplando los cierres de madrugada después de medianoche (00:00 a 05:59 AM) del día anterior,
 * los overrides en `phone_special_hours` y las 7 fechas oficiales perpetuas de `lib/holidays.ts`.
 */
export function evaluateStoreSchedulePure(params: {
  storeId: number
  storeName: string
  weeklyHours: unknown
  specialHours?: Array<{
    store_id: number | null
    event_date: string
    holiday_name: string
    is_closed: boolean
    open_time: string | null
    close_time: string | null
  }>
  now?: Date
}): StoreOpenEvaluation {
  const { storeId, specialHours = [], now = new Date() } = params
  const storeName = cleanPhoneStoreName(params.storeName)
  const pt = getPacificDateParts(now)
  const wh = normalizeWeeklyHours(params.weeklyHours)

  const addUtcDays = (baseDateStr: string, days: number) => {
    const u = new Date(`${baseDateStr}T12:00:00Z`)
    u.setUTCDate(u.getUTCDate() + days)
    return u.toISOString().slice(0, 10)
  }

  const numericStoreId = Number(storeId)
  const findSpecialForDate = (dStr: string) => {
    const storeSpecific = specialHours.find(
      (s) => s.event_date === dStr && s.store_id !== null && Number(s.store_id) === numericStoreId
    )
    if (storeSpecific) return storeSpecific
    return specialHours.find((s) => s.event_date === dStr && s.store_id === null) || null
  }

  const atTimeEs = (formatted12h: string) =>
    /^1:/i.test(formatted12h.trim()) ? `a la ${formatted12h}` : `a las ${formatted12h}`
  const cleanSpokenHoliday = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim()
  const expandHolidayMonthsEn = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\bJan\b/g, 'January')
      .replace(/\bFeb\b/g, 'February')
      .replace(/\bMar\b/g, 'March')
      .replace(/\bApr\b/g, 'April')
      .replace(/\bJun\b/g, 'June')
      .replace(/\bJul\b/g, 'July')
      .replace(/\bAug\b/g, 'August')
      .replace(/\bSep\b/g, 'September')
      .replace(/\bOct\b/g, 'October')
      .replace(/\bNov\b/g, 'November')
      .replace(/\bDec\b/g, 'December')
  const formatHolidayForParenhEs = (raw: string | null | undefined) => {
    const s = String(raw || '').trim()
    if (!s) return ''
    return s.replace(/\s*\(([^)]*)\)/g, ' — $1').replace(/\s+,/g, ',').trim()
  }
  const formatHolidayForParenEn = (raw: string | null | undefined) => {
    const s = expandHolidayMonthsEn(raw).trim()
    if (!s) return ''
    return s.replace(/\s*\(([^)]*)\)/g, ', $1').replace(/\s+,/g, ',').trim()
  }

  const getScheduleForDay = (dayIdx: number, dStr: string) => {
    const regular = wh[String(dayIdx)] || { open: '10:00', close: '00:00' }
    const regularClosed = isClosedTimeToken(regular.open) || isClosedTimeToken(regular.close)
    const sp = findSpecialForDate(dStr)
    if (sp) {
      const openOverride = normalizeHhMm(sp.open_time)
      const closeOverride = normalizeHhMm(sp.close_time)
      let effOpen = regular.open
      if (openOverride) {
        effOpen =
          sp.store_id === null && !regularClosed && parseTimeToMinutes(openOverride) < parseTimeToMinutes(regular.open)
            ? regular.open
            : openOverride
      }
      return {
        isClosedAllDay: Boolean(sp.is_closed) || (!openOverride && !closeOverride && regularClosed),
        open: effOpen,
        close: closeOverride || regular.close,
        isSpecial: true,
        holidayName: localizeHolidayLabel(sp.holiday_name, 'es', dStr) || sp.holiday_name,
        holidayNameEn: localizeHolidayLabel(sp.holiday_name, 'en', dStr) || sp.holiday_name
      }
    }

    const official = getOfficialStoreHolidaySchedule(dStr)
    if (official) {
      let effOpen = regular.open
      if (official.open_time) {
        effOpen =
          parseTimeToMinutes(official.open_time) > parseTimeToMinutes(regular.open) ? official.open_time : regular.open
      }
      return {
        isClosedAllDay: official.is_closed,
        open: effOpen,
        close: official.close_time || regular.close,
        isSpecial: true,
        holidayName: official.holiday_name_es,
        holidayNameEn: official.holiday_name_en
      }
    }

    return {
      isClosedAllDay: regularClosed,
      open: regularClosed ? 'CLOSED' : regular.open || '10:00',
      close: regularClosed ? 'CLOSED' : regular.close || '00:00',
      isSpecial: false,
      holidayName: null as string | null,
      holidayNameEn: null as string | null
    }
  }

  // Busca el próximo día abierto hasta +7 días para soportar cierres especiales consecutivos
  const findNextOpenDay = (fromDaysAhead: number = 1) => {
    for (let offset = fromDaysAhead; offset <= 7; offset++) {
      const dStr = addUtcDays(pt.dateStr, offset)
      const dow = (pt.dayOfWeek + offset) % 7
      const sched = getScheduleForDay(dow, dStr)
      if (!sched.isClosedAllDay) {
        return { offset, dStr, dow, sched }
      }
    }
    return null
  }

  // 1. Verificar primero si estamos en la madrugada (00:00 - 05:59 AM) y el turno de AYER sigue abierto
  const yesterdaySched = getScheduleForDay(pt.yesterdayDayOfWeek, pt.yesterdayDateStr)
  if (!yesterdaySched.isClosedAllDay) {
    const yOpenMin = parseTimeToMinutes(yesterdaySched.open)
    const yCloseMin = parseTimeToMinutes(yesterdaySched.close)
    // Si cierra después de medianoche (ej. "01:00", "02:00", "03:00", "04:00"), yCloseMin <= 359 y yCloseMin > 0
    if (yCloseMin > 0 && yCloseMin <= 359 && yCloseMin <= yOpenMin && pt.currentMinutes < yCloseMin) {
      const openEs = formatTime12h(yesterdaySched.open, 'es')
      const closeEs = formatTime12h(yesterdaySched.close, 'es')
      const openEn = formatTime12h(yesterdaySched.open, 'en')
      const closeEn = formatTime12h(yesterdaySched.close, 'en')
      const dayEs = DAY_NAMES_ES[pt.yesterdayDayOfWeek]
      const dayEn = DAY_NAMES_EN[pt.yesterdayDayOfWeek]
      const todayCalSched = getScheduleForDay(pt.dayOfWeek, pt.dateStr)
      const closedDayNoteEs = todayCalSched.isClosedAllDay
        ? ` (Nota: después de cerrar ${atTimeEs(closeEs)}, permaneceremos cerrados el resto del día por ${cleanSpokenHoliday(todayCalSched.holidayName) || 'día festivo'})`
        : ''
      const closedDayNoteEn = todayCalSched.isClosedAllDay
        ? ` (Note: after closing at ${closeEn}, we remain closed for the rest of the day for ${cleanSpokenHoliday(todayCalSched.holidayNameEn || todayCalSched.holidayName) || 'the holiday'})`
        : ''

      return {
        storeId,
        storeName,
        isOpenNow: true,
        activeScheduleDate: pt.yesterdayDateStr,
        activeDayLabelEs: dayEs,
        activeDayLabelEn: dayEn,
        todayOpen: yesterdaySched.open,
        todayClose: yesterdaySched.close,
        todayOpenFormattedEs: openEs,
        todayCloseFormattedEs: closeEs,
        todayOpenFormattedEn: openEn,
        todayCloseFormattedEn: closeEn,
        isAfterMidnightSpillover: true,
        isSpecialHolidaySchedule: yesterdaySched.isSpecial || todayCalSched.isSpecial,
        specialHolidayName: todayCalSched.holidayName || yesterdaySched.holidayName,
        statusMessageEs: `La sucursal ${storeName} está ABIERTA en este momento; nuestro turno nocturno de ${dayEs} cierra hoy ${atTimeEs(closeEs)}${closedDayNoteEs}.`,
        statusMessageEn: `Our ${storeName} location is OPEN right now; our ${dayEn} late-night shift closes at ${closeEn}${closedDayNoteEn}.`,
        closedGreetingPromptEs: null,
        closedGreetingPromptEn: null,
        weeklySummaryEs: buildWeeklySummary(wh, 'es'),
        weeklySummaryEn: buildWeeklySummary(wh, 'en')
      }
    }
  }

  // 2. Evaluar el horario del día calendario actual (HOY)
  const todaySched = getScheduleForDay(pt.dayOfWeek, pt.dateStr)
  const dayEs = DAY_NAMES_ES[pt.dayOfWeek]
  const dayEn = DAY_NAMES_EN[pt.dayOfWeek]

  if (todaySched.isClosedAllDay) {
    const nextOpen = findNextOpenDay(1)
    const nextOpenEs = nextOpen ? formatTime12h(nextOpen.sched.open, 'es') : ''
    const nextOpenEn = nextOpen ? formatTime12h(nextOpen.sched.open, 'en') : ''
    const reopenDayPhraseEs = nextOpen
      ? nextOpen.offset === 1
        ? `mañana ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`
        : `el ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`
      : ''
    const reopenDayPhraseEn = nextOpen
      ? nextOpen.offset === 1
        ? `tomorrow, ${DAY_NAMES_EN[nextOpen.dow]},`
        : `on ${DAY_NAMES_EN[nextOpen.dow]}`
      : ''

    const reopenTailEs = nextOpen
      ? ` ${nextOpen.offset === 1 ? `Mañana ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}` : `El ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()}`} reanudamos servicio ${atTimeEs(nextOpenEs)}.`
      : ''
    const reopenTailEn = nextOpen
      ? ` We reopen ${nextOpen.offset === 1 ? `tomorrow (${DAY_NAMES_EN[nextOpen.dow]})` : `on ${DAY_NAMES_EN[nextOpen.dow]}`} at ${nextOpenEn}.`
      : ''
    const spokenHolEs = cleanSpokenHoliday(todaySched.holidayName) || dayEs
    const spokenHolEn = cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName) || dayEn
    const reopenSpokenEs = nextOpen ? ` y reanudamos servicio ${reopenDayPhraseEs} ${atTimeEs(nextOpenEs)}` : ''
    const reopenSpokenEn = nextOpen ? `, and we reopen ${reopenDayPhraseEn} at ${nextOpenEn}` : ''

    return {
      storeId,
      storeName,
      isOpenNow: false,
      activeScheduleDate: pt.dateStr,
      activeDayLabelEs: dayEs,
      activeDayLabelEn: dayEn,
      todayOpen: 'CLOSED',
      todayClose: 'CLOSED',
      todayOpenFormattedEs: 'Cerrado',
      todayCloseFormattedEs: 'Cerrado',
      todayOpenFormattedEn: 'Closed',
      todayCloseFormattedEn: 'Closed',
      isAfterMidnightSpillover: false,
      isSpecialHolidaySchedule: true,
      specialHolidayName: todaySched.holidayName,
      statusMessageEs: `Hoy (${formatHolidayForParenhEs(todaySched.holidayName) || dayEs}) la sucursal ${storeName} permanece cerrada todo el día por día festivo.${reopenTailEs}`,
      statusMessageEn: `Today (${formatHolidayForParenEn(todaySched.holidayNameEn) || dayEn}) our ${storeName} location is closed all day for the holiday.${reopenTailEn}`,
      closedGreetingPromptEs: `En este momento nuestra sucursal está cerrada; hoy permanecemos cerrados todo el día por ${spokenHolEs}${reopenSpokenEs}. ¿En qué te puedo ayudar?`,
      closedGreetingPromptEn: `Our location is currently closed all day for ${spokenHolEn}${reopenSpokenEn}. How can I help you?`,
      weeklySummaryEs: buildWeeklySummary(wh, 'es'),
      weeklySummaryEn: buildWeeklySummary(wh, 'en')
    }
  }

  const openMin = parseTimeToMinutes(todaySched.open)
  const rawCloseMin = parseTimeToMinutes(todaySched.close)
  // Si rawCloseMin <= openMin (ej. cierra a las 00:00 medianoche o 01:00 / 03:00 AM del día siguiente), sumamos 1440
  const effectiveCloseMin = rawCloseMin <= openMin ? rawCloseMin + 1440 : rawCloseMin
  const isOpenNow = pt.currentMinutes >= openMin && pt.currentMinutes < effectiveCloseMin

  const openEs = formatTime12h(todaySched.open, 'es')
  const closeEs = formatTime12h(todaySched.close, 'es')
  const openEn = formatTime12h(todaySched.open, 'en')
  const closeEn = formatTime12h(todaySched.close, 'en')

  let statusMessageEs = ''
  let statusMessageEn = ''
  let closedGreetingPromptEs: string | null = null
  let closedGreetingPromptEn: string | null = null

  if (isOpenNow) {
    if (todaySched.isSpecial && todaySched.holidayName) {
      const hEs = formatHolidayForParenhEs(todaySched.holidayName)
      const hEn = formatHolidayForParenEn(todaySched.holidayNameEn || todaySched.holidayName)
      statusMessageEs = `La sucursal ${storeName} está ABIERTA en este momento. Hoy ${dayEs} (${hEs}) tenemos horario especial de ${openEs} a ${closeEs}.`
      statusMessageEn = `Our ${storeName} location is OPEN right now. Today (${dayEn}, ${hEn}) our special holiday hours are ${openEn} to ${closeEn}.`
    } else {
      statusMessageEs = `La sucursal ${storeName} está ABIERTA en este momento. Hoy ${dayEs} nuestro horario es de ${openEs} a ${closeEs}.`
      statusMessageEn = `Our ${storeName} location is OPEN right now. Today (${dayEn}) our hours are ${openEn} to ${closeEn}.`
    }
  } else if (pt.currentMinutes < openMin) {
    if (todaySched.isSpecial && todaySched.holidayName) {
      const spokenHolEs = cleanSpokenHoliday(todaySched.holidayName)
      const spokenHolEn = expandHolidayMonthsEn(cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName))
      const hEs = formatHolidayForParenhEs(todaySched.holidayName)
      const hEn = formatHolidayForParenEn(todaySched.holidayNameEn || todaySched.holidayName)
      statusMessageEs = `En este momento la sucursal ${storeName} está cerrada. Hoy ${dayEs} (${hEs}) abrimos en horario especial ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}.`
      statusMessageEn = `Our ${storeName} location is currently closed. Today (${dayEn}, ${hEn}) we open at ${openEn} (special holiday hours) and close at ${closeEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal aún está cerrada; hoy por ${spokenHolEs} abrimos en horario especial ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; today for ${spokenHolEn} we open at ${openEn} and close at ${closeEn}. How can I help you?`
    } else {
      statusMessageEs = `En este momento la sucursal ${storeName} está cerrada. Hoy ${dayEs} abrimos ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}.`
      statusMessageEn = `Our ${storeName} location is currently closed. Today (${dayEn}) we open at ${openEn} and close at ${closeEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal aún está cerrada; hoy ${dayEs.toLowerCase()} abrimos ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; today, ${dayEn}, we open at ${openEn} and close at ${closeEn}. How can I help you?`
    }
  } else {
    // Ya cerró por hoy: anunciar el motivo si fue cierre temprano festivo + la apertura REAL siguiente (lookahead hasta +7 días)
    const closedReasonEs = todaySched.isSpecial && todaySched.holidayName ? ` por horario especial de ${cleanSpokenHoliday(todaySched.holidayName)}` : ''
    const closedReasonEn =
      todaySched.isSpecial && (todaySched.holidayNameEn || todaySched.holidayName)
        ? ` for ${expandHolidayMonthsEn(cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName))} special hours`
        : ''

    const regToday = wh[String(pt.dayOfWeek)] || { open: '10:00', close: '00:00' }
    const regCloseMin = parseTimeToMinutes(regToday.close)
    const regEffCloseMin = regCloseMin <= parseTimeToMinutes(regToday.open) ? regCloseMin + 1440 : regCloseMin
    const closedEarlierThanUsual = todaySched.isSpecial && effectiveCloseMin < regEffCloseMin

    const spokenTodayHolEs = cleanSpokenHoliday(todaySched.holidayName)
    const spokenTodayHolEn = cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName)
    const todayClosedPartEs =
      todaySched.isSpecial && spokenTodayHolEs
        ? `hoy por ${spokenTodayHolEs} ${closedEarlierThanUsual ? 'cerramos temprano' : 'cerramos'} ${atTimeEs(closeEs)}`
        : `hoy cerramos ${atTimeEs(closeEs)}`
    const todayClosedPartEn =
      todaySched.isSpecial && spokenTodayHolEn
        ? `today for ${spokenTodayHolEn} we ${closedEarlierThanUsual ? 'closed early' : 'closed'} at ${closeEn}`
        : `we closed for the night at ${closeEn}`

    const tomorrowDateStr = addUtcDays(pt.dateStr, 1)
    const tomorrowDow = (pt.dayOfWeek + 1) % 7
    const tomorrowSched = getScheduleForDay(tomorrowDow, tomorrowDateStr)

    if (tomorrowSched.isClosedAllDay) {
      const nextOpen = findNextOpenDay(2)
      const nextOpenEs = nextOpen ? formatTime12h(nextOpen.sched.open, 'es') : ''
      const nextOpenEn = nextOpen ? formatTime12h(nextOpen.sched.open, 'en') : ''
      const reopenNextEs = nextOpen
        ? ` y reanudamos servicio el ${DAY_NAMES_ES[nextOpen.dow].toLowerCase()} ${atTimeEs(nextOpenEs)}`
        : ''
      const reopenNextEn = nextOpen
        ? `, and reopen ${DAY_NAMES_EN[nextOpen.dow]} at ${nextOpenEn}`
        : ''
      const spokenTomHolEs = cleanSpokenHoliday(tomorrowSched.holidayName)
      const spokenTomHolEn = cleanSpokenHoliday(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)
      const reopenSpokenNextEn = nextOpen
        ? `, and we reopen ${DAY_NAMES_EN[nextOpen.dow]} at ${nextOpenEn}`
        : ''

      statusMessageEs = `En este momento la sucursal ${storeName} ya cerró por hoy (cerró ${atTimeEs(closeEs)}${closedReasonEs}). Mañana permanecemos cerrados${tomorrowSched.holidayName ? ` por ${formatHolidayForParenhEs(tomorrowSched.holidayName)}` : ''}${reopenNextEs}.`
      statusMessageEn = `Our ${storeName} location is closed for the day (closed at ${closeEn}${closedReasonEn}). We will be closed tomorrow${tomorrowSched.holidayNameEn || tomorrowSched.holidayName ? ` for ${formatHolidayForParenEn(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)}` : ''}${reopenNextEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal ya está cerrada; ${todayClosedPartEs}, mañana permanecemos cerrados${spokenTomHolEs ? ` por ${spokenTomHolEs}` : ''}${reopenNextEs}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; ${todayClosedPartEn}, we remain closed tomorrow${spokenTomHolEn ? ` for ${spokenTomHolEn}` : ''}${reopenSpokenNextEn}. How can I help you?`
    } else {
      const tomOpenEs = formatTime12h(tomorrowSched.open, 'es')
      const tomOpenEn = formatTime12h(tomorrowSched.open, 'en')
      const tomCloseNoteEs = tomorrowSched.isSpecial && tomorrowSched.close ? ` y cerramos ${atTimeEs(formatTime12h(tomorrowSched.close, 'es'))}` : ''
      const tomCloseNoteEn = tomorrowSched.isSpecial && tomorrowSched.close ? ` and close at ${formatTime12h(tomorrowSched.close, 'en')}` : ''
      const tomorrowSpecialEs =
        tomorrowSched.isSpecial && tomorrowSched.holidayName ? ` (horario especial por ${formatHolidayForParenhEs(tomorrowSched.holidayName)}${tomCloseNoteEs})` : ''
      const tomorrowSpecialEn =
        tomorrowSched.isSpecial && (tomorrowSched.holidayNameEn || tomorrowSched.holidayName)
          ? ` (${formatHolidayForParenEn(tomorrowSched.holidayNameEn || tomorrowSched.holidayName)} special hours${tomCloseNoteEn})`
          : ''

      statusMessageEs = `En este momento la sucursal ${storeName} ya cerró por hoy (cerró ${atTimeEs(closeEs)}${closedReasonEs}). Mañana abrimos ${atTimeEs(tomOpenEs)}${tomorrowSpecialEs}.`
      statusMessageEn = `Our ${storeName} location is closed for the day (closed at ${closeEn}${closedReasonEn}). We reopen tomorrow at ${tomOpenEn}${tomorrowSpecialEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal ya está cerrada; ${todayClosedPartEs} y mañana ${DAY_NAMES_ES[tomorrowDow].toLowerCase()} abrimos ${atTimeEs(tomOpenEs)}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; ${todayClosedPartEn}, and we reopen tomorrow, ${DAY_NAMES_EN[tomorrowDow]}, at ${tomOpenEn}. How can I help you?`
    }
  }

  return {
    storeId,
    storeName,
    isOpenNow,
    activeScheduleDate: pt.dateStr,
    activeDayLabelEs: dayEs,
    activeDayLabelEn: dayEn,
    todayOpen: todaySched.open,
    todayClose: todaySched.close,
    todayOpenFormattedEs: openEs,
    todayCloseFormattedEs: closeEs,
    todayOpenFormattedEn: openEn,
    todayCloseFormattedEn: closeEn,
    isAfterMidnightSpillover: false,
    isSpecialHolidaySchedule: todaySched.isSpecial,
    specialHolidayName: todaySched.holidayName,
    statusMessageEs,
    statusMessageEn,
    closedGreetingPromptEs,
    closedGreetingPromptEn,
    weeklySummaryEs: buildWeeklySummary(wh, 'es'),
    weeklySummaryEn: buildWeeklySummary(wh, 'en')
  }
}

function buildWeeklySummary(wh: Record<string, StoreScheduleDay>, lang: PhoneLang): string {
  const names = lang === 'es' ? DAY_NAMES_ES : DAY_NAMES_EN
  const parts: string[] = []
  for (let d = 0; d <= 6; d++) {
    const slot = wh[String(d)]
    if (!slot) continue
    const closed = isClosedTimeToken(slot.open) || isClosedTimeToken(slot.close)
    parts.push(
      closed
        ? `${names[d]}: ${lang === 'en' ? 'Closed' : 'Cerrado'}`
        : `${names[d]}: ${formatTime12h(slot.open, lang)} - ${formatTime12h(slot.close, lang)}`
    )
  }
  return parts.join(' | ')
}

/**
 * Resume el horario semanal en bloques compactos de días consecutivos con el mismo horario
 * (ej. "Dom-Jue 10:00 AM-1:00 AM; Vie-Sáb 10:00 AM-3:00 AM") para mostrar los horarios reales
 * de las 15 sucursales sin inflar el prompt ni perder diferencias entre días.
 */
export function buildCompactWeeklyHours(rawWeeklyHours: unknown, lang: PhoneLang): string {
  const wh = normalizeWeeklyHours(rawWeeklyHours)
  const shortEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const shortEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const names = lang === 'es' ? shortEs : shortEn

  const groups: Array<{ start: number; end: number; open: string; close: string }> = []
  for (let d = 0; d <= 6; d++) {
    const slot = wh[String(d)]
    if (!slot) continue
    const last = groups[groups.length - 1]
    if (last && last.end === d - 1 && last.open === slot.open && last.close === slot.close) {
      last.end = d
    } else {
      groups.push({ start: d, end: d, open: slot.open, close: slot.close })
    }
  }

  return groups
    .map((g) => {
      const dayLabel = g.start === g.end ? names[g.start] : `${names[g.start]}-${names[g.end]}`
      const closed = isClosedTimeToken(g.open) || isClosedTimeToken(g.close)
      return closed
        ? `${dayLabel} ${lang === 'en' ? 'Closed' : 'Cerrado'}`
        : `${dayLabel} ${formatTime12h(g.open, lang)}-${formatTime12h(g.close, lang)}`
    })
    .join('; ')
}

function getEffectiveCloseMinutes(openHHMM: string, closeHHMM: string): number {
  const openMin = parseTimeToMinutes(openHHMM)
  const rawCloseMin = parseTimeToMinutes(closeHHMM)
  return rawCloseMin <= openMin ? rawCloseMin + 1440 : rawCloseMin
}

/**
 * Calcula dinámicamente desde la base de datos qué sucursales abren más temprano y cierran más tarde
 * (hoy en tiempo real y por cada día de la semana, tanto entre las 15 tiendas como en el subconjunto Drive-Thru)
 * para evitar comparaciones manuales erróneas del LLM sobre listas densas de horarios.
 */
export function buildCrossStoreHoursComparison(
  stores: Array<{ id: number; name: string; has_drive_thru?: boolean; weekly_hours: unknown }>,
  lang: PhoneLang,
  specialHours: any[] = [],
  now?: Date
): string {
  if (!Array.isArray(stores) || stores.length === 0) return ''
  const useCache = !now
  const cacheKey = `${lang}:${stores.length}:${specialHours.length}`
  if (useCache) {
    const cachedCmp = crossStoreCmpRamCache.get(cacheKey)
    if (cachedCmp && Date.now() - cachedCmp.fetchedAt < 30_000) {
      return cachedCmp.text
    }
  }
  const ptNow = getPacificDateParts(now || new Date())

  const shortEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const shortEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayShorts = lang === 'es' ? shortEs : shortEn
  const joinAnd = (items: string[]) => {
    if (items.length <= 1) return items[0] || ''
    if (items.length === 2) return lang === 'es' ? `${items[0]} y ${items[1]}` : `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${items[items.length - 1]}`
  }

  const groupDaysByValue = (entries: Array<{ d: number; text: string }>) => {
    const groups: Array<{ start: number; end: number; text: string }> = []
    for (const item of entries) {
      if (!item.text) continue
      const last = groups[groups.length - 1]
      if (last && last.end === item.d - 1 && last.text === item.text) {
        last.end = item.d
      } else {
        groups.push({ start: item.d, end: item.d, text: item.text })
      }
    }
    return groups
      .map((g) => {
        const label = g.start === g.end ? dayShorts[g.start] : `${dayShorts[g.start]}-${dayShorts[g.end]}`
        return `${label}: ${g.text}`
      })
      .join('; ')
  }

  const getCalendarTodaySchedule = (storeIdNum: number, wh: Record<string, StoreScheduleDay>) => {
    const regular = wh[String(ptNow.dayOfWeek)] || { open: '10:00', close: '00:00' }
    const sp =
      specialHours.find(
        (s) => s.event_date === ptNow.dateStr && s.store_id !== null && Number(s.store_id) === storeIdNum
      ) || specialHours.find((s) => s.event_date === ptNow.dateStr && s.store_id === null)
    if (sp) {
      if (sp.is_closed) return { open: 'CLOSED', close: 'CLOSED' }
      return {
        open: normalizeHhMm(sp.open_time) || regular.open,
        close: normalizeHhMm(sp.close_time) || regular.close
      }
    }
    const official = getOfficialStoreHolidaySchedule(ptNow.dateStr)
    if (official) {
      if (official.is_closed) return { open: 'CLOSED', close: 'CLOSED' }
      const effOpen =
        official.open_time && parseTimeToMinutes(official.open_time) > parseTimeToMinutes(regular.open)
          ? official.open_time
          : regular.open
      return { open: effOpen, close: official.close_time || regular.close }
    }
    return { open: regular.open || '10:00', close: regular.close || '00:00' }
  }

  const summarizeSubset = (subset: typeof stores) => {
    if (subset.length === 0) return null

    const normalized = subset.map((s) => {
      const id = Number(s.id)
      const wh = normalizeWeeklyHours(s.weekly_hours)
      return {
        id,
        name: cleanPhoneStoreName(s.name),
        wh,
        calToday: getCalendarTodaySchedule(id, wh),
        ev: evaluateStoreSchedulePure({
          storeId: id,
          storeName: cleanPhoneStoreName(s.name),
          weeklyHours: s.weekly_hours,
          specialHours,
          now
        })
      }
    })

    // En madrugada (00:00-05:59 AM), separar qué tiendas siguen ABIERTAS ahorita por turno de anoche
    // sin mezclar fechas al comparar qué sucursales abren/cierran más tarde hoy calendario.
    const spilloverOpenNow = normalized
      .filter((x) => x.ev.isAfterMidnightSpillover && x.ev.isOpenNow)
      .map((x) => ({
        name: x.name,
        closeMin: parseTimeToMinutes(x.ev.todayClose),
        closeFmt: lang === 'es' ? x.ev.todayCloseFormattedEs : x.ev.todayCloseFormattedEn
      }))
      .sort((a, b) => b.closeMin - a.closeMin)

    const spilloverNoteStr =
      spilloverOpenNow.length > 0
        ? lang === 'es'
          ? `Abiertas AHORITA en madrugada: ${spilloverOpenNow.map((s) => `${s.name} (hasta ${s.closeFmt})`).join(', ')}`
          : `Open RIGHT NOW (late-night shift): ${spilloverOpenNow.map((s) => `${s.name} (until ${s.closeFmt})`).join(', ')}`
        : ''

    // Horario uniforme del día calendario HOY en todas las tiendas del subconjunto
    const openCalToday = normalized
      .filter((x) => x.calToday.open !== 'CLOSED' && x.calToday.close !== 'CLOSED')
      .map((x) => ({
        name: x.name,
        openMin: parseTimeToMinutes(x.calToday.open),
        closeEff: getEffectiveCloseMinutes(x.calToday.open, x.calToday.close),
        openFmt: formatTime12h(x.calToday.open, lang),
        closeFmt: formatTime12h(x.calToday.close, lang)
      }))

    const todayLabel = lang === 'es' ? DAY_NAMES_ES[ptNow.dayOfWeek] : DAY_NAMES_EN[ptNow.dayOfWeek]

    let todayLatestStr = lang === 'es' ? 'Todas cerradas hoy' : 'All closed today'
    let todayEarliestStr = lang === 'es' ? 'Todas cerradas hoy' : 'All closed today'
    if (openCalToday.length > 0) {
      const maxClose = Math.max(...openCalToday.map((x) => x.closeEff))
      const latest = openCalToday.filter((x) => x.closeEff === maxClose)
      todayLatestStr =
        latest.length >= 10 && latest.length === openCalToday.length
          ? `${lang === 'en' ? 'All open locations' : 'Todas las sucursales abiertas'} (${latest[0].closeFmt})`
          : `${joinAnd(latest.map((x) => x.name))} (${latest[0].closeFmt})`

      const minOpen = Math.min(...openCalToday.map((x) => x.openMin))
      const earliest = openCalToday.filter((x) => x.openMin === minOpen)
      todayEarliestStr =
        earliest.length >= 10 && earliest.length === openCalToday.length
          ? `${lang === 'en' ? 'All open locations' : 'Todas las sucursales abiertas'} (${earliest[0].openFmt})`
          : `${joinAnd(earliest.map((x) => x.name))} (${earliest[0].openFmt})`
    }

    const dailyLatestClose: Array<{ d: number; text: string }> = []
    const dailyEarliestOpen: Array<{ d: number; text: string }> = []
    for (let d = 0; d <= 6; d++) {
      const dayEntries = normalized
        .map((s) => {
          const slot = s.wh[String(d)]
          if (!slot || isClosedTimeToken(slot.open) || isClosedTimeToken(slot.close)) return null
          return {
            name: s.name,
            open: slot.open,
            close: slot.close,
            openMin: parseTimeToMinutes(slot.open),
            closeEff: getEffectiveCloseMinutes(slot.open, slot.close)
          }
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))

      if (dayEntries.length === 0) continue
      const maxClose = Math.max(...dayEntries.map((x) => x.closeEff))
      const latest = dayEntries.filter((x) => x.closeEff === maxClose)
      dailyLatestClose.push({
        d,
        text: `${joinAnd(latest.map((x) => x.name))} (${formatTime12h(latest[0].close, lang)})`
      })

      const minOpen = Math.min(...dayEntries.map((x) => x.openMin))
      const earliest = dayEntries.filter((x) => x.openMin === minOpen)
      dailyEarliestOpen.push({
        d,
        text: `${joinAnd(earliest.map((x) => x.name))} (${formatTime12h(earliest[0].open, lang)})`
      })
    }

    return {
      count: subset.length,
      names: subset.map((s) => cleanPhoneStoreName(s.name)),
      spilloverNoteStr,
      todayLabel,
      todayLatestStr,
      todayEarliestStr,
      weeklyLatestStr: groupDaysByValue(dailyLatestClose),
      weeklyEarliestStr: groupDaysByValue(dailyEarliestOpen)
    }
  }

  const allSummary = summarizeSubset(stores)
  const dtStores = stores.filter((s) => Boolean(s.has_drive_thru))
  const dtSummary = summarizeSubset(dtStores)
  if (!allSummary) return ''

  if (lang === 'en') {
    const lines = [
      `EXACT LIVE CROSS-STORE SCHEDULE WINNERS (NEVER GUESS OR LUMP STORES TOGETHER):`
    ]
    if (allSummary.spilloverNoteStr) {
      lines.push(`- ${allSummary.spilloverNoteStr}`)
    }
    lines.push(
      `- ALL ${allSummary.count} LOCATIONS -> Today (${allSummary.todayLabel}): latest close ${allSummary.todayLatestStr} | earliest open ${allSummary.todayEarliestStr} | Latest close by day: ${allSummary.weeklyLatestStr} | Earliest open: ${allSummary.weeklyEarliestStr}`
    )
    if (dtSummary) {
      lines.push(
        `- DRIVE-THRU ONLY (${dtSummary.count} stores: ${dtSummary.names.join(', ')}) -> Today (${dtSummary.todayLabel}): latest close ${dtSummary.todayLatestStr} | earliest open ${dtSummary.todayEarliestStr} | Latest close by day (Drive-Thru): ${dtSummary.weeklyLatestStr} | Earliest open (Drive-Thru): ${dtSummary.weeklyEarliestStr}`
      )
    }
    const outEn = lines.join('\n')
    if (useCache) crossStoreCmpRamCache.set(cacheKey, { text: outEn, fetchedAt: Date.now() })
    return outEn
  }

  const lines = [
    `COMPARATIVA EXACTA EN VIVO ENTRE SUCURSALES (USA ESTOS GANADORES EXACTOS; NUNCA ADIVINES NI AGRUPES TIENDAS CON DISTINTO HORARIO):`
  ]
  if (allSummary.spilloverNoteStr) {
    lines.push(`- ${allSummary.spilloverNoteStr}`)
  }
  lines.push(
    `- TODAS LAS ${allSummary.count} SUCURSALES -> Hoy (${allSummary.todayLabel}): cierra más tarde ${allSummary.todayLatestStr} | abre más temprano ${allSummary.todayEarliestStr} | Cierre más tarde por día: ${allSummary.weeklyLatestStr} | Apertura más temprana: ${allSummary.weeklyEarliestStr}`
  )
  if (dtSummary) {
    lines.push(
      `- SOLO CON DRIVE-THRU (${dtSummary.count} sucursales: ${dtSummary.names.join(', ')}) -> Hoy (${dtSummary.todayLabel}): cierra más tarde ${dtSummary.todayLatestStr} | abre más temprano ${dtSummary.todayEarliestStr} | Cierre más tarde por día (Drive-Thru): ${dtSummary.weeklyLatestStr} | Apertura más temprana (Drive-Thru): ${dtSummary.weeklyEarliestStr}`
    )
  }
  const outEs = lines.join('\n')
  if (useCache) crossStoreCmpRamCache.set(cacheKey, { text: outEs, fetchedAt: Date.now() })
  return outEs
}

/**
 * Calcula los paquetes recomendados de Fiesta Platter según el número de invitados,
 * protegiendo contra divisiones por cero, valores negativos o NaN.
 */
export function recommendFiestaPlatters(guestCountInput?: number | null) {
  const g15 = PARTY_TRAY_GUIDELINES['15-20']
  const g20 = PARTY_TRAY_GUIDELINES['20-25']
  const g25 = PARTY_TRAY_GUIDELINES['25-30']
  const g30 = PARTY_TRAY_GUIDELINES['30-40']
  const cornDoz = (packs: number) => (packs * 60) / 12 // 1 paquete = 60 tortillas = 5 docenas
  const flourDoz = (packs: number) => (packs * 12) / 12 // 1 paquete = 12 tortillas = 1 docena

  const packages = [
    {
      sizeKey: '15-20',
      labelEs: 'Paquete para 15 a 20 personas',
      labelEn: '15 to 20 People Fiesta Platter',
      minGuests: 15,
      maxGuests: 20,
      price: 201.99,
      meatLbs: g15.meatLbs,
      riceBeansTrayEs: `${g15.riceLbs} lbs de arroz y ${g15.beansLbs} lbs de frijol`,
      riceBeansTrayEn: `${g15.riceLbs} lbs of rice and ${g15.beansLbs} lbs of beans`,
      aguasGallons: g15.aguaGallons,
      cornPacks: g15.cornPacks,
      flourPacks: g15.flourPacks,
      cornTortillasDozens: cornDoz(g15.cornPacks),
      flourTortillasDozens: flourDoz(g15.flourPacks)
    },
    {
      sizeKey: '20-25',
      labelEs: 'Paquete para 20 a 25 personas',
      labelEn: '20 to 25 People Fiesta Platter',
      minGuests: 20,
      maxGuests: 25,
      price: 245.79,
      meatLbs: g20.meatLbs,
      riceBeansTrayEs: `${g20.riceLbs} lbs de arroz y ${g20.beansLbs} lbs de frijol`,
      riceBeansTrayEn: `${g20.riceLbs} lbs of rice and ${g20.beansLbs} lbs of beans`,
      aguasGallons: g20.aguaGallons,
      cornPacks: g20.cornPacks,
      flourPacks: g20.flourPacks,
      cornTortillasDozens: cornDoz(g20.cornPacks),
      flourTortillasDozens: flourDoz(g20.flourPacks)
    },
    {
      sizeKey: '25-30',
      labelEs: 'Paquete para 25 a 30 personas',
      labelEn: '25 to 30 People Fiesta Platter',
      minGuests: 25,
      maxGuests: 30,
      price: 301.69,
      meatLbs: g25.meatLbs,
      riceBeansTrayEs: `${g25.riceLbs} lbs de arroz y ${g25.beansLbs} lbs de frijol`,
      riceBeansTrayEn: `${g25.riceLbs} lbs of rice and ${g25.beansLbs} lbs of beans`,
      aguasGallons: g25.aguaGallons,
      cornPacks: g25.cornPacks,
      flourPacks: g25.flourPacks,
      cornTortillasDozens: cornDoz(g25.cornPacks),
      flourTortillasDozens: flourDoz(g25.flourPacks)
    },
    {
      sizeKey: '30-40',
      labelEs: 'Paquete para 30 a 40 personas',
      labelEn: '30 to 40 People Fiesta Platter',
      minGuests: 30,
      maxGuests: 40,
      price: 373.89,
      meatLbs: g30.meatLbs,
      riceBeansTrayEs: `${g30.riceLbs} lbs de arroz y ${g30.beansLbs} lbs de frijol`,
      riceBeansTrayEn: `${g30.riceLbs} lbs of rice and ${g30.beansLbs} lbs of beans`,
      aguasGallons: g30.aguaGallons,
      cornPacks: g30.cornPacks,
      flourPacks: g30.flourPacks,
      cornTortillasDozens: cornDoz(g30.cornPacks),
      flourTortillasDozens: flourDoz(g30.flourPacks)
    }
  ]

  const guests = Number(guestCountInput)
  let recommendationEs =
    'Se ordenan en línea en tacosgavilan.com con mínimo 1 hora de anticipación para recoger el mismo día. Carnes a elegir: Carne Asada, Pollo o Al Pastor. Aguas Frescas: Horchata, Jamaica, Piña o Tamarindo. Todos incluyen arroz, frijol, tortillas de maíz o harina, salsas, verdura y desechables completos.'
  let recommendationEn =
    'Order online at tacosgavilan.com with at least 1 hour advance notice for same-day pickup. Meats: Carne Asada, Chicken, or Al Pastor. Aguas Frescas: Horchata, Jamaica, Pineapple, or Tamarind. All packages include rice, beans, corn or flour tortillas, salsas, toppings, and utensils.'

  if (Number.isFinite(guests) && guests > 0) {
    if (guests <= 20) {
      const p = packages[0]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 15 a 20 personas en $${p.price.toFixed(2)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.cornTortillasDozens} docenas de maíz o ${p.flourTortillasDozens} de harina y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 15 to 20 people package at $${p.price.toFixed(2)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.cornTortillasDozens} dozen corn or ${p.flourTortillasDozens} dozen flour tortillas, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests <= 25) {
      const p = packages[1]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 20 a 25 personas en $${p.price.toFixed(2)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.cornTortillasDozens} docenas de maíz o ${p.flourTortillasDozens} de harina y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 20 to 25 people package at $${p.price.toFixed(2)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.cornTortillasDozens} dozen corn or ${p.flourTortillasDozens} dozen flour tortillas, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests === 30) {
      const p25 = packages[2]
      const p30 = packages[3]
      recommendationEs = `Para 30 personas tenemos el paquete de 25 a 30 personas en $${p25.price.toFixed(2)} (${p25.meatLbs} lbs de carne y ${p25.aguasGallons} galones de agua fresca) o, si desean porciones más abundantes, el de 30 a 40 personas en $${p30.price.toFixed(2)} (${p30.meatLbs} lbs de carne y ${p30.aguasGallons} galones de agua fresca).`
      recommendationEn = `For 30 guests we offer the 25 to 30 people package at $${p25.price.toFixed(2)} (${p25.meatLbs} lbs of meat and ${p25.aguasGallons} gallons of agua fresca), or for larger portions, the 30 to 40 people package at $${p30.price.toFixed(2)} (${p30.meatLbs} lbs of meat and ${p30.aguasGallons} gallons of agua fresca).`
    } else if (guests < 30) {
      const p = packages[2]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 25 a 30 personas en $${p.price.toFixed(2)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.cornTortillasDozens} docenas de maíz o ${p.flourTortillasDozens} de harina y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 25 to 30 people package at $${p.price.toFixed(2)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.cornTortillasDozens} dozen corn or ${p.flourTortillasDozens} dozen flour tortillas, and ${p.aguasGallons} gallons of agua fresca).`
    } else if (guests <= 40) {
      const p = packages[3]
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 30 a 40 personas en $${p.price.toFixed(2)} (incluye ${p.meatLbs} lbs de carne, ${p.riceBeansTrayEs}, ${p.cornTortillasDozens} docenas de maíz o ${p.flourTortillasDozens} de harina y ${p.aguasGallons} galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 30 to 40 people package at $${p.price.toFixed(2)} (includes ${p.meatLbs} lbs of meat, ${p.riceBeansTrayEn}, ${p.cornTortillasDozens} dozen corn or ${p.flourTortillasDozens} dozen flour tortillas, and ${p.aguasGallons} gallons of agua fresca).`
    } else {
      // Combinación óptima de menor costo total usando los 4 tamaños reales
      const cappedGuests = Math.min(500, guests)
      let bestCombo: { counts: number[]; total: number; trays: number; minCap: number; maxCap: number } | null = null
      if (cappedGuests <= 200) {
        const max30 = Math.ceil(cappedGuests / 40) + 1
        for (let c3 = 0; c3 <= max30; c3++) {
          for (let c2 = 0; c2 <= 3; c2++) {
            for (let c1 = 0; c1 <= 3; c1++) {
              for (let c0 = 0; c0 <= 3; c0++) {
                const counts = [c0, c1, c2, c3]
                const trays = c0 + c1 + c2 + c3
                if (trays === 0) continue
                const maxCap = c0 * 20 + c1 * 25 + c2 * 30 + c3 * 40
                if (maxCap < cappedGuests) continue
                const minCap = c0 * 15 + c1 * 20 + c2 * 25 + c3 * 30
                const total = +(
                  c0 * packages[0].price +
                  c1 * packages[1].price +
                  c2 * packages[2].price +
                  c3 * packages[3].price
                ).toFixed(2)
                if (
                  !bestCombo ||
                  total < bestCombo.total - 0.001 ||
                  (Math.abs(total - bestCombo.total) < 0.001 && trays < bestCombo.trays)
                ) {
                  bestCombo = { counts, total, trays, minCap, maxCap }
                }
              }
            }
          }
        }
      }
      if (!bestCombo) {
        const fullTrays = Math.ceil(cappedGuests / 40)
        bestCombo = {
          counts: [0, 0, 0, fullTrays],
          total: +(fullTrays * packages[3].price).toFixed(2),
          trays: fullTrays,
          minCap: fullTrays * 30,
          maxCap: fullTrays * 40
        }
      }
      const descPartsEs: string[] = []
      const descPartsEn: string[] = []
      for (let i = packages.length - 1; i >= 0; i--) {
        const q = bestCombo.counts[i]
        if (q <= 0) continue
        const sizeLabel = packages[i].sizeKey.replace('-', ' a ')
        const sizeLabelEn = packages[i].sizeKey.replace('-', ' to ')
        descPartsEs.push(`${q} ${q === 1 ? 'paquete' : 'paquetes'} de ${sizeLabel} personas ($${packages[i].price.toFixed(2)}${q > 1 ? ' c/u' : ''})`)
        descPartsEn.push(`${q} × ${sizeLabelEn} people ${q === 1 ? 'package' : 'packages'} ($${packages[i].price.toFixed(2)}${q > 1 ? ' each' : ''})`)
      }
      const countDisplay = guests > 500 ? `${cappedGuests} (máximo cotizable por paquete directo)` : String(guests)
      const countDisplayEn = guests > 500 ? `${cappedGuests} (max per automated package quote)` : String(guests)
      recommendationEs = `Para ${countDisplay} personas la combinación más económica es ${descPartsEs.join(' + ')} (cubre ${bestCombo.minCap} a ${bestCombo.maxCap} personas, total $${bestCombo.total.toFixed(2)}).`
      recommendationEn = `For ${countDisplayEn} guests the most cost-effective combination is ${descPartsEn.join(' + ')} (serves ${bestCombo.minCap} to ${bestCombo.maxCap} guests, total $${bestCombo.total.toFixed(2)}).`
    }
  }

  return {
    advanceNoticeRuleEs: 'Mínimo 1 hora de anticipación ordenando exclusivamente en línea en tacosgavilan.com',
    advanceNoticeRuleEn: 'Minimum 1 hour advance notice, ordered exclusively online at tacosgavilan.com',
    allowedMeats: ['Carne Asada', 'Pollo (Chicken)', 'Al Pastor'],
    allowedAguasFrescas: ['Horchata', 'Jamaica', 'Piña (Pineapple)', 'Tamarindo (Tamarind)'],
    includedExtrasEs: 'Salsas (roja, verde o mixta), cilantro, cebolla, limones, zanahorias y chiles en vinagre, platos, tenedores, servilletas, vasos y popotes',
    includedExtrasEn: 'Salsas (red, green, or mix), cilantro, onion, limes, pickled carrots & peppers, plates, forks, napkins, cups, and straws',
    packages,
    recommendationEs,
    recommendationEn
  }
}

/**
 * Genera las instrucciones exactas de desvío condicional de llamadas según el operador de la tienda
 * (Spectrum Business fijo vs. Celular Android AT&T).
 */
export function getCarrierForwardingInstructions(
  carrierType: CarrierType,
  twilioPhoneNumber: string | null | undefined,
  ringTimeoutSeconds: number = 20
) {
  const cleanDigits = (twilioPhoneNumber || '').replace(/\D/g, '')
  const tenDigit = cleanDigits.length === 11 && cleanDigits.startsWith('1') ? cleanDigits.slice(1) : cleanDigits
  const hasValidTwilioNumber = tenDigit.length === 10
  const displayNumEs = hasValidTwilioNumber ? tenDigit : 'NÚMERO_TWILIO'
  const displayNumEn = hasValidTwilioNumber ? tenDigit : 'TWILIO_NUMBER'
  const safeTimeout = Number.isFinite(ringTimeoutSeconds) && ringTimeoutSeconds > 0 ? ringTimeoutSeconds : 20
  const clampedRing = Math.min(30, Math.max(5, Math.round(safeTimeout / 5) * 5))

  if (carrierType === 'spectrum_landline') {
    return {
      hasValidTwilioNumber,
      carrierLabelEs: 'Spectrum Business (Línea Fija)',
      carrierLabelEn: 'Spectrum Business (Landline)',
      activateNoAnswerCode: `*92${displayNumEs}`,
      activateNoAnswerCodeEn: `*92${displayNumEn}`,
      deactivateNoAnswerCode: '*93',
      activateBusyCode: `*90${displayNumEs}`,
      activateBusyCodeEn: `*90${displayNumEn}`,
      deactivateBusyCode: '*91',
      deactivateAllCode: '*93 y *91',
      deactivateAllCodeEn: '*93 & *91',
      stepsEs: [
        `Levanta el teléfono fijo de la tienda y marca *92${displayNumEs} para activar el desvío cuando nadie conteste (escucharás tono de confirmación).`,
        `Levanta de nuevo y marca *90${displayNumEs} para que también conteste la IA si la línea ya está ocupada en otra llamada.`,
        `Para ajustar cuántos timbrazos suena antes de pasar a la IA, entra a SpectrumBusiness.net -> Voice Manager -> Call Forwarding.`,
        `Para desactivar en cualquier momento, marca *93 y *91 desde el teléfono de la tienda.`
      ],
      stepsEn: [
        `Pick up the store landline and dial *92${displayNumEn} to enable Call Forwarding No Answer (wait for confirmation tone).`,
        `Pick up again and dial *90${displayNumEn} to enable Call Forwarding Busy so the AI answers when the line is busy.`,
        `To adjust the number of rings before forwarding, sign in to SpectrumBusiness.net -> Voice Manager -> Call Forwarding.`,
        `To disable at any time, dial *93 and *91 from the store phone.`
      ],
      gotchaEs:
        'Nunca uses *72 (desvío incondicional total) si quieres que el teléfono de la caja timbre primero. Algunas cuentas Spectrum requieren habilitar Call Forwarding por primera vez en el portal Voice Manager.',
      gotchaEn:
        'Do not use *72 (unconditional forwarding) if you want the register phone to ring first. Some Spectrum accounts require enabling Call Forwarding once in the Voice Manager portal.'
    }
  }

  return {
    hasValidTwilioNumber,
    carrierLabelEs: 'Celular Android con AT&T',
    carrierLabelEn: 'AT&T Android Cellphone',
    activateNoAnswerCode: `**61*+1${displayNumEs}**${clampedRing}#`,
    activateNoAnswerCodeEn: `**61*+1${displayNumEn}**${clampedRing}#`,
    deactivateNoAnswerCode: '##61#',
    activateBusyCode: `**67*+1${displayNumEs}#`,
    activateBusyCodeEn: `**67*+1${displayNumEn}#`,
    deactivateBusyCode: '##67#',
    activateUnreachableCode: `**62*+1${displayNumEs}#`,
    activateUnreachableCodeEn: `**62*+1${displayNumEn}#`,
    deactivateUnreachableCode: '##62#',
    deactivateAllCode: '##002#',
    deactivateAllCodeEn: '##002#',
    stepsEs: [
      `En el celular Android de la tienda, apaga temporalmente "Llamadas por Wi-Fi" (Wi-Fi Calling) para que AT&T acepte los códigos sin error MMI.`,
      `Abre la app Teléfono y marca **61*+1${displayNumEs}**${clampedRing}# y presiona Llamar (desvía a la IA si nadie contesta en ${clampedRing} segundos).`,
      `Marca **67*+1${displayNumEs}# y presiona Llamar (desvía a la IA si la cajera ya está en otra llamada o rechaza la llamada).`,
      `Marca **62*+1${displayNumEs}# y presiona Llamar (desvía a la IA si el celular se queda sin batería, apagado o sin señal).`,
      `Vuelve a encender "Llamadas por Wi-Fi". Si deseas desactivar todos los desvíos al instante, marca ##002#.`
    ],
    stepsEn: [
      `On the store Android phone, temporarily turn off "Wi-Fi Calling" so AT&T accepts MMI codes without error.`,
      `Open the Phone app, dial **61*+1${displayNumEn}**${clampedRing}# and press Call (forwards to AI if unanswered after ${clampedRing} seconds).`,
      `Dial **67*+1${displayNumEn}# and press Call (forwards to AI when the line is busy or declined).`,
      `Dial **62*+1${displayNumEn}# and press Call (forwards to AI if the phone battery dies, is powered off, or loses signal).`,
      `Turn "Wi-Fi Calling" back on. To remove all conditional forwarding at any time, dial ##002#.`
    ],
    gotchaEs:
      'Si el celular marca "Error de conexión o código MMI no válido", apaga Llamadas por Wi-Fi, prende y apaga Modo Avión 5 segundos, o configúralo desde Teléfono -> Ajustes -> Servicios suplementarios -> Desvío de llamadas.',
    gotchaEn:
      'If you see "Connection problem or invalid MMI code", disable Wi-Fi Calling, toggle Airplane Mode for 5 seconds, or set it via Phone -> Settings -> Supplementary Services -> Call Forwarding.'
  }
}

/**
 * Carga (con caché RAM de 5 min) los productos disponibles del menú oficial en línea (`app_menu_cache`) de una sucursal.
 */
async function loadStoreMenuEntry(storeId: number, storeNameFallback = ''): Promise<StoreMenuCacheEntry> {
  const now = Date.now()
  const cachedMenu = storeMenuRamCache.get(storeId)
  if (cachedMenu && now - cachedMenu.fetchedAt <= 60 * 1000) return cachedMenu

  const refresh = async (): Promise<StoreMenuCacheEntry> => {
    let job = storeMenuInFlight.get(storeId)
    if (!job) {
      job = (async () => {
        const { data: items, error } = await supabaseAdmin
          .from('app_menu_cache')
          .select('name, description, price, category_name, is_available')
          .eq('store_id', storeId)
          .eq('is_available', true)
        if (error || !Array.isArray(items)) {
          return cachedMenu || null
        }
        const sanitized = items.map((item: any) => {
          if (item?.name && /\blengua\b/i.test(String(item.name)) && item?.description && /Steamed Beef Head/i.test(String(item.description))) {
            return {
              ...item,
              description: String(item.description).replace(/Steamed Beef Head/gi, 'Steamed Beef Tongue')
            }
          }
          return item
        })
        const storeLabel = storeNameFallback || `Sucursal #${storeId}`
        const entry: StoreMenuCacheEntry = {
          items: sanitized,
          compactCatalogEs: buildLiveMenuCatalogText(storeLabel, sanitized, { includeFiestaPlat: false }),
          compactCatalogEn: buildLiveMenuCatalogText(storeLabel, sanitized, { includeFiestaPlat: false }),
          fetchedAt: Date.now()
        }
        storeMenuRamCache.set(storeId, entry)
        return entry
      })().finally(() => {
        storeMenuInFlight.delete(storeId)
      })
      storeMenuInFlight.set(storeId, job)
    }
    const res = await job
    return (
      res ||
      cachedMenu || {
        items: [],
        compactCatalogEs: buildLiveMenuCatalogText(storeNameFallback || `Sucursal #${storeId}`, []),
        compactCatalogEn: buildLiveMenuCatalogText(storeNameFallback || `Sucursal #${storeId}`, []),
        fetchedAt: now
      }
    )
  }

  if (cachedMenu && now - cachedMenu.fetchedAt <= 5 * 60 * 1000) {
    void refresh().catch(() => null)
    return cachedMenu
  }
  return refresh()
}

export async function loadStoreMenuItems(storeId: number): Promise<any[]> {
  const entry = await loadStoreMenuEntry(storeId)
  return entry.items
}

const STANDARD_SINGLE_MEAT_PREFIX_RE =
  /^(?:1\s+)?(?:Grilled\s+(?:Steak|Beef|Chicken|Pork\s+Maw|Hog\s+Maw)|Beef\s+Steak|Steamed\s+Beef\s+(?:Head|Tongue)|Braised\s+Pork|Mexican\s+Sausage|Marinated\s+Pork)(?:\s+(?:Mulita|Sope|Taco))?$/i

function normalizeToastMenuPrep(rawDesc: string): string {
  const s = String(rawDesc || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (/^Only\s+.+$/i.test(s)) return 'Only the selected meat'
  const m = s.match(/^(.+?)\s+-\s+(.+)$/)
  if (m && STANDARD_SINGLE_MEAT_PREFIX_RE.test(m[1].trim())) return m[2].trim()
  if (/^(?:Grilled|Marinated|Steamed|Braised|Mexican)\b.+\band Cheese$/i.test(s) && !/\+|Breaded/i.test(s)) {
    return 'Meat and Cheese'
  }
  return s
}

/**
 * Construye el catálogo de precios y descripciones EN VIVO para el prompt, agrupando por categoría y por precio
 * (ej. "- Tacos: Taco Asada, Taco Pastor, ...: $2.29 [Prep Toast: ...]"). Incluye las descripciones reales de Toast
 * (`app_menu_cache.description`) de forma compacta para responder con exactitud qué lleva cada platillo y la diferencia Regular vs Super.
 */
function compactNameGroupList(names: string[]): string {
  if (names.length <= 2) return names.join(', ')
  // Detectar prefijo común (ej. "Super Burrito Asada", "Super Burrito Pastor" -> "Super Burrito [Asada, Pastor, ...]")
  const tokenized = names.map((n) => n.trim().split(/\s+/))
  const minWords = Math.min(...tokenized.map((w) => w.length))
  if (minWords >= 2) {
    let prefixLen = 0
    for (let k = 0; k < minWords - 1; k++) {
      const ref = tokenized[0][k]
      if (tokenized.every((w) => w[k] === ref)) {
        prefixLen = k + 1
      } else {
        break
      }
    }
    if (prefixLen >= 1) {
      const prefix = tokenized[0].slice(0, prefixLen).join(' ')
      const suffixes = tokenized.map((w) => w.slice(prefixLen).join(' '))
      return `${prefix} [${suffixes.join(', ')}]`
    }
  }
  return names.join(', ')
}

export function buildLiveMenuCatalogText(
  storeName: string,
  items: any[],
  opts?: { includeFiestaPlat?: boolean }
): string {
  const includeFiestaPlat = opts?.includeFiestaPlat !== false
  const byCategory = new Map<
    string,
    {
      priceGroups: Map<string, string[]>
      itemPreps: Array<{ name: string; rawDesc: string; norm: string }>
    }
  >()
  for (const it of items || []) {
    const price = Number(it?.price)
    const name = String(it?.name || '').trim()
    if (!name || !Number.isFinite(price) || price <= 0) continue
    const category = String(it?.category_name || 'Otros').trim()
    if (!includeFiestaPlat && /fiesta\s*platter/i.test(category)) continue
    if (!byCategory.has(category)) byCategory.set(category, { priceGroups: new Map(), itemPreps: [] })
    const entry = byCategory.get(category)!
    const priceKey = price.toFixed(2)
    if (!entry.priceGroups.has(priceKey)) entry.priceGroups.set(priceKey, [])
    entry.priceGroups.get(priceKey)!.push(name)

    const rawDesc = String(it?.description || '').replace(/\s+/g, ' ').trim()
    if (rawDesc) {
      entry.itemPreps.push({ name, rawDesc, norm: normalizeToastMenuPrep(rawDesc) })
    }
  }

  if (byCategory.size === 0) {
    return 'CATÁLOGO DE PRECIOS: no disponible en este momento. Si preguntan precios, NO inventes cifras: invita a consultar tacosgavilan.com.'
  }

  const lines: string[] = []
  for (const [category, entry] of byCategory) {
    const segments = Array.from(entry.priceGroups.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([price, names]) => `${compactNameGroupList(names)}: $${price}`)

    let prepSuffix = ''
    if (entry.itemPreps.length > 0) {
      if (/fiesta\s*platter/i.test(category)) {
        const listed = entry.itemPreps.slice(0, 6).map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${listed.join('; ')}]`
      } else {
      const counts = new Map<string, number>()
      for (const p of entry.itemPreps) {
        counts.set(p.norm, (counts.get(p.norm) || 0) + 1)
      }
      let topNorm = ''
      let topCount = 0
      for (const [k, v] of counts) {
        if (v > topCount) {
          topNorm = k
          topCount = v
        }
      }
      if (topCount >= 2 && topCount >= Math.ceil(entry.itemPreps.length / 2)) {
        const outliers = entry.itemPreps
          .filter((p) => p.norm !== topNorm)
          .slice(0, 6)
          .map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${topNorm}${outliers.length ? ` | Variantes: ${outliers.join('; ')}` : ''}]`
      } else {
        const listed = entry.itemPreps.slice(0, 6).map((p) => `${p.name}: ${p.rawDesc}`)
        prepSuffix = ` [Prep Toast: ${listed.join('; ')}]`
      }
      }
    }

    lines.push(`- ${category}: ${segments.join(' | ')}${prepSuffix}`)
  }
  lines.push(
    '- Bebidas Físicas y Sabores Oficiales: Mediana = vaso ELDP22 22 oz ($3.59), Grande = vaso ELDP32 32 oz ($4.09), Galón Agua Fresca = 128 oz ($14.59, ~5 medianos). Sabores Agua Fresca: Horchata, Jamaica, Piña y Tamarindo (NO Pepino). Champurrado individual = vaso térmico ELSDR16 16 oz ($4.09); Caja Champurrado 96 oz ($27.89, 6×16 oz + 8 vasitos 12 oz). Café = vaso 16 oz ($2.59). Agua Embotellada ($1.19).'
  )
  lines.push(
    '- Quesos y Desayunos Oficiales: Tortas (Cubana, Milanesa, etc.) = Queso Fresco en rebanada (NUNCA crema ni queso fundido; sí mayonesa y aguacate). Quesadillas/Mulitas/Super Burritos = Queso blanco Monterey Jack fundido. Sopes/Platos/Taco Plate/Desayunos = Queso Cotija (Sope Queso añade Queso Fresco). Super Nachos = Queso Amarillo caliente Nacho Cheese. Breakfast: Burrito Huevo ($9.19 c/arroz y frijol), Plato Huevos ($10.59 c/arroz, frijol c/cotija, ensalada y tortillas), Torta Huevo ($9.69).'
  )
  return `CATÁLOGO EN VIVO DE ${storeName.toUpperCase()} (Toast POS; "Large"=Grande, "Medium"=Mediana):\n${lines.join('\n')}`
}

/**
 * Normaliza colisiones fonéticas frecuentes de Speech-to-Text en telefonía/navegador para tacos, bebidas y servicios
 * (ej. "torta corona" -> "torta cubana", "salad burrito" -> "asada burrito", "muleta" -> "mulita", "driver" -> "drive-thru").
 */
export function normalizePhoneSttTranscript(rawText: string): string {
  return String(rawText || '')
    .replace(/\btorta(?:s)?\s+corona\b/gi, 'torta cubana')
    .replace(/\b(?:a\s+)?salad\s+burritos?\b/gi, 'asada burrito')
    .replace(/\bmuletas\b/gi, 'mulitas')
    .replace(/\bmuleta\b/gi, 'mulita')
    .replace(/\bch[ao]mpur?ado\b/gi, 'champurrado')
    .replace(/\bchapurrado\b/gi, 'champurrado')
    .replace(/\blingua\b/gi, 'lengua')
    .replace(/\b(?:puche|guche)\b/gi, 'buche')
    .replace(/\b(tienen|tiene|con|hay|su|las?|los?)\s+drivers?\b/gi, '$1 drive-thru')
    .replace(/\b(drive\s*tru|dry\s*thru)\b/gi, 'drive-thru')
    .replace(/\b(?:call|car)\s+fresh\b/gi, 'calfresh')
    .replace(/\b(?:e\s+b\s+t|i\s+b\s+t)\b/gi, 'ebt')
}

export function rankMenuItemsForPrompt(items: any[], query: string, limit: number = 12) {
  if (!Array.isArray(items) || items.length === 0) return []
  const stopWords = new Set([
    'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'por', 'para', 'del', 'al', 'que',
    'cuesta', 'cuanto', 'precio', 'precios', 'tienen', 'hay', 'me', 'puedes', 'decir', 'hola', 'quiero',
    'saber', 'how', 'much', 'is', 'the', 'and', 'for', 'do', 'you', 'have', 'can', 'tell', 'cost'
  ])
  const synonymMap: Record<string, string[]> = {
    grande: ['large'], grandes: ['large'], large: ['grande'],
    mediana: ['medium'], mediano: ['medium'], medianas: ['medium'], medium: ['mediana', 'mediano'],
    galon: ['gallon'], galones: ['gallon'], gallon: ['galon'],
    agua: ['horchata', 'jamaica', 'pina', 'tamarindo', 'lemonade', 'water', 'fresca'],
    aguas: ['horchata', 'jamaica', 'pina', 'tamarindo', 'fresca'],
    fresca: ['agua', 'horchata', 'jamaica', 'pina', 'tamarindo'],
    embotellada: ['bottled', 'water'],
    botella: ['bottled', 'water'],
    bottled: ['water', 'embotellada'],
    water: ['bottled', 'agua'],
    fresa: ['strawberry'],
    naranja: ['orange'],
    dieta: ['diet'],
    frijol: ['beans', 'frijol'], frijoles: ['beans', 'frijol'],
    arroz: ['rice'], queso: ['cheese', 'queso'], crema: ['sour', 'cream'],
    cafe: ['coffee'], coca: ['coke'], totopos: ['chips'],
    limonada: ['lemonade'], helado: ['iced', 'tea'], te: ['tea', 'iced'],
    refresco: ['coke', 'sprite', 'fanta'], soda: ['coke', 'sprite', 'fanta'],
    postre: ['flan', 'cheesecake'], postres: ['flan', 'cheesecake'],
    desayuno: ['huevos', 'breakfast'], huevo: ['huevos', 'breakfast'],
    milanesa: ['breaded', 'milanesa'], breaded: ['milanesa'],
    jamon: ['ham', 'jamon'], ham: ['jamon'],
    salchicha: ['wiener', 'salchicha'], wiener: ['salchicha'],
  }
  const fixedQuery = normalizePhoneSttTranscript(query)
  const normQuery = normalizeSearchText(fixedQuery)
  const rawTokens = normQuery
    .split(/\s+/)
    .filter((t) => (t.length >= 3 || t === 'oz' || t === 'te') && !stopWords.has(t))

  const isBottledQuery = rawTokens.includes('embotellada') || rawTokens.includes('botella') || rawTokens.includes('bottled')
  const wantsFiesta = /fiesta|platter|charola|paquete|persona|people|catering/i.test(normQuery)

  const directTokens = new Set<string>()
  const synonymTokens = new Set<string>()
  for (const tok of rawTokens) {
    directTokens.add(tok)
    // Quitar 's' simple en sustantivos (sopes->sope, tortas->torta, mulitas->mulita) y '-es' solo en terminaciones castellanas reales (-nes/-res/-les/-mes/-ces)
    if (tok.length > 4 && /(?:ciones|siones|nes|res|les|mes|ces)$/.test(tok)) {
      directTokens.add(tok.slice(0, -2))
    } else if (tok.length > 4 && tok.endsWith('s')) {
      directTokens.add(tok.slice(0, -1))
    }
    if (tok === 'agua' && isBottledQuery) {
      synonymTokens.add('bottled')
      synonymTokens.add('water')
      continue
    }
    const syns = synonymMap[tok]
    if (syns) for (const s of syns) if (!directTokens.has(s)) synonymTokens.add(s)
  }
  const directList = Array.from(directTokens)
  const synonymList = Array.from(synonymTokens).filter((s) => !directTokens.has(s))
  const allSearchTokens = [...directList, ...synonymList]
  const pickedMap = new Map<string, { item: any; score: number }>()

  for (const tok of allSearchTokens) {
    const baseScore = directTokens.has(tok) ? 30 : 10
    for (const m of items.filter((it) => normalizeSearchText(it.name).includes(tok)).slice(0, 4)) {
      const prev = pickedMap.get(m.name)
      if (!prev || baseScore > prev.score) pickedMap.set(m.name, { item: m, score: baseScore })
    }
  }
  for (const item of items) {
    const metaHay = normalizeSearchText(`${item.category_name || ''} ${item.description || ''}`)
    const nameNorm = normalizeSearchText(item.name)
    let score = 0
    let directNameMatches = 0
    let synNameMatches = 0
    if (nameNorm === normQuery) score += 140
    if (normQuery.length >= 4 && nameNorm.includes(normQuery)) score += 70
    for (const tok of directList) {
      if (nameNorm.includes(tok)) { score += 45; directNameMatches++ }
      else if (metaHay.includes(tok)) score += 15
    }
    for (const syn of synonymList) {
      if (nameNorm.includes(syn)) { score += 28; synNameMatches++ }
      else if (metaHay.includes(syn)) score += 5
    }
    if (directNameMatches >= 2) score += directNameMatches * 30
    else if (directNameMatches + synNameMatches >= 2) score += 14
    if (!wantsFiesta && /fiesta\s*platter/i.test(String(item.category_name || ''))) {
      score = Math.max(0, score - 25)
    }
    if (score > 0) {
      const prev = pickedMap.get(item.name)
      if (!prev || score > prev.score) pickedMap.set(item.name, { item, score })
    }
  }
  return Array.from(pickedMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      name: entry.item.name,
      category: entry.item.category_name || 'Menú',
      price: Number(entry.item.price || 0),
      priceFormatted: `$${Number(entry.item.price || 0).toFixed(2)}`,
      description: entry.item.description || ''
    }))
}

/**
 * Busca precios reales en `app_menu_cache` para una sucursal delegando en `rankMenuItemsForPrompt`.
 */
export async function searchStoreMenuPrices(storeId: number, query: string, limit: number = 12) {
  const items = await loadStoreMenuItems(storeId)
  return rankMenuItemsForPrompt(items, query, limit)
}

let allStoresDirectoryCache: {
  fetchedAt: number
  stores: Array<{
    id: number
    name: string
    address: string
    phone: string
    has_drive_thru: boolean
    weekly_hours: any
    compactHoursEs: string
    compactHoursEn: string
  }>
} | null = null

let allStoresInFlight: Promise<any[]> | null = null

export async function loadAllActiveStoresDirectory() {
  const now = Date.now()
  if (allStoresDirectoryCache && now - allStoresDirectoryCache.fetchedAt < 60 * 1000) {
    return allStoresDirectoryCache.stores
  }
  const fetchStores = async () => {
    if (allStoresInFlight) return allStoresInFlight
    allStoresInFlight = (async () => {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('id, name, address, phone, has_drive_thru, weekly_hours, is_active')
        .eq('is_active', true)
        .order('id', { ascending: true })
      if (error || !data || data.length === 0) {
        return allStoresDirectoryCache?.stores || []
      }
      const stores = data.map((s: any) => ({
        id: Number(s.id),
        name: cleanPhoneStoreName(s.name),
        address: String(s.address || ''),
        phone: String(s.phone || ''),
        has_drive_thru: Boolean(s.has_drive_thru),
        weekly_hours: s.weekly_hours || null,
        compactHoursEs: buildCompactWeeklyHours(s.weekly_hours, 'es'),
        compactHoursEn: buildCompactWeeklyHours(s.weekly_hours, 'en')
      }))
      allStoresDirectoryCache = { fetchedAt: Date.now(), stores }
      return stores
    })().finally(() => {
      allStoresInFlight = null
    })
    return allStoresInFlight
  }

  if (allStoresDirectoryCache && now - allStoresDirectoryCache.fetchedAt < 5 * 60 * 1000) {
    void fetchStores().catch(() => null)
    return allStoresDirectoryCache.stores
  }
  return fetchStores()
}

export async function loadAllSpecialHoursCached(): Promise<any[]> {
  const now = Date.now()
  if (specialHoursRamCache && now - specialHoursRamCache.fetchedAt < 12 * 1000) {
    return specialHoursRamCache.rows
  }
  const fetchSp = async () => {
    if (specialHoursInFlight) return specialHoursInFlight
    specialHoursInFlight = (async () => {
      const { data, error } = await supabaseAdmin
        .from('phone_special_hours')
        .select('*')
        .order('event_date', { ascending: true })
      if (error || !Array.isArray(data)) {
        return specialHoursRamCache?.rows || []
      }
      specialHoursRamCache = { rows: data, fetchedAt: Date.now() }
      return data
    })().finally(() => {
      specialHoursInFlight = null
    })
    return specialHoursInFlight
  }
  if (specialHoursRamCache && now - specialHoursRamCache.fetchedAt < 120 * 1000) {
    void fetchSp().catch(() => null)
    return specialHoursRamCache.rows
  }
  return fetchSp()
}

async function loadAllActiveKnowledgeBaseCached(): Promise<any[]> {
  const now = Date.now()
  if (allKbRamCache && now - allKbRamCache.fetchedAt < 12 * 1000) {
    return allKbRamCache.rows
  }
  const fetchKb = async () => {
    if (allKbInFlight) return allKbInFlight
    allKbInFlight = (async () => {
      const { data, error } = await supabaseAdmin
        .from('phone_knowledge_base')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
      if (error || !Array.isArray(data)) {
        return allKbRamCache?.rows || []
      }
      allKbRamCache = { rows: data, fetchedAt: Date.now() }
      return data
    })().finally(() => {
      allKbInFlight = null
    })
    return allKbInFlight
  }
  if (allKbRamCache && now - allKbRamCache.fetchedAt < 120 * 1000) {
    void fetchKb().catch(() => null)
    return allKbRamCache.rows
  }
  return fetchKb()
}

export async function getPhoneRoutingDirectory(): Promise<PhoneRoutingDirectoryEntry> {
  const now = Date.now()
  if (phoneRoutingDirCache && now - phoneRoutingDirCache.fetchedAt < 15 * 1000) {
    return phoneRoutingDirCache
  }
  if (phoneRoutingDirInFlight) return phoneRoutingDirInFlight
  phoneRoutingDirInFlight = (async () => {
    const [{ data: configs, error: cfgErr }, { data: stores, error: storeErr }] = await Promise.all([
      supabaseAdmin.from('phone_agent_config').select('store_id, twilio_phone_number'),
      supabaseAdmin.from('stores').select('id, phone, is_active')
    ])
    if ((cfgErr || storeErr) && phoneRoutingDirCache) {
      return phoneRoutingDirCache
    }
    const entry: PhoneRoutingDirectoryEntry = {
      fetchedAt: Date.now(),
      configs: (configs || []) as Array<{ store_id: number; twilio_phone_number: string | null }>,
      activeStores: ((stores || []) as Array<{ id: number; phone: string | null; is_active: boolean | null }>).filter(
        (s) => s.is_active !== false
      )
    }
    phoneRoutingDirCache = entry
    return entry
  })().finally(() => {
    phoneRoutingDirInFlight = null
  })
  return phoneRoutingDirInFlight
}

function normalizeRouteDigits10(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/**
 * Resuelve la sucursal de destino para llamadas Twilio reales con precedencia segura para piloto con 1 solo número
 * o 15 números dedicados:
 * 1) Query param `?storeId=`,
 * 2) `ForwardedFrom` contra `stores.phone` (PRIORITARIO sobre `To` para soportar desvíos de múltiples tiendas al mismo número piloto),
 * 3) `To` contra `phone_agent_config.twilio_phone_number`,
 * 4) Respaldo piloto opcional via `TWILIO_DEFAULT_STORE_ID`.
 */
export async function resolveStoreFromIncomingCall(params: {
  queryStoreId?: string | null
  toNumber?: string | null
  forwardedFrom?: string | null
  directory?: PhoneRoutingDirectoryEntry
  defaultPilotStoreId?: number | null
}): Promise<{ storeId: number | null; matchedStorePhone: string | null; matchedBy: 'query' | 'forwarded_from' | 'to_twilio' | 'pilot_env' | null }> {
  const dir = params.directory || (await getPhoneRoutingDirectory())
  const storeById = new Map<number, any>(dir.activeStores.map((s) => [Number(s.id), s]))

  if (params.queryStoreId && Number.isFinite(Number(params.queryStoreId))) {
    const candidate = Number(params.queryStoreId)
    const found = storeById.get(candidate)
    if (found) {
      return { storeId: candidate, matchedStorePhone: found.phone || null, matchedBy: 'query' }
    }
  }

  const fwdDigits = normalizeRouteDigits10(params.forwardedFrom)
  if (fwdDigits.length === 10) {
    const matchByForwarded = dir.activeStores.find((s) => s.phone && normalizeRouteDigits10(s.phone) === fwdDigits)
    if (matchByForwarded) {
      return {
        storeId: Number(matchByForwarded.id),
        matchedStorePhone: matchByForwarded.phone || null,
        matchedBy: 'forwarded_from'
      }
    }
  }

  const toDigits = normalizeRouteDigits10(params.toNumber)
  if (toDigits.length === 10 && dir.configs) {
    const matchByTwilio = dir.configs.find(
      (c) => c.twilio_phone_number && normalizeRouteDigits10(c.twilio_phone_number) === toDigits
    )
    if (matchByTwilio && storeById.has(Number(matchByTwilio.store_id))) {
      const s = storeById.get(Number(matchByTwilio.store_id))
      return { storeId: Number(matchByTwilio.store_id), matchedStorePhone: s?.phone || null, matchedBy: 'to_twilio' }
    }
  }

  const envPilotRaw =
    params.defaultPilotStoreId ??
    (process.env.TWILIO_DEFAULT_STORE_ID ? Number(process.env.TWILIO_DEFAULT_STORE_ID) : null)
  if (envPilotRaw && Number.isFinite(envPilotRaw) && storeById.has(Number(envPilotRaw))) {
    const s = storeById.get(Number(envPilotRaw))
    return { storeId: Number(envPilotRaw), matchedStorePhone: s?.phone || null, matchedBy: 'pilot_env' }
  }

  return { storeId: null, matchedStorePhone: null, matchedBy: null }
}

/**
 * Obtiene el contexto completo de una sucursal (`stores`, `phone_agent_config`, `phone_special_hours`, `phone_knowledge_base`)
 * usando caché en RAM SWR (12s fresco / 120s stale) y compartiendo catálogos globales entre las 15 sucursales.
 */
export async function getStorePhoneContext(storeId: number) {
  const now = Date.now()
  const cached = storeContextRamCache.get(storeId)
  if (cached && now - cached.fetchedAt < 12 * 1000) {
    const freshEval = evaluateStoreSchedulePure({
      storeId: cached.data.store.id,
      storeName: cached.data.store.name,
      weeklyHours: cached.data.store.weekly_hours,
      specialHours: cached.data.specialHours || []
    })
    return {
      ...cached.data,
      scheduleEval: freshEval
    }
  }

  const refreshContext = async () => {
    const inFlight = storeContextInFlight.get(storeId)
    if (inFlight) return inFlight
    const job = (async () => {
      const [allStores, configRes, allSpecialHours, allKb] = await Promise.all([
        loadAllActiveStoresDirectory(),
        supabaseAdmin.from('phone_agent_config').select('*').eq('store_id', storeId).maybeSingle(),
        loadAllSpecialHoursCached(),
        loadAllActiveKnowledgeBaseCached()
      ])

      let store = allStores.find((s) => Number(s.id) === Number(storeId)) || null
      if (!store) {
        const { data: rawStore } = await supabaseAdmin
          .from('stores')
          .select('id, name, address, phone, has_drive_thru, weekly_hours')
          .eq('id', storeId)
          .single()
        if (!rawStore) throw new Error(`Sucursal #${storeId} no encontrada`)
        store = {
          id: Number(rawStore.id),
          name: cleanPhoneStoreName(rawStore.name),
          address: String(rawStore.address || ''),
          phone: String(rawStore.phone || ''),
          has_drive_thru: Boolean(rawStore.has_drive_thru),
          weekly_hours: rawStore.weekly_hours || null,
          compactHoursEs: buildCompactWeeklyHours(rawStore.weekly_hours, 'es'),
          compactHoursEn: buildCompactWeeklyHours(rawStore.weekly_hours, 'en')
        }
      }

      const storeSpecial = allSpecialHours.filter(
        (s: any) => s.store_id === null || Number(s.store_id) === Number(storeId)
      )
      const storeKb = allKb.filter(
        (k: any) => k.store_id === null || Number(k.store_id) === Number(storeId)
      )

      const config = configRes.data || {
        store_id: store.id,
        is_enabled: true,
        routing_mode: 'conditional_forward',
        carrier_type: [1, 8, 14, 16].includes(store.id) ? 'spectrum_landline' : 'att_wireless',
        twilio_phone_number: null,
        forwarding_status: 'pending',
        ring_timeout_seconds: 20,
        voice_id: 'Kore',
        default_language: 'es',
        custom_greeting_es: null,
        custom_greeting_en: null,
        manager_transfer_phone: null,
        allow_live_transfer: false,
        accepts_ebt: ![1, 9].includes(store.id),
        parking_notes_es: null,
        parking_notes_en: null
      }

      const scheduleEval = evaluateStoreSchedulePure({
        storeId: store.id,
        storeName: store.name,
        weeklyHours: store.weekly_hours,
        specialHours: storeSpecial
      })

      const result = {
        store,
        config,
        scheduleEval,
        specialHours: storeSpecial,
        allSpecialHours,
        knowledgeBase: storeKb,
        onlineOrderUrl: OFFICIAL_STORE_URLS[store.id] || OFFICIAL_ORDER_FALLBACK_URL
      }
      storeContextRamCache.set(storeId, { data: result, fetchedAt: Date.now() })
      return result
    })().finally(() => {
      storeContextInFlight.delete(storeId)
    })
    storeContextInFlight.set(storeId, job)
    return job
  }

  if (cached && now - cached.fetchedAt < 120 * 1000) {
    void refreshContext().catch(() => null)
    const freshEval = evaluateStoreSchedulePure({
      storeId: cached.data.store.id,
      storeName: cached.data.store.name,
      weeklyHours: cached.data.store.weekly_hours,
      specialHours: cached.data.specialHours || []
    })
    return { ...cached.data, scheduleEval: freshEval }
  }
  return refreshContext()
}

/**
 * Crea un recado prioritario en `phone_callback_requests` separando estrictamente
 * `source = 'twilio'` (llamadas reales que encienden el banner rojo en `/order-ready-board`)
 * vs `source = 'simulator'` (pruebas de entrenamiento del Simulador Web).
 */
export async function createManagerCallbackRequest(params: {
  callId?: string | null
  storeId: number
  source?: 'twilio' | 'simulator'
  callerName: string
  callerPhone: string
  callerType?: string
  urgency?: string
  reasonCategory?: string
  reasonSummary: string
  ticketOrOrderNumber?: string | null
}) {
  const businessDate = getCaliforniaBusinessDate()
  const payload = {
    call_id: params.callId || null,
    store_id: params.storeId,
    source: params.source === 'simulator' ? 'simulator' : 'twilio',
    caller_name: (params.callerName || 'Cliente').trim(),
    caller_phone: (params.callerPhone || 'No proporcionado').trim(),
    caller_type: params.callerType || 'customer',
    urgency: params.urgency || 'high',
    reason_category: params.reasonCategory || 'general',
    reason_summary: (params.reasonSummary || 'Solicitud de llamada al gerente').trim(),
    ticket_or_order_number: params.ticketOrOrderNumber ? String(params.ticketOrOrderNumber).trim() : null,
    status: 'pending',
    business_date: businessDate
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('phone_callback_requests')
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`Error al guardar recado para el gerente: ${error.message}`)
  }

  // NOTA DE SEGURIDAD (RLS + Polling Autenticado):
  // Las tablas `phone_*` tienen RLS estricto (`service_role` únicamente) para proteger PII telefónico.
  // El banner del gerente en `/order-ready-board` consulta `/api/phone/dashboard?callbacksOnly=true` (solo `source='twilio'`)
  // cada 6 segundos con recuperación instantánea al reactivar pestaña/red.
  return inserted
}

/**
 * Devuelve la frase hablada posterior al aviso legal CIPA:
 * - Si la sucursal está ABIERTA: "¿En qué te puedo ayudar?" / "How can I help you?"
 * - Si la sucursal está CERRADA (ej. Thanksgiving 6:00 PM, Navidad, Viernes Santo o madrugada): anuncia primero
 *   con claridad que ya está cerrada + el motivo/hora y la reapertura, y luego ofrece ayudar en lo que necesite.
 */
export function getPostDisclosurePrompt(lang: PhoneLang, scheduleEval?: StoreOpenEvaluation | null): string {
  if (scheduleEval && !scheduleEval.isOpenNow) {
    if (lang === 'en') {
      return scheduleEval.closedGreetingPromptEn || `${scheduleEval.statusMessageEn} How can I help you?`
    }
    return scheduleEval.closedGreetingPromptEs || `${scheduleEval.statusMessageEs} ¿En qué te puedo ayudar?`
  }
  return lang === 'en' ? 'How can I help you?' : '¿En qué te puedo ayudar?'
}

/**
 * Construye el saludo oficial de apertura de llamada cumpliendo con:
 * - California AB 2905 (Public Utilities Code § 2874) & SB 1001 (BPC § 17941): identificación explícita como Inteligencia Artificial.
 * - California Invasion of Privacy Act (CIPA — Penal Code §§ 631, 632 y 632.7): aviso previo de grabación y transcripción
 *   con proveedores/tecnología de IA y consentimiento explícito al permanecer en la línea.
 * - Si la sucursal se encuentra CERRADA al momento de la llamada (`scheduleEval.isOpenNow === false`), anuncia primero
 *   que está cerrada (con motivo festivo y hora de reapertura) antes de preguntar "¿En qué te puedo ayudar?".
 * - Aun cuando se configure `custom_greeting_es` / `custom_greeting_en`, garantiza SIEMPRE el aviso legal CIPA + IA y la tecla 9,
 *   funcionando de forma idéntica tanto en Twilio (`omitTrailingQuestion: true`) como en el Simulador Web.
 */
export function buildInitialGreeting(
  storeName: string,
  lang: PhoneLang,
  customEs?: string | null,
  customEn?: string | null,
  options?: {
    omitTrailingQuestion?: boolean
    includeLanguageSwitchHint?: boolean
    scheduleEval?: StoreOpenEvaluation | null
  }
): string {
  const cleanName = cleanPhoneStoreName(storeName)
  // Por defecto SIEMPRE incluye la opción de tecla 9 tanto en Twilio como en el Simulador Web
  const includeHint = options?.includeLanguageSwitchHint !== false
  const postPrompt = options?.omitTrailingQuestion ? '' : ` ${getPostDisclosurePrompt(lang, options?.scheduleEval)}`

  if (lang === 'en') {
    const switchEs = includeHint ? ' Para español, oprima el nueve.' : ''
    if (customEn && customEn.trim()) {
      let baseEn = customEn
        .trim()
        .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
        .replace(/\bLA\s+(Broadway|Central)\b/g, '$1')
        .replace(/\s*how can i (help|assist) you( today)?\??\s*$/i, '')
        .trim()
      if (!/[.!?]$/.test(baseEn)) baseEn += '.'
      const hasAiAndRecordConsent =
        /\b(ai|artificial intelligence|virtual assistant)\b/i.test(baseEn) &&
        /\b(record|transcrib)\w*/i.test(baseEn)
      if (!hasAiAndRecordConsent) {
        baseEn +=
          ' You are speaking with our AI assistant. This call may be recorded and transcribed using AI technology to assist you; by continuing, you consent.'
      }
      if (includeHint && !/\b(oprim[ae]|marqu[ae]|presiona|press)\b[^.!?]{0,25}\b(nueve|nine|9)\b/i.test(baseEn)) {
        baseEn += switchEs
      }
      if (options?.omitTrailingQuestion) {
        return baseEn.trim()
      }
      if (options?.scheduleEval && !options.scheduleEval.isOpenNow && !/\bclosed\b/i.test(baseEn)) {
        return `${baseEn} ${getPostDisclosurePrompt('en', options.scheduleEval)}`.trim()
      }
      return `${baseEn}${postPrompt}`.trim()
    }
    return `Thank you for calling Tacos Gavilan in ${cleanName}! You are speaking with our AI assistant. This call may be recorded and transcribed using AI technology to assist you; by continuing, you consent.${switchEs}${postPrompt}`
  }

  // "nine" escrito en letra para que la voz en español lo pronuncie en inglés puro ("press nine" y no "press nueve")
  const switchEn = includeHint ? ' For English, press nine.' : ''
  if (customEs && customEs.trim()) {
    let baseEs = customEs
      .trim()
      .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
      .replace(/\bLA\s+(Broadway|Central)\b/g, '$1')
      .replace(/\s*¿?en qu[eé] te puedo ayudar( hoy)?\??\s*$/i, '')
      .trim()
    if (!/[.!?]$/.test(baseEs)) baseEs += '.'
    const hasAiAndRecordConsent =
      /\b(inteligencia artificial|asistente virtual|asistente de ia)\b/i.test(baseEs) &&
      /\b(grabad|transcrit)\w*/i.test(baseEs)
    if (!hasAiAndRecordConsent) {
      baseEs +=
        ' Te atiende nuestra asistente de inteligencia artificial. Esta llamada puede ser grabada y transcrita con tecnología de IA para atenderte; al continuar aceptas este uso.'
    }
    if (includeHint && !/\b(press|oprim[ae]|marqu[ae]|presiona)\b[^.!?]{0,25}\b(nine|nueve|9)\b/i.test(baseEs)) {
      baseEs += switchEn
    }
    if (options?.omitTrailingQuestion) {
      return baseEs.trim()
    }
    if (options?.scheduleEval && !options.scheduleEval.isOpenNow && !/\bcerrad[oa]s?\b/i.test(baseEs)) {
      return `${baseEs} ${getPostDisclosurePrompt('es', options.scheduleEval)}`.trim()
    }
    return `${baseEs}${postPrompt}`.trim()
  }
  return `¡Gracias por llamar a Tacos Gavilan sucursal ${cleanName}! Te atiende nuestra asistente de inteligencia artificial. Esta llamada puede ser grabada y transcrita con tecnología de IA para atenderte; al continuar aceptas este uso.${switchEn}${postPrompt}`
}

const REGION_STORE_IDS: Record<string, number[]> = {
  'east la': [11, 13],
  'este de los angeles': [11, 13],
  'south la': [5, 6, 7],
  'sur de los angeles': [5, 6, 7],
  'downtown': [5, 6],
  'southeast la': [11, 12, 13, 14, 15, 16],
  'gateway cities': [11, 12, 13, 14, 15, 16],
  'orange county': [9],
  'condado de orange': [9],
  'inland empire': [1],
  'san bernardino': [1],
  'san gabriel': [3, 4, 10],
  'sgv': [3, 4, 10]
}

const PHONE_AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_store_hours_and_status',
        description:
          'Respaldo: los DATOS EN VIVO de tu contexto ya incluyen estado abierto/cerrado, horario y dirección de esta sucursal. Úsala solo si falta algún dato festivo.',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'search_menu_item_price',
        description:
          'Respaldo: úsala SOLO si el platillo, bebida o postre NO aparece ya en CATÁLOGO EN VIVO ni en COINCIDENCIAS DEL MENÚ del prompt.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Nombre del platillo o bebida a buscar (ej. "torta cubana", "champurrado", "flan").'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_fiesta_platter_packages',
        description:
          'Respaldo: úsala SOLO si la cotización exacta para un evento de MÁS DE 40 invitados NO aparece ya calculada en CHAROLAS FIESTA PLATTER de tu contexto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            guest_count: {
              type: 'INTEGER',
              description: 'Número estimado de invitados o personas para el evento (ej. 25, 40, 60, 100).'
            }
          },
          required: ['guest_count']
        }
      },
      {
        name: 'find_other_stores',
        description:
          'Respaldo: úsala ÚNICAMENTE si el usuario pregunta por otra sucursal, zona o comparativa y esa información NO aparece ya en tu contexto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_city_or_filter: {
              type: 'STRING',
              description: 'Nombre de ciudad, zona o "drive_thru" para filtrar tiendas con Drive-Thru; omítelo o envía vacío para revisar las 15 sucursales.'
            }
          }
        }
      },
      {
        name: 'create_manager_callback',
        description:
          'Registra un Recado Prioritario en Vivo en la pantalla del Gerente en la computadora de la tienda (sin transferir llamadas a celulares personales). Úsalo ÚNICAMENTE cuando ya tengas nombre y teléfono real de 10 dígitos (o cuando en llamada Twilio el cliente pida devolverle la llamada a su mismo número).',
        parameters: {
          type: 'OBJECT',
          properties: {
            caller_name: {
              type: 'STRING',
              description: 'Nombre real proporcionado por la persona que llama.'
            },
            caller_phone: {
              type: 'STRING',
              description: 'Teléfono real de 10 dígitos confirmado por la persona (NUNCA "No proporcionado" ni números 555). Si en llamada real pide marcar a este mismo número, envía "CALLER_ID".'
            },
            caller_type: {
              type: 'STRING',
              description: 'Tipo de persona: "customer", "employee", "vendor", "delivery_driver", o "corporate".'
            },
            urgency: {
              type: 'STRING',
              description: 'Nivel de urgencia: "high", "critical", o "normal".'
            },
            reason_category: {
              type: 'STRING',
              description: 'Categoría: "missing_or_wrong_item", "lost_item", "employee_callout", "vendor_arrival", "billing_refund", o "other".'
            },
            reason_summary: {
              type: 'STRING',
              description: 'Resumen claro y completo del asunto para el gerente.'
            },
            ticket_or_order_number: {
              type: 'STRING',
              description: 'Número de ticket u orden si aplica (opcional).'
            }
          },
          required: ['caller_name', 'caller_phone', 'reason_summary']
        }
      },
      {
        name: 'flag_unanswered_question',
        description:
          'Úsalo ÚNICAMENTE para dudas legítimas del negocio (políticas, facturación, eventos especiales) que no tengan respuesta en el contexto. NUNCA lo llames por chistes, música, deportes o preguntas fuera de tema ajenas a Tacos Gavilan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question_text: {
              type: 'STRING',
              description: 'La pregunta o duda exacta que no tenía respuesta oficial.'
            }
          },
          required: ['question_text']
        }
      }
    ]
  }
]

/**
 * Limpia muletillas iniciales redundantes ("¡Sí!", "¡Claro que sí!", "Hola."), corrige cualquier mención
 * accidental a "Tacos El Gavilan", y evita mutilar "la central" en español (reemplaza solo "LA " mayúscula).
 */
export function sanitizePhoneReplyText(rawText: string, lang: PhoneLang = 'es'): string {
  const preCleaned = rawText
    .replace(/[*#_`~]/g, '')
    .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
    .replace(/\bLA\s+(Broadway|Central)\b/g, '$1')
    .replace(/\b(Central|Broadway)\s*\(\s*L\.?A\.?\s*\)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const base = expandStreetAbbreviationsInText(preCleaned, lang, { stripZipAfterState: false })
  let clean = base

  // REGLAS DE SEGURIDAD (auditoría 2026-11-09):
  // - Solo se elimina una muletilla si va INMEDIATAMENTE seguida de puntuación (",", "!", ".") y luego más texto.
  //   Esto evita mutilar "Surely" o "Hi there" (no llevan puntuación pegada). No se usa \b porque en JS no
  //   funciona después de letras acentuadas ("sí").
  // - "Si" SIN tilde es condicional ("Si la sucursal está cerrada...") y NUNCA se toca; solo se quita "Sí" CON tilde.
  // - Nunca se quita una muletilla seguida de negación ("Claro que no", "Por supuesto que no tomamos pedidos").

  // 1. Saludos repetidos a mitad de llamada ("¡Hola!", "Hola,", "Hello!", "Hi!")
  clean = clean.replace(/^¡?(hola|hello|hi)[,!.]+\s+(?=\S)/i, '')

  // 2. Muletillas de apertura ("¡Claro que sí!", "¡Con mucho gusto!", "¡Por supuesto!", "Of course!")
  for (let i = 0; i < 2; i++) {
    clean = clean.replace(
      /^¡?(claro que sí|claro que si|por supuesto|con mucho gusto|claro|entendido|of course|sure thing|sure|happy to help|certainly|absolutely)[,!.]+\s+(?=\S)/i,
      ''
    )
  }

  // 3. "¡Sí!" / "Sí," / "Yes," de apertura (solo con tilde y con puntuación obligatoria)
  clean = clean.replace(/^¡?sí[,!.]+\s+(?=\S)/i, '').replace(/^yes[,!.]+\s+(?=\S)/i, '')

  // 4. Si se quitó una muletilla con "¡" y quedó un "!" de cierre huérfano en la primera oración, cambiarlo por punto
  if (clean !== base && lang === 'es') {
    const firstBang = clean.indexOf('!')
    const firstStop = clean.search(/[.?]/)
    if (firstBang !== -1 && (firstStop === -1 || firstBang < firstStop) && !clean.slice(0, firstBang).includes('¡')) {
      clean = clean.slice(0, firstBang) + '.' + clean.slice(firstBang + 1)
    }
  }

  // 5. Capitalizar la primera letra tras la limpieza
  if (clean.length > 0 && clean !== base) {
    const firstAlphaIdx = clean.search(/[a-záéíóúñA-ZÁÉÍÓÚÑ]/)
    if (firstAlphaIdx === 0) {
      clean = clean.charAt(0).toUpperCase() + clean.slice(1)
    } else if (firstAlphaIdx === 1 && (clean.startsWith('¡') || clean.startsWith('¿'))) {
      clean = clean.charAt(0) + clean.charAt(1).toUpperCase() + clean.slice(2)
    }
  }

  return clean.trim() || base
}

/**
 * Recorta la respuesta hablada a un máximo seguro (≈2-3 oraciones) cortando SIEMPRE en fin de oración,
 * para que el audio telefónico (límite de 900 caracteres en `/api/phone/tts`) nunca quede a medias.
 */
export function clampPhoneReplyLength(text: string, maxChars = 480): string {
  const clean = text.trim()
  if (clean.length <= maxChars) return clean
  const window = clean.slice(0, maxChars)
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
  if (lastStop >= 80) return window.slice(0, lastStop + 1).trim()
  const lastSpace = window.lastIndexOf(' ')
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim().replace(/[,;:]$/, '')}.`
}

/**
 * Detecta el idioma REAL de un texto (preferentemente la respuesta generada por la IA, que es texto limpio).
 * Filtra primero sustantivos propios del menú mexicano ("Piña", "Jalapeño", "Gavilán") que también se usan
 * dentro de frases en inglés para evitar cambiar la voz a español por error cuando la respuesta está en inglés.
 */
const MENU_LOANWORDS_RE =
  /\b(los\s+[aá]ngeles|piña|pina|jalapeños?|jalapenos?|horchata|jamaica|tamarindo|champurrado|asada|pastor|carnitas|lengua|cabeza|buche|chorizo|mulitas?|quesadillas?|sopes?|tacos?|burritos?|tortas?|platos?|frijoles?|arroz|queso|lim[oó]n|chiles?|salsas?|caf[eé]|monterey\s+jack|gavil[aá]n)\b/gi

const ES_STRONG_WORDS = new Set([
  'de', 'la', 'el', 'que', 'en', 'los', 'las', 'por', 'para', 'con', 'una', 'un', 'es', 'esta', 'estamos', 'tenemos',
  'hoy', 'puedes', 'nuestra', 'nuestro', 'sucursal', 'tu', 'te', 'si', 'cuanto', 'cuesta', 'horario', 'abren', 'cierran',
  'quiero', 'tienen', 'gracias', 'hola', 'gerente', 'orden', 'algo', 'mas', 'ayudar', 'pedido', 'ahorita', 'donde', 'aceptan',
  'mi', 'no', 'muy', 'pero', 'como', 'ya', 'solo', 'todo', 'bueno', 'buenas', 'tardes', 'dias', 'noches', 'cual', 'lleva'
])
const EN_STRONG_WORDS = new Set([
  'the', 'and', 'you', 'your', 'we', 'our', 'is', 'are', 'to', 'of', 'for', 'at', 'with', 'can', 'do', 'have', 'today',
  'open', 'close', 'closing', 'what', 'how', 'much', 'please', 'thank', 'thanks', 'hello', 'location', 'would', 'like',
  'help', 'there', 'does', 'accept', 'where', 'when', 'my', 'it', 'this', 'that', 'address', 'hours', 'price', 'many'
])

export function detectPhoneTextLanguage(text: string, fallback: PhoneLang): PhoneLang {
  const raw = String(text || '')
  if (!raw.trim()) return fallback
  const strippedMenuLoanwords = raw.replace(MENU_LOANWORDS_RE, ' ')
  const norm = normalizeSearchText(strippedMenuLoanwords)
  const words = norm.split(/\s+/).filter(Boolean)
  let es = /[¿¡]/.test(raw) || /[ñáéíóú]/i.test(strippedMenuLoanwords) ? 3 : 0
  let en = 0
  for (const w of words) {
    if (ES_STRONG_WORDS.has(w)) es++
    if (EN_STRONG_WORDS.has(w)) en++
  }
  if (es === en) return fallback
  if (Math.abs(es - en) < 2 && words.length > 3) return fallback
  return es > en ? 'es' : 'en'
}

/**
 * Detecta cambios de idioma en la entrada cruda/STT del usuario exigiendo evidencia sólida para evitar
 * falsos cambios ante frases cortas mixtas ("tacos de pastor", "one café please", "mi order", "ok", "drive thru").
 */
export function detectCallerLanguageSwitch(userText: string, currentLang: PhoneLang): PhoneLang {
  const raw = String(userText || '').trim()
  if (!raw) return currentLang
  const normRaw = normalizeSearchText(raw)
  if (/\b(speak english|in english|english please|switch to english|hablas ingles)\b/i.test(normRaw)) return 'en'
  if (/\b(habla espanol|en espanol|spanish please|switch to spanish|prefiero espanol)\b/i.test(normRaw)) return 'es'

  const stripped = raw
    .replace(MENU_LOANWORDS_RE, ' ')
    .replace(/\b(ok|okay|bye|super|regular|combo|drive|thru|manager|ticket|order|ebt|calfresh|hi)\b/gi, ' ')
  const norm = normalizeSearchText(stripped)
  const words = norm.split(/\s+/).filter(Boolean)
  let es = /[¿¡]/.test(raw) || /[ñáéíóú]/i.test(stripped) ? 2 : 0
  let en = 0
  for (const w of words) {
    if (ES_STRONG_WORDS.has(w)) es++
    if (EN_STRONG_WORDS.has(w)) en++
  }
  const targetLang: PhoneLang = es > en ? 'es' : 'en'
  if (targetLang === currentLang) return currentLang
  const targetScore = targetLang === 'es' ? es : en
  const currentScore = currentLang === 'es' ? es : en
  if (targetScore >= 2 && targetScore - currentScore >= 2) {
    return targetLang
  }
  return currentLang
}

async function callGeminiPhoneWithFailover(
  body: any,
  deadlineMs: number = Date.now() + 12000,
  preferredModel?: string | null
) {
  const rawPool = await getGeminiKeyPoolWithRemote()
  if (rawPool.length === 0) {
    throw new Error('No hay llaves GEMINI_API_KEY configuradas')
  }

  const now = Date.now()
  const activePool = rawPool.filter((k) => (keyQuarantineUntil.get(k) || 0) <= now)
  const candidateKeys = activePool.length > 0 ? activePool : rawPool

  const startIdx = keyRoundRobin++ % candidateKeys.length
  const rotated = [...candidateKeys.slice(startIdx), ...candidateKeys.slice(0, startIdx)]
  const modernKeys = rotated.filter((k) => k.startsWith('AQ.'))
  const classicKeys = rotated.filter((k) => !k.startsWith('AQ.'))
  const orderedKeys = [...modernKeys, ...classicKeys]

  const baseModels = Array.from(new Set([...MODERN_CHAT_MODELS, ...CLASSIC_CHAT_MODELS]))
  const orderedModels = preferredModel && baseModels.includes(preferredModel)
    ? [preferredModel, ...baseModels.filter((m) => m !== preferredModel)]
    : baseModels
  let lastError = 'Servicio de IA temporalmente no disponible'
  let attempts = 0
  const MAX_ATTEMPTS = 14

  for (const pass of ['fresh', 'cooldown_fallback'] as const) {
    if (pass === 'cooldown_fallback' && deadlineMs - Date.now() < 1200) break
    for (const model of orderedModels) {
      if (pass === 'fresh' && (modelUnavailableUntil.get(model) || 0) > Date.now()) continue
      let attemptsOnModel = 0
      let overloadsOnModel = 0
      const isFollowUpRound = Boolean(preferredModel)
      const maxAttemptsOnThisModel = pass === 'fresh' ? (isFollowUpRound ? 2 : model === 'gemini-3.5-flash-lite' ? 3 : 2) : 2
      const supportsMinimalThinking = !model.includes('3.8')

      for (const key of orderedKeys) {
        if (attemptsOnModel >= maxAttemptsOnThisModel) break
        if ((keyQuarantineUntil.get(key) || 0) > Date.now()) continue
        const pairKey = `${key}:${model}`
        if (pass === 'fresh' && (keyModelCooldownUntil.get(pairKey) || 0) > Date.now()) continue
        const modelsForKey = key.startsWith('AQ.') ? MODERN_CHAT_MODELS : CLASSIC_CHAT_MODELS
        if (!modelsForKey.includes(model)) continue

        // Presupuesto global: una llamada telefónica no puede esperar más (Twilio corta el webhook a ~15 s)
        const remaining = deadlineMs - Date.now()
        if (remaining < 900 || attempts >= MAX_ATTEMPTS) {
          throw new Error(`${lastError} (presupuesto de tiempo agotado tras ${attempts} intentos)`)
        }
        attempts++
        attemptsOnModel++

        const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`
        try {
          // thinkingLevel 'minimal' = sin razonamiento interno: los "thinking tokens" ya no consumen maxOutputTokens
          // (causa raíz del corte "Estamos abiertos en este momento en la su"). Verificado en vivo 2026-11-09.
          const genCfg: Record<string, any> = {
            maxOutputTokens: 1024,
            ...(body.generationConfig || {})
          }
          if (supportsMinimalThinking) {
            genCfg.thinkingConfig = { thinkingLevel: 'minimal' }
          }
          // Si cambiamos de modelo en una ronda de seguimiento (>0), asegurar thoughtSignature para evitar HTTP 400
          const patchedContents =
            preferredModel && model !== preferredModel && Array.isArray(body.contents)
              ? body.contents.map((turn: any) =>
                  Array.isArray(turn?.parts)
                    ? {
                        ...turn,
                        parts: turn.parts.map((p: any) =>
                          p?.functionCall && !p.thoughtSignature
                            ? { ...p, thoughtSignature: 'skip_thought_signature_validator' }
                            : p
                        )
                      }
                    : turn
                )
              : body.contents
          const requestBody = {
            ...body,
            contents: patchedContents,
            generationConfig: genCfg
          }

          const attemptLimitMs = pass === 'fresh' ? 2500 : 3200
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(Math.min(attemptLimitMs, remaining - 250)),
            body: JSON.stringify(requestBody)
          })
          const data = await res.json().catch(() => ({}))
          const candidate = data?.candidates?.[0]
          const parts: any[] = candidate?.content?.parts || []
          const hasFunctionCall = parts.some((p) => p?.functionCall)
          const visibleText = parts
            .filter((p) => !p?.thought)
            .map((p) => p?.text || '')
            .join('')
            .trim()

          if (res.ok && parts.length > 0) {
            // MAX_TOKENS con texto útil: se acepta y luego se recorta en fin de oración (clampPhoneReplyLength).
            // MAX_TOKENS SIN texto ni función: respuesta inservible -> se intenta con el siguiente candidato.
            if (candidate?.finishReason !== 'MAX_TOKENS' || hasFunctionCall || visibleText.length >= 40) {
              return { data, usedModel: model }
            }
            lastError = `Respuesta truncada (MAX_TOKENS) en ${model}`
            continue
          }

          lastError = data?.error?.message || `HTTP ${res.status}${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}`
          if (res.status === 404) {
            // El MODELO no existe o fue retirado (no es culpa de la llave): saltar ese modelo 1 hora para todas las llaves
            modelUnavailableUntil.set(model, Date.now() + 60 * 60 * 1000)
            break
          }
          if (res.status === 401 || res.status === 402 || res.status === 403) {
            // Llave inválida, sin saldo o sin permisos: cuarentena larga de la LLAVE
            keyQuarantineUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
            attemptsOnModel = Math.max(0, attemptsOnModel - 1)
            continue
          }
          if (res.status === 400) {
            // Error determinista de la petición (no se arregla cambiando de llave/modelo)
            throw new Error(`Petición inválida a Gemini: ${lastError}`)
          }
          if (res.status === 429) {
            // Cuota agotada en esa pareja (llave, modelo): enfriar 5 min y avanzar rápido sin re-quemar todo el presupuesto
            keyModelCooldownUntil.set(pairKey, Date.now() + 5 * 60 * 1000)
            continue
          }
          // 500/503 sobrecarga temporal del modelo: si 2 llaves fallan seguidas, saltar al siguiente modelo al instante
          overloadsOnModel++
          keyModelCooldownUntil.set(pairKey, Date.now() + 30 * 1000)
          if (overloadsOnModel >= 2) {
            modelUnavailableUntil.set(model, Date.now() + 60 * 1000)
            break
          }
        } catch (e: any) {
          if (String(e?.message || '').startsWith('Petición inválida a Gemini')) throw e
          overloadsOnModel++
          keyModelCooldownUntil.set(pairKey, Date.now() + 30 * 1000)
          lastError = e?.message || 'Error de red'
          if (overloadsOnModel >= 2) {
            modelUnavailableUntil.set(model, Date.now() + 60 * 1000)
            break
          }
        }
      }
    }
  }

  throw new Error(lastError)
}

/**
 * Detecta si la respuesta generada prometió/confirmó enviar una alerta o recado al gerente sin haber invocado
 * `create_manager_callback`, y extrae datos de contacto reales dichos por quien llama para garantizar persistencia.
 */
function inspectMissingCallbackGuard(params: {
  replyText: string
  transcript: TranscriptEntry[]
  blockedStoreTenDigits: string[]
  source: 'twilio' | 'simulator'
  callerNumber?: string | null
  allowDev555: boolean
}): {
  claimedSent: boolean
  callerPhone: string | null
  callerName: string
  summary: string
} {
  const normReply = normalizeSearchText(params.replyText)
  const isAskingDetails =
    /\b(necesito|dame|regala|comparte|proporciona|cual es|indica(?:me|nos)|me das|me puedes dar|tu nombre|tu numero|su nombre|su numero|your name|your phone|10 digitos|10 digits|would you like me to|quieres que|deseas que|gustaria que|can i send|si me das|if you share)\b/i.test(
      normReply
    )
  const claimedSent =
    !isAskingDetails &&
    (/\b(envio|envie|enviando|mando|mandando|deje|dejando|registre|registrando|notifico|notifique|notificando|genere|cree|paso|sending|sent|logging|logged|leaving|left|notifying|notified|creating|created|submitting|submitted)\b.{0,65}\b(alerta|recado|aviso|mensaje|notificacion|pantalla|gerente|manager|priority\s+alert|callback)\b/i.test(
      normReply
    ) ||
      /\b(ya\s+(?:tiene|recibio|esta\s+en\s+(?:la\s+)?pantalla)|already\s+(?:has|received|on\s+(?:the\s+)?screen))\b.{0,45}\b(gerente|manager|alerta|recado|pantalla|screen|alert|callback)\b/i.test(
        normReply
      ))

  if (!claimedSent) {
    return { claimedSent: false, callerPhone: null, callerName: 'Cliente en línea', summary: '' }
  }

  const userTexts = params.transcript.filter((t) => t.role === 'user').map((t) => String(t.text || '').trim())
  const combinedUser = userTexts.join(' | ').trim()
  const blocked = new Set(params.blockedStoreTenDigits.filter(Boolean))

  let detectedPhone: string | null = null
  const phoneMatches = combinedUser.match(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || []
  for (let i = phoneMatches.length - 1; i >= 0; i--) {
    const parsed = normalizeUsPhoneE164(phoneMatches[i])
    if (
      parsed.valid &&
      parsed.normalized &&
      parsed.tenDigits &&
      !blocked.has(parsed.tenDigits) &&
      !isFictitiousNanpPhone(parsed.tenDigits, params.allowDev555)
    ) {
      detectedPhone = parsed.normalized
      break
    }
  }

  if (
    !detectedPhone &&
    params.source === 'twilio' &&
    params.callerNumber &&
    /\b(este mismo numero|este numero|mi numero|same number|this number|caller id)\b/i.test(normalizeSearchText(combinedUser))
  ) {
    const parsedCaller = normalizeUsPhoneE164(params.callerNumber)
    if (parsedCaller.valid && parsedCaller.normalized && parsedCaller.tenDigits && !isFictitiousNanpPhone(parsedCaller.tenDigits, false)) {
      detectedPhone = parsedCaller.normalized
    }
  }

  let detectedName = 'Cliente en línea'
  const nameMatch = combinedUser.match(
    /(?:^|[.,;|]\s*|\b)(?:hola\s+)?(?:soy|me llamo|mi nombre es|habla|this is|my name is|i am|i'm)\s+([A-Za-z0-9_ÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/i
  )
  if (nameMatch?.[1]) {
    const candidate = nameMatch[1]
      .replace(/\b(?:de|del|en|por|para|con|y|mi|telefono|phone|numero|number|porque|que|un|una|el|la|empleado|cliente|manager|gerente).*$/i, '')
      .trim()
    if (candidate.length >= 2 && !/^(un|una|el|la|cliente|empleado|empleada|customer|caller)$/i.test(normalizeSearchText(candidate))) {
      detectedName = candidate
    }
  }

  return {
    claimedSent: true,
    callerPhone: detectedPhone,
    callerName: detectedName,
    summary: combinedUser.slice(0, 500)
  }
}

/**
 * Clasifica la intención y categoría de la llamada a partir del texto del usuario y herramientas usadas,
 * respetando estrictamente el orden de prioridad operativa para evitar colisiones entre escenarios.
 */
function inferCallMetadata(
  userText: string,
  toolsUsed: string[],
  callbackCreated: boolean
): {
  callerCategory: string
  primaryIntent: string
  resolvedByAi: boolean
  detectedLang: PhoneLang
} {
  const norm = normalizeSearchText(userText)
  const isEnglish =
    /\b(what|when|where|how much|open|close|hours|price|platter|manager|missing|order|thank|hello|hi|do you have|are you|can i)\b/i.test(
      userText
    ) && !/\b(hola|precio|horario|abierto|cerrado|cuanto|charola|tienen|gerente|orden|puedo|quiero)\b/i.test(norm)

  const detectedLang: PhoneLang = isEnglish ? 'en' : 'es'

  if (/\b(google listing|seo|merchant cash|prestamo comercial|extended warranty|solar panels|paneles solares|business insurance)\b/i.test(norm)) {
    return { callerCategory: 'spam', primaryIntent: 'spam', resolvedByAi: true, detectedLang }
  }
  if (/\b(soy empleado|soy empleada|trabajo ahi|trabajo en la sucursal|estacion de parrilla|llegar tarde|voy a llegar tarde|estoy enfermo|estoy enferma|no voy a poder ir|mi turno|calling in sick|call in sick|running late|call out|grill station)\b/i.test(norm)) {
    return {
      callerCategory: 'employee',
      primaryIntent: 'employee_callout',
      resolvedByAi: false,
      detectedLang
    }
  }
  if (/\b(falto|falta|faltaron|me falto|incompleta|equivocada|ticket|queja|reembolso|me cobraron|cobro doble|cobraron de mas|wrong order|missing|refund|overcharged|got sick)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'complaint_missing_item',
      resolvedByAi: false,
      detectedLang
    }
  }
  // Empleo ANTES que objetos perdidos ("bolsa de trabajo" no es una bolsa olvidada)
  if (/\b(bolsa de trabajo|empleo|contratando|vacantes|solicitud de empleo|aplicar para trabajar|busco trabajo|hiring|job application|apply for a job|looking for a job)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'job_inquiry', resolvedByAi: true, detectedLang }
  }
  if (/\b(olvide|deje mi|deje una|perdi|mi cartera|mi celular|mis llaves|mi bolsa|mi chamarra|lost|left my|forgot my)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'lost_and_found',
      resolvedByAi: false,
      detectedLang
    }
  }
  if (/\b(proveedor|tecnico|mantenimiento|bodega|plomero|refrigeracion|vendor|delivery truck|technician)\b/i.test(norm)) {
    return {
      callerCategory: 'vendor',
      primaryIntent: 'vendor_service',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(uber|doordash|grubhub|repartidor|delivery driver|pickup order)\b/i.test(norm)) {
    return {
      callerCategory: 'delivery_driver',
      primaryIntent: 'delivery_driver',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(hacer un pedido|pedido por telefono|ordenar por telefono|place an order|order over the phone)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'order_by_phone', resolvedByAi: true, detectedLang }
  }
  if (
    toolsUsed.includes('get_fiesta_platter_packages') ||
    /\b(charola|charolas|fiesta platter|party tray|catering|invitados|guests)\b/i.test(norm) ||
    /\b([1-9]\d{1,2})\s+(personas|people)\b/i.test(norm)
  ) {
    return { callerCategory: 'customer', primaryIntent: 'fiesta_platters', resolvedByAi: true, detectedLang }
  }
  if (/\b(ebt|calfresh|cal fresh|call fresh|car fresh|e b t|i b t|food stamps|estampillas|tarjeta|efectivo|apple pay|formas de pago)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'payment_ebt', resolvedByAi: true, detectedLang }
  }
  if (toolsUsed.includes('search_menu_item_price') || /\b(precio|cuanto cuesta|how much|cost|menu|taco|burrito|mulita|quesadilla|torta|plato|sope|nachos|horchata|jamaica|champurrado|carnes)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'menu_prices', resolvedByAi: true, detectedLang }
  }
  if (/\b(drive thru|drive-thru|direccion|ubicacion|donde estan|calles|address|location)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'location_drivethru', resolvedByAi: true, detectedLang }
  }
  if (
    toolsUsed.includes('get_store_hours_and_status') ||
    /\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|thanksgiving|accion de gracias|navidad|nochebuena|christmas|ano nuevo|new year|viernes santo|good friday|black friday|festivo|festivos|holiday|holidays)\b/i.test(
      norm
    )
  ) {
    return { callerCategory: 'customer', primaryIntent: 'hours', resolvedByAi: true, detectedLang }
  }

  return {
    callerCategory: 'customer',
    primaryIntent: callbackCreated ? 'complaint_missing_item' : 'general',
    resolvedByAi: !callbackCreated,
    detectedLang
  }
}

/**
 * Procesa un turno de conversación telefónica (tanto para llamadas reales de Twilio como para el Simulador Web).
 * Consulta herramientas en tiempo real, actualiza la bitácora en `phone_calls` y devuelve el texto listo para hablar con voz `Kore`.
 */
export async function processPhoneAgentTurn(params: {
  callSid: string
  storeId: number
  userText: string
  source?: 'twilio' | 'simulator'
  callerNumber?: string | null
  toNumber?: string | null
  forwardedFrom?: string | null
  preferredLang?: PhoneLang
  deferDbFlush?: boolean
}): Promise<{
  callId: string
  replyText: string
  language: PhoneLang
  voiceId: VoiceId
  primaryIntent: string
  toolsUsed: string[]
  callbackCreated: any | null
  shouldTransferToPhone: string | null
  shouldHangup: boolean
  transcript: TranscriptEntry[]
  storeContext: Awaited<ReturnType<typeof getStorePhoneContext>>
  flushDbPromise?: Promise<void>
}> {
  const {
    callSid,
    storeId,
    userText,
    source = 'simulator',
    callerNumber = null,
    toNumber = null,
    forwardedFrom = null,
    preferredLang,
    deferDbFlush = false
  } = params

  const turnStartedAt = Date.now()
  const turnBudgetMs = source === 'twilio' ? 11200 : 12800
  const turnDeadline = turnStartedAt + turnBudgetMs

  // Ejecutar TODAS las lecturas iniciales en paralelo (incluyendo pool de llaves Gemini y menú pre-compilado en caché SWR)
  const [ctx, existingCallRes, menuEntry, allActiveStores] = await Promise.all([
    getStorePhoneContext(storeId),
    supabaseAdmin.from('phone_calls').select('*').eq('call_sid', callSid).maybeSingle(),
    loadStoreMenuEntry(storeId),
    loadAllActiveStoresDirectory(),
    getGeminiKeyPoolWithRemote()
  ])
  const liveMenuItems = menuEntry.items

  const { store, config, scheduleEval, knowledgeBase, onlineOrderUrl } = ctx
  const voiceId: VoiceId = resolvePhoneFemaleVoice(config.voice_id)

  // 1. Obtener o iniciar en paralelo la creación del registro en `phone_calls` (sin bloquear el arranque de Gemini)
  const businessDate = getCaliforniaBusinessDate()
  const shift = getCaliforniaShift()
  const defaultCallLang: PhoneLang = (preferredLang || config.default_language || 'es') as PhoneLang

  let callRecord: any = existingCallRes.data
  let ensureCallRecordPromise: Promise<any> | null = null

  if (!callRecord) {
    const initialGreeting = buildInitialGreeting(
      store.name,
      defaultCallLang,
      config.custom_greeting_es,
      config.custom_greeting_en,
      { scheduleEval }
    )
    const initialTranscript: TranscriptEntry[] = [
      {
        role: 'assistant',
        text: initialGreeting,
        timestamp: new Date().toISOString()
      }
    ]
    ensureCallRecordPromise = (async () => {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('phone_calls')
        .upsert(
          {
            call_sid: callSid,
            store_id: store.id,
            source,
            caller_number: callerNumber,
            to_number: toNumber,
            forwarded_from: forwardedFrom,
            language: defaultCallLang,
            status: 'in_progress',
            turns_count: 0,
            transcript: initialTranscript,
            business_date: businessDate,
            shift
          },
          { onConflict: 'call_sid' }
        )
        .select()
        .single()
      if (createErr) throw createErr
      callRecord = created
      return created
    })()
  }

  const ensureCallRecord = async () => {
    if (callRecord) return callRecord
    if (ensureCallRecordPromise) return await ensureCallRecordPromise
    throw new Error('No se pudo inicializar el registro de la llamada')
  }

  const seedTranscript: TranscriptEntry[] = callRecord
    ? Array.isArray(callRecord.transcript)
      ? [...callRecord.transcript]
      : []
    : [
        {
          role: 'assistant',
          text: buildInitialGreeting(store.name, defaultCallLang, config.custom_greeting_es, config.custom_greeting_en, {
            scheduleEval
          }),
          timestamp: new Date().toISOString()
        }
      ]

  const transcript: TranscriptEntry[] = seedTranscript
  transcript.push({
    role: 'user',
    text: userText,
    timestamp: new Date().toISOString()
  })

  // Idioma de la llamada: el que ya venía en la bitácora (persistido turno a turno) o el default de la tienda.
  const callLang: PhoneLang = callRecord?.language === 'en' ? 'en' : callRecord?.language === 'es' ? 'es' : defaultCallLang
  const normalizedUserForMatch = normalizePhoneSttTranscript(userText)
  // Detectar si el cliente pidió o habló claramente en otro idioma evitando falsos flips en frases cortas mixtas
  const turnLangGuess: PhoneLang = detectCallerLanguageSwitch(userText, preferredLang || callLang)

  // Contexto combinado con el último turno de usuario si hace repregunta corta ("¿y qué lleva?", "¿y en súper?", "¿y para 65?")
  const prevUserTexts = transcript
    .slice(0, -1)
    .filter((t) => t.role === 'user')
    .slice(-2)
    .map((t) => normalizePhoneSttTranscript(t.text))
  const combinedMenuQuery =
    normalizedUserForMatch.split(/\s+/).length <= 7 && prevUserTexts.length > 0
      ? `${prevUserTexts[prevUserTexts.length - 1]} ${normalizedUserForMatch}`
      : normalizedUserForMatch
  const preFetchedMenu = rankMenuItemsForPrompt(liveMenuItems, combinedMenuQuery, 12)

  const normCombinedForScope = normalizeSearchText(`${prevUserTexts.join(' ')} ${normalizedUserForMatch}`)
  const wantsHolidayContext =
    Boolean(scheduleEval.isSpecialHolidaySchedule) ||
    /\b(festiv|holiday|navidad|nochebuena|christmas|thanksgiving|accion de gracias|black friday|fin de ano|ano nuevo|new year|viernes santo|good friday|pascua|easter|cinco de mayo|madres|mothers|julio|july|labor|memorial|septiembre|halloween|guadalupe|especial)\b/i.test(
      normCombinedForScope
    )
  const wantsMultiStoreContext =
    /\b(otra|otras|sucursal|ubicacion|locacion|tienda|cerca|ciudad|zonas?|east la|este de los angeles|south la|sur de los angeles|downtown|sgv|san gabriel|orange|inland|drive thru|drive-thru|ventanilla|cierra mas|abre mas|todas|cuantas|covina|azusa|broadway|central|slauson|hollywood|santa ana|la puente|huntington|norwalk|bell|lynwood|south gate|downey|rialto)\b/i.test(
      normCombinedForScope
    )
  const wantsMenuCatalogContext =
    preFetchedMenu.length > 0 ||
    /\b(precio|precios|cuesta|cuanto|menu|comer|platillo|taco|burrito|mulita|quesadilla|torta|plato|sope|nacho|bebida|agua|soda|coca|sprite|fanta|champurrado|cafe|coffee|flan|cheesecake|postre|desayuno|huevo|carne|asada|pastor|pollo|lengua|cabeza|buche|chorizo|carnitas|queso|crema|guacamole|ingredient|lleva|diferencia|regular|super|vegetar|alerg|frijol|arroz|oz|onza|galon)\b/i.test(
      normCombinedForScope
    )

  // 2. Construir reglas KB evitando duplicar las 4 áreas ya inyectadas de forma canónica (salvo overrides específicos de sucursal)
  const kbFiltered = knowledgeBase.filter((rule: any) => {
    if (rule.store_id) return true
    const cat = String(rule.category || '').toLowerCase()
    if (cat === 'catering' && /fiesta platter/i.test(String(rule.title || ''))) return false
    return true
  })
  const kbFormatted = kbFiltered
    .map((rule: any, idx: number) => {
      const ruleText =
        turnLangGuess === 'en' && rule.answer_en && String(rule.answer_en).trim()
          ? String(rule.answer_en).trim()
          : String(rule.answer_es || '').trim()
      return `${idx + 1}. [${rule.category.toUpperCase()}${rule.store_id ? ` - SOLO ${store.name}` : ' - GLOBAL'}] ${rule.title}: ${ruleText}`
    })
    .join('\n')

  const hadPriorCallbackInCall =
    callRecord?.status === 'callback_requested' ||
    callRecord?.status === 'transferred' ||
    (Array.isArray(callRecord?.transcript) &&
      callRecord.transcript.some(
        (t: any) => t?.role === 'tool' && t?.toolName === 'create_manager_callback' && String(t?.text || '').includes('"success":true')
      ))

  // Fecha calendario exacta en California (para no confundir hoy/mañana con festivos de fechas futuras)
  const ptNow = getPacificDateParts()
  const [calY, calM, calD] = ptNow.dateStr.split('-').map(Number)
  const tomorrowUtc = new Date(Date.UTC(calY, calM - 1, calD + 1))
  const tomorrowDateStr = tomorrowUtc.toISOString().slice(0, 10)
  const tomorrowDow = (ptNow.dayOfWeek + 1) % 7
  const todayDayLabelEs = DAY_NAMES_ES[ptNow.dayOfWeek]
  const tomorrowDayLabelEs = DAY_NAMES_ES[tomorrowDow]

  // Días festivos próximos (anclado al día calendario en California ptNow.dateStr, límite exacto 365 días para incluir las 7 fechas oficiales)
  const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
    storeId: store.id,
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: ptNow.dateStr,
    daysAhead: 365
  })
  const todayHoliday = upcomingHolidays.find((h) => h.event_date === ptNow.dateStr) || null
  const tomorrowHoliday = upcomingHolidays.find((h) => h.event_date === tomorrowDateStr) || null
  const todayHolName = todayHoliday ? (turnLangGuess === 'en' ? todayHoliday.holiday_name_en : todayHoliday.holiday_name_es) : ''
  const tomHolName = tomorrowHoliday ? (turnLangGuess === 'en' ? tomorrowHoliday.holiday_name_en : tomorrowHoliday.holiday_name_es) : ''
  const calendarDateLine = `- Fecha calendario actual en California: HOY es ${todayDayLabelEs} ${ptNow.dateStr} (${todayHoliday ? `SÍ es festivo: ${todayHolName}` : 'día normal SIN horario festivo'}) | MAÑANA es ${tomorrowDayLabelEs} ${tomorrowDateStr} (${tomorrowHoliday ? `SÍ es festivo: ${tomHolName}` : 'día normal SIN horario festivo; aplica horario semanal regular'}).`

  const holidaysContextLine = wantsHolidayContext
    ? upcomingHolidays.length > 0
      ? `- Horarios Especiales / 7 Fechas Oficiales Festivas de ${store.name}: ` +
        upcomingHolidays
          .slice(0, 7)
          .map((h) => {
            const label = turnLangGuess === 'en' ? h.holiday_name_en : h.holiday_name_es
            const relTag =
              h.event_date === ptNow.dateStr
                ? ' [HOY]'
                : h.event_date === tomorrowDateStr
                  ? ' [MAÑANA]'
                  : ' [FUTURA]'
            if (h.is_closed) {
              return `${h.event_date} (${label}): CERRADO TODO EL DÍA${relTag}`
            }
            const note = h.is_early_close_only
              ? ' [cierre temprano]'
              : h.is_late_open_only
                ? ' [apertura tarde]'
                : ' [horario especial]'
            return `${h.event_date} (${label}): ${formatTime12h(h.effective_open, turnLangGuess)} a ${formatTime12h(h.effective_close, turnLangGuess)}${note}${relTag}`
          })
          .join(' | ') +
        `\n  (Regla obligatoria si preguntan por festivos en general: menciona las 3 categorías completas — Cerrado todo el día: Viernes Santo y Navidad 25 dic; Cierre temprano 4:00 PM: Thanksgiving, Nochebuena 24 dic y Fin de Año 31 dic; Apertura tarde 11:00 AM: Año Nuevo 1 ene y Viernes después de Thanksgiving/Black Friday. Todos los demás festivos —Super Bowl, Pascua, Cinco de Mayo, Día de las Madres, 4 de Julio, Labor Day, 15/16 Sep— operan en horario regular).`
      : `- Horarios Especiales: aplica el horario semanal regular.`
    : ''

  // Catálogo en vivo compilado 1 sola vez en caché SWR e inyectado únicamente cuando el turno toca menú/precios/comida/bebidas
  const menuCatalogSummary = wantsMenuCatalogContext
    ? turnLangGuess === 'en'
      ? menuEntry.compactCatalogEn
      : menuEntry.compactCatalogEs
    : ''

  const menuPreContext =
    preFetchedMenu.length > 0
      ? `\nCOINCIDENCIAS DEL MENÚ PARA ESTA PREGUNTA:\n` +
        preFetchedMenu
          .map((m) => {
            const desc = String(m.description || '').replace(/\s+/g, ' ').trim()
            return `- ${m.name} (${m.category}): ${m.priceFormatted}${desc ? ` — ${desc}` : ''}`
          })
          .join('\n')
      : ''

  const guestMatch = combinedMenuQuery.match(/\b([1-9]\d{0,2})\s*(?:personas?|invitados?|gente|people|guests?|adultos?|adults?)\b/i)
  const detectedGuestCount = guestMatch ? Math.min(500, Math.max(1, Number(guestMatch[1]))) : null
  const wantsFiestaContext =
    detectedGuestCount !== null ||
    /\b(charola|charolas|fiesta\s*platter|party\s*tray|catering|taquiza|banquete)\b/i.test(normCombinedForScope)
  const platterInfo = recommendFiestaPlatters(detectedGuestCount)
  const platterPreContext = wantsFiestaContext
    ? `\nCHAROLAS FIESTA PLATTER OFICIALES (orden exclusivo en línea en tacosgavilan.com con mínimo 1 hora de anticipación; carnes: Carne Asada, Pollo o Al Pastor; aguas frescas: Horchata, Jamaica, Piña o Tamarindo; incluye arroz, frijol, tortillas, salsas, verdura y desechables):\n` +
      platterInfo.packages
        .map(
          (p) =>
            `- ${p.labelEs}: $${p.price.toFixed(2)} (${p.meatLbs} lbs carne, ${p.riceBeansTrayEs}, ${p.cornTortillasDozens} doc maíz o ${p.flourTortillasDozens} harina, ${p.aguasGallons} gal agua)`
        )
        .join('\n') +
      (detectedGuestCount
        ? `\n  -> CÁLCULO EXACTO PARA ${detectedGuestCount} PERSONAS (RESPONDE DIRECTO SIN LLAMAR HERRAMIENTAS): ${turnLangGuess === 'en' ? platterInfo.recommendationEn : platterInfo.recommendationEs}`
        : '')
    : ''

  const atTimePromptEs = (formatted12h: string) =>
    /^1:/i.test(formatted12h.trim()) ? `a la ${formatted12h}` : `a las ${formatted12h}`

  // Frase de cierre correcta: en la madrugada (turno nocturno del día anterior) se dice "cerramos hoy a las 3:00 AM",
  // y en días festivos con horario especial se menciona la festividad.
  const closingPhraseEs = scheduleEval.isAfterMidnightSpillover
    ? `cerramos hoy ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
    : scheduleEval.isSpecialHolidaySchedule && scheduleEval.specialHolidayName
      ? `hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} por ${scheduleEval.specialHolidayName} cerramos en horario especial ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
      : `hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos ${atTimePromptEs(scheduleEval.todayCloseFormattedEs)}`
  const hoursExampleEs = scheduleEval.isOpenNow
    ? store.has_drive_thru
      ? `"En este momento estamos abiertos aquí en la sucursal ${store.name}, contamos con servicio de Drive-Thru y ${closingPhraseEs}. ¿Te puedo ayudar con algo más?"`
      : `"En este momento estamos abiertos aquí en la sucursal ${store.name} y ${closingPhraseEs}; en esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar."`
    : `Usa exactamente el "Estado actual en vivo" de arriba (la sucursal está CERRADA en este momento) y menciona si hay Drive-Thru o no en la misma oración.`

  const parkingNotesBlock = [
    config.parking_notes_es ? `- Notas de acceso/estacionamiento (ES): ${config.parking_notes_es}` : '',
    config.parking_notes_en ? `- Parking / access notes (EN): ${config.parking_notes_en}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const priorCallbackNote = hadPriorCallbackInCall
    ? `\nESTADO DE ESTA LLAMADA: En un turno previo de esta misma llamada YA quedó registrado el recado prioritario para el gerente de ${store.name}. NO vuelvas a pedir nombre ni teléfono; solo llama \`create_manager_callback\` si la persona desea agregar información nueva al recado.`
    : ''

  const callbackOutcomeInstruction = scheduleEval.isOpenNow
    ? 'confírmale con calidez que el gerente en turno en la sucursal ya recibió la alerta prioritaria en su pantalla para devolverle la llamada enseguida (por política de Tacos Gavilan NUNCA desviamos llamadas a teléfonos personales).'
    : 'aclárale con transparencia que como la sucursal está cerrada en este momento, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos.'

  const spokenStoreAddress = formatStoreAddressForAgent(store.address, turnLangGuess, { includeZip: false })
  const storeZipCode = extractZipCodeFromAddress(store.address)
  const allSpecialForCross = (ctx as any).allSpecialHours || ctx.specialHours || []
  const regionalMatchIds = Object.entries(REGION_STORE_IDS).find(([alias]) => normCombinedForScope.includes(alias))?.[1] || null
  const crossStoreComparison =
    wantsMultiStoreContext && allActiveStores.length > 0
      ? buildCrossStoreHoursComparison(allActiveStores, turnLangGuess, allSpecialForCross)
      : ''
  const regionalPreContext =
    regionalMatchIds && allActiveStores.length > 0
      ? `\nCOINCIDENCIAS REGIONALES PRE-CALCULADAS (RESPONDE DIRECTO SIN TOOL): ` +
        allActiveStores
          .filter((s) => regionalMatchIds.includes(Number(s.id)))
          .map((s) => `#${s.id} ${s.name} (${formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false })}, Tel: ${s.phone}, ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'})`)
          .join(' | ')
      : ''
  const storesDirectoryBlock =
    wantsMultiStoreContext && allActiveStores.length > 0
      ? `\nDIRECTORIO OFICIAL VERIFICADO DE LAS 15 SUCURSALES (USA ESTOS DATOS REALES; NUNCA INVENTES CALLES):\n` +
        allActiveStores
          .map(
            (s) =>
              `- #${s.id} ${s.name}: ${formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false })} | Tel: ${s.phone} | ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'} | Horario: ${turnLangGuess === 'en' ? s.compactHoursEn : s.compactHoursEs}`
          )
          .join('\n') +
        (crossStoreComparison ? `\n\n${crossStoreComparison}` : '') +
        regionalPreContext
      : ''

  const systemInstruction = `Eres la recepcionista telefónica virtual oficial de **Tacos Gavilan** en la sucursal **${store.name}** (Sucursal #${store.id}).
El nombre oficial de la marca es estrictamente **Tacos Gavilan** (NUNCA digas "Tacos El Gavilan", ni escribas "(LA)" junto a Central o Broadway).

DATOS EN VIVO DE ESTA SUCURSAL (${store.name}):
${calendarDateLine}
- Estado actual en vivo (Zona Horaria Pacífico): ${turnLangGuess === 'en' ? scheduleEval.statusMessageEn : scheduleEval.statusMessageEs}
- Horario de la semana: ${turnLangGuess === 'en' ? scheduleEval.weeklySummaryEn : scheduleEval.weeklySummaryEs}
${holidaysContextLine ? holidaysContextLine + '\n' : ''}- Dirección exacta para decir por teléfono (SIN abreviaturas): ${spokenStoreAddress}${storeZipCode ? ` (Código postal solo si lo piden: ${storeZipCode})` : ''}
- Teléfono: ${store.phone}
- Drive-Thru: ${store.has_drive_thru ? 'Esta sucursal SÍ tiene Drive-Thru.' : 'Esta sucursal NO tiene Drive-Thru (solo Comedor y Para Llevar).'} Las únicas 6 sucursales con Drive-Thru son Central, West Covina, La Puente, Norwalk, Lynwood y South Gate.
- Pagos / EBT: ${config.accepts_ebt ? 'Aceptamos EBT CalFresh RMP en caja, efectivo, tarjetas y Apple Pay/Google Pay.' : 'NO aceptamos EBT CalFresh aquí; sí efectivo, tarjetas y Apple Pay/Google Pay.'}
- Web / Ordenar en línea: tacosgavilan.com (NUNCA dictes URLs largas ni IDs numéricos)${source === 'twilio' && callerNumber ? `\n- Caller ID Twilio entrante: ${callerNumber} (solo úsalo si piden marcar a este mismo número)` : ''}
${parkingNotesBlock}${priorCallbackNote}
${storesDirectoryBlock}

${menuCatalogSummary}
${menuPreContext}
${platterPreContext}

BASE DE CONOCIMIENTO OFICIAL EDITABLE (REGLAS VIGENTES, TIENEN PRIORIDAD SOBRE CUALQUIER EJEMPLO):
${kbFormatted}

MAPA DE EJECUCIÓN DE ESCENARIOS Y REGLAS ESTRICTAS DE DIÁLOGO:
0. **CERO DATOS INVENTADOS Y PRONUNCIACIÓN VIAL NATURAL (REGLA CRÍTICA)**:
   - Usa ÚNICAMENTE la información de este contexto. NUNCA inventes platillos, carnes, ingredientes, precios, promociones, horarios de entrevistas ni procesos que no aparezcan arriba. Si no tienes el dato, dilo con honestidad, ofrece tacosgavilan.com o dejar recado al gerente, y llama a \`flag_unanswered_question\`.
   - Al decir cualquier domicilio o calle, dilo SIEMPRE completo y sin abreviaturas (ej. \`101 South Azusa Avenue, en West Covina, California\`, \`115 East Baseline Road\`, \`1258 East Seventeenth Street\`, \`3220 East Imperial Highway\`, \`Boulevard\`). NUNCA escribas \`S.\`, \`E.\`, \`N.\`, \`W.\`, \`Ave.\`, \`Rd.\`, \`Blvd.\`, \`St.\`, \`Hwy.\` ni \`CA\`, y no menciones el código postal a menos que el cliente lo pida.
1. **CERO MULETILLAS Y CERO REPETICIÓN DE "¡SÍ!"**:
   - **PROHIBIDO** empezar tus respuestas con "¡Sí!", "¡Claro que sí!", "¡Claro!", "¡Por supuesto!", "¡Hola!" o "Yes!".
   - Cuando el cliente hace varias preguntas a la vez (ej. "¿Están abiertos, a qué hora cierran y tienen Drive-Thru?"), **NUNCA** digas "Sí" dos veces. Integra todo en una sola oración fluida. Ejemplo para este momento: ${hoursExampleEs}
2. **Menú, STT Fonético, Bebidas, Quesos, Regular vs Super y No Manejados**:
   - Si el precio/ingrediente YA está en tu contexto, **RESPONDE DIRECTO SIN LLAMAR HERRAMIENTAS**. Ante posibles errores de micrófono sobre un tema reciente (ej. "torta Corona" tras hablar de "torta cubana", "salad burrito" = asada, "muleta" = mulita, "driver" = Drive-Thru), interpreta con naturalidad el platillo correcto.
   - Medidas reales de bebidas y quesos aparecen en el CATÁLOGO y Base de Conocimiento (ej. Champurrado y Café individual = **vaso térmico de 16 onzas**, Caja Champurrado = **96 onzas** [6×16 oz / 8 vasitos de 12 oz]; Aguas Frescas: **Horchata, Jamaica, Piña y Tamarindo** en 22 oz / 32 oz / 128 oz; Tortas = **Queso Fresco**, NUNCA crema ni queso fundido). Diferencia Regular vs Super: Quesadilla/Mulita Super añade guacamole y crema; Burrito Super añade queso Monterey Jack, guacamole y crema; Torta Cubana = milanesa de res, jamón y salchicha.
   - No vendemos menudo, birria, pozole, suadero, tripa (descontinuada) ni alcohol/cerveza; ante estos o temas ajenos (música, deportes, chistes), declina con amabilidad y **NUNCA** llames \`flag_unanswered_question\`.
3. **Charolas Fiesta Platters**:
   - Usa la sección CHAROLAS de tu contexto (si ya calculó \`CÁLCULO EXACTO\` para >40 personas, responde directo sin tool call).
4. **Pedidos por Teléfono**:
   - Explica amablemente que por políticas de Tacos Gavilan no tomamos pedidos por teléfono, e invítalo a ordenar en línea en tacosgavilan.com para pasar a recoger${store.has_drive_thru ? ' o pedir directamente en caja o por el Drive-Thru' : ' o pedir directamente en caja'}.
5. **Repartidores de Delivery (DoorDash, Uber Eats, Grubhub)**:
   - ${store.has_drive_thru ? `En esta sucursal (${store.name}), mientras el comedor esté abierto recogen en el mostrador; si el comedor ya cerró pero el Drive-Thru sigue abierto, pueden recoger por la ventanilla del Drive-Thru mostrando el nombre y código de la orden. Si la sucursal ya está totalmente cerrada, díselo con claridad.` : `En esta sucursal (${store.name}) NO tenemos Drive-Thru, por lo que todas las órdenes de DoorDash y Uber Eats se recogen en el mostrador dentro del horario de la tienda (usa el "Estado actual en vivo" de arriba). Si tiene algún inconveniente, ofrécele avisar en vivo al gerente.`}
   - Si quien llama es un CLIENTE con un problema en su pedido de DoorDash/Uber Eats (faltantes, cobro, orden equivocada), trátalo como reclamo (regla 6), no como repartidor.
6. **Reclamos de Órdenes, Cobros, Objetos Olvidados, Empleados (Retardos/Faltas), Proveedores o "quiero hablar con el gerente"**:
   - **ACCIÓN OBLIGATORIA CON HERRAMIENTA**: Si la persona YA dio su nombre y teléfono real de 10 dígitos (o en llamada Twilio pidió marcarle a su Caller ID), **EJECUTA PRIMERO \`create_manager_callback\`** con EXACTAMENTE esos datos antes de responder. **PROHIBIDO** decir en texto que "envías / dejaste / registraste una alerta o recado" sin haber invocado \`create_manager_callback\`.
   - Después de ejecutar \`create_manager_callback\`, aclara amablemente que por política estricta de Tacos Gavilan no desviamos llamadas a celulares personales de los gerentes y ${callbackOutcomeInstruction}
   - Si aún NO ha dado su nombre o teléfono real de 10 dígitos, aclara que no transferimos a celulares personales y pídeselos con empatía en una sola frase corta ANTES de intentar registrar el recado.
   - Si ya enviaste la alerta en esta misma llamada, no la dupliques salvo que agregue datos nuevos: confirma que el gerente ya la tiene en su pantalla.
7. **Idioma y Agilidad Telefónica (REGLA CRÍTICA DE VELOCIDAD)**:
   - Idioma detectado del cliente: ${turnLangGuess === 'en' ? 'Inglés' : 'Español'}. Responde SIEMPRE en el mismo idioma de su último mensaje (español mexicano cálido o inglés natural).
   - Sé concisa y directa: **12 a 28 palabras** (1–2 oraciones ágiles). Excepciones autorizadas hasta **65–75 palabras**: (a) cuando pidan el **calendario de días festivos especiales en general**, DEBES resumir las **7 fechas reales** (cerrados Viernes Santo y Navidad 25 dic; cierre temprano 4 PM en Thanksgiving, Nochebuena 24 dic y Fin de Año 31 dic; apertura tarde 11 AM en Año Nuevo 1 ene y Black Friday); o (b) direcciones de varias sucursales a la vez. Sin comerciales de relleno, viñetas, emojis ni markdown.
8. **Filtro Anti-Spam / Ventas Comerciales**:
   - Si llaman para vender servicios comerciales (SEO/Google, préstamos, paneles solares, garantías), declina con cortesía en una oración breve indicando que en sucursal no recibimos ofertas comerciales y NO ejecutes \`create_manager_callback\`.`

  // Convertir historial de transcripción a contents de Gemini excluyendo fallbacks de error previos para no contaminar el modelo
  const historyEntries = transcript
    .filter(
      (t) =>
        (t.role === 'user' || t.role === 'assistant') &&
        !/problema t[eé]cnico moment[aá]neo|brief technical issue/i.test(String(t.text || ''))
    )
    .slice(-10)
  while (historyEntries.length > 0 && historyEntries[0].role !== 'user') historyEntries.shift()
  const contents: any[] = historyEntries.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }]
  }))

  const toolsUsed: string[] = []
  const normUser = normalizeSearchText(userText)
  const isCallbackOrOrderScenario =
    /\b(soy empleado|llegar tarde|mi turno|falto|faltaron|incompleta|ticket|queja|reembolso|olvide|perdi|hacer un pedido|pedido por telefono|ordenar por telefono|place an order|order over the phone|uber|doordash|grubhub|repartidor|contratando|empleo|vacantes|trabajo)\b/i.test(
      normUser
    )

  // Telemetría de herramientas consultadas implícitamente (los datos ya van inyectados en el contexto)
  if (
    !isCallbackOrOrderScenario &&
    preFetchedMenu.length > 0 &&
    /\b(precio|cuesta|cuanto|how much|price|cost|taco|burrito|mulita|quesadilla|torta|plato|sope|nachos|horchata|jamaica|champurrado|agua)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('search_menu_item_price')
  }
  if (!isCallbackOrOrderScenario && (/\b(charola|charolas|fiesta platter|party tray|catering|invitados)\b/i.test(normUser) || /\b([1-9]\d{1,2})\s+(personas|people)\b/i.test(normUser))) {
    toolsUsed.push('get_fiesta_platter_packages')
  }
  if (
    !isCallbackOrOrderScenario &&
    /\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|drive thru|drive-thru|direccion|address|thanksgiving|accion de gracias|navidad|nochebuena|christmas|ano nuevo|new year|viernes santo|good friday|black friday|festivo|festivos|holiday|holidays)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('get_store_hours_and_status')
  }

  let callbackCreated: any | null = null
  let callbackWasNew = false
  let unansweredFlagged: string | null = null
  let replyText = ''
  let geminiFailed = false
  const VALID_URGENCY = new Set(['high', 'critical', 'normal'])
  const VALID_REASON = new Set(['missing_or_wrong_item', 'lost_item', 'employee_callout', 'vendor_arrival', 'billing_refund', 'other'])

  const executeTool = async (toolName: string, toolArgs: any): Promise<any> => {
    if (toolName === 'get_store_hours_and_status') {
      return {
        address: formatStoreAddressForAgent(store.address, turnLangGuess, { includeZip: false }),
        zip_code: extractZipCodeFromAddress(store.address),
        phone: store.phone,
        hasDriveThru: store.has_drive_thru,
        acceptsEbt: config.accepts_ebt,
        ...scheduleEval,
        upcomingHolidays: upcomingHolidays.slice(0, 7)
      }
    }
    if (toolName === 'search_menu_item_price') {
      const q = String(toolArgs?.query || '')
      const matches = rankMenuItemsForPrompt(liveMenuItems, q, 8)
      return { storeName: store.name, query: q, matchesFound: matches.length, items: matches }
    }
    if (toolName === 'get_fiesta_platter_packages') {
      const guestCount = Math.round(Number(toolArgs?.guest_count))
      return recommendFiestaPlatters(Number.isFinite(guestCount) && guestCount > 0 && guestCount <= 500 ? guestCount : null)
    }
    if (toolName === 'find_other_stores') {
      const [activeStores, allSpecialHours] = await Promise.all([
        allActiveStores.length > 0 ? Promise.resolve(allActiveStores) : loadAllActiveStoresDirectory(),
        loadAllSpecialHoursCached()
      ])
      const filterNorm = normalizeSearchText(toolArgs?.search_city_or_filter || '')
      const matchedRegionIds = Object.entries(REGION_STORE_IDS).find(([alias]) => filterNorm.includes(alias))?.[1] || null
      const isScheduleComparisonFilter =
        !filterNorm ||
        /^(all|todas|todos|sucursales|stores|horario|horarios|hours)$/.test(filterNorm) ||
        (/\b(tarde|temprano|late|latest|early|earliest|cierra|cierran|abre|abren|domingo|lunes|martes|miercoles|jueves|viernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday|semana|weekend)\b/.test(
          filterNorm
        ) &&
          !matchedRegionIds)

      const matchedStores = activeStores.filter((s: any) => {
        if (filterNorm.includes('drive')) return Boolean(s.has_drive_thru)
        if (isScheduleComparisonFilter) return true
        if (matchedRegionIds) return matchedRegionIds.includes(Number(s.id))
        return normalizeSearchText(`${s.name} ${cleanPhoneStoreName(s.name)} ${s.address}`).includes(filterNorm)
      })
      const targetStores = matchedStores.length > 0 ? matchedStores : activeStores
      const comparisonSummary = buildCrossStoreHoursComparison(activeStores, turnLangGuess, allSpecialHours || [])

      const filtered = targetStores.map((s: any) => {
        const ev = evaluateStoreSchedulePure({
          storeId: Number(s.id),
          storeName: s.name,
          weeklyHours: s.weekly_hours,
          specialHours: allSpecialHours || []
        })
        return {
          id: s.id,
          name: cleanPhoneStoreName(s.name),
          address: formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false }),
          zip_code: extractZipCodeFromAddress(s.address),
          phone: s.phone,
          has_drive_thru: s.has_drive_thru,
          isOpenNow: ev.isOpenNow,
          activeDayEs: ev.activeDayLabelEs,
          activeDayEn: ev.activeDayLabelEn,
          todayHoursEs: ev.todayOpen === 'CLOSED' ? 'Cerrado hoy' : `${ev.todayOpenFormattedEs} - ${ev.todayCloseFormattedEs}`,
          todayHoursEn: ev.todayOpen === 'CLOSED' ? 'Closed today' : `${ev.todayOpenFormattedEn} - ${ev.todayCloseFormattedEn}`,
          weeklyHoursCompactEs: buildCompactWeeklyHours(s.weekly_hours, 'es'),
          weeklyHoursCompactEn: buildCompactWeeklyHours(s.weekly_hours, 'en'),
          weeklySummaryEs: ev.weeklySummaryEs,
          weeklySummaryEn: ev.weeklySummaryEn,
          statusMessageEs: ev.statusMessageEs,
          statusMessageEn: ev.statusMessageEn
        }
      })
      return { comparisonSummary, stores: filtered }
    }
    if (toolName === 'create_manager_callback') {
      const ensuredCall = await ensureCallRecord()
      const reasonSummary = String(toolArgs?.reason_summary || userText).trim()
      const argPhoneRaw = String(toolArgs?.caller_phone || '').trim()
      const allowDev555 = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
      const parsedArg = argPhoneRaw.toUpperCase() === 'CALLER_ID' ? { valid: false, normalized: null, tenDigits: null } : normalizeUsPhoneE164(argPhoneRaw)
      const parsedCaller = source === 'twilio' && callerNumber ? normalizeUsPhoneE164(callerNumber) : { valid: false, normalized: null, tenDigits: null }
      const argIsClean = parsedArg.valid && parsedArg.tenDigits && !isFictitiousNanpPhone(parsedArg.tenDigits, allowDev555)
      const callerIsClean = parsedCaller.valid && parsedCaller.tenDigits && !isFictitiousNanpPhone(parsedCaller.tenDigits, false)
      const cleanCallbackPhone = argIsClean
        ? parsedArg.normalized!
        : callerIsClean
          ? parsedCaller.normalized!
          : ''

      // Anti-duplicados: omitir SELECT a DB si la llamada no ha tenido recados aún en memoria
      const existingPending =
        callbackCreated ||
        (hadPriorCallbackInCall
          ? (
              await supabaseAdmin
                .from('phone_callback_requests')
                .select('*')
                .eq('call_id', ensuredCall.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            ).data
          : null)

      if (existingPending) {
        const prevSummary = String(existingPending.reason_summary || '')
        const patch: Record<string, any> = {}
        if (reasonSummary && !prevSummary.includes(reasonSummary)) {
          patch.reason_summary = `${prevSummary} | ${reasonSummary}`.slice(0, 2000)
        }
        if (cleanCallbackPhone && extractPhoneDigits(cleanCallbackPhone).length >= 7) {
          patch.caller_phone = cleanCallbackPhone
        }
        const candidateName = String(toolArgs?.caller_name || '').trim()
        if (candidateName && !/^(cliente|customer|cliente en linea|caller|unknown)$/i.test(normalizeSearchText(candidateName))) {
          patch.caller_name = candidateName
        }
        if (toolArgs?.ticket_or_order_number && String(toolArgs.ticket_or_order_number).trim()) {
          patch.ticket_or_order_number = String(toolArgs.ticket_or_order_number).trim()
        }
        if (String(toolArgs?.urgency || '').toLowerCase() === 'critical') {
          patch.urgency = 'critical'
        }
        if (Object.keys(patch).length > 0) {
          const { data: updatedCb } = await supabaseAdmin
            .from('phone_callback_requests')
            .update(patch)
            .eq('id', existingPending.id)
            .select()
            .maybeSingle()
          callbackCreated = updatedCb || { ...existingPending, ...patch }
        } else {
          callbackCreated = existingPending
        }
        return {
          success: true,
          alreadySent: true,
          callbackId: existingPending.id,
          message: `El gerente de ${store.name} ya tiene la alerta de esta llamada; se actualizó el detalle.`
        }
      }

      // Validación estricta: NUNCA guardar un recado sin teléfono real válido de 10 dígitos
      if (!cleanCallbackPhone) {
        return {
          success: false,
          missingCallerPhone: true,
          message:
            'Aún NO cuentas con un número telefónico real válido de 10 dígitos con código de área. Pídele amablemente su nombre y su número de teléfono de 10 dígitos antes de registrar el recado.'
        }
      }

      const urgency = String(toolArgs?.urgency || 'high').toLowerCase()
      const reasonCategory = String(toolArgs?.reason_category || 'other').toLowerCase()
      callbackCreated = await createManagerCallbackRequest({
        callId: ensuredCall.id,
        storeId: store.id,
        source,
        callerName: String(toolArgs?.caller_name || 'Cliente en línea'),
        callerPhone: cleanCallbackPhone,
        callerType: String(toolArgs?.caller_type || 'customer'),
        urgency: VALID_URGENCY.has(urgency) ? urgency : 'high',
        reasonCategory: VALID_REASON.has(reasonCategory) ? reasonCategory : 'other',
        reasonSummary,
        ticketOrOrderNumber: toolArgs?.ticket_or_order_number ? String(toolArgs.ticket_or_order_number) : null
      })
      callbackWasNew = true
      return {
        success: true,
        storeOpenNow: scheduleEval.isOpenNow,
        willTransferLive: false,
        callbackId: callbackCreated.id,
        message: scheduleEval.isOpenNow
          ? `Alerta enviada en vivo a la pantalla del Manager en la sucursal ${store.name} (sin desviar a teléfonos personales). Confírmale que el gerente se comunicará enseguida desde la tienda.`
          : `Recado prioritario registrado para el Manager de ${store.name}. IMPORTANTE: La sucursal está CERRADA ahora (${scheduleEval.statusMessageEs}); informa al cliente que el gerente le devolverá la llamada al reabrir.`
      }
    }
    if (toolName === 'flag_unanswered_question') {
      const qRaw = String(toolArgs?.question_text || userText).slice(0, 300)
      const isOffTopicTrivia = /\b(chiste|joke|cancion|canta|song|sing|banda|rock|heroes del silencio|futbol|soccer|nfl|nba|clima|weather|presidente|politica)\b/i.test(
        normalizeSearchText(`${userText} ${qRaw}`)
      )
      if (!isOffTopicTrivia) {
        unansweredFlagged = qRaw
      }
      return { recorded: !isOffTopicTrivia }
    }
    return { error: `Herramienta desconocida: ${toolName}` }
  }

  let pinnedModelForTurn: string | null = null
  for (let round = 0; round < 3 && !replyText; round++) {
    let data: any
    try {
      const resGemini = await callGeminiPhoneWithFailover(
        {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools: PHONE_AGENT_TOOLS,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024
          }
        },
        turnDeadline,
        pinnedModelForTurn
      )
      data = resGemini.data
      if (!pinnedModelForTurn && resGemini.usedModel) {
        pinnedModelForTurn = resGemini.usedModel
      }
    } catch (e) {
      console.error('[phone-agent] Gemini no disponible en este turno:', e)
      geminiFailed = true
      break
    }

    const candidateContent = data?.candidates?.[0]?.content
    const parts: any[] = candidateContent?.parts || []
    const fnCallParts = parts.filter((p) => p?.functionCall)

    if (fnCallParts.length === 0) {
      replyText = parts
        .filter((p) => !p?.thought)
        .map((p) => p.text || '')
        .join(' ')
        .replace(/[*#_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      break
    }

    // Gemini puede pedir VARIAS herramientas en paralelo: se ejecutan todas y se responden en el mismo orden
    const responseParts: any[] = []
    for (const fnPart of fnCallParts) {
      const toolName = String(fnPart.functionCall?.name || '')
      const toolArgs = fnPart.functionCall?.args || {}
      toolsUsed.push(toolName)
      let toolResult: any
      try {
        toolResult = await executeTool(toolName, toolArgs)
      } catch (toolErr: any) {
        console.error(`[phone-agent] Error en herramienta ${toolName}:`, toolErr)
        toolResult = { success: false, error: String(toolErr?.message || toolErr).slice(0, 300) }
      }
      transcript.push({
        role: 'tool',
        text: JSON.stringify(toolResult),
        timestamp: new Date().toISOString(),
        toolName
      })
      responseParts.push({ functionResponse: { name: toolName, response: toolResult } })
    }

    contents.push(candidateContent)
    contents.push({ role: 'user', parts: responseParts })
  }

  // Política oficial Tacos Gavilan: cero desvíos a teléfonos personales; escalación vía Alerta Prioritaria en PC de tienda
  const shouldTransferToPhone: string | null = null

  // Blindaje determinista: si un modelo rápido confirmó envío de alerta sin invocar `create_manager_callback`,
  // persistimos el recado con los datos reales dichos por quien llama o evitamos una confirmación falsa si falta el teléfono.
  if (!callbackCreated && !hadPriorCallbackInCall && !geminiFailed && replyText) {
    const store10 = extractPhoneDigits(store.phone).slice(-10)
    const twilio10 = extractPhoneDigits(config.twilio_phone_number).slice(-10)
    const allowDev555 = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
    const guard = inspectMissingCallbackGuard({
      replyText,
      transcript,
      blockedStoreTenDigits: [store10, twilio10],
      source,
      callerNumber,
      allowDev555
    })
    if (guard.claimedSent) {
      if (guard.callerPhone) {
        const inferredForCb = inferCallMetadata(guard.summary || userText, toolsUsed, true)
        const inferredReason =
          inferredForCb.primaryIntent === 'complaint_missing_item'
            ? /\b(cobro|cobraron|reembolso|refund|overcharged|billing)\b/i.test(normalizeSearchText(guard.summary))
              ? 'billing_refund'
              : 'missing_or_wrong_item'
            : inferredForCb.primaryIntent === 'lost_and_found'
              ? 'lost_item'
              : inferredForCb.primaryIntent === 'employee_callout'
                ? 'employee_callout'
                : inferredForCb.primaryIntent === 'vendor_service'
                  ? 'vendor_arrival'
                  : 'other'
        const inferredCallerType =
          inferredForCb.callerCategory === 'employee'
            ? 'employee'
            : inferredForCb.callerCategory === 'vendor'
              ? 'vendor'
              : inferredForCb.callerCategory === 'delivery_driver'
                ? 'delivery_driver'
                : 'customer'
        try {
          const forcedRes = await executeTool('create_manager_callback', {
            caller_name: guard.callerName,
            caller_phone: guard.callerPhone,
            caller_type: inferredCallerType,
            urgency: /\b(emergencia|emergency|intoxic|got sick|cobro doble|overcharged|fraud)\b/i.test(normalizeSearchText(guard.summary)) ? 'critical' : 'high',
            reason_category: inferredReason,
            reason_summary: guard.summary || userText
          })
          toolsUsed.push('create_manager_callback')
          transcript.push({
            role: 'tool',
            text: JSON.stringify(forcedRes),
            timestamp: new Date().toISOString(),
            toolName: 'create_manager_callback'
          })
        } catch (cbErr) {
          console.error('[phone-agent] Error en blindaje de recado obligatorio:', cbErr)
        }
      } else {
        replyText =
          turnLangGuess === 'en'
            ? "By Tacos Gavilan policy we don't transfer calls to managers' personal phones, but I'd gladly send a priority alert to the store manager's screen. Could you give me your name and 10-digit phone number?"
            : 'Por política de Tacos Gavilan no transferimos llamadas a celulares personales, pero con gusto envío una alerta prioritaria a la pantalla del gerente en sucursal. ¿Me compartes tu nombre y número de teléfono de 10 dígitos para que se comunique contigo?'
      }
    }
  }

  if (!replyText) {
    if (callbackCreated) {
      if (!scheduleEval.isOpenNow) {
        replyText =
          turnLangGuess === 'en'
            ? `Since our ${store.name} location is currently closed, your priority message has been saved so the manager can call you back as soon as we reopen. Is there anything else I can help you with?`
            : `Como nuestra sucursal ${store.name} está cerrada en este momento, dejé tu recado prioritario registrado para que el gerente te devuelva la llamada en cuanto abramos. ¿Te puedo ayudar con algo más?`
      } else {
        replyText =
          turnLangGuess === 'en'
            ? `Your message is already on the ${store.name} manager's screen, and they will call you back as soon as possible. Is there anything else I can help you with?`
            : `Tu recado ya está en la pantalla del gerente de ${store.name} y se comunicará contigo lo antes posible. ¿Te puedo ayudar con algo más?`
      }
    } else if (geminiFailed) {
      // Respaldo determinista en memoria si Gemini agotó presupuesto o cuota para no colgar en error genérico
      if (/\b(drive|ventanilla)\b/i.test(normUser) && allActiveStores.length > 0) {
        const dtNames = allActiveStores.filter((s) => s.has_drive_thru).map((s) => s.name)
        replyText =
          turnLangGuess === 'en'
            ? `Our six locations with Drive-Thru are ${dtNames.join(', ')}. Would you like the hours or address for any of them?`
            : `Las seis sucursales con Drive-Thru son ${dtNames.join(', ')}. ¿Te doy el horario o dirección de alguna?`
      } else if (wantsFiestaContext && detectedGuestCount) {
        replyText = turnLangGuess === 'en' ? platterInfo.recommendationEn : platterInfo.recommendationEs
      } else if (preFetchedMenu.length > 0 && /\b(precio|cuesta|cuanto|price|cost|how much)\b/i.test(normUser)) {
        const top = preFetchedMenu.slice(0, 3).map((m) => `${m.name} (${m.priceFormatted})`)
        replyText =
          turnLangGuess === 'en'
            ? `In ${store.name}, ${top.join(', ')}. Can I check anything else?`
            : `En ${store.name}, ${top.join(', ')}. ¿Te ayudo con algo más?`
      } else if (/\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|direccion|ubicacion|address)\b/i.test(normUser)) {
        replyText =
          turnLangGuess === 'en'
            ? `${scheduleEval.statusMessageEn} Our address is ${spokenStoreAddress}.`
            : `${scheduleEval.statusMessageEs} Nuestra dirección es ${spokenStoreAddress}.`
      } else {
        replyText =
          turnLangGuess === 'en'
            ? 'Sorry, I had a brief technical issue. Could you please repeat your question?'
            : 'Disculpa, tuve un problema técnico momentáneo. ¿Me puedes repetir tu pregunta, por favor?'
      }
    } else {
      replyText =
        turnLangGuess === 'en'
          ? `${scheduleEval.statusMessageEn} How else can I help you?`
          : `${scheduleEval.statusMessageEs} ¿Te puedo ayudar con algo más?`
    }
  }

  const meta = inferCallMetadata(normalizedUserForMatch, toolsUsed, Boolean(callbackCreated))

  // Idioma FINAL = idioma real del texto generado (se detecta antes de acentuar topónimos como "Los Ángeles")
  const finalLang: PhoneLang = detectPhoneTextLanguage(replyText, turnLangGuess)
  // Sanitizar muletillas iniciales ("¡Sí!", "¡Claro que sí!", "Hola."), expandir abreviaturas viales y recortar en fin de oración
  replyText = clampPhoneReplyLength(sanitizePhoneReplyText(replyText, finalLang), 620)

  transcript.push({
    role: 'assistant',
    text: replyText,
    timestamp: new Date().toISOString()
  })

  const normEnd = normalizeSearchText(userText)
  const prevAssistantText =
    transcript
      .slice(0, -1)
      .filter((t) => t.role === 'assistant')
      .slice(-1)[0]?.text || ''
  const offeredEnding = /algo m[aá]s|anything else|else i can help/i.test(prevAssistantText)
  const continuesAsking =
    /[?¿]/.test(userText) ||
    /\b(mejor dime|espera|una pregunta|otra pregunta|y cuanto|a que hora|tambien|también|one more|wait|actually)\b/i.test(normEnd)
  const shouldHangup =
    !shouldTransferToPhone &&
    (meta.primaryIntent === 'spam' ||
      (!continuesAsking &&
        (/\b(gracias es todo|eso es todo|solo era eso|seria todo|nada mas|bye|goodbye|thank you that is all|thats all|that will be all|nothing else|no thank you|no thanks|hasta luego|adios|nos vemos)\b/i.test(
          normEnd
        ) ||
          (offeredEnding && /^(?:no\s+)?(?:muchas\s+)?gracias\.?$/i.test(normEnd.trim())))))

  const finalCallRecord = await ensureCallRecord()
  const startedAtMs = finalCallRecord.started_at ? new Date(finalCallRecord.started_at).getTime() : Date.now()
  const durationSeconds = Math.max(5, Math.round((Date.now() - startedAtMs) / 1000))

  // Estado persistente: respetar 'transferred', 'callback_requested' o 'completed' previos
  const wasTransferred = Boolean(shouldTransferToPhone) || finalCallRecord.status === 'transferred'
  const callbackEverRequested = Boolean(callbackCreated) || finalCallRecord.status === 'callback_requested'

  const nextStatus = wasTransferred
    ? 'transferred'
    : callbackEverRequested
      ? 'callback_requested'
      : shouldHangup || finalCallRecord.status === 'completed'
        ? 'completed'
        : 'in_progress'

  const INTENT_PRIORITY: Record<string, number> = {
    employee_callout: 100,
    complaint_missing_item: 95,
    lost_and_found: 90,
    vendor_service: 85,
    delivery_driver: 75,
    fiesta_platters: 65,
    order_by_phone: 60,
    payment_ebt: 50,
    menu_prices: 40,
    location_drivethru: 35,
    hours: 30,
    spam: 25,
    general: 10
  }
  const prevIntent = String(finalCallRecord.primary_intent || 'general')
  const prevPrio = INTENT_PRIORITY[prevIntent] ?? 10
  const nextPrio = INTENT_PRIORITY[meta.primaryIntent] ?? 10
  const resolvedIntent = nextPrio >= prevPrio && meta.primaryIntent !== 'general' ? meta.primaryIntent : prevIntent !== 'general' ? prevIntent : meta.primaryIntent

  // Respaldo: capturar unanswered_question si la IA admite falta de dato oficial de negocio sin haber invocado la herramienta
  if (
    !unansweredFlagged &&
    /\b(no cuento con informaci[oó]n oficial|no tengo ese dato oficial|don't have official information|do not have that policy)\b/i.test(
      replyText
    ) &&
    !/\b(chiste|joke|cancion|song|banda|rock|heroes del silencio|futbol|soccer|nfl|nba|clima|weather|menudo|birria|pozole|suadero|tripa|cerveza)\b/i.test(
      normUser
    )
  ) {
    unansweredFlagged = userText.slice(0, 300)
  }

  const updatePayload: Record<string, any> = {
    language: finalLang,
    caller_category:
      finalCallRecord.caller_category && finalCallRecord.caller_category !== 'customer' && meta.callerCategory === 'customer'
        ? finalCallRecord.caller_category
        : meta.callerCategory,
    primary_intent: resolvedIntent,
    status: nextStatus,
    resolved_by_ai:
      wasTransferred ||
      callbackEverRequested ||
      ['complaint_missing_item', 'lost_and_found', 'employee_callout'].includes(resolvedIntent)
        ? false
        : meta.resolvedByAi,
    duration_seconds: durationSeconds,
    turns_count: Number(finalCallRecord.turns_count || 0) + 1,
    summary: `${userText.slice(0, 120)} -> ${replyText.slice(0, 140)}`,
    transcript
  }

  if (unansweredFlagged) {
    updatePayload.unanswered_question = unansweredFlagged
  }
  if (shouldHangup) {
    updatePayload.ended_at = new Date().toISOString()
  }

  const flushDbPromise = (async () => {
    // Asegurar no degradar estados terminales ya alcanzados ('transferred' / 'callback_requested')
    const { error: updateErr } = await supabaseAdmin
      .from('phone_calls')
      .update(updatePayload)
      .eq('id', finalCallRecord.id)
    if (updateErr) {
      console.error('[phone-agent] No se pudo actualizar la bitácora de la llamada:', updateErr.message)
    }
  })()

  if (!deferDbFlush) {
    await flushDbPromise
  }

  return {
    callId: finalCallRecord.id,
    replyText,
    language: finalLang,
    voiceId,
    primaryIntent: updatePayload.primary_intent,
    toolsUsed,
    callbackCreated: callbackWasNew ? callbackCreated : null,
    shouldTransferToPhone,
    shouldHangup,
    transcript,
    storeContext: ctx,
    flushDbPromise
  }
}

/**
 * Verifica criptográficamente la firma `X-Twilio-Signature` en webhooks entrantes de Twilio,
 * reconstruyendo la URL pública con `x-forwarded-proto` y `x-forwarded-host` sanitizados en Vercel.
 */
export function verifyTwilioWebhookSignature(
  request: Request,
  formParams: Record<string, string>
): { valid: boolean; reason?: string } {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // Fail-closed en producción o cualquier despliegue de Vercel (production / preview)
    const isProductionOrDeployed =
      process.env.NODE_ENV === 'production' ||
      (Boolean(process.env.VERCEL_ENV) && process.env.VERCEL_ENV !== 'development')
    if (isProductionOrDeployed) {
      return { valid: false, reason: 'missing_twilio_auth_token_in_deployment' }
    }
    return { valid: true, reason: 'no_auth_token_configured_dev_only' }
  }

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) {
    return { valid: false, reason: 'missing_x_twilio_signature' }
  }

  const reqUrl = new URL(request.url)
  const rawProto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
  const proto = rawProto.split(',')[0].trim() || 'https'
  const host = rawHost.split(',')[0].trim()
  const publicUrl = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`

  const isValid = twilio.validateRequest(authToken, signature, publicUrl, formParams)
  return { valid: isValid, reason: isValid ? 'verified' : 'invalid_signature' }
}

/**
 * Firma HMAC-SHA256 para las URLs de `/api/phone/tts`. Twilio (`<Play>`) no puede enviar sesión de usuario, así que
 * el servidor firma `lang|voice|text` (normalizado con `.trim()`) y el endpoint solo genera audio si la firma coincide.
 */
function getPhoneTtsSigningSecret(): string {
  return process.env.PHONE_TTS_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

export function signPhoneTtsParams(text: string, lang: string, voice: string): string {
  const secret = getPhoneTtsSigningSecret()
  if (!secret) return ''
  const cleanText = String(text || '').trim()
  return createHmac('sha256', secret).update(`${lang}|${voice}|${cleanText}`).digest('hex').slice(0, 32)
}

export function verifyPhoneTtsSignature(text: string, lang: string, voice: string, sig: string | null | undefined): boolean {
  const cleanText = String(text || '').trim()
  const expected = signPhoneTtsParams(cleanText, lang, voice)
  if (!expected || !sig || sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

const TWILIO_GATHER_HINTS =
  'Tacos Gavilan, asada, pastor, pollo, cabeza, lengua, buche, chorizo, carnitas, mulita, super mulita, torta cubana, torta milanesa, super burrito, burrito vegetariano, quesadilla, super quesadilla, sope, taco plate, super nachos, flan, cheesecake, horchata, jamaica, pina, tamarindo, champurrado, aguas frescas, huevos rancheros, huevos con chorizo, Monterey Jack, queso fresco, cotija, fiesta platter, charola, drive thru, EBT, CalFresh, West Covina, Lynwood, South Gate, Downey, Norwalk, La Puente, Huntington Park, Santa Ana, Rialto, Azusa, Bell, Hollywood, Slauson, Central, Broadway, gerente, manager'

/**
 * Genera los atributos estándar optimizados de Twilio `<Gather input="speech dtmf">`
 * con `speechTimeout="1"`, `timeout="4"`, `actionOnEmptyResult="true"`, `speechModel="phone_call"`, `enhanced="true"` y `hints`.
 */
export function buildTwilioGatherAttrs(lang: PhoneLang, actionUrl: string): string {
  const speechLang = lang === 'en' ? 'en-US' : 'es-US'
  return `input="speech dtmf" numDigits="1" language="${speechLang}" speechTimeout="1" timeout="4" actionOnEmptyResult="true" speechModel="phone_call" enhanced="true" hints="${escapeXml(TWILIO_GATHER_HINTS)}" action="${escapeXml(actionUrl)}" method="POST"`
}

/**
 * Construye la URL firmada de audio telefónico (`/api/phone/tts?lang&voice&text&sig[&rate=8000][&dyn=1]`).
 * Cuando `dynamic = true` (respuestas dinámicas de `respond`), añade `&dyn=1` para omitir búsquedas/subidas lentas en Storage.
 */
export function buildPhoneTtsUrl(
  baseUrl: string,
  text: string,
  lang: PhoneLang,
  voice: string = 'Kore',
  rateOrOpts?: 8000 | 24000 | { rate?: 8000 | 24000; dynamic?: boolean }
): string {
  const cleanText = String(text || '').trim()
  const sig = signPhoneTtsParams(cleanText, lang, voice)
  const rateOpt = typeof rateOrOpts === 'number' ? rateOrOpts : rateOrOpts?.rate
  const isDynamic = typeof rateOrOpts === 'object' ? Boolean(rateOrOpts?.dynamic) : false
  const effectiveRate = rateOpt ?? (baseUrl ? 8000 : 24000)
  const rateParam = effectiveRate === 8000 ? '&rate=8000' : ''
  const dynParam = isDynamic ? '&dyn=1' : ''
  return `${baseUrl}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(cleanText)}&sig=${sig}${rateParam}${dynParam}`
}

/**
 * Escapa texto para incluirlo de forma segura dentro de etiquetas XML/TwiML.
 */
export function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
