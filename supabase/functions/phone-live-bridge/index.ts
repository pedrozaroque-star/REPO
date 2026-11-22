/**
 * @module supabase/functions/phone-live-bridge
 * @description Puente bidireccional WebSocket + TwiML de baja latencia entre Twilio Media Streams (`8 kHz μ-law`)
 * y `gemini-3.8-live` (voz neuronal `Kore`) para las 15 sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Cero órdenes por teléfono: invita a `tacosgavilan.com`, mostrador o Drive-Thru (sin decir "políticas").
 * - Menú completo recitable por voz directamente al cliente (prohibido mandarlo a `tacosgavilan.com` solo para ver el menú).
 * - Recados al gerente: pedir nombre, teléfono real de 10 dígitos y motivo breve, guardando `reason_summary` SIEMPRE en español.
 * - Cierre limpio: jamás colgar por simples acuses (`"okay, gracias"`, `"gracias"`); solo cerrar tras despedida explícita.
 * - Sucursales #5, #6 y #7 frente al cliente siempre como Los Ángeles + entrecalles oficiales.
 *
 * @dataFlow
 * - Twilio POST -> TwiML (`<Play>` CIPA + `<Connect><Stream>` + fallback `/api/phone/respond`) ->
 *   WebSocket puente `dsp.ts` <-> `BidiGenerateContent` (`gemini-3.8-live`) -> tools live -> `phone_calls` / `phone_callback_requests`.
 *
 * @notes
 * - v9 (2026-11-21): fast-path síncrono de tramas Twilio sin `JSON.parse`/`async`, batching `60 ms` en habla y
 *   keepalive `800 ms` en reposo (>-80% CPU vs v8), VAD calibrado (`START_SENSITIVITY_LOW` + `END_SENSITIVITY_LOW` + `550 ms`),
 *   candado determinista en `end_call` y `reason_summary` forzado al español.
 * - Fase 25 (2026-11-21): validación en tiempo real `validate_order_ticket` + compuerta en `create_manager_callback`
 *   contra Supabase + Toast POS `/orders/v2/ordersBulk` (caché RAM 45s), candado anti-cuelgue ante frustración /
 *   `"me voy con la competencia"`, soluciones urgentes `< 1h` para grupos, menú verbal completo y filtro de ruido vial no latino.
 * - v10 (2026-11-21): cobertura `dt_orders` (Drive-Thru), `delivery_packing_audits` (estatus + customer_name),
 *   `app_orders`, rango real de tickets del día (`observedRange`), fallback firmado HMAC a `/api/phone/verify-order`,
 *   bloqueo estricto ES/EN con intercepción de salida no latina en runtime (`suppressForeignOutputTurn`) y salida `SIN TICKET` sin bucles.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import {
  SILENCE_100MS_PCM16_GEMINI_JSON,
  StatefulMulaw8kToPcm16k,
  StatefulPcm24kToMulaw8k,
  base64ToUint8,
  convertWavBytesToMulaw8k,
  decodeBase64Into,
  uint8ToBase64
} from "./dsp.ts"

const SHARED_UTF8_DECODER = new TextDecoder()

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type PhoneLang = "es" | "en"

interface TranscriptEntry {
  role: "user" | "assistant" | "tool"
  text: string
  timestamp: string
  toolName?: string
}

interface BridgeSecrets {
  twilioAccountSid: string
  twilioAuthToken: string
  ttsSigningSecret: string
  publicAppBaseUrl: string
  toastApiHost: string
  toastClientId: string
  toastClientSecret: string
  geminiKeys: string[]
  fetchedAt: number
}

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "https://ywwwdcvgfculqmcfkihq.supabase.co").replace(/\/+$/, "")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const GEMINI_LIVE_MODEL = "models/gemini-3.8-live"
const GEMINI_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"

const LA_CROSS_STREETS: Record<
  number,
  {
    displayEs: string
    displayEn: string
    spokenEs: string
    spokenEn: string
    greetingEs: string
    greetingEn: string
    crossEs: string
    crossEn: string
  }
> = {
  5: {
    displayEs: "Los Ángeles (Vernon y Broadway)",
    displayEn: "Los Angeles (Vernon & Broadway)",
    spokenEs: "Los Ángeles, en la esquina de Vernon y Broadway",
    spokenEn: "Los Angeles, at the corner of Vernon and Broadway",
    greetingEs: "en Los Ángeles, esquina de Vernon y Broadway",
    greetingEn: "in Los Angeles, at the corner of Vernon and Broadway",
    crossEs: "Vernon y Broadway",
    crossEn: "Vernon & Broadway"
  },
  6: {
    displayEs: "Los Ángeles (Central y Washington)",
    displayEn: "Los Angeles (Central & Washington)",
    spokenEs: "Los Ángeles, en la esquina de Central y Washington",
    spokenEn: "Los Angeles, at the corner of Central and Washington",
    greetingEs: "en Los Ángeles, esquina de Central y Washington",
    greetingEn: "in Los Angeles, at the corner of Central and Washington",
    crossEs: "Central y Washington",
    crossEn: "Central & Washington"
  },
  7: {
    displayEs: "Los Ángeles (Slauson y Broadway)",
    displayEn: "Los Angeles (Slauson & Broadway)",
    spokenEs: "Los Ángeles, en la esquina de Slauson y Broadway",
    spokenEn: "Los Angeles, at the corner of Slauson and Broadway",
    greetingEs: "en Los Ángeles, esquina de Slauson y Broadway",
    greetingEn: "in Los Angeles, at the corner of Slauson and Broadway",
    crossEs: "Slauson y Broadway",
    crossEn: "Slauson & Broadway"
  }
}

const PARTY_TRAYS = [
  { key: "15-20", guests: "15 a 20 personas", meatLbs: 6, aguasGal: 1, cornDoz: 10, flourDoz: 5 },
  { key: "20-25", guests: "20 a 25 personas", meatLbs: 8, aguasGal: 2, cornDoz: 15, flourDoz: 7 },
  { key: "25-30", guests: "25 a 30 personas", meatLbs: 10, aguasGal: 2, cornDoz: 20, flourDoz: 9 },
  { key: "30-40", guests: "30 a 40 personas", meatLbs: 13, aguasGal: 3, cornDoz: 25, flourDoz: 12 }
]

/** Busca el item Fiesta Platter en app_menu_cache tolerando guiones con espacios ("15 - 20 People") o palabras ("15 to 20"). */
function findPartyTrayMenuItem(menuItems: any[], key: string): any | null {
  if (!Array.isArray(menuItems) || menuItems.length === 0) return null
  const [lo, hi] = key.split("-")
  const sizeRe = new RegExp(`\\b${lo}\\s*[-–a-z]*\\s*${hi}\\b`, "i")
  return (
    menuItems.find(
      (m) =>
        /fiesta\s*platter|party\s*tray|charola/i.test(String(m?.category_name || "")) &&
        sizeRe.test(String(m?.name || "")) &&
        Number.isFinite(Number(m?.price)) &&
        Number(m?.price) > 0
    ) ||
    menuItems.find(
      (m) =>
        sizeRe.test(String(m?.name || "")) &&
        /people|personas|fiesta|platter/i.test(String(m?.name || "")) &&
        Number.isFinite(Number(m?.price)) &&
        Number(m?.price) > 0
    ) ||
    null
  )
}

let cachedSecrets: BridgeSecrets | null = null
const deadGeminiKeyUntil = new Map<string, number>()
const coolGeminiKeyUntil = new Map<string, number>()
const healthyGeminiKeyAt = new Map<string, number>()
let geminiKeyCursor = 0
const mulawPromptRamCache = new Map<string, Uint8Array>()

function dbHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    ...(extra || {})
  }
}

async function pgSelect(tableAndQuery: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableAndQuery}`, {
    headers: dbHeaders()
  })
  if (!res.ok) return []
  return await res.json().catch(() => [])
}

async function loadSecrets(force = false): Promise<BridgeSecrets> {
  const now = Date.now()
  if (!force && cachedSecrets && now - cachedSecrets.fetchedAt < 5 * 60 * 1000) {
    return cachedSecrets
  }
  const [twRes, gmRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/storage/v1/object/order-ready-tts/_config/twilio-bridge-config.json`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
      cache: "no-store"
    }),
    fetch(`${SUPABASE_URL}/storage/v1/object/order-ready-tts/_config/gemini-keys.json`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
      cache: "no-store"
    })
  ])
  const twJson = twRes.ok ? await twRes.json().catch(() => ({})) : {}
  const gmJson = gmRes.ok ? await gmRes.json().catch(() => ({})) : {}
  const keys: string[] = Array.isArray(gmJson?.keys)
    ? gmJson.keys.map((k: unknown) => String(k || "").trim()).filter(Boolean)
    : []

  cachedSecrets = {
    twilioAccountSid: String(twJson?.twilioAccountSid || Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim(),
    twilioAuthToken: String(twJson?.twilioAuthToken || Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim(),
    ttsSigningSecret: String(twJson?.ttsSigningSecret || SUPABASE_SERVICE_ROLE_KEY).trim(),
    publicAppBaseUrl: String(twJson?.publicAppBaseUrl || "https://tacosgavilan.vercel.app")
      .trim()
      .replace(/\/+$/, ""),
    toastApiHost: String(twJson?.toastApiHost || Deno.env.get("TOAST_API_HOST") || "https://ws-api.toasttab.com")
      .trim()
      .replace(/\/+$/, ""),
    toastClientId: String(twJson?.toastClientId || Deno.env.get("TOAST_CLIENT_ID") || "").trim(),
    toastClientSecret: String(twJson?.toastClientSecret || Deno.env.get("TOAST_CLIENT_SECRET") || "").trim(),
    geminiKeys: keys,
    fetchedAt: now
  }
  return cachedSecrets
}

function escapeXml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function normalizeDigits10(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "")
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d
}

function normalizeSearch(raw: string | null | undefined): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function cleanInternalStoreName(name: string): string {
  return String(name || "")
    .replace(/^#\d+\s*/, "")
    .replace(/^LA\s+/i, "")
    .trim()
}

function customerStoreDisplay(store: { id: number; name: string }, lang: PhoneLang): string {
  const la = LA_CROSS_STREETS[Number(store.id)]
  if (la) return lang === "en" ? la.displayEn : la.displayEs
  return cleanInternalStoreName(store.name)
}

function customerStoreSpoken(store: { id: number; name: string }, lang: PhoneLang): string {
  const la = LA_CROSS_STREETS[Number(store.id)]
  if (la) return lang === "en" ? la.spokenEn : la.spokenEs
  return cleanInternalStoreName(store.name)
}

function customerGreetingTarget(store: { id: number; name: string }, lang: PhoneLang): string {
  const la = LA_CROSS_STREETS[Number(store.id)]
  if (la) return lang === "en" ? la.greetingEn : la.greetingEs
  return cleanInternalStoreName(store.name)
}

function expandStreetAddress(raw: string, lang: PhoneLang): string {
  let out = String(raw || "")
    .replace(/,\s*\d{5}(?:-\d{4})?$/g, "")
    .replace(/\bS\.\s+/g, "South ")
    .replace(/\bN\.\s+/g, "North ")
    .replace(/\bE\.\s+/g, "East ")
    .replace(/\bW\.\s+/g, "West ")
    .replace(/\bAve\.?\b/g, "Avenue")
    .replace(/\bBlvd\.?\b/g, "Boulevard")
    .replace(/\bRd\.?\b/g, "Road")
    .replace(/\bSt\.?\b/g, "Street")
    .replace(/\bHwy\.?\b/g, "Highway")
    .replace(/,\s*CA\b/g, ", California")
    .trim()
  if (lang === "es") {
    out = out.replace(/\bLos Angeles\b/gi, "Los Ángeles")
  }
  return out
}

const BRIDGE_DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const
const BRIDGE_DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

function getPacificNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ""
  const year = Number(get("year"))
  const month = Number(get("month"))
  const day = Number(get("day"))
  const hourRaw = Number(get("hour"))
  const hour = hourRaw === 24 ? 0 : hourRaw
  const minute = Number(get("minute"))
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayOfWeek = wkMap[get("weekday")] ?? 0
  const dateStr = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const yesterdayDateStr = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
  const yesterdayDayOfWeek = (dayOfWeek + 6) % 7

  const businessDate = hour < 6 ? yesterdayDateStr : dateStr
  const shift = hour >= 6 && hour < 17 ? "AM" : "PM"
  const isBreakfastOpen = hour >= 6 && hour < 14
  return {
    dateStr,
    yesterdayDateStr,
    businessDate,
    shift,
    dayOfWeek,
    yesterdayDayOfWeek,
    hour,
    minute,
    totalMin: hour * 60 + minute,
    isBreakfastOpen
  }
}

function fmt12h(hhmm: string): string {
  const [hS, mS] = String(hhmm || "00:00").split(":")
  const h = Number(hS) || 0
  const m = Number(mS) || 0
  const period = h >= 12 && h < 24 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

function atTimeEsBridge(fmt12: string): string {
  return /^1:/i.test(fmt12.trim()) ? `a la ${fmt12}` : `a las ${fmt12}`
}

function parseMinBridge(hhmm: string): number {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

function normalizeBridgeWeeklyMap(rawWeekly: unknown): Record<number, { open: string; close: string }> {
  let list = rawWeekly
  if (typeof rawWeekly === "string" && rawWeekly.trim().startsWith("[")) {
    try {
      list = JSON.parse(rawWeekly)
    } catch {
      list = []
    }
  }
  const byDay: Record<number, { open: string; close: string }> = {}
  if (Array.isArray(list)) {
    for (const d of list) {
      if (d && typeof d.day === "number") {
        byDay[d.day] = { open: String(d.open || "09:00"), close: String(d.close || "00:00") }
      }
    }
  }
  return byDay
}

function resolveBridgeDaySchedule(
  storeIdNum: number,
  regular: { open: string; close: string } | undefined,
  dateStr: string,
  specialHours: any[]
): { isClosedAllDay: boolean; open: string; close: string; isSpecial: boolean; holidayName: string | null } {
  const regOpen = regular?.open || "10:00"
  const regClose = regular?.close || "00:00"
  const regClosed = /^closed$/i.test(regOpen) || /^closed$/i.test(regClose)
  const sp =
    specialHours.find((s) => s.event_date === dateStr && s.store_id !== null && Number(s.store_id) === storeIdNum) ||
    specialHours.find((s) => s.event_date === dateStr && s.store_id === null) ||
    null

  if (sp) {
    const spOpen = sp.open_time ? String(sp.open_time).slice(0, 5) : ""
    const spClose = sp.close_time ? String(sp.close_time).slice(0, 5) : ""
    if (Boolean(sp.is_closed) || (regClosed && !(sp.store_id !== null && spOpen && spClose))) {
      return {
        isClosedAllDay: true,
        open: "CLOSED",
        close: "CLOSED",
        isSpecial: true,
        holidayName: sp.holiday_name || "día festivo"
      }
    }
    const effOpen = spOpen
      ? sp.store_id === null && !regClosed && parseMinBridge(spOpen) < parseMinBridge(regOpen)
        ? regOpen
        : spOpen
      : regOpen
    const effClose = spClose || regClose
    return {
      isClosedAllDay: false,
      open: effOpen,
      close: effClose,
      isSpecial: true,
      holidayName: sp.holiday_name || null
    }
  }

  return {
    isClosedAllDay: regClosed,
    open: regOpen,
    close: regClose,
    isSpecial: false,
    holidayName: null
  }
}

function evaluateStoreSchedule(store: any, specialHours: any[], pt = getPacificNow()) {
  const byDay = normalizeBridgeWeeklyMap(store?.weekly_hours)
  const storeIdNum = Number(store?.id)
  const dispEs = customerStoreDisplay(store, "es")
  const dispEn = customerStoreDisplay(store, "en")
  const todayDayEs = BRIDGE_DAY_NAMES_ES[pt.dayOfWeek]
  const todayDayEn = BRIDGE_DAY_NAMES_EN[pt.dayOfWeek]
  const prevDayEs = BRIDGE_DAY_NAMES_ES[pt.yesterdayDayOfWeek]
  const prevDayEn = BRIDGE_DAY_NAMES_EN[pt.yesterdayDayOfWeek]

  let prevJustClosedInfo: { phraseEs: string; phraseEn: string } | null = null

  // 1. Verificar spillover nocturno de la jornada laboral de ayer (00:00 a 05:59 AM)
  if (pt.hour < 6) {
    const prevSched = resolveBridgeDaySchedule(storeIdNum, byDay[pt.yesterdayDayOfWeek], pt.yesterdayDateStr, specialHours)
    if (!prevSched.isClosedAllDay) {
      const closeM = parseMinBridge(prevSched.close)
      const openM = parseMinBridge(prevSched.open)
      if (closeM <= 359 && closeM <= openM) {
        const closeFmt = fmt12h(prevSched.close)
        if (closeM > 0 && pt.totalMin < closeM) {
          return {
            isOpenNow: true,
            todayCloseFmt: closeFmt,
            statusEs: `Abierto ahora en ${dispEs}: el turno nocturno de ${prevDayEs} cierra esta madrugada ${atTimeEsBridge(closeFmt)}.`,
            statusEn: `Currently open at ${dispEn}: our ${prevDayEn} late-night shift closes at ${closeFmt}.`,
            closedPromptEs: "",
            closedPromptEn: ""
          }
        }
        prevJustClosedInfo = {
          phraseEs: closeM === 0 ? "cerró a medianoche (12:00 AM)" : `cerró ${atTimeEsBridge(closeFmt)}`,
          phraseEn: closeM === 0 ? "closed at midnight (12:00 AM)" : `closed at ${closeFmt}`
        }
      }
    }
  }

  // 2. Horario efectivo de hoy (respetando días festivos con open_time/close_time parciales)
  const todaySched = resolveBridgeDaySchedule(storeIdNum, byDay[pt.dayOfWeek], pt.dateStr, specialHours)

  if (todaySched.isClosedAllDay) {
    const hName = todaySched.holidayName || "día festivo"
    const prevTailEs = prevJustClosedInfo ? `Nuestro turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs}; hoy ` : "Hoy "
    const prevTailEn = prevJustClosedInfo ? `Our ${prevDayEn} shift ${prevJustClosedInfo.phraseEn}; today ` : "Today "
    return {
      isOpenNow: false,
      todayCloseFmt: "CERRADO",
      statusEs: `Cerrado en ${dispEs}: ${prevTailEs}permanecemos cerrados todo el día por ${hName}.`,
      statusEn: `Closed at ${dispEn}: ${prevTailEn}we are closed all day for ${hName}.`,
      closedPromptEs: prevJustClosedInfo
        ? `En este momento ya cerramos; el turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y hoy permanecemos cerrados por ${hName}. ¿En qué te ayudo hoy?`
        : `En este momento estamos cerrados por ${hName}. ¿En qué te ayudo hoy?`,
      closedPromptEn: prevJustClosedInfo
        ? `We are currently closed; our ${prevDayEn} shift ${prevJustClosedInfo.phraseEn} and we are closed today for ${hName}. How can I help you today?`
        : `We are currently closed for ${hName}. How can I help you today?`
    }
  }

  const openM = parseMinBridge(todaySched.open)
  const rawCloseM = parseMinBridge(todaySched.close)
  const closeEffective = rawCloseM <= openM ? rawCloseM + 1440 : rawCloseM
  const isOpenNow = pt.totalMin >= openM && pt.totalMin < closeEffective
  const openFmt = fmt12h(todaySched.open)
  const closeFmt = fmt12h(todaySched.close)

  if (isOpenNow) {
    return {
      isOpenNow: true,
      todayCloseFmt: closeFmt,
      statusEs: `Abierto en este momento en ${dispEs}; hoy ${todayDayEs} nuestro horario es de ${openFmt} a ${closeFmt}.`,
      statusEn: `Currently open at ${dispEn}; today's (${todayDayEn}) hours are ${openFmt} to ${closeFmt}.`,
      closedPromptEs: "",
      closedPromptEn: ""
    }
  }

  if (pt.totalMin < openM) {
    if (pt.hour < 6 && prevJustClosedInfo) {
      return {
        isOpenNow: false,
        todayCloseFmt: closeFmt,
        statusEs: `Cerrado en este momento en ${dispEs}: el turno nocturno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y volvemos a abrir hoy ${todayDayEs} ${atTimeEsBridge(openFmt)} (horario de hoy ${todayDayEs}: ${openFmt} a ${closeFmt}).`,
        statusEn: `Currently closed at ${dispEn}: our ${prevDayEn} late-night shift ${prevJustClosedInfo.phraseEn} and we reopen today (${todayDayEn}) at ${openFmt} (today's hours: ${openFmt} to ${closeFmt}).`,
        closedPromptEs: `En este momento ya cerramos; el turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y abrimos hoy ${todayDayEs} ${atTimeEsBridge(openFmt)}. ¿En qué te ayudo hoy?`,
        closedPromptEn: `We are currently closed; our ${prevDayEn} shift ${prevJustClosedInfo.phraseEn} and we reopen today at ${openFmt}. How can I help you today?`
      }
    }
    return {
      isOpenNow: false,
      todayCloseFmt: closeFmt,
      statusEs: `Cerrado en este momento en ${dispEs}; hoy ${todayDayEs} abrimos ${atTimeEsBridge(openFmt)} y cerramos ${atTimeEsBridge(closeFmt)}.`,
      statusEn: `Currently closed at ${dispEn}; today (${todayDayEn}) we open at ${openFmt} and close at ${closeFmt}.`,
      closedPromptEs: `En este momento aún estamos cerrados; hoy ${todayDayEs} abrimos ${atTimeEsBridge(openFmt)} y cerramos ${atTimeEsBridge(closeFmt)}. ¿En qué te ayudo hoy?`,
      closedPromptEn: `We are currently closed; today we open at ${openFmt} and close at ${closeFmt}. How can I help you today?`
    }
  }

  return {
    isOpenNow: false,
    todayCloseFmt: closeFmt,
    statusEs: `Cerrado en este momento en ${dispEs}; hoy ${todayDayEs} cerramos ${atTimeEsBridge(closeFmt)}.`,
    statusEn: `Currently closed at ${dispEn}; we closed today at ${closeFmt}.`,
    closedPromptEs: `En este momento ya cerramos por hoy (cerramos ${atTimeEsBridge(closeFmt)}). ¿En qué te ayudo hoy?`,
    closedPromptEn: `We are currently closed for the night (closed at ${closeFmt}). How can I help you today?`
  }
}

function compactWeeklySummary(weeklyHours: any[]): string {
  if (!Array.isArray(weeklyHours) || weeklyHours.length === 0) return "Consultar horario diario"
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
  const ordered = [1, 2, 3, 4, 5, 6, 0]
  const map: Record<number, string> = {}
  for (const d of weeklyHours) {
    if (d && typeof d.day === "number") {
      map[d.day] = `${fmt12h(d.open)}-${fmt12h(d.close)}`
    }
  }
  return ordered
    .filter((idx) => map[idx])
    .map((idx) => `${dayNames[idx]} ${map[idx]}`)
    .join(", ")
}

function buildInitialGreetingTexts(
  store: any,
  lang: PhoneLang,
  scheduleEval: ReturnType<typeof evaluateStoreSchedule>,
  includeLangSwitchHint: boolean
) {
  const target = customerGreetingTarget(store, lang)
  const postPrompt = !scheduleEval.isOpenNow
    ? lang === "en"
      ? scheduleEval.closedPromptEn
      : scheduleEval.closedPromptEs
    : lang === "en"
      ? "How can I help you today?"
      : "¿En qué te ayudo hoy?"

  if (lang === "en") {
    const switchHint = includeLangSwitchHint ? " Para español, oprima el nueve." : ""
    const disclosure = `Thanks for calling Tacos Gavilan ${target}!${switchHint} You're speaking with our virtual assistant on a transcribed line.`
    return {
      disclosureOnly: disclosure,
      questionOnly: postPrompt,
      fullGreeting: `${disclosure} ${postPrompt}`.trim()
    }
  }

  const switchHint = includeLangSwitchHint ? " For English, press nine." : ""
  const disclosure = `¡Gracias por llamar a Tacos Gavilan ${target}!${switchHint} Hablas con nuestra asistente virtual en una llamada transcrita para atenderte.`
  return {
    disclosureOnly: disclosure,
    questionOnly: postPrompt,
    fullGreeting: `${disclosure} ${postPrompt}`.trim()
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message))
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  )
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message))
  return uint8ToBase64(new Uint8Array(sigBuf))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function verifyTwilioHttpSignature(
  req: Request,
  params: Record<string, string>,
  twilioAuthToken: string
): Promise<boolean> {
  const headerSig = (req.headers.get("x-twilio-signature") || "").trim()
  if (!headerSig || !twilioAuthToken) return false

  const sortedKeys = Object.keys(params).sort()
  let paramSuffix = ""
  for (const k of sortedKeys) {
    paramSuffix += k + (params[k] ?? "")
  }

  const reqUrl = new URL(req.url)
  const pubHost = new URL(SUPABASE_URL).host
  const fwdHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || pubHost

  const candidates = Array.from(
    new Set([
      `https://${pubHost}/functions/v1/phone-live-bridge${reqUrl.search}`,
      `https://${fwdHost}/functions/v1/phone-live-bridge${reqUrl.search}`,
      `https://${fwdHost}${reqUrl.pathname}${reqUrl.search}`,
      req.url
    ])
  )

  for (const urlCandidate of candidates) {
    const expected = await hmacSha1Base64(twilioAuthToken, urlCandidate + paramSuffix)
    if (constantTimeEqual(expected, headerSig)) return true
  }
  return false
}

