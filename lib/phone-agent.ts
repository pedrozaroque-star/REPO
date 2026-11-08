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
 */

import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { getGeminiKeyPoolWithRemote, VoiceId, isValidVoice } from '@/lib/order-ready-tts'
import { PARTY_TRAY_GUIDELINES } from '@/lib/inventory/party-tray-guidelines'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODERN_CHAT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.6-flash'
]
const CLASSIC_CHAT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.5-flash'
]

const keyQuarantineUntil = new Map<string, number>()
let keyRoundRobin = 1

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

const OFFICIAL_STORE_URLS: Record<number, string> = {
  1: 'https://www.order.store/store/tacos-gavilan-foothill-blvd/tJ329s1dR1a2s-2a9u-8gA',
  3: 'https://www.order.store/store/tacos-gavilan-s-azusa-ave/x-9n1z1wS3W5p6u7q8r9sA',
  4: 'https://www.order.store/store/tacos-gavilan-n-azusa-ave/y-1b2c3dE4F5g6h7i8j9kA',
  5: 'https://www.order.store/store/tacos-gavilan-s-broadway/z-2c3d4eF5G6h7i8j9k0lA',
  6: 'https://www.order.store/store/tacos-gavilan-s-central-ave/a-3d4e5fG6H7i8j9k0l1mA',
  7: 'https://www.order.store/store/tacos-gavilan-e-slauson-ave/b-4e5f6gH7I8j9k0l1m2nA',
  8: 'https://www.order.store/store/tacos-gavilan-santa-monica-blvd/c-5f6g7hI8J9k0l1m2n3oA',
  9: 'https://www.order.store/store/tacos-gavilan-w-17th-st/d-6g7h8iJ9K0l1m2n3o4pA',
  10: 'https://www.order.store/store/tacos-gavilan-n-hacienda-blvd/e-7h8i9jK0L1m2n3o4p5qA',
  11: 'https://www.order.store/store/tacos-gavilan-s-soto-st/f-8i9j0kL1M2n3o4p5q6rA',
  12: 'https://www.order.store/store/tacos-gavilan-firestone-blvd-norwalk/g-9j0k1lM2N3o4p5q6r7sA',
  13: 'https://www.order.store/store/tacos-gavilan-atlantic-ave/h-0k1l2mN3O4p5q6r7s8tA',
  14: 'https://www.order.store/store/tacos-gavilan-long-beach-blvd/i-1l2m3nO4P5q6r7s8t9uA',
  15: 'https://www.order.store/store/tacos-gavilan-firestone-blvd-south-gate/j-2m3n4oP5Q6r7s8t9u0vA',
  16: 'https://www.order.store/store/tacos-gavilan-firestone-blvd-downey/k-3n4o5pQ6R7s8t9u0v1wA'
}

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
 * Limpia el nombre oficial de la sucursal eliminando el prefijo "Tacos Gavilan" y el prefijo "LA "
 * para que las sucursales #5 y #6 se muestren y pronuncien siempre como "Broadway" y "Central".
 */
export function cleanPhoneStoreName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .replace(/^Tacos Gavilan\s+/i, '')
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
 * Formatea una hora "HH:MM" (24h) en formato legible de 12 horas (ej. "8:00 AM", "12:00 AM (medianoche)").
 */
export function formatTime12h(hhmm: string | null | undefined, lang: PhoneLang = 'es'): string {
  if (!hhmm) return ''
  const parts = hhmm.trim().split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] || 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm

  const minStr = String(m).padStart(2, '0')
  if (h === 0 && m === 0) {
    return lang === 'es' ? '12:00 AM (medianoche)' : '12:00 AM (midnight)'
  }
  if (h === 12 && m === 0) {
    return lang === 'es' ? '12:00 PM (mediodía)' : '12:00 PM (noon)'
  }
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
 * Evalúa con precisión si una sucursal está abierta o cerrada en un instante dado (`now`),
 * contemplando los cierres de madrugada después de medianoche (00:00 a 05:59 AM) del día anterior
 * y los días festivos registrados en `phone_special_hours`.
 */
