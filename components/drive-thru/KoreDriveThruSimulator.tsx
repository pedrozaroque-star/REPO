/**
 * @module components/drive-thru/KoreDriveThruSimulator
 * @description Simulador "Kore Drive-Thru" (pestaña `kore` de `/drive-thru`). Un gerente habla por el
 *   micrófono del navegador como si fuera el cliente en el carro y la asistente de voz Kore
 *   (Gemini Live API, modelo `gemini-3.8-live`, voz prebuilt `Kore`) le toma la orden con el menú
 *   y los precios reales de la tienda, mientras se arma un ticket en vivo (live ticket).
 *
 * @businessRules
 * - SIMULACIÓN: NADA se envía a Toast POS ni a cocina (la llave Toast no tiene `orders:write`).
 *   La UI lo indica con un badge permanente.
 * - Solo tiendas con Drive-Thru (`stores.has_drive_thru = true`: hoy #3 West Covina, #6 LA Central,
 *   #10 La Puente, #12 Norwalk, #14 Lynwood, #15 South Gate). El API de Kore usa `stores.id` numérico.
 * - Roles: manager / supervisor / admin (lo protege la página con ProtectedRoute y el backend).
 *   Al montar se lee `teg_user` de `localStorage`: los roles globales (`admin`, `administrador`,
 *   `supervisor`, `regional_manager`) ven las 6 sucursales Drive-Thru; los roles por sucursal
 *   (`manager`, `general_manager`, `gerente`) ven únicamente las tiendas Drive-Thru incluidas en su
 *   `store_id` / `store_scope`, seleccionando la primera permitida ANTES de pedir el historial.
 *   Si un gerente solo tiene una sucursal sin Drive-Thru (p. ej. #1 Rialto), se muestra aviso
 *   bilingüe (`drive_thru.kore_no_dt_access`), se deshabilita el inicio y no se disparan 403/422.
 * - Las herramientas (tools) de Kore se ejecutan con el motor puro `applyKoreTool`
 *   (`lib/drive-thru-kore-order.ts`): `add_item`, `add_items` (lote), `update_item`, `remove_item`,
 *   `get_order`, `search_menu`, `confirm_order`, `cancel_order` y `end_session` (cierre automático
 *   del auto tras confirmar y despedir sin cortar el audio de Kore); mientras que
 *   `register_driver_pickup` cruza EN TIEMPO REAL contra `POST /api/drive-thru/kore/driver-lookup`
 *   (`fetchOffPremiseOrders` de Blindaje Delivery + envío a **Ventana 2 / Window 2**), con timeout
 *   seguro de 4.5 s y degradación automática a `applyKoreTool` local si la red tarda o falla.
 * - Banco de voz pregrabada instantánea (`<25 ms`, cero doble voz): precarga en RAM (`Float32Array`)
 *   los clips bilingües `Kore 3.8` (`GET /api/drive-thru/kore/fast-clips`) minados sobre los tickets
 *   históricos reales de Drive-Thru (`toast_ticket_consumption_snapshots` + `dt_orders`), reproduce
 *   al instante la bienvenida inicial (`initialGreetingClips` + `clientContent` `turnComplete: false`),
 *   las aclaraciones/confirmaciones (`matchKoreFastClipForToolOutcome`) silenciando el turno tardío de
 *   Gemini (`suppressGeminiTurnAudioRef`), y las despedidas finales (`isTerminalSendoff`).
 * - Cambio instantáneo de idioma (`ES <-> EN`): detecta en tiempo real sobre `interimInputTranscription`
 *   e `inputTranscription` (`detectKoreSpokenLanguage`) si el cliente habla en inglés (o español),
 *   actualiza al instante `sessionMetaRef.current.lang`, inyecta `lang` en todas las llamadas a herramientas
 *   (`applyKoreTool` + `/api/drive-thru/kore/driver-lookup`), habilita los botones `ES / EN` en caliente
 *   y cuenta con red de seguridad silenciosa al terminar el turno (`!playbackRef.current?.isActive`).
 * - Anti-ruido y modos de voz: incluye `KoreNoiseGate` opcional por umbral RMS (ignora TV/radio de
 *   fondo) y modo opcional Push-to-Talk (botón o barra espaciadora con envío inmediato de `audioStreamEnd`).
 * - Telemetría de latencia: mide en vivo `ms` desde el fin de voz del cliente hasta el primer chunk
 *   PCM de Kore (`avgLatencyMs`, `p95LatencyMs`, `bargeInCount`, `sessionKind`) y lo envía al guardar.
 * - Totales en centavos enteros con `computeKoreTotals` y moneda USD (`$0.00` en `driver_pickup`).
 * - Tope de seguridad de 8 minutos por sesión (KORE_SESSION_CAP_SEC).
 * - Al terminar (confirmada / cancelada / abandonada) se guarda la simulación en
 *   `dt_kore_sim_sessions` vía `/api/drive-thru/kore/sessions`, se muestra el historial reciente y
 *   se integra `KoreLearningPanel` (`/api/drive-thru/kore/learning`) para criterios y reglas aprendidas.
 *
 * @dataFlow
 * 1. GET `/api/stores` → tiendas con Drive-Thru (id numérico + external_id UUID).
 * 2. Click "Iniciar": AudioContext (gesto del usuario) → getUserMedia (echoCancellation,
 *    noiseSuppression, autoGainControl) → AudioWorklet PCM16 16 kHz (`kore-audio.ts`).
 * 3. POST `/api/drive-thru/kore/session` {storeId, lang} → {token efímero, wsUrl, setup, menu, store}.
 * 4. `new WebSocket(wsUrl)` (endpoint `BidiGenerateContentConstrained?access_token=…`) → envía
 *    `{setup}` → espera `setupComplete` → `realtimeInput.text` (señal de llegada del carro).
 * 5. Micrófono → `realtimeInput.audio` (base64, `audio/pcm;rate=16000`); pausa → `audioStreamEnd`.
 * 6. Servidor → `serverContent.modelTurn.parts[].inlineData` (PCM16 24 kHz) → cola gapless;
 *    `interrupted` → vacía la cola (barge-in); `inputTranscription` / `outputTranscription` →
 *    conversación en vivo; `toolCall` → cola asíncrona serializada (`driver-lookup` en vivo para
 *    `register_driver_pickup` o `applyKoreTool` local) → `toolResponse`; `toolCallCancellation`
 *    → aborta/deshace las acciones canceladas si fueron las últimas; `goAway` → aviso visible.
 * 7. Fin → limpieza total (socket, tracks, worklet, AudioContext) → POST sessions → GET historial.
 *
 * @notes
 * - Los handlers del WebSocket se crean una vez por sesión: SOLO leen refs (nunca estado de React)
 *   para evitar cierres obsoletos (stale closures). `genRef` invalida flujos asíncronos viejos
 *   (p. ej. si el usuario termina mientras se pide el token).
 * - El medidor de nivel del mic se pinta directo al DOM (sin re-render a ~31 fps).
 * - `ws.binaryType = 'arraybuffer'`: Gemini Live manda frames binarios con JSON UTF-8.
 * - Las herramientas son `behavior: 'BLOCKING'` (el modelo espera la respuesta); si el backend
 *   declarara alguna `NON_BLOCKING`, se agrega `scheduling: 'WHEN_IDLE'` a su respuesta.
 * - Al desmontar con una sesión viva se intenta guardar como "abandonada" con `fetch keepalive`.
 * - Usa audífonos: el eco del altavoz puede provocar que Kore se interrumpa sola.
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Mic, MicOff, PhoneCall, PhoneOff, Headphones, Loader2, AlertTriangle, Volume2, Car,
    History, RefreshCw, ShieldAlert, Bot, User, Wrench, X, Radio, Info, Gauge, Sliders, Truck, Zap,
    ChevronDown, ChevronUp
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { CANONICAL_CUSTOMER_STORES_BY_ID, formatCustomerGreetingTarget, formatCustomerStoreName } from '@/lib/customer-store-names'
import {
    applyKoreTool,
    computeKoreTotals,
    createKoreOrderState,
    detectKoreSpokenLanguage,
    isKoreClosingSendoffText,
    type KoreDriverPickup,
    type KoreMenuItem,
    type KoreOrderState,
    type KoreSessionKind,
} from '@/lib/drive-thru-kore-order'
import {
    KORE_FAST_CLIP_SPECS,
    matchKoreFastClipForToolOutcome,
    type KoreFastClipCategory,
    type KoreFastClipMatch,
} from '@/lib/drive-thru-kore-fast-match'
import {
    KORE_CAPTURE_PROCESSOR,
    KORE_CHUNK_SAMPLES,
    KORE_INPUT_SAMPLE_RATE,
    KoreNoiseGate,
    KorePlaybackQueue,
    base64ToBytes,
    bytesToBase64,
    computeKoreLatencyStats,
    decodePcm16ToFloat32,
    loadKoreCaptureWorklet,
    parsePcmRate,
    type KoreLatencyStats,
} from './kore-audio'
import KoreLiveTicket, { formatUsdCents } from './KoreLiveTicket'
import KoreLearningPanel from './KoreLearningPanel'

// ─────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────

/** Tope de seguridad por sesión (8 minutos). */
const KORE_SESSION_CAP_SEC = 8 * 60
/** Tiempo máximo para recibir `setupComplete` tras abrir el socket. */
const SETUP_TIMEOUT_MS = 15000
/** Tiempo máximo para cruzar órdenes de repartidor con Blindaje Delivery antes de fallback local. */
export const KORE_DRIVER_LOOKUP_TIMEOUT_MS = 4500
/** Colchón natural tras terminar audio de despedida cuando Kore invocó `end_session` explícito. */
export const KORE_AUTO_END_EXPLICIT_CUSHION_MS = 650
/** Silencio de respaldo tras enviar el auto a ventanilla (`isKoreClosingSendoffText`) sin pregunta abierta. */
export const KORE_AUTO_END_SENDOFF_CUSHION_MS = 3200

export type KoreAutoEndMode = 'none' | 'explicit_tool' | 'confirmed_sendoff'

/**
 * Determina el colchón de cierre automático al concluir el turno de Kore (`turnComplete === true`):
 * - `'explicit_tool'` (`end_session`) -> `650 ms` tras vaciar todo el audio de `KorePlaybackQueue`.
 * - `'confirmed_sendoff'` (orden confirmada/cancelada + despedida a ventanilla sin `?`) -> `3200 ms`.
 * - En cualquier otro caso -> `null` (la sesión permanece abierta).
 */
export function evaluateKoreTurnCompleteAutoEnd(params: {
    currentMode: KoreAutoEndMode
    orderStatus: KoreOrderState['status']
    lastKoreText: string
}): number | null {
    if (params.currentMode === 'explicit_tool') {
        return KORE_AUTO_END_EXPLICIT_CUSHION_MS
    }
    if (
        (params.currentMode === 'none' || params.currentMode === 'confirmed_sendoff') &&
        (params.orderStatus === 'confirmed' || params.orderStatus === 'cancelled') &&
        isKoreClosingSendoffText(params.lastKoreText)
    ) {
        return KORE_AUTO_END_SENDOFF_CUSHION_MS
    }
    return null
}
/** Umbral RMS mínimo en modo VAD mientras suena un clip local pregrabado (evita retroalimentación de bocinas sin audífonos). */
export const KORE_LOCAL_CLIP_ECHO_RMS_FLOOR = 0.06
/** Segundo refresco automático del panel de aprendizaje tras terminar `after()` en backend. */
export const KORE_POST_SAVE_LEARNING_REFRESH_MS = 3500

export function shouldSuppressLocalFastClipSpeakerEcho(params: {
    playbackActive: boolean
    localFastClipStartedAt: number
    micMode: 'vad' | 'ptt'
    rms: number
}): boolean {
    if (!params.playbackActive || !(params.localFastClipStartedAt > 0) || params.micMode !== 'vad') {
        return false
    }
    return !(Number.isFinite(params.rms) && params.rms >= KORE_LOCAL_CLIP_ECHO_RMS_FLOOR)
}

/** Si el socket acumula más de esto sin enviar, se descartan bloques de mic (backpressure). */
const WS_BACKPRESSURE_BYTES = 512 * 1024

/** Señal de llegada del carro cuando no hay saludo pregrabado en caché. */
const ARRIVAL_CUE: Record<KoreLang, string> = {
    es: '[SIMULACIÓN DRIVE-THRU — IDIOMA ACTIVO: ESPAÑOL] Un cliente acaba de llegar a la bocina. Salúdalo ahora 100% en español.',
    en: '[DRIVE-THRU SIMULATION — ACTIVE LANGUAGE: ENGLISH] A customer just pulled up to the speaker. Greet them now 100% in English.',
}

/** Contexto inicial inyectado en `clientContent` junto al saludo pregrabado para fijar el idioma base sin sesgo. */
export const KORE_SEEDED_GREETING_CUE: Record<'es' | 'en', string> = {
    es: '[SIMULACIÓN DRIVE-THRU — IDIOMA ACTIVO: ESPAÑOL. El cliente está en la bocina; responde 100% en español salvo que te hablen en inglés.]',
    en: '[DRIVE-THRU SIMULATION — ACTIVE LANGUAGE: ENGLISH. The customer is at the speaker; respond 100% in English unless they speak Spanish.]',
}

/** Directiva silenciosa para conmutar o bloquear idioma en caliente (solo cuando Kore no está reproduciendo audio). */
export const KORE_SYSTEM_LANG_SWITCH_CUE: Record<'es' | 'en', string> = {
    en: '[SYSTEM LANGUAGE SWITCH -> ENGLISH] Customer is speaking English. Respond strictly in 100% English from now on.',
    es: '[SYSTEM LANGUAGE LOCK -> SPANISH] El cliente está hablando en ESPAÑOL. PROHIBIDO responder en inglés. Responde estrictamente 100% en español.',
}

/** Evalúa el siguiente idioma activo de la sesión a partir de lo hablado por el cliente. */
export function resolveNextKoreSessionLang(text: string, currentLang: 'es' | 'en'): 'es' | 'en' {
    return detectKoreSpokenLanguage(text, currentLang)
}

/** Respaldo si `/api/stores` falla (stores.id numérico; nombres internos de la DB). */
const FALLBACK_DT_STORES: DtStoreOption[] = [
    { id: 3, name: 'West Covina', externalId: '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02' },
    { id: 6, name: 'LA Central', externalId: '8685e942-3f07-403a-afb6-faec697cd2cb' },
    { id: 10, name: 'La Puente', externalId: '3a803939-eb13-4def-a1a4-462df8e90623' },
    { id: 12, name: 'Norwalk', externalId: '42ed15a6-106b-466a-9076-1e8f72451f6b' },
    { id: 14, name: 'Lynwood', externalId: '80a1ec95-bc73-402e-8884-e5abbe9343e6' },
    { id: 15, name: 'South Gate', externalId: '95866cfc-eeb8-4af9-9586-f78931e1ea04' },
]

// ─────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────

type KoreLang = 'es' | 'en'
type KoreMicMode = 'vad' | 'ptt'
type SessionPhase = 'idle' | 'requesting' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'
type KoreOutcome = 'confirmed' | 'cancelled' | 'abandoned'
type TranscriptRole = 'customer' | 'kore' | 'system'

export interface DtStoreOption {
    id: number
    name: string
    externalId: string | null
    code?: string | null
}

/** Alcance del usuario autenticado (`teg_user`) para filtrar sucursales Drive-Thru en cliente. */
export interface KoreViewerScope {
    isGlobal: boolean
    tokens: string[]
    primaryTokens: string[]
}

interface KoreSessionStore {
    id: number
    internalName: string
    customerName: string
    customerNameEs?: string
    customerNameEn?: string
    acceptsEbt?: boolean
    taxRatePct: number
    taxIsEstimate: boolean
}

export interface KoreRawFastClipVariant {
    text: string
    pcm16Base64: string
    sampleRate?: number
}

