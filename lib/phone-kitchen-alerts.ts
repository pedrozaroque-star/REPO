/**
 * @module lib/phone-kitchen-alerts
 * @description Motor operativo en tiempo real para los 3 flujos avanzados de la Contestadora IA (Kore 3.8 Live /
 *   teléfono y simulador) hacia la tableta PREPARADOR (`/inventory/preparador`), `/order-ready-board` y Delivery Armor:
 *   1) **Cambio de Horario de Recolección en Órdenes Toast (`request_type: 'pickup_time_change'`)**:
 *      Valida la nueva hora solicitada contra el horario real de la sucursal (incluyendo `weekly_hours`,
 *      `phone_special_hours` y los 7 festivos oficiales de `lib/holidays.ts`), localiza la orden viva o programada
 *      (`promisedDate` / `ordersBulk` del día completo, superando la ventana de 180 min) y envía alerta parpadeante
 *      en `< 500 ms` a cocina/mostrador con la hora anterior → nueva hora y los platillos exactos de Toast.
 *   2) **Transferencia Coordinada de Sucursal Equivocada (`wrong_store_stop` + `wrong_store_prepare`)**:
 *      Localiza la orden real en la sucursal donde cayó por error (`paidStoreId`) para extraer los platillos pagados
 *      y envía SIMULTÁNEAMENTE dos alertas sincronizadas en `< 500 ms` (+ recados en `phone_callback_requests`):
 *      - A `paidStoreId`: **`🛑 NO PREPARAR`** (avisa que la orden se movió a `prepareStoreId`).
 *      - A `prepareStoreId`: **`🍳 PREPARAR AQUÍ`** con los platillos exactos pagados en `paidStoreId`, número de orden,
 *        nombre, teléfono y hora de recolección.
 *   3) **Personalización de Fiesta Platters / Party Trays de Plataformas (`fiesta_platter_custom`)**:
 *      Valida el desglose de carnes (1 sola carne o múltiples carnes divididas en libras exactas, ej. 12 lbs = 4 Asada +
 *      4 Pollo + 4 Pastor), aguas frescas y tortillas contra la guía oficial `PARTY_TRAY_GUIDELINES` (6 / 7.5 / 10 / 12 lbs;
 *      3 / 4 / 5 / 6 galones) bloqueando excesos gratis, y dispara alerta directa para los cocineros en la tableta
 *      PREPARADOR en las **15 sucursales** (incluyendo `#7 Slauson` y `#8 Hollywood`).
 *
 * @businessRules
 * - Día laboral California (`America/Los_Angeles`): 6:00 AM a 5:59 AM del día siguiente.
 * - Protocolo Toast API: siempre traduce `diningOption.guid` con `getDiningOptionsMap` antes de clasificar canales.
 * - Nomenclatura Los Ángeles frente al cliente (`lib/customer-store-names.ts`): siempre usar entrecalles oficiales en
 *   `#5 Los Ángeles (Vernon y Broadway)`, `#6 Los Ángeles (Central y Washington)` y `#7 Los Ángeles (Slauson y Broadway)`.
 * - Todos los precios y reglas pertenecen exclusivamente a **Tacos Gavilan** (`USD`).
 *
 * @dataFlow
 * - `phone-live-bridge` (HMAC POST `/api/delivery-armor/phone-notes`) / `lib/phone-live-kore` / `lib/phone-agent`
 *   -> `lib/phone-kitchen-alerts.ts` -> Toast API (solo lectura) + `public.delivery_armor_phone_notes` (+ `phone_callback_requests`)
 *   -> Supabase Realtime Broadcast (`blindaje-delivery-phone-notes-{storeId}`, `event: 'phone_note_updated'`)
 *   -> PREPARADOR (`/inventory/preparador`), `/order-ready-board` y Delivery Armor (`/admin/blindaje-delivery/empaque`).
 *
 * @notes
 * - Creado 2026-11-24 a solicitud explícita de Carlos (3 requisitos operativos para Toast pickup time, wrong-store dual alert
 *   y personalización de Fiesta Platters para cocineros en tableta PREPARADOR).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import { getOfficialStoreHolidaySchedule } from '@/lib/holidays'
import { formatCustomerStoreName } from '@/lib/customer-store-names'
import { getAuthToken, getDiningOptionsMap } from '@/lib/toast-api'
import {
  fetchOffPremiseOrders,
  type DeliveryPlatform,
  type OffPremiseOrder,
  type OrderItemDetail
} from '@/lib/delivery-armor'
import {
  broadcastDeliveryArmorPhoneNotePing,
  formatPlatformLabel,
  mapDbRowToPhoneNote,
  matchDeliveryArmorOrderFromList,
  normalizeDeliveryPlatformInput,
  type DeliveryArmorPhoneNote,
  type FiestaPlatterCustomSpec
} from '@/lib/delivery-armor-phone-notes'
import { PARTY_TRAY_GUIDELINES, type PartyTraySize } from '@/lib/inventory/party-tray-guidelines'

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

export interface ExtendedToastOrderForPhone extends OffPremiseOrder {
  promisedDate?: string | null
  estimatedFulfillmentDate?: string | null
  approvalStatus?: string | null
  formattedPromisedTimePt?: string | null
}

function foldAscii(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatIsoTimeInCalifornia(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(ms))
  } catch {
    return null
  }
}

export function formatMinutesTo12h(totalMins: number): string {
  const norm = ((Math.round(totalMins) % 1440) + 1440) % 1440
  const h24 = Math.floor(norm / 60)
  const m = norm % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * Parsea horas habladas o escritas en español o inglés ("2:30 PM", "14:30", "3 de la tarde", "dos y media pm",
 * "11:15 am", "en 45 minutos", "in 1 hour") a minutos desde medianoche (0..1439) y una etiqueta limpia ("2:30 PM").
 */
export function parseRequestedPickupTime(
  rawText: string | null | undefined,
  nowDate: Date = new Date()
): { minutesOfDay: number; formatted12h: string; isRelative: boolean } | null {
  const raw = String(rawText || '').trim()
  if (!raw) return null
  const norm = foldAscii(raw)

  // 1. Tiempo relativo ("en 45 minutos", "in 1 hour", "en una hora y media")
  const relMinMatch = norm.match(/\b(?:en|in)\s+(\d{1,3})\s*(?:min|mins|minuto|minutos|minute|minutes)\b/)
  if (relMinMatch) {
    const delta = Number(relMinMatch[1])
    if (Number.isFinite(delta) && delta >= 5 && delta <= 720) {
      const target = new Date(nowDate.getTime() + delta * 60_000)
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(target)
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12') % 24
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
      const mins = h * 60 + m
      return { minutesOfDay: mins, formatted12h: formatMinutesTo12h(mins), isRelative: true }
    }
  }
  const relHourMatch = norm.match(/\b(?:en|in)\s+(?:(\d+(?:\.\d+)?)|una|un|one|an)\s*(?:hr|hrs|hora|horas|hour|hours)(?:\s+y\s+media)?\b/)
  if (relHourMatch) {
    const baseHours = relHourMatch[1] ? Number(relHourMatch[1]) : 1
    const extraHalf = /y\s+media|and\s+a\s+half/.test(norm) ? 0.5 : 0
    const deltaMins = Math.round((baseHours + extraHalf) * 60)
    if (deltaMins >= 15 && deltaMins <= 720) {
      const target = new Date(nowDate.getTime() + deltaMins * 60_000)
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(target)
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12') % 24
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
      const mins = h * 60 + m
      return { minutesOfDay: mins, formatted12h: formatMinutesTo12h(mins), isRelative: true }
    }
  }

  // 2. Mediodía / Medianoche explícito
  if (/\b(mediodia|medio\s+dia|noon)\b/.test(norm)) {
    return { minutesOfDay: 12 * 60, formatted12h: '12:00 PM', isRelative: false }
  }
  if (/\b(medianoche|media\s+noche|midnight)\b/.test(norm)) {
    return { minutesOfDay: 0, formatted12h: '12:00 AM', isRelative: false }
  }

  // 3. Formato numérico explícito: "2:30 pm", "14:30", "3 pm", "las 5 y media de la tarde", "las 8:15 de la noche"
  const hhmm = norm.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.|de\s+la\s+manana|de\s+la\s+tarde|de\s+la\s+noche|de\s+la\s+madrugada|in\s+the\s+morning|in\s+the\s+afternoon|at\s+night)?\b/)
  if (!hhmm) return null

  let hour = Number(hhmm[1])
  let minute = hhmm[2] ? Number(hhmm[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null

  if (!hhmm[2] && /\by\s+media\b|\bhalf\s+past\b/.test(norm)) {
    minute = 30
  } else if (!hhmm[2] && /\by\s+cuarto\b|\bquarter\s+past\b/.test(norm)) {
    minute = 15
  }

  const meridiemRaw = String(hhmm[3] || '')
  const hasExplicitPm =
    /pm|p\.m\.|tarde|noche|afternoon|evening|night/.test(meridiemRaw) ||
    /\b(pm|p\.m\.|de\s+la\s+tarde|de\s+la\s+noche|afternoon|evening|night)\b/.test(norm)
  const hasExplicitAm =
    /am|a\.m\.|manana|madrugada|morning/.test(meridiemRaw) ||
    /\b(am|a\.m\.|de\s+la\s+manana|de\s+la\s+madrugada|morning)\b/.test(norm)

  if (hasExplicitPm && hour >= 1 && hour <= 11) {
    hour += 12
  } else if (hasExplicitAm && hour === 12) {
    hour = 0
  } else if (!hasExplicitPm && !hasExplicitAm && hour >= 1 && hour <= 11) {
    // Sin AM/PM explícito: usar heurística de la hora actual en California (si son >= 11 AM y dicen "2" -> 2:00 PM)
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false
    }).formatToParts(nowDate)
    const nowH = Number(nowParts.find((p) => p.type === 'hour')?.value ?? '12') % 24
    if (hour <= 6) {
      // 1..6 sin AM/PM casi siempre es PM (salvo madrugada 12 AM - 3 AM)
      if (nowH >= 6 && nowH <= 21) hour += 12
    } else if (nowH >= 12 && hour < 12 && hour + 12 >= nowH) {
      hour += 12
    }
  }

  const mins = hour * 60 + minute
  return { minutesOfDay: mins, formatted12h: formatMinutesTo12h(mins), isRelative: false }
}

