/**
 * @module lib/toast-ticket-validator
 * @description Validador en tiempo real de existencia de tickets y números de orden por sucursal y fecha laboral
 * para el Canal Telefónico en Vivo (`Kore 3.8 Live` y Contestadora IA), consultando en paralelo las tablas operativas
 * de Supabase y la API oficial en vivo de Toast POS (`/orders/v2/ordersBulk`).
 *
 * @businessRules
 * - **Día Laboral Sagrado de Tacos Gavilan (`America/Los_Angeles`)**: Inicia a las `06:00 AM` y termina a las `05:59 AM`
 *   del día calendario siguiente (`getCaliforniaBusinessDate`). Llamadas en madrugada (`12:00 AM`–`05:59 AM`) que dicen
 *   `"hoy"` o `"anoche"` corresponden a la jornada laboral activa iniciada a las `06:00 AM` previa.
 * - **Limpieza Natural de Voz (`cleanSpokenTicketNumber`)**: Limpia prefijos y sufijos hablados (`"#1600"`,
 *   `"ticket 1600"`, `"orden 1600"`, `"el 1600 del día de hoy"` -> `"1600"`). Si el cliente indica explícitamente
 *   `"SIN TICKET"` / `"no tengo ticket"`, retorna `{ ok: true, skippedNoTicket: true }` sin bloquear el recado.
 * - **Protocolo Toast API**: Nunca se hardcodean GUIDs de `diningOption`; se traducen dinámicamente con caché en RAM
 *   por sucursal vía `/config/v2/diningOptions` (`Toast-Restaurant-External-ID`), ignorando órdenes `voided === true`.
 * - **Nomenclatura Oficial Frente al Cliente (`#5`, `#6`, `#7`)**: Usa siempre `formatCustomerStoreName` de
 *   `@/lib/customer-store-names` (`Los Ángeles (Central y Washington)`, etc., jamás `"LA Central"`).
 *
 * @dataFlow
 * - `validate_order_ticket` / `create_manager_callback` -> `validateStoreOrderTicket()` ->
 *   `Promise.all([Supabase(order_ready_announcements, gavilan_pos_orders, delivery_platform_orders), Toast(/orders/v2/ordersBulk)])`
 *   con caché en RAM de `45 s` por `storeGuid+YYYYMMDD` -> `{ ok: true, found: true | false, ... }`.
 *
 * @notes
 * - Implementado en Fase 25 tras la prueba real en carro `d4c1eba4` en `#6 Los Ángeles (Central y Washington)` donde se
 *   reportó el ticket inexistente `#1600` del día de hoy y Carlos instruyó validar en tiempo real contra el sistema POS.
 * - Si la API de Toast sufre un fallo transitorio de red (`toastNetworkError: true`) y el ticket tampoco está en caché
 *   local de Supabase, expone `toastNetworkError: true` para que `create_manager_callback` no rechace falsamente un
 *   recado legítimo por caída externa.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { formatCustomerStoreName } from '@/lib/customer-store-names'
import { getAuthToken } from '@/lib/toast-api'

const TOAST_API_HOST = (process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com').replace(/\/+$/, '')
const TOAST_ORDERS_CACHE_TTL_MS = 45_000
const TOAST_DINING_OPTIONS_TTL_MS = 10 * 60_000
const STORE_META_CACHE_TTL_MS = 5 * 60_000
// Secuencial (1 página a la vez) evita HTTP 429 burst en Toast ordersBulk.
const TOAST_PAGE_BATCH_SIZE = 1
const TOAST_MAX_PAGES = 24
const TOAST_OVERALL_BUDGET_MS = 12_000

const TOAST_FALLBACK_GUID_BY_STORE_ID: Readonly<Record<number, string>> = Object.freeze({
  1: 'acf15327-54c8-4da4-8d0d-3ac0544dc422',
  3: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02',
  4: 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8',
  5: '475bc112-187d-4b9c-884d-1f6a041698ce',
  6: '8685e942-3f07-403a-afb6-faec697cd2cb',
  7: '9625621e-1b5e-48d7-87ae-7094fab5a4fd',
  8: '5fbb58f5-283c-4ea4-9415-04100ee6978b',
  9: '3c2d8251-c43c-43b8-8306-387e0a4ed7c2',
  10: '3a803939-eb13-4def-a1a4-462df8e90623',
  11: '47256ade-2cd4-4073-9632-84567ad9e2c8',
  12: '42ed15a6-106b-466a-9076-1e8f72451f6b',
  13: 'a83901db-2431-4283-834e-9502a2ba4b3b',
  14: '80a1ec95-bc73-402e-8884-e5abbe9343e6',
  15: '95866cfc-eeb8-4af9-9586-f78931e1ea04',
  16: 'b7f63b01-f089-4ad7-a346-afdb1803dc1a'
})

interface StoreTicketMeta {
  id: number
  name: string
  code: string
  externalId: string
  customerNameEs: string
  customerNameEn: string
  expiresAt: number
}

export type TicketMatchSource =
  | 'order_ready_announcements'
  | 'dt_orders'
  | 'delivery_packing_audits'
  | 'gavilan_pos_orders'
  | 'delivery_platform_orders'
  | 'app_orders'
  | 'toast_live_api'

export interface TicketObservedRange {
  minOrder: number | null
  maxOrder: number | null
  count: number
  businessDate: string
}

interface TicketMatchDetail {
  ticketNumber: string
  channel: string
  itemsSummary: string
  statusText?: string
  customerName?: string
  source: TicketMatchSource
}

interface ToastDayOrdersCacheEntry {
  expiresAt: number
  byTicket: Map<string, TicketMatchDetail>
  complete: boolean
  nextPage: number
  minOrder: number | null
  maxOrder: number | null
}

export interface ValidateStoreOrderTicketParams {
  storeId: number
  ticketOrOrderNumber: string
  purchaseDateText?: string | null
  customerName?: string | null
  now?: Date
}

export interface ValidateStoreOrderTicketResult {
  ok: true
  skippedNoTicket?: boolean
  found?: boolean
  matchedByCustomer?: boolean
  ticketNumber: string
  businessDate: string
  storeName: string
  storeNameEn: string
  channel?: string
  statusText?: string
  customerName?: string
  itemsSummary?: string
  matchedSource?: TicketMatchSource
  observedRange?: TicketObservedRange | null
  toastNetworkError?: boolean
  messageEs?: string
  messageEn?: string
}

const storeMetaRamCache = new Map<number, StoreTicketMeta>()
const diningOptionsRamCache = new Map<string, { expiresAt: number; map: Record<string, string> }>()
const toastDayOrdersRamCache = new Map<string, ToastDayOrdersCacheEntry>()
const inflightToastBatch = new Map<string, Promise<{ hit: TicketMatchDetail | null; networkError: boolean }>>()

function foldText(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

const SPOKEN_SINGLE_DIGITS: Readonly<Record<string, string>> = Object.freeze({
  cero: '0',
  zero: '0',
  oh: '0',
  uno: '1',
  una: '1',
  one: '1',
  dos: '2',
  two: '2',
  tres: '3',
  three: '3',
  cuatro: '4',
  four: '4',
  cinco: '5',
  five: '5',
  seis: '6',
  six: '6',
  siete: '7',
  seven: '7',
  ocho: '8',
  eight: '8',
  nueve: '9',
  nine: '9'
})

const NO_TICKET_RE =
  /\b(sin\s*(?:el\s*)?(?:ticket|recibo|comprobante)|no\s*(?:tengo|traigo|conservo|guarde|me\s*dieron)\s*(?:el\s*|mi\s*)?(?:ticket|recibo|comprobante)?|perdi\s*(?:el\s*|mi\s*)?(?:ticket|recibo)|se\s*me\s*perdio|lo\s*(?:tire|perdi)|tire\s*(?:el\s*|mi\s*)?(?:ticket|recibo)|no\s*ticket|without\s*(?:a\s*|the\s*)?(?:ticket|receipt)|lost\s*(?:my\s*|the\s*)?(?:ticket|receipt)|threw\s*(?:away|out)\s*(?:my\s*|the\s*)?(?:ticket|receipt)|dont\s*have\s*(?:a\s*|the\s*|my\s*)?(?:ticket|receipt)|do\s*not\s*have\s*(?:a\s*|the\s*|my\s*)?(?:ticket|receipt))\b/i

/**
 * Limpia prefijos y sufijos hablados de un número de ticket u orden (`"#1600"`, `"ticket 1600"`,
 * `"orden 1600"`, `"el 1600 del día de hoy"` -> `"1600"`), detectando explícitamente `"SIN TICKET"`.
 */