async function signTtsUrl(
  baseUrl: string,
  ttsSecret: string,
  text: string,
  lang: PhoneLang,
  voice = "Kore"
): Promise<string> {
  const cleanText = text.trim()
  const fullHex = await hmacSha256Hex(ttsSecret, `${lang}|${voice}|${cleanText}`)
  const sig = fullHex.slice(0, 32)
  return `${baseUrl}/api/phone/tts?lang=${lang}&voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(cleanText)}&sig=${sig}&rate=8000`
}

async function fetchMulawPromptClip(
  baseUrl: string,
  ttsSecret: string,
  text: string,
  lang: PhoneLang
): Promise<Uint8Array | null> {
  const cacheKey = `${lang}|${text.trim()}`
  const hit = mulawPromptRamCache.get(cacheKey)
  if (hit) return hit
  try {
    const url = await signTtsUrl(baseUrl, ttsSecret, text, lang, "Kore")
    const res = await fetch(url, { signal: AbortSignal.timeout(2600) })
    if (!res.ok) return null
    const wavBytes = new Uint8Array(await res.arrayBuffer())
    const mulaw = convertWavBytesToMulaw8k(wavBytes)
    if (mulaw.length > 160) {
      mulawPromptRamCache.set(cacheKey, mulaw)
      return mulaw
    }
  } catch {
    // Si tarda, Gemini Live hablará directamente
  }
  return null
}