function parseHhMmString(raw: string | null | undefined): number | null {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return dt.toISOString().slice(0, 10)
}

function getDayOfWeekForYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

export interface StoreHoursValidationResult {
  valid: boolean
  isClosedAllDay: boolean
  targetDate: string
  openLabel: string | null
  closeLabel: string | null
  holidayNameEs?: string | null
  holidayNameEn?: string | null
  reasonEs?: string
  reasonEn?: string
}

/**
 * Valida si `requestedMinutes` (0..1439) cae dentro del horario real de la sucursal en `targetDate` (YYYY-MM-DD),
 * respetando `stores.weekly_hours`, `phone_special_hours` y los 7 festivos oficiales de `lib/holidays.ts`,
 * además de la regla de día laboral 6:00 AM–5:59 AM (`America/Los_Angeles`).
 */
export async function validatePickupTimeAgainstStoreHours(
  storeId: number,
  requestedMinutes: number,
  targetDate: string
): Promise<StoreHoursValidationResult> {
  const { data: storeRow } = await supabaseAdmin
    .from('stores')
    .select('id, code, name, opening_time, closing_time, weekly_hours')
    .eq('id', storeId)
    .maybeSingle()

  const dow = getDayOfWeekForYmd(targetDate)
  let openMins = parseHhMmString(storeRow?.opening_time) ?? 8 * 60
  let closeMins = parseHhMmString(storeRow?.closing_time) ?? 24 * 60 - 1

  if (Array.isArray(storeRow?.weekly_hours)) {
    const dayEntry = (storeRow.weekly_hours as Array<{ day?: number; open?: string; close?: string }>).find(
      (d) => Number(d?.day) === dow
    )
    if (dayEntry) {
      const parsedOpen = parseHhMmString(dayEntry.open)
      const parsedClose = parseHhMmString(dayEntry.close)
      if (parsedOpen !== null) openMins = parsedOpen
      if (parsedClose !== null) closeMins = parsedClose
    }
  }

  // Aplicar festivo oficial de lib/holidays.ts
  let isClosedAllDay = false
  let holidayNameEs: string | null = null
  let holidayNameEn: string | null = null
  const officialHoliday = getOfficialStoreHolidaySchedule(targetDate)
  if (officialHoliday) {
    holidayNameEs = officialHoliday.holiday_name_es
    holidayNameEn = officialHoliday.holiday_name_en
    if (officialHoliday.is_closed) {
      isClosedAllDay = true
    } else {
      const holOpen = parseHhMmString(officialHoliday.open_time)
      const holClose = parseHhMmString(officialHoliday.close_time)
      if (holOpen !== null) openMins = holOpen
      if (holClose !== null) closeMins = holClose
    }
  }

  // Overrides explícitos en phone_special_hours (sucursal específica > global)
  const { data: specialRows } = await supabaseAdmin
    .from('phone_special_hours')
    .select('store_id, holiday_name, is_closed, open_time, close_time')
    .eq('event_date', targetDate)
    .or(`store_id.eq.${storeId},store_id.is.null`)

  if (Array.isArray(specialRows) && specialRows.length > 0) {
    const chosen =
      specialRows.find((r: any) => Number(r.store_id) === storeId) ||
      specialRows.find((r: any) => r.store_id == null)
    if (chosen) {
      if (chosen.holiday_name) {
        holidayNameEs = String(chosen.holiday_name)
        holidayNameEn = String(chosen.holiday_name)
      }
      if (chosen.is_closed) {
        isClosedAllDay = true
      } else {
        isClosedAllDay = false
        const spOpen = parseHhMmString(chosen.open_time)
        const spClose = parseHhMmString(chosen.close_time)
        if (spOpen !== null) openMins = spOpen
        if (spClose !== null) closeMins = spClose
      }
    }
  }

  const storeDisplayEs = formatCustomerStoreName({ id: storeId, code: storeRow?.code, name: storeRow?.name }, 'es')
  const storeDisplayEn = formatCustomerStoreName({ id: storeId, code: storeRow?.code, name: storeRow?.name }, 'en')

  if (isClosedAllDay) {
    return {
      valid: false,
      isClosedAllDay: true,
      targetDate,
      openLabel: null,
      closeLabel: null,
      holidayNameEs,
      holidayNameEn,
      reasonEs: `${storeDisplayEs} permanecerá cerrada todo el día (${holidayNameEs || targetDate}).`,
      reasonEn: `${storeDisplayEn} is closed all day (${holidayNameEn || targetDate}).`
    }
  }

  // En día laboral 6:00 AM–5:59 AM, si el cierre es de madrugada (< openMins, ej. 01:00 o 03:00),
  // desplazar cualquier hora < 6:00 AM (+1440 min) para comparar en una línea continua.
  const shiftBusiness = (mins: number) => (mins < 6 * 60 ? mins + 1440 : mins)
  const openAdj = shiftBusiness(openMins)
  const closeAdj = closeMins <= openMins ? closeMins + 1440 : shiftBusiness(closeMins)
  const reqAdj = shiftBusiness(requestedMinutes)

  const openLabel = formatMinutesTo12h(openMins)
  const closeLabel = formatMinutesTo12h(closeMins)

  // Permitir recoger desde la hora de apertura hasta 10 min antes del cierre (o exacto hasta cierre)
  const valid = reqAdj >= openAdj && reqAdj <= closeAdj
  if (!valid) {
    return {
      valid: false,
      isClosedAllDay: false,
      targetDate,
      openLabel,
      closeLabel,
      holidayNameEs,
      holidayNameEn,
      reasonEs: `La hora solicitada queda fuera del horario de ${storeDisplayEs} (${openLabel} a ${closeLabel}${holidayNameEs ? ` por ${holidayNameEs}` : ''}).`,
      reasonEn: `The requested time falls outside ${storeDisplayEn}'s operating hours (${openLabel} to ${closeLabel}${holidayNameEn ? ` for ${holidayNameEn}` : ''}).`
    }
  }

  return {
    valid: true,
    isClosedAllDay: false,
    targetDate,
    openLabel,
    closeLabel,
    holidayNameEs,
    holidayNameEn
  }
}

function formatItemsSummary(items: OrderItemDetail[] | null | undefined): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const parts = items.slice(0, 10).map((it) => {
    const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1
    const mods =
      Array.isArray(it.modifiers) && it.modifiers.length > 0
        ? ` (${it.modifiers.slice(0, 3).join(', ')})`
        : ''
    return `${qty}× ${it.displayName}${mods}`
  })
  const extra = items.length > 10 ? ` +${items.length - 10}` : ''
  return `${parts.join(' • ')}${extra}`.slice(0, 420)
}

function classifyDiningOptionNameToPlatform(diningName: string, sourceRaw: string): DeliveryPlatform {
  const n = foldAscii(diningName)
  const s = foldAscii(sourceRaw)
  if (n.includes('doordash') || n.includes('door dash') || n.includes('caviar')) return 'DOORDASH'
  if (n.includes('uber') || n.includes('postmates')) return 'UBER_EATS'
  if (n.includes('grubhub') || n.includes('grub hub') || n.includes('seamless')) return 'GRUBHUB'
  if (n.includes('online') || n.includes('curbside') || n.includes('toast') || s === 'online' || s === 'api') {
    return 'TOAST_ONLINE'
  }
  if (n.includes('takeout') || n.includes('take out') || n.includes('to go') || n.includes('pickup')) {
    return 'TAKEOUT'
  }
  return 'OTHER'
}

/**
 * Busca órdenes en vivo (últimos 180 min vía `fetchOffPremiseOrders`) Y, si no aparece ahí (por ejemplo
 * una orden Toast Online o Fiesta Platter programada hace más de 3 horas para recoger hoy o mañana),
 * consulta `GET /orders/v2/ordersBulk?businessDate=YYYYMMDD` trayendo `promisedDate`, `estimatedFulfillmentDate`,
 * `approvalStatus`, `customer`, `tabName` y `selections` respetando el Protocolo Toast API (`getDiningOptionsMap`).
 */
