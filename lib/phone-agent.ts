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
 *   * Validación E.164 + anti-bucle en `shouldTransferToPhone` (`<Dial>`), gramática `"a la 1:00 AM"`, lookahead +7 días
 *     en cierres festivos consecutivos, preservación legal CIPA + tecla `9` en saludos personalizados, herramientas
 *     declaradas completas (`get_fiesta_platter_packages` >40 invitados y `get_store_hours_and_status`), filtro de
 *     sustantivos del menú (`Piña`, `Jalapeño`) en `detectPhoneTextLanguage`, y pronunciación vial/telefónica natural
 *     en las 15 sucursales (`lib/phone-speech-format.ts`: sin abreviaturas `S.`, `E.`, `Ave.`, `Rd.`, `Blvd.`, `17th St.`, `Hwy.`, `CA`).
 */

import twilio from 'twilio'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getGeminiKeyPoolWithRemote, VoiceId, resolvePhoneFemaleVoice } from '@/lib/order-ready-tts'
import { PARTY_TRAY_GUIDELINES } from '@/lib/inventory/party-tray-guidelines'
import { getOfficialStoreHolidaySchedule, getUpcomingOfficialStoreHolidays } from '@/lib/holidays'
import { extractPhoneDigits, normalizeUsPhoneE164 } from '@/lib/phone-agent-access'
import {
  expandStreetAbbreviationsInText,
  extractZipCodeFromAddress,
  formatStoreAddressForAgent
} from '@/lib/phone-speech-format'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Orden validado con benchmark en vivo (2026-11-09): gemini-3-flash-preview ~1.0 s, gemini-3.6-flash ~1.5 s.
// 'gemini-3.5-flash' se omite: en los benchmarks del 06 y 09-nov-2026 tardó 9.8 s y llegó a 15 s (timeout).
const MODERN_CHAT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.6-flash'
]
const CLASSIC_CHAT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.6-flash'
]

const keyQuarantineUntil = new Map<string, number>()
const modelUnavailableUntil = new Map<string, number>()
let keyRoundRobin = 0

// Caché en memoria de corta duración para eliminar latencia de DB en cada turno de voz
const storeMenuRamCache = new Map<number, { items: any[]; fetchedAt: number }>()
const storeContextRamCache = new Map<number, { data: any; fetchedAt: number }>()

