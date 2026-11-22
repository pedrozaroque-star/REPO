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
 * - Intervención automática de cajera por Headset (`A1` — Fase 15): detecta en `<15 ms` cuando la
 *   cajera abre su línea del headset por cualquiera de 3 vías automáticas — (1) señal física `HME EOS|HD J1,2`
 *   (`/A1 Talk` vía Web Serial `CTS` o interfaz/tecla HID `F9`), (2) voz sostenida en micrófono o Canal 2
 *   estéreo de cajera (`KoreCashierChannelMonitor`), o (3) frase inequívoca de cajera en `inputTranscription`
 *   (`detectKoreCashierVerbalTakeoverCue`) — más botón de respaldo manual. Al activarse, silencia la voz y
 *   herramientas de Kore al instante (`KORE_HUMAN_TAKEOVER_OBSERVER_CUE`), mantiene viva al 100% la
 *   transcripción (`role: 'cashier'` vs `'customer'`) con Smart Latch para el resto del auto (o hasta
 *   presionar `Devolver turno a Kore`) y guarda todo para el autoaprendizaje continuo.
 * - Anti-ruido y modos de voz: incluye `KoreNoiseGate` opcional por umbral RMS (`0.009`, pre-roll `160 ms`,
 *   hangover `448 ms`) para ignorar TV/radio sin recortar inicios de frase ni pausas breves, piso anti-eco
 *   de clips locales calibrado (`0.032`), y modo Push-to-Talk (`audioStreamEnd` inmediato).
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
    ChevronDown, ChevronUp, Search
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { CANONICAL_CUSTOMER_STORES_BY_ID, formatCustomerGreetingTarget, formatCustomerStoreName } from '@/lib/customer-store-names'
import {
    KORE_HUMAN_TAKEOVER_OBSERVER_CUE,
    applyKoreTool,
    buildKoreHumanTakeoverReleaseCue,
    computeKoreTotals,
    createKoreOrderState,
    detectKoreCashierVerbalTakeoverCue,
    detectKoreSpokenLanguage,
    isKoreClosingSendoffText,
    type KoreCashierInterventionMeta,
    type KoreCashierTriggerSource,
    type KoreDriverPickup,
    type KoreMenuItem,
    type KoreOrderState,
    type KoreSessionKind,
} from '@/lib/drive-thru-kore-order'
import {
    detectKoreCustomerHoldRequest,
    detectKoreThirdLanguage,
    endsWithDanglingClauseConnector,
    findUnfulfilledSessionOrderCategories,
    hasUnresolvedCompoundOrderItems,
    isCustomerResumingFromHold,
    isDanglingIncompleteOrderFragment,
    isExplicitBaseLanguageSwitchRequest,
    isLikelyBackgroundMediaSpeech,
    isLikelyKoreSelfEchoTranscript,
    isNonLatinNoiseTranscript,
    matchesThirdLanguageScript,
    shouldBlockUnconfirmedCancelOrder,
    type KoreThirdLanguageCode,
    type KoreThirdLanguageMatch,
} from '@/lib/kore-shared-speech'
import {
    KORE_FAST_CLIP_SPECS,
    matchKoreFastClipForToolOutcome,
    type KoreFastClipCategory,
    type KoreFastClipMatch,
} from '@/lib/drive-thru-kore-fast-match'
import {
    KORE_CAPTURE_PROCESSOR,
    KORE_CHUNK_SAMPLES,
    KORE_DEFAULT_NOISE_GATE_RMS,
    KORE_INPUT_SAMPLE_RATE,
    KORE_NOISE_GATE_FLOOR_MULTIPLIER,
    KoreCashierChannelMonitor,
    KoreHeadsetSignalMonitor,
    KoreNoiseGate,
    KorePlaybackQueue,
    base64ToBytes,
    bytesToBase64,
    computeKoreLatencyStats,
    decodePcm16ToFloat32,
    isKoreWebSerialSupported,
    loadKoreCaptureWorklet,
    mixPcm16Buffers,
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
/** Piso RMS mínimo de barge-in en modo VAD mientras Kore habla sin AGC (bloquea eco/chispazos sin tragarse "Un flan" a 0.032+). */
export const KORE_LOCAL_CLIP_ECHO_RMS_FLOOR = 0.028
/** Segundo refresco automático del panel de aprendizaje tras terminar `after()` en backend. */
export const KORE_POST_SAVE_LEARNING_REFRESH_MS = 3500

export const KORE_BARGE_IN_MIN_CONSECUTIVE_CHUNKS = 4
export const KORE_BARGE_IN_THRESHOLD_MULTIPLIER = 1.30
export const KORE_BARGE_IN_MAX_THRESHOLD_RMS = 0.042
export const KORE_BARGE_IN_PRE_ONSET_CHUNKS = 7
/** Ventana máxima (ms) tras un barge-in local sobre voz viva de Gemini para descartar paquetes modelTurn en vuelo previos a sc.interrupted. */
export const KORE_LIVE_BARGE_IN_RTT_SHIELD_MS = 480
/** Cooldown (ms) entre cortes asistidos por transcripción ante monólogos de TV/YouTube en vivo. */
export const KORE_TRANSCRIPT_TV_CUT_COOLDOWN_MS = 1500
/** Bloques consecutivos sobre `bargeInThreshold` exigidos para cancelar un `autoEnd` con socket aún abierto. */
export const KORE_AUTO_END_CANCEL_CONSECUTIVE_CHUNKS = 3
/** Ventana (ms) tras un arranque truncado o conector colgante ("Hola. Quiero", "...hablar con el", "...es") para continuación suave. */
export const KORE_CONTINUATION_GRACE_WINDOW_MS = 3000
/** Bloques consecutivos requeridos en modo continuación suave (2 × 32 ms = 64 ms). */
export const KORE_CONTINUATION_GRACE_MIN_CHUNKS = 2
/** Umbral RMS reducido en continuación suave (`Math.min(bargeInThreshold, 0.024)`) para retomar palabra en 64 ms bloqueando eco 0.018. */
export const KORE_CONTINUATION_GRACE_RMS_THRESHOLD = 0.024
/** Duración (ms) del modo espera silencioso cuando el cliente pide tiempo ("espérame, estoy pensando", "no me apresures"). */
export const KORE_CUSTOMER_HOLD_STANDBY_MS = 45_000

/** Herramientas de artículos que jamás deben adivinar productos/tamaños ante un arranque truncado ("Quiero una"). */
export const KORE_ITEM_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    'add_item',
    'add_items',
    'update_item',
    'remove_item',
])

/** Bloquea llamadas adivinadas a add_item/add_items/update_item/remove_item cuando el turno del cliente quedó truncado ("Quiero una"). */
export function shouldBlockDanglingFragmentToolCall(toolName: string, customerTurnText: string): boolean {
    if (!KORE_ITEM_MUTATION_TOOL_NAMES.has(toolName)) return false
    const clean = String(customerTurnText ?? '').trim()
    if (!clean) return false
    return isDanglingIncompleteOrderFragment(clean)
}

/**
 * Impide que frases ambiguas de descarte ("Olvídalo entonces.", "Mejor no", "Never mind", "cancelar hablar con el manager")
 * borren una orden activa con artículos ya capturados; permite `cancel_order` cuando hay intención explícita o motivo EBT.
 */
export function shouldBlockAmbiguousCancelOrderToolCall(
    toolName: string,
    args: Record<string, unknown>,
    customerTurnText: string,
    hasActiveOrderLines: boolean
): boolean {
    if (toolName !== 'cancel_order') return false
    if (!hasActiveOrderLines) return false
    const rawReason = typeof args?.reason === 'string' ? args.reason : null
    return shouldBlockUnconfirmedCancelOrder(String(customerTurnText ?? ''), rawReason)
}

/** Evalúa si debe activarse la ventana de continuación suave (64 ms @ 0.015) tras un corte en arranque truncado o conector colgante. */
export function isKoreContinuationGraceActive(
    turnText: string,
    nowMs: number,
    lastSpeechMs: number,
    windowMs = KORE_CONTINUATION_GRACE_WINDOW_MS
): boolean {
    if (!(lastSpeechMs > 0)) return false
    const elapsed = nowMs - lastSpeechMs
    if (elapsed < 0 || elapsed >= windowMs) return false
    const clean = String(turnText ?? '').trim()
    if (!clean) return false
    return isDanglingIncompleteOrderFragment(clean) || endsWithDanglingClauseConnector(clean)
}

export interface KoreCustomerHoldEvaluation {
    holdActive: boolean
    holdUntilMs: number
    activatedOrRenewedHold: boolean
    resumedFromHold: boolean
    suppressGeminiTurn: boolean
    shouldLockNoiseFloor: boolean
    nonLatinNoise: boolean
}

/**
 * Controlador determinista de espera del cliente ("espérame, estoy pensando", "no me apresures"):
 * - Al detectar `detectKoreCustomerHoldRequest(turnText) === true`, permite que Kore confirme brevemente ese turno
 *   y activa una ventana de espera de `45 s` (`KORE_CUSTOMER_HOLD_STANDBY_MS`).
 * - Mientras la espera está vigente, suprime al 100% cualquier respuesta de Kore ante ruido/videos del auto
 *   (`isCustomerResumingFromHold === false`, ej. "de repente me di", "es esta cámara", "जी के", reseñas nocturnas),
 *   y despierta al instante cuando el cliente retoma con una orden, pregunta o cierre real ("Quiero un postre", "un flan").
 * - Además filtra universalmente basura STT sin letras latinas ni dígitos (`isNonLatinNoiseTranscript`) aún fuera de espera.
 */
export class KoreCustomerHoldController {
    private holdUntilMs = 0

    get holdUntilTimestampMs(): number {
        return this.holdUntilMs
    }

    isHoldActive(nowMs: number): boolean {
        return this.holdUntilMs > 0 && Number.isFinite(nowMs) && nowMs < this.holdUntilMs
    }

    reset(): void {
        this.holdUntilMs = 0
    }

    evaluateTurnText(
        turnText: string,
        nowMs: number,
        standbyMs = KORE_CUSTOMER_HOLD_STANDBY_MS,
        activeThirdLangCode: KoreThirdLanguageCode | null = null
    ): KoreCustomerHoldEvaluation {
        const safeNow = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : 0
        if (this.holdUntilMs > 0 && safeNow >= this.holdUntilMs) {
            this.holdUntilMs = 0
        }
        const wasHoldActive = this.holdUntilMs > 0 && safeNow < this.holdUntilMs
        const clean = String(turnText ?? '').trim()
        if (!clean) {
            return {
                holdActive: wasHoldActive,
                holdUntilMs: this.holdUntilMs,
                activatedOrRenewedHold: false,
                resumedFromHold: false,
                suppressGeminiTurn: false,
                shouldLockNoiseFloor: false,
                nonLatinNoise: false,
            }
        }

        if (isNonLatinNoiseTranscript(clean, activeThirdLangCode)) {
            return {
                holdActive: wasHoldActive,
                holdUntilMs: this.holdUntilMs,
                activatedOrRenewedHold: false,
                resumedFromHold: false,
                suppressGeminiTurn: true,
                shouldLockNoiseFloor: true,
                nonLatinNoise: true,
            }
        }

        if (detectKoreCustomerHoldRequest(clean, activeThirdLangCode)) {
            this.holdUntilMs = safeNow + Math.max(1000, standbyMs)
            return {
                holdActive: true,
                holdUntilMs: this.holdUntilMs,
                activatedOrRenewedHold: true,
                resumedFromHold: false,
                suppressGeminiTurn: false,
                shouldLockNoiseFloor: false,
                nonLatinNoise: false,
            }
        }

        if (wasHoldActive) {
            if (isCustomerResumingFromHold(clean, activeThirdLangCode)) {
                this.holdUntilMs = 0
                return {
                    holdActive: false,
                    holdUntilMs: 0,
                    activatedOrRenewedHold: false,
                    resumedFromHold: true,
                    suppressGeminiTurn: false,
                    shouldLockNoiseFloor: false,
                    nonLatinNoise: false,
                }
            }
            return {
                holdActive: true,
                holdUntilMs: this.holdUntilMs,
                activatedOrRenewedHold: false,
                resumedFromHold: false,
                suppressGeminiTurn: true,
                shouldLockNoiseFloor: true,
                nonLatinNoise: false,
            }
        }

        return {
            holdActive: false,
            holdUntilMs: 0,
            activatedOrRenewedHold: false,
            resumedFromHold: false,
            suppressGeminiTurn: false,
            shouldLockNoiseFloor: false,
            nonLatinNoise: false,
        }
    }

    inspectCustomerTurn(
        turnText: string,
        nowMs: number,
        standbyMs = KORE_CUSTOMER_HOLD_STANDBY_MS,
        activeThirdLangCode: KoreThirdLanguageCode | null = null
    ): KoreCustomerHoldEvaluation {
        return this.evaluateTurnText(turnText, nowMs, standbyMs, activeThirdLangCode)
    }
}

/** Cuenta cuántos artículos distintos se agregaron exitosamente en el lote actual de herramientas. */
export function countAddedOrderItemsInToolBatch(
    executedCalls: readonly { name: string; args: Record<string, unknown>; response: Record<string, unknown> }[]
): number {
    let count = 0
    for (const c of executedCalls) {
        if (c.response.ok !== true) continue
        if (c.name === 'add_item') {
            count += 1
        } else if (c.name === 'add_items') {
            if (typeof c.response.added_count === 'number' && Number.isFinite(c.response.added_count) && c.response.added_count > 0) {
                count += c.response.added_count
            } else if (Array.isArray(c.response.added) && c.response.added.length > 0) {
                count += c.response.added.length
            } else if (Array.isArray(c.args.items) && c.args.items.length > 0) {
                count += c.args.items.length
            } else {
                count += 1
            }
        }
    }
    return count
}

/** Reúne en orden cronológico todos los turnos válidos del cliente en la sesión actual (sin duplicar el turno activo ni incluir basura no latina). */
export function collectSessionCustomerTurns(
    transcript: readonly { role: string; text: string }[],
    activeTurnCustomerText = '',
    activeThirdLangCode: KoreThirdLanguageCode | null = null
): string[] {
    const turns: string[] = []
    for (const entry of transcript) {
        if (!entry || entry.role !== 'customer') continue
        const clean = String(entry.text ?? '').trim()
        if (!clean || isNonLatinNoiseTranscript(clean, activeThirdLangCode)) continue
        turns.push(clean)
    }
    const activeClean = String(activeTurnCustomerText ?? '').trim()
    if (
        activeClean &&
        !isNonLatinNoiseTranscript(activeClean, activeThirdLangCode) &&
        turns[turns.length - 1] !== activeClean
    ) {
        turns.push(activeClean)
    }
    return turns
}

/** Impide que un fast-clip parcial (ej. ack_1_super_burrito_asada) calle la pregunta/acción viva de Kore cuando faltan platillos compuestos del turno o de la sesión. */
export function shouldSuppressFastClipForCompoundTurn(params: {
    isTerminalSendoff: boolean
    customerTurnText: string
    addedItemsCount: number
    unfulfilledSessionCategories?: readonly string[] | null
    clipCategory?: KoreFastClipCategory | null
}): boolean {
    if (params.isTerminalSendoff || params.addedItemsCount <= 0) return false
    if (
        Array.isArray(params.unfulfilledSessionCategories) &&
        params.unfulfilledSessionCategories.length > 0 &&
        (params.clipCategory == null || params.clipCategory === 'item_ack')
    ) {
        return true
    }
    return hasUnresolvedCompoundOrderItems(params.customerTurnText, params.addedItemsCount)
}

/** Verifica si todo el lote de herramientas es de solo lectura (search_menu / get_order). */
export function isReadOnlyLookupToolBatch(calls: readonly unknown[]): boolean {
    if (calls.length === 0) return false
    let validCount = 0
    for (const raw of calls) {
        if (!isPlainObject(raw)) continue
        const name = typeof raw.name === 'string' ? raw.name : ''
        if (name !== 'search_menu' && name !== 'get_order') return false
        validCount += 1
    }
    return validCount > 0
}

/** Detecta si Kore ya pronunció una pregunta en el turno actual antes de emitir un lookup de solo lectura. */
export function hasKoreAlreadyAskedQuestionInTurn(
    currentKoreTurnText: string,
    transcript: readonly { role: string; text: string }[]
): boolean {
    if (/[?¿]/.test(currentKoreTurnText)) return true
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
        const entry = transcript[i]
        if (!entry || entry.role === 'system') continue
        if (entry.role === 'kore') {
            return /[?¿]/.test(entry.text)
        }
        break
    }
    return false
}

/** Herramientas mutantes que jamás deben ejecutarse si el turno del micrófono fue 100% TV/YouTube sin orden del cliente. */
export const KORE_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
    'add_item',
    'add_items',
    'update_item',
    'remove_item',
    'confirm_order',
    'cancel_order',
    'end_session',
])

