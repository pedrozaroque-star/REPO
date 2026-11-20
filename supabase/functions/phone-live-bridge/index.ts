import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import {
  StatefulMulaw8kToPcm16k,
  StatefulPcm24kToMulaw8k,
  base64ToUint8,
  convertWavBytesToMulaw8k,
  uint8ToBase64
} from "./dsp.ts"

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

  const yest = new Date(now.getTime() - 24 * 3600 * 1000)
  const yParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(yest)
  const yg = (t: string) => yParts.find((p) => p.type === t)?.value || ""
  const yesterdayDateStr = `${yg("year")}-${yg("month")}-${yg("day")}`

  const businessDate = hour < 6 ? yesterdayDateStr : dateStr
  const shift = hour >= 6 && hour < 17 ? "AM" : "PM"
  const isBreakfastOpen = hour >= 6 && hour < 14
  return { dateStr, yesterdayDateStr, businessDate, shift, dayOfWeek, hour, minute, totalMin: hour * 60 + minute, isBreakfastOpen }
}

function fmt12h(hhmm: string): string {
  const [hS, mS] = String(hhmm || "00:00").split(":")
  const h = Number(hS) || 0
  const m = Number(mS) || 0
  const period = h >= 12 && h < 24 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

function evaluateStoreSchedule(store: any, specialHours: any[], pt = getPacificNow()) {
  const byDay: Record<number, { open: string; close: string }> = {}
  if (Array.isArray(store?.weekly_hours)) {
    for (const d of store.weekly_hours) {
      if (d && typeof d.day === "number") {
        byDay[d.day] = { open: String(d.open || "09:00"), close: String(d.close || "00:00") }
      }
    }
  }
  const parseMin = (hhmm: string) => {
    const [h, m] = String(hhmm || "00:00").split(":").map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  // Verificar spillover nocturno del día anterior (00:00 a 05:59 AM)
  if (pt.hour < 6) {
    const prevDow = (pt.dayOfWeek + 6) % 7
    const prevSpecial =
      specialHours.find((s) => s.event_date === pt.yesterdayDateStr && Number(s.store_id) === Number(store.id)) ||
      specialHours.find((s) => s.event_date === pt.yesterdayDateStr && s.store_id === null)
    if (!prevSpecial?.is_closed) {
      const prevSched = prevSpecial
        ? { open: prevSpecial.open_time || "09:00", close: prevSpecial.close_time || "00:00" }
        : byDay[prevDow]
      if (prevSched) {
        const closeM = parseMin(prevSched.close)
        const openM = parseMin(prevSched.open)
        if (closeM > 0 && closeM <= openM && pt.totalMin < closeM) {
          const dispEs = customerStoreDisplay(store, "es")
          const dispEn = customerStoreDisplay(store, "en")
          const closeFmt = fmt12h(prevSched.close)
          return {
            isOpenNow: true,
            todayCloseFmt: closeFmt,
            statusEs: `Abierto ahora en ${dispEs}; cerramos esta madrugada a las ${closeFmt}.`,
            statusEn: `Currently open at ${dispEn}; we close tonight at ${closeFmt}.`,
            closedPromptEs: "",
            closedPromptEn: ""
          }
        }
      }
    }
  }

  const todaySpecial =
    specialHours.find((s) => s.event_date === pt.dateStr && Number(s.store_id) === Number(store.id)) ||
    specialHours.find((s) => s.event_date === pt.dateStr && s.store_id === null)

  const dispEs = customerStoreDisplay(store, "es")
  const dispEn = customerStoreDisplay(store, "en")

  if (todaySpecial?.is_closed) {
    const hName = todaySpecial.holiday_name || "día festivo"
    return {
      isOpenNow: false,
      todayCloseFmt: "CERRADO",
      statusEs: `Hoy permanecemos cerrados en ${dispEs} por ${hName}.`,
      statusEn: `We are closed today at ${dispEn} for ${hName}.`,
      closedPromptEs: `En este momento estamos cerrados por ${hName}. ¿En qué te ayudo hoy?`,
      closedPromptEn: `We are currently closed for ${hName}. How can I help you today?`
    }
  }

  const sched = todaySpecial
    ? { open: todaySpecial.open_time || "09:00", close: todaySpecial.close_time || "00:00" }
    : byDay[pt.dayOfWeek] || { open: "09:00", close: "01:00" }

  const openM = parseMin(sched.open)
  const rawCloseM = parseMin(sched.close)
  const closeEffective = rawCloseM <= openM ? rawCloseM + 1440 : rawCloseM
  const isOpenNow = pt.totalMin >= openM && pt.totalMin < closeEffective
  const openFmt = fmt12h(sched.open)
  const closeFmt = fmt12h(sched.close)

  return {
    isOpenNow,
    todayCloseFmt: closeFmt,
    statusEs: isOpenNow
      ? `Abierto en este momento en ${dispEs} de ${openFmt} a ${closeFmt}.`
      : `Cerrado en este momento en ${dispEs}; nuestro horario de hoy es de ${openFmt} a ${closeFmt}.`,
    statusEn: isOpenNow
      ? `Currently open at ${dispEn} from ${openFmt} to ${closeFmt}.`
      : `Currently closed at ${dispEn}; today's hours are ${openFmt} to ${closeFmt}.`,
    closedPromptEs: `En este momento ya estamos cerrados; abrimos de ${openFmt} a ${closeFmt}. ¿En qué te ayudo hoy?`,
    closedPromptEn: `We are currently closed; our hours are ${openFmt} to ${closeFmt}. How can I help you today?`
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
    pgSelect("stores?is_active=eq.true&select=id,name,code,address,phone,has_drive_thru,weekly_hours&order=id.asc"),
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
      // Pre-calentar en RAM el clip μ-law de "¿En qué te ayudo hoy?" mientras suena el aviso CIPA (~5 s)
      await fetchMulawPromptClip(secrets.publicAppBaseUrl, secrets.ttsSigningSecret, greetings.questionOnly, activeLang)
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
    name: "create_manager_callback",
    behavior: "BLOCKING",
    description:
      "Registra un Recado Prioritario para el Gerente o Nota de Empaque en la pantalla de la sucursal. Úsalo ÚNICAMENTE cuando ya tengas nombre real y teléfono real de 10 dígitos (y en reclamos de orden equivocada/incompleta en tienda o Drive-Thru también número de ticket o confirmación de SIN TICKET + fecha de compra).",
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
            "'condiments_note', 'wrong_store_order', 'delivery_issue', 'missing_or_wrong_item', 'lost_item', 'employee_callout', 'vendor_arrival', 'billing_refund', u 'other'."
        },
        reason_summary: { type: "STRING", description: "Resumen completo del motivo." },
        ticket_or_order_number: { type: "STRING", description: "Número de ticket u orden, o 'SIN TICKET'." },
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
      "Invócala al final cuando la consulta o recado ya quedó resuelto y el cliente se despide o dice que es todo ('es todo, gracias', 'no thanks'), justo para colgar limpiamente después de tu despedida cálida.",
    parameters: {
      type: "OBJECT",
      properties: {
        farewell_reason: { type: "STRING", description: "Motivo breve de cierre." }
      }
    }
  }
]

async function buildBridgeSystemPromptAndData(storeId: number, lang: PhoneLang, callerNumber: string) {
  const [stores, configs, specialHours, menuItems, kbEntries, learnedItems] = await Promise.all([
    pgSelect("stores?is_active=eq.true&select=id,name,code,address,phone,has_drive_thru,weekly_hours&order=id.asc"),
    pgSelect("phone_agent_config?select=*"),
    pgSelect("phone_special_hours?select=*"),
    pgSelect(
      `app_menu_cache?store_id=eq.${storeId}&is_available=eq.true&select=category_name,name,description,price&order=category_name.asc,name.asc`
    ),
    pgSelect(
      `phone_knowledge_base?is_active=eq.true&or=(store_id.is.null,store_id.eq.${storeId})&select=category,title,answer_es,answer_en,priority&order=priority.desc`
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
    const found = menuItems.find((m) => String(m.name || "").includes(t.key))
    const p = found ? `$${Number(found.price).toFixed(2)} USD` : "consultar en tacosgavilan.com"
    return `- Fiesta Platter ${t.key} (${t.guests}): ${p} — ${t.meatLbs} lbs carne (Asada/Pollo/Pastor), arroz y frijol, ${t.cornDoz} docenas maíz o ${t.flourDoz} docenas harina, ${t.aguasGal} gal agua fresca, salsas y utensilios.`
  }).join("\n")

  const dirLines = stores
    .map((s) => {
      const lbl = customerStoreDisplay(s, lang)
      const la = LA_CROSS_STREETS[Number(s.id)]
      const cross = la ? ` [Esquina: ${lang === "en" ? la.crossEn : la.crossEs}]` : ""
      const ebt = ![1, 9].includes(Number(s.id)) ? "EBT en mostrador" : "Sin EBT"
      return `- #${s.id} ${lbl}${cross}: ${expandStreetAddress(s.address || "", lang)} | Tel: ${s.phone} | ${s.has_drive_thru ? "CON Drive-Thru" : "Sin Drive-Thru"} | ${ebt} | Horario: ${compactWeeklySummary(s.weekly_hours)}`
    })
    .join("\n")

  const kbLines = kbEntries
    .filter((k) => String(k.category || "").toLowerCase() !== "staff")
    .slice(0, 35)
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
      ? "ACTIVE BASE LANGUAGE: ENGLISH. Greeted in English. Mirror the caller's spoken language immediately on every turn: if they speak Spanish, answer 100% in natural Southern California Mexican Spanish; if English, answer 100% in warm American English."
      : "IDIOMA BASE ACTIVO: ESPAÑOL. Ya saludaste en español. Espeja de inmediato el idioma que hable la persona en cada turno: si habla en inglés, respóndele 100% en inglés natural; si habla en español, respóndele 100% en español cálido y natural del Sur de California."

  const callbackOutcome = schedEval.isOpenNow
    ? "confírmale con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer 'enseguida', 'de inmediato', 'ahorita', 'right away' o 'immediately')."
    : "aclárale con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos."

  const systemText = [
    baseLangAnchor,
    "",
    `Eres Kore, la recepcionista telefónica en vivo de **Tacos Gavilan** en **${spokenName}** (Sucursal #${store.id}${laMeta ? `, esquina oficial: ${lang === "en" ? laMeta.crossEn : laMeta.crossEs}` : ""}), California, EE. UU.`,
    `REGLAS INQUEBRANTABLES DE IDENTIDAD, VOZ Y NEGOCIO:`,
    `1. MARCA Y MONEDA: El nombre oficial es estrictamente **Tacos Gavilan** (JAMÁS digas 'Tacos El Gavilan'). Todos los precios son exclusivamente en **dólares y centavos estadounidenses (USD)** (PROHIBIDO decir 'pesos' o 'MXN').`,
    `2. ESTILO DE VOZ EN VIVO (ÁGIL Y HUMANO): Tono cálido, amable, natural y directo. CERO muletillas iniciales (NO empieces con '¡Sí!', '¡Claro que sí!', '¡Por supuesto!' ni '¡Hola!'). Respuestas cortas y fluidas de **1 a 2 oraciones (8 a 22 palabras)**; solo usa hasta 55-65 palabras cuando coticen múltiples platillos, charolas Fiesta Platter o varias sucursales/festivos. Ya saludaste al contestar: NO vuelvas a saludar.`,
    `3. SUCURSALES DE LOS ÁNGELES (#5, #6 y #7 — OBLIGATORIO): Frente al cliente PROHIBIDO decir solo 'Broadway', 'Central', 'Slauson', 'LA Broadway' o 'LA Central'. SIEMPRE di **Los Ángeles** con sus entrecalles oficiales: #5 = **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway, en Los Ángeles); #6 = **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, en Los Ángeles, con Drive-Thru); #7 = **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway, en Los Ángeles). Pronuncia las calles completas sin abreviaturas.`,
    `4. HORARIOS Y DESAYUNOS EN VIVO (${pt.dateStr}, ${String(pt.hour).padStart(2, "0")}:${String(pt.minute).padStart(2, "0")} PT):`,
    `   - Estado actual aquí: ${schedEval.statusEs} / ${schedEval.statusEn}`,
    `   - Horario semanal aquí: ${compactWeeklySummary(store.weekly_hours)}`,
    `   - Festivos anuales oficiales: Cerrado Viernes Santo y Navidad (25 dic); cierra 4:00 PM en Thanksgiving, Nochebuena (24 dic) y Fin de Año (31 dic); abre 11:00 AM en Año Nuevo (1 ene) y Black Friday.`,
    `   - **Desayunos (las 15 sucursales)**: Disponibles todos los días desde la apertura hasta las **2:00 PM** (${pt.isBreakfastOpen && schedEval.isOpenNow ? "DISPONIBLES AHORA" : "YA TERMINARON POR HOY — ofrece nuestro menú regular"}). **Café caliente (16 oz) y Champurrado (16 oz y Caja 96 oz) SÍ están disponibles TODO EL DÍA**.`,
    `5. DRIVE-THRU Y EBT CALFRESH:`,
    `   - Drive-Thru aquí: ${store.has_drive_thru ? "SÍ tenemos Drive-Thru." : "NO tenemos Drive-Thru aquí (solo comedor y para llevar)."} Las 6 tiendas con Drive-Thru son West Covina, Los Ángeles (Central y Washington), La Puente, Norwalk, Lynwood y South Gate.`,
    `   - EBT CalFresh aquí: ${config.accepts_ebt ? "SÍ aceptamos EBT CalFresh ÚNICAMENTE pasando adentro a la caja del mostrador del comedor; JAMÁS se procesa EBT por la ventanilla del Drive-Thru." : "NO aceptamos EBT CalFresh en esta sucursal (Rialto y Santa Ana no aceptan EBT); sí efectivo, tarjetas y Apple Pay/Google Pay."}`,
    `6. CERO PEDIDOS POR TELÉFONO: No tomamos órdenes nuevas de comida por teléfono. Invita con amabilidad a pedir fácilmente en **tacosgavilan.com** para recoger${store.has_drive_thru ? " o directamente en caja o por el Drive-Thru" : " o directamente en caja"}. PROHIBIDO decir 'política', 'políticas', 'reglamentos' o 'policy'.`,
    `7. MENÚ, REGULAR VS SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - Si piden varios platillos, cotiza TODOS con su precio unitario exacto en USD y el subtotal ('más impuestos' / 'plus tax').`,
    `   - Comida sin palabra 'tamaño'/'size': burritos, quesadillas y mulitas son **Regular** o **Super** (si no especifican Super, da ambos precios Regular y Super; Supreme/Supremo = Super).`,
    `   - Bebidas frías (Horchata, Jamaica, Piña, Tamarindo y sodas): únicamente **Mediana de 22 onzas**, **Grande de 32 onzas** y **Galón de 128 onzas** (aguas). PROHIBIDO decir 'chica', 'pequeña' o 'small'.`,
    `   - Postres: **SOLO Flan y Cheesecake individuales** (NO manejamos pasteles de cumpleaños, churros, menudo, birria, pozole, suadero, tripa ni alcohol).`,
    `   - Charolas Fiesta Platter: exclusivamente en **tacosgavilan.com** con mínimo 1 hora de anticipación.`,
    `   - Correcciones fonéticas naturales: 'torta corona'='torta cubana', 'sasada'/'salad burrito'='asada', 'adobada'='pastor', 'muleta'='mulita', 'ibt'/'evt'/'tarjetas abc'='EBT', 'dritro'='Drive-Thru'.`,
    `8. RECADOS AL GERENTE Y RECLAMOS (CERO TRANSFERENCIAS TELEFÓNICAS):`,
    `   - Nunca transferimos llamadas a celulares personales. Usa \`create_manager_callback\` para enviar alertas prioritarias en vivo a la pantalla de tienda.`,
    `   - **Condimentos gratis en orden existente**: pide nombre, número/código de orden, condimentos y teléfono de 10 dígitos -> \`create_manager_callback\` (\`reason_category: 'condiments_note'\`, \`urgency: 'normal'\`), aclarando que aplica si la orden aún no ha salido.`,
    `   - **Uber Eats / DoorDash / Grubhub**: cambios con costo, dirección, cancelación o reembolso se gestionan en **Ayuda (Help)** de su app; para avisar al gerente o retrasos, pide nombre, teléfono de 10 dígitos y código (\`reason_category: 'delivery_issue'\`).`,
    `   - **Sucursal equivocada en tacosgavilan.com**: pregunta en cuál tienda cayó, toma nombre, teléfono de 10 dígitos y orden -> \`create_manager_callback\` con \`target_store_id\` (\`reason_category: 'wrong_store_order'\`).`,
    `   - **Órdenes equivocadas o incompletas en tienda, Drive-Thru o tacosgavilan.com**: pide SIEMPRE los **4 datos obligatorios**: **1) número de ticket, 2) fecha de compra, 3) nombre y 4) teléfono real de 10 dígitos**, advirtiendo con respeto que **sin el número de ticket es poco probable determinar la equivocación** ('Without the ticket number, it is unlikely we can verify the mistake'). Si confirma que perdió el ticket envía \`ticket_or_order_number: 'SIN TICKET'\` sin prometer reposición. EJECUTA \`create_manager_callback\` ANTES de confirmar, y luego ${callbackOutcome}`,
    `   - **Objetos olvidados, empleados, proveedores o gerente**: pide nombre real y teléfono real de 10 dígitos${callerNumber ? ` (Caller ID entrante: ${callerNumber}; si autoriza explícitamente usar este mismo número envía caller_phone='CALLER_ID')` : ""}, ejecuta \`create_manager_callback\` ANTES de confirmar y ${callbackOutcome}`,
    `9. CIERRE LIMPIO Y SEÑAL TELEFÓNICA: Si un audio llega entrecortado o confuso por la señal telefónica, jamás adivines ni inventes respuesta: pide con calidez que lo repita brevemente ('Disculpa, se cortó un poco la señal, ¿me lo repites por favor?' / 'Sorry, the line broke up slightly, could you repeat that?'). NUNCA invoques \`end_call\` por palabras sueltas o ambiguas; solo cuando el cliente resuelva su duda y se despida claramente ('es todo, gracias', 'no gracias', 'adiós', 'that is all, thank you'), despídete cálidamente en una oración sin preguntas ('Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!' / 'You are very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!') e invoca \`end_call\`.`,
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

  return {
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
              ? new TextDecoder().decode(ev.data)
              : new TextDecoder().decode(await (ev.data as Blob).arrayBuffer())
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

async function executeBridgeTool(params: {
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
}): Promise<{ response: Record<string, unknown>; shouldEndCall: boolean; hadCallback: boolean }> {
  const { toolName, toolArgs, callSid, store, stores, config, specialHours, menuItems, lang, callerNumber, recentUserText } = params
  const pt = getPacificNow()
  const schedEval = evaluateStoreSchedule(store, specialHours, pt)
  const dispName = customerStoreDisplay(store, lang)

  if (toolName === "end_call") {
    return {
      response: { ok: true, endingCall: true },
      shouldEndCall: true,
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
    const packages = PARTY_TRAYS.map((t) => {
      const found = menuItems.find((m) => String(m.name || "").includes(t.key))
      return {
        package: `Fiesta Platter ${t.key}`,
        serves: t.guests,
        priceUsd: found ? `$${Number(found.price).toFixed(2)} USD` : "ver tacosgavilan.com",
        meatLbs: t.meatLbs,
        aguasGallons: t.aguasGal,
        cornDozens: t.cornDoz,
        flourDozens: t.flourDoz
      }
    })
    return {
      response: {
        requestedGuests: guests,
        orderOnlineOnly: "tacosgavilan.com con mínimo 1 hora de anticipación",
        packages
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
    const category = validCats.has(rawCat) ? rawCat : "other"
    const rawTicket = String(toolArgs?.ticket_or_order_number || "").trim()
    const rawOrderDate = String(toolArgs?.order_date || "").trim()
    const isDelivery = /\b(uber|doordash|door dash|grubhub|postmates)\b/i.test(
      normalizeSearch(`${recentUserText} ${toolArgs?.reason_summary || ""}`)
    )

    if (category === "missing_or_wrong_item" && !isDelivery && (!rawTicket || !rawOrderDate)) {
      const missing: string[] = []
      if (!rawTicket) missing.push("número de ticket (o confirmación de SIN TICKET)")
      if (!rawOrderDate) missing.push("fecha de compra")
      return {
        response: {
          success: false,
          missingOrderReviewFields: missing,
          message: `Aún falta preguntar al cliente: ${missing.join(" y ")}. Recuérdale con respeto que sin el número de ticket es poco probable determinar la equivocación.`
        },
        shouldEndCall: false,
        hadCallback: false
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

    const baseReason = String(toolArgs?.reason_summary || "Solicitud de atención del gerente").trim()
    const finalSummary =
      Number(destStore.id) !== Number(store.id)
        ? `[Llamó a #${store.id} ${dispName} -> Enrutada a #${destStore.id} ${destDisplay}] ${baseReason}`
        : baseReason

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
  let pcm16Batch: Uint8Array[] = []
  let pcm16BatchBytes = 0
  const preReadyPcmQueue: string[] = []

  const transcript: TranscriptEntry[] = []
  let openUserText = ""
  let openAssistantText = ""
  let bridgeData: Awaited<ReturnType<typeof buildBridgeSystemPromptAndData>> | null = null
  let secretsCache: BridgeSecrets | null = null

  const flushOpenUserTurn = () => {
    const clean = openUserText.replace(/\s+/g, " ").trim()
    if (clean) {
      transcript.push({ role: "user", text: clean, timestamp: new Date().toISOString() })
    }
    openUserText = ""
  }

  const flushOpenAssistantTurn = () => {
    const clean = openAssistantText.replace(/\s+/g, " ").trim()
    if (clean) {
      transcript.push({ role: "assistant", text: clean, timestamp: new Date().toISOString() })
    }
    openAssistantText = ""
  }

  const sendMulawToTwilio = (mulawBytes: Uint8Array) => {
    if (closed || !streamSid || mulawBytes.length === 0 || twilioWs.readyState !== WebSocket.OPEN) return
    const nowMs = Date.now()
    outboundAudioDrainUntilMs = Math.max(outboundAudioDrainUntilMs, nowMs) + Math.ceil(mulawBytes.length / 8)
    const FRAME_SIZE = 640 // 80 ms a 8 kHz μ-law
    for (let offset = 0; offset < mulawBytes.length; offset += FRAME_SIZE) {
      const slice = mulawBytes.subarray(offset, Math.min(offset + FRAME_SIZE, mulawBytes.length))
      twilioWs.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: uint8ToBase64(slice) }
        })
      )
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

  const attachGeminiHandlers = (gws: WebSocket) => {
    gws.onmessage = async (ev) => {
      if (closed) return
      let msg: any
      try {
        const raw =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof ArrayBuffer
              ? new TextDecoder().decode(ev.data)
              : new TextDecoder().decode(await (ev.data as Blob).arrayBuffer())
        msg = JSON.parse(raw)
      } catch {
        return
      }

      const sc = msg?.serverContent
      if (sc) {
        if (sc.interrupted === true) {
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
          openUserText += sc.inputTranscription.text
        }

        if (sc.outputTranscription?.text) {
          if (openUserText.trim()) flushOpenUserTurn()
          openAssistantText += sc.outputTranscription.text
        }

        const parts = sc.modelTurn?.parts
        if (Array.isArray(parts)) {
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

        if (sc.turnComplete === true) {
          const tail = outResampler.flush()
          if (tail.length > 0) sendMulawToTwilio(tail)

          const lastSpoken = openAssistantText.trim()
          flushOpenUserTurn()
          flushOpenAssistantTurn()

          const markName = `turn_${++turnCounter}`
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: "mark", streamSid, mark: { name: markName } }))
          }

          const looksLikeCleanFarewell =
            !lastSpoken.includes("?") &&
            /\b(que tengas un excelente d[ií]a|have a wonderful day|gracias por llamar a tacos gavilan|thank you for calling tacos gavilan)\b/i.test(
              lastSpoken
            )

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
        const dataRef = bridgeData
        toolChain = toolChain.then(async () => {
          const functionResponses: any[] = []
          const recentUser = transcript
            .filter((t) => t.role === "user")
            .slice(-4)
            .map((t) => t.text)
            .join(" | ")

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
              recentUserText: recentUser
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

  twilioWs.onmessage = async (ev) => {
    if (closed) return
    let msg: any
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data))
    } catch {
      return
    }

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

        bridgeData = await buildBridgeSystemPromptAndData(storeId, activeLang, callerNumber)
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
              startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              prefixPaddingMs: 280,
              silenceDurationMs: 560
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
      const mulaw = base64ToUint8(payloadB64)
      const inPlaybackWindow = Date.now() < outboundAudioDrainUntilMs + 180
      const { pcmBytes: pcm16, speechActive } = inResampler.process(mulaw, { inPlaybackWindow })
      pcm16Batch.push(pcm16)
      pcm16BatchBytes += pcm16.length

      // Enviar cada ~40 ms (2 tramas Twilio = 1280 bytes a 16 kHz PCM16)
      if (pcm16BatchBytes >= 1280) {
        const merged = new Uint8Array(pcm16BatchBytes)
        let pos = 0
        for (const part of pcm16Batch) {
          merged.set(part, pos)
          pos += part.length
        }
        pcm16Batch = []
        pcm16BatchBytes = 0
        const b64 = uint8ToBase64(merged)

        if (geminiReady && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(
            JSON.stringify({
              realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } }
            })
          )
        } else if (speechActive) {
          // Solo encolar tramas de voz humana real antes de ready (descartar silencio/ruido inicial de conexión)
          if (preReadyPcmQueue.length >= 12) preReadyPcmQueue.shift()
          preReadyPcmQueue.push(b64)
        }
      }
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
      model: "gemini-3.8-live",
      voice: "Kore",
      region: "us-west-1"
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
})
