/**
 * @module lib/drive-thru-kore
 * @description Capa de SERVIDOR del simulador "Kore Drive-Thru" de Tacos Gavilan: carga el menú real de la sucursal
 * (`app_menu_cache` -> `KoreMenuItem[]`), la Base de Conocimiento (`phone_knowledge_base`), la tasa de impuesto estimada,
 * arma el system prompt de la asistente de voz Kore y el mensaje `BidiGenerateContentSetup` de Gemini Live API
 * (`gemini-3.8-live`, voz prebuilt `Kore`), y crea el token efímero (ephemeral token) con el pool de llaves Gemini.
 *
 * @businessRules
 * - **Marca y cliente**: siempre "Tacos Gavilan"; las sucursales #5/#6/#7 se nombran ante el cliente como
 *   "Los Ángeles (entrecalles)" vía `lib/customer-store-names.ts` (nunca "Central"/"Broadway"/"Slauson" a secas).
 * - **Bienvenida corta, cálida y variada (`pickKoreDriveThruGreeting`)**: el saludo inicial en bocina de Drive-Thru es
 *   breve, hospitalario y rota entre variantes cálidas (*"¡Bienvenido a Tacos Gavilan [Tienda]! ¿Cómo le podemos ayudar?"*,
 *   *"¿Qué se le antoja ordenar hoy?"*, *"¿Cómo le podemos ayudar hoy?"*, *"¿Qué le gustaría ordenar hoy?"*), sin avisos
 *   largos y prohibiendo frases cortantes/golpeadas como *"¿Qué le ofrezco?"*, *"¿Qué va a llevar?"* o *"¿Qué quiere?"*.
 * - **Precios**: solo los de `app_menu_cache` (USD, jamás "pesos"); Kore debe usar SIEMPRE las herramientas para
 *   agregar/cambiar/quitar y para cotizar. Postres: solo Flan y Cheesecake individuales.
 * - **Condimentos Gratis ($0.00)**: las cajeras ya saben qué condimentos lleva cada platillo; Kore NUNCA pregunta por
 *   condimentos gratis de oficio. Si el cliente dice `"con todo"`, se acepta directo a `$0.00`; si pide `Cebolla Asada`
 *   o `Frijol de la Olla`, ambos son 100% gratis (`$0.00`, jamás cobrar `Beans $2.49`).
 * - **Repartidores + Blindaje Delivery + Ventana 2**: al registrar recolección (`register_driver_pickup`), se cruza en
 *   tiempo real contra `fetchOffPremiseOrders(storeId)` de `lib/delivery-armor.ts` y siempre se envía a **Ventana 2**.
 * - **Pagos EBT (regla oficial del dueño)**: las 6 tiendas con Drive-Thru aceptan EBT SOLO en el mostrador del comedor;
 *   por Drive-Thru solo efectivo, débito/crédito, Apple Pay y Google Pay. Si el cliente elige pasar al comedor con EBT,
 *   Kore cancela la orden del carril (`cancel_order` con `reason: "EBT: pasa al comedor"`).
 * - **Desayunos hasta las 2:00 PM PT (regla oficial del dueño, 15 sucursales)**: el prompt inyecta el estado en vivo
 *   (`isKoreBreakfastOpen`, `America/Los_Angeles`) y el motor rechaza platillos `Breakfast` después de las 2:00 PM.
 * - **Fiesta Platters** se excluyen del drive-thru (requieren anticipación; KB de catering).
 * - **Impuesto ESTIMADO**: tasa oficial CDTFA por sucursal de `docs/STORE_BRANCH_AND_TAX_MATRIX_2026-10-09.md`
 *   (vigente oct-2026), contrastada con la tasa observada `taxes/net_sales` de `sales_daily_cache` (últimos 30 días,
 *   siempre un poco menor por artículos exentos/EBT). Siempre se reporta `taxIsEstimate: true` (no viene de Toast).
 * - **Simulación pura**: nada se envía a Toast (nuestra llave no tiene `orders:write` ni `orders.prices:read`).
 * - **Cierre automático por auto (`confirm_order` -> `end_session`)**: en el Paso A (`"Ya es todo"`), Kore llama
 *   `confirm_order`, lee artículos + total y pregunta *"¿Está correcta su orden?"*; en el Paso B (cuando el cliente
 *   confirma que está bien y que no hay nada más, o cuando un repartidor/cliente EBT termina), Kore llama `end_session`
 *   y da una despedida breve sin pregunta para finalizar automáticamente la sesión de ese vehículo.
 *
 * @dataFlow
 * - `POST /api/drive-thru/kore/session` -> `loadKoreStore()` + `loadKoreMenu()` + `loadKoreKnowledge()` +
 *   `getKoreStoreTaxRate()` -> `buildKoreSystemPrompt()` -> `buildKoreLiveSetup()` -> `createKoreEphemeralToken(setup)`
 *   (`POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`, header `x-goog-api-key`, rotación de llaves
 *   `getGeminiKeyPoolWithRemote()`) -> navegador abre `BidiGenerateContentConstrained?access_token=…`.
 *
 * @notes
 * - HALLAZGO 2026-11-19 (verificado en vivo): el endpoint REST `auth_tokens` NO acepta `liveConnectConstraints`
 *   (HTTP 400 "Unknown name"); el campo REST real es `bidiGenerateContentSetup`. Con `fieldMask` vacío, el setup COMPLETO
 *   (modelo, voz, system prompt y tools) queda BLOQUEADO dentro del token y el servidor de Gemini IGNORA cualquier setup
 *   distinto enviado por el navegador (probado: setup cliente "PERA" vs token "MANGO" => respondió "MANGO"). Así el system
 *   prompt nunca depende del cliente. Por lo mismo NO se usa `sessionResumption` (el handle del cliente sería ignorado):
 *   si el socket se cae, el navegador pide una sesión nueva.
 * - Las 10 llaves del pool (7 `AQ.` + 3 `AIz`) crean tokens efímeros (HTTP 200, 2026-11-19).
 * - Jamás se devuelve ni se registra una API key: los errores se sanean antes de salir del módulo.
 * - `uses: 1`, `expireTime` = +20 min, `newSessionExpireTime` = +60 s (el navegador debe conectar en ese minuto).
 * - Sincronización bidireccional Fase 3 (2026-11-19): `loadKoreKnowledge(storeId)` carga TODAS las categorías de cara al
 *   cliente de `phone_knowledge_base` (`menu`, `delivery`, `policies`, `payments`, `hours`, `catering`, `general`,
 *   `employment` — excluyendo `staff` interno, evitando duplicar `synced_kb_id` ya inyectados en `loadActiveKoreLearnedRules`
 *   e ignorando reglas con `applies_to_channels = 'phone_only'`), con caché RAM de 60 s (`invalidateKoreKnowledgeCache`).
 * - Optimización Single-Key Tier 1 (2026-11-20): cuando `orderedKeys.length === 1`, `createKoreEphemeralToken` omite el
 *   pre-probe `countTokens` (ahorrando 50% de RPM y ~200 ms) y aplica 1 reintento rápido de `400 ms` ante error 5xx/red.
 * - Calibración VAD anti-cortes (2026-11-21, sesiones `cb6234d1` y `fe7812f9`): `buildKoreLiveSetup` usa `START_SENSITIVITY_HIGH`,
 *   `END_SENSITIVITY_LOW`, `prefixPaddingMs: 40` y `silenceDurationMs: 1150` para evitar recorte de sílabas iniciales
 *   ("perburito") y cortes a mitad de idea (`"carne es la más"`, `"...en mi carro y"`), fijando además la concordancia
 *   gramatical femenina estricta de Kore en español (`"lista"`, `"atenta"`, prohibido `"aquí sigo listo"`) y respuesta única
 *   sin preguntas ante solicitudes de espera (`"espérame, estoy pensando"`, `"no me apresures"`).
 * - Prioridad de intención del cliente sobre TV/YouTube mezclado (2026-11-21, sesión `9026505b`): la Regla #4 prohíbe
 *   responder `"Disculpe, se escuchó ruido de fondo"` cuando en el turno viene cualquier pedido, respuesta o verificación
 *   directa (`"¿Me escuchas?"` / `"¿Sí me escuchas o no?"` / `"Can you hear me?"`), confirmando `"¡Sí, le escucho claro!"`
 *   y retomando en la misma oración la pregunta u orden pendiente sin perder el contexto previo ni ciclarse en disculpas.
 * - Blindaje Fase 18 & 19 (2026-11-21, sesiones `36c77a72` y `cb6234d1`): prohíbe disclaimers médicos/legales en inglés ante
 *   ruido STT suelto (`"médico"`), prohíbe adivinar carne/variante/tamaño en fragmentos truncados (`"Quiero una"`) o elegir al
 *   azar en pares mixtos (`"una mediana y una grande"` sobre dos sabores distintos), incluye receta oficial por categoría en
 *   `buildCompactMenuCatalog` y Regla #7 (Sopes: tortilla gruesa con frijoles, crema/sour cream, queso Cotija y carne — JAMÁS
 *   lechuga ni tomate), prohíbe hablar antes de emitir un `toolCall` en el mismo turno, incluye rotación completa con `Taco Plate`
 *   y `Platos` ante `"¿Qué más hay?"`, y exige leer el total exacto en USD antes de `end_session`.
 * - Blindaje Fase 21 (2026-11-21, sesión `99d29f93`): `buildCompactMenuCatalog` calcula en vivo desde `menu` la aritmética
 *   exacta `Regular + 1 extra` vs `Regular + 2 extras` vs `Super` (evitando afirmar falsamente que `Super Mulita` sin crema es
 *   más barata que `Mulita Regular + Guacamole`), prohíbe pedir nombre/teléfono de 10 dígitos en Drive-Thru ante `"¿Puedo hablar
 *   con el manager?"` (invitando a pasar directo a ventanilla), y prohíbe llamar `cancel_order` ante `"Olvídalo"` / `"Never mind"`.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getGeminiKeyPoolWithRemote } from '@/lib/order-ready-tts'
import { formatCustomerGreetingTarget, formatCustomerStoreName } from '@/lib/customer-store-names'
import { fetchOffPremiseOrders, type OffPremiseOrder } from '@/lib/delivery-armor'
import {
  KORE_BREAKFAST_CUTOFF_LABEL,
  KORE_HUMAN_TAKEOVER_OBSERVER_CUE,
  KORE_MAX_DRIVER_ORDERS,
  KORE_TOOL_DECLARATIONS,
  buildKoreHumanTakeoverReleaseCue,
  isKoreBreakfastOpen,
  mapAppMenuRowsToKoreMenu,
  normalizeKoreDriverPlatform,
  type KoreCashierInterventionMeta,
  type KoreCashierTriggerSource,
  type KoreDriverOrderLookupStatus,
  type KoreDriverPickup,
  type KoreDriverPickupOrder,
  type KoreMenuItem
} from '@/lib/drive-thru-kore-order'
import type { ActiveKoreLearnedRule } from '@/lib/drive-thru-kore-learning'

export {
  KORE_HUMAN_TAKEOVER_OBSERVER_CUE,
  buildKoreHumanTakeoverReleaseCue,
  type KoreCashierInterventionMeta,
  type KoreCashierTriggerSource
}

export type KoreLang = 'es' | 'en'

export const KORE_LIVE_MODEL = 'gemini-3.8-live'
export const KORE_VOICE_NAME = 'Kore'
export const KORE_WS_CONSTRAINED_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'
const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens'
const TOKEN_EXPIRE_MS = 20 * 60 * 1000
const TOKEN_NEW_SESSION_MS = 60 * 1000
const TOKEN_REQUEST_TIMEOUT_MS = 8000
const MENU_CACHE_TTL_MS = 60 * 1000
const KB_CACHE_TTL_MS = 60 * 1000
const TAX_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Roles autorizados para el simulador Kore Drive-Thru (manager/supervisor/admin y equivalentes del padrón `public.users`).
 * Asistentes, shift leaders y empleados NO tienen acceso.
 */
export const KORE_SIM_ALLOWED_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'administrador',
  'supervisor',
  'regional_manager',
  'manager',
  'general_manager',
  'gerente'
])

/**
 * Tasas oficiales CDTFA vigentes (oct-2026) por `stores.id`.
 * Fuente: docs/STORE_BRANCH_AND_TAX_MATRIX_2026-10-09.md (tabla maestra de las 15 sucursales).
 */
export const KORE_CDTFA_TAX_RATES_PCT: Readonly<Record<number, number>> = Object.freeze({
  1: 7.75,
  3: 10.25,
  4: 11.25,
  5: 10.25,
  6: 10.25,
  7: 10.25,
  8: 10.25,
  9: 9.25,
  10: 10.75,
  11: 11.0,
  12: 11.0,
  13: 10.25,
  14: 11.25,
  15: 11.25,
  16: 11.0
})

export interface KoreStoreRow {
  id: number
  name: string
  code: string | null
  address: string | null
  city: string
  externalId: string | null
  hasDriveThru: boolean
  acceptsEbt: boolean
  isActive: boolean
}

export interface KoreEbtStoreMatrix {
  noEbtCitiesEs: string
  noEbtCitiesEn: string
  ebtDiningRoomCitiesEs: string
  ebtDiningRoomCitiesEn: string
  byStoreId: Record<number, { city: string; acceptsEbt: boolean; hasDriveThru: boolean }>
}

export interface KoreTaxInfo {
  taxRatePct: number
  taxIsEstimate: true
  taxSource: 'cdtfa_matrix_2026_10' | 'observed_sales_30d'
  /** taxes / net_sales de los últimos 30 días cerrados (null si no hay datos). */
  observedTaxRatePct: number | null
}

export interface KoreKnowledgeEntry {
  id?: string
  category: string
  title: string
  answerEs: string
  answerEn: string
}

/** Categorías de `phone_knowledge_base` de cara al cliente válidas para Drive-Thru (excluye `staff` interno). */
export const KORE_CUSTOMER_KB_CATEGORIES: ReadonlySet<string> = new Set([
  'menu',
  'delivery',
  'policies',
  'payments',
  'hours',
  'catering',
  'general',
  'employment'
])