/** Determina si una llamada a herramienta mutante debe bloquearse por espera activa sin retomar, basura no latina o TV/YouTube. */
export function shouldBlockGhostMediaToolCall(
    toolName: string,
    customerTurnText: string,
    holdSuppressed = false,
    activeThirdLangCode: KoreThirdLanguageCode | null = null
): boolean {
    if (!KORE_MUTATING_TOOL_NAMES.has(toolName)) return false
    if (holdSuppressed) return true
    const clean = String(customerTurnText ?? '').trim()
    if (!clean) return false
    return (
        isNonLatinNoiseTranscript(clean, activeThirdLangCode) ||
        isLikelyBackgroundMediaSpeech(clean, activeThirdLangCode)
    )
}

/** Determina si la transcripción parcial/final acumulada amerita anclar el piso anti-TV y cortar el stream de inmediato. */
export function shouldTriggerTranscriptTvCut(
    turnText: string,
    nowMs: number,
    lastCutAtMs: number,
    cooldownMs = KORE_TRANSCRIPT_TV_CUT_COOLDOWN_MS,
    activeThirdLangCode: KoreThirdLanguageCode | null = null
): boolean {
    if (nowMs - lastCutAtMs < cooldownMs) return false
    const clean = String(turnText ?? '').trim()
    if (!clean) return false
    const words = clean.split(/\s+/).filter(Boolean)
    if (words.length < 10) return false
    return isLikelyBackgroundMediaSpeech(clean, activeThirdLangCode)
}

/** Verifica si el WebSocket sigue abierto (`readyState === 1`); tras `fast_sendoff` (`null`) el cierre automático es irrevocable. */
export function isKoreSocketOpenForAutoEndCancel(ws: { readyState: number } | null | undefined): boolean {
    return Boolean(ws && ws.readyState === 1)
}

/** Calcula el umbral RMS de barge-in cercano mientras Kore está hablando en modo VAD sin AGC. */
export function computeKoreBargeInThresholdRms(effectiveGateThresholdRms: number): number {
    const safeEff =
        Number.isFinite(effectiveGateThresholdRms) && effectiveGateThresholdRms > 0
            ? effectiveGateThresholdRms
            : KORE_DEFAULT_NOISE_GATE_RMS
    const estimatedAmbientRms = safeEff / KORE_NOISE_GATE_FLOOR_MULTIPLIER
    return Math.min(
        KORE_BARGE_IN_MAX_THRESHOLD_RMS,
        Math.max(KORE_LOCAL_CLIP_ECHO_RMS_FLOOR, estimatedAmbientRms * KORE_BARGE_IN_THRESHOLD_MULTIPLIER)
    )
}

export interface KoreBargeInGuardStep {
    suppressed: boolean
    justTriggeredBargeIn: boolean
    bargeInLatched: boolean
    bargeInThresholdRms: number
    chunksToForward: ArrayBuffer[]
}

/**
 * Escudo anti-barge-in mientras Kore habla (`playbackActive === true && micMode === 'vad'`):
 * - Impide que TV/YouTube de fondo (`RMS ~0.012–0.030`) o picos aislados disparen
 *   `serverContent.interrupted = true` cortando la voz de Kore a media frase ("Para el burrito,").
 * - Exige `>= 4` bloques consecutivos (128 ms) sobre `bargeInThreshold` (`0.028–0.042`) en modo normal para bloquear
 *   al 100% chispazos de 1 sílaba ("e", "Dra.", "luego", `1–3` bloques = `32–96 ms`), volcando íntegros los `6` bloques
 *   de pre-ataque (`192 ms`) al abrir en el 4.º bloque de "Un flan" (`RMS 0.032`).
 * - Cuando `continuationGraceActive = true` (conector colgante en los últimos `3000 ms`), abre en `2` bloques (`64 ms`)
 *   con umbral `Math.min(bargeInThreshold, 0.024)` para retomar la palabra de inmediato sin dejar pasar eco `0.018`.
 */
export interface KorePlaybackBargeInGuardOptions {
    continuationGraceActive?: boolean
    minConsecutiveChunks?: number
    thresholdOverrideRms?: number
    outputRms?: number
    playbackElapsedMs?: number
}

export class KorePlaybackBargeInGuard {
    private latched = false
    private consecutiveAbove = 0
    private preOnsetQueue: ArrayBuffer[] = []
    private onsetChunks: ArrayBuffer[] = []
    private learnedEchoRms = 0
    private silenceCache = new Map<number, ArrayBuffer>()

    get isLatched(): boolean {
        return this.latched
    }

    get learnedEchoFloorRms(): number {
        return this.learnedEchoRms
    }

    get hasPendingState(): boolean {
        return this.latched || this.consecutiveAbove > 0 || this.preOnsetQueue.length > 0
    }

    /** Calibra hacia arriba el piso de auto-eco aprendido de la bocina en la sesión actual (techo 0.075). */
    bumpLearnedEchoFloor(rms: number): number {
        const safe = Number.isFinite(rms) && rms > 0 ? rms : 0
        if (safe > 0) {
            this.learnedEchoRms = Math.min(0.075, Math.max(this.learnedEchoRms, safe))
        }
        return this.learnedEchoRms
    }

    reset(): void {
        this.latched = false
        this.consecutiveAbove = 0
        this.preOnsetQueue = []
        this.onsetChunks = []
    }

    /** Limpieza completa al iniciar o cerrar sesión de un vehículo (borra también learnedEchoRms). */
    resetSession(): void {
        this.reset()
        this.learnedEchoRms = 0
    }

    private getSilence(byteLength: number): ArrayBuffer {
        let buf = this.silenceCache.get(byteLength)
        if (!buf) {
            buf = new ArrayBuffer(byteLength)
            this.silenceCache.set(byteLength, buf)
        }
        return buf
    }

    processDuringPlayback(
        pcm: ArrayBuffer,
        rms: number,
        effectiveGateThresholdRms: number,
        opts?: KorePlaybackBargeInGuardOptions
    ): KoreBargeInGuardStep {
        const grace = opts?.continuationGraceActive === true
        const safeOutputRms =
            typeof opts?.outputRms === 'number' && Number.isFinite(opts.outputRms) && opts.outputRms > 0
                ? opts.outputRms
                : 0
        const playbackElapsedMs =
            typeof opts?.playbackElapsedMs === 'number' && Number.isFinite(opts.playbackElapsedMs)
                ? opts.playbackElapsedMs
                : 9999
        const baseThreshold = computeKoreBargeInThresholdRms(effectiveGateThresholdRms)

        let autoThreshold: number
        let autoRequiredChunks: number
        if (!grace && playbackElapsedMs >= 0 && playbackElapsedMs < 650) {
            // Régimen 1: ventana inicial de convergencia AEC (0–650 ms del saludo "¡Bienvenido a Tacos Gavilan!")
            autoThreshold = Math.max(baseThreshold, safeOutputRms * 0.55, 0.085)
            autoRequiredChunks = 6
        } else if (!grace && playbackElapsedMs >= 650 && safeOutputRms >= 0.055) {
            // Régimen 2: sílabas fuertes activas en bocina (outputRms >= 0.055) -> acoplado a energía de salida
            autoThreshold = Math.min(
                0.095,
                Math.max(baseThreshold, safeOutputRms * 0.38, this.learnedEchoRms * 1.30, 0.052)
            )
            autoRequiredChunks = 6
        } else {
            // Régimen 3: cola de pregunta / pausa entre frases (outputRms < 0.055 o continuación suave) -> preserva "Un flan" @ 0.032
            autoThreshold = grace
                ? Math.min(baseThreshold, KORE_CONTINUATION_GRACE_RMS_THRESHOLD)
                : Math.max(baseThreshold, this.learnedEchoRms * 1.25)
            autoRequiredChunks = grace
                ? KORE_CONTINUATION_GRACE_MIN_CHUNKS
                : KORE_BARGE_IN_MIN_CONSECUTIVE_CHUNKS
        }

        const threshold =
            typeof opts?.thresholdOverrideRms === 'number' &&
            Number.isFinite(opts.thresholdOverrideRms) &&
            opts.thresholdOverrideRms > 0
                ? opts.thresholdOverrideRms
                : autoThreshold
        const requiredChunks =
            typeof opts?.minConsecutiveChunks === 'number' &&
            Number.isInteger(opts.minConsecutiveChunks) &&
            opts.minConsecutiveChunks >= 1
                ? opts.minConsecutiveChunks
                : autoRequiredChunks
        if (this.latched) {
            return {
                suppressed: false,
                justTriggeredBargeIn: false,
                bargeInLatched: true,
                bargeInThresholdRms: threshold,
                chunksToForward: [pcm],
            }
        }

        const safeRms = Number.isFinite(rms) && rms >= 0 ? rms : 0
        if (safeRms >= threshold) {
            this.consecutiveAbove += 1
            this.onsetChunks.push(pcm.slice(0))
            if (this.consecutiveAbove >= requiredChunks) {
                this.latched = true
                const flushed = [...this.preOnsetQueue, ...this.onsetChunks]
                this.preOnsetQueue = []
                this.onsetChunks = []
                return {
                    suppressed: false,
                    justTriggeredBargeIn: true,
                    bargeInLatched: true,
                    bargeInThresholdRms: threshold,
                    chunksToForward: flushed,
                }
            }
            return {
                suppressed: true,
                justTriggeredBargeIn: false,
                bargeInLatched: false,
                bargeInThresholdRms: threshold,
                chunksToForward: [this.getSilence(pcm.byteLength)],
            }
        }

        if (this.onsetChunks.length > 0) {
            this.preOnsetQueue.push(...this.onsetChunks)
            this.onsetChunks = []
        }
        this.consecutiveAbove = 0
        this.preOnsetQueue.push(pcm.slice(0))
        while (this.preOnsetQueue.length > KORE_BARGE_IN_PRE_ONSET_CHUNKS) {
            this.preOnsetQueue.shift()
        }
        return {
            suppressed: true,
            justTriggeredBargeIn: false,
            bargeInLatched: false,
            bargeInThresholdRms: threshold,
            chunksToForward: [this.getSilence(pcm.byteLength)],
        }
    }

    process(
        pcm: ArrayBuffer,
        rms: number,
        effectiveGateThresholdRms: number,
        opts?: KorePlaybackBargeInGuardOptions
    ): KoreBargeInGuardStep {
        return this.processDuringPlayback(pcm, rms, effectiveGateThresholdRms, opts)
    }
}

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

/** Evalúa el siguiente idioma activo de la sesión a partir de lo hablado por el cliente (ignorando basura STT no latina). */
export function resolveNextKoreSessionLang(
    text: string,
    currentLang: 'es' | 'en',
    activeThirdLangCode: KoreThirdLanguageCode | null = null
): 'es' | 'en' {
    const clean = String(text ?? '').trim()
    if (!clean || isNonLatinNoiseTranscript(clean, activeThirdLangCode)) return currentLang
    return detectKoreSpokenLanguage(clean, currentLang)
}

const NON_LATIN_THIRD_LANG_CODES: ReadonlySet<KoreThirdLanguageCode> = new Set([
    'ja',
    'ko',
    'zh',
    'ar',
    'ru',
    'hi',
    'hy',
])

const NEUTRAL_MENU_LOANWORD_ONLY_RE =
    /^\s*(?:(?:el|la|los|las|un|una)\s+)?(?:tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|platos?|plates?|taco\s+plates?|super\s+nachos?|nachos?|asada|pastor|adobada|pollo|chicken|steak|beef|pork|cabeza|lengua|buche|chorizo|carnitas|veggie|vegetariano|vegetariana|super|súper|supreme|regular|horchata|jamaica|tamarindo|pina|piña|champurrado|coffee|cafe|café|coca|coke|sprite|fanta|jarritos|agua|flan|cheesecake|medium|mediana|large|grande|gallon|galon|corn|maiz|maíz|flour|harina|ok|okay|yes|no|\d+)[\s.,!?]*$/i

/** Evidencia clara de saludo, cortesía, pedido o dominio de restaurante en inglés antes de voltear automáticamente de 'es' a 'en'. */
const CLEAR_ENGLISH_AUTO_SWITCH_INTENT_RE =
    /\b(?:hi|hello|hey\s+there|good\s+(?:morning|afternoon|evening)|excuse\s+me|please|thank\s+you|thanks|can\s+i\s+(?:get|have|order|add|do)|could\s+i\s+(?:get|have|order|add)|may\s+i\s+(?:get|have|order)|let\s+me\s+(?:get|have|do)|give\s+me|gimme|i\s+(?:want|would\s+like|need|ordered|will\s+take)|i['’]?d\s+like|i['’]?ll\s+(?:take|have|do|get)|we['’]?ll\s+(?:take|have|get)|we\s+(?:want|would\s+like|need)|make\s+it|add\s+(?:some|extra|a|one|two|three)|take\s+off|remove\s+the|without\s+(?:onion|onions|cilantro|cheese|beans|rice|salsa|cream|sour\s+cream|guacamole)|no\s+(?:onion|onions|cilantro|cheese|beans|rice|salsa|sour\s+cream|guacamole)|that['’]?s\s+(?:all|it|everything|right|correct)|nothing\s+else|all\s+set|hold\s+on|one\s+(?:moment|second|minute)|just\s+a\s+(?:moment|second|minute)|cancel\s+(?:my|the)\s+order|never\s+mind|tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|plates?|combos?|flan|cheesecake|desserts?|platters?|trays?|breakfast|eggs?|asada|pastor|adobada|pollo|chicken|steak|beef|pork|cabeza|lengua|tongue|buche|chorizo|carnitas|veggie|vegetarian|meat|meats|beans?|rice|cheese|guacamole|avocado|sour\s+cream|cream|onions?|cilantro|salsa|lime|limes|jalapenos?|tortillas?|corn|flour|chips|horchata|jamaica|tamarindo|pineapple|lemonade|champurrado|coffee|coke|sprite|fanta|jarritos|soda|water|drinks?|beverages?|gallon|medium|large|order|orders|ordering|menu|price|prices|how\s+much|cost|total|cash|card|credit|debit|ebt|calfresh|apple\s+pay|receipt|ticket|window|drive[\s-]*thru|dining\s+room|inside|counter|open|close|closed|hours|location|address|doordash|uber\s*eats|uber|grubhub|postmates|pickup|picking\s+up|delivery|driver|manager|hear\s+me)\b/i

const ANY_NON_LATIN_SCRIPT_CHAR_RE =
    /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}\p{Script=Armenian}]/u

/** Verifica si una frase en inglés tiene intención real de cliente (saludo, pedido o dominio de restaurante) para evitar falsos giros como "What's the other three?". */
export function hasClearEnglishCustomerIntentForAutoSwitch(rawText: string): boolean {
    const clean = String(rawText ?? '').trim()
    if (!clean) return false
    return CLEAR_ENGLISH_AUTO_SWITCH_INTENT_RE.test(clean)
}

/**
 * Construye un mensaje `clientContent` para inyectar contexto de sistema/idioma en Gemini Live:
 * - `shouldTriggerModelReply = false` (por defecto): inyecta en silencio (`turnComplete: false`) sin obligar a Kore a hablar.
 * - `shouldTriggerModelReply = true`: usado únicamente en `ARRIVAL_CUE` y `releaseCue` cuando Kore sí debe tomar la palabra.
 */
export function buildSilentContextClientContent(
    cueText: string,
    shouldTriggerModelReply = false
): {
    clientContent: {
        turns: [{ role: 'user'; parts: [{ text: string }] }]
        turnComplete: boolean
    }
} {
    return {
        clientContent: {
            turns: [{ role: 'user', parts: [{ text: String(cueText ?? '').trim() }] }],
            turnComplete: Boolean(shouldTriggerModelReply),
        },
    }
}

/** Retorna `true` si el texto de salida carece de letras y dígitos (ej. `"..."`, `"…"`, `". . ."`, `""`). */
export function isMeaninglessEllipsisOrPunctuationOutput(text: string): boolean {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return true
    return !/[\p{L}\p{N}]/u.test(trimmed)
}

export function buildKoreThirdLangSwitchCue(match: KoreThirdLanguageMatch): string {
    return '[SYSTEM LANGUAGE SWITCH -> ' + match.nameEn.toUpperCase() + ' (' + match.code + ')] Customer is speaking ' + match.nameEn + '. Respond warmly and concisely 100% in natural ' + match.nameEn + ' while keeping Tacos Gavilan menu item names clear, prices strictly in USD dollars ($), and standard POS tool calls.'
}

export function buildKoreThirdLangLockCue(match: KoreThirdLanguageMatch): string {
    return '[SYSTEM LANGUAGE LOCK -> ' + match.nameEn.toUpperCase() + ' (' + match.code + ')] Keep responding 100% in ' + match.nameEn + ' to the customer; ignore background Spanish/English bystander chatter.'
}

export interface KoreLiveLanguageResolution {
    baseLang: 'es' | 'en'
    thirdLang: KoreThirdLanguageMatch | null
    switchCue: string | null
}

export interface ResolveKoreLiveLanguageOptions {
    hadRecentNonLatinNoise?: boolean
}