export function cleanSpokenTicketNumber(rawInput: string | null | undefined): {
  isNoTicket: boolean
  ticketNumber: string
  candidates: string[]
} {
  const raw = String(rawInput || '').trim()
  if (!raw) {
    return { isNoTicket: false, ticketNumber: '', candidates: [] }
  }

  const folded = foldText(raw).replace(/['’`]+/g, '')
  if (
    folded === 'sin ticket' ||
    folded === 'no ticket' ||
    folded === 'none' ||
    folded === 'n/a' ||
    folded === 'na' ||
    NO_TICKET_RE.test(folded)
  ) {
    return { isNoTicket: true, ticketNumber: 'SIN TICKET', candidates: [] }
  }

  // Quitar sufijos entre paréntesis agregados por herramientas, ej. "1600 (Hoy)" o "#1600 (el día de hoy)"
  let working = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[¿?¡!.,;:"'’`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Quitar colas temporales habladas ("del día de hoy", "de hoy", "de ayer", "from today", "today", "yesterday")
  working = working
    .replace(
      /\b(?:del?\s+d[ií]a\s+de\s+(?:hoy|ayer)|del?\s+(?:hoy|ayer|anoche)|el\s+d[ií]a\s+de\s+(?:hoy|ayer)|from\s+(?:today|yesterday|last\s+night)|(?:de\s+)?(?:hoy|ayer|anoche|ahorita|today|yesterday|tonight|last\s+night))\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()

  // Si no hay dígitos ASCII pero dictaron dígito por dígito ("uno seis cero cero"), convertirlos
  if (!/\d/.test(working)) {
    working = working
      .replace(
        /\b(cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)\b/gi,
        (m) => SPOKEN_SINGLE_DIGITS[m.toLowerCase()] ?? m
      )
      .replace(/(?<=\d)\s+(?=\d)/g, '')
  }

  // Quitar prefijos hablados ("el ticket es el #1600", "ticket número 1600", "orden 1600", "el 1600")
  working = working
    .replace(
      /^(?:(?:mi|el|la|my|the|este|ese)\s+)*(?:(?:ticket|recibo|comprobante|orden|order|receipt|check|cheque|folio|c[oó]digo|code|n[uú]mero|numero|number|num|no)\s*(?:de\s+(?:la\s+|mi\s+)?(?:orden|compra|ticket|recibo)\s*)?(?:es|fue|era|ser[ií]a|is|was|el|la|n[uú]mero|numero|number|num|no|#|:|-)*\s*)+/i,
      ''
    )
    .replace(/^(?:es|fue|era|is|was)?\s*(?:el|la|the)?\s*[#:\-]+\s*/i, '')
    .replace(/^(?:el|la|the)\s+(?=[#A-Za-z0-9])/i, '')
    .replace(/^#+/, '')
    .trim()

  // Extraer token principal con al menos un dígito (ej. "1600", "0983", "7AF29", "SEED-1043")
  const explicitHash = raw.match(/#\s*([A-Za-z0-9][A-Za-z0-9\-]{0,19})/)
  let token = ''
  if (explicitHash && /\d/.test(explicitHash[1])) {
    token = explicitHash[1].trim()
  } else if (/^[A-Za-z0-9][A-Za-z0-9\-]{0,19}$/.test(working) && /\d/.test(working)) {
    token = working
  } else {
    const tokenMatches = Array.from(working.matchAll(/\b([A-Za-z0-9][A-Za-z0-9\-]{0,19})\b/g))
      .map((m) => m[1])
      .filter((t) => /\d/.test(t))
    if (tokenMatches.length > 0) {
      token = tokenMatches[0]
    }
  }

  if (!token) {
    return { isNoTicket: false, ticketNumber: '', candidates: [] }
  }

  const normalizedUpper = /^\d+$/.test(token) ? token : token.toUpperCase()
  const candidateSet = new Set<string>([normalizedUpper])
  if (/^\d+$/.test(normalizedUpper)) {
    const strippedZeros = normalizedUpper.replace(/^0+(?=\d)/, '')
    candidateSet.add(strippedZeros)
  } else {
    candidateSet.add(token.toLowerCase())
  }

  const canonicalTicket = /^\d+$/.test(normalizedUpper)
    ? normalizedUpper.replace(/^0+(?=\d)/, '')
    : normalizedUpper

  return {
    isNoTicket: false,
    ticketNumber: canonicalTicket,
    candidates: Array.from(candidateSet)
  }
}

function shiftIsoDateDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays))
  return dt.toISOString().slice(0, 10)
}

function getLaHourAndYear(now: Date): { hour: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')?.value || now.getUTCFullYear())
  const hRaw = Number(parts.find((p) => p.type === 'hour')?.value || 12)
  return { hour: hRaw === 24 ? 0 : hRaw, year: y }
}

const MONTH_NAME_MAP: Readonly<Record<string, number>> = Object.freeze({
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  june: 6,
  julio: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  september: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12
})

const WEEKDAY_NAME_MAP: Readonly<Record<string, number>> = Object.freeze({
  domingo: 0,
  sunday: 0,
  lunes: 1,
  monday: 1,
  martes: 2,
  tuesday: 2,
  miercoles: 3,
  wednesday: 3,
  jueves: 4,
  thursday: 4,
  viernes: 5,
  friday: 5,
  sabado: 6,
  saturday: 6
})

/**
 * Resuelve la fecha operativa `YYYY-MM-DD` en `America/Los_Angeles` respetando estrictamente
 * la jornada laboral de `06:00 AM` a `05:59 AM` del día siguiente (`getCaliforniaBusinessDate`).
 */
export function resolveTicketBusinessDate(
  purchaseDateText?: string | null,
  now: Date = new Date()
): string {
  const baseBusinessDate = getCaliforniaBusinessDate(now)
  const raw = String(purchaseDateText || '').trim()
  if (!raw) return baseBusinessDate

  // 1) Fecha explícita ISO YYYY-MM-DD
  const isoMatch = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const norm = foldText(raw)
  const { hour: laHour, year: laYear } = getLaHourAndYear(now)

  // 2) Fecha explícita MM/DD o MM/DD/YYYY (o MM-DD-YYYY)
  const slashMatch = norm.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}|\d{2}))?\b/)
  if (slashMatch) {
    const mm = Number(slashMatch[1])
    const dd = Number(slashMatch[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let yyyy = slashMatch[3]
        ? slashMatch[3].length === 2
          ? 2000 + Number(slashMatch[3])
          : Number(slashMatch[3])
        : laYear
      const candidate = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      if (!slashMatch[3] && candidate > shiftIsoDateDays(baseBusinessDate, 2)) {
        yyyy -= 1
      }
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  // 3) Día y nombre de mes ("20 de noviembre", "nov 20", "november 20")
  const esMonthMatch = norm.match(
    /\b(\d{1,2})\s+(?:de\s+)?(enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|septiembre|setiembre|sep|sept|octubre|oct|noviembre|nov|diciembre|dic)\b/
  )
  const enMonthMatch = norm.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})\b/
  )
  if (esMonthMatch || enMonthMatch) {
    const dd = esMonthMatch ? Number(esMonthMatch[1]) : Number(enMonthMatch![2])
    const mName = esMonthMatch ? esMonthMatch[2] : enMonthMatch![1]
    const mm = MONTH_NAME_MAP[mName]
    if (mm && dd >= 1 && dd <= 31) {
      let yyyy = laYear
      const candidate = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      if (candidate > shiftIsoDateDays(baseBusinessDate, 2)) {
        yyyy -= 1
      }
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }

  // 4) Expresiones relativas: antier / hace N días / ayer / anoche / hoy
  if (/\b(antier|anteayer|day\s+before\s+yesterday|(?:hace\s+)?(?:dos|2)\s+dias|2\s+days\s+ago|two\s+days\s+ago)\b/.test(norm)) {
    return shiftIsoDateDays(baseBusinessDate, -2)
  }
  const daysAgoMatch = norm.match(/\b(?:hace\s+(\d{1,2})\s+dias|(\d{1,2})\s+days\s+ago)\b/)
  if (daysAgoMatch) {
    const n = Number(daysAgoMatch[1] || daysAgoMatch[2])
    if (Number.isFinite(n) && n >= 1 && n <= 31) {
      return shiftIsoDateDays(baseBusinessDate, -n)
    }
  }
  if (/\b(ayer|yesterday)\b/.test(norm)) {
    return shiftIsoDateDays(baseBusinessDate, -1)
  }
  if (/\b(anoche|last\s+night)\b/.test(norm)) {
    // Entre 12:00 AM y 5:59 AM PT seguimos dentro del mismo business_date de esa noche
    return laHour < 6 ? baseBusinessDate : shiftIsoDateDays(baseBusinessDate, -1)
  }
  if (
    /\b(hoy|el\s+dia\s+de\s+hoy|ahorita|hace\s+(?:un\s+)?(?:rato|momento|media\s+hora|una\s+hora|\d+\s+minutos?)|acabo\s+de|esta\s+(?:manana|tarde|noche)|today|right\s+now|just\s+now|tonight|this\s+(?:morning|afternoon|evening)|earlier)\b/.test(
      norm
    )
  ) {
    return baseBusinessDate
  }

  // 5) Día de la semana ("el viernes", "on Friday")
  for (const [wName, wIdx] of Object.entries(WEEKDAY_NAME_MAP)) {
    if (new RegExp(`\\b${wName}\\b`).test(norm)) {
      const [by, bm, bd] = baseBusinessDate.split('-').map(Number)
      const baseDow = new Date(Date.UTC(by, bm - 1, bd)).getUTCDay()
      let diff = (baseDow - wIdx + 7) % 7
      if (diff === 0 && /\b(pasad[oa]|last)\b/.test(norm)) {
        diff = 7
      }
      return shiftIsoDateDays(baseBusinessDate, -diff)
    }
  }

  return baseBusinessDate
}

async function getStoreTicketMeta(storeId: number): Promise<StoreTicketMeta> {
  const hit = storeMetaRamCache.get(storeId)
  if (hit && Date.now() < hit.expiresAt) return hit

  const { data } = await supabaseAdmin
    .from('stores')
    .select('id, name, code, external_id')
    .eq('id', storeId)
    .maybeSingle()

  const fallbackObj = { id: storeId, name: data?.name || `Sucursal #${storeId}` }
  const meta: StoreTicketMeta = {
    id: Number(data?.id || storeId),
    name: String(data?.name || `Sucursal #${storeId}`),
    code: String(data?.code || '').trim(),
    externalId: String(data?.external_id || TOAST_FALLBACK_GUID_BY_STORE_ID[storeId] || '').trim(),
    customerNameEs: formatCustomerStoreName(fallbackObj, 'es', { style: 'display' }),
    customerNameEn: formatCustomerStoreName(fallbackObj, 'en', { style: 'display' }),
    expiresAt: Date.now() + STORE_META_CACHE_TTL_MS
  }
  storeMetaRamCache.set(storeId, meta)
  return meta
}

function summarizeOrderItems(rawItems: unknown): string {
  if (!rawItems) return ''
  let arr: unknown[] = []
  if (Array.isArray(rawItems)) {
    arr = rawItems
  } else if (typeof rawItems === 'string') {
    const trimmed = rawItems.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) arr = parsed
      } catch {
        return trimmed.slice(0, 180)
      }
    } else {
      return trimmed.slice(0, 180)
    }
  }
  if (arr.length === 0) return ''

  const parts: string[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (rec.voided === true) continue
    const name = String(rec.displayName || rec.name || rec.title || rec.item_name || '').trim()
    if (!name) continue
    const qtyNum = Number(rec.quantity ?? rec.qty ?? 1)
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1
    parts.push(`${qty}x ${name}`)
    if (parts.length >= 6) break
  }
  if (parts.length === 0) return ''
  const extra = arr.length > parts.length ? ` (+${arr.length - parts.length} más)` : ''
  return `${parts.join(', ')}${extra}`
}

function formatFriendlyChannel(rawChannel: string | null | undefined): string {
  const c = String(rawChannel || '').trim()
  if (!c) return 'POS Sucursal'
  const u = c.toUpperCase()
  if (u === 'FOR_HERE' || u === 'DINE_IN') return 'Comedor (Dine-In)'
  if (u === 'TOGO' || u === 'TAKE_OUT' || u === 'TAKEOUT') return 'Para Llevar (Take-Out)'
  if (u === 'DRIVE_THRU' || u === 'DRIVETHRU') return 'Drive-Thru'
  if (u.includes('UBER')) return 'Uber Eats'
  if (u.includes('DOORDASH') || u.includes('DOOR DASH')) return 'DoorDash'
  if (u.includes('GRUBHUB')) return 'Grubhub'
  if (u.includes('ONLINE')) return 'tacosgavilan.com (Online)'
  return c
}

function formatDeliveryAuditStatus(rawStatus: unknown): { es: string; en: string } {
  const s = String(rawStatus || '').toUpperCase().trim()
  if (s === 'PACKED_AND_SEALED' || s === 'READY') return { es: 'Lista y sellada esperando entrega', en: 'Packed, sealed, and ready for pickup' }
  if (s === 'DELIVERED') return { es: 'Ya fue entregada', en: 'Already handed off / delivered' }
  if (s === 'MATCHED') return { es: 'Empacándose en mostrador', en: 'Being packed at the counter' }
  if (s === 'PENDING_MATCH') return { es: 'En preparación en cocina', en: 'Still in kitchen prep' }
  if (s === 'UNCLAIMED_2H') return { es: 'Lista sin recoger (+2 horas)', en: 'Ready / unclaimed for 2+ hours' }
  if (s === 'DISPUTED') return { es: 'Marcada en revisión', en: 'Flagged for review' }
  return { es: '', en: '' }
}

function matchCustomerFuzzy(rowName: unknown, queryCustomer: string): boolean {
  const cleanRow = foldText(String(rowName || ''))
  const cleanQ = foldText(queryCustomer)
  if (!cleanRow || !cleanQ || cleanQ.length < 3) return false
  if (cleanRow === cleanQ || cleanRow.includes(cleanQ)) return true
  const qTokens = cleanQ.split(/\s+/).filter((t) => t.length >= 3)
  if (qTokens.length === 0) return false
  return qTokens.every((tok) => cleanRow.includes(tok))
}

async function querySupabaseTicketSources(
  store: StoreTicketMeta,
  businessDate: string,
  canonicalTicket: string,
  candidates: string[],
  customerName?: string | null
): Promise<{ hit: TicketMatchDetail | null; observedRange: TicketObservedRange | null }> {
  const numericCandidates = candidates
    .filter((c) => /^\d+$/.test(c))
    .map((c) => Number(c))
    .filter((n) => Number.isSafeInteger(n) && n >= 0)

  const cleanCust = String(customerName || '').trim()
  const recentAuditIso = new Date(Date.now() - 36 * 3600_000).toISOString()

  const oraScopeFilter = store.code
    ? `store_code.eq.${store.code},store_id.eq.${store.externalId}`
    : `store_id.eq.${store.externalId}`

  const [
    oraRes,
    dtRes,
    dpaRes,
    gpoByNumRes,
    gpoByClientRes,
    dpoByDisplayRes,
    dpoByPlatRes,
    dpoByCustRes,
    appOrdRes,
    rangeOraRes,
    rangeDtRes
  ] = await Promise.all([
    candidates.length > 0
      ? supabaseAdmin
          .from('order_ready_announcements')
          .select('store_id, store_code, order_number, dining_option, items_summary')
          .eq('business_date', businessDate)
          .in('order_number', candidates)
          .limit(10)
      : Promise.resolve({ data: null, error: null }),
    candidates.length > 0 && store.externalId
      ? supabaseAdmin
          .from('dt_orders')
          .select('order_number, order_guid, half_hour_slot, opened_at')
          .eq('store_id', store.externalId)
          .eq('business_date', businessDate)
          .in('order_number', candidates)
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    candidates.length > 0 || cleanCust.length >= 3
      ? supabaseAdmin
          .from('delivery_packing_audits')
          .select('store_id, toast_display_number, platform, dining_option_name, customer_name, status, courier_order_reference, quick_checks, items_json, order_opened_at')
          .eq('store_id', store.id)
          .gte('created_at', recentAuditIso)
          .order('created_at', { ascending: false })
          .limit(90)
      : Promise.resolve({ data: null, error: null }),
    numericCandidates.length > 0
      ? supabaseAdmin
          .from('gavilan_pos_orders')
          .select('store_id, store_number, order_number, client_order_id, dining_option, items, is_voided')
          .eq('business_date', businessDate)
          .eq('is_voided', false)
          .in('order_number', numericCandidates)
          .limit(10)
      : Promise.resolve({ data: null, error: null }),
    canonicalTicket
      ? supabaseAdmin
          .from('gavilan_pos_orders')
          .select('store_id, store_number, order_number, client_order_id, dining_option, items, is_voided')
          .eq('business_date', businessDate)
          .eq('is_voided', false)
          .ilike('client_order_id', canonicalTicket)
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    candidates.length > 0
      ? supabaseAdmin
          .from('delivery_platform_orders')
          .select('store_id, platform, toast_display_number, platform_order_id, toast_dining_option, customer_name, items_summary')
          .eq('store_id', store.id)
          .eq('business_date', businessDate)
          .in('toast_display_number', candidates)
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    canonicalTicket
      ? supabaseAdmin
          .from('delivery_platform_orders')
          .select('store_id, platform, toast_display_number, platform_order_id, toast_dining_option, customer_name, items_summary')
          .eq('store_id', store.id)
          .eq('business_date', businessDate)
          .ilike('platform_order_id', canonicalTicket)
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    cleanCust.length >= 3
      ? supabaseAdmin
          .from('delivery_platform_orders')
          .select('store_id, platform, toast_display_number, platform_order_id, toast_dining_option, customer_name, items_summary')
          .eq('store_id', store.id)
          .eq('business_date', businessDate)
          .ilike('customer_name', `%${cleanCust}%`)
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
    canonicalTicket && canonicalTicket.length >= 4
      ? supabaseAdmin
          .from('app_orders')
          .select('id, store_id, toast_order_guid, pickup_method, status, items_json, created_at')
          .eq('store_id', store.id)
          .gte('created_at', recentAuditIso)
          .order('created_at', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: null, error: null }),
    store.externalId || store.code
      ? supabaseAdmin
          .from('order_ready_announcements')
          .select('order_number')
          .eq('business_date', businessDate)
          .or(oraScopeFilter)
          .limit(1000)
      : Promise.resolve({ data: null, error: null }),
    store.externalId
      ? supabaseAdmin
          .from('dt_orders')
          .select('order_number')
          .eq('store_id', store.externalId)
          .eq('business_date', businessDate)
          .limit(1000)
      : Promise.resolve({ data: null, error: null })
  ])

  const serialNumbers: number[] = []
  let rawRangeCount = 0
  for (const r of [...(Array.isArray(rangeOraRes.data) ? rangeOraRes.data : []), ...(Array.isArray(rangeDtRes.data) ? rangeDtRes.data : [])]) {
    rawRangeCount++
    const rawOrd = String((r as any).order_number || '').trim()
    if (/^\d+$/.test(rawOrd)) {
      const n = Number(rawOrd)
      // Excluir folios offline de 5-6 dígitos (80001+) del rango normal del día
      if (n >= 1 && n <= 9999) serialNumbers.push(n)
    }
  }
  const observedRange: TicketObservedRange | null =
    rawRangeCount > 0
      ? {
          minOrder: serialNumbers.length > 0 ? Math.min(...serialNumbers) : null,
          maxOrder: serialNumbers.length > 0 ? Math.max(...serialNumbers) : null,
          count: rawRangeCount,
          businessDate
        }
      : null

  const oraRows = Array.isArray(oraRes.data) ? oraRes.data : []
  const matchedOra = oraRows.find((r) => {
    const sid = String(r.store_id || '').trim()
    const scode = String(r.store_code || '').trim()
    return (
      (store.code && (scode === store.code || sid === store.code)) ||
      (store.externalId && sid === store.externalId) ||
      sid === String(store.id)
    )
  })
  if (matchedOra) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(matchedOra.order_number || canonicalTicket).trim(),
        channel: formatFriendlyChannel(matchedOra.dining_option),
        itemsSummary: summarizeOrderItems(matchedOra.items_summary),
        source: 'order_ready_announcements'
      }
    }
  }

  const dtRows = Array.isArray(dtRes.data) ? dtRes.data : []
  if (dtRows.length > 0) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(dtRows[0].order_number || canonicalTicket).trim(),
        channel: 'Drive-Thru',
        itemsSummary: '',
        source: 'dt_orders'
      }
    }
  }

  const dpaRows = Array.isArray(dpaRes.data) ? dpaRes.data : []
  const candUpperSet = new Set(candidates.map((c) => c.toUpperCase()))
  const dpaMatchesTicket = (r: any): boolean => {
    if (candidates.length === 0) return false
    const disp = String(r.toast_display_number || '').trim().toUpperCase()
    const dispStrip = /^\d+$/.test(disp) ? disp.replace(/^0+(?=\d)/, '') : disp
    const cref = String(r.courier_order_reference || '').trim().toUpperCase()
    const qc = r.quick_checks && typeof r.quick_checks === 'object' ? r.quick_checks : {}
    const pk = String((qc as any).platformOrderKey || '').trim().toUpperCase()
    const sk = String((qc as any).shortOrderKey || '').trim().toUpperCase()
    return (
      candUpperSet.has(disp) ||
      candUpperSet.has(dispStrip) ||
      (cref.length > 0 && (candUpperSet.has(cref) || candidates.some((c) => c.length >= 4 && cref.includes(c.toUpperCase())))) ||
      (pk.length > 0 && candUpperSet.has(pk)) ||
      (sk.length > 0 && candUpperSet.has(sk))
    )
  }
  const matchedDpa =
    dpaRows.find((r: any) => dpaMatchesTicket(r)) ||
    (cleanCust.length >= 3 ? dpaRows.find((r: any) => matchCustomerFuzzy(r.customer_name, cleanCust)) : undefined)
  if (matchedDpa) {
    const st = formatDeliveryAuditStatus((matchedDpa as any).status)
    return {
      observedRange,
      hit: {
        ticketNumber: String((matchedDpa as any).toast_display_number || (matchedDpa as any).courier_order_reference || canonicalTicket || 'DELIVERY').trim(),
        channel: formatFriendlyChannel((matchedDpa as any).dining_option_name || (matchedDpa as any).platform),
        statusText: st.es || undefined,
        customerName: String((matchedDpa as any).customer_name || '').trim() || undefined,
        itemsSummary: summarizeOrderItems((matchedDpa as any).items_json),
        source: 'delivery_packing_audits'
      }
    }
  }

  const gpoRows = [
    ...(Array.isArray(gpoByNumRes.data) ? gpoByNumRes.data : []),
    ...(Array.isArray(gpoByClientRes.data) ? gpoByClientRes.data : [])
  ]
  const matchedGpo = gpoRows.find(
    (r) => Number(r.store_number) === store.id || Number(r.store_id) === store.id
  )
  if (matchedGpo) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(matchedGpo.order_number || matchedGpo.client_order_id || canonicalTicket).trim(),
        channel: formatFriendlyChannel(matchedGpo.dining_option),
        itemsSummary: summarizeOrderItems(matchedGpo.items),
        source: 'gavilan_pos_orders'
      }
    }
  }

  const dpoRows = [
    ...(Array.isArray(dpoByDisplayRes.data) ? dpoByDisplayRes.data : []),
    ...(Array.isArray(dpoByPlatRes.data) ? dpoByPlatRes.data : []),
    ...(Array.isArray(dpoByCustRes.data) ? dpoByCustRes.data : [])
  ]
  if (dpoRows.length > 0) {
    const dpo = dpoRows[0] as any
    return {
      observedRange,
      hit: {
        ticketNumber: String(dpo.toast_display_number || dpo.platform_order_id || canonicalTicket || 'DELIVERY').trim(),
        channel: formatFriendlyChannel(dpo.toast_dining_option || dpo.platform),
        customerName: String(dpo.customer_name || '').trim() || undefined,
        itemsSummary: summarizeOrderItems(dpo.items_summary),
        source: 'delivery_platform_orders'
      }
    }
  }

  const appRows = Array.isArray(appOrdRes.data) ? appOrdRes.data : []
  const matchedApp = appRows.find((r: any) => {
    const idStr = String(r.id || '').toUpperCase()
    const guidStr = String(r.toast_order_guid || '').toUpperCase()
    return candidates.some((c) => {
      const u = c.toUpperCase()
      return u.length >= 4 && (idStr.startsWith(u) || idStr.endsWith(u) || guidStr.startsWith(u))
    })
  })
  if (matchedApp) {
    return {
      observedRange,
      hit: {
        ticketNumber: canonicalTicket || String((matchedApp as any).id).slice(0, 8).toUpperCase(),
        channel: `tacosgavilan.com / App (${String((matchedApp as any).pickup_method || 'pickup')})`,
        statusText: String((matchedApp as any).status || '').trim() || undefined,
        itemsSummary: summarizeOrderItems((matchedApp as any).items_json),
        source: 'app_orders'
      }
    }
  }

  return { hit: null, observedRange }
}