export async function fetchExtendedToastOrdersForPhoneLookup(
  storeId: number,
  options?: {
    targetBusinessDate?: string
    includeFullDayToastScan?: boolean
    ordersOverride?: ExtendedToastOrderForPhone[]
  }
): Promise<ExtendedToastOrderForPhone[]> {
  if (Array.isArray(options?.ordersOverride)) {
    return options.ordersOverride
  }

  const mergedByGuid = new Map<string, ExtendedToastOrderForPhone>()

  // 1. Órdenes vivas de los últimos 180 min + auditorías Delivery Armor
  try {
    const live = await fetchOffPremiseOrders(storeId)
    for (const o of live.orders || []) {
      mergedByGuid.set(o.orderGuid, { ...o })
    }
  } catch (err) {
    console.error('[phone-kitchen-alerts] fetchOffPremiseOrders error:', err)
  }

  if (options?.includeFullDayToastScan === false) {
    return Array.from(mergedByGuid.values())
  }

  // 2. Escaneo ligero del businessDate completo en Toast (para órdenes programadas / futuras > 3h)
  try {
    const { data: storeRow } = await supabaseAdmin
      .from('stores')
      .select('id, name, external_id')
      .eq('id', storeId)
      .maybeSingle()

    const restaurantGuid = String(storeRow?.external_id || '').trim()
    if (!restaurantGuid) return Array.from(mergedByGuid.values())

    const token = await getAuthToken()
    if (!token) return Array.from(mergedByGuid.values())
    const diningMap = await getDiningOptionsMap(token, restaurantGuid)
    const targetYmd = (options?.targetBusinessDate || getCaliforniaBusinessDate()).replace(/-/g, '')
    const fields = [
      'guid',
      'displayNumber',
      'promisedDate',
      'estimatedFulfillmentDate',
      'approvalStatus',
      'openedDate',
      'voided',
      'deleted',
      'source',
      'diningOption',
      'checks.displayNumber',
      'checks.tabName',
      'checks.customer',
      'checks.voided',
      'checks.deleted',
      'checks.selections.guid',
      'checks.selections.displayName',
      'checks.selections.quantity',
      'checks.selections.price',
      'checks.selections.modifiers.displayName',
      'checks.selections.fulfillmentStatus',
      'checks.selections.voided'
    ].join(',')

    const deadline = Date.now() + 5500
    for (let page = 1; page <= 10; page++) {
      if (Date.now() > deadline) break
      const url = `${TOAST_API_HOST}/orders/v2/ordersBulk?businessDate=${targetYmd}&pageSize=100&page=${page}&fields=${encodeURIComponent(fields)}`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 3500)
      let rows: any[] = []
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            'Toast-Restaurant-External-ID': restaurantGuid
          }
        })
        if (!res.ok) break
        const data = await res.json().catch(() => null)
        rows = Array.isArray(data) ? data : []
      } finally {
        clearTimeout(timer)
      }

      for (const raw of rows) {
        if (!raw || raw.voided || raw.deleted || !raw.guid) continue
        const guid = String(raw.guid)
        const promisedDate = raw.promisedDate ? String(raw.promisedDate) : null
        const estDate = raw.estimatedFulfillmentDate ? String(raw.estimatedFulfillmentDate) : null
        const approvalStatus = raw.approvalStatus ? String(raw.approvalStatus) : null
        const formattedPromisedTimePt = formatIsoTimeInCalifornia(promisedDate || estDate)

        const existing = mergedByGuid.get(guid)
        if (existing) {
          existing.promisedDate = promisedDate || existing.promisedDate || null
          existing.estimatedFulfillmentDate = estDate || existing.estimatedFulfillmentDate || null
          existing.approvalStatus = approvalStatus || existing.approvalStatus || null
          existing.formattedPromisedTimePt = formattedPromisedTimePt || existing.formattedPromisedTimePt || null
          continue
        }

        const diningGuid = String(raw.diningOption?.guid || '')
        const diningName = (diningGuid && diningMap[diningGuid]) || ''
        const platform = classifyDiningOptionNameToPlatform(diningName, String(raw.source || ''))
        const checks = Array.isArray(raw.checks) ? raw.checks.filter((c: any) => c && !c.voided && !c.deleted) : []
        const firstCheck = checks[0] || {}
        const custObj = firstCheck.customer || {}
        const fullName = [custObj.firstName, custObj.lastName].filter(Boolean).join(' ').trim()
        const customerName = fullName || String(firstCheck.tabName || '').trim() || 'Cliente Online'
        const displayNumber = String(raw.displayNumber || firstCheck.displayNumber || '').trim()

        const items: OrderItemDetail[] = []
        let allReady = true
        let hasSelections = false
        for (const ch of checks) {
          const sels = Array.isArray(ch.selections) ? ch.selections : []
          for (const sel of sels) {
            if (!sel || sel.voided) continue
            hasSelections = true
            const fStatus = String(sel.fulfillmentStatus || '').toUpperCase()
            if (fStatus !== 'READY') allReady = false
            const mods = Array.isArray(sel.modifiers)
              ? sel.modifiers.map((m: any) => String(m?.displayName || '').trim()).filter(Boolean)
              : []
            items.push({
              id: String(sel.guid || `${guid}-${items.length}`),
              displayName: String(sel.displayName || 'Platillo'),
              quantity: Number(sel.quantity) > 0 ? Number(sel.quantity) : 1,
              price: Number(sel.price) || 0,
              modifiers: mods,
              isHighRiskDrink: /horchata|jamaica|pina|tamarindo|soda|coca|jarrito|agua|champurrado|cafe/i.test(
                String(sel.displayName || '')
              )
            })
          }
        }

        const shortOrderKey = displayNumber ? `#${displayNumber}` : guid.slice(-6).toUpperCase()
        mergedByGuid.set(guid, {
          orderGuid: guid,
          displayNumber,
          storeId,
          storeName: String(storeRow?.name || ''),
          platform,
          diningOptionGuid: diningGuid,
          diningOptionName: diningName || platform,
          customerName,
          maskedCustomerName: customerName.split(/\s+/)[0] || customerName,
          platformOrderKey: `${platform === 'TOAST_ONLINE' ? 'TOAST' : platform} ${shortOrderKey}`,
          shortOrderKey,
          openedDate: String(raw.openedDate || new Date().toISOString()),
          kdsStatus: hasSelections && allReady ? 'READY' : 'IN_KITCHEN',
          kdsSentAt: String(raw.openedDate || new Date().toISOString()),
          kdsReadyAt: null,
          kdsPrepSeconds: null,
          items,
          totalItemsCount: items.reduce((acc, it) => acc + it.quantity, 0),
          promisedDate,
          estimatedFulfillmentDate: estDate,
          approvalStatus,
          formattedPromisedTimePt
        })
      }

      if (rows.length < 100) break
    }
  } catch (err) {
    console.error('[phone-kitchen-alerts] full-day Toast scan error:', err)
  }

  return Array.from(mergedByGuid.values())
}

async function resolveCallIdBySid(callId?: string | null, callSid?: string | null): Promise<string | null> {
  if (callId) return callId
  if (!callSid) return null
  const { data } = await supabaseAdmin
    .from('phone_calls')
    .select('id')
    .eq('call_sid', callSid)
    .maybeSingle()
  return data?.id ? String(data.id) : null
}

// ============================================================================
// FLUJO 1: CAMBIO DE HORARIO PARA RECOGER EN ÓRDENES TOAST / TACOSGAVILAN.COM
// ============================================================================

export interface ToastPickupTimeChangeParams {
  storeId: number
  source?: 'twilio' | 'simulator' | 'manual'
  callSid?: string | null
  callId?: string | null
  customerName: string
  orderCode?: string | null
  requestedPickupTime: string
  requestedDate?: string | null // 'today' | 'tomorrow' | YYYY-MM-DD
  callerPhone?: string | null
  orderedItemsHint?: string | null
  extraNotes?: string | null
  confirmSaveUnmatched?: boolean
  ordersOverride?: ExtendedToastOrderForPhone[]
}

export interface ToastPickupTimeChangeResult {
  ok: boolean
  outcome:
    | 'SENT_TO_KITCHEN'
    | 'SENT_TO_KITCHEN_ALREADY_READY'
    | 'SENT_UNMATCHED_ALERT'
    | 'OUTSIDE_STORE_HOURS'
    | 'ALREADY_DELIVERED'
    | 'AMBIGUOUS'
    | 'NOT_FOUND'
    | 'MISSING_INFO'
  note?: DeliveryArmorPhoneNote | null
  requestedPickupTimeFormatted?: string | null
  originalPickupTimeFormatted?: string | null
  storeHours?: { open: string | null; close: string | null; isClosedAllDay: boolean }
  ambiguousCandidates?: Array<{
    platform: DeliveryPlatform
    maskedCustomerName: string
    shortOrderKey: string
    stage: string
  }>
  messageEs: string
  messageEn: string
}