const menuCache = new Map<number, { items: KoreMenuItem[]; fetchedAt: number }>()
const kbCache = new Map<number, { entries: KoreKnowledgeEntry[]; fetchedAt: number }>()
const taxCache = new Map<number, { info: KoreTaxInfo; fetchedAt: number }>()
let ebtMatrixCache: { matrix: KoreEbtStoreMatrix; fetchedAt: number } | null = null
let keyCursor = 0

/** Extrae la ciudad limpia desde `stores.address` (ej. "115 E. Baseline Rd., Rialto, CA 92376" -> "Rialto"). */
export function extractCityFromStoreAddress(address: unknown, fallbackName = '', storeId?: number): string {
  const addr = String(address ?? '').trim()
  const m = /,\s*([A-Za-zÀ-ÿ .'-]+?)\s*,\s*CA\b/i.exec(addr)
  if (m && m[1]?.trim()) return m[1].trim()
  if (storeId === 1) return 'Rialto'
  if (storeId === 9) return 'Santa Ana'
  if (storeId && [5, 6, 7, 8].includes(storeId)) return 'Los Angeles'
  return String(fallbackName || '')
    .replace(/^#\d+\s*/, '')
    .replace(/^LA\s+/i, 'Los Angeles ')
    .trim()
}

/** Invalida la caché RAM (60 s) de la Base de Conocimiento compartida con Drive-Thru (una sucursal o todas). */
export function invalidateKoreKnowledgeCache(storeId?: number) {
  ebtMatrixCache = null
  if (typeof storeId === 'number' && Number.isInteger(storeId) && storeId > 0) {
    kbCache.delete(storeId)
  } else {
    kbCache.clear()
  }
}

/**
 * Carga la matriz en vivo de validez de EBT CalFresh por ciudad/sucursal (`stores` + `phone_agent_config.accepts_ebt`),
 * con caché RAM de 60 s. Rialto (#1) y Santa Ana (#9) tienen `accepts_ebt = false`; las 13 del Condado de LA `true`.
 */
export async function loadKoreEbtStoreMatrix(opts?: { bypassCache?: boolean }): Promise<KoreEbtStoreMatrix> {
  if (!opts?.bypassCache && ebtMatrixCache && Date.now() - ebtMatrixCache.fetchedAt < KB_CACHE_TTL_MS) {
    return ebtMatrixCache.matrix
  }
  const [{ data: storesData }, { data: cfgData }] = await Promise.all([
    supabaseAdmin
      .from('stores')
      .select('id, name, code, address, has_drive_thru, is_active')
      .eq('is_active', true)
      .order('id', { ascending: true }),
    supabaseAdmin.from('phone_agent_config').select('store_id, accepts_ebt')
  ])
  const ebtByStore = new Map<number, boolean>()
  for (const c of (cfgData || []) as any[]) {
    if (typeof c.accepts_ebt === 'boolean') ebtByStore.set(Number(c.store_id), c.accepts_ebt)
  }
  const byStoreId: Record<number, { city: string; acceptsEbt: boolean; hasDriveThru: boolean }> = {}
  const noEbtEs: string[] = []
  const noEbtEn: string[] = []
  const yesEbtEs: string[] = []
  const yesEbtEn: string[] = []

  for (const s of (storesData || []) as any[]) {
    const id = Number(s.id)
    const city = extractCityFromStoreAddress(s.address, String(s.name || ''), id)
    const acceptsEbt = ebtByStore.has(id) ? ebtByStore.get(id)! : ![1, 9].includes(id)
    const hasDriveThru = s.has_drive_thru === true
    byStoreId[id] = { city, acceptsEbt, hasDriveThru }
    const labelEs = formatCustomerStoreName(id, 'es', { style: 'display' })
    const labelEn = formatCustomerStoreName(id, 'en', { style: 'display' })
    if (acceptsEbt) {
      yesEbtEs.push(labelEs)
      yesEbtEn.push(labelEn)
    } else {
      noEbtEs.push(`${labelEs} (${city})`)
      noEbtEn.push(`${labelEn} (${city})`)
    }
  }

  const matrix: KoreEbtStoreMatrix = {
    noEbtCitiesEs: noEbtEs.length > 0 ? noEbtEs.join(' y ') : 'Rialto y Santa Ana',
    noEbtCitiesEn: noEbtEn.length > 0 ? noEbtEn.join(' and ') : 'Rialto and Santa Ana',
    ebtDiningRoomCitiesEs:
      yesEbtEs.length > 0
        ? yesEbtEs.join(', ')
        : 'West Covina, Azusa, Los Ángeles (Vernon y Broadway), Los Ángeles (Central y Washington), Los Ángeles (Slauson y Broadway), Hollywood, La Puente, Huntington Park, Norwalk, Bell, Lynwood, South Gate y Downey',
    ebtDiningRoomCitiesEn:
      yesEbtEn.length > 0
        ? yesEbtEn.join(', ')
        : 'West Covina, Azusa, Los Angeles (Vernon & Broadway), Los Angeles (Central & Washington), Los Angeles (Slauson & Broadway), Hollywood, La Puente, Huntington Park, Norwalk, Bell, Lynwood, South Gate, and Downey',
    byStoreId
  }
  ebtMatrixCache = { matrix, fetchedAt: Date.now() }
  return matrix
}

/** Lee la sucursal (`stores` + `phone_agent_config.accepts_ebt`) por id numérico. Lanza error si falla la DB (fail-closed). */
export async function loadKoreStore(storeId: number): Promise<KoreStoreRow | null> {
  const [{ data, error }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from('stores')
      .select('id, name, code, address, external_id, has_drive_thru, is_active')
      .eq('id', storeId)
      .maybeSingle(),
    supabaseAdmin.from('phone_agent_config').select('accepts_ebt').eq('store_id', storeId).maybeSingle()
  ])
  if (error) throw new Error(`Error consultando la sucursal: ${error.message}`)
  if (!data) return null
  const id = Number(data.id)
  const address = data.address ? String(data.address) : null
  const city = extractCityFromStoreAddress(address, String(data.name || ''), id)
  const acceptsEbt = typeof cfg?.accepts_ebt === 'boolean' ? cfg.accepts_ebt : ![1, 9].includes(id)
  return {
    id,
    name: String(data.name || ''),
    code: data.code ? String(data.code) : null,
    address,
    city,
    externalId: data.external_id ? String(data.external_id) : null,
    hasDriveThru: data.has_drive_thru === true,
    acceptsEbt,
    isActive: data.is_active !== false
  }
}

/** Menú real disponible de la sucursal (sin Fiesta Platters), con caché RAM de 60 s. */
export async function loadKoreMenu(storeId: number, opts?: { bypassCache?: boolean }): Promise<KoreMenuItem[]> {
  const hit = menuCache.get(storeId)
  if (!opts?.bypassCache && hit && Date.now() - hit.fetchedAt < MENU_CACHE_TTL_MS) return hit.items
  const { data, error } = await supabaseAdmin
    .from('app_menu_cache')
    .select('toast_item_guid, name, description, price, category_name, modifier_groups_json, is_available')
    .eq('store_id', storeId)
    .eq('is_available', true)
  if (error) {
    if (hit) return hit.items
    throw new Error(`Error cargando el menú de la sucursal: ${error.message}`)
  }
  const items = mapAppMenuRowsToKoreMenu(data || [], { excludeCategory: (c) => /fiesta\s*platter/i.test(c) })
  menuCache.set(storeId, { items, fetchedAt: Date.now() })
  return items
}

/**
 * Carga TODAS las entradas activas de cara al cliente de `phone_knowledge_base` (`menu`, `delivery`, `policies`,
 * `payments`, `hours`, `catering`, `general`, `employment` — excluyendo `staff` interno), evitando duplicar filas cuyo
 * `id` ya esté inyectado en `loadActiveKoreLearnedRules` vía `synced_kb_id` e ignorando filas marcadas `phone_only`.
 */
export async function loadKoreKnowledge(
  storeId: number,
  opts?: { bypassCache?: boolean }
): Promise<KoreKnowledgeEntry[]> {
  const safeStoreId = Math.trunc(storeId)
  const hit = kbCache.get(safeStoreId)
  if (!opts?.bypassCache && hit && Date.now() - hit.fetchedAt < KB_CACHE_TTL_MS) return hit.entries

  const [{ data, error }, { data: linkedRows }] = await Promise.all([
    supabaseAdmin
      .from('phone_knowledge_base')
      .select('id, store_id, category, title, answer_es, answer_en, is_active, priority, updated_at')
      .eq('is_active', true)
      .or(`store_id.is.null,store_id.eq.${safeStoreId}`),
    supabaseAdmin
      .from('dt_kore_learning_items')
      .select('id, synced_kb_id, status, item_kind, applies_to_channels')
      .not('synced_kb_id', 'is', null)
      .or(`store_id.is.null,store_id.eq.${safeStoreId}`)
  ])

  if (error || !Array.isArray(data)) return hit?.entries || []

  const excludedKbIds = new Set<string>()
  for (const lr of (linkedRows || []) as any[]) {
    const kbId = lr.synced_kb_id ? String(lr.synced_kb_id) : ''
    if (!kbId) continue
    const ch = String(lr.applies_to_channels || 'both')
    const isActiveInDtRules =
      (lr.status === 'approved' || lr.status === 'auto_applied') &&
      lr.item_kind !== 'latency_insight' &&
      (ch === 'both' || ch === 'drive_thru_only')
    if (ch === 'phone_only' || isActiveInDtRules) {
      excludedKbIds.add(kbId)
    }
  }

  const entries: KoreKnowledgeEntry[] = data
    .filter((r: any) => {
      const cat = String(r.category || 'general').trim().toLowerCase()
      if (cat === 'staff') return false
      if (!KORE_CUSTOMER_KB_CATEGORIES.has(cat) && cat !== '') {
        // Permite categorías personalizadas de cara al cliente pero jamás `staff`
      }
      if (r.id && excludedKbIds.has(String(r.id))) return false
      return true
    })
    .sort(
      (a: any, b: any) =>
        (a.store_id ? 0 : 1) - (b.store_id ? 0 : 1) ||
        Number(b.priority || 0) - Number(a.priority || 0) ||
        String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    )
    .map((r: any) => ({
      id: r.id ? String(r.id) : undefined,
      category: String(r.category || 'general').trim().toLowerCase(),
      title: String(r.title || ''),
      answerEs: String(r.answer_es || '').replace(/\s+/g, ' ').trim(),
      answerEn: String(r.answer_en || '').replace(/\s+/g, ' ').trim()
    }))

  kbCache.set(safeStoreId, { entries, fetchedAt: Date.now() })
  return entries
}

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Fecha laboral actual en California (el día laboral inicia a las 6:00 AM America/Los_Angeles). */
function currentCaliforniaBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  return Number(get('hour')) < 6 ? shiftIsoDate(date, -1) : date
}

/**
 * Tasa de impuesto ESTIMADA por sucursal: CDTFA oficial (matriz oct-2026) y, como contraste, la tasa observada en
 * `sales_daily_cache` (últimos 30 días laborales cerrados). Si la tienda no está en la matriz se usa la observada.
 */
export async function getKoreStoreTaxRate(store: Pick<KoreStoreRow, 'id' | 'externalId'>): Promise<KoreTaxInfo> {
  const hit = taxCache.get(store.id)
  if (hit && Date.now() - hit.fetchedAt < TAX_CACHE_TTL_MS) return hit.info
  let observed: number | null = null
  if (store.externalId) {
    const today = currentCaliforniaBusinessDate()
    const { data, error } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('net_sales, taxes')
      .eq('store_id', store.externalId)
      .gte('business_date', shiftIsoDate(today, -30))
      .lt('business_date', today)
    if (!error && Array.isArray(data)) {
      let net = 0
      let tax = 0
      for (const r of data as any[]) {
        const n = Number(r.net_sales)
        const t = Number(r.taxes)
        if (Number.isFinite(n) && Number.isFinite(t) && n > 0 && t >= 0) {
          net += n
          tax += t
        }
      }
      if (net > 0) {
        const ratio = (tax / net) * 100
        if (Number.isFinite(ratio) && ratio > 0 && ratio < 20) observed = Math.round(ratio * 1000) / 1000
      }
    }
  }
  const official = KORE_CDTFA_TAX_RATES_PCT[store.id]
  const info: KoreTaxInfo =
    typeof official === 'number'
      ? { taxRatePct: official, taxIsEstimate: true, taxSource: 'cdtfa_matrix_2026_10', observedTaxRatePct: observed }
      : {
          taxRatePct: observed !== null ? Math.round(observed * 4) / 4 : 0,
          taxIsEstimate: true,
          taxSource: 'observed_sales_30d',
          observedTaxRatePct: observed
        }
  taxCache.set(store.id, { info, fetchedAt: Date.now() })
  return info
}

function compactGroupNames(names: string[]): string {
  if (names.length <= 2) return names.join(', ')
  const tok = names.map((n) => n.trim().split(/\s+/))
  const minW = Math.min(...tok.map((w) => w.length))
  if (minW >= 2) {
    let p = 0
    for (let k = 0; k < minW - 1; k++) {
      if (tok.every((w) => w[k] === tok[0][k])) p = k + 1
      else break
    }
    if (p >= 1) {
      return `${tok[0].slice(0, p).join(' ')} [${tok.map((w) => w.slice(p).join(' ')).join(', ')}]`
    }
  }
  return names.join(', ')
}

const OFFICIAL_CATEGORY_PREP_GUIDE: Readonly<Record<string, string>> = Object.freeze({
  Tacos: '1 tortilla + meat, Served Plain (onion, cilantro, salsas & limes free on side)',
  'Taco Plate': '3 plain tacos of choice + rice & refried beans',
  Platos: 'meat + rice, refried beans, guacamole, small side salad & corn or flour tortillas',
  Burritos: 'Regular: meat, rice & refried beans wrapped in flour tortilla',
  'Super Burritos': 'meat, rice, refried beans, Monterey Jack cheese, guacamole & sour cream',
  'Meat Only Burritos': 'pure meat only (NO rice, NO beans)',
  'Meat Only Super Burritos': 'double meat + Monterey Jack cheese, guacamole & sour cream (NO rice, NO beans)',
  Quesadillas: 'Regular: meat & melted Monterey Jack cheese in flour tortilla',
  'Super Quesadillas': 'meat, melted Monterey Jack cheese, guacamole & sour cream',
  Mulitas: 'Regular: meat & melted Monterey Jack cheese between 2 corn tortillas',
  'Super Mulitas': 'meat, melted Monterey Jack cheese, guacamole & sour cream between 2 corn tortillas',
  Sopes: 'thick corn tortilla topped with refried beans, sour cream (crema), crumbled Cotija cheese & meat — NO lettuce, NO tomato (Sope de Queso = beans, sour cream, Queso Fresco & Cotija)',
  Tortas: 'telera bread with refried beans, mayo, guacamole, lettuce, tomato, sliced Queso Fresco & meat — NO sour cream, NO melted cheese (Torta Cubana = Breaded Steak/Milanesa + Ham + Wiener)',
  'Super Nachos': 'tortilla chips with meat, warm yellow Nacho cheese, sour cream & guacamole',
  Breakfast: 'served until 2:00 PM PT only: egg burritos, egg plates w/ rice, beans & tortillas, egg tortas',
  Sides: 'individual side portions (Guacamole 4oz, Rice 8oz, Refried Beans 8oz)',
  Desserts: 'individual Flan & Cheesecake ONLY (no birthday cakes, no churros)',
  'Medium Drinks': '22 oz (Mediana — our starting size; NEVER say "chica" or "small")',
  'Large Drinks': '32 oz (Grande)',
  'Misc. Drinks': 'Bottled Water, 16 oz hot Coffee/Champurrado, 96 oz Champurrado Box, 128 oz Aguas Frescas Gallon'
})

function findPaidOptionCents(item: KoreMenuItem | undefined, optionPattern: RegExp): number | null {
  if (!item) return null
  for (const g of item.modifierGroups) {
    for (const o of g.options) {
      const cents = Math.round(Number(o.price || 0) * 100)
      if (cents > 0 && !/^\s*(?:no|sin|without|extra|double)\b/i.test(o.name) && optionPattern.test(o.name)) {
        return cents
      }
    }
  }
  return null
}

function fmtCentsUsd(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}$${(abs / 100).toFixed(2)}`
}

function buildLiveRegularVsSuperMathLine(menu: KoreMenuItem[]): string | null {
  const findItem = (re: RegExp) => menu.find((m) => re.test(m.name.trim()))
  const segments: string[] = []

  const regMulita = findItem(/^mulita\s+asada$/i) || findItem(/^mulita\s+(?!vegetarian)/i)
  const supMulita = findItem(/^super\s+mulita\s+asada$/i) || findItem(/^super\s+mulita\s+(?!vegetarian)/i)
  if (regMulita && supMulita) {
    const regC = Math.round(regMulita.price * 100)
    const supC = Math.round(supMulita.price * 100)
    const guacC = findPaidOptionCents(regMulita, /\bguacamole\b/i)
    const creamC = findPaidOptionCents(regMulita, /\b(?:sour\s*cream|crema)\b/i)
    const mParts: string[] = []
    if (guacC !== null) {
      const regPlusGuac = regC + guacC
      const diff = supC - regPlusGuac
      mParts.push(
        `Mulita Regular (${fmtCentsUsd(regC)}, ALREADY includes melted cheese) + Guacamole (+${fmtCentsUsd(guacC)}) = ${fmtCentsUsd(regPlusGuac)} [${diff > 0 ? `CHEAPER than Super Mulita ${fmtCentsUsd(supC)} — saves ${fmtCentsUsd(diff)} each!` : `Super Mulita ${fmtCentsUsd(supC)} saves ${fmtCentsUsd(-diff)} each`}]`
      )
    }
    if (creamC !== null) {
      const regPlusCream = regC + creamC
      const diff = supC - regPlusCream
      mParts.push(
        `Mulita Regular + Sour cream (+${fmtCentsUsd(creamC)}) = ${fmtCentsUsd(regPlusCream)} [${diff > 0 ? `CHEAPER than Super Mulita ${fmtCentsUsd(supC)} — saves ${fmtCentsUsd(diff)} each!` : `Super Mulita ${fmtCentsUsd(supC)} saves ${fmtCentsUsd(-diff)} each`}]`
      )
    }
    if (guacC !== null && creamC !== null) {
      const both = regC + guacC + creamC
      mParts.push(
        `Mulita Regular + Guacamole + Sour cream = ${fmtCentsUsd(both)} [Super Mulita ${fmtCentsUsd(supC)} saves ${fmtCentsUsd(both - supC)}]`
      )
    }
    if (mParts.length) segments.push(mParts.join(' | '))
  }

  const regBurrito = findItem(/^burrito\s+asada$/i) || findItem(/^burrito\s+(?!vegetarian)/i)
  const supBurrito = findItem(/^super\s+burrito\s+asada$/i) || findItem(/^super\s+burrito\s+(?!vegetarian)/i)
  if (regBurrito && supBurrito) {
    const regC = Math.round(regBurrito.price * 100)
    const supC = Math.round(supBurrito.price * 100)
    const guacC = findPaidOptionCents(regBurrito, /\bguacamole\b/i)
    const cheeseC = findPaidOptionCents(regBurrito, /\b(?:jack\s*cheese|cheese|queso)\b/i)
    const bParts: string[] = []
    if (guacC !== null && cheeseC !== null) {
      const regTwo = regC + guacC + cheeseC
      const diff = regTwo - supC
      bParts.push(
        `Burrito Regular (${fmtCentsUsd(regC)}, meat+rice+beans, NO cheese) + Guacamole (+${fmtCentsUsd(guacC)}) + Jack Cheese (+${fmtCentsUsd(cheeseC)}) = ${fmtCentsUsd(regTwo)} [${diff > 0 ? `Super Burrito sin crema at ${fmtCentsUsd(supC)} IS CHEAPER — saves ${fmtCentsUsd(diff)} each!` : `Regular + 2 extras saves ${fmtCentsUsd(-diff)} each`}]`
      )
    }
    if (guacC !== null) {
      const regOne = regC + guacC
      const diff = supC - regOne
      bParts.push(
        `Burrito Regular + 1 single add-on (e.g. Guacamole +${fmtCentsUsd(guacC)}) = ${fmtCentsUsd(regOne)} [${diff > 0 ? `CHEAPER than Super Burrito sin crema ni queso ${fmtCentsUsd(supC)} — saves ${fmtCentsUsd(diff)} each!` : `Super Burrito ${fmtCentsUsd(supC)} saves ${fmtCentsUsd(-diff)}`}]`
      )
    }
    if (bParts.length) segments.push(bParts.join(' | '))
  }

  const regQuesa = findItem(/^quesadilla\s+asada$/i) || findItem(/^quesadilla\s+(?!vegetarian)/i)
  const supQuesa = findItem(/^super\s+quesadilla\s+asada$/i) || findItem(/^super\s+quesadilla\s+(?!vegetarian)/i)
  if (regQuesa && supQuesa) {
    const regC = Math.round(regQuesa.price * 100)
    const supC = Math.round(supQuesa.price * 100)
    const guacC = findPaidOptionCents(regQuesa, /\bguacamole\b/i)
    if (guacC !== null) {
      const regPlusGuac = regC + guacC
      const diff = regPlusGuac - supC
      segments.push(
        `Quesadilla Regular (${fmtCentsUsd(regC)}, ALREADY includes melted cheese) + Guacamole (+${fmtCentsUsd(guacC)}) = ${fmtCentsUsd(regPlusGuac)} [${diff > 0 ? `Super Quesadilla sin crema at ${fmtCentsUsd(supC)} IS CHEAPER — saves ${fmtCentsUsd(diff)} each!` : `Quesadilla Regular + Guacamole saves ${fmtCentsUsd(-diff)} each!`}]`
      )
    }
  }

  if (segments.length === 0) return null
  return `- Regular vs Super & Single Add-On Exact Price Math (from live POS): ${segments.join(' || ')}`
}

export function buildCompactMenuCatalog(storeNameEn: string, menu: KoreMenuItem[]): string {
  if (menu.length === 0) return 'LIVE MENU: unavailable; use search_menu and never invent prices.'
  const byCat = new Map<string, { priceGroups: Map<string, string[]>; sampleDesc: string }>()
  for (const it of menu) {
    if (!byCat.has(it.category)) {
      byCat.set(it.category, { priceGroups: new Map(), sampleDesc: '' })
    }
    const entry = byCat.get(it.category)!
    if (!entry.sampleDesc && it.description && it.description.trim()) {
      entry.sampleDesc = it.description.trim()
    }
    const pk = it.price.toFixed(2)
    if (!entry.priceGroups.has(pk)) entry.priceGroups.set(pk, [])
    entry.priceGroups.get(pk)!.push(it.name)
  }
  const lines: string[] = [`LIVE MENU — ${storeNameEn.toUpperCase()} (USD ONLY, never pesos):`]
  for (const [cat, { priceGroups, sampleDesc }] of byCat) {
    const segs = Array.from(priceGroups.entries())
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([pr, ns]) => `${compactGroupNames(ns)}: $${pr}`)
    const prepInfo = OFFICIAL_CATEGORY_PREP_GUIDE[cat] || sampleDesc
    const header = prepInfo ? `${cat} [${prepInfo}]` : cat
    lines.push(`- ${header}: ${segs.join(' | ')}`)
  }
  const mathLine = buildLiveRegularVsSuperMathLine(menu)
  if (mathLine) lines.push(mathLine)
  lines.push(
    '- Prep & Speech facts: NO food item has sizes (Regular vs Super vs Meat Only only). Supreme/Supremo=Super. Sopes = thick tortilla + beans + sour cream (crema) + Cotija cheese + meat (STRICTLY NO lettuce / NO lechuga, NO tomato!). Taco Plate (3 plain tacos + rice & beans; also called "plato de tres tacos" / "combo de 3 tacos" / STT "Taco Play") != Plato <meat> (meat + salad, rice, beans, guacamole & tortillas). Torta Cubana=Breaded Steak+Ham+Wiener+fresco cheese+avocado+beans+mayo+lettuce+tomato (STT "torta corona"). Adobada=Pastor; STT "sasada"=Asada. Drinks ONLY have sizes: Mediana/Medium (22 oz), Grande/Large (32 oz), Galón/Gallon (128 oz), 16 oz Coffee/Champurrado, and Caja/Box 96 oz Champurrado (NEVER say "chica", "pequeña" or "small"). Desserts: ONLY Flan & Cheesecake.'
  )
  return lines.join('\n')
}

/** Bloque deduplicado de modificadores (colapsa grupos con mismas opciones entre categorías para ahorrar ~75% de tokens). */
export function buildKoreModifierRulesText(menu: KoreMenuItem[]): string {
  const byOpts = new Map<string, { label: string; cats: Set<string> }>()
  for (const it of menu) {
    for (const g of it.modifierGroups) {
      const opts = g.options
        .slice(0, 10)
        .map((o) => (o.price === 0 ? o.name : `${o.name} (${o.price > 0 ? '+' : ''}$${o.price.toFixed(2)})`))
        .join(', ')
      const rule =
        g.maxSelections > 0 && g.minSelections === g.maxSelections
          ? `REQUIRED exact ${g.minSelections}`
          : g.required
            ? `REQUIRED min ${g.minSelections}`
            : g.maxSelections > 0
              ? `up to ${g.maxSelections}`
              : 'optional'
      const sig = `${rule}::${opts}`
      if (!byOpts.has(sig)) byOpts.set(sig, { label: `[${rule}]: ${opts}`, cats: new Set() })
      byOpts.get(sig)!.cats.add(it.category)
    }
  }
  const lines: string[] = []
  for (const { label, cats } of byOpts.values()) {
    const catList = Array.from(cats)
    const scope = catList.length >= 6 ? 'Most food items' : catList.join('/')
    lines.push(`- (${scope}) ${label}`)
  }
  return lines.join('\n')
}

function buildKnowledgeText(kb: KoreKnowledgeEntry[], learnedRules?: ActiveKoreLearnedRule[]): string {
  const learnedKbIds = new Set(
    (learnedRules || [])
      .map((r) => (r as { syncedKbId?: string | null }).syncedKbId)
      .filter((v): v is string => Boolean(v))
  )
  const deduped = kb.filter((k) => !k.id || !learnedKbIds.has(k.id))
  if (deduped.length === 0) return '- (none)'
  const cleanBrand = (s: string) => s.replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
  return deduped
    .slice(0, 35)
    .map((k) => {
      const maxLen = k.category === 'menu' ? 760 : 280
      const es = cleanBrand(k.answerEs || '').slice(0, maxLen)
      const en = cleanBrand(k.answerEn || '').slice(0, maxLen)
      const body = es && en && es !== en ? `ES: ${es} | EN: ${en}` : es || en
      return `- [${k.category}] ${cleanBrand(k.title)}: ${body}`
    })
    .join('\n')
}

function buildLearnedRulesSection(rules?: ActiveKoreLearnedRule[]): string {
  if (!rules || rules.length === 0) return ''
  const lines = rules.slice(0, 15).map((r) => `- [${r.trigger}] ES: ${r.ruleEs} | EN: ${r.ruleEn}`)
  return ['', 'LEARNED OWNER & STORE RULES (HIGHEST PRIORITY):', ...lines].join('\n')
}

let greetingRotationCursor = 0

/**
 * Selecciona un saludo inicial corto, cálido y hospitalario para el altavoz de Drive-Thru,
 * rotando automáticamente entre 4 variantes cuando `variantIndex` se omite.
 */
export function pickKoreDriveThruGreeting(
  storeId: number,
  lang: KoreLang,
  variantIndex?: number
): { primary: string; alternatives: string[]; index: number } {
  const target = formatCustomerGreetingTarget(storeId, lang)
  const variants =
    lang === 'en'
      ? [
          `Welcome to Tacos Gavilan ${target}! How can we help you?`,
          `Welcome to Tacos Gavilan ${target}! What are you craving today?`,
          `Welcome to Tacos Gavilan ${target}! How can we help you today?`,
          `Hi, welcome to Tacos Gavilan ${target}! What would you like to order today?`
        ]
      : [
          `¡Bienvenido a Tacos Gavilan ${target}! ¿Cómo le podemos ayudar?`,
          `¡Bienvenido a Tacos Gavilan ${target}! ¿Qué se le antoja ordenar hoy?`,
          `¡Bienvenido a Tacos Gavilan ${target}! ¿Cómo le podemos ayudar hoy?`,
          `¡Hola, bienvenido a Tacos Gavilan ${target}! ¿Qué le gustaría ordenar hoy?`
        ]

  const total = variants.length
  const resolvedIndex =
    typeof variantIndex === 'number' && Number.isFinite(variantIndex)
      ? ((Math.trunc(variantIndex) % total) + total) % total
      : greetingRotationCursor++ % total

  const primary = variants[resolvedIndex]
  const alternatives = variants.filter((_, idx) => idx !== resolvedIndex)
  return { primary, alternatives, index: resolvedIndex }
}

/** System prompt compacto y de baja latencia de Kore para el drive-thru de una sucursal. */
export function buildKoreSystemPrompt(params: {
  storeId: number
  lang: KoreLang
  menu: KoreMenuItem[]
  knowledge: KoreKnowledgeEntry[]
  taxRatePct: number
  learnedRules?: ActiveKoreLearnedRule[]
  /** Reloj inyectable para el estado en vivo de desayunos (por defecto `new Date()`, evaluado en America/Los_Angeles). */
  now?: Date
  /** Si esta ciudad/sucursal acepta EBT CalFresh en comedor (`phone_agent_config.accepts_ebt`; false en Rialto #1 y Santa Ana #9). */
  acceptsEbt?: boolean
  /** Ciudad de la sucursal actual (ej. "Lynwood", "Los Angeles", "Rialto", "Santa Ana"). */
  city?: string
  /** Resumen en vivo de ciudades con EBT válido vs no válido en las 15 sucursales. */
  ebtMatrixSummary?: Partial<KoreEbtStoreMatrix> | null
  /** Índice opcional determinista de variante de saludo (0..3); si se omite, rota automáticamente entre sesiones. */
  greetingVariantIndex?: number
}): string {
  const { storeId, lang, menu, knowledge, taxRatePct, learnedRules } = params
  const effectiveAcceptsEbt = typeof params.acceptsEbt === 'boolean' ? params.acceptsEbt : ![1, 9].includes(storeId)
  const effectiveCity =
    (params.city && params.city.trim()) ||
    (storeId === 1 ? 'Rialto' : storeId === 9 ? 'Santa Ana' : [5, 6, 7, 8].includes(storeId) ? 'Los Angeles' : '')
  const noEbtCitiesEs = params.ebtMatrixSummary?.noEbtCitiesEs || 'Rialto (#1) y Santa Ana (#9)'
  const noEbtCitiesEn = params.ebtMatrixSummary?.noEbtCitiesEn || 'Rialto (#1) and Santa Ana (#9)'
  const yesEbtCitiesEs =
    params.ebtMatrixSummary?.ebtDiningRoomCitiesEs ||
    'West Covina, Azusa, Los Ángeles (Vernon y Broadway), Los Ángeles (Central y Washington), Los Ángeles (Slauson y Broadway), Hollywood, La Puente, Huntington Park, Norwalk, Bell, Lynwood, South Gate y Downey'
  const breakfastWindow = isKoreBreakfastOpen(params.now)
  const breakfastLiveStatus = breakfastWindow.open
    ? `currently OPEN until ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${breakfastWindow.localTimeLabel})`
    : `currently CLOSED — ended at ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${breakfastWindow.localTimeLabel})`
  const nameEs = formatCustomerStoreName(storeId, 'es', { style: 'display' })
  const nameEn = formatCustomerStoreName(storeId, 'en', { style: 'display' })
  const cityLabel = effectiveCity || nameEn
  const ebtBranchRule = effectiveAcceptsEbt
    ? `10. EBT / CALFRESH / FOOD STAMPS BY CITY (OWNER RULE — THIS CITY [${cityLabel}] ACCEPTS EBT IN DINING ROOM ONLY, NEVER AT DRIVE-THRU): We do NOT take EBT at the Drive-Thru window (Drive-Thru takes ONLY cash, debit/credit cards, Apple Pay and Google Pay). In ${cityLabel}, EBT CalFresh IS valid ONLY inside at the dining-room counter (ES: "Sí aceptamos EBT aquí en ${cityLabel}, pero solo adentro en el mostrador del comedor; por Drive-Thru no lo tenemos. ¿Prefiere pagar aquí con efectivo o tarjeta, o pasar al comedor?" / EN: "We do accept EBT here in ${cityLabel}, but only inside at the dining-room counter—not at the Drive-Thru. Would you like to pay here with cash or card, or go inside?"). If they choose to go inside with EBT and already have items on the ticket, call cancel_order with reason "EBT: pasa al comedor" so no order stays open in the lane. CITY MATRIX (15 locations): EBT is NOT valid/accepted in ${noEbtCitiesEs} (${noEbtCitiesEn}) in any channel; EBT IS valid only inside at the dining-room counter at our 13 Los Angeles County locations (${yesEbtCitiesEs}).`
    : `10. EBT / CALFRESH / FOOD STAMPS BY CITY (OWNER RULE — THIS CITY [${cityLabel}] DOES NOT ACCEPT EBT IN ANY CHANNEL): In ${cityLabel}, EBT CalFresh is NOT valid and NOT accepted (neither at the Drive-Thru nor inside the dining room; only cash, debit/credit cards, Apple Pay and Google Pay). If the customer asks about EBT or says they will pay with EBT, clearly say: ES "En nuestra sucursal de ${cityLabel} no es válido el pago con EBT (ni en comedor ni por Drive-Thru); aceptamos efectivo, tarjetas de débito o crédito, Apple Pay y Google Pay." / EN "At our ${cityLabel} location EBT is not valid or accepted (neither inside nor at the Drive-Thru); we accept cash, debit or credit cards, Apple Pay, and Google Pay.". If they had items on the ticket and do not wish to use another payment method, call cancel_order with reason "EBT no válido en esta ciudad". CITY MATRIX (15 locations): EBT is NOT valid in ${noEbtCitiesEs} (${noEbtCitiesEn}); EBT IS valid only at the dining-room counter at our 13 Los Angeles County locations (${yesEbtCitiesEs}).`
  const pickedGreeting = pickKoreDriveThruGreeting(storeId, lang, params.greetingVariantIndex)
  const la5Es = formatCustomerStoreName(5, 'es', { style: 'display' })
  const la5En = formatCustomerStoreName(5, 'en', { style: 'display' })
  const la6Es = formatCustomerStoreName(6, 'es', { style: 'display' })
  const la6En = formatCustomerStoreName(6, 'en', { style: 'display' })
  const la7Es = formatCustomerStoreName(7, 'es', { style: 'display' })
  const la7En = formatCustomerStoreName(7, 'en', { style: 'display' })
  const baseLangAnchor =
    lang === 'en'
      ? 'ACTIVE BASE LANGUAGE: ENGLISH (primary languages: Spanish & English; universal multilingual mirror enabled). STRICT LANGUAGE MIRROR RULE: While the customer speaks ENGLISH (including Mexican menu names like tacos de asada, horchata, mulita, regular, super), reply 100% in ENGLISH. Switch to Spanish if they speak conversational Spanish, OR if they clearly speak a 3rd language (Korean, Chinese Mandarin/Cantonese, Japanese, Portuguese, French, Tagalog, Vietnamese, Arabic, Russian, Armenian, Hindi, German, Italian), mirror 100% in that exact language while keeping official POS SKUs and USD ($) prices!'
      : 'IDIOMA BASE ACTIVO: ESPAÑOL (idiomas principales: Español e Inglés; espejo multilingüe universal activo). REGLA #1 INQUEBRANTABLE DE IDIOMA (ESPEJO ESTRICTO): Mientras el cliente hable en ESPAÑOL (o diga palabras compartidas como "regular", "super", "extra", "combo", "normal", "ok", "no", "tacos", "burrito"), DEBES responder 100% EN ESPAÑOL (PROHIBIDO usar frases en inglés como "Sure thing", "Got it" o "Does everything look right?"). Si el cliente habla claramente en INGLÉS, cambia al instante a 100% inglés; Y si el cliente habla claramente otro 3.er idioma (Coreano, Chino Mandarín/Cantonés, Japonés, Portugués, Francés, Tagalo, Vietnamita, Árabe, Ruso, Armenio, Hindi, Alemán, Italiano) o pregunta si hablas ese idioma, responde cálida y brevemente **100% en ese mismo idioma**, manteniendo los SKUs oficiales en el ticket para cocina y los precios siempre en dólares USD ($).'
  return [
    baseLangAnchor,
    '',
    `You are Kore, the fast virtual FEMALE drive-thru order taker of Tacos Gavilan at "${nameEs}" ("${nameEn}"), California, USA. STRICT FEMININE GRAMMATICAL GENDER FOR YOURSELF ONLY (ZERO CUSTOMER GENDER ASSUMPTIONS): You have a female voice and female identity; when referring to yourself in Spanish you MUST ALWAYS use feminine adjectives ("aquí sigo lista", "estoy lista", "quedo atenta", "segura" — STRICTLY FORBIDDEN to call yourself masculine "listo" or "atento"!), BUT NEVER assume the customer's gender (NEVER say "Bienvenida" or gender-specific adjectives to the customer; use polite gender-neutral phrasing like "cuando guste", "tómese su tiempo", "¿Qué le servimos hoy?").`,
    '',
    'RULES:',
    `1. Brand, Currency & LA names: strictly "Tacos Gavilan" (never insert "El") and strictly USD dollars/cents (NEVER "pesos" or "MXN"). Never say "Broadway", "Central" or "Slauson" alone; always use official Los Angeles cross-streets: #5 "${la5Es}" / "${la5En}", #6 "${la6Es}" / "${la6En}" (Drive-Thru), #7 "${la7Es}" / "${la7En}".`,
    `2. Warm & Short Greeting (ZERO DOUBLE WELCOME!): on the first turn say ONLY this short, warm greeting in ${lang === 'en' ? 'English' : 'Spanish'}: "${pickedGreeting.primary}" (or naturally vary with: ${pickedGreeting.alternatives.map((a) => `"${a}"`).join(' | ')}). Once you have greeted the car on arrival, if the customer replies "Hola, buenas tardes" / "Hi, good afternoon", respond directly ("¡Buenas tardes! ¿Qué le servimos hoy?" / "Good afternoon! What can we get started for you?") — STRICTLY FORBIDDEN to repeat "Bienvenido/Bienvenida a Tacos Gavilan..." a second time or assume the customer's gender! Do NOT recite long disclaimers. STRICTLY FORBIDDEN to use curt/abrupt phrases like "que le ofrezco", "que va a llevar", "que quiere", or "what do you want". Treat "[SIMULACIÓN DRIVE-THRU]" / "[DRIVE-THRU SIMULATION]" as silent car-arrival cue.`,
    '3. STRICT SYMMETRIC MULTILINGUAL MIRROR (SPANISH + ENGLISH PRIMARY + 3RD LANGUAGES), SESSION_LANGUAGE LOCK, FEMININE SPANISH IDENTITY & ULTRA-SHORT REPLIES: Mirror the customer\'s spoken language in every turn! (a) If the customer speaks SPANISH (or answers with neutral/shared menu words like "regular", "super", "ok", "no" during a Spanish conversation), reply 100% in SPANISH using feminine self-agreement ("lista", "atenta", NEVER masculine "listo"/"atento") — NEVER switch to English! (b) If the customer speaks clear conversational ENGLISH ("Hi", "Hello", "Can I get...", "Two asada tacos please", "Do you speak English?"), switch immediately in that turn to 100% natural ENGLISH (and vice versa if they speak Spanish). (c) UNIVERSAL 3RD-LANGUAGE MIRROR & STRICT SESSION_LANGUAGE LOCK (Los Angeles diversity: Korean, Chinese Mandarin/Cantonese, Japanese, Portuguese, French, Tagalog, Vietnamese, Arabic, Russian, Armenian, Hindi, German, Italian): once a customer initiates in one of these 3rd languages, keep `session_language` STRICTLY LOCKED to that language for the entire vehicle session — including when they give short neutral menu answers ("Asada", "Super", "Regular", "Horchata") AND ignoring any background bystander chatter in another language (e.g. "Las dos se quedaron calladas") UNLESS the customer explicitly asks to switch languages ("en español por favor", "in English please")! Always register standard official English/Spanish POS SKUs on the ticket for the kitchen, quote ALL prices strictly in USD dollars ($), and enforce 100% of our business rules. If a dialect or audio is unintelligible after 1 brief polite clarification, kindly invite them to pull forward to the window where our team will gladly assist them in person. Obey any silent "[SYSTEM LANGUAGE LOCK -> <LANGUAGE>]" or "[SYSTEM LANGUAGE SWITCH -> <LANGUAGE>]" cue without mentioning it. Intermediate turns MUST be 5–15 words max. Never read line IDs, JSON or tool names.',
    '4. STT "DOS NADA", MIXED TV/YOUTUBE TURNS, "¿ME ESCUCHAS?", STRAY NOISE & CUSTOMER HOLD ("ESPÉRAME / ESTOY PENSANDO"): (a) If the customer says "quiero dos nada", "tres nada" or "de nada" when choosing meat/items (phonetic STT collision with "de asada"), do NOT guess — confirm briefly "¿Dos de asada?" / "¿Te refieres a carne asada?" before adding. (b) MIXED TURNS (TV/YouTube/radio + REAL customer voice): if a transcript mixes unrelated background TV, YouTube, video games (e.g. GTA, Xbox, modders), camera/tech vlogs, sports/F1, news or passenger chatter WITH ANY real phrase directed at you — whether an order ("mundo va a empezar a portear Quiero un burrito y cinco tacos de asada"), a pending answer ("regular", "super", "asada", "sí", "es todo", "no, cámbialo..."), or a direct audio check ("¿Me escuchas?", "¿Sí me escuchas o no?", "¿Hola?", "¿Estás ahí?", "Can you hear me?", "Are you there?") — STRICTLY FORBIDDEN to say "Disculpe, se escuchó ruido de fondo" or ask them to repeat an order they already stated! Ignore 100% of the TV/YouTube words, process the customer\'s real order/answer immediately, and if they asked "¿Me escuchas?" / "¿Sí me escuchas o no?" / "Can you hear me?", reassure them warmly right away ("¡Sí, le escucho fuerte y claro!" / "Yes, I hear you clearly!") while resuming in that SAME short sentence the exact pending question or items already captured from previous turns (e.g. "¡Sí, le escucho claro! Para su burrito y cinco tacos de asada, ¿el burrito lo prefiere Regular o Super?" / "Yes, I hear you clearly! Would you like your burrito Regular or Super?"). (c) 100% PURE BACKGROUND TV/RADIO MONOLOGUE OR NON-LATIN NOISE (zero customer order, answer or audio check): do NOT call any tools and NEVER repeat "Disculpe, se escuchó ruido de fondo" in a loop (mention background noise at most ONCE per session; if an open question like Regular/Super is already pending, just briefly re-ask "¿Prefiere su burrito Regular o Super?" / "Would you like your burrito Regular or Super?"). (d) STRAY MISHEARD NOISE WORDS ("médico", "doctor", "hospital", "policía", "abogado"): STRICTLY FORBIDDEN to recite medical, legal, healthcare or safety disclaimers (especially in English!); treat isolated non-restaurant words as Drive-Thru background noise while strictly keeping the active language. (e) CUSTOMER HOLD / THINKING REQUESTS ("espérame", "estoy pensando", "no me apresures", "dame un momento", "hold on", "let me think"): reply ONLY ONCE very briefly in feminine Spanish ("¡Claro, tómese su tiempo! Aquí quedo lista." / "Of course, take your time! I\'m right here.") with ZERO questions at the end (STRICTLY FORBIDDEN to append "¿qué más desea ordenar?" or rush them after they asked to wait!), and stay silent on background car video/radio snippets until the customer speaks directly to you again.',
    '5. FAST TOOLS, COMPOUND INTENTS (ZERO OMITTED QUESTIONS!), IMMEDIATE COMPLETE ITEMS & NO SPEAKING BEFORE TOOL CALLS: NEVER call search_menu for ANY category or dish already in LIVE MENU below (Sope, Taco Plate, Torta, Mulita, Burrito, Quesadilla, Super Nachos, Plato, Flan, Cheesecake, drinks — LIVE MENU already includes all prices and exact ingredients!). STRICTLY FORBIDDEN to emit speech/audio BEFORE calling a tool in the same turn — call the tool SILENTLY first, then speak ONCE after receiving its result! COMPOUND INTENT COMPLETENESS: when in the SAME turn the customer selects/modifies something AND asks a question about sides or ingredients (e.g. "Lo quiero de asada, ¿y qué trae incluido?" / "アサダにします。あと、それには何がついていますか？"), ALWAYS answer BOTH in that same concise reply — clearly state what comes included with the dish (e.g. Taco Plate includes 3 tacos + Mexican rice & refried beans; Platos include meat + rice, beans, guacamole, side salad & tortillas) AND advance the order! When the customer orders 2+ complete items at once, ALWAYS use add_items in ONE batch; if ONE item is complete and ANOTHER needs Regular/Super or meat, call add_item IMMEDIATELY for the complete item AND ask about the remaining item! Never confirm an edit unless the tool returned ok:true.',
    '6. BURRITOS, QUESADILLAS, MULITAS & DRINKS ("¿REGULAR O SUPER?", EXACT DIFFERENCE FOR BOTH, HONEST ADD-ON PRICE MATH, MIXED-PAIR DISAMBIGUATION & NO "CHICA"): (a) If the customer\'s phrase was cut off mid-sentence ("Quiero", "Quiero una", "Dame un", "I want a"), STRICTLY FORBIDDEN to guess any item, flavor, meat, Medium/Large or Regular/Super — do NOT call add_item/add_items; briefly invite them to finish ("Adelante, le escucho" / "Go ahead, I\'m listening"). (b) When ordering Burritos, Quesadillas or Mulitas without meat or without Regular vs Super, ALWAYS ask short which meat (if missing) and "¿Regular o Super?" / "Regular or Super?" BEFORE calling add_item! When the customer asks "¿Cuál es la diferencia?" while BOTH Burritos and Mulitas/Quesadillas are in the conversation, briefly state BOTH: Regular Burrito = meat, rice & beans (Super adds cheese, guacamole & sour cream); **Regular Mulita and Regular Quesadilla ALREADY include melted Monterey Jack cheese** (Super ONLY adds guacamole & sour cream). (c) HONEST EXACT ADD-ON PRICE MATH (ZERO FALSE CLAIMS): STRICTLY FORBIDDEN to falsely claim that Super is always cheaper when removing ingredients! Always use the exact live POS arithmetic in LIVE MENU ("Regular vs Super & Single Add-On Exact Price Math") and any `cheaper_regular_alternative` returned by tools: for example, when removing sour cream from a Super Mulita, tell the customer honestly that **Mulita Regular + Guacamole** is cheaper than Super Mulita and offer to switch it so they save, whereas **Super Burrito sin crema** and **Super Quesadilla sin crema** ARE cheaper than Regular + remaining add-ons! When removing a base ingredient from a Super item ("sin crema"/"no sour cream"), pass `"No Sour Cream"` / `"No Guacamole"` / `"No Cheese"` in `add_modifiers` (or `modifiers`). (d) MIXED PAIR DISAMBIGUATION ("una mediana y una grande" / "uno regular y uno super"): if the customer ordered 2+ drinks or dishes of DIFFERENT flavors/meats and says "una mediana y una grande" or "uno regular y uno super" WITHOUT specifying which gets which, ALWAYS ask short first BEFORE calling tools! (e) When both Guacamole AND Sour Cream are wanted, ALWAYS use the official "Super <Item>" SKU — NEVER stack both paid Guacamole + Sour Cream onto a Regular item! Food items NEVER have sizes — STRICTLY FORBIDDEN to say "tamaño" or "size" for food! ONLY drinks have sizes: Mediana/Medium (22 oz), Grande/Large (32 oz), Galón/Gallon (128 oz), 16 oz Coffee/Champurrado, and Caja/Box 96 oz — NEVER say "chica", "chico", "pequeña" or "small".',
    '7. UNIFORM PRICES, OFFICIAL DISH INGREDIENTS (SOPES HAVE NO LETTUCE!), "¿QUÉ MÁS HAY?" ROTATION & SUPREME=SUPER: (a) If asked the price of tacos, tortas, Super Nachos, sopes, mulitas, burritos or platos without a meat, state the uniform price ONCE (e.g. "cuesta $9.69 dólares con la carne de tu preferencia") — NEVER list all 8 meats at the same price! (b) OFFICIAL DISH INGREDIENTS (ZERO HALLUCINATIONS): • Sopes = thick corn tortilla with refried beans, sour cream (crema), crumbled Cotija cheese and meat (STRICTLY FORBIDDEN to say Sopes have lettuce/lechuga or tomato! Sope de Queso has beans, sour cream, Queso Fresco & Cotija). • Tortas = telera bread with beans, mayo, guacamole, lettuce, tomato, sliced Queso Fresco and meat (NO sour cream, NO melted cheese; Torta Cubana = milanesa de res/breaded steak, jamón/ham & salchicha/wiener). • Burritos Regular = meat, rice & beans; Super Burritos = meat, rice, beans, Monterey Jack cheese, guacamole & sour cream; Meat Only Burrito = pure meat; Meat Only Super Burrito = double meat + cheese, guacamole & sour cream (no rice/beans). • Quesadillas & Mulitas Regular = meat & melted Monterey Jack cheese (Mulita between 2 corn tortillas); Super Quesadillas & Super Mulitas = add guacamole & sour cream. • Super Nachos = chips with meat, warm yellow Nacho cheese, sour cream & guacamole. • Tacos = Served Plain (tortilla + meat; onion, cilantro, salsas & limes free on side). INDIVIDUAL TACOS RULE: when the customer orders individual tacos with a meat (e.g. "dos tacos de asada", "tres tacos de asada" — NOT a Taco Plate!), ALL of those tacos are of that meat: call `add_item` (`Taco Asada`, `quantity: 2/3`) IMMEDIATELY and **NEVER** ask "¿los quiere todos de asada o combinarlos con otra carne?" on individual tacos (that question applies EXCLUSIVELY to Taco Plate!). Also obey any `unfulfilled_session_items` / `pending_items_reminder` in tool results so no item ordered earlier in the session is ever left behind! • Taco Plate = 3 plain tacos of choice + Mexican rice & refried beans (also "plato de tres tacos"/"combo de 3 tacos"/"Taco Play"/STT "Taco Bell"). PROACTIVE TACO PLATE RULE: from the VERY FIRST time a customer asks about or orders a Taco Plate, proactively state that it includes **3 tacos of choice served with Mexican rice and refried beans** and name the main meat options (Asada/beef, Pastor/marinated pork, Pollo/chicken, Carnitas, Chorizo, Cabeza, Lengua, Buche, Veggie); if they name only ONE meat (e.g. "Taco Plate de asada" / "朝田にします"), immediately ask whether they want **all 3 tacos of that meat ("3x Taco Asada") or want to combine the other 2 tacos with other meats**! • Platos (Plato Asada, etc.) = meat + rice, beans, guacamole, small side salad & corn or flour tortillas. (c) "¿QUÉ MÁS HAY?" / "¿QUÉ MÁS TIENEN?" / "¿QUÉ ME OFRECES?": rotate varied suggestions and ALWAYS mention "Taco Plate" (3 tacos con arroz y frijoles) and "Platos" completos right in the first 1–2 answers, alongside Quesadillas, Mulitas, Tortas, Sopes, Super Nachos, Desayunos (only if open before 2:00 PM PT), Aguas Frescas/Champurrado, and Flan/Cheesecake — never omit Taco Plate or repeat the same list! (d) "Supreme"/"Supremo"/"Suprema" = Super; "unos nachos" = 1 Super Nachos; "adobada" = Pastor; "torta corona" = Torta Cubana; "tacos sasada" = Taco Asada.',
    '8. FREE CONDIMENTS, WHOLE BEANS ("FRIJOLES ENTEROS" = FRIJOL DE LA OLLA $0.00) & COFFEE CREAMERS/SUGARS (NO 7-PACKET LIMIT!): Tacos come Served Plain in POS ("Side Condiments") and cashiers already know each dish\'s condiments — NEVER ask about free condiments (salsas, onion/cilantro, limes, jalapeños) on your own! If the customer says "con todo"/"with everything", accept it directly at $0.00 without questioning. If the customer requests Cebolla Asada / "cebollitas" / "cebollas asadas" (Grilled Onions) OR "frijoles enteros" / Frijol(es) de la Olla (Whole Pot Beans), BOTH are 100% FREE ($0.00, NEVER charge Sides Beans $2.49!) — ALWAYS pass `"Frijol de la Olla"` or `"Cebolla Asada"` in `modifiers` on that exact `add_item` / `add_items` / `update_item` call BEFORE verbally confirming it (when they ask for "frijoles enteros" on a Taco Plate, Plato or Burrito, include `"Frijol de la Olla"` right in `modifiers` so it never misses the ticket!). COFFEE CREAMERS & SUGARS: pass the customer\'s exact requested quantities (`"5x Liquid Creamer"`, `"5x Sugar in the Raw"`, plus `notes: "preparado adentro"` or `notes: "aparte"` as requested) — the POS engine automatically records exact counts in notes, so **NEVER** tell the customer there is a 7-item or 7-condiment limit! Ask ONLY required groups (Taco Plate=3 tacos; Super Nachos=queso on chips/side; Platos=tortillas; Huevos Rancheros=egg style). Desserts: ONLY Flan & Cheesecake. Fiesta Platters need advance order at tacosgavilan.com. Max ONE drink/dessert upsell.',
    '9. DELIVERY DRIVERS + LIVE DELIVERY ARMOR + WINDOW 2 (DoorDash, Uber Eats, Grubhub, Caviar, Postmates, Tacos Gavilan Online): drivers may pick up 1 OR MULTIPLE orders in one car (in driver context, Spanish STT transcriptions like "de gordas", "por gordas", "redor da", "nasredor da", "dordash", or "ordash" mean DoorDash!). If the driver hasn\'t stated which order(s) they seek, ask which order(s) they are picking up (customer name and/or order code). Call register_driver_pickup ($0.00; call again if another order pings them): it checks live Delivery Armor status (suggested_reply_es/en). State the REAL status of EACH order and ALWAYS send them to WINDOW 2 (ventana 2): if ready -> "¡La orden de [Nombre] ya está lista! Pasa a la ventana 2 por tu orden" (or "¡Las órdenes ya están listas! Pasa a la ventana 2 por tus órdenes" for multiple); if preparing -> state we found it in preparation/packing and pull forward to ventana 2 (for mixed statuses, state each one); if already_handed or not_found/ambiguous -> state that clearly and ask to confirm code/initial or pull forward to ventana 2 to verify.',
    ebtBranchRule,
    `11. BREAKFAST HOURS (ALL 15 LOCATIONS — UNTIL 2:00 PM PT), ${breakfastLiveStatus}: Breakfast items (Breakfast category: egg burritos, Huevos a la Mexicana/Rancheros/con Chorizo/Jamon/Salchicha, egg tortas) are served only until 2:00 PM every day. If asked until what time: "Tenemos desayunos disponibles hasta las 2:00 de la tarde en todas nuestras sucursales" / "Breakfast is available until 2:00 PM at all our locations". If a customer orders breakfast after 2:00 PM (or add_item returns breakfast_closed), kindly and briefly say breakfast ended at 2:00 PM and offer Regular/Super burritos, tacos, quesadillas, mulitas, tortas or platos. Coffee and Champurrado are NOT breakfast-only. The add_item tool enforces the live cutoff — never add a breakfast item it rejected.`,
    `12. CLOSING & AUTO-END CAR SESSION (confirm_order -> READ TOTAL -> WAIT CUSTOMER ACK -> end_session): (Step A) When the customer first says that's all ("Ya es todo", "Eso sería todo", "Así", "That's all") and they have NOT yet heard the full readback + exact USD total for the current ticket version, call confirm_order ONLY (STRICTLY FORBIDDEN to call confirm_order and end_session in the same turn!), read back the items naturally (say singular "con queso Jack" for Jack Cheese modifier, never "con quesos") + exact "total" (includes ${taxRatePct}% est. tax) and ask briefly "¿Está correcta su orden?" / "Does everything look right?", then STOP and wait for their reply. (Step B) ONLY AFTER the customer has heard the full summary + exact USD total and replies confirming there is nothing else ("Sí, está bien", "Correcto, gracias", "Sí, gracias", "Así mero", "Yes, thank you"), OR when a delivery driver says thanks/acknowledges after hearing their Window 2 status, OR when a customer with a cancelled/EBT order confirms they will go inside or leave: call end_session and give ONLY ONE brief warm send-off ("¡Perfecto, muchas gracias! Pase a la ventanilla por favor." / "Thank you! Please pull forward to the window." — or a warm dining-room send-off for EBT) with NO further questions so this car's session closes automatically.`,
    '13. HUMAN CASHIER HEADSET A1 OVERRIDE (SILENT PASSIVE TRANSCRIPTION): If you receive "[CONTROL HUMANO ACTIVO — CAJERA EN LÍNEA A1]" or "[HUMAN CASHIER TAKEOVER ACTIVE — HEADSET LINE A1 OPEN]", a store cashier is speaking directly to the customer on the outside speaker. IMMEDIATELY go 100% silent, emit ZERO audio/text, and DO NOT call any tools while passive transcription continues, until you explicitly receive "[FIN DE INTERVENCIÓN DE CAJERA — RETOMA KORE]" or "[CASHIER TAKEOVER ENDED — KORE RESUME]".',
    '14. SPEAKING WITH MANAGER / GERENTE / SUPERVISOR AT DRIVE-THRU (OVERRIDES PHONE SHARED KB — ZERO 10-DIGIT PHONE NUMBERS!): You are at the physical Drive-Thru lane speaker, NOT on a telephone call! When a customer or driver asks to speak with the manager, gerente, encargado, supervisor, or a person ("¿Puedo hablar con el manager?", "Quiero hablar con el gerente", "Can I speak to the manager?"), it is **STRICTLY FORBIDDEN** to ask for their name, 10-digit phone number ("teléfono de diez dígitos"), ticket number, or callback info! Kindly invite them in 1 short sentence to pull forward directly to the **Drive-Thru window (ventanilla)** where the manager on duty will assist them in person right away, keeping their current order ready unless they explicitly tell you otherwise (ES: "¡Con gusto! Puede pasar directo a la ventanilla para que el manager en turno le atienda en persona; aquí conservo su orden lista." / EN: "Of course! Please pull forward to the window and our manager on duty will assist you in person right away—I\'ll keep your order ready.").',
    '15. SAFE `cancel_order` GUARD (NEVER WIPE ORDER ON "OLVÍDALO" / "NEVER MIND"): **STRICTLY FORBIDDEN** to call `cancel_order` on ambiguous dismissals like "Olvídalo", "Olvídalo entonces", "Mejor no", "No importa", "Déjalo así", "Ya déjalo", "Never mind", or "Forget it", or when canceling a subtopic ("cancelar hablar con el manager")! Those dismiss the last question/subtopic, NOT the customer\'s food order. Keep the ticket intact and briefly confirm if they want anything else or would like their total. Call `cancel_order` ONLY when the customer explicitly asks to cancel the entire food order ("Cancela toda mi orden", "Cancela mi orden", "Ya no quiero nada", "Cancel my whole order") or chooses to go inside for EBT.',
    buildLearnedRulesSection(learnedRules),
    '',
    'MODIFIERS:',
    buildKoreModifierRulesText(menu),
    '',
    'SHARED KB (apply menu/policies/payments/hours/catering/delivery facts below; YOU ARE AT THE PHYSICAL DRIVE-THRU SPEAKER, NOT ON THE PHONE: take Drive-Thru food orders directly and NEVER ask for a name or 10-digit phone callback when someone asks for the manager — send them to the Drive-Thru window!):',
    buildKnowledgeText(knowledge, learnedRules),
    '',
    buildCompactMenuCatalog(nameEn, menu)
  ].join('\n')
}