/**
 * Resuelve y mantiene bloqueado el session_language del vehículo o llamada actual:
 * - Ignora vacíos y basura STT no latina (isNonLatinNoiseTranscript(clean, activeThirdCode)).
 * - Si ya hay un currentThirdLang fijado (ej. ja, ko, zh, pt, fr), mantiene bloqueado currentThirdLang
 *   durante toda la atención de ese auto/llamada; voces externas sin comando explícito de cambio de idioma
 *   (ej. "Las dos se quedaron calladas.", "Asada, por favor") JAMÁS rompen currentThirdLang.
 * - Solo cambia desde currentThirdLang si isExplicitBaseLanguageSwitchRequest(clean) pide explícitamente 'es' / 'en'
 *   (ej. "En español por favor", "In English please") o si detectKoreThirdLanguage(clean) detecta otro 3.er idioma.
 * - En sesión 'es' (`currentThirdLang === null`), exige intención real de restaurante/saludo (`hasClearEnglishCustomerIntentForAutoSwitch`)
 *   antes de auto-cambiar a 'en', y re-bloquea 'es' si tras ruido no latino ("저리서" / "哇") entra una palabra neutra del menú ("chorizo").
 */
export function resolveKoreLiveLanguageState(
    text: string,
    currentBaseLang: 'es' | 'en',
    currentThirdLang: KoreThirdLanguageMatch | null,
    opts?: ResolveKoreLiveLanguageOptions
): KoreLiveLanguageResolution {
    const activeCode = currentThirdLang?.code ?? null
    const clean = String(text ?? '').trim()
    if (!clean || isNonLatinNoiseTranscript(clean, activeCode)) {
        return { baseLang: currentBaseLang, thirdLang: currentThirdLang, switchCue: null }
    }

    if (currentThirdLang !== null) {
        const explicitSwitch = isExplicitBaseLanguageSwitchRequest(clean)
        if (explicitSwitch !== null) {
            return {
                baseLang: explicitSwitch,
                thirdLang: null,
                switchCue: KORE_SYSTEM_LANG_SWITCH_CUE[explicitSwitch],
            }
        }
    }

    const detectedThird = detectKoreThirdLanguage(clean)
    if (detectedThird) {
        const changed = currentThirdLang?.code !== detectedThird.code
        return {
            baseLang: currentBaseLang,
            thirdLang: detectedThird,
            switchCue: changed ? buildKoreThirdLangSwitchCue(detectedThird) : null,
        }
    }

    if (currentThirdLang !== null) {
        const isNonLatinSession = NON_LATIN_THIRD_LANG_CODES.has(currentThirdLang.code)
        const hasLatinChars = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(clean)
        const hasClientScript = matchesThirdLanguageScript(clean, currentThirdLang.code)
        const shouldReinforceLock =
            isNonLatinSession &&
            hasLatinChars &&
            !hasClientScript &&
            !NEUTRAL_MENU_LOANWORD_ONLY_RE.test(clean)
        return {
            baseLang: currentBaseLang,
            thirdLang: currentThirdLang,
            switchCue: shouldReinforceLock ? buildKoreThirdLangLockCue(currentThirdLang) : null,
        }
    }

    const explicitFromBase = isExplicitBaseLanguageSwitchRequest(clean)
    if (explicitFromBase !== null && explicitFromBase !== currentBaseLang) {
        return {
            baseLang: explicitFromBase,
            thirdLang: null,
            switchCue: KORE_SYSTEM_LANG_SWITCH_CUE[explicitFromBase],
        }
    }

    const nextBase = detectKoreSpokenLanguage(clean, currentBaseLang)
    if (nextBase !== currentBaseLang) {
        if (
            currentBaseLang === 'es' &&
            nextBase === 'en' &&
            !hasClearEnglishCustomerIntentForAutoSwitch(clean)
        ) {
            return {
                baseLang: 'es',
                thirdLang: null,
                switchCue: opts?.hadRecentNonLatinNoise ? KORE_SYSTEM_LANG_SWITCH_CUE.es : null,
            }
        }
        return {
            baseLang: nextBase,
            thirdLang: null,
            switchCue: KORE_SYSTEM_LANG_SWITCH_CUE[nextBase],
        }
    }

    if (
        currentBaseLang === 'es' &&
        opts?.hadRecentNonLatinNoise === true &&
        NEUTRAL_MENU_LOANWORD_ONLY_RE.test(clean)
    ) {
        return {
            baseLang: 'es',
            thirdLang: null,
            switchCue: KORE_SYSTEM_LANG_SWITCH_CUE.es,
        }
    }
    return { baseLang: currentBaseLang, thirdLang: null, switchCue: null }
}

/** Valor centinela en el selector de canal secundario para leer el Canal 2 (Right) de una interfaz USB estéreo. */
export const KORE_STEREO_RIGHT_CHANNEL_ID = '__stereo_right__'

/** Ventana de gracia (ms) tras soltar A1 / terminar VAD de cajera para que el paquete final de transcripción siga siendo 'cashier'. */
export const KORE_CASHIER_SPEECH_GRACE_MS = 900

export function createEmptyKoreCashierMeta(): KoreCashierInterventionMeta {
    return {
        triggered: false,
        triggerSource: null,
        triggeredAt: null,
        resumedToKoreCount: 0,
        cashierTurnCount: 0,
    }
}

/** Sintetiza los turnos hablados durante la intervención de cajera para inyectarlos al devolver el control a Kore. */
export function buildKoreTakeoverTranscriptSummary(
    entries: readonly { role: string; text: string }[],
    lang: 'es' | 'en'
): string {
    const parts: string[] = []
    for (const entry of entries) {
        const clean = String(entry.text ?? '').replace(/\s+/g, ' ').trim()
        if (!clean) continue
        if (entry.role === 'cashier') {
            parts.push(lang === 'en' ? `Cashier: ${clean}` : `Cajera: ${clean}`)
        } else if (entry.role === 'customer') {
            parts.push(lang === 'en' ? `Customer: ${clean}` : `Cliente: ${clean}`)
        }
    }
    return parts.join(' | ').slice(0, 850)
}

/**
 * Controlador puro de sesión para la intervención automática de cajera (`A1` Headset Takeover):
 * gestiona los 4 orígenes de disparo, el Smart Latch por vehículo, la atribución de rol (`cashier` vs `customer`),
 * la promoción de burbuja abierta ante `verbal_cue` y la devolución opcional del turno a Kore.
 */
export class KoreCashierSessionController {
    private active = false
    private speaking = false
    private verbalCueActive = false
    private attributionUntilMs = 0
    private takeoverStartIdx = 0
    private meta: KoreCashierInterventionMeta = createEmptyKoreCashierMeta()

    get isActive(): boolean {
        return this.active
    }

    get isCashierSpeaking(): boolean {
        return this.speaking
    }

    get currentMeta(): KoreCashierInterventionMeta {
        return { ...this.meta }
    }

    reset(): void {
        this.active = false
        this.speaking = false
        this.verbalCueActive = false
        this.attributionUntilMs = 0
        this.takeoverStartIdx = 0
        this.meta = createEmptyKoreCashierMeta()
    }

    engage(
        source: KoreCashierTriggerSource,
        nowMs: number,
        currentTranscriptLen: number,
        opts?: { markSpeaking?: boolean; isoNow?: string }
    ): { newlyActivated: boolean; sendObserverCue: boolean; meta: KoreCashierInterventionMeta } {
        let newlyActivated = false
        if (!this.active) {
            this.active = true
            newlyActivated = true
            this.takeoverStartIdx = Math.max(0, currentTranscriptLen)
            if (!this.meta.triggered) {
                this.meta = {
                    ...this.meta,
                    triggered: true,
                    triggerSource: source,
                    triggeredAt: opts?.isoNow ?? new Date().toISOString(),
                }
            }
        }
        if (opts?.markSpeaking) {
            this.speaking = true
            this.attributionUntilMs = Number.POSITIVE_INFINITY
        }
        return {
            newlyActivated,
            sendObserverCue: newlyActivated,
            meta: { ...this.meta },
        }
    }

    setPhysicalSpeaking(
        speaking: boolean,
        source: 'headset_signal' | 'cashier_mic_vad',
        nowMs: number,
        currentTranscriptLen: number,
        isoNow?: string
    ): { newlyActivated: boolean; sendObserverCue: boolean; speakingChanged: boolean; meta: KoreCashierInterventionMeta } {
        if (speaking) {
            const prevSpeaking = this.speaking
            const res = this.engage(source, nowMs, currentTranscriptLen, { markSpeaking: true, isoNow })
            return {
                ...res,
                speakingChanged: !prevSpeaking,
            }
        }
        const prevSpeaking = this.speaking
        this.speaking = false
        if (prevSpeaking) {
            this.attributionUntilMs = nowMs + KORE_CASHIER_SPEECH_GRACE_MS
        }
        return {
            newlyActivated: false,
            sendObserverCue: false,
            speakingChanged: prevSpeaking,
            meta: { ...this.meta },
        }
    }

    inspectInputText(
        combinedTurnText: string,
        nowMs: number,
        currentTranscriptLen: number,
        hasOpenCustomerBubble: boolean,
        isoNow?: string
    ): {
        triggeredVerbalCue: boolean
        newlyActivated: boolean
        sendObserverCue: boolean
        promoteOpenCustomerBubble: boolean
        role: 'cashier' | 'customer'
        meta: KoreCashierInterventionMeta
    } {
        let newlyActivated = false
        let sendObserverCue = false
        let triggeredVerbalCue = false
        let promoteOpenCustomerBubble = false

        if (detectKoreCashierVerbalTakeoverCue(combinedTurnText)) {
            triggeredVerbalCue = !this.verbalCueActive
            this.verbalCueActive = true
            const startIdx = hasOpenCustomerBubble ? Math.max(0, currentTranscriptLen - 1) : currentTranscriptLen
            const engaged = this.engage('verbal_cue', nowMs, startIdx, { isoNow })
            newlyActivated = engaged.newlyActivated
            sendObserverCue = engaged.sendObserverCue
            promoteOpenCustomerBubble = hasOpenCustomerBubble
        }

        const isCashier =
            this.active &&
            (this.speaking || this.verbalCueActive || nowMs <= this.attributionUntilMs)

        return {
            triggeredVerbalCue,
            newlyActivated,
            sendObserverCue,
            promoteOpenCustomerBubble,
            role: isCashier ? 'cashier' : 'customer',
            meta: { ...this.meta },
        }
    }

    recordNewCashierBubble(): KoreCashierInterventionMeta {
        this.meta = {
            ...this.meta,
            triggered: true,
            cashierTurnCount: this.meta.cashierTurnCount + 1,
        }
        return { ...this.meta }
    }

    onTurnComplete(): void {
        this.verbalCueActive = false
        if (!this.speaking) {
            this.attributionUntilMs = 0
        }
    }

    releaseToKore(
        lang: 'es' | 'en',
        transcriptEntries: readonly { role: string; text: string }[]
    ): { released: boolean; releaseCue: string; summary: string; meta: KoreCashierInterventionMeta } {
        if (!this.active) {
            return { released: false, releaseCue: '', summary: '', meta: { ...this.meta } }
        }
        const slice = transcriptEntries.slice(this.takeoverStartIdx)
        const summary = buildKoreTakeoverTranscriptSummary(slice, lang)
        const releaseCue = buildKoreHumanTakeoverReleaseCue(lang, summary)
        this.active = false
        this.speaking = false
        this.verbalCueActive = false
        this.attributionUntilMs = 0
        this.meta = {
            ...this.meta,
            resumedToKoreCount: this.meta.resumedToKoreCount + 1,
        }
        return {
            released: true,
            releaseCue,
            summary,
            meta: { ...this.meta },
        }
    }
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
type TranscriptRole = 'customer' | 'kore' | 'cashier' | 'system'

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
    order?: { cashierIntervention?: { triggered?: boolean } | null } | null
    transcript?: { role?: string; text?: string }[]
}

interface MicChunkMessage {
    pcm: ArrayBuffer
    rms: number
    rightRms?: number
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

/** Límite seguro por página (36 situaciones = máx 72 clips <= 2.6 MB, bajo el tope de 4.5 MB de Vercel). */
export const KORE_FAST_CLIPS_PAGE_LIMIT = 36

/** Concurrencia controlada para hidratar páginas secundarias del banco de audios en segundo plano. */
export const KORE_FAST_CLIPS_BG_CONCURRENCY = 2

export interface KoreFastClipsPagination {
    offset: number
    limit: number
    totalSituations: number
    hasMore: boolean
    nextOffset: number | null
}

/** Pre-decodifica una página de `/api/drive-thru/kore/fast-clips` a RAM (`Float32Array`) + estadísticas + paginación. */
export function decodeKoreFastClipsPayload(data: unknown): {
    map: Map<string, KoreDecodedFastClipPair>
    stats: KoreFastClipsStats | null
    pagination: KoreFastClipsPagination | null
} {
    const map = new Map<string, KoreDecodedFastClipPair>()
    if (!isPlainObject(data)) return { map, stats: null, pagination: null }
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
                  topDriveThruItems: topItems.slice(0, 16),
              }
            : null

    let pagination: KoreFastClipsPagination | null = null
    if (isPlainObject(data.pagination)) {
        const rawPag = data.pagination
        const offset =
            typeof rawPag.offset === 'number' && Number.isFinite(rawPag.offset) && rawPag.offset >= 0
                ? Math.round(rawPag.offset)
                : 0
        const limit =
            typeof rawPag.limit === 'number' && Number.isFinite(rawPag.limit) && rawPag.limit > 0
                ? Math.round(rawPag.limit)
                : KORE_FAST_CLIPS_PAGE_LIMIT
        const totalSituations =
            typeof rawPag.totalSituations === 'number' && Number.isFinite(rawPag.totalSituations) && rawPag.totalSituations >= 0
                ? Math.round(rawPag.totalSituations)
                : Math.round(totalClips / 2)
        const nextOffset =
            typeof rawPag.nextOffset === 'number' && Number.isFinite(rawPag.nextOffset) && rawPag.nextOffset > offset
                ? Math.round(rawPag.nextOffset)
                : null
        const hasMore = Boolean(rawPag.hasMore) && (nextOffset !== null || offset + limit < totalSituations)
        pagination = { offset, limit, totalSituations, hasMore, nextOffset }
    }
    return { map, stats, pagination }
}

/** Fusiona progresivamente pares decodificados (`Float32Array`) sin vaciar ni reemplazar entradas ya hidratadas. */
export function mergeKoreDecodedFastClipsMap(
    target: Map<string, KoreDecodedFastClipPair>,
    incoming: ReadonlyMap<string, KoreDecodedFastClipPair>
): void {
    for (const [clipId, pair] of incoming.entries()) {
        const prev = target.get(clipId)
        if (!prev) {
            target.set(clipId, { es: pair.es, en: pair.en })
        } else {
            target.set(clipId, {
                es: pair.es ?? prev.es,
                en: pair.en ?? prev.en,
            })
        }
    }
}

export interface KorePaginatedFastClipsCallbacks {
    storeId: number
    pageLimit?: number
    concurrency?: number
    signal: AbortSignal
    fetchPage?: (url: string, signal: AbortSignal) => Promise<unknown>
    onPage0?: (payload: {
        map: Map<string, KoreDecodedFastClipPair>
        stats: KoreFastClipsStats | null
        pagination: KoreFastClipsPagination | null
    }) => void
    onBackgroundPage?: (payload: {
        map: Map<string, KoreDecodedFastClipPair>
        stats: KoreFastClipsStats | null
        loadedSituations: number
        totalSituations: number
    }) => void
}

/**
 * Hidrata en RAM el banco completo de voces `Kore 3.8` de forma paginada (segura bajo el límite de 4.5 MB de Vercel):
 * 1) Descarga primero Página 0 (`offset=0&limit=36`) e hidrata al instante bienvenidas, aclaraciones, reglas, despedidas y stats (`288/288`).
 * 2) Si `pagination.hasMore`, descarga en segundo plano las páginas restantes (`offset = 36, 72, 108...`) con concurrencia `2`
 *    y cancelación limpia vía `AbortSignal`.
 */