export function invalidateStorePhoneContextCache(storeId?: number) {
  if (storeId && Number.isFinite(storeId)) {
    storeContextRamCache.delete(Number(storeId))
  } else {
    storeContextRamCache.clear()
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
export function parseTimeToMinutes(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 480 // default 08:00
  const parts = hhmm.trim().split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] || 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 480
  return h * 60 + m
}

/**
 * Formatea una hora "HH:MM" (24h) en formato limpio de 12 horas (ej. "8:00 AM", "12:00 AM", "12:00 PM")
 * sin paréntesis hablados para que el motor TTS pronuncie las horas con total fluidez.
 */
export function formatTime12h(hhmm: string | null | undefined, _lang: PhoneLang = 'es'): string {
  if (!hhmm) return ''
  const parts = hhmm.trim().split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] || 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm

  const minStr = String(m).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${minStr} ${period}`
}

/**
 * Extrae las partes de fecha y hora en la zona horaria oficial `America/Los_Angeles`.
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
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const parts = formatter.formatToParts(now)
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
  const out: Record<string, StoreScheduleDay> = {}
  if (Array.isArray(source)) {
    for (const row of source) {
      const day = resolveDayIndex(row?.day)
      if (day !== null && row?.open && row?.close) {
        out[String(day)] = { open: String(row.open), close: String(row.close) }
      }
    }
    return out
  }
  if (source && typeof source === 'object') {
    for (const [k, v] of Object.entries(source as Record<string, any>)) {
      const day = resolveDayIndex(k)
      if (day !== null && v?.open && v?.close) {
        out[String(day)] = { open: String(v.open), close: String(v.close) }
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
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 5)
}

/**
 * Fusiona los días festivos configurados en `phone_special_hours` (override por sucursal > regla global)
 * con las 7 fechas oficiales perpetuas de `lib/holidays.ts`, calculando las horas reales de apertura y cierre
 * para la sucursal consultada (`weeklyHours`).
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

  const allDates = new Set<string>()
  const numericStoreId = Number(storeId)
  for (const s of specialHours) {
    if (
      s?.event_date &&
      s.event_date >= fromDateStr &&
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

    const storeSpecific = specialHours.find((s) => s.event_date === dStr && Number(s.store_id) === numericStoreId)
    const globalRow = !storeSpecific ? specialHours.find((s) => s.event_date === dStr && s.store_id === null) : null
    const dbMatch = storeSpecific || globalRow || null

    if (dbMatch) {
      const openOverride = normalizeHhMm(dbMatch.open_time)
      const closeOverride = normalizeHhMm(dbMatch.close_time)
      const isClosed = Boolean(dbMatch.is_closed)
      const effectiveOpen = isClosed ? 'CLOSED' : openOverride || regular.open
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
    const storeSpecific = specialHours.find((s) => s.event_date === dStr && Number(s.store_id) === numericStoreId)
    if (storeSpecific) return storeSpecific
    return specialHours.find((s) => s.event_date === dStr && s.store_id === null) || null
  }

  const atTimeEs = (formatted12h: string) =>
    /^1:/i.test(formatted12h.trim()) ? `a la ${formatted12h}` : `a las ${formatted12h}`
  const cleanSpokenHoliday = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim()

  const getScheduleForDay = (dayIdx: number, dStr: string) => {
    const regular = wh[String(dayIdx)] || { open: '10:00', close: '00:00' }
    const sp = findSpecialForDate(dStr)
    if (sp) {
      const openOverride = normalizeHhMm(sp.open_time)
      const closeOverride = normalizeHhMm(sp.close_time)
      return {
        isClosedAllDay: Boolean(sp.is_closed),
        open: openOverride || regular.open,
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
      isClosedAllDay: false,
      open: regular.open || '10:00',
      close: regular.close || '00:00',
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
        isSpecialHolidaySchedule: yesterdaySched.isSpecial,
        specialHolidayName: yesterdaySched.holidayName,
        statusMessageEs: `La sucursal ${storeName} está ABIERTA en este momento; nuestro turno nocturno de ${dayEs} cierra hoy ${atTimeEs(closeEs)}.`,
        statusMessageEn: `Our ${storeName} location is OPEN right now; our ${dayEn} late-night shift closes at ${closeEn}.`,
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
      statusMessageEs: `Hoy (${todaySched.holidayName || dayEs}) la sucursal ${storeName} permanece cerrada todo el día por día festivo.${reopenTailEs}`,
      statusMessageEn: `Today (${todaySched.holidayNameEn || dayEn}) our ${storeName} location is closed all day for the holiday.${reopenTailEn}`,
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
      statusMessageEs = `La sucursal ${storeName} está ABIERTA en este momento. Hoy ${dayEs} (${todaySched.holidayName}) tenemos horario especial de ${openEs} a ${closeEs}.`
      statusMessageEn = `Our ${storeName} location is OPEN right now. Today (${dayEn}, ${todaySched.holidayNameEn || todaySched.holidayName}) our special holiday hours are ${openEn} to ${closeEn}.`
    } else {
      statusMessageEs = `La sucursal ${storeName} está ABIERTA en este momento. Hoy ${dayEs} nuestro horario es de ${openEs} a ${closeEs}.`
      statusMessageEn = `Our ${storeName} location is OPEN right now. Today (${dayEn}) our hours are ${openEn} to ${closeEn}.`
    }
  } else if (pt.currentMinutes < openMin) {
    if (todaySched.isSpecial && todaySched.holidayName) {
      const spokenHolEs = cleanSpokenHoliday(todaySched.holidayName)
      const spokenHolEn = cleanSpokenHoliday(todaySched.holidayNameEn || todaySched.holidayName)
      statusMessageEs = `En este momento la sucursal ${storeName} está cerrada. Hoy ${dayEs} (${todaySched.holidayName}) abrimos en horario especial ${atTimeEs(openEs)} y cerramos ${atTimeEs(closeEs)}.`
      statusMessageEn = `Our ${storeName} location is currently closed. Today (${dayEn}, ${todaySched.holidayNameEn || todaySched.holidayName}) we open at ${openEn} (special holiday hours) and close at ${closeEn}.`
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
    const closedReasonEs = todaySched.isSpecial && todaySched.holidayName ? ` por horario especial de ${todaySched.holidayName}` : ''
    const closedReasonEn =
      todaySched.isSpecial && (todaySched.holidayNameEn || todaySched.holidayName)
        ? ` for ${todaySched.holidayNameEn || todaySched.holidayName} special hours`
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

      statusMessageEs = `En este momento la sucursal ${storeName} ya cerró por hoy (cerró ${atTimeEs(closeEs)}${closedReasonEs}). Mañana permanecemos cerrados${tomorrowSched.holidayName ? ` por ${tomorrowSched.holidayName}` : ''}${reopenNextEs}.`
      statusMessageEn = `Our ${storeName} location is closed for the day (closed at ${closeEn}${closedReasonEn}). We will be closed tomorrow${tomorrowSched.holidayNameEn || tomorrowSched.holidayName ? ` for ${tomorrowSched.holidayNameEn || tomorrowSched.holidayName}` : ''}${reopenNextEn}.`
      closedGreetingPromptEs = `En este momento nuestra sucursal ya está cerrada; ${todayClosedPartEs}, mañana permanecemos cerrados${spokenTomHolEs ? ` por ${spokenTomHolEs}` : ''}${reopenNextEs}. ¿En qué te puedo ayudar?`
      closedGreetingPromptEn = `Our location is currently closed; ${todayClosedPartEn}, we remain closed tomorrow${spokenTomHolEn ? ` for ${spokenTomHolEn}` : ''}${reopenSpokenNextEn}. How can I help you?`
    } else {
      const tomOpenEs = formatTime12h(tomorrowSched.open, 'es')
      const tomOpenEn = formatTime12h(tomorrowSched.open, 'en')
      const tomorrowSpecialEs =
        tomorrowSched.isSpecial && tomorrowSched.holidayName ? ` (horario especial por ${tomorrowSched.holidayName})` : ''
      const tomorrowSpecialEn =
        tomorrowSched.isSpecial && (tomorrowSched.holidayNameEn || tomorrowSched.holidayName)
          ? ` (${tomorrowSched.holidayNameEn || tomorrowSched.holidayName} special hours)`
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
    parts.push(`${names[d]}: ${formatTime12h(slot.open, lang)} - ${formatTime12h(slot.close, lang)}`)
  }
  return parts.join(' | ')
}

/**
 * Calcula los paquetes recomendados de Fiesta Platter según el número de invitados,
 * protegiendo contra divisiones por cero, valores negativos o NaN.
 */
export function recommendFiestaPlatters(guestCountInput?: number | null) {
  const packages = [
    {
      sizeKey: '15-20',
      labelEs: 'Paquete para 15 a 20 personas',
      labelEn: '15 to 20 People Fiesta Platter',
      minGuests: 15,
      maxGuests: 20,
      price: 201.99,
      meatLbs: PARTY_TRAY_GUIDELINES['15-20'].meatLbs,
      riceBeansTray: 'Charola Mediana de arroz y frijol (3 lbs c/u)',
      aguasGallons: PARTY_TRAY_GUIDELINES['15-20'].aguaGallons,
      cornTortillasDozens: 10,
      flourTortillasDozens: 5
    },
    {
      sizeKey: '20-25',
      labelEs: 'Paquete para 20 a 25 personas',
      labelEn: '20 to 25 People Fiesta Platter',
      minGuests: 20,
      maxGuests: 25,
      price: 245.79,
      meatLbs: PARTY_TRAY_GUIDELINES['20-25'].meatLbs,
      riceBeansTray: '1/2 Charola de arroz y frijol (4 lbs c/u)',
      aguasGallons: PARTY_TRAY_GUIDELINES['20-25'].aguaGallons,
      cornTortillasDozens: 13,
      flourTortillasDozens: 7
    },
    {
      sizeKey: '25-30',
      labelEs: 'Paquete para 25 a 30 personas',
      labelEn: '25 to 30 People Fiesta Platter',
      minGuests: 25,
      maxGuests: 30,
      price: 301.69,
      meatLbs: PARTY_TRAY_GUIDELINES['25-30'].meatLbs,
      riceBeansTray: '3/4 de Charola de arroz y frijol (6 lbs c/u)',
      aguasGallons: PARTY_TRAY_GUIDELINES['25-30'].aguaGallons,
      cornTortillasDozens: 15,
      flourTortillasDozens: 8
    },
    {
      sizeKey: '30-40',
      labelEs: 'Paquete para 30 a 40 personas',
      labelEn: '30 to 40 People Fiesta Platter',
      minGuests: 30,
      maxGuests: 40,
      price: 373.89,
      meatLbs: PARTY_TRAY_GUIDELINES['30-40'].meatLbs,
      riceBeansTray: 'Charola Completa de arroz y frijol (10 lbs c/u)',
      aguasGallons: PARTY_TRAY_GUIDELINES['30-40'].aguaGallons,
      cornTortillasDozens: 20,
      flourTortillasDozens: 10
    }
  ]

  const guests = Number(guestCountInput)
  let recommendationEs =
    'Se ordenan en línea en tacosgavilan.com con mínimo 1 hora de anticipación para recoger el mismo día. Carnes a elegir: Carne Asada, Pollo o Al Pastor. Aguas Frescas: Horchata, Jamaica, Piña o Tamarindo. Todos incluyen arroz, frijol, tortillas, salsas, verdura y desechables completos.'
  let recommendationEn =
    'Order online at tacosgavilan.com with at least 1 hour advance notice for same-day pickup. Meats: Carne Asada, Chicken, or Al Pastor. Aguas Frescas: Horchata, Jamaica, Pineapple, or Tamarind. All packages include rice, beans, tortillas, salsas, toppings, and utensils.'

  if (Number.isFinite(guests) && guests > 0) {
    if (guests <= 20) {
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 15 a 20 personas en $201.99 (incluye 6 lbs de carne y 3 galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 15 to 20 people package at $201.99 (includes 6 lbs of meat and 3 gallons of agua fresca).`
    } else if (guests <= 25) {
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 20 a 25 personas en $245.79 (incluye 7.5 lbs de carne y 4 galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 20 to 25 people package at $245.79 (includes 7.5 lbs of meat and 4 gallons of agua fresca).`
    } else if (guests === 30) {
      recommendationEs = `Para 30 personas tenemos el paquete de 25 a 30 personas en $301.69 (10 lbs de carne y 5 galones de agua fresca) o, si desean porciones más abundantes, el de 30 a 40 personas en $373.89 (12 lbs de carne y 6 galones de agua fresca).`
      recommendationEn = `For 30 guests we offer the 25 to 30 people package at $301.69 (10 lbs of meat and 5 gallons of agua fresca), or for larger portions, the 30 to 40 people package at $373.89 (12 lbs of meat and 6 gallons of agua fresca).`
    } else if (guests < 30) {
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 25 a 30 personas en $301.69 (incluye 10 lbs de carne y 5 galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 25 to 30 people package at $301.69 (includes 10 lbs of meat and 5 gallons of agua fresca).`
    } else if (guests <= 40) {
      recommendationEs = `Para ${guests} personas te recomendamos el paquete de 30 a 40 personas en $373.89 (incluye 12 lbs de carne y 6 galones de agua fresca).`
      recommendationEn = `For ${guests} guests we recommend the 30 to 40 people package at $373.89 (includes 12 lbs of meat and 6 gallons of agua fresca).`
    } else {
      const fullTrays = Math.ceil(guests / 38)
      const total = +(fullTrays * 373.89).toFixed(2)
      recommendationEs = `Para ${guests} personas te recomendamos combinar ${fullTrays} paquetes de 30 a 40 personas ($373.89 c/u, total $${total.toFixed(2)}).`
      recommendationEn = `For ${guests} guests we recommend combining ${fullTrays} of the 30 to 40 people packages ($373.89 each, total $${total.toFixed(2)}).`
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
  const clampedRing = Math.min(30, Math.max(5, Math.round(ringTimeoutSeconds / 5) * 5))

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
export async function loadStoreMenuItems(storeId: number): Promise<any[]> {
  const now = Date.now()
  const cachedMenu = storeMenuRamCache.get(storeId)
  if (cachedMenu && now - cachedMenu.fetchedAt <= 5 * 60 * 1000) return cachedMenu.items

  const { data: items, error } = await supabaseAdmin
    .from('app_menu_cache')
    .select('name, description, price, category_name, is_available')
    .eq('store_id', storeId)
    .eq('is_available', true)

  if (error || !items || items.length === 0) {
    // Si falla la lectura pero había caché vieja, es mejor usarla que dejar a la IA sin precios
    return cachedMenu?.items || []
  }
  storeMenuRamCache.set(storeId, { items, fetchedAt: now })
  return items
}

/**
 * Construye el catálogo de precios EN VIVO para el prompt, agrupando por categoría y por precio
 * (ej. "- Tacos: Taco Asada, Taco Pastor, ...: $2.29"). Reemplaza el catálogo escrito a mano que decía "EN VIVO"
 * sin serlo: si un precio cambia en Toast / `app_menu_cache`, la IA lo dice correctamente en máximo 5 minutos.
 */
export function buildLiveMenuCatalogText(storeName: string, items: any[]): string {
  const byCategory = new Map<string, Map<string, string[]>>()
  for (const it of items || []) {
    const price = Number(it?.price)
    const name = String(it?.name || '').trim()
    if (!name || !Number.isFinite(price) || price <= 0) continue
    const category = String(it?.category_name || 'Otros').trim()
    if (!byCategory.has(category)) byCategory.set(category, new Map())
    const priceGroups = byCategory.get(category)!
    const priceKey = price.toFixed(2)
    if (!priceGroups.has(priceKey)) priceGroups.set(priceKey, [])
    priceGroups.get(priceKey)!.push(name)
  }

  if (byCategory.size === 0) {
    return 'CATÁLOGO DE PRECIOS: no disponible en este momento. Si preguntan precios, NO inventes cifras: invita a consultar tacosgavilan.com.'
  }

  const lines: string[] = []
  for (const [category, priceGroups] of byCategory) {
    const segments = Array.from(priceGroups.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([price, names]) => `${names.join(', ')}: $${price}`)
    lines.push(`- ${category}: ${segments.join(' | ')}`)
  }
  return `CATÁLOGO COMPLETO DE PRECIOS EN VIVO DE ${storeName.toUpperCase()} (menú oficial en línea; nombres en inglés tal como aparecen en el menú, ej. "Large" = Grande, "Medium" = Mediana, "Beans" = Frijol, "Rice" = Arroz):\n${lines.join('\n')}`
}

/**
 * Busca precios reales en `app_menu_cache` para una sucursal con tolerancia a tildes, mayúsculas
 * y sinónimos bilingües Español <-> Inglés (ej. "grande" <-> "large", "mediana" <-> "medium", "galon" <-> "gallon").
 */
export async function searchStoreMenuPrices(storeId: number, query: string, limit: number = 12) {
  const stopWords = new Set([
    'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'por', 'para', 'del', 'al', 'que',
    'cuesta', 'cuanto', 'precio', 'precios', 'tienen', 'hay', 'me', 'puedes', 'decir', 'hola', 'quiero',
    'saber', 'how', 'much', 'is', 'the', 'and', 'for', 'do', 'you', 'have', 'can', 'tell', 'cost'
  ])
  const synonymMap: Record<string, string[]> = {
    grande: ['large'],
    grandes: ['large'],
    large: ['grande'],
    mediana: ['medium'],
    mediano: ['medium'],
    medianas: ['medium'],
    medium: ['mediana', 'mediano'],
    galon: ['gallon'],
    galones: ['gallon'],
    gallon: ['galon'],
    agua: ['horchata', 'jamaica', 'pina', 'tamarindo', 'lemonade', 'water', 'fresca'],
    aguas: ['horchata', 'jamaica', 'pina', 'tamarindo', 'fresca'],
    fresca: ['agua', 'horchata', 'jamaica', 'pina', 'tamarindo'],
    frijol: ['beans', 'frijol'],
    frijoles: ['beans', 'frijol'],
    arroz: ['rice'],
    queso: ['cheese', 'queso'],
    crema: ['sour', 'cream'],
    cafe: ['coffee'],
    refresco: ['coke', 'sprite', 'fanta'],
    soda: ['coke', 'sprite', 'fanta'],
    postre: ['flan', 'cheesecake'],
    postres: ['flan', 'cheesecake'],
    desayuno: ['huevos', 'breakfast'],
    huevo: ['huevos', 'breakfast']
  }

  const normQuery = normalizeSearchText(query)
  const rawTokens = normQuery.split(/\s+/).filter((t) => t.length >= 3 && !stopWords.has(t))
  const expandedTokens = new Set<string>()
  for (const tok of rawTokens) {
    expandedTokens.add(tok)
    const syns = synonymMap[tok]
    if (syns) {
      for (const s of syns) expandedTokens.add(s)
    }
  }
  const tokens = Array.from(expandedTokens)

  const items = await loadStoreMenuItems(storeId)
  if (items.length === 0) return []

  // Asegurar cobertura multi-platillo: tomar los mejores de cada palabra clave además del score global
  const pickedMap = new Map<string, { item: any; score: number }>()

  for (const tok of tokens) {
    const tokenMatches = items
      .filter((it) => normalizeSearchText(it.name).includes(tok))
      .slice(0, 3)
    for (const m of tokenMatches) {
      pickedMap.set(m.name, { item: m, score: 25 })
    }
  }

  for (const item of items) {
    const hay = normalizeSearchText(`${item.name} ${item.category_name || ''} ${item.description || ''}`)
    const nameNorm = normalizeSearchText(item.name)
    let score = 0
    let matchedNameTokens = 0
    if (nameNorm === normQuery) score += 120
    if (normQuery.length >= 4 && nameNorm.includes(normQuery)) score += 60
    for (const tok of tokens) {
      if (nameNorm.includes(tok)) {
        score += 30
        matchedNameTokens++
      } else if (hay.includes(tok)) {
        score += 8
      }
    }
    if (matchedNameTokens >= 2) {
      score += matchedNameTokens * 25
    }
    if (score > 0) {
      const prev = pickedMap.get(item.name)
      if (!prev || score > prev.score) {
        pickedMap.set(item.name, { item, score })
      }
    }
  }

  const scored = Array.from(pickedMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      name: entry.item.name,
      category: entry.item.category_name || 'Menú',
      price: Number(entry.item.price || 0),
      priceFormatted: `$${Number(entry.item.price || 0).toFixed(2)}`,
      description: entry.item.description || ''
    }))

  return scored
}