async function handleTwilioHttpPost(req: Request): Promise<Response> {
  const secrets = await loadSecrets()
  const formData = await req.formData().catch(() => null)
  const params: Record<string, string> = {}
  if (formData) {
    formData.forEach((v, k) => {
      params[k] = String(v)
    })
  }

  const sigValid = await verifyTwilioHttpSignature(req, params, secrets.twilioAuthToken)
  if (!sigValid) {
    return new Response("Forbidden: Invalid X-Twilio-Signature", { status: 403 })
  }

  const reqUrl = new URL(req.url)
  const callSid = (params.CallSid || `TWILIO_${Date.now()}`).trim()
  const fromNumber = (params.From || "").trim()
  const toNumber = (params.To || "").trim()
  const forwardedFrom = (params.ForwardedFrom || "").trim()
  const digits = (params.Digits || "").trim()
  const isPreconsentSwitch = reqUrl.searchParams.get("preconsent") === "1" && digits === "9"

  const [stores, configs, specialHours] = await Promise.all([
    pgSelect("stores?is_active=eq.true&select=id,name,code,external_id,address,phone,has_drive_thru,weekly_hours&order=id.asc"),
    pgSelect("phone_agent_config?select=*"),
    pgSelect("phone_special_hours?select=*")
  ])

  let storeId: number | null = null
  const qStore = Number(reqUrl.searchParams.get("storeId"))
  if (Number.isInteger(qStore) && qStore > 0) {
    storeId = qStore
  } else {
    const fwd10 = normalizeDigits10(forwardedFrom)
    if (fwd10.length === 10) {
      const m = stores.find((s) => normalizeDigits10(s.phone) === fwd10)
      if (m) storeId = Number(m.id)
    }
    if (!storeId) {
      const to10 = normalizeDigits10(toNumber)
      if (to10.length === 10) {
        const cfgMatches = configs.filter((c) => normalizeDigits10(c.twilio_phone_number) === to10)
        if (cfgMatches.length === 1) storeId = Number(cfgMatches[0].store_id)
      }
    }
  }

  if (!storeId) {
    const fallbackUrl = await signTtsUrl(
      secrets.publicAppBaseUrl,
      secrets.ttsSigningSecret,
      "Gracias por llamar a Tacos Gavilan. Puedes consultar nuestro menú y horarios en tacosgavilan.com.",
      "es"
    )
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${escapeXml(fallbackUrl)}</Play><Hangup/></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } }
    )
  }

  const store = stores.find((s) => Number(s.id) === storeId) || stores[0]
  const config = configs.find((c) => Number(c.store_id) === storeId) || {
    store_id: storeId,
    is_enabled: true,
    default_language: "es",
    accepts_ebt: ![1, 9].includes(storeId)
  }

  const pt = getPacificNow()
  const schedEval = evaluateStoreSchedule(store, specialHours, pt)
  const baseLang: PhoneLang = config.default_language === "en" ? "en" : "es"
  const activeLang: PhoneLang = isPreconsentSwitch ? (baseLang === "en" ? "es" : "en") : baseLang

  if (!config.is_enabled) {
    const target = customerGreetingTarget(store, activeLang)
    const msg =
      activeLang === "en"
        ? `Thank you for calling Tacos Gavilan ${target}. ${schedEval.statusEn} You can order online at tacosgavilan.com.`
        : `Gracias por llamar a Tacos Gavilan ${target}. ${schedEval.statusEs} También puedes ordenar en línea en tacosgavilan.com.`
    const disabledUrl = await signTtsUrl(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, msg, activeLang)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${escapeXml(disabledUrl)}</Play><Hangup/></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } }
    )
  }

  const greetings = buildInitialGreetingTexts(store, activeLang, schedEval, !isPreconsentSwitch)
  const [discPlayUrl, qPlayUrl] = await Promise.all([
    signTtsUrl(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.disclosureOnly, activeLang),
    signTtsUrl(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.questionOnly, activeLang)
  ])

  const initialTranscript: TranscriptEntry[] = [
    { role: "assistant", text: greetings.fullGreeting, timestamp: new Date().toISOString() }
  ]

  // Persistir registro inicial en phone_calls sin bloquear TwiML
  EdgeRuntime.waitUntil(
    (async () => {
      if (isPreconsentSwitch) {
        await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
          method: "PATCH",
          headers: dbHeaders(),
          body: JSON.stringify({ language: activeLang, transcript: initialTranscript })
        }).catch(() => null)
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?on_conflict=call_sid`, {
          method: "POST",
          headers: dbHeaders({ Prefer: "resolution=ignore-duplicates" }),
          body: JSON.stringify({
            call_sid: callSid,
            store_id: store.id,
            source: "twilio",
            caller_number: fromNumber || null,
            to_number: toNumber || null,
            forwarded_from: forwardedFrom || null,
            language: activeLang,
            caller_category: "customer",
            primary_intent: "general",
            status: "in_progress",
            resolved_by_ai: false,
            turns_count: 0,
            duration_seconds: 0,
            transcript: initialTranscript,
            business_date: pt.businessDate,
            shift: pt.shift
          })
        }).catch(() => null)
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/reconcile_phone_call_with_tombstone_atomic`, {
          method: "POST",
          headers: dbHeaders(),
          body: JSON.stringify({ p_call_sid: callSid })
        }).catch(() => null)
        const fwd10 = normalizeDigits10(forwardedFrom)
        const store10 = normalizeDigits10(store.phone)
        if (fwd10.length === 10 && fwd10 === store10 && config.forwarding_status !== "verified") {
          await fetch(`${SUPABASE_URL}/rest/v1/phone_agent_config?store_id=eq.${store.id}`, {
            method: "PATCH",
            headers: dbHeaders(),
            body: JSON.stringify({
              forwarding_status: "verified",
              forwarding_verified_at: new Date().toISOString()
            })
          }).catch(() => null)
        }
      }
      // Pre-calentar en RAM el clip μ-law de "¿En qué te ayudo hoy?" y el contexto de tienda mientras suena el aviso CIPA (~10 s)
      await Promise.all([
        fetchMulawPromptClip(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.questionOnly, activeLang),
        buildBridgeSystemPromptAndData(store.id, activeLang, fromNumber).catch(() => null)
      ])
    })()
  )

  const streamTs = Date.now()
  const streamSig = await hmacSha256Hex(
    secrets.twilioAuthToken,
    `${callSid}|${store.id}|${activeLang}|${streamTs}`
  )
  const wssBridgeUrl = `wss://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge`
  const selfHttpUrl = `https://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge?storeId=${store.id}&lang=${activeLang}&preconsent=1`
  const vercelFallbackRespond = `${secrets.publicAppBaseUrl}/api/phone/respond?storeId=${store.id}&lang=${activeLang}&turn0=1`

  const disclosureBlock = isPreconsentSwitch
    ? `<Play>${escapeXml(discPlayUrl)}</Play>`
    : `<Gather input="dtmf" numDigits="1" timeout="1" action="${escapeXml(selfHttpUrl)}" method="POST">
    <Play>${escapeXml(discPlayUrl)}</Play>
  </Gather>`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${disclosureBlock}
  <Connect>
    <Stream url="${escapeXml(wssBridgeUrl)}">
      <Parameter name="callSid" value="${escapeXml(callSid)}" />
      <Parameter name="storeId" value="${store.id}" />
      <Parameter name="lang" value="${activeLang}" />
      <Parameter name="callerNumber" value="${escapeXml(fromNumber)}" />
      <Parameter name="toNumber" value="${escapeXml(toNumber)}" />
      <Parameter name="forwardedFrom" value="${escapeXml(forwardedFrom)}" />
      <Parameter name="ts" value="${streamTs}" />
      <Parameter name="sig" value="${escapeXml(streamSig)}" />
    </Stream>
  </Connect>
  <Gather input="speech dtmf" numDigits="1" language="${activeLang === "en" ? "en-US" : "es-US"}" speechTimeout="1" timeout="4" actionOnEmptyResult="true" action="${escapeXml(vercelFallbackRespond)}" method="POST">
    <Play>${escapeXml(qPlayUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(vercelFallbackRespond)}&amp;silence=1</Redirect>
</Response>`

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" }
  })
}

const LIVE_TOOL_DECLARATIONS = [
  {
    name: "get_store_hours_and_status",
    behavior: "BLOCKING",
    description: "Consulta en vivo el estado abierto/cerrado, horario semanal y próximos días festivos de esta sucursal.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "search_menu_item_price",
    behavior: "BLOCKING",
    description: "Busca precios exactos en USD e ingredientes en el menú en vivo de la sucursal.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Platillo o bebida a consultar." }
      },
      required: ["query"]
    }
  },
  {
    name: "get_fiesta_platter_packages",
    behavior: "BLOCKING",
    description: "Calcula paquetes y precios en USD de charolas Fiesta Platter según el número de personas.",
    parameters: {
      type: "OBJECT",
      properties: {
        guest_count: { type: "INTEGER", description: "Número estimado de invitados." }
      },
      required: ["guest_count"]
    }
  },
  {
    name: "find_other_stores",
    behavior: "BLOCKING",
    description: "Consulta ubicaciones, entrecalles, teléfonos, Drive-Thru y horarios de las 15 sucursales.",
    parameters: {
      type: "OBJECT",
      properties: {
        search_city_or_filter: { type: "STRING", description: "Ciudad, zona o 'drive_thru'." }
      }
    }
  },
  {
    name: "validate_order_ticket",
    behavior: "BLOCKING",
    description:
      "Valida en tiempo real en el sistema POS/Supabase de la sucursal si un número de ticket, orden Drive-Thru o pedido de entrega (por ticket o customer_name) existe realmente para la fecha indicada. Invócala DE INMEDIATO cuando el cliente dé un número/código o pregunte el estatus de un pedido existente (Uber/DoorDash/pickup), ANTES de darlo por bueno, inventar estatus o llamar create_manager_callback.",
    parameters: {
      type: "OBJECT",
      properties: {
        ticket_or_order_number: { type: "STRING", description: "Número de ticket, orden o código dicho por el cliente (ej. '1600', '#983', '012234', 'SIN TICKET')." },
        customer_name: { type: "STRING", description: "Nombre del cliente cuando consulta orden de Uber Eats, DoorDash, Grubhub o pickup por nombre (ej. 'Enrique')." },
        purchase_date: { type: "STRING", description: "Fecha o momento de compra dicho por el cliente (ej. 'hoy', 'el día de hoy', 'ayer', '2026-11-21')." },
        target_store_id: { type: "INTEGER", description: "ID de sucursal (1, 3..16) si el cliente indicó que compró en otra tienda distinta." }
      },
      required: ["ticket_or_order_number"]
    }
  },
  {
    name: "create_manager_callback",
    behavior: "BLOCKING",
    description:
      "Registra un Recado Prioritario para el Gerente o Nota de Empaque en la pantalla de la sucursal. Úsalo ÚNICAMENTE cuando ya tengas nombre real y teléfono real de 10 dígitos (y en reclamos de orden equivocada/incompleta en tienda o Drive-Thru también número de ticket VALIDADO con validate_order_ticket o confirmación explícita de SIN TICKET + fecha de compra).",
    parameters: {
      type: "OBJECT",
      properties: {
        caller_name: { type: "STRING", description: "Nombre real de la persona." },
        caller_phone: {
          type: "STRING",
          description: "Teléfono real de 10 dígitos o 'CALLER_ID' si autorizó explícitamente usar el mismo número del que llama."
        },
        caller_type: { type: "STRING", description: "'customer', 'employee', 'vendor', 'delivery_driver', o 'corporate'." },
        urgency: { type: "STRING", description: "'high', 'critical', o 'normal' (siempre 'normal' para 'condiments_note')." },
        reason_category: {
          type: "STRING",
          description:
            "'condiments_note', 'wrong_store_order', 'delivery_issue', 'missing_or_wrong_item' (o 'wrong_or_missing_order'), 'lost_item', 'employee_callout', 'vendor_arrival', 'billing_refund', u 'other'."
        },
        reason_summary: {
          type: "STRING",
          description:
            "Resumen completo y claro SIEMPRE EN ESPAÑOL para el gerente en pantalla de tienda (ej. 'Solicita hablar con el gerente en turno sobre [motivo]'; PROHIBIDO redactarlo en inglés incluso si el cliente habló en inglés)."
        },
        ticket_or_order_number: { type: "STRING", description: "Número de ticket u orden validado, o 'SIN TICKET'." },
        order_date: { type: "STRING", description: "Fecha o momento de compra dicho por el cliente." },
        target_store_id: { type: "INTEGER", description: "ID de sucursal destino (1, 3..16) si pidió en otra tienda." }
      },
      required: ["caller_name", "caller_phone", "reason_category", "reason_summary"]
    }
  },
  {
    name: "flag_unanswered_question",
    behavior: "BLOCKING",
    description: "Registra una duda legítima del negocio sin respuesta oficial en el contexto.",
    parameters: {
      type: "OBJECT",
      properties: {
        question_text: { type: "STRING", description: "Pregunta exacta sin respuesta oficial." }
      },
      required: ["question_text"]
    }
  },
  {
    name: "end_call",
    behavior: "BLOCKING",
    description:
      "Invócala ÚNICAMENTE al final cuando el cliente confirme explícitamente que ya terminó o se despide ('es todo, gracias', 'no gracias, bye', 'adiós', 'hasta luego', 'eso es todo, gracias', 'that is all, thank you'). ESTRICTAMENTE PROHIBIDO invocarla si el cliente solo dijo 'okay, gracias', o si expresó frustración, queja o dijo 'me voy con la competencia' / '¿por qué me cuelgas?' sin despedirse explícitamente.",
    parameters: {
      type: "OBJECT",
      properties: {
        farewell_reason: { type: "STRING", description: "Motivo breve de cierre." }
      }
    }
  }
]

type BridgePromptData = {
  store: any
  stores: any[]
  config: any
  specialHours: any[]
  menuItems: any[]
  schedEval: ReturnType<typeof evaluateStoreSchedule>
  greetings: ReturnType<typeof buildInitialGreetingTexts>
  spokenAddr: string
  systemText: string
}

const prewarmedBridgeCache = new Map<string, { at: number; data: BridgePromptData }>()

async function getPrewarmedOrBuildBridgeData(storeId: number, lang: PhoneLang, callerNumber: string): Promise<BridgePromptData> {
  const key = `${storeId}|${lang}|${callerNumber || ""}`
  const hit = prewarmedBridgeCache.get(key)
  if (hit && Date.now() - hit.at < 45_000) {
    prewarmedBridgeCache.delete(key)
    return hit.data
  }
  return buildBridgeSystemPromptAndData(storeId, lang, callerNumber)
}

async function buildBridgeSystemPromptAndData(storeId: number, lang: PhoneLang, callerNumber: string): Promise<BridgePromptData> {
  const [stores, configs, specialHours, menuItems, kbEntries, learnedItems] = await Promise.all([
    pgSelect("stores?is_active=eq.true&select=id,name,code,external_id,address,phone,has_drive_thru,weekly_hours&order=id.asc"),
    pgSelect("phone_agent_config?select=*"),
    pgSelect("phone_special_hours?select=*"),
    pgSelect(
      `app_menu_cache?store_id=eq.${storeId}&is_available=eq.true&select=category_name,name,description,price&order=category_name.asc,name.asc`
    ),
    pgSelect(
      `phone_knowledge_base?is_active=eq.true&or=(store_id.is.null,store_id.eq.${storeId})&select=id,category,title,answer_es,answer_en,priority&order=priority.desc`
    ),
    pgSelect(
      `phone_learning_items?status=in.(approved,auto_applied)&applies_to_channels=in.(both,phone_only)&item_kind=in.(doubt_for_owner,learned_rule,fast_reply_macro,stt_synonym)&or=(store_id.is.null,store_id.eq.${storeId})&select=item_kind,status,applies_to_channels,category,question_or_trigger,proposed_rule_es,proposed_rule_en,store_id&order=status.asc,evidence_count.desc,updated_at.desc&limit=40`
    )
  ])

  const store = stores.find((s) => Number(s.id) === storeId) || stores[0]
  const config = configs.find((c) => Number(c.store_id) === storeId) || {
    store_id: storeId,
    is_enabled: true,
    default_language: "es",
    accepts_ebt: ![1, 9].includes(storeId)
  }

  const pt = getPacificNow()
  const schedEval = evaluateStoreSchedule(store, specialHours, pt)
  const greetings = buildInitialGreetingTexts(store, lang, schedEval, true)

  const dispName = customerStoreDisplay(store, lang)
  const spokenName = customerStoreSpoken(store, lang)
  const laMeta = LA_CROSS_STREETS[Number(store.id)]
  const spokenAddr = expandStreetAddress(store.address || "", lang)

  // Agrupar menú compacto por categoría
  const byCat = new Map<string, string[]>()
  for (const m of menuItems) {
    const cat = String(m.category_name || "Menu")
    if (!byCat.has(cat)) byCat.set(cat, [])
    const price = Number(m.price || 0).toFixed(2)
    byCat.get(cat)!.push(`${m.name}: $${price}`)
  }
  const menuTextLines: string[] = []
  for (const [cat, items] of byCat.entries()) {
    menuTextLines.push(`[${cat}] ${items.join(" | ")}`)
  }

  const trayLines = PARTY_TRAYS.map((t) => {
    const found = findPartyTrayMenuItem(menuItems, t.key)
    const p = found ? `$${Number(found.price).toFixed(2)} USD` : "consultar en tacosgavilan.com"
    return `- Fiesta Platter ${t.key} (${t.guests}): ${p} — ${t.meatLbs} lbs carne (Asada/Pollo/Pastor), arroz y frijol, ${t.cornDoz} docenas maíz o ${t.flourDoz} docenas harina, ${t.aguasGal} gal agua fresca, salsas y utensilios.`
  }).join("\n")

  // Directorio compacto con estatus en vivo y horario de HOY (para consultar horario semanal de otra tienda usar find_other_stores)
  const dirLines = stores
    .map((s) => {
      const lbl = customerStoreDisplay(s, lang)
      const la = LA_CROSS_STREETS[Number(s.id)]
      const cross = la ? ` [${lang === "en" ? la.crossEn : la.crossEs}]` : ""
      const ebt = ![1, 9].includes(Number(s.id)) ? "EBT comedor" : "Sin EBT"
      const ev = evaluateStoreSchedule(s, specialHours, pt)
      const stateTag = ev.isOpenNow ? "Abierta" : "Cerrada"
      return `- #${s.id} ${lbl}${cross}: ${expandStreetAddress(s.address || "", lang)} | Tel: ${s.phone} | ${s.has_drive_thru ? "CON Drive-Thru" : "Sin Drive-Thru"} | ${ebt} | ${stateTag}: ${lang === "en" ? ev.statusEn : ev.statusEs}`
    })
    .join("\n")

  // Omitir entrada duplicada de precios fijos (#084304c3) y resumen redundante largo si ya van en vivo arriba
  const kbLines = kbEntries
    .filter((k) => {
      const cat = String(k.category || "").toLowerCase()
      if (cat === "staff") return false
      if (String(k.id || "") === "084304c3-8629-471b-9277-3b47518a962d") return false
      return true
    })
    .slice(0, 60)
    .map((k) => `- [${k.category}] ${k.title}: ${lang === "en" ? k.answer_en || k.answer_es : k.answer_es || k.answer_en}`)
    .join("\n")

  const learnedLines = (Array.isArray(learnedItems) ? learnedItems : [])
    .filter((r) => {
      if (!r || (!r.proposed_rule_es && !r.proposed_rule_en)) return false
      if (r.item_kind === "latency_insight" || r.item_kind === "audio_prewarm") return false
      if (r.applies_to_channels === "drive_thru_only") return false
      return true
    })
    .sort((a, b) => {
      const aApp = a.status === "approved" ? 0 : 1
      const bApp = b.status === "approved" ? 0 : 1
      if (aApp !== bApp) return aApp - bApp
      const aStore = Number(a.store_id) === storeId ? 0 : 1
      const bStore = Number(b.store_id) === storeId ? 0 : 1
      return aStore - bStore
    })
    .slice(0, 30)
    .map((r, i) => {
      const kindTag = r.item_kind === "stt_synonym" ? "STT" : String(r.category || "general").toUpperCase()
      const scopeTag = Number(r.store_id) === storeId ? `SOLO ${dispName}` : "GLOBAL"
      const txt = lang === "en" ? r.proposed_rule_en || r.proposed_rule_es : r.proposed_rule_es || r.proposed_rule_en
      return `${i + 1}. [${kindTag} - ${scopeTag}] (${r.question_or_trigger || ""}): ${txt}`
    })
    .join("\n")

  const baseLangAnchor =
    lang === "en"
      ? "ACTIVE BASE LANGUAGE: ENGLISH (primary: Spanish & English; universal multilingual mirror & strict session_language lock enabled). Greeted in English. While the call is in English or Spanish, mirror complete sentences between warm American English and Southern California Mexican Spanish (NEVER flip language on brief interjections like 'no my god', 'oh my god', 'okay', 'bye', 'un', and NEVER switch language or respond to strange characters from road/engine noise like 'क्या से है...'). If the caller genuinely initiates clear restaurant/customer sentences in a 3rd language (Korean, Chinese Mandarin/Cantonese, Japanese, Portuguese, French, Tagalog, Vietnamese, Arabic, Russian, Armenian, Hindi, German, Italian), keep session_language STRICTLY LOCKED to that language throughout the call (unless they explicitly ask 'in Spanish' / 'in English'), keeping prices strictly in USD ($)."
      : "IDIOMA BASE ACTIVO: ESPAÑOL (principales: Español e Inglés; espejo multilingüe universal y bloqueo estricto session_language activos). Ya saludaste en español. Mientras la llamada transcurra en español o inglés, responde en español cálido del Sur de California (o 100% inglés si habla oraciones completas claras en inglés o presiona 9), JAMÁS saltes al inglés por muletillas aisladas como 'no my god', 'oh my god', 'okay', 'bye' o 'un', y JAMÁS cambies de idioma ni respondas a sílabas/caracteres extraños generados por ruido vial o de motor ('क्या से है...'). Y si el llamante inicia genuinamente con oraciones claras de consulta/restaurante en un 3.er idioma (Coreano, Chino Mandarín/Cantonés, Japonés, Portugués, Francés, Tagalo, Vietnamita, Árabe, Ruso, Armenio, Hindi, Alemán, Italiano), mantén session_language ESTRICTAMENTE FIJO en ese idioma durante toda la llamada (salvo petición explícita 'en español' / 'in English'), con todos los precios en dólares USD ($)."

  const callbackOutcome = schedEval.isOpenNow
    ? "confírmale con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer 'enseguida', 'de inmediato', 'ahorita', 'right away' o 'immediately')."
    : "aclárale con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos."

  const systemText = [
    baseLangAnchor,
    "",
    `Eres Kore, la recepcionista telefónica en vivo de **Tacos Gavilan** en **${spokenName}** (Sucursal #${store.id}${laMeta ? `, esquina oficial: ${lang === "en" ? laMeta.crossEn : laMeta.crossEs}` : ""}), California, EE. UU. CONCORDANCIA DE GÉNERO FEMENINO EN ESPAÑOL: Eres mujer; al hablar de ti usa siempre adjetivos femeninos ("aquí sigo lista", "estoy lista", "quedo atenta", "segura"; PROHIBIDO decirte "listo" o "atento").`,
    `REGLAS INQUEBRANTABLES DE IDENTIDAD, VOZ Y NEGOCIO:`,
    `0. CERO PEDIDOS POR TELÉFONO (BLOQUEO INMEDIATO EN TU PRIMERA ORACIÓN — PRIORIDAD MÁXIMA): NUNCA tomamos, armamos ni procesamos órdenes nuevas de comida por teléfono. Si el cliente dice frases de intención de compra como 'quiero dos tacos y dos burritos', 'voy a querer...', 'dame...', 'me das...', 'puedo pedir...', 'me tomas la orden', 'I want two tacos...', 'can I order...':`,
    `   - EN TU PRIMERA ORACIÓN dile con amabilidad que **no tomamos órdenes por teléfono** e invítalo a ordenar fácilmente en **tacosgavilan.com** para recoger${store.has_drive_thru ? " o directamente en caja o por el Drive-Thru" : " o directamente en caja"}.`,
    `   - ESTRICTAMENTE PROHIBIDO actuar como cajera o preguntar '¿Regular o Super?', '¿qué carne?', '¿con todo?' o '¿algo más de tu orden?'.`,
    `   - Si mencionan platillos, solo si aporta utilidad informativa da sus precios unitarios directos en USD (y para burrito/quesadilla/mulita sin especificar Super, informa ambos precios Regular y Super sin preguntar cuál prefiere ni decir 'tamaño'), cerrando sin tomar pedido. Excepción única: reclamos o condimentos de un pedido YA realizado (Regla #8).`,
    `   - PROHIBIDO decir las palabras 'política', 'políticas', 'reglamentos' o 'policy'.`,
    `1. MARCA Y MONEDA: El nombre oficial es estrictamente **Tacos Gavilan** (JAMÁS digas 'Tacos El Gavilan'). Todos los precios son exclusivamente en **dólares y centavos estadounidenses (USD)** (PROHIBIDO decir 'pesos' o 'MXN').`,
    `2. ESTILO DE VOZ EN VIVO (ÁGIL Y HUMANO): Tono cálido, amable, natural y directo. CERO muletillas iniciales (NO empieces con '¡Sí!', '¡Claro que sí!', '¡Por supuesto!' ni '¡Hola!'). Respuestas cortas y fluidas de **1 a 2 oraciones (8 a 20 palabras)**; solo usa hasta 50-60 palabras cuando coticen múltiples platillos o Fiesta Platters. Ya saludaste al contestar: NO vuelvas a saludar. Si preguntan si grabamos su voz o si es legal, responde cálido y directo en 1 frase sin sonar robótico: 'No guardamos grabaciones de tu voz; la llamada solo se transcribe en texto en el momento para atenderte y por eso escuchaste el aviso al inicio.'`,
    `3. SUCURSALES DE LOS ÁNGELES (#5, #6 y #7 — OBLIGATORIO): Frente al cliente PROHIBIDO decir solo 'Broadway', 'Central', 'Slauson', 'LA Broadway' o 'LA Central'. SIEMPRE di **Los Ángeles** con sus entrecalles oficiales: #5 = **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway); #6 = **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, con Drive-Thru); #7 = **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway). Pronuncia las calles completas sin abreviaturas.`,
    `4. HORARIOS Y DESAYUNOS EN VIVO (Hoy ${BRIDGE_DAY_NAMES_ES[pt.dayOfWeek]} ${pt.dateStr}, ${String(pt.hour).padStart(2, "0")}:${String(pt.minute).padStart(2, "0")} PT${pt.hour < 6 ? " — ES MADRUGADA: si reabrimos esta misma mañana, di SIEMPRE 'hoy' / 'today', JAMÁS 'mañana' / 'tomorrow'" : ""}):`,
    `   - Estado actual aquí: ${schedEval.statusEs} / ${schedEval.statusEn}`,
    `   - Horario semanal aquí: ${compactWeeklySummary(store.weekly_hours)}`,
    `   - Festivos anuales oficiales: Cerrado Viernes Santo y Navidad (25 dic); cierra 4:00 PM en Thanksgiving, Nochebuena (24 dic) y Fin de Año (31 dic); abre 11:00 AM en Año Nuevo (1 ene) y Black Friday.`,
    `   - **Desayunos (las 15 sucursales)**: Todos los días desde la apertura hasta las **2:00 PM** (${pt.isBreakfastOpen && schedEval.isOpenNow ? "DISPONIBLES AHORA" : "YA TERMINARON POR HOY — ofrece nuestro menú regular"}). **Café caliente (16 oz) y Champurrado (16 oz y Caja 96 oz) SÍ disponibles TODO EL DÍA**.`,
    `5. DRIVE-THRU Y EBT CALFRESH:`,
    `   - Drive-Thru aquí: ${store.has_drive_thru ? "SÍ tenemos Drive-Thru." : "NO tenemos Drive-Thru aquí (solo comedor y para llevar)."} Las 6 tiendas con Drive-Thru son West Covina, Los Ángeles (Central y Washington), La Puente, Norwalk, Lynwood y South Gate.`,
    `   - EBT CalFresh aquí: ${config.accepts_ebt ? "SÍ aceptamos EBT CalFresh ÚNICAMENTE pasando adentro a la caja del mostrador del comedor; JAMÁS se procesa EBT por la ventanilla del Drive-Thru." : "NO aceptamos EBT CalFresh en esta sucursal (Rialto y Santa Ana no aceptan EBT); sí efectivo, tarjetas y Apple Pay/Google Pay."}`,
    `6. MENÚ COMPLETO POR VOZ, REGULAR VS SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - **RECITA EL MENÚ COMPLETO POR VOZ (PROHIBIDO MANDAR A LA WEB PARA VER EL MENÚ)**: Si preguntan "¿qué venden?", "¿qué hay en el menú?", "¿me repites el menú?", "no lo quiero visitar, ¿me lo puedes decir tú?" o "¿es toda la comida que tienen?", NUNCA los envíes a visitar tacosgavilan.com para ver el menú (tacosgavilan.com solo se menciona si desean ordenar en línea), y JAMÁS respondas "sí, ese es todo nuestro menú" si omitiste alguna categoría. Incluye SIEMPRE explícitamente **Taco Plate (3 tacos con arroz y frijoles)**, **Platos completos (con arroz, frijoles, guacamole, ensalada y tortillas)** y **Desayunos (todos los días hasta las 2:00 PM: burritos, tortas y platos de huevos)** además de **Tacos, Burritos (Regular, Super y Meat Only), Quesadillas, Mulitas, Tortas (Asada, Pastor, Milanesa, Cubana y más), Sopes, Super Nachos**, las **8 carnes** (Carne Asada, Al Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo y Carnitas), bebidas (**Aguas Frescas de Horchata, Jamaica, Piña y Tamarindo, sodas de fuente, agua embotellada, y Café y Champurrado todo el día**), postres (**Flan y Cheesecake** individuales) y **Charolas Fiesta Platter**.`,
    `   - Si consultan varios precios, informa cada uno en USD y el subtotal aproximado ('más impuestos' / 'plus tax') si ya especificaron todo; si falta Regular/Super informa ambos precios SIN tomar pedido.`,
    `   - Jamás digas 'tamaño'/'size' en comida: burritos, quesadillas y mulitas son **Regular** o **Super** (Burrito Regular = carne, arroz y frijol; Super añade queso, guacamole y crema; Mulita y Quesadilla Regular ya incluyen queso y Super añade guacamole y crema; Supreme/Supremo = Super).`,
    `   - Bebidas frías (Horchata, Jamaica, Piña, Tamarindo y sodas): únicamente **Mediana de 22 onzas**, **Grande de 32 onzas** y **Galón de 128 onzas** (aguas); **Champurrado 16 oz y Caja 96 oz, Café 16 oz**. PROHIBIDO decir 'chica', 'pequeña' o 'small'.`,
    `   - Postres: **SOLO Flan y Cheesecake individuales** (NO vendemos pasteles de cumpleaños, churros, menudo, birria, pozole, suadero, tripa ni alcohol).`,
    `   - **Charolas Fiesta Platter y Solución Urgente < 1 Hora para Grupos**: las charolas Fiesta Platter se ordenan en **tacosgavilan.com** con mínimo 1 hora de anticipación (invoca SIEMPRE \`get_fiesta_platter_packages\` por número de invitados). **PERO si el cliente necesita comida para su grupo en MENOS de 1 hora** (ej. 'ya los quiero para ahorita en media hora', '¿qué hago?'), JAMÁS le cierres la puerta ni te despidas: ofrécele proactivamente **2 soluciones reales** para no perder su evento: **(a)** pasar directo al mostrador${store.has_drive_thru ? " o al Drive-Thru" : ""} para preparar al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, **O (b)** tomar su nombre y teléfono de 10 dígitos con \`create_manager_callback\` (\`urgency: 'high'\`) para que el gerente en turno revise de inmediato la capacidad de cocina.`,
    `   - Correcciones fonéticas naturales: 'torta corona'='torta cubana', 'sasada'/'salad burrito'='asada', 'adobada'='pastor', 'muleta'='mulita', 'ibt'/'evt'/'tarjetas abc'='EBT', 'dritro'='Drive-Thru'.`,
    `7. RECADOS AL GERENTE Y RECLAMOS CON VALIDACIÓN REAL DE TICKET (CERO TRANSFERENCIAS TELEFÓNICAS):`,
    `   - Nunca transferimos llamadas a celulares personales. Usa \`create_manager_callback\` para alertas prioritarias en la pantalla de tienda y escribe \`reason_summary\` **SIEMPRE EN ESPAÑOL** claro para el gerente.`,
    `   - **Condimentos gratis en orden existente vs productos pagados**: para salsas, chiles, limones, cebollas o servilletas gratis en orden YA hecha (sin costo), pide nombre, número/código de orden, condimentos y teléfono de 10 dígitos -> \`create_manager_callback\` (\`reason_category: 'condiments_note'\`, \`urgency: 'normal'\`), aclarando que aplican sin costo si la orden aún no ha salido (para agregar comida o bebidas con costo diles pedirlas aparte en **tacosgavilan.com** o en caja).`,
    `   - **Uber Eats / DoorDash / Grubhub y Consulta de Estatus**: si preguntan el estatus real de una orden de delivery o pickup (ej. 'Enrique 012234'), INVOCA \`validate_order_ticket\` pasando \`ticket_or_order_number\` y/o \`customer_name\` antes de decir 'estoy revisando'. Cambios con costo, dirección, cancelación o reembolso se gestionan en **Ayuda (Help)** de su app; para avisar retraso al gerente, pide nombre, teléfono de 10 dígitos y código (\`reason_category: 'delivery_issue'\`).`,
    `   - **Sucursal equivocada en tacosgavilan.com**: pregunta en cuál tienda cayó, toma nombre, teléfono de 10 dígitos y orden -> \`create_manager_callback\` con \`target_store_id\` (\`reason_category: 'wrong_store_order'\`).`,
    `   - **Órdenes equivocadas o incompletas en tienda, Drive-Thru o tacosgavilan.com (VALIDACIÓN EN TIEMPO REAL OBLIGATORIA)**: pide con respeto los **4 datos obligatorios**: **1) número de ticket, 2) fecha de compra, 3) nombre y 4) teléfono real de 10 dígitos**, advirtiendo UNA SOLA VEZ que **sin el número de ticket es poco probable determinar la equivocación** ('Without the ticket number, it is unlikely we can verify the mistake'). **REGLA CRÍTICA**: en cuanto el cliente diga un número de ticket u orden (ej. '1600 del día de hoy'), **INVOCA DE INMEDIATO \`validate_order_ticket\`**: si \`found: true\`, confirma con amabilidad que ya localizaste su orden y pide solo lo que falte; si \`found: false\`, infórmale con claridad que ese número **NO aparece registrado** (mencionando si el sistema indica el rango de tickets del día) y pídele verificar su recibo, sucursal/fecha o plataforma. **SALIDA SIN BUCLE**: si confirma que perdió, tiró o no encuentra su ticket, NO repitas el pedido del ticket ni lo atrapes: pasa directo a registrar con \`ticket_or_order_number: 'SIN TICKET'\` (juntando el teléfono si lo dictó en 2 partes ej. '310' + '529 1147') sin prometer reposición. Cuando invoques una herramienta bloqueante espera su respuesta en silencio antes de hablar (nunca repitas dos veces 'Gracias, solo me falta...'). EJECUTA \`create_manager_callback\` ANTES de confirmar, y luego ${callbackOutcome}`,
    `   - **Objetos olvidados, empleados, proveedores o hablar con gerente**: en una sola pregunta pide nombre real, teléfono real de 10 dígitos${callerNumber ? ` (Caller ID entrante: ${callerNumber}; si autoriza explícitamente usar este mismo número envía caller_phone='CALLER_ID')` : ""} y brevemente el motivo (si el cliente ya dio nombre y teléfono sin motivo, igual registra el recado sin frenarlo), escribe \`reason_summary\` SIEMPRE EN ESPAÑOL, ejecuta \`create_manager_callback\` ANTES de confirmar y ${callbackOutcome}`,
    `8. CERO CUELGUES ANTE FRUSTRACIÓN, RUIDO VIAL Y CIERRE LIMPIO: Ignora ruidos breves de carretera/motor en el carro que suenen como sílabas ajenas sin sentido (jamás interrumpas diciendo 'la llamada no se escucha claramente' por ruido vial). Si el cliente te interrumpe diciendo '¿qué?', 'perdón' o 'repite' mientras enumerabas carnes o platillos, repite la lista COMPLETA desde el principio. **PROHIBIDO COLGAR O INVOCAR \`end_call\`** si el cliente expresa frustración, molestia, queja, '¿qué hago?', **'me voy con la competencia'** o **'¿por qué me colgaste?'** sin despedirse explícitamente ('adiós', 'bye', 'hasta luego', 'eso es todo, gracias'): ante frustración retén al cliente con empatía ofreciendo soluciones reales o avisar urgente al gerente (y si pregunta por qué se cortó una llamada previa, discúlpate con calidez aclarando que nunca colgamos a propósito y atiéndelo al instante). Tampoco invoques \`end_call\` cuando solo diga 'okay, gracias', 'gracias' o 'perfecto' (pregunta primero '¿Te puedo ayudar con algo más?'). Solo cuando confirme explícitamente que ya terminó o se despida ('es todo, gracias', 'no gracias, bye', 'adiós', 'that is all, thank you'), despídete cálidamente en una oración sin preguntas e invoca \`end_call\`.`,
    "",
    `DIRECTORIO EN VIVO DE LAS 15 SUCURSALES:`,
    dirLines,
    "",
    `CHAROLAS FIESTA PLATTER:`,
    trayLines,
    "",
    kbLines ? `BASE DE CONOCIMIENTO OFICIAL:\n${kbLines}\n` : "",
    learnedLines ? `REGLAS APRENDIDAS PRIORITARIAS:\n${learnedLines}\n` : "",
    `CATÁLOGO EN VIVO EN ${dispName} (USD):`,
    menuTextLines.join("\n")
  ]
    .filter(Boolean)
    .join("\n")

  const built: BridgePromptData = {
    store,
    stores,
    config,
    specialHours,
    menuItems,
    schedEval,
    greetings,
    spokenAddr,
    systemText
  }
  prewarmedBridgeCache.set(`${storeId}|${lang}|${callerNumber || ""}`, { at: Date.now(), data: built })
  return built
}