async function getCachedDiningOptionsMap(token: string, storeGuid: string): Promise<Record<string, string>> {
  const hit = diningOptionsRamCache.get(storeGuid)
  if (hit && Date.now() < hit.expiresAt) return hit.map

  try {
    const res = await fetch(`${TOAST_API_HOST}/config/v2/diningOptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Toast-Restaurant-External-ID': storeGuid
      },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return hit?.map || {}
    const data = await res.json().catch(() => [])
    const map: Record<string, string> = {}
    if (Array.isArray(data)) {
      for (const opt of data) {
        if (opt?.guid && opt?.name) {
          map[String(opt.guid)] = String(opt.name)
        }
      }
    }
    diningOptionsRamCache.set(storeGuid, { expiresAt: Date.now() + TOAST_DINING_OPTIONS_TTL_MS, map })
    return map
  } catch {
    return hit?.map || {}
  }
}

function indexToastOrderIntoMap(
  ord: Record<string, any>,
  diningMap: Record<string, string>,
  entry: ToastDayOrdersCacheEntry
): void {
  if (!ord || ord.voided === true || ord.deleted === true) return

  const checks: any[] = Array.isArray(ord.checks) ? ord.checks : []
  const activeChecks = checks.filter((c) => c && c.voided !== true && c.deleted !== true)
  if (checks.length > 0 && activeChecks.length === 0) return

  const allSelections: any[] = []
  for (const chk of activeChecks) {
    if (Array.isArray(chk.selections)) {
      for (const sel of chk.selections) {
        if (sel && sel.voided !== true) allSelections.push(sel)
      }
    }
  }

  const diningGuid = ord.diningOption?.guid ? String(ord.diningOption.guid) : ''
  const rawChannel = (diningGuid && diningMap[diningGuid]) || String(ord.source || 'POS Sucursal')
  const channel = formatFriendlyChannel(rawChannel)
  const itemsSummary = summarizeOrderItems(allSelections)

  const registerKey = (rawDisp: unknown) => {
    const clean = String(rawDisp ?? '').trim()
    if (!clean) return
    const upper = clean.toUpperCase()
    if (/^\d+$/.test(upper)) {
      const n = Number(upper)
      if (n >= 1 && n <= 9999) {
        entry.minOrder = entry.minOrder === null ? n : Math.min(entry.minOrder, n)
        entry.maxOrder = entry.maxOrder === null ? n : Math.max(entry.maxOrder, n)
      }
    }
    const detail: TicketMatchDetail = {
      ticketNumber: clean,
      channel,
      itemsSummary,
      source: 'toast_live_api'
    }
    if (!entry.byTicket.has(upper)) entry.byTicket.set(upper, detail)
    if (/^\d+$/.test(upper)) {
      const stripped = upper.replace(/^0+(?=\d)/, '')
      if (!entry.byTicket.has(stripped)) entry.byTicket.set(stripped, detail)
    }
  }

  registerKey(ord.displayNumber)
  for (const chk of activeChecks) {
    registerKey(chk.displayNumber)
  }
}

const TOAST_TICKET_LOOKUP_FIELDS = [
  'guid',
  'displayNumber',
  'voided',
  'deleted',
  'source',
  'diningOption',
  'checks.voided',
  'checks.deleted',
  'checks.displayNumber',
  'checks.selections.displayName',
  'checks.selections.quantity',
  'checks.selections.voided'
].join(',')

async function queryLiveToastTicket(
  storeGuid: string,
  businessDate: string,
  candidates: string[]
): Promise<{ hit: TicketMatchDetail | null; networkError: boolean }> {
  if (!storeGuid) return { hit: null, networkError: true }

  const yyyymmdd = businessDate.replace(/-/g, '')
  const cacheKey = `${storeGuid}|${yyyymmdd}`
  const upperCandidates = candidates.map((c) => c.toUpperCase())

  const findInEntry = (entry: ToastDayOrdersCacheEntry): TicketMatchDetail | null => {
    for (const key of upperCandidates) {
      const m = entry.byTicket.get(key)
      if (m) return m
    }
    return null
  }

  const nowMs = Date.now()
  let entry = toastDayOrdersRamCache.get(cacheKey)
  if (entry && nowMs < entry.expiresAt) {
    const cachedHit = findInEntry(entry)
    if (cachedHit) return { hit: cachedHit, networkError: false }
    if (entry.complete) return { hit: null, networkError: false }
  } else {
    entry = {
      expiresAt: nowMs + TOAST_ORDERS_CACHE_TTL_MS,
      byTicket: new Map<string, TicketMatchDetail>(),
      complete: false,
      nextPage: 1,
      minOrder: null,
      maxOrder: null
    }
    toastDayOrdersRamCache.set(cacheKey, entry)
  }

  const inflightKey = `${cacheKey}|${upperCandidates[0] || ''}`
  const existingPromise = inflightToastBatch.get(inflightKey)
  if (existingPromise) return existingPromise

  const runner = (async (): Promise<{ hit: TicketMatchDetail | null; networkError: boolean }> => {
    try {
      const token = await getAuthToken()
      if (!token) return { hit: null, networkError: true }
      const diningMap = await getCachedDiningOptionsMap(token, storeGuid)

      const deadlineMs = Date.now() + TOAST_OVERALL_BUDGET_MS
      let startPage = entry!.nextPage
      while (startPage <= TOAST_MAX_PAGES && Date.now() < deadlineMs) {
        const batchPages: number[] = []
        for (let i = 0; i < TOAST_PAGE_BATCH_SIZE && startPage + i <= TOAST_MAX_PAGES; i++) {
          batchPages.push(startPage + i)
        }

        const pageResults: Array<{ page: number; orders: any[] }> = []
        for (const p of batchPages) {
          const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${yyyymmdd}&pageSize=100&page=${p}&fields=${encodeURIComponent(TOAST_TICKET_LOOKUP_FIELDS)}`
          let fetchedOrders: any[] | null = null
          let lastStatus = 0
          for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(url, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Toast-Restaurant-External-ID': storeGuid
              },
              signal: AbortSignal.timeout(4500)
            })
            lastStatus = res.status
            if (res.ok) {
              const json = await res.json()
              fetchedOrders = Array.isArray(json) ? json : []
              break
            }
            if ((res.status === 429 || res.status >= 500) && attempt < 2 && Date.now() + 900 < deadlineMs) {
              const retryHeader = Number(res.headers.get('retry-after') || '')
              const waitMs =
                Number.isFinite(retryHeader) && retryHeader > 0
                  ? Math.min(2000, retryHeader * 1000)
                  : 600 * (attempt + 1)
              await new Promise((r) => setTimeout(r, waitMs))
              continue
            }
            throw new Error(`Toast ordersBulk HTTP ${lastStatus} on page ${p}`)
          }
          if (fetchedOrders !== null) {
            pageResults.push({ page: p, orders: fetchedOrders })
          }
        }

        let reachedEnd = false
        for (const pr of pageResults) {
          for (const ord of pr.orders) {
            indexToastOrderIntoMap(ord, diningMap, entry!)
          }
          if (pr.orders.length < 100) {
            reachedEnd = true
          }
        }

        entry!.nextPage = startPage + batchPages.length
        entry!.expiresAt = Date.now() + TOAST_ORDERS_CACHE_TTL_MS
        if (reachedEnd) {
          entry!.complete = true
        }

        const foundHit = findInEntry(entry!)
        if (foundHit) {
          return { hit: foundHit, networkError: false }
        }

        if (reachedEnd) {
          return { hit: null, networkError: false }
        }

        startPage += batchPages.length
      }

      return { hit: null, networkError: false }
    } catch (err) {
      console.warn('[toast-ticket-validator] Toast API lookup warning:', err instanceof Error ? err.message : err)
      return { hit: null, networkError: true }
    } finally {
      inflightToastBatch.delete(inflightKey)
    }
  })()

  inflightToastBatch.set(inflightKey, runner)
  return runner
}