let allStoresDirectoryCache: {
  fetchedAt: number
  stores: Array<{ id: number; name: string; address: string; phone: string; has_drive_thru: boolean }>
} | null = null

async function loadAllActiveStoresDirectory() {
  const now = Date.now()
  if (allStoresDirectoryCache && now - allStoresDirectoryCache.fetchedAt < 5 * 60 * 1000) {
    return allStoresDirectoryCache.stores
  }
  const { data } = await supabaseAdmin
    .from('stores')
    .select('id, name, address, phone, has_drive_thru, is_active')
    .eq('is_active', true)
    .order('id', { ascending: true })
  const stores = (data || []).map((s: any) => ({
    id: Number(s.id),
    name: cleanPhoneStoreName(s.name),
    address: String(s.address || ''),
    phone: String(s.phone || ''),
    has_drive_thru: Boolean(s.has_drive_thru),
  }))
  if (stores.length > 0) {
    allStoresDirectoryCache = { fetchedAt: now, stores }
  }
  return stores
}

/**
 * Obtiene el contexto completo de una sucursal (datos de `stores`, `phone_agent_config`, `phone_special_hours` y `phone_knowledge_base`).
 * Incluye caché en RAM de 45s para máxima velocidad en conversaciones telefónicas.
 */
export async function getStorePhoneContext(storeId: number) {
  const now = Date.now()
  const cached = storeContextRamCache.get(storeId)
  if (cached && now - cached.fetchedAt < 45 * 1000) {
    // Re-evaluar horario en vivo (0ms en memoria) por si cruzó el minuto de apertura/cierre
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

  const [storeRes, configRes, specialRes, kbRes] = await Promise.all([
    supabaseAdmin
      .from('stores')
      .select('id, name, address, phone, has_drive_thru, weekly_hours, latitude, longitude')
      .eq('id', storeId)
      .single(),
    supabaseAdmin
      .from('phone_agent_config')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle(),
    supabaseAdmin
      .from('phone_special_hours')
      .select('*')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('event_date', { ascending: true }),
    supabaseAdmin
      .from('phone_knowledge_base')
      .select('*')
      .eq('is_active', true)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('priority', { ascending: false })
  ])

  const rawStore = storeRes.data
  if (!rawStore) {
    throw new Error(`Sucursal #${storeId} no encontrada`)
  }
  const store = {
    ...rawStore,
    name: cleanPhoneStoreName(rawStore.name)
  }

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
    specialHours: specialRes.data || []
  })

  const result = {
    store,
    config,
    scheduleEval,
    specialHours: specialRes.data || [],
    knowledgeBase: kbRes.data || [],
    onlineOrderUrl: OFFICIAL_STORE_URLS[store.id] || OFFICIAL_ORDER_FALLBACK_URL
  }
  storeContextRamCache.set(storeId, { data: result, fetchedAt: now })
  return result
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
    reason_summary: params.reasonSummary.trim(),
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
      if (includeHint && !/\b(nueve|nine|9)\b/i.test(baseEn)) {
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
    if (includeHint && !/\b(nine|nueve|9)\b/i.test(baseEs)) {
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

const PHONE_AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_store_hours_and_status',
        description:
          'Obtiene el estado exacto en tiempo real (abierto/cerrado), horario semanal, horarios festivos, dirección, Drive-Thru y formas de pago de esta sucursal.',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      },
      {
        name: 'search_menu_item_price',
        description:
          'Busca platillos, bebidas o postres adicionales en el menú en vivo de esta sucursal si el cliente pregunta por un ítem específico que no aparezca ya listado en el contexto.',
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
          'Calcula el paquete o combinación exacta de charolas Fiesta Platter y el precio total según el número de personas/invitados (especialmente útil para eventos de más de 40 personas, ej. 50, 60, 80 o 100 invitados).',
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
          'Consulta información y estado abierto/cerrado en vivo de las otras 15 sucursales de Tacos Gavilan cuando el cliente pregunta por otra ciudad, región (ej. East LA, Orange County, Inland Empire) o pregunta cuáles sucursales tienen Drive-Thru.',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_city_or_filter: {
              type: 'STRING',
              description: 'Nombre de ciudad, zona o "drive_thru" para filtrar tiendas con Drive-Thru (opcional).'
            }
          }
        }
      },
      {
        name: 'create_manager_callback',
        description:
          'Registra un Recado Prioritario en Vivo que suena y aparece inmediatamente en la pantalla del Gerente de esta sucursal. Úsalo ÚNICAMENTE cuando ya tengas el nombre y el número telefónico real de 10 dígitos de la persona para: (1) comida faltante, queja o cobro erróneo, (2) objeto olvidado en la tienda, (3) empleado que reporta retardo o falta, (4) proveedor/técnico urgente, o (5) solicitud de hablar con el gerente.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caller_name: {
              type: 'STRING',
              description: 'Nombre real proporcionado por la persona que llama.'
            },
            caller_phone: {
              type: 'STRING',
              description: 'Teléfono real de 10 dígitos confirmado por la persona para devolverle la llamada (NUNCA envíes "No proporcionado" ni inventes números).'
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
          'Úsalo ÚNICAMENTE si la persona hace una pregunta ajena al menú, precios, horarios, ubicación, pagos, empleo o políticas que no tenga respuesta en el contexto.',
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
export function detectPhoneTextLanguage(text: string, fallback: PhoneLang): PhoneLang {
  const raw = String(text || '')
  if (!raw.trim()) return fallback
  const strippedMenuLoanwords = raw.replace(
    /\b(los\s+[aá]ngeles|piña|pina|jalapeños?|jalapenos?|horchata|jamaica|tamarindo|champurrado|asada|pastor|carnitas|lengua|cabeza|buche|chorizo|mulitas?|quesadillas?|sopes?|gavil[aá]n)\b/gi,
    ' '
  )
  const norm = normalizeSearchText(strippedMenuLoanwords)
  const words = norm.split(/\s+/).filter(Boolean)
  const esWords = new Set([
    'de', 'la', 'el', 'que', 'en', 'los', 'las', 'por', 'para', 'con', 'una', 'un', 'es', 'esta', 'estamos', 'tenemos',
    'hoy', 'puedes', 'nuestra', 'nuestro', 'sucursal', 'tu', 'te', 'si', 'cuanto', 'cuesta', 'horario', 'abren', 'cierran',
    'quiero', 'tienen', 'gracias', 'hola', 'gerente', 'orden', 'algo', 'mas', 'ayudar', 'pedido', 'ahorita', 'donde', 'aceptan'
  ])
  const enWords = new Set([
    'the', 'and', 'you', 'your', 'we', 'our', 'is', 'are', 'to', 'of', 'for', 'at', 'with', 'can', 'do', 'have', 'today',
    'open', 'close', 'what', 'how', 'much', 'please', 'thank', 'thanks', 'hello', 'hi', 'order', 'my', 'it', 'this', 'that',
    'location', 'would', 'like', 'help', 'there', 'does', 'accept', 'where', 'when'
  ])
  let es = /[¿¡]/.test(raw) || /[ñáéíóú]/i.test(strippedMenuLoanwords) ? 3 : 0
  let en = 0
  for (const w of words) {
    if (esWords.has(w)) es++
    if (enWords.has(w)) en++
  }
  if (es === en) return fallback
  if (Math.abs(es - en) < 2 && words.length > 3) return fallback
  return es > en ? 'es' : 'en'
}

async function callGeminiPhoneWithFailover(body: any, deadlineMs: number = Date.now() + 12000) {
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

  let lastError = 'Servicio de IA temporalmente no disponible'
  let attempts = 0
  const MAX_ATTEMPTS = 6

  for (const key of orderedKeys) {
    const models = key.startsWith('AQ.') ? MODERN_CHAT_MODELS : CLASSIC_CHAT_MODELS
    for (const model of models) {
      // Presupuesto global: una llamada telefónica no puede esperar más (Twilio corta el webhook a ~15 s)
      const remaining = deadlineMs - Date.now()
      if (remaining < 1500 || attempts >= MAX_ATTEMPTS) {
        throw new Error(`${lastError} (presupuesto de tiempo agotado tras ${attempts} intentos)`)
      }
      if ((modelUnavailableUntil.get(model) || 0) > Date.now()) continue
      attempts++

      const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`
      try {
        // thinkingLevel 'minimal' = sin razonamiento interno: los "thinking tokens" ya no consumen maxOutputTokens
        // (causa raíz del corte "Estamos abiertos en este momento en la su"). Verificado en vivo 2026-11-09.
        const requestBody = {
          ...body,
          generationConfig: {
            maxOutputTokens: 1024,
            ...(body.generationConfig || {}),
            thinkingConfig: { thinkingLevel: 'minimal' }
          }
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(Math.min(6000, remaining - 500)),
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
          // MAX_TOKENS SIN texto ni función: respuesta inservible -> se intenta con el siguiente modelo.
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
          continue
        }
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          // Llave inválida, sin saldo o sin permisos: cuarentena larga de la LLAVE
          keyQuarantineUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
          break
        }
        if (res.status === 400) {
          // Error determinista de la petición (no se arregla cambiando de llave/modelo)
          throw new Error(`Petición inválida a Gemini: ${lastError}`)
        }
        if (res.status === 429) {
          // Cuota por modelo: probar el siguiente modelo de la misma llave
          continue
        }
      } catch (e: any) {
        if (String(e?.message || '').startsWith('Petición inválida a Gemini')) throw e
        lastError = e?.message || 'Error de red'
      }
    }
  }

  throw new Error(lastError)
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
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(falto|falta|faltaron|me falto|incompleta|equivocada|ticket|queja|reembolso|me cobraron|cobro doble|cobraron de mas|wrong order|missing|refund|overcharged|got sick)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'complaint_missing_item',
      resolvedByAi: !callbackCreated,
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
      resolvedByAi: !callbackCreated,
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
  if (/\b(ebt|calfresh|food stamps|estampillas|tarjeta|efectivo|apple pay|formas de pago)\b/i.test(norm)) {
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

  // Ejecutar lecturas de contexto, llamada existente, pre-búsqueda de menú y directorio de 15 sucursales en paralelo
  const [ctx, existingCallRes, preFetchedMenu, allActiveStores] = await Promise.all([
    getStorePhoneContext(storeId),
    supabaseAdmin.from('phone_calls').select('*').eq('call_sid', callSid).maybeSingle(),
    searchStoreMenuPrices(storeId, userText, 12),
    loadAllActiveStoresDirectory()
  ])

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
        .insert({
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
        })
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

  // 2. Construir las reglas de la Base de Conocimiento Editable (`phone_knowledge_base`)
  const kbFormatted = knowledgeBase
    .map((rule: any, idx: number) => {
      const enPart = rule.answer_en && String(rule.answer_en).trim() ? `\n   - EN: ${String(rule.answer_en).trim()}` : ''
      return `${idx + 1}. [${rule.category.toUpperCase()}${rule.store_id ? ` - SOLO ${store.name}` : ' - GLOBAL'}] ${rule.title}:\n   - ES: ${rule.answer_es}${enPart}`
    })
    .join('\n')

  const turnStartedAt = Date.now()
  // Idioma de la llamada: el que ya venía en la bitácora (persistido turno a turno) o el default de la tienda.
  const callLang: PhoneLang = callRecord?.language === 'en' ? 'en' : callRecord?.language === 'es' ? 'es' : defaultCallLang
  // Detectar si el cliente habló claramente en otro idioma (ej. habla en inglés aunque la tienda inició en español)
  const turnLangGuess: PhoneLang = detectPhoneTextLanguage(userText, preferredLang || callLang)

  // Validar de antemano si la transferencia en vivo al gerente es segura (E.164 válido + tienda abierta + sin bucle hacia la tienda/Twilio)
  const liveTransferCandidatePhone: string | null = (() => {
    if (!scheduleEval.isOpenNow || !config.allow_live_transfer || !config.manager_transfer_phone) return null
    const parsed = normalizeUsPhoneE164(config.manager_transfer_phone)
    if (!parsed.valid || !parsed.normalized || !parsed.tenDigits) return null
    const storeDigits = extractPhoneDigits(store.phone)
    const store10 = storeDigits.length === 11 && storeDigits.startsWith('1') ? storeDigits.slice(1) : storeDigits
    const twDigits = extractPhoneDigits(config.twilio_phone_number)
    const tw10 = twDigits.length === 11 && twDigits.startsWith('1') ? twDigits.slice(1) : twDigits
    if ((store10 && store10 === parsed.tenDigits) || (tw10 && tw10 === parsed.tenDigits)) {
      console.warn(`[phone-agent] Transferencia bloqueada por protección anti-bucle en tienda #${store.id}`)
      return null
    }
    return parsed.normalized
  })()

  const hadPriorCallbackInCall =
    callRecord?.status === 'callback_requested' ||
    callRecord?.status === 'transferred' ||
    (Array.isArray(callRecord?.transcript) &&
      callRecord.transcript.some(
        (t: any) => t?.role === 'tool' && t?.toolName === 'create_manager_callback' && String(t?.text || '').includes('"success":true')
      ))

  // Días festivos próximos (fusión en tiempo real: overrides por tienda/globales en `phone_special_hours` + calendario perpetuo `lib/holidays.ts`)
  const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
    storeId: store.id,
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: businessDate,
    daysAhead: 180
  })
  const holidaysContextLine =
    upcomingHolidays.length > 0
      ? `- Horarios Especiales / Días Festivos oficiales de esta sucursal (${store.name}): ` +
        upcomingHolidays
          .slice(0, 10)
          .map((h) => {
            if (h.is_closed) {
              return `${h.event_date} (${h.holiday_name}): CERRADO TODO EL DÍA`
            }
            const note = h.is_early_close_only
              ? ' [cierre temprano]'
              : h.is_late_open_only
                ? ' [apertura tarde]'
                : ' [horario especial]'
            return `${h.event_date} (${h.holiday_name}): ${formatTime12h(h.effective_open, 'es')} a ${formatTime12h(h.effective_close, 'es')}${note}`
          })
          .join(' | ') +
        `\n  (Todos los demás días festivos como Super Bowl, Domingo de Pascua, Cinco de Mayo, Día de las Madres, Memorial Day, 4 de Julio, Labor Day, 15 y 16 de Septiembre, Halloween y 12 de Diciembre operan en nuestro horario semanal regular normal).`
      : `- Horarios Especiales / Días Festivos: No hay cierres festivos especiales próximos; aplica el horario semanal regular.`

  // Catálogo de precios generado EN VIVO desde `app_menu_cache` (ya está en la caché RAM por la pre-búsqueda)
  const liveMenuItems = await loadStoreMenuItems(store.id)
  const menuCatalogSummary = buildLiveMenuCatalogText(store.name, liveMenuItems)

  const menuPreContext =
    preFetchedMenu.length > 0
      ? `\nCOINCIDENCIAS DEL MENÚ PARA ESTA PREGUNTA:\n` +
        preFetchedMenu.map((m) => `- ${m.name} (${m.category}): ${m.priceFormatted}`).join('\n')
      : ''

  const platterInfo = recommendFiestaPlatters(null)
  const platterPreContext =
    `\nCHAROLAS FIESTA PLATTER OFICIALES (se piden en línea en tacosgavilan.com con mínimo 1 hora de anticipación; incluyen carne a elegir entre Carne Asada, Pollo o Al Pastor, arroz, frijol, aguas frescas de Horchata, Jamaica, Piña o Tamarindo, tortillas de maíz o harina, salsas, cebolla, cilantro, limones, chiles en vinagre y desechables completos; para más de 40 personas usa \`get_fiesta_platter_packages\`):\n` +
    platterInfo.packages
      .map(
        (p) =>
          `- ${p.labelEs}: $${p.price.toFixed(2)} (${p.meatLbs} libras de carne, ${p.riceBeansTray} y ${p.aguasGallons} galones de agua fresca)`
      )
      .join('\n')

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

  const callbackOutcomeInstruction = liveTransferCandidatePhone
    ? 'infórmale con calidez que ya registraste su aviso y que en este instante le estás transfiriendo la llamada al gerente en turno (NO te despidas ni digas que le llamarán después, porque la línea sonará con el gerente).'
    : scheduleEval.isOpenNow
      ? 'confírmale que el gerente en turno ya recibió la alerta prioritaria en su pantalla para devolverle la llamada.'
      : 'aclárale con transparencia que como la sucursal está cerrada en este momento, su recado prioritario quedó registrado para que el gerente se comunique en cuanto abramos.'

  const spokenStoreAddress = formatStoreAddressForAgent(store.address, turnLangGuess, { includeZip: false })
  const storeZipCode = extractZipCodeFromAddress(store.address)
  const storesDirectoryBlock =
    allActiveStores.length > 0
      ? `\nDIRECTORIO OFICIAL VERIFICADO DE LAS 15 SUCURSALES DE TACOS GAVILAN (USA EXCLUSIVAMENTE ESTAS DIRECCIONES Y TELÉFONOS REALES; JAMÁS INVENTES CALLES NI NÚMEROS. Si preguntan horario o si otra sucursal está abierta ahorita, llama \`find_other_stores\`):\n` +
        allActiveStores
          .map(
            (s) =>
              `- #${s.id} ${s.name}: ${formatStoreAddressForAgent(s.address, turnLangGuess, { includeZip: false })} | Tel: ${s.phone} | ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'}`
          )
          .join('\n')
      : ''

  const systemInstruction = `Eres la recepcionista telefónica virtual oficial de **Tacos Gavilan** en la sucursal **${store.name}** (Sucursal #${store.id}).
El nombre oficial de la marca es estrictamente **Tacos Gavilan** (NUNCA digas "Tacos El Gavilan", ni escribas "(LA)" junto a Central o Broadway).

DATOS EN VIVO DE ESTA SUCURSAL (${store.name}):
- Estado actual en vivo (Zona Horaria Pacífico): ${scheduleEval.statusMessageEs} / ${scheduleEval.statusMessageEn}
- Horario de la semana: ${scheduleEval.weeklySummaryEs}
${holidaysContextLine}
- Dirección exacta para decir por teléfono (SIN abreviaturas): ${spokenStoreAddress}${storeZipCode ? ` (Código postal / Zip Code solo si el cliente lo pregunta explícitamente: ${storeZipCode})` : ''}
- Teléfono de la sucursal: ${store.phone}
- ¿Tiene Drive-Thru?: ${store.has_drive_thru ? 'Esta sucursal SÍ tiene servicio de Drive-Thru, además de Comedor y Para Llevar.' : 'Esta sucursal NO tiene Drive-Thru (únicamente servicio en Comedor y Para Llevar en mostrador). Las 6 sucursales con Drive-Thru son Central, West Covina, La Puente, Norwalk, Lynwood y South Gate.'}
- ¿Acepta EBT CalFresh en caja?: ${config.accepts_ebt ? 'En esta sucursal aceptamos tarjeta EBT CalFresh (Restaurant Meals Program) directamente en caja, además de efectivo, tarjetas Visa/Mastercard/Amex/Discover y Apple Pay/Google Pay.' : 'En esta sucursal no está activo el cobro con EBT CalFresh RMP; aceptamos efectivo, tarjetas de débito/crédito y Apple Pay/Google Pay.'}
- Sitio web para ordenar en línea: tacosgavilan.com (NUNCA dictes URLs largas con https o IDs numéricos por teléfono)
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
2. **Precios del Menú y Platillos No Manejados**:
   - Da los precios exactos del CATÁLOGO EN VIVO de arriba, respetando el tamaño (Medium/Mediana vs Large/Grande) y la carne que pidió. Si preguntan por platillos o bebidas que NO vendemos en el catálogo (ej. menudo, birria, pozole, cerveza o alcohol), aclara con amabilidad que no los manejamos y menciona brevemente nuestras opciones reales SIN llamar a \`flag_unanswered_question\`. Reserva \`flag_unanswered_question\` solo para dudas operativas o políticas especiales que no estén en la Base de Conocimiento (ej. llevar pastel, descuentos escolares).
3. **Charolas Fiesta Platters**:
   - Recomienda el paquete según el número de invitados usando los precios oficiales de arriba (si son exactamente 30 personas, menciona el de 25 a 30 y el de 30 a 40; si son más de 40 personas, llama a \`get_fiesta_platter_packages\` para dar la combinación y total exacto). Indica que se piden en tacosgavilan.com con mínimo 1 hora de anticipación.
4. **Pedidos por Teléfono**:
   - Explica amablemente que por políticas de Tacos Gavilan no tomamos pedidos por teléfono, e invítalo a ordenar en línea en tacosgavilan.com para pasar a recoger${store.has_drive_thru ? ' o pedir directamente en caja o por el Drive-Thru' : ' o pedir directamente en caja'}.
5. **Repartidores de Delivery (DoorDash, Uber Eats, Grubhub)**:
   - ${store.has_drive_thru ? `En esta sucursal (${store.name}), mientras el comedor esté abierto recogen en el mostrador; si el comedor ya cerró pero el Drive-Thru sigue abierto, pueden recoger por la ventanilla del Drive-Thru mostrando el nombre y código de la orden. Si la sucursal ya está totalmente cerrada, díselo con claridad.` : `En esta sucursal (${store.name}) NO tenemos Drive-Thru, por lo que todas las órdenes de DoorDash y Uber Eats se recogen en el mostrador dentro del horario de la tienda (usa el "Estado actual en vivo" de arriba). Si tiene algún inconveniente, ofrécele avisar en vivo al gerente.`}
   - Si quien llama es un CLIENTE con un problema en su pedido de DoorDash/Uber Eats (faltantes, cobro, orden equivocada), trátalo como reclamo (regla 6), no como repartidor.
6. **Reclamos de Órdenes, Cobros, Objetos Olvidados, Empleados (Retardos/Faltas), Proveedores o "quiero hablar con el gerente"**:
   - Si la persona YA proporcionó su nombre y un teléfono real de contacto, ejecuta DE INMEDIATO \`create_manager_callback\` con EXACTAMENTE el nombre, teléfono y detalle que dijo (NUNCA inventes ni completes datos) y ${callbackOutcomeInstruction}
   - Si aún NO ha dado su nombre o su número de teléfono de 10 dígitos, pídeselos con empatía en una sola frase corta ANTES de llamar \`create_manager_callback\`.
   - Si ya enviaste la alerta en esta misma llamada, no la vuelvas a enviar salvo que agregue datos nuevos: confirma que el gerente ya la tiene.
7. **Idioma y Agilidad Telefónica (REGLA CRÍTICA DE VELOCIDAD)**:
   - Idioma detectado del cliente: ${turnLangGuess === 'en' ? 'Inglés' : 'Español'}. Responde SIEMPRE en el mismo idioma en que te habló el cliente en su último mensaje (si te habló en inglés aunque la tienda inició en español, contéstale en inglés natural; si te habló en español, contéstale en español mexicano cálido).
   - Sé concisa y directa como una recepcionista real por teléfono: **12 a 28 palabras** (1 oración ágil o máximo 2 oraciones cortas; si el cliente pide explícitamente las direcciones de varias sucursales a la vez, ej. "de todas", proporciónale calle y ciudad de cada una de forma directa hasta ~75 palabras). NO agregues comerciales de relleno sobre tacosgavilan.com al final si el cliente solo preguntó precios, horarios o formas de pago. Sin viñetas, sin emojis ni markdown.
8. **Filtro Anti-Spam / Ventas Comerciales**:
   - Si llaman para vender servicios comerciales (SEO/Google, préstamos, paneles solares, garantías), declina con cortesía en una oración breve indicando que en sucursal no recibimos ofertas comerciales y NO ejecutes \`create_manager_callback\`.`

  // Convertir historial de transcripción a contents de Gemini (empezando siempre por un turno del usuario)
  const historyEntries = transcript.filter((t) => t.role === 'user' || t.role === 'assistant').slice(-8)
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
  // Presupuesto total del turno: Twilio espera la respuesta del webhook ~15 s
  const turnDeadline = turnStartedAt + 13000

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
        ...scheduleEval
      }
    }
    if (toolName === 'search_menu_item_price') {
      const q = String(toolArgs?.query || '')
      const matches = await searchStoreMenuPrices(store.id, q, 8)
      return { storeName: store.name, query: q, matchesFound: matches.length, items: matches }
    }
    if (toolName === 'get_fiesta_platter_packages') {
      const guestCount = Math.round(Number(toolArgs?.guest_count))
      return recommendFiestaPlatters(Number.isFinite(guestCount) && guestCount > 0 && guestCount <= 500 ? guestCount : null)
    }
    if (toolName === 'find_other_stores') {
      const [{ data: allStores }, { data: allSpecialHours }] = await Promise.all([
        supabaseAdmin.from('stores').select('id, name, address, phone, has_drive_thru, weekly_hours, is_active').order('id'),
        supabaseAdmin.from('phone_special_hours').select('*')
      ])
      const REGION_STORE_IDS: Record<string, number[]> = {
        'east la': [11, 13],
        'este de los angeles': [11, 13],
        'south la': [5, 6, 7],
        'sur de los angeles': [5, 6, 7],
        'downtown': [5, 6],
        'southeast la': [11, 12, 13, 14, 15, 16],
        'orange county': [9],
        'condado de orange': [9],
        'inland empire': [1],
        'san bernardino': [1],
        'san gabriel': [3, 4, 10],
        'sgv': [3, 4, 10]
      }
      const filterNorm = normalizeSearchText(toolArgs?.search_city_or_filter || '')
      const matchedRegionIds = Object.entries(REGION_STORE_IDS).find(([alias]) => filterNorm.includes(alias))?.[1] || null

      const filtered = (allStores || [])
        .filter((s: any) => s.is_active !== false)
        .filter((s: any) => {
          if (!filterNorm) return true
          if (filterNorm.includes('drive')) return Boolean(s.has_drive_thru)
          if (matchedRegionIds) return matchedRegionIds.includes(Number(s.id))
          return normalizeSearchText(`${s.name} ${cleanPhoneStoreName(s.name)} ${s.address}`).includes(filterNorm)
        })
        .map((s: any) => {
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
            todayHoursEs: ev.todayOpen === 'CLOSED' ? 'Cerrado hoy' : `${ev.todayOpenFormattedEs} - ${ev.todayCloseFormattedEs}`,
            todayHoursEn: ev.todayOpen === 'CLOSED' ? 'Closed today' : `${ev.todayOpenFormattedEn} - ${ev.todayCloseFormattedEn}`,
            statusMessageEs: ev.statusMessageEs,
            statusMessageEn: ev.statusMessageEn
          }
        })
      return { stores: filtered }
    }
    if (toolName === 'create_manager_callback') {
      const ensuredCall = await ensureCallRecord()
      const reasonSummary = String(toolArgs?.reason_summary || userText).trim()
      const argPhoneRaw = String(toolArgs?.caller_phone || '').trim()
      const argPhoneDigits = extractPhoneDigits(argPhoneRaw)
      const fallbackCallerDigits = source === 'twilio' && callerNumber ? extractPhoneDigits(callerNumber) : ''
      const resolvedPhoneRaw =
        argPhoneDigits.length >= 7
          ? argPhoneRaw
          : fallbackCallerDigits.length >= 7
            ? String(callerNumber).trim()
            : ''
      const resolvedPhoneNorm = normalizeUsPhoneE164(resolvedPhoneRaw)
      const cleanCallbackPhone = resolvedPhoneNorm.valid && resolvedPhoneNorm.normalized ? resolvedPhoneNorm.normalized : resolvedPhoneRaw

      // Anti-duplicados: si esta llamada ya tiene un recado pendiente, se anexa el detalle y se enriquecen campos faltantes
      const existingPending =
        callbackCreated ||
        (
          await supabaseAdmin
            .from('phone_callback_requests')
            .select('*')
            .eq('call_id', ensuredCall.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ).data

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

      // Validación estricta: NUNCA guardar un recado sin teléfono real de contacto (>= 7 dígitos)
      if (!cleanCallbackPhone || extractPhoneDigits(cleanCallbackPhone).length < 7) {
        return {
          success: false,
          missingCallerPhone: true,
          message:
            'Aún NO cuentas con un número telefónico real de contacto (mínimo 10 dígitos). Pídele amablemente su nombre y número de teléfono de 10 dígitos antes de registrar el recado.'
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
        willTransferLive: Boolean(liveTransferCandidatePhone),
        callbackId: callbackCreated.id,
        message: liveTransferCandidatePhone
          ? `Alerta registrada y transferencia en vivo ACTIVA: infórmale que ya registraste su aviso y que en este momento le transfieres la llamada con el gerente en turno de ${store.name} (NO te despidas).`
          : scheduleEval.isOpenNow
            ? `Alerta enviada en vivo a la pantalla del Manager de ${store.name}.`
            : `Recado prioritario registrado para el Manager de ${store.name}. IMPORTANTE: La sucursal está CERRADA ahora (${scheduleEval.statusMessageEs}); informa al cliente que el gerente le devolverá la llamada al reabrir.`
      }
    }
    if (toolName === 'flag_unanswered_question') {
      unansweredFlagged = String(toolArgs?.question_text || userText).slice(0, 300)
      return { recorded: true }
    }
    return { error: `Herramienta desconocida: ${toolName}` }
  }

  for (let round = 0; round < 3 && !replyText; round++) {
    let data: any
    try {
      ;({ data } = await callGeminiPhoneWithFailover(
        {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools: PHONE_AGENT_TOOLS,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024
          }
        },
        turnDeadline
      ))
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

  const shouldTransferToPhone = callbackWasNew && liveTransferCandidatePhone ? liveTransferCandidatePhone : null

  if (!replyText) {
    if (callbackCreated) {
      if (shouldTransferToPhone) {
        replyText =
          turnLangGuess === 'en'
            ? `I have logged your message and am connecting you with the ${store.name} manager on duty right now. Please hold for a moment.`
            : `Ya registré tu aviso y en este momento te estoy comunicando con el gerente en turno de ${store.name}. Un momento en la línea, por favor.`
      } else if (!scheduleEval.isOpenNow) {
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
      replyText =
        turnLangGuess === 'en'
          ? 'Sorry, I had a brief technical issue. Could you please repeat your question?'
          : 'Disculpa, tuve un problema técnico momentáneo. ¿Me puedes repetir tu pregunta, por favor?'
    } else {
      replyText =
        turnLangGuess === 'en'
          ? `${scheduleEval.statusMessageEn} How else can I help you?`
          : `${scheduleEval.statusMessageEs} ¿Te puedo ayudar con algo más?`
    }
  }

  const meta = inferCallMetadata(userText, toolsUsed, Boolean(callbackCreated))

  // Idioma FINAL = idioma real del texto generado (se detecta antes de acentuar topónimos como "Los Ángeles")
  const finalLang: PhoneLang = detectPhoneTextLanguage(replyText, turnLangGuess)
  // Sanitizar muletillas iniciales ("¡Sí!", "¡Claro que sí!", "Hola."), expandir abreviaturas viales y recortar en fin de oración
  replyText = clampPhoneReplyLength(sanitizePhoneReplyText(replyText, finalLang), 620)

  transcript.push({
    role: 'assistant',
    text: replyText,
    timestamp: new Date().toISOString()
  })

  const shouldHangup =
    !shouldTransferToPhone &&
    (meta.primaryIntent === 'spam' ||
      (!/[?¿]/.test(userText) &&
        /\b(gracias es todo|eso es todo|nada mas gracias|bye|goodbye|thank you that is all|thats all|adios)\b/i.test(
          normalizeSearchText(userText)
        )))

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

  const updatePayload: Record<string, any> = {
    language: finalLang,
    caller_category:
      finalCallRecord.caller_category && finalCallRecord.caller_category !== 'customer' && meta.callerCategory === 'customer'
        ? finalCallRecord.caller_category
        : meta.callerCategory,
    primary_intent:
      finalCallRecord.primary_intent && finalCallRecord.primary_intent !== 'general'
        ? finalCallRecord.primary_intent
        : meta.primaryIntent,
    status: nextStatus,
    resolved_by_ai: wasTransferred || callbackEverRequested ? false : meta.resolvedByAi,
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
    const { error: updateErr } = await supabaseAdmin.from('phone_calls').update(updatePayload).eq('id', finalCallRecord.id)
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

/**
 * Construye la URL firmada de audio telefónico (`/api/phone/tts?lang&voice&text&sig`).
 */
export function buildPhoneTtsUrl(baseUrl: string, text: string, lang: PhoneLang, voice: string = 'Kore'): string {
  const cleanText = String(text || '').trim()
  const sig = signPhoneTtsParams(cleanText, lang, voice)
  return `${baseUrl}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(cleanText)}&sig=${sig}`
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