async function connectGeminiLiveWithHedge(
  keys: string[],
  setupPayload: Record<string, unknown>
): Promise<WebSocket> {
  const now = Date.now()
  const alive = keys.filter((k) => (deadGeminiKeyUntil.get(k) || 0) <= now)
  const pool = alive.length > 0 ? alive : keys
  const fresh = pool.filter((k) => (coolGeminiKeyUntil.get(k) || 0) <= now)
  const candidates = fresh.length > 0 ? fresh : pool

  const healthyPool = candidates.filter((k) => {
    const okAt = healthyGeminiKeyAt.get(k) || 0
    return okAt > 0 && now - okAt <= 10 * 60 * 1000
  })
  const healthySet = new Set(healthyPool)
  const rest = candidates.filter((k) => !healthySet.has(k))
  const aq = rest.filter((k) => k.startsWith("AQ."))
  const classic = rest.filter((k) => !k.startsWith("AQ."))
  const hStart = healthyPool.length > 0 ? geminiKeyCursor % healthyPool.length : 0
  const start = aq.length > 0 ? geminiKeyCursor % aq.length : 0
  geminiKeyCursor++
  const cooledFallback = fresh.length > 0 ? pool.filter((k) => !fresh.includes(k)) : []
  const ordered = [
    ...healthyPool.slice(hStart),
    ...healthyPool.slice(0, hStart),
    ...aq.slice(start),
    ...aq.slice(0, start),
    ...classic,
    ...cooledFallback
  ]

  const trySingleKey = (apiKey: string, abortSig: AbortSignal): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      if (abortSig.aborted) {
        reject(new Error("aborted"))
        return
      }
      const ws = new WebSocket(`${GEMINI_WS_BASE}?key=${encodeURIComponent(apiKey)}`)
      ws.binaryType = "arraybuffer"
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          coolGeminiKeyUntil.set(apiKey, Date.now() + 30_000)
          try {
            ws.close()
          } catch {}
          reject(new Error("setup_timeout"))
        }
      }, 4200)

      const onAbort = () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          try {
            ws.close()
          } catch {}
          reject(new Error("aborted"))
        }
      }
      abortSig.addEventListener("abort", onAbort, { once: true })

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ setup: setupPayload }))
        } catch (err) {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(err)
          }
        }
      }

      ws.onmessage = async (ev) => {
        const txt =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? SHARED_UTF8_DECODER.decode(ev.data)
              : SHARED_UTF8_DECODER.decode(await (ev.data as Blob).arrayBuffer())
        if (txt.includes("setupComplete") && !settled) {
          settled = true
          clearTimeout(timer)
          abortSig.removeEventListener("abort", onAbort)
          coolGeminiKeyUntil.delete(apiKey)
          healthyGeminiKeyAt.set(apiKey, Date.now())
          ws.onmessage = null
          ws.onerror = null
          ws.onclose = null
          resolve(ws)
        }
      }

      ws.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          coolGeminiKeyUntil.set(apiKey, Date.now() + 30_000)
          reject(new Error("ws_error"))
        }
      }

      ws.onclose = (ev) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          healthyGeminiKeyAt.delete(apiKey)
          const reason = String(ev.reason || "")
          if (/prepayment|depleted|API_KEY_INVALID|leaked|PERMISSION_DENIED/i.test(reason)) {
            deadGeminiKeyUntil.set(apiKey, Date.now() + 6 * 3600 * 1000)
          } else if (/Quota exceeded|RESOURCE_EXHAUSTED|rate/i.test(reason)) {
            coolGeminiKeyUntil.set(apiKey, Date.now() + 5 * 60 * 1000)
          }
          reject(new Error(`closed_${ev.code}_${reason.slice(0, 80)}`))
        }
      }
    })

  // Carrera de 2 llaves en paralelo (0 ms y 420 ms) y cola secuencial sobre el resto
  if (ordered.length >= 2) {
    const c0 = new AbortController()
    const c1 = new AbortController()
    try {
      const winner = await new Promise<WebSocket>((resolve, reject) => {
        let fails = 0
        let lastErr: unknown = null
        let launched1 = false
        const launch1 = () => {
          if (launched1) return
          launched1 = true
          trySingleKey(ordered[1], c1.signal).then(
            (ws) => {
              c0.abort()
              resolve(ws)
            },
            (err) => {
              lastErr = err
              fails++
              if (fails >= 2) reject(lastErr)
            }
          )
        }
        const hedgeTimer = setTimeout(launch1, 420)
        trySingleKey(ordered[0], c0.signal).then(
          (ws) => {
            clearTimeout(hedgeTimer)
            c1.abort()
            resolve(ws)
          },
          (err) => {
            clearTimeout(hedgeTimer)
            lastErr = err
            fails++
            launch1()
            if (fails >= 2) reject(lastErr)
          }
        )
      })
      return winner
    } catch {
      // Continuar con llaves restantes
    }
  }

  const startIdx = ordered.length >= 2 ? 2 : 0
  let lastError: unknown = new Error("No healthy Gemini Live keys")
  const BATCH_SIZE = 4
  for (let i = startIdx; i < ordered.length; i += BATCH_SIZE) {
    const batch = ordered.slice(i, i + BATCH_SIZE)
    const ctrls = batch.map(() => new AbortController())
    try {
      const winner = await new Promise<WebSocket>((resolve, reject) => {
        let settled = false
        let remaining = batch.length
        batch.forEach((key, bIdx) => {
          trySingleKey(key, ctrls[bIdx].signal).then(
            (ws) => {
              remaining--
              if (settled) {
                try { ws.close() } catch {}
                return
              }
              settled = true
              ctrls.forEach((c, cIdx) => { if (cIdx !== bIdx) c.abort() })
              resolve(ws)
            },
            (err) => {
              remaining--
              lastError = err
              if (!settled && remaining <= 0) {
                settled = true
                reject(lastError)
              }
            }
          )
        })
      })
      return winner
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

function cleanUsTenPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : ""
  if (ten.length !== 10) return null
  if (Number(ten.slice(0, 3)) < 200 || Number(ten.slice(3, 6)) < 200) return null
  if (ten.slice(3, 6) === "555" || /^(\d)\1{9}$/.test(ten)) return null
  return `+1${ten}`
}

const EXPLICIT_GOODBYE_RE =
  /\b(es\s+todo|seria\s+todo|eso\s+es\s+todo|ya\s+seria\s+todo|ya\s+es\s+todo|ya\s+estuvo|nada\s+mas|no,?\s*(?:gracias|por\s+ahora|necesito)|adios|bye|hasta\s+luego|nos\s+vemos|cuidate|que\s+tengas|buen\s+dia|buena\s+tarde|buena\s+noche|thats\s+all|that\s+is\s+all|thats\s+it|that\s+is\s+it|nothing\s+else|no,?\s*thank(?:s|\s+you)|(?:im|were)\s+(?:good|fine|all\s+set)|all\s+set|all\s+done|no\s+(?:more|other)\s+questions|have\s+a\s+(?:good|great|nice|wonderful)|goodbye)\b/i

const ACK_ONLY_NO_GOODBYE_RE =
  /^(?:(?:ok(?:ay)?|okey|vale|sale|bien|bueno|esta\s+bien|de\s+acuerdo|muy\s+bien|perfecto|entendido|claro|listo|excelente|genial|va|ya|aha|aja|sip?|yeah?|yep|got\s+it|alright|all\s+right|sounds\s+good|very\s+good|good|nice|cool|fine)(?:[\s,]+(?:muchas\s+)?(?:gracias|thank\s+you|thanks|por\s+favor))?|(?:muchas\s+)?gracias|thank\s+you(?:\s+very\s+much|\s+so\s+much)?|thanks(?:\s+a\s+lot)?)$/i

const OFFERED_FURTHER_HELP_RE =
  /\b(algo\s+mas|ayud(?:o|arte)\s+con\s+algo|otra\s+(?:pregunta|duda)|anything\s+else|help\s+you\s+with\s+anything|other\s+question)\b/i

const BRIDGE_FRUSTRATION_NO_HANGUP_RE =
  /\b(competencia|competitor|otro\s+lado|otro\s+restaurante|otra\s+taqueria|somewhere\s+else|another\s+place|por\s+que\s+me\s+colg(?:aste|aron)|por\s+que\s+(?:me\s+)?cuelgas?|no\s+me\s+cuelgues?|why\s+did\s+you\s+hang\s+up|dont\s+hang\s+up|do\s+not\s+hang\s+up|pesimo|mal\s+servicio|que\s+mal|eso\s+esta\s+mal|terrible|horrible|ridiculo|ridiculous|frustrad[oa]|molest[oa]|enojad[oa]|upset|angry|reclamo|queja|que\s+hago|what\s+do\s+i\s+do|no\s+sirve|no\s+me\s+ayudas?|para\s+ahorita|en\s+media\s+hora)\b/i

const BRIDGE_STRICT_FAREWELL_RE =
  /\b(adios|bye|goodbye|hasta\s+luego|nos\s+vemos|eso\s+es\s+todo(?:\s*,?\s*gracias)?|es\s+todo\s*,?\s*gracias|seria\s+todo(?:\s*,?\s*gracias)?|no\s*,?\s*gracias\s*,?\s*(?:adios|bye|es\s+todo)|thats\s+all\s*,?\s*thank(?:s|\s+you)|that\s+is\s+all\s*,?\s*thank(?:s|\s+you)|thats\s+it\s*,?\s*thank(?:s|\s+you))\b/i

function isBridgeCallerFrustratedWithoutGoodbye(lastUserText: string): boolean {
  const normU = normalizeSearch(lastUserText)
    .replace(/['’`]+/g, "")
    .replace(/[.,!?¿¡"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normU) return false
  if (BRIDGE_STRICT_FAREWELL_RE.test(normU) && !/\b(competencia|competitor|por\s+que\s+me\s+colg|por\s+que\s+cuelgas)\b/i.test(normU)) {
    return false
  }
  return BRIDGE_FRUSTRATION_NO_HANGUP_RE.test(normU)
}

function shouldAllowEndCall(lastUserText: string, prevAssistantText: string): boolean {
  const normU = normalizeSearch(lastUserText)
    .replace(/['’]+/g, "")
    .replace(/[.,!?¿¡"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normU) return false
  if (isBridgeCallerFrustratedWithoutGoodbye(lastUserText)) return false
  if (EXPLICIT_GOODBYE_RE.test(normU)) return true
  const normA = normalizeSearch(prevAssistantText)
  if (/^(?:no|nop|nope|todo\s+bien|ya\s+no|ninguna)$/i.test(normU) && OFFERED_FURTHER_HELP_RE.test(normA)) {
    return true
  }
  if (ACK_ONLY_NO_GOODBYE_RE.test(normU) && !OFFERED_FURTHER_HELP_RE.test(normA)) {
    return false
  }
  return false
}

const BRIDGE_MEANINGFUL_NON_LATIN_SPEECH_RE =
  /(?:안녕하세요|안녕|영업|주문|메뉴|타코|부리또|얼마|감사|잠시만|你好|您好|请问|营业|菜单|点餐|塔可|多少钱|谢谢|等一下|こんにちは|こんばんは|すみません|営業|メニュー|注文|タコス|ブリトー|いくら|ありがとう|ちょっと待って|مرحبا|السلام|مفتوح|قائمة|طلب|تاكو|شكرا|здравствуйте|привет|открыт|меню|заказ|тако|сколько|спасибо|नमस्ते|खुला|मेनू|ऑर्डर|टैको|कितना|धन्यवाद|բարև|բաց|մենյու|պատվեր|տակո|շնորհակալ)/u

const BRIDGE_NON_LATIN_LOANWORD_FOOD_RE =
  /(?:타코|부리또|퀘사디아|호르차타|塔可|卷饼|タコス|ブリトー|ケサディーヤ|تاكو|بوريتو|тако|буррито|टैको|बुरिटो|տակո)/u

/**
 * Filtra transcripciones cortas en alfabeto no latino producidas por ruido vial/motor en llamadas telefónicas
 * (ej. `"क्या से है? यह जो कि है, सब ठीक है, लेकिन"`), evitando que Kore interrumpa diciendo
 * `"la llamada no se escucha claramente"` cuando la conversación transcurre en español o inglés.
 */
const FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE =
  /[\p{Script=Devanagari}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Thai}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Tamil}\p{Script=Telugu}]/u

function hasDisallowedBridgeForeignScript(rawText: string): boolean {
  const s = String(rawText || "").trim()
  return Boolean(s && FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE.test(s))
}

function isBridgeTicketNotFoundAdmission(rawText: string): boolean {
  const norm = normalizeSearch(rawText).replace(/['’`]+/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
  if (!norm) return false
  return /\b(?:sin\s+ticket|no\s+(?:tengo|conservo|encuentro|hallo|traigo|me\s+dieron|salio|veo)\s+(?:el\s+|mi\s+|ningun\s+)?(?:ticket|recibo|comprobante|codigo|numero)|lo\s+(?:tire|perdi|bote)|se\s+(?:me\s+)?perdio|(?:tire|perdi|bote)\s+(?:el\s+|mi\s+)?(?:ticket|recibo)|dont\s+have\s+(?:the\s+|a\s+|my\s+)?(?:receipt|ticket)|no\s+(?:receipt|ticket)|threw\s+(?:it|the\s+receipt|my\s+receipt)\s+away|lost\s+(?:it|the\s+receipt|my\s+receipt)|cant\s+find\s+(?:it|the\s+receipt|my\s+receipt)|couldnt\s+find\s+(?:it|the\s+receipt))\b/i.test(
    norm
  )
}

function isBridgeNonLatinRoadNoise(rawText: string, hasLatinCallerHistory: boolean): boolean {
  const raw = String(rawText || "").trim()
  if (!raw) return false
  if (/[\p{Script=Latin}0-9]/u.test(raw)) return false
  if (!FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE.test(raw)) return false
  if (hasLatinCallerHistory && !BRIDGE_NON_LATIN_LOANWORD_FOOD_RE.test(raw)) {
    return true
  }
  return !BRIDGE_MEANINGFUL_NON_LATIN_SPEECH_RE.test(raw)
}

function normalizeCallbackReasonToSpanish(rawReason: string): string {
  const clean = String(rawReason || "").trim()
  if (!clean) return "Solicita hablar con el gerente en turno."
  if (/^(?:the\s+)?(?:caller|customer)\s+(?:requested|asked|wants?)\s+to\s+speak\s+(?:with|to)\s+(?:the|a)\s+manager\.?$/i.test(clean)) {
    return "Solicita hablar con el gerente en turno."
  }
  if (/^(?:requested|asked)\s+to\s+speak\s+(?:with|to)\s+(?:the|a)\s+manager\.?$/i.test(clean)) {
    return "Solicita hablar con el gerente en turno."
  }
  if (/^(?:speak\s+(?:with|to)\s+(?:the|a)\s+manager|manager\s+callback(?:\s+request)?|callback\s+request|wants\s+manager)\.?$/i.test(clean)) {
    return "Solicita hablar con el gerente en turno."
  }
  return clean
}

const BRIDGE_TOAST_FALLBACK_GUID_BY_ID: Record<number, string> = {
  1: "acf15327-54c8-4da4-8d0d-3ac0544dc422",
  3: "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02",
  4: "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8",
  5: "475bc112-187d-4b9c-884d-1f6a041698ce",
  6: "8685e942-3f07-403a-afb6-faec697cd2cb",
  7: "9625621e-1b5e-48d7-87ae-7094fab5a4fd",
  8: "5fbb58f5-283c-4ea4-9415-04100ee6978b",
  9: "3c2d8251-c43c-43b8-8306-387e0a4ed7c2",
  10: "3a803939-eb13-4def-a1a4-462df8e90623",
  11: "47256ade-2cd4-4073-9632-84567ad9e2c8",
  12: "42ed15a6-106b-466a-9076-1e8f72451f6b",
  13: "a83901db-2431-4283-834e-9502a2ba4b3b",
  14: "80a1ec95-bc73-402e-8884-e5abbe9343e6",
  15: "95866cfc-eeb8-4af9-9586-f78931e1ea04",
  16: "b7f63b01-f089-4ad7-a346-afdb1803dc1a"
}

interface BridgeTicketHit {
  ticketNumber: string
  channel: string
  itemsSummary: string
  statusText?: string
  customerName?: string
  source:
    | "order_ready_announcements"
    | "dt_orders"
    | "delivery_packing_audits"
    | "gavilan_pos_orders"
    | "delivery_platform_orders"
    | "app_orders"
    | "toast_live_api"
}

interface BridgeTicketRange {
  minOrder: number | null
  maxOrder: number | null
  count: number
  businessDate: string
}

let bridgeToastTokenCache: { token: string; expiresAt: number } | null = null
const bridgeDiningMapCache = new Map<string, { expiresAt: number; map: Record<string, string> }>()
const bridgeToastDayCache = new Map<
  string,
  { expiresAt: number; byTicket: Map<string, BridgeTicketHit>; complete: boolean; nextPage: number }
>()
const bridgeValidatedTicketsPerCall = new Map<string, Set<string>>()

function cleanBridgeSpokenTicket(rawInput: string): { isNoTicket: boolean; ticketNumber: string; candidates: string[] } {
  const raw = String(rawInput || "").trim()
  if (!raw) return { isNoTicket: false, ticketNumber: "", candidates: [] }
  const folded = normalizeSearch(raw).replace(/['’`]+/g, "")
  if (
    folded === "sin ticket" ||
    folded === "no ticket" ||
    folded === "none" ||
    folded === "n/a" ||
    /\b(sin\s*(?:el\s*)?(?:ticket|recibo|comprobante)|no\s*(?:tengo|traigo|conservo|guarde|me\s*dieron)\s*(?:el\s*|mi\s*)?(?:ticket|recibo)?|perdi\s*(?:el\s*|mi\s*)?(?:ticket|recibo)|lo\s*(?:tire|perdi)|no\s*ticket|without\s*(?:a\s*|the\s*)?(?:ticket|receipt)|lost\s*(?:my\s*|the\s*)?(?:ticket|receipt))\b/i.test(
      folded
    )
  ) {
    return { isNoTicket: true, ticketNumber: "SIN TICKET", candidates: [] }
  }
  let working = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/[¿?¡!.,;:"'’`]+/g, " ")
    .replace(
      /\b(?:del?\s+d[ií]a\s+de\s+(?:hoy|ayer)|del?\s+(?:hoy|ayer|anoche)|el\s+d[ií]a\s+de\s+(?:hoy|ayer)|from\s+(?:today|yesterday|last\s+night)|(?:de\s+)?(?:hoy|ayer|anoche|ahorita|today|yesterday|tonight|last\s+night))\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim()
  working = working
    .replace(
      /^(?:(?:mi|el|la|my|the|este|ese)\s+)*(?:(?:ticket|recibo|comprobante|orden|order|receipt|check|cheque|folio|c[oó]digo|code|n[uú]mero|numero|number|num|no)\s*(?:de\s+(?:la\s+|mi\s+)?(?:orden|compra|ticket|recibo)\s*)?(?:es|fue|era|ser[ií]a|is|was|el|la|n[uú]mero|numero|number|num|no|#|:|-)*\s*)+/i,
      ""
    )
    .replace(/^(?:es|fue|era|is|was)?\s*(?:el|la|the)?\s*[#:\-]+\s*/i, "")
    .replace(/^(?:el|la|the)\s+(?=[#A-Za-z0-9])/i, "")
    .replace(/^#+/, "")
    .trim()
  const explicitHash = raw.match(/#\s*([A-Za-z0-9][A-Za-z0-9\-]{0,19})/)
  let token = ""
  if (explicitHash && /\d/.test(explicitHash[1])) token = explicitHash[1].trim()
  else if (/^[A-Za-z0-9][A-Za-z0-9\-]{0,19}$/.test(working) && /\d/.test(working)) token = working
  else {
    const matches = Array.from(working.matchAll(/\b([A-Za-z0-9][A-Za-z0-9\-]{0,19})\b/g))
      .map((m) => m[1])
      .filter((t) => /\d/.test(t))
    if (matches.length > 0) token = matches[0]
  }
  if (!token) return { isNoTicket: false, ticketNumber: "", candidates: [] }
  const upper = /^\d+$/.test(token) ? token : token.toUpperCase()
  const set = new Set<string>([upper])
  if (/^\d+$/.test(upper)) set.add(upper.replace(/^0+(?=\d)/, ""))
  else set.add(token.toLowerCase())
  const canonical = /^\d+$/.test(upper) ? upper.replace(/^0+(?=\d)/, "") : upper
  return { isNoTicket: false, ticketNumber: canonical, candidates: Array.from(set) }
}

function shiftBridgeIsoDays(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays)).toISOString().slice(0, 10)
}

function resolveBridgeTicketBusinessDate(purchaseDateText?: string | null, pt = getPacificNow()): string {
  const base = pt.businessDate
  const raw = String(purchaseDateText || "").trim()
  if (!raw) return base
  const iso = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const norm = normalizeSearch(raw)
  const slash = norm.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}|\d{2}))?\b/)
  if (slash) {
    const mm = Number(slash[1])
    const dd = Number(slash[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let yyyy = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : Number(base.slice(0, 4))
      const cand = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      if (!slash[3] && cand > shiftBridgeIsoDays(base, 2)) yyyy -= 1
      return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
    }
  }
  if (/\b(antier|anteayer|day\s+before\s+yesterday|(?:hace\s+)?(?:dos|2)\s+dias|2\s+days\s+ago|two\s+days\s+ago)\b/.test(norm)) {
    return shiftBridgeIsoDays(base, -2)
  }
  if (/\b(ayer|yesterday)\b/.test(norm)) return shiftBridgeIsoDays(base, -1)
  if (/\b(anoche|last\s+night)\b/.test(norm)) return pt.hour < 6 ? base : shiftBridgeIsoDays(base, -1)
  return base
}

function summarizeBridgeItems(rawItems: unknown): string {
  if (!rawItems) return ""
  let arr: any[] = []
  if (Array.isArray(rawItems)) arr = rawItems
  else if (typeof rawItems === "string") {
    const t = rawItems.trim()
    if (t.startsWith("[")) {
      try {
        const p = JSON.parse(t)
        if (Array.isArray(p)) arr = p
      } catch {
        return t.slice(0, 160)
      }
    } else return t.slice(0, 160)
  }
  const parts: string[] = []
  for (const it of arr) {
    if (!it || typeof it !== "object" || it.voided === true) continue
    const name = String(it.displayName || it.name || it.title || "").trim()
    if (!name) continue
    const q = Number(it.quantity ?? 1)
    parts.push(`${Number.isFinite(q) && q > 0 ? q : 1}x ${name}`)
    if (parts.length >= 6) break
  }
  if (parts.length === 0) return ""
  return parts.join(", ") + (arr.length > parts.length ? ` (+${arr.length - parts.length} más)` : "")
}

function friendlyBridgeChannel(raw: string | null | undefined): string {
  const c = String(raw || "").trim()
  if (!c) return "POS Sucursal"
  const u = c.toUpperCase()
  if (u === "FOR_HERE" || u === "DINE_IN") return "Comedor (Dine-In)"
  if (u === "TOGO" || u === "TAKE_OUT" || u === "TAKEOUT") return "Para Llevar (Take-Out)"
  if (u === "DRIVE_THRU" || u === "DRIVETHRU") return "Drive-Thru"
  if (u.includes("UBER")) return "Uber Eats"
  if (u.includes("DOORDASH") || u.includes("DOOR DASH")) return "DoorDash"
  if (u.includes("GRUBHUB")) return "Grubhub"
  if (u.includes("ONLINE")) return "tacosgavilan.com (Online)"
  return c
}

async function getBridgeToastToken(secrets: BridgeSecrets): Promise<string | null> {
  if (bridgeToastTokenCache && Date.now() < bridgeToastTokenCache.expiresAt) {
    return bridgeToastTokenCache.token
  }
  if (!secrets.toastClientId || !secrets.toastClientSecret) return null
  const res = await fetch(`${secrets.toastApiHost}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: secrets.toastClientId,
      clientSecret: secrets.toastClientSecret,
      userAccessType: "TOAST_MACHINE_CLIENT"
    }),
    signal: AbortSignal.timeout(6000)
  })
  if (!res.ok) throw new Error(`Toast auth HTTP ${res.status}`)
  const data = await res.json()
  const tok = String(data?.token?.accessToken || "").trim()
  if (!tok) throw new Error("Empty Toast accessToken")
  bridgeToastTokenCache = { token: tok, expiresAt: Date.now() + 55 * 60_000 }
  return tok
}

async function getBridgeDiningOptionsMap(host: string, token: string, storeGuid: string): Promise<Record<string, string>> {
  const hit = bridgeDiningMapCache.get(storeGuid)
  if (hit && Date.now() < hit.expiresAt) return hit.map
  try {
    const res = await fetch(`${host}/config/v2/diningOptions`, {
      headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": storeGuid },
      signal: AbortSignal.timeout(4500)
    })
    if (!res.ok) return hit?.map || {}
    const arr = await res.json().catch(() => [])
    const map: Record<string, string> = {}
    if (Array.isArray(arr)) {
      for (const o of arr) {
        if (o?.guid && o?.name) map[String(o.guid)] = String(o.name)
      }
    }
    bridgeDiningMapCache.set(storeGuid, { expiresAt: Date.now() + 10 * 60_000, map })
    return map
  } catch {
    return hit?.map || {}
  }
}

const BRIDGE_TOAST_FIELDS =
  "guid,displayNumber,voided,deleted,source,diningOption,checks.voided,checks.deleted,checks.displayNumber,checks.selections.displayName,checks.selections.quantity,checks.selections.voided"

function formatBridgeDeliveryAuditStatus(rawStatus: unknown): string {
  const s = String(rawStatus || "").toUpperCase().trim()
  if (s === "PACKED_AND_SEALED" || s === "READY") return "Lista y sellada esperando entrega"
  if (s === "DELIVERED") return "Ya fue entregada"
  if (s === "MATCHED") return "Empacándose en mostrador"
  if (s === "PENDING_MATCH") return "En preparación en cocina"
  if (s === "UNCLAIMED_2H") return "Lista sin recoger (+2 horas)"
  if (s === "DISPUTED") return "Marcada en revisión"
  return ""
}

function matchBridgeCustomerFuzzy(rowName: unknown, queryCustomer: string): boolean {
  const cr = normalizeSearch(String(rowName || ""))
  const cq = normalizeSearch(queryCustomer)
  if (!cr || !cq || cq.length < 3) return false
  if (cr === cq || cr.includes(cq)) return true
  const tokens = cq.split(/\s+/).filter((t) => t.length >= 3)
  return tokens.length > 0 && tokens.every((t) => cr.includes(t))
}

async function queryBridgeSupabaseTickets(
  storeIdNum: number,
  storeCode: string,
  storeGuid: string,
  businessDate: string,
  canonicalTicket: string,
  candidates: string[],
  customerName?: string | null
): Promise<{ hit: BridgeTicketHit | null; observedRange: BridgeTicketRange | null }> {
  const inListEncoded = candidates.map((c) => encodeURIComponent(c)).join(",")
  const numericCands = candidates.filter((c) => /^\d+$/.test(c))
  const cleanCust = String(customerName || "").trim()
  const recentAuditIso = encodeURIComponent(new Date(Date.now() - 36 * 3600_000).toISOString())
  const oraScopeFilter = storeCode
    ? `or=(store_code.eq.${encodeURIComponent(storeCode)},store_id.eq.${encodeURIComponent(storeGuid)})`
    : `store_id=eq.${encodeURIComponent(storeGuid)}`

  const [oraRows, dtRows, dpaRows, gpoRows, dpoRows, appRows, rangeOraRows, rangeDtRows] = await Promise.all([
    candidates.length > 0
      ? pgSelect(
          `order_ready_announcements?business_date=eq.${businessDate}&order_number=in.(${inListEncoded})&select=store_id,store_code,order_number,dining_option,items_summary&limit=10`
        )
      : Promise.resolve([]),
    candidates.length > 0 && storeGuid
      ? pgSelect(
          `dt_orders?store_id=eq.${encodeURIComponent(storeGuid)}&business_date=eq.${businessDate}&order_number=in.(${inListEncoded})&select=order_number,order_guid,half_hour_slot&limit=5`
        )
      : Promise.resolve([]),
    candidates.length > 0 || cleanCust.length >= 3
      ? pgSelect(
          `delivery_packing_audits?store_id=eq.${storeIdNum}&created_at=gte.${recentAuditIso}&select=toast_display_number,platform,dining_option_name,customer_name,status,courier_order_reference,items_json,quick_checks&order=created_at.desc&limit=90`
        )
      : Promise.resolve([]),
    numericCands.length > 0
      ? pgSelect(
          `gavilan_pos_orders?business_date=eq.${businessDate}&is_voided=eq.false&or=(order_number.in.(${numericCands.join(",")}),client_order_id.ilike.${encodeURIComponent(canonicalTicket)})&select=store_id,store_number,order_number,client_order_id,dining_option,items&limit=10`
        )
      : canonicalTicket
        ? pgSelect(
            `gavilan_pos_orders?business_date=eq.${businessDate}&is_voided=eq.false&client_order_id=ilike.${encodeURIComponent(canonicalTicket)}&select=store_id,store_number,order_number,client_order_id,dining_option,items&limit=5`
          )
        : Promise.resolve([]),
    candidates.length > 0
      ? pgSelect(
          `delivery_platform_orders?store_id=eq.${storeIdNum}&business_date=eq.${businessDate}&or=(toast_display_number.in.(${inListEncoded}),platform_order_id.ilike.${encodeURIComponent(canonicalTicket)})&select=platform,toast_display_number,platform_order_id,toast_dining_option,customer_name,items_summary&limit=5`
        )
      : cleanCust.length >= 3
        ? pgSelect(
            `delivery_platform_orders?store_id=eq.${storeIdNum}&business_date=eq.${businessDate}&customer_name=ilike.*${encodeURIComponent(cleanCust)}*&select=platform,toast_display_number,platform_order_id,toast_dining_option,customer_name,items_summary&limit=5`
          )
        : Promise.resolve([]),
    canonicalTicket.length >= 4
      ? pgSelect(
          `app_orders?store_id=eq.${storeIdNum}&created_at=gte.${recentAuditIso}&select=id,toast_order_guid,pickup_method,status,items_json&order=created_at.desc&limit=40`
        )
      : Promise.resolve([]),
    storeGuid || storeCode
      ? pgSelect(`order_ready_announcements?business_date=eq.${businessDate}&${oraScopeFilter}&select=order_number&limit=1000`)
      : Promise.resolve([]),
    storeGuid
      ? pgSelect(`dt_orders?store_id=eq.${encodeURIComponent(storeGuid)}&business_date=eq.${businessDate}&select=order_number&limit=1000`)
      : Promise.resolve([])
  ])

  const serialNums: number[] = []
  let rawRangeCount = 0
  for (const r of [...rangeOraRows, ...rangeDtRows]) {
    rawRangeCount++
    const rawOrd = String(r?.order_number || "").trim()
    if (/^\d+$/.test(rawOrd)) {
      const n = Number(rawOrd)
      if (n >= 1 && n <= 9999) serialNums.push(n)
    }
  }
  const observedRange: BridgeTicketRange | null =
    rawRangeCount > 0
      ? {
          minOrder: serialNums.length > 0 ? Math.min(...serialNums) : null,
          maxOrder: serialNums.length > 0 ? Math.max(...serialNums) : null,
          count: rawRangeCount,
          businessDate
        }
      : null

  const ora = oraRows.find((r) => {
    const sid = String(r.store_id || "").trim()
    const scode = String(r.store_code || "").trim()
    return (storeCode && (scode === storeCode || sid === storeCode)) || (storeGuid && sid === storeGuid) || sid === String(storeIdNum)
  })
  if (ora) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(ora.order_number || canonicalTicket).trim(),
        channel: friendlyBridgeChannel(ora.dining_option),
        itemsSummary: summarizeBridgeItems(ora.items_summary),
        source: "order_ready_announcements"
      }
    }
  }
  if (dtRows.length > 0) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(dtRows[0].order_number || canonicalTicket).trim(),
        channel: "Drive-Thru",
        itemsSummary: "",
        source: "dt_orders"
      }
    }
  }
  const candUpperSet = new Set(candidates.map((c) => c.toUpperCase()))
  const dpaByNum = dpaRows.find((r) => {
    if (candidates.length === 0) return false
    const disp = String(r.toast_display_number || "").trim().toUpperCase()
    const dispStrip = /^\d+$/.test(disp) ? disp.replace(/^0+(?=\d)/, "") : disp
    const cref = String(r.courier_order_reference || "").trim().toUpperCase()
    const qc = r.quick_checks && typeof r.quick_checks === "object" ? r.quick_checks : {}
    const pk = String(qc.platformOrderKey || "").trim().toUpperCase()
    const sk = String(qc.shortOrderKey || "").trim().toUpperCase()
    return (
      candUpperSet.has(disp) ||
      candUpperSet.has(dispStrip) ||
      (cref.length > 0 && (candUpperSet.has(cref) || candidates.some((c) => c.length >= 4 && cref.includes(c.toUpperCase())))) ||
      (pk.length > 0 && candUpperSet.has(pk)) ||
      (sk.length > 0 && candUpperSet.has(sk))
    )
  })
  const dpa = dpaByNum || (cleanCust.length >= 3 ? dpaRows.find((r) => matchBridgeCustomerFuzzy(r.customer_name, cleanCust)) : undefined)
  if (dpa) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(dpa.toast_display_number || dpa.courier_order_reference || canonicalTicket || "DELIVERY").trim(),
        channel: friendlyBridgeChannel(dpa.dining_option_name || dpa.platform),
        statusText: formatBridgeDeliveryAuditStatus(dpa.status) || undefined,
        customerName: String(dpa.customer_name || "").trim() || undefined,
        itemsSummary: summarizeBridgeItems(dpa.items_json),
        source: "delivery_packing_audits"
      }
    }
  }
  const gpo = gpoRows.find((r) => Number(r.store_number) === storeIdNum || Number(r.store_id) === storeIdNum)
  if (gpo) {
    return {
      observedRange,
      hit: {
        ticketNumber: String(gpo.order_number || gpo.client_order_id || canonicalTicket).trim(),
        channel: friendlyBridgeChannel(gpo.dining_option),
        itemsSummary: summarizeBridgeItems(gpo.items),
        source: "gavilan_pos_orders"
      }
    }
  }
  if (dpoRows.length > 0) {
    const d = dpoRows[0]
    return {
      observedRange,
      hit: {
        ticketNumber: String(d.toast_display_number || d.platform_order_id || canonicalTicket || "DELIVERY").trim(),
        channel: friendlyBridgeChannel(d.toast_dining_option || d.platform),
        customerName: String(d.customer_name || "").trim() || undefined,
        itemsSummary: summarizeBridgeItems(d.items_summary),
        source: "delivery_platform_orders"
      }
    }
  }
  const appMatch = appRows.find((r) => {
    const idStr = String(r.id || "").toUpperCase()
    const guidStr = String(r.toast_order_guid || "").toUpperCase()
    return candidates.some((c) => {
      const u = c.toUpperCase()
      return u.length >= 4 && (idStr.startsWith(u) || idStr.endsWith(u) || guidStr.startsWith(u))
    })
  })
  if (appMatch) {
    return {
      observedRange,
      hit: {
        ticketNumber: canonicalTicket || String(appMatch.id).slice(0, 8).toUpperCase(),
        channel: `tacosgavilan.com / App (${String(appMatch.pickup_method || "pickup")})`,
        statusText: String(appMatch.status || "").trim() || undefined,
        itemsSummary: summarizeBridgeItems(appMatch.items_json),
        source: "app_orders"
      }
    }
  }
  return { hit: null, observedRange }
}

async function queryVercelVerifyOrderFallback(params: {
  storeId: number
  ticketOrOrderNumber: string
  purchaseDateText: string
  customerName: string
}): Promise<Record<string, any> | null> {
  try {
    const secrets = await loadSecrets()
    if (!secrets.publicAppBaseUrl || !secrets.ttsSigningSecret) return null
    const ts = String(Date.now())
    const canonical = `${params.storeId}|${params.ticketOrOrderNumber}|${params.purchaseDateText}|${params.customerName}|${ts}`
    const sig = await hmacSha256Hex(secrets.ttsSigningSecret, canonical)
    const res = await fetch(`${secrets.publicAppBaseUrl}/api/phone/verify-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: params.storeId,
        ticketOrOrderNumber: params.ticketOrOrderNumber,
        purchaseDateText: params.purchaseDateText,
        customerName: params.customerName,
        ts,
        sig
      }),
      signal: AbortSignal.timeout(3800)
    })
    if (!res.ok) return null
    const j = await res.json().catch(() => null)
    return j && typeof j === "object" && j.ok === true ? j : null
  } catch {
    return null
  }
}

async function queryBridgeToastTickets(
  storeGuid: string,
  yyyymmdd: string,
  candidates: string[]
): Promise<{ hit: BridgeTicketHit | null; networkError: boolean }> {
  if (!storeGuid) return { hit: null, networkError: true }
  const cacheKey = `${storeGuid}|${yyyymmdd}`
  let entry = bridgeToastDayCache.get(cacheKey)
  const upperCands = candidates.map((c) => c.toUpperCase())
  const lookupEntry = (e: NonNullable<typeof entry>) => {
    for (const k of upperCands) {
      const h = e.byTicket.get(k)
      if (h) return h
    }
    return null
  }
  if (entry && Date.now() < entry.expiresAt) {
    const h = lookupEntry(entry)
    if (h) return { hit: h, networkError: false }
    if (entry.complete) return { hit: null, networkError: false }
  } else {
    entry = { expiresAt: Date.now() + 45_000, byTicket: new Map(), complete: false, nextPage: 1 }
    bridgeToastDayCache.set(cacheKey, entry)
  }

  try {
    const secrets = await loadSecrets()
    const token = await getBridgeToastToken(secrets)
    if (!token) return { hit: null, networkError: true }
    const diningMap = await getBridgeDiningOptionsMap(secrets.toastApiHost, token, storeGuid)

    let startPage = entry.nextPage
    const deadlineMs = Date.now() + 10_500
    while (startPage <= 24 && Date.now() < deadlineMs) {
      const pages = [startPage]
      const batch = await Promise.all(
        pages.map(async (p) => {
          const url = `${secrets.toastApiHost}/orders/v2/ordersBulk?businessDate=${yyyymmdd}&pageSize=100&page=${p}&fields=${encodeURIComponent(BRIDGE_TOAST_FIELDS)}`
          for (let attempt = 0; attempt < 4; attempt++) {
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": storeGuid },
              signal: AbortSignal.timeout(8000)
            })
            if (res.ok) {
              const j = await res.json()
              return Array.isArray(j) ? j : []
            }
            if ((res.status === 429 || res.status >= 500) && attempt < 3) {
              const retrySec = Number(res.headers.get("retry-after") || "")
              const waitMs = Number.isFinite(retrySec) && retrySec > 0 ? Math.min(4000, retrySec * 1000) : 950 * (attempt + 1)
              await new Promise((r) => setTimeout(r, waitMs))
              continue
            }
            throw new Error(`Toast HTTP ${res.status}`)
          }
          return []
        })
      )
      let reachedEnd = false
      for (const orders of batch) {
        for (const ord of orders) {
          if (!ord || ord.voided === true || ord.deleted === true) continue
          const checks = Array.isArray(ord.checks) ? ord.checks.filter((c: any) => c && c.voided !== true && c.deleted !== true) : []
          if (Array.isArray(ord.checks) && ord.checks.length > 0 && checks.length === 0) continue
          const sels: any[] = []
          for (const chk of checks) {
            if (Array.isArray(chk.selections)) {
              for (const s of chk.selections) if (s && s.voided !== true) sels.push(s)
            }
          }
          const dGuid = ord.diningOption?.guid ? String(ord.diningOption.guid) : ""
          const channel = friendlyBridgeChannel((dGuid && diningMap[dGuid]) || String(ord.source || "POS Sucursal"))
          const itemsSummary = summarizeBridgeItems(sels)
          const reg = (disp: unknown) => {
            const cl = String(disp ?? "").trim()
            if (!cl) return
            const up = cl.toUpperCase()
            const detail: BridgeTicketHit = { ticketNumber: cl, channel, itemsSummary, source: "toast_live_api" }
            if (!entry!.byTicket.has(up)) entry!.byTicket.set(up, detail)
            if (/^\d+$/.test(up)) {
              const st = up.replace(/^0+(?=\d)/, "")
              if (!entry!.byTicket.has(st)) entry!.byTicket.set(st, detail)
            }
          }
          reg(ord.displayNumber)
          for (const chk of checks) reg(chk.displayNumber)
        }
        if (orders.length < 100) reachedEnd = true
      }
      entry.nextPage = startPage + pages.length
      entry.expiresAt = Date.now() + 45_000
      if (reachedEnd) entry.complete = true
      const hit = lookupEntry(entry)
      if (hit) return { hit, networkError: false }
      if (reachedEnd) return { hit: null, networkError: false }
      startPage += pages.length
    }
    return { hit: null, networkError: false }
  } catch {
    return { hit: null, networkError: true }
  }
}

async function validateBridgeOrderTicket(params: {
  targetStore: any
  ticketOrOrderNumber: string
  purchaseDateText?: string | null
  customerName?: string | null
}): Promise<Record<string, any>> {
  const { targetStore, ticketOrOrderNumber, purchaseDateText, customerName } = params
  const pt = getPacificNow()
  const businessDate = resolveBridgeTicketBusinessDate(purchaseDateText, pt)
  const storeIdNum = Number(targetStore?.id || 6)
  const storeNameEs = customerStoreDisplay(targetStore, "es")
  const storeNameEn = customerStoreDisplay(targetStore, "en")
  const storeCode = String(targetStore?.code || "").trim()
  const storeGuid = String(targetStore?.external_id || BRIDGE_TOAST_FALLBACK_GUID_BY_ID[storeIdNum] || "").trim()
  const parsed = cleanBridgeSpokenTicket(ticketOrOrderNumber)
  const cleanCust = String(customerName || "").trim()

  if (parsed.isNoTicket) {
    return { ok: true, skippedNoTicket: true, ticketNumber: "SIN TICKET", businessDate, storeName: storeNameEs, storeNameEn }
  }
  if ((!parsed.ticketNumber || parsed.candidates.length === 0) && cleanCust.length < 3) {
    return {
      ok: true,
      found: false,
      ticketNumber: String(ticketOrOrderNumber || "").trim(),
      businessDate,
      storeName: storeNameEs,
      storeNameEn,
      toastNetworkError: false,
      messageEs: `No se detectó un número de ticket válido para ${storeNameEs}. Pídele verificar el número en la parte superior de su recibo o confirmar si no conserva el ticket ('SIN TICKET').`,
      messageEn: `No valid ticket number was detected for ${storeNameEn}. Ask the caller to check the number at the top of their receipt or confirm if they do not have the ticket ('SIN TICKET').`
    }
  }

  const yyyymmdd = businessDate.replace(/-/g, "")
  const warm = storeGuid ? bridgeToastDayCache.get(`${storeGuid}|${yyyymmdd}`) : undefined
  if (warm && Date.now() < warm.expiresAt && parsed.candidates.length > 0) {
    for (const c of parsed.candidates) {
      const hit = warm.byTicket.get(c.toUpperCase())
      if (hit) {
        return {
          ok: true,
          found: true,
          ticketNumber: hit.ticketNumber,
          businessDate,
          storeName: storeNameEs,
          storeNameEn,
          channel: hit.channel,
          itemsSummary: hit.itemsSummary,
          matchedSource: hit.source,
          toastNetworkError: false,
          messageEs: `El ticket #${hit.ticketNumber} del ${businessDate} en ${storeNameEs} SÍ existe en nuestro sistema (${hit.channel}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirma con amabilidad que ya localizaste su orden y pide solo lo que falte (nombre y teléfono de 10 dígitos) para enviar la alerta al gerente.`,
          messageEn: `Ticket #${hit.ticketNumber} on ${businessDate} at ${storeNameEn} WAS FOUND in our system (${hit.channel}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirm you located their order and ask only for any missing info (name and 10-digit phone number) to send the manager alert.`
        }
      }
    }
  }

  const supaRes = await queryBridgeSupabaseTickets(
    storeIdNum,
    storeCode,
    storeGuid,
    businessDate,
    parsed.ticketNumber,
    parsed.candidates,
    cleanCust || null
  ).catch(() => ({ hit: null, observedRange: null }))

  const buildBridgeHitResponse = (hit: BridgeTicketHit, observedRange: BridgeTicketRange | null) => {
    const statusSuffix = hit.statusText ? ` — Estatus actual: ${hit.statusText}` : ""
    const custSuffix = hit.customerName ? ` a nombre de ${hit.customerName}` : ""
    return {
      ok: true,
      found: true,
      ticketNumber: hit.ticketNumber,
      businessDate,
      storeName: storeNameEs,
      storeNameEn,
      channel: hit.channel || "POS Sucursal",
      statusText: hit.statusText,
      customerName: hit.customerName,
      itemsSummary: hit.itemsSummary || "",
      matchedSource: hit.source,
      observedRange,
      toastNetworkError: false,
      messageEs: `La orden #${hit.ticketNumber}${custSuffix} del ${businessDate} en ${storeNameEs} SÍ existe en nuestro sistema (${hit.channel}${statusSuffix}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirma con claridad este dato real y pide únicamente lo que falte (nombre y teléfono de 10 dígitos si aplica) para el gerente.`,
      messageEn: `Order #${hit.ticketNumber}${hit.customerName ? ` under ${hit.customerName}` : ""} on ${businessDate} at ${storeNameEn} WAS FOUND in our system (${hit.channel}${hit.statusText ? ` — Status: ${hit.statusText}` : ""}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirm these real details clearly and ask only for any missing info.`
    }
  }

  if (supaRes.hit) {
    return buildBridgeHitResponse(supaRes.hit, supaRes.observedRange)
  }

  const toastRes = parsed.candidates.length > 0
    ? await queryBridgeToastTickets(storeGuid, yyyymmdd, parsed.candidates)
    : { hit: null, networkError: false }
  if (toastRes.hit) {
    return buildBridgeHitResponse(toastRes.hit, supaRes.observedRange)
  }

  // Fallback HMAC firmado al servidor Next.js cuando la Edge Function no tenga toastClientId local
  if (toastRes.networkError) {
    const apiFallback = await queryVercelVerifyOrderFallback({
      storeId: storeIdNum,
      ticketOrOrderNumber: parsed.ticketNumber || cleanCust,
      purchaseDateText: businessDate,
      customerName: cleanCust
    })
    if (apiFallback) return apiFallback
  }

  const range = supaRes.observedRange
  const numericAsked = /^\d+$/.test(parsed.ticketNumber) ? Number(parsed.ticketNumber) : null
  const rangeHintEs =
    range && range.minOrder !== null && range.maxOrder !== null
      ? ` (los tickets registrados para el ${businessDate} en esa sucursal van del #${range.minOrder} al #${range.maxOrder})`
      : ""
  const rangeHintEn =
    range && range.minOrder !== null && range.maxOrder !== null
      ? ` (registered tickets on ${businessDate} for that location range from #${range.minOrder} to #${range.maxOrder})`
      : ""
  const clearlyOutOfSyncedRange =
    numericAsked !== null &&
    range !== null &&
    range.count >= 5 &&
    range.minOrder !== null &&
    range.maxOrder !== null &&
    (numericAsked > range.maxOrder + 35 || numericAsked < range.minOrder - 5)

  if (toastRes.networkError && !clearlyOutOfSyncedRange) {
    return {
      ok: true,
      found: false,
      ticketNumber: parsed.ticketNumber || cleanCust,
      businessDate,
      storeName: storeNameEs,
      storeNameEn,
      observedRange: range,
      toastNetworkError: true,
      messageEs: `La verificación en línea del ticket #${parsed.ticketNumber || cleanCust} no está disponible en este instante${rangeHintEs}; toma el nombre y teléfono de 10 dígitos para que el gerente en ${storeNameEs} lo revise directamente.`,
      messageEn: `Live verification for ticket #${parsed.ticketNumber || cleanCust} is momentarily unavailable${rangeHintEn}; collect name and 10-digit phone number so the manager at ${storeNameEn} can check it directly.`
    }
  }
  return {
    ok: true,
    found: false,
    ticketNumber: parsed.ticketNumber || cleanCust,
    businessDate,
    storeName: storeNameEs,
    storeNameEn,
    observedRange: range,
    toastNetworkError: false,
    messageEs: `El ticket #${parsed.ticketNumber || cleanCust} NO existe ni aparece registrado en ${businessDate} en ${storeNameEs}${rangeHintEs}. Informa con amabilidad y claridad al cliente que ese número de ticket no aparece en nuestro sistema para esa fecha/sucursal, y pídele verificar el número impreso en la parte superior de su recibo, confirmar en qué sucursal o fecha compró, o indicar si pidió por Uber Eats/DoorDash.`,
    messageEn: `Ticket #${parsed.ticketNumber || cleanCust} DOES NOT exist and is not registered on ${businessDate} at ${storeNameEn}${rangeHintEn}. Kindly and clearly let the caller know that this ticket number does not appear in our system for that date and location, and ask them to double-check the number printed at the top of their receipt, confirm which location or date they ordered from, or let you know if they ordered through Uber Eats or DoorDash.`
  }
}

async function executeLiveTool(params: {
  toolName: string
  toolArgs: Record<string, any>
  callSid: string
  store: any
  stores: any[]
  config: any
  specialHours: any[]
  menuItems: any[]
  lang: PhoneLang
  callerNumber: string
  recentUserText: string
  lastUserText: string
  prevAssistantText: string
}): Promise<{ response: Record<string, unknown>; shouldEndCall: boolean; hadCallback: boolean }> {
  const {
    toolName,
    toolArgs,
    callSid,
    store,
    stores,
    config,
    specialHours,
    menuItems,
    lang,
    callerNumber,
    recentUserText,
    lastUserText,
    prevAssistantText
  } = params
  const pt = getPacificNow()
  const schedEval = evaluateStoreSchedule(store, specialHours, pt)
  const dispName = customerStoreDisplay(store, lang)

  if (toolName === "end_call") {
    const effectiveLastUser =
      lastUserText.trim() ||
      recentUserText
        .split(" | ")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ||
      ""
    if (effectiveLastUser && isBridgeCallerFrustratedWithoutGoodbye(effectiveLastUser)) {
      return {
        response: {
          ok: false,
          endingCall: false,
          keepAlive: true,
          reason: "caller_frustration_retention_lock",
          instruction:
            "PROHIBIDO COLGAR O DESPEDIRTE: el cliente expresó frustración, queja o dijo 'me voy con la competencia' sin despedirse explícitamente. Retén al cliente con total empatía SIN cortar la llamada: ofrécele pasar directo al mostrador o Drive-Thru para preparar al momento órdenes individuales recién hechas (tacos, burritos, mulitas o platos), O tomar su nombre y teléfono de 10 dígitos con create_manager_callback (urgency: 'high') para que el gerente en turno revise capacidad de cocina de inmediato."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }
    if (!shouldAllowEndCall(effectiveLastUser, prevAssistantText)) {
      return {
        response: {
          ok: false,
          endingCall: false,
          keepAlive: true,
          reason: "caller_ack_only_without_goodbye",
          instruction:
            "NO cuelgues ni digas despedida final: el cliente solo dijo 'okay, gracias' o agradeció brevemente sin despedirse ni decir que es todo. Pregunta amablemente en 1 frase corta si le puedes ayudar con algo más ('¡Con gusto! ¿Te puedo ayudar con algo más?' / 'You are welcome! Is there anything else I can help you with?')."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }
    return {
      response: { ok: true, endingCall: true },
      shouldEndCall: true,
      hadCallback: false
    }
  }

  if (toolName === "validate_order_ticket") {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const targetStore =
      Number.isInteger(reqTargetId) && reqTargetId > 0 ? stores.find((s) => Number(s.id) === reqTargetId) || store : store
    const vRes = await validateBridgeOrderTicket({
      targetStore,
      ticketOrOrderNumber: String(toolArgs?.ticket_or_order_number || ""),
      purchaseDateText: toolArgs?.purchase_date ? String(toolArgs.purchase_date) : null,
      customerName: toolArgs?.customer_name ? String(toolArgs.customer_name) : null
    })
    if (vRes.found && vRes.ticketNumber && callSid) {
      let set = bridgeValidatedTicketsPerCall.get(callSid)
      if (!set) {
        if (bridgeValidatedTicketsPerCall.size > 300) bridgeValidatedTicketsPerCall.clear()
        set = new Set<string>()
        bridgeValidatedTicketsPerCall.set(callSid, set)
      }
      set.add(`${targetStore.id}|${vRes.businessDate}|${String(vRes.ticketNumber).toUpperCase()}`)
    }
    return {
      response: vRes,
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "get_store_hours_and_status") {
    return {
      response: {
        storeName: dispName,
        address: expandStreetAddress(store.address || "", lang),
        phone: store.phone,
        hasDriveThru: Boolean(store.has_drive_thru),
        acceptsEbtInDiningRoomOnly: Boolean(config.accepts_ebt),
        breakfastAvailableUntil: "2:00 PM",
        isBreakfastOpenNow: pt.isBreakfastOpen && schedEval.isOpenNow,
        isOpenNow: schedEval.isOpenNow,
        statusEs: schedEval.statusEs,
        statusEn: schedEval.statusEn,
        weeklyHours: compactWeeklySummary(store.weekly_hours)
      },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "search_menu_item_price") {
    const qNorm = normalizeSearch(String(toolArgs?.query || ""))
    const tokens = qNorm.split(/\s+/).filter((w) => w.length >= 3)
    const scored = menuItems
      .map((m) => {
        const hay = normalizeSearch(`${m.name} ${m.category_name} ${m.description || ""}`)
        let score = hay.includes(qNorm) ? 10 : 0
        for (const tk of tokens) if (hay.includes(tk)) score += 3
        return { m, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ m }) => ({
        name: m.name,
        category: m.category_name,
        priceUsd: `$${Number(m.price).toFixed(2)} USD`,
        description: m.description || ""
      }))

    return {
      response: {
        storeName: dispName,
        currency: "USD",
        matchesFound: scored.length,
        items: scored
      },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "get_fiesta_platter_packages") {
    const guests = Math.max(1, Math.round(Number(toolArgs?.guest_count) || 20))
    const ranges: Record<string, [number, number]> = {
      "15-20": [15, 20],
      "20-25": [20, 25],
      "25-30": [25, 30],
      "30-40": [30, 40]
    }
    const packages = PARTY_TRAYS.map((t) => {
      const found = findPartyTrayMenuItem(menuItems, t.key)
      const priceNum = found && Number.isFinite(Number(found.price)) && Number(found.price) > 0 ? Number(found.price) : null
      const [minG, maxG] = ranges[t.key]
      return {
        key: t.key,
        package: `Fiesta Platter ${t.key}`,
        serves: t.guests,
        minGuests: minG,
        maxGuests: maxG,
        priceNum,
        priceUsd: priceNum !== null ? `$${priceNum.toFixed(2)} USD` : "ver tacosgavilan.com",
        meatLbs: t.meatLbs,
        aguasGallons: t.aguasGal,
        cornDozens: t.cornDoz,
        flourDozens: t.flourDoz
      }
    })
    const allPricesOk = packages.every((p) => p.priceNum !== null)
    let recommendationEs = ""
    let recommendationEn = ""
    if (guests <= 20) {
      const p = packages[0]
      recommendationEs = `Para ${guests} personas conviene 1 paquete de 15 a 20 personas (${p.priceUsd}).`
      recommendationEn = `For ${guests} guests we recommend 1 package for 15 to 20 people (${p.priceUsd}).`
    } else if (guests <= 25) {
      const p = packages[1]
      recommendationEs = `Para ${guests} personas conviene 1 paquete de 20 a 25 personas (${p.priceUsd}).`
      recommendationEn = `For ${guests} guests we recommend 1 package for 20 to 25 people (${p.priceUsd}).`
    } else if (guests <= 30) {
      const p = packages[2]
      recommendationEs = `Para ${guests} personas conviene 1 paquete de 25 a 30 personas (${p.priceUsd}).`
      recommendationEn = `For ${guests} guests we recommend 1 package for 25 to 30 people (${p.priceUsd}).`
    } else if (guests <= 40) {
      const p = packages[3]
      recommendationEs = `Para ${guests} personas conviene 1 paquete de 30 a 40 personas (${p.priceUsd}).`
      recommendationEn = `For ${guests} guests we recommend 1 package for 30 to 40 people (${p.priceUsd}).`
    } else {
      const capped = Math.min(500, guests)
      let best: { counts: number[]; total: number | null; score: number; trays: number; minCap: number; maxCap: number } | null = null
      const max30 = Math.ceil(capped / 40) + 1
      for (let c3 = 0; c3 <= max30; c3++) {
        for (let c2 = 0; c2 <= 3; c2++) {
          for (let c1 = 0; c1 <= 3; c1++) {
            for (let c0 = 0; c0 <= 3; c0++) {
              const trays = c0 + c1 + c2 + c3
              if (trays === 0) continue
              const maxCap = c0 * 20 + c1 * 25 + c2 * 30 + c3 * 40
              if (maxCap < capped) continue
              const minCap = c0 * 15 + c1 * 20 + c2 * 25 + c3 * 30
              const total = allPricesOk
                ? +(
                    c0 * (packages[0].priceNum as number) +
                    c1 * (packages[1].priceNum as number) +
                    c2 * (packages[2].priceNum as number) +
                    c3 * (packages[3].priceNum as number)
                  ).toFixed(2)
                : null
              const score = total !== null ? total : maxCap - capped + trays * 0.25
              if (!best || score < best.score - 0.001 || (Math.abs(score - best.score) < 0.001 && trays < best.trays)) {
                best = { counts: [c0, c1, c2, c3], total, score, trays, minCap, maxCap }
              }
            }
          }
        }
      }
      if (best) {
        const partsEs: string[] = []
        const partsEn: string[] = []
        for (let i = 3; i >= 0; i--) {
          const q = best.counts[i]
          if (q <= 0) continue
          const pr = packages[i].priceNum !== null ? ` ($${(packages[i].priceNum as number).toFixed(2)}${q > 1 ? " c/u" : ""})` : ""
          const prEn = packages[i].priceNum !== null ? ` ($${(packages[i].priceNum as number).toFixed(2)}${q > 1 ? " each" : ""})` : ""
          partsEs.push(`${q} ${q === 1 ? "paquete" : "paquetes"} de ${packages[i].key.replace("-", " a ")} personas${pr}`)
          partsEn.push(`${q} ${packages[i].key.replace("-", " to ")} people ${q === 1 ? "package" : "packages"}${prEn}`)
        }
        const totTail = best.total !== null ? `, total $${best.total.toFixed(2)} USD más impuestos` : ""
        const totTailEn = best.total !== null ? `, total $${best.total.toFixed(2)} USD plus tax` : ""
        recommendationEs = `Para ${capped} personas la combinación más económica es ${partsEs.join(" y ")} (cubre ${best.minCap} a ${best.maxCap} personas${totTail}).`
        recommendationEn = `For ${capped} guests the most cost-effective combination is ${partsEn.join(" and ")} (serves ${best.minCap} to ${best.maxCap} guests${totTailEn}).`
      }
    }
    const walkInEs = store.has_drive_thru ? "al mostrador o al Drive-Thru" : "directamente al mostrador"
    const walkInEn = store.has_drive_thru ? "to the counter or Drive-Thru" : "directly to the counter"
    return {
      response: {
        requestedGuests: guests,
        orderOnlineOnly: "tacosgavilan.com con mínimo 1 hora de anticipación",
        urgentUnderOneHourSolutionsEs: `Si el cliente necesita comida para el grupo en MENOS de 1 hora, NO cierres la venta: ofrécele (1) pasar directo ${walkInEs} para preparar al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, O (2) tomar su nombre y teléfono de 10 dígitos con create_manager_callback (urgency: 'high') para que el gerente en turno revise de inmediato la capacidad de cocina.`,
        urgentUnderOneHourSolutionsEn: `If the caller needs food in LESS than 1 hour, DO NOT turn them away: proactively offer (1) coming straight ${walkInEn} to prepare fresh individual orders of tacos, burritos, mulitas, or plates on the spot, OR (2) taking their name and 10-digit phone number via create_manager_callback (urgency: 'high') so the manager on duty can check kitchen capacity right away.`,
        recommendationEs,
        recommendationEn,
        packages: packages.map(({ package: pkg, serves, priceUsd, meatLbs, aguasGallons, cornDozens, flourDozens }) => ({
          package: pkg,
          serves,
          priceUsd,
          meatLbs,
          aguasGallons,
          cornDozens,
          flourDozens
        }))
      },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "find_other_stores") {
    const fNorm = normalizeSearch(String(toolArgs?.search_city_or_filter || ""))
    const list = stores
      .filter((s) => {
        if (!fNorm || /^(all|todas|todos|sucursales|stores)$/.test(fNorm)) return true
        if (fNorm.includes("drive")) return Boolean(s.has_drive_thru)
        const disp = `${customerStoreDisplay(s, "es")} ${customerStoreDisplay(s, "en")} ${s.address || ""}`
        return normalizeSearch(disp).includes(fNorm)
      })
      .map((s) => {
        const ev = evaluateStoreSchedule(s, specialHours, pt)
        return {
          id: s.id,
          name: customerStoreDisplay(s, lang),
          spokenName: customerStoreSpoken(s, lang),
          address: expandStreetAddress(s.address || "", lang),
          phone: s.phone,
          hasDriveThru: Boolean(s.has_drive_thru),
          acceptsEbtInDiningRoom: ![1, 9].includes(Number(s.id)),
          isOpenNow: ev.isOpenNow,
          hours: compactWeeklySummary(s.weekly_hours),
          status: lang === "en" ? ev.statusEn : ev.statusEs
        }
      })
    return {
      response: { stores: list.length > 0 ? list : stores.map((s) => ({ id: s.id, name: customerStoreDisplay(s, lang) })) },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "flag_unanswered_question") {
    const q = String(toolArgs?.question_text || "").trim().slice(0, 500)
    if (q) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({ unanswered_question: q })
      }).catch(() => null)
    }
    return { response: { ok: true, flaggedQuestion: q }, shouldEndCall: false, hadCallback: false }
  }

  if (toolName === "create_manager_callback") {
    const rawPhone = String(toolArgs?.caller_phone || "").trim()
    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const candidateE164 =
      rawPhone.toUpperCase() === "CALLER_ID" ? cleanUsTenPhone(callerNumber) : cleanUsTenPhone(rawPhone)
    const cleanPhone =
      candidateE164 && !ownTen.has(normalizeDigits10(candidateE164)) ? candidateE164 : null

    if (!cleanPhone) {
      return {
        response: {
          success: false,
          missingCallerPhone: true,
          message: "Pídele amablemente su número telefónico real de 10 dígitos con código de área antes de guardar el recado."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    const callerName = String(toolArgs?.caller_name || "").trim()
    if (!callerName || /^(cliente|customer|caller|unknown|persona)$/i.test(normalizeSearch(callerName))) {
      return {
        response: {
          success: false,
          missingCallerName: true,
          message: "Pídele amablemente su nombre real antes de registrar el recado."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    const validCats = new Set([
      "condiments_note",
      "wrong_store_order",
      "delivery_issue",
      "missing_or_wrong_item",
      "lost_item",
      "employee_callout",
      "vendor_arrival",
      "billing_refund",
      "other"
    ])
    const rawCat = String(toolArgs?.reason_category || "other").trim().toLowerCase()
    const mappedCat =
      rawCat === "wrong_or_missing_order" || rawCat === "wrong_order" || rawCat === "missing_item"
        ? "missing_or_wrong_item"
        : rawCat
    const category = validCats.has(mappedCat) ? mappedCat : "other"
    const rawTicketArg = String(toolArgs?.ticket_or_order_number || "").trim()
    const rawTicket =
      rawTicketArg ||
      (isBridgeTicketNotFoundAdmission(recentUserText) ? "SIN TICKET" : "")
    const rawOrderDate = String(toolArgs?.order_date || "").trim()
    const isDelivery = /\b(uber|doordash|door dash|grubhub|postmates)\b/i.test(
      normalizeSearch(`${recentUserText} ${toolArgs?.reason_summary || ""}`)
    )
    const preTargetId = Number(toolArgs?.target_store_id)
    const preDestStore =
      Number.isInteger(preTargetId) && preTargetId > 0 ? stores.find((s) => Number(s.id) === preTargetId) || store : store
    let ticketValidationTag = ""

    if (category === "missing_or_wrong_item" && !isDelivery) {
      if (!rawTicket || !rawOrderDate) {
        const missing: string[] = []
        if (!rawTicket) missing.push("número de ticket (o confirmación de SIN TICKET)")
        if (!rawOrderDate) missing.push("fecha de compra")
        return {
          response: {
            ok: false,
            success: false,
            missingOrderReviewFields: missing,
            message: `Aún falta preguntar al cliente: ${missing.join(" y ")}. Recuérdale con respeto que sin el número de ticket es poco probable determinar la equivocación.`
          },
          shouldEndCall: false,
          hadCallback: false
        }
      }

      const parsedTk = cleanBridgeSpokenTicket(rawTicket)
      if (!parsedTk.isNoTicket) {
        const vRes = await validateBridgeOrderTicket({
          targetStore: preDestStore,
          ticketOrOrderNumber: rawTicket,
          purchaseDateText: rawOrderDate
        })
        const validatedSet = callSid ? bridgeValidatedTicketsPerCall.get(callSid) : undefined
        const wasAlreadyValid = Boolean(
          validatedSet?.has(`${preDestStore.id}|${vRes.businessDate}|${parsedTk.ticketNumber.toUpperCase()}`)
        )
        if (vRes.found && vRes.ticketNumber) {
          ticketValidationTag = ` [Ticket #${vRes.ticketNumber} validado en POS]`
        } else if (vRes.found === false && !vRes.toastNetworkError && !wasAlreadyValid) {
          return {
            response: {
              ok: false,
              success: false,
              error_code: "ticket_not_found_in_pos",
              ticketNumber: vRes.ticketNumber,
              businessDate: vRes.businessDate,
              storeName: vRes.storeName,
              message: vRes.messageEs,
              messageEs: vRes.messageEs,
              messageEn: vRes.messageEn
            },
            shouldEndCall: false,
            hadCallback: false
          }
        } else if (wasAlreadyValid) {
          ticketValidationTag = ` [Ticket #${parsedTk.ticketNumber} validado en POS]`
        } else if (vRes.found === false) {
          ticketValidationTag = ` [Ticket #${vRes.ticketNumber} pendiente validar en tienda]`
        }
      } else {
        ticketValidationTag = " [SIN TICKET confirmado por cliente]"
      }
    }

    const callRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id&limit=1`)
    const callId = callRows[0]?.id || null

    const targetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isInteger(targetId) && targetId > 0 ? stores.find((s) => Number(s.id) === targetId) || store : store
    const destDisplay = customerStoreDisplay(destStore, lang)

    const ticketFormatted =
      rawTicket && rawOrderDate && !normalizeSearch(rawTicket).includes(normalizeSearch(rawOrderDate))
        ? `${rawTicket} (${rawOrderDate})`
        : rawTicket || (rawOrderDate ? `SIN TICKET (${rawOrderDate})` : null)

    const baseReason = normalizeCallbackReasonToSpanish(String(toolArgs?.reason_summary || "Solicita hablar con el gerente en turno."))
    const taggedReason =
      ticketValidationTag && !baseReason.includes(ticketValidationTag.trim()) ? `${baseReason}${ticketValidationTag}` : baseReason
    const finalSummary =
      Number(destStore.id) !== Number(store.id)
        ? `[Llamó a #${store.id} ${dispName} -> Enrutada a #${destStore.id} ${destDisplay}] ${taggedReason}`
        : taggedReason

    const urgency = category === "condiments_note" ? "normal" : String(toolArgs?.urgency || "high")

    // Verificar si ya existe un recado pendiente para esta misma llamada
    const existingCb = callId
      ? await pgSelect(`phone_callback_requests?call_id=eq.${callId}&status=eq.pending&select=id&limit=1`)
      : []

    if (existingCb.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests?id=eq.${existingCb[0].id}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          caller_name: callerName,
          caller_phone: cleanPhone,
          reason_category: category,
          reason_summary: finalSummary,
          ticket_or_order_number: ticketFormatted,
          urgency
        })
      }).catch(() => null)
    } else {
      const insertBody: Record<string, unknown> = {
        call_id: callId,
        store_id: Number(destStore.id),
        source: "twilio",
        caller_name: callerName,
        caller_phone: cleanPhone,
        caller_type: String(toolArgs?.caller_type || "customer"),
        urgency,
        reason_category: category,
        reason_summary: finalSummary,
        ticket_or_order_number: ticketFormatted,
        status: "pending",
        business_date: pt.businessDate
      }
      if (Number(destStore.id) !== Number(store.id)) {
        insertBody.origin_store_id = Number(store.id)
      }
      await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests`, {
        method: "POST",
        headers: dbHeaders(),
        body: JSON.stringify(insertBody)
      })
    }

    await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
      method: "PATCH",
      headers: dbHeaders(),
      body: JSON.stringify({
        status: "callback_requested",
        resolved_by_ai: false,
        primary_intent: category
      })
    }).catch(() => null)

    return {
      response: {
        success: true,
        routedToStoreName: destDisplay,
        reasonCategory: category,
        storeOpenNow: schedEval.isOpenNow,
        message:
          category === "condiments_note"
            ? `Nota de empaque enviada en vivo a ${destDisplay}; recuérdale que se incluirán si la orden aún no ha salido.`
            : schedEval.isOpenNow
              ? `Alerta prioritaria enviada a la pantalla del gerente de ${destDisplay}; confirma que se comunicarán en cuanto sea posible.`
              : `Recado registrado en ${destDisplay}; como está cerrada ahora, el gerente se comunicará en cuanto abran.`
      },
      shouldEndCall: false,
      hadCallback: true
    }
  }

  return { response: { ok: false, error: "unknown_tool" }, shouldEndCall: false, hadCallback: false }
}

const executeBridgeTool = executeLiveTool

function handleTwilioWebSocket(req: Request): Response {
  const { socket: twilioWs, response } = Deno.upgradeWebSocket(req)

  let resolveSessionDone!: () => void
  const sessionDonePromise = new Promise<void>((r) => {
    resolveSessionDone = r
  })
  EdgeRuntime.waitUntil(sessionDonePromise)

  let streamSid = ""
  let callSid = ""
  let storeId = 6
  let activeLang: PhoneLang = "es"
  let callerNumber = ""
  let authenticated = false
  let startedAtMs = Date.now()

  let geminiWs: WebSocket | null = null
  let geminiReady = false
  let closed = false
  let hadCallback = false
  let pendingEndCall = false
  let turnCounter = 0
  let awaitingHangupMark = ""
  let hangupTimer: ReturnType<typeof setTimeout> | null = null
  let outboundAudioDrainUntilMs = 0

  const inResampler = new StatefulMulaw8kToPcm16k()
  const outResampler = new StatefulPcm24kToMulaw8k()
  const inboundMulawBuf = new Uint8Array(1024)
  const speechBatchBuf = new Uint8Array(16384)
  let speechBatchPos = 0
  let silenceFramesTotal = 0
  let postSpeechSilenceRemaining = 0
  const preReadyPcmQueue: string[] = []

  const transcript: TranscriptEntry[] = []
  let openUserText = ""
  let openUserStartedAtIso = ""
  let openAssistantText = ""
  let openAssistantStartedAtIso = ""
  let hasLatinCallerTurn = false
  let hasGenuineNonLatinCallerTurn = false
  let suppressNoiseReplyTurn = false
  let suppressForeignOutputTurn = false
  let foreignOutputRecoveryCount = 0
  let bridgeData: Awaited<ReturnType<typeof buildBridgeSystemPromptAndData>> | null = null
  let secretsCache: BridgeSecrets | null = null

  const flushOpenUserTurn = () => {
    const clean = openUserText.replace(/\s+/g, " ").trim()
    if (clean) {
      if (isBridgeNonLatinRoadNoise(clean, hasLatinCallerTurn)) {
        openUserText = ""
        openUserStartedAtIso = ""
        return
      }
      if (/[\p{Script=Latin}]{2,}/u.test(clean)) {
        hasLatinCallerTurn = true
      } else if (FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE.test(clean) && BRIDGE_MEANINGFUL_NON_LATIN_SPEECH_RE.test(clean)) {
        hasGenuineNonLatinCallerTurn = true
      }
      transcript.push({ role: "user", text: clean, timestamp: openUserStartedAtIso || new Date().toISOString() })
    }
    openUserText = ""
    openUserStartedAtIso = ""
  }

  const flushOpenAssistantTurn = () => {
    const clean = openAssistantText.replace(/\s+/g, " ").trim()
    if (clean) {
      transcript.push({ role: "assistant", text: clean, timestamp: openAssistantStartedAtIso || new Date().toISOString() })
    }
    openAssistantText = ""
    openAssistantStartedAtIso = ""
  }

  const sendMulawToTwilio = (mulawBytes: Uint8Array) => {
    if (closed || !streamSid || mulawBytes.length === 0 || twilioWs.readyState !== WebSocket.OPEN) return
    const nowMs = Date.now()
    outboundAudioDrainUntilMs = Math.max(outboundAudioDrainUntilMs, nowMs) + Math.ceil(mulawBytes.length / 8)
    const FRAME_SIZE = 1600 // 200 ms a 8 kHz μ-law (reduce 2.5x overhead JSON/Base64 en Edge Runtime sin añadir latencia)
    for (let offset = 0; offset < mulawBytes.length; offset += FRAME_SIZE) {
      const slice = offset === 0 && mulawBytes.length <= FRAME_SIZE
        ? mulawBytes
        : mulawBytes.subarray(offset, Math.min(offset + FRAME_SIZE, mulawBytes.length))
      twilioWs.send(`{"event":"media","streamSid":"${streamSid}","media":{"payload":"${uint8ToBase64(slice)}"}}`)
    }
  }

  const persistCallSnapshot = async (isFinal: boolean) => {
    if (!authenticated || !callSid) return
    flushOpenUserTurn()
    flushOpenAssistantTurn()

    const userTurns = transcript.filter((t) => t.role === "user")
    const assistantTurns = transcript.filter((t) => t.role === "assistant")
    const durationSeconds = Math.min(7200, Math.max(1, Math.round((Date.now() - startedAtMs) / 1000)))
    const lastU = userTurns[userTurns.length - 1]?.text || ""
    const lastA = assistantTurns[assistantTurns.length - 1]?.text || ""
    const summary =
      userTurns.length === 0
        ? "Llamada finalizada durante el saludo inicial (Kore 3.8 Live)."
        : `${lastU.slice(0, 140)} -> ${lastA.slice(0, 180)}`

    if (!isFinal) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          language: activeLang,
          turns_count: userTurns.length,
          summary,
          transcript
        })
      }).catch(() => null)
      return
    }

    const existingRows = await pgSelect(
      `phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,status,unanswered_question,ended_at,duration_seconds&limit=1`
    )
    const existing = existingRows[0]
    const effectiveCb = hadCallback || existing?.status === "callback_requested"
    const nextStatus = effectiveCb
      ? "callback_requested"
      : existing?.status && !["in_progress", "completed"].includes(existing.status)
        ? existing.status
        : "completed"
    const resolvedByAi = userTurns.length > 0 && nextStatus === "completed" && !effectiveCb && !existing?.unanswered_question

    const patch: Record<string, unknown> = {
      language: activeLang,
      status: nextStatus,
      resolved_by_ai: resolvedByAi,
      turns_count: userTurns.length,
      summary,
      transcript,
      ended_at: existing?.ended_at || new Date().toISOString()
    }
    if (!existing?.ended_at || Number(existing?.duration_seconds || 0) === 0) {
      patch.duration_seconds = durationSeconds
    }

    await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
      method: "PATCH",
      headers: dbHeaders(),
      body: JSON.stringify(patch)
    }).catch(() => null)

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/reconcile_phone_call_with_tombstone_atomic`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({ p_call_sid: callSid })
    }).catch(() => null)
  }

  const hangupTwilioCallCleanly = async () => {
    if (closed) return
    closed = true
    if (hangupTimer) {
      clearTimeout(hangupTimer)
      hangupTimer = null
    }
    try {
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, "call_complete")
    } catch {}
    await persistCallSnapshot(true)
    if (secretsCache?.twilioAccountSid && secretsCache?.twilioAuthToken && /^CA[0-9a-f]{32}$/i.test(callSid)) {
      const authBasic = btoa(`${secretsCache.twilioAccountSid}:${secretsCache.twilioAuthToken}`)
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${secretsCache.twilioAccountSid}/Calls/${callSid}.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${authBasic}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: "Status=completed"
        }
      ).catch(() => null)
    }
    try {
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1000, "completed")
    } catch {}
    resolveSessionDone()
  }

  let toolChain = Promise.resolve()

  const getTurnContextBeforeFarewell = () => {
    let lastUserIdx = -1
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].role === "user") {
        lastUserIdx = i
        break
      }
    }
    let prevAssistantText = ""
    if (lastUserIdx > 0) {
      for (let i = lastUserIdx - 1; i >= 0; i--) {
        if (transcript[i].role === "assistant") {
          prevAssistantText = transcript[i].text
          break
        }
      }
    }
    return {
      lastUserText: lastUserIdx >= 0 ? transcript[lastUserIdx].text : "",
      prevAssistantText
    }
  }

  const handleGeminiServerRaw = (gws: WebSocket, raw: string) => {
    if (closed) return
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

      const sc = msg?.serverContent
      if (sc) {
        if (sc.interrupted === true) {
          suppressNoiseReplyTurn = false
          suppressForeignOutputTurn = false
          outResampler.reset()
          outboundAudioDrainUntilMs = 0
          pendingEndCall = false
          awaitingHangupMark = ""
          if (hangupTimer) {
            clearTimeout(hangupTimer)
            hangupTimer = null
          }
          flushOpenAssistantTurn()
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: "clear", streamSid }))
          }
        }

        if (sc.inputTranscription?.text) {
          if (!openUserStartedAtIso) openUserStartedAtIso = new Date().toISOString()
          openUserText += sc.inputTranscription.text
          const trimmedIn = openUserText.replace(/\s+/g, " ").trim()
          if (/[\p{Script=Latin}0-9]/u.test(trimmedIn)) {
            suppressNoiseReplyTurn = false
          } else if (isBridgeNonLatinRoadNoise(trimmedIn, hasLatinCallerTurn)) {
            suppressNoiseReplyTurn = true
          }
        }

        if (sc.outputTranscription?.text) {
          const outChunk = String(sc.outputTranscription.text || "")
          const pendingIn = openUserText.replace(/\s+/g, " ").trim()
          if (pendingIn && isBridgeNonLatinRoadNoise(pendingIn, hasLatinCallerTurn)) {
            suppressNoiseReplyTurn = true
            openUserText = ""
            openUserStartedAtIso = ""
          }
          const pendingHasGenuineNonLatin =
            !hasLatinCallerTurn &&
            Boolean(pendingIn) &&
            FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE.test(pendingIn) &&
            BRIDGE_MEANINGFUL_NON_LATIN_SPEECH_RE.test(pendingIn)
          if (!hasGenuineNonLatinCallerTurn && !pendingHasGenuineNonLatin && hasDisallowedBridgeForeignScript(outChunk)) {
            suppressForeignOutputTurn = true
            openAssistantText = ""
            openAssistantStartedAtIso = ""
            outResampler.reset()
            outboundAudioDrainUntilMs = 0
            if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify({ event: "clear", streamSid }))
            }
          }
          if (suppressNoiseReplyTurn || suppressForeignOutputTurn) {
            openAssistantText = ""
            openAssistantStartedAtIso = ""
          } else {
            if (openUserText.trim()) flushOpenUserTurn()
            if (!openAssistantStartedAtIso) openAssistantStartedAtIso = new Date().toISOString()
            openAssistantText += outChunk
          }
        }

        const parts = sc.modelTurn?.parts
        if (Array.isArray(parts)) {
          const pendingIn = openUserText.replace(/\s+/g, " ").trim()
          if (pendingIn && isBridgeNonLatinRoadNoise(pendingIn, hasLatinCallerTurn)) {
            suppressNoiseReplyTurn = true
            openUserText = ""
            openUserStartedAtIso = ""
          }
          if (suppressNoiseReplyTurn || suppressForeignOutputTurn) {
            outResampler.reset()
          } else {
            for (const p of parts) {
              const b64 = p?.inlineData?.data
              const mime = String(p?.inlineData?.mimeType || "").toLowerCase()
              if (b64 && (!mime || mime.startsWith("audio/pcm"))) {
                const pcm24k = base64ToUint8(b64)
                const mulaw = outResampler.process(pcm24k)
                sendMulawToTwilio(mulaw)
              }
            }
          }
        }

        if (sc.turnComplete === true) {
          if (suppressNoiseReplyTurn || suppressForeignOutputTurn) {
            const wasForeignOut = suppressForeignOutputTurn
            if (wasForeignOut && openUserText.trim() && /[\p{Script=Latin}0-9]/u.test(openUserText)) {
              flushOpenUserTurn()
            }
            suppressNoiseReplyTurn = false
            suppressForeignOutputTurn = false
            outResampler.reset()
            openUserText = ""
            openUserStartedAtIso = ""
            openAssistantText = ""
            openAssistantStartedAtIso = ""
            if (wasForeignOut && foreignOutputRecoveryCount < 3 && gws.readyState === WebSocket.OPEN) {
              foreignOutputRecoveryCount++
              try {
                gws.send(
                  JSON.stringify({
                    clientContent: {
                      turns: [
                        {
                          role: "user",
                          parts: [
                            {
                              text:
                                activeLang === "en"
                                  ? "[SYSTEM RECOVERY: Disallowed non-Latin script blocked. Continue ONLY in natural American English (or Spanish if caller speaks Spanish). Briefly ask how you can help.]"
                                  : "[SYSTEM RECOVERY: Escritura extranjera bloqueada. Responde ÚNICAMENTE en español cálido (o inglés si habla inglés). Continúa amablemente preguntando en qué le ayudas.]"
                            }
                          ]
                        }
                      ],
                      turnComplete: true
                    }
                  })
                )
              } catch {}
            }
            return
          }
          const tail = outResampler.flush()
          if (tail.length > 0) sendMulawToTwilio(tail)

          const lastSpoken = openAssistantText.trim()
          flushOpenUserTurn()
          flushOpenAssistantTurn()

          const markName = `turn_${++turnCounter}`
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }))
          }

          const turnCtx = getTurnContextBeforeFarewell()
          const looksLikeCleanFarewell =
            !lastSpoken.includes("?") &&
            /\b(que tengas un excelente d[ií]a|have a wonderful day|gracias por llamar a tacos gavilan|thank you for calling tacos gavilan)\b/i.test(
              lastSpoken
            ) &&
            shouldAllowEndCall(turnCtx.lastUserText, turnCtx.prevAssistantText)

          if (pendingEndCall || looksLikeCleanFarewell) {
            awaitingHangupMark = markName
            if (hangupTimer) clearTimeout(hangupTimer)
            hangupTimer = setTimeout(() => {
              void hangupTwilioCallCleanly()
            }, 6500)
          } else {
            void persistCallSnapshot(false)
          }
        }
      }

      const fCalls = msg?.toolCall?.functionCalls
      if (Array.isArray(fCalls) && fCalls.length > 0 && bridgeData) {
        flushOpenUserTurn()
        flushOpenAssistantTurn()
        const dataRef = bridgeData
        toolChain = toolChain.then(async () => {
          const functionResponses: any[] = []
          const userTurnsOnly = transcript.filter((t) => t.role === "user")
          const recentUser = userTurnsOnly
            .slice(-4)
            .map((t) => t.text)
            .join(" | ")
          const toolTurnCtx = getTurnContextBeforeFarewell()

          for (const fc of fCalls) {
            const tName = String(fc?.name || "")
            const tArgs = fc?.args && typeof fc.args === "object" ? fc.args : {}
            const execRes = await executeBridgeTool({
              toolName: tName,
              toolArgs: tArgs,
              callSid,
              store: dataRef.store,
              stores: dataRef.stores,
              config: dataRef.config,
              specialHours: dataRef.specialHours,
              menuItems: dataRef.menuItems,
              lang: activeLang,
              callerNumber,
              recentUserText: recentUser,
              lastUserText: toolTurnCtx.lastUserText,
              prevAssistantText: toolTurnCtx.prevAssistantText
            })
            if (execRes.hadCallback) hadCallback = true
            if (execRes.shouldEndCall) pendingEndCall = true

            transcript.push({
              role: "tool",
              toolName: tName,
              text: JSON.stringify(execRes.response),
              timestamp: new Date().toISOString()
            })

            functionResponses.push({
              id: fc.id,
              name: tName,
              response: execRes.response
            })
          }

          if (!closed && gws.readyState === WebSocket.OPEN) {
            gws.send(JSON.stringify({ toolResponse: { functionResponses } }))
          }
        })
      }
  }

  const attachGeminiHandlers = (gws: WebSocket) => {
    gws.onmessage = (ev) => {
      if (closed) return
      if (typeof ev.data === "string") {
        handleGeminiServerRaw(gws, ev.data)
      } else if (ev.data instanceof ArrayBuffer) {
        handleGeminiServerRaw(gws, SHARED_UTF8_DECODER.decode(ev.data))
      } else if (ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then((buf) => {
          if (!closed) handleGeminiServerRaw(gws, SHARED_UTF8_DECODER.decode(buf))
        })
      }
    }

    gws.onclose = () => {
      if (!closed) {
        closed = true
        void persistCallSnapshot(true).finally(() => {
          try {
            if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1000, "upstream_closed")
          } catch {}
          resolveSessionDone()
        })
      }
    }
  }

  const flushSpeechBatchToGemini = () => {
    if (speechBatchPos === 0) return
    const b64 = uint8ToBase64(speechBatchBuf, speechBatchPos)
    speechBatchPos = 0
    if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(`{"realtimeInput":{"audio":{"data":"${b64}","mimeType":"audio/pcm;rate=16000"}}}`)
    } else {
      if (preReadyPcmQueue.length >= 12) preReadyPcmQueue.shift()
      preReadyPcmQueue.push(b64)
    }
  }

  const processInboundMulawView = (mulawView: Uint8Array) => {
    if (mulawView.length === 0) return
    const inPlaybackWindow = Date.now() < outboundAudioDrainUntilMs + 180
    const res = inResampler.processInto(mulawView, { inPlaybackWindow }, speechBatchBuf, speechBatchPos)

    if (res.speechActive && res.writtenBytes > 0) {
      silenceFramesTotal = 0
      postSpeechSilenceRemaining = 8 // 800 ms post-voz enviando cada 100 ms para disparo ágil de Gemini VAD
      if (res.pcmBytes.buffer === speechBatchBuf.buffer) {
        speechBatchPos += res.writtenBytes
        if (speechBatchPos >= 1920) {
          flushSpeechBatchToGemini()
        }
      } else {
        flushSpeechBatchToGemini()
        const b64 = uint8ToBase64(res.pcmBytes, res.writtenBytes)
        if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(`{"realtimeInput":{"audio":{"data":"${b64}","mimeType":"audio/pcm;rate=16000"}}}`)
        } else {
          if (preReadyPcmQueue.length >= 12) preReadyPcmQueue.shift()
          preReadyPcmQueue.push(b64)
        }
      }
      return
    }

    // Al terminar ráfaga de habla, vaciar de inmediato para cero latencia de cierre de turno
    if (speechBatchPos > 0) {
      flushSpeechBatchToGemini()
    }

    if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      silenceFramesTotal++
      if (postSpeechSilenceRemaining > 0) {
        if (silenceFramesTotal >= 5) {
          silenceFramesTotal = 0
          postSpeechSilenceRemaining--
          geminiWs.send(SILENCE_100MS_PCM16_GEMINI_JSON)
        }
      } else if (silenceFramesTotal >= 40) {
        silenceFramesTotal = 0
        geminiWs.send(SILENCE_100MS_PCM16_GEMINI_JSON)
      }
    }
  }

  const handleControlTwilioEvent = async (msg: any) => {
    if (closed) return

    if (msg.event === "start") {
      streamSid = String(msg.start?.streamSid || msg.streamSid || "")
      const cp = msg.start?.customParameters || {}
      callSid = String(cp.callSid || msg.start?.callSid || "").trim()
      storeId = Number(cp.storeId) || 6
      activeLang = cp.lang === "en" ? "en" : "es"
      callerNumber = String(cp.callerNumber || "").trim()
      const ts = Number(cp.ts || 0)
      const sig = String(cp.sig || "").trim()
      startedAtMs = Date.now()

      try {
        secretsCache = await loadSecrets()
        const expectedSig = await hmacSha256Hex(
          secretsCache.twilioAuthToken,
          `${callSid}|${storeId}|${activeLang}|${ts}`
        )
        const freshEnough = Math.abs(Date.now() - ts) <= 15 * 60 * 1000
        if (!freshEnough || !constantTimeEqual(expectedSig, sig)) {
          closed = true
          twilioWs.close(1008, "Invalid stream signature")
          resolveSessionDone()
          return
        }
        authenticated = true

        bridgeData = await getPrewarmedOrBuildBridgeData(storeId, activeLang, callerNumber)
        transcript.push({
          role: "assistant",
          text: bridgeData.greetings.fullGreeting,
          timestamp: new Date().toISOString()
        })

        const setupPayload = {
          model: GEMINI_LIVE_MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
            }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 120,
              silenceDurationMs: 550
            }
          },
          systemInstruction: { parts: [{ text: bridgeData.systemText }] },
          tools: [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }

        // En paralelo: enviar "¿En qué te ayudo hoy?" al instante en cuanto cargue sin esperar a Gemini (~550 ms)
        const promptPromise = fetchMulawPromptClip(
          secretsCache.publicAppBaseUrl,
          secretsCache.ttsSigningSecret,
          bridgeData.greetings.questionOnly,
          activeLang
        ).then((clip) => {
          if (!closed && clip && clip.length > 0 && turnCounter === 0) {
            sendMulawToTwilio(clip)
          }
          return clip
        })

        const connectedGws = await connectGeminiLiveWithHedge(secretsCache.geminiKeys, setupPayload)
        await promptPromise.catch(() => null)

        if (closed) {
          try {
            connectedGws.close()
          } catch {}
          return
        }

        geminiWs = connectedGws
        attachGeminiHandlers(connectedGws)

        // Sembrar el saludo ya dicho para que Kore NO salude dos veces y escuche de inmediato
        connectedGws.send(
          JSON.stringify({
            clientContent: {
              turns: [
                { role: "user", parts: [{ text: "[TELEPHONE LINE CONNECTED]" }] },
                { role: "model", parts: [{ text: bridgeData.greetings.fullGreeting }] }
              ],
              turnComplete: false
            }
          })
        )

        geminiReady = true
        for (const queuedB64 of preReadyPcmQueue) {
          connectedGws.send(
            JSON.stringify({
              realtimeInput: { audio: { data: queuedB64, mimeType: "audio/pcm;rate=16000" } }
            })
          )
        }
        preReadyPcmQueue.length = 0
      } catch (err) {
        // Si fallara la conexión a Gemini Live antes de arrancar, cerrar el Stream sin colgar la llamada Twilio
        // para que <Connect> caiga automáticamente al paracaídas <Gather> clásico de abajo.
        console.error("[phone-live-bridge] Fallback to classic TwiML:", err)
        closed = true
        try {
          if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1011, "fallback_to_gather")
        } catch {}
        resolveSessionDone()
      }
      return
    }

    if (msg.event === "media" && authenticated) {
      if (msg.media?.track && msg.media.track !== "inbound") return
      const payloadB64 = msg.media?.payload
      if (!payloadB64) return
      const n = decodeBase64Into(payloadB64, 0, payloadB64.length, inboundMulawBuf)
      processInboundMulawView(n >= 0 ? inboundMulawBuf.subarray(0, n) : base64ToUint8(payloadB64))
      return
    }

    if (msg.event === "dtmf" && authenticated) {
      const digit = String(msg.dtmf?.digit || "")
      if (digit === "9" && geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        activeLang = activeLang === "en" ? "es" : "en"
        outResampler.reset()
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: "clear", streamSid }))
        }
        const cue =
          activeLang === "en"
            ? "[CALLER PRESSED 9 TO SWITCH TO ENGLISH] Switch to warm American English immediately and say: Of course, we can continue in English! How can I help you today?"
            : "[EL CLIENTE PRESIONÓ 9 PARA ESPAÑOL] Cambia a español de inmediato y di: Con gusto continuamos en español. ¿En qué te ayudo hoy?"
        geminiWs.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: cue }] }],
              turnComplete: true
            }
          })
        )
      }
      return
    }

    if (msg.event === "mark" && authenticated) {
      const mName = String(msg.mark?.name || "")
      if (awaitingHangupMark && mName === awaitingHangupMark) {
        awaitingHangupMark = ""
        if (hangupTimer) {
          clearTimeout(hangupTimer)
          hangupTimer = null
        }
        setTimeout(() => {
          void hangupTwilioCallCleanly()
        }, 250)
      }
      return
    }

    if (msg.event === "stop") {
      if (!closed) {
        closed = true
        if (hangupTimer) {
          clearTimeout(hangupTimer)
          hangupTimer = null
        }
        try {
          if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, "twilio_stop")
        } catch {}
        await persistCallSnapshot(true)
        resolveSessionDone()
      }
    }
  }

  twilioWs.onmessage = (ev) => {
    if (closed) return
    if (typeof ev.data === "string") {
      const raw = ev.data
      // Fast-path sin JSON.parse ni Promises para eventos frecuentes "media" (50×/s)
      if (authenticated && raw.includes('"event":"media"')) {
        const trackIdx = raw.indexOf('"track":"')
        if (trackIdx >= 0 && !raw.startsWith('"inbound"', trackIdx + 8)) return
        const pKey = '"payload":"'
        const pIdx = raw.indexOf(pKey)
        if (pIdx >= 0) {
          const valStart = pIdx + pKey.length
          const valEnd = raw.indexOf('"', valStart)
          if (valEnd > valStart) {
            const n = decodeBase64Into(raw, valStart, valEnd, inboundMulawBuf)
            processInboundMulawView(n >= 0 ? inboundMulawBuf.subarray(0, n) : base64ToUint8(raw.slice(valStart, valEnd)))
            return
          }
        }
      }
      try {
        const msg = JSON.parse(raw)
        void handleControlTwilioEvent(msg)
      } catch {}
      return
    }
    try {
      const raw = SHARED_UTF8_DECODER.decode(ev.data as ArrayBuffer)
      const msg = JSON.parse(raw)
      void handleControlTwilioEvent(msg)
    } catch {}
  }

  twilioWs.onclose = () => {
    if (!closed) {
      closed = true
      if (hangupTimer) {
        clearTimeout(hangupTimer)
        hangupTimer = null
      }
      try {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, "twilio_ws_closed")
      } catch {}
      void persistCallSnapshot(true).finally(() => resolveSessionDone())
    }
  }

  return response
}

Deno.serve(async (req: Request) => {
  const upgrade = (req.headers.get("upgrade") || "").toLowerCase()
  if (upgrade === "websocket") {
    return handleTwilioWebSocket(req)
  }
  if (req.method === "POST") {
    return await handleTwilioHttpPost(req)
  }
  return new Response(
    JSON.stringify({
      ok: true,
      service: "tacos-gavilan-phone-live-bridge",
      version: "v10",
      model: "gemini-3.8-live",
      voice: "Kore",
      region: "us-west-1"
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
})