export async function createToastPickupTimeChangeAlert(
  params: ToastPickupTimeChangeParams
): Promise<ToastPickupTimeChangeResult> {
  const storeId = Number(params.storeId)
  const customerName = String(params.customerName || '').trim()
  const rawRequestedTime = String(params.requestedPickupTime || '').trim()

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Sucursal inválida para actualizar el horario de recolección.',
      messageEn: 'Invalid store ID for pickup time update.'
    }
  }

  if (!rawRequestedTime) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pregúntale al cliente a qué hora exacta desea pasar a recoger su orden.',
      messageEn: 'Ask the customer what exact time they would like to pick up their order.'
    }
  }

  if (!customerName && !params.orderCode) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pídele al cliente su nombre y el número de orden de Toast / tacosgavilan.com para localizarla.',
      messageEn: 'Ask the customer for their name and Toast / tacosgavilan.com order number so we can locate it.'
    }
  }

  // 1. Parsear hora solicitada y resolver fecha objetivo
  const parsedTime = parseRequestedPickupTime(rawRequestedTime)
  if (!parsedTime) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: `No pude interpretar la hora "${rawRequestedTime}". Pídele al cliente la hora exacta (por ejemplo: 2:30 PM o 6:00 PM).`,
      messageEn: `I couldn't parse the time "${rawRequestedTime}". Ask the customer for the exact pickup time (for example: 2:30 PM or 6:00 PM).`
    }
  }

  const todayYmd = getCaliforniaBusinessDate()
  let targetDate = todayYmd
  const rawDateNorm = foldAscii(params.requestedDate)
  if (rawDateNorm === 'tomorrow' || rawDateNorm === 'manana') {
    targetDate = addDaysToYmd(todayYmd, 1)
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(params.requestedDate || '').trim())) {
    targetDate = String(params.requestedDate).trim()
  }

  // 2. Validar horario real de la sucursal + 7 festivos oficiales
  const hoursCheck = await validatePickupTimeAgainstStoreHours(storeId, parsedTime.minutesOfDay, targetDate)
  if (!hoursCheck.valid) {
    return {
      ok: false,
      outcome: 'OUTSIDE_STORE_HOURS',
      requestedPickupTimeFormatted: parsedTime.formatted12h,
      storeHours: {
        open: hoursCheck.openLabel,
        close: hoursCheck.closeLabel,
        isClosedAllDay: hoursCheck.isClosedAllDay
      },
      messageEs: `${hoursCheck.reasonEs} Pregúntale al cliente si prefiere programar su recolección dentro de nuestro horario abierto.`,
      messageEn: `${hoursCheck.reasonEn} Ask the customer if they'd like to schedule pickup within our open hours.`
    }
  }

  // 3. Localizar orden Toast (viva o programada del día)
  const orders = await fetchExtendedToastOrdersForPhoneLookup(storeId, {
    targetBusinessDate: targetDate,
    ordersOverride: params.ordersOverride
  })

  const match = matchDeliveryArmorOrderFromList({
    orders,
    platform: 'TOAST_ONLINE',
    customerName,
    orderCode: params.orderCode,
    orderedItemsHint: params.orderedItemsHint
  })

  if (match.outcome === 'AMBIGUOUS') {
    return {
      ok: false,
      outcome: 'AMBIGUOUS',
      ambiguousCandidates: match.candidates.map((c) => ({
        platform: c.platform,
        maskedCustomerName: c.maskedCustomerName,
        shortOrderKey: c.shortOrderKey,
        stage: c.stage
      })),
      messageEs: 'Hay más de una orden parecida en Toast. Pídele al cliente su número de orden o 1 platillo de su pedido para confirmar cuál es exactamente.',
      messageEn: 'There is more than one matching order in Toast. Ask the caller for their order number or 1 dish on their order to confirm.'
    }
  }

  if (match.outcome === 'ALREADY_DELIVERED' && match.matchedOrder) {
    return {
      ok: false,
      outcome: 'ALREADY_DELIVERED',
      messageEs: `La orden #${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey} ya figura como entregada/recogida, por lo que ya no es posible cambiar el horario.`,
      messageEn: `Order #${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey} is already marked as picked up/handed off, so we can no longer change its pickup time.`
    }
  }

  if (match.outcome === 'NOT_FOUND' && !params.confirmSaveUnmatched) {
    return {
      ok: false,
      outcome: 'NOT_FOUND',
      messageEs: `Aún no aparece una orden activa en Toast a nombre de "${customerName || params.orderCode}" en esta sucursal. Pídele verificar el número de orden y la sucursal; si acaba de hacer el pedido o está programado para más tarde, vuelve a llamar con confirm_save_unmatched=true para dejar el aviso directo en la tableta de cocina.`,
      messageEn: `No active Toast order under "${customerName || params.orderCode}" appeared yet at this branch. Ask them to verify the order number and store; if they just submitted it or scheduled it for later, call again with confirm_save_unmatched=true to post the alert directly to the kitchen tablet.`
    }
  }

  const matched = match.matchedOrder as ExtendedToastOrderForPhone | null
  const origTimeLabel = matched?.formattedPromisedTimePt || null
  const newTimeLabel = targetDate !== todayYmd ? `${targetDate} ${parsedTime.formatted12h}` : parsedTime.formatted12h
  const stage = matched
    ? matched.audit?.status === 'PACKED_AND_SEALED'
      ? 'PACKED_AND_SEALED'
      : matched.approvalStatus === 'FUTURE'
      ? 'FUTURE'
      : matched.kdsStatus === 'READY'
      ? 'READY'
      : 'IN_KITCHEN'
    : 'UNMATCHED'

  const isAlreadyReadyOrPacked = stage === 'READY' || stage === 'PACKED_AND_SEALED'
  const extraNoteText = String(params.extraNotes || '').trim()
  const itemsHint = formatItemsSummary(matched?.items) || (params.orderedItemsHint ? String(params.orderedItemsHint).trim().slice(0, 320) : null)

  const summaryEs = [
    `⏰ CAMBIO DE HORARIO TOAST: Recoger a las ${newTimeLabel}${origTimeLabel ? ` (antes ${origTimeLabel})` : ''}.`,
    isAlreadyReadyOrPacked
      ? 'ORDEN YA LISTA/EMPACADA — retener y coordinar frescura para la nueva hora.'
      : 'Preparar/coordinar en cocina para tenerla fresca y lista a las ' + newTimeLabel + '.',
    extraNoteText ? `Nota cliente: ${extraNoteText}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const summaryEn = [
    `⏰ TOAST PICKUP TIME CHANGE: Customer will pick up at ${newTimeLabel}${origTimeLabel ? ` (was ${origTimeLabel})` : ''}.`,
    isAlreadyReadyOrPacked
      ? 'ORDER ALREADY READY/PACKED — hold and ensure freshness for the new time.'
      : `Coordinate kitchen prep to have it fresh and ready at ${newTimeLabel}.`,
    extraNoteText ? `Customer note: ${extraNoteText}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const resolvedCallId = await resolveCallIdBySid(params.callId, params.callSid)
  const modLine = origTimeLabel
    ? `⏰ Horario: ${origTimeLabel} → ${newTimeLabel}`
    : `⏰ Nueva hora de recolección: ${newTimeLabel}`

  const insertPayload = {
    store_id: storeId,
    business_date: todayYmd,
    source: params.source || 'twilio',
    call_id: resolvedCallId,
    match_status: matched ? 'MATCHED' : 'UNMATCHED',
    toast_order_guid: matched?.orderGuid || null,
    toast_display_number: matched?.displayNumber || (params.orderCode ? String(params.orderCode).replace(/^#/, '').trim() : null),
    platform: matched?.platform || 'TOAST_ONLINE',
    platform_order_key: matched?.platformOrderKey || (params.orderCode ? `TOAST #${String(params.orderCode).replace(/^#/, '').trim()}` : null),
    short_order_key: matched?.shortOrderKey || (params.orderCode ? `#${String(params.orderCode).replace(/^#/, '').trim()}` : null),
    order_customer_name: matched?.customerName || customerName || 'Cliente Toast',
    order_stage_at_alert: stage,
    caller_name: customerName || matched?.customerName || 'Cliente Toast',
    caller_phone: params.callerPhone ? String(params.callerPhone).trim() : null,
    request_type: 'pickup_time_change',
    note_summary_es: summaryEs,
    note_summary_en: summaryEn,
    requested_condiments: [],
    item_modifications: [modLine, ...(extraNoteText ? [extraNoteText] : [])],
    ordered_items_hint: itemsHint,
    requested_pickup_time: newTimeLabel,
    original_pickup_time: origTimeLabel,
    status: 'pending'
  }

  const { data: saved, error: insErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .insert(insertPayload)
    .select()
    .single()

  if (insErr || !saved) {
    throw new Error(`Error guardando alerta de cambio de horario Toast: ${insErr?.message || 'desconocido'}`)
  }

  const note = mapDbRowToPhoneNote(saved)
  await broadcastDeliveryArmorPhoneNotePing({
    storeId,
    noteId: note.id,
    toastOrderGuid: note.toastOrderGuid,
    status: note.status
  })

  const orderRef = note.toastDisplayNumber ? `#${note.toastDisplayNumber}` : note.shortOrderKey || note.callerName
  if (isAlreadyReadyOrPacked) {
    return {
      ok: true,
      outcome: 'SENT_TO_KITCHEN_ALREADY_READY',
      note,
      requestedPickupTimeFormatted: newTimeLabel,
      originalPickupTimeFormatted: origTimeLabel,
      messageEs: `Localizamos tu orden Toast (${orderRef}) — ya aparecía lista/empacada en cocina, pero ya enviamos alerta inmediata a la tableta de cocina y mostrador para que la coordinen y la tengas lista a las ${newTimeLabel}.`,
      messageEn: `We located your Toast order (${orderRef}) — it was already ready/packed, and we immediately alerted the kitchen tablet and counter so they hold and coordinate freshness for your ${newTimeLabel} pickup.`
    }
  }

  if (matched) {
    return {
      ok: true,
      outcome: 'SENT_TO_KITCHEN',
      note,
      requestedPickupTimeFormatted: newTimeLabel,
      originalPickupTimeFormatted: origTimeLabel,
      messageEs: `¡Listo! Localizamos tu orden Toast (${orderRef}) y enviamos la alerta en vivo a la tableta de cocina para que te la tengan fresca y lista a las ${newTimeLabel}.`,
      messageEn: `All set! We located your Toast order (${orderRef}) and sent a live alert straight to the kitchen tablet so your order is fresh and ready at ${newTimeLabel}.`
    }
  }

  return {
    ok: true,
    outcome: 'SENT_UNMATCHED_ALERT',
    note,
    requestedPickupTimeFormatted: newTimeLabel,
    originalPickupTimeFormatted: origTimeLabel,
    messageEs: `¡Listo! Ya enviamos la alerta en vivo a la tableta de cocina a nombre de ${note.callerName} para que te tengan tu orden lista a las ${newTimeLabel}.`,
    messageEn: `All set! We sent a live alert to the kitchen tablet under ${note.callerName} so your order is ready for pickup at ${newTimeLabel}.`
  }
}

// ============================================================================
// FLUJO 2: SUCURSAL EQUIVOCADA — ALERTA COORDINADA A LAS 2 SUCURSALES
// ============================================================================

export interface WrongStoreTransferParams {
  calledStoreId: number
  paidStoreId: number
  prepareStoreId: number
  source?: 'twilio' | 'simulator' | 'manual'
  callSid?: string | null
  callId?: string | null
  platform?: string | null
  customerName: string
  orderCode?: string | null
  callerPhone?: string | null
  orderedItemsHint?: string | null
  requestedPickupTime?: string | null
  extraNotes?: string | null
  confirmSaveUnmatched?: boolean
  ordersOverrideAtPaidStore?: ExtendedToastOrderForPhone[]
}

export interface WrongStoreTransferResult {
  ok: boolean
  outcome:
    | 'DUAL_ALERTS_SENT'
    | 'DUAL_ALERTS_SENT_UNMATCHED'
    | 'ALREADY_DELIVERED'
    | 'SAME_STORE_ERROR'
    | 'NEED_ITEMS_OR_CONFIRM'
    | 'MISSING_INFO'
  stopNote?: DeliveryArmorPhoneNote | null
  prepareNote?: DeliveryArmorPhoneNote | null
  paidStoreNameEs?: string
  prepareStoreNameEs?: string
  matchedItemsSummary?: string | null
  messageEs: string
  messageEn: string
}

export async function createWrongStoreTransferAlerts(
  params: WrongStoreTransferParams
): Promise<WrongStoreTransferResult> {
  const calledStoreId = Number(params.calledStoreId)
  const paidStoreId = Number(params.paidStoreId)
  const prepareStoreId = Number(params.prepareStoreId)
  const customerName = String(params.customerName || '').trim()
  const callerPhone = params.callerPhone ? String(params.callerPhone).trim() : null

  if (!Number.isInteger(paidStoreId) || paidStoreId <= 0 || !Number.isInteger(prepareStoreId) || prepareStoreId <= 0) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Necesito confirmar exactamente las 2 sucursales: (1) en qué sucursal cayó el pedido por error y (2) en qué sucursal desea recoger el cliente.',
      messageEn: 'I need to confirm both locations: (1) which location received the order by mistake and (2) which location the customer wants to pick up from.'
    }
  }

  if (paidStoreId === prepareStoreId) {
    return {
      ok: false,
      outcome: 'SAME_STORE_ERROR',
      messageEs: 'La sucursal donde cayó el pedido y la sucursal donde desea recoger son la misma. Confirma con el cliente cuál fue la sucursal equivocada y a cuál desea pasar.',
      messageEn: 'The store where the order was placed and the desired pickup store are the same. Confirm both distinct locations with the caller.'
    }
  }

  if (!customerName) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pídele al cliente su nombre, número de orden y teléfono de 10 dígitos para enviar la alerta a ambas sucursales.',
      messageEn: 'Ask the customer for their name, order number, and 10-digit phone number so we can alert both locations.'
    }
  }

  const paidStoreEs = formatCustomerStoreName({ id: paidStoreId }, 'es')
  const paidStoreEn = formatCustomerStoreName({ id: paidStoreId }, 'en')
  const prepareStoreEs = formatCustomerStoreName({ id: prepareStoreId }, 'es')
  const prepareStoreEn = formatCustomerStoreName({ id: prepareStoreId }, 'en')

  // 1. Buscar la orden real en Toast de la sucursal donde cayó el pedido (paidStoreId) para obtener platillos exactos
  const paidOrders = await fetchExtendedToastOrdersForPhoneLookup(paidStoreId, {
    ordersOverride: params.ordersOverrideAtPaidStore
  })
  const match = matchDeliveryArmorOrderFromList({
    orders: paidOrders,
    platform: params.platform || 'TOAST_ONLINE',
    customerName,
    orderCode: params.orderCode,
    orderedItemsHint: params.orderedItemsHint
  })

  if (match.outcome === 'ALREADY_DELIVERED' && match.matchedOrder) {
    return {
      ok: false,
      outcome: 'ALREADY_DELIVERED',
      paidStoreNameEs: paidStoreEs,
      prepareStoreNameEs: prepareStoreEs,
      messageEs: `La orden #${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey} en ${paidStoreEs} ya figura como entregada/recogida, por lo que ya no puede transferirse a ${prepareStoreEs}.`,
      messageEn: `Order #${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey} at ${paidStoreEn} is already marked as handed off/picked up, so it can no longer be moved to ${prepareStoreEn}.`
    }
  }

  const matched = match.matchedOrder as ExtendedToastOrderForPhone | null
  const matchedItemsSummary =
    formatItemsSummary(matched?.items) ||
    (params.orderedItemsHint ? String(params.orderedItemsHint).trim().slice(0, 420) : null)

  if (!matched && !matchedItemsSummary && !params.confirmSaveUnmatched) {
    return {
      ok: false,
      outcome: 'NEED_ITEMS_OR_CONFIRM',
      paidStoreNameEs: paidStoreEs,
      prepareStoreNameEs: prepareStoreEs,
      messageEs: `Aún no localizamos automáticamente los platillos de la orden en ${paidStoreEs}. Pídele al cliente confirmar el número de orden y qué platillos ordenó para enviarlos a ${prepareStoreEs} (y confirma con confirm_save_unmatched=true).`,
      messageEn: `We haven't automatically pulled the exact items from ${paidStoreEn} yet. Ask the customer for their order number and what items they ordered so ${prepareStoreEn} knows exactly what to cook (then re-call with confirm_save_unmatched=true).`
    }
  }

  const resolvedCallId = await resolveCallIdBySid(params.callId, params.callSid)
  const businessDate = getCaliforniaBusinessDate()
  const source = params.source || 'twilio'
  const platform: DeliveryPlatform =
    matched?.platform || normalizeDeliveryPlatformInput(params.platform) || 'TOAST_ONLINE'
  const orderRef =
    matched?.displayNumber
      ? `#${matched.displayNumber}`
      : params.orderCode
      ? `#${String(params.orderCode).replace(/^#/, '').trim()}`
      : 'Sin número'
  const pickupTimeFormatted = params.requestedPickupTime
    ? parseRequestedPickupTime(params.requestedPickupTime)?.formatted12h || String(params.requestedPickupTime).trim()
    : matched?.formattedPromisedTimePt || null
  const extraNote = String(params.extraNotes || '').trim()

  // 2. Crear callback urgente para AMBAS sucursales en phone_callback_requests (gracias al índice único por call_id + store_id)
  const stopCallbackSummary = `[NO PREPARAR — MOVIDA A ${prepareStoreEs}] Orden ${orderRef} (${formatPlatformLabel(platform)}) de ${customerName} se transfirió a ${prepareStoreEs}. NO cocinar ni empacar en ${paidStoreEs}.${matchedItemsSummary ? ` Platillos: ${matchedItemsSummary}` : ''}`
  const prepareCallbackSummary = `[PREPARAR AQUÍ — PAGADA EN ${paidStoreEs}] Cliente ${customerName} recogerá en ${prepareStoreEs}${pickupTimeFormatted ? ` (${pickupTimeFormatted})` : ''}. Orden ${orderRef} (${formatPlatformLabel(platform)}) YA PAGADA en ${paidStoreEs} (ya se avisó allá NO preparar).${matchedItemsSummary ? ` Platillos: ${matchedItemsSummary}` : ''}${extraNote ? ` Nota: ${extraNote}` : ''}`

  async function upsertStoreCallback(targetStId: number, otherStId: number, summary: string): Promise<string | null> {
    try {
      if (resolvedCallId) {
        const { data: existing } = await supabaseAdmin
          .from('phone_callback_requests')
          .select('id')
          .eq('call_id', resolvedCallId)
          .eq('store_id', targetStId)
          .eq('status', 'pending')
          .maybeSingle()
        if (existing?.id) {
          await supabaseAdmin
            .from('phone_callback_requests')
            .update({
              origin_store_id: otherStId,
              reason_category: 'wrong_store_order',
              urgency: 'urgent',
              reason_summary: summary.slice(0, 1000),
              ticket_or_order_number: orderRef
            })
            .eq('id', existing.id)
          return String(existing.id)
        }
      }
      const { data: inserted } = await supabaseAdmin
        .from('phone_callback_requests')
        .insert({
          call_id: resolvedCallId,
          store_id: targetStId,
          origin_store_id: otherStId,
          source: source === 'simulator' ? 'simulator' : 'twilio',
          caller_name: customerName,
          caller_phone: callerPhone || 'No proporcionado',
          caller_type: 'customer',
          urgency: 'urgent',
          reason_category: 'wrong_store_order',
          reason_summary: summary.slice(0, 1000),
          ticket_or_order_number: orderRef,
          status: 'pending',
          business_date: businessDate
        })
        .select('id')
        .single()
      return inserted?.id ? String(inserted.id) : null
    } catch (err) {
      console.error('[phone-kitchen-alerts] wrong-store callback insert error:', err)
      return null
    }
  }

  const [stopCallbackId, prepareCallbackId] = await Promise.all([
    upsertStoreCallback(paidStoreId, prepareStoreId, stopCallbackSummary),
    upsertStoreCallback(prepareStoreId, paidStoreId, prepareCallbackSummary)
  ])

  // 3. Crear alerta STOP en paidStoreId (`wrong_store_stop`)
  const stopSummaryEs = `🛑 NO PREPARAR — SUCURSAL EQUIVOCADA: Orden ${orderRef} de ${customerName} se movió para prepararse en ${prepareStoreEs}. NO cocinar ni empacar aquí.`
  const stopSummaryEn = `🛑 DO NOT PREPARE — WRONG LOCATION: Order ${orderRef} for ${customerName} was moved to be prepared at ${prepareStoreEn}. DO NOT cook or pack here.`

  const { data: stopRow, error: stopErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .insert({
      store_id: paidStoreId,
      origin_store_id: calledStoreId > 0 ? calledStoreId : null,
      related_store_id: prepareStoreId,
      business_date: businessDate,
      source,
      call_id: resolvedCallId,
      callback_id: stopCallbackId,
      match_status: matched ? 'MATCHED' : 'UNMATCHED',
      toast_order_guid: matched?.orderGuid || null,
      toast_display_number: matched?.displayNumber || (params.orderCode ? String(params.orderCode).replace(/^#/, '').trim() : null),
      platform,
      platform_order_key: matched?.platformOrderKey || (orderRef !== 'Sin número' ? orderRef : null),
      short_order_key: matched?.shortOrderKey || (orderRef !== 'Sin número' ? orderRef : null),
      order_customer_name: matched?.customerName || customerName,
      order_stage_at_alert: matched ? (matched.audit?.status || matched.kdsStatus) : 'UNMATCHED',
      caller_name: customerName,
      caller_phone: callerPhone,
      request_type: 'wrong_store_stop',
      note_summary_es: stopSummaryEs,
      note_summary_en: stopSummaryEn,
      requested_condiments: [],
      item_modifications: [
        `🛑 NO PREPARAR AQUÍ — Se prepara en ${prepareStoreEs}`
      ],
      ordered_items_hint: matchedItemsSummary,
      requested_pickup_time: pickupTimeFormatted,
      status: 'pending'
    })
    .select()
    .single()

  if (stopErr || !stopRow) {
    throw new Error(`Error creando alerta STOP en sucursal origen #${paidStoreId}: ${stopErr?.message}`)
  }

  // 4. Crear alerta PREPARE en prepareStoreId (`wrong_store_prepare`) enlazada a stopRow.id
  const prepareSummaryEs = `🍳 PREPARAR AQUÍ — ORDEN PAGADA EN ${paidStoreEs.toUpperCase()}: Cliente ${customerName}${callerPhone ? ` (${callerPhone})` : ''} pasará a recoger aquí${pickupTimeFormatted ? ` a las ${pickupTimeFormatted}` : ''}. Orden ${orderRef} ya pagada en ${paidStoreEs} (ya se avisó allá NO prepararla).`
  const prepareSummaryEn = `🍳 PREPARE HERE — PAID AT ${paidStoreEn.toUpperCase()}: Customer ${customerName}${callerPhone ? ` (${callerPhone})` : ''} will pick up here${pickupTimeFormatted ? ` at ${pickupTimeFormatted}` : ''}. Order ${orderRef} was already paid at ${paidStoreEn} (they were alerted NOT to prepare it).`

  const { data: prepareRow, error: prepErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .insert({
      store_id: prepareStoreId,
      origin_store_id: calledStoreId > 0 ? calledStoreId : null,
      related_store_id: paidStoreId,
      related_note_id: stopRow.id,
      business_date: businessDate,
      source,
      call_id: resolvedCallId,
      callback_id: prepareCallbackId,
      match_status: matched ? 'MATCHED' : 'UNMATCHED',
      toast_order_guid: matched?.orderGuid || null,
      toast_display_number: matched?.displayNumber || (params.orderCode ? String(params.orderCode).replace(/^#/, '').trim() : null),
      platform,
      platform_order_key: matched?.platformOrderKey || (orderRef !== 'Sin número' ? orderRef : null),
      short_order_key: matched?.shortOrderKey || (orderRef !== 'Sin número' ? orderRef : null),
      order_customer_name: matched?.customerName || customerName,
      order_stage_at_alert: matched ? 'PAID_AT_OTHER_STORE' : 'UNMATCHED',
      caller_name: customerName,
      caller_phone: callerPhone,
      request_type: 'wrong_store_prepare',
      note_summary_es: prepareSummaryEs,
      note_summary_en: prepareSummaryEn,
      requested_condiments: [],
      item_modifications: [
        `🍳 PREPARAR AQUÍ — Ya pagada en ${paidStoreEs}`,
        ...(pickupTimeFormatted ? [`⏰ Hora estimada recolección: ${pickupTimeFormatted}`] : []),
        ...(extraNote ? [extraNote] : [])
      ],
      ordered_items_hint: matchedItemsSummary,
      requested_pickup_time: pickupTimeFormatted,
      status: 'pending'
    })
    .select()
    .single()

  if (prepErr || !prepareRow) {
    // Limpiar stopRow parcial si falló la segunda alerta para evitar desincronización
    await supabaseAdmin.from('delivery_armor_phone_notes').delete().eq('id', stopRow.id)
    throw new Error(`Error creando alerta PREPARE en sucursal destino #${prepareStoreId}: ${prepErr?.message}`)
  }

  // Vincular recíprocamente stopRow -> prepareRow
  await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .update({ related_note_id: prepareRow.id })
    .eq('id', stopRow.id)

  const stopNote = mapDbRowToPhoneNote({ ...stopRow, related_note_id: prepareRow.id })
  const prepareNote = mapDbRowToPhoneNote(prepareRow)

  // 5. Broadcast instantáneo en paralelo a AMBAS sucursales (< 500 ms)
  await Promise.all([
    broadcastDeliveryArmorPhoneNotePing({
      storeId: paidStoreId,
      noteId: stopNote.id,
      toastOrderGuid: stopNote.toastOrderGuid,
      status: stopNote.status
    }),
    broadcastDeliveryArmorPhoneNotePing({
      storeId: prepareStoreId,
      noteId: prepareNote.id,
      toastOrderGuid: prepareNote.toastOrderGuid,
      status: prepareNote.status
    })
  ])

  return {
    ok: true,
    outcome: matched ? 'DUAL_ALERTS_SENT' : 'DUAL_ALERTS_SENT_UNMATCHED',
    stopNote,
    prepareNote,
    paidStoreNameEs: paidStoreEs,
    prepareStoreNameEs: prepareStoreEs,
    matchedItemsSummary,
    messageEs: `¡Listo! Ya enviamos la alerta en vivo a las 2 sucursales: (1) a ${paidStoreEs} para que NO preparen tu orden (${orderRef}), y (2) a ${prepareStoreEs} con el detalle de tu pedido ya pagado para que te lo preparen allá${pickupTimeFormatted ? ` para las ${pickupTimeFormatted}` : ''}.`,
    messageEn: `All set! We sent a live coordinated alert to BOTH locations: (1) to ${paidStoreEn} NOT to prepare your order (${orderRef}), and (2) to ${prepareStoreEn} with your paid order details so they prepare it for you there${pickupTimeFormatted ? ` for ${pickupTimeFormatted}` : ''}.`
  }
}

// ============================================================================
// FLUJO 3: PERSONALIZACIÓN DE FIESTA PLATTERS EN PLATAFORMAS -> TABLETA PREPARADOR
// ============================================================================

const OFFICIAL_MEAT_ALIASES: Array<{ canonical: string; re: RegExp }> = [
  { canonical: 'Asada', re: /\b(asada|carne\s*asada|steak|beef\s*steak|pasada|azada)\b/i },
  { canonical: 'Pollo', re: /\b(pollo|chicken|grilled\s*chicken)\b/i },
  { canonical: 'Al Pastor', re: /\b(pastor|al\s*pastor|adobada|marinated\s*pork)\b/i },
  { canonical: 'Carnitas', re: /\b(carnitas|pork)\b/i },
  { canonical: 'Cabeza', re: /\b(cabeza|beef\s*head|steamed\s*beef)\b/i },
  { canonical: 'Lengua', re: /\b(lengua|tongue|beef\s*tongue)\b/i },
  { canonical: 'Buche', re: /\b(buche|pork\s*stomach)\b/i },
  { canonical: 'Chorizo', re: /\b(chorizo|sausage)\b/i }
]

const OFFICIAL_AGUA_ALIASES: Array<{ canonical: string; re: RegExp }> = [
  { canonical: 'Horchata', re: /\b(horchata|orchata|chata|rice\s*water)\b/i },
  { canonical: 'Jamaica', re: /\b(jamaica|hibiscus)\b/i },
  { canonical: 'Piña', re: /\b(pina|piña|pineapple)\b/i },
  { canonical: 'Tamarindo', re: /\b(tamarindo|tamarind)\b/i }
]

export function normalizeOfficialMeatName(raw: string): string {
  const s = String(raw || '').trim()
  for (const entry of OFFICIAL_MEAT_ALIASES) {
    if (entry.re.test(foldAscii(s))) return entry.canonical
  }
  return s.slice(0, 40)
}

export function normalizeOfficialAguaName(raw: string): string {
  const s = String(raw || '').trim()
  for (const entry of OFFICIAL_AGUA_ALIASES) {
    if (entry.re.test(foldAscii(s))) return entry.canonical
  }
  return s.slice(0, 40)
}

export function inferFiestaPlatterSizeFromText(raw: string | null | undefined): PartyTraySize | null {
  const s = foldAscii(raw)
  if (!s) return null
  if (/30\s*(?:-|a|to)\s*40|\b40\b|12\s*(?:lb|lbs|libra|libras)/.test(s)) return '30-40'
  if (/25\s*(?:-|a|to)\s*30|\b30\b|10\s*(?:lb|lbs|libra|libras)/.test(s)) return '25-30'
  if (/20\s*(?:-|a|to)\s*25|\b25\b|7\.?5\s*(?:lb|lbs|libra|libras)/.test(s)) return '20-25'
  if (/15\s*(?:-|a|to)\s*20|\b20\b|\b15\b|6\s*(?:lb|lbs|libra|libras)/.test(s)) return '15-20'
  return null
}

function roundHalfLb(n: number): number {
  return Math.round(n * 2) / 2
}

export interface FiestaPlatterValidationResult {
  ok: boolean
  code?: 'EXCEEDS_MEAT_LIMIT' | 'UNDER_MEAT_LIMIT' | 'EXCEEDS_AGUA_LIMIT' | 'MISSING_CUSTOMIZATION'
  spec?: FiestaPlatterCustomSpec
  messageEs?: string
  messageEn?: string
}

/**
 * Valida y normaliza la distribución de carnes (1 carne o múltiples carnes), aguas frescas y tortillas
 * contra la Guía Oficial `PARTY_TRAY_GUIDELINES` (`6 / 7.5 / 10 / 12 lbs` de carne; `3 / 4 / 5 / 6` galones de agua).
 */
export function validateAndNormalizeFiestaPlatterSpec(input: {
  packageSize: PartyTraySize
  meatBreakdown?: Array<{ meat: string; lbs?: number | null }> | null
  aguasBreakdown?: Array<{ flavor: string; gallons?: number | null }> | null
  tortillasPreference?: string | null
  extraNotes?: string | null
}): FiestaPlatterValidationResult {
  const guideline = PARTY_TRAY_GUIDELINES[input.packageSize]
  const totalMeatLbs = guideline.meatLbs
  const totalAguaGallons = guideline.aguaGallons

  // 1. Procesar y consolidar carnes (puede ser 1 sola carne o varias en cualquier combinación que sume totalMeatLbs)
  const rawMeats = Array.isArray(input.meatBreakdown) ? input.meatBreakdown.filter((m) => m && String(m.meat || '').trim()) : []
  const meatsAgg: Array<{ meat: string; lbs: number | null }> = []
  for (const entry of rawMeats) {
    const canonical = normalizeOfficialMeatName(entry.meat)
    if (!canonical) continue
    const lbsVal = entry.lbs != null && Number.isFinite(Number(entry.lbs)) && Number(entry.lbs) > 0 ? Number(entry.lbs) : null
    const existing = meatsAgg.find((x) => x.meat.toLowerCase() === canonical.toLowerCase())
    if (existing) {
      if (lbsVal !== null) existing.lbs = (existing.lbs ?? 0) + lbsVal
    } else {
      meatsAgg.push({ meat: canonical, lbs: lbsVal })
    }
  }

  let finalMeats: Array<{ meat: string; lbs: number }> = []
  if (meatsAgg.length > 0) {
    const withLbs = meatsAgg.filter((m) => m.lbs !== null)
    const withoutLbs = meatsAgg.filter((m) => m.lbs === null)
    const explicitSum = withLbs.reduce((s, m) => s + (m.lbs || 0), 0)

    if (explicitSum > totalMeatLbs + 0.05) {
      return {
        ok: false,
        code: 'EXCEEDS_MEAT_LIMIT',
        messageEs: `El paquete Fiesta Platter ${input.packageSize} personas incluye exactamente ${totalMeatLbs} libras de carne en total (lo solicitado suma ${explicitSum} lbs). Pregúntale al cliente cómo desea repartir exactamente las ${totalMeatLbs} libras incluidas.`,
        messageEn: `The ${input.packageSize}-person Fiesta Platter includes exactly ${totalMeatLbs} lb of meat total (requested total is ${explicitSum} lb). Ask the customer how they'd like to split the included ${totalMeatLbs} lb.`
      }
    }

    if (withoutLbs.length === 0) {
      // Todas traen libras explícitas: validar que no falten libras
      if (explicitSum < totalMeatLbs - 0.05) {
        const missing = Number((totalMeatLbs - explicitSum).toFixed(2))
        return {
          ok: false,
          code: 'UNDER_MEAT_LIMIT',
          messageEs: `El paquete Fiesta Platter ${input.packageSize} personas incluye ${totalMeatLbs} libras de carne en total y lo indicado suma ${explicitSum} lbs (faltan ${missing} lbs por asignar). Pregúntale al cliente de qué carne desea esas ${missing} libras restantes.`,
          messageEn: `The ${input.packageSize}-person Fiesta Platter includes ${totalMeatLbs} lb of meat total and the current split adds up to ${explicitSum} lb (${missing} lb left unassigned). Ask the customer which meat they'd like for the remaining ${missing} lb.`
        }
      }
      finalMeats = withLbs.map((m) => ({ meat: m.meat, lbs: Number((m.lbs || 0).toFixed(2)) }))
    } else {
      // Distribuir equitativamente las libras restantes entre las carnes sin cantidad explícita
      const remaining = Math.max(0, totalMeatLbs - explicitSum)
      const count = withoutLbs.length
      const baseEach = roundHalfLb(remaining / count)
      let assigned = 0
      const autoList = withoutLbs.map((m, idx) => {
        const val = idx === count - 1 ? Number((remaining - assigned).toFixed(2)) : baseEach
        assigned += val
        return { meat: m.meat, lbs: Math.max(0.5, val) }
      })
      finalMeats = [
        ...withLbs.map((m) => ({ meat: m.meat, lbs: Number((m.lbs || 0).toFixed(2)) })),
        ...autoList
      ]
    }
  }

  // 2. Procesar aguas frescas (1 sabor o varios sumando hasta totalAguaGallons)
  const rawAguas = Array.isArray(input.aguasBreakdown) ? input.aguasBreakdown.filter((a) => a && String(a.flavor || '').trim()) : []
  const aguasAgg: Array<{ flavor: string; gallons: number | null }> = []
  for (const entry of rawAguas) {
    const canonical = normalizeOfficialAguaName(entry.flavor)
    if (!canonical) continue
    const galVal = entry.gallons != null && Number.isFinite(Number(entry.gallons)) && Number(entry.gallons) > 0 ? Number(entry.gallons) : null
    const existing = aguasAgg.find((x) => x.flavor.toLowerCase() === canonical.toLowerCase())
    if (existing) {
      if (galVal !== null) existing.gallons = (existing.gallons ?? 0) + galVal
    } else {
      aguasAgg.push({ flavor: canonical, gallons: galVal })
    }
  }

  let finalAguas: Array<{ flavor: string; gallons: number }> = []
  if (aguasAgg.length > 0) {
    const withGal = aguasAgg.filter((a) => a.gallons !== null)
    const withoutGal = aguasAgg.filter((a) => a.gallons === null)
    const explicitGalSum = withGal.reduce((s, a) => s + (a.gallons || 0), 0)
    if (explicitGalSum > totalAguaGallons + 0.05) {
      return {
        ok: false,
        code: 'EXCEEDS_AGUA_LIMIT',
        messageEs: `El paquete Fiesta Platter ${input.packageSize} personas incluye exactamente ${totalAguaGallons} galones de agua fresca en total (lo solicitado suma ${explicitGalSum} gal). Pregúntale cómo desea repartir sus ${totalAguaGallons} galones.`,
        messageEn: `The ${input.packageSize}-person Fiesta Platter includes exactly ${totalAguaGallons} gallons of agua fresca total (requested total is ${explicitGalSum} gal). Ask how they'd like to split their ${totalAguaGallons} gallons.`
      }
    }
    if (withoutGal.length === 0) {
      finalAguas = withGal.map((a) => ({ flavor: a.flavor, gallons: Number((a.gallons || 0).toFixed(2)) }))
    } else {
      const remGal = Math.max(0, totalAguaGallons - explicitGalSum)
      const baseGal = Math.floor(remGal / withoutGal.length)
      let extraGal = Math.round(remGal - baseGal * withoutGal.length)
      finalAguas = [
        ...withGal.map((a) => ({ flavor: a.flavor, gallons: Number((a.gallons || 0).toFixed(2)) })),
        ...withoutGal.map((a) => {
          const bonus = extraGal > 0 ? 1 : 0
          if (extraGal > 0) extraGal -= 1
          return { flavor: a.flavor, gallons: Math.max(0.5, baseGal + bonus) }
        })
      ]
    }
  }

  const tortillas = input.tortillasPreference ? String(input.tortillasPreference).trim().slice(0, 120) : null
  const extraNotes = input.extraNotes ? String(input.extraNotes).trim().slice(0, 240) : null

  if (finalMeats.length === 0 && finalAguas.length === 0 && !tortillas && !extraNotes) {
    return {
      ok: false,
      code: 'MISSING_CUSTOMIZATION',
      messageEs: 'Pregúntale al cliente exactamente qué carnes (y cómo las quiere repartidas), aguas frescas o tortillas desea en su Fiesta Platter.',
      messageEn: 'Ask the customer exactly which meats (and split), aguas frescas, or tortillas they want in their Fiesta Platter.'
    }
  }

  return {
    ok: true,
    spec: {
      packageSize: input.packageSize,
      totalMeatLbs,
      totalAguaGallons,
      meats: finalMeats,
      aguas: finalAguas,
      tortillas,
      extraNotes
    }
  }
}

export interface FiestaPlatterCustomPrepParams {
  storeId: number
  source?: 'twilio' | 'simulator' | 'manual'
  callSid?: string | null
  callId?: string | null
  platform?: string | null
  customerName: string
  orderCode?: string | null
  callerPhone?: string | null
  packageSize?: string | null
  meatBreakdown?: Array<{ meat: string; lbs?: number | null }> | null
  aguasBreakdown?: Array<{ flavor: string; gallons?: number | null }> | null
  tortillasPreference?: string | null
  requestedCondiments?: string[] | null
  extraNotes?: string | null
  requestedPickupTime?: string | null
  confirmSaveUnmatched?: boolean
  ordersOverride?: ExtendedToastOrderForPhone[]
}

export interface FiestaPlatterCustomPrepResult {
  ok: boolean
  outcome:
    | 'SENT_TO_PREPARADOR'
    | 'SENT_UNMATCHED_TO_PREPARADOR'
    | 'EXCEEDS_PACKAGE_LIMIT'
    | 'UNDER_PACKAGE_LIMIT'
    | 'ALREADY_DELIVERED'
    | 'AMBIGUOUS'
    | 'NOT_FOUND'
    | 'MISSING_INFO'
  note?: DeliveryArmorPhoneNote | null
  spec?: FiestaPlatterCustomSpec | null
  ambiguousCandidates?: Array<{
    platform: DeliveryPlatform
    maskedCustomerName: string
    shortOrderKey: string
    stage: string
  }>
  messageEs: string
  messageEn: string
}

export async function createFiestaPlatterCustomPrepAlert(
  params: FiestaPlatterCustomPrepParams
): Promise<FiestaPlatterCustomPrepResult> {
  const storeId = Number(params.storeId)
  const customerName = String(params.customerName || '').trim()

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Sucursal inválida para enviar la instrucción de Fiesta Platter.',
      messageEn: 'Invalid store ID for Fiesta Platter kitchen alert.'
    }
  }

  if (!customerName && !params.orderCode) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pídele al cliente su nombre, plataforma (DoorDash, Uber Eats, Grubhub o Tacos Gavilan Online) y código o número de orden.',
      messageEn: 'Ask the customer for their name, platform (DoorDash, Uber Eats, Grubhub, or Tacos Gavilan Online), and order code/number.'
    }
  }

  // 1. Buscar la orden en Toast (incluyendo Fiesta Platters programados > 3h)
  const orders = await fetchExtendedToastOrdersForPhoneLookup(storeId, {
    ordersOverride: params.ordersOverride
  })
  const match = matchDeliveryArmorOrderFromList({
    orders,
    platform: params.platform,
    customerName,
    orderCode: params.orderCode,
    orderedItemsHint: 'Fiesta Platter Party Tray'
  })

  if (match.outcome === 'AMBIGUOUS') {
    return {
      ok: false,
      outcome: 'AMBIGUOUS',
      ambiguousCandidates: match.candidates.map((c) => ({
        platform: c.platform,
        maskedCustomerName: c.maskedCustomerName,
        shortOrderKey: c.shortOrderKey,
        stage: c.stage
      })),
      messageEs: 'Hay más de una orden parecida en cocina. Pídele al cliente el código de su orden para asegurarnos de enviar la instrucción al Fiesta Platter exacto.',
      messageEn: 'There is more than one similar order in the kitchen. Ask for the order code to make sure we tag the exact Fiesta Platter.'
    }
  }

  if (match.outcome === 'ALREADY_DELIVERED' && match.matchedOrder) {
    return {
      ok: false,
      outcome: 'ALREADY_DELIVERED',
      messageEs: `El Fiesta Platter (#${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey}) ya fue entregado, por lo que ya no es posible cambiar la selección de carnes/productos.`,
      messageEn: `The Fiesta Platter (#${match.matchedOrder.displayNumber || match.matchedOrder.shortOrderKey}) was already handed off, so we can no longer customize the selection.`
    }
  }

  const matched = match.matchedOrder as ExtendedToastOrderForPhone | null

  // 2. Determinar el tamaño de paquete (del parámetro o detectado directo en Toast)
  const matchedPlatterNames = matched?.items?.map((i) => `${i.displayName} ${i.modifiers.join(' ')}`).join(' ') || ''
  const packageSize =
    inferFiestaPlatterSizeFromText(params.packageSize) ||
    inferFiestaPlatterSizeFromText(matchedPlatterNames) ||
    // En plataformas de delivery, el botón genérico "Fiesta Platters" sin rango siempre corresponde a 15-20 personas
    (/fiesta\s*platter|party\s*tray/i.test(matchedPlatterNames) ? '15-20' : null)

  if (!packageSize) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pregúntale al cliente de cuántas personas es el Fiesta Platter que ordenó (15-20, 20-25, 25-30 o 30-40 personas) para indicar las libras exactas a cocina.',
      messageEn: 'Ask the customer which Fiesta Platter size they ordered (15-20, 20-25, 25-30, or 30-40 people) so we send the exact meat pound breakdown to the cooks.'
    }
  }

  // 3. Validar libras de carne, galones de agua y tortillas contra PARTY_TRAY_GUIDELINES
  const validation = validateAndNormalizeFiestaPlatterSpec({
    packageSize,
    meatBreakdown: params.meatBreakdown,
    aguasBreakdown: params.aguasBreakdown,
    tortillasPreference: params.tortillasPreference,
    extraNotes: params.extraNotes
  })

  if (!validation.ok || !validation.spec) {
    return {
      ok: false,
      outcome:
        validation.code === 'EXCEEDS_MEAT_LIMIT' || validation.code === 'EXCEEDS_AGUA_LIMIT'
          ? 'EXCEEDS_PACKAGE_LIMIT'
          : validation.code === 'UNDER_MEAT_LIMIT'
          ? 'UNDER_PACKAGE_LIMIT'
          : 'MISSING_INFO',
      messageEs: validation.messageEs || 'Falta especificar los productos del Fiesta Platter.',
      messageEn: validation.messageEn || 'Missing Fiesta Platter customization details.'
    }
  }

  if (match.outcome === 'NOT_FOUND' && !params.confirmSaveUnmatched) {
    return {
      ok: false,
      outcome: 'NOT_FOUND',
      spec: validation.spec,
      messageEs: `Aún no aparece la orden del Fiesta Platter a nombre de "${customerName || params.orderCode}" en Toast de esta sucursal. Si el cliente la acaba de enviar hace unos segundos o está programada para más tarde, confirma la sucursal y vuelve a llamar con confirm_save_unmatched=true para dejar la instrucción fija en la tableta PREPARADOR.`,
      messageEn: `The Fiesta Platter order under "${customerName || params.orderCode}" hasn't popped into Toast at this location yet. If the customer just submitted it or scheduled it for later, confirm the store and re-call with confirm_save_unmatched=true to post the instruction straight to the PREPARADOR tablet.`
    }
  }

  const spec = validation.spec
  const meatParts = spec.meats.map((m) => `${m.lbs} lbs ${m.meat}`)
  const aguaParts = spec.aguas.map((a) => `${a.gallons} gal ${a.flavor}`)
  const modLines: string[] = []
  if (meatParts.length > 0) {
    modLines.push(`🥩 CARNES (${spec.totalMeatLbs} lbs): ${meatParts.join(' • ')}`)
  }
  if (aguaParts.length > 0) {
    modLines.push(`🥤 AGUAS (${spec.totalAguaGallons} gal): ${aguaParts.join(' • ')}`)
  }
  if (spec.tortillas) {
    modLines.push(`🌮 TORTILLAS: ${spec.tortillas}`)
  }
  if (spec.extraNotes) {
    modLines.push(`📝 NOTA COCINA: ${spec.extraNotes}`)
  }

  const summaryEs = `🎉 FIESTA PLATTER (${spec.packageSize} personas) — INSTRUCCIÓN COCINEROS: ${[
    meatParts.length > 0 ? `Carne (${spec.totalMeatLbs} lbs): ${meatParts.join(', ')}` : '',
    aguaParts.length > 0 ? `Aguas: ${aguaParts.join(', ')}` : '',
    spec.tortillas ? `Tortillas: ${spec.tortillas}` : '',
    spec.extraNotes ? spec.extraNotes : ''
  ]
    .filter(Boolean)
    .join(' | ')}`

  const summaryEn = `🎉 FIESTA PLATTER (${spec.packageSize} people) — KITCHEN BREAKDOWN: ${[
    meatParts.length > 0 ? `Meat (${spec.totalMeatLbs} lb): ${meatParts.join(', ')}` : '',
    aguaParts.length > 0 ? `Aguas Frescas: ${aguaParts.join(', ')}` : '',
    spec.tortillas ? `Tortillas: ${spec.tortillas}` : '',
    spec.extraNotes ? spec.extraNotes : ''
  ]
    .filter(Boolean)
    .join(' | ')}`

  const resolvedCallId = await resolveCallIdBySid(params.callId, params.callSid)
  const businessDate = getCaliforniaBusinessDate()
  const platform: DeliveryPlatform =
    matched?.platform || normalizeDeliveryPlatformInput(params.platform) || 'OTHER'
  const pickupTimeFormatted = params.requestedPickupTime
    ? parseRequestedPickupTime(params.requestedPickupTime)?.formatted12h || String(params.requestedPickupTime).trim()
    : matched?.formattedPromisedTimePt || null
  const condiments = Array.isArray(params.requestedCondiments)
    ? params.requestedCondiments.map((c) => String(c || '').trim()).filter(Boolean)
    : []

  const { data: saved, error: insErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .insert({
      store_id: storeId,
      business_date: businessDate,
      source: params.source || 'twilio',
      call_id: resolvedCallId,
      match_status: matched ? 'MATCHED' : 'UNMATCHED',
      toast_order_guid: matched?.orderGuid || null,
      toast_display_number: matched?.displayNumber || (params.orderCode ? String(params.orderCode).replace(/^#/, '').trim() : null),
      platform,
      platform_order_key: matched?.platformOrderKey || (params.orderCode ? String(params.orderCode).trim() : null),
      short_order_key: matched?.shortOrderKey || (params.orderCode ? String(params.orderCode).trim() : null),
      order_customer_name: matched?.customerName || customerName,
      order_stage_at_alert: matched ? (matched.audit?.status || matched.kdsStatus) : 'UNMATCHED',
      caller_name: customerName || matched?.customerName || 'Cliente Fiesta Platter',
      caller_phone: params.callerPhone ? String(params.callerPhone).trim() : null,
      request_type: 'fiesta_platter_custom',
      note_summary_es: summaryEs,
      note_summary_en: summaryEn,
      requested_condiments: condiments,
      item_modifications: modLines,
      ordered_items_hint: formatItemsSummary(matched?.items) || `Fiesta Platter ${spec.packageSize} personas`,
      requested_pickup_time: pickupTimeFormatted,
      platter_spec: spec,
      status: 'pending'
    })
    .select()
    .single()

  if (insErr || !saved) {
    throw new Error(`Error guardando alerta Fiesta Platter para PREPARADOR: ${insErr?.message || 'desconocido'}`)
  }

  const note = mapDbRowToPhoneNote(saved)
  await broadcastDeliveryArmorPhoneNotePing({
    storeId,
    noteId: note.id,
    toastOrderGuid: note.toastOrderGuid,
    status: note.status
  })

  const platLabel = formatPlatformLabel(note.platform)
  const orderRef = note.shortOrderKey || (note.toastDisplayNumber ? `#${note.toastDisplayNumber}` : note.callerName)
  return {
    ok: true,
    outcome: matched ? 'SENT_TO_PREPARADOR' : 'SENT_UNMATCHED_TO_PREPARADOR',
    note,
    spec,
    messageEs: `¡Listo! Ya enviamos la instrucción exacta de tu Fiesta Platter (${spec.packageSize} personas, ${platLabel} ${orderRef}) directo a la tableta de los cocineros (PREPARADOR): ${[
      meatParts.length > 0 ? meatParts.join(', ') : '',
      aguaParts.length > 0 ? aguaParts.join(', ') : '',
      spec.tortillas ? `tortillas: ${spec.tortillas}` : ''
    ]
      .filter(Boolean)
      .join(' • ')}.`,
    messageEn: `All set! We sent the exact breakdown for your Fiesta Platter (${spec.packageSize} people, ${platLabel} ${orderRef}) straight to the cooks' PREPARADOR tablet: ${[
      meatParts.length > 0 ? meatParts.join(', ') : '',
      aguaParts.length > 0 ? aguaParts.join(', ') : '',
      spec.tortillas ? `tortillas: ${spec.tortillas}` : ''
    ]
      .filter(Boolean)
      .join(' • ')}.`
  }
}
