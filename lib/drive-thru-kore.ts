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
 * - Blindaje Fase 26 (2026-11-21): `buildLearnedRulesSection` eleva el tope activo a `KORE_MAX_ACTIVE_LEARNED_RULES = 35`
 *   (antes `15`) recibiendo reglas priorizadas `approved` -> `auto_applied` y `evidence_count DESC`.
 * - Optimización de Costos Voz Paid Tier 2 (2026-11-23):
 *   1) Herramientas de orden/repartidor declaradas `NON_BLOCKING` con `scheduling: 'SILENT'` cuando suena un clip pregrabado de
 *      Supabase Storage (`fast_clip_spoken: true`), eliminando el 100% de la síntesis y re-cobro doble de voz en Google.
 *   2) Compresión sin pérdida del `systemInstruction` (~72% menos tokens por turno): `learnedRules` sin duplicación bilingüe
 *      redundante, `SHARED KB` movido a consulta `< 1 ms` en RAM vía `search_menu` dejando solo políticas esenciales fijas,
 *      y reglas 1–15 compactadas conservando el 100% de guardrails operativos.
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
import {
  buildCompactWeeklyHours,
  buildCrossStoreHoursComparison,
  buildEffectiveUpcomingHolidaysForStore,
  evaluateStoreSchedulePure,
  loadAllActiveStoresDirectory,
  loadAllSpecialHoursCached,
  localizeHolidayLabel
} from '@/lib/phone-agent'

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
  phone?: string | null
  weeklyHours?: unknown
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
  titleEn?: string | null
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
      .select('id, name, code, address, phone, weekly_hours, external_id, has_drive_thru, is_active')
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
    phone: data.phone ? String(data.phone) : null,
    weeklyHours: data.weekly_hours ?? null,
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
      .select('id, store_id, category, title, title_en, answer_es, answer_en, is_active, priority, updated_at')
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
      titleEn: r.title_en ? String(r.title_en).replace(/\s+/g, ' ').trim() : null,
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
  Burritos: 'Regular: meat, rice & refried beans wrapped in flour tortilla (50/50 half-and-half of 2 meats free at $0.00!)',
  'Super Burritos': 'meat, rice, refried beans, Monterey Jack cheese, guacamole & sour cream (50/50 half-and-half of 2 meats free at $0.00!)',
  'Meat Only Burritos': 'pure meat only, NO rice, NO beans (50/50 half-and-half of 2 meats free at $0.00!)',
  'Meat Only Super Burritos': 'double meat + Monterey Jack cheese, guacamole & sour cream, NO rice, NO beans (50/50 half-and-half of 2 meats free at $0.00!)',
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
  'Misc. Drinks': 'Bottled Water, 16 oz hot Coffee (serves BOTH traditional spiced Café de Olla AND Café Regular — pass "Café de Olla" when requested!), 16 oz Champurrado, 96 oz Champurrado To-Go Box, 128 oz Aguas Frescas Gallon'
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
    '- Prep & Speech facts: NO food item has sizes (Regular vs Super vs Meat Only only). Burritos (all 4 tiers: Regular, Super, Meat Only, Meat Only Super) CAN be made 50/50 half-and-half with any 2 meats at $0.00 extra ("Half <Meat>"). Coffee (16 oz) = BOTH Café de Olla tradicional AND Café Regular served ALL DAY (NEVER deny Café de Olla!). Champurrado comes ONLY in 16 oz cup or 96 oz To-Go Box (clarify if asked for "champurrado grande"). In-store $0.00 prep mods: Carne Dorada, Tortilla Dorada, Pan Dorado, Sope Dorado, Partido en Dos. Supreme/Supremo=Super. Sopes = thick tortilla + beans + sour cream (crema) + Cotija cheese + meat (STRICTLY NO lettuce / NO lechuga, NO tomato!). Taco Plate (3 plain tacos + rice & beans; STT "Taco Play") != Plato <meat> (meat + salad, rice, beans, guacamole & tortillas). Torta Cubana=Breaded Steak+Ham+Wiener+fresco cheese+avocado+beans+mayo+lettuce+tomato (STT "torta corona"). Adobada=Pastor; STT "sasada"=Asada; STT "fe de la hoya"="café de olla". Drinks ONLY have sizes: Mediana/Medium (22 oz), Grande/Large (32 oz), Galón/Gallon (128 oz), 16 oz Coffee/Champurrado, and Caja/Box 96 oz Champurrado (NEVER say "chica", "pequeña" or "small"). Desserts: ONLY Flan & Cheesecake.'
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