export async function hydrateKoreFastClipsPaginated(
    opts: KorePaginatedFastClipsCallbacks
): Promise<{ map: Map<string, KoreDecodedFastClipPair>; stats: KoreFastClipsStats | null; aborted: boolean }> {
    const pageLimit = Math.max(1, Math.round(opts.pageLimit ?? KORE_FAST_CLIPS_PAGE_LIMIT))
    const concurrency = Math.max(1, Math.min(4, Math.round(opts.concurrency ?? KORE_FAST_CLIPS_BG_CONCURRENCY)))
    const defaultFetchPage = async (url: string, sig: AbortSignal): Promise<unknown> => {
        const res = await fetch(url, { headers: getAuthHeaders(), signal: sig })
        if (!res.ok) return null
        return res.json().catch(() => null)
    }
    const fetchPage = opts.fetchPage ?? defaultFetchPage
    const buildUrl = (offset: number) =>
        `/api/drive-thru/kore/fast-clips?storeId=${opts.storeId}&offset=${offset}&limit=${pageLimit}`

    if (opts.signal.aborted) {
        return { map: new Map(), stats: null, aborted: true }
    }

    let rawPage0: unknown = null
    try {
        rawPage0 = await fetchPage(buildUrl(0), opts.signal)
    } catch {
        return { map: new Map(), stats: null, aborted: opts.signal.aborted }
    }
    if (opts.signal.aborted || !isPlainObject(rawPage0)) {
        return { map: new Map(), stats: null, aborted: opts.signal.aborted }
    }

    const decoded0 = decodeKoreFastClipsPayload(rawPage0)
    const accumulatedMap = new Map<string, KoreDecodedFastClipPair>(decoded0.map)
    let latestStats = decoded0.stats

    opts.onPage0?.({
        map: accumulatedMap,
        stats: latestStats,
        pagination: decoded0.pagination,
    })

    const pag0 = decoded0.pagination
    if (!pag0 || !pag0.hasMore) {
        return { map: accumulatedMap, stats: latestStats, aborted: false }
    }

    const stepLimit = pag0.limit > 0 ? pag0.limit : pageLimit
    const totalSituations =
        pag0.totalSituations > stepLimit
            ? pag0.totalSituations
            : latestStats && latestStats.totalClips > 0
                ? Math.round(latestStats.totalClips / 2)
                : 0

    if (totalSituations > stepLimit) {
        const offsets: number[] = []
        const startOffset = pag0.nextOffset ?? stepLimit
        for (let off = startOffset; off < totalSituations && offsets.length < 24; off += stepLimit) {
            offsets.push(off)
        }
        let cursor = 0
        const worker = async () => {
            while (!opts.signal.aborted) {
                const idx = cursor++
                if (idx >= offsets.length) return
                const off = offsets[idx]
                try {
                    const pageRaw = await fetchPage(buildUrl(off), opts.signal)
                    if (opts.signal.aborted || !isPlainObject(pageRaw)) continue
                    const pageDecoded = decodeKoreFastClipsPayload(pageRaw)
                    mergeKoreDecodedFastClipsMap(accumulatedMap, pageDecoded.map)
                    if (pageDecoded.stats) latestStats = pageDecoded.stats
                    opts.onBackgroundPage?.({
                        map: accumulatedMap,
                        stats: latestStats,
                        loadedSituations: accumulatedMap.size,
                        totalSituations,
                    })
                } catch {
                    if (opts.signal.aborted) return
                }
            }
        }
        const workerCount = Math.min(concurrency, offsets.length)
        await Promise.all(Array.from({ length: workerCount }, () => worker()))
    } else {
        // Respaldo secuencial si pagination no trajo totalSituations pero sí nextOffset
        let nextOff = pag0.nextOffset
        let safety = 0
        while (!opts.signal.aborted && nextOff !== null && safety < 24) {
            safety += 1
            try {
                const pageRaw = await fetchPage(buildUrl(nextOff), opts.signal)
                if (opts.signal.aborted || !isPlainObject(pageRaw)) break
                const pageDecoded = decodeKoreFastClipsPayload(pageRaw)
                mergeKoreDecodedFastClipsMap(accumulatedMap, pageDecoded.map)
                if (pageDecoded.stats) latestStats = pageDecoded.stats
                opts.onBackgroundPage?.({
                    map: accumulatedMap,
                    stats: latestStats,
                    loadedSituations: accumulatedMap.size,
                    totalSituations: Math.max(accumulatedMap.size, totalSituations),
                })
                if (!pageDecoded.pagination?.hasMore) break
                nextOff = pageDecoded.pagination.nextOffset
            } catch {
                break
            }
        }
    }

    return { map: accumulatedMap, stats: latestStats, aborted: opts.signal.aborted }
}

export type KoreFastClipCatalogGroup = 'greeting' | 'item_ack' | 'clarify' | 'modifiers' | 'ops' | 'sendoff'
export type KoreFastClipCatalogFilter = 'all' | KoreFastClipCatalogGroup

export interface KoreFastClipCatalogRow {
    clipId: string
    category: 'greeting' | KoreFastClipCategory
    group: KoreFastClipCatalogGroup
    greetingNum?: number
    textEs: string
    textEn: string
    hasEs: boolean
    hasEn: boolean
}

/**
 * Clasifica cada situación bilingüe en exactamente uno de los 6 grupos visuales del catálogo:
 * `greeting`, `item_ack` (Platillos Top DT), `clarify` (Aclaraciones), `modifiers` (Modificadores / Cortesías),
 * `ops` (Repartidores y Reglas) o `sendoff` (Despedidas).
 */
export function classifyKoreFastClipGroup(
    clipId: string,
    category: 'greeting' | KoreFastClipCategory,
    textEs = '',
    textEn = ''
): KoreFastClipCatalogGroup {
    if (category === 'greeting' || clipId.startsWith('greeting')) return 'greeting'
    if (category === 'clarify' || clipId.startsWith('clarify_')) return 'clarify'
    if (category === 'sendoff' || clipId.startsWith('sendoff_')) return 'sendoff'
    if (
        /^(?:mod_|modifier_|update_|removed_ack_|courtesy_|cortesia_)/i.test(clipId) ||
        (category === 'item_ack' &&
            (/(?:^|_)(?:cebolla_asada|frijol_(?:de_la_)?olla|cortesia|courtesy)(?:_|$)/i.test(clipId) ||
                /\bcortes[ií]a\b|\bsin costo\b|\bfree courtesy\b|\bno charge\b/i.test(`${textEs} ${textEn}`)))
    ) {
        return 'modifiers'
    }
    if (category === 'item_ack') return 'item_ack'
    return 'ops'
}

function normalizeFastClipSearchText(raw: string): string {
    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
}

