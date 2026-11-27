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
 * - v11 (2026-11-21, Fase 26): correcciones fonéticas reales `'pasada'/'hadas'='asada'` y `'Dortmund'/'Door Dash'='DoorDash'`
 *   y tope de 35 reglas aprendidas activas ordenadas `approved` -> `auto_applied`.
 * - v12 (2026-11-22): Identificador de Llamadas real en 3 niveles (directorio interno Tacos Gavilan vía RPC
 *   `resolve_phone_caller_directory`, Twilio CNAM `CallerName` y respaldo Lookup v2 con caché 30 días en
 *   `phone_caller_id_cache`), confirmación rápida por últimos 4 dígitos del Caller ID sin hacer dictar los 10 dígitos,
 *   regla obligatoria de detalle previo y re-invocación de `create_manager_callback` + PATCH con fusión segura sin pérdida,
 *   red de seguridad automática post-recado (traduce y anexa detalles dichos tras el recado) y resúmenes reales en `phone_calls.summary`.
 * - v13 (2026-11-23): relevo transparente de worker (`resume=1` + refresh proactivo de CPU a los 140s sin replay CIPA ni caída a
 *   español en `/api/phone/respond`), DSP optimizado + batching 100ms, VAD ampliado (`silenceDurationMs: 1050` / `postSpeechSilenceRemaining: 14`),
 *   bloqueo bilingüe estricto ES<->EN (cambio inmediato en turno 1 + candado anti-rebote por acento/platillos mexicanos),
 *   alerta roja de sucursal cerrada (anti-falsos positivos con bots de Uber Eats/DoorDash), candado anti-recados vagos en
 *   `missing_or_wrong_item`, fusión limpia sin duplicar `[SIN TICKET]`, auto-resolución si el cliente encuentra su platillo,
 *   filtro ampliado de despedidas ("Eso sería todo. Gracias." -> sin "Ningún detalle adicional") y `PARTY_TRAYS` sincronizados
 *   con Party Tray Guidelines oficiales (`6/7.5/10/12` lbs carne, `3/4/6/10` lbs arroz/frijol, `3/4/5/6` gal agua fresca).
 * - v14 (2026-11-23, Privacy by Design / CCPA-CPRA): el nombre resuelto del directorio interno (`toast_employees`/`users`/lealtad)
 *   y CNAM se conserva exclusivamente para uso interno en `phone_calls.caller_name` (`/admin/llamadas`) y JAMÁS se inyecta en el
 *   system prompt de Kore ni se pronuncia al aire; Kore solo confirma los últimos 4 dígitos del teléfono y siempre pide el nombre de viva voz.
 * - v15 (2026-11-23, Optimización de Costos Gemini 3.8 Live + Caché μ-law): adelgazamiento sin pérdida de `buildBridgeSystemPromptAndData`
 *   (`~70%` menos tokens por turno: menú agrupado por precio/categoría, `phone_knowledge_base` servida en `<1 ms` desde RAM vía
 *   `search_menu_item_price`, directorio compacto de IDs + `find_other_stores` en RAM) y cierre `end_call` de costo cero usando
 *   clip `Kore 3.8` (`8 kHz μ-law`) reciclado desde Supabase Storage (`order-ready-tts/phone_v6/Kore/`) sin re-invocar turno final.
 * - v16 (2026-11-24): nueva herramienta `send_delivery_armor_order_note` para clientes de DoorDash, Uber Eats, Grubhub y
 *   Tacos Gavilan Online que llaman para agregar condimentos gratuitos o modificar sin costo un platillo (taco/burrito/mulita/etc.):
 *   solicita plataforma + nombre en app + código o 1-2 platillos, empareja la orden viva vía `/api/delivery-armor/phone-notes`
 *   (con respaldo directo a `delivery_armor_phone_notes` + Realtime Broadcast) y hace parpadear la orden exacta en la tableta Delivery Armor.
 * - v17 (2026-11-24): contestaciones festivas oficiales pre-grabadas (ES y EN) 100% alineadas carácter por carácter con `lib/holidays.ts`
 *   para las 7 fechas anuales (Thanksgiving cierre 4:00 PM + reapertura viernes 11:00 AM, Black Friday apertura 11:00 AM, Nochebuena 24 dic,
 *   Navidad 25 dic, Fin de Año 31 dic, Año Nuevo 1 ene y Viernes Santo), lookahead de reapertura real en `evaluateStoreSchedule`,
 *   respaldo perpetuo de festivos oficiales si `phone_special_hours` omite una fecha y timeout de `fetchMulawPromptClip` ampliado a `4500 ms`.
 * - v18 (2026-11-24): cobertura 24h completa de audios festivos pre-grabados también en madrugada (1:00–5:59 AM tras cerrar el turno nocturno
 *   previo en Thanksgiving, Nochebuena, Fin de Año y Viernes Santo) y excepción oficial de #6 Los Ángeles (Central y Washington): en los 3 días
 *   de cierre temprano (Thanksgiving, 24 dic y 31 dic), Comedor y Drive-Thru cierran al mismo tiempo a las 4:00 PM.
 * - v19 (2026-11-24): 3 nuevas herramientas operativas conectadas en vivo a la tableta PREPARADOR (`/inventory/preparador`), `/order-ready-board`
 *   y Delivery Armor vía HMAC `/api/delivery-armor/phone-notes`: (1) `request_toast_pickup_time_change`, (2) `coordinate_wrong_store_order`
 *   (alerta dual simultánea a AMBAS sucursales: NO PREPARAR + PREPARAR AQUÍ) y (3) `send_fiesta_platter_prep_alert` (Fiesta Platters a cocineros).
 * - v20 (2026-11-24): regla por estatus de preparación en órdenes delivery — en estatus `IN_KITCHEN` (PREPARACIÓN) permite quitar/modificar
 *   ingredientes del platillo (ej. sin frijol en un burrito) y agregar/editar condimentos gratis (`replace_condiments`); si ya salió de cocina
 *   (`READY` / `PACKED_AND_SEALED`) bloquea modificaciones al platillo (`ALREADY_PREPARED_NO_ITEM_MOD` / `SENT_CONDIMENTS_ONLY_ALREADY_PREPARED`)
 *   y permite únicamente condimentos gratis aparte.
 * - v21 (2026-11-25): soporte oficial de Café de Olla + Café Regular (16 oz todo el día bajo SKU `Coffee`), Burritos mitad y mitad (50%/50% de
 *   2 carnes a `$0.00` extra en Regular, Super, Meat Only y Meat Only Super), opciones sin costo en caja (`Carne Dorada`, `Tortilla Dorada`,
 *   `Partido en Dos`), normalización STT `"fe de la hoya"` -> `"café de olla"`, y `find_other_stores` completo con horarios en fallback.
 * - v22 (2026-11-25): calendario efectivo de los próximos 7 días (`HOY`, `MAÑANA`, `PASADO MAÑANA` + 4 días) y próximos festivos con fechas
 *   exactas y horas 12h AM/PM inyectados en el prompt y en `get_store_hours_and_status` / `find_other_stores` (incluyendo cierre conjunto 4:00 PM
 *   de Comedor y Drive-Thru en #6 en Thanksgiving/24 dic/31 dic y apertura tarde 11:00 AM en Black Friday/1 ene) para que jamás dé horario regular
 *   cuando un cliente pregunta por "mañana" o un día de la semana sin decir el nombre del festivo.
 * - v23 (2026-11-26, Auditoría Forense 249 llamadas): hora actual en 12h AM/PM (jamás 24h '14:33'), ancla anti-deriva UTC al cerrar el día,
 *   estado explícito de #6 Comedor cerrado / solo Drive-Thru en última hora nocturna y madrugada 00:00-05:59 AM, Regla 0 consciente de tienda cerrada
 *   (!isOpenNow) y polaridad neutra en ALERTA ROJA, bloqueo de cambio de platillo con costo en delivery, parseo de meses ES/EN + cero fuga de PII
 *   en validate_order_ticket + búsqueda por nombre en SIN TICKET, teléfono alterno estricto de 10 dígitos sin caer al Caller ID, port de
 *   userExplicitWrongOrderEvidence + FECHA NO RECORDADA, anti-spam en flag_unanswered_question, cierre limpio sin latigazos (todo gracias, happy holidays,
 *   costado, não, one star/yelp en frustración), sanitizador de <speech>{pause} y prefijos Devanagari mixtos, y bloqueo anti-salto a portugués/inglés.
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
  { key: "15-20", guests: "15 a 20 personas", meatLbs: 6, riceLbs: 3, beansLbs: 3, aguasGal: 3, cornDoz: 10, flourDoz: 5 },
  { key: "20-25", guests: "20 a 25 personas", meatLbs: 7.5, riceLbs: 4, beansLbs: 4, aguasGal: 4, cornDoz: 15, flourDoz: 7 },
  { key: "25-30", guests: "25 a 30 personas", meatLbs: 10, riceLbs: 6, beansLbs: 6, aguasGal: 5, cornDoz: 20, flourDoz: 9 },
  { key: "30-40", guests: "30 a 40 personas", meatLbs: 12, riceLbs: 10, beansLbs: 10, aguasGal: 6, cornDoz: 25, flourDoz: 12 }
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

type BridgeOfficialHolidayKey =
  | "new_years_day"
  | "good_friday"
  | "thanksgiving"
  | "day_after_thanksgiving"
  | "christmas_eve"
  | "christmas_day"
  | "new_years_eve"

function addBridgeUtcDays(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + offsetDays)).toISOString().slice(0, 10)
}

function getBridgeOfficialHoliday(dateStr: string): {
  holidayKey: BridgeOfficialHolidayKey
  holidayName: string
  isClosedAllDay: boolean
  openTime: string | null
  closeTime: string | null
} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const year = Number(dateStr.slice(0, 4))
  const mmdd = dateStr.slice(5)
  if (mmdd === "01-01") {
    return { holidayKey: "new_years_day", holidayName: "Año Nuevo / New Year's Day", isClosedAllDay: false, openTime: "11:00", closeTime: null }
  }
  if (mmdd === "12-24") {
    return { holidayKey: "christmas_eve", holidayName: "Nochebuena / Christmas Eve", isClosedAllDay: false, openTime: null, closeTime: "16:00" }
  }
  if (mmdd === "12-25") {
    return { holidayKey: "christmas_day", holidayName: "Navidad / Christmas Day", isClosedAllDay: true, openTime: null, closeTime: null }
  }
  if (mmdd === "12-31") {
    return { holidayKey: "new_years_eve", holidayName: "Fin de Año / New Year's Eve", isClosedAllDay: false, openTime: null, closeTime: "16:00" }
  }
  // Thanksgiving: 4th Thursday of November; Day After Thanksgiving: Friday after
  const nov1Dow = new Date(Date.UTC(year, 10, 1)).getUTCDay()
  const firstThu = 1 + ((4 - nov1Dow + 7) % 7)
  const tgDay = firstThu + 21
  const tgStr = `${year}-11-${String(tgDay).padStart(2, "0")}`
  if (dateStr === tgStr) {
    return { holidayKey: "thanksgiving", holidayName: "Día de Acción de Gracias / Thanksgiving", isClosedAllDay: false, openTime: null, closeTime: "16:00" }
  }
  const bfStr = addBridgeUtcDays(tgStr, 1)
  if (dateStr === bfStr) {
    return { holidayKey: "day_after_thanksgiving", holidayName: "Viernes después de Thanksgiving / Black Friday", isClosedAllDay: false, openTime: "11:00", closeTime: null }
  }
  // Good Friday (Anonymous Gregorian Easter algorithm - 2 days)
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const eMonth = Math.floor((h + l - 7 * m + 114) / 31)
  const eDay = ((h + l - 7 * m + 114) % 31) + 1
  const gfStr = new Date(Date.UTC(year, eMonth - 1, eDay - 2)).toISOString().slice(0, 10)
  if (dateStr === gfStr) {
    return { holidayKey: "good_friday", holidayName: "Viernes Santo / Good Friday", isClosedAllDay: true, openTime: null, closeTime: null }
  }
  return null
}

/**
 * 100% idéntico carácter por carácter a `buildOfficialHolidayClosedGreeting` en `lib/holidays.ts`
 * para reutilizar los mismos WAVs pre-grabados en `order-ready-tts/phone_v6/Kore/`.
 */