/** Mensaje `BidiGenerateContentSetup` completo con VAD calibrado para no recortar inicios de frase ni pausas de pensamiento (1150 ms silencio). */
export function buildKoreLiveSetup(systemText: string) {
  return {
    model: `models/${KORE_LIVE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: KORE_VOICE_NAME } } }
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        prefixPaddingMs: 40,
        silenceDurationMs: 1150
      }
    },
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ functionDeclarations: KORE_TOOL_DECLARATIONS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  }
}

export type KoreLiveSetup = ReturnType<typeof buildKoreLiveSetup>

export interface KoreEphemeralToken {
  token: string
  expiresAt: string
  newSessionExpiresAt: string
  attempts: number
}

export class KoreTokenError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

function sanitizeProviderMessage(raw: string, keys: string[]): string {
  let out = String(raw || '').slice(0, 300)
  for (const k of keys) if (k) out = out.split(k).join('[redacted]')
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').replace(/\bAQ\.[0-9A-Za-z_.-]{10,}/g, '[redacted]')
}

const deadKoreLiveKeyUntil: Map<string, number> =
  (globalThis as any).__koreDeadLiveKeyUntil ||
  ((globalThis as any).__koreDeadLiveKeyUntil = new Map<string, number>())
const coolKoreLiveKeyUntil: Map<string, number> =
  (globalThis as any).__koreCoolLiveKeyUntil ||
  ((globalThis as any).__koreCoolLiveKeyUntil = new Map<string, number>())
const healthyKoreLiveKeyAt: Map<string, number> =
  (globalThis as typeof globalThis & { __koreHealthyLiveKeyAt?: Map<string, number> }).__koreHealthyLiveKeyAt ||
  ((globalThis as typeof globalThis & { __koreHealthyLiveKeyAt?: Map<string, number> }).__koreHealthyLiveKeyAt = new Map<string, number>())

const KORE_HEALTHY_KEY_TTL_MS = 10 * 60 * 1000
const KORE_ZERO_QUOTA_COOLDOWN_MS = 10 * 60 * 1000
const KORE_TRANSIENT_429_COOLDOWN_MS = 90 * 1000

function compute429CooldownMs(rawBody: string): number {
  if (/"quota_limit_value"\s*:\s*"?0"?/i.test(rawBody)) {
    return KORE_ZERO_QUOTA_COOLDOWN_MS
  }
  return KORE_TRANSIENT_429_COOLDOWN_MS
}

/**
 * Crea un token efímero de un solo uso con el setup BLOQUEADO (`bidiGenerateContentSetup`), priorizando llaves
 * comprobadas sanas recientemente (`healthyKoreLiveKeyAt`), rotando llaves activas (`AQ.` primero) y corriendo carrera
 * paralela (0 ms / 350 ms) entre las 2 primeras llaves más lotes paralelos de 4 como respaldo ultrarrápido.
 */
export async function createKoreEphemeralToken(setup: KoreLiveSetup, now = Date.now()): Promise<KoreEphemeralToken> {
  const rawKeys = await getGeminiKeyPoolWithRemote()
  if (rawKeys.length === 0) throw new KoreTokenError('No hay llaves de Gemini configuradas en el servidor.', 503)

  const unblocked = rawKeys.filter((k) => (deadKoreLiveKeyUntil.get(k) || 0) <= now)
  const pool = unblocked.length > 0 ? unblocked : rawKeys
  const freshPool = pool.filter((k) => (coolKoreLiveKeyUntil.get(k) || 0) <= now)
  const activePool = freshPool.length > 0 ? freshPool : pool
  const fallbackCooled = freshPool.length > 0 ? pool.filter((k) => !freshPool.includes(k)) : []
  const healthyPool = activePool.filter((k) => {
    const okAt = healthyKoreLiveKeyAt.get(k) || 0
    return okAt > 0 && now - okAt <= KORE_HEALTHY_KEY_TTL_MS
  })
  const healthySet = new Set(healthyPool)
  const remainingActive = activePool.filter((k) => !healthySet.has(k))
  const aqPool = remainingActive.filter((k) => k.startsWith('AQ.'))
  const classicPool = remainingActive.filter((k) => !k.startsWith('AQ.'))
  const rotHealthyStart = healthyPool.length > 0 ? keyCursor % healthyPool.length : 0
  const rotAqStart = aqPool.length > 0 ? keyCursor % aqPool.length : 0
  keyCursor++
  const orderedKeys = [
    ...healthyPool.slice(rotHealthyStart),
    ...healthyPool.slice(0, rotHealthyStart),
    ...aqPool.slice(rotAqStart),
    ...aqPool.slice(0, rotAqStart),
    ...classicPool,
    ...fallbackCooled
  ]

  const expiresAt = new Date(now + TOKEN_EXPIRE_MS).toISOString()
  const newSessionExpiresAt = new Date(now + TOKEN_NEW_SESSION_MS).toISOString()
  const body = JSON.stringify({ uses: 1, expireTime: expiresAt, newSessionExpireTime: newSessionExpiresAt, bidiGenerateContentSetup: setup })

  const verifiedCreditKeyUntil = (globalThis as any).__koreVerifiedCreditKeyUntil || ((globalThis as any).__koreVerifiedCreditKeyUntil = new Map<string, number>())
  const isSingleKeyMode = orderedKeys.length === 1

  const mintWithSingleKey = async (key: string, signal: AbortSignal): Promise<string | null> => {
    // En modo multi-llave (>1), verificar saldo/cuota cacheado (15 min) para saltar rápido llaves 402/429.
    // En modo llave única (orderedKeys.length === 1), omitir el pre-probe para ahorrar 50% de RPM y ~200 ms de latencia.
    if (!isSingleKeyMode && (verifiedCreditKeyUntil.get(key) || 0) <= Date.now()) {
      const probeRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:countTokens', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ok' }] }] }),
        signal,
        cache: 'no-store'
      }).catch(() => null)
      if (probeRes && (probeRes.status === 401 || probeRes.status === 402 || probeRes.status === 403)) {
        deadKoreLiveKeyUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
        healthyKoreLiveKeyAt.delete(key)
        return null
      }
      if (probeRes && probeRes.status === 429) {
        const probeErrTxt = await probeRes.text().catch(() => '')
        lastError = `HTTP 429: ${sanitizeProviderMessage(probeErrTxt, rawKeys)}`
        coolKoreLiveKeyUntil.set(key, Date.now() + compute429CooldownMs(probeErrTxt))
        healthyKoreLiveKeyAt.delete(key)
        return null
      }
      if (probeRes?.ok) {
        verifiedCreditKeyUntil.set(key, Date.now() + 15 * 60 * 1000)
      }
    }

    const maxAuthTries = isSingleKeyMode ? 2 : 1
    for (let authTry = 0; authTry < maxAuthTries; authTry++) {
      if (signal.aborted) return null
      let res: Response
      try {
        res = await fetch(AUTH_TOKENS_URL, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body,
          signal,
          cache: 'no-store'
        })
      } catch (netErr: any) {
        if (isSingleKeyMode && authTry === 0 && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 400))
          continue
        }
        throw netErr
      }
      const text = await res.text()
      if (res.ok) {
        let parsed: any = null
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = null
        }
        const token = typeof parsed?.name === 'string' ? parsed.name : ''
        if (token.startsWith('auth_tokens/')) {
          coolKoreLiveKeyUntil.delete(key)
          healthyKoreLiveKeyAt.set(key, Date.now())
          return token
        }
        return null
      }
      const sanitized = sanitizeProviderMessage(text, rawKeys)
      lastError = `HTTP ${res.status}: ${sanitized}`
      if (res.status >= 500 && isSingleKeyMode && authTry === 0 && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 400))
        continue
      }
      if (res.status === 401 || res.status === 402 || res.status === 403 || /prepayment|depleted|API_KEY_INVALID|leaked/i.test(text)) {
        if (!isSingleKeyMode) {
          deadKoreLiveKeyUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
        }
        healthyKoreLiveKeyAt.delete(key)
        return null
      }
      if (res.status === 429 || /RESOURCE_EXHAUSTED|Quota exceeded|rate/i.test(text)) {
        coolKoreLiveKeyUntil.set(key, Date.now() + (isSingleKeyMode ? 5000 : compute429CooldownMs(text)))
        healthyKoreLiveKeyAt.delete(key)
        return null
      }
      const keyProblem = /api[_ ]?key|API_KEY|permission|quota|billing|RESOURCE_EXHAUSTED|UNAUTHENTICATED/i.test(text)
      if (res.status === 400 && !keyProblem) {
        throw new KoreTokenError(`Gemini rechazó la configuración del token (${lastError}).`, 502)
      }
      return null
    }
    return null
  }

  let lastError = 'sin respuesta'
  let totalAttempts = 0

  // Carrera paralela rápida entre las primeras 2 llaves AQ. distintas (0 ms / 350 ms)
  if (orderedKeys.length >= 2) {
    const pair = [orderedKeys[0], orderedKeys[1]]
    const ctrls = [new AbortController(), new AbortController()]
    const timers: Array<ReturnType<typeof setTimeout> | null> = [null, null]
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null
    try {
      const racedToken = await new Promise<string | null>((resolve) => {
        let settled = false
        let running = 0
        const launched = new Set<number>()
        const startSlot = (idx: number) => {
          if (settled || launched.has(idx)) return
          launched.add(idx)
          running++
          totalAttempts++
          timers[idx] = setTimeout(() => ctrls[idx].abort(), TOKEN_REQUEST_TIMEOUT_MS)
          void mintWithSingleKey(pair[idx], ctrls[idx].signal)
            .then((tok) => {
              if (timers[idx]) clearTimeout(timers[idx]!)
              running = Math.max(0, running - 1)
              if (settled) return
              if (tok) {
                settled = true
                if (hedgeTimer) clearTimeout(hedgeTimer)
                ctrls[1 - idx].abort()
                resolve(tok)
                return
              }
              if (idx === 0 && !launched.has(1)) {
                if (hedgeTimer) clearTimeout(hedgeTimer)
                startSlot(1)
              }
              if (running === 0 && launched.size >= 2) {
                settled = true
                resolve(null)
              }
            })
            .catch((err) => {
              if (timers[idx]) clearTimeout(timers[idx]!)
              running = Math.max(0, running - 1)
              if (settled) return
              if (err instanceof KoreTokenError) {
                settled = true
                if (hedgeTimer) clearTimeout(hedgeTimer)
                ctrls[1 - idx].abort()
                resolve(`__DETERMINISTIC_ERR__:${err.message}`)
                return
              }
              lastError = err?.name === 'AbortError' ? 'timeout' : sanitizeProviderMessage(String(err?.message || err), rawKeys)
              if (idx === 0 && !launched.has(1)) {
                if (hedgeTimer) clearTimeout(hedgeTimer)
                startSlot(1)
              }
              if (running === 0 && launched.size >= 2) {
                settled = true
                resolve(null)
              }
            })
        }
        hedgeTimer = setTimeout(() => startSlot(1), 350)
        startSlot(0)
      })
      if (racedToken?.startsWith('__DETERMINISTIC_ERR__:')) {
        throw new KoreTokenError(racedToken.slice('__DETERMINISTIC_ERR__:'.length), 502)
      }
      if (racedToken) {
        return { token: racedToken, expiresAt, newSessionExpiresAt, attempts: totalAttempts }
      }
    } finally {
      if (hedgeTimer) clearTimeout(hedgeTimer)
      for (const t of timers) if (t) clearTimeout(t)
    }
  }

  const startFrom = orderedKeys.length >= 2 ? 2 : 0
  const FALLBACK_BATCH_SIZE = 4
  for (let i = startFrom; i < orderedKeys.length; i += FALLBACK_BATCH_SIZE) {
    const batch = orderedKeys.slice(i, i + FALLBACK_BATCH_SIZE)
    const batchCtrls = batch.map(() => new AbortController())
    const batchTimers = batchCtrls.map((c) => setTimeout(() => c.abort(), TOKEN_REQUEST_TIMEOUT_MS))
    try {
      const batchWinner = await new Promise<string | null>((resolve) => {
        let settled = false
        let remaining = batch.length
        batch.forEach((key, bIdx) => {
          totalAttempts++
          void mintWithSingleKey(key, batchCtrls[bIdx].signal)
            .then((tok) => {
              remaining--
              if (settled) return
              if (tok) {
                settled = true
                batchCtrls.forEach((c, cIdx) => {
                  if (cIdx !== bIdx) c.abort()
                })
                resolve(tok)
                return
              }
              if (remaining <= 0) {
                settled = true
                resolve(null)
              }
            })
            .catch((err) => {
              remaining--
              if (settled) return
              if (err instanceof KoreTokenError) {
                settled = true
                batchCtrls.forEach((c, cIdx) => {
                  if (cIdx !== bIdx) c.abort()
                })
                resolve(`__DETERMINISTIC_ERR__:${err.message}`)
                return
              }
              lastError =
                err?.name === 'AbortError'
                  ? 'timeout'
                  : sanitizeProviderMessage(String(err?.message || err), rawKeys)
              if (remaining <= 0) {
                settled = true
                resolve(null)
              }
            })
        })
      })
      if (batchWinner?.startsWith('__DETERMINISTIC_ERR__:')) {
        throw new KoreTokenError(batchWinner.slice('__DETERMINISTIC_ERR__:'.length), 502)
      }
      if (batchWinner) {
        return { token: batchWinner, expiresAt, newSessionExpiresAt, attempts: totalAttempts }
      }
    } finally {
      for (const tm of batchTimers) clearTimeout(tm)
    }
  }
  throw new KoreTokenError(`No se pudo crear el token efímero de Gemini con ninguna llave (${lastError}).`, 502)
}

/** URL WebSocket constrained con el token efímero como `access_token`. */
export function buildKoreWsUrl(token: string): string {
  return `${KORE_WS_CONSTRAINED_URL}?access_token=${encodeURIComponent(token)}`
}

/** Precalienta en segundo plano la caché de órdenes Off-Premise de Blindaje Delivery para respuesta en milisegundos. */
export function prewarmKoreDriverOrdersCache(storeId: number): void {
  void fetchOffPremiseOrders(storeId).catch(() => null)
}

export interface KoreDriverLookupInputOrder {
  customer_name?: string
  customerName?: string
  order_code?: string
  orderCode?: string
}

export interface KoreDriverLookupResult {
  ok: true
  driverPickup: KoreDriverPickup
  allReady: boolean
  anyFound: boolean
  windowNumber: 2
  lookupDegraded?: boolean
  toolResult: Record<string, unknown>
}

function cleanDriverCode(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
}

function tokenizeCustomerName(raw: unknown): string[] {
  const s = String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^orden\s+[a-z0-9#-]+$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.split(' ').filter(Boolean) : []
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
    } else {
      if (++edits > 1) return false
      if (a.length > b.length) i++
      else if (b.length > a.length) j++
      else {
        i++
        j++
      }
    }
  }
  if (i < a.length || j < b.length) edits++
  return edits <= 1
}

function mapFriendlyPlatformToArmor(platform: string): string | null {
  if (platform === 'DoorDash' || platform === 'Caviar') return 'DOORDASH'
  if (platform === 'Uber Eats' || platform === 'Postmates') return 'UBER_EATS'
  if (platform === 'Grubhub') return 'GRUBHUB'
  if (platform === 'Tacos Gavilan') return 'TOAST_ONLINE'
  return null
}

function mapArmorPlatformToFriendly(armorPlatform: string, fallback: string): string {
  if (armorPlatform === 'DOORDASH') return 'DoorDash'
  if (armorPlatform === 'UBER_EATS') return 'Uber Eats'
  if (armorPlatform === 'GRUBHUB') return 'Grubhub'
  if (armorPlatform === 'TOAST_ONLINE' || armorPlatform === 'TAKEOUT') return 'Tacos Gavilan'
  return fallback
}

function scoreOffPremiseMatch(
  queryNameTokens: string[],
  queryCode: string,
  expectedArmorPlatform: string | null,
  cand: OffPremiseOrder
): number {
  if (cand.isVoided) return 0
  let score = 0
  const shortKey = cleanDriverCode(cand.shortOrderKey)
  const platKey = cleanDriverCode(cand.platformOrderKey)
  const dispNum = cleanDriverCode(cand.displayNumber)

  if (queryCode.length >= 2) {
    if (shortKey && queryCode === shortKey) score += 120
    else if (platKey && queryCode === platKey) score += 115
    else if (dispNum && queryCode === dispNum) score += 110
    else if (queryCode.length >= 4 && ((platKey && platKey.endsWith(queryCode)) || (shortKey && shortKey.endsWith(queryCode)))) {
      score += 95
    }
  }

  const candTokens = tokenizeCustomerName(cand.customerName)
  if (queryNameTokens.length > 0 && candTokens.length > 0) {
    const firstExact = queryNameTokens[0] === candTokens[0]
    const firstNear =
      !firstExact &&
      queryNameTokens[0].length >= 5 &&
      candTokens[0].length >= 5 &&
      editDistanceAtMostOne(queryNameTokens[0], candTokens[0])

    if (firstExact || firstNear) {
      let nameScore = firstExact ? 55 : 42
      if (queryNameTokens.length >= 2 && candTokens.length >= 2) {
        const qLast = queryNameTokens[queryNameTokens.length - 1]
        const cRest = candTokens.slice(1)
        if (cRest.some((ct) => ct === qLast)) nameScore += 40
        else if (qLast.length === 1 && cRest.some((ct) => ct.startsWith(qLast))) nameScore += 30
        else if (qLast.length >= 3 && cRest.some((ct) => ct.startsWith(qLast) || editDistanceAtMostOne(qLast, ct))) nameScore += 26
        else nameScore = 0 // Apellido/inicial incompatible (ej. "Maria G" vs "Maria Lopez")
      } else if (queryNameTokens.length >= 2 && candTokens.length === 1) {
        nameScore -= 5
      }
      score += Math.max(0, nameScore)
    } else if (
      queryNameTokens.length === 1 &&
      queryNameTokens[0].length >= 4 &&
      candTokens.slice(1).some((ct) => ct === queryNameTokens[0])
    ) {
      // Repartidor dijo únicamente el apellido del cliente
      score += 45
    }
  }

  if (score > 0 && expectedArmorPlatform) {
    if (cand.platform === expectedArmorPlatform) score += 12
    else if (expectedArmorPlatform === 'TOAST_ONLINE' && cand.platform === 'TAKEOUT') score += 10
  }
  return score
}

function classifyOffPremiseOrderStatus(cand: OffPremiseOrder): {
  lookupStatus: KoreDriverOrderLookupStatus
  packedAndSealed: boolean
} {
  const auditStatus = cand.audit?.status
  if (auditStatus === 'DELIVERED') {
    return { lookupStatus: 'already_handed', packedAndSealed: false }
  }
  const packed = auditStatus === 'PACKED_AND_SEALED' || auditStatus === 'UNCLAIMED_2H'
  if (packed || cand.kdsStatus === 'READY') {
    return { lookupStatus: 'ready', packedAndSealed: packed }
  }
  return { lookupStatus: 'preparing', packedAndSealed: false }
}

/**
 * Cruza de forma pura las órdenes solicitadas por el repartidor contra `OffPremiseOrder[]` de Blindaje Delivery,
 * enriqueciendo `KoreDriverPickup` y construyendo el `toolResult` listo para Gemini Live (`Window 2` / `Ventana 2`).
 */
export function matchDriverOrdersAgainstOffPremise(params: {
  platform?: string | null
  orders: KoreDriverLookupInputOrder[]
  existingPickup?: KoreDriverPickup | null
  notes?: string | null
  confirmPickup?: boolean
  replace?: boolean
  offPremiseOrders: OffPremiseOrder[]
  lookupDegraded?: boolean
  lang?: KoreLang
}): KoreDriverLookupResult {
  const hasExplicitPlatform = Boolean(params.platform && String(params.platform).trim())
  const basePlatform =
    (hasExplicitPlatform ? normalizeKoreDriverPlatform(params.platform) : null) ||
    (params.existingPickup?.platform ? normalizeKoreDriverPlatform(params.existingPickup.platform) : null) ||
    'Other'
  const expectedArmorPlatform = mapFriendlyPlatformToArmor(basePlatform)

  const priorOrders: KoreDriverPickupOrder[] =
    params.replace || !params.existingPickup || !Array.isArray(params.existingPickup.orders)
      ? []
      : params.existingPickup.orders.map((o) => ({ ...o }))

  const combinedRaw: Array<{ customerName: string; orderCode?: string }> = priorOrders.map((o) => ({
    customerName: o.customerName,
    ...(o.orderCode ? { orderCode: o.orderCode } : {})
  }))

  for (const inc of params.orders || []) {
    if (!inc || typeof inc !== 'object') continue
    const code = String(inc.order_code ?? inc.orderCode ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined
    let name = String(inc.customer_name ?? inc.customerName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (name.length < 2 && code && code.length >= 2) name = `Orden ${code}`
    if (name.length < 2) continue
    const qCode = cleanDriverCode(code)
    const qToks = tokenizeCustomerName(name)
    const existing = combinedRaw.find((m) => {
      const mCode = cleanDriverCode(m.orderCode)
      const mToks = tokenizeCustomerName(m.customerName)
      if (qCode && mCode) return qCode === mCode
      return qToks.length > 0 && qToks.join(' ') === mToks.join(' ')
    })
    if (existing) {
      if (code && !existing.orderCode) existing.orderCode = code
      if (!/^orden\s+/i.test(name) && /^orden\s+/i.test(existing.customerName)) existing.customerName = name
    } else if (combinedRaw.length < KORE_MAX_DRIVER_ORDERS) {
      combinedRaw.push({ customerName: name, ...(code ? { orderCode: code } : {}) })
    }
  }

  const usedGuids = new Set<string>()
  const enrichedOrders: KoreDriverPickupOrder[] = []
  const ambiguousHints: string[] = []

  for (const item of combinedRaw) {
    const qToks = tokenizeCustomerName(item.customerName)
    const qCode = cleanDriverCode(item.orderCode)

    if (params.lookupDegraded) {
      enrichedOrders.push({ ...item, lookupStatus: 'not_found' })
      continue
    }

    const scored = (params.offPremiseOrders || [])
      .map((cand) => ({ cand, score: scoreOffPremiseMatch(qToks, qCode, expectedArmorPlatform, cand) }))
      .filter((x) => x.score >= 42)
      .sort((a, b) => {
        const aFree = usedGuids.has(a.cand.orderGuid) ? 0 : 1
        const bFree = usedGuids.has(b.cand.orderGuid) ? 0 : 1
        if (b.score !== a.score) return b.score - a.score
        return bFree - aFree
      })

    if (scored.length === 0) {
      enrichedOrders.push({
        customerName: item.customerName,
        ...(item.orderCode ? { orderCode: item.orderCode } : {}),
        lookupStatus: 'not_found',
        matchedDisplayNumber: null,
        matchedShortKey: null,
        matchedPlatform: null,
        itemsCount: null,
        packedAndSealed: false
      })
      continue
    }

    const top = scored[0]
    const runnerUp = scored[1]
    // Ambiguo si hay 2 órdenes distintas con puntaje muy cercano y no se dio código desambiguador
    if (runnerUp && runnerUp.cand.orderGuid !== top.cand.orderGuid && top.score < 105 && top.score - runnerUp.score <= 6) {
      ambiguousHints.push(
        `${top.cand.customerName} (${top.cand.shortOrderKey || `#${top.cand.displayNumber}`}) vs ${runnerUp.cand.customerName} (${runnerUp.cand.shortOrderKey || `#${runnerUp.cand.displayNumber}`})`
      )
      enrichedOrders.push({
        customerName: item.customerName,
        ...(item.orderCode ? { orderCode: item.orderCode } : {}),
        lookupStatus: 'ambiguous',
        matchedDisplayNumber: null,
        matchedShortKey: null,
        matchedPlatform: top.cand.platform,
        itemsCount: null,
        packedAndSealed: false
      })
      continue
    }

    usedGuids.add(top.cand.orderGuid)
    const st = classifyOffPremiseOrderStatus(top.cand)
    const resolvedName =
      /^orden\s+/i.test(item.customerName) && top.cand.customerName ? top.cand.customerName : top.cand.customerName || item.customerName
    enrichedOrders.push({
      customerName: resolvedName,
      ...(item.orderCode ? { orderCode: item.orderCode } : top.cand.shortOrderKey ? { orderCode: top.cand.shortOrderKey } : {}),
      lookupStatus: st.lookupStatus,
      matchedDisplayNumber: top.cand.displayNumber || null,
      matchedShortKey: top.cand.shortOrderKey || null,
      matchedPlatform: top.cand.platform,
      itemsCount: Number.isFinite(top.cand.totalItemsCount) ? top.cand.totalItemsCount : top.cand.items?.length ?? null,
      packedAndSealed: st.packedAndSealed
    })
  }

  let effectivePlatform = basePlatform
  if (effectivePlatform === 'Other') {
    const firstMatchedPlat = enrichedOrders.find((o) => o.matchedPlatform)?.matchedPlatform
    if (firstMatchedPlat) effectivePlatform = mapArmorPlatformToFriendly(firstMatchedPlat, 'Other')
  }

  const cleanNotes =
    params.notes !== undefined
      ? String(params.notes || '').replace(/\s+/g, ' ').trim().slice(0, 180) || undefined
      : params.existingPickup?.notes

  const driverPickup: KoreDriverPickup = cleanNotes
    ? { platform: effectivePlatform, orders: enrichedOrders, notes: cleanNotes }
    : { platform: effectivePlatform, orders: enrichedOrders }

  const allReady = enrichedOrders.length > 0 && enrichedOrders.every((o) => o.lookupStatus === 'ready')
  const anyFound = enrichedOrders.some(
    (o) => o.lookupStatus === 'ready' || o.lookupStatus === 'preparing' || o.lookupStatus === 'already_handed'
  )

  const { replyEs, replyEn, modelInstruction: baseModelInstruction } = buildDriverSpeechGuidance(
    enrichedOrders,
    Boolean(params.lookupDegraded),
    ambiguousHints
  )
  const effectiveModelInstruction =
    params.lang === 'en'
      ? `CRITICAL: Driver is speaking ENGLISH. Reply 100% in natural English ONLY (NEVER in Spanish): "${replyEn}"`
      : params.lang === 'es'
        ? `El repartidor habla español; responde en español: "${replyEs}"`
        : baseModelInstruction
  const langDirective =
    params.lang === 'en'
      ? {
          reply_language: 'en' as const,
          language_directive: 'CRITICAL: Customer is speaking ENGLISH. Reply 100% in natural English ONLY (NEVER in Spanish).'
        }
      : params.lang === 'es'
        ? {
            reply_language: 'es' as const,
            language_directive: 'El cliente habla español; responde en español.'
          }
        : {}

  const toolResult: Record<string, unknown> = {
    ok: true,
    action: 'driver_pickup_registered',
    status: params.confirmPickup ? 'confirmed' : 'building',
    session_kind: 'driver_pickup',
    platform: driverPickup.platform,
    pickup_count: enrichedOrders.length,
    window_number: 2,
    all_ready: allReady,
    any_found: anyFound,
    ...(params.lookupDegraded ? { lookup_degraded: true } : {}),
    orders: enrichedOrders.map((o) => ({
      customer_name: o.customerName,
      order_code: o.orderCode || o.matchedShortKey || null,
      lookup_status: o.lookupStatus || 'not_found',
      packed_and_sealed: Boolean(o.packedAndSealed),
      display_number: o.matchedDisplayNumber || null,
      items_count: o.itemsCount ?? null
    })),
    suggested_reply_es: replyEs,
    suggested_reply_en: replyEn,
    message: effectiveModelInstruction,
    ...langDirective,
    subtotal: '$0.00',
    tax: '$0.00',
    total: '$0.00'
  }

  return {
    ok: true,
    driverPickup,
    allReady,
    anyFound,
    windowNumber: 2,
    ...(params.lookupDegraded ? { lookupDegraded: true } : {}),
    toolResult
  }
}

function buildDriverSpeechGuidance(
  orders: KoreDriverPickupOrder[],
  degraded: boolean,
  ambiguousHints: string[]
): { replyEs: string; replyEn: string; modelInstruction: string } {
  if (degraded || orders.length === 0) {
    const names = orders.map((o) => o.customerName).join(', ')
    const replyEs = names
      ? `Registrado para ${names}. Pasa a la ventana 2 para recoger tu orden.`
      : 'Pasa a la ventana 2 para revisar tu orden.'
    const replyEn = names
      ? `Got it for ${names}. Please pull forward to Window 2 for your order.`
      : 'Please pull forward to Window 2 to check your order.'
    return {
      replyEs,
      replyEn,
      modelInstruction: `Direct the driver to Window 2 (ventana 2). Suggested ES: "${replyEs}" | EN: "${replyEn}".`
    }
  }

  if (orders.length === 1) {
    const o = orders[0]
    if (o.lookupStatus === 'ready') {
      const replyEs = `¡La orden de ${o.customerName} ya está lista! Pasa a la ventana 2 por tu orden.`
      const replyEn = `${o.customerName}'s order is ready! Pull forward to Window 2 for your order.`
      return { replyEs, replyEn, modelInstruction: `Order is READY in Delivery Armor. Say: "${replyEs}" / "${replyEn}".` }
    }
    if (o.lookupStatus === 'preparing') {
      const replyEs = `Encontramos la orden de ${o.customerName} en preparación y empaque. Pasa a la ventana 2 por favor.`
      const replyEn = `We have ${o.customerName}'s order in preparation and packing. Please pull forward to Window 2.`
      return { replyEs, replyEn, modelInstruction: `Order is IN_KITCHEN/preparing. Say: "${replyEs}" / "${replyEn}".` }
    }
    if (o.lookupStatus === 'already_handed') {
      const replyEs = `La orden de ${o.customerName} ya aparece marcada como entregada en el sistema. Pasa a la ventana 2 para verificarlo.`
      const replyEn = `${o.customerName}'s order already shows as handed out in our system. Please pull forward to Window 2 to verify.`
      return { replyEs, replyEn, modelInstruction: `Order is DELIVERED. Say: "${replyEs}" / "${replyEn}".` }
    }
    if (o.lookupStatus === 'ambiguous') {
      const replyEs = `Veo más de una orden con ese nombre. ¿Me confirmas el código o inicial del apellido, o pasa a la ventana 2?`
      const replyEn = `I see more than one order with that name. Can you confirm the order code or last initial, or pull forward to Window 2?`
      return {
        replyEs,
        replyEn,
        modelInstruction: `Ambiguous match (${ambiguousHints.join('; ')}). Ask for order code/last initial or send to Window 2.`
      }
    }
    const replyEs = `No me aparece aún la orden de ${o.customerName} en pantalla; confírmame el código o pasa a la ventana 2 a verificar.`
    const replyEn = `I don't see ${o.customerName}'s order on screen yet; please confirm the code or pull forward to Window 2 to verify.`
    return { replyEs, replyEn, modelInstruction: `Order NOT_FOUND in active Delivery Armor queue. Say: "${replyEs}" / "${replyEn}".` }
  }

  // Múltiples órdenes en el mismo vehículo
  const allReady = orders.every((o) => o.lookupStatus === 'ready')
  if (allReady) {
    const names = orders.map((o) => o.customerName).join(' y ')
    const replyEs = `¡Las órdenes (${names}) ya están listas! Pasa a la ventana 2 por tus órdenes.`
    const replyEn = `All ${orders.length} orders (${orders.map((o) => o.customerName).join(' & ')}) are ready! Pull forward to Window 2 for your orders.`
    return { replyEs, replyEn, modelInstruction: `All ${orders.length} orders are READY. Say: "${replyEs}" / "${replyEn}".` }
  }

  const partsEs = orders.map((o) => {
    if (o.lookupStatus === 'ready') return `la de ${o.customerName} ya está lista`
    if (o.lookupStatus === 'preparing') return `la de ${o.customerName} sigue en preparación`
    if (o.lookupStatus === 'already_handed') return `la de ${o.customerName} figura entregada`
    return `la de ${o.customerName} se verificará en pantalla`
  })
  const partsEn = orders.map((o) => {
    if (o.lookupStatus === 'ready') return `${o.customerName} is ready`
    if (o.lookupStatus === 'preparing') return `${o.customerName} is still being prepared`
    if (o.lookupStatus === 'already_handed') return `${o.customerName} shows handed out`
    return `${o.customerName} needs verification`
  })
  const replyEs = `${partsEs.join(', y ')}. Pasa a la ventana 2 por tus órdenes.`
  const replyEn = `${partsEn.join(', and ')}. Pull forward to Window 2 for your orders.`
  return { replyEs, replyEn, modelInstruction: `State each order's exact status and direct to Window 2: "${replyEs}" / "${replyEn}".` }
}