/** Filtra instantáneamente el catálogo por grupo visual y búsqueda libre (ES, EN o clipId, sin importar acentos). */
export function filterKoreFastClipCatalogRows(
    rows: readonly KoreFastClipCatalogRow[],
    groupFilter: KoreFastClipCatalogFilter,
    searchQuery: string
): KoreFastClipCatalogRow[] {
    const byGroup = groupFilter === 'all' ? rows : rows.filter(r => r.group === groupFilter)
    const normQuery = normalizeFastClipSearchText(searchQuery)
    if (!normQuery) return [...byGroup]
    const tokens = normQuery.split(/\s+/).filter(Boolean)
    return byGroup.filter(row => {
        const haystack = normalizeFastClipSearchText(`${row.clipId} ${row.textEs} ${row.textEn}`)
        return tokens.every(tok => haystack.includes(tok))
    })
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
                group: 'greeting',
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
        const textEs = pair?.es?.text || spec.textEs
        const textEn = pair?.en?.text || spec.textEn
        rows.push({
            clipId: spec.clipId,
            category: spec.category,
            group: classifyKoreFastClipGroup(spec.clipId, spec.category, textEs, textEn),
            textEs,
            textEn,
            hasEs: Boolean(pair?.es && pair.es.samples.length > 0),
            hasEn: Boolean(pair?.en && pair.en.samples.length > 0),
        })
    }
    for (const [clipId, pair] of map.entries()) {
        if (seen.has(clipId)) continue
        const inferredCat: 'greeting' | KoreFastClipCategory = clipId.startsWith('greeting')
            ? 'greeting'
            : clipId.startsWith('clarify_')
                ? 'clarify'
                : clipId.startsWith('sendoff_')
                    ? 'sendoff'
                    : clipId.startsWith('ack_') || clipId.startsWith('added_ack_') || clipId.startsWith('combo_')
                        ? 'item_ack'
                        : 'ops'
        const textEs = pair.es?.text || '—'
        const textEn = pair.en?.text || '—'
        rows.push({
            clipId,
            category: inferredCat,
            group: classifyKoreFastClipGroup(clipId, inferredCat, textEs, textEn),
            textEs,
            textEn,
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
    thirdLanguage?: KoreThirdLanguageMatch | null
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
        ...(deps.thirdLanguage ? { thirdLanguage: deps.thirdLanguage } : {}),
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
    const [fastClipsSearch, setFastClipsSearch] = useState('')
    const [fastClipsHydratingBg, setFastClipsHydratingBg] = useState<{ loaded: number; total: number } | null>(null)
    const [previewingClipKey, setPreviewingClipKey] = useState<string | null>(null)
    const [cashierTakeoverActive, setCashierTakeoverActive] = useState(false)
    const [cashierSpeaking, setCashierSpeaking] = useState(false)
    const [cashierTriggerSource, setCashierTriggerSource] = useState<KoreCashierTriggerSource | null>(null)
    const [showCashierConfig, setShowCashierConfig] = useState(false)
    const [cashierChannelId, setCashierChannelId] = useState<string>('')
    const [audioInputDevices, setAudioInputDevices] = useState<{ deviceId: string; label: string }[]>([])
    const [serialConnected, setSerialConnected] = useState(false)
    const [serialSupported, setSerialSupported] = useState(false)

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
    const lastCompletedCustomerTurnTextRef = useRef('')
    const customerTurnFreshRef = useRef(true)
    const confirmedOrderInCurrentTurnRef = useRef(false)
    const lastTranscriptTvCutMsRef = useRef(0)
    const lastCustomerSpeechTimestampMsRef = useRef(0)
    const recentRawMicRmsRef = useRef(0)
    const autoEndCancelConsecRef = useRef(0)
    const langCueTimerRef = useRef<number | null>(null)
    const activeThirdLangRef = useRef<KoreThirdLanguageMatch | null>(null)
    const fastClipsMapRef = useRef<Map<string, KoreDecodedFastClipPair>>(new Map())
    const fastClipsStoreIdRef = useRef<number>(0)
    const fastClipsInflightStoreIdRef = useRef<number>(0)
    const fastClipsAbortRef = useRef<AbortController | null>(null)
    const fastClipsReqRef = useRef(0)
    const suppressGeminiTurnAudioRef = useRef(false)
    const localFastClipStartedAtRef = useRef(0)
    const customerSpokeSinceFastClipRef = useRef(false)
    const bargeInGuardRef = useRef<KorePlaybackBargeInGuard>(new KorePlaybackBargeInGuard())
    const customerBargeInActiveRef = useRef(false)
    const pendingLiveBargeInUntilMsRef = useRef(0)
    const koreModelStreamingRef = useRef(false)
    const lastModelAudioChunkMsRef = useRef(0)
    const lastSpokenKoreTextRef = useRef('')
    const lastSpokenKoreAtMsRef = useRef(0)
    const fastClipSeedRef = useRef(0)
    const playedFastClipIdsRef = useRef<Set<string>>(new Set())
    const sawRecentNonLatinNoiseRef = useRef(false)
    const pendingKorePrefixRef = useRef('')
    const previewCtxRef = useRef<AudioContext | null>(null)
    const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)
    const postSaveLearnTimerRef = useRef<number | null>(null)
    const cashierControllerRef = useRef<KoreCashierSessionController>(new KoreCashierSessionController())
    const customerHoldRef = useRef<KoreCustomerHoldController>(new KoreCustomerHoldController())
    const holdSuppressedCurrentTurnRef = useRef(false)
    const cashierTakeoverActiveRef = useRef(false)
    const cashierSpeakingRef = useRef(false)
    const cashierChannelIdRef = useRef<string>('')
    cashierChannelIdRef.current = cashierChannelId
    const cashierMonitorRef = useRef<KoreCashierChannelMonitor | null>(null)
    const headsetSignalMonitorRef = useRef<KoreHeadsetSignalMonitor | null>(null)
    const transcriptRef = useRef<TranscriptEntry[]>([])
    const openEntryRef = useRef<{ customer: string | null; kore: string | null; cashier: string | null }>({
        customer: null,
        kore: null,
        cashier: null,
    })
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
        fastClipsAbortRef.current?.abort()
        const abortCtrl = new AbortController()
        fastClipsAbortRef.current = abortCtrl
        fastClipsInflightStoreIdRef.current = forStoreId
        const reqId = ++fastClipsReqRef.current
        setFastClipsLoading(true)
        setFastClipsHydratingBg(null)
        try {
            await hydrateKoreFastClipsPaginated({
                storeId: forStoreId,
                pageLimit: KORE_FAST_CLIPS_PAGE_LIMIT,
                concurrency: KORE_FAST_CLIPS_BG_CONCURRENCY,
                signal: abortCtrl.signal,
                onPage0: ({ map, stats, pagination }) => {
                    if (reqId !== fastClipsReqRef.current || !mountedRef.current || abortCtrl.signal.aborted) return
                    fastClipsMapRef.current = map
                    fastClipsStoreIdRef.current = forStoreId
                    setFastClipsStats(stats)
                    setFastClipsLoading(false)
                    if (pagination?.hasMore && pagination.totalSituations > map.size) {
                        setFastClipsHydratingBg({ loaded: map.size, total: pagination.totalSituations })
                    }
                    setFastClipsVersion(v => v + 1)
                },
                onBackgroundPage: ({ map, stats, loadedSituations, totalSituations }) => {
                    if (reqId !== fastClipsReqRef.current || !mountedRef.current || abortCtrl.signal.aborted) return
                    fastClipsMapRef.current = map
                    if (stats) setFastClipsStats(stats)
                    setFastClipsHydratingBg(
                        loadedSituations < totalSituations
                            ? { loaded: loadedSituations, total: totalSituations }
                            : null
                    )
                    setFastClipsVersion(v => v + 1)
                },
            })
        } catch {
            // Degradación silenciosa: si el banco pregrabado no responde, Gemini Live habla directo
        } finally {
            if (reqId === fastClipsReqRef.current) {
                fastClipsInflightStoreIdRef.current = 0
                if (mountedRef.current) {
                    setFastClipsLoading(false)
                    setFastClipsHydratingBg(null)
                }
            }
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
            fastClipsAbortRef.current?.abort()
            fastClipsAbortRef.current = null
            fastClipsInflightStoreIdRef.current = 0
            fastClipsReqRef.current += 1
            fastClipsMapRef.current = new Map()
            fastClipsStoreIdRef.current = 0
            setFastClipsStats(null)
            setFastClipsHydratingBg(null)
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

    /** Agrega un fragmento (delta) a la entrada abierta del rol, o abre una nueva (descartando "..." vacío en Kore). */
    const appendSpeech = (role: 'customer' | 'kore' | 'cashier', delta: string) => {
        if (!delta) return
        const openId = openEntryRef.current[role]
        const list = transcriptRef.current
        const idx = openId ? list.findIndex(e => e.id === openId) : -1
        if (idx >= 0) {
            const updated = { ...list[idx], text: list[idx].text + delta }
            transcriptRef.current = [...list.slice(0, idx), updated, ...list.slice(idx + 1)]
        } else {
            let initialText = delta
            if (role === 'kore') {
                const combined = pendingKorePrefixRef.current + delta
                if (isMeaninglessEllipsisOrPunctuationOutput(combined)) {
                    pendingKorePrefixRef.current = combined
                    return
                }
                const cleanedPrefix = pendingKorePrefixRef.current.replace(/^[.\u2026\s]+/, '')
                pendingKorePrefixRef.current = ''
                initialText = cleanedPrefix + delta
            }
            if (role === 'cashier') {
                const updatedMeta = cashierControllerRef.current.recordNewCashierBubble()
                orderRef.current = { ...orderRef.current, cashierIntervention: updatedMeta }
                setOrder(orderRef.current)
            }
            const id = newEntryId()
            transcriptRef.current = [...list, { id, role, text: initialText, at: new Date().toISOString(), final: false }]
            openEntryRef.current[role] = id
        }
        publishTranscript()
    }

    const finalizeSpeech = (role: 'customer' | 'kore' | 'cashier') => {
        if (role === 'kore') {
            pendingKorePrefixRef.current = ''
        }
        const openId = openEntryRef.current[role]
        if (!openId) return
        openEntryRef.current[role] = null
        if (role === 'kore') {
            const openEntry = transcriptRef.current.find(e => e.id === openId)
            if (openEntry && isMeaninglessEllipsisOrPunctuationOutput(openEntry.text)) {
                transcriptRef.current = transcriptRef.current.filter(e => e.id !== openId)
                publishTranscript()
                return
            }
        }
        transcriptRef.current = transcriptRef.current.map(e => (e.id === openId ? { ...e, final: true } : e))
        publishTranscript()
    }

    /** Promueve la burbuja abierta de 'customer' a 'cashier' cuando una frase dispara verbal_cue a mitad de oración. */
    const promoteOpenCustomerBubbleToCashier = () => {
        const openCustId = openEntryRef.current.customer
        if (!openCustId) return
        const list = transcriptRef.current
        const idx = list.findIndex(e => e.id === openCustId)
        openEntryRef.current.customer = null
        if (idx < 0) return
        const updatedMeta = cashierControllerRef.current.recordNewCashierBubble()
        orderRef.current = { ...orderRef.current, cashierIntervention: updatedMeta }
        setOrder(orderRef.current)
        const promoted: TranscriptEntry = { ...list[idx], role: 'cashier' }
        transcriptRef.current = [...list.slice(0, idx), promoted, ...list.slice(idx + 1)]
        openEntryRef.current.cashier = openCustId
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

    const clearAutoEnd = (resetMode = true, opts?: { force?: boolean }) => {
        // Candado anti-zombie: si el WebSocket ya fue cerrado por fast_sendoff, el drenado y cierre es irrevocable
        if (
            resetMode &&
            !opts?.force &&
            liveRef.current &&
            !endingRef.current &&
            !isKoreSocketOpenForAutoEndCancel(wsRef.current)
        ) {
            return
        }
        autoEndCancelConsecRef.current = 0
        if (autoEndTimerRef.current !== null) {
            window.clearTimeout(autoEndTimerRef.current)
            autoEndTimerRef.current = null
        }
        if (resetMode) {
            autoEndModeRef.current = 'none'
        }
    }

    const formatCashierSourceLabel = (source: KoreCashierTriggerSource | null): string => {
        switch (source) {
            case 'headset_signal': return tRef.current('drive_thru.kore_cashier_src_headset')
            case 'cashier_mic_vad': return tRef.current('drive_thru.kore_cashier_src_mic')
            case 'verbal_cue': return tRef.current('drive_thru.kore_cashier_src_verbal')
            case 'manual_button': return tRef.current('drive_thru.kore_cashier_src_manual')
            default: return tRef.current('drive_thru.kore_cashier_src_headset')
        }
    }

    /** Silencia a Kore en <15 ms al activarse cualquiera de los 3 detectores automáticos o el botón de respaldo. */
    const applyImmediateCashierTakeoverEffects = (
        meta: KoreCashierInterventionMeta,
        sendObserverCue: boolean
    ) => {
        playbackRef.current?.stop()
        koreModelStreamingRef.current = false
        lastModelAudioChunkMsRef.current = 0
        localFastClipStartedAtRef.current = 0
        customerSpokeSinceFastClipRef.current = false
        bargeInGuardRef.current.reset()
        customerBargeInActiveRef.current = false
        pendingLiveBargeInUntilMsRef.current = 0
        clearAutoEnd(true)
        clearLangCueTimer()
        suppressGeminiTurnAudioRef.current = true
        currentKoreTurnTextRef.current = ''
        pendingKorePrefixRef.current = ''
        finalizeSpeech('kore')
        setKoreSpeaking(false)

        cashierTakeoverActiveRef.current = true
        setCashierTakeoverActive(true)
        setCashierTriggerSource(meta.triggerSource)
        orderRef.current = { ...orderRef.current, cashierIntervention: meta }
        setOrder(orderRef.current)

        if (sendObserverCue) {
            pushSystem(
                tRef.current('drive_thru.kore_cashier_event_engaged', {
                    source: formatCashierSourceLabel(meta.triggerSource),
                }),
                'warning'
            )
            sendJson(buildSilentContextClientContent(KORE_HUMAN_TAKEOVER_OBSERVER_CUE[sessionMetaRef.current.lang], false))
        }
    }

    const handlePhysicalCashierVoiceChange = (
        speaking: boolean,
        source: 'headset_signal' | 'cashier_mic_vad'
    ) => {
        if (!liveRef.current || endingRef.current) return
        if (speaking) {
            finalizeSpeech('customer')
        }
        const res = cashierControllerRef.current.setPhysicalSpeaking(
            speaking,
            source,
            performance.now(),
            transcriptRef.current.length
        )
        cashierSpeakingRef.current = cashierControllerRef.current.isCashierSpeaking
        setCashierSpeaking(cashierSpeakingRef.current)
        if (res.newlyActivated || cashierControllerRef.current.isActive) {
            applyImmediateCashierTakeoverEffects(res.meta, res.sendObserverCue)
        }
    }

    const handleManualCashierTakeover = () => {
        if (!liveRef.current || endingRef.current) return
        if (cashierTakeoverActiveRef.current) return
        finalizeSpeech('customer')
        const res = cashierControllerRef.current.engage(
            'manual_button',
            performance.now(),
            transcriptRef.current.length
        )
        applyImmediateCashierTakeoverEffects(res.meta, res.sendObserverCue)
    }

    const releaseCashierTakeoverToKore = () => {
        if (!liveRef.current || endingRef.current || !cashierTakeoverActiveRef.current) return
        finalizeSpeech('cashier')
        finalizeSpeech('customer')
        setInterimText('')
        currentCustomerTurnTextRef.current = ''
        currentKoreTurnTextRef.current = ''
        pendingKorePrefixRef.current = ''
        const rel = cashierControllerRef.current.releaseToKore(sessionMetaRef.current.lang, transcriptRef.current)
        if (!rel.released) return
        cashierTakeoverActiveRef.current = false
        cashierSpeakingRef.current = false
        suppressGeminiTurnAudioRef.current = false
        setCashierTakeoverActive(false)
        setCashierSpeaking(false)
        orderRef.current = { ...orderRef.current, cashierIntervention: rel.meta }
        setOrder(orderRef.current)
        pushSystem(tRef.current('drive_thru.kore_cashier_event_released'))
        sendJson(buildSilentContextClientContent(rel.releaseCue, true))
    }

    const refreshAudioInputDevices = useCallback(async () => {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
        try {
            const list = await navigator.mediaDevices.enumerateDevices()
            if (!mountedRef.current) return
            const seen = new Set<string>()
            const mics: { deviceId: string; label: string }[] = []
            for (const d of list) {
                if (d.kind !== 'audioinput' || !d.deviceId || d.deviceId === 'communications') continue
                if (seen.has(d.deviceId)) continue
                seen.add(d.deviceId)
                mics.push({ deviceId: d.deviceId, label: d.label.trim() })
            }
            setAudioInputDevices(mics)
        } catch {
            // Permiso aún no concedido o navegador sin soporte
        }
    }, [])

    const handleConnectSerialJ1 = async () => {
        const mon = headsetSignalMonitorRef.current
        if (!mon) return
        try {
            await mon.connectSerialPort()
        } catch (e) {
            const name = e instanceof DOMException ? e.name : ''
            if (name === 'NotFoundError' || name === 'AbortError') return
            const msg = e instanceof Error ? e.message : String(e)
            setNotice(tRef.current('drive_thru.kore_cashier_cfg_serial_error', { message: msg }))
        }
    }

    const handleDisconnectSerialJ1 = async () => {
        await headsetSignalMonitorRef.current?.disconnectSerialPort()
    }

    const handleMicChunk = (data: MicChunkMessage) => {
        if (!data || !(data.pcm instanceof ArrayBuffer)) return
        if (
            cashierChannelIdRef.current === KORE_STEREO_RIGHT_CHANNEL_ID &&
            typeof data.rightRms === 'number' &&
            Number.isFinite(data.rightRms)
        ) {
            cashierMonitorRef.current?.feedRightChannelRms(data.rightRms)
        }
        if (Number.isFinite(data.rms) && data.rms >= 0) {
            recentRawMicRmsRef.current =
                recentRawMicRmsRef.current === 0 ? data.rms : recentRawMicRmsRef.current * 0.85 + data.rms * 0.15
        }
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

        // Si el WebSocket ya fue cerrado (ej. fast_sendoff drenando despedida), jamás permitir barge-in ni cancelar autoEnd
        if (liveRef.current && !isKoreSocketOpenForAutoEndCancel(wsRef.current)) {
            return
        }

        const nowMicMs = performance.now()
        if (koreModelStreamingRef.current && nowMicMs - lastModelAudioChunkMsRef.current >= 600) {
            koreModelStreamingRef.current = false
        }
        const echoWindowActive =
            Boolean(playbackRef.current?.isEchoShieldActive()) ||
            (koreModelStreamingRef.current && nowMicMs - lastModelAudioChunkMsRef.current < 450)
        const pbActive = echoWindowActive
        const useVadBargeInShield = echoWindowActive && micModeRef.current === 'vad' && !cashierTakeoverActiveRef.current

        if (!useVadBargeInShield && !customerBargeInActiveRef.current && bargeInGuardRef.current.hasPendingState) {
            bargeInGuardRef.current.reset()
        }

        if (useVadBargeInShield) {
            const lastTurnTxt =
                currentCustomerTurnTextRef.current.trim() || lastCompletedCustomerTurnTextRef.current.trim()
            const continuationGraceActive = isKoreContinuationGraceActive(
                lastTurnTxt,
                nowMicMs,
                lastCustomerSpeechTimestampMsRef.current
            )
            const currentOutputRms = playbackRef.current?.getRecentOutputRms() ?? 0
            const currentElapsedMs = playbackRef.current?.isEchoShieldActive()
                ? playbackRef.current.getPlaybackElapsedMs()
                : 9999
            const bgStep = bargeInGuardRef.current.processDuringPlayback(
                data.pcm,
                data.rms,
                noiseGateRef.current.effectiveThresholdRms,
                {
                    continuationGraceActive,
                    outputRms: currentOutputRms,
                    playbackElapsedMs: currentElapsedMs,
                }
            )
            customerBargeInActiveRef.current = bgStep.bargeInLatched

            if (bgStep.suppressed) {
                // Cierra solo la ventana transitoria SIN borrar ambientFloorRms aprendido de la TV
                noiseGateRef.current.closeTransientGate()
                const decayedEcho = meterLevelRef.current * 0.8
                meterLevelRef.current = decayedEcho < 0.01 ? 0 : decayedEcho
                if (meterRef.current) meterRef.current.style.width = `${Math.round(meterLevelRef.current * 100)}%`
                const filteringNow = Number.isFinite(data.rms) && data.rms >= 0.004
                if (filteringNow !== noiseGatedRef.current) {
                    noiseGatedRef.current = filteringNow
                    setNoiseGatedNow(filteringNow)
                }
                if (!liveRef.current) return
                const wsSilent = wsRef.current
                if (!wsSilent || wsSilent.readyState !== WebSocket.OPEN || wsSilent.bufferedAmount > WS_BACKPRESSURE_BYTES) return
                for (const silentBuf of bgStep.chunksToForward) {
                    const cashierExtra = cashierMonitorRef.current?.popPendingPcm() ?? null
                    const outboundBuf = cashierExtra ? mixPcm16Buffers(silentBuf, cashierExtra) : silentBuf
                    sendJson({
                        realtimeInput: {
                            audio: {
                                data: bytesToBase64(new Uint8Array(outboundBuf)),
                                mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}`,
                            },
                        },
                    })
                }
                return
            }

            if (bgStep.justTriggeredBargeIn) {
                noiseGateRef.current.primeOpenFromBargeIn()
                const rawBurst = Math.min(1, Math.max(0, data.rms) * 5)
                meterLevelRef.current = Math.max(rawBurst, meterLevelRef.current * 0.82)
                if (meterRef.current) meterRef.current.style.width = `${Math.round(meterLevelRef.current * 100)}%`
                if (noiseGatedRef.current) {
                    noiseGatedRef.current = false
                    setNoiseGatedNow(false)
                }
                if (!liveRef.current) return
                const nowBargeMs = performance.now()
                const wasLocalFastClip = localFastClipStartedAtRef.current > 0
                customerBargeInActiveRef.current = true
                if (!wasLocalFastClip) {
                    pendingLiveBargeInUntilMsRef.current = nowBargeMs + KORE_LIVE_BARGE_IN_RTT_SHIELD_MS
                }
                initialGreetingPendingRef.current = false
                lastCustomerVoiceMsRef.current = nowBargeMs
                lastCustomerSpeechTimestampMsRef.current = nowBargeMs
                customerSpokeSinceFastClipRef.current = true
                clearAutoEnd(true)
                localFastClipStartedAtRef.current = 0
                koreModelStreamingRef.current = false
                lastModelAudioChunkMsRef.current = 0
                playbackRef.current?.clear()
                finalizeSpeech('kore')
                if (!koreTurnInterruptedRef.current) {
                    koreTurnInterruptedRef.current = true
                    bargeInCountRef.current += 1
                    setBargeInCount(bargeInCountRef.current)
                }
                koreTurnFirstAudioRecordedRef.current = false
                const wsBurst = wsRef.current
                if (!wsBurst || wsBurst.readyState !== WebSocket.OPEN || wsBurst.bufferedAmount > WS_BACKPRESSURE_BYTES) return
                for (const onsetBuf of bgStep.chunksToForward) {
                    const cashierExtra = cashierMonitorRef.current?.popPendingPcm() ?? null
                    const outboundBuf = cashierExtra ? mixPcm16Buffers(onsetBuf, cashierExtra) : onsetBuf
                    sendJson({
                        realtimeInput: {
                            audio: {
                                data: bytesToBase64(new Uint8Array(outboundBuf)),
                                mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}`,
                            },
                        },
                    })
                }
                return
            }
        }

        const gate = noiseGateRef.current.process(data.pcm, data.rms)
        if (!gate.speechActive && (customerBargeInActiveRef.current || bargeInGuardRef.current.hasPendingState)) {
            bargeInGuardRef.current.reset()
            customerBargeInActiveRef.current = false
            customerSpokeSinceFastClipRef.current = false
        }

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
        const bargeInOrPtt = !pbActive || micModeRef.current === 'ptt' || customerBargeInActiveRef.current
        if (gate.speechActive && bargeInOrPtt) {
            const nowSpeechMs = performance.now()
            initialGreetingPendingRef.current = false
            lastCustomerVoiceMsRef.current = nowSpeechMs
            lastCustomerSpeechTimestampMsRef.current = nowSpeechMs
            koreTurnFirstAudioRecordedRef.current = false
            if (
                localFastClipStartedAtRef.current > 0 &&
                performance.now() - localFastClipStartedAtRef.current > 350 &&
                ((micModeRef.current === 'ptt' && pttTalkingRef.current) || customerBargeInActiveRef.current)
            ) {
                customerSpokeSinceFastClipRef.current = true
            }
            // Si el socket sigue vivo y el cliente habla fuerte durante el colchón (>= 3 bloques sobre bargeInThreshold), cancela el cierre
            if (
                autoEndTimerRef.current !== null &&
                isKoreSocketOpenForAutoEndCancel(wsRef.current) &&
                (!pbActive || micModeRef.current === 'ptt')
            ) {
                if (micModeRef.current === 'ptt' && pttTalkingRef.current) {
                    clearAutoEnd(true)
                } else {
                    const cancelThr = computeKoreBargeInThresholdRms(noiseGateRef.current.effectiveThresholdRms)
                    if (data.rms >= cancelThr) {
                        autoEndCancelConsecRef.current += 1
                        if (autoEndCancelConsecRef.current >= KORE_AUTO_END_CANCEL_CONSECUTIVE_CHUNKS) {
                            clearAutoEnd(true)
                        }
                    } else {
                        autoEndCancelConsecRef.current = 0
                    }
                }
            }
        } else if (autoEndTimerRef.current !== null) {
            autoEndCancelConsecRef.current = 0
        }

        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        if (ws.bufferedAmount > WS_BACKPRESSURE_BYTES) return
        for (const chunkBuf of gate.chunksToSend) {
            const cashierExtra = cashierMonitorRef.current?.popPendingPcm() ?? null
            const outboundBuf = cashierExtra ? mixPcm16Buffers(chunkBuf, cashierExtra) : chunkBuf
            sendJson({
                realtimeInput: {
                    audio: { data: bytesToBase64(new Uint8Array(outboundBuf)), mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}` },
                },
            })
        }
        if (gate.forcedTvCut && !cashierTakeoverActiveRef.current) {
            sendJson({ realtimeInput: { audioStreamEnd: true } })
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
        activeThirdLangRef.current = null
        suppressGeminiTurnAudioRef.current = false
        localFastClipStartedAtRef.current = 0
        customerSpokeSinceFastClipRef.current = false
        koreModelStreamingRef.current = false
        lastModelAudioChunkMsRef.current = 0
        lastSpokenKoreTextRef.current = ''
        lastSpokenKoreAtMsRef.current = 0
        playedFastClipIdsRef.current.clear()
        sawRecentNonLatinNoiseRef.current = false
        pendingKorePrefixRef.current = ''
        bargeInGuardRef.current.resetSession()
        customerBargeInActiveRef.current = false
        pendingLiveBargeInUntilMsRef.current = 0
        confirmedOrderInCurrentTurnRef.current = false
        lastCustomerSpeechTimestampMsRef.current = 0
        autoEndCancelConsecRef.current = 0
        clearAutoEnd(true, { force: true })
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
        if (cashierMonitorRef.current) {
            cashierMonitorRef.current.stop()
            cashierMonitorRef.current = null
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
        cashierTakeoverActiveRef.current = false
        cashierSpeakingRef.current = false
        setCashierTakeoverActive(false)
        setCashierSpeaking(false)
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
        const cashierMeta = cashierControllerRef.current.currentMeta
        const finalOrder: KoreOrderState = cashierMeta.triggered
            ? { ...orderRef.current, cashierIntervention: cashierMeta }
            : orderRef.current
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
            // Contrato del backend: role customer|kore|cashier|system|tool (máx 400 turnos / 2000 chars)
            transcript: transcriptRef.current
                .map(e => ({
                    role: e.role === 'system' && (e.kind === 'tool' || e.kind === 'tool_error') ? 'tool' : e.role,
                    text: e.text.trim().slice(0, 2000),
                    at: e.at,
                }))
                .filter(e => e.text.length > 0 && !(e.role === 'kore' && isMeaninglessEllipsisOrPunctuationOutput(e.text)))
                .slice(-400),
            order: finalOrder,
            ...(cashierMeta.triggered ? { cashierIntervention: cashierMeta } : {}),
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
        clearAutoEnd(true, { force: true })
        genRef.current += 1 // invalida flujos asíncronos de start()
        const wasLive = startedAtRef.current !== null
        setPhase('ending')
        finalizeSpeech('customer')
        finalizeSpeech('cashier')
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
        clearAutoEnd(false, { force: true })
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
        // Si la cajera ya tenía abierta la línea A1 al llegar el auto, Kore entra en silencio desde el segundo 0
        if (headsetSignalMonitorRef.current?.isHeadsetTalkActive) {
            initialGreetingPendingRef.current = false
            handlePhysicalCashierVoiceChange(true, 'headset_signal')
            return
        }
        const greetClip = decodeKoreFastClipVariant(sessionRef.current?.initialGreetingClips?.[activeLang])
        if (greetClip) {
            initialGreetingPendingRef.current = false
            const nowGreetMs = performance.now()
            localFastClipStartedAtRef.current = nowGreetMs
            customerSpokeSinceFastClipRef.current = false
            lastSpokenKoreTextRef.current = greetClip.text
            lastSpokenKoreAtMsRef.current = nowGreetMs
            playbackRef.current?.enqueue(greetClip.samples, greetClip.sampleRate, { localCompleteClip: true })
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
            sendJson(buildSilentContextClientContent(ARRIVAL_CUE[activeLang], true))
        }
    }

    /**
     * Envía en silencio (`turnComplete: false`) una directiva `[SYSTEM LANGUAGE SWITCH/LOCK -> ...]` únicamente
     * cuando Kore NO está reproduciendo audio (`!playbackRef.current?.isActive && remainingMs === 0`), sin provocar
     * un turno hablado adicional de Gemini Live.
     */
    const scheduleSilentCueTextWhenIdle = (cueText: string, expectedLangKey: string, gen: number) => {
        clearLangCueTimer()
        const waitIdle = () => {
            langCueTimerRef.current = null
            if (gen !== genRef.current || !liveRef.current || endingRef.current || autoEndModeRef.current !== 'none') return
            if (cashierTakeoverActiveRef.current) return
            const activeKey = activeThirdLangRef.current?.code ?? sessionMetaRef.current.lang
            if (activeKey !== expectedLangKey) return
            const pb = playbackRef.current
            if (pb?.isActive || (pb?.remainingMs ?? 0) > 0) {
                langCueTimerRef.current = window.setTimeout(waitIdle, 90)
                return
            }
            sendJson(buildSilentContextClientContent(cueText, false))
        }
        waitIdle()
    }

    const scheduleSilentLangCueWhenIdle = (targetLang: KoreLang, gen: number) => {
        scheduleSilentCueTextWhenIdle(KORE_SYSTEM_LANG_SWITCH_CUE[targetLang], targetLang, gen)
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

    const applyLiveLanguageResolution = (resolved: KoreLiveLanguageResolution, gen: number) => {
        const prevThirdCode = activeThirdLangRef.current?.code ?? null
        const nextThirdCode = resolved.thirdLang?.code ?? null
        activeThirdLangRef.current = resolved.thirdLang
        if (resolved.baseLang !== sessionMetaRef.current.lang) {
            applyLiveLanguageSwitch(resolved.baseLang, { gen })
        }
        if (nextThirdCode !== prevThirdCode && resolved.thirdLang && liveRef.current) {
            pushSystem(`Idioma espejo activo: ${resolved.thirdLang.nameEs} (${resolved.thirdLang.code})`)
        }
        if (nextThirdCode !== null || resolved.baseLang !== 'es' || resolved.switchCue !== null) {
            sawRecentNonLatinNoiseRef.current = false
        }
        if (resolved.switchCue && liveRef.current) {
            scheduleSilentCueTextWhenIdle(resolved.switchCue, nextThirdCode ?? resolved.baseLang, gen)
        }
    }

    const handleManualLanguageSelect = (code: KoreLang) => {
        langTouchedRef.current = true
        activeThirdLangRef.current = null
        sawRecentNonLatinNoiseRef.current = false
        if (liveRef.current) {
            currentCustomerTurnTextRef.current = ''
            applyLiveLanguageSwitch(code, { sendCueWhenIdle: true, gen: genRef.current })
        } else {
            setLang(code)
        }
    }

    const handleServerContent = (sc: Record<string, unknown>, gen: number) => {
        if (sc.interrupted === true) {
            pendingLiveBargeInUntilMsRef.current = 0
            suppressGeminiTurnAudioRef.current = cashierTakeoverActiveRef.current
            const localClipActive = localFastClipStartedAtRef.current > 0 && Boolean(playbackRef.current?.isActive)
            const vadProtectedPlayback =
                micModeRef.current === 'vad' &&
                Boolean(playbackRef.current?.isActive) &&
                !cashierTakeoverActiveRef.current &&
                !customerBargeInActiveRef.current
            const shouldClearPlayback = (!localClipActive || customerSpokeSinceFastClipRef.current) && !vadProtectedPlayback
            clearLangCueTimer()
            currentKoreTurnTextRef.current = ''
            pendingKorePrefixRef.current = ''
            koreTurnFirstAudioRecordedRef.current = false
            if (shouldClearPlayback) {
                clearAutoEnd(true)
                localFastClipStartedAtRef.current = 0
                customerSpokeSinceFastClipRef.current = false
                koreModelStreamingRef.current = false
                lastModelAudioChunkMsRef.current = 0
                playbackRef.current?.clear()
                finalizeSpeech('kore')
                if (!koreTurnInterruptedRef.current) {
                    koreTurnInterruptedRef.current = true
                    bargeInCountRef.current += 1
                    setBargeInCount(bargeInCountRef.current)
                }
            }
        }
        const liveBargeInRttShieldActive =
            pendingLiveBargeInUntilMsRef.current > 0 && performance.now() < pendingLiveBargeInUntilMsRef.current
        if (!liveBargeInRttShieldActive && pendingLiveBargeInUntilMsRef.current > 0) {
            pendingLiveBargeInUntilMsRef.current = 0
        }
        const modelTurn = isPlainObject(sc.modelTurn) ? sc.modelTurn : null
        if (
            !cashierTakeoverActiveRef.current &&
            !suppressGeminiTurnAudioRef.current &&
            !liveBargeInRttShieldActive &&
            modelTurn &&
            Array.isArray(modelTurn.parts)
        ) {
            // Procesar TODAS las parts de cada mensaje
            for (const part of modelTurn.parts) {
                if (!isPlainObject(part) || !isPlainObject(part.inlineData)) continue
                const inline = part.inlineData
                const mime = typeof inline.mimeType === 'string' ? inline.mimeType : ''
                if (typeof inline.data !== 'string' || (mime && !mime.toLowerCase().startsWith('audio/pcm'))) continue
                const samples = decodePcm16ToFloat32(base64ToBytes(inline.data))
                if (samples.length > 0) {
                    koreModelStreamingRef.current = true
                    lastModelAudioChunkMsRef.current = performance.now()
                }
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
            if (customerTurnFreshRef.current && sc.inputTranscription.text.trim()) {
                lastCompletedCustomerTurnTextRef.current = ''
                customerTurnFreshRef.current = false
            }
            currentCustomerTurnTextRef.current += sc.inputTranscription.text
            const trimmedTurn = currentCustomerTurnTextRef.current.trim()
            if (trimmedTurn) {
                lastCompletedCustomerTurnTextRef.current = trimmedTurn
            }
            const nowInMs = performance.now()
            const activeThirdCode = activeThirdLangRef.current?.code ?? null
            const koreRecentlySpoke =
                Boolean(playbackRef.current?.isEchoShieldActive()) ||
                koreModelStreamingRef.current ||
                (lastSpokenKoreAtMsRef.current > 0 && nowInMs - lastSpokenKoreAtMsRef.current <= 3000)
            const referenceKoreSpeech = currentKoreTurnTextRef.current.trim() || lastSpokenKoreTextRef.current
            const isSelfEchoTurn =
                !cashierTakeoverActiveRef.current &&
                koreRecentlySpoke &&
                trimmedTurn.length > 0 &&
                isLikelyKoreSelfEchoTranscript(trimmedTurn, referenceKoreSpeech)
            if (isSelfEchoTurn) {
                bargeInGuardRef.current.bumpLearnedEchoFloor(recentRawMicRmsRef.current)
            }
            const holdEval = !cashierTakeoverActiveRef.current
                ? customerHoldRef.current.evaluateTurnText(
                      trimmedTurn,
                      nowInMs,
                      KORE_CUSTOMER_HOLD_STANDBY_MS,
                      activeThirdCode
                  )
                : null
            if (isSelfEchoTurn || holdEval?.suppressGeminiTurn) {
                suppressGeminiTurnAudioRef.current = true
                holdSuppressedCurrentTurnRef.current = true
                if (!isSelfEchoTurn && playbackRef.current?.isActive && localFastClipStartedAtRef.current === 0) {
                    koreModelStreamingRef.current = false
                    lastModelAudioChunkMsRef.current = 0
                    playbackRef.current.clear()
                    currentKoreTurnTextRef.current = ''
                }
            } else if (holdSuppressedCurrentTurnRef.current) {
                holdSuppressedCurrentTurnRef.current = false
                suppressGeminiTurnAudioRef.current = cashierTakeoverActiveRef.current
            }
            if (holdEval?.shouldLockNoiseFloor) {
                noiseGateRef.current.lockBackgroundMediaFloor(recentRawMicRmsRef.current)
            }
            const chunkNonLatinNoise =
                trimmedTurn.length > 0 &&
                (Boolean(holdEval?.nonLatinNoise) ||
                    isNonLatinNoiseTranscript(trimmedTurn, activeThirdCode) ||
                    (activeThirdCode === null &&
                        ANY_NON_LATIN_SCRIPT_CHAR_RE.test(trimmedTurn) &&
                        !detectKoreThirdLanguage(trimmedTurn)))
            if (!cashierTakeoverActiveRef.current && chunkNonLatinNoise && activeThirdCode === null && sessionMetaRef.current.lang === 'es') {
                sawRecentNonLatinNoiseRef.current = true
                scheduleSilentLangCueWhenIdle('es', gen)
            }
            const isPureTvTurn =
                trimmedTurn.length > 0 &&
                (isSelfEchoTurn ||
                    Boolean(holdEval?.nonLatinNoise) ||
                    Boolean(holdEval?.suppressGeminiTurn) ||
                    isNonLatinNoiseTranscript(trimmedTurn, activeThirdCode) ||
                    isLikelyBackgroundMediaSpeech(trimmedTurn, activeThirdCode))
            if (sc.inputTranscription.text.trim()) {
                initialGreetingPendingRef.current = false
                if (!isPureTvTurn) {
                    lastCustomerSpeechTimestampMsRef.current = nowInMs
                }
                if (!isPureTvTurn) {
                    confirmedOrderInCurrentTurnRef.current = false
                    if (autoEndModeRef.current !== 'none' && isKoreSocketOpenForAutoEndCancel(wsRef.current)) {
                        clearAutoEnd(true)
                    }
                }
                if (
                    !isPureTvTurn &&
                    localFastClipStartedAtRef.current > 0 &&
                    nowInMs - localFastClipStartedAtRef.current > 280 &&
                    (micModeRef.current === 'ptt' || customerBargeInActiveRef.current)
                ) {
                    customerSpokeSinceFastClipRef.current = true
                    if (playbackRef.current?.isActive) {
                        playbackRef.current.clear()
                        localFastClipStartedAtRef.current = 0
                    }
                }
            }
            if (
                !cashierTakeoverActiveRef.current &&
                shouldTriggerTranscriptTvCut(
                    trimmedTurn,
                    nowInMs,
                    lastTranscriptTvCutMsRef.current,
                    KORE_TRANSCRIPT_TV_CUT_COOLDOWN_MS,
                    activeThirdCode
                )
            ) {
                lastTranscriptTvCutMsRef.current = nowInMs
                noiseGateRef.current.lockBackgroundMediaFloor(recentRawMicRmsRef.current)
                sendJson({ realtimeInput: { audioStreamEnd: true } })
            }
            const inspected = cashierControllerRef.current.inspectInputText(
                currentCustomerTurnTextRef.current,
                nowInMs,
                transcriptRef.current.length,
                openEntryRef.current.customer !== null
            )
            if (inspected.newlyActivated) {
                applyImmediateCashierTakeoverEffects(inspected.meta, inspected.sendObserverCue)
            }
            if (inspected.promoteOpenCustomerBubble) {
                promoteOpenCustomerBubbleToCashier()
            }
            if (!cashierTakeoverActiveRef.current && !isPureTvTurn) {
                const resolvedLang = resolveKoreLiveLanguageState(
                    currentCustomerTurnTextRef.current,
                    sessionMetaRef.current.lang,
                    activeThirdLangRef.current,
                    { hadRecentNonLatinNoise: sawRecentNonLatinNoiseRef.current }
                )
                applyLiveLanguageResolution(resolvedLang, gen)
            }
            if (inspected.role === 'cashier') {
                finalizeSpeech('customer')
                appendSpeech('cashier', sc.inputTranscription.text)
            } else {
                finalizeSpeech('cashier')
                appendSpeech('customer', sc.inputTranscription.text)
            }
            setInterimText('')
        }
        if (isPlainObject(sc.interimInputTranscription) && typeof sc.interimInputTranscription.text === 'string') {
            const nowInterimMs = performance.now()
            const previewThirdCode = activeThirdLangRef.current?.code ?? null
            const combinedPreview = `${currentCustomerTurnTextRef.current} ${sc.interimInputTranscription.text}`.trim()
            const previewNonLatin =
                combinedPreview.length > 0 && isNonLatinNoiseTranscript(combinedPreview, previewThirdCode)
            const previewBlockedDuringHold =
                !cashierTakeoverActiveRef.current &&
                combinedPreview.length > 0 &&
                customerHoldRef.current.isHoldActive(nowInterimMs) &&
                !detectKoreCustomerHoldRequest(combinedPreview, previewThirdCode) &&
                !isCustomerResumingFromHold(combinedPreview, previewThirdCode)
            if (previewNonLatin || previewBlockedDuringHold) {
                suppressGeminiTurnAudioRef.current = true
                holdSuppressedCurrentTurnRef.current = true
                noiseGateRef.current.lockBackgroundMediaFloor(recentRawMicRmsRef.current)
            } else if (
                holdSuppressedCurrentTurnRef.current &&
                combinedPreview.length > 0 &&
                (!customerHoldRef.current.isHoldActive(nowInterimMs) ||
                    isCustomerResumingFromHold(combinedPreview, previewThirdCode))
            ) {
                customerHoldRef.current.evaluateTurnText(
                    combinedPreview,
                    nowInterimMs,
                    KORE_CUSTOMER_HOLD_STANDBY_MS,
                    previewThirdCode
                )
                holdSuppressedCurrentTurnRef.current = false
                suppressGeminiTurnAudioRef.current = cashierTakeoverActiveRef.current
            }
            const isPureTvPreview =
                combinedPreview.length > 0 &&
                (previewNonLatin ||
                    previewBlockedDuringHold ||
                    isLikelyBackgroundMediaSpeech(combinedPreview, previewThirdCode))
            if (combinedPreview) {
                lastCompletedCustomerTurnTextRef.current = combinedPreview
            }
            if (sc.interimInputTranscription.text.trim()) {
                initialGreetingPendingRef.current = false
                if (!isPureTvPreview && autoEndModeRef.current !== 'none' && isKoreSocketOpenForAutoEndCancel(wsRef.current)) {
                    clearAutoEnd(true)
                }
                if (
                    !isPureTvPreview &&
                    localFastClipStartedAtRef.current > 0 &&
                    nowInterimMs - localFastClipStartedAtRef.current > 280 &&
                    (micModeRef.current === 'ptt' || customerBargeInActiveRef.current)
                ) {
                    customerSpokeSinceFastClipRef.current = true
                    if (playbackRef.current?.isActive) {
                        playbackRef.current.clear()
                        localFastClipStartedAtRef.current = 0
                    }
                }
            }
            if (combinedPreview) {
                if (
                    !cashierTakeoverActiveRef.current &&
                    shouldTriggerTranscriptTvCut(
                        combinedPreview,
                        nowInterimMs,
                        lastTranscriptTvCutMsRef.current,
                        KORE_TRANSCRIPT_TV_CUT_COOLDOWN_MS,
                        previewThirdCode
                    )
                ) {
                    lastTranscriptTvCutMsRef.current = nowInterimMs
                    noiseGateRef.current.lockBackgroundMediaFloor(recentRawMicRmsRef.current)
                    sendJson({ realtimeInput: { audioStreamEnd: true } })
                }
                const previewInspected = cashierControllerRef.current.inspectInputText(
                    combinedPreview,
                    nowInterimMs,
                    transcriptRef.current.length,
                    openEntryRef.current.customer !== null
                )
                if (previewInspected.newlyActivated) {
                    applyImmediateCashierTakeoverEffects(previewInspected.meta, previewInspected.sendObserverCue)
                }
                if (previewInspected.promoteOpenCustomerBubble) {
                    promoteOpenCustomerBubbleToCashier()
                }
                if (!cashierTakeoverActiveRef.current && !isPureTvPreview) {
                    const resolvedLang = resolveKoreLiveLanguageState(
                        combinedPreview,
                        sessionMetaRef.current.lang,
                        activeThirdLangRef.current,
                        { hadRecentNonLatinNoise: sawRecentNonLatinNoiseRef.current }
                    )
                    applyLiveLanguageResolution(resolvedLang, gen)
                }
            }
            setInterimText(sc.interimInputTranscription.text)
        }
        if (isPlainObject(sc.outputTranscription) && typeof sc.outputTranscription.text === 'string' && !liveBargeInRttShieldActive) {
            if (!cashierTakeoverActiveRef.current && !suppressGeminiTurnAudioRef.current) {
                if (autoEndTimerRef.current !== null) clearAutoEnd(false, { force: true })
                if (currentCustomerTurnTextRef.current.trim()) {
                    lastCompletedCustomerTurnTextRef.current = currentCustomerTurnTextRef.current.trim()
                }
                currentCustomerTurnTextRef.current = ''
                customerTurnFreshRef.current = true
                currentKoreTurnTextRef.current += sc.outputTranscription.text
                const trimmedKoreOut = currentKoreTurnTextRef.current.trim()
                if (trimmedKoreOut && !isMeaninglessEllipsisOrPunctuationOutput(trimmedKoreOut)) {
                    lastSpokenKoreTextRef.current = trimmedKoreOut
                    lastSpokenKoreAtMsRef.current = performance.now()
                }
                finalizeSpeech('customer')
                finalizeSpeech('cashier')
                appendSpeech('kore', sc.outputTranscription.text)
            } else if (!cashierTakeoverActiveRef.current) {
                if (currentCustomerTurnTextRef.current.trim()) {
                    lastCompletedCustomerTurnTextRef.current = currentCustomerTurnTextRef.current.trim()
                }
                currentCustomerTurnTextRef.current = ''
                customerTurnFreshRef.current = true
                finalizeSpeech('customer')
                finalizeSpeech('cashier')
            }
        }
        if (sc.turnComplete === true) {
            pendingLiveBargeInUntilMsRef.current = 0
            koreModelStreamingRef.current = false
            playbackRef.current?.resetUnderruns()
            const wasSuppressedTurn = suppressGeminiTurnAudioRef.current
            holdSuppressedCurrentTurnRef.current = false
            suppressGeminiTurnAudioRef.current = cashierTakeoverActiveRef.current
            initialGreetingPendingRef.current = false
            koreTurnFirstAudioRecordedRef.current = false
            koreTurnInterruptedRef.current = false
            if (currentCustomerTurnTextRef.current.trim()) {
                lastCompletedCustomerTurnTextRef.current = currentCustomerTurnTextRef.current.trim()
            }
            currentCustomerTurnTextRef.current = ''
            customerTurnFreshRef.current = true
            cashierControllerRef.current.onTurnComplete()
            finalizeSpeech('customer')
            finalizeSpeech('cashier')
            finalizeSpeech('kore')
            setInterimText('')
            const rawSpokenKoreTurn = currentKoreTurnTextRef.current.trim()
            const spokenKoreTurn = isMeaninglessEllipsisOrPunctuationOutput(rawSpokenKoreTurn) ? '' : rawSpokenKoreTurn
            if (spokenKoreTurn) {
                lastSpokenKoreTextRef.current = spokenKoreTurn
                lastSpokenKoreAtMsRef.current = performance.now()
            }
            currentKoreTurnTextRef.current = ''
            if (cashierTakeoverActiveRef.current || wasSuppressedTurn) return
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
                // Red de seguridad bidireccional sin cortar audio: re-bloquea idioma si Gemini se desvió
                if (autoEndModeRef.current === 'none' && spokenKoreTurn.length > 0) {
                    const lockedThird = activeThirdLangRef.current
                    if (lockedThird !== null) {
                        if (
                            NON_LATIN_THIRD_LANG_CODES.has(lockedThird.code) &&
                            /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(spokenKoreTurn) &&
                            !matchesThirdLanguageScript(spokenKoreTurn, lockedThird.code)
                        ) {
                            scheduleSilentCueTextWhenIdle(buildKoreThirdLangLockCue(lockedThird), lockedThird.code, gen)
                        }
                    } else if (
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
        const calls = Array.isArray(toolCall.functionCalls) ? toolCall.functionCalls : []
        if (cashierTakeoverActiveRef.current) {
            const blockedResponses: { id?: string; name: string; response: Record<string, unknown> }[] = []
            for (const rawCall of calls) {
                if (!isPlainObject(rawCall)) continue
                const name = typeof rawCall.name === 'string' ? rawCall.name : ''
                const id = typeof rawCall.id === 'string' ? rawCall.id : undefined
                let response: Record<string, unknown> = {
                    ok: false,
                    error_code: 'human_cashier_takeover_active',
                    message: KORE_HUMAN_TAKEOVER_OBSERVER_CUE[sessionMetaRef.current.lang],
                }
                if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') {
                    response = { ...response, scheduling: 'WHEN_IDLE' }
                }
                blockedResponses.push({ ...(id ? { id } : {}), name, response })
            }
            if (blockedResponses.length > 0) sendJson({ toolResponse: { functionResponses: blockedResponses } })
            return
        }
        pendingLiveBargeInUntilMsRef.current = 0
        const wasHoldSuppressed = holdSuppressedCurrentTurnRef.current
        if (!wasHoldSuppressed) {
            suppressGeminiTurnAudioRef.current = false
        } else {
            suppressGeminiTurnAudioRef.current = true
        }
        if (currentCustomerTurnTextRef.current.trim()) {
            lastCompletedCustomerTurnTextRef.current = currentCustomerTurnTextRef.current.trim()
            currentCustomerTurnTextRef.current = ''
            customerTurnFreshRef.current = true
        }
        const activeTurnCustomerText = lastCompletedCustomerTurnTextRef.current
        const sessionCustomerTurns = collectSessionCustomerTurns(
            transcriptRef.current,
            activeTurnCustomerText,
            activeThirdLangRef.current?.code ?? null
        )
        const readOnlyBatch = isReadOnlyLookupToolBatch(calls)
        const koreAlreadyAskedQuestion =
            readOnlyBatch && hasKoreAlreadyAskedQuestionInTurn(currentKoreTurnTextRef.current, transcriptRef.current)
        finalizeSpeech('customer')
        finalizeSpeech('cashier')
        if (!koreAlreadyAskedQuestion) {
            finalizeSpeech('kore')
        }
        const functionResponses: { id?: string; name: string; response: Record<string, unknown> }[] = []
        const executedCallsForCount: { name: string; args: Record<string, unknown>; response: Record<string, unknown> }[] = []
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

            // Candado contra herramientas fantasma alucinadas por espera activa, basura no latina o TV/YouTube (ej. GTA 6 -> Mulita Asada)
            if (
                shouldBlockGhostMediaToolCall(
                    name,
                    activeTurnCustomerText,
                    wasHoldSuppressed,
                    activeThirdLangRef.current?.code ?? null
                )
            ) {
                failedCallsCount += 1
                let blockedResp: Record<string, unknown> = {
                    ok: false,
                    error_code: 'background_media_ignored',
                    message: 'Audio was background TV/YouTube media with no customer order; ticket unchanged.',
                }
                pushSystem(`${describeTool(name, args)} — background_media_ignored`, 'tool_error', name)
                if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') {
                    blockedResp = { ...blockedResp, scheduling: 'WHEN_IDLE' }
                }
                functionResponses.push({ ...(id ? { id } : {}), name, response: blockedResp })
                continue
            }

            // Candado contra adivinanzas cuando el cliente fue cortado a mitad de frase ("Quiero", "Quiero una")
            if (shouldBlockDanglingFragmentToolCall(name, activeTurnCustomerText)) {
                failedCallsCount += 1
                let incompleteResp: Record<string, unknown> = {
                    ok: false,
                    error_code: 'incomplete_customer_utterance',
                    message: `Customer utterance was cut mid-phrase ("${activeTurnCustomerText}"). Ask briefly what they wanted to say instead of guessing items or sizes.`,
                }
                pushSystem(`${describeTool(name, args)} — incomplete_customer_utterance`, 'tool_error', name)
                if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') {
                    incompleteResp = { ...incompleteResp, scheduling: 'WHEN_IDLE' }
                }
                functionResponses.push({ ...(id ? { id } : {}), name, response: incompleteResp })
                continue
            }

            // Candado contra cancel_order accidental ante frases ambiguas ("Olvídalo entonces.", "Mejor no", "Never mind")
            const hasActiveOrderLines =
                orderRef.current.lines.length > 0 && orderRef.current.status !== 'cancelled'
            if (shouldBlockAmbiguousCancelOrderToolCall(name, args, activeTurnCustomerText, hasActiveOrderLines)) {
                failedCallsCount += 1
                let cancelBlockedResp: Record<string, unknown> = {
                    ok: false,
                    error_code: 'confirm_whole_order_cancel_first',
                    message:
                        'Ambiguous dismissal ("olvídalo" / "never mind" / non-order topic) does NOT cancel an active food order. Ticket kept intact; clarify briefly or confirm their existing order in the active language.',
                }
                pushSystem('Cancelación bloqueada (frase ambigua) — confirm_whole_order_cancel_first', 'tool_error', name)
                if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') {
                    cancelBlockedResp = { ...cancelBlockedResp, scheduling: 'WHEN_IDLE' }
                }
                functionResponses.push({ ...(id ? { id } : {}), name, response: cancelBlockedResp })
                continue
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
                                thirdLanguage: activeThirdLangRef.current,
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
                    const preCallUnfulfilled = findUnfulfilledSessionOrderCategories(sessionCustomerTurns, before.lines)
                    const toolOpts: Parameters<typeof applyKoreTool>[4] & { confirmedInCurrentTurn?: boolean } = {
                        taxRatePct: sessionRef.current?.store.taxRatePct ?? null,
                        lang: activeLang,
                        thirdLanguage: activeThirdLangRef.current,
                        confirmedInCurrentTurn: confirmedOrderInCurrentTurnRef.current,
                        sessionCustomerTurns,
                        unfulfilledSessionCategories: preCallUnfulfilled,
                        ...(typeof storeAcceptsEbt === 'boolean' ? { acceptsEbt: storeAcceptsEbt } : {}),
                    }
                    const out = applyKoreTool(before, menuRef.current, name, args, toolOpts)
                    orderRef.current = out.state
                    response = isPlainObject(out.result) ? { ...out.result } : { result: out.result }
                }
                if (id) {
                    toolHistoryRef.current.push({ id, name, before })
                    if (toolHistoryRef.current.length > 80) toolHistoryRef.current.shift()
                }
                if (name === 'confirm_order' && response.ok === true) {
                    confirmedOrderInCurrentTurnRef.current = true
                }
                if (name === 'end_session' && response.ok === true && response.should_end_session === true) {
                    clearAutoEnd(false, { force: true })
                    autoEndModeRef.current = 'explicit_tool'
                } else if (
                    (name === 'add_item' || name === 'add_items' || name === 'update_item' || name === 'remove_item') &&
                    response.ok === true
                ) {
                    confirmedOrderInCurrentTurnRef.current = false
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
                    customerTurnText: activeTurnCustomerText,
                    alreadyPlayedClipIds: playedFastClipIdsRef.current,
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
            if (koreAlreadyAskedQuestion && (name === 'search_menu' || name === 'get_order')) {
                response = {
                    ...response,
                    _anti_repeat_hint:
                        'You already spoke to the customer before this lookup; do NOT repeat the exact same question you just asked.',
                }
            }
            executedCallsForCount.push({ name, args, response })
            if (toolBehaviorRef.current.get(name) === 'NON_BLOCKING') response = { ...response, scheduling: 'WHEN_IDLE' }
            functionResponses.push({ ...(id ? { id } : {}), name, response })
        }
        if (gen !== genRef.current || !liveRef.current) return
        setOrder(orderRef.current)

        // Selección de clip instantáneo sin doble voz (terminal tiene prioridad; en lote solo si 1 llamada o 1 aclaración)
        const terminalCandidate = candidateMatches.find(c => c.match.isTerminalSendoff === true)
        const rawSingleCandidate =
            terminalCandidate ||
            (functionResponses.length === 1 && candidateMatches.length === 1
                ? candidateMatches[0]
                : failedCallsCount === 1 && candidateMatches.length === 1 && functionResponses[candidateMatches[0].idx]?.response.ok === false
                    ? candidateMatches[0]
                    : undefined)
        const remainingUnfulfilledAfterBatch = findUnfulfilledSessionOrderCategories(
            sessionCustomerTurns,
            orderRef.current.lines
        )
        if (remainingUnfulfilledAfterBatch.length === 0) {
            for (const fnRes of functionResponses) {
                if ('unfulfilled_session_items' in fnRes.response || 'pending_items_reminder' in fnRes.response) {
                    const cleaned = { ...fnRes.response }
                    delete cleaned.unfulfilled_session_items
                    delete cleaned.pending_items_reminder
                    fnRes.response = cleaned
                }
            }
        }
        const addedItemsCount = countAddedOrderItemsInToolBatch(executedCallsForCount)
        const suppressForCompoundTurn =
            rawSingleCandidate !== undefined &&
            shouldSuppressFastClipForCompoundTurn({
                isTerminalSendoff: rawSingleCandidate.match.isTerminalSendoff === true,
                customerTurnText: activeTurnCustomerText,
                addedItemsCount,
                unfulfilledSessionCategories: remainingUnfulfilledAfterBatch,
                clipCategory: KORE_FAST_CLIP_SPECS.find(sp => sp.clipId === rawSingleCandidate.match.clipId)?.category ?? null,
            })
        const singleCandidate =
            wasHoldSuppressed || suppressForCompoundTurn || activeThirdLangRef.current !== null
                ? undefined
                : rawSingleCandidate
        const finalLang = sessionMetaRef.current.lang
        const chosenClip = singleCandidate
            ? fastClipsMapRef.current.get(singleCandidate.match.clipId)?.[finalLang] ?? null
            : null

        if (singleCandidate && chosenClip && chosenClip.samples.length > 0) {
            playedFastClipIdsRef.current.add(singleCandidate.match.clipId)
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
                koreModelStreamingRef.current = false
                lastModelAudioChunkMsRef.current = 0
                playbackRef.current?.clear()
                const nowTermClipMs = performance.now()
                localFastClipStartedAtRef.current = nowTermClipMs
                customerSpokeSinceFastClipRef.current = false
                lastSpokenKoreTextRef.current = spokenText
                lastSpokenKoreAtMsRef.current = nowTermClipMs
                playbackRef.current?.enqueue(chosenClip.samples, chosenClip.sampleRate, { localCompleteClip: true })
                appendSpeech('kore', spokenText)
                finalizeSpeech('kore')
                pushSystem(tRef.current('drive_thru.kore_fast_clip_played', { clipId: singleCandidate.match.clipId }))
                autoEndModeRef.current = 'explicit_tool'
                scheduleAutoEndAfterAudioDrain(450, gen)
                return
            }

            // No terminal: reproduce al instante (<10 ms), suprime audio/texto tardío de Gemini hasta turnComplete
            koreModelStreamingRef.current = false
            lastModelAudioChunkMsRef.current = 0
            playbackRef.current?.clear()
            suppressGeminiTurnAudioRef.current = true
            const nowClipMs = performance.now()
            localFastClipStartedAtRef.current = nowClipMs
            customerSpokeSinceFastClipRef.current = false
            lastSpokenKoreTextRef.current = spokenText
            lastSpokenKoreAtMsRef.current = nowClipMs
            playbackRef.current?.enqueue(chosenClip.samples, chosenClip.sampleRate, { localCompleteClip: true })
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
        openEntryRef.current = { customer: null, kore: null, cashier: null }
        cashierControllerRef.current.reset()
        customerHoldRef.current.reset()
        holdSuppressedCurrentTurnRef.current = false
        activeThirdLangRef.current = null
        cashierTakeoverActiveRef.current = false
        cashierSpeakingRef.current = false
        setCashierTakeoverActive(false)
        setCashierSpeaking(false)
        setCashierTriggerSource(null)
        toolHistoryRef.current = []
        toolQueueRef.current = Promise.resolve()
        cancelledToolIdsRef.current.clear()
        clearAutoEnd(true, { force: true })
        clearLangCueTimer()
        suppressGeminiTurnAudioRef.current = false
        localFastClipStartedAtRef.current = 0
        customerSpokeSinceFastClipRef.current = false
        koreModelStreamingRef.current = false
        lastModelAudioChunkMsRef.current = 0
        lastSpokenKoreTextRef.current = ''
        lastSpokenKoreAtMsRef.current = 0
        bargeInGuardRef.current.resetSession()
        customerBargeInActiveRef.current = false
        pendingLiveBargeInUntilMsRef.current = 0
        confirmedOrderInCurrentTurnRef.current = false
        lastTranscriptTvCutMsRef.current = 0
        lastCustomerSpeechTimestampMsRef.current = 0
        recentRawMicRmsRef.current = 0
        autoEndCancelConsecRef.current = 0
        fastClipSeedRef.current = 0
        playedFastClipIdsRef.current.clear()
        sawRecentNonLatinNoiseRef.current = false
        pendingKorePrefixRef.current = ''
        currentKoreTurnTextRef.current = ''
        currentCustomerTurnTextRef.current = ''
        lastCompletedCustomerTurnTextRef.current = ''
        customerTurnFreshRef.current = true
        abortInFlightTools()
        if (
            fastClipsInflightStoreIdRef.current !== meta.storeId &&
            (fastClipsStoreIdRef.current !== meta.storeId || fastClipsMapRef.current.size === 0)
        ) {
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

        // 2) Micrófono (mono 1 canal por defecto; 2 canales estéreo si se eligió Canal 2 Right para cajera)
        const wantStereoRight = cashierChannelIdRef.current === KORE_STEREO_RIGHT_CHANNEL_ID
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: wantStereoRight
                    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }
                    : { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
            })
            if (gen !== genRef.current) {
                stream.getTracks().forEach(track => track.stop())
                return
            }
            streamRef.current = stream
            void refreshAudioInputDevices()
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
                channelCount: wantStereoRight ? 2 : 1,
                channelCountMode: 'explicit',
                channelInterpretation: 'speakers',
                processorOptions: {
                    targetRate: KORE_INPUT_SAMPLE_RATE,
                    chunkSamples: KORE_CHUNK_SAMPLES,
                    ...(wantStereoRight ? { emitChannelRms: true } : {}),
                },
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
                if (
                    !active &&
                    !customerBargeInActiveRef.current &&
                    !playbackRef.current?.isEchoShieldActive() &&
                    !koreModelStreamingRef.current
                ) {
                    bargeInGuardRef.current.reset()
                }
                if (!active) {
                    localFastClipStartedAtRef.current = 0
                    if (!customerBargeInActiveRef.current) {
                        customerSpokeSinceFastClipRef.current = false
                    }
                }
                setKoreSpeaking(active)
            })

            const selectedCashierChannel = cashierChannelIdRef.current.trim()
            if (selectedCashierChannel) {
                const primaryDevId = streamRef.current?.getAudioTracks()[0]?.getSettings?.()?.deviceId ?? null
                const monitor = new KoreCashierChannelMonitor({
                    mode: selectedCashierChannel === KORE_STEREO_RIGHT_CHANNEL_ID ? 'stereo_right' : 'device',
                    cashierDeviceId: selectedCashierChannel === KORE_STEREO_RIGHT_CHANNEL_ID ? undefined : selectedCashierChannel,
                    primaryDeviceId: primaryDevId,
                    ctx,
                    onCashierVoiceState: speaking => {
                        handlePhysicalCashierVoiceChange(speaking, 'cashier_mic_vad')
                    },
                    onCashierPcmChunk: pcm => {
                        if (!liveRef.current) return
                        const primaryTransmitting = micModeRef.current === 'ptt' ? pttTalkingRef.current : micEnabledRef.current
                        if (primaryTransmitting) return // Se mezcla muestra a muestra en handleMicChunk
                        cashierMonitorRef.current?.clearPendingPcm()
                        const wsNow = wsRef.current
                        if (!wsNow || wsNow.readyState !== WebSocket.OPEN || wsNow.bufferedAmount > WS_BACKPRESSURE_BYTES) return
                        sendJson({
                            realtimeInput: {
                                audio: {
                                    data: bytesToBase64(new Uint8Array(pcm)),
                                    mimeType: `audio/pcm;rate=${KORE_INPUT_SAMPLE_RATE}`,
                                },
                            },
                        })
                    },
                })
                cashierMonitorRef.current = monitor
                monitor.start().catch(err => {
                    const msg = err instanceof Error ? err.message : String(err)
                    if (mountedRef.current) {
                        setNotice(tRef.current('drive_thru.kore_cashier_cfg_mic_error', { message: msg }))
                    }
                })
            }
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
        fastClipsAbortRef.current?.abort()
        fastClipsAbortRef.current = null
        stopFastClipPreview(true)
        teardownMedia()
    }

    const onHeadsetTalkSignalRef = useRef<(active: boolean) => void>(() => undefined)
    onHeadsetTalkSignalRef.current = (active: boolean) => {
        handlePhysicalCashierVoiceChange(active, 'headset_signal')
    }

    useEffect(() => {
        setSerialSupported(isKoreWebSerialSupported())
        void refreshAudioInputDevices()
        const sigMon = new KoreHeadsetSignalMonitor({
            shortcutKey: 'F9',
            onHeadsetTalkChange: active => {
                onHeadsetTalkSignalRef.current(active)
            },
            onSerialStatusChange: (connected, errMsg) => {
                if (!mountedRef.current) return
                setSerialConnected(connected)
                if (!connected && errMsg) {
                    setNotice(tRef.current('drive_thru.kore_cashier_cfg_serial_error', { message: errMsg }))
                }
            },
        })
        sigMon.attachKeyboard()
        headsetSignalMonitorRef.current = sigMon
        return () => {
            sigMon.stop()
            headsetSignalMonitorRef.current = null
        }
    }, [refreshAudioInputDevices])

    useEffect(() => {
        mountedRef.current = true
        const onPageHide = () => {
            if (startedAtRef.current !== null) saveOnExitRef.current()
            genRef.current += 1
            teardownRef.current()
            headsetSignalMonitorRef.current?.stop()
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
        () => filterKoreFastClipCatalogRows(fastClipCatalogRows, fastClipsCategory, fastClipsSearch),
        [fastClipCatalogRows, fastClipsCategory, fastClipsSearch]
    )
    const fastClipCategoryTabs: { id: KoreFastClipCatalogFilter; labelKey: string; count: number }[] = useMemo(() => {
        const countOf = (grp: KoreFastClipCatalogGroup) => fastClipCatalogRows.filter(r => r.group === grp).length
        return [
            { id: 'all', labelKey: 'drive_thru.kore_fast_clips_cat_all', count: fastClipCatalogRows.length },
            { id: 'greeting', labelKey: 'drive_thru.kore_fast_clips_cat_greeting', count: countOf('greeting') },
            { id: 'item_ack', labelKey: 'drive_thru.kore_fast_clips_cat_item_ack', count: countOf('item_ack') },
            { id: 'clarify', labelKey: 'drive_thru.kore_fast_clips_cat_clarify', count: countOf('clarify') },
            { id: 'modifiers', labelKey: 'drive_thru.kore_fast_clips_cat_modifiers', count: countOf('modifiers') },
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
                if (cashierTakeoverActive) {
                    return {
                        label: t('drive_thru.kore_status_cashier_takeover'),
                        cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 ring-1 ring-amber-400/70',
                        icon: <Headphones size={14} className="animate-pulse text-amber-600 dark:text-amber-400" />,
                    }
                }
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
        <div className="space-y-4" data-teg-live-sim={isBusy ? 'true' : 'false'}>
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

                {/* Botón auto-activable de Cajera en Línea / Headset (A1) + respaldo manual */}
                {phase === 'live' && (
                    !cashierTakeoverActive ? (
                        <button
                            type="button"
                            onClick={handleManualCashierTakeover}
                            className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/70 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-400 dark:hover:border-amber-600 px-3.5 py-2.5 text-left transition-all cursor-pointer group"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                <span className="p-2 rounded-lg bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 group-hover:bg-amber-200/80 dark:group-hover:bg-amber-900/60 group-hover:text-amber-900 dark:group-hover:text-amber-200 transition-colors shrink-0">
                                    <Headphones size={18} />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 truncate">
                                        {t('drive_thru.kore_cashier_btn_ready')}
                                    </p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {t('drive_thru.kore_cashier_btn_ready_sub')}
                                    </p>
                                </div>
                            </div>
                            <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                                <Radio size={12} className="animate-pulse" />
                                <span>{t('drive_thru.kore_cashier_cfg_badge_ready')}</span>
                            </span>
                        </button>
                    ) : (
                        <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border-2 border-amber-400 dark:border-amber-500 bg-gradient-to-r from-amber-50 via-emerald-50 to-teal-50 dark:from-amber-950/60 dark:via-emerald-950/50 dark:to-teal-950/50 px-3.5 py-3 shadow-md shadow-amber-500/10">
                            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                                <span className="p-2 rounded-lg bg-amber-500 text-white shadow-sm shrink-0 animate-pulse">
                                    <Headphones size={18} />
                                </span>
                                <div className="min-w-0 space-y-1">
                                    <p className="text-xs sm:text-sm font-black text-amber-950 dark:text-amber-100 break-words">
                                        {t('drive_thru.kore_cashier_btn_active')}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                            cashierSpeaking
                                                ? 'bg-emerald-600 text-white animate-pulse'
                                                : 'bg-white/80 dark:bg-slate-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                        }`}>
                                            {cashierSpeaking ? t('drive_thru.kore_cashier_btn_active_talking') : t('drive_thru.kore_cashier_btn_active_listening')}
                                        </span>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                                            {t('drive_thru.kore_cashier_active_source_badge', {
                                                source: formatCashierSourceLabel(cashierTriggerSource),
                                            })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={releaseCashierTakeoverToKore}
                                className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-black shadow-sm transition-all active:scale-95 cursor-pointer"
                            >
                                {t('drive_thru.kore_cashier_btn_release')}
                            </button>
                        </div>
                    )
                )}

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

                {/* Franja colapsable: Auto-detección física de Headset Cajera (HME J1 / Mic secundario / Estéreo R) */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => {
                            const next = !showCashierConfig
                            setShowCashierConfig(next)
                            if (next) void refreshAudioInputDevices()
                        }}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                    >
                        <span className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 min-w-0">
                            <Headphones size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="truncate">{t('drive_thru.kore_cashier_cfg_toggle')}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                serialConnected
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                                    : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            }`}>
                                {serialConnected ? t('drive_thru.kore_cashier_cfg_serial_connected') : t('drive_thru.kore_cashier_cfg_badge_ready')}
                            </span>
                        </span>
                        {showCashierConfig ? <ChevronUp size={15} className="text-slate-400 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                    </button>
                    {showCashierConfig && (
                        <div className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <label htmlFor="kore-cashier-channel" className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                            {t('drive_thru.kore_cashier_cfg_mic_label')}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => void refreshAudioInputDevices()}
                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                        >
                                            <RefreshCw size={11} />
                                            <span>{t('drive_thru.kore_cashier_cfg_refresh_mics')}</span>
                                        </button>
                                    </div>
                                    <select
                                        id="kore-cashier-channel"
                                        value={cashierChannelId}
                                        disabled={isBusy}
                                        onChange={e => setCashierChannelId(e.target.value)}
                                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 disabled:opacity-60"
                                    >
                                        <option value="">{t('drive_thru.kore_cashier_cfg_mic_none')}</option>
                                        <option value={KORE_STEREO_RIGHT_CHANNEL_ID}>{t('drive_thru.kore_cashier_cfg_mic_stereo_r')}</option>
                                        {audioInputDevices.map((dev, idx) => (
                                            <option key={dev.deviceId} value={dev.deviceId}>
                                                {dev.label || t('drive_thru.kore_cashier_cfg_mic_unnamed', { num: idx + 1 })}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col justify-between">
                                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('drive_thru.kore_cashier_cfg_serial_label')}
                                    </span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {serialSupported ? (
                                            !serialConnected ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void handleConnectSerialJ1()}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold transition-colors cursor-pointer"
                                                >
                                                    <Headphones size={13} />
                                                    <span>{t('drive_thru.kore_cashier_cfg_serial_connect')}</span>
                                                </button>
                                            ) : (
                                                <>
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                                                        {t('drive_thru.kore_cashier_cfg_serial_connected')}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDisconnectSerialJ1()}
                                                        className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 cursor-pointer"
                                                    >
                                                        {t('drive_thru.kore_cashier_cfg_serial_disconnect')}
                                                    </button>
                                                </>
                                            )
                                        ) : (
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {t('drive_thru.kore_cashier_cfg_serial_unsupported')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                {t('drive_thru.kore_cashier_cfg_hint')}
                            </p>
                        </div>
                    )}
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
                                    <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 break-words">
                                        {t('drive_thru.kore_fast_clips_top_hint', { items: fastClipsStats.topDriveThruItems.slice(0, 8).join(' · ') })}
                                    </p>
                                )}
                                {fastClipsHydratingBg && (
                                    <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                                        <Loader2 size={11} className="animate-spin shrink-0" />
                                        <span>
                                            {t('drive_thru.kore_fast_clips_hydrating_bg', {
                                                loaded: fastClipsHydratingBg.loaded,
                                                total: fastClipsHydratingBg.total,
                                            })}
                                        </span>
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
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                    <div>
                                        <p className="text-xs font-black text-slate-800 dark:text-white">{t('drive_thru.kore_fast_clips_catalog_title')}</p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('drive_thru.kore_fast_clips_catalog_sub')}</p>
                                    </div>
                                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                                        {t('drive_thru.kore_fast_clips_showing_count', {
                                            shown: filteredFastClipRows.length,
                                            total: fastClipCatalogRows.length,
                                        })}
                                    </span>
                                </div>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={fastClipsSearch}
                                        onChange={e => setFastClipsSearch(e.target.value)}
                                        placeholder={t('drive_thru.kore_fast_clips_search_placeholder')}
                                        className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                    {fastClipsSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setFastClipsSearch('')}
                                            aria-label={t('drive_thru.kore_fast_clips_search_clear')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
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
                                <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800">
                                    {filteredFastClipRows.length === 0 ? (
                                        <p className="p-6 text-center text-xs text-slate-400">
                                            {t('drive_thru.kore_fast_clips_search_empty', { query: fastClipsSearch.trim() })}
                                        </p>
                                    ) : filteredFastClipRows.map(row => {
                                        const esKey = `${row.clipId}:es`
                                        const enKey = `${row.clipId}:en`
                                        const playingEs = previewingClipKey === esKey
                                        const playingEn = previewingClipKey === enKey
                                        const catLabelKey =
                                            row.group === 'greeting'
                                                ? 'drive_thru.kore_fast_clips_cat_greeting'
                                                : row.group === 'clarify'
                                                    ? 'drive_thru.kore_fast_clips_cat_clarify'
                                                    : row.group === 'item_ack'
                                                        ? 'drive_thru.kore_fast_clips_cat_item_ack'
                                                        : row.group === 'modifiers'
                                                            ? 'drive_thru.kore_fast_clips_cat_modifiers'
                                                            : row.group === 'sendoff'
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
                            const isCashier = entry.role === 'cashier'
                            return (
                                <div key={entry.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                        isCustomer
                                            ? 'bg-orange-500 text-white rounded-br-md'
                                            : isCashier
                                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-slate-900 dark:text-emerald-50 border-2 border-emerald-300 dark:border-emerald-700 rounded-bl-md'
                                                : 'bg-violet-50 dark:bg-violet-950/40 text-slate-800 dark:text-slate-100 border border-violet-100 dark:border-violet-900 rounded-bl-md'
                                    } ${entry.final ? '' : 'opacity-80'}`}>
                                        <p className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mb-0.5 ${
                                            isCustomer
                                                ? 'text-orange-100'
                                                : isCashier
                                                    ? 'text-emerald-700 dark:text-emerald-300'
                                                    : 'text-violet-600 dark:text-violet-300'
                                        }`}>
                                            {isCustomer ? <User size={10} /> : isCashier ? <Headphones size={10} /> : <Bot size={10} />}
                                            {isCustomer
                                                ? t('drive_thru.kore_role_customer')
                                                : isCashier
                                                    ? t('drive_thru.kore_role_cashier')
                                                    : t('drive_thru.kore_role_kore')}
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
                                                    {(row.order?.cashierIntervention?.triggered === true ||
                                                        (Array.isArray(row.transcript) && row.transcript.some(turn => turn?.role === 'cashier'))) && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                                            <Headphones size={10} />
                                                            <span>{t('drive_thru.kore_history_cashier_badge')}</span>
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