function buildEssentialPoliciesText(kb: KoreKnowledgeEntry[]): string {
  const cleanBrand = (s: string) => s.replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
  const essentialCats = new Set(['hours', 'catering', 'payments'])
  const brief = kb
    .filter((k) => essentialCats.has(String(k.category || '').toLowerCase()))
    .slice(0, 5)
    .map((k) => `- [${k.category}] ${cleanBrand(k.title)}: ${cleanBrand(k.answerEs || k.answerEn || '').slice(0, 320)}`)
  brief.push(
    '- [lookup] For employment, other branch addresses/hours, catering details or special FAQ not listed here, call search_menu(query) (<1 ms local RAM lookup).'
  )
  return brief.join('\n')
}

export const KORE_MAX_ACTIVE_LEARNED_RULES = 24

export function buildLearnedRulesSection(rules?: ActiveKoreLearnedRule[], lang: KoreLang = 'es'): string {
  if (!rules || rules.length === 0) return ''
  const seen = new Set<string>()
  const lines: string[] = []
  for (const r of rules) {
    if (lines.length >= KORE_MAX_ACTIVE_LEARNED_RULES) break
    const primary = (lang === 'en' ? r.ruleEn || r.ruleEs : r.ruleEs || r.ruleEn || '').trim()
    if (!primary) continue
    const dedupKey = primary.toLowerCase().slice(0, 72)
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    const trig = r.triggerEn && r.triggerEn !== r.trigger ? `${r.trigger}/${r.triggerEn}` : r.trigger
    lines.push(`- [${trig.slice(0, 70)}] ${primary.slice(0, 280)}`)
  }
  if (lines.length === 0) return ''
  return ['', 'LEARNED OWNER RULES (HIGH PRIORITY):', ...lines].join('\n')
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

function formatPacificDateIso(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value || '2026'
  const m = parts.find((p) => p.type === 'month')?.value || '01'
  const d = parts.find((p) => p.type === 'day')?.value || '01'
  return `${y}-${m}-${d}`
}

function format12hSimple(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim())
  if (!m) return String(hhmm || '')
  const h24 = Number(m[1])
  const min = m[2]
  const period = h24 >= 12 && h24 < 24 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${min} ${period}`
}

/**
 * Construye entradas sintéticas en RAM de `category: 'hours'` con el horario real de esta sucursal,
 * festivos próximos y directorio completo de las 15 sucursales para consultas `< 1 ms` en `search_menu`.
 */
export function buildKoreHoursKnowledgeEntries(params: {
  store: KoreStoreRow
  allStores?: Array<{
    id: number
    name: string
    address?: string | null
    phone?: string | null
    has_drive_thru?: boolean
    weekly_hours?: unknown
  }>
  specialHours?: any[]
  now?: Date
}): KoreKnowledgeEntry[] {
  const { store, allStores = [], specialHours = [], now = new Date() } = params
  const entries: KoreKnowledgeEntry[] = []
  const ptDate = formatPacificDateIso(now)
  const nameEs = formatCustomerStoreName(store.id, 'es', { style: 'display' })
  const nameEn = formatCustomerStoreName(store.id, 'en', { style: 'display' })

  if (store.weeklyHours) {
    const evalNow = evaluateStoreSchedulePure({
      storeId: store.id,
      storeName: nameEn,
      weeklyHours: store.weeklyHours,
      specialHours,
      now
    })
    const compactEs = buildCompactWeeklyHours(store.weeklyHours, 'es')
    const compactEn = buildCompactWeeklyHours(store.weeklyHours, 'en')
    const upcoming = buildEffectiveUpcomingHolidaysForStore({
      storeId: store.id,
      weeklyHours: store.weeklyHours,
      specialHours,
      fromDateStr: ptDate,
      daysAhead: 120
    }).slice(0, 6)
    const holEs = upcoming
      .map((h) => {
        const lbl = localizeHolidayLabel(h.holiday_name, 'es', h.event_date)
        return h.is_closed
          ? `${h.event_date} (${lbl}): CERRADO`
          : `${h.event_date} (${lbl}): ${format12hSimple(h.open_time)} a ${format12hSimple(h.close_time)}`
      })
      .join('; ')
    const holEn = upcoming
      .map((h) => {
        const lbl = localizeHolidayLabel(h.holiday_name, 'en', h.event_date)
        return h.is_closed
          ? `${h.event_date} (${lbl}): CLOSED`
          : `${h.event_date} (${lbl}): ${format12hSimple(h.open_time)} to ${format12hSimple(h.close_time)}`
      })
      .join('; ')
    const centralNoteEs =
      store.id === 6
        ? ' Nota exclusiva de Los Ángeles (Central y Washington): el Drive-Thru cierra en ese horario y el comedor cierra 1 hora antes (excepto en festivos con cierre temprano a las 4:00 PM donde ambos cierran a las 4:00 PM).'
        : ' Comedor y Drive-Thru manejan exactamente este mismo horario.'
    const centralNoteEn =
      store.id === 6
        ? ' Exclusive note for Los Angeles (Central & Washington): Drive-Thru closes at these hours and the dining room closes 1 hour earlier (except on 4:00 PM early-close holidays when both close at 4:00 PM).'
        : ' Dining room and Drive-Thru share these exact same hours.'

    entries.push({
      id: `ram:hours:store_${store.id}`,
      category: 'hours',
      title: `Horario oficial de Tacos Gavilan ${nameEs} (apertura, cierre y días festivos)`,
      titleEn: `Official hours for Tacos Gavilan ${nameEn} (open, close & holidays)`,
      answerEs: `Sucursal ${nameEs}${store.address ? ` (${store.address})` : ''}: ${compactEs}.${centralNoteEs} Estado hoy: ${evalNow.statusMessageEs}${holEs ? ` Próximos festivos: ${holEs}.` : ''}`,
      answerEn: `${nameEn}${store.address ? ` (${store.address})` : ''}: ${compactEn}.${centralNoteEn} Live status today: ${evalNow.statusMessageEn}${holEn ? ` Upcoming holidays: ${holEn}.` : ''}`
    })
  }

  if (allStores.length > 0) {
    const dirEs = allStores
      .map((s) => {
        const nm = formatCustomerStoreName(Number(s.id), 'es', { style: 'display' })
        const dt = s.has_drive_thru ? ' [con Drive-Thru]' : ' [solo comedor]'
        const wh = s.weekly_hours ? buildCompactWeeklyHours(s.weekly_hours, 'es') : ''
        const extra6 = Number(s.id) === 6 ? ' (DT; comedor cierra 1h antes)' : ''
        return `${nm}${dt}: ${wh}${extra6}${s.address ? ` — ${s.address}` : ''}`
      })
      .join(' | ')
    const dirEn = allStores
      .map((s) => {
        const nm = formatCustomerStoreName(Number(s.id), 'en', { style: 'display' })
        const dt = s.has_drive_thru ? ' [Drive-Thru]' : ' [Dining room only]'
        const wh = s.weekly_hours ? buildCompactWeeklyHours(s.weekly_hours, 'en') : ''
        const extra6 = Number(s.id) === 6 ? ' (DT; dining room closes 1h earlier)' : ''
        return `${nm}${dt}: ${wh}${extra6}${s.address ? ` — ${s.address}` : ''}`
      })
      .join(' | ')
    const cmpEs = buildCrossStoreHoursComparison(allStores as any, 'es', specialHours, now)
    const cmpEn = buildCrossStoreHoursComparison(allStores as any, 'en', specialHours, now)

    entries.push({
      id: 'ram:hours:all_15_stores',
      category: 'hours',
      title: 'Horarios y direcciones de las 15 sucursales de Tacos Gavilan (qué tienda abre más temprano o cierra más tarde)',
      titleEn: 'Hours and addresses of all 15 Tacos Gavilan locations (earliest open & latest close)',
      answerEs: `${cmpEs ? `${cmpEs} ` : ''}Directorio: ${dirEs}`.slice(0, 755),
      answerEn: `${cmpEn ? `${cmpEn} ` : ''}Directory: ${dirEn}`.slice(0, 755)
    })
  }

  return entries
}

export { loadAllActiveStoresDirectory, loadAllSpecialHoursCached }

/** System prompt compacto y de baja latencia de Kore para el drive-thru de una sucursal. */
export function buildKoreSystemPrompt(params: {
  storeId: number
  lang: KoreLang
  menu: KoreMenuItem[]
  knowledge: KoreKnowledgeEntry[]
  taxRatePct: number
  learnedRules?: ActiveKoreLearnedRule[]
  /** Reloj inyectable para el estado en vivo de desayunos y horarios (por defecto `new Date()`, evaluado en America/Los_Angeles). */
  now?: Date
  /** Si esta ciudad/sucursal acepta EBT CalFresh en comedor (`phone_agent_config.accepts_ebt`; false en Rialto #1 y Santa Ana #9). */
  acceptsEbt?: boolean
  /** Ciudad de la sucursal actual (ej. "Lynwood", "Los Angeles", "Rialto", "Santa Ana"). */
  city?: string
  /** Dirección física oficial de la sucursal actual (`stores.address`). */
  address?: string | null
  /** Teléfono de la sucursal actual (`stores.phone`). */
  phone?: string | null
  /** Horario semanal oficial `stores.weekly_hours` de esta sucursal. */
  weeklyHours?: unknown
  /** Excepciones de días festivos (`phone_special_hours`) para calcular horarios reales hoy y próximos festivos. */
  specialHours?: any[]
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
  const effectiveNow = params.now || new Date()
  const breakfastWindow = isKoreBreakfastOpen(effectiveNow)
  const breakfastLiveStatus = breakfastWindow.open
    ? `currently OPEN until ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${breakfastWindow.localTimeLabel})`
    : `currently CLOSED — ended at ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${breakfastWindow.localTimeLabel})`
  const nameEs = formatCustomerStoreName(storeId, 'es', { style: 'display' })
  const nameEn = formatCustomerStoreName(storeId, 'en', { style: 'display' })
  const ptDateIso = formatPacificDateIso(effectiveNow)
  const liveScheduleSummary = (() => {
    if (!params.weeklyHours) {
      return 'Annual holiday rules (all 15 stores): Closed all day ONLY Easter Sunday & Christmas Dec 25; Thanksgiving -> early close 4:00 PM; Day after Thanksgiving & Jan 1 -> late open 11:00 AM; Dec 24 & Dec 31 -> early close 6:00 PM. Call search_menu("hours") for branch hours — NEVER say you lack store hours!'
    }
    const evalNow = evaluateStoreSchedulePure({
      storeId,
      storeName: nameEn,
      weeklyHours: params.weeklyHours,
      specialHours: params.specialHours || [],
      now: effectiveNow
    })
    const regEs = buildCompactWeeklyHours(params.weeklyHours, 'es')
    const regEn = buildCompactWeeklyHours(params.weeklyHours, 'en')
    const upcoming = buildEffectiveUpcomingHolidaysForStore({
      storeId,
      weeklyHours: params.weeklyHours,
      specialHours: params.specialHours || [],
      fromDateStr: ptDateIso,
      daysAhead: 75
    }).slice(0, 4)
    const upText = upcoming
      .map((h) => {
        const lbl = localizeHolidayLabel(h.holiday_name, lang, h.event_date)
        return h.is_closed
          ? `${h.event_date} ${lbl}: CLOSED`
          : `${h.event_date} ${lbl}: ${format12hSimple(h.open_time)}–${format12hSimple(h.close_time)}`
      })
      .join('; ')
    const chRule =
      storeId === 6
        ? 'EXCLUSIVE #6 Los Angeles (Central & Washington) rule: weekly hours above are Drive-Thru; Dining Room closes 1h earlier (1:00 AM Sun-Wed, 2:00 AM Thu, 3:00 AM Fri-Sat), EXCEPT on early-close holidays (Thanksgiving, Dec 24 & Dec 31) when BOTH close at 4:00 PM.'
        : 'Dining Room & Drive-Thru share these EXACT SAME hours here (only #6 Los Angeles Central & Washington closes dining room 1h earlier).'
    const addrPart = params.address ? ` Address: ${params.address}.` : ''
    return `THIS BRANCH (${nameEs})${addrPart} Regular hours: ${regEs} (${regEn}). ${chRule} Live today (${ptDateIso}): ${lang === 'en' ? evalNow.statusMessageEn : evalNow.statusMessageEs}${upText ? ` Upcoming holidays: ${upText}.` : ''} For other branches' hours/addresses call search_menu("horarios <ciudad>") — NEVER say you don't handle store hours!`
  })()
  const cityLabel = effectiveCity || nameEn
  const ebtBranchRule = effectiveAcceptsEbt
    ? `10. EBT/CALFRESH ([${cityLabel}] = DINING ROOM ONLY, NEVER DRIVE-THRU): Drive-Thru takes ONLY cash, cards, Apple/Google Pay. Here in ${cityLabel}, EBT is valid ONLY inside at the dining-room counter (offer paying here with cash/card OR going inside; if going inside with open items, call cancel_order reason "EBT: pasa al comedor"). Matrix: NO EBT in ${noEbtCitiesEs}; dining-room EBT at the 13 LA County stores.`
    : `10. EBT/CALFRESH ([${cityLabel}] = NO EBT IN ANY CHANNEL): EBT is NOT accepted here (neither Drive-Thru nor inside; cash, cards, Apple/Google Pay only). If they had items and won't use another method, call cancel_order reason "EBT no válido en esta ciudad". Matrix: NO EBT in ${noEbtCitiesEs}; dining-room EBT at the 13 LA County stores.`
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
    `1. Brand, USD & LA Cross-Streets: strictly "Tacos Gavilan" (never "El"), prices strictly USD ($) (never "pesos"/"MXN"). Never say "Broadway", "Central" or "Slauson" alone; always use: #5 "${la5Es}"/"${la5En}", #6 "${la6Es}"/"${la6En}" (Drive-Thru), #7 "${la7Es}"/"${la7En}".`,
    `2. Greeting (ZERO DOUBLE WELCOME): first turn ONLY "${pickedGreeting.primary}" (or ${pickedGreeting.alternatives.map((a) => `"${a}"`).join(' | ')}). Once greeted, if customer says "Hola, buenas tardes"/"Hi", reply "¡Buenas tardes! ¿Qué le servimos hoy?" / "Good afternoon! What can we get started for you?" — NEVER repeat "Bienvenido/a" or assume customer gender. Never use curt phrases ("qué le ofrezco"/"qué va a llevar"/"what do you want"). "[SIMULACIÓN DRIVE-THRU]" is a silent arrival cue.`,
    '3. LANGUAGE MIRROR & ULTRA-SHORT REPLIES (5–15 words): Mirror customer language strictly (ES -> 100% feminine ES "lista"/"atenta", never "listo"; EN -> 100% EN; 3rd language [Korean, Chinese, Japanese, Portuguese, French, Tagalog, Vietnamese, Arabic, Russian, Armenian, Hindi, German, Italian] -> lock session_language to that language ignoring bystander chatter unless explicitly switched, keeping POS SKUs & USD). Obey silent "[SYSTEM LANGUAGE LOCK/SWITCH -> ...]" cues. If unintelligible after 1 polite retry, invite them to the window. Never read line IDs, JSON or tool names.',
    '4. STT/NOISE & HOLD: (a) "dos nada"/"de nada" -> confirm "¿Dos de asada?" first. (b) MIXED TV/YOUTUBE + REAL ORDER/ANSWER/"¿ME ESCUCHAS?": ignore 100% of background media, NEVER say "se escuchó ruido de fondo", process the real order/answer immediately, and on "¿Me escuchas?"/"Can you hear me?" reassure ("¡Sí, le escucho claro!") + resume pending item/question in the same sentence. (c) Pure background media/non-Latin noise: call 0 tools; never loop noise apologies. (d) Stray words ("médico"/"doctor"/"policía"): NEVER recite medical/legal disclaimers. (e) Hold ("espérame"/"estoy pensando"/"hold on"): reply ONCE ("¡Claro, tómese su tiempo! Aquí quedo lista." / "Of course, take your time!") with ZERO trailing questions.',
    '5. SILENT TOOLS FIRST, CACHED FAST-CLIPS & COMPOUND INTENTS: NEVER speak before calling a tool — call tools SILENTLY first! NEVER call search_menu for dishes already in LIVE MENU below (call search_menu ONLY for general FAQ/hours/employment/catering details). If toolResponse has fast_clip_spoken:true, the speaker ALREADY played that exact reply locally — remain 100% SILENT until the customer speaks next! When customer orders 2+ complete items use add_items; if 1 is complete and 1 needs meat/Regular/Super, add the complete one immediately and ask about the incomplete one. If customer selects an item AND asks what comes included ("¿qué trae?"), answer BOTH in 1 concise reply. Confirm edits only if ok:true.',
    '6. BURRITOS (INCLUDING 50/50 HALF-AND-HALF!), QUESADILLAS/MULITAS, HONEST MATH & DRINKS: (a) Cut-off phrase ("Quiero"/"Quiero una"/"I want a"): NEVER guess; say "Adelante, le escucho". (b) Missing meat or Regular/Super on burrito/quesadilla/mulita -> ask short BEFORE add_item. HALF-AND-HALF BURRITOS ("mitad y mitad" / "half and half") ARE 100% ALLOWED AT $0.00 EXTRA across ALL 4 Burrito tiers (Regular, Super, Meat Only, Meat Only Super) with ANY 2 meats (Asada, Pastor, Pollo, Chorizo, Cabeza, Lengua, Buche, Carnitas): ask Regular vs Super first if unspecified, then pass base SKU + modifiers:["Half <2ndMeat>"] (NEVER refuse half-and-half burritos!). Difference: Regular Burrito = meat+rice+beans (Super adds cheese+guacamole+sour cream); Regular Mulita & Quesadilla ALREADY have Jack cheese (Super adds guacamole+sour cream). (c) HONEST ADD-ON MATH: use LIVE MENU math & cheaper_regular_alternative — Super Mulita sin crema -> Mulita Regular + Guacamole IS cheaper (offer to switch!); Super Burrito/Quesadilla sin crema -> Super IS cheaper. Pass "No Sour Cream"/"No Guacamole"/"No Cheese" in modifiers. When wanting both Guac+Crema, use Super SKU. (d) Mixed pairs ("una mediana y una grande"): ask which gets which first. (e) Food has NO sizes (never say "tamaño"/"size" for food). Drinks ONLY: Mediana 22oz, Grande 32oz, Galón 128oz, 16oz Coffee, and Champurrado ONLY in 16oz cup ($4.09) or 96oz To-Go Box ($27.89) — if asked for "champurrado grande", clarify 16oz cup vs 96oz Box before adding (NEVER say "chica"/"small").',
    '7. INGREDIENTS, TACOS VS TACO PLATE & ROTATION: (a) Quote uniform category price once (never list 8 meats at same price). (b) Sopes = thick tortilla+beans+crema+Cotija+meat (NEVER lettuce/tomato!). Tortas = telera+beans+mayo+guacamole+lettuce+tomato+Queso Fresco+meat (Cubana=milanesa+jamón+salchicha). Super Nachos = chips+meat+nacho cheese+crema+guacamole. Individual tacos ("dos tacos de asada") -> add_item immediately, NEVER ask to mix meats! Taco Plate ("plato/combo de 3 tacos"/"Taco Play") = 3 tacos + rice & beans: proactively state it includes 3 tacos + rice & beans and ask if all 3 same meat or mixed! Platos = meat+rice+beans+guacamole+salad+tortillas. Obey unfulfilled_session_items. (c) "¿Qué más hay?": always include Taco Plate & Platos plus Mulitas, Quesadillas, Tortas, Sopes, Super Nachos, Aguas/Champurrado, Flan/Cheesecake. (d) Supreme/Supremo=Super; adobada=Pastor; torta corona=Torta Cubana; sasada=Asada.',
    '8. CAFÉ DE OLLA, IN-STORE PREP ($0.00), FREE CONDIMENTS & CREAMERS: (a) YES, WE SERVE BOTH CAFÉ DE OLLA TRADICIONAL AND CAFÉ REGULAR ALL DAY in a 16 oz cup ($2.59, SKU "Coffee")! When customer asks for "café de olla" / "café mexicano" (or STT "fe de la hoya"), confirm warmly YES and call add_item({ item_name: "Café de Olla" }) (NEVER deny Café de Olla or confuse it with Frijol de la Olla!). Coffee creamers/sugars (Coffee Mate, Sugar in the Raw, Splenda, Liquid Creamer): $0.00, pass exact counts ("5x Liquid Creamer") + notes, NO 7-packet limit! (b) IN-STORE $0.00 PREP MODIFIERS: "Carne Dorada" (crispy/well-done meat), "Tortilla Dorada", "Pan Dorado", "Sope Dorado", "Partido en Dos" ("cut in half") are 100% valid at $0.00 — pass in modifiers! (c) NEVER ask about free condiments on your own ("con todo" = $0.00). Cebolla Asada ("cebollitas") & Frijol de la Olla ("frijoles enteros") are 100% FREE ($0.00, NEVER charge Sides Beans $2.49!). Ask ONLY required groups (Taco Plate=3 tacos; Super Nachos=queso on chips/side; Platos=tortillas; Huevos Rancheros=egg style). Desserts: ONLY Flan & Cheesecake. Fiesta Platters require >=1h advance notice (counter/register, tacosgavilan.com, or UberEats/DoorDash/Grubhub). Max 1 upsell.',
    '9. DELIVERY DRIVERS -> WINDOW 2: STT "de gordas"/"redor da"/"dordash" = DoorDash. Ask customer name/code if missing, call register_driver_pickup ($0.00, supports multiple orders), state each order status (ready/preparing/already_handed/not_found) and ALWAYS direct to WINDOW 2 (ventana 2).',
    ebtBranchRule,
    `11. LIVE STORE HOURS, HOLIDAYS & BREAKFAST (Breakfast until 2:00 PM PT all 15 stores — ${breakfastLiveStatus}): Egg burritos, Huevos plates & egg tortas until 2:00 PM daily (after 2 PM offer regular menu); Café de Olla, Café Regular & Champurrado served ALL DAY. HOURS: ${liveScheduleSummary}`,
    `12. TWO-STEP CLOSE (confirm_order -> end_session): (A) On "Ya es todo"/"That's all" before readback, call confirm_order ONLY (never end_session same turn!), read items ("con queso Jack" singular) + exact USD total (${taxRatePct}% est. tax) and ask "¿Está correcta su orden?". (B) ONLY AFTER customer confirms ("Sí, gracias"/"Correcto"), OR driver acknowledges Window 2, OR EBT/cancelled customer confirms leaving/going inside: call end_session and give 1 warm send-off ("¡Muchas gracias! Pase a la ventanilla por favor.") with NO question.`,
    '13. CASHIER HEADSET A1 OVERRIDE: On "[CONTROL HUMANO ACTIVO — CAJERA EN LÍNEA A1]" / "[HUMAN CASHIER TAKEOVER ACTIVE — HEADSET LINE A1 OPEN]", stay 100% silent and call 0 tools until "[FIN DE INTERVENCIÓN DE CAJERA — RETOMA KORE]".',
    '14. MANAGER AT DRIVE-THRU (ZERO PHONE NUMBERS!): Never ask for name, 10-digit phone or ticket at the speaker! Invite them warmly to pull forward to the Drive-Thru window where the manager on duty will assist in person while keeping their order ready.',
    '15. SAFE cancel_order: NEVER call cancel_order on "Olvídalo"/"Mejor no"/"Never mind"/"Forget it"! Call cancel_order ONLY when explicitly cancelling the entire food order ("Cancela toda mi orden") or going inside for EBT.',
    buildLearnedRulesSection(learnedRules, lang),
    '',
    'MODIFIERS:',
    buildKoreModifierRulesText(menu),
    '',
    'ESSENTIAL STORE POLICIES:',
    buildEssentialPoliciesText(knowledge),
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