function buildBridgeHolidayClosedGreeting(params: {
  holidayKey: BridgeOfficialHolidayKey
  phase: "closed_all_day" | "before_open" | "after_close"
  todayDayEs: string
  todayDayEn: string
  openFmt?: string | null
  closeFmt?: string | null
  nextOpenDayEs?: string | null
  nextOpenDayEn?: string | null
  nextOpenFmt?: string | null
  tomorrowIsClosedHoliday?: boolean
}): { promptEs: string; promptEn: string } {
  const openFmt = params.openFmt || "10:00 AM"
  const closeFmt = params.closeFmt || "4:00 PM"
  const nextOpenFmt = params.nextOpenFmt || "10:00 AM"
  const nextDayEs = (params.nextOpenDayEs || "").toLowerCase()
  const nextDayEn = params.nextOpenDayEn || ""
  const todayEs = (params.todayDayEs || "").toLowerCase()
  const todayEn = params.todayDayEn || ""

  if (params.holidayKey === "thanksgiving") {
    if (params.phase === "before_open") {
      return {
        promptEs: `¡Feliz Día de Acción de Gracias! En este momento nuestra sucursal aún está cerrada; hoy abrimos ${atTimeEsBridge(openFmt)} y cerramos temprano ${atTimeEsBridge(closeFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Happy Thanksgiving! Our location is currently closed; today we open at ${openFmt} and close early at ${closeFmt}. How can I help you today?`
      }
    }
    return {
      promptEs: `¡Feliz Día de Acción de Gracias! En este momento nuestra sucursal ya está cerrada; hoy cerramos temprano ${atTimeEsBridge(closeFmt)} y mañana ${nextDayEs || "viernes"} abrimos ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Happy Thanksgiving! Our location is currently closed; today we closed early at ${closeFmt}, and we reopen tomorrow, ${nextDayEn || "Friday"}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  if (params.holidayKey === "day_after_thanksgiving") {
    if (params.phase === "before_open") {
      return {
        promptEs: `En este momento nuestra sucursal aún está cerrada; hoy ${todayEs || "viernes"} abrimos en horario especial ${atTimeEsBridge(openFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Our location is currently closed; today, ${todayEn || "Friday"}, we open with special hours at ${openFmt}. How can I help you today?`
      }
    }
    return {
      promptEs: `En este momento nuestra sucursal ya está cerrada; hoy cerramos ${atTimeEsBridge(closeFmt)} y mañana ${nextDayEs || "sábado"} abrimos ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Our location is currently closed; we closed today at ${closeFmt}, and we reopen tomorrow, ${nextDayEn || "Saturday"}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  if (params.holidayKey === "christmas_eve") {
    if (params.phase === "before_open") {
      return {
        promptEs: `¡Feliz Nochebuena! En este momento nuestra sucursal aún está cerrada; hoy abrimos ${atTimeEsBridge(openFmt)} y cerramos temprano ${atTimeEsBridge(closeFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Merry Christmas Eve! Our location is currently closed; today we open at ${openFmt} and close early at ${closeFmt}. How can I help you today?`
      }
    }
    if (params.tomorrowIsClosedHoliday) {
      return {
        promptEs: `¡Feliz Nochebuena! En este momento nuestra sucursal ya está cerrada; hoy cerramos temprano ${atTimeEsBridge(closeFmt)}, mañana permanecemos cerrados por Navidad y reanudamos servicio el ${nextDayEs || "sábado"} ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Merry Christmas Eve! Our location is currently closed; today we closed early at ${closeFmt}, we are closed tomorrow for Christmas Day, and we reopen ${nextDayEn || "Saturday"} at ${nextOpenFmt}. How can I help you today?`
      }
    }
    return {
      promptEs: `¡Feliz Nochebuena! En este momento nuestra sucursal ya está cerrada; hoy cerramos temprano ${atTimeEsBridge(closeFmt)} y mañana ${nextDayEs} abrimos ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Merry Christmas Eve! Our location is currently closed; today we closed early at ${closeFmt}, and we reopen tomorrow, ${nextDayEn}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  if (params.holidayKey === "christmas_day") {
    return {
      promptEs: `¡Feliz Navidad! Hoy permanecemos cerrados todo el día por Navidad y reanudamos servicio mañana ${nextDayEs || "sábado"} ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Merry Christmas! We are closed all day today for Christmas Day, and we reopen tomorrow, ${nextDayEn || "Saturday"}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  if (params.holidayKey === "new_years_eve") {
    if (params.phase === "before_open") {
      return {
        promptEs: `En este momento nuestra sucursal aún está cerrada; hoy por Fin de Año abrimos ${atTimeEsBridge(openFmt)} y cerramos temprano ${atTimeEsBridge(closeFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Our location is currently closed; today for New Year's Eve we open at ${openFmt} and close early at ${closeFmt}. How can I help you today?`
      }
    }
    return {
      promptEs: `¡Feliz Año Nuevo! En este momento nuestra sucursal ya está cerrada; hoy por Fin de Año cerramos temprano ${atTimeEsBridge(closeFmt)} y mañana ${nextDayEs || "viernes"} abrimos ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Happy New Year's Eve! Our location is currently closed; today we closed early at ${closeFmt}, and we reopen tomorrow, ${nextDayEn || "Friday"}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  if (params.holidayKey === "new_years_day") {
    if (params.phase === "before_open") {
      return {
        promptEs: `¡Feliz Año Nuevo! En este momento nuestra sucursal aún está cerrada; hoy ${todayEs || "viernes"} abrimos en horario especial ${atTimeEsBridge(openFmt)}. ¿En qué te ayudo hoy?`,
        promptEn: `Happy New Year! Our location is currently closed; today, ${todayEn || "Friday"}, we open with special hours at ${openFmt}. How can I help you today?`
      }
    }
    return {
      promptEs: `¡Feliz Año Nuevo! En este momento nuestra sucursal ya está cerrada; hoy cerramos ${atTimeEsBridge(closeFmt)} y mañana ${nextDayEs} abrimos ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
      promptEn: `Happy New Year! Our location is currently closed; we closed today at ${closeFmt}, and we reopen tomorrow, ${nextDayEn}, at ${nextOpenFmt}. How can I help you today?`
    }
  }

  return {
    promptEs: `En este momento permanecemos cerrados todo el día por Viernes Santo y reanudamos servicio mañana ${nextDayEs || "sábado"} ${atTimeEsBridge(nextOpenFmt)}. ¿En qué te ayudo hoy?`,
    promptEn: `We are closed all day today for Good Friday, and we reopen tomorrow, ${nextDayEn || "Saturday"}, at ${nextOpenFmt}. How can I help you today?`
  }
}

function resolveBridgeDaySchedule(
  storeIdNum: number,
  regular: { open: string; close: string } | undefined,
  dateStr: string,
  specialHours: any[]
): {
  isClosedAllDay: boolean
  open: string
  close: string
  isSpecial: boolean
  holidayName: string | null
  holidayKey: BridgeOfficialHolidayKey | null
} {
  const regOpen = regular?.open || "10:00"
  const regClose = regular?.close || "00:00"
  const regClosed = /^closed$/i.test(regOpen) || /^closed$/i.test(regClose)
  const official = getBridgeOfficialHoliday(dateStr)
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
        holidayName: sp.holiday_name || official?.holidayName || "día festivo",
        holidayKey: official?.holidayKey || null
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
      holidayName: sp.holiday_name || official?.holidayName || null,
      holidayKey: official?.holidayKey || null
    }
  }

  if (official) {
    if (official.isClosedAllDay || regClosed) {
      return {
        isClosedAllDay: true,
        open: "CLOSED",
        close: "CLOSED",
        isSpecial: true,
        holidayName: official.holidayName,
        holidayKey: official.holidayKey
      }
    }
    const effOpen = official.openTime
      ? parseMinBridge(official.openTime) < parseMinBridge(regOpen)
        ? regOpen
        : official.openTime
      : regOpen
    const effClose = official.closeTime || regClose
    return {
      isClosedAllDay: false,
      open: effOpen,
      close: effClose,
      isSpecial: true,
      holidayName: official.holidayName,
      holidayKey: official.holidayKey
    }
  }

  return {
    isClosedAllDay: regClosed,
    open: regOpen,
    close: regClose,
    isSpecial: false,
    holidayName: null,
    holidayKey: null
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

  const findNextOpenBridge = (startOffset: number) => {
    for (let offset = startOffset; offset <= 7; offset++) {
      const dStr = addBridgeUtcDays(pt.dateStr, offset)
      const dow = (pt.dayOfWeek + offset) % 7
      const sched = resolveBridgeDaySchedule(storeIdNum, byDay[dow], dStr, specialHours)
      if (!sched.isClosedAllDay) {
        return {
          offset,
          dow,
          dayEs: BRIDGE_DAY_NAMES_ES[dow],
          dayEn: BRIDGE_DAY_NAMES_EN[dow],
          openFmt: fmt12h(sched.open),
          sched
        }
      }
    }
    return null
  }

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
          const isStore6LastHourDtOnly =
            storeIdNum === 6 &&
            !(prevSched.holidayKey === "thanksgiving" || prevSched.holidayKey === "christmas_eve" || prevSched.holidayKey === "new_years_eve") &&
            closeM - pt.totalMin <= 60
          const drCloseFmt = fmt12h(subtractOneHourBridge(prevSched.close))
          return {
            isOpenNow: true,
            isSpilloverActive: true,
            isStore6DriveThruOnlyNow: isStore6LastHourDtOnly,
            todayCloseFmt: closeFmt,
            statusEs: isStore6LastHourDtOnly
              ? `Abierto ahora SOLO DRIVE-THRU en ${dispEs}: el salón comedor de ${prevDayEs} YA CERRÓ ${atTimeEsBridge(drCloseFmt)}, y únicamente el Drive-Thru permanece abierto hasta ${atTimeEsBridge(closeFmt)} de esta madrugada.`
              : storeIdNum === 6
                ? `Abierto ahora en ${dispEs}: el turno nocturno de ${prevDayEs} cierra esta madrugada (Comedor ${atTimeEsBridge(drCloseFmt)}, Drive-Thru ${atTimeEsBridge(closeFmt)}).`
                : `Abierto ahora en ${dispEs}: el turno nocturno de ${prevDayEs} cierra esta madrugada ${atTimeEsBridge(closeFmt)}.`,
            statusEn: isStore6LastHourDtOnly
              ? `Currently open DRIVE-THRU ONLY at ${dispEn}: our ${prevDayEn} dining room ALREADY CLOSED at ${drCloseFmt}, and ONLY the Drive-Thru remains open until ${closeFmt}.`
              : storeIdNum === 6
                ? `Currently open at ${dispEn}: our ${prevDayEn} late-night shift closes tonight (Dining Room at ${drCloseFmt}, Drive-Thru at ${closeFmt}).`
                : `Currently open at ${dispEn}: our ${prevDayEn} late-night shift closes at ${closeFmt}.`,
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

  // 2. Horario efectivo de hoy (respetando días festivos en phone_special_hours + calendario perpetuo)
  const todaySched = resolveBridgeDaySchedule(storeIdNum, byDay[pt.dayOfWeek], pt.dateStr, specialHours)

  if (todaySched.isClosedAllDay) {
    const hName = todaySched.holidayName || "día festivo"
    const nextOpen = findNextOpenBridge(1)
    const prevTailEs = prevJustClosedInfo ? `Nuestro turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs}; hoy ` : "Hoy "
    const prevTailEn = prevJustClosedInfo ? `Our ${prevDayEn} shift ${prevJustClosedInfo.phraseEn}; today ` : "Today "
    const reopenEs = nextOpen ? ` Reanudamos servicio ${nextOpen.offset === 1 ? `mañana ${nextOpen.dayEs}` : `el ${nextOpen.dayEs}`} ${atTimeEsBridge(nextOpen.openFmt)}.` : ""
    const reopenEn = nextOpen ? ` We reopen ${nextOpen.offset === 1 ? `tomorrow (${nextOpen.dayEn})` : `on ${nextOpen.dayEn}`} at ${nextOpen.openFmt}.` : ""
    const canonicalClosed = todaySched.holidayKey
      ? buildBridgeHolidayClosedGreeting({
            holidayKey: todaySched.holidayKey,
            phase: "closed_all_day",
            todayDayEs,
            todayDayEn,
            nextOpenDayEs: nextOpen?.dayEs || null,
            nextOpenDayEn: nextOpen?.dayEn || null,
            nextOpenFmt: nextOpen?.openFmt || null
          })
        : null
    return {
      isOpenNow: false,
      todayCloseFmt: "CERRADO",
      statusEs: `Cerrado en ${dispEs}: ${prevTailEs}permanecemos cerrados todo el día por ${hName}.${reopenEs}`,
      statusEn: `Closed at ${dispEn}: ${prevTailEn}we are closed all day for ${hName}.${reopenEn}`,
      closedPromptEs: canonicalClosed
        ? canonicalClosed.promptEs
        : prevJustClosedInfo
          ? `En este momento ya cerramos; el turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y hoy permanecemos cerrados por ${hName}. ¿En qué te ayudo hoy?`
          : `En este momento estamos cerrados por ${hName}. ¿En qué te ayudo hoy?`,
      closedPromptEn: canonicalClosed
        ? canonicalClosed.promptEn
        : prevJustClosedInfo
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
    const isJointEarlyClose =
      todaySched.holidayKey === "thanksgiving" ||
      todaySched.holidayKey === "christmas_eve" ||
      todaySched.holidayKey === "new_years_eve" ||
      (todaySched.isSpecial && todaySched.close === "16:00")
    const isStore6DtOnly = storeIdNum === 6 && !isJointEarlyClose && closeEffective - pt.totalMin <= 60
    const drCloseFmt = fmt12h(subtractOneHourBridge(todaySched.close))
    const s6NoteEs =
      storeIdNum === 6
        ? isJointEarlyClose
          ? ` (Comedor y Drive-Thru cierran JUNTOS ${atTimeEsBridge(closeFmt)})`
          : isStore6DtOnly
            ? ` — ATENCIÓN: el Comedor YA CERRÓ ${atTimeEsBridge(drCloseFmt)}; ahorita SOLO Drive-Thru está abierto hasta ${atTimeEsBridge(closeFmt)}`
            : ` (Comedor cierra ${atTimeEsBridge(drCloseFmt)}, Drive-Thru ${atTimeEsBridge(closeFmt)})`
        : ""
    const s6NoteEn =
      storeIdNum === 6
        ? isJointEarlyClose
          ? ` (BOTH Dining Room and Drive-Thru close together at ${closeFmt})`
          : isStore6DtOnly
            ? ` — NOTICE: the Dining Room ALREADY CLOSED at ${drCloseFmt}; ONLY Drive-Thru is open until ${closeFmt}`
            : ` (Dining Room closes at ${drCloseFmt}, Drive-Thru at ${closeFmt})`
        : ""
    return {
      isOpenNow: true,
      isSpilloverActive: false,
      isStore6DriveThruOnlyNow: isStore6DtOnly,
      todayCloseFmt: closeFmt,
      statusEs: todaySched.isSpecial && todaySched.holidayName
        ? `Abierto en este momento en ${dispEs}; hoy ${todayDayEs} (${todaySched.holidayName}) tenemos horario especial de ${openFmt} a ${closeFmt}${s6NoteEs}.`
        : `Abierto en este momento en ${dispEs}; hoy ${todayDayEs} nuestro horario es de ${openFmt} a ${closeFmt}${s6NoteEs}.`,
      statusEn: todaySched.isSpecial && todaySched.holidayName
        ? `Currently open at ${dispEn}; today (${todayDayEn}, ${todaySched.holidayName}) our special holiday hours are ${openFmt} to ${closeFmt}${s6NoteEn}.`
        : `Currently open at ${dispEn}; today's (${todayDayEn}) hours are ${openFmt} to ${closeFmt}${s6NoteEn}.`,
      closedPromptEs: "",
      closedPromptEn: ""
    }
  }

  if (pt.totalMin < openM) {
    if (pt.hour < 6 && prevJustClosedInfo && !todaySched.holidayKey) {
      return {
        isOpenNow: false,
        todayCloseFmt: closeFmt,
        statusEs: `Cerrado en este momento en ${dispEs}: el turno nocturno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y volvemos a abrir hoy ${todayDayEs} ${atTimeEsBridge(openFmt)} (horario de hoy ${todayDayEs}: ${openFmt} a ${closeFmt}).`,
        statusEn: `Currently closed at ${dispEn}: our ${prevDayEn} late-night shift ${prevJustClosedInfo.phraseEn} and we reopen today (${todayDayEn}) at ${openFmt} (today's hours: ${openFmt} to ${closeFmt}).`,
        closedPromptEs: `En este momento ya cerramos; el turno de ${prevDayEs} ${prevJustClosedInfo.phraseEs} y abrimos hoy ${todayDayEs} ${atTimeEsBridge(openFmt)}. ¿En qué te ayudo hoy?`,
        closedPromptEn: `We are currently closed; our ${prevDayEn} shift ${prevJustClosedInfo.phraseEn} and we reopen today at ${openFmt}. How can I help you today?`
      }
    }
    const canonicalBefore = todaySched.holidayKey
      ? buildBridgeHolidayClosedGreeting({
          holidayKey: todaySched.holidayKey,
          phase: "before_open",
          todayDayEs,
          todayDayEn,
          openFmt,
          closeFmt
        })
      : null
    return {
      isOpenNow: false,
      todayCloseFmt: closeFmt,
      statusEs: todaySched.isSpecial && todaySched.holidayName
        ? `Cerrado en este momento en ${dispEs}; hoy ${todayDayEs} (${todaySched.holidayName}) abrimos en horario especial ${atTimeEsBridge(openFmt)} y cerramos ${atTimeEsBridge(closeFmt)}.`
        : `Cerrado en este momento en ${dispEs}; hoy ${todayDayEs} abrimos ${atTimeEsBridge(openFmt)} y cerramos ${atTimeEsBridge(closeFmt)}.`,
      statusEn: todaySched.isSpecial && todaySched.holidayName
        ? `Currently closed at ${dispEn}; today (${todayDayEn}, ${todaySched.holidayName}) we open with special hours at ${openFmt} and close at ${closeFmt}.`
        : `Currently closed at ${dispEn}; today (${todayDayEn}) we open at ${openFmt} and close at ${closeFmt}.`,
      closedPromptEs: canonicalBefore
        ? canonicalBefore.promptEs
        : `En este momento aún estamos cerrados; hoy ${todayDayEs} abrimos ${atTimeEsBridge(openFmt)} y cerramos ${atTimeEsBridge(closeFmt)}. ¿En qué te ayudo hoy?`,
      closedPromptEn: canonicalBefore
        ? canonicalBefore.promptEn
        : `We are currently closed; today we open at ${openFmt} and close at ${closeFmt}. How can I help you today?`
    }
  }

  // Ya cerró por hoy: mirar horario REAL de mañana (+1 día, y +2 si mañana está cerrado todo el día como Navidad)
  const tomorrowDateStr = addBridgeUtcDays(pt.dateStr, 1)
  const tomorrowDow = (pt.dayOfWeek + 1) % 7
  const tomorrowSched = resolveBridgeDaySchedule(storeIdNum, byDay[tomorrowDow], tomorrowDateStr, specialHours)
  const nextOpenAfter = tomorrowSched.isClosedAllDay ? findNextOpenBridge(2) : {
    offset: 1,
    dow: tomorrowDow,
    dayEs: BRIDGE_DAY_NAMES_ES[tomorrowDow],
    dayEn: BRIDGE_DAY_NAMES_EN[tomorrowDow],
    openFmt: fmt12h(tomorrowSched.open),
    sched: tomorrowSched
  }

  const canonicalAfter = todaySched.holidayKey
    ? buildBridgeHolidayClosedGreeting({
        holidayKey: todaySched.holidayKey,
        phase: "after_close",
        todayDayEs,
        todayDayEn,
        closeFmt,
        nextOpenDayEs: nextOpenAfter?.dayEs || null,
        nextOpenDayEn: nextOpenAfter?.dayEn || null,
        nextOpenFmt: nextOpenAfter?.openFmt || null,
        tomorrowIsClosedHoliday: tomorrowSched.isClosedAllDay
      })
    : null

  const statusReopenEs = tomorrowSched.isClosedAllDay
    ? ` Mañana permanecemos cerrados${tomorrowSched.holidayName ? ` por ${tomorrowSched.holidayName}` : ""}${nextOpenAfter ? ` y reanudamos servicio el ${nextOpenAfter.dayEs} ${atTimeEsBridge(nextOpenAfter.openFmt)}` : ""}.`
    : nextOpenAfter
      ? ` Mañana ${nextOpenAfter.dayEs} abrimos ${atTimeEsBridge(nextOpenAfter.openFmt)}.`
      : ""
  const statusReopenEn = tomorrowSched.isClosedAllDay
    ? ` We are closed tomorrow${tomorrowSched.holidayName ? ` for ${tomorrowSched.holidayName}` : ""}${nextOpenAfter ? ` and reopen ${nextOpenAfter.dayEn} at ${nextOpenAfter.openFmt}` : ""}.`
    : nextOpenAfter
      ? ` We reopen tomorrow (${nextOpenAfter.dayEn}) at ${nextOpenAfter.openFmt}.`
      : ""

  return {
    isOpenNow: false,
    todayCloseFmt: closeFmt,
    statusEs: `Cerrado en este momento en ${dispEs}; hoy ${todayDayEs}${todaySched.holidayName ? ` (${todaySched.holidayName})` : ""} cerramos ${atTimeEsBridge(closeFmt)}.${statusReopenEs}`,
    statusEn: `Currently closed at ${dispEn}; today (${todayDayEn}${todaySched.holidayName ? `, ${todaySched.holidayName}` : ""}) we closed at ${closeFmt}.${statusReopenEn}`,
    closedPromptEs: canonicalAfter
      ? canonicalAfter.promptEs
      : `En este momento ya cerramos por hoy (cerramos ${atTimeEsBridge(closeFmt)}).${nextOpenAfter ? ` Mañana ${nextOpenAfter.dayEs} abrimos ${atTimeEsBridge(nextOpenAfter.openFmt)}.` : ""} ¿En qué te ayudo hoy?`,
    closedPromptEn: canonicalAfter
      ? canonicalAfter.promptEn
      : `We are currently closed for the night (closed at ${closeFmt}).${nextOpenAfter ? ` We reopen tomorrow at ${nextOpenAfter.openFmt}.` : ""} How can I help you today?`
  }
}

function subtractOneHourBridge(hhmm: string): string {
  const m = parseMinBridge(hhmm)
  const prev = (m - 60 + 1440) % 1440
  const hh = Math.floor(prev / 60)
  const mm = prev % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

type BridgeResolvedDayInfo = {
  offset: number
  dateStr: string
  dow: number
  dayEs: string
  dayEn: string
  relTagEs: string
  relTagEn: string
  isClosedAllDay: boolean
  isSpecial: boolean
  holidayName: string | null
  holidayKey: BridgeOfficialHolidayKey | null
  openFmt: string
  closeFmt: string
  diningRoomCloseFmt: string
  driveThruCloseFmt: string
  sameCloseAllServices: boolean
  summaryEs: string
  summaryEn: string
}

function buildBridgeResolvedDayInfo(
  storeIdNum: number,
  byDay: Record<number, { open: string; close: string }>,
  dateStr: string,
  dow: number,
  offset: number,
  specialHours: any[]
): BridgeResolvedDayInfo {
  const sched = resolveBridgeDaySchedule(storeIdNum, byDay[dow], dateStr, specialHours)
  const dayEs = BRIDGE_DAY_NAMES_ES[dow]
  const dayEn = BRIDGE_DAY_NAMES_EN[dow]
  const relTagEs = offset === 0 ? "HOY" : offset === 1 ? "MAÑANA" : offset === 2 ? "PASADO MAÑANA" : ""
  const relTagEn = offset === 0 ? "TODAY" : offset === 1 ? "TOMORROW" : offset === 2 ? "DAY AFTER TOMORROW" : ""
  const openFmt = sched.isClosedAllDay ? "CERRADO" : fmt12h(sched.open)
  const closeFmt = sched.isClosedAllDay ? "CERRADO" : fmt12h(sched.close)
  const isStore6 = storeIdNum === 6
  const isJointEarlyCloseHoliday =
    sched.holidayKey === "thanksgiving" ||
    sched.holidayKey === "christmas_eve" ||
    sched.holidayKey === "new_years_eve" ||
    (sched.isSpecial && sched.close === "16:00")
  const sameCloseAllServices = !isStore6 || isJointEarlyCloseHoliday || sched.isClosedAllDay
  const diningRoomCloseFmt = sched.isClosedAllDay
    ? "CERRADO"
    : sameCloseAllServices
      ? closeFmt
      : fmt12h(subtractOneHourBridge(sched.close))
  const driveThruCloseFmt = closeFmt

  let summaryEs = ""
  let summaryEn = ""
  const prefixEs = relTagEs ? `${relTagEs} ${dayEs} ${dateStr}` : `${dayEs} ${dateStr}`
  const prefixEn = relTagEn ? `${relTagEn} ${dayEn} ${dateStr}` : `${dayEn} ${dateStr}`

  if (sched.isClosedAllDay) {
    const hTagEs = sched.holidayName ? ` [FESTIVO: ${sched.holidayName}]` : ""
    const hTagEn = sched.holidayName ? ` [HOLIDAY: ${sched.holidayName}]` : ""
    summaryEs = `${prefixEs}${hTagEs}: CERRADO TODO EL DÍA`
    summaryEn = `${prefixEn}${hTagEn}: CLOSED ALL DAY`
  } else {
    const isEarlyClose = sched.isSpecial && sched.close === "16:00"
    const isLateOpen = sched.isSpecial && sched.open === "11:00" && sched.close !== "16:00"
    const hTagEs = sched.isSpecial && sched.holidayName ? ` [FESTIVO ESPECIAL: ${sched.holidayName}]` : ""
    const hTagEn = sched.isSpecial && sched.holidayName ? ` [SPECIAL HOLIDAY: ${sched.holidayName}]` : ""
    const extraNotesEs: string[] = []
    const extraNotesEn: string[] = []
    if (isEarlyClose) {
      extraNotesEs.push(`CIERRE TEMPRANO ${closeFmt} — NO aplica horario regular`)
      extraNotesEn.push(`EARLY CLOSE ${closeFmt} — regular hours do NOT apply`)
    }
    if (isLateOpen) {
      extraNotesEs.push(`APERTURA TARDE ${openFmt} — NO abren a hora regular`)
      extraNotesEn.push(`LATE OPEN ${openFmt} — NOT regular morning opening`)
    }
    if (isStore6) {
      if (isJointEarlyCloseHoliday) {
        extraNotesEs.push(`Comedor y Drive-Thru cierran JUNTOS a las ${closeFmt}`)
        extraNotesEn.push(`Dining Room & Drive-Thru BOTH close together at ${closeFmt}`)
      } else {
        extraNotesEs.push(`Comedor cierra ${diningRoomCloseFmt}; Drive-Thru cierra ${driveThruCloseFmt}`)
        extraNotesEn.push(`Dining Room closes ${diningRoomCloseFmt}; Drive-Thru closes ${driveThruCloseFmt}`)
      }
    }
    const tailEs = extraNotesEs.length > 0 ? ` (${extraNotesEs.join("; ")})` : ""
    const tailEn = extraNotesEn.length > 0 ? ` (${extraNotesEn.join("; ")})` : ""
    summaryEs = `${prefixEs}${hTagEs}: ${openFmt} a ${closeFmt}${tailEs}`
    summaryEn = `${prefixEn}${hTagEn}: ${openFmt} to ${closeFmt}${tailEn}`
  }

  return {
    offset,
    dateStr,
    dow,
    dayEs,
    dayEn,
    relTagEs,
    relTagEn,
    isClosedAllDay: sched.isClosedAllDay,
    isSpecial: sched.isSpecial,
    holidayName: sched.holidayName,
    holidayKey: sched.holidayKey,
    openFmt,
    closeFmt,
    diningRoomCloseFmt,
    driveThruCloseFmt,
    sameCloseAllServices,
    summaryEs,
    summaryEn
  }
}

function buildBridgeEffectiveNext7Days(store: any, specialHours: any[], pt = getPacificNow()): BridgeResolvedDayInfo[] {
  const byDay = normalizeBridgeWeeklyMap(store?.weekly_hours)
  const storeIdNum = Number(store?.id)
  const out: BridgeResolvedDayInfo[] = []
  for (let offset = 0; offset < 7; offset++) {
    const dateStr = addBridgeUtcDays(pt.dateStr, offset)
    const dow = (pt.dayOfWeek + offset) % 7
    out.push(buildBridgeResolvedDayInfo(storeIdNum, byDay, dateStr, dow, offset, specialHours))
  }
  return out
}

function buildBridgeUpcomingHolidays(
  store: any,
  specialHours: any[],
  pt = getPacificNow(),
  daysAhead = 150
): BridgeResolvedDayInfo[] {
  const byDay = normalizeBridgeWeeklyMap(store?.weekly_hours)
  const storeIdNum = Number(store?.id)
  const out: BridgeResolvedDayInfo[] = []
  const maxDays = Math.max(7, Math.min(365, Math.trunc(daysAhead)))
  for (let offset = 0; offset <= maxDays; offset++) {
    const dateStr = addBridgeUtcDays(pt.dateStr, offset)
    const dow = (pt.dayOfWeek + offset) % 7
    const info = buildBridgeResolvedDayInfo(storeIdNum, byDay, dateStr, dow, offset, specialHours)
    if (info.isSpecial) {
      out.push(info)
    }
  }
  return out
}

function resolveBridgeRequestedDateInfo(
  rawDate: string | null | undefined,
  store: any,
  specialHours: any[],
  pt: ReturnType<typeof getPacificNow>,
  next7Days: BridgeResolvedDayInfo[],
  upcomingHolidays: BridgeResolvedDayInfo[]
): BridgeResolvedDayInfo | null {
  const raw = String(rawDate || "").trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const existing = next7Days.find((d) => d.dateStr === raw)
    if (existing) return existing
    const byDay = normalizeBridgeWeeklyMap(store?.weekly_hours)
    const dt = new Date(`${raw}T12:00:00Z`)
    if (Number.isNaN(dt.getTime())) return null
    const dow = dt.getUTCDay()
    const offset = Math.round((dt.getTime() - new Date(`${pt.dateStr}T12:00:00Z`).getTime()) / 86400000)
    return buildBridgeResolvedDayInfo(Number(store?.id), byDay, raw, dow, offset, specialHours)
  }
  const norm = normalizeSearch(raw)
  if (/^(today|hoy)$/.test(norm)) return next7Days[0] || null
  if (/^(tomorrow|manana)$/.test(norm)) return next7Days[1] || null
  if (/^(day after tomorrow|pasado manana)$/.test(norm)) return next7Days[2] || null

  const weekdayAliases: Array<{ re: RegExp; dow: number }> = [
    { re: /\b(domingo|sunday|sun)\b/, dow: 0 },
    { re: /\b(lunes|monday|mon)\b/, dow: 1 },
    { re: /\b(martes|tuesday|tue)\b/, dow: 2 },
    { re: /\b(miercoles|wednesday|wed)\b/, dow: 3 },
    { re: /\b(jueves|thursday|thu)\b/, dow: 4 },
    { re: /\b(viernes|friday|fri)\b/, dow: 5 },
    { re: /\b(sabado|saturday|sat)\b/, dow: 6 }
  ]
  for (const w of weekdayAliases) {
    if (w.re.test(norm)) {
      return next7Days.find((d) => d.offset >= 1 && d.dow === w.dow) || next7Days.find((d) => d.dow === w.dow) || null
    }
  }

  const holidayKeyAliases: Array<{ re: RegExp; key: BridgeOfficialHolidayKey }> = [
    { re: /\b(black friday|day after thanksgiving|despues de thanksgiving|despues de accion de gracias)\b/, key: "day_after_thanksgiving" },
    { re: /\b(thanksgiving|accion de gracias)\b/, key: "thanksgiving" },
    { re: /\b(christmas eve|nochebuena|24 de dic|dec 24)\b/, key: "christmas_eve" },
    { re: /\b(christmas|navidad|25 de dic|dec 25)\b/, key: "christmas_day" },
    { re: /\b(new year'?s? eve|fin de ano|31 de dic|dec 31)\b/, key: "new_years_eve" },
    { re: /\b(new year|ano nuevo|1 de ene|jan 1)\b/, key: "new_years_day" },
    { re: /\b(good friday|viernes santo)\b/, key: "good_friday" }
  ]
  for (const h of holidayKeyAliases) {
    if (h.re.test(norm)) {
      return upcomingHolidays.find((u) => u.holidayKey === h.key) || null
    }
  }
  return null
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

const BRIDGE_CACHED_FAREWELL_ES = "Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!"
const BRIDGE_CACHED_FAREWELL_EN = "You are very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!"

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
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) })
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


interface BridgeCallerIdentity {
  phoneDigits10: string | null
  phoneE164: string | null
  last4: string | null
  last4Spoken: string | null
  displayName: string | null
  rawCnam: string | null
  source: string | null
  callerType: string
  highConfidenceName: boolean
}

const BRIDGE_US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
])

const BRIDGE_CNAM_GARBAGE = new Set([
  "WIRELESS CALLER", "WIRELESS", "CELL PHONE", "CELLULAR", "CELLULAR CALLER",
  "MOBILE CALLER", "MOBILE", "UNKNOWN", "UNKNOWN CALLER", "UNAVAILABLE",
  "ANONYMOUS", "RESTRICTED", "PRIVATE", "PRIVATE CALLER", "PRIVATE NUMBER",
  "NO CALLER ID", "OUT OF AREA", "TOLL FREE", "TOLL-FREE", "TOLL FREE CALL",
  "PAYPHONE", "PAY PHONE", "SPAM", "SPAM RISK", "SCAM LIKELY", "POTENTIAL SPAM",
  "SUSPECTED SPAM", "TELEMARKETER", "ROBOCALL", "CUSTOMER", "CLIENTE", "CALLER",
  "USER", "USUARIO", "NONE", "N/A", "NA", "NULL", "UNDEFINED", "CALIFORNIA",
  "LOS ANGELES", "HUNTINGTON PARK", "LYNWOOD", "DOWNEY", "COMPTON", "VERNON",
  "BELL", "BELL GARDENS", "SOUTH GATE", "RIALTO", "SANTA ANA", "LONG BEACH",
  "ANAHEIM", "ONTARIO", "FONTANA", "RIVERSIDE", "PASADENA", "INGLEWOOD",
  "HAWTHORNE", "GARDENA", "CARSON", "TORRANCE", "PARAMOUNT", "NORWALK",
  "WHITTIER", "MONTEBELLO", "ALHAMBRA", "EL MONTE", "POMONA", "CORONA",
  "WALNUT PARK", "PICO RIVERA", "MAYWOOD", "CUDAHY", "SAN BERNARDINO",
  "ORANGE COUNTY", "UNITED STATES"
])

const BRIDGE_CNAM_GARBAGE_RE =
  /\b(wireless\s+caller|cell\s+phone|mobile\s+caller|spam\s+risk|scam\s+likely|potential\s+spam|suspected\s+spam|telemarketer|robocall|unavailable|anonymous|restricted|private\s+caller|out\s+of\s+area|toll[\s-]free|no\s+caller\s+id|unknown\s+name)\b/i

const BRIDGE_KEEP_UPPER = new Set(["LLC", "INC", "USA", "US", "TV", "II", "III", "IV"])

function titleCaseBridgeWord(token: string): string {
  const clean = token.trim()
  if (!clean) return ""
  const upper = clean.toUpperCase()
  if (BRIDGE_KEEP_UPPER.has(upper) || clean.length === 1) return upper
  if (/^MC[A-Z]{2,}$/.test(upper)) return "Mc" + upper[2] + upper.slice(3).toLowerCase()
  if (/^O'[A-Z]{2,}$/.test(upper)) return "O'" + upper[2] + upper.slice(3).toLowerCase()
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase()
}

function titleCaseBridgePhrase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split("-").map(titleCaseBridgeWord).join("-"))
    .join(" ")
}

function cleanBridgeCnam(rawName: string | null | undefined, callerType?: string | null): string | null {
  const collapsed = String(rawName || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  if (!collapsed) return null
  if (collapsed.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 2) return null
  if (collapsed.replace(/\D/g, "").length >= 7) return null

  const upper = collapsed.toUpperCase()
  if (BRIDGE_CNAM_GARBAGE.has(upper) || BRIDGE_CNAM_GARBAGE_RE.test(collapsed)) return null

  if (!collapsed.includes(",")) {
    const parts = upper.split(" ").filter(Boolean)
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1]
      const cityPart = parts.slice(0, -1).join(" ")
      if (
        BRIDGE_US_STATE_CODES.has(lastPart) &&
        (BRIDGE_CNAM_GARBAGE.has(cityPart) ||
          parts.length >= 3 ||
          /^(LOS|SAN|SANTA|SOUTH|NORTH|EAST|WEST|NEW|FORT|MOUNT|LAKE|LONG|EL|LA|LAS|BELL|HUNTINGTON|HUNT|DOWNEY|LYNWOOD|COMPTON|VERNON|RIALTO|ONTARIO|FONTANA|CARSON|NORWALK|PASADENA|INGLEWOOD|GARDENA|TORRANCE|WHITTIER|POMONA|CORONA|ANAHEIM|RIVERSIDE)\b/.test(
            cityPart
          ))
      ) {
        return null
      }
    }
  } else {
    const commaParts = upper.split(",").map((p) => p.trim())
    if (commaParts.length === 2 && BRIDGE_US_STATE_CODES.has(commaParts[1]) && BRIDGE_CNAM_GARBAGE.has(commaParts[0])) {
      return null
    }
  }

  const isBusiness = String(callerType || "").toUpperCase() === "BUSINESS"
  if (!isBusiness) {
    const m = collapsed.match(/^([A-Za-zÀ-ÿ'-]{2,})\s*,\s*([A-Za-zÀ-ÿ'-]{2,}(?:\s+[A-Za-zÀ-ÿ'.-]{1,})?)$/)
    if (m) {
      const combined = `${titleCaseBridgePhrase(m[2])} ${titleCaseBridgePhrase(m[1])}`.replace(/\s+/g, " ").trim()
      if (BRIDGE_CNAM_GARBAGE.has(combined.toUpperCase())) return null
      return combined.slice(0, 80)
    }
  }

  const isAllUpper = collapsed === collapsed.toUpperCase() && /[A-Z]/.test(collapsed)
  const isAllLower = collapsed === collapsed.toLowerCase() && /[a-z]/.test(collapsed)
  const formatted = isAllUpper || isAllLower ? titleCaseBridgePhrase(collapsed) : collapsed
  if (BRIDGE_CNAM_GARBAGE.has(formatted.toUpperCase())) return null
  return formatted.slice(0, 80)
}

function formatBridgeLast4Spoken(phone: string | null | undefined): string | null {
  const e164 = cleanUsTenPhone(String(phone || ""))
  if (!e164) return null
  return e164.slice(-4).split("").join("-")
}

async function upsertBridgeCallerIdCache(params: {
  phoneDigits10: string
  phoneE164: string
  rawCnam: string | null
  displayName: string | null
  callerType: string | null
  source: "twilio_cnam" | "twilio_lookup"
}): Promise<void> {
  const now = Date.now()
  await fetch(`${SUPABASE_URL}/rest/v1/phone_caller_id_cache?on_conflict=phone_digits`, {
    method: "POST",
    headers: dbHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({
      phone_digits: params.phoneDigits10,
      phone_e164: params.phoneE164,
      raw_cnam: params.rawCnam,
      display_name: params.displayName,
      caller_type: params.callerType,
      source: params.source,
      looked_up_at: new Date(now).toISOString(),
      expires_at: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  }).catch(() => null)
}

async function lookupBridgeTwilioCnamV2(
  phoneE164: string,
  secrets: BridgeSecrets | null,
  timeoutMs = 700
): Promise<{ rawCnam: string | null; callerType: string | null } | null> {
  if (!secrets?.twilioAccountSid || !secrets?.twilioAuthToken) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(250, timeoutMs))
  try {
    const authBasic = btoa(`${secrets.twilioAccountSid}:${secrets.twilioAuthToken}`)
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneE164)}?Fields=caller_name`,
      { headers: { Authorization: `Basic ${authBasic}` }, signal: ctrl.signal }
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const cn = data?.caller_name
    if (!cn || typeof cn !== "object") return null
    return {
      rawCnam: typeof cn.caller_name === "string" && cn.caller_name.trim() ? cn.caller_name.trim() : null,
      callerType: typeof cn.caller_type === "string" && cn.caller_type.trim() ? cn.caller_type.trim() : null
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveBridgeCallerIdentity(params: {
  phone: string
  rawTwilioCallerName?: string
  secrets?: BridgeSecrets | null
  allowTwilioLookup?: boolean
  blockedTenDigits?: Set<string>
}): Promise<BridgeCallerIdentity> {
  const e164 = cleanUsTenPhone(params.phone)
  const ten = e164 ? e164.slice(2) : null
  if (!e164 || !ten || (params.blockedTenDigits && params.blockedTenDigits.has(ten))) {
    return {
      phoneDigits10: null,
      phoneE164: null,
      last4: null,
      last4Spoken: null,
      displayName: null,
      rawCnam: null,
      source: null,
      callerType: "customer",
      highConfidenceName: false
    }
  }

  const last4 = ten.slice(-4)
  const last4Spoken = last4.split("").join("-")
  const rawWebhookCnam = String(params.rawTwilioCallerName || "").trim() || null
  const cleanedWebhookCnam = rawWebhookCnam ? cleanBridgeCnam(rawWebhookCnam) : null

  if (rawWebhookCnam) {
    void upsertBridgeCallerIdCache({
      phoneDigits10: ten,
      phoneE164: e164,
      rawCnam: rawWebhookCnam,
      displayName: cleanedWebhookCnam,
      callerType: null,
      source: "twilio_cnam"
    })
  }

  // Nivel 1: Directorio interno Tacos Gavilan + historial recurrente + caché CNAM (1 solo RPC < 15 ms)
  let dirRow: any = null
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_phone_caller_directory`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({ p_digits10: ten })
    })
    if (rpcRes.ok) {
      const arr = await rpcRes.json().catch(() => null)
      if (Array.isArray(arr) && arr.length > 0) dirRow = arr[0]
    }
  } catch {
    dirRow = null
  }

  if (dirRow && typeof dirRow.display_name === "string" && dirRow.display_name.trim().length >= 2) {
    const src = String(dirRow.source || "returning_caller")
    return {
      phoneDigits10: ten,
      phoneE164: e164,
      last4,
      last4Spoken,
      displayName: dirRow.display_name.trim(),
      rawCnam: rawWebhookCnam,
      source: src,
      callerType: String(dirRow.caller_type || "customer"),
      highConfidenceName: ["employee", "store", "vendor", "loyalty", "returning_caller"].includes(src)
    }
  }

  // Nivel 2: Twilio Webhook CallerName
  if (cleanedWebhookCnam) {
    return {
      phoneDigits10: ten,
      phoneE164: e164,
      last4,
      last4Spoken,
      displayName: cleanedWebhookCnam,
      rawCnam: rawWebhookCnam,
      source: "twilio_cnam",
      callerType: "customer",
      highConfidenceName: false
    }
  }

  // Nivel 3: Twilio Lookup v2 fallback (solo cuando no hay caché negativa activa)
  if (params.allowTwilioLookup && !rawWebhookCnam && params.secrets) {
    const existingCache = await pgSelect(
      `phone_caller_id_cache?phone_digits=eq.${encodeURIComponent(ten)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=phone_digits&limit=1`
    )
    if (existingCache.length === 0) {
      const looked = await lookupBridgeTwilioCnamV2(e164, params.secrets, 750)
      if (looked) {
        const cleanedLookup = cleanBridgeCnam(looked.rawCnam, looked.callerType)
        await upsertBridgeCallerIdCache({
          phoneDigits10: ten,
          phoneE164: e164,
          rawCnam: looked.rawCnam,
          displayName: cleanedLookup,
          callerType: looked.callerType,
          source: "twilio_lookup"
        })
        if (cleanedLookup) {
          return {
            phoneDigits10: ten,
            phoneE164: e164,
            last4,
            last4Spoken,
            displayName: cleanedLookup,
            rawCnam: looked.rawCnam,
            source: "twilio_lookup",
            callerType: String(looked.callerType || "").toUpperCase() === "BUSINESS" ? "vendor" : "customer",
            highConfidenceName: false
          }
        }
      }
    }
  }

  return {
    phoneDigits10: ten,
    phoneE164: e164,
    last4,
    last4Spoken,
    displayName: null,
    rawCnam: rawWebhookCnam,
    source: null,
    callerType: "customer",
    highConfidenceName: false
  }
}

function isBridgeTrivialAckOrFarewell(text: string): boolean {
  const norm = normalizeSearch(text)
  if (!norm || norm.length <= 2) return true
  if (
    /^(ok|okay|okey|si|yes|yeah|yep|yup|no|nope|nah|gracias|muchas gracias|muchisimas gracias|thank you|thanks|thanks a lot|thank you so much|perfecto|perfect|excelente|entendido|claro|listo|esta bien|all good|sounds good|got it|alright|all right|bye|goodbye|good bye|adios|hasta luego|nos vemos|que tenga buen dia|que tengas buen dia|have a good day|have a good night|have a great day|buenas noches|buenos dias|buenas tardes|hola|hello|hi|hey|eso es todo|eso seria todo|seria todo|es todo|nada mas|eso seria todo gracias|seria todo gracias|no eso seria todo|no seria todo|no gracias eso seria todo|no nada mas|nada mas gracias|ningun detalle adicional|sin detalles adicionales|thats all|that is all|thats it|nothing else|im good|i am good|no gracias|no thank you|no thanks|ok gracias|okay gracias|ok thanks|okay thanks|okay thank you|ok thank you|si gracias|yes thank you|yes thanks|no eso es todo|no thats all|no nothing else|alright bye|okay bye|ok bye|gracias adios|thanks bye|thank you bye|bye bye)$/.test(
      norm
    )
  ) {
    return true
  }
  const words = norm.split(" ").filter(Boolean)
  const fillers = new Set([
    "ok", "okay", "okey", "si", "yes", "yeah", "yep", "yup", "no", "nope", "nah",
    "gracias", "muchas", "muchisimas", "thank", "thanks", "you", "so", "much",
    "bye", "goodbye", "adios", "hasta", "luego", "eso", "es", "seria", "serian",
    "todo", "nada", "mas", "that", "thats", "is", "all", "nothing", "else",
    "perfect", "perfecto", "good", "great", "alright", "right", "fine", "awesome",
    "cool", "bien", "listo", "claro", "entendido", "vale", "sale", "hola", "hello",
    "hi", "hey", "uh", "um", "ah", "ningun", "ninguna", "detalle", "detalles",
    "adicional", "adicionales"
  ])
  return words.length <= 7 && words.every((w) => fillers.has(w))
}

function extractBridgePostCallbackUserTurns(entries: TranscriptEntry[]): string[] {
  let lastCbIdx = -1
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (
      e.role === "tool" &&
      e.toolName === "create_manager_callback" &&
      (e.text.includes('"success":true') || e.text.includes('"success": true'))
    ) {
      lastCbIdx = i
    }
  }
  if (lastCbIdx < 0) return []
  const extras: string[] = []
  for (let i = lastCbIdx + 1; i < entries.length; i++) {
    const e = entries[i]
    if (e.role !== "user") continue
    const txt = String(e.text || "").replace(/\s+/g, " ").trim()
    if (!txt || isBridgeTrivialAckOrFarewell(txt)) continue
    if (txt.replace(/[^A-Za-zÀ-ÿ0-9]/g, "").length < 3) continue
    extras.push(txt)
  }
  return extras
}

const BRIDGE_INTENT_SUMMARY_ES: Record<string, string> = {
  hours_location: "Horario / Ubicación",
  menu_prices: "Menú / Precios",
  breakfast_hours: "Desayunos",
  payment_ebt: "Pago / EBT",
  catering_platter: "Charolas Fiesta Platter",
  delivery_issue: "Orden Delivery",
  condiments_note: "Nota de Empaque",
  complaint_missing_item: "Reclamo de Orden",
  missing_or_wrong_item: "Reclamo de Orden",
  wrong_store_order: "Sucursal Equivocada",
  lost_item: "Objeto Olvidado",
  employee_callout: "Aviso de Empleado",
  vendor_arrival: "Proveedor",
  billing_refund: "Cobro / Reembolso",
  manager_callback: "Recado al Gerente",
  unanswered_inquiry: "Consulta Pendiente"
}

function buildBridgeMeaningfulSummary(params: {
  transcript: TranscriptEntry[]
  callbackSummary?: string | null
  callbackCallerName?: string | null
  callbackTicket?: string | null
  primaryIntent?: string | null
  unansweredQuestion?: string | null
}): string {
  const entries = params.transcript
  const userTurns = entries.filter((t) => t.role === "user" && String(t.text || "").trim().length > 0)
  if (userTurns.length === 0) {
    return "Llamada finalizada durante el saludo inicial (Kore 3.8 Live)."
  }

  const cbSummary = String(params.callbackSummary || "").replace(/\s+/g, " ").trim()
  if (cbSummary) {
    const who = String(params.callbackCallerName || "").trim()
    const tk = String(params.callbackTicket || "").trim()
    const prefix = who ? `Recado (${who}): ` : "Recado al gerente: "
    const suffix = tk && !cbSummary.toLowerCase().includes(tk.toLowerCase()) ? ` [${tk}]` : ""
    return `${prefix}${cbSummary}${suffix}`.slice(0, 320)
  }

  const unanswered = String(params.unansweredQuestion || "").replace(/\s+/g, " ").trim()
  if (unanswered) {
    return `Consulta pendiente: ${unanswered}`.slice(0, 320)
  }

  const substantive: Array<{ idx: number; text: string }> = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.role !== "user") continue
    const txt = String(e.text || "").replace(/\s+/g, " ").trim()
    if (!txt || isBridgeTrivialAckOrFarewell(txt)) continue
    if (/^[\d\s.]{1,12}$/.test(normalizeSearch(txt))) continue
    substantive.push({ idx: i, text: txt })
  }

  const intentKey = String(params.primaryIntent || "").trim().toLowerCase()
  const intentPrefix = BRIDGE_INTENT_SUMMARY_ES[intentKey] ? `${BRIDGE_INTENT_SUMMARY_ES[intentKey]}: ` : ""

  if (substantive.length === 0) {
    const firstU = userTurns[0].text.replace(/\s+/g, " ").trim()
    const assistantTurns = entries.filter((t) => t.role === "assistant" && String(t.text || "").trim().length > 0)
    const lastA = assistantTurns[assistantTurns.length - 1]?.text?.replace(/\s+/g, " ").trim() || ""
    return `${intentPrefix}${firstU.slice(0, 120)}${lastA ? ` -> ${lastA.slice(0, 140)}` : ""}`.slice(0, 320)
  }

  const primary = substantive[0]
  let topic = primary.text
  if (substantive.length > 1 && topic.length < 90) {
    const extras: string[] = []
    for (const s of substantive.slice(1)) {
      if (s.text.length < 4 || topic.toLowerCase().includes(s.text.toLowerCase())) continue
      extras.push(s.text)
      if (extras.length >= 2) break
    }
    if (extras.length > 0) topic = `${topic} / ${extras.join(" / ")}`
  }

  let matchedReply = ""
  for (let j = primary.idx + 1; j < entries.length; j++) {
    if (entries[j].role === "assistant" && String(entries[j].text || "").trim()) {
      matchedReply = String(entries[j].text).replace(/\s+/g, " ").trim()
      break
    }
    if (entries[j].role === "user") break
  }

  return `${intentPrefix}${topic.slice(0, 145)}${matchedReply ? ` -> ${matchedReply.slice(0, 150)}` : ""}`.slice(0, 320)
}

const BRIDGE_ORDER_ITEM_NOUN_RE =
  /\b(tacos?|burritos?|mulitas?|quesadillas?|tortas?|sopes?|nachos?|platos?|plates?|combos?|flan(?:es)?|cheesecakes?|aguas?|horchatas?|jamaicas?|pinas?|tamarindos?|sodas?|cocas?|cokes?|sprites?|fantas?|cafes?|coffees?|champurrados?|arroz|rice|frijol(?:es)?|beans?|carnes?|meats?|asadas?|pastor(?:es)?|pollos?|chicken|cabezas?|lenguas?|buches?|chorizos?|carnitas|huevos?|eggs?|desayunos?|breakfast|tortillas?|salsas?|guacamole|guac|crema|queso|cheese|cebolla|onion|cilantro|limon(?:es)?|limes?|chiles?|jalapenos?|chips|bebidas?|drinks?|platters?|charolas?|trays?|postres?|desserts?|bolsas?|bags?|utensilios|servilletas|napkins|cupon|gift\s*card)\b/i

const BRIDGE_CONCRETE_DEFECT_RE =
  /\b(crud[oa]s?|raw|fri[oa]s?|cold|quemad[oa]s?|burnt|echad[oa]\s+a\s+perder|spoiled|pelo|cabello|hair|plastico|plastic|doble\s+cobro|charged\s+twice|overcharged|cobro\s+de\s+mas|cobro\s+extra|me\s+cobraron|mal\s+estado|acido|rancio|caducado|enferm|food\s+poison|equivocad[oa]\s+de\s+carne|wrong\s+meat|sin\s+queso|no\s+cheese|con\s+queso|sin\s+cebolla|no\s+onion|sin\s+cilantro|no\s+cilantro|en\s+vez\s+de|instead\s+of|me\s+dieron\s+otra\s+orden|someone\s+else'?s\s+order)\b/i

const BRIDGE_REFUSE_DETAIL_RE =
  /\b(no\s+quiero\s+decir|solo\s+quiero\s+hablar\s+con\s+el\s+gerente|prefiero\s+decirle\s+al\s+gerente|just\s+(?:want\s+to\s+)?(?:speak|talk)\s+to\s+(?:the\s+)?manager|tell\s+(?:the\s+)?manager\s+directly|prefer\s+to\s+tell\s+(?:the\s+)?manager)\b/i

function hasBridgeSpecificOrderIssueDetails(summary: string, userContext: string): boolean {
  const combined = normalizeSearch(`${summary || ""} ${userContext || ""}`)
  if (!combined) return false
  if (BRIDGE_ORDER_ITEM_NOUN_RE.test(combined)) return true
  if (BRIDGE_CONCRETE_DEFECT_RE.test(combined)) return true
  if (BRIDGE_REFUSE_DETAIL_RE.test(combined)) return true
  return false
}

function isBridgeFoundItemOrCancelResolution(summary: string, userText: string): boolean {
  const combined = normalizeSearch(`${summary || ""} ${userText || ""}`)
  if (!combined) return false
  return /\b(ya\s+encontre|ya\s+lo\s+encontre|ya\s+la\s+encontre|lo\s+encontre|la\s+encontre|encontro\s+su|encontro\s+la|encontro\s+el|found\s+my|i\s+found\s+it|found\s+the|found\s+my\s+food|found\s+my\s+plate|found\s+my\s+order|here\s+in\s+my\s+car|aqui\s+en\s+mi\s+carro|esta\s+en\s+mi\s+carro|never\s*mind\s+i\s+found|cancel\s+(?:the\s+)?(?:callback|alert|request)|cancelar\s+(?:el\s+)?(?:recado|alerta)|ya\s+no\s+hace\s+falta|ya\s+no\s+necesito\s+(?:que\s+me\s+llamen|el\s+recado)|everything\s+is\s+here|esta\s+todo\s+completo)\b/i.test(
    combined
  )
}

function detectBridgeExplicitEnglishRequest(text: string): boolean {
  const norm = normalizeSearch(text)
  if (!norm) return false
  return /\b(english|speak\s+english|in\s+english|english\s+please|don\s*t\s+speak\s+spanish|do\s+not\s+speak\s+spanish|no\s+hablo\s+espanol|no\s+spanish)\b/i.test(
    norm
  )
}

function detectBridgeExplicitSpanishRequest(text: string): boolean {
  const norm = normalizeSearch(text)
  if (!norm) return false
  return /\b(en\s+espanol|habla\s+espanol|hablas\s+espanol|speak\s+spanish|in\s+spanish|spanish\s+please|prefiero\s+espanol)\b/i.test(
    norm
  )
}

const BRIDGE_SPANISH_ANCHOR_WORDS = new Set([
  "que", "para", "como", "donde", "cuando", "quiero", "queria", "tienen", "tienes", "puedo",
  "pueden", "buenos", "buenas", "disculpa", "disculpe", "por", "favor", "cuanto", "cuanta",
  "cuesta", "cuestan", "orden", "recibo", "falta", "falto", "faltaron", "sucursal", "tienda",
  "gerente", "horario", "horarios", "abierto", "abiertos", "cerrado", "cerrados", "gracias",
  "hola", "ayuda", "necesito", "preguntar", "saber", "venden", "charola", "charolas", "personas"
])

const BRIDGE_ENGLISH_ANCHOR_WORDS = new Set([
  "what", "where", "when", "how", "much", "are", "you", "guys", "open", "close", "closed",
  "hours", "today", "tonight", "tomorrow", "order", "ordered", "missing", "wrong", "didnt",
  "give", "gave", "food", "party", "tray", "trays", "platter", "platters", "catering",
  "people", "guests", "delivery", "pickup", "drive", "thru", "through", "can", "could",
  "would", "wondering", "please", "need", "want", "looking", "asking", "calling", "about",
  "with", "from", "this", "that", "there", "here", "they", "them", "my", "our", "your",
  "store", "location", "manager", "number", "phone", "receipt", "ticket", "refund", "charge",
  "charged", "breakfast", "menu", "price", "prices", "come", "comes", "include", "includes",
  "still", "right", "now", "check", "checking", "help", "just", "went", "bought", "got",
  "forgot", "left", "bag", "plate", "meat", "drinks", "gallons", "dozen", "speak", "someone",
  "placed", "actually", "double", "business", "hello", "hi"
])

function detectBridgeClearEnglishTurn(text: string): boolean {
  const norm = normalizeSearch(text)
  if (!norm || norm.length < 6) return false
  if (detectBridgeExplicitEnglishRequest(norm)) return true
  const words = norm.split(" ").filter(Boolean)
  if (words.length < 3) return false
  let esHits = 0
  let enHits = 0
  const seenEn = new Set<string>()
  for (const w of words) {
    if (BRIDGE_SPANISH_ANCHOR_WORDS.has(w)) esHits++
    if (BRIDGE_ENGLISH_ANCHOR_WORDS.has(w) && !seenEn.has(w)) {
      seenEn.add(w)
      enHits++
    }
  }
  return esHits === 0 && enHits >= 3
}

function isVagueOrderDraftSegment(seg: string): boolean {
  const norm = normalizeSearch(seg)
  if (!norm) return true
  if (norm.length < 95 && !BRIDGE_ORDER_ITEM_NOUN_RE.test(norm) && !BRIDGE_CONCRETE_DEFECT_RE.test(norm)) {
    if (/(reporta\s+problema|problema\s+en\s+drive|problema\s+con\s+su\s+orden|solicita\s+hablar|sin\s+numero\s+de\s+ticket|sin\s+especificar)/i.test(norm)) {
      return true
    }
  }
  return false
}

function segmentContentTokens(seg: string): string[] {
  const stop = new Set([
    "cliente", "reporta", "solicita", "hablar", "gerente", "orden", "pedido", "tienda", "sucursal",
    "ticket", "numero", "para", "con", "sin", "que", "por", "del", "las", "los", "una", "uno", "esta",
    "nota", "adicional", "hoy", "ayer", "drive", "thru"
  ])
  return Array.from(
    new Set(
      normalizeSearch(seg)
        .split(" ")
        .filter((w) => w.length >= 4 && !stop.has(w))
    )
  )
}

function mergeBridgeCallbackSummaries(prevSummary: string, nextSummary: string): string {
  const rawPrev = String(prevSummary || "").replace(/\s+/g, " ").trim()
  const rawNext = String(nextSummary || "").replace(/\s+/g, " ").trim()
  if (!rawPrev) return rawNext.slice(0, 2000)
  if (!rawNext) return rawPrev.slice(0, 2000)

  const routeTags: string[] = []
  const statusTags: string[] = []
  const seenTagNorms = new Set<string>()

  const stripAndCollectTags = (input: string): string => {
    return input
      .replace(/\[[^\]]+\]/g, (m) => {
        const cleanTag = m.replace(/\s+/g, " ").trim()
        const normTag = normalizeSearch(cleanTag)
        if (!seenTagNorms.has(normTag)) {
          seenTagNorms.add(normTag)
          if (/^\[llam[oó]\s+a\s+#/i.test(cleanTag)) {
            routeTags.push(cleanTag)
          } else {
            statusTags.push(cleanTag)
          }
        }
        return " "
      })
      .replace(/\s+/g, " ")
      .trim()
  }

  const prevBody = stripAndCollectTags(rawPrev)
  const nextBody = stripAndCollectTags(rawNext)

  const rawSegments = [
    ...prevBody.split("|").map((s) => s.trim()),
    ...nextBody.split("|").map((s) => s.trim())
  ].filter(Boolean)

  const kept: string[] = []
  for (const cand of rawSegments) {
    if (/^nota adicional del cliente:\s*(ning[uú]n\s+detalle|sin\s+detalles|nada|none)\b/i.test(cand)) {
      continue
    }
    const normCand = normalizeSearch(cand)
    if (!normCand) continue
    const candTokens = segmentContentTokens(cand)

    let handled = false
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i]
      const normEx = normalizeSearch(existing)
      if (normCand === normEx || normEx.includes(normCand)) {
        handled = true
        break
      }
      if (normCand.includes(normEx)) {
        kept[i] = cand
        handled = true
        break
      }
      // Si el borrador previo era vago y el nuevo trae detalles concretos, reemplazar el borrador vago
      if (isVagueOrderDraftSegment(existing) && !isVagueOrderDraftSegment(cand) && cand.length >= 24) {
        kept[i] = cand
        handled = true
        break
      }
      if (isVagueOrderDraftSegment(cand) && !isVagueOrderDraftSegment(existing)) {
        handled = true
        break
      }
      // Si comparten >= 60% de palabras clave sustantivas, conservar el más completo sin duplicar
      const exTokens = segmentContentTokens(existing)
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

  // Si hay ticket validado en POS o estado RESUELTO, descartar tags obsoletos de SIN TICKET / pendiente
  const hasValidatedTicket = statusTags.some((t) => /validado en pos/i.test(t))
  const finalStatusTags = statusTags.filter((t) => {
    if (hasValidatedTicket && /(sin ticket|pendiente validar)/i.test(t)) return false
    return true
  })

  const prefix = routeTags.length > 0 ? `${routeTags[routeTags.length - 1]} ` : ""
  const body = kept.join(" | ").trim()
  const suffix = finalStatusTags.length > 0 ? ` ${finalStatusTags.join(" ")}` : ""
  return `${prefix}${body}${suffix}`.replace(/\s+/g, " ").trim().slice(0, 2000)
}

function isPhoneFragmentOfCallerId(rawArg: string, callerIdE164: string): boolean {
  const argDigits = String(rawArg || "").replace(/\D/g, "")
  if (!argDigits) return true
  const caller10 = callerIdE164.replace(/\D/g, "").slice(-10)
  if (caller10.length !== 10) return false
  if (argDigits.length >= 4 && argDigits.length <= 11) {
    const normArg = argDigits.length === 11 && argDigits.startsWith("1") ? argDigits.slice(1) : argDigits
    if (caller10.includes(normArg)) return true
  }
  return false
}

async function translatePostCallbackNoteToSpanish(
  extraTurns: string[],
  existingSummary: string,
  geminiKeys: string[] | undefined
): Promise<string> {
  const cleanedTurns = extraTurns.filter((t) => !isBridgeTrivialAckOrFarewell(t))
  if (cleanedTurns.length === 0) return ""
  const joined = cleanedTurns.join(" / ").replace(/\s+/g, " ").trim()
  if (!joined) return ""
  const fallback = `Nota adicional del cliente: ${joined}`.slice(0, 400)
  if (!geminiKeys || geminiKeys.length === 0) return fallback

  const prompt = `Analiza estos turnos que dijo el cliente DESPUÉS de crear su recado en un restaurante.
Si NO contienen información sustantiva nueva (por ejemplo: solo despedidas, agradecimientos, "eso sería todo", "nada más", o únicamente repiten lo que ya está en el recado actual), responde EXACTAMENTE la palabra: NONE
De lo contrario, resume y traduce al ESPAÑOL claro y breve (máximo 1 oración corta para la pantalla del gerente) SOLO los datos nuevos sin comillas ni prefijos.
Recado actual: ${existingSummary}
Turnos nuevos del cliente: ${joined}`
  const models = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite-preview"]
  for (const model of models) {
    const key = geminiKeys[0]
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2200)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 120 }
          })
        }
      )
      if (res.ok) {
        const json = await res.json().catch(() => null)
        const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "")
          .replace(/[\r\n]+/g, " ")
          .replace(/\s+/g, " ")
          .replace(/^["']|["']$/g, "")
          .trim()
        const normOut = normalizeSearch(text)
        if (
          !normOut ||
          /^(none|ningun\s+detalle|sin\s+detalles|no\s+hay\s+detalles|nada\s+(?:mas|nuevo|adicional)|solo\s+(?:despedida|agradecimiento)|no\s+contiene\s+informacion)/.test(
            normOut
          )
        ) {
          clearTimeout(timer)
          return ""
        }
        if (text.length >= 4) {
          clearTimeout(timer)
          return `Nota adicional del cliente: ${text}`.slice(0, 420)
        }
      }
    } catch {
      // continuar con fallback
    } finally {
      clearTimeout(timer)
    }
  }
  return fallback
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
  const rawCallerName = (params.CallerName || "").trim()
  const toNumber = (params.To || "").trim()
  const forwardedFrom = (params.ForwardedFrom || "").trim()
  const digits = (params.Digits || "").trim()
  const isPreconsentSwitch = reqUrl.searchParams.get("preconsent") === "1" && digits === "9"
  const isResume = reqUrl.searchParams.get("resume") === "1"
  const resumeAttempt = Math.max(0, Math.min(10, Number(reqUrl.searchParams.get("attempt") || "0") || 0))
  const twilioCallStatus = String(params.CallStatus || "").trim().toLowerCase()

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
  const blockedCallerTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
  const callerIdentity = await resolveBridgeCallerIdentity({
    phone: fromNumber,
    rawTwilioCallerName: rawCallerName,
    secrets,
    allowTwilioLookup: false,
    blockedTenDigits: blockedCallerTen
  })

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

  const wssBridgeUrl = `wss://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge`

  // RELEVO TRANSPARENTE DE WORKER (resume=1): evita corte de llamada por CPU limit y JAMÁS vuelve a reproducir CIPA ni español
  if (isResume) {
    if (["completed", "canceled", "busy", "failed", "no-answer"].includes(twilioCallStatus)) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" }
      })
    }
    const existingCallRows = await pgSelect(
      `phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,status,language,caller_name,caller_name_source,ended_at,turns_count&limit=1`
    )
    const existingCall = existingCallRows[0]
    if (
      existingCall?.ended_at ||
      ["completed", "canceled", "busy", "failed", "no-answer"].includes(String(existingCall?.status || "").toLowerCase())
    ) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" }
      })
    }

    const resumedLang: PhoneLang =
      existingCall?.language === "en" ? "en" : existingCall?.language === "es" ? "es" : activeLang
    const resumedName = String(existingCall?.caller_name || callerIdentity.displayName || "").trim()
    const resumedSource = String(existingCall?.caller_name_source || callerIdentity.source || "").trim()
    const existingTurns = Number(existingCall?.turns_count || 0)

    // Si Gemini Live no pudo arrancar ni con 1 reintento (0 turnos) o agotó 4 relevos (>11 min), caer al respaldo clásico EN EL IDIOMA REAL
    if (resumeAttempt > 4 || (resumeAttempt >= 2 && existingTurns === 0)) {
      const vercelFallbackRespond = `${secrets.publicAppBaseUrl}/api/phone/respond?storeId=${store.id}&lang=${resumedLang}&turn0=${existingTurns === 0 ? "1" : "0"}`
      const resumePromptText =
        resumedLang === "en"
          ? existingTurns === 0
            ? "How can I help you today?"
            : "I'm still here with you, how can I help?"
          : existingTurns === 0
            ? "¿En qué te ayudo hoy?"
            : "Aquí sigo contigo, ¿en qué te ayudo?"
      const fallbackPlayUrl = await signTtsUrl(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, resumePromptText, resumedLang)
      const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech dtmf" numDigits="1" language="${resumedLang === "en" ? "en-US" : "es-US"}" speechTimeout="1" timeout="5" actionOnEmptyResult="true" action="${escapeXml(vercelFallbackRespond)}" method="POST">
    <Play>${escapeXml(fallbackPlayUrl)}</Play>
  </Gather>
  <Redirect method="POST">${escapeXml(vercelFallbackRespond)}&amp;silence=1</Redirect>
</Response>`
      return new Response(fallbackTwiml, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" }
      })
    }

    const resumeTs = Date.now()
    const resumeSig = await hmacSha256Hex(
      secrets.twilioAuthToken,
      `${callSid}|${store.id}|${resumedLang}|${resumeTs}`
    )
    const nextResumeUrl = `https://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge?storeId=${store.id}&resume=1&attempt=${resumeAttempt + 1}`
    const resumeTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wssBridgeUrl)}">
      <Parameter name="callSid" value="${escapeXml(callSid)}" />
      <Parameter name="storeId" value="${store.id}" />
      <Parameter name="lang" value="${resumedLang}" />
      <Parameter name="resume" value="1" />
      <Parameter name="callerNumber" value="${escapeXml(fromNumber)}" />
      <Parameter name="callerName" value="${escapeXml(resumedName)}" />
      <Parameter name="callerNameSource" value="${escapeXml(resumedSource)}" />
      <Parameter name="toNumber" value="${escapeXml(toNumber)}" />
      <Parameter name="forwardedFrom" value="${escapeXml(forwardedFrom)}" />
      <Parameter name="ts" value="${resumeTs}" />
      <Parameter name="sig" value="${escapeXml(resumeSig)}" />
    </Stream>
  </Connect>
  <Redirect method="POST">${escapeXml(nextResumeUrl)}</Redirect>