const DRIVER_LOOKUP_TIMEOUT_MS = 3500

async function loadRecentAuditOrdersFallback(storeId: number): Promise<OffPremiseOrder[]> {
  const sinceIso = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('delivery_packing_audits')
    .select('id, store_id, toast_order_guid, toast_display_number, platform, dining_option_name, customer_name, order_opened_at, items_json, matched_items, match_completed, status, quick_checks')
    .eq('store_id', storeId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(80)
  if (error || !Array.isArray(data)) return []
  return data.map((r: any) => {
    const qc = r.quick_checks && typeof r.quick_checks === 'object' ? r.quick_checks : {}
    const itemsArr = Array.isArray(r.items_json) ? r.items_json : []
    const totalItems = itemsArr.reduce((acc: number, it: any) => acc + (Number(it?.quantity) || 1), 0)
    return {
      orderGuid: String(r.toast_order_guid || r.id),
      displayNumber: String(r.toast_display_number || ''),
      storeId: Number(r.store_id),
      storeName: '',
      platform: (r.platform || 'OTHER') as any,
      diningOptionGuid: '',
      diningOptionName: String(r.dining_option_name || ''),
      customerName: String(r.customer_name || ''),
      maskedCustomerName: String(r.customer_name || ''),
      platformOrderKey: String(qc.platformOrderKey || qc.shortOrderKey || ''),
      shortOrderKey: String(qc.shortOrderKey || ''),
      openedDate: String(r.order_opened_at || new Date().toISOString()),
      kdsStatus:
        r.status === 'PACKED_AND_SEALED' || r.status === 'UNCLAIMED_2H' || r.status === 'DELIVERED' || qc.kdsStatus === 'READY'
          ? 'READY'
          : 'IN_KITCHEN',
      kdsSentAt: String(qc.kdsSentAt || r.order_opened_at || new Date().toISOString()),
      kdsReadyAt: qc.kdsReadyAt ? String(qc.kdsReadyAt) : null,
      kdsPrepSeconds: Number.isFinite(Number(qc.kdsPrepSeconds)) ? Number(qc.kdsPrepSeconds) : null,
      items: itemsArr,
      totalItemsCount: totalItems,
      audit: {
        id: String(r.id),
        status: r.status,
        matchedItems: Array.isArray(r.matched_items) ? r.matched_items : [],
        matchCompleted: Boolean(r.match_completed)
      }
    } as OffPremiseOrder
  })
}

/**
 * Consulta en vivo `fetchOffPremiseOrders(storeId)` de Blindaje Delivery (con timeout seguro de 3.5 s, respaldo
 * instantáneo `< 60 ms` sobre `delivery_packing_audits` y degradación elegante) para responder dentro del presupuesto
 * de 4.5 s del navegador sin romper jamás la llamada.
 */
export async function lookupKoreDriverOrdersLive(params: {
  storeId: number
  platform?: string | null
  orders: KoreDriverLookupInputOrder[]
  existingPickup?: KoreDriverPickup | null
  notes?: string | null
  confirmPickup?: boolean
  replace?: boolean
  lang?: KoreLang
}): Promise<KoreDriverLookupResult> {
  let offPremiseOrders: OffPremiseOrder[] = []
  let toastFailed = false

  const [toastOutcome, auditFallback] = await Promise.all([
    Promise.race([
      fetchOffPremiseOrders(params.storeId).then((r) => ({ ok: true as const, orders: Array.isArray(r?.orders) ? r.orders : [] })),
      new Promise<{ ok: false; err: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, err: 'driver_lookup_timeout' }), DRIVER_LOOKUP_TIMEOUT_MS)
      )
    ]).catch((e: any) => ({ ok: false as const, err: String(e?.message || e).slice(0, 180) })),
    loadRecentAuditOrdersFallback(params.storeId).catch(() => [] as OffPremiseOrder[])
  ])

  if (toastOutcome.ok) {
    offPremiseOrders = [...toastOutcome.orders]
  } else {
    toastFailed = true
    console.warn('[Kore DT driver-lookup] Toast fallback to delivery_packing_audits:', toastOutcome.err)
  }

  const seenGuids = new Set(offPremiseOrders.map((o) => o.orderGuid))
  for (const aud of auditFallback) {
    if (!seenGuids.has(aud.orderGuid)) {
      seenGuids.add(aud.orderGuid)
      offPremiseOrders.push(aud)
    }
  }

  const lookupDegraded = toastFailed && offPremiseOrders.length === 0

  return matchDriverOrdersAgainstOffPremise({
    platform: params.platform,
    orders: params.orders,
    existingPickup: params.existingPickup,
    notes: params.notes,
    confirmPickup: params.confirmPickup,
    replace: params.replace,
    offPremiseOrders,
    lookupDegraded,
    lang: params.lang
  })
}

export const resolveKoreDriverPickupLive = lookupKoreDriverOrdersLive