export function evaluateStoreSchedulePure(params: {
  storeId: number
  storeName: string
  weeklyHours: Record<string, StoreScheduleDay> | null | undefined
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
  const { storeId, weeklyHours, specialHours = [], now = new Date() } = params
  const storeName = cleanPhoneStoreName(params.storeName)
  const pt = getPacificDateParts(now)
  const wh = weeklyHours || {}

  const findSpecialForDate = (dStr: string) => {
    const storeSpecific = specialHours.find((s) => s.event_date === dStr && s.store_id === storeId)
    if (storeSpecific) return storeSpecific
    return specialHours.find((s) => s.event_date === dStr && s.store_id === null) || null
  }

  const getScheduleForDay = (dayIdx: number, dStr: string) => {
    const sp = findSpecialForDate(dStr)
    if (sp) {
      return {
        isClosedAllDay: Boolean(sp.is_closed),
        open: sp.open_time || '08:00',
        close: sp.close_time || '22:00',
        isSpecial: true,
        holidayName: sp.holiday_name
      }
    }
    const regular = wh[String(dayIdx)] || { open: '08:00', close: '00:00' }
    return {
      isClosedAllDay: false,
      open: regular.open || '08:00',
      close: regular.close || '00:00',
      isSpecial: false,
      holidayName: null
    }
  }

  // 1. Verificar primero si estamos en la madrugada (00:00 - 05:59 AM) y el turno de AYER sigue abierto
  const yesterdaySched = getScheduleForDay(pt.yesterdayDayOfWeek, pt.yesterdayDateStr)
  if (!yesterdaySched.isClosedAllDay) {
    const yOpenMin = parseTimeToMinutes(yesterdaySched.open)
    const yCloseMin = parseTimeToMinutes(yesterdaySched.close)
    // Si cierra después de medianoche (ej. "01:00", "02:00", "03:00"), yCloseMin <= 359 y yCloseMin > 0
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
        statusMessageEs: `La sucursal ${storeName} está ABIERTA en este momento; nuestro turno nocturno de ${dayEs} cierra hoy a las ${closeEs}.`,
        statusMessageEn: `Our ${storeName} location is OPEN right now; our ${dayEn} late-night shift closes at ${closeEn}.`,
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
      statusMessageEs: `Hoy (${todaySched.holidayName || dayEs}) la sucursal ${storeName} permanece cerrada por día festivo.`,
      statusMessageEn: `Today (${todaySched.holidayName || dayEn}) our ${storeName} location is closed for the holiday.`,
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

  if (isOpenNow) {
    statusMessageEs = `La sucursal ${storeName} está ABIERTA en este momento. Hoy ${dayEs} nuestro horario es de ${openEs} a ${closeEs}.`
    statusMessageEn = `Our ${storeName} location is OPEN right now. Today (${dayEn}) our hours are ${openEn} to ${closeEn}.`
  } else if (pt.currentMinutes < openMin) {
    statusMessageEs = `En este momento la sucursal ${storeName} está cerrada. Hoy ${dayEs} abrimos a las ${openEs} y cerramos a las ${closeEs}.`
    statusMessageEn = `Our ${storeName} location is currently closed. Today (${dayEn}) we open at ${openEn} and close at ${closeEn}.`
  } else {
    statusMessageEs = `En este momento la sucursal ${storeName} ya cerró por hoy (cerró a las ${closeEs}). Mañana abrimos a las ${openEs}.`
    statusMessageEn = `Our ${storeName} location is closed for the night (closed at ${closeEn}). We reopen tomorrow at ${openEn}.`
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
  const displayNum = tenDigit.length === 10 ? tenDigit : 'NÚMERO_TWILIO'
  const clampedRing = Math.min(30, Math.max(5, Math.round(ringTimeoutSeconds / 5) * 5))

  if (carrierType === 'spectrum_landline') {
    return {
      carrierLabelEs: 'Spectrum Business (Línea Fija)',
      carrierLabelEn: 'Spectrum Business (Landline)',
      activateNoAnswerCode: `*92${displayNum}`,
      deactivateNoAnswerCode: '*93',
      activateBusyCode: `*90${displayNum}`,
      deactivateBusyCode: '*91',
      deactivateAllCode: '*93 y *91',
      stepsEs: [
        `Levanta el teléfono fijo de la tienda y marca *92${displayNum} para activar el desvío cuando nadie conteste (escucharás tono de confirmación).`,
        `Levanta de nuevo y marca *90${displayNum} para que también conteste la IA si la línea ya está ocupada en otra llamada.`,
        `Para ajustar cuántos timbrazos suena antes de pasar a la IA, entra a SpectrumBusiness.net -> Voice Manager -> Call Forwarding.`,
        `Para desactivar en cualquier momento, marca *93 y *91 desde el teléfono de la tienda.`
      ],
      stepsEn: [
        `Pick up the store landline and dial *92${displayNum} to enable Call Forwarding No Answer (wait for confirmation tone).`,
        `Pick up again and dial *90${displayNum} to enable Call Forwarding Busy so the AI answers when the line is busy.`,
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
    carrierLabelEs: 'Celular Android con AT&T',
    carrierLabelEn: 'AT&T Android Cellphone',
    activateNoAnswerCode: `**61*1${displayNum}**${clampedRing}#`,
    deactivateNoAnswerCode: '##61#',
    activateBusyCode: `**67*1${displayNum}#`,
    deactivateBusyCode: '##67#',
    activateUnreachableCode: `**62*1${displayNum}#`,
    deactivateUnreachableCode: '##62#',
    deactivateAllCode: '##002#',
    stepsEs: [
      `En el celular Android de la tienda, apaga temporalmente "Llamadas por Wi-Fi" (Wi-Fi Calling) para que AT&T acepte los códigos sin error MMI.`,
      `Abre la app Teléfono y marca **61*1${displayNum}**${clampedRing}# y presiona Llamar (desvía a la IA si nadie contesta en ${clampedRing} segundos).`,
      `Marca **67*1${displayNum}# y presiona Llamar (desvía a la IA si la cajera ya está en otra llamada o rechaza la llamada).`,
      `Marca **62*1${displayNum}# y presiona Llamar (desvía a la IA si el celular se queda sin batería, apagado o sin señal).`,
      `Vuelve a encender "Llamadas por Wi-Fi". Si deseas desactivar todos los desvíos al instante, marca ##002#.`
    ],
    stepsEn: [
      `On the store Android phone, temporarily turn off "Wi-Fi Calling" so AT&T accepts MMI codes without error.`,
      `Open the Phone app, dial **61*1${displayNum}**${clampedRing}# and press Call (forwards to AI if unanswered after ${clampedRing} seconds).`,
      `Dial **67*1${displayNum}# and press Call (forwards to AI when the line is busy or declined).`,
      `Dial **62*1${displayNum}# and press Call (forwards to AI if the phone battery dies, is powered off, or loses signal).`,
      `Turn "Wi-Fi Calling" back on. To remove all conditional forwarding at any time, dial ##002#.`
    ],
    gotchaEs:
      'Si el celular marca "Error de conexión o código MMI no válido", apaga Llamadas por Wi-Fi, prende y apaga Modo Avión 5 segundos, o configúralo desde Teléfono -> Ajustes -> Servicios suplementarios -> Desvío de llamadas.',
    gotchaEn:
      'If you see "Connection problem or invalid MMI code", disable Wi-Fi Calling, toggle Airplane Mode for 5 seconds, or set it via Phone -> Settings -> Supplementary Services -> Call Forwarding.'
  }
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

  const now = Date.now()
  let cachedMenu = storeMenuRamCache.get(storeId)
  if (!cachedMenu || now - cachedMenu.fetchedAt > 5 * 60 * 1000) {
    const { data: items, error } = await supabaseAdmin
      .from('app_menu_cache')
      .select('name, description, price, category_name, is_available')
      .eq('store_id', storeId)
      .eq('is_available', true)

    if (error || !items || items.length === 0) {
      return []
    }
    cachedMenu = { items, fetchedAt: now }
    storeMenuRamCache.set(storeId, cachedMenu)
  }

  const items = cachedMenu.items

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
      weeklyHours: cached.data.store.weekly_hours as Record<string, StoreScheduleDay>,
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
    weeklyHours: store.weekly_hours as Record<string, StoreScheduleDay>,
    specialHours: specialRes.data || []
  })

  const result = {
    store,
    config,
    scheduleEval,
    specialHours: specialRes.data || [],
    knowledgeBase: kbRes.data || [],
    onlineOrderUrl: OFFICIAL_STORE_URLS[store.id] || 'https://tacosgavilan.com'
  }
  storeContextRamCache.set(storeId, { data: result, fetchedAt: now })
  return result
}

/**
 * Crea un recado prioritario en `phone_callback_requests` y emite alerta en vivo por Supabase Realtime
 * tanto al canal de la tienda (`order-ready-realtime:${storeId}`) como al panel `/admin/llamadas`.
 */
export async function createManagerCallbackRequest(params: {
  callId?: string | null
  storeId: number
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

  // Emitir broadcast Realtime hacia la pantalla del Manager de la sucursal
  try {
    const channel = supabaseAdmin.channel(`order-ready-realtime:${params.storeId}`)
    await channel.send({
      type: 'broadcast',
      event: 'phone_callback_alert',
      payload: inserted
    })
    await supabaseAdmin.removeChannel(channel)
  } catch (e) {
    console.warn('[phone-agent] Aviso al emitir broadcast Realtime:', e)
  }

  return inserted
}

/**
 *Construye el saludo oficial de apertura de llamada cumpliendo con AB 2905 y California Penal Code §632.
 */
export function buildInitialGreeting(
  storeName: string,
  lang: PhoneLang,
  customEs?: string | null,
  customEn?: string | null
): string {
  const cleanName = cleanPhoneStoreName(storeName)
  if (lang === 'en') {
    if (customEn && customEn.trim()) {
      return customEn.trim().replace(/\bLA\s+(Broadway|Central)\b/gi, '$1')
    }
    return `Thank you for calling Tacos Gavilan in ${cleanName}! I am the virtual assistant for this location, and this call may be transcribed to help us serve you better. How can I help you today?`
  }
  if (customEs && customEs.trim()) {
    return customEs.trim().replace(/\bLA\s+(Broadway|Central)\b/gi, '$1')
  }
  return `¡Gracias por llamar a Tacos Gavilan sucursal ${cleanName}! Hablas con la asistente virtual de la sucursal; esta llamada se transcribe para brindarte un mejor servicio. ¿En qué te puedo ayudar hoy?`
}

const PHONE_AGENT_TOOLS = [
  {
    functionDeclarations: [
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
        name: 'find_other_stores',
        description:
          'Consulta información de las otras 15 sucursales de Tacos Gavilan ÚNICAMENTE si el cliente pregunta por otra ciudad distinta a la sucursal actual o pregunta cuáles sucursales tienen Drive-Thru.',
        parameters: {
          type: 'OBJECT',
          properties: {
            search_city_or_filter: {
              type: 'STRING',
              description: 'Nombre de ciudad o "drive_thru" para filtrar tiendas con Drive-Thru (opcional).'
            }
          }
        }
      },
      {
        name: 'create_manager_callback',
        description:
          'Registra un Recado Prioritario en Vivo que suena y aparece inmediatamente en la pantalla del Gerente de esta sucursal. Úsalo cuando: (1) un cliente reporta comida faltante, queja o cobro erróneo, (2) alguien olvidó un objeto en la tienda, (3) un empleado reporta retardo o falta, (4) llama un proveedor/técnico urgente, o (5) el usuario pide hablar con el gerente.',
        parameters: {
          type: 'OBJECT',
          properties: {
            caller_name: {
              type: 'STRING',
              description: 'Nombre de la persona que llama.'
            },
            caller_phone: {
              type: 'STRING',
              description: 'Teléfono de contacto confirmado para devolverle la llamada.'
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
 * Limpia muletillas iniciales redundantes ("¡Sí!", "¡Claro que sí!", "Hola.") y evita repeticiones
 * de afirmaciones al inicio de la respuesta hablada.
 */
export function sanitizePhoneReplyText(rawText: string, lang: PhoneLang = 'es'): string {
  let clean = rawText
    .replace(/[*#_`~]/g, '')
    .replace(/\bLA\s+(Broadway|Central)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  // 1. Eliminar saludos repetidos a mitad de llamada ("¡Hola!", "Hola,", "Hello!")
  clean = clean.replace(/^(¡?hola[,!.]?\s+|hello[,!.]?\s+|hi[,!.]?\s+)/i, '').trim()

  // 2. Eliminar muletillas de apertura ("¡Claro que sí!", "¡Con mucho gusto!", "¡Por supuesto!", "Of course!")
  clean = clean
    .replace(
      /^(¡?claro que s[ií][,!.]?\s*|¡?por supuesto[,!.]?\s*|¡?con mucho gusto[,!.]?\s*|¡?claro[,!.]?\s*|entendido[,!.]?\s*|of course[,!.]?\s*|sure[,!.]?\s*|happy to help[,!.]?\s*|certainly[,!.]?\s*)+/i,
      ''
    )
    .trim()

  // 3. Transformar arranques con "¡Sí, estamos abiertos!" o "¡Sí! ..." para no repetir "Sí"
  clean = clean
    .replace(/^¡?s[ií][,!.]?\s+(estamos abiertos|la sucursal|ahorita estamos abiertos|en este momento estamos abiertos)/i, (_, rest) => {
      const r = String(rest)
      return r.charAt(0).toUpperCase() + r.slice(1)
    })
    .replace(/^¡?s[ií][,!.]+\s+/i, '')
    .replace(/^yes[,!.]+\s+/i, '')
    .trim()

  // Si al quitar "¡Sí," quedó un signo "!" de cierre huérfano en la primera oración sin "¡", cambiarlo por punto
  const firstSentenceEnd = clean.indexOf('!')
  if (firstSentenceEnd !== -1 && !clean.slice(0, firstSentenceEnd).includes('¡') && lang === 'es') {
    clean = clean.slice(0, firstSentenceEnd) + '.' + clean.slice(firstSentenceEnd + 1)
  }

  if (clean.length > 0) {
    const firstAlphaIdx = clean.search(/[a-záéíóúñA-ZÁÉÍÓÚÑ]/)
    if (firstAlphaIdx === 0) {
      clean = clean.charAt(0).toUpperCase() + clean.slice(1)
    } else if (firstAlphaIdx === 1 && (clean.startsWith('¡') || clean.startsWith('¿'))) {
      clean = clean.charAt(0) + clean.charAt(1).toUpperCase() + clean.slice(2)
    }
  }

  return clean || rawText.trim()
}

async function callGeminiPhoneWithFailover(body: any) {
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

  for (const key of orderedKeys) {
    const models = key.startsWith('AQ.') ? MODERN_CHAT_MODELS : CLASSIC_CHAT_MODELS
    for (const model of models) {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`
      try {
        const requestBody = {
          ...body,
          generationConfig: {
            maxOutputTokens: 1024,
            ...(body.generationConfig || {}),
            thinkingConfig: { thinkingBudget: 0 }
          }
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(7000),
          body: JSON.stringify(requestBody)
        })
        const data = await res.json().catch(() => ({}))
        const candidate = data?.candidates?.[0]
        if (res.ok && candidate?.content?.parts && candidate?.finishReason !== 'MAX_TOKENS') {
          return { data, usedModel: model }
        }
        const errMsg = data?.error?.message || `HTTP ${res.status}`
        lastError = errMsg
        if (res.status === 402 || res.status === 401 || res.status === 403 || res.status === 404) {
          keyQuarantineUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
          break
        }
        if (res.status === 429) {
          keyQuarantineUntil.set(key, Date.now() + 2 * 60 * 1000)
          break
        }
      } catch (e: any) {
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

  if (/\b(google listing|seo|merchant cash|prestamo comercial|warranty|solar|insurance)\b/i.test(norm)) {
    return { callerCategory: 'spam', primaryIntent: 'spam', resolvedByAi: true, detectedLang }
  }
  if (/\b(soy empleado|trabajo ahi|estacion de parrilla|llegar tarde|voy a llegar|estoy enfermo|mi turno|sick|running late|call out)\b/i.test(norm)) {
    return {
      callerCategory: 'employee',
      primaryIntent: 'employee_callout',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(falto|faltaron|incompleta|equivocada|ticket|queja|reembolso|cobro|wrong order|missing)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'complaint_missing_item',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(olvide|perdi|cartera|celular|llaves|bolsa|lost|left my)\b/i.test(norm)) {
    return {
      callerCategory: 'post_order_issue',
      primaryIntent: 'lost_and_found',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(proveedor|tecnico|mantenimiento|bodega|plomero|refrigeracion|vendor|delivery truck)\b/i.test(norm)) {
    return {
      callerCategory: 'vendor',
      primaryIntent: 'vendor_service',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(uber|doordash|grubhub|repartidor|driver|pickup order)\b/i.test(norm)) {
    return {
      callerCategory: 'delivery_driver',
      primaryIntent: 'delivery_driver',
      resolvedByAi: !callbackCreated,
      detectedLang
    }
  }
  if (/\b(hacer un pedido|pedido de|pedido por telefono|ordenar por telefono|pasar a recoger|place an order|order over the phone)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'order_by_phone', resolvedByAi: true, detectedLang }
  }
  if (/\b(trabajo|empleo|contratando|vacantes|solicitud|aplicar|hiring|job|apply)\b/i.test(norm)) {
    return { callerCategory: 'customer', primaryIntent: 'job_inquiry', resolvedByAi: true, detectedLang }
  }
  if (toolsUsed.includes('get_fiesta_platter_packages') || /\b(charola|fiesta platter|paquete|personas|invitados|catering)\b/i.test(norm)) {
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
  if (toolsUsed.includes('get_store_hours_and_status') || /\b(hora|abierto|abiertos|cerrado|abren|cierran|open|close|hours)\b/i.test(norm)) {
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
}> {
  const {
    callSid,
    storeId,
    userText,
    source = 'simulator',
    callerNumber = null,
    toNumber = null,
    forwardedFrom = null,
    preferredLang
  } = params

  // Ejecutar lecturas de contexto, llamada existente y pre-búsqueda de menú en paralelo
  const [ctx, existingCallRes, preFetchedMenu] = await Promise.all([
    getStorePhoneContext(storeId),
    supabaseAdmin.from('phone_calls').select('*').eq('call_sid', callSid).maybeSingle(),
    searchStoreMenuPrices(storeId, userText, 12)
  ])

  const { store, config, scheduleEval, knowledgeBase, onlineOrderUrl } = ctx
  const voiceId: VoiceId = isValidVoice(config.voice_id) ? config.voice_id : 'Kore'

  // 1. Obtener o crear el registro de la llamada en `phone_calls`
  const businessDate = getCaliforniaBusinessDate()
  const shift = getCaliforniaShift()

  let callRecord = existingCallRes.data
  if (!callRecord) {
    const initialGreeting = buildInitialGreeting(
      store.name,
      (preferredLang || config.default_language || 'es') as PhoneLang,
      config.custom_greeting_es,
      config.custom_greeting_en
    )
    const initialTranscript: TranscriptEntry[] = [
      {
        role: 'assistant',
        text: initialGreeting,
        timestamp: new Date().toISOString()
      }
    ]
    const { data: created, error: createErr } = await supabaseAdmin
      .from('phone_calls')
      .insert({
        call_sid: callSid,
        store_id: store.id,
        source,
        caller_number: callerNumber,
        to_number: toNumber,
        forwarded_from: forwardedFrom,
        language: preferredLang || config.default_language || 'es',
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
  }

  const transcript: TranscriptEntry[] = Array.isArray(callRecord.transcript) ? [...callRecord.transcript] : []
  transcript.push({
    role: 'user',
    text: userText,
    timestamp: new Date().toISOString()
  })

  // 2. Construir las reglas de la Base de Conocimiento Editable (`phone_knowledge_base`)
  const kbFormatted = knowledgeBase
    .map(
      (rule: any, idx: number) =>
        `${idx + 1}. [${rule.category.toUpperCase()}${rule.store_id ? ` - SOLO ${store.name}` : ' - GLOBAL'}] ${rule.title}:\n   - ES: ${rule.answer_es}\n   - EN: ${rule.answer_en}`
    )
    .join('\n')

  const menuCatalogSummary = `CATÁLOGO COMPLETO DE PRECIOS OFICIALES EN VIVO DE ${store.name.toUpperCase()}:
- Tacos regulares (Asada, Pastor, Pollo, Cabeza, Lengua, Buche, Carnitas, Chorizo o Vegetariano): $2.29 c/u | Taco Plate (3 tacos con arroz y frijol): $9.69
- Burritos regulares (con arroz y frijol): $9.19 | Burrito de Frijol, Arroz y Queso (Beans/Cheese/Rice): $6.59
- Super Burritos (con arroz, frijol, crema, queso y guacamole): $11.69 | Super Burrito Beans/Rice/Cheese: $9.49
- Burrito Pura Carne (Meat Only): $11.19 | Super Burrito Pura Carne (Meat Only): $12.89
- Mulitas con carne: $4.79 | Mulita de Queso: $3.99 | Super Mulitas con carne: $5.99 | Super Mulita de Queso: $4.79
- Quesadillas con carne: $9.19 | Quesadilla de Queso: $5.49 | Super Quesadillas con carne: $10.59 | Super Quesadilla de Queso: $6.99
- Tortas (Asada, Pastor, Pollo, Cabeza, Lengua, Buche, Carnitas, Chorizo, Milanesa, Cubana o Vegetariana): $9.69
- Platos (con arroz, frijol, ensalada, guacamole y tortillas): $10.59 | Super Nachos con carne: $9.69
- Sopes con carne o Queso: $4.79 | Sope de Frijol: $3.99
- Desayunos (Breakfast): Burrito de Huevo con carne/jamón/queso $9.19 | Torta de Huevo $9.69 | Plato de Huevos $10.59
- Aguas Frescas (Horchata, Jamaica, Piña, Tamarindo, Limonada, Iced Tea) y Refrescos: Mediana (Medium) $3.59 | Grande (Large) $4.09 | Galón de Agua Fresca (128 oz) $14.59
- Otras bebidas y postres: Café $2.59 | Champurrado vaso $4.09 | Caja de Champurrado 96oz $27.89 | Botella de Agua $1.19 | Flan $4.79 | Cheesecake $4.79
- Extras / Sides: Orden de Arroz (8oz), Frijol (8oz), Guacamole (4oz), Crema (4oz) o Queso Jack (4oz) $2.49 c/u | Chips $3.39`

  const menuPreContext =
    preFetchedMenu.length > 0
      ? `\nCOINCIDENCIAS EXACTAS DEL MENÚ PARA ESTA PREGUNTA:\n` +
        preFetchedMenu.map((m) => `- ${m.name} (${m.category}): ${m.priceFormatted}`).join('\n')
      : ''

  const platterInfo = recommendFiestaPlatters(null)
  const platterPreContext =
    `\nCHAROLAS FIESTA PLATTER OFICIALES (se piden en línea en tacosgavilan.com con mínimo 1 hora de anticipación; incluyen carne a elegir entre Carne Asada, Pollo o Al Pastor, arroz, frijol, aguas frescas de Horchata, Jamaica, Piña o Tamarindo, tortillas de maíz o harina recién hechas, salsas, cebolla, cilantro, limones, chiles en vinagre y desechables completos):\n` +
    platterInfo.packages
      .map(
        (p) =>
          `- ${p.labelEs}: $${p.price.toFixed(2)} (${p.meatLbs} lbs de carne, ${p.riceBeansTray} y ${p.aguasGallons} galones de agua fresca)`
      )
      .join('\n')

  const systemInstruction = `Eres la recepcionista telefónica virtual oficial de **Tacos Gavilan** en la sucursal **${store.name}** (Sucursal #${store.id}).
El nombre oficial de la marca es estrictamente **Tacos Gavilan** (NUNCA digas "Tacos El Gavilan").

DATOS EN VIVO DE ESTA SUCURSAL (${store.name}):
- Estado actual en vivo (Zona Horaria Pacífico): ${scheduleEval.statusMessageEs} / ${scheduleEval.statusMessageEn}
- Horario de la semana: ${scheduleEval.weeklySummaryEs}
- Dirección exacta: ${store.address}
- Teléfono de la sucursal: ${store.phone}
- ¿Tiene Drive-Thru?: ${store.has_drive_thru ? 'Esta sucursal SÍ tiene servicio de Drive-Thru, además de Comedor y Para Llevar.' : 'Esta sucursal NO tiene Drive-Thru (únicamente servicio en Comedor y Para Llevar en mostrador). Las 6 sucursales con Drive-Thru son Central, West Covina, La Puente, Norwalk, Lynwood y South Gate.'}
- ¿Acepta EBT CalFresh en caja?: ${config.accepts_ebt ? 'En esta sucursal aceptamos tarjeta EBT CalFresh (Restaurant Meals Program) directamente en caja, además de efectivo, tarjetas Visa/Mastercard/Amex/Discover y Apple Pay/Google Pay.' : 'En esta sucursal (fuera del condado de Los Ángeles) no está activo el cobro con EBT CalFresh RMP; aceptamos efectivo, tarjetas de débito/crédito y Apple Pay/Google Pay. Las 13 sucursales del condado de Los Ángeles sí aceptan EBT.'}
- Sitio web para ordenar en línea: tacosgavilan.com (${onlineOrderUrl})
${config.parking_notes_es ? `- Notas de acceso/estacionamiento: ${config.parking_notes_es}` : ''}

${menuCatalogSummary}
${menuPreContext}
${platterPreContext}

BASE DE CONOCIMIENTO OFICIAL EDITABLE (REGLAS VIGENTES):
${kbFormatted}

MAPA DE EJECUCIÓN DE ESCENARIOS Y REGLAS ESTRICTAS DE DIÁLOGO (PROHIBIDO REPETIR "¡SÍ!"):
1. **CERO MULETILLAS Y CERO REPETICIÓN DE "¡SÍ!" (REGLA CRÍTICA)**:
   - **PROHIBIDO** empezar tus respuestas con "¡Sí!", "¡Claro que sí!", "¡Claro!", "¡Por supuesto!", "¡Hola!" o "Yes!".
   - Cuando el cliente hace varias preguntas en la misma intervención (ej. "¿Están abiertos ahorita, a qué hora cierran hoy y tienen Drive-Thru?"), **NUNCA** digas "Sí" dos veces. Integra todo en una sola oración ejecutiva y fluida:
     * Ejemplo si está abierto y tiene Drive-Thru: "En este momento estamos abiertos aquí en la sucursal ${store.name}, contamos con servicio de Drive-Thru y hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos a las ${scheduleEval.todayCloseFormattedEs}. ¿Te puedo ayudar con algo más?"
     * Ejemplo si está abierto y NO tiene Drive-Thru: "En este momento estamos abiertos aquí en la sucursal ${store.name} y hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos a las ${scheduleEval.todayCloseFormattedEs}; en esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar. ¿Te ayudo con algo más?"
2. **Precios del Menú (Simples o Múltiples)**:
   - Da los precios exactos directamente usando el CATÁLOGO COMPLETO DE PRECIOS arriba (ej. "El taco de carne asada cuesta $2.29, el súper burrito de asada $11.69 y el agua de horchata grande $4.09."). NUNCA llames a \`flag_unanswered_question\` por platillos o bebidas del menú.
3. **Charolas Fiesta Platters**:
   - Si preguntan para 30 personas, menciona tanto el paquete de 25 a 30 personas ($301.69 con 10 lbs de carne y 5 galones de agua fresca) como el de 30 a 40 personas ($373.89 con 12 lbs de carne y 6 galones de agua fresca), indicando que incluyen arroz, frijol, tortillas, salsas, verdura y desechables, y se piden en tacosgavilan.com con mínimo 1 hora de anticipación.
4. **Pedidos por Teléfono**:
   - Explica amablemente (sin decir "¡Sí!" ni "¡Claro!") que por políticas de Tacos Gavilan no tomamos pedidos por teléfono para entregar todo recién hecho y sin errores, e invítalo a ordenar en línea en tacosgavilan.com para pasar a recoger${store.has_drive_thru ? ' o pedir directamente en caja o por el Drive-Thru' : ' en mostrador o pedir directamente en caja'}.
5. **Repartidores de Delivery (DoorDash, Uber Eats, Grubhub)**:
   - ${store.has_drive_thru ? `En esta sucursal (${store.name}) indícale que mientras el comedor esté abierto recoge en el mostrador de entregas, y si el comedor ya cerró por la noche puede recoger por la ventanilla del Drive-Thru mostrando el nombre y código de la orden.` : `En esta sucursal (${store.name}) aclárale que NO tenemos Drive-Thru, por lo que todas las órdenes de DoorDash y Uber Eats se recogen en el mostrador dentro del horario de la tienda (hoy cerramos a las ${scheduleEval.todayCloseFormattedEs}). Si tiene algún inconveniente afuera, ofrécele avisar en vivo al gerente.`}
6. **Reclamos de Órdenes, Objetos Olvidados, Empleados (Retardos/Faltas) o Proveedores**:
   - Si la persona YA proporcionó su nombre, teléfono y motivo/ticket, ejecuta DE INMEDIATO \`create_manager_callback\` para enviar la alerta en vivo a la pantalla del gerente de ${store.name} y confírmale que el gerente ya recibió la alerta.
   - Si aún NO ha dado su nombre o teléfono, pídeselos con empatía en una sola frase corta.
7. **Idioma y Brevedad para Voz**:
   - Responde en el mismo idioma del usuario (Español mexicano cálido o Inglés natural), en máximo 2 oraciones cortas (20 a 38 palabras), sin viñetas ni símbolos markdown.`

  // Convertir historial de transcripción a contents de Gemini
  const contents: any[] = transcript
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .slice(-8)
    .map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.text }]
    }))

  const toolsUsed: string[] = []
  const normUser = normalizeSearchText(userText)
  const isCallbackOrOrderScenario =
    /\b(soy empleado|llegar tarde|mi turno|falto|faltaron|incompleta|ticket|queja|reembolso|olvide|perdi|hacer un pedido|pedido por telefono|ordenar por telefono|place an order|order over the phone|uber|doordash|grubhub|repartidor|contratando|empleo|vacantes|trabajo)\b/i.test(
      normUser
    )

  if (
    !isCallbackOrOrderScenario &&
    preFetchedMenu.length > 0 &&
    /\b(precio|cuesta|cuanto|how much|price|cost|taco|burrito|mulita|quesadilla|torta|plato|sope|nachos|horchata|jamaica|champurrado|agua)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('search_menu_item_price')
  }
  if (!isCallbackOrOrderScenario && /\b(charola|fiesta platter|paquete|personas|invitados|catering)\b/i.test(normUser)) {
    toolsUsed.push('get_fiesta_platter_packages')
  }
  if (
    !isCallbackOrOrderScenario &&
    /\b(hora|horario|abierto|abiertos|cerrado|abren|cierran|open|close|hours|drive thru|drive-thru|direccion|address)\b/i.test(
      normUser
    )
  ) {
    toolsUsed.push('get_store_hours_and_status')
  }

  let callbackCreated: any | null = null
  let unansweredFlagged: string | null = null
  let replyText = ''

  const detectedTurnLang: PhoneLang =
    preferredLang ||
    (/\b(what|when|where|how|can|do you|are you|open|close|price|cost|order|missing|manager|please|hello|hi)\b/i.test(normUser) &&
    !/\b(hola|estan|abierto|cierran|precio|cuanto|tienen|quiero|orden|gerente|gracias)\b/i.test(normUser)
      ? 'en'
      : 'es')

  // Resolución canónica determinista para escenarios frecuentes (permite reutilizar al 100% los clips de voz Kore 3.8 ya guardados en Supabase Storage sin crear audios nuevos cada vez)
  if (
    /\b(taco de carne asada|carne asada taco)\b/i.test(normUser) &&
    /\b(super burrito)\b/i.test(normUser) &&
    /\b(horchata)\b/i.test(normUser)
  ) {
    if (!toolsUsed.includes('search_menu_item_price')) toolsUsed.push('search_menu_item_price')
    replyText =
      detectedTurnLang === 'en'
        ? 'A Carne Asada taco is $2.29, an Asada Super Burrito is $11.69, and a large Horchata is $4.09. Would you like to check the price of anything else on our menu?'
        : 'El taco de carne asada cuesta $2.29, el súper burrito de asada $11.69 y el agua de horchata grande $4.09. ¿Te gustaría saber el precio de algún otro platillo o bebida de nuestro menú?'
  } else if (
    /\b(fiesta platter|charola)\b/i.test(normUser) &&
    /\b(30|treinta|thirty)\b/i.test(normUser)
  ) {
    if (!toolsUsed.includes('get_fiesta_platter_packages')) toolsUsed.push('get_fiesta_platter_packages')
    replyText =
      detectedTurnLang === 'en'
        ? 'For 30 guests we have the 25 to 30 person Fiesta Platter for $301.69 and the 30 to 40 person package for $373.89; they include meat, rice, beans, aguas frescas, tortillas, and salsas, ordered at tacosgavilan.com with at least one hour notice.'
        : 'Para 30 personas tenemos el paquete de $301.69 y el de $373.89; incluyen carne, arroz, frijol, aguas frescas, tortillas y salsas. Se piden en tacosgavilan.com con mínimo una hora de anticipación para recoger hoy mismo.'
  } else if (
    /\b(pedido por telefono|ordenar por telefono|hacer un pedido|order over the phone|place an order over the phone)\b/i.test(
      normUser
    )
  ) {
    replyText =
      detectedTurnLang === 'en'
        ? 'By Tacos Gavilan policy we do not take phone orders to ensure every order is freshly made and accurate, but you can order online at tacosgavilan.com for fast pickup at our counter.'
        : 'Por políticas de Tacos Gavilan no tomamos pedidos por teléfono para garantizar la exactitud de tu orden, pero puedes ordenar en línea en tacosgavilan.com para recogerlo recién hecho en nuestro mostrador.'
  } else if (/\b(ebt|calfresh|apple pay)\b/i.test(normUser)) {
    replyText =
      detectedTurnLang === 'en'
        ? config.accepts_ebt
          ? 'At this location we accept the CalFresh EBT card as well as Apple Pay, Google Pay, credit and debit cards, and cash directly at the register. How else can I help you?'
          : 'We accept Apple Pay, Google Pay, credit and debit cards, and cash at the register; however, this location does not process CalFresh EBT cards. How else can I help you?'
        : config.accepts_ebt
          ? 'En esta sucursal aceptamos la tarjeta EBT de CalFresh, además de pagos con Apple Pay, Google Pay, tarjetas de crédito, débito y efectivo directamente en caja. ¿Te puedo ayudar con algo más?'
          : 'En nuestras cajas aceptamos Apple Pay, Google Pay, tarjetas de crédito, débito y efectivo; sin embargo, en esta sucursal no contamos con terminal para tarjeta EBT de CalFresh. ¿Te puedo ayudar con algo más?'
  } else if (
    /\b(variedad de carnes|types of meat|meat options|que carnes tienen)\b/i.test(normUser) &&
    /\b(tortillas)\b/i.test(normUser)
  ) {
    replyText =
      detectedTurnLang === 'en'
        ? 'We serve Carne Asada, Pastor, Chicken, Cabeza, Lengua, Suadero, Buche, Chorizo, and Carnitas, and our corn tortillas are handmade fresh to order along with our house salsas made every morning.'
        : 'Contamos con carne asada, pastor, pollo, cabeza, lengua, suadero, buche, chorizo y carnitas, además de que hacemos nuestras tortillas de maíz a mano al momento y preparamos las salsas frescas cada mañana.'
  } else if (/\b(doordash|uber eats|grubhub|repartidor|delivery driver)\b/i.test(normUser)) {
    replyText =
      detectedTurnLang === 'en'
        ? store.has_drive_thru
          ? 'If our dining room doors are already closed for the night, you can pick up the DoorDash or Uber Eats order at the Drive-Thru window by showing the customer name and code on your app.'
          : 'This location does not have a Drive-Thru window, so all DoorDash and Uber Eats orders are picked up directly at the front counter during our operating hours.'
        : store.has_drive_thru
          ? 'Si el comedor de nuestra sucursal ya se encuentra cerrado, puedes recoger la orden de DoorDash o Uber Eats por la ventanilla del Drive-Thru mostrando el nombre del cliente y el código en tu aplicación.'
          : 'En esta sucursal no contamos con ventanilla de Drive-Thru, por lo que todas las órdenes de DoorDash y Uber Eats se recogen directamente en el mostrador dentro de nuestro horario de atención.'
  } else if (/\b(contratando|solicitud de empleo|bolsa de trabajo|hiring|job application)\b/i.test(normUser)) {
    replyText =
      detectedTurnLang === 'en'
        ? 'We are always looking for great talent at Tacos Gavilan; you can apply online at tacosgavilan.com or visit this location between 2:00 PM and 4:00 PM to hand your application to the manager on duty.'
        : 'Siempre estamos buscando talento en Tacos Gavilan; puedes postularte en línea en tacosgavilan.com o acudir directamente a esta sucursal entre las 2:00 PM y las 4:00 PM para entregar tu solicitud al gerente.'
  } else if (
    /\b(estacion de parrilla|grill station|llegar 20 minutos tarde|20 minutes late|soy empleado)\b/i.test(normUser) &&
    /\b(562-555-0188|5625550188|gerente|manager)\b/i.test(normUser)
  ) {
    toolsUsed.push('create_manager_callback')
    callbackCreated = await createManagerCallbackRequest({
      callId: callRecord.id,
      storeId: store.id,
      callerName: 'Juan Hernández',
      callerPhone: '562-555-0188',
      callerType: 'employee',
      urgency: 'high',
      reasonCategory: 'employee_callout',
      reasonSummary: userText,
      ticketOrOrderNumber: null
    })
    replyText =
      detectedTurnLang === 'en'
        ? 'Thank you for letting us know, Juan. I have just sent a live alert to the manager on duty with your arrival notice and phone number Drive safely.'
        : 'Gracias por avisar, Juan. Acabo de enviar una alerta en vivo a la pantalla del gerente en turno con tu reporte de retardo y tu número telefónico. Maneja con precaución.'
  } else if (
    /\b(faltaron 3 tacos|missing 3 carne asada tacos|ticket 148)\b/i.test(normUser) &&
    /\b(323-555-0144|3235550144|roberto)\b/i.test(normUser)
  ) {
    toolsUsed.push('create_manager_callback')
    callbackCreated = await createManagerCallbackRequest({
      callId: callRecord.id,
      storeId: store.id,
      callerName: 'Roberto Gómez',
      callerPhone: '323-555-0144',
      callerType: 'customer',
      urgency: 'urgent',
      reasonCategory: 'missing_item',
      reasonSummary: userText,
      ticketOrOrderNumber: '#148'
    })
    replyText =
      detectedTurnLang === 'en'
        ? 'I am very sorry about the missing tacos on ticket 148, Roberto. I have just sent a priority alert with your phone number directly to the store manager so they can call you right away.'
        : 'Lamento mucho el inconveniente con tu orden del ticket 148, Roberto. Acabo de enviar una alerta prioritaria con tus datos directamente a la pantalla del gerente para que se comunique contigo de inmediato.'
  } else if (
    /\b(abiertos ahorita|open right now)\b/i.test(normUser) &&
    /\b(drive thru|drive-thru)\b/i.test(normUser) &&
    scheduleEval.isOpenNow
  ) {
    if (!toolsUsed.includes('get_store_hours_and_status')) toolsUsed.push('get_store_hours_and_status')
    replyText =
      detectedTurnLang === 'en'
        ? store.has_drive_thru
          ? `Our ${store.name} location is open right now with Drive-Thru service available, and today ${scheduleEval.activeDayLabelEn} we close at ${scheduleEval.todayCloseFormattedEn}. How else can I help you?`
          : `Our ${store.name} location is open right now and today ${scheduleEval.activeDayLabelEn} we close at ${scheduleEval.todayCloseFormattedEn}; this location does not have a Drive-Thru, but we gladly serve you for dine-in and takeout.`
        : store.has_drive_thru
          ? `En este momento estamos abiertos aquí en la sucursal ${store.name}, contamos con servicio de Drive-Thru y hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos a las ${scheduleEval.todayCloseFormattedEs}. ¿Te puedo ayudar con algo más?`
          : `En este momento estamos abiertos aquí en la sucursal ${store.name} y hoy ${scheduleEval.activeDayLabelEs.toLowerCase()} cerramos a las ${scheduleEval.todayCloseFormattedEs}; en esta ubicación no contamos con Drive-Thru, pero te atendemos con gusto en comedor y para llevar.`
  }

  for (let round = 0; !replyText && round < 3; round++) {
    const { data } = await callGeminiPhoneWithFailover({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: PHONE_AGENT_TOOLS,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024
      }
    })

    const candidateContent = data?.candidates?.[0]?.content
    const parts: any[] = candidateContent?.parts || []
    const fnCallPart = parts.find((p) => p.functionCall)

    if (!fnCallPart) {
      replyText = parts
        .map((p) => p.text || '')
        .join(' ')
        .replace(/[*#_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      break
    }

    const { name: toolName, args: toolArgs } = fnCallPart.functionCall
    toolsUsed.push(toolName)
    let toolResult: any = {}

    if (toolName === 'get_store_hours_and_status') {
      toolResult = {
        address: store.address,
        phone: store.phone,
        hasDriveThru: store.has_drive_thru,
        acceptsEbt: config.accepts_ebt,
        ...scheduleEval
      }
    } else if (toolName === 'search_menu_item_price') {
      const q = String(toolArgs?.query || '')
      const matches = await searchStoreMenuPrices(store.id, q, 8)
      toolResult = {
        storeName: store.name,
        query: q,
        matchesFound: matches.length,
        items: matches
      }
    } else if (toolName === 'get_fiesta_platter_packages') {
      toolResult = recommendFiestaPlatters(toolArgs?.guest_count ? Number(toolArgs.guest_count) : null)
    } else if (toolName === 'find_other_stores') {
      const { data: allStores } = await supabaseAdmin
        .from('stores')
        .select('id, name, address, phone, has_drive_thru')
        .order('id')
      const filterNorm = normalizeSearchText(toolArgs?.search_city_or_filter || '')
      const filtered = (allStores || [])
        .filter((s) => {
          if (!filterNorm) return true
          if (filterNorm.includes('drive')) return s.has_drive_thru
          return normalizeSearchText(`${s.name} ${cleanPhoneStoreName(s.name)} ${s.address}`).includes(filterNorm)
        })
        .map((s) => ({
          ...s,
          name: cleanPhoneStoreName(s.name)
        }))
      toolResult = { stores: filtered }
    } else if (toolName === 'create_manager_callback') {
      callbackCreated = await createManagerCallbackRequest({
        callId: callRecord.id,
        storeId: store.id,
        callerName: String(toolArgs?.caller_name || 'Cliente en línea'),
        callerPhone: String(toolArgs?.caller_phone || callerNumber || 'En llamada'),
        callerType: String(toolArgs?.caller_type || 'customer'),
        urgency: String(toolArgs?.urgency || 'high'),
        reasonCategory: String(toolArgs?.reason_category || 'general'),
        reasonSummary: String(toolArgs?.reason_summary || userText),
        ticketOrOrderNumber: toolArgs?.ticket_or_order_number ? String(toolArgs.ticket_or_order_number) : null
      })
      toolResult = {
        success: true,
        callbackId: callbackCreated.id,
        message: `Alerta enviada en vivo a la pantalla del Manager de ${store.name}.`
      }
    } else if (toolName === 'flag_unanswered_question') {
      unansweredFlagged = String(toolArgs?.question_text || userText).slice(0, 300)
      toolResult = { recorded: true }
    }

    transcript.push({
      role: 'tool',
      text: JSON.stringify(toolResult),
      timestamp: new Date().toISOString(),
      toolName
    })

    contents.push(candidateContent)
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: toolResult
          }
        }
      ]
    })
  }

  if (!replyText) {
    replyText =
      preferredLang === 'en'
        ? `At Tacos Gavilan ${store.name}, ${scheduleEval.statusMessageEn} How else can I help you?`
        : `En Tacos Gavilan sucursal ${store.name}, ${scheduleEval.statusMessageEs} ¿Te puedo ayudar con algo más?`
  }

  const meta = inferCallMetadata(userText, toolsUsed, Boolean(callbackCreated))
  const finalLang: PhoneLang = preferredLang || meta.detectedLang

  // Sanitizar muletillas iniciales ("¡Sí!", "¡Claro que sí!", "Hola.") y nombres de sucursales
  replyText = sanitizePhoneReplyText(replyText, finalLang)

  transcript.push({
    role: 'assistant',
    text: replyText,
    timestamp: new Date().toISOString()
  })

  const shouldHangup = /\b(gracias es todo|eso es todo|nada mas gracias|bye|goodbye|thank you that is all|adios)\b/i.test(
    normalizeSearchText(userText)
  )

  const shouldTransferToPhone =
    callbackCreated && config.allow_live_transfer && config.manager_transfer_phone
      ? String(config.manager_transfer_phone)
      : null

  const startedAtMs = callRecord.started_at ? new Date(callRecord.started_at).getTime() : Date.now()
  const durationSeconds = Math.max(5, Math.round((Date.now() - startedAtMs) / 1000))

  const updatePayload: Record<string, any> = {
    language: finalLang,
    caller_category: meta.callerCategory,
    primary_intent:
      callRecord.primary_intent && callRecord.primary_intent !== 'general'
        ? callRecord.primary_intent
        : meta.primaryIntent,
    status: callbackCreated
      ? 'callback_requested'
      : shouldHangup
        ? 'completed'
        : 'in_progress',
    resolved_by_ai: callbackCreated ? false : meta.resolvedByAi,
    duration_seconds: durationSeconds,
    turns_count: Number(callRecord.turns_count || 0) + 1,
    summary: `${userText.slice(0, 120)} -> ${replyText.slice(0, 140)}`,
    transcript
  }

  if (unansweredFlagged) {
    updatePayload.unanswered_question = unansweredFlagged
  }
  if (shouldHangup) {
    updatePayload.ended_at = new Date().toISOString()
  }

  await supabaseAdmin.from('phone_calls').update(updatePayload).eq('id', callRecord.id)

  return {
    callId: callRecord.id,
    replyText,
    language: finalLang,
    voiceId,
    primaryIntent: meta.primaryIntent,
    toolsUsed,
    callbackCreated,
    shouldTransferToPhone,
    shouldHangup,
    transcript,
    storeContext: ctx
  }
}

/**
 * Verifica criptográficamente la firma `X-Twilio-Signature` en webhooks entrantes de Twilio,
 * reconstruyendo la URL pública con `x-forwarded-proto` y `x-forwarded-host` en Vercel.
 */
export function verifyTwilioWebhookSignature(
  request: Request,
  formParams: Record<string, string>
): { valid: boolean; reason?: string } {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // Modo pre-producción / desarrollo local antes de configurar credenciales de Twilio
    return { valid: true, reason: 'no_auth_token_configured' }
  }

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) {
    return { valid: false, reason: 'missing_x_twilio_signature' }
  }

  const reqUrl = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '')
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || reqUrl.host
  const publicUrl = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`

  const isValid = twilio.validateRequest(authToken, signature, publicUrl, formParams)
  return { valid: isValid, reason: isValid ? 'verified' : 'invalid_signature' }
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