/**
 * Valida en tiempo real si un número de ticket u orden existe realmente para la sucursal y fecha laboral
 * indicadas, consultando primero Supabase (`order_ready_announcements`, `dt_orders`,
 * `delivery_packing_audits`, `gavilan_pos_orders`, `delivery_platform_orders`, `app_orders`) y solo si no
 * aparece ahí, consultando secuencialmente la API en vivo de Toast POS (`/orders/v2/ordersBulk`).
 */
export async function validateStoreOrderTicket(
  params: ValidateStoreOrderTicketParams
): Promise<ValidateStoreOrderTicketResult> {
  const { storeId, ticketOrOrderNumber, purchaseDateText, customerName, now = new Date() } = params
  const businessDate = resolveTicketBusinessDate(purchaseDateText, now)
  const store = await getStoreTicketMeta(storeId)
  const parsed = cleanSpokenTicketNumber(ticketOrOrderNumber)
  const cleanCustomer = String(customerName || '').trim()

  if (parsed.isNoTicket) {
    return {
      ok: true,
      skippedNoTicket: true,
      ticketNumber: 'SIN TICKET',
      businessDate,
      storeName: store.customerNameEs,
      storeNameEn: store.customerNameEn
    }
  }

  if ((!parsed.ticketNumber || parsed.candidates.length === 0) && cleanCustomer.length < 3) {
    return {
      ok: true,
      found: false,
      ticketNumber: String(ticketOrOrderNumber || '').trim(),
      businessDate,
      storeName: store.customerNameEs,
      storeNameEn: store.customerNameEn,
      toastNetworkError: false,
      messageEs: `No se detectó un número de ticket válido para ${store.customerNameEs}. Pídele amablemente al cliente el número impreso en la parte superior de su recibo, o que confirme si no conserva el ticket ('SIN TICKET').`,
      messageEn: `No valid ticket number was detected for ${store.customerNameEn}. Kindly ask the caller for the number printed at the top of their receipt, or to confirm if they no longer have the ticket ('SIN TICKET').`
    }
  }

  const yyyymmdd = businessDate.replace(/-/g, '')
  const warmToastEntry = store.externalId ? toastDayOrdersRamCache.get(`${store.externalId}|${yyyymmdd}`) : undefined
  if (warmToastEntry && Date.now() < warmToastEntry.expiresAt && parsed.candidates.length > 0) {
    for (const cand of parsed.candidates) {
      const instantHit = warmToastEntry.byTicket.get(cand.toUpperCase())
      if (instantHit) {
        return {
          ok: true,
          found: true,
          ticketNumber: instantHit.ticketNumber,
          businessDate,
          storeName: store.customerNameEs,
          storeNameEn: store.customerNameEn,
          channel: instantHit.channel || 'POS Sucursal',
          itemsSummary: instantHit.itemsSummary || '',
          matchedSource: instantHit.source,
          toastNetworkError: false,
          messageEs: `El ticket #${instantHit.ticketNumber} del ${businessDate} en ${store.customerNameEs} SÍ existe en nuestro sistema (${instantHit.channel}${instantHit.itemsSummary ? `: ${instantHit.itemsSummary}` : ''}). Confirma con amabilidad que ya localizaste su orden en el sistema y pídele únicamente lo que falte (nombre y teléfono real de 10 dígitos) para enviar la alerta prioritaria al gerente.`,
          messageEn: `Ticket #${instantHit.ticketNumber} on ${businessDate} at ${store.customerNameEn} WAS FOUND in our system (${instantHit.channel}${instantHit.itemsSummary ? `: ${instantHit.itemsSummary}` : ''}). Kindly confirm that you located their order in our system and ask only for any remaining info (name and valid 10-digit phone number) to send the priority alert to the manager.`
        }
      }
    }
  }

  // 1) Consultar primero Supabase (cero llamadas innecesarias a Toast cuando ya existe en cache/DB)
  const supaRes = await querySupabaseTicketSources(
    store,
    businessDate,
    parsed.ticketNumber,
    parsed.candidates,
    cleanCustomer || null
  ).catch(() => ({ hit: null, observedRange: null }))

  const buildHitResult = (hit: TicketMatchDetail, observedRange: TicketObservedRange | null): ValidateStoreOrderTicketResult => {
    const channel = hit.channel || 'POS Sucursal'
    const statusSuffixEs = hit.statusText ? ` — Estatus actual: ${hit.statusText}` : ''
    const custSuffixEs = hit.customerName ? ` a nombre de ${hit.customerName}` : ''
    const itemsSummary = hit.itemsSummary || ''
    return {
      ok: true,
      found: true,
      matchedByCustomer: Boolean(cleanCustomer && !parsed.ticketNumber),
      ticketNumber: hit.ticketNumber,
      businessDate,
      storeName: store.customerNameEs,
      storeNameEn: store.customerNameEn,
      channel,
      statusText: hit.statusText,
      customerName: hit.customerName,
      itemsSummary,
      matchedSource: hit.source,
      observedRange,
      toastNetworkError: false,
      messageEs: `La orden #${hit.ticketNumber}${custSuffixEs} del ${businessDate} en ${store.customerNameEs} SÍ existe en nuestro sistema (${channel}${statusSuffixEs}${itemsSummary ? `: ${itemsSummary}` : ''}). Confirma con claridad este dato real y pídele únicamente lo que falte (nombre y teléfono real de 10 dígitos si aplica) para el gerente.`,
      messageEn: `Order #${hit.ticketNumber}${hit.customerName ? ` under ${hit.customerName}` : ''} on ${businessDate} at ${store.customerNameEn} WAS FOUND in our system (${channel}${hit.statusText ? ` — Status: ${hit.statusText}` : ''}${itemsSummary ? `: ${itemsSummary}` : ''}). Confirm these real details and ask only for any remaining info.`
    }
  }

  if (supaRes.hit) {
    return buildHitResult(supaRes.hit, supaRes.observedRange)
  }

  // 2) Fallback secuencial en Toast Live API solo cuando no existe aún en Supabase
  const toastOutcome = parsed.candidates.length > 0
    ? await queryLiveToastTicket(store.externalId, businessDate, parsed.candidates)
    : { hit: null, networkError: false }

  const postToastEntry = store.externalId ? toastDayOrdersRamCache.get(`${store.externalId}|${yyyymmdd}`) : undefined
  const mergedRange: TicketObservedRange | null = (() => {
    const mins = [supaRes.observedRange?.minOrder, postToastEntry?.minOrder].filter((n): n is number => typeof n === 'number')
    const maxs = [supaRes.observedRange?.maxOrder, postToastEntry?.maxOrder].filter((n): n is number => typeof n === 'number')
    const cnt = Math.max(supaRes.observedRange?.count || 0, postToastEntry?.byTicket.size || 0)
    if (cnt === 0 && mins.length === 0) return supaRes.observedRange
    return {
      minOrder: mins.length > 0 ? Math.min(...mins) : null,
      maxOrder: maxs.length > 0 ? Math.max(...maxs) : null,
      count: cnt,
      businessDate
    }
  })()

  if (toastOutcome.hit) {
    return buildHitResult(toastOutcome.hit, mergedRange)
  }

  const numericAsked = /^\d+$/.test(parsed.ticketNumber) ? Number(parsed.ticketNumber) : null
  const rangeHintEs =
    mergedRange && mergedRange.minOrder !== null && mergedRange.maxOrder !== null
      ? ` (los tickets registrados para el ${businessDate} en esa sucursal van del #${mergedRange.minOrder} al #${mergedRange.maxOrder})`
      : ''
  const rangeHintEn =
    mergedRange && mergedRange.minOrder !== null && mergedRange.maxOrder !== null
      ? ` (registered tickets on ${businessDate} for that location range from #${mergedRange.minOrder} to #${mergedRange.maxOrder})`
      : ''

  const clearlyOutOfSyncedRange =
    numericAsked !== null &&
    mergedRange !== null &&
    mergedRange.count >= 5 &&
    mergedRange.minOrder !== null &&
    mergedRange.maxOrder !== null &&
    (numericAsked > mergedRange.maxOrder + 35 || numericAsked < mergedRange.minOrder - 5)

  if (toastOutcome.networkError && !clearlyOutOfSyncedRange) {
    return {
      ok: true,
      found: false,
      ticketNumber: parsed.ticketNumber || cleanCustomer,
      businessDate,
      storeName: store.customerNameEs,
      storeNameEn: store.customerNameEn,
      observedRange: mergedRange,
      toastNetworkError: true,
      messageEs: `En este momento no fue posible completar la consulta en línea del ticket #${parsed.ticketNumber || cleanCustomer} en ${store.customerNameEs}${rangeHintEs}; toma el nombre y teléfono de 10 dígitos del cliente para que el gerente verifique directamente el ticket #${parsed.ticketNumber || cleanCustomer} del ${businessDate}.`,
      messageEn: `Live verification for ticket #${parsed.ticketNumber || cleanCustomer} at ${store.customerNameEn} is momentarily unavailable${rangeHintEn}; collect the caller's name and 10-digit phone number so the manager can verify ticket #${parsed.ticketNumber || cleanCustomer} from ${businessDate} directly.`
    }
  }

  return {
    ok: true,
    found: false,
    ticketNumber: parsed.ticketNumber || cleanCustomer,
    businessDate,
    storeName: store.customerNameEs,
    storeNameEn: store.customerNameEn,
    observedRange: mergedRange,
    toastNetworkError: false,
    messageEs: `El ticket #${parsed.ticketNumber || cleanCustomer} NO existe ni aparece registrado en ${businessDate} en ${store.customerNameEs}${rangeHintEs}. Informa con amabilidad y claridad al cliente que ese número de ticket no aparece en nuestro sistema para esa fecha/sucursal, y pídele verificar el número impreso en la parte superior de su recibo, confirmar en qué sucursal o fecha compró, o indicar si pidió por Uber Eats/DoorDash.`,
    messageEn: `Ticket #${parsed.ticketNumber || cleanCustomer} DOES NOT exist and is not registered on ${businessDate} at ${store.customerNameEn}${rangeHintEn}. Kindly and clearly let the caller know that this ticket number does not appear in our system for that date and location, and ask them to double-check the number printed at the top of their receipt, confirm which location or date they ordered from, or let you know if they ordered through Uber Eats or DoorDash.`
  }
}