export interface KoreDecodedFastClipVariant {
    text: string
    samples: Float32Array
    sampleRate: number
}

export interface KoreDecodedFastClipPair {
    es: KoreDecodedFastClipVariant | null
    en: KoreDecodedFastClipVariant | null
}

export interface KoreFastClipsStats {
    totalClips: number
    cachedClips: number
    historicalDtOrdersCount: number
    historicalDetailedSnapshotsCount: number
    topDriveThruItems: string[]
}

interface KoreSessionResponse {
    token: string
    wsUrl: string
    model: string
    setup: Record<string, unknown>
    menu: KoreMenuItem[]
    store: KoreSessionStore
    initialGreetingClips?: {
        es?: KoreRawFastClipVariant | null
        en?: KoreRawFastClipVariant | null
    } | null
    expiresAt: string
}

interface TranscriptEntry {
    id: string
    role: TranscriptRole
    text: string
    at: string
    final: boolean
    kind?: 'event' | 'tool' | 'tool_error' | 'warning'
    toolName?: string
}

/** Fila de GET /api/drive-thru/kore/sessions (camelCase; totales recalculados por el servidor). */
interface KoreHistoryRow {
    id: string | number
    storeId: number
    startedAt: string | null
    endedAt: string | null
    durationSec: number | null
    lang: string | null
    outcome: KoreOutcome | string | null
    subtotalCents: number | null
    taxCents: number | null
    totalCents: number | null
    itemCount: number | null
    avgLatencyMs?: number | null
    p95LatencyMs?: number | null
    bargeInCount?: number | null
    sessionKind?: KoreSessionKind | string | null
    createdBy?: string | number | null
    createdByName?: string | null
    createdAt?: string | null
}

interface MicChunkMessage {
    pcm: ArrayBuffer
    rms: number
}

// ─────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Decodifica una variante de clip rápido (`pcm16Base64` 24 kHz) a `Float32Array` listo para `AudioContext`. */
export function decodeKoreFastClipVariant(raw: unknown): KoreDecodedFastClipVariant | null {
    if (!isPlainObject(raw)) return null
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const b64 = typeof raw.pcm16Base64 === 'string' ? raw.pcm16Base64.trim() : ''
    if (!text || !b64) return null
    const samples = decodePcm16ToFloat32(base64ToBytes(b64))
    if (samples.length === 0) return null
    const rate =
        typeof raw.sampleRate === 'number' && Number.isFinite(raw.sampleRate) && raw.sampleRate >= 8000 && raw.sampleRate <= 192000
            ? Math.round(raw.sampleRate)
            : 24000
    return { text, samples, sampleRate: rate }
}

/** Pre-decodifica el mapa completo de `/api/drive-thru/kore/fast-clips` a RAM (`Float32Array`) + estadísticas. */
export function decodeKoreFastClipsPayload(data: unknown): {
    map: Map<string, KoreDecodedFastClipPair>
    stats: KoreFastClipsStats | null
} {
    const map = new Map<string, KoreDecodedFastClipPair>()
    if (!isPlainObject(data)) return { map, stats: null }
    let countedTotal = 0
    let countedCached = 0
    if (isPlainObject(data.clips)) {
        for (const [clipId, rawPair] of Object.entries(data.clips)) {
            if (!clipId || !isPlainObject(rawPair)) continue
            const es = decodeKoreFastClipVariant(rawPair.es)
            const en = decodeKoreFastClipVariant(rawPair.en)
            countedTotal += 2
            if (es) countedCached += 1
            if (en) countedCached += 1
            if (es || en) map.set(clipId, { es, en })
        }
    }
    const rawStats = isPlainObject(data.stats) ? data.stats : null
    const topItems: string[] = []
    if (rawStats && Array.isArray(rawStats.topDriveThruItems)) {
        for (const entry of rawStats.topDriveThruItems) {
            if (typeof entry === 'string' && entry.trim()) topItems.push(entry.trim())
            else if (isPlainObject(entry)) {
                const nm = typeof entry.name === 'string'
                    ? entry.name.trim()
                    : typeof entry.itemName === 'string'
                        ? entry.itemName.trim()
                        : typeof entry.displayName === 'string'
                            ? entry.displayName.trim()
                            : ''
                if (nm) topItems.push(nm)
            }
        }
    }
    const totalClips =
        rawStats && typeof rawStats.totalClips === 'number' && Number.isFinite(rawStats.totalClips) && rawStats.totalClips >= 0
            ? Math.round(rawStats.totalClips)
            : countedTotal
    const cachedClips =
        rawStats && typeof rawStats.cachedClips === 'number' && Number.isFinite(rawStats.cachedClips) && rawStats.cachedClips >= 0
            ? Math.round(rawStats.cachedClips)
            : countedCached
    const historicalDtOrdersCount =
        rawStats && typeof rawStats.historicalDtOrdersCount === 'number' && Number.isFinite(rawStats.historicalDtOrdersCount)
            ? Math.max(0, Math.round(rawStats.historicalDtOrdersCount))
            : 0
    const historicalDetailedSnapshotsCount =
        rawStats && typeof rawStats.historicalDetailedSnapshotsCount === 'number' && Number.isFinite(rawStats.historicalDetailedSnapshotsCount)
            ? Math.max(0, Math.round(rawStats.historicalDetailedSnapshotsCount))
            : 0
    const stats: KoreFastClipsStats | null =
        rawStats || map.size > 0
            ? {
                  totalClips,
                  cachedClips,
                  historicalDtOrdersCount,
                  historicalDetailedSnapshotsCount,
                  topDriveThruItems: topItems.slice(0, 6),
              }
            : null
    return { map, stats }
}

export type KoreFastClipCatalogFilter = 'all' | 'greeting' | KoreFastClipCategory

export interface KoreFastClipCatalogRow {
    clipId: string
    category: 'greeting' | KoreFastClipCategory
    greetingNum?: number
    textEs: string
    textEn: string
    hasEs: boolean
    hasEn: boolean
}

/** Construye la lista completa y legible del catálogo de audios pregrabados (ES/EN) para la tienda activa. */
export function buildKoreFastClipCatalogRows(
    storeId: number,
    map: ReadonlyMap<string, KoreDecodedFastClipPair>
): KoreFastClipCatalogRow[] {
    const rows: KoreFastClipCatalogRow[] = []
    const seen = new Set<string>()
    if (Number.isInteger(storeId) && storeId > 0) {
        const targetEs = formatCustomerGreetingTarget(storeId, 'es')
        const targetEn = formatCustomerGreetingTarget(storeId, 'en')
        const esGreetings = [
            `¡Bienvenido a Tacos Gavilan ${targetEs}! ¿Cómo le podemos ayudar?`,
            `¡Bienvenido a Tacos Gavilan ${targetEs}! ¿Qué se le antoja ordenar hoy?`,
            `¡Bienvenido a Tacos Gavilan ${targetEs}! ¿Cómo le podemos ayudar hoy?`,
            `¡Hola, bienvenido a Tacos Gavilan ${targetEs}! ¿Qué le gustaría ordenar hoy?`,
        ]
        const enGreetings = [
            `Welcome to Tacos Gavilan ${targetEn}! How can we help you?`,
            `Welcome to Tacos Gavilan ${targetEn}! What are you craving today?`,
            `Welcome to Tacos Gavilan ${targetEn}! How can we help you today?`,
            `Hi, welcome to Tacos Gavilan ${targetEn}! What would you like to order today?`,
        ]
        for (let v = 0; v < 4; v++) {
            const clipId = `greeting_v${v}`
            const pair = map.get(clipId)
            seen.add(clipId)
            rows.push({
                clipId,
                category: 'greeting',
                greetingNum: v + 1,
                textEs: pair?.es?.text || esGreetings[v],
                textEn: pair?.en?.text || enGreetings[v],
                hasEs: Boolean(pair?.es && pair.es.samples.length > 0),
                hasEn: Boolean(pair?.en && pair.en.samples.length > 0),
            })
        }
    }
    for (const spec of KORE_FAST_CLIP_SPECS) {
        const pair = map.get(spec.clipId)
        seen.add(spec.clipId)
        rows.push({
            clipId: spec.clipId,
            category: spec.category,
            textEs: pair?.es?.text || spec.textEs,
            textEn: pair?.en?.text || spec.textEn,
            hasEs: Boolean(pair?.es && pair.es.samples.length > 0),
            hasEn: Boolean(pair?.en && pair.en.samples.length > 0),
        })
    }
    for (const [clipId, pair] of map.entries()) {
        if (seen.has(clipId)) continue
        rows.push({
            clipId,
            category: clipId.startsWith('greeting') ? 'greeting' : 'ops',
            textEs: pair.es?.text || '—',
            textEn: pair.en?.text || '—',
            hasEs: Boolean(pair.es && pair.es.samples.length > 0),
            hasEn: Boolean(pair.en && pair.en.samples.length > 0),
        })
    }
    return rows
}

function getAuthHeaders(): Record<string, string> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
}

export interface KoreDriverLookupFetchDeps {
    storeId: number
    headers: Record<string, string>
    lang?: 'es' | 'en'
    acceptsEbt?: boolean
    fetchImpl?: typeof fetch
    timeoutMs?: number
    externalSignal?: AbortSignal
}

/**
 * Ejecuta `register_driver_pickup` cruzando en vivo contra `POST /api/drive-thru/kore/driver-lookup`
 * (`fetchOffPremiseOrders` de Blindaje Delivery + envío a Ventana 2), con timeout seguro (4.5 s)
 * y degradación automática a `applyKoreTool` local si la red tarda o falla.
 */
export async function resolveKoreDriverPickupTool(
    before: KoreOrderState,
    menu: KoreMenuItem[],
    args: Record<string, unknown>,
    taxRatePct: number | null,
    deps: KoreDriverLookupFetchDeps
): Promise<{ state: KoreOrderState; response: Record<string, unknown>; cancelled?: boolean; usedFallback: boolean }> {
    const fallbackOut = applyKoreTool(before, menu, 'register_driver_pickup', args, {
        taxRatePct,
        ...(deps.lang ? { lang: deps.lang } : {}),
        ...(typeof deps.acceptsEbt === 'boolean' ? { acceptsEbt: deps.acceptsEbt } : {}),
    })
    if (deps.externalSignal?.aborted) {
        return { state: before, response: {}, cancelled: true, usedFallback: false }
    }

    const rawOrders = Array.isArray(args.orders) ? args.orders : []
    const normalizedOrders = rawOrders
        .filter(isPlainObject)
        .map(o => {
            const cname = typeof o.customer_name === 'string'
                ? o.customer_name
                : typeof o.customerName === 'string'
                    ? o.customerName
                    : undefined
            const code = typeof o.order_code === 'string'
                ? o.order_code
                : typeof o.orderCode === 'string'
                    ? o.orderCode
                    : undefined
            return {
                ...(cname !== undefined ? { customer_name: cname } : {}),
                ...(code !== undefined ? { order_code: code } : {}),
            }
        })

    if (normalizedOrders.length === 0) {
        return {
            state: fallbackOut.state,
            response: isPlainObject(fallbackOut.result) ? { ...fallbackOut.result } : { result: fallbackOut.result },
            usedFallback: true,
        }
    }

    const shouldDiscardExisting = Boolean(args.replace) || before.status === 'cancelled'
    const existingPickup: KoreDriverPickup | null =
        !shouldDiscardExisting && before.sessionKind === 'driver_pickup'
            ? (before.driverPickup ?? null)
            : null

    const reqBody: Record<string, unknown> = {
        storeId: deps.storeId,
        ...(deps.lang ? { lang: deps.lang } : {}),
        ...(typeof args.platform === 'string' && args.platform.trim() ? { platform: args.platform.trim() } : {}),
        orders: normalizedOrders,
        existingPickup,
        ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
        ...(typeof args.confirm_pickup === 'boolean' ? { confirm_pickup: args.confirm_pickup } : {}),
        ...(typeof args.replace === 'boolean' ? { replace: args.replace } : {}),
    }

    const ctrl = new AbortController()
    const onExternalAbort = () => ctrl.abort()
    if (deps.externalSignal) {
        deps.externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const timeoutMs = deps.timeoutMs ?? KORE_DRIVER_LOOKUP_TIMEOUT_MS
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)

    try {
        const doFetch = deps.fetchImpl ?? fetch
        const res = await doFetch('/api/drive-thru/kore/driver-lookup', {
            method: 'POST',
            headers: deps.headers,
            body: JSON.stringify(reqBody),
            signal: ctrl.signal,
        })
        if (deps.externalSignal?.aborted) {
            return { state: before, response: {}, cancelled: true, usedFallback: false }
        }
        const data: unknown = await res.json().catch(() => null)
        if (res.ok && isPlainObject(data)) {
            if (data.ok === true && isPlainObject(data.driverPickup)) {
                const ordersList = Array.isArray(data.driverPickup.orders) ? data.driverPickup.orders : []
                const toolResult = isPlainObject(data.toolResult)
                    ? { ...data.toolResult }
                    : (isPlainObject(fallbackOut.result) ? { ...fallbackOut.result } : { ok: true })
                if (ordersList.length > 0) {
                    const dp = data.driverPickup as unknown as KoreDriverPickup
                    const nextState: KoreOrderState = {
                        lines: [],
                        status: args.confirm_pickup === true ? 'confirmed' : 'building',
                        sessionKind: 'driver_pickup',
                        driverPickup: dp,
                        nextLineNumber: before.nextLineNumber ?? 1,
                        version: (before.version ?? 0) + 1,
                    }
                    return { state: nextState, response: toolResult, usedFallback: false }
                }
                return { state: before, response: toolResult, usedFallback: false }
            }
            if (data.ok === false && isPlainObject(data.toolResult)) {
                return { state: before, response: { ...data.toolResult }, usedFallback: false }
            }
        }
    } catch {
        if (deps.externalSignal?.aborted) {
            return { state: before, response: {}, cancelled: true, usedFallback: false }
        }
    } finally {
        clearTimeout(timer)
        if (deps.externalSignal) {
            deps.externalSignal.removeEventListener('abort', onExternalAbort)
        }
    }

    return {
        state: fallbackOut.state,
        response: isPlainObject(fallbackOut.result) ? { ...fallbackOut.result } : { result: fallbackOut.result },
        usedFallback: true,
    }
}