</Response>`
    return new Response(resumeTwiml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" }
    })
  }

  const greetings = buildInitialGreetingTexts(store, activeLang, schedEval, !isPreconsentSwitch)
  const [discPlayUrl] = await Promise.all([
    signTtsUrl(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.disclosureOnly, activeLang)
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
            caller_name: callerIdentity.displayName || null,
            caller_name_source: callerIdentity.source || null,
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
      // Si ni directorio interno ni webhook CNAM tenían nombre, resolver Twilio Lookup v2 durante los ~8s del aviso CIPA (0 ms extra al contestar)
      let effectiveCallerName = callerIdentity.displayName || ""
      let effectiveCallerSource = callerIdentity.source || ""
      if (!effectiveCallerName && callerIdentity.phoneE164 && !rawCallerName) {
        const lookedUp = await resolveBridgeCallerIdentity({
          phone: fromNumber,
          rawTwilioCallerName: "",
          secrets,
          allowTwilioLookup: true,
          blockedTenDigits: blockedCallerTen
        }).catch(() => null)
        if (lookedUp?.displayName) {
          effectiveCallerName = lookedUp.displayName
          effectiveCallerSource = lookedUp.source || "twilio_lookup"
          await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
            method: "PATCH",
            headers: dbHeaders(),
            body: JSON.stringify({
              caller_name: effectiveCallerName,
              caller_name_source: effectiveCallerSource
            })
          }).catch(() => null)
        }
      }
      // Pre-calentar en RAM los clips μ-law ("¿En qué te ayudo hoy?" + despedida) y el contexto de tienda mientras suena el aviso CIPA (~10 s)
      await Promise.all([
        fetchMulawPromptClip(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.questionOnly, activeLang),
        fetchMulawPromptClip(
          secrets.publicAppBaseUrl,
          secrets.ttsSigningSecret,
          activeLang === "en" ? BRIDGE_CACHED_FAREWELL_EN : BRIDGE_CACHED_FAREWELL_ES,
          activeLang
        ),
        buildBridgeSystemPromptAndData(store.id, activeLang, fromNumber, effectiveCallerName, effectiveCallerSource).catch(() => null)
      ])
    })()
  )

  const streamTs = Date.now()
  const streamSig = await hmacSha256Hex(
    secrets.twilioAuthToken,
    `${callSid}|${store.id}|${activeLang}|${streamTs}`
  )
  const selfHttpUrl = `https://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge?storeId=${store.id}&lang=${activeLang}&preconsent=1`
  const resumeSelfUrl = `https://${new URL(SUPABASE_URL).host}/functions/v1/phone-live-bridge?storeId=${store.id}&resume=1&attempt=1`

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
      <Parameter name="callerName" value="${escapeXml(callerIdentity.displayName || "")}" />
      <Parameter name="callerNameSource" value="${escapeXml(callerIdentity.source || "")}" />
      <Parameter name="toNumber" value="${escapeXml(toNumber)}" />
      <Parameter name="forwardedFrom" value="${escapeXml(forwardedFrom)}" />
      <Parameter name="ts" value="${streamTs}" />
      <Parameter name="sig" value="${escapeXml(streamSig)}" />
    </Stream>
  </Connect>
  <Redirect method="POST">${escapeXml(resumeSelfUrl)}</Redirect>
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
    description:
      "Consulta en vivo el estado abierto/cerrado, el calendario real de los próximos 7 días (HOY, MAÑANA, PASADO MAÑANA y días de esta semana con festivos ya aplicados), próximos festivos con fechas exactas y horario semanal regular de esta sucursal.",
    parameters: {
      type: "OBJECT",
      properties: {
        requested_date: {
          type: "STRING",
          description:
            "Opcional: 'today', 'tomorrow', 'day_after_tomorrow', nombre de día ('jueves'/'thursday'/'viernes'/'friday'), nombre de festivo ('thanksgiving'/'black friday'/'navidad') o fecha 'YYYY-MM-DD'."
        }
      }
    }
  },
  {
    name: "search_menu_item_price",
    behavior: "BLOCKING",
    description:
      "Busca en <1ms precios exactos en USD, ingredientes, desayunos, historia (1992), empleo, catering o políticas oficiales en el menú y base de conocimiento en vivo de la sucursal.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Platillo, bebida, ingrediente o tema a consultar." }
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
      required: []
    }
  },
  {
    name: "send_delivery_armor_order_note",
    behavior: "BLOCKING",
    description:
      "Envía una ALERTA PARPADEANTE en tiempo real a la tableta de empaque Delivery Armor de la sucursal para que la cajera que está empacando una orden de DoorDash, Uber Eats, Grubhub o Tacos Gavilan Online agregue condimentos gratuitos (salsas, chiles, limones, cebollas, servilletas, cubiertos) o aplique una modificación sin costo a un platillo (ej. sin queso, sin cebolla, sin cilantro, sin crema, salsa aparte, tortillas de harina/maíz). PROHIBIDO usarla para agregar comida o bebidas con costo extra. ANTES de invocarla, pide al cliente: (1) plataforma (DoorDash, Uber Eats, Grubhub u Online), (2) nombre como aparece en su orden, (3) código de orden de la app o 1–2 platillos que pidió para identificarla con precisión, y (4) qué condimentos gratuitos o qué modificación sin costo y en qué platillo desea. Si después agrega otro condimento o cambio, VUELVE A INVOCARLA para actualizar la alerta.",
    parameters: {
      type: "OBJECT",
      properties: {
        platform: {
          type: "STRING",
          description: "Plataforma donde hizo la orden: 'DOORDASH', 'UBER_EATS', 'GRUBHUB', o 'TOAST_ONLINE'."
        },
        customer_name: {
          type: "STRING",
          description: "Nombre exacto como aparece en la orden de la aplicación (ej. 'Maria Gonzalez', 'Cameron K')."
        },
        order_code: {
          type: "STRING",
          description: "Código de la orden en la app o últimos dígitos si el cliente los tiene (ej. '2DFF4', '60446F49', '#2845')."
        },
        ordered_items: {
          type: "STRING",
          description: "1 o 2 platillos que pidió el cliente (ej. '2 tacos de asada y burrito de pollo') para identificar la orden si no tiene código o hay nombres repetidos."
        },
        request_type: {
          type: "STRING",
          description: "'condiments' (solo condimentos gratis), 'item_modification' (solo ajuste sin costo en platillo) o 'both' (ambos)."
        },
        requested_condiments: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Lista corta EN ESPAÑOL de condimentos gratuitos solicitados (ej. ['Salsa roja', 'Salsa verde', 'Limones', 'Chiles asados'])."
        },
        item_modifications: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Lista corta EN ESPAÑOL de modificaciones sin costo indicando el platillo (ej. ['Burrito de Asada: sin cebolla ni cilantro', 'Taco Plate: sin queso'])."
        },
        note_summary_es: {
          type: "STRING",
          description: "Resumen corto y muy claro SIEMPRE EN ESPAÑOL para la cajera de empaque en la tableta (ej. 'Agregar 4 salsas rojas y limones. Burrito de Asada SIN cebolla.')."
        },
        note_summary_en: {
          type: "STRING",
          description: "Resumen breve en inglés opcional (ej. 'Add 4 red salsas & limes. Asada Burrito NO onion.')."
        },
        caller_phone: {
          type: "STRING",
          description: "Envía 'CALLER_ID' o teléfono alterno de 10 dígitos si lo dio."
        },
        target_store_id: {
          type: "INTEGER",
          description: "ID de sucursal destino (1, 3..16) solo si ordenó en otra sucursal distinta."
        },
        replace_condiments: {
          type: "BOOLEAN",
          description: "true si el cliente está editando o reemplazando condimentos que pidió antes en la misma orden."
        },
        confirm_save_unmatched: {
          type: "BOOLEAN",
          description: "Solo envía true en un segundo intento si la orden todavía no baja a Toast y el cliente confirmó que la acaba de enviar hace segundos a ESTA sucursal."
        }
      },
      required: ["platform", "customer_name", "note_summary_es"]
    }
  },
  {
    name: "request_toast_pickup_time_change",
    behavior: "BLOCKING",
    description:
      "Ayuda a un cliente con una orden de Toast / tacosgavilan.com a cambiar el horario para recoger su pedido (más tarde o más temprano). Valida horario real de la sucursal y envía alerta parpadeante en vivo a cocina en la tableta PREPARADOR.",
    parameters: {
      type: "OBJECT",
      properties: {
        customer_name: { type: "STRING", description: "Nombre en la orden." },
        order_code: { type: "STRING", description: "Número de orden Toast si lo tiene." },
        requested_pickup_time: { type: "STRING", description: "Nueva hora exacta para recoger (ej. '2:30 PM', '6:00 PM', 'en 1 hora')." },
        requested_date: { type: "STRING", description: "Opcional: 'today', 'tomorrow' o YYYY-MM-DD." },
        caller_phone: { type: "STRING", description: "'CALLER_ID' o teléfono de 10 dígitos." },
        ordered_items: { type: "STRING", description: "Platillos pedidos si los menciona." },
        extra_notes: { type: "STRING", description: "Nota breve en español para cocina." },
        target_store_id: { type: "INTEGER", description: "ID de sucursal (1, 3..16) solo si ordenó en otra tienda." },
        confirm_save_unmatched: { type: "BOOLEAN", description: "true en 2do intento si aún no aparece en Toast." }
      },
      required: ["customer_name", "requested_pickup_time"]
    }
  },
  {
    name: "coordinate_wrong_store_order",
    behavior: "BLOCKING",
    description:
      "Cuando el cliente se equivocó de sucursal al ordenar, envía ALERTA SIMULTÁNEA en vivo a las 2 sucursales involucradas: NO PREPARAR a paid_store_id y PREPARAR AQUÍ con los platillos pagados a prepare_store_id.",
    parameters: {
      type: "OBJECT",
      properties: {
        paid_store_id: { type: "INTEGER", description: "ID de sucursal (1, 3..16) donde cayó/se pagó la orden por error." },
        prepare_store_id: { type: "INTEGER", description: "ID de sucursal (1, 3..16) donde el cliente QUIERE recoger y donde debe prepararse." },
        customer_name: { type: "STRING", description: "Nombre del cliente en la orden." },
        order_code: { type: "STRING", description: "Número o código de orden." },
        platform: { type: "STRING", description: "'TOAST_ONLINE', 'DOORDASH', 'UBER_EATS' o 'GRUBHUB'." },
        caller_phone: { type: "STRING", description: "'CALLER_ID' o teléfono de 10 dígitos." },
        ordered_items: { type: "STRING", description: "Platillos ordenados si aún no baja a Toast." },
        requested_pickup_time: { type: "STRING", description: "Hora estimada para recoger (opcional)." },
        extra_notes: { type: "STRING", description: "Nota breve en español." },
        confirm_save_unmatched: { type: "BOOLEAN", description: "true si ya confirmaste los platillos con el cliente." }
      },
      required: ["paid_store_id", "prepare_store_id", "customer_name"]
    }
  },
  {
    name: "send_fiesta_platter_prep_alert",
    behavior: "BLOCKING",
    description:
      "Cuando un cliente ordenó un Fiesta Platter / Party Tray en DoorDash, Uber Eats, Grubhub o Online y la app no le dejó seleccionar todas las carnes, aguas o tortillas que quiere, valida las libras/galones oficiales (1 sola carne o varias, ej. 12 lbs = 4 Asada, 4 Pollo, 4 Pastor) y envía alerta directo a los cocineros en la tableta PREPARADOR.",
    parameters: {
      type: "OBJECT",
      properties: {
        platform: { type: "STRING", description: "'DOORDASH', 'UBER_EATS', 'GRUBHUB' o 'TOAST_ONLINE'." },
        customer_name: { type: "STRING", description: "Nombre del cliente." },
        order_code: { type: "STRING", description: "Código o número de orden." },
        package_size: { type: "STRING", description: "'15-20' (6 lb), '20-25' (7.5 lb), '25-30' (10 lb) o '30-40' (12 lb)." },
        meat_breakdown: {
          type: "ARRAY",
          description: "Carnes solicitadas: [{ meat: 'Asada'|'Pollo'|'Al Pastor'|'Carnitas'|'Cabeza'|'Lengua'|'Buche'|'Chorizo', lbs?: número }].",
          items: {
            type: "OBJECT",
            properties: {
              meat: { type: "STRING" },
              lbs: { type: "NUMBER" }
            },
            required: ["meat"]
          }
        },
        aguas_breakdown: {
          type: "ARRAY",
          description: "Opcional: [{ flavor: 'Horchata'|'Jamaica'|'Piña'|'Tamarindo', gallons?: número }].",
          items: {
            type: "OBJECT",
            properties: {
              flavor: { type: "STRING" },
              gallons: { type: "NUMBER" }
            },
            required: ["flavor"]
          }
        },
        tortillas_preference: { type: "STRING", description: "Opcional: 'Maíz', 'Harina' o 'Mitad Maíz y Mitad Harina'." },
        requested_condiments: { type: "ARRAY", items: { type: "STRING" }, description: "Condimentos gratis extra EN ESPAÑOL." },
        extra_notes: { type: "STRING", description: "Nota adicional para cocina EN ESPAÑOL." },
        requested_pickup_time: { type: "STRING", description: "Hora de recolección programada (opcional)." },
        caller_phone: { type: "STRING", description: "'CALLER_ID' o teléfono de 10 dígitos." },
        target_store_id: { type: "INTEGER", description: "ID de sucursal (1, 3..16) solo si ordenó en otra tienda." },
        confirm_save_unmatched: { type: "BOOLEAN", description: "true en 2do intento si aún no aparece en Toast." }
      },
      required: ["platform", "customer_name"]
    }
  },
  {
    name: "create_manager_callback",
    behavior: "BLOCKING",
    description:
      "Registra o ACTUALIZA un Recado Prioritario para el Gerente o Nota de Empaque en la pantalla de la sucursal. Antes de llamarlo, conoce el detalle/cambio concreto del cliente, confirma su nombre y confirma si usamos el número del que llama ('CALLER_ID') u otro de 10 dígitos (en reclamos en tienda/Drive-Thru también ticket VALIDADO con validate_order_ticket o SIN TICKET + fecha). OBLIGATORIO: si después de crear el recado el cliente agrega cualquier detalle nuevo (ej. 'sin queso', 'Taco Plate', código o aclaración), VUELVE A INVOCAR esta herramienta con el reason_summary completo en español ANTES de decirle que ya lo agregaste.",
    parameters: {
      type: "OBJECT",
      properties: {
        caller_name: { type: "STRING", description: "Nombre real de la persona." },
        caller_phone: {
          type: "STRING",
          description: "Envía 'CALLER_ID' si confirmó usar el mismo número del que llama (preferido cuando Twilio entregó Caller ID), o el teléfono alternativo real de 10 dígitos."
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
  kbEntries: any[]
  schedEval: ReturnType<typeof evaluateStoreSchedule>
  greetings: ReturnType<typeof buildInitialGreetingTexts>
  spokenAddr: string
  systemText: string
}

const prewarmedBridgeCache = new Map<string, { at: number; data: BridgePromptData }>()

async function getPrewarmedOrBuildBridgeData(
  storeId: number,
  lang: PhoneLang,
  callerNumber: string,
  callerName = "",
  callerNameSource = ""
): Promise<BridgePromptData> {
  const key = `${storeId}|${lang}|${callerNumber || ""}`
  const hit = prewarmedBridgeCache.get(key)
  if (hit && Date.now() - hit.at < 45_000) {
    prewarmedBridgeCache.delete(key)
    return hit.data
  }
  return buildBridgeSystemPromptAndData(storeId, lang, callerNumber, callerName, callerNameSource)
}

async function buildBridgeSystemPromptAndData(
  storeId: number,
  lang: PhoneLang,
  callerNumber: string,
  callerName = "",
  callerNameSource = ""
): Promise<BridgePromptData> {
  const [stores, configs, specialHours, menuItems, kbEntries, learnedItems] = await Promise.all([
    pgSelect("stores?is_active=eq.true&select=id,name,code,external_id,address,phone,has_drive_thru,weekly_hours&order=id.asc"),
    pgSelect("phone_agent_config?select=*"),
    pgSelect("phone_special_hours?select=*"),
    pgSelect(
      `app_menu_cache?store_id=eq.${storeId}&is_available=eq.true&select=category_name,name,description,price&order=category_name.asc,name.asc`
    ),
    pgSelect(
      `phone_knowledge_base?is_active=eq.true&or=(store_id.is.null,store_id.eq.${storeId})&select=id,category,title,title_en,answer_es,answer_en,priority&order=priority.desc`
    ),
    pgSelect(
      `phone_learning_items?status=in.(approved,auto_applied)&applies_to_channels=in.(both,phone_only)&item_kind=in.(doubt_for_owner,learned_rule,fast_reply_macro,stt_synonym)&or=(store_id.is.null,store_id.eq.${storeId})&select=item_kind,status,applies_to_channels,category,question_or_trigger,question_or_trigger_en,proposed_rule_es,proposed_rule_en,store_id&order=status.asc,evidence_count.desc,updated_at.desc&limit=40`
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
  const next7Days = buildBridgeEffectiveNext7Days(store, specialHours, pt)
  const upcomingHolidays = buildBridgeUpcomingHolidays(store, specialHours, pt, 150)
  const next7PrimaryLines = next7Days
    .slice(0, 3)
    .map((d) => `     * ${d.isSpecial ? "⚠️ " : ""}${lang === "en" ? d.summaryEn : d.summaryEs}`)
    .join("\n")
  const next7RestCompact = next7Days
    .slice(3)
    .map((d) => (d.isSpecial ? `⚠️ ${lang === "en" ? d.summaryEn : d.summaryEs}` : `${lang === "en" ? d.dayEn : d.dayEs} ${d.dateStr}: ${d.isClosedAllDay ? (lang === "en" ? "CLOSED" : "CERRADO") : `${d.openFmt}-${d.closeFmt}`}`))
    .join(" | ")
  const upcomingHolidaysExactLine = upcomingHolidays
    .slice(0, 7)
    .map((h) => {
      const rel = h.relTagEs ? ` [${lang === "en" ? h.relTagEn : h.relTagEs}]` : ""
      const hrs = h.isClosedAllDay ? (lang === "en" ? "CLOSED ALL DAY" : "CERRADO TODO EL DÍA") : `${h.openFmt}-${h.closeFmt}`
      return `${h.dateStr}${rel} (${h.holidayName || "Festivo"}): ${hrs}`
    })
    .join(" | ")

  const dispName = customerStoreDisplay(store, lang)
  const spokenName = customerStoreSpoken(store, lang)
  const laMeta = LA_CROSS_STREETS[Number(store.id)]
  const spokenAddr = expandStreetAddress(store.address || "", lang)

  // Agrupar menú sin pérdida por categoría + precio (100% de platillos y precios reales en ~75% menos tokens)
  const byCatPrice = new Map<string, Map<string, string[]>>()
  for (const m of menuItems) {
    const cat = String(m.category_name || "Menu")
    const price = `$${Number(m.price || 0).toFixed(2)}`
    if (!byCatPrice.has(cat)) byCatPrice.set(cat, new Map())
    const pMap = byCatPrice.get(cat)!
    if (!pMap.has(price)) pMap.set(price, [])
    const rawItemName = String(m.name || "").trim()
    const displayItemName = rawItemName === "Coffee" ? "Coffee (Café de Olla / Café Regular 16 oz)" : rawItemName
    pMap.get(price)!.push(displayItemName)
  }
  const menuTextLines: string[] = []
  for (const [cat, pMap] of byCatPrice.entries()) {
    const groups: string[] = []
    for (const [price, names] of pMap.entries()) {
      groups.push(`${price}: ${names.join(", ")}`)
    }
    menuTextLines.push(`[${cat}] ${groups.join(" | ")}`)
  }

  const trayLines = PARTY_TRAYS.map((t) => {
    const found = findPartyTrayMenuItem(menuItems, t.key)
    const p = found ? `$${Number(found.price).toFixed(2)} USD` : "ver tacosgavilan.com"
    return `- Fiesta Platter ${t.key} (${t.guests}): ${p} (${t.meatLbs}lb carne, ${t.riceLbs}lb arroz, ${t.beansLbs}lb frijol, ${t.cornDoz}doc maíz o ${t.flourDoz}doc harina, ${t.aguasGal}gal agua, salsas/platos/utensilios)`
  }).join("\n")

  // Mapa compacto de IDs de las 15 sucursales (para dirección/teléfono/horario en vivo de otra tienda -> find_other_stores en 0ms RAM)
  const storeIdMapLine = stores
    .map((s) => `#${s.id} ${customerStoreDisplay(s, lang)}${s.has_drive_thru ? " [DT]" : ""}`)
    .join(", ")

  const activeKbEntries = kbEntries.filter((k) => String(k?.category || "").toLowerCase() !== "staff")

  const seenLearnedNorm = new Set<string>()
  const learnedLines = (Array.isArray(learnedItems) ? learnedItems : [])
    .filter((r) => {
      if (!r || (!r.proposed_rule_es && !r.proposed_rule_en)) return false
      if (r.item_kind === "latency_insight" || r.item_kind === "audio_prewarm") return false
      if (r.applies_to_channels === "drive_thru_only") return false
      const rawTxt = String(lang === "en" ? r.proposed_rule_en || r.proposed_rule_es : r.proposed_rule_es || r.proposed_rule_en).trim()
      const key = normalizeSearch(rawTxt).slice(0, 90)
      if (!key || seenLearnedNorm.has(key)) return false
      seenLearnedNorm.add(key)
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
    .slice(0, 16)
    .map((r, i) => {
      const scopeTag = Number(r.store_id) === storeId ? ` [${dispName}]` : ""
      const txt = String(lang === "en" ? r.proposed_rule_en || r.proposed_rule_es : r.proposed_rule_es || r.proposed_rule_en)
        .replace(/\s+/g, " ")
        .trim()
      return `${i + 1}.${scopeTag} ${txt}`
    })
    .join("\n")

  const baseLangAnchor =
    lang === "en"
      ? "ACTIVE BASE LANGUAGE: ENGLISH — STRICT ENGLISH LOCK ENABLED. You are speaking with an English-speaking caller. Respond 100% in warm, natural American English throughout the ENTIRE call. STRICTLY FORBIDDEN to switch to Spanish or Portuguese just because the caller has a Hispanic/bilingual accent, says Mexican food names (champurrado, tamales, mulita, asada, carnitas, quesadilla, horchata, salsa, chiles), or STT outputs a 1-word artifact ('Não', '2', 'Aló', 'rain'). Switch to Spanish ONLY if the caller explicitly requests 'en español' / 'habla español' or presses 9. NEVER respond to non-Latin road noise ('क्या से है...'). Keep all prices strictly in USD ($)."
      : "IDIOMA BASE ACTIVO: ESPAÑOL — CAMBIO INMEDIATO A INGLÉS + BLOQUEO ESTRICTO. Ya saludaste en español. REGLA CRÍTICA DE IDIOMA: (1) Si el cliente responde en INGLÉS con una oración clara de 3+ palabras (ej. 'Hello, I was wondering...', 'Hi, are you open right now?', 'How much is a party tray?') SIN haber presionado 9, CAMBIA DE INMEDIATO desde ese MISMO turno a inglés americano cálido y natural y QUÉDATE 100% BLOQUEADO EN INGLÉS el resto de la llamada incluso si tiene acento hispano o dice platillos mexicanos. (2) Si el cliente habla en español, quédate 100% EN ESPAÑOL cálido del Sur de California: **ESTÁ PROHIBIDO** saltar a inglés o portugués por palabras sueltas o artefactos STT de 1-2 palabras ('Não', '2', '¿Aló?', 'rain', 'okay', 'bye', 'delivery') ni tras mensajes de herramienta. (3) JAMÁS cambies a un 3.er idioma (portugués, coreano, chino, francés, etc.) salvo que el cliente diga una oración completa y clara de 4+ palabras en ese idioma. (4) JAMÁS respondas a ruido vial/motor no latino ('क्या से है...')."

  const callbackOutcome = schedEval.isOpenNow
    ? "confírmale con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer 'enseguida', 'de inmediato', 'ahorita', 'right away' o 'immediately')."
    : "aclárale con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos."

  const ownPromptTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
  const validCallerE164 = cleanUsTenPhone(callerNumber)
  const safeCallerE164 = validCallerE164 && !ownPromptTen.has(normalizeDigits10(validCallerE164)) ? validCallerE164 : null
  const callerLast4Spoken = safeCallerE164 ? formatBridgeLast4Spoken(safeCallerE164) : null
  // PRIVACIDAD ESTRICTA (CCPA/CPRA — Privacy by Design): callerName / callerNameSource del directorio interno o CNAM
  // son SOLO para uso interno en phone_calls (/admin/llamadas) y JAMÁS se inyectan en el prompt verbal de Kore.
  void callerName
  void callerNameSource
  const callerIdGuidanceLine = safeCallerE164 && callerLast4Spoken
    ? `   - **IDENTIFICADOR DE TELÉFONO ACTIVO (Caller ID — SOLO ÚLTIMOS 4 DÍGITOS, PRIVACIDAD ESTRICTA DE NOMBRE)**: Twilio ya detectó el teléfono desde el que llama (${safeCallerE164}, terminado en ${callerLast4Spoken}). **PROHIBIDO hacer que el cliente dicte los 10 dígitos de su teléfono**: cuando necesites datos para cualquier recado o nota de empaque, pide SIEMPRE su nombre de viva voz y en la misma pregunta SOLO confirma si podemos contactarle a este mismo número terminado en ${callerLast4Spoken} (ES: "¿Me compartes tu nombre y me confirmas si te podemos contactar a este mismo número terminado en ${callerLast4Spoken}, o prefieres otro?" / EN: "May I have your name, and is this number ending in ${callerLast4Spoken} the best one to reach you, or would you prefer another?"). Si responde que sí o no da otro teléfono, envía \`caller_phone: "CALLER_ID"\`. Solo pide otro número de 10 dígitos si el cliente indica que prefiere uno distinto. Por privacidad, JAMÁS adivines ni asumas el nombre de quien llama.`
    : `   - **Sin Caller ID visible**: solicita amablemente nombre real y teléfono de 10 dígitos con código de área.`

  const systemText = [
    baseLangAnchor,
    "",
    `Eres Kore, recepcionista telefónica en vivo de **Tacos Gavilan** en **${spokenName}** (#${store.id}${laMeta ? `, esquina: ${lang === "en" ? laMeta.crossEn : laMeta.crossEs}` : ""}), dir: ${spokenAddr}, tel: ${store.phone}, CA, EE. UU. Eres mujer: en español usa SIEMPRE femenino ("lista", "atenta", "segura") y **PROHIBIDO decir "Listo" como muletilla** (di "Perfecto" o "Con gusto").`,
    `REGLAS INQUEBRANTABLES:`,
    `0. CERO PEDIDOS POR TELÉFONO (SOLO cuando intenten hacer un pedido NUEVO): Aplica esta regla ÚNICAMENTE si el cliente realmente intenta pedir comida nueva por teléfono ('quiero dos tacos...', 'dame...', 'puedo pedir...', 'can I order...'). **NO la dispares** ante saludos ('Hola'/'Hello'), preguntas de horario/precio/menú, quejas de higiene/comida o notas de órdenes ya hechas. Cuando sí intenten ordenar por teléfono: ${schedEval.isOpenNow ? `dile amablemente (SIN decir 'por el momento' ni 'políticas'/'policy') que **no tomamos órdenes por teléfono** e invítalo a ordenar en **tacosgavilan.com** (para recoger o delivery vía order.online)${store.has_drive_thru ? " o directamente en caja o Drive-Thru" : " o directamente en caja"}` : `aclara PRIMERO que **en este momento estamos cerrados** (no le pidas ordenar ahorita en tacosgavilan.com como si estuviéramos abiertos; indícale cuándo reabrimos para ordenar en tacosgavilan.com${store.has_drive_thru ? ", caja o Drive-Thru" : " o caja"})`}. PROHIBIDO actuar como cajera ('¿Regular o Super?', '¿qué carne?') o decir 'políticas'/'policy'. Si mencionan platillos, solo da precios unitarios en USD (Regular y Super sin preguntar preferencia).`,
    `1. MARCA Y MONEDA: Estrictamente **Tacos Gavilan** (JAMÁS 'Tacos El Gavilan'). Precios siempre en **USD ($)** (JAMÁS 'pesos'/'MXN').`,
    `2. VOZ EN VIVO: Cálida, directa, 1-2 oraciones (8-20 palabras; hasta 55 al cotizar varios ítems o Fiesta Platters). CERO muletillas iniciales ('¡Sí!', '¡Claro que sí!', '¡Por supuesto!', '¡Hola!'). Ya saludaste: NO re-saludes. CERO etiquetas de control (nunca escribas <speech> ni {pause}). Si preguntan si grabamos su voz: 'No guardamos grabaciones de tu voz; la llamada solo se transcribe en texto al momento para atenderte.'`,
    `3. LOS ÁNGELES (#5, #6 y #7): PROHIBIDO decir solo 'Broadway', 'Central', 'Slauson', 'sucursal de Vernon y Broadway' o 'sucursal de Slauson y Broadway'. Di SIEMPRE **Los Ángeles** + esquina oficial sin abreviar calles: #5 **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway); #6 **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, Drive-Thru; salón comedor cierra 1h antes que Drive-Thru en días regulares y Black Friday/1 ene — SIEMPRE menciona ambas horas en #6 — EXCEPTO Thanksgiving, 24 dic y 31 dic donde Comedor y Drive-Thru cierran juntos a las 4:00 PM); #7 **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway).`,
    `4. HORARIOS Y DESAYUNOS AQUÍ — ⚠️ **RELOJ OFICIAL DE CALIFORNIA (IGNORA TU RELOJ UTC)**: AHORA MISMO ES **${BRIDGE_DAY_NAMES_ES[pt.dayOfWeek].toUpperCase()} ${pt.dateStr}, ${fmt12h(`${pt.hour}:${pt.minute}`)} PT** (${BRIDGE_DAY_NAMES_EN[pt.dayOfWeek]} ${pt.dateStr}, ${fmt12h(`${pt.hour}:${pt.minute}`)} PT)${pt.hour < 6 ? " — MADRUGADA: si reabrimos esta mañana di 'hoy'/'today', JAMÁS 'mañana'/'tomorrow'" : ""}:`,
    `   - **ESTADO ACTUAL AHORA MISMO (${fmt12h(`${pt.hour}:${pt.minute}`)} PT)**: ${schedEval.statusEs} / ${schedEval.statusEn}`,
    (schedEval as any).isSpilloverActive
      ? `   - **⚠️ TURNO NOCTURNO ACTIVO AHORA (PRIORIDAD #1 EN MADRUGADA)**: Si el cliente pregunta a qué hora cerramos ahorita o por qué está cerrado el comedor, responde PRIMERO con el turno nocturno activo arriba (ej. Comedor 1:00 AM / Drive-Thru 2:00 AM) y JAMÁS digas que "ya cerramos a las 4 PM" en plena madrugada.`
      : "",
    !schedEval.isOpenNow
      ? `   - **⚠️ ANCLA ANTI-ERROR DE DÍA Y POLARIDAD (CERRADO AHORA)**: AUNQUE YA CERRAMOS POR HOY, **HOY SIGUE SIENDO ${BRIDGE_DAY_NAMES_ES[pt.dayOfWeek].toUpperCase()} ${pt.dateStr}** y **MAÑANA ES ${(next7Days[1]?.dayEs || "").toUpperCase()} ${next7Days[1]?.dateStr || ""}** — JAMÁS llames 'hoy' al día de mañana ni 'mañana' a pasado mañana (ante pregunta de 'horarios', INVOCA \`get_store_hours_and_status\`). Si preguntan '¿están abiertos?' / 'are you open right now?', inicia rotundo: **"No, en este momento estamos CERRADOS..."** / **"No, we are currently CLOSED right now..."**. Si preguntan '¿están cerrados?' / 'are you closed?', responde: **"Así es, en este momento estamos cerrados..."** / **"Yes, we are currently closed..."** (JAMÁS digas "No, estamos cerrados").`
      : "",
    `   - **CALENDARIO REAL DE LOS PRÓXIMOS 7 DÍAS (FESTIVOS YA APLICADOS — PRIORIDAD ABSOLUTA SOBRE HORARIO SEMANAL REGULAR)**:\n${next7PrimaryLines}\n     * Resto de la semana: ${next7RestCompact}`,
    `   - **REGLA CRÍTICA DE HORARIOS POR DÍA**: Si preguntan por "mañana", "pasado mañana", "el jueves", "el viernes" o cualquier día de esta semana (AUNQUE NO MENCIONEN el nombre del festivo), responde SIEMPRE con el horario del **CALENDARIO REAL DE LOS PRÓXIMOS 7 DÍAS** de arriba (JAMÁS uses el horario semanal regular para una fecha marcada con ⚠️ FESTIVO ESPECIAL).`,
    `   - Próximos festivos con fecha exacta: ${upcomingHolidaysExactLine || "Cerrado Viernes Santo y Navidad (25 dic); cierra 4:00 PM Thanksgiving, 24 dic y 31 dic; abre 11:00 AM 1 ene y Black Friday."}`,
    `   - Horario semanal regular (SOLO días SIN festivo): ${compactWeeklySummary(store.weekly_hours)}. Desayunos en las 15 tiendas: apertura a **2:00 PM** (${pt.isBreakfastOpen && schedEval.isOpenNow ? "DISPONIBLES AHORA" : "YA TERMINARON HOY"}). **Café de Olla tradicional, Café Regular (16 oz) y Champurrado (16 oz y Caja 96 oz) TODO EL DÍA**.`,
    `5. DRIVE-THRU, EBT Y OTRAS SUCURSALES:`,
    `   - Aquí: ${store.has_drive_thru ? "SÍ tenemos Drive-Thru." : "NO tenemos Drive-Thru (solo comedor y mostrador)."} Las 6 con Drive-Thru: West Covina (#3), Los Ángeles Central y Washington (#6), La Puente (#10), Norwalk (#12), Lynwood (#14) y South Gate (#15).`,
    `   - EBT CalFresh aquí: ${config.accepts_ebt ? "SÍ aceptamos EBT ÚNICAMENTE adentro en mostrador del comedor; JAMÁS por Drive-Thru." : "NO aceptamos EBT aquí (#1 Rialto y #9 Santa Ana no aceptan EBT); sí efectivo, tarjetas y Apple/Google Pay."}`,
    `   - IDs de las 15 sucursales: ${storeIdMapLine}. Para dirección, teléfono u horario en vivo de OTRA sucursal invoca SIEMPRE \`find_other_stores\`.`,
    `6. MENÚ POR VOZ, REGULAR/SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - **RECITA EL MENÚ POR VOZ**: Si preguntan qué vendemos o el menú completo, NUNCA los mandes a tacosgavilan.com a verlo ni omitas categorías: incluye **Taco Plate (3 tacos con arroz y frijol)**, **Platos completos**, **Desayunos (hasta 2 PM)**, **Tacos, Burritos (Regular, Super y Meat Only), Quesadillas, Mulitas, Tortas (Asada, Pastor, Milanesa, Cubana, etc.), Sopes (sin lechuga), Super Nachos**, **8 carnes** (Asada, Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo, Carnitas), **Aguas Frescas (Horchata, Jamaica, Piña, Tamarindo), sodas, agua, Café y Champurrado todo el día**, **Flan y Cheesecake** individuales y **Fiesta Platters**.`,
    `   - Jamás digas 'tamaño'/'size' en comida: es **Regular** o **Super** (Burrito Reg = carne/arroz/frijol; Super +queso/guacamole/crema; Mulita/Quesadilla Reg ya llevan queso y Super +guacamole/crema). **BURRITOS MITAD Y MITAD ($0.00 EXTRA)**: en todos los Burritos (Regular, Super, Meat Only y Meat Only Super) SÍ se puede combinar mitad y mitad (50%/50%) de 2 carnes sin cargo extra, además de opciones sin costo en caja como Carne Dorada, Tortilla Dorada y Partido en Dos. **CAFÉ DE OLLA (16 oz)**: manejamos tanto **Café de Olla tradicional** como **Café Regular** todo el día (mismo precio de Coffee; JAMÁS niegues Café de Olla!). Bebidas frías: SOLO **Mediana 22 oz**, **Grande 32 oz** y **Galón 128 oz** (PROHIBIDO 'chica'/'small'); Champurrado solo vaso **16 oz** o Caja **96 oz**. Postres: SOLO **Flan y Cheesecake** (sin pasteles de cumpleaños ni ingreso de pasteles externos, sin churros/menudo/birria/pozole/suadero/tripa/alcohol ni descuentos por volumen). Prep pickup ~7-15 min; nacimos en 1992 (Gage y Main, LA); animales de servicio bienvenidos; empleo en tienda o tacosgavilan.com. Para dudas detalladas invoca \`search_menu_item_price\`.`,
    `   - **Fiesta Platters**: en caja, **tacosgavilan.com** (pickup o delivery vía order.online) o Uber Eats/DoorDash/Grubhub con **1h de anticipación** (invoca SIEMPRE \`get_fiesta_platter_packages\`). **Si necesitan comida para grupo en MENOS de 1h**, NO cierres la venta: ofrece **(a)** pasar al mostrador${store.has_drive_thru ? " o Drive-Thru" : ""} por órdenes individuales al momento, **O (b)** registrar \`create_manager_callback\` (\`urgency: 'high'\`) para que el gerente revise capacidad de cocina.`,
    `   - **Aclaraciones clave de menú**: NO vendemos charolas individuales de solo arroz ni champurrado por galón (arroz solo en porción individual $2.49 o incluido en Fiesta Platters; Champurrado solo vaso 16 oz $4.09 o Caja 96 oz = 3/4 galón $27.89). **Frijoles de la olla** (vasito cortesía $0) sí se pueden incluir gratis como condimento en ES y EN (distinto a un lado pagado extra).`,
    `   - Fonética STT: 'fe de la hoya'/'cafe de la hoya'/'cafe hoy'='café de olla', 'torta corona'/'crota'='torta cubana', 'sasada'/'a sada'/'salad burrito'/'pasada'/'hadas'='asada', 'adobada'/'al pasture'='pastor', 'muleta'/'malita'/'molita'='mulita', 'soapy'='sope', 'a plan'/'plans'='flan', 'whole/pot beans'='frijol de la olla ($0)', 'Dortmund'='DoorDash', 'host'/'post'='Toast', 'ibt'/'evt'/'abc'='EBT', 'dritro'/'have driver'='Drive-Thru', 'costado'='es todo', 'Centralia Washington'='Central y Washington'.`,
    `7. RECADOS AL GERENTE Y VALIDACIÓN DE TICKET (CERO TRANSFERENCIAS — PROHIBIDO PROMETER CONECTAR):`,
    `   - **PROHIBIDO** decir 'connect you with the manager', 'transferir la llamada', 'canalizarte' ni dar el teléfono de esta misma tienda (${store.phone}) al que YA está llamando. Aclara siempre que esta línea no transfiere directo al mostrador y que enviarás una **alerta prioritaria** a la pantalla del gerente con \`create_manager_callback\` (\`reason_summary\` SIEMPRE EN ESPAÑOL). **JAMÁS** digas 'ya envié la alerta / notifiqué al gerente' sin haber invocado \`create_manager_callback\` exitosamente primero!`,
    callerIdGuidanceLine,
    `   - **DETALLE EXACTO ANTES DE GUARDAR + RE-INVOCACIÓN OBLIGATORIA**: Pregunta qué cambio/detalle exacto y en qué platillo ANTES de llamar \`create_manager_callback\`. Si el cliente da un teléfono alterno de menos de 10 dígitos, pídele repetir los 10 dígitos completos. Si DESPUÉS de guardar el cliente agrega CUALQUIER dato nuevo, **VUELVE A INVOCAR \`create_manager_callback\` PRIMERO**.`,
    `   - **CONDIMENTOS GRATIS O MODIFICACIÓN SIN COSTO EN DOORDASH / UBER EATS / GRUBHUB / ONLINE (REGLA POR ESTATUS DE PREPARACIÓN)**: **(a) En \`IN_KITCHEN\` (PREPARACIÓN)** se permite **quitar ingredientes sin costo del MISMO platillo** (ej. **sin frijol en el burrito**, sin queso, sin cebolla, sin cilantro, sin arroz, sin crema, salsa aparte, tortillas de harina/maíz) **Y** **agregar/editar condimentos gratis** (salsas roja/verde, chiles, limones, cebollas, rábanos, servilletas, frijol de la olla cortesía); **(b) En \`READY\` / \`PACKED_AND_SEALED\`** ya NO se pueden modificar ingredientes de cocina (ni lechuga aparte, queso o guacamole), SOLO condimentos gratis de estación de empaque. **PROHIBIDO cambiar un platillo por otro distinto o más caro (ej. Burrito por Taco Plate), subir a Super o agregar comida/bebidas con costo** (\`PAID_ITEM_CHANGE_BLOCKED\` -> redirigir a Ayuda/Help de la app). **JAMÁS** digas que una orden ya 'está lista y confirmada' cuando \`send_delivery_armor_order_note\` solo devolvió \`SENT_TO_TABLET\` (solo significa que el aviso se envió a la tableta). **1)** Pide plataforma, nombre, código o 1–2 platillos y cambio/condimentos exactos; **2)** **INVOCA \`send_delivery_armor_order_note\`** (\`replace_condiments: true\` al editar); **3)** Responde con honestidad según el resultado.`,
    `   - **Uber/DoorDash/Grubhub (estatus, retrasos y reembolsos)**: para estatus invoca \`validate_order_ticket\` (código y/o \`customer_name\`). Cambios con costo, agregar comida pagada, dirección, cancelaciones o reembolsos van en **Ayuda (Help)** de su app; retrasos largos esperando repartidor -> \`create_manager_callback\` (\`reason_category: 'delivery_issue'\`).`,
    `   - **Cambio de horario en orden Toast / tacosgavilan.com**: si quiere recoger su pedido más tarde o más temprano, pide nombre, número de orden y la nueva hora exacta e **INVOCA \`request_toast_pickup_time_change\`** (valida horario real y alerta a cocina en PREPARADOR para tenerla lista a esa hora).`,
    `   - **Sucursal equivocada (ALERTA A LAS 2 SUCURSALES)**: siempre ayuda coordinando ambas tiendas: pregunta (1) en qué sucursal cayó por error (\`paid_store_id\`), (2) en cuál quiere recoger (\`prepare_store_id\`, confirmando entrecalles en Los Ángeles), (3) nombre, orden y teléfono, e **INVOCA \`coordinate_wrong_store_order\`** para mandar alerta 🛑 NO PREPARAR a la tienda equivocada y 🍳 PREPARAR AQUÍ con los platillos pagados a la que quiere el cliente. (En delivery con chofer de Uber/DD/GH aclara que el chofer va a la tienda de su app por lo que conviene cancelar en app si busca entrega a domicilio; para pickup o coordinación igual envía la alerta doble.)`,
    `   - **Fiesta Platters en plataformas (carnes/aguas/tortillas que la app no dejó elegir)**: si en Uber Eats, DoorDash, Grubhub o Online no pudo seleccionar todas las carnes/productos que quiere dentro del total de su paquete (1 sola carne o varias en libras exactas: 15-20=6 lb, 20-25=7.5 lb, 25-30=10 lb, 30-40=12 lb; ej. 12 lb = 4 Asada, 4 Pollo, 4 Pastor), pide plataforma, nombre, código/orden, tamaño y desglose exacto e **INVOCA \`send_fiesta_platter_prep_alert\`** directo a los cocineros en la tableta PREPARADOR.`,
    `   - **Faltantes / orden mal en tienda, DT o web**: pide **1) qué faltó/estuvo mal + ticket, 2) fecha, 3) nombre, 4) confirmar teléfono**, advirtiendo 1 vez que sin ticket es poco probable verificarlo. En cuanto dé número de ticket **INVOCA DE INMEDIATO \`validate_order_ticket\`** (con \`target_store_id\` si compró en otra sucursal). Si no conserva ticket usa \`'SIN TICKET'\` sin bucle. Si encuentra su comida durante la llamada, re-invoca \`create_manager_callback\` indicando que la encontró para auto-cerrar la alerta. Ejecuta la herramienta en silencio ANTES de confirmar y luego ${callbackOutcome}`,
    `   - **Objetos olvidados, empleados, proveedores o hablar con gerente**: pide nombre, confirma teléfono y motivo breve -> \`create_manager_callback\` en español y ${callbackOutcome}`,
    `8. CERO CUELGUES ANTE FRUSTRACIÓN Y CIERRE LIMPIO: Ignora ruido vial sin sentido. Si piden repetir lista, repítela completa. **PROHIBIDO \`end_call\`** si hay frustración, queja, 'me voy con la competencia', '¿por qué me colgaste?' o simple 'okay, gracias' (pregunta '¿Te puedo ayudar con algo más?'). Solo tras despedida explícita ('es todo, gracias', 'adiós', 'bye', 'that is all, thank you'), despídete en 1 oración sin preguntas e invoca \`end_call\`.`,
    "",
    `CHAROLAS FIESTA PLATTER:`,
    trayLines,
    "",
    learnedLines ? `REGLAS APRENDIDAS:\n${learnedLines}\n` : "",
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
    kbEntries: activeKbEntries,
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
  const normalized = String(raw || "").replace(/(\d{1,2}):(\d{2})/g, "$1$2")
  const digits = normalized.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : ""
  if (ten.length !== 10) return null
  if (Number(ten.slice(0, 3)) < 200 || Number(ten.slice(3, 6)) < 200) return null
  if (ten.slice(3, 6) === "555" || /^(\d)\1{9}$/.test(ten)) return null
  return `+1${ten}`
}

const EXPLICIT_GOODBYE_RE =
  /(?:^(?:todo|costado)(?:\s*,?\s*(?:muchas\s+)?gracias)?$|\b(es\s+todo|seria\s+todo|eso\s+es\s+todo|ya\s+seria\s+todo|ya\s+es\s+todo|ya\s+estuvo|testo\s+la\s+frase|nada\s+mas|solo\s+eso|no,?\s*(?:gracias|por\s+ahora|necesito|no\s+esta|no\s+mas\s+(?:queria|eso)|solo\s+(?:queria|eso))|adios|bye|hasta\s+luego|nos\s+vemos|cuidate|cuelgame|hang\s+up|que\s+tengas|buen\s+dia|buena\s+tarde|buena\s+noche|feliz\s+(?:dia|thanksgiving|navidad|ano)|felices\s+fiestas|happy\s+(?:holidays|thanksgiving|new\s+year)|merry\s+christmas|thats\s+all|that\s+is\s+all|thats\s+it|that\s+is\s+it|nothing\s+else|no,?\s*thank(?:s|\s+you)|(?:im|were)\s+(?:good|fine|all\s+set)|all\s+set|all\s+done|no\s+(?:more|other)\s+questions|have\s+a\s+(?:good|great|nice|wonderful)|goodbye)\b)/i

const ACK_ONLY_NO_GOODBYE_RE =
  /^(?:(?:ok(?:ay)?|okey|vale|sale|bien|bueno|esta\s+bien|de\s+acuerdo|muy\s+bien|perfecto|entendido|claro|listo|excelente|genial|va|ya|aha|aja|sip?|yeah?|yep|got\s+it|alright|all\s+right|sounds\s+good|very\s+good|good|nice|cool|fine)(?:[\s,]+(?:muchas\s+)?(?:gracias|thank\s+you|thanks|por\s+favor))?|(?:muchas\s+)?gracias|thank\s+you(?:\s+very\s+much|\s+so\s+much)?|thanks(?:\s+a\s+lot)?)$/i

const OFFERED_FURTHER_HELP_RE =
  /\b(algo\s+mas|ayud(?:o|arte)\s+con\s+algo|otra\s+(?:pregunta|duda|consulta)|anything\s+else|help\s+you\s+with\s+anything|assist\s+you\s+with|other\s+question)\b/i

const BRIDGE_FRUSTRATION_NO_HANGUP_RE =
  /\b(competencia|competitor|otro\s+lado|otro\s+restaurante|otra\s+taqueria|somewhere\s+else|another\s+place|por\s+que\s+me\s+colg(?:aste|aron)|por\s+que\s+(?:me\s+)?cuelgas?|no\s+me\s+cuelgues?|why\s+did\s+you\s+hang\s+up|dont\s+hang\s+up|do\s+not\s+hang\s+up|one\s+star|1\s+star|una\s+estrella|yelp|google\s+review|bad\s+review|resena|pesimo|mal\s+servicio|que\s+mal|eso\s+esta\s+mal|terrible|horrible|ridiculo|ridiculous|frustrad[oa]|molest[oa]|enojad[oa]|upset|angry|reclamo|queja|que\s+hago|what\s+do\s+i\s+do|no\s+sirve|no\s+me\s+ayudas?|para\s+ahorita|en\s+media\s+hora)\b/i

const BRIDGE_STRICT_FAREWELL_RE =
  /\b(adios|bye|goodbye|hasta\s+luego|nos\s+vemos|cuelgame|hang\s+up|eso\s+es\s+todo(?:\s*,?\s*gracias)?|es\s+todo\s*,?\s*gracias|seria\s+todo(?:\s*,?\s*gracias)?|no\s*,?\s*gracias\s*,?\s*(?:adios|bye|es\s+todo)|thats\s+all\s*,?\s*thank(?:s|\s+you)|that\s+is\s+all\s*,?\s*thank(?:s|\s+you)|thats\s+it\s*,?\s*thank(?:s|\s+you))\b/i

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
  if (
    /^(?:no|nao|nop|nope|solamente|no\s+solamente|solo\s+eso|todo\s+bien|ya\s+no|ninguna|no\s+esta|no\s+no\s+esta|costado)$/i.test(normU) &&
    OFFERED_FURTHER_HELP_RE.test(normA)
  ) {
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
  if (explicitHash && (/\d/.test(explicitHash[1]) || /^[A-Fa-f]{5}$/.test(explicitHash[1]))) token = explicitHash[1].trim()
  else if (/^[A-Za-z0-9][A-Za-z0-9\-]{0,19}$/.test(working) && (/\d/.test(working) || /^[A-Fa-f]{5}$/.test(working))) token = working
  else {
    const matches = Array.from(working.matchAll(/\b([A-Za-z0-9][A-Za-z0-9\-]{0,19})\b/g))
      .map((m) => m[1])
      .filter((t) => /\d/.test(t) || /^[A-Fa-f]{5}$/.test(t))
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
  const MONTH_MAP: Record<string, number> = {
    enero: 1, ene: 1, january: 1, jan: 1,
    febrero: 2, feb: 2, february: 2,
    marzo: 3, mar: 3, march: 3,
    abril: 4, abr: 4, april: 4, apr: 4,
    mayo: 5, may: 5,
    junio: 6, jun: 6, june: 6,
    julio: 7, jul: 7, july: 7,
    agosto: 8, ago: 8, august: 8, aug: 8,
    septiembre: 9, setiembre: 9, sep: 9, sept: 9, september: 9,
    octubre: 10, oct: 10, october: 10,
    noviembre: 11, nov: 11, november: 11,
    diciembre: 12, dic: 12, december: 12, dec: 12
  }
  const monthNamesPat = Object.keys(MONTH_MAP).join("|")
  const m1 = norm.match(new RegExp(`\\b(${monthNamesPat})\\s+(?:el\\s+|de\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:de|del|,)?\\s*(20\\d{2}))?\\b`))
  const m2 = !m1
    ? norm.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${monthNamesPat})(?:\\s*(?:de|del|,)?\\s*(20\\d{2}))?\\b`))
    : null
  if (m1 || m2) {
    const mm = MONTH_MAP[m1 ? m1[1] : m2![2]]
    const dd = Number(m1 ? m1[2] : m2![1])
    const explicitYearRaw = m1 ? m1[3] : m2![3]
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const baseYear = Number(base.slice(0, 4))
      let yyyy = explicitYearRaw ? Number(explicitYearRaw) : baseYear
      const candBaseYear = `${String(baseYear).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      // Si el cliente dijo el año pasado por desliz verbal ("noviembre 24 del 2025" siendo 25 nov 2026), corregir al año actual
      if (explicitYearRaw && yyyy === baseYear - 1) {
        const diffDays = Math.abs(
          Math.round((new Date(`${candBaseYear}T12:00:00Z`).getTime() - new Date(`${base}T12:00:00Z`).getTime()) / 86400000)
        )
        if (diffDays <= 21 && candBaseYear <= shiftBridgeIsoDays(base, 1)) {
          yyyy = baseYear
        }
      }
      const cand = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      if (!explicitYearRaw && cand > shiftBridgeIsoDays(base, 2)) yyyy -= 1
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

async function postBridgeDeliveryArmorPhoneNote(params: {
  storeId: number
  callSid: string
  callId?: string | null
  callbackId?: string | null
  platform?: string | null
  customerName: string
  orderCode?: string | null
  orderedItemsHint?: string | null
  callerName?: string | null
  callerPhone?: string | null
  requestType?: string | null
  noteSummaryEs: string
  noteSummaryEn?: string | null
  requestedCondiments?: string[]
  itemModifications?: string[]
  replaceCondiments?: boolean
  confirmSaveUnmatched?: boolean
  businessDate: string
}): Promise<Record<string, any>> {
  const secrets = await loadSecrets()
  if (secrets.publicAppBaseUrl && secrets.ttsSigningSecret) {
    try {
      const ts = String(Date.now())
      const canonical = `${params.storeId}|${params.callSid}|${params.customerName}|${ts}`
      const sig = await hmacSha256Hex(secrets.ttsSigningSecret, canonical)
      const res = await fetch(`${secrets.publicAppBaseUrl}/api/delivery-armor/phone-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: params.storeId,
          source: "twilio",
          callSid: params.callSid,
          callId: params.callId || null,
          callbackId: params.callbackId || null,
          platform: params.platform || null,
          customerName: params.customerName,
          orderCode: params.orderCode || null,
          orderedItemsHint: params.orderedItemsHint || null,
          callerName: params.callerName || params.customerName,
          callerPhone: params.callerPhone || null,
          requestType: params.requestType || "condiments",
          noteSummaryEs: params.noteSummaryEs,
          noteSummaryEn: params.noteSummaryEn || null,
          requestedCondiments: params.requestedCondiments || [],
          itemModifications: params.itemModifications || [],
          replaceCondiments: Boolean(params.replaceCondiments),
          confirmSaveUnmatched: Boolean(params.confirmSaveUnmatched),
          ts,
          sig
        }),
        signal: AbortSignal.timeout(6500)
      })
      if (res.ok) {
        const j = await res.json().catch(() => null)
        if (j && typeof j === "object" && typeof j.outcome === "string") {
          return j
        }
      }
    } catch {
      // Continuar con respaldo directo a Supabase si Vercel no responde o está en despliegue
    }
  }

  // Respaldo directo a Supabase + Realtime Broadcast para cero pérdida incluso durante un deploy de Vercel
  const platRaw = normalizeSearch(params.platform || "")
  const normPlat = /doordash|door dash|dd|caviar|dortmund/.test(platRaw)
    ? "DOORDASH"
    : /uber|postmates/.test(platRaw)
      ? "UBER_EATS"
      : /grubhub|gh/.test(platRaw)
        ? "GRUBHUB"
        : /toast|online|tacosgavilan/.test(platRaw)
          ? "TOAST_ONLINE"
          : "OTHER"
  const conds = Array.isArray(params.requestedCondiments) ? params.requestedCondiments.filter(Boolean) : []
  const mods = Array.isArray(params.itemModifications) ? params.itemModifications.filter(Boolean) : []
  const reqType =
    conds.length > 0 && mods.length > 0
      ? "both"
      : params.requestType === "item_modification" || mods.length > 0
        ? "item_modification"
        : "condiments"

  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/delivery_armor_phone_notes`, {
    method: "POST",
    headers: dbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      store_id: params.storeId,
      business_date: params.businessDate,
      source: "twilio",
      call_id: params.callId || null,
      callback_id: params.callbackId || null,
      match_status: "UNMATCHED",
      platform: normPlat,
      platform_order_key: params.orderCode || null,
      short_order_key: params.orderCode || null,
      order_customer_name: params.customerName,
      order_stage_at_alert: "UNMATCHED",
      caller_name: params.callerName || params.customerName,
      caller_phone: params.callerPhone || null,
      request_type: reqType,
      note_summary_es: params.noteSummaryEs,
      note_summary_en: params.noteSummaryEn || null,
      requested_condiments: conds,
      item_modifications: mods,
      ordered_items_hint: params.orderedItemsHint || null,
      status: "pending"
    })
  }).catch(() => null)
  const rows = insRes && insRes.ok ? await insRes.json().catch(() => []) : []
  const noteId = Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : ""
  if (noteId) {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({
        messages: [
          {
            topic: `blindaje-delivery-phone-notes-${params.storeId}`,
            event: "phone_note_updated",
            payload: { storeId: params.storeId, noteId, toastOrderGuid: null, status: "pending", ts: Date.now() }
          }
        ]
      })
    }).catch(() => null)
  }
  return {
    ok: Boolean(noteId),
    outcome: "SENT_UNMATCHED_BANNER",
    note: noteId ? { id: noteId, noteSummaryEs: params.noteSummaryEs, platform: normPlat } : null,
    messageEs:
      "Aviso enviado en vivo a la barra superior de la tableta de Delivery Armor para la cajera de empaque; incluirán tus condimentos o ajuste siempre que la orden aún no haya salido.",
    messageEn:
      "Live alert sent to the top banner of our Delivery Armor packing tablet for the packing cashier; they will include your condiments or adjustment as long as the order has not left yet."
  }
}

async function postBridgeKitchenOrderAlert(
  mode: "pickup_time_change" | "wrong_store_transfer" | "fiesta_platter_custom",
  params: Record<string, any> & { storeId: number; callSid: string; customerName: string; businessDate: string }
): Promise<Record<string, any>> {
  const secrets = await loadSecrets()
  if (secrets.publicAppBaseUrl && secrets.ttsSigningSecret) {
    try {
      const ts = String(Date.now())
      const canonical = `${params.storeId}|${params.callSid}|${params.customerName}|${ts}`
      const sig = await hmacSha256Hex(secrets.ttsSigningSecret, canonical)
      const res = await fetch(`${secrets.publicAppBaseUrl}/api/delivery-armor/phone-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          mode,
          source: "twilio",
          ts,
          sig
        }),
        signal: AbortSignal.timeout(8000)
      })
      if (res.ok) {
        const j = await res.json().catch(() => null)
        if (j && typeof j === "object" && typeof j.outcome === "string") {
          return j
        }
      }
    } catch {
      // Continuar con respaldo directo a Supabase si Vercel no responde o está desplegando
    }
  }

  // Respaldo directo a Supabase + Realtime Broadcast para cero pérdida ante deploy de Vercel
  const emitPing = async (stId: number, noteId: string) => {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({
        messages: [
          {
            topic: `blindaje-delivery-phone-notes-${stId}`,
            event: "phone_note_updated",
            payload: { storeId: stId, noteId, toastOrderGuid: null, status: "pending", ts: Date.now() }
          }
        ]
      })
    }).catch(() => null)
  }

  if (mode === "wrong_store_transfer") {
    const paidStoreId = Number(params.paidStoreId || params.storeId)
    const prepareStoreId = Number(params.prepareStoreId)
    if (!Number.isInteger(prepareStoreId) || prepareStoreId <= 0 || paidStoreId === prepareStoreId) {
      return {
        ok: false,
        outcome: "MISSING_INFO",
        messageEs: "Confirma con el cliente las 2 sucursales distintas: donde cayó el pedido y donde desea recoger.",
        messageEn: "Confirm both distinct stores with the caller: where the order landed and where they want to pick up."
      }
    }
    const orderRef = params.orderCode ? `#${String(params.orderCode).replace(/^#/, "").trim()}` : "Sin número"
    const stopRes = await fetch(`${SUPABASE_URL}/rest/v1/delivery_armor_phone_notes`, {
      method: "POST",
      headers: { ...dbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: paidStoreId,
        origin_store_id: Number(params.calledStoreId || params.storeId) || null,
        related_store_id: prepareStoreId,
        business_date: params.businessDate,
        source: "twilio",
        call_id: params.callId || null,
        match_status: "UNMATCHED",
        platform: "TOAST_ONLINE",
        short_order_key: orderRef !== "Sin número" ? orderRef : null,
        order_customer_name: params.customerName,
        caller_name: params.customerName,
        caller_phone: params.callerPhone || null,
        request_type: "wrong_store_stop",
        note_summary_es: `🛑 NO PREPARAR — SUCURSAL EQUIVOCADA: Orden ${orderRef} de ${params.customerName} se movió a otra sucursal. NO cocinar ni empacar aquí.`,
        note_summary_en: `🛑 DO NOT PREPARE — WRONG LOCATION: Order ${orderRef} for ${params.customerName} moved to another store. DO NOT cook or pack here.`,
        ordered_items_hint: params.orderedItemsHint || null,
        requested_pickup_time: params.requestedPickupTime || null,
        status: "pending"
      })
    }).catch(() => null)
    const prepRes = await fetch(`${SUPABASE_URL}/rest/v1/delivery_armor_phone_notes`, {
      method: "POST",
      headers: { ...dbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: prepareStoreId,
        origin_store_id: Number(params.calledStoreId || params.storeId) || null,
        related_store_id: paidStoreId,
        business_date: params.businessDate,
        source: "twilio",
        call_id: params.callId || null,
        match_status: "UNMATCHED",
        platform: "TOAST_ONLINE",
        short_order_key: orderRef !== "Sin número" ? orderRef : null,
        order_customer_name: params.customerName,
        caller_name: params.customerName,
        caller_phone: params.callerPhone || null,
        request_type: "wrong_store_prepare",
        note_summary_es: `🍳 PREPARAR AQUÍ — ORDEN PAGADA EN OTRA SUCURSAL: Cliente ${params.customerName} recogerá aquí (orden ${orderRef}).`,
        note_summary_en: `🍳 PREPARE HERE — PAID AT ANOTHER LOCATION: Customer ${params.customerName} will pick up here (order ${orderRef}).`,
        ordered_items_hint: params.orderedItemsHint || null,
        requested_pickup_time: params.requestedPickupTime || null,
        status: "pending"
      })
    }).catch(() => null)
    const stopRows = stopRes && stopRes.ok ? await stopRes.json().catch(() => []) : []
    const prepRows = prepRes && prepRes.ok ? await prepRes.json().catch(() => []) : []
    const sId = Array.isArray(stopRows) && stopRows[0]?.id ? String(stopRows[0].id) : ""
    const pId = Array.isArray(prepRows) && prepRows[0]?.id ? String(prepRows[0].id) : ""
    if (sId) await emitPing(paidStoreId, sId)
    if (pId) await emitPing(prepareStoreId, pId)
    return {
      ok: Boolean(sId && pId),
      outcome: "DUAL_ALERTS_SENT_UNMATCHED",
      messageEs: "Ya enviamos la alerta en vivo a ambas sucursales: donde cayó el pedido para que NO lo preparen, y donde deseas recoger para que te lo preparen allá.",
      messageEn: "We sent live alerts to both locations: DO NOT prepare at the wrong store, and PREPARE HERE at your preferred location."
    }
  }

  const reqType = mode === "pickup_time_change" ? "pickup_time_change" : "fiesta_platter_custom"
  const fallbackSummaryEs =
    mode === "pickup_time_change"
      ? `⏰ CAMBIO DE HORARIO TOAST: Cliente ${params.customerName} solicita recoger a las ${params.requestedPickupTime || "horario indicado"}.`
      : `🎉 FIESTA PLATTER (${params.packageSize || "personalizado"}) — INSTRUCCIÓN COCINEROS para ${params.customerName}.`
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/delivery_armor_phone_notes`, {
    method: "POST",
    headers: { ...dbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      store_id: params.storeId,
      business_date: params.businessDate,
      source: "twilio",
      call_id: params.callId || null,
      match_status: "UNMATCHED",
      platform: mode === "pickup_time_change" ? "TOAST_ONLINE" : "OTHER",
      short_order_key: params.orderCode ? String(params.orderCode).trim() : null,
      order_customer_name: params.customerName,
      caller_name: params.customerName,
      caller_phone: params.callerPhone || null,
      request_type: reqType,
      note_summary_es: fallbackSummaryEs,
      ordered_items_hint: params.orderedItemsHint || null,
      requested_pickup_time: params.requestedPickupTime || null,
      status: "pending"
    })
  }).catch(() => null)
  const rows = insRes && insRes.ok ? await insRes.json().catch(() => []) : []
  const noteId = Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : ""
  if (noteId) await emitPing(params.storeId, noteId)
  return {
    ok: Boolean(noteId),
    outcome: mode === "pickup_time_change" ? "SENT_UNMATCHED_ALERT" : "SENT_UNMATCHED_TO_PREPARADOR",
    messageEs: "Alerta enviada en vivo a la tableta PREPARADOR de cocina.",
    messageEn: "Live alert sent to the kitchen PREPARADOR tablet."
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

  if (parsed.isNoTicket && cleanCust.length < 3) {
    return {
      ok: true,
      found: false,
      skippedNoTicket: true,
      ticketNumber: "SIN TICKET",
      businessDate,
      storeName: storeNameEs,
      storeNameEn,
      messageEs: `No se buscó ticket porque el cliente indicó SIN TICKET. **PROHIBIDO decirle que localizaste su orden**; continúa tomando el recado al gerente con SIN TICKET.`,
      messageEn: `No order lookup was matched because the caller has no ticket (SIN TICKET). **DO NOT tell the caller you located their order**; proceed with taking the manager callback using SIN TICKET.`
    }
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
          messageEs: `El ticket #${hit.ticketNumber} del ${businessDate} en ${storeNameEs} SÍ existe en nuestro sistema (${hit.channel}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirma con amabilidad que ya localizaste su orden y pide solo lo que falte (nombre y confirmar su Caller ID o teléfono alterno) para enviar la alerta al gerente.`,
          messageEn: `Ticket #${hit.ticketNumber} on ${businessDate} at ${storeNameEn} WAS FOUND in our system (${hit.channel}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirm you located their order and ask only for any missing info (name and confirming their Caller ID number or an alternate number) to send the manager alert.`
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
    // Privacidad estricta: si el cliente dio su nombre y NO coincide con el nombre en el ticket, JAMÁS exponer el nombre privado del otro cliente!
    const normHitCust = normalizeSearch(hit.customerName || "")
    const normAskedCust = normalizeSearch(cleanCust || "")
    const hitFirst = normHitCust.split(" ")[0] || ""
    const askedFirst = normAskedCust.split(" ")[0] || ""
    const hasNameMismatch = Boolean(
      hitFirst.length >= 3 &&
      askedFirst.length >= 3 &&
      hitFirst !== askedFirst &&
      !normHitCust.includes(askedFirst) &&
      !normAskedCust.includes(hitFirst)
    )
    if (hasNameMismatch) {
      return {
        ok: true,
        found: false,
        nameMismatch: true,
        ticketNumber: hit.ticketNumber,
        businessDate,
        storeName: storeNameEs,
        storeNameEn,
        observedRange,
        toastNetworkError: false,
        messageEs: `El ticket #${hit.ticketNumber} del ${businessDate} en ${storeNameEs} aparece bajo otro nombre distinto a "${cleanCust}" (por privacidad NO menciones el nombre de otra persona). Pídele confirmar la fecha exacta de compra, la sucursal o el número de ticket, y si sigue sin coincidir registra el recado al gerente para revisión.`,
        messageEn: `Ticket #${hit.ticketNumber} on ${businessDate} at ${storeNameEn} is registered under a different name than "${cleanCust}" (for privacy DO NOT disclose the other customer's name). Ask them to verify the exact purchase date, branch, or ticket number, and offer to log a manager callback to review it.`
      }
    }
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
      messageEs: `La orden #${hit.ticketNumber}${custSuffix} del ${businessDate} en ${storeNameEs} SÍ existe en nuestro sistema (${hit.channel}${statusSuffix}${hit.itemsSummary ? `: ${hit.itemsSummary}` : ""}). Confirma con claridad este dato real y pide únicamente lo que falte (nombre y confirmar su Caller ID o teléfono alterno si aplica) para el gerente.`,
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
      messageEs: `La verificación en línea del ticket #${parsed.ticketNumber || cleanCust} no está disponible en este instante${rangeHintEs} (**PROHIBIDO decir que el ticket no existe**); informa que la consulta en línea no está disponible ahora y confirma su nombre y su Caller ID (o un número alterno de 10 dígitos) para que el gerente en ${storeNameEs} lo revise directamente.`,
      messageEn: `Live verification for ticket #${parsed.ticketNumber || cleanCust} is momentarily unavailable${rangeHintEn} (**DO NOT tell the caller the ticket does not exist**); explain that live lookup is unavailable right now and confirm their name and Caller ID (or an alternate 10-digit number) so the manager at ${storeNameEn} can check it directly.`
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
  kbEntries?: any[]
  lang: PhoneLang
  callerNumber: string
  recentUserText: string
  allUserText?: string
  lastUserText: string
  prevAssistantText: string
}): Promise<{
  response: Record<string, unknown>
  shouldEndCall: boolean
  hadCallback: boolean
  callbackMeta?: { id: string | null; summary: string; callerName: string; ticket: string | null; category: string }
}> {
  const {
    toolName,
    toolArgs,
    callSid,
    store,
    stores,
    config,
    specialHours,
    menuItems,
    kbEntries,
    lang,
    callerNumber,
    recentUserText,
    allUserText,
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
            "PROHIBIDO COLGAR O DESPEDIRTE: el cliente expresó frustración, queja o dijo 'me voy con la competencia' sin despedirse explícitamente. Retén al cliente con total empatía SIN cortar la llamada: ofrécele pasar directo al mostrador o Drive-Thru para preparar al momento órdenes individuales recién hechas (tacos, burritos, mulitas o platos), O confirmar su nombre y número del Caller ID (o uno alterno) con create_manager_callback (urgency: 'high') para que el gerente en turno revise capacidad de cocina de inmediato."
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

  if (toolName === "send_delivery_armor_order_note") {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isInteger(reqTargetId) && reqTargetId > 0 ? stores.find((s) => Number(s.id) === reqTargetId) || store : store
    const customerNameArg = String(toolArgs?.customer_name || "").replace(/\s+/g, " ").trim()
    const rawPlatformArg = String(toolArgs?.platform || "").trim()
    const orderCodeArg = String(toolArgs?.order_code || "").trim()
    const orderedItemsArg = String(toolArgs?.ordered_items || "").trim()
    const rawConds = Array.isArray(toolArgs?.requested_condiments)
      ? toolArgs.requested_condiments.map((x: any) => String(x || "").trim()).filter(Boolean)
      : []
    const rawMods = Array.isArray(toolArgs?.item_modifications)
      ? toolArgs.item_modifications.map((x: any) => String(x || "").trim()).filter(Boolean)
      : []
    const rawSummary = String(toolArgs?.note_summary_es || "").replace(/\s+/g, " ").trim()
    const summaryEs = normalizeCallbackReasonToSpanish(
      rawSummary ||
        [
          rawConds.length > 0 ? `Condimentos gratis: ${rawConds.join(", ")}` : "",
          rawMods.length > 0 ? `Modificación: ${rawMods.join("; ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ")
    )
    const summaryEn = toolArgs?.note_summary_en ? String(toolArgs.note_summary_en).replace(/\s+/g, " ").trim() : null

    if (!customerNameArg || customerNameArg.length < 2) {
      return {
        response: {
          ok: false,
          outcome: "MISSING_INFO",
          message: "Pide primero el nombre exacto como aparece en la orden de DoorDash, Uber Eats o Grubhub."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }
    if (!summaryEs || summaryEs.length < 4) {
      return {
        response: {
          ok: false,
          outcome: "MISSING_INFO",
          message: "Pregunta primero exactamente qué condimentos gratis o qué modificación sin costo (y en qué platillo) necesita."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    // Blindaje determinista en vivo contra cambios de platillo con costo (ej. Burrito -> Taco Plate, Regular -> Super, extras pagados)
    const bridgeModIntent = normalizeSearch([summaryEs, summaryEn || "", ...rawMods].join(" "))
    const BRIDGE_DISH_FAMILIES_RE =
      /(?:taco\s+plates?|fiesta\s+platters?|burritos?|tacos?|platos?|plates?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|charolas?|aguas?\s+frescas?|horchatas?|jamaicas?|champurrados?|flan(?:es)?|cheesecakes?|sodas?|bebidas?|drinks?)/
    const bridgeSwapMatch =
      bridgeModIntent.match(
        /\b(?:cambiar|cambia|change|swap|switch|replace|convertir|convert)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|my\s+|the\s+|one\s+|a\s+)?([a-z0-9\s]{2,36}?)\s+(?:por|a|para|to|for|into|with)\s+(?:un\s+|una\s+|el\s+|la\s+|a\s+|an\s+|the\s+)?([a-z0-9\s]{2,36})\b/
      ) ||
      bridgeModIntent.match(
        /\b(?:en\s+vez\s+de|en\s+lugar\s+de|instead\s+of)\s+(?:el\s+|la\s+|un\s+|una\s+|the\s+|a\s+|an\s+)?([a-z0-9\s]{2,36}?)\s+(?:quiere|quiero|poner|pon|dar|make\s+it|wants?|give\s+me|send)?\s*(?:un\s+|una\s+|el\s+|la\s+|a\s+|an\s+|the\s+)?([a-z0-9\s]{2,36})\b/
      )
    let bridgePaidDishSwap = false
    if (bridgeSwapMatch) {
      const ld = bridgeSwapMatch[1].trim().match(BRIDGE_DISH_FAMILIES_RE)?.[0] || ""
      const rd = bridgeSwapMatch[2].trim().match(BRIDGE_DISH_FAMILIES_RE)?.[0] || ""
      const normFam = (d: string) =>
        /taco\s+plate/.test(d) ? "taco_plate"
        : /^taco/.test(d) ? "taco"
        : /^burrito/.test(d) ? "burrito"
        : /^plato|^plate/.test(d) ? "plate"
        : /^quesadilla/.test(d) ? "quesadilla"
        : /^mulita/.test(d) ? "mulita"
        : /^torta/.test(d) ? "torta"
        : /^sope/.test(d) ? "sope"
        : /^nacho/.test(d) ? "nachos"
        : /fiesta|charola/.test(d) ? "platter"
        : /agua|horchata|jamaica|champurrado|soda|bebida|drink/.test(d) ? "drink"
        : /flan|cheesecake/.test(d) ? "dessert"
        : d
      if (ld && rd && normFam(ld) !== normFam(rd)) bridgePaidDishSwap = true
    }
    const bridgePaidUpgradeOrAdd =
      /\b(?:hacerlo\s+super|cambiar(?:lo)?\s+a\s+super|upgrade\s+(?:to\s+)?super|make\s+(?:it|the\s+\w+)\s+super|extra\s+(?:carne|meat|asada|pastor|pollo|queso|cheese|guacamole|aguacate|avocado|crema|sour\s+cream|arroz|rice)|(?:agregar|anadir|add)\s+(?:un|una|unos|unas|dos|tres|\d+|a|an|one|two|extra)\s+(?:burrito|taco|torta|quesadilla|mulita|sope|plato|plate|nacho|bebida|drink|horchata|jamaica|champurrado|flan|cheesecake|arroz|rice|guacamole|queso))\b/.test(
        bridgeModIntent
      )
    if (bridgePaidDishSwap || bridgePaidUpgradeOrAdd) {
      return {
        response: {
          ok: false,
          outcome: "PAID_ITEM_CHANGE_BLOCKED",
          messageEs:
            "No podemos cambiar un platillo por otro distinto, subir de Regular a Super ni agregar comida, bebidas o extras con costo por teléfono en una orden pagada. Esos cambios deben hacerse directamente en la sección de Ayuda (Help) de tu aplicación de delivery (DoorDash, Uber Eats o Grubhub). Por teléfono solo podemos quitar ingredientes sin costo si sigue en preparación o agregar condimentos gratis (salsas, chiles, limones, servilletas).",
          messageEn:
            "We cannot swap one dish for a different menu item, upgrade Regular to Super, or add paid food, drinks, or paid extras over the phone on an already-paid order. Please make paid item changes or cancellations directly in the Help section of your delivery app (DoorDash, Uber Eats, or Grubhub). By phone we can only remove no-cost ingredients while still in kitchen prep or add free condiments (salsas, jalapeños, limes, napkins)."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const rawCallerIdE164 = cleanUsTenPhone(callerNumber)
    const validCallerIdE164 = rawCallerIdE164 && !ownTen.has(normalizeDigits10(rawCallerIdE164)) ? rawCallerIdE164 : null
    const rawPhoneArg = String(toolArgs?.caller_phone || "").trim()
    const argE164 = rawPhoneArg && rawPhoneArg.toUpperCase() !== "CALLER_ID" ? cleanUsTenPhone(rawPhoneArg) : null
    const cleanPhone = (argE164 && !ownTen.has(normalizeDigits10(argE164)) ? argE164 : validCallerIdE164) || null

    let callId: string | null = null
    if (callSid) {
      const cRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id&limit=1`)
      callId = cRows[0]?.id ? String(cRows[0].id) : null
    }

    const daRes = await postBridgeDeliveryArmorPhoneNote({
      storeId: Number(destStore.id),
      callSid,
      callId,
      platform: rawPlatformArg || null,
      customerName: customerNameArg,
      orderCode: orderCodeArg || null,
      orderedItemsHint: orderedItemsArg || null,
      callerName: customerNameArg,
      callerPhone: cleanPhone,
      requestType: toolArgs?.request_type ? String(toolArgs.request_type) : null,
      noteSummaryEs: summaryEs,
      noteSummaryEn: summaryEn,
      requestedCondiments: rawConds,
      itemModifications: rawMods,
      replaceCondiments: Boolean(toolArgs?.replace_condiments),
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched),
      businessDate: pt.businessDate
    })

    if (daRes.ok && callSid) {
      const reqCat = rawMods.length > 0 ? "delivery_issue" : "condiments_note"
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          primary_intent: reqCat,
          summary: `Delivery Armor (${daRes.matchedOrder?.platform || rawPlatformArg || "Delivery"} ${daRes.matchedOrder?.shortOrderKey || orderCodeArg || customerNameArg}): ${summaryEs}`.slice(0, 320)
        })
      }).catch(() => null)
    }

    return {
      response: daRes,
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "request_toast_pickup_time_change") {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isInteger(reqTargetId) && reqTargetId > 0 ? stores.find((s) => Number(s.id) === reqTargetId) || store : store
    const customerNameArg = String(toolArgs?.customer_name || "").replace(/\s+/g, " ").trim()
    const requestedTimeArg = String(toolArgs?.requested_pickup_time || "").replace(/\s+/g, " ").trim()
    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const rawCallerIdE164 = cleanUsTenPhone(callerNumber)
    const validCallerIdE164 = rawCallerIdE164 && !ownTen.has(normalizeDigits10(rawCallerIdE164)) ? rawCallerIdE164 : null
    const rawPhoneArg = String(toolArgs?.caller_phone || "").trim()
    const argE164 = rawPhoneArg && rawPhoneArg.toUpperCase() !== "CALLER_ID" ? cleanUsTenPhone(rawPhoneArg) : null
    const cleanPhone = (argE164 && !ownTen.has(normalizeDigits10(argE164)) ? argE164 : validCallerIdE164) || null

    let callId: string | null = null
    if (callSid) {
      const cRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id&limit=1`)
      callId = cRows[0]?.id ? String(cRows[0].id) : null
    }

    const res = await postBridgeKitchenOrderAlert("pickup_time_change", {
      storeId: Number(destStore.id),
      callSid,
      callId,
      customerName: customerNameArg,
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      requestedPickupTime: requestedTimeArg,
      requestedDate: toolArgs?.requested_date ? String(toolArgs.requested_date).trim() : null,
      callerPhone: cleanPhone,
      orderedItemsHint: toolArgs?.ordered_items ? String(toolArgs.ordered_items).trim() : null,
      extraNotes: toolArgs?.extra_notes ? normalizeCallbackReasonToSpanish(String(toolArgs.extra_notes).trim()) : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched),
      businessDate: pt.businessDate
    })

    if (res.ok && callSid) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          primary_intent: "pickup_time_change",
          summary: `Cambio horario Toast (${customerNameArg} -> ${res.requestedPickupTimeFormatted || requestedTimeArg})`.slice(0, 320)
        })
      }).catch(() => null)
    }

    return { response: res, shouldEndCall: false, hadCallback: false }
  }

  if (toolName === "coordinate_wrong_store_order") {
    const paidStoreId = Number(toolArgs?.paid_store_id)
    const prepareStoreId = Number(toolArgs?.prepare_store_id)
    const customerNameArg = String(toolArgs?.customer_name || "").replace(/\s+/g, " ").trim()
    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const rawCallerIdE164 = cleanUsTenPhone(callerNumber)
    const validCallerIdE164 = rawCallerIdE164 && !ownTen.has(normalizeDigits10(rawCallerIdE164)) ? rawCallerIdE164 : null
    const rawPhoneArg = String(toolArgs?.caller_phone || "").trim()
    const argE164 = rawPhoneArg && rawPhoneArg.toUpperCase() !== "CALLER_ID" ? cleanUsTenPhone(rawPhoneArg) : null
    const cleanPhone = (argE164 && !ownTen.has(normalizeDigits10(argE164)) ? argE164 : validCallerIdE164) || null

    let callId: string | null = null
    if (callSid) {
      const cRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id&limit=1`)
      callId = cRows[0]?.id ? String(cRows[0].id) : null
    }

    const res = await postBridgeKitchenOrderAlert("wrong_store_transfer", {
      storeId: Number.isInteger(paidStoreId) && paidStoreId > 0 ? paidStoreId : Number(store.id),
      calledStoreId: Number(store.id),
      paidStoreId,
      prepareStoreId,
      callSid,
      callId,
      platform: toolArgs?.platform ? String(toolArgs.platform) : "TOAST_ONLINE",
      customerName: customerNameArg,
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      callerPhone: cleanPhone,
      orderedItemsHint: toolArgs?.ordered_items ? String(toolArgs.ordered_items).trim() : null,
      requestedPickupTime: toolArgs?.requested_pickup_time ? String(toolArgs.requested_pickup_time).trim() : null,
      extraNotes: toolArgs?.extra_notes ? normalizeCallbackReasonToSpanish(String(toolArgs.extra_notes).trim()) : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched),
      businessDate: pt.businessDate
    })

    if (res.ok && callSid) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          primary_intent: "wrong_store_order",
          summary: `Sucursal equivocada (Alerta dual #${paidStoreId} NO PREPARAR -> #${prepareStoreId} PREPARAR AQUÍ, ${customerNameArg})`.slice(0, 320)
        })
      }).catch(() => null)
    }

    return { response: res, shouldEndCall: false, hadCallback: Boolean(res.ok) }
  }

  if (toolName === "send_fiesta_platter_prep_alert") {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isInteger(reqTargetId) && reqTargetId > 0 ? stores.find((s) => Number(s.id) === reqTargetId) || store : store
    const customerNameArg = String(toolArgs?.customer_name || "").replace(/\s+/g, " ").trim()
    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const rawCallerIdE164 = cleanUsTenPhone(callerNumber)
    const validCallerIdE164 = rawCallerIdE164 && !ownTen.has(normalizeDigits10(rawCallerIdE164)) ? rawCallerIdE164 : null
    const rawPhoneArg = String(toolArgs?.caller_phone || "").trim()
    const argE164 = rawPhoneArg && rawPhoneArg.toUpperCase() !== "CALLER_ID" ? cleanUsTenPhone(rawPhoneArg) : null
    const cleanPhone = (argE164 && !ownTen.has(normalizeDigits10(argE164)) ? argE164 : validCallerIdE164) || null

    let callId: string | null = null
    if (callSid) {
      const cRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id&limit=1`)
      callId = cRows[0]?.id ? String(cRows[0].id) : null
    }

    const res = await postBridgeKitchenOrderAlert("fiesta_platter_custom", {
      storeId: Number(destStore.id),
      callSid,
      callId,
      platform: toolArgs?.platform ? String(toolArgs.platform) : null,
      customerName: customerNameArg,
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      callerPhone: cleanPhone,
      packageSize: toolArgs?.package_size ? String(toolArgs.package_size).trim() : null,
      meatBreakdown: Array.isArray(toolArgs?.meat_breakdown) ? toolArgs.meat_breakdown : null,
      aguasBreakdown: Array.isArray(toolArgs?.aguas_breakdown) ? toolArgs.aguas_breakdown : null,
      tortillasPreference: toolArgs?.tortillas_preference ? String(toolArgs.tortillas_preference).trim() : null,
      requestedCondiments: Array.isArray(toolArgs?.requested_condiments)
        ? toolArgs.requested_condiments.map(String)
        : null,
      extraNotes: toolArgs?.extra_notes ? normalizeCallbackReasonToSpanish(String(toolArgs.extra_notes).trim()) : null,
      requestedPickupTime: toolArgs?.requested_pickup_time ? String(toolArgs.requested_pickup_time).trim() : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched),
      businessDate: pt.businessDate
    })

    if (res.ok && callSid) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          primary_intent: "fiesta_platter_custom",
          summary: `Fiesta Platter PREPARADOR (${customerNameArg}, ${toolArgs?.package_size || res.spec?.packageSize || ""})`.slice(0, 320)
        })
      }).catch(() => null)
    }

    return { response: res, shouldEndCall: false, hadCallback: false }
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
    const next7Days = buildBridgeEffectiveNext7Days(store, specialHours, pt)
    const upcomingHolidays = buildBridgeUpcomingHolidays(store, specialHours, pt, 150)
    const requestedDateSchedule = resolveBridgeRequestedDateInfo(
      toolArgs?.requested_date ? String(toolArgs.requested_date) : null,
      store,
      specialHours,
      pt,
      next7Days,
      upcomingHolidays
    )
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
        todayDate: pt.dateStr,
        tomorrowDate: next7Days[1]?.dateStr || null,
        statusEs: schedEval.statusEs,
        statusEn: schedEval.statusEn,
        todaySchedule: next7Days[0] || null,
        tomorrowSchedule: next7Days[1] || null,
        dayAfterTomorrowSchedule: next7Days[2] || null,
        requestedDateSchedule,
        next7Days: next7Days.map((d) => ({
          date: d.dateStr,
          dayEs: d.dayEs,
          dayEn: d.dayEn,
          relTag: lang === "en" ? d.relTagEn : d.relTagEs,
          isSpecialHoliday: d.isSpecial,
          holidayName: d.holidayName,
          isClosedAllDay: d.isClosedAllDay,
          open: d.openFmt,
          close: d.closeFmt,
          diningRoomClose: d.diningRoomCloseFmt,
          driveThruClose: d.driveThruCloseFmt,
          summary: lang === "en" ? d.summaryEn : d.summaryEs
        })),
        upcomingHolidays: upcomingHolidays.slice(0, 7).map((h) => ({
          date: h.dateStr,
          dayEs: h.dayEs,
          dayEn: h.dayEn,
          relTag: lang === "en" ? h.relTagEn : h.relTagEs,
          holidayName: h.holidayName,
          isClosedAllDay: h.isClosedAllDay,
          open: h.openFmt,
          close: h.closeFmt,
          diningRoomClose: h.diningRoomCloseFmt,
          driveThruClose: h.driveThruCloseFmt,
          summary: lang === "en" ? h.summaryEn : h.summaryEs
        })),
        diningRoomClosingNoteEs:
          Number(store.id) === 6
            ? "ÚNICAMENTE aquí en Los Ángeles (Central y Washington) el salón comedor cierra 1 hora antes del horario publicado y el Drive-Thru permanece abierto 1 hora más hasta el cierre (EXCEPCIÓN: en Thanksgiving, Nochebuena 24 dic y Fin de Año 31 dic, Comedor y Drive-Thru cierran juntos a las 4:00 PM)."
            : "El comedor cierra a la hora oficial publicada de la sucursal.",
        diningRoomClosingNoteEn:
          Number(store.id) === 6
            ? "ONLY here at Los Angeles (Central & Washington) does the dining room close 1 hour before the published closing time while the Drive-Thru stays open 1 additional hour until close (EXCEPTION: on Thanksgiving, Christmas Eve Dec 24, and New Year's Eve Dec 31, both Dining Room and Drive-Thru close together at 4:00 PM)."
            : "The dining room closes at the published closing time.",
        regularWeeklyHoursNote:
          "SOLO para días SIN festivo. Para hoy, mañana, pasado mañana o cualquier día de esta semana USA SIEMPRE tomorrowSchedule / next7Days.",
        weeklyHours: compactWeeklySummary(store.weekly_hours)
      },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "search_menu_item_price") {
    const rawQ = String(toolArgs?.query || "")
      .replace(/\bfe\s+de\s+(?:la\s+)?(?:hoya|olla)\b/gi, "cafe de olla")
      .replace(/\bcaf[eé]\s+de\s+(?:la\s+)?hoya\b/gi, "cafe de olla")
      .replace(/\bcaf[eé]\s+hoy\b/gi, "cafe de olla")
      .replace(/\bsupreme\b|\bsupremo\b/gi, "super")
      .replace(/\bmolita(s?)\b/gi, "mulita$1")
    const qNorm = normalizeSearch(rawQ)
    const asksCoffeeOrOlla =
      !/\bfrijol(?:es)?\b|\bbeans?\b/.test(qNorm) &&
      /\b(?:cafe|cafecito|coffee|olla|hoya)\b/.test(qNorm)
    const asksHalfBurrito = /\bburritos?\b/.test(qNorm) && /\b(?:mitad|half|50|dos\s+carnes|two\s+meats|campechano)\b/.test(qNorm)
    const tokens = qNorm
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !(asksCoffeeOrOlla && w === "olla"))
    const scored = menuItems
      .map((m) => {
        const isCoffeeSku = normalizeSearch(m.name) === "coffee"
        const hay = normalizeSearch(`${m.name} ${m.category_name} ${m.description || ""}`)
        let score = qNorm && hay.includes(qNorm) ? 10 : 0
        for (const tk of tokens) if (hay.includes(tk)) score += 3
        if (asksCoffeeOrOlla && isCoffeeSku) score += 30
        return { m, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ m }) => ({
        name: m.name === "Coffee" ? "Coffee (Café de Olla / Café Regular 16 oz)" : m.name,
        category: m.category_name,
        priceUsd: `$${Number(m.price).toFixed(2)} USD`,
        description:
          m.name === "Coffee"
            ? "16 oz hot cup — serves BOTH traditional spiced Café de Olla AND Café Regular all day at the same price."
            : m.description || ""
      }))

    const kbList = Array.isArray(kbEntries) ? kbEntries : []
    const matchedPolicies = kbList
      .map((k) => {
        const hay = normalizeSearch(`${k.category || ""} ${k.title || ""} ${k.title_en || ""} ${k.answer_es || ""} ${k.answer_en || ""}`)
        let score = qNorm && hay.includes(qNorm) ? 10 : 0
        for (const tk of tokens) if (hay.includes(tk)) score += 3
        return { k, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ k }) => ({
        category: k.category,
        title: lang === "en" ? k.title_en || k.title : k.title || k.title_en,
        answer: lang === "en" ? k.answer_en || k.answer_es : k.answer_es || k.answer_en
      }))

    return {
      response: {
        storeName: dispName,
        currency: "USD",
        matchesFound: scored.length,
        items: scored,
        ...(asksHalfBurrito
          ? {
              halfAndHalfBurritoPolicy:
                lang === "en"
                  ? "All 4 Burrito categories (Regular, Super, Meat Only, Meat Only Super) can be ordered 50/50 half-and-half with any two meats at $0.00 extra charge."
                  : "En las 4 categorías de Burritos (Regular, Super, Meat Only y Meat Only Super) SÍ se puede combinar mitad y mitad (50%/50%) de dos carnes sin cargo extra ($0.00)."
            }
          : {}),
        ...(matchedPolicies.length > 0 ? { policies: matchedPolicies } : {})
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
        riceLbs: t.riceLbs,
        beansLbs: t.beansLbs,
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
        orderOnlineOnly:
          "directamente en caja/mostrador, en tacosgavilan.com (tanto para pickup como para delivery a domicilio vía order.online) y en plataformas de delivery (Uber Eats, DoorDash, Grubhub) con mínimo 1 hora de anticipación",
        orderChannelsEn:
          "in-store at the counter, online at tacosgavilan.com (for BOTH pickup and delivery via order.online), or on Uber Eats, DoorDash, and Grubhub with at least 1 hour advance notice",
        urgentUnderOneHourSolutionsEs: `Si el cliente necesita comida para el grupo en MENOS de 1 hora, NO cierres la venta: ofrécele (1) pasar directo ${walkInEs} para preparar al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, O (2) confirmar su nombre y su número del Caller ID (o uno alterno) con create_manager_callback (urgency: 'high') para que el gerente en turno revise de inmediato la capacidad de cocina.`,
        urgentUnderOneHourSolutionsEn: `If the caller needs food in LESS than 1 hour, DO NOT turn them away: proactively offer (1) coming straight ${walkInEn} to prepare fresh individual orders of tacos, burritos, mulitas, or plates on the spot, OR (2) confirming their name and Caller ID phone number (or an alternate number) via create_manager_callback (urgency: 'high') so the manager on duty can check kitchen capacity right away.`,
        recommendationEs,
        recommendationEn,
        packages: packages.map(({ package: pkg, serves, priceUsd, meatLbs, riceLbs, beansLbs, aguasGallons, cornDozens, flourDozens }) => ({
          package: pkg,
          serves,
          priceUsd,
          meatLbs,
          riceLbs,
          beansLbs,
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
    const mapStoreWithHours = (s: any) => {
      const ev = evaluateStoreSchedule(s, specialHours, pt)
      const sNext3 = buildBridgeEffectiveNext7Days(s, specialHours, pt).slice(0, 3)
      return {
        id: s.id,
        name: customerStoreDisplay(s, lang),
        spokenName: customerStoreSpoken(s, lang),
        address: expandStreetAddress(s.address || "", lang),
        phone: s.phone,
        hasDriveThru: Boolean(s.has_drive_thru),
        acceptsEbtInDiningRoom: ![1, 9].includes(Number(s.id)),
        isOpenNow: ev.isOpenNow,
        todayHours: lang === "en" ? sNext3[0]?.summaryEn : sNext3[0]?.summaryEs,
        tomorrowHours: lang === "en" ? sNext3[1]?.summaryEn : sNext3[1]?.summaryEs,
        dayAfterTomorrowHours: lang === "en" ? sNext3[2]?.summaryEn : sNext3[2]?.summaryEs,
        regularWeeklyHours: compactWeeklySummary(s.weekly_hours),
        status: lang === "en" ? ev.statusEn : ev.statusEs
      }
    }
    const list = stores
      .filter((s) => {
        if (!fNorm || /^(all|todas|todos|sucursales|stores|horarios?|hours)$/.test(fNorm)) return true
        if (fNorm.includes("drive")) return Boolean(s.has_drive_thru)
        const disp = `${customerStoreDisplay(s, "es")} ${customerStoreDisplay(s, "en")} ${s.address || ""}`
        return normalizeSearch(disp).includes(fNorm)
      })
      .map(mapStoreWithHours)
    return {
      response: { stores: list.length > 0 ? list : stores.map(mapStoreWithHours) },
      shouldEndCall: false,
      hadCallback: false
    }
  }

  if (toolName === "flag_unanswered_question") {
    const q = String(toolArgs?.question_text || "").trim().slice(0, 500)
    const isSpamRobocall =
      /\b(?:reduce\s+the\s+interest|accruing\s+on\s+your\s+balance|resolution\s+specialist|press\s+2\s+to\s+speak|debt\s+relief|auto\s+warranty|extended\s+warranty|merchant\s+cash\s+advance|social\s+security|telemarketing|robocall)\b/i.test(
        q
      )
    if (q && !isSpamRobocall) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({ unanswered_question: q })
      }).catch(() => null)
    }
    return { response: { ok: true, flaggedQuestion: isSpamRobocall ? "" : q, ignoredSpam: isSpamRobocall }, shouldEndCall: false, hadCallback: false }
  }

  if (toolName === "create_manager_callback") {
    const rawPhone = String(toolArgs?.caller_phone || "").trim()
    const ownTen = new Set([normalizeDigits10(store.phone), normalizeDigits10(config.twilio_phone_number)].filter(Boolean))
    const rawCallerIdE164 = cleanUsTenPhone(callerNumber)
    const validCallerIdE164 = rawCallerIdE164 && !ownTen.has(normalizeDigits10(rawCallerIdE164)) ? rawCallerIdE164 : null
    const rawArgE164 = rawPhone && rawPhone.toUpperCase() !== "CALLER_ID" ? cleanUsTenPhone(rawPhone) : null
    const validArgE164 = rawArgE164 && !ownTen.has(normalizeDigits10(rawArgE164)) ? rawArgE164 : null
    const rawPhoneDigits = rawPhone.replace(/(\d{1,2}):(\d{2})/g, "$1$2").replace(/\D/g, "")
    const userAttemptedIncompleteAlternatePhone =
      Boolean(rawPhone) &&
      rawPhone.toUpperCase() !== "CALLER_ID" &&
      !validArgE164 &&
      rawPhoneDigits.length >= 5 &&
      !(validCallerIdE164 && isPhoneFragmentOfCallerId(rawPhone, validCallerIdE164))

    const cleanPhone = userAttemptedIncompleteAlternatePhone
      ? null
      : validArgE164 ||
        (validCallerIdE164 &&
        (rawPhone.toUpperCase() === "CALLER_ID" || !rawPhone || isPhoneFragmentOfCallerId(rawPhone, validCallerIdE164))
          ? validCallerIdE164
          : null)

    if (!cleanPhone) {
      const last4Hint = validCallerIdE164 ? formatBridgeLast4Spoken(validCallerIdE164) : null
      return {
        response: {
          success: false,
          missingCallerPhone: true,
          incompleteAlternatePhone: userAttemptedIncompleteAlternatePhone,
          message: userAttemptedIncompleteAlternatePhone
            ? `El número alterno dictado ("${rawPhone}") está incompleto (${rawPhoneDigits.length} dígitos en vez de 10). Pídele amablemente que repita los 10 dígitos completos con código de área antes de confirmar el recado.`
            : last4Hint
              ? `Confirma si podemos llamarle a este mismo número terminado en ${last4Hint} (enviando caller_phone='CALLER_ID') o pídele el número alterno completo de 10 dígitos.`
              : "Pídele amablemente su número telefónico real de 10 dígitos con código de área antes de guardar el recado."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    const callerName = String(toolArgs?.caller_name || "").replace(/\s+/g, " ").trim()
    if (
      !callerName ||
      callerName.length < 2 ||
      /^(cliente|customer|caller|unknown|persona|usuario|n\/a|na|none|anonymous|anonimo|desconocido|not provided|driver)$/i.test(
        normalizeSearch(callerName)
      )
    ) {
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
    const rawCategory = validCats.has(mappedCat) ? mappedCat : "other"
    const userAndSummaryNorm = normalizeSearch(`${allUserText || recentUserText} ${toolArgs?.reason_summary || ""}`)
    const userExplicitWrongOrderEvidence =
      /\b(falt[oó]|faltaron|missing|incomplet[oa]|equivocad[oa]|wrong\s+(?:order|item|food|burrito|taco)|orden\s+mal|mal\s+preparad[oa]|frio|cold|cabello|pelo|hair|crudo|raw|quemad[oa]|burned|salsa\s+mal|sin\s+(?:arroz|frijol|queso|salsa|carne|bebida|horchata)|no\s+me\s+dieron|didnt\s+get|forgot\s+my|cobro\s+de\s+mas|overcharged|doble\s+cobro)\b/i.test(
        userAndSummaryNorm
      )
    const category = rawCategory === "missing_or_wrong_item" && !userExplicitWrongOrderEvidence ? "other" : rawCategory

    const validCallerTypes = new Set(["customer", "employee", "vendor", "delivery_driver", "corporate"])
    const rawCallerType = String(toolArgs?.caller_type || "customer").trim().toLowerCase()
    const callerType = validCallerTypes.has(rawCallerType) ? rawCallerType : "customer"

    const validUrgencies = new Set(["normal", "medium", "high", "urgent", "critical"])
    const rawUrgency = String(toolArgs?.urgency || "high").trim().toLowerCase()
    const urgency = category === "condiments_note" ? "normal" : validUrgencies.has(rawUrgency) ? rawUrgency : "high"

    const fullUserContext = allUserText || recentUserText
    const rawTicketArg = String(toolArgs?.ticket_or_order_number || "").trim()
    const rawTicket =
      rawTicketArg ||
      (isBridgeTicketNotFoundAdmission(fullUserContext) ? "SIN TICKET" : "")
    const rawOrderDateInput = String(toolArgs?.order_date || "").trim()
    const callerDoesNotKnowDate =
      /\b(no\s+(?:recuerdo|se|me\s+acuerdo)(?:\s+(?:la\s+)?fecha)?|dont\s+(?:remember|know)\s+(?:the\s+)?date|no\s+estoy\s+segur[oa]\s+de\s+la\s+fecha)\b/i.test(
        normalizeSearch(allUserText || recentUserText)
      )
    const rawOrderDate = rawOrderDateInput || (callerDoesNotKnowDate ? "FECHA NO RECORDADA" : "")
    const isDelivery = /\b(uber|doordash|door dash|grubhub|postmates)\b/i.test(
      normalizeSearch(`${fullUserContext} ${toolArgs?.reason_summary || ""}`)
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

    // Garantizar que phone_calls exista para que call_id jamás quede null y la deduplicación siempre funcione
    let callRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,caller_name&limit=1`)
    if (!callRows[0]?.id && callSid) {
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?on_conflict=call_sid`, {
        method: "POST",
        headers: dbHeaders({ Prefer: "resolution=ignore-duplicates" }),
        body: JSON.stringify({
          call_sid: callSid,
          store_id: store.id,
          source: "twilio",
          caller_number: callerNumber || null,
          caller_name: callerName,
          caller_name_source: "spoken",
          language: lang,
          caller_category: callerType,
          primary_intent: category,
          status: "callback_requested",
          resolved_by_ai: false,
          turns_count: 1,
          duration_seconds: 0,
          transcript: [],
          business_date: pt.businessDate,
          shift: pt.shift
        })
      }).catch(() => null)
      callRows = await pgSelect(`phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,caller_name&limit=1`)
    }
    const callId = callRows[0]?.id || null
    const callHasExistingName = Boolean(callRows[0]?.caller_name)

    const targetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isInteger(targetId) && targetId > 0 ? stores.find((s) => Number(s.id) === targetId) || store : store
    const destDisplay = customerStoreDisplay(destStore, lang)
    const destSchedEval =
      Number(destStore.id) === Number(store.id) ? schedEval : evaluateStoreSchedule(destStore, specialHours, pt)

    const ticketFormatted =
      rawTicket && rawOrderDate && !normalizeSearch(rawTicket).includes(normalizeSearch(rawOrderDate))
        ? `${rawTicket} (${rawOrderDate})`
        : rawTicket || (rawOrderDate ? `SIN TICKET (${rawOrderDate})` : null)

    const baseReason = normalizeCallbackReasonToSpanish(String(toolArgs?.reason_summary || "Solicita hablar con el gerente en turno."))
    const taggedReason =
      ticketValidationTag && !baseReason.includes(ticketValidationTag.trim()) ? `${baseReason}${ticketValidationTag}` : baseReason
    const finalSummary =
      Number(destStore.id) !== Number(store.id) && !taggedReason.includes("-> Enrutada a #")
        ? `[Llamó a #${store.id} ${dispName} -> Enrutada a #${destStore.id} ${destDisplay}] ${taggedReason}`
        : taggedReason

    const urgencyRank: Record<string, number> = { normal: 1, medium: 2, high: 3, urgent: 4, critical: 5 }
    const isResolvedByCallerNow = isBridgeFoundItemOrCancelResolution(
      String(toolArgs?.reason_summary || ""),
      lastUserText || recentUserText
    )

    const applyPatchExisting = async (existingRow: any): Promise<{ ok: boolean; savedSummary: string; savedTicket: string | null; savedId: string; resolvedNow: boolean }> => {
      const resolvedTag = isResolvedByCallerNow ? " [RESUELTO: Cliente confirmó que encontró su comida durante la llamada]" : ""
      const mergedSummary = mergeBridgeCallbackSummaries(existingRow.reason_summary || "", `${finalSummary}${resolvedTag}`)
      const prevTicket = existingRow.ticket_or_order_number ? String(existingRow.ticket_or_order_number) : null
      const nextTicketIsNoTicket = !ticketFormatted || /^SIN TICKET/i.test(ticketFormatted)
      const prevTicketIsReal = Boolean(prevTicket && !/^SIN TICKET/i.test(prevTicket))
      const mergedTicket = prevTicketIsReal && nextTicketIsNoTicket ? prevTicket : ticketFormatted || prevTicket
      const prevUrg = String(existingRow.urgency || "normal").toLowerCase()
      const mergedUrgency = isResolvedByCallerNow
        ? "normal"
        : (urgencyRank[urgency] || 1) >= (urgencyRank[prevUrg] || 1)
          ? urgency
          : prevUrg
      const prevCat = String(existingRow.reason_category || "other")
      const mergedCategory = prevCat === "condiments_note" && category !== "condiments_note" ? category : category || prevCat

      const patchBody: Record<string, unknown> = {
        caller_name: callerName,
        caller_phone: cleanPhone,
        caller_type: callerType,
        reason_category: mergedCategory,
        reason_summary: mergedSummary,
        ticket_or_order_number: mergedTicket,
        urgency: mergedUrgency,
        store_id: Number(destStore.id),
        origin_store_id: Number(destStore.id) !== Number(store.id) ? Number(store.id) : null
      }
      if (isResolvedByCallerNow) {
        patchBody.status = "resolved"
        patchBody.resolved_at = new Date().toISOString()
        patchBody.resolved_by = "Kore IA (cliente encontró su orden)"
        patchBody.resolution_notes = "El cliente confirmó durante la llamada que encontró su comida / ya no requiere seguimiento."
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests?id=eq.${existingRow.id}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify(patchBody)
      }).catch(() => null)
      return {
        ok: Boolean(patchRes && patchRes.ok),
        savedSummary: mergedSummary,
        savedTicket: mergedTicket,
        savedId: String(existingRow.id),
        resolvedNow: isResolvedByCallerNow
      }
    }

    // Verificar si ya existe un recado pendiente para esta misma llamada y fusionar sin perder datos previos
    const existingCb = callId
      ? await pgSelect(
          `phone_callback_requests?call_id=eq.${callId}&status=eq.pending&select=id,store_id,origin_store_id,caller_name,caller_phone,caller_type,urgency,reason_category,reason_summary,ticket_or_order_number&limit=1`
        )
      : []

    // COMPUERTA ANTI-RECADO VAGO: en creación inicial de missing_or_wrong_item, exigir saber QUÉ faltó o estuvo mal antes de guardar
    if (
      existingCb.length === 0 &&
      category === "missing_or_wrong_item" &&
      !isResolvedByCallerNow &&
      !hasBridgeSpecificOrderIssueDetails(String(toolArgs?.reason_summary || ""), fullUserContext)
    ) {
      return {
        response: {
          ok: false,
          success: false,
          missingOrderIssueDetails: true,
          message:
            "Aún no sabes qué platillo o artículo faltó o cuál fue el problema exacto con su orden. Pregúntale primero con amabilidad qué faltó o qué estuvo mal ANTES de registrar el recado al gerente."
        },
        shouldEndCall: false,
        hadCallback: false
      }
    }

    let savedId: string | null = null
    let savedSummary = finalSummary
    let savedTicket = ticketFormatted
    let wasUpdated = false
    let wasAutoResolved = false

    if (existingCb.length > 0) {
      const pRes = await applyPatchExisting(existingCb[0])
      savedId = pRes.savedId
      savedSummary = pRes.savedSummary
      savedTicket = pRes.savedTicket
      wasUpdated = true
      wasAutoResolved = pRes.resolvedNow
    } else {
      const insertBody: Record<string, unknown> = {
        call_id: callId,
        store_id: Number(destStore.id),
        source: "twilio",
        caller_name: callerName,
        caller_phone: cleanPhone,
        caller_type: callerType,
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
      const postRes = await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests`, {
        method: "POST",
        headers: dbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(insertBody)
      }).catch(() => null)

      if (postRes && postRes.ok) {
        const rows = await postRes.json().catch(() => null)
        if (Array.isArray(rows) && rows[0]?.id) savedId = String(rows[0].id)
      } else if (postRes && postRes.status === 409 && callId) {
        // Carrera única idx_phone_callbacks_one_pending_per_call -> fusionar vía PATCH
        const raceCb = await pgSelect(
          `phone_callback_requests?call_id=eq.${callId}&status=eq.pending&select=id,store_id,origin_store_id,caller_name,caller_phone,caller_type,urgency,reason_category,reason_summary,ticket_or_order_number&limit=1`
        )
        if (raceCb.length > 0) {
          const pRes = await applyPatchExisting(raceCb[0])
          savedId = pRes.savedId
          savedSummary = pRes.savedSummary
          savedTicket = pRes.savedTicket
          wasUpdated = true
          wasAutoResolved = pRes.resolvedNow
        }
      } else {
        console.error("[phone-live-bridge] create_manager_callback POST failed:", postRes?.status || "network_error")
        return {
          response: {
            success: false,
            error: "db_write_failed",
            message: "No se pudo guardar el recado por un error momentáneo; intenta nuevamente."
          },
          shouldEndCall: false,
          hadCallback: false
        }
      }
    }

    const callPatch: Record<string, unknown> = {
      status: wasAutoResolved ? "completed" : "callback_requested",
      resolved_by_ai: wasAutoResolved,
      primary_intent: category
    }
    if (!callHasExistingName) {
      callPatch.caller_name = callerName
      callPatch.caller_name_source = "spoken"
    }
    await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
      method: "PATCH",
      headers: dbHeaders(),
      body: JSON.stringify(callPatch)
    }).catch(() => null)

    // Red de seguridad Delivery Armor: si create_manager_callback se usó para condimentos o ajuste sin costo de DD/Uber/Grubhub,
    // encender también la alerta parpadeante en la tableta Delivery Armor ligada a este callbackId.
    const shouldMirrorToDeliveryArmor =
      !wasAutoResolved &&
      (category === "condiments_note" || (category === "delivery_issue" && isDelivery)) &&
      /\b(uber|doordash|door\s*dash|grubhub|postmates|online|tacosgavilan|salsa|limon|chile|cebolla|cilantro|queso|crema|servilleta|condimento|tortilla)\b/i.test(
        normalizeSearch(`${fullUserContext} ${savedSummary}`)
      )
    if (shouldMirrorToDeliveryArmor) {
      const inferredPlat = /doordash|door\s*dash|caviar/i.test(`${fullUserContext} ${savedSummary}`)
        ? "DOORDASH"
        : /uber|postmates/i.test(`${fullUserContext} ${savedSummary}`)
          ? "UBER_EATS"
          : /grubhub/i.test(`${fullUserContext} ${savedSummary}`)
            ? "GRUBHUB"
            : "TOAST_ONLINE"
      void postBridgeDeliveryArmorPhoneNote({
        storeId: Number(destStore.id),
        callSid,
        callId,
        callbackId: savedId,
        platform: inferredPlat,
        customerName: callerName,
        orderCode: rawTicket && !/^SIN TICKET/i.test(rawTicket) ? rawTicket : null,
        orderedItemsHint: recentUserText.slice(0, 220),
        callerName,
        callerPhone: cleanPhone,
        requestType: category === "condiments_note" ? "condiments" : "item_modification",
        noteSummaryEs: baseReason,
        confirmSaveUnmatched: true,
        businessDate: pt.businessDate
      }).catch(() => null)
    }

    return {
      response: {
        success: true,
        updatedExisting: wasUpdated,
        resolvedAutomatically: wasAutoResolved,
        callbackId: savedId,
        routedToStoreName: destDisplay,
        reasonCategory: category,
        storeOpenNow: destSchedEval.isOpenNow,
        message: wasAutoResolved
          ? `Alerta marcada automáticamente como RESUELTA en ${destDisplay} porque el cliente confirmó que encontró su comida; respóndele con calidez que qué bueno que ya la tiene.`
          : wasUpdated
            ? `Recado actualizado en vivo en la pantalla de ${destDisplay} con todos los detalles acumulados; confírmalo brevemente al cliente.`
            : category === "condiments_note"
              ? `Nota de empaque enviada en vivo a ${destDisplay}; recuérdale que se incluirán si la orden aún no ha salido.`
              : destSchedEval.isOpenNow
                ? `Alerta prioritaria enviada a la pantalla del gerente de ${destDisplay}; confirma que se comunicarán en cuanto sea posible.`
                : `Recado registrado en ${destDisplay}; como está cerrada ahora, el gerente se comunicará en cuanto abran.`
      },
      shouldEndCall: false,
      hadCallback: !wasAutoResolved,
      callbackMeta: {
        id: savedId,
        summary: savedSummary,
        callerName,
        ticket: savedTicket,
        category
      }
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
  let callerName = ""
  let callerNameSource = ""
  let authenticated = false
  let isResumeSession = false
  let strictEnglishLock = false
  let strictSpanishLock = false
  let startedAtMs = Date.now()
  let workerStartedAtMs = Date.now()
  const WORKER_CPU_REFRESH_AFTER_MS = 140_000

  let geminiWs: WebSocket | null = null
  let geminiReady = false
  let closed = false
  let isRefreshingWorker = false
  let awaitingRefreshMark = ""
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let hadCallback = false
  let latestCallbackId = ""
  let latestCallbackSummary = ""
  let latestCallbackCallerName = ""
  let latestCallbackTicket: string | null = null
  let latestIntent = "general"
  let pendingEndCall = false
  let geminiClosingForHangup = false
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
      const wantsEn =
        activeLang === "es" &&
        (detectBridgeExplicitEnglishRequest(clean) || (!strictSpanishLock && detectBridgeClearEnglishTurn(clean)))
      const wantsEs = activeLang === "en" && detectBridgeExplicitSpanishRequest(clean)
      if (wantsEn) {
        activeLang = "en"
        strictEnglishLock = true
        strictSpanishLock = false
        if (callSid) {
          void fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
            method: "PATCH",
            headers: dbHeaders(),
            body: JSON.stringify({ language: "en" })
          }).catch(() => null)
        }
        if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          try {
            geminiWs.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: "[SYSTEM LANGUAGE LOCK: ENGLISH] The caller is speaking English. Respond 100% in warm American English from now on. NEVER switch back to Spanish even if the caller has a Hispanic accent or mentions Mexican food names (champurrado, tamales, mulita, asada, carnitas, quesadilla, horchata), unless they explicitly ask for Spanish."
                        }
                      ]
                    }
                  ],
                  turnComplete: false
                }
              })
            )
          } catch {}
        }
      } else if (wantsEs) {
        activeLang = "es"
        strictEnglishLock = false
        strictSpanishLock = true
        if (callSid) {
          void fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
            method: "PATCH",
            headers: dbHeaders(),
            body: JSON.stringify({ language: "es" })
          }).catch(() => null)
        }
        if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          try {
            geminiWs.send(
              JSON.stringify({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [
                        {
                          text: "[SYSTEM LANGUAGE LOCK: ESPAÑOL] El cliente solicitó hablar en español. Responde 100% en español cálido del Sur de California a partir de ahora."
                        }
                      ]
                    }
                  ],
                  turnComplete: false
                }
              })
            )
          } catch {}
        }
      }
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

  let snapshotChain = Promise.resolve()

  const persistCallSnapshotImpl = async (isFinal: boolean) => {
    if (!authenticated || !callSid) return
    if (isFinal) {
      // Esperar cualquier herramienta en vuelo (ej. create_manager_callback) antes de sellar el cierre
      await toolChain.catch(() => null)
    }
    flushOpenUserTurn()
    flushOpenAssistantTurn()

    const userTurns = transcript.filter((t) => t.role === "user")
    const durationSeconds = Math.min(7200, Math.max(1, Math.round((Date.now() - startedAtMs) / 1000)))

    if (!isFinal) {
      const interimSummary = buildBridgeMeaningfulSummary({
        transcript,
        callbackSummary: latestCallbackSummary || null,
        callbackCallerName: latestCallbackCallerName || null,
        callbackTicket: latestCallbackTicket,
        primaryIntent: latestIntent
      })
      await fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          language: activeLang,
          turns_count: userTurns.length,
          summary: interimSummary,
          transcript
        })
      }).catch(() => null)
      return
    }

    const existingRows = await pgSelect(
      `phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,status,primary_intent,unanswered_question,ended_at,duration_seconds,caller_name&limit=1`
    )
    const existing = existingRows[0]
    let effectiveCb = hadCallback || existing?.status === "callback_requested"
    let resolvedDuringCall = false

    // RED DE SEGURIDAD POST-RECADO: si el cliente dijo detalles sustantivos DESPUÉS de create_manager_callback
    // (ej. "Just tell them no cheese" / "for the taco plate") y Gemini olvidó re-invocar la herramienta, actualizar el recado ahora
    if (effectiveCb && existing?.id) {
      const extraUserTurns = extractBridgePostCallbackUserTurns(transcript)
      const pendingCbRows = await pgSelect(
        `phone_callback_requests?call_id=eq.${existing.id}&status=eq.pending&select=id,caller_name,reason_summary,ticket_or_order_number&limit=1`
      )
      const pendingCb = pendingCbRows[0]
      if (pendingCb) {
        if (!latestCallbackId) latestCallbackId = String(pendingCb.id)
        if (!latestCallbackSummary) latestCallbackSummary = String(pendingCb.reason_summary || "")
        if (!latestCallbackCallerName) latestCallbackCallerName = String(pendingCb.caller_name || "")
        if (!latestCallbackTicket && pendingCb.ticket_or_order_number) {
          latestCallbackTicket = String(pendingCb.ticket_or_order_number)
        }
        if (extraUserTurns.length > 0) {
          const postJoined = extraUserTurns.join(" | ")
          if (isBridgeFoundItemOrCancelResolution("", postJoined)) {
            const resolvedSummary = mergeBridgeCallbackSummaries(
              String(pendingCb.reason_summary || ""),
              "[RESUELTO: Cliente confirmó durante la llamada que encontró su comida]"
            )
            await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests?id=eq.${pendingCb.id}`, {
              method: "PATCH",
              headers: dbHeaders(),
              body: JSON.stringify({
                status: "resolved",
                urgency: "normal",
                resolved_at: new Date().toISOString(),
                resolved_by: "Kore IA (cliente encontró su orden)",
                resolution_notes: "El cliente confirmó durante la llamada que encontró su comida / resolvió el inconveniente.",
                reason_summary: resolvedSummary
              })
            }).catch(() => null)
            latestCallbackSummary = resolvedSummary
            hadCallback = false
            effectiveCb = false
            resolvedDuringCall = true
          } else {
            const normExistingCb = normalizeSearch(String(pendingCb.reason_summary || ""))
            const uncaptured = extraUserTurns.filter((u) => {
              const tokens = normalizeSearch(u)
                .split(" ")
                .filter((w) => w.length >= 4 && !["just", "tell", "them", "this", "that", "with", "solo", "diles", "para", "esto"].includes(w))
              if (tokens.length === 0) return false
              return !tokens.every((tok) => normExistingCb.includes(tok))
            })
            if (uncaptured.length > 0) {
              const addendumEs = await translatePostCallbackNoteToSpanish(
                uncaptured,
                String(pendingCb.reason_summary || ""),
                secretsCache?.geminiKeys
              )
              if (addendumEs) {
                const enrichedSummary = mergeBridgeCallbackSummaries(String(pendingCb.reason_summary || ""), addendumEs)
                if (enrichedSummary && enrichedSummary !== String(pendingCb.reason_summary || "").trim()) {
                  await fetch(`${SUPABASE_URL}/rest/v1/phone_callback_requests?id=eq.${pendingCb.id}`, {
                    method: "PATCH",
                    headers: dbHeaders(),
                    body: JSON.stringify({ reason_summary: enrichedSummary })
                  }).catch(() => null)
                  latestCallbackSummary = enrichedSummary
                }
              }
            }
          }
        }
      }
    }

    const nextStatus = resolvedDuringCall
      ? "completed"
      : effectiveCb
        ? "callback_requested"
        : existing?.status && !["in_progress", "completed"].includes(existing.status)
          ? existing.status
          : "completed"
    const resolvedByAi = userTurns.length > 0 && nextStatus === "completed" && !effectiveCb && !existing?.unanswered_question
    const finalSummary = buildBridgeMeaningfulSummary({
      transcript,
      callbackSummary: latestCallbackSummary || null,
      callbackCallerName: latestCallbackCallerName || null,
      callbackTicket: latestCallbackTicket,
      primaryIntent: existing?.primary_intent || latestIntent,
      unansweredQuestion: existing?.unanswered_question || null
    })

    const patch: Record<string, unknown> = {
      language: activeLang,
      status: nextStatus,
      resolved_by_ai: resolvedByAi,
      turns_count: userTurns.length,
      summary: finalSummary,
      transcript,
      ended_at: existing?.ended_at || new Date().toISOString()
    }
    if (!existing?.caller_name && (callerName || latestCallbackCallerName)) {
      patch.caller_name = callerName || latestCallbackCallerName
      patch.caller_name_source = callerName ? callerNameSource || "twilio_cnam" : "spoken"
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

    bridgeValidatedTicketsPerCall.delete(callSid)
  }

  const persistCallSnapshot = (isFinal: boolean): Promise<void> => {
    snapshotChain = snapshotChain.then(() => persistCallSnapshotImpl(isFinal)).catch(() => undefined)
    return snapshotChain
  }

  const refreshWorkerCleanly = async () => {
    if (closed) return
    isRefreshingWorker = true
    closed = true
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    if (hangupTimer) {
      clearTimeout(hangupTimer)
      hangupTimer = null
    }
    await toolChain.catch(() => null)
    try {
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, "cpu_refresh")
    } catch {}
    await persistCallSnapshot(false)
    try {
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1000, "cpu_refresh")
    } catch {}
    resolveSessionDone()
  }

  const hangupTwilioCallCleanly = async () => {
    if (closed) return
    closed = true
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
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
          awaitingRefreshMark = ""
          if (refreshTimer) {
            clearTimeout(refreshTimer)
            refreshTimer = null
          }
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
          // Si hay texto latino real junto con ruido no-latino incrustado (ej. Devanagari), limpiar el prefijo no-latino
          if (/[\p{Script=Latin}]{2,}/u.test(openUserText) && FORBIDDEN_BRIDGE_FOREIGN_SCRIPT_RE.test(openUserText)) {
            openUserText = openUserText
              .replace(/[\p{Script=Devanagari}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Thai}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Tamil}\p{Script=Telugu}]+/gu, " ")
              .replace(/\s+/g, " ")
          }
          const trimmedIn = openUserText.replace(/\s+/g, " ").trim()
          if (/[\p{Script=Latin}0-9]/u.test(trimmedIn)) {
            suppressNoiseReplyTurn = false
            if (
              activeLang === "es" &&
              !strictSpanishLock &&
              (detectBridgeExplicitEnglishRequest(trimmedIn) || detectBridgeClearEnglishTurn(trimmedIn))
            ) {
              activeLang = "en"
              strictEnglishLock = true
              if (callSid) {
                void fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
                  method: "PATCH",
                  headers: dbHeaders(),
                  body: JSON.stringify({ language: "en" })
                }).catch(() => null)
              }
            }
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
            const sanitizedOutChunk = outChunk
              .replace(/<\/?speech[^>]*>/gi, "")
              .replace(/\{\s*pause\s*\}/gi, " ")
              .replace(/<[^>]{1,40}>/g, "")
            openAssistantText += sanitizedOutChunk
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
          } else if (
            Date.now() - workerStartedAtMs >= WORKER_CPU_REFRESH_AFTER_MS &&
            !awaitingRefreshMark &&
            !isRefreshingWorker
          ) {
            awaitingRefreshMark = markName
            void persistCallSnapshot(false)
            if (refreshTimer) clearTimeout(refreshTimer)
            refreshTimer = setTimeout(() => {
              void refreshWorkerCleanly()
            }, 4500)
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
          const allUser = userTurnsOnly.map((t) => t.text).join(" | ")
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
              kbEntries: dataRef.kbEntries,
              lang: activeLang,
              callerNumber,
              recentUserText: recentUser,
              allUserText: allUser,
              lastUserText: toolTurnCtx.lastUserText,
              prevAssistantText: toolTurnCtx.prevAssistantText
            })
            if (execRes.hadCallback) {
              hadCallback = true
              if (execRes.callbackMeta) {
                if (execRes.callbackMeta.id) latestCallbackId = execRes.callbackMeta.id
                latestCallbackSummary = execRes.callbackMeta.summary
                latestCallbackCallerName = execRes.callbackMeta.callerName
                latestCallbackTicket = execRes.callbackMeta.ticket
                latestIntent = execRes.callbackMeta.category
              }
            }
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

          if (
            pendingEndCall &&
            fCalls.length === 1 &&
            String(fCalls[0]?.name || "") === "end_call" &&
            !closed &&
            twilioWs.readyState === WebSocket.OPEN
          ) {
            let lastUserIdx = -1
            for (let i = transcript.length - 1; i >= 0; i--) {
              if (transcript[i].role === "user") {
                lastUserIdx = i
                break
              }
            }
            const alreadySpokeFarewell = transcript
              .slice(lastUserIdx + 1)
              .some((e) => e.role === "assistant" && String(e.text || "").trim().length > 0)

            const armHangupAndCloseGemini = (closeReason: string) => {
              const tail = outResampler.flush()
              if (tail.length > 0) sendMulawToTwilio(tail)
              const markName = `turn_${++turnCounter}`
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                twilioWs.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }))
              }
              awaitingHangupMark = markName
              if (hangupTimer) clearTimeout(hangupTimer)
              hangupTimer = setTimeout(() => {
                void hangupTwilioCallCleanly()
              }, 6500)
              geminiClosingForHangup = true
              try {
                if (gws.readyState === WebSocket.OPEN) gws.close(1000, closeReason)
              } catch {}
            }

            if (alreadySpokeFarewell) {
              armHangupAndCloseGemini("end_call_already_spoken")
              return
            }

            const farewellText = activeLang === "en" ? BRIDGE_CACHED_FAREWELL_EN : BRIDGE_CACHED_FAREWELL_ES
            const cachedFarewellClip = secretsCache
              ? await fetchMulawPromptClip(
                  secretsCache.publicAppBaseUrl,
                  secretsCache.ttsSigningSecret,
                  farewellText,
                  activeLang
                )
              : null

            if (cachedFarewellClip && cachedFarewellClip.length > 0 && !closed && twilioWs.readyState === WebSocket.OPEN) {
              sendMulawToTwilio(cachedFarewellClip)
              transcript.push({
                role: "assistant",
                text: farewellText,
                timestamp: new Date().toISOString()
              })
              armHangupAndCloseGemini("end_call_cached_clip")
              return
            }
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
      if (geminiClosingForHangup) return
      if (!closed) {
        const shouldReconnectViaResume = !pendingEndCall && !isRefreshingWorker && twilioWs.readyState === WebSocket.OPEN
        closed = true
        void persistCallSnapshot(!shouldReconnectViaResume).finally(() => {
          try {
            if (twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.close(1000, shouldReconnectViaResume ? "upstream_reconnect" : "upstream_closed")
            }
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
      postSpeechSilenceRemaining = 14 // 1,400 ms post-voz enviando cada 100 ms acorde a silenceDurationMs: 1050
      if (res.pcmBytes.buffer === speechBatchBuf.buffer) {
        speechBatchPos += res.writtenBytes
        if (speechBatchPos >= 3200) {
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
      callerName = String(cp.callerName || "").trim()
      callerNameSource = String(cp.callerNameSource || "").trim()
      isResumeSession = cp.resume === "1"
      strictEnglishLock = activeLang === "en"
      const ts = Number(cp.ts || 0)
      const sig = String(cp.sig || "").trim()
      workerStartedAtMs = Date.now()
      startedAtMs = workerStartedAtMs

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

        let resumedTurnsSeed: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> | null = null
        if (isResumeSession && callSid) {
          const prevRows = await pgSelect(
            `phone_calls?call_sid=eq.${encodeURIComponent(callSid)}&select=id,status,language,caller_name,caller_name_source,primary_intent,transcript,created_at&limit=1`
          )
          const prev = prevRows[0]
          if (prev) {
            if (prev.language === "en" || prev.language === "es") {
              activeLang = prev.language
              strictEnglishLock = activeLang === "en"
            }
            if (!callerName && prev.caller_name) {
              callerName = String(prev.caller_name)
              callerNameSource = String(prev.caller_name_source || callerNameSource)
            }
            if (prev.primary_intent) latestIntent = String(prev.primary_intent)
            if (prev.created_at) {
              const origMs = Date.parse(String(prev.created_at))
              if (Number.isFinite(origMs) && origMs > 0) startedAtMs = origMs
            }
            if (Array.isArray(prev.transcript) && prev.transcript.length > 0) {
              for (const entry of prev.transcript) {
                if (entry && (entry.role === "user" || entry.role === "assistant" || entry.role === "tool") && typeof entry.text === "string") {
                  transcript.push({
                    role: entry.role,
                    text: entry.text,
                    timestamp: String(entry.timestamp || new Date().toISOString()),
                    ...(entry.toolName ? { toolName: String(entry.toolName) } : {})
                  })
                  if (entry.role === "user" && /[\p{Script=Latin}]{2,}/u.test(entry.text)) {
                    hasLatinCallerTurn = true
                  }
                }
              }
            }
            if (prev.id) {
              const cbRows = await pgSelect(
                `phone_callback_requests?call_id=eq.${prev.id}&status=eq.pending&select=id,caller_name,reason_summary,ticket_or_order_number,reason_category&limit=1`
              )
              if (cbRows[0]) {
                hadCallback = true
                latestCallbackId = String(cbRows[0].id || "")
                latestCallbackSummary = String(cbRows[0].reason_summary || "")
                latestCallbackCallerName = String(cbRows[0].caller_name || "")
                latestCallbackTicket = cbRows[0].ticket_or_order_number ? String(cbRows[0].ticket_or_order_number) : null
                if (cbRows[0].reason_category) latestIntent = String(cbRows[0].reason_category)
              }
            }
          }
        }

        // Si el WS abrió sin callerName (ej. Lookup v2 terminó durante el aviso CIPA o vino de /api/phone/incoming), resolver en ~12ms desde RPC/caché
        if (!callerName && callerNumber) {
          const wsIdentity = await resolveBridgeCallerIdentity({
            phone: callerNumber,
            rawTwilioCallerName: "",
            secrets: secretsCache,
            allowTwilioLookup: false
          }).catch(() => null)
          if (wsIdentity?.displayName) {
            callerName = wsIdentity.displayName
            callerNameSource = wsIdentity.source || "twilio_cnam"
          }
        }

        bridgeData = await getPrewarmedOrBuildBridgeData(storeId, activeLang, callerNumber, callerName, callerNameSource)
        if (!isResumeSession || transcript.length === 0) {
          transcript.push({
            role: "assistant",
            text: bridgeData.greetings.fullGreeting,
            timestamp: new Date().toISOString()
          })
        } else {
          const dialogTurns = transcript.filter(
            (e) => (e.role === "user" || e.role === "assistant") && String(e.text || "").trim().length > 0
          ).slice(-18)
          const resumeBanner =
            activeLang === "en"
              ? "[SEAMLESS AUDIO CHANNEL REFRESH — DO NOT RE-GREET. STAY STRICTLY LOCKED IN ENGLISH. Continue naturally from the conversation below and listen to the caller.]"
              : "[RECONEXIÓN TRANSPARENTE DE AUDIO — NO VUELVAS A SALUDAR. Mantén el idioma activo y continúa la conversación exactamente donde quedó escuchando al cliente.]"
          resumedTurnsSeed = [{ role: "user", parts: [{ text: resumeBanner }] }]
          for (const d of dialogTurns) {
            const r: "user" | "model" = d.role === "assistant" ? "model" : "user"
            const last = resumedTurnsSeed[resumedTurnsSeed.length - 1]
            if (last && last.role === r) {
              last.parts[0].text += ` | ${d.text}`
            } else {
              resumedTurnsSeed.push({ role: r, parts: [{ text: d.text }] })
            }
          }
        }

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
              silenceDurationMs: 1050
            }
          },
          systemInstruction: { parts: [{ text: bridgeData.systemText }] },
          tools: [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }

        // En llamada nueva: enviar "¿En qué te ayudo hoy?" al instante. En relevo resume=1: silencio total sin re-saludar.
        const promptPromise = isResumeSession
          ? Promise.resolve(null)
          : fetchMulawPromptClip(
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

        // Sembrar historial previo (en resume=1) o saludo ya dicho (en inicio) para continuidad exacta
        connectedGws.send(
          JSON.stringify({
            clientContent: {
              turns: resumedTurnsSeed || [
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
        strictEnglishLock = activeLang === "en"
        strictSpanishLock = activeLang === "es"
        if (callSid) {
          void fetch(`${SUPABASE_URL}/rest/v1/phone_calls?call_sid=eq.${encodeURIComponent(callSid)}`, {
            method: "PATCH",
            headers: dbHeaders(),
            body: JSON.stringify({ language: activeLang })
          }).catch(() => null)
        }
        outResampler.reset()
        if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: "clear", streamSid }))
        }
        const cue =
          activeLang === "en"
            ? "[CALLER PRESSED 9 — STRICT ENGLISH LOCK ENABLED] Switch IMMEDIATELY to warm American English and STAY 100% IN ENGLISH for the rest of the call, even if the caller has a Hispanic accent or mentions Mexican food words (champurrado, tamales, mulita, asada, carnitas, quesadilla). Say warmly: Of course, we can continue in English! How can I help you today?"
            : "[EL CLIENTE PRESIONÓ 9 PARA ESPAÑOL — BLOQUEO EN ESPAÑOL] Cambia a español de inmediato y mantente en español cálido del Sur de California. Di: Con gusto continuamos en español. ¿En qué te ayudo hoy?"
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
      } else if (awaitingRefreshMark && mName === awaitingRefreshMark) {
        awaitingRefreshMark = ""
        if (refreshTimer) {
          clearTimeout(refreshTimer)
          refreshTimer = null
        }
        setTimeout(() => {
          void refreshWorkerCleanly()
        }, 120)
      }
      return
    }

    if (msg.event === "stop") {
      if (!closed) {
        closed = true
        if (refreshTimer) {
          clearTimeout(refreshTimer)
          refreshTimer = null
        }
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
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
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
      version: "v23",
      model: "gemini-3.8-live",
      voice: "Kore",
      region: "us-west-1"
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
})