/** Duración protobuf JSON ("12s", "1.5s") → segundos enteros. */
function parseDurationSec(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
    if (typeof value !== 'string') return null
    const n = parseFloat(value)
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

function formatClock(totalSec: number): string {
    const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0
    const m = Math.floor(safe / 60)
    const s = safe % 60
    return `${m}:${s.toString().padStart(2, '0')}`
}

let entrySeq = 0
function newEntryId(): string {
    entrySeq += 1
    return `k${Date.now().toString(36)}${entrySeq}`
}

const GLOBAL_KORE_ROLES = new Set(['admin', 'administrador', 'supervisor', 'regional_manager'])
const SCOPED_KORE_ROLES = new Set(['manager', 'general_manager', 'gerente'])

function normalizeStoreToken(raw: unknown): string {
    return String(raw ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/tacos\s*(?:el\s*)?gavilan/g, '')
        .replace(/[^a-z0-9]/g, '')
}

function collectRawTokens(source: unknown, target: string[]): void {
    if (source === null || source === undefined) return
    if (Array.isArray(source)) {
        for (const item of source) collectRawTokens(item, target)
        return
    }
    if (typeof source === 'number' && Number.isFinite(source)) {
        target.push(String(source))
        return
    }
    if (typeof source === 'string') {
        for (const piece of source.split(',')) {
            const trimmed = piece.trim()
            if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') target.push(trimmed)
        }
    }
}

/** Parsea `localStorage.getItem('teg_user')` para determinar alcance global vs por sucursal. */
export function parseKoreViewerScope(rawTegUser: string | null | undefined): KoreViewerScope {
    if (rawTegUser === null || rawTegUser === undefined) {
        return { isGlobal: true, tokens: [], primaryTokens: [] }
    }
    let obj: unknown
    try {
        obj = JSON.parse(rawTegUser)
    } catch {
        return { isGlobal: false, tokens: [], primaryTokens: [] }
    }
    if (!isPlainObject(obj)) return { isGlobal: false, tokens: [], primaryTokens: [] }
    const meta = isPlainObject(obj.user_metadata) ? obj.user_metadata : null
    const rawRole = obj.role || obj.user_role || meta?.role || ''
    const role = String(rawRole).trim().toLowerCase()
    if (GLOBAL_KORE_ROLES.has(role)) return { isGlobal: true, tokens: [], primaryTokens: [] }
    if (!SCOPED_KORE_ROLES.has(role)) return { isGlobal: false, tokens: [], primaryTokens: [] }

    const primaryTokens: string[] = []
    collectRawTokens(obj.store_id, primaryTokens)
    collectRawTokens(meta?.store_id, primaryTokens)
    const tokens: string[] = [...primaryTokens]
    collectRawTokens(obj.store_ids, tokens)
    collectRawTokens(obj.store_scope, tokens)
    collectRawTokens(meta?.store_ids, tokens)
    collectRawTokens(meta?.store_scope, tokens)
    return {
        isGlobal: false,
        tokens: Array.from(new Set(tokens)),
        primaryTokens: Array.from(new Set(primaryTokens)),
    }
}

function storeMatchesTokens(store: DtStoreOption, tokens: string[]): boolean {
    if (tokens.length === 0) return false
    const canonical = CANONICAL_CUSTOMER_STORES_BY_ID[store.id]
    const normCandidates = new Set(
        [store.name, store.code, String(store.id), canonical?.code, canonical?.internalName, canonical?.slug]
            .map(normalizeStoreToken)
            .filter(Boolean)
    )
    const extLower = store.externalId ? store.externalId.toLowerCase() : null
    return tokens.some(tok => {
        if (/^\d+$/.test(tok) && Number(tok) === store.id) return true
        if (extLower && tok.toLowerCase() === extLower) return true
        const norm = normalizeStoreToken(tok)
        return Boolean(norm && normCandidates.has(norm))
    })
}

/** Filtra las tiendas Drive-Thru a las autorizadas para el usuario (`teg_user`). */
export function filterDtStoresForViewer(allDtStores: DtStoreOption[], scope: KoreViewerScope): DtStoreOption[] {
    if (scope.isGlobal) return allDtStores
    return allDtStores.filter(s => storeMatchesTokens(s, scope.tokens))
}

/** Selecciona el `storeId` inicial permitido antes de disparar cualquier petición. */
export function pickInitialKoreStoreId(
    allowedStores: DtStoreOption[],
    scope: KoreViewerScope,
    defaultExternalId?: string | null
): number {
    if (allowedStores.length === 0) return 0
    if (defaultExternalId) {
        const extLower = defaultExternalId.toLowerCase()
        const byExternal = allowedStores.find(s => s.externalId && s.externalId.toLowerCase() === extLower)
        if (byExternal) return byExternal.id
    }
    if (!scope.isGlobal && scope.primaryTokens.length > 0) {
        const primary = allowedStores.find(s => storeMatchesTokens(s, scope.primaryTokens))
        if (primary) return primary.id
    }
    if (scope.isGlobal && allowedStores.some(s => s.id === 14)) return 14
    return allowedStores[0].id
}

function readBrowserViewerScope(): KoreViewerScope {
    if (typeof window === 'undefined') return { isGlobal: true, tokens: [], primaryTokens: [] }
    try {
        return parseKoreViewerScope(window.localStorage.getItem('teg_user'))
    } catch {
        return { isGlobal: true, tokens: [], primaryTokens: [] }
    }
}

/** Mapa nombre → behavior de las functionDeclarations del setup (BLOCKING / NON_BLOCKING). */
function extractToolBehaviors(setup: Record<string, unknown>): Map<string, string> {
    const map = new Map<string, string>()
    const inner = isPlainObject(setup.setup) ? setup.setup : setup
    const tools = Array.isArray(inner.tools) ? inner.tools : []
    for (const tool of tools) {
        if (!isPlainObject(tool) || !Array.isArray(tool.functionDeclarations)) continue
        for (const decl of tool.functionDeclarations) {
            if (isPlainObject(decl) && typeof decl.name === 'string') {
                map.set(decl.name, typeof decl.behavior === 'string' ? decl.behavior : 'BLOCKING')
            }
        }
    }
    return map
}

// ─────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────

interface KoreDriveThruSimulatorProps {
    /** UUID (external_id) de la tienda preseleccionada en la página, si existe. */
    defaultStoreExternalId?: string | null
}

export default function KoreDriveThruSimulator({ defaultStoreExternalId }: KoreDriveThruSimulatorProps) {
    const { t, language } = useLanguage()

    // ─── Estado de UI (alcance por rol resuelto ANTES del primer efecto) ───
    const [viewerScope, setViewerScope] = useState<KoreViewerScope>(() => readBrowserViewerScope())
    const [rawStores, setRawStores] = useState<DtStoreOption[]>(FALLBACK_DT_STORES)
    const stores = useMemo(() => filterDtStoresForViewer(rawStores, viewerScope), [rawStores, viewerScope])
    const [storeId, setStoreId] = useState<number>(() => {
        const scope = readBrowserViewerScope()
        return pickInitialKoreStoreId(filterDtStoresForViewer(FALLBACK_DT_STORES, scope), scope, defaultStoreExternalId)
    })
    const [lang, setLang] = useState<KoreLang>(language === 'en' ? 'en' : 'es')
    const [phase, setPhase] = useState<SessionPhase>('idle')
    const [micMode, setMicMode] = useState<KoreMicMode>('vad')
    const [pttTalking, setPttTalking] = useState(false)
    const [noiseGateEnabled, setNoiseGateEnabled] = useState(true)
    const [noiseGatedNow, setNoiseGatedNow] = useState(false)
    const [micEnabled, setMicEnabled] = useState(true)
    const [koreSpeaking, setKoreSpeaking] = useState(false)
    const [latencyStats, setLatencyStats] = useState<KoreLatencyStats>(() => computeKoreLatencyStats([]))
    const [bargeInCount, setBargeInCount] = useState(0)
    const [learningRefreshKey, setLearningRefreshKey] = useState(0)
    const [order, setOrder] = useState<KoreOrderState>(() => createKoreOrderState())
    const [sessionStore, setSessionStore] = useState<KoreSessionStore | null>(null)
    const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
    const [interimText, setInterimText] = useState('')
    const [elapsedSec, setElapsedSec] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [savedOk, setSavedOk] = useState(false)
    const [resetKey, setResetKey] = useState(0)
    const [history, setHistory] = useState<KoreHistoryRow[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyError, setHistoryError] = useState<string | null>(null)
    const [fastClipsStats, setFastClipsStats] = useState<KoreFastClipsStats | null>(null)
    const [fastClipsLoading, setFastClipsLoading] = useState(false)
    const [fastClipsWarming, setFastClipsWarming] = useState(false)
    const [fastClipsVersion, setFastClipsVersion] = useState(0)
    const [showFastClipsCatalog, setShowFastClipsCatalog] = useState(false)
    const [fastClipsCategory, setFastClipsCategory] = useState<KoreFastClipCatalogFilter>('all')
    const [previewingClipKey, setPreviewingClipKey] = useState<string | null>(null)

    // ─── Refs de sesión (los handlers del socket SOLO leen refs) ───
    const tRef = useRef(t)
    tRef.current = t
    const mountedRef = useRef(true)
    const genRef = useRef(0)
    const wsRef = useRef<WebSocket | null>(null)
    const ctxRef = useRef<AudioContext | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
    const workletRef = useRef<AudioWorkletNode | null>(null)
    const sinkRef = useRef<GainNode | null>(null)
    const outNodeRef = useRef<GainNode | null>(null)
    const playbackRef = useRef<KorePlaybackQueue | null>(null)
    const noiseGateRef = useRef<KoreNoiseGate>(new KoreNoiseGate({ enabled: true }))
    const noiseGatedRef = useRef(false)
    const micModeRef = useRef<KoreMicMode>('vad')
    const pttTalkingRef = useRef(false)
    const micEnabledRef = useRef(true)
    const liveRef = useRef(false)
    const endingRef = useRef(false)
    const latencySamplesRef = useRef<number[]>([])
    const bargeInCountRef = useRef(0)
    const initialGreetingPendingRef = useRef(true)
    const lastCustomerVoiceMsRef = useRef<number | null>(null)
    const koreTurnFirstAudioRecordedRef = useRef(false)
    const koreTurnInterruptedRef = useRef(false)
    const orderRef = useRef<KoreOrderState>(order)
    const menuRef = useRef<KoreMenuItem[]>([])
    const sessionRef = useRef<KoreSessionResponse | null>(null)
    const sessionMetaRef = useRef<{ storeId: number; lang: KoreLang }>({ storeId: 14, lang: 'es' })
    const toolBehaviorRef = useRef<Map<string, string>>(new Map())
    const toolHistoryRef = useRef<{ id: string; name: string; before: KoreOrderState }[]>([])
    const toolQueueRef = useRef<Promise<void>>(Promise.resolve())
    const cancelledToolIdsRef = useRef<Set<string>>(new Set())
    const inFlightToolAbortsRef = useRef<Map<string, AbortController>>(new Map())
    const autoEndModeRef = useRef<KoreAutoEndMode>('none')
    const autoEndTimerRef = useRef<number | null>(null)
    const currentKoreTurnTextRef = useRef('')
    const currentCustomerTurnTextRef = useRef('')
    const langCueTimerRef = useRef<number | null>(null)
    const fastClipsMapRef = useRef<Map<string, KoreDecodedFastClipPair>>(new Map())
    const fastClipsStoreIdRef = useRef<number>(0)
    const fastClipsReqRef = useRef(0)
    const suppressGeminiTurnAudioRef = useRef(false)
    const localFastClipStartedAtRef = useRef(0)
    const customerSpokeSinceFastClipRef = useRef(false)
    const fastClipSeedRef = useRef(0)
    const previewCtxRef = useRef<AudioContext | null>(null)
    const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)
    const postSaveLearnTimerRef = useRef<number | null>(null)
    const transcriptRef = useRef<TranscriptEntry[]>([])
    const openEntryRef = useRef<{ customer: string | null; kore: string | null }>({ customer: null, kore: null })
    const startedAtRef = useRef<number | null>(null)
    const timersRef = useRef<{ setup: number | null; cap: number | null; tick: number | null }>({ setup: null, cap: null, tick: null })
    const meterRef = useRef<HTMLDivElement | null>(null)
    const meterLevelRef = useRef(0)
    const transcriptBoxRef = useRef<HTMLDivElement | null>(null)

    const isBusy = phase === 'requesting' || phase === 'connecting' || phase === 'live' || phase === 'ending'

    // Sincroniza teg_user al montar por si cambió entre login y navegación cliente
    useEffect(() => {
        const fresh = readBrowserViewerScope()
        setViewerScope(prev => {
            if (prev.isGlobal === fresh.isGlobal && prev.tokens.join('|') === fresh.tokens.join('|')) return prev
            return fresh
        })
    }, [])

    // ─────────────────────────────────────────────
    // Tiendas con Drive-Thru
    // ─────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        fetch('/api/stores')
            .then(res => (res.ok ? res.json() : null))
            .then((data: unknown) => {
                if (cancelled || !Array.isArray(data)) return
                const list: DtStoreOption[] = data
                    .filter((s): s is Record<string, unknown> => isPlainObject(s) && s.has_drive_thru === true)
                    .map(s => ({
                        id: Number(s.id),
                        name: String(s.name ?? ''),
                        externalId: typeof s.external_id === 'string' ? s.external_id : null,
                        code: typeof s.code === 'string' ? s.code : null,
                    }))
                    .filter(s => Number.isInteger(s.id) && s.id > 0)
                    .sort((a, b) => a.id - b.id)
                if (list.length > 0) setRawStores(list)
            })
            .catch(err => console.error('[Kore DT] Error cargando tiendas:', err))
        return () => { cancelled = true }
    }, [])

    // Idioma de arranque sigue al idioma de la UI hasta que el gerente lo elija a mano
    const langTouchedRef = useRef(false)
    useEffect(() => {
        if (!langTouchedRef.current && !isBusy) setLang(language === 'en' ? 'en' : 'es')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language])

    // Ajusta storeId únicamente dentro de las tiendas Drive-Thru autorizadas del usuario
    useEffect(() => {
        if (isBusy) return
        if (stores.length === 0) {
            if (storeId !== 0) setStoreId(0)
            return
        }
        const byExternal = defaultStoreExternalId
            ? stores.find(s => s.externalId && s.externalId.toLowerCase() === defaultStoreExternalId.toLowerCase())
            : undefined
        if (byExternal) {
            if (storeId !== byExternal.id) setStoreId(byExternal.id)
        } else if (!stores.some(s => s.id === storeId)) {
            setStoreId(pickInitialKoreStoreId(stores, viewerScope, defaultStoreExternalId))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stores, viewerScope, defaultStoreExternalId])

    const selectedStore = stores.find(s => s.id === storeId) || null
    const hasDtAccess = stores.length > 0

    // ─────────────────────────────────────────────
    // Historial (SOLO para tiendas autorizadas con Drive-Thru; nunca 403/422)
    // ─────────────────────────────────────────────
    const historyReqRef = useRef(0)
    const loadHistory = useCallback(async (forStoreId: number) => {
        if (!Number.isInteger(forStoreId) || forStoreId <= 0) return
        const reqId = ++historyReqRef.current
        setHistoryLoading(true)
        setHistoryError(null)
        try {
            const res = await fetch(`/api/drive-thru/kore/sessions?storeId=${forStoreId}&limit=10`, { headers: getAuthHeaders() })
            const data: unknown = await res.json().catch(() => null)
            if (reqId !== historyReqRef.current || !mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            const rows = isPlainObject(data) && Array.isArray(data.sessions) ? data.sessions : Array.isArray(data) ? data : []
            setHistory(rows.filter(isPlainObject) as unknown as KoreHistoryRow[])
        } catch (e) {
            if (reqId !== historyReqRef.current || !mountedRef.current) return
            setHistoryError(e instanceof Error ? e.message : String(e))
            setHistory([])
        } finally {
            if (reqId === historyReqRef.current && mountedRef.current) setHistoryLoading(false)
        }
    }, [])

    const stopFastClipPreview = useCallback((closeCtx = false) => {
        const src = previewSourceRef.current
        previewSourceRef.current = null
        if (src) {
            src.onended = null
            try { src.stop() } catch { /* ya detenida */ }
            try { src.disconnect() } catch { /* ya desconectada */ }
        }
        setPreviewingClipKey(null)
        if (closeCtx) {
            const pctx = previewCtxRef.current
            previewCtxRef.current = null
            if (pctx && pctx.state !== 'closed') {
                pctx.close().catch(() => undefined)
            }
        }
    }, [])

    const playFastClipPreview = async (clipId: string, clipLang: KoreLang) => {
        if (isBusy) return
        const key = `${clipId}:${clipLang}`
        if (previewingClipKey === key) {
            stopFastClipPreview(false)
            return
        }
        stopFastClipPreview(false)
        const variant = fastClipsMapRef.current.get(clipId)?.[clipLang]
        if (!variant || variant.samples.length === 0) return
        try {
            let pctx = previewCtxRef.current
            if (!pctx || pctx.state === 'closed') {
                const Ctor: typeof AudioContext | undefined =
                    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
                if (!Ctor) return
                pctx = new Ctor({ latencyHint: 'interactive' })
                previewCtxRef.current = pctx
            }
            if (pctx.state === 'suspended') {
                await pctx.resume().catch(() => undefined)
            }
            const buffer = pctx.createBuffer(1, variant.samples.length, variant.sampleRate)
            buffer.copyToChannel(variant.samples as Float32Array<ArrayBuffer>, 0)
            const src = pctx.createBufferSource()
            src.buffer = buffer
            src.connect(pctx.destination)
            previewSourceRef.current = src
            setPreviewingClipKey(key)
            src.onended = () => {
                try { src.disconnect() } catch { /* noop */ }
                if (previewSourceRef.current === src) {
                    previewSourceRef.current = null
                    setPreviewingClipKey(null)
                }
            }
            src.start(0)
        } catch {
            stopFastClipPreview(false)
        }
    }

    const loadFastClips = useCallback(async (forStoreId: number) => {
        if (!Number.isInteger(forStoreId) || forStoreId <= 0) return
        const reqId = ++fastClipsReqRef.current
        setFastClipsLoading(true)
        try {
            const res = await fetch(`/api/drive-thru/kore/fast-clips?storeId=${forStoreId}`, { headers: getAuthHeaders() })
            const data: unknown = await res.json().catch(() => null)
            if (reqId !== fastClipsReqRef.current || !mountedRef.current) return
            if (!res.ok || !isPlainObject(data)) return
            const decoded = decodeKoreFastClipsPayload(data)
            fastClipsMapRef.current = decoded.map
            fastClipsStoreIdRef.current = forStoreId
            setFastClipsStats(decoded.stats)
            setFastClipsVersion(v => v + 1)
        } catch {
            // Degradación silenciosa: si el banco pregrabado no responde, Gemini Live habla directo
        } finally {
            if (reqId === fastClipsReqRef.current && mountedRef.current) setFastClipsLoading(false)
        }
    }, [])

    const handleWarmFastClips = async () => {
        if (!selectedStore || fastClipsWarming) return
        const targetStoreId = selectedStore.id
        setFastClipsWarming(true)
        try {
            const res = await fetch('/api/drive-thru/kore/fast-clips', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ storeId: targetStoreId }),
            })
            await res.json().catch(() => null)
            if (mountedRef.current) await loadFastClips(targetStoreId)
        } catch {
            // noop
        } finally {
            if (mountedRef.current) setFastClipsWarming(false)
        }
    }

    useEffect(() => {
        if (isBusy) return
        stopFastClipPreview(false)
        if (!selectedStore) {
            historyReqRef.current += 1
            fastClipsReqRef.current += 1
            fastClipsMapRef.current = new Map()
            fastClipsStoreIdRef.current = 0
            setFastClipsStats(null)
            setFastClipsVersion(v => v + 1)
            setFastClipsLoading(false)
            setHistory([])
            setHistoryError(null)
            setHistoryLoading(false)
            return
        }
        void loadHistory(selectedStore.id)
        void loadFastClips(selectedStore.id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStore?.id, loadHistory, loadFastClips])

    // ─────────────────────────────────────────────
    // Transcripción
    // ─────────────────────────────────────────────
    const publishTranscript = () => setTranscript(transcriptRef.current.slice())

    const pushEntry = (entry: Omit<TranscriptEntry, 'id' | 'at'>) => {
        transcriptRef.current = [...transcriptRef.current, { ...entry, id: newEntryId(), at: new Date().toISOString() }]
        publishTranscript()
    }

    const pushSystem = (text: string, kind: TranscriptEntry['kind'] = 'event', toolName?: string) => {
        pushEntry({ role: 'system', text, final: true, kind, toolName })
    }

    /** Agrega un fragmento (delta) a la entrada abierta del rol, o abre una nueva. */
    const appendSpeech = (role: 'customer' | 'kore', delta: string) => {
        if (!delta) return
        const openId = openEntryRef.current[role]
        const list = transcriptRef.current
        const idx = openId ? list.findIndex(e => e.id === openId) : -1
        if (idx >= 0) {
            const updated = { ...list[idx], text: list[idx].text + delta }
            transcriptRef.current = [...list.slice(0, idx), updated, ...list.slice(idx + 1)]
        } else {
            const id = newEntryId()
            transcriptRef.current = [...list, { id, role, text: delta, at: new Date().toISOString(), final: false }]
            openEntryRef.current[role] = id
        }
        publishTranscript()
    }

    const finalizeSpeech = (role: 'customer' | 'kore') => {
        const openId = openEntryRef.current[role]
        if (!openId) return
        openEntryRef.current[role] = null
        transcriptRef.current = transcriptRef.current.map(e => (e.id === openId ? { ...e, final: true } : e))
        publishTranscript()
    }

    // Auto-scroll de la conversación
    useEffect(() => {
        const box = transcriptBoxRef.current
        if (box) box.scrollTop = box.scrollHeight
    }, [transcript, interimText])

    // ─────────────────────────────────────────────
    // Envío por WebSocket
    // ─────────────────────────────────────────────
    const sendJson = (payload: unknown): boolean => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return false
        try {
            ws.send(JSON.stringify(payload))
            return true
        } catch (e) {
            console.error('[Kore DT] Error enviando por WebSocket:', e)
            return false
        }
    }

    const clearAutoEnd = (resetMode = true) => {
        if (autoEndTimerRef.current !== null) {
            window.clearTimeout(autoEndTimerRef.current)
            autoEndTimerRef.current = null
        }
        if (resetMode) {
            autoEndModeRef.current = 'none'
        }
    }

    const handleMicChunk = (data: MicChunkMessage) => {
        if (!data || !(data.pcm instanceof ArrayBuffer)) return
        const canTransmit = micModeRef.current === 'ptt' ? pttTalkingRef.current : micEnabledRef.current
        if (!canTransmit) {
            const decayed = meterLevelRef.current * 0.78
            meterLevelRef.current = decayed < 0.01 ? 0 : decayed
            if (meterRef.current) meterRef.current.style.width = `${Math.round(meterLevelRef.current * 100)}%`
            if (noiseGatedRef.current) {
                noiseGatedRef.current = false
                setNoiseGatedNow(false)
            }
            return
        }

        const echoSuppressed = shouldSuppressLocalFastClipSpeakerEcho({
            playbackActive: Boolean(playbackRef.current?.isActive),
            localFastClipStartedAt: localFastClipStartedAtRef.current,
            micMode: micModeRef.current,
            rms: data.rms,
        })
        if (echoSuppressed) {
            noiseGateRef.current.reset()
            const decayedEcho = meterLevelRef.current * 0.8
            meterLevelRef.current = decayedEcho < 0.01 ? 0 : decayedEcho
            if (meterRef.current) meterRef.current.style.width = `${Math.round(meterLevelRef.current * 100)}%`
            if (!noiseGatedRef.current && Number.isFinite(data.rms) && data.rms >= 0.004) {
                noiseGatedRef.current = true
                setNoiseGatedNow(true)
            }
            if (!liveRef.current) return
            const wsSilent = wsRef.current
            if (!wsSilent || wsSilent.readyState !== WebSocket.OPEN || wsSilent.bufferedAmount > WS_BACKPRESSURE_BYTES) return
            sendJson({
                realtimeInput: {
                    audio: {
                        data: bytesToBase64(new Uint8Array(data.pcm.byteLength)),
                        mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}`,
                    },
                },
            })
            return
        }

        const gate = noiseGateRef.current.process(data.pcm, data.rms)
        const raw = Math.min(1, gate.effectiveRms * 5)
        const level = Math.max(raw, meterLevelRef.current * 0.82)
        meterLevelRef.current = level
        if (meterRef.current) meterRef.current.style.width = `${Math.round(level * 100)}%`

        const activelyFilteringNoise = gate.gated && Number.isFinite(data.rms) && data.rms >= 0.004
        if (activelyFilteringNoise !== noiseGatedRef.current) {
            noiseGatedRef.current = activelyFilteringNoise
            setNoiseGatedNow(activelyFilteringNoise)
        }

        if (!liveRef.current) return
        const minSpeechRms =
            playbackRef.current?.isActive && localFastClipStartedAtRef.current > 0 && micModeRef.current === 'vad'
                ? KORE_LOCAL_CLIP_ECHO_RMS_FLOOR
                : 0.025
        if (gate.speechActive && (!playbackRef.current?.isActive || micModeRef.current === 'ptt' || data.rms >= minSpeechRms)) {
            initialGreetingPendingRef.current = false
            lastCustomerVoiceMsRef.current = performance.now()
            koreTurnFirstAudioRecordedRef.current = false
            if (
                localFastClipStartedAtRef.current > 0 &&
                performance.now() - localFastClipStartedAtRef.current > 350 &&
                ((micModeRef.current === 'ptt' && pttTalkingRef.current) || data.rms >= KORE_LOCAL_CLIP_ECHO_RMS_FLOOR)
            ) {
                customerSpokeSinceFastClipRef.current = true
            }
            // Si ya terminó de sonar Kore y el cliente habla durante el colchón de cierre, cancela el cierre al instante
            if (autoEndTimerRef.current !== null && (!playbackRef.current?.isActive || micModeRef.current === 'ptt')) {
                if (micModeRef.current === 'ptt' || data.rms >= 0.035) {
                    clearAutoEnd(true)
                }
            }
        }

        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        if (ws.bufferedAmount > WS_BACKPRESSURE_BYTES) return
        for (const chunkBuf of gate.chunksToSend) {
            sendJson({
                realtimeInput: {
                    audio: { data: bytesToBase64(new Uint8Array(chunkBuf)), mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}` },
                },
            })
        }
    }

    // ─────────────────────────────────────────────
    // Limpieza de recursos (idempotente)
    // ─────────────────────────────────────────────
    const clearTimers = () => {
        const timers = timersRef.current
        if (timers.setup !== null) window.clearTimeout(timers.setup)
        if (timers.cap !== null) window.clearTimeout(timers.cap)
        if (timers.tick !== null) window.clearInterval(timers.tick)
        timersRef.current = { setup: null, cap: null, tick: null }
    }

    const abortInFlightTools = () => {
        inFlightToolAbortsRef.current.forEach(ctrl => {
            try { ctrl.abort() } catch { /* noop */ }
        })
        inFlightToolAbortsRef.current.clear()
    }

    const clearLangCueTimer = () => {
        if (langCueTimerRef.current !== null) {
            window.clearTimeout(langCueTimerRef.current)
            langCueTimerRef.current = null
        }
    }

    const teardownMedia = () => {
        liveRef.current = false
        suppressGeminiTurnAudioRef.current = false
        localFastClipStartedAtRef.current = 0
        customerSpokeSinceFastClipRef.current = false
        clearAutoEnd(true)
        clearLangCueTimer()
        abortInFlightTools()
        clearTimers()
        const ws = wsRef.current
        wsRef.current = null
        if (ws) {
            ws.onopen = null
            ws.onmessage = null
            ws.onerror = null
            ws.onclose = null
            try {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, 'client_end')
            } catch { /* ya cerrado */ }
        }
        playbackRef.current?.clear()
        playbackRef.current = null
        if (workletRef.current) {
            workletRef.current.port.onmessage = null
            try { workletRef.current.disconnect() } catch { /* noop */ }
            workletRef.current = null
        }
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.disconnect() } catch { /* noop */ }
            sourceNodeRef.current = null
        }
        if (sinkRef.current) {
            try { sinkRef.current.disconnect() } catch { /* noop */ }
            sinkRef.current = null
        }
        if (outNodeRef.current) {
            try { outNodeRef.current.disconnect() } catch { /* noop */ }
            outNodeRef.current = null
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        const ctx = ctxRef.current
        ctxRef.current = null
        if (ctx && ctx.state !== 'closed') ctx.close().catch(() => undefined)
        meterLevelRef.current = 0
        if (meterRef.current) meterRef.current.style.width = '0%'
        pttTalkingRef.current = false
        noiseGatedRef.current = false
        noiseGateRef.current.reset()
        setPttTalking(false)
        setNoiseGatedNow(false)
        setKoreSpeaking(false)
    }

    // ─────────────────────────────────────────────
    // Guardado de la simulación
    // ─────────────────────────────────────────────
    const buildSavePayload = () => {
        const session = sessionRef.current
        const started = startedAtRef.current
        if (!session || started === null) return null
        const ended = Date.now()
        const finalOrder = orderRef.current
        const sessionKind: KoreSessionKind = finalOrder.sessionKind === 'driver_pickup' ? 'driver_pickup' : 'customer_order'
        const hasConfirmableContent =
            finalOrder.lines.length > 0 ||
            (sessionKind === 'driver_pickup' && (finalOrder.driverPickup?.orders?.length ?? 0) > 0)
        const outcome: KoreOutcome =
            finalOrder.status === 'confirmed' && hasConfirmableContent
                ? 'confirmed'
                : finalOrder.status === 'cancelled'
                    ? 'cancelled'
                    : 'abandoned'
        const stats = computeKoreLatencyStats(latencySamplesRef.current)
        return {
            storeId: sessionMetaRef.current.storeId,
            lang: sessionMetaRef.current.lang,
            startedAt: new Date(started).toISOString(),
            endedAt: new Date(ended).toISOString(),
            outcome,
            sessionKind,
            bargeInCount: bargeInCountRef.current,
            ...(stats.avgLatencyMs !== null ? { avgLatencyMs: stats.avgLatencyMs } : {}),
            ...(stats.p95LatencyMs !== null ? { p95LatencyMs: stats.p95LatencyMs } : {}),
            // Contrato del backend: role customer|kore|system|tool (máx 400 turnos / 2000 chars)
            transcript: transcriptRef.current
                .map(e => ({
                    role: e.role === 'system' && (e.kind === 'tool' || e.kind === 'tool_error') ? 'tool' : e.role,
                    text: e.text.trim().slice(0, 2000),
                    at: e.at,
                }))
                .filter(e => e.text.length > 0)
                .slice(-400),
            order: finalOrder,
            taxRatePct: session.store.taxRatePct,
        }
    }

    const saveSession = async (): Promise<void> => {
        const payload = buildSavePayload()
        startedAtRef.current = null
        if (!payload) return
        try {
            const res = await fetch('/api/drive-thru/kore/sessions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload),
            })
            if (!res.ok) {
                const data: unknown = await res.json().catch(() => null)
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            setSavedOk(true)
            setLearningRefreshKey(k => k + 1)
            if (postSaveLearnTimerRef.current !== null) {
                window.clearTimeout(postSaveLearnTimerRef.current)
            }
            postSaveLearnTimerRef.current = window.setTimeout(() => {
                postSaveLearnTimerRef.current = null
                if (mountedRef.current) setLearningRefreshKey(k => k + 1)
            }, KORE_POST_SAVE_LEARNING_REFRESH_MS)
        } catch (e) {
            setError(tRef.current('drive_thru.kore_err_save', { message: e instanceof Error ? e.message : String(e) }))
        }
    }

    // ─────────────────────────────────────────────
    // Fin de sesión (único punto de salida)
    // ─────────────────────────────────────────────
    const finishSession = async (errorMessage?: string) => {
        if (endingRef.current) return
        endingRef.current = true
        clearAutoEnd(true)
        genRef.current += 1 // invalida flujos asíncronos de start()
        const wasLive = startedAtRef.current !== null
        setPhase('ending')
        finalizeSpeech('customer')
        finalizeSpeech('kore')
        setInterimText('')
        teardownMedia()
        if (errorMessage) setError(errorMessage)
        if (wasLive) await saveSession()
        if (!mountedRef.current) {
            endingRef.current = false
            return
        }
        setPhase(errorMessage ? 'error' : wasLive ? 'ended' : 'idle')
        endingRef.current = false
        if (sessionMetaRef.current.storeId > 0) void loadHistory(sessionMetaRef.current.storeId)
    }

    /**
     * Espera a que termine al 100% el audio agendado de Kore (`!isActive && remainingMs === 0`) y luego
     * aplica el colchón natural (`650 ms` en `explicit_tool` o `3200 ms` en `confirmed_sendoff`) antes
     * de cerrar la sesión del auto, sin cortar jamás su voz a media frase.
     */
    const scheduleAutoEndAfterAudioDrain = (cushionMs: number, gen: number) => {
        clearAutoEnd(false)
        const waitDrain = () => {
            autoEndTimerRef.current = null
            if (gen !== genRef.current || !liveRef.current || endingRef.current || autoEndModeRef.current === 'none') return
            const pb = playbackRef.current
            const active = Boolean(pb?.isActive)
            const rem = pb?.remainingMs ?? 0
            if (active || rem > 0) {
                const pollMs = Math.min(200, Math.max(50, rem > 0 ? Math.min(rem + 25, 200) : 60))
                autoEndTimerRef.current = window.setTimeout(waitDrain, pollMs)
                return
            }
            autoEndTimerRef.current = window.setTimeout(() => {
                autoEndTimerRef.current = null
                if (gen !== genRef.current || !liveRef.current || endingRef.current || autoEndModeRef.current === 'none') return
                const pbAfter = playbackRef.current
                if (pbAfter?.isActive || (pbAfter?.remainingMs ?? 0) > 0) {
                    waitDrain()
                    return
                }
                autoEndModeRef.current = 'none'
                const autoEndText = tRef.current('drive_thru.kore_auto_ended_notice')
                setNotice(autoEndText)
                pushSystem(autoEndText)
                void finishSession()
            }, cushionMs)
        }
        waitDrain()
    }

    // ─────────────────────────────────────────────
    // Mensajes del servidor
    // ─────────────────────────────────────────────
    const onSetupComplete = () => {
        if (liveRef.current) return
        const timers = timersRef.current
        if (timers.setup !== null) {
            window.clearTimeout(timers.setup)
            timers.setup = null
        }
        liveRef.current = true
        initialGreetingPendingRef.current = true
        lastCustomerVoiceMsRef.current = null
        koreTurnFirstAudioRecordedRef.current = false
        koreTurnInterruptedRef.current = false
        currentKoreTurnTextRef.current = ''
        startedAtRef.current = Date.now()
        setElapsedSec(0)
        setPhase('live')
        timers.tick = window.setInterval(() => {
            const started = startedAtRef.current
            if (started !== null) setElapsedSec(Math.floor((Date.now() - started) / 1000))
        }, 1000)
        timers.cap = window.setTimeout(() => {
            setNotice(tRef.current('drive_thru.kore_warn_cap', { minutes: Math.round(KORE_SESSION_CAP_SEC / 60) }))
            void finishSession()
        }, KORE_SESSION_CAP_SEC * 1000)
        pushSystem(tRef.current('drive_thru.kore_car_arrived'))
        const activeLang = sessionMetaRef.current.lang
        const greetClip = decodeKoreFastClipVariant(sessionRef.current?.initialGreetingClips?.[activeLang])
        if (greetClip) {
            initialGreetingPendingRef.current = false
            localFastClipStartedAtRef.current = performance.now()
            customerSpokeSinceFastClipRef.current = false
            playbackRef.current?.enqueue(greetClip.samples, greetClip.sampleRate)
            appendSpeech('kore', greetClip.text)
            finalizeSpeech('kore')
            sendJson({
                clientContent: {
                    turns: [
                        { role: 'user', parts: [{ text: KORE_SEEDED_GREETING_CUE[activeLang] }] },
                        { role: 'model', parts: [{ text: greetClip.text }] },
                    ],
                    turnComplete: false,
                },
            })
        } else {
            sendJson({ realtimeInput: { text: ARRIVAL_CUE[activeLang] } })
        }
    }

    /**
     * Envía en silencio la directiva `[SYSTEM LANGUAGE SWITCH -> ...]` únicamente cuando Kore NO está
     * reproduciendo audio (`!playbackRef.current?.isActive && remainingMs === 0`), jamás a mitad de voz.
     */
    const scheduleSilentLangCueWhenIdle = (targetLang: KoreLang, gen: number) => {
        clearLangCueTimer()
        const waitIdle = () => {
            langCueTimerRef.current = null
            if (gen !== genRef.current || !liveRef.current || endingRef.current || autoEndModeRef.current !== 'none') return
            if (sessionMetaRef.current.lang !== targetLang) return
            const pb = playbackRef.current
            if (pb?.isActive || (pb?.remainingMs ?? 0) > 0) {
                langCueTimerRef.current = window.setTimeout(waitIdle, 90)
                return
            }
            sendJson({ realtimeInput: { text: KORE_SYSTEM_LANG_SWITCH_CUE[targetLang] } })
        }
        waitIdle()
    }

    const applyLiveLanguageSwitch = (nextLang: KoreLang, opts?: { sendCueWhenIdle?: boolean; gen?: number }) => {
        const changed = sessionMetaRef.current.lang !== nextLang
        sessionMetaRef.current = { ...sessionMetaRef.current, lang: nextLang }
        setLang(nextLang)
        setSessionStore(prev => {
            if (!prev) return null
            const nextCustomerName =
                nextLang === 'en'
                    ? (prev.customerNameEn || formatCustomerStoreName(prev.id, 'en', { style: 'display' }))
                    : (prev.customerNameEs || formatCustomerStoreName(prev.id, 'es', { style: 'display' }))
            return { ...prev, customerName: nextCustomerName }
        })
        if (changed && liveRef.current) {
            pushSystem(tRef.current(nextLang === 'en' ? 'drive_thru.kore_lang_switched_en' : 'drive_thru.kore_lang_switched_es'))
        }
        if (opts?.sendCueWhenIdle && liveRef.current) {
            scheduleSilentLangCueWhenIdle(nextLang, opts.gen ?? genRef.current)
        }
    }

    const handleManualLanguageSelect = (code: KoreLang) => {
        langTouchedRef.current = true
        if (liveRef.current) {
            currentCustomerTurnTextRef.current = ''
            applyLiveLanguageSwitch(code, { sendCueWhenIdle: true, gen: genRef.current })
        } else {
            setLang(code)
        }
    }

    const handleServerContent = (sc: Record<string, unknown>, gen: number) => {
        if (sc.interrupted === true) {
            suppressGeminiTurnAudioRef.current = false
            const localClipActive = localFastClipStartedAtRef.current > 0 && Boolean(playbackRef.current?.isActive)
            const shouldClearPlayback = !localClipActive || customerSpokeSinceFastClipRef.current
            clearLangCueTimer()
            currentKoreTurnTextRef.current = ''
            koreTurnFirstAudioRecordedRef.current = false
            if (shouldClearPlayback) {
                clearAutoEnd(true)
                localFastClipStartedAtRef.current = 0
                customerSpokeSinceFastClipRef.current = false
                playbackRef.current?.clear()
                finalizeSpeech('kore')
                if (!koreTurnInterruptedRef.current) {
                    koreTurnInterruptedRef.current = true
                    bargeInCountRef.current += 1
                    setBargeInCount(bargeInCountRef.current)
                }
            }
        }
        const modelTurn = isPlainObject(sc.modelTurn) ? sc.modelTurn : null
        if (!suppressGeminiTurnAudioRef.current && modelTurn && Array.isArray(modelTurn.parts)) {
            // Procesar TODAS las parts de cada mensaje
            for (const part of modelTurn.parts) {
                if (!isPlainObject(part) || !isPlainObject(part.inlineData)) continue
                const inline = part.inlineData
                const mime = typeof inline.mimeType === 'string' ? inline.mimeType : ''
                if (typeof inline.data !== 'string' || (mime && !mime.toLowerCase().startsWith('audio/pcm'))) continue
                const samples = decodePcm16ToFloat32(base64ToBytes(inline.data))
                if (samples.length > 0 && !koreTurnFirstAudioRecordedRef.current) {
                    koreTurnFirstAudioRecordedRef.current = true
                    koreTurnInterruptedRef.current = false
                    if (!initialGreetingPendingRef.current && lastCustomerVoiceMsRef.current !== null) {
                        const deltaMs = Math.round(performance.now() - lastCustomerVoiceMsRef.current)
                        lastCustomerVoiceMsRef.current = null
                        if (deltaMs >= 30 && deltaMs <= 15000) {
                            latencySamplesRef.current = [...latencySamplesRef.current, deltaMs]
                            setLatencyStats(computeKoreLatencyStats(latencySamplesRef.current))
                        }
                    }
                }
                playbackRef.current?.enqueue(samples, parsePcmRate(mime))
            }
        }
        if (isPlainObject(sc.inputTranscription) && typeof sc.inputTranscription.text === 'string') {
            if (sc.inputTranscription.text.trim()) {
                initialGreetingPendingRef.current = false
                if (autoEndModeRef.current !== 'none') clearAutoEnd(true)
                if (localFastClipStartedAtRef.current > 0 && performance.now() - localFastClipStartedAtRef.current > 280) {
                    customerSpokeSinceFastClipRef.current = true
                    if (playbackRef.current?.isActive) {
                        playbackRef.current.clear()
                        localFastClipStartedAtRef.current = 0
                    }
                }
            }
            currentCustomerTurnTextRef.current += sc.inputTranscription.text
            const detected = resolveNextKoreSessionLang(currentCustomerTurnTextRef.current, sessionMetaRef.current.lang)
            if (detected !== sessionMetaRef.current.lang) {
                applyLiveLanguageSwitch(detected, { gen })
            }
            appendSpeech('customer', sc.inputTranscription.text)
            setInterimText('')
        }
        if (isPlainObject(sc.interimInputTranscription) && typeof sc.interimInputTranscription.text === 'string') {
            if (sc.interimInputTranscription.text.trim()) {
                initialGreetingPendingRef.current = false
                if (autoEndModeRef.current !== 'none') clearAutoEnd(true)
                if (localFastClipStartedAtRef.current > 0 && performance.now() - localFastClipStartedAtRef.current > 280) {
                    customerSpokeSinceFastClipRef.current = true
                    if (playbackRef.current?.isActive) {
                        playbackRef.current.clear()
                        localFastClipStartedAtRef.current = 0
                    }
                }
            }
            const combinedPreview = `${currentCustomerTurnTextRef.current} ${sc.interimInputTranscription.text}`.trim()
            if (combinedPreview) {
                const detected = resolveNextKoreSessionLang(combinedPreview, sessionMetaRef.current.lang)
                if (detected !== sessionMetaRef.current.lang) {
                    applyLiveLanguageSwitch(detected, { gen })
                }
            }
            setInterimText(sc.interimInputTranscription.text)
        }
        if (isPlainObject(sc.outputTranscription) && typeof sc.outputTranscription.text === 'string') {
            if (!suppressGeminiTurnAudioRef.current) {
                if (autoEndTimerRef.current !== null) clearAutoEnd(false)
                currentCustomerTurnTextRef.current = ''
                currentKoreTurnTextRef.current += sc.outputTranscription.text
                finalizeSpeech('customer')
                appendSpeech('kore', sc.outputTranscription.text)
            } else {
                currentCustomerTurnTextRef.current = ''
                finalizeSpeech('customer')
            }
        }
        if (sc.turnComplete === true) {
            const wasSuppressedTurn = suppressGeminiTurnAudioRef.current
            suppressGeminiTurnAudioRef.current = false
            initialGreetingPendingRef.current = false
            koreTurnFirstAudioRecordedRef.current = false
            koreTurnInterruptedRef.current = false
            currentCustomerTurnTextRef.current = ''
            finalizeSpeech('customer')
            finalizeSpeech('kore')
            setInterimText('')
            const spokenKoreTurn = currentKoreTurnTextRef.current.trim()
            currentKoreTurnTextRef.current = ''
            if (wasSuppressedTurn) return
            const cushionMs = evaluateKoreTurnCompleteAutoEnd({
                currentMode: autoEndModeRef.current,
                orderStatus: orderRef.current.status,
                lastKoreText: spokenKoreTurn,
            })
            if (cushionMs !== null) {
                if (autoEndModeRef.current === 'none') {
                    autoEndModeRef.current = 'confirmed_sendoff'
                }
                scheduleAutoEndAfterAudioDrain(cushionMs, gen)
            } else {
                if (autoEndModeRef.current === 'confirmed_sendoff' && spokenKoreTurn.length > 0) {
                    clearAutoEnd(true)
                }
                // Red de seguridad bidireccional sin cortar audio: re-bloquea ES o EN si Gemini se desvió de idioma
                if (autoEndModeRef.current === 'none' && spokenKoreTurn.length > 0) {
                    if (
                        sessionMetaRef.current.lang === 'es' &&
                        detectKoreSpokenLanguage(spokenKoreTurn, 'es') === 'en'
                    ) {
                        scheduleSilentLangCueWhenIdle('es', gen)
                    } else if (
                        sessionMetaRef.current.lang === 'en' &&
                        detectKoreSpokenLanguage(spokenKoreTurn, 'en') === 'es'
                    ) {
                        scheduleSilentLangCueWhenIdle('en', gen)
                    }
                }
            }
        }
    }

    const describeTool = (name: string, args: Record<string, unknown>): string => {
        const known = [
            'add_item', 'add_items', 'update_item', 'remove_item',
            'get_order', 'search_menu', 'register_driver_pickup', 'confirm_order', 'cancel_order', 'end_session',
        ]
        const label = known.includes(name)
            ? tRef.current(`drive_thru.kore_tool_${name}`)
            : tRef.current('drive_thru.kore_tool_unknown', { name })
        const detailParts: string[] = []
        if (typeof args.line_id === 'string' && args.line_id.trim()) detailParts.push(`[${args.line_id.trim()}]`)
        if (typeof args.quantity === 'number' && Number.isFinite(args.quantity)) detailParts.push(`${args.quantity}×`)
        if (typeof args.item_name === 'string' && args.item_name.trim()) detailParts.push(args.item_name.trim())
        if (Array.isArray(args.items) && args.items.length > 0) {
            const batch = args.items
                .filter(isPlainObject)
                .map(it => {
                    const q = typeof it.quantity === 'number' && Number.isFinite(it.quantity) ? `${it.quantity}× ` : ''
                    return `${q}${typeof it.item_name === 'string' ? it.item_name.trim() : ''}`.trim()
                })
                .filter(Boolean)
            if (batch.length > 0) detailParts.push(batch.join(', '))
        }
        if (typeof args.platform === 'string' && args.platform.trim()) {
            detailParts.push(args.platform.trim())
        }
        if (Array.isArray(args.orders) && args.orders.length > 0) {
            const pickups = args.orders
                .filter(isPlainObject)
                .map(o => {
                    const cname = typeof o.customer_name === 'string' ? o.customer_name.trim() : ''
                    const code = typeof o.order_code === 'string' && o.order_code.trim() ? ` #${o.order_code.trim()}` : ''
                    return `${cname}${code}`.trim()
                })
                .filter(Boolean)
            if (pickups.length > 0) detailParts.push(`${pickups.length}× (${pickups.join(', ')})`)
        }
        if (typeof args.query === 'string' && args.query.trim()) detailParts.push(`“${args.query.trim()}”`)
        if (Array.isArray(args.modifiers) && args.modifiers.length > 0) {
            detailParts.push(`(${args.modifiers.filter(m => typeof m === 'string').join(', ')})`)
        }
        if (typeof args.reason === 'string' && args.reason.trim()) {
            detailParts.push(`(${args.reason.trim()})`)
        }
        return detailParts.length > 0 ? `${label}: ${detailParts.join(' ')}` : label
    }

    const handleToolCall = async (toolCall: Record<string, unknown>, gen: number): Promise<void> => {
        if (gen !== genRef.current || !liveRef.current) return
        suppressGeminiTurnAudioRef.current = false
        finalizeSpeech('customer')
        finalizeSpeech('kore')
        const calls = Array.isArray(toolCall.functionCalls) ? toolCall.functionCalls : []
        const functionResponses: { id?: string; name: string; response: Record<string, unknown> }[] = []
        const candidateMatches: { idx: number; match: KoreFastClipMatch }[] = []
        let failedCallsCount = 0
        for (const rawCall of calls) {
            if (gen !== genRef.current || !liveRef.current) return
            if (!isPlainObject(rawCall)) continue
            const name = typeof rawCall.name === 'string' ? rawCall.name : ''
            const id = typeof rawCall.id === 'string' ? rawCall.id : undefined
            if (id && cancelledToolIdsRef.current.has(id)) continue
            const rawArgs: unknown = rawCall.args
            let args: Record<string, unknown> = {}
            if (isPlainObject(rawArgs)) args = rawArgs
            else if (typeof rawArgs === 'string') {
                try {
                    const parsed: unknown = JSON.parse(rawArgs)
                    if (isPlainObject(parsed)) args = parsed
                } catch { /* el motor reporta args inválidos */ }
            }
            const before = orderRef.current
            const activeLang = sessionMetaRef.current.lang
            const storeAcceptsEbt = sessionRef.current?.store.acceptsEbt
            let response: Record<string, unknown>
            try {
                if (name === 'register_driver_pickup') {
                    const callAbort = new AbortController()
                    if (id) inFlightToolAbortsRef.current.set(id, callAbort)
                    try {
                        const resolved = await resolveKoreDriverPickupTool(
                            before,
                            menuRef.current,
                            args,
                            sessionRef.current?.store.taxRatePct ?? null,
                            {
                                storeId: sessionMetaRef.current.storeId,
                                headers: getAuthHeaders(),
                                lang: activeLang,
                                acceptsEbt: storeAcceptsEbt,
                                externalSignal: callAbort.signal,
                            }
                        )
                        if (gen !== genRef.current || !liveRef.current) return
                        if (resolved.cancelled || (id && cancelledToolIdsRef.current.has(id))) continue
                        orderRef.current = resolved.state
                        setOrder(orderRef.current)
                        response = resolved.response
                    } finally {
                        if (id) inFlightToolAbortsRef.current.delete(id)
                    }
                } else {
                    const out = applyKoreTool(before, menuRef.current, name, args, {
                        taxRatePct: sessionRef.current?.store.taxRatePct ?? null,
                        lang: activeLang,
                        ...(typeof storeAcceptsEbt === 'boolean' ? { acceptsEbt: storeAcceptsEbt } : {}),
                    })
                    orderRef.current = out.state
                    response = isPlainObject(out.result) ? { ...out.result } : { result: out.result }
                }
                if (id) {
                    toolHistoryRef.current.push({ id, name, before })
                    if (toolHistoryRef.current.length > 80) toolHistoryRef.current.shift()
                }
                if (name === 'end_session' && response.ok === true && response.should_end_session === true) {
                    clearAutoEnd(false)
                    autoEndModeRef.current = 'explicit_tool'
                } else if (
                    (name === 'add_item' || name === 'add_items' || name === 'update_item' || name === 'remove_item') &&
                    response.ok === true
                ) {
                    clearAutoEnd(true)
                }
                // Contrato del motor: éxito {ok:true,…}; falla {ok:false, error_code, message,…}
                const failed = response.ok === false
                if (failed) failedCallsCount += 1
                const detail = describeTool(name, args)
                if (failed) {
                    const reason = typeof response.message === 'string' ? response.message : typeof response.error_code === 'string' ? response.error_code : ''
                    pushSystem(reason ? `${detail} — ${reason}` : detail, 'tool_error', name)
                } else {
                    pushSystem(detail, 'tool', name)
                }
                fastClipSeedRef.current += 1
                const fastMatch = matchKoreFastClipForToolOutcome({
                    toolName: name,
                    args,
                    stateBefore: before,
                    stateAfter: orderRef.current,
                    result: response,
                    lang: sessionMetaRef.current.lang,
                    variantSeed: fastClipSeedRef.current,
                })
                if (fastMatch) {
                    candidateMatches.push({ idx: functionResponses.length, match: fastMatch })
                }
            } catch (e) {
                failedCallsCount += 1
                const message = e instanceof Error ? e.message : String(e)
                response = { ok: false, error: message }
                pushSystem(tRef.current('drive_thru.kore_tool_error', { message }), 'tool_error', name)
            }
            if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') response = { ...response, scheduling: 'WHEN_IDLE' }
            functionResponses.push({ ...(id ? { id } : {}), name, response })
        }
        if (gen !== genRef.current || !liveRef.current) return
        setOrder(orderRef.current)

        // Selección de clip instantáneo sin doble voz (terminal tiene prioridad; en lote solo si 1 llamada o 1 aclaración)
        const terminalCandidate = candidateMatches.find(c => c.match.isTerminalSendoff === true)
        const singleCandidate =
            terminalCandidate ||
            (functionResponses.length === 1 && candidateMatches.length === 1
                ? candidateMatches[0]
                : failedCallsCount === 1 && candidateMatches.length === 1 && functionResponses[candidateMatches[0].idx]?.response.ok === false
                    ? candidateMatches[0]
                    : undefined)
        const finalLang = sessionMetaRef.current.lang
        const chosenClip = singleCandidate
            ? fastClipsMapRef.current.get(singleCandidate.match.clipId)?.[finalLang] ?? null
            : null

        if (singleCandidate && chosenClip && chosenClip.samples.length > 0) {
            const spokenText = chosenClip.text
            if (lastCustomerVoiceMsRef.current !== null) {
                const rawDelta = Math.round(performance.now() - lastCustomerVoiceMsRef.current)
                lastCustomerVoiceMsRef.current = null
                if (rawDelta >= 0 && rawDelta <= 15000) {
                    latencySamplesRef.current = [...latencySamplesRef.current, Math.max(8, rawDelta)]
                    setLatencyStats(computeKoreLatencyStats(latencySamplesRef.current))
                }
            }
            if (singleCandidate.match.isTerminalSendoff) {
                // Cierra el WebSocket limpiando handlers para que onclose no corte el audio de despedida
                const wsToClose = wsRef.current
                wsRef.current = null
                if (wsToClose) {
                    wsToClose.onopen = null
                    wsToClose.onmessage = null
                    wsToClose.onerror = null
                    wsToClose.onclose = null
                    try {
                        if (wsToClose.readyState === WebSocket.OPEN || wsToClose.readyState === WebSocket.CONNECTING) {
                            wsToClose.close(1000, 'fast_sendoff')
                        }
                    } catch { /* noop */ }
                }
                playbackRef.current?.clear()
                localFastClipStartedAtRef.current = performance.now()
                customerSpokeSinceFastClipRef.current = false
                playbackRef.current?.enqueue(chosenClip.samples, chosenClip.sampleRate)
                appendSpeech('kore', spokenText)
                finalizeSpeech('kore')
                pushSystem(tRef.current('drive_thru.kore_fast_clip_played', { clipId: singleCandidate.match.clipId }))
                autoEndModeRef.current = 'explicit_tool'
                scheduleAutoEndAfterAudioDrain(450, gen)
                return
            }

            // No terminal: reproduce al instante (<10 ms), suprime audio/texto tardío de Gemini hasta turnComplete
            playbackRef.current?.clear()
            suppressGeminiTurnAudioRef.current = true
            localFastClipStartedAtRef.current = performance.now()
            customerSpokeSinceFastClipRef.current = false
            playbackRef.current?.enqueue(chosenClip.samples, chosenClip.sampleRate)
            appendSpeech('kore', spokenText)
            finalizeSpeech('kore')
            pushSystem(tRef.current('drive_thru.kore_fast_clip_played', { clipId: singleCandidate.match.clipId }))
            const targetEntry = functionResponses[singleCandidate.idx]
            if (targetEntry) {
                targetEntry.response = {
                    ...targetEntry.response,
                    fast_clip_spoken: true,
                    instruction:
                        finalLang === 'en'
                            ? `Respond ONLY in English with exact text: "${spokenText}"`
                            : `Responde ÚNICAMENTE en español con este texto exacto: "${spokenText}"`,
                }
            }
        }

        if (functionResponses.length > 0) sendJson({ toolResponse: { functionResponses } })
    }

    const enqueueToolCall = (toolCall: Record<string, unknown>, gen: number) => {
        toolQueueRef.current = toolQueueRef.current
            .then(() => handleToolCall(toolCall, gen))
            .catch(err => console.error('[Kore DT] Error ejecutando toolCall:', err))
    }

    const handleToolCancellation = (cancellation: Record<string, unknown>) => {
        const ids = new Set((Array.isArray(cancellation.ids) ? cancellation.ids : []).filter((x): x is string => typeof x === 'string'))
        if (ids.size === 0) return
        let abortedInFlight = false
        ids.forEach(cid => {
            cancelledToolIdsRef.current.add(cid)
            const ctrl = inFlightToolAbortsRef.current.get(cid)
            if (ctrl) {
                abortedInFlight = true
                try { ctrl.abort() } catch { /* noop */ }
                inFlightToolAbortsRef.current.delete(cid)
            }
        })
        const hist = toolHistoryRef.current
        if (hist.some(h => ids.has(h.id) && h.name === 'end_session')) {
            clearAutoEnd(true)
        }
        const firstIdx = hist.findIndex(h => ids.has(h.id))
        if (firstIdx === -1) {
            if (abortedInFlight) pushSystem(tRef.current('drive_thru.kore_tool_cancelled'), 'warning')
            return
        }
        const onlySuffix = hist.slice(firstIdx).every(h => ids.has(h.id))
        if (onlySuffix) {
            orderRef.current = hist[firstIdx].before
            toolHistoryRef.current = hist.slice(0, firstIdx)
            setOrder(orderRef.current)
            pushSystem(tRef.current('drive_thru.kore_tool_reverted'), 'warning')
        } else {
            pushSystem(tRef.current('drive_thru.kore_tool_cancelled'), 'warning')
        }
    }

    const processServerMessage = (msg: Record<string, unknown>, gen: number) => {
        if ('setupComplete' in msg) onSetupComplete()
        if (isPlainObject(msg.serverContent)) handleServerContent(msg.serverContent, gen)
        if (isPlainObject(msg.toolCall)) enqueueToolCall(msg.toolCall, gen)
        if (isPlainObject(msg.toolCallCancellation)) handleToolCancellation(msg.toolCallCancellation)
        if (isPlainObject(msg.goAway)) {
            const seconds = parseDurationSec(msg.goAway.timeLeft)
            const text = tRef.current('drive_thru.kore_warn_goaway', { seconds: seconds ?? '?' })
            setNotice(text)
            pushSystem(text, 'warning')
        }
        if (isPlainObject(msg.error) && typeof msg.error.message === 'string') {
            pushSystem(msg.error.message, 'warning')
        }
    }

    const decoderRef = useRef<TextDecoder | null>(null)
    const handleSocketData = (raw: unknown, gen: number) => {
        if (gen !== genRef.current) return
        const parse = (text: string) => {
            if (gen !== genRef.current) return
            try {
                const parsed: unknown = JSON.parse(text)
                if (isPlainObject(parsed)) processServerMessage(parsed, gen)
            } catch (e) {
                console.error('[Kore DT] Mensaje inválido del servidor:', e)
            }
        }
        if (typeof raw === 'string') return parse(raw)
        if (raw instanceof ArrayBuffer) {
            if (!decoderRef.current) decoderRef.current = new TextDecoder('utf-8')
            return parse(decoderRef.current.decode(raw))
        }
        if (raw instanceof Blob) void raw.text().then(parse)
    }

    // ─────────────────────────────────────────────
    // Inicio de sesión
    // ─────────────────────────────────────────────
    const startSession = async () => {
        if (!selectedStore || isBusy || endingRef.current) return
        stopFastClipPreview(true)
        const gen = ++genRef.current
        const meta = { storeId: selectedStore.id, lang }
        sessionMetaRef.current = meta

        // Reinicio de estado visible
        setError(null)
        setNotice(null)
        setSavedOk(false)
        setInterimText('')
        setElapsedSec(0)
        setSessionStore(null)
        transcriptRef.current = []
        openEntryRef.current = { customer: null, kore: null }
        toolHistoryRef.current = []
        toolQueueRef.current = Promise.resolve()
        cancelledToolIdsRef.current.clear()
        clearAutoEnd(true)
        clearLangCueTimer()
        suppressGeminiTurnAudioRef.current = false
        localFastClipStartedAtRef.current = 0
        customerSpokeSinceFastClipRef.current = false
        fastClipSeedRef.current = 0
        currentKoreTurnTextRef.current = ''
        currentCustomerTurnTextRef.current = ''
        abortInFlightTools()
        if (fastClipsStoreIdRef.current !== meta.storeId || fastClipsMapRef.current.size === 0) {
            void loadFastClips(meta.storeId)
        }
        setTranscript([])
        const fresh = createKoreOrderState()
        orderRef.current = fresh
        setOrder(fresh)
        setResetKey(k => k + 1)
        latencySamplesRef.current = []
        setLatencyStats(computeKoreLatencyStats([]))
        bargeInCountRef.current = 0
        setBargeInCount(0)
        noiseGateRef.current.reset()
        noiseGateRef.current.setEnabled(noiseGateEnabled)
        pttTalkingRef.current = false
        setPttTalking(false)
        micEnabledRef.current = true
        setMicEnabled(true)
        startedAtRef.current = null
        setPhase('requesting')

        const fail = (message: string) => {
            if (gen !== genRef.current) return
            void finishSession(message)
        }

        if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            return fail(t('drive_thru.kore_err_insecure'))
        }

        // 1) AudioContext dentro del gesto del usuario (evita autoplay bloqueado)
        let ctx: AudioContext
        try {
            const Ctor: typeof AudioContext | undefined =
                window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!Ctor) throw new Error('AUDIO_CONTEXT_UNSUPPORTED')
            ctx = new Ctor({ latencyHint: 'interactive' })
            ctxRef.current = ctx
            void ctx.resume().catch(() => undefined)
        } catch {
            return fail(t('drive_thru.kore_err_worklet'))
        }

        // 2) Micrófono
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            })
            if (gen !== genRef.current) {
                stream.getTracks().forEach(track => track.stop())
                return
            }
            streamRef.current = stream
        } catch (e) {
            const name = e instanceof DOMException ? e.name : ''
            if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
                return fail(t('drive_thru.kore_err_mic_denied'))
            }
            if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
                return fail(t('drive_thru.kore_err_mic_unavailable'))
            }
            return fail(t('drive_thru.kore_err_mic_unavailable'))
        }

        // 3) Grafo de audio: mic → worklet PCM16 16 kHz (salida muda) y cola de reproducción
        try {
            await loadKoreCaptureWorklet(ctx)
            if (gen !== genRef.current) return
            if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
            const source = ctx.createMediaStreamSource(streamRef.current as MediaStream)
            const node = new AudioWorkletNode(ctx, KORE_CAPTURE_PROCESSOR, {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                channelCount: 1,
                channelCountMode: 'explicit',
                channelInterpretation: 'speakers',
                processorOptions: { targetRate: KORE_INPUT_SAMPLE_RATE, chunkSamples: KORE_CHUNK_SAMPLES },
            })
            const sink = ctx.createGain()
            sink.gain.value = 0
            node.port.onmessage = (ev: MessageEvent<MicChunkMessage>) => handleMicChunk(ev.data)
            source.connect(node)
            node.connect(sink)
            sink.connect(ctx.destination)
            sourceNodeRef.current = source
            workletRef.current = node
            sinkRef.current = sink
            const out = ctx.createGain()
            out.gain.value = 1
            out.connect(ctx.destination)
            outNodeRef.current = out
            playbackRef.current = new KorePlaybackQueue(ctx, out, active => {
                if (!active) {
                    localFastClipStartedAtRef.current = 0
                    customerSpokeSinceFastClipRef.current = false
                }
                setKoreSpeaking(active)
            })
        } catch (e) {
            console.error('[Kore DT] Error inicializando audio:', e)
            return fail(t('drive_thru.kore_err_worklet'))
        }

        // 4) Token efímero + setup desde el backend
        let session: KoreSessionResponse
        try {
            const res = await fetch('/api/drive-thru/kore/session', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ storeId: meta.storeId, lang: meta.lang }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (gen !== genRef.current) return
            if (!res.ok || !isPlainObject(data) || typeof data.wsUrl !== 'string' || !isPlainObject(data.setup) || !isPlainObject(data.store)) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                return fail(t('drive_thru.kore_err_token', { message: msg }))
            }
            session = data as unknown as KoreSessionResponse
        } catch (e) {
            return fail(t('drive_thru.kore_err_token', { message: e instanceof Error ? e.message : String(e) }))
        }
        sessionRef.current = session
        menuRef.current = Array.isArray(session.menu) ? session.menu : []
        toolBehaviorRef.current = extractToolBehaviors(session.setup)
        setSessionStore(session.store)

        // 5) WebSocket con Gemini Live (endpoint constrained + access_token)
        setPhase('connecting')
        let ws: WebSocket
        try {
            ws = new WebSocket(session.wsUrl)
        } catch (e) {
            return fail(t('drive_thru.kore_err_socket', { message: e instanceof Error ? e.message : String(e) }))
        }
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws
        timersRef.current.setup = window.setTimeout(() => {
            if (gen === genRef.current && !liveRef.current) fail(tRef.current('drive_thru.kore_err_setup_timeout'))
        }, SETUP_TIMEOUT_MS)

        ws.onopen = () => {
            if (gen !== genRef.current) return
            const setupMsg = isPlainObject(session.setup.setup) ? session.setup : { setup: session.setup }
            if (!sendJson(setupMsg)) fail(tRef.current('drive_thru.kore_err_socket', { message: 'send_failed' }))
        }
        ws.onmessage = (ev: MessageEvent) => handleSocketData(ev.data, gen)
        ws.onerror = () => {
            // El detalle llega en onclose (code/reason); aquí solo se registra.
            console.warn('[Kore DT] WebSocket error')
        }
        ws.onclose = (ev: CloseEvent) => {
            if (gen !== genRef.current) return
            wsRef.current = null
            const reason = ev.reason ? ` · ${ev.reason}` : ''
            if (ev.code === 1000 && liveRef.current) {
                pushSystem(tRef.current('drive_thru.kore_socket_closed_normal'), 'warning')
                void finishSession()
                return
            }
            void finishSession(tRef.current('drive_thru.kore_err_closed', { code: ev.code, reason }))
        }
    }

    const endSession = () => {
        if (phase === 'idle' || phase === 'ended' || phase === 'error') return
        void finishSession()
    }

    const toggleMic = () => {
        const next = !micEnabledRef.current
        micEnabledRef.current = next
        setMicEnabled(next)
        streamRef.current?.getAudioTracks().forEach(track => { track.enabled = next })
        if (!next) {
            meterLevelRef.current = 0
            if (meterRef.current) meterRef.current.style.width = '0%'
            if (liveRef.current) sendJson({ realtimeInput: { audioStreamEnd: true } })
        }
    }

    const toggleNoiseGate = () => {
        setNoiseGateEnabled(prev => {
            const next = !prev
            noiseGateRef.current.setEnabled(next)
            if (!next) {
                noiseGatedRef.current = false
                setNoiseGatedNow(false)
            }
            return next
        })
    }

    const startPttTalk = useCallback(() => {
        if (!liveRef.current || micModeRef.current !== 'ptt' || pttTalkingRef.current) return
        pttTalkingRef.current = true
        setPttTalking(true)
        noiseGateRef.current.reset()
        initialGreetingPendingRef.current = false
        koreTurnFirstAudioRecordedRef.current = false
        if (playbackRef.current?.isActive) {
            playbackRef.current.clear()
            if (!koreTurnInterruptedRef.current) {
                koreTurnInterruptedRef.current = true
                bargeInCountRef.current += 1
                setBargeInCount(bargeInCountRef.current)
            }
        }
    }, [])

    const stopPttTalk = useCallback(() => {
        if (!pttTalkingRef.current) return
        pttTalkingRef.current = false
        setPttTalking(false)
        meterLevelRef.current = 0
        if (meterRef.current) meterRef.current.style.width = '0%'
        if (liveRef.current) {
            lastCustomerVoiceMsRef.current = performance.now()
            koreTurnFirstAudioRecordedRef.current = false
            sendJson({ realtimeInput: { audioStreamEnd: true } })
        }
    }, [])

    const switchMicMode = (nextMode: KoreMicMode) => {
        if (micModeRef.current === nextMode) return
        micModeRef.current = nextMode
        setMicMode(nextMode)
        if (nextMode === 'ptt') {
            pttTalkingRef.current = false
            setPttTalking(false)
            meterLevelRef.current = 0
            if (meterRef.current) meterRef.current.style.width = '0%'
            if (liveRef.current) sendJson({ realtimeInput: { audioStreamEnd: true } })
        } else {
            pttTalkingRef.current = false
            setPttTalking(false)
            micEnabledRef.current = true
            setMicEnabled(true)
            streamRef.current?.getAudioTracks().forEach(track => { track.enabled = true })
        }
    }

    // Barra espaciadora para Push-to-Talk (sin interferir con inputs/textareas/selects)
    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null): boolean => {
            if (!(target instanceof HTMLElement)) return false
            if (target.isContentEditable) return true
            const tag = target.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
            if (tag === 'BUTTON' && target.dataset.pttButton !== 'true') return true
            return false
        }
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.code !== 'Space' || !liveRef.current || micModeRef.current !== 'ptt') return
            if (isEditableTarget(ev.target)) return
            ev.preventDefault()
            if (!ev.repeat) startPttTalk()
        }
        const onKeyUp = (ev: KeyboardEvent) => {
            if (ev.code !== 'Space' || micModeRef.current !== 'ptt') return
            if (pttTalkingRef.current) {
                ev.preventDefault()
                stopPttTalk()
            }
        }
        const onBlur = () => stopPttTalk()
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', onBlur)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
            window.removeEventListener('blur', onBlur)
        }
    }, [startPttTalk, stopPttTalk])

    // ─────────────────────────────────────────────
    // Desmontaje / cierre de pestaña: limpieza total + guardado "abandonada"
    // ─────────────────────────────────────────────
    const saveOnExitRef = useRef<() => void>(() => undefined)
    saveOnExitRef.current = () => {
        const payload = buildSavePayload()
        startedAtRef.current = null
        if (!payload) return
        try {
            void fetch('/api/drive-thru/kore/sessions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload),
                keepalive: true,
            }).catch(() => undefined)
        } catch { /* noop */ }
    }
    const teardownRef = useRef<() => void>(() => undefined)
    teardownRef.current = () => {
        if (postSaveLearnTimerRef.current !== null) {
            window.clearTimeout(postSaveLearnTimerRef.current)
            postSaveLearnTimerRef.current = null
        }
        stopFastClipPreview(true)
        teardownMedia()
    }

    useEffect(() => {
        mountedRef.current = true
        const onPageHide = () => {
            if (startedAtRef.current !== null) saveOnExitRef.current()
            genRef.current += 1
            teardownRef.current()
        }
        window.addEventListener('pagehide', onPageHide)
        return () => {
            mountedRef.current = false
            window.removeEventListener('pagehide', onPageHide)
            if (startedAtRef.current !== null) saveOnExitRef.current()
            genRef.current += 1
            teardownRef.current()
        }
    }, [])

    // ─────────────────────────────────────────────
    // Derivados de UI
    // ─────────────────────────────────────────────
    const totals = useMemo(() => computeKoreTotals(order, sessionStore?.taxRatePct ?? 0), [order, sessionStore])
    const fastClipCatalogRows = useMemo(
        () => buildKoreFastClipCatalogRows(selectedStore?.id ?? 0, fastClipsMapRef.current),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedStore?.id, fastClipsVersion]
    )
    const filteredFastClipRows = useMemo(
        () => (fastClipsCategory === 'all' ? fastClipCatalogRows : fastClipCatalogRows.filter(r => r.category === fastClipsCategory)),
        [fastClipCatalogRows, fastClipsCategory]
    )
    const fastClipCategoryTabs: { id: KoreFastClipCatalogFilter; labelKey: string; count: number }[] = useMemo(() => {
        const countOf = (cat: KoreFastClipCatalogRow['category']) => fastClipCatalogRows.filter(r => r.category === cat).length
        return [
            { id: 'all', labelKey: 'drive_thru.kore_fast_clips_cat_all', count: fastClipCatalogRows.length },
            { id: 'greeting', labelKey: 'drive_thru.kore_fast_clips_cat_greeting', count: countOf('greeting') },
            { id: 'clarify', labelKey: 'drive_thru.kore_fast_clips_cat_clarify', count: countOf('clarify') },
            { id: 'item_ack', labelKey: 'drive_thru.kore_fast_clips_cat_item_ack', count: countOf('item_ack') },
            { id: 'ops', labelKey: 'drive_thru.kore_fast_clips_cat_ops', count: countOf('ops') },
            { id: 'sendoff', labelKey: 'drive_thru.kore_fast_clips_cat_sendoff', count: countOf('sendoff') },
        ]
    }, [fastClipCatalogRows])
    const customerDisplayName = useMemo(() => {
        if (sessionStore?.customerName) return sessionStore.customerName
        if (!selectedStore) return null
        return formatCustomerStoreName({ id: selectedStore.id, name: selectedStore.name, code: selectedStore.code }, lang)
    }, [sessionStore, selectedStore, lang])
    const remainingSec = Math.max(0, KORE_SESSION_CAP_SEC - elapsedSec)

    const statusInfo = (() => {
        switch (phase) {
            case 'requesting': return { label: t('drive_thru.kore_status_requesting'), cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300', icon: <Loader2 size={14} className="animate-spin" /> }
            case 'connecting': return { label: t('drive_thru.kore_status_connecting'), cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300', icon: <Loader2 size={14} className="animate-spin" /> }
            case 'live':
                if (koreSpeaking) return { label: t('drive_thru.kore_status_speaking'), cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300', icon: <Volume2 size={14} className="animate-pulse" /> }
                if (micMode === 'ptt') {
                    return pttTalking
                        ? { label: t('drive_thru.kore_status_ptt_talking'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', icon: <Radio size={14} className="animate-pulse" /> }
                        : { label: t('drive_thru.kore_status_ptt_ready'), cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300', icon: <Mic size={14} /> }
                }
                if (!micEnabled) return { label: t('drive_thru.kore_status_muted'), cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: <MicOff size={14} /> }
                return { label: t('drive_thru.kore_status_listening'), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', icon: <Radio size={14} className="animate-pulse" /> }
            case 'ending': return { label: t('drive_thru.kore_status_ending'), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300', icon: <Loader2 size={14} className="animate-spin" /> }
            case 'ended': return { label: t('drive_thru.kore_status_ended'), cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300', icon: <PhoneOff size={14} /> }
            case 'error': return { label: t('drive_thru.kore_status_error'), cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300', icon: <AlertTriangle size={14} /> }
            default: return { label: t('drive_thru.kore_status_idle'), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', icon: <Bot size={14} /> }
        }
    })()

    const outcomeBadge = (outcome: string | null) => {
        if (outcome === 'confirmed') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">{t('drive_thru.kore_outcome_confirmed')}</span>
        if (outcome === 'cancelled') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">{t('drive_thru.kore_outcome_cancelled')}</span>
        return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{t('drive_thru.kore_outcome_abandoned')}</span>
    }

    const dateFmt = useMemo(
        () => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-MX', {
            timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }),
        [language]
    )

    // ─────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────
    return (
        <div className="space-y-4">
            {/* Badge de simulación (siempre visible) */}
            <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
                <ShieldAlert className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" size={22} />
                <div>
                    <p className="text-sm sm:text-base font-black uppercase tracking-wide text-amber-800 dark:text-amber-300">{t('drive_thru.kore_sim_badge')}</p>
                    <p className="text-xs sm:text-sm text-amber-700 dark:text-amber-400/90">{t('drive_thru.kore_sim_badge_detail')}</p>
                </div>
            </div>

            {/* Controles */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl shadow-lg shadow-violet-500/20">
                            <Bot className="text-white" size={22} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-900 dark:text-white">{t('drive_thru.kore_title')}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">{t('drive_thru.kore_subtitle')}</p>
                        </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold ${statusInfo.cls}`}>
                        {statusInfo.icon}
                        {statusInfo.label}
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <div>
                        <label htmlFor="kore-store" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('drive_thru.kore_store')}</label>
                        <select
                            id="kore-store"
                            value={selectedStore ? selectedStore.id : ''}
                            disabled={isBusy || !hasDtAccess}
                            onChange={e => setStoreId(Number(e.target.value))}
                            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none disabled:opacity-60"
                        >
                            {hasDtAccess ? (
                                stores.map(s => (
                                    <option key={s.id} value={s.id}>#{s.id} {s.name}</option>
                                ))
                            ) : (
                                <option value="">{t('drive_thru.kore_no_dt_store_option')}</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('drive_thru.kore_language')}</span>
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 gap-1">
                            {(['es', 'en'] as KoreLang[]).map(code => (
                                <button
                                    key={code}
                                    type="button"
                                    disabled={phase === 'requesting' || phase === 'connecting' || phase === 'ending'}
                                    onClick={() => handleManualLanguageSelect(code)}
                                    className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-bold transition-all cursor-pointer disabled:opacity-60 ${
                                        lang === code
                                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {code === 'es' ? t('drive_thru.kore_lang_es') : t('drive_thru.kore_lang_en')}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-2 lg:col-span-2">
                        {!isBusy ? (
                            <button
                                type="button"
                                onClick={() => void startSession()}
                                disabled={!selectedStore}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-black shadow-md shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                                <PhoneCall size={18} /> {t('drive_thru.kore_start')}
                            </button>
                        ) : (
                            <>
                                {micMode === 'ptt' ? (
                                    <button
                                        type="button"
                                        data-ptt-button="true"
                                        disabled={phase !== 'live'}
                                        onPointerDown={e => { e.preventDefault(); startPttTalk() }}
                                        onPointerUp={() => stopPttTalk()}
                                        onPointerCancel={() => stopPttTalk()}
                                        onPointerLeave={() => stopPttTalk()}
                                        className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-black border-2 select-none touch-none transition-all disabled:opacity-50 cursor-pointer ${
                                            pttTalking
                                                ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-500/30 scale-[0.99]'
                                                : 'bg-amber-50 dark:bg-amber-950/50 border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                                        }`}
                                    >
                                        <Mic size={18} className={pttTalking ? 'animate-pulse' : ''} />
                                        <span className="truncate">{pttTalking ? t('drive_thru.kore_ptt_talking') : t('drive_thru.kore_ptt_hold')}</span>
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={toggleMic}
                                        disabled={phase !== 'live'}
                                        className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold border transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
                                            micEnabled
                                                ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                                                : 'bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                                        }`}
                                    >
                                        {micEnabled ? <MicOff size={18} /> : <Mic size={18} />}
                                        <span className="hidden sm:inline">{micEnabled ? t('drive_thru.kore_mic_pause') : t('drive_thru.kore_mic_resume')}</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={endSession}
                                    disabled={phase === 'ending'}
                                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-black shadow-md shadow-rose-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
                                >
                                    {phase === 'ending' ? <Loader2 size={18} className="animate-spin" /> : <PhoneOff size={18} />}
                                    <span>{t('drive_thru.kore_end')}</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Modo de voz (VAD vs Push-to-Talk) + Filtro anti-ruido */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                            <Mic size={14} className="text-violet-500" />
                            <span>{t('drive_thru.kore_mic_mode')}</span>
                        </span>
                        <div className="flex bg-white dark:bg-slate-900 rounded-lg p-0.5 gap-1 border border-slate-200 dark:border-slate-700">
                            {(['vad', 'ptt'] as KoreMicMode[]).map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => switchMicMode(m)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                                        micMode === m
                                            ? 'bg-violet-600 text-white shadow-sm'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {m === 'vad' ? t('drive_thru.kore_mode_vad') : t('drive_thru.kore_mode_ptt')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2 flex-wrap">
                        <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                <Sliders size={14} className="text-emerald-500 shrink-0" />
                                <span>{t('drive_thru.kore_noise_gate_label')}</span>
                                {noiseGateEnabled && noiseGatedNow && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                        {t('drive_thru.kore_noise_gate_gated')}
                                    </span>
                                )}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">{t('drive_thru.kore_noise_gate_hint')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={toggleNoiseGate}
                            className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                                noiseGateEnabled
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                        >
                            {noiseGateEnabled ? t('drive_thru.kore_noise_gate_on') : t('drive_thru.kore_noise_gate_off')}
                        </button>
                    </div>
                </div>

                {/* Medidor + latencia en vivo + tiempo + aviso de audífonos */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                        {micEnabled ? <Mic size={16} className="text-slate-500 shrink-0" /> : <MicOff size={16} className="text-amber-500 shrink-0" />}
                        <div className="flex-1">
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('drive_thru.kore_mic_level')}</p>
                            <div className="h-2 mt-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div ref={meterRef} className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-lime-400 to-amber-400 transition-[width] duration-75" style={{ width: '0%' }} />
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                        <Gauge size={16} className="text-violet-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('drive_thru.kore_latency_label')}</p>
                            {latencyStats.lastMs !== null && latencyStats.avgLatencyMs !== null && latencyStats.p95LatencyMs !== null ? (
                                <div>
                                    <span className={`inline-block text-sm font-black tabular-nums ${
                                        latencyStats.lastMs <= 900
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : latencyStats.lastMs <= 1800
                                                ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                    }`}>
                                        {t('drive_thru.kore_latency_unit_ms', { ms: latencyStats.lastMs })}
                                    </span>
                                    <p className="text-[11px] text-slate-400 truncate tabular-nums">
                                        {t('drive_thru.kore_latency_stats', {
                                            avg: latencyStats.avgLatencyMs,
                                            p95: latencyStats.p95LatencyMs,
                                            barge: bargeInCount,
                                        })}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-xs font-semibold text-slate-400 truncate">{t('drive_thru.kore_latency_waiting')}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                        <Car size={16} className="text-slate-500 shrink-0" />
                        <div className="flex-1">
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('drive_thru.kore_session_time')}</p>
                            <p className="text-sm font-black tabular-nums text-slate-900 dark:text-white">
                                {formatClock(elapsedSec)}
                                <span className={`ml-2 text-xs font-semibold ${phase === 'live' && remainingSec <= 60 ? 'text-rose-500' : 'text-slate-400'}`}>
                                    {t('drive_thru.kore_session_cap', { minutes: Math.round(KORE_SESSION_CAP_SEC / 60), remaining: formatClock(remainingSec) })}
                                </span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 px-3 py-2">
                        <Headphones size={18} className="text-sky-600 dark:text-sky-400 shrink-0" />
                        <p className="text-xs font-semibold text-sky-800 dark:text-sky-300">{t('drive_thru.kore_headphones_tip')}</p>
                    </div>
                </div>

                {!hasDtAccess && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-200">
                        <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <span>{t('drive_thru.kore_no_dt_access')}</span>
                    </div>
                )}

                {hasDtAccess && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2.5 flex-wrap">
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 flex-wrap">
                                    {fastClipsLoading && !fastClipsStats ? (
                                        <>
                                            <Loader2 size={13} className="animate-spin shrink-0" />
                                            <span>{t('drive_thru.kore_fast_clips_loading')}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Zap size={14} className="text-amber-500 shrink-0" />
                                            <span>
                                                {t('drive_thru.kore_fast_clips_status', {
                                                    cached: fastClipsStats?.cachedClips ?? 0,
                                                    total: fastClipsStats?.totalClips ?? fastClipCatalogRows.length * 2,
                                                    tickets: new Intl.NumberFormat(language === 'en' ? 'en-US' : 'es-MX').format(
                                                        fastClipsStats?.historicalDtOrdersCount || fastClipsStats?.historicalDetailedSnapshotsCount || 0
                                                    ),
                                                })}
                                            </span>
                                        </>
                                    )}
                                </p>
                                {fastClipsStats && fastClipsStats.topDriveThruItems.length > 0 && (
                                    <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 truncate">
                                        {t('drive_thru.kore_fast_clips_top_hint', { items: fastClipsStats.topDriveThruItems.slice(0, 4).join(' · ') })}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (showFastClipsCatalog) stopFastClipPreview(false)
                                        setShowFastClipsCatalog(v => !v)
                                    }}
                                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-slate-800 text-emerald-800 dark:text-emerald-200 px-2.5 py-1 text-xs font-bold shadow-sm transition-all cursor-pointer"
                                >
                                    <Volume2 size={13} />
                                    <span>{showFastClipsCatalog ? t('drive_thru.kore_fast_clips_hide_btn') : t('drive_thru.kore_fast_clips_view_btn')}</span>
                                    {showFastClipsCatalog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                </button>
                                {fastClipsStats && fastClipsStats.totalClips > 0 && (
                                    fastClipsStats.cachedClips >= fastClipsStats.totalClips ? (
                                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-2.5 py-0.5 text-[11px] font-black">
                                            <Zap size={11} />
                                            <span>{t('drive_thru.kore_fast_clips_ready_badge')}</span>
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => void handleWarmFastClips()}
                                            disabled={fastClipsWarming}
                                            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-bold shadow-sm transition-all disabled:opacity-60 cursor-pointer"
                                        >
                                            {fastClipsWarming ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                            <span>{fastClipsWarming ? t('drive_thru.kore_fast_clips_warming') : t('drive_thru.kore_fast_clips_warm_btn')}</span>
                                        </button>
                                    )
                                )}
                            </div>
                        </div>

                        {showFastClipsCatalog && (
                            <div className="rounded-xl border border-emerald-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/95 p-3 space-y-2.5">
                                <div>
                                    <p className="text-xs font-black text-slate-800 dark:text-white">{t('drive_thru.kore_fast_clips_catalog_title')}</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('drive_thru.kore_fast_clips_catalog_sub')}</p>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {fastClipCategoryTabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setFastClipsCategory(tab.id)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                                                fastClipsCategory === tab.id
                                                    ? 'bg-emerald-600 text-white shadow-sm'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            {t(tab.labelKey)} ({tab.count})
                                        </button>
                                    ))}
                                </div>
                                <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800">
                                    {filteredFastClipRows.map(row => {
                                        const esKey = `${row.clipId}:es`
                                        const enKey = `${row.clipId}:en`
                                        const playingEs = previewingClipKey === esKey
                                        const playingEn = previewingClipKey === enKey
                                        const catLabelKey =
                                            row.category === 'greeting'
                                                ? 'drive_thru.kore_fast_clips_cat_greeting'
                                                : row.category === 'clarify'
                                                    ? 'drive_thru.kore_fast_clips_cat_clarify'
                                                    : row.category === 'item_ack'
                                                        ? 'drive_thru.kore_fast_clips_cat_item_ack'
                                                        : row.category === 'sendoff'
                                                            ? 'drive_thru.kore_fast_clips_cat_sendoff'
                                                            : 'drive_thru.kore_fast_clips_cat_ops'
                                        return (
                                            <div key={row.clipId} className="px-3 py-2.5 space-y-1.5 text-xs">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                                        {t(catLabelKey)}
                                                    </span>
                                                    <code className="text-[11px] font-mono font-bold text-violet-700 dark:text-violet-300">
                                                        {row.greetingNum ? `${t('drive_thru.kore_fast_clips_greeting_label', { num: row.greetingNum })} (${row.clipId})` : row.clipId}
                                                    </code>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                                                        <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-200 break-words">
                                                            <strong className="text-emerald-700 dark:text-emerald-400 mr-1">{t('drive_thru.kore_fast_clips_lang_es_tag')}</strong>
                                                            <span>{row.textEs}</span>
                                                        </p>
                                                        <div className="shrink-0 flex items-center gap-1.5">
                                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                row.hasEs
                                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                                                                    : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                                            }`}>
                                                                {row.hasEs ? t('drive_thru.kore_fast_clips_recorded') : t('drive_thru.kore_fast_clips_pending')}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                disabled={!row.hasEs || isBusy}
                                                                onClick={() => void playFastClipPreview(row.clipId, 'es')}
                                                                className={`px-2 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                                                    playingEs
                                                                        ? 'bg-rose-600 text-white shadow-sm'
                                                                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                                                                }`}
                                                            >
                                                                {playingEs ? t('drive_thru.kore_fast_clips_stop') : t('drive_thru.kore_fast_clips_play_es')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                                                        <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-200 break-words">
                                                            <strong className="text-sky-700 dark:text-sky-400 mr-1">{t('drive_thru.kore_fast_clips_lang_en_tag')}</strong>
                                                            <span>{row.textEn}</span>
                                                        </p>
                                                        <div className="shrink-0 flex items-center gap-1.5">
                                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                row.hasEn
                                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
                                                                    : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                                            }`}>
                                                                {row.hasEn ? t('drive_thru.kore_fast_clips_recorded') : t('drive_thru.kore_fast_clips_pending')}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                disabled={!row.hasEn || isBusy}
                                                                onClick={() => void playFastClipPreview(row.clipId, 'en')}
                                                                className={`px-2 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                                                    playingEn
                                                                        ? 'bg-rose-600 text-white shadow-sm'
                                                                        : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm'
                                                                }`}
                                                            >
                                                                {playingEn ? t('drive_thru.kore_fast_clips_stop') : t('drive_thru.kore_fast_clips_play_en')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {customerDisplayName && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Info size={13} /> {t('drive_thru.kore_customer_name', { name: customerDisplayName })}
                    </p>
                )}

                {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        <span className="flex-1 break-words">{error}</span>
                        <button type="button" onClick={() => setError(null)} aria-label={t('drive_thru.kore_dismiss')} className="shrink-0 hover:opacity-70 cursor-pointer">
                            <X size={16} />
                        </button>
                    </div>
                )}
                {notice && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        <span className="flex-1 break-words">{notice}</span>
                        <button type="button" onClick={() => setNotice(null)} aria-label={t('drive_thru.kore_dismiss')} className="shrink-0 hover:opacity-70 cursor-pointer">
                            <X size={16} />
                        </button>
                    </div>
                )}
                {savedOk && phase === 'ended' && (
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{t('drive_thru.kore_saved')}</p>
                )}
                {order.status === 'confirmed' && phase === 'live' && (
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{t('drive_thru.kore_confirmed_hint')}</p>
                )}
            </div>

            {/* Ticket en vivo + conversación */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3">
                    <KoreLiveTicket
                        order={order}
                        totals={totals}
                        taxRatePct={sessionStore?.taxRatePct ?? null}
                        taxIsEstimate={sessionStore?.taxIsEstimate ?? true}
                        customerStoreName={customerDisplayName}
                        active={phase === 'live'}
                        resetKey={resetKey}
                    />
                </div>
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col min-h-[460px] max-h-[640px]">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">{t('drive_thru.kore_transcript')}</h3>
                        {phase === 'live' && koreSpeaking && <Volume2 size={16} className="text-violet-500 animate-pulse" />}
                    </div>
                    <div ref={transcriptBoxRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                        {transcript.length === 0 && !interimText && (
                            <p className="text-sm text-slate-400 text-center py-10 px-4">{t('drive_thru.kore_transcript_empty')}</p>
                        )}
                        {transcript.map(entry => {
                            if (entry.role === 'system') {
                                const tone =
                                    entry.kind === 'tool' ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                                        : entry.kind === 'tool_error' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                            : entry.kind === 'warning' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                return (
                                    <div key={entry.id} className="flex justify-center animate-in fade-in duration-300">
                                        <span className={`inline-flex items-center gap-1.5 max-w-full rounded-full px-3 py-1 text-[11px] font-semibold ${tone}`}>
                                            {entry.kind === 'tool' || entry.kind === 'tool_error' ? <Wrench size={11} className="shrink-0" /> : entry.kind === 'warning' ? <AlertTriangle size={11} className="shrink-0" /> : <Car size={11} className="shrink-0" />}
                                            <span className="break-words">{entry.text}</span>
                                        </span>
                                    </div>
                                )
                            }
                            const isCustomer = entry.role === 'customer'
                            return (
                                <div key={entry.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                        isCustomer
                                            ? 'bg-orange-500 text-white rounded-br-md'
                                            : 'bg-violet-50 dark:bg-violet-950/40 text-slate-800 dark:text-slate-100 border border-violet-100 dark:border-violet-900 rounded-bl-md'
                                    } ${entry.final ? '' : 'opacity-80'}`}>
                                        <p className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mb-0.5 ${isCustomer ? 'text-orange-100' : 'text-violet-600 dark:text-violet-300'}`}>
                                            {isCustomer ? <User size={10} /> : <Bot size={10} />}
                                            {isCustomer ? t('drive_thru.kore_role_customer') : t('drive_thru.kore_role_kore')}
                                        </p>
                                        <p className="whitespace-pre-wrap break-words">{entry.text.trim()}</p>
                                    </div>
                                </div>
                            )
                        })}
                        {interimText && (
                            <div className="flex justify-end">
                                <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 italic">
                                    {t('drive_thru.kore_hearing')} {interimText}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Historial reciente */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <History size={16} /> {t('drive_thru.kore_history')}
                        {selectedStore && <span className="font-semibold text-slate-400">· #{selectedStore.id} {selectedStore.name}</span>}
                    </h3>
                    <button
                        type="button"
                        onClick={() => { if (selectedStore) void loadHistory(selectedStore.id) }}
                        disabled={historyLoading || !selectedStore}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} /> {t('drive_thru.kore_refresh')}
                    </button>
                </div>
                {historyError ? (
                    <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{t('drive_thru.kore_history_error', { message: historyError })}</p>
                ) : historyLoading && history.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">{t('drive_thru.kore_history_loading')}</p>
                ) : history.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">{t('drive_thru.kore_history_empty')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_date')}</th>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_duration')}</th>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_latency')}</th>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_lang')}</th>
                                    <th className="text-right font-semibold px-4 py-2">{t('drive_thru.kore_col_items')}</th>
                                    <th className="text-right font-semibold px-4 py-2">{t('drive_thru.kore_col_total')}</th>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_outcome')}</th>
                                    <th className="text-left font-semibold px-4 py-2">{t('drive_thru.kore_col_by')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {history.map(row => {
                                    const started = row.startedAt ? new Date(row.startedAt) : null
                                    const rowAvgLat = typeof row.avgLatencyMs === 'number' && Number.isFinite(row.avgLatencyMs) ? Math.round(row.avgLatencyMs) : null
                                    return (
                                        <tr key={String(row.id)} className="text-slate-700 dark:text-slate-200">
                                            <td className="px-4 py-2 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{started && !Number.isNaN(started.getTime()) ? dateFmt.format(started) : '—'}</span>
                                                    {row.sessionKind === 'driver_pickup' && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                                            <Truck size={10} />
                                                            <span>{t('drive_thru.kore_kind_driver')}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 tabular-nums">{formatClock(Number(row.durationSec) || 0)}</td>
                                            <td className="px-4 py-2 tabular-nums">
                                                {rowAvgLat !== null ? t('drive_thru.kore_latency_unit_ms', { ms: rowAvgLat }) : '—'}
                                            </td>
                                            <td className="px-4 py-2 uppercase">{row.lang || '—'}</td>
                                            <td className="px-4 py-2 text-right tabular-nums">{typeof row.itemCount === 'number' ? row.itemCount : '—'}</td>
                                            <td className="px-4 py-2 text-right tabular-nums font-bold">{formatUsdCents(Number(row.totalCents) || 0)}</td>
                                            <td className="px-4 py-2">{outcomeBadge(typeof row.outcome === 'string' ? row.outcome : null)}</td>
                                            <td className="px-4 py-2 truncate max-w-[160px]">{row.createdByName || (row.createdBy != null ? String(row.createdBy) : '—')}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Aprendizaje Continuo de Kore (criterios del dueño + reglas activas) */}
            {selectedStore && (
                <KoreLearningPanel
                    storeId={selectedStore.id}
                    isGlobalScope={viewerScope.isGlobal}
                    refreshKey={learningRefreshKey}
                />
            )}
        </div>
    )
}
