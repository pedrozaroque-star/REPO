/**
 * @module app/admin/llamadas/page
 * @description Centro de Control de la Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan (`/admin/llamadas`).
 * Incluye:
 * 1. Simulador Interactivo de Llamada en Vivo con micrófono (barge-in real) y voz neuronal `Kore` en streaming PCM 24kHz.
 * 2. Base de Conocimiento Editable en tiempo real (`phone_knowledge_base`) global o por sucursal + Detector Automático de
 *    Preguntas Nuevas (con opción de convertir en regla o descartar) + Días Festivos (`phone_special_hours` crear/editar/borrar).
 * 3. Configuración avanzada de las 15 Sucursales (idioma inicial, escalación fija a PC de tienda, segundos de timbrado, EBT, voz,
 *    estacionamiento y saludo personalizado) y Asistente de Desvío Condicional para Spectrum Business y AT&T Android.
 * 4. Bitácora de Llamadas (`phone_calls`) con filtro de origen (Twilio Real vs Simulador) y reproducción de voz bajo demanda,
 *    más Panel de Recados Prioritarios (`phone_callback_requests`) con notas de resolución.
 * 5. Aprendizaje Continuo Diario IA (`phone_learning_items` / `/api/phone/learning` + cron diario 5:35 AM PT) con Bandeja de Dudas
 *    Reales (`needs_owner_input`), enseñanza instantánea bilingüe y pre-calentamiento automático de audios WAV (`~80 ms`).
 *
 * @businessRules
 * - Un solo módulo unificado atiende a las 15 sucursales de Tacos Gavilan.
 * - Control de Acceso Basado en Roles (RBAC):
 *   * `admin` / `administrador` / `supervisor`: administran las 15 sucursales, reglas globales, festivos y desvíos.
 *   * `manager` / `general_manager` / `asistente`: acceso acotado estrictamente a su sucursal asignada (`Simulador` y
 *     `Bitácora & Recados` de su tienda).
 * - Los recados generados desde el Simulador Web se etiquetan con `source = 'simulator'` y NUNCA disparan alertas rojas
 *   en el tablero operativo `/order-ready-board` de la tienda.
 * - Cumple 100% con el protocolo bilingüe `useLanguage()` (`es` y `en` vía `t('phone_agent.*')`).
 *
 * @dataFlow
 * - UI `/admin/llamadas` -> `/api/phone/dashboard` (GET/POST/PATCH/DELETE con polling autenticado),
 *   `/api/phone/learning` (GET/POST/PATCH Aprendizaje Continuo Diario),
 *   `/api/phone/simulate` (POST NDJSON PCM stream) & `/api/phone/tts` (POST WAV replay).
 *
 * @notes
 * - Con RLS estricto habilitado en todas las tablas `phone_*`, la actualización automática se realiza mediante polling
 *   HTTP autenticado cada 12s (y al recuperar foco/red) en lugar de suscripciones `anon` de Supabase Realtime.
 * - Incluye respaldo automático de síntesis de voz femenina del navegador (con filtro estricto anti-Raul).
 * - Blindaje 2026-11-17: seguimiento granular de campos sin guardar (`dirtyStoreFieldsRef`) que preserva borradores al activar/apagar
 *   una tienda; cancelación total de red (`AbortController` + `reader.cancel()` + limpieza `src` HTMLAudio) y reproducción al interrumpir;
 *   validación estricta NANP E.164 anti-bucle antes de habilitar copia de códigos de desvío; y aviso acústico inicial de recados pendientes.
 * - Auditoría 2026-11-18: liberación síncrona de `simBusyRef` en `start_meta` (evita pérdida de clics/barge-in durante saludo),
 *   cierre automático al silenciar despedida terminal, candados síncronos `useRef` contra doble clic en CRUD y replay de audio,
 *   código `*73` en guía Spectrum Business, rol `administrador` en `ProtectedRoute` y limpieza de timers al desmontar.
 * - Upgrade 2026-11-18 (Paquete 1 + 2A + 2B): soporte visual en Bitácora/Recados para categorías `condiments_note` (tarjeta
 *   azul cielo de empaque), `wrong_store_order` (con badge de origen `origin_store_id` con entrecalles LA) y `delivery_issue`.
 * - Blindaje Auditoría Total 2026-11-18:
 *   * Guía AT&T Wireless actualizada tras error MMI real con `**61`: método primario por menú nativo Samsung/Android
 *     (`Servicios complementarios -> Desvío de llamadas`) + códigos AT&T sin `+1` y con `*11*` (`*61*<10d>*11*<sec>#`, `##002#`/`##004#`, `611`).
 *   * `tts_fallback_required` en inicio y turnos evita fetches redundantes a `/api/phone/tts`; `preserveSeq` en voz de respaldo
 *     evita que se pierda el auto-colgado; `hasReceivedAudio()` evita duplicar TTS cuando `AudioContext` está suspendido.
 *   * `computeAdaptiveSilenceDurationMs` con normalización Unicode, dedup de Chrome Android, detección de dígitos al final
 *     (no suma ticket+fecha+teléfono) y pausa inteligente en nombre/ticket/fecha; 6 escenarios rápidos corregidos sin `555-01XX`
 *     + nuevos escenarios Paquete 1+2A+2B y DT/Comedor `SIN TICKET`.
 * - Upgrade 2026-11-19 (Aprendizaje Continuo Diario IA + Puente Bidireccional con Kore Drive-Thru): pestaña bilingüe
 *   `Aprendizaje Continuo IA` conectada a `/api/phone/learning` con KPIs ejecutivos, bandeja de dudas reales (`needs_owner_input`),
 *   alcance por canal (`Teléfono + Drive-Thru`, `Solo Teléfono`, `Solo Drive-Thru`), insignia de enlace en vivo con Drive-Thru
 *   (`syncedDtItemId`), respuesta rápida de voz opcional (`<= 220` car., `~80 ms`) y sincronización espejo con `phone_knowledge_base`
 *   y `dt_kore_learning_items`.
 * - Optimización 2026-11-19 (Paquete 1B): polling silencioso del dashboard elevado de 12s a 60s con guardia `visibilityState === 'visible'`.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { normalizeTextForPhoneSpeech, pickStrictFemaleBrowserVoice } from '@/lib/phone-speech-format'
import {
  CANONICAL_CUSTOMER_STORES_BY_ID,
  formatCustomerGreetingTarget,
  formatCustomerStoreName
} from '@/lib/customer-store-names'
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Send,
  BookOpen,
  Store,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  RefreshCw,
  Smartphone,
  MessageSquare,
  Bell,
  Copy,
  Check,
  Calendar,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  PhoneForwarded,
  ShieldCheck,
  ShoppingBag,
  RotateCcw,
  Loader2,
  Gauge,
  MessageSquareQuote,
  Zap
} from 'lucide-react'
import {
  KorePhoneLiveSimulator,
  type KorePhoneLiveSimulatorHandle
} from '@/components/phone/KorePhoneLiveSimulator'

type VoiceId = 'Kore' | 'Aoede' | 'Zephyr'

const CLIENT_VOICES: ReadonlyArray<{ id: VoiceId; name: string }> = [
  { id: 'Kore', name: 'Kore ♀' },
  { id: 'Aoede', name: 'Aoede ♀' },
  { id: 'Zephyr', name: 'Zephyr ♀' }
]

interface ViewerInfo {
  id: number
  name: string
  email: string
  role: string
  isGlobalAdmin: boolean
  assignedStoreId: number | null
  allowedStoreIds: number[] | 'ALL'
}

interface ForwardingGuide {
  carrierLabelEs: string
  carrierLabelEn: string
  hasValidTwilioNumber?: boolean
  activateNoAnswerCode: string
  activateNoAnswerCodeEn: string
  deactivateNoAnswerCode: string
  activateBusyCode: string
  activateBusyCodeEn: string
  deactivateBusyCode: string
  activateUnreachableCode?: string
  activateUnreachableCodeEn?: string
  deactivateAllCode: string
  deactivateAllCodeEn: string
  deactivateCodes?: string[]
  stepsEs: string[]
  stepsEn: string[]
  gotchaEs: string
  gotchaEn: string
}

interface StoreRow {
  id: number
  name: string
  address: string
  phone: string
  has_drive_thru: boolean
  config: {
    store_id: number
    is_enabled: boolean
    routing_mode: string
    carrier_type: 'spectrum_landline' | 'att_wireless'
    twilio_phone_number: string | null
    forwarding_status: string
    ring_timeout_seconds: number
    voice_id: VoiceId
    default_language: 'es' | 'en'
    custom_greeting_es: string | null
    custom_greeting_en: string | null
    manager_transfer_phone: string | null
    allow_live_transfer: boolean
    accepts_ebt: boolean
    parking_notes_es: string | null
    parking_notes_en: string | null
  }
  scheduleEval: {
    isOpenNow: boolean
    activeDayLabelEs: string
    activeDayLabelEn: string
    todayOpenFormattedEs: string
    todayCloseFormattedEs: string
    todayOpenFormattedEn: string
    todayCloseFormattedEn: string
    statusMessageEs: string
    statusMessageEn: string
    weeklySummaryEs: string
    weeklySummaryEn: string
  }
  forwardingGuide: ForwardingGuide
}

interface KnowledgeRule {
  id: string
  store_id: number | null
  category: string
  title: string
  title_en?: string | null
  question_keywords: string | null
  answer_es: string
  answer_en: string
  is_active: boolean
  priority: number
  stores?: { id: number; name: string } | null
}

interface SpecialHourRow {
  id: string
  store_id: number | null
  event_date: string
  holiday_name: string
  is_closed: boolean
  open_time: string | null
  close_time: string | null
  stores?: { id: number; name: string } | null
}

interface CallRow {
  id: string
  call_sid: string
  store_id: number
  source: string
  caller_number: string | null
  caller_name?: string | null
  caller_name_source?: string | null
  language: string
  caller_category: string
  primary_intent: string
  status: string
  resolved_by_ai: boolean
  duration_seconds: number
  turns_count: number
  summary: string | null
  unanswered_question: string | null
  transcript: Array<{ role: string; text: string; timestamp: string; toolName?: string }>
  started_at: string
  stores?: { id: number; name: string } | null
}

interface CallbackRow {
  id: string
  call_id: string | null
  store_id: number
  origin_store_id?: number | null
  source?: string
  caller_name: string
  caller_phone: string
  caller_type: string
  urgency: string
  reason_category: string
  reason_summary: string
  ticket_or_order_number: string | null
  status: string
  resolved_by: string | null
  resolved_at?: string | null
  resolution_notes: string | null
  created_at: string
  stores?: { id: number; name: string } | null
}

type PhoneLearningChannelScope = 'both' | 'phone_only' | 'drive_thru_only'

interface PhoneLearningItemRow {
  id: string
  storeId: number | null
  sourceCallId: string | null
  sourceType: string
  itemKind: string
  status: string
  category: string
  appliesToChannels: PhoneLearningChannelScope
  syncedDtItemId: string | null
  kbEntryId: string | null
  questionOrTrigger: string
  questionOrTriggerEn: string | null
  triggerKeywords: string[]
  customerQuote: string | null
  koreQuote: string | null
  doubtForOwner: string | null
  doubtForOwnerEn: string | null
  proposedRuleEs: string | null
  proposedRuleEn: string | null
  fastReplyEs: string | null
  fastReplyEn: string | null
  ownerInstruction: string | null
  evidenceCount: number
  avgLatencyMs: number | null
  audioPrewarmed: boolean
  resolvedByName: string | null
  resolvedAt: string | null
  createdAt: string | null
}

type PhoneLearningItem = PhoneLearningItemRow

interface PhoneLearningStats {
  pendingDoubts: number
  activeRules: number
  prewarmedClips: number
  analyzedCalls: number
  avgTurnLatencyMs: number | null
}

function inferDefaultPhoneLearningChannels(
  rawChannel: unknown,
  categoryRaw: unknown,
  textRaw: unknown
): PhoneLearningChannelScope {
  if (rawChannel === 'phone_only' || rawChannel === 'drive_thru_only' || rawChannel === 'both') {
    return rawChannel
  }
  const cat = String(categoryRaw ?? '').toLowerCase().trim()
  const txt = String(textRaw ?? '').toLowerCase()
  if (
    cat === 'staff' ||
    /\b(no tomamos [oó]rdenes por tel[eé]fono|recado|alerta prioritaria|desv[ií]o|spectrum|at&t|colgar llamada|transferir llamada)\b/i.test(
      txt
    )
  ) {
    return 'phone_only'
  }
  return 'both'
}

function normalizePhoneLearningItem(raw: Record<string, any>): PhoneLearningItemRow {
  const rawStoreId = raw.storeId !== undefined ? raw.storeId : raw.store_id
  const parsedStoreId =
    rawStoreId !== null && rawStoreId !== undefined && Number.isFinite(Number(rawStoreId))
      ? Number(rawStoreId)
      : null
  const rawLat = raw.avgLatencyMs !== undefined ? raw.avgLatencyMs : raw.avg_latency_ms
  const category = String(raw.category ?? 'general')
  const questionOrTrigger = String(raw.questionOrTrigger ?? raw.question_or_trigger ?? '')
  const rawQuestionOrTriggerEn = raw.questionOrTriggerEn ?? raw.question_or_trigger_en ?? null
  const questionOrTriggerEn =
    typeof rawQuestionOrTriggerEn === 'string' && rawQuestionOrTriggerEn.trim()
      ? rawQuestionOrTriggerEn.trim()
      : null
  const rawDoubtEn = raw.doubtForOwnerEn ?? raw.doubt_for_owner_en ?? null
  const doubtForOwnerEn =
    typeof rawDoubtEn === 'string' && rawDoubtEn.trim() ? rawDoubtEn.trim() : null
  const rawChannel = raw.appliesToChannels ?? raw.applies_to_channels
  const rawSyncedDt = raw.syncedDtItemId ?? raw.synced_dt_item_id ?? null
  const rawKbId = raw.kbEntryId ?? raw.kb_entry_id ?? null
  return {
    id: String(raw.id ?? ''),
    storeId: parsedStoreId,
    sourceCallId: raw.sourceCallId ?? raw.source_call_id ?? null,
    sourceType: String(raw.sourceType ?? raw.source_type ?? 'cron_daily'),
    itemKind: String(raw.itemKind ?? raw.item_kind ?? 'learned_rule'),
    status: String(raw.status ?? 'needs_owner_input'),
    category,
    appliesToChannels: inferDefaultPhoneLearningChannels(
      rawChannel,
      category,
      `${questionOrTrigger} ${questionOrTriggerEn ?? ''} ${raw.doubtForOwner ?? raw.doubt_for_owner ?? ''} ${doubtForOwnerEn ?? ''} ${raw.proposedRuleEs ?? raw.proposed_rule_es ?? ''}`
    ),
    syncedDtItemId: rawSyncedDt ? String(rawSyncedDt) : null,
    kbEntryId: rawKbId ? String(rawKbId) : null,
    questionOrTrigger,
    questionOrTriggerEn,
    triggerKeywords: Array.isArray(raw.triggerKeywords)
      ? raw.triggerKeywords.map(String)
      : Array.isArray(raw.trigger_keywords)
        ? raw.trigger_keywords.map(String)
        : [],
    customerQuote: raw.customerQuote ?? raw.customer_quote ?? null,
    koreQuote: raw.koreQuote ?? raw.kore_quote ?? null,
    doubtForOwner: raw.doubtForOwner ?? raw.doubt_for_owner ?? null,
    doubtForOwnerEn,
    proposedRuleEs: raw.proposedRuleEs ?? raw.proposed_rule_es ?? null,
    proposedRuleEn: raw.proposedRuleEn ?? raw.proposed_rule_en ?? null,
    fastReplyEs: raw.fastReplyEs ?? raw.fast_reply_es ?? null,
    fastReplyEn: raw.fastReplyEn ?? raw.fast_reply_en ?? null,
    ownerInstruction: raw.ownerInstruction ?? raw.owner_instruction ?? null,
    evidenceCount: Math.max(1, Number(raw.evidenceCount ?? raw.evidence_count ?? 1) || 1),
    avgLatencyMs:
      typeof rawLat === 'number' && Number.isFinite(rawLat) ? Math.round(rawLat) : null,
    audioPrewarmed: Boolean(raw.audioPrewarmed ?? raw.audio_prewarmed ?? false),
    resolvedByName: raw.resolvedByName ?? raw.resolved_by_name ?? null,
    resolvedAt: raw.resolvedAt ?? raw.resolved_at ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null
  }
}

function buildPhoneBilingualLines(
  textEs: string | null | undefined,
  textEn: string | null | undefined,
  isEn: boolean,
  fallbackText?: string | null
): Array<{ flag: string; code: 'ES' | 'EN'; text: string }> {
  const cleanEs = String(textEs ?? '').trim()
  const cleanEn = String(textEn ?? '').trim()
  const cleanFallback = String(fallbackText ?? '').trim()
  const esEntry = cleanEs ? { flag: '🇲🇽', code: 'ES' as const, text: cleanEs } : null
  const enEntry = cleanEn ? { flag: '🇺🇸', code: 'EN' as const, text: cleanEn } : null
  const ordered = isEn ? [enEntry, esEntry] : [esEntry, enEntry]
  const nonEmpty = ordered.filter(
    (entry): entry is { flag: string; code: 'ES' | 'EN'; text: string } => entry !== null
  )
  if (nonEmpty.length > 0) return nonEmpty
  if (!cleanFallback) return []
  return [isEn ? { flag: '🇺🇸', code: 'EN', text: cleanFallback } : { flag: '🇲🇽', code: 'ES', text: cleanFallback }]
}

const CLIENT_BLOCKED_NANP_AREA_CODES = new Set([
  '456', '500', '600', '622', '700', '900', '976',
  '242', '246', '264', '268', '284', '345', '441', '473',
  '649', '658', '664', '721', '758', '767', '784',
  '809', '829', '849', '868', '869', '876'
])

function validateClientTwilioNumber(
  rawTwilioNumber: string | null | undefined,
  options?: {
    storePhones?: Array<string | null | undefined>
    directConflictTenDigits?: Set<string>
  }
): { valid: boolean; isEmpty: boolean; tenDigits: string } {
  const trimmed = String(rawTwilioNumber ?? '').trim()
  if (!trimmed) return { valid: false, isEmpty: true, tenDigits: '' }
  const strippedLeading = trimmed.replace(/^[\s(]+/, '')
  const plusCount = (trimmed.match(/\+/g) || []).length
  if (plusCount > 1 || (plusCount === 1 && !/^\+1(?:\D|\d|$)/.test(strippedLeading))) {
    return { valid: false, isEmpty: false, tenDigits: '' }
  }
  const digits = trimmed.replace(/\D/g, '')
  const tenDigits =
    digits.length === 10 ? digits : digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : ''
  if (tenDigits.length !== 10) return { valid: false, isEmpty: false, tenDigits: '' }

  const areaCode = tenDigits.slice(0, 3)
  const centralOffice = tenDigits.slice(3, 6)
  const isFictitious =
    areaCode === '555' ||
    centralOffice === '555' ||
    centralOffice === '976' ||
    tenDigits.slice(3) === '0000000' ||
    /^(\d)\1{9}$/.test(tenDigits) ||
    /^(\d)\1{6}$/.test(tenDigits.slice(3)) ||
    tenDigits.slice(3) === '1234567' ||
    tenDigits === '1234567890'

  if (
    !/^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits) ||
    areaCode.slice(1) === '11' ||
    centralOffice.slice(1) === '11' ||
    CLIENT_BLOCKED_NANP_AREA_CODES.has(areaCode) ||
    isFictitious
  ) {
    return { valid: false, isEmpty: false, tenDigits: '' }
  }

  const matchesStoreOwnPhone = (options?.storePhones || []).some((sp) => {
    const d = String(sp || '').replace(/\D/g, '')
    const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
    return ten.length === 10 && ten === tenDigits
  })
  if (matchesStoreOwnPhone) return { valid: false, isEmpty: false, tenDigits: '' }

  if (options?.directConflictTenDigits?.has(tenDigits)) {
    return { valid: false, isEmpty: false, tenDigits: '' }
  }

  return { valid: true, isEmpty: false, tenDigits }
}

function computeClientForwardingGuide(
  carrierType: 'spectrum_landline' | 'att_wireless',
  rawTwilioNumber: string | null | undefined,
  ringSeconds = 20,
  options?: {
    storePhones?: Array<string | null | undefined>
    directConflictTenDigits?: Set<string>
  }
): ForwardingGuide {
  const twCheck = validateClientTwilioNumber(rawTwilioNumber, options)
  const tenDigits = twCheck.tenDigits
  const hasValidTwilioNumber = twCheck.valid
  const target10Es = hasValidTwilioNumber ? tenDigits : 'TU_NUMERO_TWILIO'
  const target10En = hasValidTwilioNumber ? tenDigits : 'TWILIO_NUMBER'
  const safeSec = Number.isFinite(Number(ringSeconds)) && Number(ringSeconds) > 0 ? Number(ringSeconds) : 20
  const clampedSec = Math.min(30, Math.max(5, Math.round(safeSec / 5) * 5))

  if (carrierType === 'spectrum_landline') {
    return {
      carrierLabelEs: 'Spectrum Business Voice (Línea Fija)',
      carrierLabelEn: 'Spectrum Business Voice (Landline)',
      hasValidTwilioNumber,
      activateNoAnswerCode: `*92${target10Es}`,
      activateNoAnswerCodeEn: `*92${target10En}`,
      deactivateNoAnswerCode: '*93',
      activateBusyCode: `*90${target10Es}`,
      activateBusyCodeEn: `*90${target10En}`,
      deactivateBusyCode: '*91',
      deactivateAllCode: '*93 / *91 / *73',
      deactivateAllCodeEn: '*93 / *91 / *73',
      deactivateCodes: ['*93', '*91', '*73'],
      stepsEs: [
        '1. Levanta el auricular del teléfono fijo Spectrum Business de la tienda y espera tono de marcar.',
        `2. Marca *92${target10Es} y espera el tono de confirmación para desviar ÚNICAMENTE cuando la tienda no conteste (el número de timbrazos se configura en SpectrumBusiness.net -> Voice Manager).`,
        `3. Cuelga, vuelve a levantar y marca *90${target10Es} para desviar también si la línea está ocupada.`,
        '4. Opcional desde oficina: entra a SpectrumBusiness.net -> Voice Manager -> Call Forwarding -> "When Busy or No Answer" -> ingresa el número Twilio y desactiva Buzón de Voz.'
      ],
      stepsEn: [
        '1. Pick up the store Spectrum Business landline handset and wait for a dial tone.',
        `2. Dial *92${target10En} and wait for the confirmation tone to forward ONLY when unanswered (ring count is adjusted in SpectrumBusiness.net -> Voice Manager).`,
        `3. Hang up, pick up again, and dial *90${target10En} to also forward when the line is busy.`,
        '4. Optional remote setup: log into SpectrumBusiness.net -> Voice Manager -> Call Forwarding -> "When Busy or No Answer" and disable Voicemail.'
      ],
      gotchaEs:
        'Importante: NO uses *72 (desvío inmediato) porque el teléfono de tienda dejaría de sonar; si alguien lo activó por error, cancélalo marcando *73. En Spectrum, el tiempo antes de desviar y desactivar Buzón de Voz se ajustan en SpectrumBusiness.net -> Voice Manager.',
      gotchaEn:
        'Important: DO NOT use *72 (unconditional forwarding) or the store phone will stop ringing; if enabled by mistake, dial *73 to cancel it. In Spectrum, disable Voicemail or adjust ring timeout in SpectrumBusiness.net -> Voice Manager.'
    }
  }

  return {
    carrierLabelEs: 'Celular Android con AT&T Wireless',
    carrierLabelEn: 'Android Cellphone on AT&T Wireless',
    hasValidTwilioNumber,
    activateNoAnswerCode: `*61*${target10Es}*11*${clampedSec}#`,
    activateNoAnswerCodeEn: `*61*${target10En}*11*${clampedSec}#`,
    deactivateNoAnswerCode: '##61#',
    activateBusyCode: `*67*${target10Es}#`,
    activateBusyCodeEn: `*67*${target10En}#`,
    deactivateBusyCode: '##67#',
    activateUnreachableCode: `*62*${target10Es}#`,
    activateUnreachableCodeEn: `*62*${target10En}#`,
    deactivateAllCode: '##002#',
    deactivateAllCodeEn: '##002#',
    deactivateCodes: ['##002#', '##004#'],
    stepsEs: [
      '1. OPCIÓN 1 RECOMENDADA (Menú nativo Samsung/Android — evita "Problema de conexión o código incorrecto de MMI"): apaga temporalmente Wi-Fi y "Llamadas Wi-Fi" (Wi-Fi Calling) para ver señal 5G/LTE.',
      '2. Abre la app Teléfono -> ⋮ (arriba a la derecha) -> Ajustes (Configuración) -> Servicios complementarios -> Desvío de llamadas -> Llamada de voz.',
      `3. Configura SOLO las 3 opciones condicionales con ${target10Es}: ✅ Ocupado, ✅ Sin contestar (${clampedSec}s si lo ofrece) y ✅ No disponible. DEJA ❌ "Desviar siempre" DESACTIVADO para que el celular de la tienda timbre primero.`,
      `4. OPCIÓN 2 (Teclado manual AT&T sin "+1" y con "*11*"): con Wi-Fi y Wi-Fi Calling apagados, activa/desactiva Modo Avión 10s, limpia desvíos marcando ##002# (o ##004#) y luego marca *61*${target10Es}*11*${clampedSec}# (sin contestar), *67*${target10Es}# (ocupado) y *62*${target10Es}# (sin señal). Respaldo si rechaza *61*: **61*${target10Es}*11*${clampedSec}# o *61*1${target10Es}*11*${clampedSec}#.`,
      '5. Vuelve a encender Wi-Fi / Llamadas Wi-Fi si la sucursal lo utiliza.'
    ],
    stepsEn: [
      '1. OPTION 1 RECOMMENDED (Native Samsung/Android menu — avoids "Connection problem or invalid MMI code"): temporarily turn OFF Wi-Fi and Wi-Fi Calling so the phone shows 5G/LTE.',
      '2. Open the Phone app -> ⋮ (top right) -> Settings -> Supplementary services -> Call forwarding -> Voice call.',
      `3. Set ONLY the 3 conditional options to ${target10En}: ✅ Forward when busy, ✅ Forward when unanswered (${clampedSec}s if shown), and ✅ Forward when unreachable. KEEP ❌ "Always forward" OFF so the store phone rings first.`,
      `4. OPTION 2 (Manual AT&T keypad without "+1", using "*11*"): with Wi-Fi & Wi-Fi Calling OFF, toggle Airplane Mode for 10s, clear old forwards with ##002# (or ##004#), then dial *61*${target10En}*11*${clampedSec}# (unanswered), *67*${target10En}# (busy), and *62*${target10En}# (unreachable). Fallback if *61* fails: **61*${target10En}*11*${clampedSec}# or *61*1${target10En}*11*${clampedSec}#.`,
      '5. Re-enable Wi-Fi / Wi-Fi Calling if needed.'
    ],
    gotchaEs:
      'Si AT&T muestra "Problema de conexión o código incorrecto de MMI" aun con Wi-Fi/Wi-Fi Calling apagados y tras marcar ##002# / ##004#, usa el menú nativo (Paso 2) o marca al 611 (Soporte Técnico AT&T) para que activen Desvío Condicional y verifiquen que el IMEI de la SIM coincida con este equipo.',
    gotchaEn:
      'If AT&T still shows "Connection problem or invalid MMI code" with Wi-Fi & Wi-Fi Calling off and after dialing ##002# / ##004#, use the native Phone menu (Step 2) or dial 611 (AT&T Tech Support) to provision Conditional Call Forwarding and verify SIM IMEI alignment.'
  }
}

function formatStoreDateTime(iso: string | null | undefined, isEn: boolean): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  try {
    return d.toLocaleString(isEn ? 'en-US' : 'es-MX', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'short',
      timeStyle: 'short'
    })
  } catch {
    return d.toLocaleString()
  }
}

function stripDiacriticsLower(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function detectTranscriptMessageLang(text: string, callLang: 'es' | 'en'): 'es' | 'en' {
  const raw = String(text || '')
  if (!raw.trim()) return callLang
  const norm = stripDiacriticsLower(raw)
  const esMatches = norm.match(
    /\b(hola|gracias|buenos|buenas|abierto|abrimos|cerrado|cerramos|tienda|sucursal|precio|cuesta|cuestan|estamos|tenemos|horario|horarios|dolares|orden|pedido|gerente|recado|por favor|disculpa|claro|como|donde|cuando|puede|puedo|ayudo|ayudar)\b/g
  )
  const enMatches = norm.match(
    /\b(hello|thank you|thanks|welcome|we are|we're|open|closed|close|price|prices|how can i|help you|address|dollars|order|manager|callback|please|sorry|sure|where|when|hours|today|tomorrow|store|location)\b/g
  )
  const esScore = (esMatches?.length || 0) + (/[¿¡]/.test(raw) ? 2 : 0)
  const enScore = enMatches?.length || 0
  if (esScore >= 2 && esScore > enScore) return 'es'
  if (enScore >= 2 && enScore > esScore) return 'en'
  if (esScore > enScore && esScore >= 1 && callLang === 'es') return 'es'
  if (enScore > esScore && enScore >= 1 && callLang === 'en') return 'en'
  if (esScore > 0 && enScore === 0) return 'es'
  if (enScore > 0 && esScore === 0) return 'en'
  return callLang
}

function dedupCumulativeSpeechParts(rawParts: string[]): string {
  const cleaned: string[] = []
  for (const raw of rawParts) {
    const part = String(raw || '').trim().replace(/\s+/g, ' ')
    if (!part) continue
    if (cleaned.length === 0) {
      cleaned.push(part)
      continue
    }
    const prevAll = cleaned.join(' ')
    const normPart = stripDiacriticsLower(part)
    const normPrevAll = stripDiacriticsLower(prevAll)
    const normLast = stripDiacriticsLower(cleaned[cleaned.length - 1])
    if (normPart === normLast || normPart === normPrevAll) {
      continue
    }
    // Android Chrome con continuous=true suele emitir slots acumulativos donde el nuevo slot contiene al acumulado previo
    if (normPart.startsWith(normPrevAll + ' ')) {
      cleaned.length = 0
      cleaned.push(part)
      continue
    }
    if (normPart.startsWith(normLast + ' ')) {
      cleaned[cleaned.length - 1] = part
      continue
    }
    cleaned.push(part)
  }
  return cleaned.join(' ').replace(/\s+/g, ' ').trim()
}

function computeAdaptiveSilenceDurationMs(
  combinedText: string,
  isFinalUtterance: boolean,
  lastAssistantText: string
): number {
  const trimmed = String(combinedText || '').trim()
  if (!trimmed) return isFinalUtterance ? 420 : 950
  const normText = stripDiacriticsLower(trimmed)
  const normAssistant = stripDiacriticsLower(lastAssistantText || '')

  const assistantAskedDetails =
    /(?:^|[^a-z0-9])(tu\s+nombre|su\s+nombre|como\s+te\s+llamas|hablo\s+con|tu\s+numero|su\s+numero|mismo\s+numero|terminado\s+en|tu\s+telefono|su\s+telefono|10\s+digitos|diez\s+digitos|digitos\s+restantes|ultimos\s+\d*\s*digitos|numero\s+de\s+ticket|numero\s+de\s+orden|recibo|fecha\s+de\s+(?:tu\s+|su\s+)?compra|que\s+dia|que\s+cambio|your\s+name|speaking\s+with|whats\s+your\s+name|what'?s\s+your\s+name|your\s+phone|your\s+number|this\s+number|ending\s+in|phone\s+number|10\s+digits|ten\s+digits|10-digit|remaining\s+digits|last\s+\d*\s*digits|ticket\s+number|order\s+number|receipt|purchase\s+date|what\s+change)(?:$|[^a-z0-9])/i.test(
      normAssistant
    )

  // 1. Conector abierto al final (incluyendo puntuación que agrega Web Speech API como "." o ",") SIEMPRE espera primero
  const endsInOpenConnector =
    /(?:^|[^a-z0-9])(y|e|o|de|del|al|el|la|los|las|mi|su|es|son|con|para|que|por|a|en|un|una|pero|porque|nombre|celular|numero|telefono|llama|llamo|soy|and|or|of|the|my|is|are|with|for|to|at|in|on|from|about|but|because|so|name|cell|number|i'?m|called)[\s,.:;!?…]*$/i.test(
      normText
    )
  if (endsInOpenConnector) return isFinalUtterance ? 1400 : 2100

  // 2. Extraer únicamente la secuencia telefónica final (evita sumar dígitos previos de ticket/fecha + código de área)
  const trailingPhoneMatch = trimmed.match(/\(?\d[\d\s\-().]*$/i)
  const trailingRaw = trailingPhoneMatch ? trailingPhoneMatch[0] : ''
  const trailingDigitsCount = trailingRaw.replace(/\D/g, '').length
  const precedingBeforeTrailing = trailingPhoneMatch
    ? stripDiacriticsLower(trimmed.slice(0, trailingPhoneMatch.index || 0)).trim()
    : ''
  const isCurrencyOrTicketOrQty =
    /\$\s*$/.test(precedingBeforeTrailing) ||
    /(?:^|[^a-z0-9])(ticket|orden|order|receipt|recibo|personas|people|tacos|burritos|quesadillas|tortas|mulitas|sopes|aguas|horchatas|flan|flanes)\s*#?$/.test(
      precedingBeforeTrailing
    )

  // Teléfono completo (10 u 11 dígitos con 1) al final sin conector abierto -> envío rápido
  const hasCompleteTrailingPhone =
    !isCurrencyOrTicketOrQty &&
    (trailingDigitsCount === 10 || (trailingDigitsCount === 11 && trailingRaw.replace(/\D/g, '').startsWith('1')))
  if (hasCompleteTrailingPhone) return isFinalUtterance ? 480 : 950

  // Teléfono en curso (3-9 dígitos, incluyendo "(323)", o 1-2 dígitos si la IA acaba de pedir teléfono/datos)
  const looksLikePartialPhoneDigits =
    !isCurrencyOrTicketOrQty &&
    ((trailingDigitsCount >= 3 && trailingDigitsCount <= 9) ||
      (assistantAskedDetails && trailingDigitsCount >= 1 && trailingDigitsCount <= 2))
  if (looksLikePartialPhoneDigits) return isFinalUtterance ? 1750 : 2400

  // Dígitos dictados con palabras ("tres dos tres", "three two three") sin completar 10 dígitos
  const spokenDigitTail = normText.match(
    /(?:(?:^|\s)(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|oh|one|two|three|four|five|six|seven|eight|nine)){2,9}[\s,.:;!?…]*$/i
  )
  if (spokenDigitTail) return isFinalUtterance ? 1750 : 2400

  // 3. Si la IA pidió nombre/teléfono/ticket/fecha y aún no da un teléfono completo, dar margen incluso si isFinal=true (ej. "Roberto Gómez" antes de dictar su número)
  const anyCompletePhoneInText = /(?:^|\D)(?:1[\s\-.]?)?\(?[2-9]\d{2}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}(?:$|\D)/.test(
    trimmed
  )
  if (assistantAskedDetails && !anyCompletePhoneInText) {
    return isFinalUtterance ? 1200 : 1800
  }

  return isFinalUtterance ? 420 : 950
}

const SCENARIO_GROUPS = [
  { id: 'all', key: 'phone_agent.sim_group_all' },
  { id: 'hours', key: 'phone_agent.sim_group_hours' },
  { id: 'menu', key: 'phone_agent.sim_group_menu' },
  { id: 'catering', key: 'phone_agent.sim_group_catering' },
  { id: 'payments', key: 'phone_agent.sim_group_payments' },
  { id: 'issues', key: 'phone_agent.sim_group_issues' },
  { id: 'staff', key: 'phone_agent.sim_group_staff' }
] as const

const QUICK_SCENARIOS: Array<{
  id: string
  group: 'hours' | 'menu' | 'catering' | 'payments' | 'issues' | 'staff'
  labelEs: string
  labelEn: string
  textEs: string
  textEn: string
}> = [
  {
    id: 'hours_dt',
    group: 'hours',
    labelEs: '🕐 ¿Están abiertos ahorita, a qué hora cierran hoy y tienen Drive-Thru?',
    labelEn: '🕐 Are you open right now, what time do you close & do you have Drive-Thru?',
    textEs: 'Hola, ¿están abiertos ahorita, a qué hora cierran hoy y tienen Drive-Thru en esta sucursal?',
    textEn: 'Hi, are you open right now, what time do you close today, and does this location have a Drive-Thru?'
  },
  {
    id: 'weekend_late_hours',
    group: 'hours',
    labelEs: '🌙 Horario nocturno viernes/sábado y a qué hora abren mañana',
    labelEn: '🌙 Friday/Saturday late-night hours & tomorrow opening time',
    textEs: '¿Hasta qué hora cierran los viernes y sábados en la noche, y a qué hora abren mañana en la mañana?',
    textEn: 'How late do you stay open on Friday and Saturday nights, and what time do you open tomorrow morning?'
  },
  {
    id: 'address_parking',
    group: 'hours',
    labelEs: '📍 Dirección exacta de esta sucursal y teléfono directo',
    labelEn: '📍 Exact street address & direct phone number of this store',
    textEs: '¿Me puedes dar la dirección exacta de esta sucursal y confirmar el teléfono de aquí?',
    textEn: 'Can you give me the exact street address for this location and confirm your phone number?'
  },
  {
    id: 'other_stores_dt',
    group: 'hours',
    labelEs: '🚗 ¿Cuáles sucursales de Tacos Gavilan SÍ tienen Drive-Thru?',
    labelEn: '🚗 Which Tacos Gavilan locations DO have a Drive-Thru?',
    textEs: 'Traigo a mis niños dormidos en el carro, ¿me dices cuáles sucursales de Tacos Gavilan sí tienen ventanilla de Drive-Thru?',
    textEn: 'My kids are asleep in the car—can you tell me which Tacos Gavilan locations have a Drive-Thru window?'
  },
  {
    id: 'holiday_hours',
    group: 'hours',
    labelEs: '🎄 Días festivos (Thanksgiving / Navidad): ¿abren en horario especial?',
    labelEn: '🎄 Holiday hours (Thanksgiving / Christmas): are you open?',
    textEs: 'Quería preguntar si van a abrir en Día de Acción de Gracias o Navidad, o si tienen algún horario festivo especial.',
    textEn: 'I wanted to ask if you will be open on Thanksgiving or Christmas, or if you have special holiday hours.'
  },
  {
    id: 'prices',
    group: 'menu',
    labelEs: '🌮 Precios clásicos: Taco de Asada, Super Burrito y Horchata Grande',
    labelEn: '🌮 Classic prices: Asada Taco, Super Burrito & Large Horchata',
    textEs: '¿Me puedes decir cuánto cuesta el taco de carne asada, el super burrito de asada y un agua de horchata grande?',
    textEn: 'Can you tell me how much a Carne Asada taco, an Asada Super Burrito, and a large Horchata cost?'
  },
  {
    id: 'prices_specialties',
    group: 'menu',
    labelEs: '🥪 Especialidades: Torta Cubana, Super Mulita de Pastor y Taco Plate',
    labelEn: '🥪 Specialties: Torta Cubana, Pastor Super Mulita & Taco Plate',
    textEs: '¿Cuánto cuesta una torta cubana, una super mulita de pastor y el plato de tres tacos con arroz y frijol?',
    textEn: 'How much is a Torta Cubana, an Al Pastor Super Mulita, and the three-taco plate with rice and beans?'
  },
  {
    id: 'drinks_champurrado',
    group: 'menu',
    labelEs: '☕ Bebidas: Champurrado (vaso y caja 96oz), Café y Galón de Agua Fresca',
    labelEn: '☕ Drinks: Champurrado (cup & 96oz box), Coffee & Gallon Agua Fresca',
    textEs: '¿Venden champurrado y café? ¿Cuánto cuesta el vaso, la caja grande de champurrado para llevar y el galón de agua fresca?',
    textEn: 'Do you sell Champurrado and coffee? How much is a cup, the 96oz Champurrado box, and a gallon of agua fresca?'
  },
  {
    id: 'breakfast_desserts',
    group: 'menu',
    labelEs: '🍳 Desayunos con Huevo + Postres (Flan y Cheesecake)',
    labelEn: '🍳 Egg Breakfast items + Desserts (Flan & Cheesecake)',
    textEs: '¿Tienen burritos o platos de desayuno con huevo, y venden postres como flan o cheesecake? ¿Qué precios tienen?',
    textEn: 'Do you serve egg breakfast burritos or plates, and do you have desserts like flan or cheesecake? What are the prices?'
  },
  {
    id: 'sides_extras',
    group: 'menu',
    labelEs: '🥑 Extras sueltos: Orden de Guacamole, Arroz, Frijol y Chips',
    labelEn: '🥑 Side orders: Guacamole, Rice, Beans & Chips',
    textEs: '¿Cuánto cuesta aparte una orden de guacamole, una de arroz, una de frijoles y una bolsa de chips?',
    textEn: 'How much is a side order of guacamole, a side of rice, a side of beans, and an order of chips?'
  },
  {
    id: 'meats_menu',
    group: 'menu',
    labelEs: '🥩 ¿Qué variedad de carnes tienen y hacen tortillas y salsas frescas?',
    labelEn: '🥩 What meat options do you serve & are tortillas and salsas fresh?',
    textEs: '¿Qué variedad de carnes tienen para los tacos y burritos, y sus tortillas y salsas son frescas?',
    textEn: 'What types of meat do you have for tacos and burritos, and are your tortillas and salsas freshly made?'
  },
  {
    id: 'vegetarian_allergies',
    group: 'menu',
    labelEs: '🥗 Opciones vegetarianas / sin carne y consulta de alergia severa',
    labelEn: '🥗 Vegetarian / meatless options & severe food allergy inquiry',
    textEs: 'Mi hija es vegetariana y tiene alergia severa a las nueces: ¿qué platillos sin carne tienen y cómo manejan las alergias?',
    textEn: 'My daughter is vegetarian and has a severe nut allergy: what meatless items do you have and how should we handle allergies?'
  },
  {
    id: 'unavailable_item',
    group: 'menu',
    labelEs: '🚫 Productos que NO manejamos: ¿Pastel de cumpleaños, menudo o cerveza?',
    labelEn: '🚫 Items we DO NOT carry: Birthday cakes, menudo, or beer?',
    textEs: 'Oye, una pregunta rápida: ¿venden pasteles de cumpleaños, menudo los domingos o cerveza en esta sucursal?',
    textEn: 'Quick question: do you guys sell birthday cakes, menudo on Sundays, or beer at this location?'
  },
  {
    id: 'platters_small',
    group: 'catering',
    labelEs: '🍱 Reunión chica (18 personas): paquete, carnes y aguas a elegir',
    labelEn: '🍱 Small gathering (18 guests): package, meat & drink choices',
    textEs: 'Somos 18 personas en la oficina hoy: ¿cuál charola Fiesta Platter nos recomiendas, cuánto cuesta y qué carnes y aguas incluye?',
    textEn: 'We have 18 people at the office today: which Fiesta Platter do you recommend, how much is it, and what meats and drinks come with it?'
  },
  {
    id: 'platters',
    group: 'catering',
    labelEs: '🍱 Charola Fiesta Platter para 30 personas (opciones y anticipación)',
    labelEn: '🍱 Fiesta Platter for 30 guests (options & advance notice)',
    textEs: 'Tengo una reunión para 30 personas hoy en la tarde. ¿Cuánto cuesta la charola Fiesta Platter, qué incluye y con cuánta anticipación se pide?',
    textEn: 'I have a party for 30 people this afternoon. How much is the Fiesta Platter, what does it include, and how much advance notice is needed?'
  },
  {
    id: 'platters_large',
    group: 'catering',
    labelEs: '🎉 Evento grande (85 personas): cuántas charolas combinar y total',
    labelEn: '🎉 Large event (85 guests): how many platters to combine & total',
    textEs: 'Tengo una fiesta familiar para 85 personas este sábado: ¿cuántos paquetes Fiesta Platter necesito combinar y cuánto sería en total?',
    textEn: 'I am hosting a family party for 85 guests this Saturday: how many Fiesta Platter packages should I combine and what is the total price?'
  },
  {
    id: 'phone_order',
    group: 'catering',
    labelEs: '🛍️ Quiero hacer un pedido de tacos por teléfono para recoger',
    labelEn: '🛍️ I want to place a taco order over the phone for pickup',
    textEs: 'Hola, quiero hacer un pedido de 10 tacos y 2 mulitas por teléfono para pasar a recoger en 15 minutos.',
    textEn: 'Hi, I would like to place an order over the phone for 10 tacos and 2 mulitas to pick up in 15 minutes.'
  },
  {
    id: 'ebt_payment',
    group: 'payments',
    labelEs: '💳 ¿Aceptan tarjeta EBT CalFresh (RMP), Apple Pay y Google Pay?',
    labelEn: '💳 Do you accept CalFresh EBT (RMP), Apple Pay & Google Pay?',
    textEs: 'Hola, quería preguntar si en esta sucursal aceptan la tarjeta EBT de CalFresh y pagos con Apple Pay o Google Pay.',
    textEn: 'Hi, I wanted to ask if this location accepts the CalFresh EBT card and Apple Pay or Google Pay at the register.'
  },
  {
    id: 'cards_receipt',
    group: 'payments',
    labelEs: '🧾 ¿Aceptan American Express / Discover y efectivo en caja?',
    labelEn: '🧾 Do you accept American Express / Discover & cash at the register?',
    textEs: '¿Aceptan tarjetas American Express y Discover en caja, o también puedo pagar en efectivo al recoger?',
    textEn: 'Do you accept American Express and Discover cards at the register, or can I also pay cash when picking up?'
  },
  {
    id: 'missing_item',
    group: 'issues',
    labelEs: '🚨 Orden incompleta DT/Comedor con Ticket (Recado Simulador)',
    labelEn: '🚨 Missing items DT/Dine-In with Ticket (Simulator Callback)',
    textEs: 'Acabo de pasar hoy hace 10 minutos por mi orden ticket #148 y al llegar a mi casa vi que me faltaron 3 tacos de asada. Me llamo Roberto Gómez y mi teléfono es 323-418-2914, necesito que revisen mi orden.',
    textEn: 'I just picked up my order ticket #148 today 10 minutes ago and when I got home I noticed 3 Carne Asada tacos were missing. My name is Roberto Gomez and my phone is 323-418-2914, please have the manager review my order.'
  },
  {
    id: 'dt_wrong_order_no_ticket',
    group: 'issues',
    labelEs: '🧾 Orden equivocada DT SIN TICKET (Revisión 4 campos)',
    labelEn: '🧾 Wrong Drive-Thru order NO TICKET (4-field review)',
    textEs: 'Pasé hoy por el Drive-Thru y me dieron mal mi burrito, ya tiré el ticket y no lo tengo. Me llamo Jorge Navarro y mi teléfono es 562-841-3742.',
    textEn: 'I went through the Drive-Thru today and got the wrong burrito, I already threw away my receipt. My name is Jorge Navarro and my phone is 562-841-3742.'
  },
  {
    id: 'paquete2a_condiments_note',
    group: 'issues',
    labelEs: '🌶️ Paquete 2A: Agregar salsas/cilantro gratis a orden (Nota Empaque)',
    labelEn: '🌶️ Package 2A: Add free salsas/cilantro to order (Packing Note)',
    textEs: 'Acabo de hacer mi orden para recoger #204 a nombre de Mateo Silva, teléfono 323-418-2951, ¿le pueden poner extra salsa verde, cilantro, cebolla y limones gratis en la bolsa?',
    textEn: 'I just placed pickup order #204 under Mateo Silva, phone 323-418-2951. Could you please include extra free green salsa, cilantro, onions, and limes in the bag?'
  },
  {
    id: 'paquete2b_wrong_store',
    group: 'issues',
    labelEs: '↪️ Paquete 2B: Ordené en sucursal equivocada (Enrutamiento entre tiendas)',
    labelEn: '↪️ Package 2B: Ordered at wrong location (Cross-store routing)',
    textEs: 'Hice mi pedido en línea #319 por error en la sucursal de Los Ángeles en Central y Washington pero yo estoy en Lynwood. Soy Camila Reyes, 213-629-4812, ¿pueden avisarle al gerente de allá?',
    textEn: 'I accidentally placed my online order #319 at the Los Angeles Central and Washington store instead of Lynwood. My name is Camila Reyes, 213-629-4812, can you notify that store manager?'
  },
  {
    id: 'paquete1_delivery_modify',
    group: 'issues',
    labelEs: '🛵 Paquete 1: Modificar orden de DoorDash / Uber Eats',
    labelEn: '🛵 Package 1: Modify DoorDash / Uber Eats delivery order',
    textEs: 'Acabo de pedir por DoorDash y quiero agregar dos tacos de pastor y cambiar la dirección de entrega antes de que salga el repartidor.',
    textEn: 'I just ordered on DoorDash and want to add two al pastor tacos and change my delivery address before the driver picks it up.'
  },
  {
    id: 'double_charge',
    group: 'issues',
    labelEs: '💸 Cobro duplicado en tarjeta hace 15 min (Recado Simulador)',
    labelEn: '💸 Duplicate card charge 15 mins ago (Simulator Callback)',
    textEs: 'Pagué hoy hace 15 minutos en caja y en la app de mi banco me aparece cobrado dos veces por $28.40. Soy Laura Méndez, mi celular es 323-418-2926, por favor que me marque el gerente.',
    textEn: 'I paid at the register today 15 minutes ago and my banking app shows two charges of $28.40. My name is Laura Mendez, my cell is 323-418-2926, please have the manager call me.'
  },
  {
    id: 'lost_item',
    group: 'issues',
    labelEs: '👛 Objeto olvidado: Dejé mi cartera en una mesa (Recado Simulador)',
    labelEn: '👛 Lost & Found: Left my wallet at a table (Simulator Callback)',
    textEs: 'Estuve cenando hace media hora ahí en el comedor y creo que dejé olvidada mi cartera café en la mesa. Me llamo Daniel Ortiz y mi número es 562-841-3763, ¿le puedes avisar urgente al gerente?',
    textEn: 'I was dining there half an hour ago and I think I left my brown wallet on the table. My name is Daniel Ortiz and my number is 562-841-3763, can you urgently alert the manager?'
  },
  {
    id: 'delivery_customer_issue',
    group: 'issues',
    labelEs: '📱 Paquete 1: Cliente de Uber Eats con pedido incompleto',
    labelEn: '📱 Package 1: Uber Eats customer with missing items',
    textEs: 'Pedí a domicilio por Uber Eats y el repartidor me entregó la bolsa sellada pero no venían mis dos aguas de horchata. Soy Sofía Lara, 213-629-4875, ¿me ayuda el gerente?',
    textEn: 'I ordered delivery on Uber Eats and the sealed bag arrived without my two large Horchatas. My name is Sofia Lara, 213-629-4875, can the manager help me?'
  },
  {
    id: 'delivery_driver',
    group: 'issues',
    labelEs: '🛵 Chofer de DoorDash / Uber Eats: recolección nocturna',
    labelEn: '🛵 DoorDash / Uber Eats driver: late-night pickup rules',
    textEs: 'Hola, soy repartidor de DoorDash y vengo por una orden, ¿si ya cerraron las puertas del comedor puedo recoger por el Drive-Thru?',
    textEn: 'Hi, I am a DoorDash driver picking up an order. If the dining room doors are closed, can I pick up at the Drive-Thru window?'
  },
  {
    id: 'staff_callout',
    group: 'staff',
    labelEs: '👷 Empleado reportando retardo al turno (Recado Simulador)',
    labelEn: '👷 Employee reporting late arrival to shift (Simulator Callback)',
    textEs: 'Hola, soy Juan Hernández de la estación de parrilla, voy a llegar 20 minutos tarde al turno porque hay un accidente en el freeway. Mi celular es 562-841-3788, avísale al gerente por favor.',
    textEn: 'Hi, this is Juan Hernandez from the grill station, I am going to be 20 minutes late for my shift due to a freeway accident. My cell is 562-841-3788, please notify the manager.'
  },
  {
    id: 'vendor_arrival',
    group: 'staff',
    labelEs: '🔧 Técnico de refrigeración afuera de sucursal (Recado Simulador)',
    labelEn: '🔧 Refrigeration technician outside store (Simulator Callback)',
    textEs: 'Hablo de servicio técnico de refrigeración, ya estoy afuera de la tienda para revisar el cuarto frío. Soy Marcos Vega, 714-392-6439, avísale al gerente que me abra por favor.',
    textEn: 'This is Marcos Vega from refrigeration service, I am outside the store to inspect the walk-in cooler. My number is 714-392-6439, please let the manager on duty know.'
  },
  {
    id: 'jobs',
    group: 'staff',
    labelEs: '💼 Bolsa de Trabajo: ¿Están contratando cajeros o taqueros?',
    labelEn: '💼 Careers / Hiring: Are you hiring cashiers or cooks?',
    textEs: 'Hola, buenas tardes, quería saber si están contratando cajeros o taqueros y dónde puedo entregar mi solicitud de empleo.',
    textEn: 'Hello, I wanted to ask if you are hiring cashiers or cooks and how I can submit a job application.'
  },
  {
    id: 'auto_lang_switch',
    group: 'staff',
    labelEs: '🌐 Cambio automático a Inglés (Cliente habla inglés sin apretar 9)',
    labelEn: '🌐 Auto-switch to Spanish (Caller speaks Spanish in English call)',
    textEs: 'Hi! Sorry I only speak English—are you guys open right now and how much is an Asada Super Burrito?',
    textEn: '¡Hola! Disculpa, hablo español: ¿están abiertos ahorita y cuánto cuesta el super burrito de asada?'
  },
  {
    id: 'spam_call',
    group: 'staff',
    labelEs: '🛡️ Filtro Anti-Spam: Vendedor de SEO / préstamos comerciales',
    labelEn: '🛡️ Anti-Spam Filter: SEO / merchant cash advance telemarketer',
    textEs: 'Buen día, llamo para ofrecerle al dueño posicionamiento en Google Listing, paneles solares y un préstamo comercial preaprobado.',
    textEn: 'Hello, I am calling to offer the business owner Google listing SEO services, commercial solar panels, and a pre-approved merchant cash advance.'
  },
  {
    id: 'drinks_cup_oz',
    group: 'menu',
    labelEs: '🥤 Bebidas: tamaños en onzas (22/32 oz), galón 128 oz y Champurrado 96 oz',
    labelEn: '🥤 Drinks: exact cup ounces (22/32 oz), 128 oz gallon & 96 oz Champurrado box',
    textEs: '¿De cuántas onzas son las aguas frescas mediana, grande y el galón, y qué tamaño trae la caja de champurrado para llevar?',
    textEn: 'How many ounces are the medium and large aguas frescas, the gallon, and what size is the to-go champurrado box?'
  },
  {
    id: 'quesadilla_lengua_super',
    group: 'menu',
    labelEs: '🧀 Quesadilla de Lengua vs Súper Quesadilla y Súper Burrito',
    labelEn: '🧀 Beef Tongue Quesadilla vs Super Quesadilla & Super Burrito',
    textEs: '¿Qué diferencia hay entre una quesadilla regular de lengua y una súper quesadilla, y qué trae el súper burrito?',
    textEn: 'What is the difference between a regular beef tongue quesadilla and a super quesadilla, and what comes on a super burrito?'
  },
  {
    id: 'unanswered_probe',
    group: 'staff',
    labelEs: '❓ Pregunta no registrada (Prueba detector de Nuevas Preguntas)',
    labelEn: '❓ Unregistered policy question (Tests Unanswered Detector)',
    textEs: 'Oigan, ¿manejan convenios de descuento para escuelas locales o patrocinios para eventos escolares?',
    textEn: 'Hey, do you offer discount partnerships for local schools or sponsorships for school events?'
  }
]

const CATEGORIES = [
  { id: 'policies', key: 'phone_agent.kb_cat_policies' },
  { id: 'menu', key: 'phone_agent.kb_cat_menu' },
  { id: 'catering', key: 'phone_agent.kb_cat_catering' },
  { id: 'payments', key: 'phone_agent.kb_cat_payments' },
  { id: 'delivery', key: 'phone_agent.kb_cat_delivery' },
  { id: 'staff', key: 'phone_agent.kb_cat_staff' },
  { id: 'employment', key: 'phone_agent.kb_cat_employment' },
  { id: 'vendors', key: 'phone_agent.kb_cat_vendors' },
  { id: 'general', key: 'phone_agent.kb_cat_general' }
] as const

export default function ContestadoraIaPage() {
  const { t, language } = useLanguage()
  const isEn = language === 'en'

  const [activeTab, setActiveTab] = useState<'simulator' | 'knowledge' | 'learning' | 'stores' | 'calls'>('simulator')
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState<ViewerInfo | null>(null)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeRule[]>([])
  const [specialHours, setSpecialHours] = useState<SpecialHourRow[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([])
  const [callbacksPagination, setCallbacksPagination] = useState<{
    criticalPendingCap: number
    criticalPendingReturned: number
    criticalPendingTotal: number
    criticalPendingTruncated: boolean
    nonCriticalPendingCap: number
    pendingReturned: number
    pendingTotal: number
    pendingTruncated: boolean
    hasMorePending: boolean
  } | null>(null)
  const [unansweredQuestions, setUnansweredQuestions] = useState<any[]>([])
  const [kpis, setKpis] = useState({
    totalCalls: 0,
    realCallsCount: 0,
    realEvaluatedCallsCount: 0,
    simulatorCallsCount: 0,
    evaluatedCallsCount: 0,
    resolvedByAiCount: 0,
    realResolvedByAiCount: 0,
    resolvedByAiPct: 0,
    pendingCallbacksCount: 0,
    pendingSimulatorCallbacksCount: 0,
    estimatedCashierMinutesSaved: 0,
    activeStoresCount: 0,
    verifiedForwardingCount: 0
  })
  const [twilioIntegration, setTwilioIntegration] = useState<{
    authTokenConfigured: boolean
    accountSidConfigured: boolean
    defaultPilotStoreId: number | null
    sharedPilotAllowed: boolean
  } | null>(null)

  const [feedbackBanner, setFeedbackBanner] = useState<{
    kind: 'ok' | 'err'
    text: string
  } | null>(null)

  // Simulator state
  const [simEngineMode, setSimEngineMode] = useState<'kore_live' | 'classic'>('kore_live')
  const koreLiveSimRef = useRef<KorePhoneLiveSimulatorHandle | null>(null)
  const [simStoreId, setSimStoreId] = useState<number>(14)
  const [simLang, setSimLang] = useState<'es' | 'en'>('es')
  const [simActive, setSimActive] = useState(false)
  const [simCallSid, setSimCallSid] = useState<string | null>(null)
  const [simBusy, setSimBusy] = useState(false)
  const [simSynthesizingAudio, setSimSynthesizingAudio] = useState(false)
  const [simSpeaking, setSimSpeaking] = useState(false)
  const [simMuted, setSimMuted] = useState(false)
  const simMutedRef = useRef(false)
  const [simListening, setSimListening] = useState(false)
  const [simInput, setSimInput] = useState('')
  const [simScenarioGroup, setSimScenarioGroup] = useState<string>('all')
  const [simErrorBanner, setSimErrorBanner] = useState<string | null>(null)
  const [simAutoEndedNotice, setSimAutoEndedNotice] = useState(false)
  const [simTransferPhone, setSimTransferPhone] = useState<string | null>(null)
  const [simTranscript, setSimTranscript] = useState<Array<{
    role: string
    text: string
    timestamp: string
    toolName?: string
    audioUrl?: string
    audioDataUrl?: string
    lang?: 'es' | 'en'
    firstAudioMs?: number
    fromCache?: boolean
  }>>([])
  const [simLastTools, setSimLastTools] = useState<string[]>([])
  const [simLastCallback, setSimLastCallback] = useState<any | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const nextAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const ringOscillatorsRef = useRef<OscillatorNode[]>([])
  const nextPlayTimeRef = useRef<number>(0)
  const streamAbortRef = useRef<AbortController | null>(null)
  const activeStreamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const voicePlayAbortRef = useRef<AbortController | null>(null)
  const voicePlaySeqRef = useRef(0)
  const replayAbortRef = useRef<AbortController | null>(null)
  const simReqIdRef = useRef(0)
  const recognitionRef = useRef<any>(null)
  const micSilenceTimerRef = useRef<number | null>(null)
  const micAccumulatedRef = useRef('')
  const micCommittedRef = useRef(false)
  const simTranscriptRef = useRef(simTranscript)
  simTranscriptRef.current = simTranscript
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const ruleEditorRef = useRef<HTMLDivElement | null>(null)
  const fetchSeqRef = useRef(0)
  const activeBlockingFetchSeqRef = useRef<number | null>(null)
  const dashboardAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const tRef = useRef(t)
  tRef.current = t
  const skipNextFilterFetchRef = useRef(false)
  const seenCbScopeKeyRef = useRef<string>('')
  const cbChimeInFlightRef = useRef(false)
  const browserUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const browserSpeakTimerRef = useRef<number | null>(null)
  const ringToneTimerRef = useRef<number | null>(null)
  const copiedCbPhoneTimerRef = useRef<number | null>(null)
  const storesRef = useRef<StoreRow[]>(stores)
  storesRef.current = stores
  const dirtyStoreIdsRef = useRef<Set<number>>(new Set())
  const dirtyStoreFieldsRef = useRef<Map<number, Set<string>>>(new Map())
  const [dirtyStoreIds, setDirtyStoreIds] = useState<number[]>([])
  const seenRealCallbackIdsRef = useRef<Set<string>>(new Set())
  const cbAlertInitializedRef = useRef(false)
  const deferredInitialCbChimeRef = useRef(false)
  const realPendingCbCountRef = useRef(0)
  const realPendingKpiCountRef = useRef(0)
  const feedbackTimerRef = useRef<number | null>(null)
  const copiedCodeTimerRef = useRef<number | null>(null)
  const pendingAutoHangupRef = useRef(false)
  const savingStoreIdsRef = useRef<Set<number>>(new Set())
  const savingRuleRef = useRef(false)
  const savingHolidayRef = useRef(false)
  const togglingRuleIdsRef = useRef<Set<string>>(new Set())
  const deletingRuleIdsRef = useRef<Set<string>>(new Set())
  const deletingHolidayIdsRef = useRef<Set<string>>(new Set())
  const dismissingCallIdsRef = useRef<Set<string>>(new Set())
  const resolvingCallbackIdsRef = useRef<Set<string>>(new Set())
  const replayingActiveRef = useRef(false)
  const replayingSeqRef = useRef(0)
  const simSpeakingRef = useRef(false)
  simSpeakingRef.current = simSpeaking
  const simActiveRef = useRef(false)
  const simBusyRef = useRef(false)
  const handleSendSimTurnRef = useRef<(textOverride?: string) => Promise<void>>(async () => {})
  const simStoreIdRef = useRef<number>(simStoreId)
  simStoreIdRef.current = simStoreId
  const simCallSidRef = useRef<string | null>(null)

  const setSimActiveSync = useCallback((val: boolean) => {
    simActiveRef.current = val
    setSimActive(val)
  }, [])

  const setSimBusySync = useCallback((val: boolean) => {
    simBusyRef.current = val
    setSimBusy(val)
  }, [])

  const setSimCallSidSync = useCallback((val: string | null) => {
    simCallSidRef.current = val
    setSimCallSid(val)
  }, [])

  const setSimMutedSync = useCallback((val: boolean) => {
    simMutedRef.current = val
    setSimMuted(val)
  }, [])

  const syncDirtyStoresSnapshot = useCallback(() => {
    const ids: number[] = []
    dirtyStoreFieldsRef.current.forEach((fields, id) => {
      if (fields.size > 0) ids.push(id)
    })
    dirtyStoreIdsRef.current = new Set(ids)
    setDirtyStoreIds(ids)
  }, [])

  // Knowledge Base Editor state
  const [editingRule, setEditingRule] = useState<Partial<KnowledgeRule> | null>(null)
  const [ruleEditorOpenSeq, setRuleEditorOpenSeq] = useState(0)
  const [resolveCallIdForRule, setResolveCallIdForRule] = useState<string | null>(null)
  const [kbFilterCategory, setKbFilterCategory] = useState<string>('all')
  const [savingRule, setSavingRule] = useState(false)

  // Special Holiday form state (create & edit)
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null)
  const [newHoliday, setNewHoliday] = useState<{
    store_id: string
    event_date: string
    holiday_name: string
    mode: 'closed' | 'early_close' | 'late_open' | 'custom'
    open_time: string
    close_time: string
  }>({
    store_id: '',
    event_date: '',
    holiday_name: '',
    mode: 'closed',
    open_time: '11:00',
    close_time: '16:00'
  })

  // Store Config & Forwarding Guide Modal
  const [selectedStoreIdForForwarding, setSelectedStoreIdForForwarding] = useState<number | null>(null)
  const [expandedStoreId, setExpandedStoreId] = useState<number | null>(null)
  const [savingStoreIds, setSavingStoreIds] = useState<Record<number, boolean>>({})
  const [savingHoliday, setSavingHoliday] = useState(false)
  const [resolvingCallbackIds, setResolvingCallbackIds] = useState<Record<string, boolean>>({})
  const [dismissingCallIds, setDismissingCallIds] = useState<Record<string, boolean>>({})
  const [togglingRuleIds, setTogglingRuleIds] = useState<Record<string, boolean>>({})
  const [deletingRuleIds, setDeletingRuleIds] = useState<Record<string, boolean>>({})
  const [deletingHolidayIds, setDeletingHolidayIds] = useState<Record<string, boolean>>({})
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [copiedCbPhoneId, setCopiedCbPhoneId] = useState<string | null>(null)

  // Calls & Callbacks filter (decoupled from global KPIs)
  const [callsFilterStoreId, setCallsFilterStoreId] = useState<string>('all')
  const [callsFilterSource, setCallsFilterSource] = useState<'all' | 'twilio' | 'simulator'>('all')
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [selectedCallFallback, setSelectedCallFallback] = useState<CallRow | null>(null)
  const [callbackNotes, setCallbackNotes] = useState<Record<string, string>>({})
  const [replayingMsgIdx, setReplayingMsgIdx] = useState<number | null>(null)

  // Continuous AI Learning state (/api/phone/learning)
  const [learningStoreFilter, setLearningStoreFilter] = useState<string>('all')
  const [learningItems, setLearningItems] = useState<PhoneLearningItemRow[]>([])
  const [learningStats, setLearningStats] = useState<PhoneLearningStats>({
    pendingDoubts: 0,
    activeRules: 0,
    prewarmedClips: 0,
    analyzedCalls: 0,
    avgTurnLatencyMs: null
  })
  const [learningLoading, setLearningLoading] = useState(false)
  const [learningAnalyzing, setLearningAnalyzing] = useState(false)
  const [learningBusyId, setLearningBusyId] = useState<string | null>(null)
  const [learningError, setLearningError] = useState<string | null>(null)
  const [learningDraftInstruction, setLearningDraftInstruction] = useState<Record<string, string>>({})
  const [learningDraftFastEs, setLearningDraftFastEs] = useState<Record<string, string>>({})
  const [learningDraftFastEn, setLearningDraftFastEn] = useState<Record<string, string>>({})
  const [learningDraftGlobal, setLearningDraftGlobal] = useState<Record<string, boolean>>({})
  const [learningDraftChannels, setLearningDraftChannels] = useState<
    Record<string, PhoneLearningChannelScope>
  >({})
  const [learningExpandedFastIds, setLearningExpandedFastIds] = useState<Record<string, boolean>>({})
  const [learningShowManualForm, setLearningShowManualForm] = useState(false)
  const [learningManualTrigger, setLearningManualTrigger] = useState('')
  const [learningManualInstruction, setLearningManualInstruction] = useState('')
  const [learningManualFastEs, setLearningManualFastEs] = useState('')
  const [learningManualFastEn, setLearningManualFastEn] = useState('')
  const [learningManualGlobal, setLearningManualGlobal] = useState(true)
  const [learningManualChannels, setLearningManualChannels] =
    useState<PhoneLearningChannelScope>('both')
  const [learningCreatingManual, setLearningCreatingManual] = useState(false)
  const learningReqIdRef = useRef(0)
  const learningAbortRef = useRef<AbortController | null>(null)
  const learningAnalyzingRef = useRef(false)
  const learningMutatingRef = useRef(false)

  const isGlobalAdmin = viewer ? viewer.isGlobalAdmin : false

  const showFeedback = useCallback((kind: 'ok' | 'err', text: string) => {
    if (!mountedRef.current) return
    if (feedbackTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(feedbackTimerRef.current)
    }
    setFeedbackBanner({ kind, text })
    if (typeof window !== 'undefined') {
      feedbackTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return
        setFeedbackBanner(null)
        feedbackTimerRef.current = null
      }, 5000)
    }
  }, [])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, [])

  const stopMicrophone = useCallback(() => {
    if (micSilenceTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(micSilenceTimerRef.current)
      micSilenceTimerRef.current = null
    }
    micAccumulatedRef.current = ''
    micCommittedRef.current = false
    if (recognitionRef.current) {
      const rec = recognitionRef.current
      recognitionRef.current = null
      try {
        rec.onstart = null
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        if (typeof rec.abort === 'function') {
          rec.abort()
        } else if (typeof rec.stop === 'function') {
          rec.stop()
        }
      } catch {}
    }
    setSimListening(false)
  }, [])

  const fetchDashboard = useCallback(
    async (silent = false) => {
      if (dashboardAbortRef.current) {
        dashboardAbortRef.current.abort()
      }
      const ctrl = new AbortController()
      dashboardAbortRef.current = ctrl
      const seq = ++fetchSeqRef.current
      if (!silent) {
        activeBlockingFetchSeqRef.current = seq
        setLoading(true)
      }
      const filterScopeKey = `${callsFilterStoreId}|${callsFilterSource}`
      try {
        const params = new URLSearchParams({
          callsStoreId: callsFilterStoreId,
          callsSource: callsFilterSource
        })
        const res = await fetch(`/api/phone/dashboard?${params.toString()}`, {
          headers: getAuthHeaders(),
          cache: 'no-store',
          signal: ctrl.signal
        })
        if (!mountedRef.current || seq !== fetchSeqRef.current) return
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}))
          if (!mountedRef.current || seq !== fetchSeqRef.current) return
          if (!silent) showFeedback('err', errJson.error || tRef.current('phone_agent.dashboard_load_error'))
          return
        }
        const data = await res.json()
        if (!mountedRef.current || seq !== fetchSeqRef.current) return
        const loadedStores: StoreRow[] = data.stores || []
        setStores((prev) => {
          if (dirtyStoreFieldsRef.current.size === 0 || prev.length === 0) return loadedStores
          const prevById = new Map(prev.map((s) => [s.id, s]))
          return loadedStores.map((incoming) => {
            const dirtyFields = dirtyStoreFieldsRef.current.get(incoming.id)
            if (dirtyFields && dirtyFields.size > 0) {
              const localEdited = prevById.get(incoming.id)
              if (localEdited) {
                const mergedConfig: any = { ...incoming.config }
                dirtyFields.forEach((field) => {
                  mergedConfig[field] = (localEdited.config as any)[field]
                })
                return { ...incoming, config: mergedConfig }
              }
            }
            return incoming
          })
        })
        if (data.viewer) {
          setViewer(data.viewer)
          if (!data.viewer.isGlobalAdmin && loadedStores.length > 0) {
            setSimStoreId((prev) =>
              loadedStores.some((s) => s.id === prev) ? prev : loadedStores[0].id
            )
            if (loadedStores.length === 1) {
              const onlyId = String(loadedStores[0].id)
              setCallsFilterStoreId((prev) => {
                if (prev === onlyId) return prev
                skipNextFilterFetchRef.current = true
                return onlyId
              })
            }
          }
        }
        setKnowledgeBase(data.knowledgeBase || [])
        setSpecialHours(data.specialHours || [])
        setCalls(data.calls || [])
        const loadedCallbacks: CallbackRow[] = Array.isArray(data.callbacks) ? data.callbacks : []
        setCallbacks(loadedCallbacks)
        setCallbacksPagination(data.callbacksPagination || null)
        // Solo disparar chime de gerente en recados reales que NO sean notas de condimentos/empaque
        const realPendingManagerList = loadedCallbacks.filter(
          (cb) =>
            cb.status === 'pending' &&
            cb.source !== 'simulator' &&
            String(cb.reason_category || '').toLowerCase() !== 'condiments_note'
        )
        const globalRealPendingKpi = Number(data.kpis?.pendingCallbacksCount ?? realPendingManagerList.length)
        const prevKpiCount = realPendingKpiCountRef.current
        realPendingKpiCountRef.current = globalRealPendingKpi
        realPendingCbCountRef.current = realPendingManagerList.length
        const scopeChanged = Boolean(seenCbScopeKeyRef.current && seenCbScopeKeyRef.current !== filterScopeKey)
        seenCbScopeKeyRef.current = filterScopeKey
        let hasBrandNewRealPending = false
        for (const cb of realPendingManagerList) {
          if (!seenRealCallbackIdsRef.current.has(cb.id)) {
            seenRealCallbackIdsRef.current.add(cb.id)
            if (!scopeChanged) {
              hasBrandNewRealPending = true
            }
          }
        }
        const wasCbInit = cbAlertInitializedRef.current
        cbAlertInitializedRef.current = true
        if (realPendingManagerList.length === 0) {
          deferredInitialCbChimeRef.current = false
        } else if (
          (!wasCbInit && realPendingManagerList.length > 0) ||
          hasBrandNewRealPending ||
          (wasCbInit && !scopeChanged && globalRealPendingKpi > prevKpiCount && realPendingManagerList.length > 0)
        ) {
          deferredInitialCbChimeRef.current = true
        }
        setUnansweredQuestions(data.unansweredQuestions || [])
        if (data.twilioIntegration) {
          setTwilioIntegration(data.twilioIntegration)
        }
        if (data.kpis) {
          setKpis((prev) => ({ ...prev, ...data.kpis }))
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || !mountedRef.current || seq !== fetchSeqRef.current) return
        console.error('[ContestadoraIA] Error cargando datos:', e)
        if (!silent) showFeedback('err', tRef.current('phone_agent.dashboard_load_error'))
      } finally {
        if (dashboardAbortRef.current === ctrl) {
          dashboardAbortRef.current = null
        }
        if (mountedRef.current && (seq === fetchSeqRef.current || seq === activeBlockingFetchSeqRef.current)) {
          activeBlockingFetchSeqRef.current = null
          setLoading(false)
        }
      }
    },
    [callsFilterStoreId, callsFilterSource, getAuthHeaders, showFeedback]
  )

  useEffect(() => {
    if (skipNextFilterFetchRef.current) {
      skipNextFilterFetchRef.current = false
      return
    }
    void fetchDashboard(false)
  }, [fetchDashboard])

  // Si un usuario de sucursal intenta quedar en pestañas exclusivas de admin global, redirigir a Simulador
  useEffect(() => {
    if (viewer && !viewer.isGlobalAdmin && (activeTab === 'knowledge' || activeTab === 'stores')) {
      setActiveTab('simulator')
    }
  }, [viewer, activeTab])

  // Alinear filtro de aprendizaje para usuarios acotados a sucursal
  useEffect(() => {
    if (viewer && !viewer.isGlobalAdmin && stores.length > 0) {
      setLearningStoreFilter((prev) => {
        if (prev !== 'all' && stores.some((s) => String(s.id) === prev)) return prev
        return String(stores[0].id)
      })
    }
  }, [viewer, stores])

  const fetchPhoneLearning = useCallback(
    async (silent = false) => {
      if (!viewer) return
      if (!viewer.isGlobalAdmin && learningStoreFilter === 'all') {
        if (stores.length === 0) return
      }
      if (learningAbortRef.current) {
        learningAbortRef.current.abort()
      }
      const ctrl = new AbortController()
      learningAbortRef.current = ctrl
      const reqId = ++learningReqIdRef.current
      if (!silent) {
        setLearningLoading(true)
        setLearningError(null)
      }
      try {
        const effectiveStoreParam =
          !viewer.isGlobalAdmin && learningStoreFilter === 'all' && stores.length > 0
            ? String(stores[0].id)
            : learningStoreFilter
        const qs =
          effectiveStoreParam && effectiveStoreParam !== 'all'
            ? `?storeId=${encodeURIComponent(effectiveStoreParam)}`
            : ''
        const res = await fetch(`/api/phone/learning${qs}`, {
          headers: getAuthHeaders(),
          cache: 'no-store',
          signal: ctrl.signal
        })
        const data: any = await res.json().catch(() => null)
        if (!mountedRef.current || reqId !== learningReqIdRef.current) return
        if (!res.ok) {
          const msg = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
          if (!silent) {
            setLearningError(tRef.current('phone_agent.learning_load_err', { message: msg }))
          }
          return
        }
        const rawItems = Array.isArray(data?.items) ? data.items : []
        const normalized = rawItems
          .filter((r: unknown) => typeof r === 'object' && r !== null)
          .map((r: Record<string, any>) => normalizePhoneLearningItem(r))
        const rawStats = (data && typeof data.stats === 'object' && data.stats) || {}
        const rawAvgLat =
          rawStats.avgTurnLatencyMs ??
          rawStats.avgLatencyMs ??
          rawStats.avg_turn_latency_ms ??
          null
        setLearningItems(normalized)
        const actionablePendingDoubts = viewer.isGlobalAdmin
          ? Number(
              rawStats.pendingDoubts ??
                rawStats.pending_doubts ??
                normalized.filter((i: PhoneLearningItemRow) => i.status === 'needs_owner_input').length
            ) || 0
          : normalized.filter(
              (i: PhoneLearningItemRow) => i.status === 'needs_owner_input' && i.storeId !== null
            ).length
        setLearningStats({
          pendingDoubts: actionablePendingDoubts,
          activeRules:
            Number(rawStats.activeRules ?? rawStats.active_rules ?? normalized.filter((i: PhoneLearningItemRow) => i.status === 'approved' || i.status === 'auto_applied').length) || 0,
          prewarmedClips:
            Number(rawStats.prewarmedClips ?? rawStats.prewarmed_clips ?? rawStats.audioPrewarmedCount ?? normalized.filter((i: PhoneLearningItemRow) => i.audioPrewarmed).length) || 0,
          analyzedCalls: Number(rawStats.analyzedCalls ?? rawStats.analyzed_calls ?? 0) || 0,
          avgTurnLatencyMs:
            typeof rawAvgLat === 'number' && Number.isFinite(rawAvgLat) ? Math.round(rawAvgLat) : null
        })
        setLearningError(null)
      } catch (e: any) {
        if (e?.name === 'AbortError' || !mountedRef.current || reqId !== learningReqIdRef.current) return
        if (!silent) {
          setLearningError(
            tRef.current('phone_agent.learning_load_err', {
              message: e instanceof Error ? e.message : String(e)
            })
          )
        }
      } finally {
        if (learningAbortRef.current === ctrl) {
          learningAbortRef.current = null
        }
        if (mountedRef.current && reqId === learningReqIdRef.current) {
          setLearningLoading(false)
        }
      }
    },
    [viewer, learningStoreFilter, stores, getAuthHeaders]
  )

  useEffect(() => {
    if (!viewer) return
    void fetchPhoneLearning(activeTab !== 'learning')
  }, [viewer, learningStoreFilter, activeTab, fetchPhoneLearning])

  const handleAnalyzeCallsNow = async () => {
    if (learningAnalyzingRef.current) return
    learningAnalyzingRef.current = true
    setLearningAnalyzing(true)
    setLearningError(null)
    try {
      const storeIdPayload =
        !isGlobalAdmin
          ? Number(learningStoreFilter !== 'all' ? learningStoreFilter : stores[0]?.id || viewer?.assignedStoreId || 0) || null
          : learningStoreFilter === 'all'
            ? null
            : Number(learningStoreFilter) || null
      const res = await fetch('/api/phone/learning', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'analyze_now',
          storeId: storeIdPayload
        })
      })
      const data: any = await res.json().catch(() => null)
      if (!mountedRef.current) return
      if (!res.ok) {
        const msg = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        throw new Error(msg)
      }
      const analysis = data?.analysis || data?.summary || data || {}
      const callsCount = Number(
        analysis.analyzedCallsCount ??
          analysis.analyzedCalls ??
          analysis.callsAnalyzed ??
          analysis.scannedCalls ??
          analysis.processedCalls ??
          0
      ) || 0
      const doubtsCount =
        Number(analysis.insertedItems ?? 0) + Number(analysis.incrementedItems ?? 0) ||
        Number(
          analysis.doubtsCreated ??
            analysis.newDoubts ??
            analysis.pendingDoubts ??
            data?.stats?.pendingDoubts ??
            0
        ) ||
        0
      const prewarmsCount = Number(
        analysis.prewarmedNowCount ??
          analysis.prewarmedClips ??
          analysis.audiosPrewarmed ??
          analysis.prewarmedCount ??
          0
      ) || 0
      showFeedback(
        'ok',
        t('phone_agent.learning_analyze_done', {
          calls: callsCount,
          doubts: doubtsCount,
          prewarms: prewarmsCount
        })
      )
      await Promise.all([fetchPhoneLearning(true), fetchDashboard(true)])
    } catch (e: any) {
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setLearningError(t('phone_agent.learning_action_err', { message: msg }))
      showFeedback('err', t('phone_agent.learning_action_err', { message: msg }))
    } finally {
      learningAnalyzingRef.current = false
      if (mountedRef.current) setLearningAnalyzing(false)
    }
  }

  const getLearningInstructionValue = (item: PhoneLearningItemRow): string => {
    if (item.id in learningDraftInstruction) return learningDraftInstruction[item.id]
    return item.ownerInstruction || ''
  }

  const getLearningFastEsValue = (item: PhoneLearningItemRow): string => {
    if (item.id in learningDraftFastEs) return learningDraftFastEs[item.id]
    return item.fastReplyEs || ''
  }

  const getLearningFastEnValue = (item: PhoneLearningItemRow): string => {
    if (item.id in learningDraftFastEn) return learningDraftFastEn[item.id]
    return item.fastReplyEn || ''
  }

  const getLearningGlobalValue = (item: PhoneLearningItemRow): boolean => {
    if (!isGlobalAdmin) return false
    if (item.id in learningDraftGlobal) return learningDraftGlobal[item.id]
    return item.storeId === null
  }

  const getLearningChannelsValue = (item: PhoneLearningItemRow): PhoneLearningChannelScope => {
    if (item.id in learningDraftChannels) return learningDraftChannels[item.id]
    return item.appliesToChannels || 'both'
  }

  const handleAnswerLearningDoubt = async (item: PhoneLearningItemRow) => {
    if (learningMutatingRef.current) return
    const instruction = getLearningInstructionValue(item).trim()
    if (!instruction) {
      setLearningError(t('phone_agent.learning_validation_err'))
      showFeedback('err', t('phone_agent.learning_validation_err'))
      return
    }
    const fastEs = getLearningFastEsValue(item).trim()
    const fastEn = getLearningFastEnValue(item).trim()
    const applyGlobal = getLearningGlobalValue(item)
    const appliesToChannels = getLearningChannelsValue(item)
    const fallbackStoreId =
      item.storeId ??
      (learningStoreFilter !== 'all' ? Number(learningStoreFilter) : stores[0]?.id ?? viewer?.assignedStoreId ?? null)
    const targetStoreId = isGlobalAdmin ? (applyGlobal ? null : fallbackStoreId) : fallbackStoreId

    learningMutatingRef.current = true
    setLearningBusyId(item.id)
    setLearningError(null)
    try {
      const res = await fetch('/api/phone/learning', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'answer_doubt',
          status: 'approved',
          id: item.id,
          ownerInstruction: instruction,
          fastReplyEs: fastEs || undefined,
          fastReplyEn: fastEn || undefined,
          storeId: targetStoreId,
          applyAllStores: applyGlobal,
          appliesToChannels
        })
      })
      const data: any = await res.json().catch(() => null)
      if (!mountedRef.current) return
      if (!res.ok) {
        const msg = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        throw new Error(msg)
      }
      setLearningDraftInstruction((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setLearningDraftFastEs((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setLearningDraftFastEn((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setLearningDraftChannels((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      showFeedback('ok', t('phone_agent.learning_saved_ok'))
      await Promise.all([fetchPhoneLearning(true), fetchDashboard(true)])
    } catch (e: any) {
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setLearningError(t('phone_agent.learning_action_err', { message: msg }))
      showFeedback('err', t('phone_agent.learning_action_err', { message: msg }))
    } finally {
      learningMutatingRef.current = false
      if (mountedRef.current) setLearningBusyId(null)
    }
  }

  const handleDismissLearningItem = async (id: string) => {
    if (learningMutatingRef.current) return
    learningMutatingRef.current = true
    setLearningBusyId(id)
    setLearningError(null)
    try {
      const res = await fetch('/api/phone/learning', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'dismiss',
          status: 'dismissed',
          id
        })
      })
      const data: any = await res.json().catch(() => null)
      if (!mountedRef.current) return
      if (!res.ok) {
        const msg = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        throw new Error(msg)
      }
      showFeedback('ok', t('phone_agent.learning_dismissed_ok'))
      await fetchPhoneLearning(true)
    } catch (e: any) {
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setLearningError(t('phone_agent.learning_action_err', { message: msg }))
      showFeedback('err', t('phone_agent.learning_action_err', { message: msg }))
    } finally {
      learningMutatingRef.current = false
      if (mountedRef.current) setLearningBusyId(null)
    }
  }

  const handleCreateManualLearnedRule = async () => {
    if (learningMutatingRef.current) return
    const trigger = learningManualTrigger.trim()
    const instruction = learningManualInstruction.trim()
    if (!trigger || !instruction) {
      setLearningError(t('phone_agent.learning_manual_validation_err'))
      showFeedback('err', t('phone_agent.learning_manual_validation_err'))
      return
    }
    const applyGlobal = isGlobalAdmin && learningManualGlobal
    const fallbackStoreId =
      learningStoreFilter !== 'all'
        ? Number(learningStoreFilter)
        : stores[0]?.id ?? viewer?.assignedStoreId ?? null
    const targetStoreId = applyGlobal ? null : fallbackStoreId

    learningMutatingRef.current = true
    setLearningCreatingManual(true)
    setLearningError(null)
    try {
      const res = await fetch('/api/phone/learning', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'create_rule',
          questionOrTrigger: trigger,
          ownerInstruction: instruction,
          fastReplyEs: learningManualFastEs.trim() || undefined,
          fastReplyEn: learningManualFastEn.trim() || undefined,
          storeId: targetStoreId,
          applyAllStores: applyGlobal,
          appliesToChannels: learningManualChannels
        })
      })
      const data: any = await res.json().catch(() => null)
      if (!mountedRef.current) return
      if (!res.ok) {
        const msg = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
        throw new Error(msg)
      }
      setLearningManualTrigger('')
      setLearningManualInstruction('')
      setLearningManualFastEs('')
      setLearningManualFastEn('')
      setLearningManualChannels('both')
      setLearningShowManualForm(false)
      showFeedback('ok', t('phone_agent.learning_saved_ok'))
      await Promise.all([fetchPhoneLearning(true), fetchDashboard(true)])
    } catch (e: any) {
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setLearningError(t('phone_agent.learning_action_err', { message: msg }))
      showFeedback('err', t('phone_agent.learning_action_err', { message: msg }))
    } finally {
      learningMutatingRef.current = false
      if (mountedRef.current) setLearningCreatingManual(false)
    }
  }

  // Polling autenticado silencioso cada 60s + recarga al volver a la pestaña o recuperar red
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchDashboard(true)
      }
    }, 60000)

    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchDashboard(true)
    }
    const onOnline = () => void fetchDashboard(true)

    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchDashboard])

  // Auto-scroll del contenedor de conversación en el simulador
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight
    }
  }, [simTranscript, simBusy, simAutoEndedNotice])

  const ensureUnlockedAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (typeof window === 'undefined') return null
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return null
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx()
      }
      const ctxState = String(audioCtxRef.current.state || '')
      if (ctxState === 'suspended' || ctxState === 'interrupted') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  const playPendingCallbackChime = useCallback(async () => {
    if (cbChimeInFlightRef.current) return
    cbChimeInFlightRef.current = true
    try {
      if (typeof window === 'undefined' || simSpeakingRef.current || simActiveRef.current || simBusyRef.current) return
      const ctx = ensureUnlockedAudioCtx()
      if (!ctx) return
      const st = String(ctx.state || '')
      if (st === 'suspended' || st === 'interrupted') {
        await ctx.resume().catch(() => {})
      }
      if (ctx.state !== 'running') {
        deferredInitialCbChimeRef.current = true
        return
      }
      deferredInitialCbChimeRef.current = false
      const playNote = (freq: number, offset: number, dur: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.11, ctx.currentTime + offset)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + dur)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + dur)
      }
      playNote(880, 0, 0.18)
      playNote(1174.66, 0.2, 0.24)
    } catch {
      deferredInitialCbChimeRef.current = true
    } finally {
      cbChimeInFlightRef.current = false
    }
  }, [ensureUnlockedAudioCtx])

  // Disparar aviso acústico inicial o de nuevo recado pendiente, con desbloqueo automático en el primer gesto si el navegador suspendió AudioContext
  useEffect(() => {
    if (deferredInitialCbChimeRef.current && realPendingCbCountRef.current > 0) {
      void playPendingCallbackChime()
    }
  }, [callbacks, playPendingCallbackChime])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const unlockCbChime = () => {
      if (deferredInitialCbChimeRef.current && realPendingCbCountRef.current > 0) {
        void playPendingCallbackChime()
      }
    }
    window.addEventListener('pointerdown', unlockCbChime, { passive: true })
    window.addEventListener('keydown', unlockCbChime, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', unlockCbChime)
      window.removeEventListener('keydown', unlockCbChime)
    }
  }, [playPendingCallbackChime])

  const playPhoneRingTone = useCallback(async () => {
    if (simMutedRef.current) return
    try {
      const ctx = ensureUnlockedAudioCtx()
      if (!ctx) return
      const st = String(ctx.state || '')
      if (st === 'suspended' || st === 'interrupted') {
        await ctx.resume().catch(() => {})
      }
      if (simMutedRef.current || ctx.state !== 'running') return
      const playBurst = (startTime: number, duration: number) => {
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain = ctx.createGain()
        osc1.frequency.value = 440
        osc2.frequency.value = 480
        gain.gain.setValueAtTime(0.08, startTime)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
        osc1.connect(gain)
        osc2.connect(gain)
        gain.connect(ctx.destination)
        ringOscillatorsRef.current.push(osc1, osc2)
        const cleanupOsc = (o: OscillatorNode) => {
          ringOscillatorsRef.current = ringOscillatorsRef.current.filter((item) => item !== o)
        }
        osc1.onended = () => cleanupOsc(osc1)
        osc2.onended = () => cleanupOsc(osc2)
        osc1.start(startTime)
        osc2.start(startTime)
        osc1.stop(startTime + duration)
        osc2.stop(startTime + duration)
      }
      playBurst(ctx.currentTime, 0.28)
      await new Promise<void>((resolve) => {
        if (ringToneTimerRef.current !== null && typeof window !== 'undefined') {
          window.clearTimeout(ringToneTimerRef.current)
        }
        if (typeof window === 'undefined') {
          resolve()
          return
        }
        ringToneTimerRef.current = window.setTimeout(() => {
          ringToneTimerRef.current = null
          resolve()
        }, 340)
      })
    } catch {
      // Ignore audio context restrictions
    }
  }, [ensureUnlockedAudioCtx])

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const warmVoices = () => {
      try {
        window.speechSynthesis.getVoices()
      } catch {}
    }
    warmVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', warmVoices)
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', warmVoices)
    }
  }, [])

  useEffect(() => {
    if (ruleEditorOpenSeq > 0 && ruleEditorRef.current) {
      ruleEditorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [ruleEditorOpenSeq])

  const speakWithFemaleBrowserVoice = useCallback(
    (
      text: string,
      lang: 'es' | 'en',
      onDone?: () => void,
      options?: { ignoreMute?: boolean; preserveSeq?: number }
    ) => {
      if ((!options?.ignoreMute && simMutedRef.current) || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSimSpeaking(false)
        onDone?.()
        return
      }
      const preferredFemale = pickStrictFemaleBrowserVoice(window.speechSynthesis.getVoices(), lang)
      // PROHIBICIÓN ABSOLUTA DE VOZ MASCULINA: si el sistema operativo (ej. Windows sin voz femenina en español)
      // no tiene una voz femenina explícitamente verificada, NO invocar `speechSynthesis.speak`, ya que Windows
      // usaría por defecto `Microsoft David` (masculina).
      if (!preferredFemale) {
        setSimSpeaking(false)
        onDone?.()
        return
      }
      const normalized = normalizeTextForPhoneSpeech(text, lang)
      const sentences = normalized
        .split(/(?<=[.!?])(?!\d)\s+/g)
        .map((s) => s.trim())
        .filter(Boolean)
      if (sentences.length === 0) {
        setSimSpeaking(false)
        onDone?.()
        return
      }
      // Si se invoca internamente como respaldo desde playVoiceUrl, preservar myPlaySeq para que finish() no crea que fue interrumpido
      const mySeq = typeof options?.preserveSeq === 'number' ? options.preserveSeq : ++voicePlaySeqRef.current
      if (browserSpeakTimerRef.current !== null) {
        window.clearTimeout(browserSpeakTimerRef.current)
        browserSpeakTimerRef.current = null
      }
      try {
        window.speechSynthesis.cancel()
      } catch {}
      setSimSpeaking(true)
      let idx = 0
      const speakNext = () => {
        if (mySeq !== voicePlaySeqRef.current || (!options?.ignoreMute && simMutedRef.current)) {
          browserUtteranceRef.current = null
          if (mySeq === voicePlaySeqRef.current) setSimSpeaking(false)
          return
        }
        if (idx >= sentences.length) {
          browserUtteranceRef.current = null
          setSimSpeaking(false)
          onDone?.()
          return
        }
        const utter = new SpeechSynthesisUtterance(sentences[idx++])
        utter.lang = preferredFemale.lang || (lang === 'en' ? 'en-US' : 'es-MX')
        utter.rate = 1.04
        utter.voice = preferredFemale
        // Mantener referencia viva para evitar Garbage Collection prematuro en Chrome/Safari
        browserUtteranceRef.current = utter
        let settled = false
        const handleUtterFinished = () => {
          if (settled) return
          settled = true
          if (browserUtteranceRef.current === utter) {
            browserUtteranceRef.current = null
          }
          speakNext()
        }
        utter.onend = handleUtterFinished
        utter.onerror = handleUtterFinished
        window.speechSynthesis.speak(utter)
      }
      browserSpeakTimerRef.current = window.setTimeout(() => {
        browserSpeakTimerRef.current = null
        speakNext()
      }, 45)
    },
    []
  )

  const stopAllSimAudio = useCallback((abortStream = false) => {
    // Invalidar cualquier continuación asíncrona de playVoiceUrl y, si abortStream=true, cualquier lector NDJSON previo
    voicePlaySeqRef.current += 1
    if (abortStream) {
      simReqIdRef.current += 1
    }
    if (voicePlayAbortRef.current) {
      try {
        voicePlayAbortRef.current.abort()
      } catch {}
      voicePlayAbortRef.current = null
    }
    if (replayAbortRef.current) {
      try {
        replayAbortRef.current.abort()
      } catch {}
      replayAbortRef.current = null
    }
    if (abortStream) {
      if (streamAbortRef.current) {
        try {
          streamAbortRef.current.abort()
        } catch {}
        streamAbortRef.current = null
      }
      if (activeStreamReaderRef.current) {
        try {
          void activeStreamReaderRef.current.cancel().catch(() => {})
        } catch {}
        activeStreamReaderRef.current = null
      }
    }
    if (ringOscillatorsRef.current.length > 0) {
      for (const osc of ringOscillatorsRef.current) {
        try {
          osc.onended = null
          osc.stop()
          osc.disconnect()
        } catch {}
      }
      ringOscillatorsRef.current = []
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null
        activeSourceRef.current.stop()
        activeSourceRef.current.disconnect()
      } catch {}
      activeSourceRef.current = null
    }
    if (scheduledSourcesRef.current.length > 0) {
      for (const src of scheduledSourcesRef.current) {
        try {
          src.onended = null
          src.stop()
          src.disconnect()
        } catch {}
      }
      scheduledSourcesRef.current = []
    }
    nextPlayTimeRef.current = 0
    const abortHtmlAudio = (el: HTMLAudioElement | null) => {
      if (!el) return
      try {
        el.onended = null
        el.onerror = null
        el.pause()
        el.removeAttribute('src')
        el.load()
      } catch {}
    }
    abortHtmlAudio(audioRef.current)
    audioRef.current = null
    abortHtmlAudio(nextAudioRef.current)
    nextAudioRef.current = null
    if (browserSpeakTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(browserSpeakTimerRef.current)
      browserSpeakTimerRef.current = null
    }
    if (ringToneTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(ringToneTimerRef.current)
      ringToneTimerRef.current = null
    }
    browserUtteranceRef.current = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSimSpeaking(false)
    setSimSynthesizingAudio(false)
    if (abortStream) {
      setSimBusySync(false)
    }
  }, [setSimBusySync])

  // Limpiar audio, micrófono y estado de auto-hangup/replay al cambiar de pestaña
  useEffect(() => {
    if (activeTab !== 'simulator') {
      stopMicrophone()
      if (pendingAutoHangupRef.current) {
        pendingAutoHangupRef.current = false
        setSimActiveSync(false)
        setSimCallSidSync(null)
        setSimAutoEndedNotice(true)
      }
      stopAllSimAudio(true)
    }
    if (activeTab !== 'calls') {
      if (replayingActiveRef.current || replayingMsgIdx !== null) {
        replayingActiveRef.current = false
        replayingSeqRef.current += 1
        setReplayingMsgIdx(null)
        if (replayAbortRef.current) {
          try {
            replayAbortRef.current.abort()
          } catch {}
          replayAbortRef.current = null
        }
        stopAllSimAudio(false)
      }
      setSelectedCallId(null)
      setSelectedCallFallback(null)
    }
  }, [activeTab, stopMicrophone, stopAllSimAudio, setSimActiveSync, setSimCallSidSync])

  // Cerrar modales con tecla Escape
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (selectedStoreIdForForwarding === null && !selectedCallId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selectedCallId) {
        replayingActiveRef.current = false
        replayingSeqRef.current += 1
        setReplayingMsgIdx(null)
        if (replayAbortRef.current) {
          try {
            replayAbortRef.current.abort()
          } catch {}
          replayAbortRef.current = null
        }
        stopAllSimAudio(false)
        setSelectedCallId(null)
        setSelectedCallFallback(null)
      } else if (selectedStoreIdForForwarding !== null) {
        setSelectedStoreIdForForwarding(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedStoreIdForForwarding, selectedCallId, stopAllSimAudio])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (dashboardAbortRef.current) {
        dashboardAbortRef.current.abort()
        dashboardAbortRef.current = null
      }
      if (learningAbortRef.current) {
        learningAbortRef.current.abort()
        learningAbortRef.current = null
      }
      if (feedbackTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = null
      }
      if (copiedCodeTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(copiedCodeTimerRef.current)
        copiedCodeTimerRef.current = null
      }
      if (copiedCbPhoneTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(copiedCbPhoneTimerRef.current)
        copiedCbPhoneTimerRef.current = null
      }
      stopMicrophone()
      stopAllSimAudio(true)
      if (simCallSidRef.current) {
        void fetch('/api/phone/simulate', {
          method: 'POST',
          keepalive: true,
          headers: getAuthHeaders(),
          body: JSON.stringify({
            action: 'end',
            callSid: simCallSidRef.current,
            storeId: simStoreIdRef.current
          })
        }).catch(() => null)
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
      }
    }
  }, [stopMicrophone, stopAllSimAudio, getAuthHeaders])

  const createPcmStreamPlayer = useCallback(
    (onPlaybackComplete?: () => void) => {
      stopAllSimAudio(false)
      const playerSeq = voicePlaySeqRef.current
      const ctx = ensureUnlockedAudioCtx()
      let streamFinished = false
      let playedAny = false
      let isFirstChunk = true
      let completedNotified = false
      let resumePending = false
      const pendingResumeQueue: Array<{ floats: Float32Array; sampleRate: number }> = []

      const isPlayerCancelled = () => playerSeq !== voicePlaySeqRef.current || simMutedRef.current

      const notifyDoneOnce = () => {
        if (!completedNotified && !isPlayerCancelled()) {
          completedNotified = true
          onPlaybackComplete?.()
        }
      }

      const scheduleDecodedFloats = (floats: Float32Array, sampleRate: number) => {
        if (isPlayerCancelled() || !ctx || ctx.state === 'closed') return
        const hadUnderrun = nextPlayTimeRef.current < ctx.currentTime + 0.005
        if (isFirstChunk || hadUnderrun) {
          isFirstChunk = false
          const fadeSamples = Math.min(64, floats.length)
          for (let i = 0; i < fadeSamples; i++) {
            floats[i] *= i / fadeSamples
          }
        }

        const audioBuf = ctx.createBuffer(1, floats.length, sampleRate)
        audioBuf.getChannelData(0).set(floats)

        const source = ctx.createBufferSource()
        source.buffer = audioBuf
        source.connect(ctx.destination)

        const startAt = Math.max(ctx.currentTime + 0.085, nextPlayTimeRef.current)
        nextPlayTimeRef.current = startAt + audioBuf.duration

        scheduledSourcesRef.current.push(source)
        activeSourceRef.current = source
        if (!playedAny) {
          playedAny = true
          setSimSpeaking(true)
        }

        source.onended = () => {
          scheduledSourcesRef.current = scheduledSourcesRef.current.filter((s) => s !== source)
          if (activeSourceRef.current === source) {
            activeSourceRef.current = scheduledSourcesRef.current[0] || null
          }
          if (isPlayerCancelled()) {
            if (playerSeq === voicePlaySeqRef.current) setSimSpeaking(false)
            return
          }
          if (streamFinished && pendingResumeQueue.length === 0 && scheduledSourcesRef.current.length === 0) {
            setSimSpeaking(false)
            notifyDoneOnce()
          }
        }

        source.start(startAt)
      }

      const flushPendingQueue = () => {
        while (pendingResumeQueue.length > 0 && !isPlayerCancelled() && String(ctx?.state || '') === 'running') {
          const item = pendingResumeQueue.shift()!
          scheduleDecodedFloats(item.floats, item.sampleRate)
        }
        if (isPlayerCancelled()) {
          pendingResumeQueue.length = 0
          return
        }
        if (streamFinished && pendingResumeQueue.length === 0 && scheduledSourcesRef.current.length === 0) {
          setSimSpeaking(false)
          if (playedAny) notifyDoneOnce()
        }
      }

      const pushPcmBase64 = (pcmBase64: string, sampleRate = 24000) => {
        if (isPlayerCancelled() || !ctx || !pcmBase64) return
        let binary = ''
        try {
          binary = window.atob(pcmBase64)
        } catch {
          return
        }
        const byteLen = binary.length - (binary.length % 2)
        if (byteLen < 2) return

        const bytes = new Uint8Array(byteLen)
        for (let i = 0; i < byteLen; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const view = new DataView(bytes.buffer)
        const sampleCount = byteLen / 2
        const floats = new Float32Array(sampleCount)
        for (let i = 0; i < sampleCount; i++) {
          floats[i] = view.getInt16(i * 2, true) / 32768
        }

        const st = String(ctx.state || '')
        if (st === 'suspended' || st === 'interrupted') {
          pendingResumeQueue.push({ floats, sampleRate })
          if (!resumePending) {
            resumePending = true
            void ctx
              .resume()
              .then(() => {
                resumePending = false
                if (String(ctx.state || '') === 'running') {
                  flushPendingQueue()
                } else {
                  pendingResumeQueue.length = 0
                  if (!isPlayerCancelled()) {
                    setSimSpeaking(false)
                    if (streamFinished) notifyDoneOnce()
                  }
                }
              })
              .catch(() => {
                resumePending = false
                pendingResumeQueue.length = 0
                if (!isPlayerCancelled()) {
                  setSimSpeaking(false)
                  if (streamFinished) notifyDoneOnce()
                }
              })
          }
          return
        }
        if (pendingResumeQueue.length > 0) {
          pendingResumeQueue.push({ floats, sampleRate })
          flushPendingQueue()
          return
        }
        scheduleDecodedFloats(floats, sampleRate)
      }

      const finish = () => {
        streamFinished = true
        if (isPlayerCancelled()) {
          pendingResumeQueue.length = 0
          return
        }
        if (pendingResumeQueue.length === 0 && (!playedAny || scheduledSourcesRef.current.length === 0)) {
          setSimSpeaking(false)
          if (playedAny) notifyDoneOnce()
        }
      }

      return {
        pushPcmBase64,
        finish,
        hasPlayedAny: () => playedAny,
        hasReceivedAudio: () => playedAny || pendingResumeQueue.length > 0
      }
    },
    [ensureUnlockedAudioCtx, stopAllSimAudio]
  )

  const handleLiveDashboardRefresh = useCallback(() => {
    void fetchDashboard(true)
  }, [fetchDashboard])

  // Pre-calentar en RAM el contexto, menú en vivo y saludo SOLO antes de iniciar llamada (jamás competir con una llamada activa)
  const hasSimStoreLoaded = stores.some((s) => s.id === simStoreId)
  useEffect(() => {
    if (loading || activeTab !== 'simulator' || simEngineMode === 'kore_live' || !hasSimStoreLoaded || simActive || simBusy) return
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: ctrl.signal,
        body: JSON.stringify({
          action: 'prewarm',
          storeId: simStoreId,
          lang: simLang
        })
      }).catch(() => null)
    }, 250)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [loading, activeTab, simEngineMode, simStoreId, simLang, simActive, simBusy, hasSimStoreLoaded, getAuthHeaders])

  const playVoiceUrl = useCallback(
    async (
      primarySrc: string,
      fallbackText: string,
      lang: 'es' | 'en',
      nextAudioUrl?: string | null,
      onComplete?: () => void,
      options?: { voice?: VoiceId; ignoreMute?: boolean }
    ) => {
      if (simMutedRef.current && !options?.ignoreMute) {
        stopAllSimAudio(false)
        onComplete?.()
        return
      }
      try {
        stopAllSimAudio(false)
        const playCtrl = new AbortController()
        voicePlayAbortRef.current = playCtrl
        const myPlaySeq = voicePlaySeqRef.current
        const isInterrupted = () =>
          playCtrl.signal.aborted ||
          myPlaySeq !== voicePlaySeqRef.current ||
          (!options?.ignoreMute && simMutedRef.current)

        const fetchWithLinkedTimeout = async (
          input: string,
          init: RequestInit,
          timeoutMs: number
        ): Promise<Response> => {
          const linkedCtrl = new AbortController()
          const onParentAbort = () => linkedCtrl.abort()
          if (playCtrl.signal.aborted) {
            linkedCtrl.abort()
          } else {
            playCtrl.signal.addEventListener('abort', onParentAbort, { once: true })
          }
          const timer = typeof window !== 'undefined' ? window.setTimeout(() => linkedCtrl.abort(), timeoutMs) : null
          try {
            return await fetch(input, { ...init, signal: linkedCtrl.signal })
          } finally {
            if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer)
            playCtrl.signal.removeEventListener('abort', onParentAbort)
          }
        }

        setSimSpeaking(true)
        const ctx = ensureUnlockedAudioCtx()
        let primaryFetchFailedHttpOrNet = false

        const fetchAndDecode = async (src: string, retryViaAuthPost = false): Promise<AudioBuffer | null> => {
          if (!ctx || isInterrupted()) return null
          for (let attempt = 0; attempt < 2; attempt++) {
            if (isInterrupted()) return null
            try {
              const res = await fetchWithLinkedTimeout(src, {}, 11500)
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const arrayBuf = await res.arrayBuffer()
              if (isInterrupted()) return null
              if (arrayBuf.byteLength <= 44) throw new Error('Empty WAV')
              return await ctx.decodeAudioData(arrayBuf.slice(0))
            } catch {
              if (isInterrupted()) return null
              if (attempt === 0) await new Promise((r) => setTimeout(r, 120))
            }
          }
          if (!isInterrupted() && retryViaAuthPost && fallbackText && !src.startsWith('blob:')) {
            try {
              const postRes = await fetchWithLinkedTimeout(
                '/api/phone/tts',
                {
                  method: 'POST',
                  headers: getAuthHeaders(),
                  body: JSON.stringify({ text: fallbackText, lang, voice: options?.voice || 'Kore' })
                },
                11500
              )
              if (postRes.ok && !isInterrupted()) {
                const arrayBuf = await postRes.arrayBuffer()
                if (!isInterrupted() && arrayBuf.byteLength > 44) {
                  return await ctx.decodeAudioData(arrayBuf.slice(0))
                }
              }
            } catch {
              // Ignore and fall through
            }
          }
          if (retryViaAuthPost) primaryFetchFailedHttpOrNet = true
          return null
        }

        if (ctx) {
          const ctxSt = String(ctx.state || '')
          if (ctxSt === 'suspended' || ctxSt === 'interrupted') {
            await ctx.resume().catch(() => {})
          }
          if (isInterrupted()) {
            if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
            return
          }
          const nextBufferPromise = nextAudioUrl ? fetchAndDecode(nextAudioUrl, false) : Promise.resolve(null)
          const firstBuffer = await fetchAndDecode(primarySrc, true)
          if (isInterrupted()) {
            if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
            return
          }

          if (firstBuffer && ctx.state === 'running') {
            const playBuffer = (buf: AudioBuffer): Promise<void> =>
              new Promise((resolve) => {
                if (isInterrupted()) {
                  resolve()
                  return
                }
                const source = ctx.createBufferSource()
                source.buffer = buf
                source.connect(ctx.destination)
                activeSourceRef.current = source
                const onAbort = () => {
                  try {
                    source.onended = null
                    source.stop()
                    source.disconnect()
                  } catch {}
                  if (activeSourceRef.current === source) {
                    activeSourceRef.current = null
                  }
                  resolve()
                }
                playCtrl.signal.addEventListener('abort', onAbort, { once: true })
                source.onended = () => {
                  playCtrl.signal.removeEventListener('abort', onAbort)
                  if (activeSourceRef.current === source) {
                    activeSourceRef.current = null
                  }
                  resolve()
                }
                source.start(0)
              })

            await playBuffer(firstBuffer)
            if (isInterrupted()) {
              if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
              return
            }
            const nextBuffer = await nextBufferPromise
            if (isInterrupted()) {
              if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
              return
            }
            if (nextBuffer) {
              await playBuffer(nextBuffer)
            }
            if (!isInterrupted()) {
              if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
              onComplete?.()
            }
            return
          }
        }

        if (isInterrupted()) {
          if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
          return
        }

        // Si ya fallaron 2 GET + 1 POST a /api/phone/tts, no lanzar un 4to GET fallido con HTMLAudioElement; pasar directo a voz femenina del navegador preservando myPlaySeq
        if (primaryFetchFailedHttpOrNet && !primarySrc.startsWith('blob:')) {
          await new Promise<void>((resolve) => {
            speakWithFemaleBrowserVoice(
              fallbackText,
              lang,
              () => {
                if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
                if (!isInterrupted()) onComplete?.()
                resolve()
              },
              { ignoreMute: options?.ignoreMute, preserveSeq: myPlaySeq }
            )
          })
          return
        }

        await new Promise<void>((resolve) => {
          const onAbortHtml = () => {
            finish()
          }
          playCtrl.signal.addEventListener('abort', onAbortHtml, { once: true })
          let done = false
          let fallbackTriggered = false
          const audio = new Audio(primarySrc)
          audioRef.current = audio
          let preloadedNext: HTMLAudioElement | null = null
          if (nextAudioUrl) {
            preloadedNext = new Audio(nextAudioUrl)
            preloadedNext.preload = 'auto'
            nextAudioRef.current = preloadedNext
          }
          const finish = () => {
            if (done) return
            done = true
            audio.onended = null
            audio.onerror = null
            if (preloadedNext) {
              preloadedNext.onended = null
              preloadedNext.onerror = null
            }
            playCtrl.signal.removeEventListener('abort', onAbortHtml)
            if (myPlaySeq === voicePlaySeqRef.current) setSimSpeaking(false)
            if (!isInterrupted()) {
              onComplete?.()
            }
            resolve()
          }
          const triggerBrowserFallback = () => {
            if (done || fallbackTriggered) return
            fallbackTriggered = true
            if (isInterrupted()) {
              finish()
              return
            }
            speakWithFemaleBrowserVoice(fallbackText, lang, finish, {
              ignoreMute: options?.ignoreMute,
              preserveSeq: myPlaySeq
            })
          }

          audio.onended = () => {
            if (isInterrupted()) {
              finish()
              return
            }
            if (preloadedNext) {
              audioRef.current = preloadedNext
              preloadedNext.onended = finish
              preloadedNext.onerror = finish
              preloadedNext.play().catch(finish)
            } else {
              finish()
            }
          }
          audio.onerror = triggerBrowserFallback
          audio.play().catch(triggerBrowserFallback)
        })
      } catch {
        if (voicePlayAbortRef.current?.signal.aborted) return
        setSimSpeaking(false)
        onComplete?.()
      }
    },
    [ensureUnlockedAudioCtx, getAuthHeaders, speakWithFemaleBrowserVoice, stopAllSimAudio]
  )

  const handleStartSimCall = async () => {
    if (simBusyRef.current || !hasSimStoreLoaded) return
    ensureUnlockedAudioCtx()
    stopMicrophone()
    stopAllSimAudio(true)
    const reqId = ++simReqIdRef.current
    pendingAutoHangupRef.current = false
    setSimBusySync(true)
    setSimErrorBanner(null)
    setSimAutoEndedNotice(false)
    setSimTransferPhone(null)
    setSimSynthesizingAudio(false)
    setSimLastTools([])
    setSimLastCallback(null)

    const abortCtrl = new AbortController()
    streamAbortRef.current = abortCtrl
    const clickStart = performance.now()
    const startVoice: VoiceId = currentSimStore?.config.voice_id || 'Kore'
    let startMeta: any = null

    try {
      void playPhoneRingTone()
      const res = await fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
        body: JSON.stringify({
          action: 'start',
          storeId: simStoreId,
          lang: simLang,
          voiceMode: 'neural_turbo',
          stream: true
        })
      })

      if (reqId !== simReqIdRef.current) {
        void res.body?.cancel?.().catch(() => {})
        return
      }

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || t('phone_agent.sim_error_start'))
      }

      const pcmPlayer = createPcmStreamPlayer()
      const reader = res.body.getReader()
      activeStreamReaderRef.current = reader
      const decoder = new TextDecoder()
      let ndjsonBuf = ''
      let clientFirstAudioMs: number | undefined
      let handledFallbackSpeech = false

      const handleStartEvent = (evt: any) => {
        if (reqId !== simReqIdRef.current) return
        if (evt.type === 'start_meta') {
          startMeta = evt
          setSimCallSidSync(evt.callSid)
          setSimActiveSync(true)
          setSimBusySync(false)
          if (!simMutedRef.current) setSimSynthesizingAudio(true)
          setSimTranscript([
            {
              role: 'assistant',
              text: evt.greetingText,
              timestamp: new Date().toISOString(),
              audioUrl: evt.audioUrl,
              lang: evt.language
            }
          ])
        } else if (evt.type === 'audio_pcm') {
          setSimSynthesizingAudio(false)
          if (clientFirstAudioMs === undefined) {
            clientFirstAudioMs = Math.round(performance.now() - clickStart)
          }
          pcmPlayer.pushPcmBase64(evt.pcmBase64, evt.sampleRate || 24000)
        } else if (evt.type === 'tts_fallback_required' || evt.type === 'audio_stream_truncated') {
          if (evt.type === 'audio_stream_truncated') {
            stopAllSimAudio(false)
          }
          setSimSynthesizingAudio(false)
          handledFallbackSpeech = true
          const fullText = evt.text || startMeta?.greetingText || ''
          const clipLang: 'es' | 'en' =
            evt.language === 'en' ? 'en' : evt.language === 'es' ? 'es' : startMeta?.language === 'en' ? 'en' : 'es'
          // En tts_fallback_required el servidor ya agotó TTS: hablar directo con voz femenina del navegador (0 fetches redundantes a /api/phone/tts)
          if (evt.type === 'audio_stream_truncated' && startMeta?.audioUrl) {
            void playVoiceUrl(startMeta.audioUrl, fullText, clipLang, null, undefined, {
              voice: (startMeta.voiceId as VoiceId) || startVoice
            })
          } else {
            speakWithFemaleBrowserVoice(fullText, clipLang)
          }
        } else if (evt.type === 'done') {
          setSimSynthesizingAudio(false)
          const finalAudioMs = evt.totalFirstAudioMs > 0 ? evt.totalFirstAudioMs : clientFirstAudioMs
          setSimTranscript((prev) =>
            prev.map((m, idx) =>
              idx === 0 ? { ...m, firstAudioMs: finalAudioMs, fromCache: Boolean(evt.fromCache) } : m
            )
          )
        } else if (evt.type === 'error') {
          throw new Error(evt.error || t('phone_agent.sim_error_start'))
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (reqId !== simReqIdRef.current) break
          if (done) {
            ndjsonBuf += decoder.decode()
            for (const remLine of ndjsonBuf.split('\n')) {
              if (!remLine.trim()) continue
              let evt: any = null
              try {
                evt = JSON.parse(remLine)
              } catch {
                continue
              }
              if (evt) handleStartEvent(evt)
            }
            break
          }
          ndjsonBuf += decoder.decode(value, { stream: true })
          const lines = ndjsonBuf.split('\n')
          ndjsonBuf = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            if (reqId !== simReqIdRef.current) break
            let evt: any = null
            try {
              evt = JSON.parse(line)
            } catch {
              continue
            }
            if (evt) handleStartEvent(evt)
          }
        }
      } finally {
        if (!handledFallbackSpeech) {
          pcmPlayer.finish()
        }
        if (activeStreamReaderRef.current === reader) {
          activeStreamReaderRef.current = null
        }
      }

      if (reqId !== simReqIdRef.current) {
        return
      }
      if (startMeta && !pcmPlayer.hasReceivedAudio() && !handledFallbackSpeech && startMeta.audioUrl && !simMutedRef.current) {
        void playVoiceUrl(startMeta.audioUrl, startMeta.greetingText, startMeta.language, null, undefined, {
          voice: (startMeta.voiceId as VoiceId) || startVoice
        })
      }
      void fetchDashboard(true)
    } catch (e: any) {
      if (reqId === simReqIdRef.current && e?.name !== 'AbortError') {
        if (startMeta && simCallSidRef.current === startMeta.callSid) {
          setSimActiveSync(false)
          setSimCallSidSync(null)
        }
        setSimErrorBanner(e.message || t('phone_agent.sim_error_start'))
      }
    } finally {
      if (reqId === simReqIdRef.current) {
        setSimBusySync(false)
        setSimSynthesizingAudio(false)
      }
    }
  }

  const handleEndSimCall = async () => {
    stopMicrophone()
    stopAllSimAudio(true)
    pendingAutoHangupRef.current = false
    const closingSid = simCallSidRef.current || simCallSid
    setSimActiveSync(false)
    setSimCallSidSync(null)
    if (closingSid) {
      await fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          action: 'end',
          callSid: closingSid,
          storeId: simStoreId
        })
      }).catch(() => null)
    }
    void fetchDashboard(true)
  }

  const handleSendSimTurn = async (textOverride?: string) => {
    const message = (textOverride ?? simInput).trim()
    if (!message || simBusyRef.current || !hasSimStoreLoaded) return

    ensureUnlockedAudioCtx()
    stopMicrophone()
    // Si la llamada anterior estaba en despedida terminal (ya cerrada en BD), abrir una sesión limpia nueva
    const wasPendingTerminalHangup = pendingAutoHangupRef.current
    stopAllSimAudio(true)
    const reqId = ++simReqIdRef.current
    pendingAutoHangupRef.current = false
    setSimBusySync(true)
    setSimErrorBanner(null)
    setSimAutoEndedNotice(false)
    setSimInput('')
    setSimSynthesizingAudio(false)

    const startingNewCallSession = !simActiveRef.current || !simCallSidRef.current || wasPendingTerminalHangup
    let activeSid = simCallSidRef.current
    if (startingNewCallSession) {
      const randSuffix = Math.random().toString(36).slice(2, 8)
      activeSid = `SIM_${simStoreId}_${Date.now()}_${randSuffix}`
      setSimCallSidSync(activeSid)
      setSimActiveSync(true)
      setSimLastTools([])
      setSimLastCallback(null)
      setSimTransferPhone(null)
    }

    const prevTranscriptSnapshot = simTranscriptRef.current
    setSimTranscript((prev) => {
      if (startingNewCallSession) {
        const storeObj = storesRef.current.find((s) => s.id === simStoreId)
        const greetingTarget = formatCustomerGreetingTarget({ id: simStoreId, name: storeObj?.name || `#${simStoreId}` }, simLang)
        const syntheticGreeting =
          simLang === 'en'
            ? `Thanks for calling Tacos Gavilan ${greetingTarget}! How can I help you today?`
            : `¡Gracias por llamar a Tacos Gavilan ${greetingTarget}! ¿En qué te ayudo hoy?`
        const nowIso = new Date().toISOString()
        return [
          { role: 'assistant', text: syntheticGreeting, timestamp: nowIso, lang: simLang },
          { role: 'user', text: message, timestamp: nowIso }
        ]
      }
      return [...prev, { role: 'user', text: message, timestamp: new Date().toISOString() }]
    })

    const abortCtrl = new AbortController()
    streamAbortRef.current = abortCtrl
    const turnStart = performance.now()
    const turnVoice: VoiceId = currentSimStore?.config.voice_id || 'Kore'
    let shouldAutoHangup = false
    let turnMeta: any = null

    const finalizeAutoHangupIfNeeded = () => {
      if (!shouldAutoHangup || !pendingAutoHangupRef.current || reqId !== simReqIdRef.current) return
      shouldAutoHangup = false
      stopMicrophone()
      pendingAutoHangupRef.current = false
      setSimActiveSync(false)
      setSimCallSidSync(null)
      setSimAutoEndedNotice(true)
    }

    try {
      const res = await fetch('/api/phone/simulate', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
        body: JSON.stringify({
          action: 'turn',
          callSid: activeSid,
          storeId: simStoreId,
          lang: simLang,
          userText: message,
          voiceMode: 'neural_turbo',
          stream: true
        })
      })

      if (reqId !== simReqIdRef.current) {
        void res.body?.cancel?.().catch(() => {})
        return
      }

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || t('phone_agent.sim_error_turn'))
      }

      const pcmPlayer = createPcmStreamPlayer(() => finalizeAutoHangupIfNeeded())
      const reader = res.body.getReader()
      activeStreamReaderRef.current = reader
      const decoder = new TextDecoder()
      let ndjsonBuf = ''
      let assistantMsgTimestamp = ''
      let clientFirstAudioMs: number | undefined

      let handledFallbackSpeech = false

      const handleTurnEvent = (evt: any) => {
        if (reqId !== simReqIdRef.current) return
        if (evt.type === 'turn_meta') {
          turnMeta = evt
          shouldAutoHangup = Boolean(evt.shouldHangup || evt.shouldTransferToPhone)
          pendingAutoHangupRef.current = shouldAutoHangup
          assistantMsgTimestamp = new Date().toISOString()
          setSimBusySync(false)
          if (!simMutedRef.current) setSimSynthesizingAudio(true)
          if (evt.language === 'en' || evt.language === 'es') {
            setSimLang(evt.language)
          }
          setSimLastTools(evt.toolsUsed || [])
          if (evt.callbackCreated) {
            setSimLastCallback(evt.callbackCreated)
          }
          if (evt.shouldTransferToPhone) {
            setSimTransferPhone(evt.shouldTransferToPhone)
          }
          setSimTranscript((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: evt.replyText,
              timestamp: assistantMsgTimestamp,
              audioUrl: evt.audioUrl,
              lang: evt.language
            }
          ])
        } else if (evt.type === 'audio_pcm') {
          setSimSynthesizingAudio(false)
          if (clientFirstAudioMs === undefined) {
            clientFirstAudioMs = Math.round(performance.now() - turnStart)
            const immediateMs = clientFirstAudioMs
            const isFromCache = Boolean(evt.fromCache)
            if (assistantMsgTimestamp) {
              setSimTranscript((prev) =>
                prev.map((m) =>
                  m.timestamp === assistantMsgTimestamp
                    ? { ...m, firstAudioMs: immediateMs, fromCache: isFromCache }
                    : m
                )
              )
            }
          }
          pcmPlayer.pushPcmBase64(evt.pcmBase64, evt.sampleRate || 24000)
        } else if (evt.type === 'tts_fallback_required' || evt.type === 'audio_stream_truncated') {
          setSimSynthesizingAudio(false)
          if (evt.type === 'tts_fallback_required' || clientFirstAudioMs === undefined) {
            handledFallbackSpeech = true
            const fullText = evt.text || turnMeta?.replyText || ''
            const clipLang: 'es' | 'en' =
              evt.language === 'en' ? 'en' : evt.language === 'es' ? 'es' : turnMeta?.language === 'en' ? 'en' : 'es'
            speakWithFemaleBrowserVoice(
              fullText,
              clipLang,
              finalizeAutoHangupIfNeeded
            )
          }
        } else if (evt.type === 'done') {
          setSimSynthesizingAudio(false)
          const finalAudioMs = evt.totalFirstAudioMs > 0 ? evt.totalFirstAudioMs : clientFirstAudioMs
          if (assistantMsgTimestamp) {
            setSimTranscript((prev) =>
              prev.map((m) =>
                m.timestamp === assistantMsgTimestamp
                  ? { ...m, firstAudioMs: finalAudioMs, fromCache: Boolean(evt.fromCache) }
                  : m
              )
            )
          }
        } else if (evt.type === 'error') {
          throw new Error(evt.error || t('phone_agent.sim_error_turn'))
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (reqId !== simReqIdRef.current) break
          if (done) {
            ndjsonBuf += decoder.decode()
            for (const remLine of ndjsonBuf.split('\n')) {
              if (!remLine.trim()) continue
              let evt: any = null
              try {
                evt = JSON.parse(remLine)
              } catch {
                continue
              }
              if (evt) handleTurnEvent(evt)
            }
            break
          }
          ndjsonBuf += decoder.decode(value, { stream: true })
          const lines = ndjsonBuf.split('\n')
          ndjsonBuf = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            if (reqId !== simReqIdRef.current) break
            let evt: any = null
            try {
              evt = JSON.parse(line)
            } catch {
              continue
            }
            if (evt) handleTurnEvent(evt)
          }
        }
      } finally {
        if (!handledFallbackSpeech) {
          pcmPlayer.finish()
        }
        if (activeStreamReaderRef.current === reader) {
          activeStreamReaderRef.current = null
        }
      }

      if (reqId !== simReqIdRef.current) {
        return
      }
      if (turnMeta && !pcmPlayer.hasReceivedAudio() && !handledFallbackSpeech) {
        if (simActiveRef.current && turnMeta.audioUrl && !simMutedRef.current) {
          void playVoiceUrl(
            turnMeta.audioUrl,
            turnMeta.replyText,
            turnMeta.language,
            null,
            finalizeAutoHangupIfNeeded,
            { voice: (turnMeta.voiceId as VoiceId) || turnVoice }
          )
        } else {
          finalizeAutoHangupIfNeeded()
        }
      }
      void fetchDashboard(true)
    } catch (e: any) {
      if (reqId === simReqIdRef.current && e?.name !== 'AbortError') {
        if (startingNewCallSession && !turnMeta) {
          setSimActiveSync(false)
          setSimCallSidSync(null)
          setSimTranscript(prevTranscriptSnapshot)
        }
        setSimErrorBanner(e.message || t('phone_agent.sim_error_turn'))
      }
    } finally {
      if (reqId === simReqIdRef.current) {
        setSimBusySync(false)
        setSimSynthesizingAudio(false)
      }
    }
  }
  handleSendSimTurnRef.current = handleSendSimTurn

  const toggleMicrophone = () => {
    if (simBusyRef.current || !hasSimStoreLoaded) return
    ensureUnlockedAudioCtx()
    if (simListening || recognitionRef.current) {
      const pendingSpeech = micAccumulatedRef.current.trim()
      if (pendingSpeech && !micCommittedRef.current) {
        micCommittedRef.current = true
        setSimInput('')
        stopMicrophone()
        void handleSendSimTurnRef.current(pendingSpeech)
        return
      }
      stopMicrophone()
      return
    }

    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRec) {
      setSimErrorBanner(t('phone_agent.sim_mic_unsupported'))
      return
    }

    // Si la IA estaba en despedida terminal, cerrar la sesión terminada antes de abrir micrófono para nueva pregunta
    if (pendingAutoHangupRef.current) {
      pendingAutoHangupRef.current = false
      setSimActiveSync(false)
      setSimCallSidSync(null)
      setSimAutoEndedNotice(true)
    }

    // Barge-in real: silenciar cualquier audio de la IA antes de abrir el micrófono para que no se transcriba a sí misma
    stopAllSimAudio(true)
    setSimErrorBanner(null)

    const rec = new SpeechRec()
    rec.lang = simLang === 'en' ? 'en-US' : 'es-MX'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    micAccumulatedRef.current = ''
    micCommittedRef.current = false

    const clearMicTimer = () => {
      if (micSilenceTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(micSilenceTimerRef.current)
        micSilenceTimerRef.current = null
      }
    }

    const flushMicSpeech = () => {
      clearMicTimer()
      if (micCommittedRef.current) return
      const finalPayload = micAccumulatedRef.current.trim()
      if (!finalPayload) return
      micCommittedRef.current = true
      setSimInput('')
      stopMicrophone()
      void handleSendSimTurnRef.current(finalPayload)
    }

    rec.onstart = () => {
      if (recognitionRef.current !== rec) return
      setSimListening(true)
    }
    rec.onend = () => {
      if (recognitionRef.current !== rec) return
      recognitionRef.current = null
      if (!micCommittedRef.current && micAccumulatedRef.current.trim()) {
        flushMicSpeech()
        return
      }
      clearMicTimer()
      setSimListening(false)
    }
    rec.onerror = (ev: any) => {
      if (recognitionRef.current !== rec) return
      clearMicTimer()
      const errCode = String(ev?.error || '')
      if (errCode === 'no-speech' && !micCommittedRef.current && micAccumulatedRef.current.trim()) {
        flushMicSpeech()
        return
      }
      // Desvincular onend para que un error de red/hardware jamás envíe audio truncado al disparar onend inmediatamente después
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      recognitionRef.current = null
      micAccumulatedRef.current = ''
      setSimListening(false)
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setSimErrorBanner(t('phone_agent.sim_mic_denied'))
      } else if (errCode === 'no-speech') {
        setSimErrorBanner(t('phone_agent.sim_mic_no_speech'))
      } else if (errCode === 'audio-capture') {
        setSimErrorBanner(t('phone_agent.sim_mic_audio_capture'))
      } else if (errCode === 'network') {
        setSimErrorBanner(t('phone_agent.sim_mic_network_error'))
      }
    }
    rec.onresult = (event: any) => {
      if (recognitionRef.current !== rec || micCommittedRef.current) return
      const pieces: string[] = []
      for (let i = 0; i < (event.results?.length || 0); i++) {
        const part = String(event.results[i]?.[0]?.transcript || '').trim()
        if (part) pieces.push(part)
      }
      const combined = dedupCumulativeSpeechParts(pieces)
      if (!combined) return
      const resLen = event.results?.length || 0
      const lastIsFinal = resLen > 0 ? Boolean(event.results[resLen - 1]?.isFinal) : false
      const lastAssistant =
        [...simTranscriptRef.current].reverse().find((m) => m.role === 'assistant')?.text || ''
      micAccumulatedRef.current = combined
      setSimInput(combined)
      clearMicTimer()
      if (typeof window !== 'undefined') {
        micSilenceTimerRef.current = window.setTimeout(
          flushMicSpeech,
          computeAdaptiveSilenceDurationMs(combined, lastIsFinal, lastAssistant)
        )
      }
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      recognitionRef.current = null
      clearMicTimer()
      setSimListening(false)
    }
  }

  const handleReplaySimMessage = (msg: {
    text: string
    audioUrl?: string
    audioDataUrl?: string
    lang?: 'es' | 'en'
  }) => {
    const src = msg.audioDataUrl || msg.audioUrl
    if (!src) return
    stopMicrophone()
    if (pendingAutoHangupRef.current) {
      pendingAutoHangupRef.current = false
      setSimActiveSync(false)
      setSimCallSidSync(null)
      setSimAutoEndedNotice(true)
    }
    const storeVoice: VoiceId = currentSimStore?.config.voice_id || 'Kore'
    void playVoiceUrl(src, msg.text, msg.lang || simLang, null, undefined, {
      voice: storeVoice,
      ignoreMute: true
    })
  }

  const stopTranscriptReplay = useCallback(() => {
    replayingActiveRef.current = false
    replayingSeqRef.current += 1
    setReplayingMsgIdx(null)
    if (replayAbortRef.current) {
      try {
        replayAbortRef.current.abort()
      } catch {}
      replayAbortRef.current = null
    }
    stopAllSimAudio(false)
  }, [stopAllSimAudio])

  // Reproducir cualquier mensaje de la asistente desde la Bitácora de Llamadas (Tab 4)
  const handleReplayTranscriptTurn = async (
    text: string,
    langStr: string,
    storeId: number,
    idx: number
  ) => {
    if (replayingMsgIdx === idx) {
      stopTranscriptReplay()
      return
    }
    if (!text.trim() || replayingActiveRef.current || replayingMsgIdx !== null) return
    replayingActiveRef.current = true
    const replaySeq = ++replayingSeqRef.current
    setReplayingMsgIdx(idx)
    const callLang: 'es' | 'en' = String(langStr || '').toLowerCase() === 'en' ? 'en' : 'es'
    const msgLang = detectTranscriptMessageLang(text, callLang)
    const storeVoice = stores.find((s) => s.id === storeId)?.config.voice_id || 'Kore'
    replayAbortRef.current?.abort()
    const replayCtrl = new AbortController()
    replayAbortRef.current = replayCtrl
    const replayTimeout =
      typeof window !== 'undefined' ? window.setTimeout(() => replayCtrl.abort(), 15000) : null
    let blobUrl: string | null = null
    try {
      ensureUnlockedAudioCtx()
      const res = await fetch('/api/phone/tts', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: replayCtrl.signal,
        body: JSON.stringify({
          text,
          lang: msgLang,
          voice: storeVoice
        })
      })
      if (replayTimeout !== null && typeof window !== 'undefined') window.clearTimeout(replayTimeout)
      if (replayAbortRef.current === replayCtrl) {
        replayAbortRef.current = null
      }
      if (!res.ok) throw new Error('TTS failed')
      const blob = await res.blob()
      if (replaySeq !== replayingSeqRef.current) return
      blobUrl = URL.createObjectURL(blob)
      await playVoiceUrl(blobUrl, text, msgLang, null, undefined, {
        voice: storeVoice as VoiceId,
        ignoreMute: true
      })
    } catch (err: any) {
      if (replayTimeout !== null && typeof window !== 'undefined') window.clearTimeout(replayTimeout)
      if (replaySeq === replayingSeqRef.current && err?.name !== 'AbortError') {
        await new Promise<void>((resolve) => {
          speakWithFemaleBrowserVoice(text, msgLang, resolve, { ignoreMute: true })
        })
      }
    } finally {
      if (replayTimeout !== null && typeof window !== 'undefined') window.clearTimeout(replayTimeout)
      if (replayAbortRef.current === replayCtrl) {
        replayAbortRef.current = null
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (replaySeq === replayingSeqRef.current) {
        replayingActiveRef.current = false
        setReplayingMsgIdx(null)
      }
    }
  }

  // Knowledge Base handlers
  const handleSaveKnowledgeRule = async () => {
    if (savingRuleRef.current || savingRule || !editingRule?.title?.trim() || !editingRule?.answer_es?.trim()) return
    savingRuleRef.current = true
    setSavingRule(true)
    try {
      const isEdit = Boolean(editingRule.id)
      const res = await fetch('/api/phone/dashboard', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'knowledge_base',
          ...(isEdit ? { id: editingRule.id } : {}),
          store_id: editingRule.store_id ?? null,
          category: editingRule.category || 'general',
          title: editingRule.title.trim(),
          title_en: editingRule.title_en?.trim() || '',
          question_keywords: editingRule.question_keywords || '',
          answer_es: editingRule.answer_es.trim(),
          answer_en: editingRule.answer_en || '',
          priority: Math.max(0, Math.min(1000, Number(editingRule.priority ?? 80) || 0)),
          resolveCallId: isEdit ? null : resolveCallIdForRule
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      setEditingRule(null)
      setResolveCallIdForRule(null)
      showFeedback('ok', t('phone_agent.kb_saved_ok'))
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      savingRuleRef.current = false
      setSavingRule(false)
    }
  }

  const handleDismissUnanswered = async (callId: string) => {
    if (dismissingCallIdsRef.current.has(callId)) return
    dismissingCallIdsRef.current.add(callId)
    setDismissingCallIds((prev) => ({ ...prev, [callId]: true }))
    try {
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'dismiss_unanswered',
          callId
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      if (resolveCallIdForRule === callId) {
        setResolveCallIdForRule(null)
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      dismissingCallIdsRef.current.delete(callId)
      setDismissingCallIds((prev) => {
        const next = { ...prev }
        delete next[callId]
        return next
      })
    }
  }

  const handleToggleRuleActive = async (rule: KnowledgeRule) => {
    if (togglingRuleIdsRef.current.has(rule.id)) return
    togglingRuleIdsRef.current.add(rule.id)
    setTogglingRuleIds((prev) => ({ ...prev, [rule.id]: true }))
    try {
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'knowledge_base',
          id: rule.id,
          is_active: !rule.is_active
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      togglingRuleIdsRef.current.delete(rule.id)
      setTogglingRuleIds((prev) => {
        const next = { ...prev }
        delete next[rule.id]
        return next
      })
    }
  }

  const handleDeleteRule = async (id: string) => {
    if (deletingRuleIdsRef.current.has(id)) return
    if (typeof window !== 'undefined' && !window.confirm(t('phone_agent.kb_confirm_delete_rule'))) {
      return
    }
    deletingRuleIdsRef.current.add(id)
    setDeletingRuleIds((prev) => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/phone/dashboard?entity=knowledge_base&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      if (editingRule?.id === id) {
        setEditingRule(null)
        setResolveCallIdForRule(null)
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      deletingRuleIdsRef.current.delete(id)
      setDeletingRuleIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const formatUiHhMm12h = (raw: string | null | undefined): string => {
    if (!raw) return ''
    const parts = String(raw).trim().split(':')
    const h = Number(parts[0])
    const m = Number(parts[1] || 0)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return String(raw)
    const minStr = String(m).padStart(2, '0')
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${minStr} ${period}`
  }

  const parseHhMmToMinutes = (raw: string | null | undefined): number | null => {
    if (!raw) return null
    const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h < 0 || h > 23 || min < 0 || min > 59) return null
    return h * 60 + min
  }

  const handleSaveHoliday = async () => {
    if (savingHolidayRef.current || savingHoliday || !newHoliday.event_date || !newHoliday.holiday_name.trim()) return
    const isClosed = newHoliday.mode === 'closed'
    const openTime =
      newHoliday.mode === 'late_open' || newHoliday.mode === 'custom' ? newHoliday.open_time : null
    const closeTime =
      newHoliday.mode === 'early_close' || newHoliday.mode === 'custom' ? newHoliday.close_time : null

    if (
      !isClosed &&
      ((newHoliday.mode === 'late_open' && !openTime) ||
        (newHoliday.mode === 'early_close' && !closeTime) ||
        (newHoliday.mode === 'custom' && (!openTime || !closeTime)))
    ) {
      showFeedback('err', t('phone_agent.holidays_missing_time'))
      return
    }
    if (!isClosed && newHoliday.mode === 'custom' && openTime && closeTime) {
      if (openTime === closeTime) {
        showFeedback('err', t('phone_agent.holidays_invalid_range'))
        return
      }
      const openMin = parseHhMmToMinutes(openTime)
      const closeMin = parseHhMmToMinutes(closeTime)
      // Regla de día laboral (6:00 AM - 5:59 AM): el cierre puede ser de madrugada (00:00-05:59), pero nunca >= 06:00 y <= apertura
      if (openMin !== null && closeMin !== null && closeMin >= 360 && closeMin <= openMin) {
        showFeedback('err', t('phone_agent.holidays_invalid_business_window'))
        return
      }
    }

    savingHolidayRef.current = true
    setSavingHoliday(true)
    try {
      const res = await fetch('/api/phone/dashboard', {
        method: editingHolidayId ? 'PATCH' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'special_hours',
          ...(editingHolidayId ? { id: editingHolidayId } : {}),
          store_id: newHoliday.store_id ? Number(newHoliday.store_id) : null,
          event_date: newHoliday.event_date,
          holiday_name: newHoliday.holiday_name.trim(),
          is_closed: isClosed,
          open_time: openTime,
          close_time: closeTime
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      setEditingHolidayId(null)
      setNewHoliday({
        store_id: '',
        event_date: '',
        holiday_name: '',
        mode: 'closed',
        open_time: '11:00',
        close_time: '16:00'
      })
      showFeedback('ok', t('phone_agent.holidays_saved_ok'))
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      savingHolidayRef.current = false
      setSavingHoliday(false)
    }
  }

  const handleStartEditHoliday = (sh: SpecialHourRow) => {
    setEditingHolidayId(sh.id)
    const mode: 'closed' | 'early_close' | 'late_open' | 'custom' = sh.is_closed
      ? 'closed'
      : sh.open_time && sh.close_time
        ? 'custom'
        : sh.close_time
          ? 'early_close'
          : 'late_open'
    setNewHoliday({
      store_id: sh.store_id ? String(sh.store_id) : '',
      event_date: sh.event_date,
      holiday_name: sh.holiday_name,
      mode,
      open_time: (sh.open_time || '11:00').slice(0, 5),
      close_time: (sh.close_time || '16:00').slice(0, 5)
    })
  }

  const handleDeleteHoliday = async (id: string) => {
    if (deletingHolidayIdsRef.current.has(id)) return
    if (typeof window !== 'undefined' && !window.confirm(t('phone_agent.holidays_confirm_delete'))) {
      return
    }
    deletingHolidayIdsRef.current.add(id)
    setDeletingHolidayIds((prev) => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/phone/dashboard?entity=special_hours&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      if (editingHolidayId === id) {
        setEditingHolidayId(null)
        setNewHoliday({
          store_id: '',
          event_date: '',
          holiday_name: '',
          mode: 'closed',
          open_time: '11:00',
          close_time: '16:00'
        })
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      deletingHolidayIdsRef.current.delete(id)
      setDeletingHolidayIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  // Store Config handler (protege ediciones locales escritas mientras PATCH está en vuelo)
  const handleSaveStoreConfig = async (
    storeRow: StoreRow,
    customUpdates?: Record<string, any>,
    onlyCustomUpdates = false
  ): Promise<boolean> => {
    if (savingStoreIdsRef.current.has(storeRow.id)) return false
    savingStoreIdsRef.current.add(storeRow.id)
    setSavingStoreIds((prev) => ({ ...prev, [storeRow.id]: true }))
    const sentSnapshot: Record<string, any> = onlyCustomUpdates
      ? { ...(customUpdates || {}) }
      : { ...storeRow.config, ...(customUpdates || {}) }
    try {
      const payload = {
        entity: 'store_config',
        ...sentSnapshot,
        store_id: storeRow.id
      }
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      })
      const savedBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(savedBody.error || 'Error')
      }
      let preservedDraftOnStore = false
      const latestLocalStore = storesRef.current.find((s) => s.id === storeRow.id)
      const dirtyFields = dirtyStoreFieldsRef.current.get(storeRow.id)
      if (dirtyFields) {
        const keysToConsider = onlyCustomUpdates ? Object.keys(customUpdates || {}) : Array.from(dirtyFields)
        for (const k of keysToConsider) {
          const currentLocalVal = latestLocalStore ? (latestLocalStore.config as any)[k] : undefined
          // Solo limpiar el flag sucio si el usuario NO volvió a modificar este campo durante el PATCH
          if (!latestLocalStore || currentLocalVal === sentSnapshot[k]) {
            dirtyFields.delete(k)
          }
        }
        if (dirtyFields.size === 0) {
          dirtyStoreFieldsRef.current.delete(storeRow.id)
        } else {
          preservedDraftOnStore = true
        }
      }
      syncDirtyStoresSnapshot()
      const stillDirty = dirtyStoreFieldsRef.current.get(storeRow.id)
      setStores((prev) =>
        prev.map((s) => {
          if (s.id !== storeRow.id) return s
          const merged: any = { ...s.config }
          const incomingPatch = onlyCustomUpdates
            ? {
                ...(customUpdates || {}),
                ...(savedBody?.config
                  ? {
                      is_enabled: savedBody.config.is_enabled,
                      forwarding_status: savedBody.config.forwarding_status,
                      forwarding_verified_at: savedBody.config.forwarding_verified_at
                    }
                  : {})
              }
            : savedBody?.config || {}
          for (const [k, v] of Object.entries(incomingPatch)) {
            if (!stillDirty?.has(k)) {
              merged[k] = v
            }
          }
          return { ...s, config: merged }
        })
      )
      showFeedback(
        'ok',
        `#${storeRow.id} ${storeRow.name}: ${
          preservedDraftOnStore ? t('phone_agent.stores_toggle_preserved_draft') : t('phone_agent.stores_saved_ok')
        }`
      )
      await fetchDashboard(true)
      return true
    } catch (e: any) {
      showFeedback('err', e.message)
      return false
    } finally {
      savingStoreIdsRef.current.delete(storeRow.id)
      setSavingStoreIds((prev) => {
        const next = { ...prev }
        delete next[storeRow.id]
        return next
      })
    }
  }

  const updateLocalStoreConfig = (storeId: number, field: string, value: any) => {
    let fieldSet = dirtyStoreFieldsRef.current.get(storeId)
    if (!fieldSet) {
      fieldSet = new Set<string>()
      dirtyStoreFieldsRef.current.set(storeId, fieldSet)
    }
    fieldSet.add(field)
    syncDirtyStoresSnapshot()
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, config: { ...s.config, [field]: value } } : s))
    )
  }

  const handleUpdateCallbackStatus = async (
    cb: CallbackRow,
    nextStatus: 'resolved' | 'dismissed' | 'pending'
  ) => {
    if (resolvingCallbackIdsRef.current.has(cb.id)) return
    resolvingCallbackIdsRef.current.add(cb.id)
    setResolvingCallbackIds((prev) => ({ ...prev, [cb.id]: true }))
    try {
      const note = (callbackNotes[cb.id] || '').trim()
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'callback_request',
          id: cb.id,
          status: nextStatus,
          ...(nextStatus !== 'pending' && note ? { resolution_notes: note } : {})
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('phone_agent.banner_resolve_error'))
      }
      if (nextStatus !== 'pending') {
        setCallbackNotes((prev) => {
          const next = { ...prev }
          delete next[cb.id]
          return next
        })
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      resolvingCallbackIdsRef.current.delete(cb.id)
      setResolvingCallbackIds((prev) => {
        const next = { ...prev }
        delete next[cb.id]
        return next
      })
    }
  }

  const copyTextWithFallback = (text: string, onCopied: () => void) => {
    const execFallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) {
          onCopied()
        } else {
          showFeedback('err', t('phone_agent.stores_copy_failed'))
        }
      } catch {
        showFeedback('err', t('phone_agent.stores_copy_failed'))
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(onCopied).catch(execFallback)
      return
    }
    execFallback()
  }

  const copyToClipboard = (code: string) => {
    copyTextWithFallback(code, () => {
      setCopiedCode(code)
      if (copiedCodeTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(copiedCodeTimerRef.current)
      }
      if (typeof window !== 'undefined') {
        copiedCodeTimerRef.current = window.setTimeout(() => {
          setCopiedCode((cur) => (cur === code ? null : cur))
          copiedCodeTimerRef.current = null
        }, 2000)
      }
    })
  }

  const copyCallbackPhone = (cbId: string, phoneText: string) => {
    copyTextWithFallback(phoneText, () => {
      setCopiedCbPhoneId(cbId)
      if (copiedCbPhoneTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(copiedCbPhoneTimerRef.current)
      }
      if (typeof window !== 'undefined') {
        copiedCbPhoneTimerRef.current = window.setTimeout(() => {
          setCopiedCbPhoneId((cur) => (cur === cbId ? null : cur))
          copiedCbPhoneTimerRef.current = null
        }, 1800)
      }
    })
  }

  const getCallerTypeLabel = (callerType: string): string => {
    const norm = String(callerType || '').toLowerCase()
    if (norm === 'employee') return t('phone_agent.caller_type_employee')
    if (norm === 'vendor') return t('phone_agent.caller_type_vendor')
    if (norm === 'delivery_driver') return t('phone_agent.caller_type_driver')
    if (norm === 'corporate') return t('phone_agent.caller_type_corporate')
    return t('phone_agent.caller_type_customer')
  }

  const getUrgencyLabel = (urgency: string): string => {
    const norm = String(urgency || '').toLowerCase()
    if (norm === 'critical') return t('phone_agent.urgency_critical')
    if (norm === 'urgent') return t('phone_agent.urgency_urgent')
    if (norm === 'high') return t('phone_agent.urgency_high')
    return t('phone_agent.urgency_normal')
  }

  const getIntentLabel = (intent: string): string => {
    const norm = String(intent || 'general').toLowerCase()
    const knownIntents = new Set([
      'spam',
      'employee_callout',
      'wrong_store_order',
      'complaint_missing_item',
      'delivery_issue',
      'condiments_note',
      'job_inquiry',
      'lost_and_found',
      'vendor_service',
      'delivery_driver',
      'order_by_phone',
      'fiesta_platters',
      'payment_ebt',
      'menu_prices',
      'location_drivethru',
      'hours',
      'manager_callback',
      'general'
    ])
    return knownIntents.has(norm) ? t(`phone_agent.intent_${norm}`) : intent
  }

  const getCallerSourceMeta = (src?: string | null): { label: string; cls: string } => {
    const norm = String(src || '').toLowerCase()
    if (norm === 'employee') {
      return {
        label: t('phone_agent.calls_caller_source_employee'),
        cls: 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
      }
    }
    if (norm === 'store') {
      return {
        label: t('phone_agent.calls_caller_source_store'),
        cls: 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
      }
    }
    if (norm === 'vendor') {
      return {
        label: t('phone_agent.calls_caller_source_vendor'),
        cls: 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
      }
    }
    if (norm === 'loyalty') {
      return {
        label: t('phone_agent.calls_caller_source_loyalty'),
        cls: 'bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300'
      }
    }
    if (norm === 'returning_caller') {
      return {
        label: t('phone_agent.calls_caller_source_returning'),
        cls: 'bg-teal-100 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300'
      }
    }
    if (norm === 'spoken') {
      return {
        label: t('phone_agent.calls_caller_source_spoken'),
        cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
      }
    }
    return {
      label: t('phone_agent.calls_caller_source_cnam'),
      cls: 'bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300'
    }
  }

  const isSimulatorPlaceholderCaller = (val?: string | null) =>
    !val || val === 'SIMULATOR_WEB' || val === 'SIMULADOR_LIVE_WEB'

  const getReasonCategoryLabel = (category: string): string => {
    const norm = String(category || '').toLowerCase()
    if (norm === 'general') return t('phone_agent.reason_other')
    const knownReasons = new Set([
      'condiments_note',
      'wrong_store_order',
      'delivery_issue',
      'missing_or_wrong_item',
      'lost_item',
      'employee_callout',
      'vendor_arrival',
      'billing_refund',
      'other'
    ])
    return knownReasons.has(norm) ? t(`phone_agent.reason_${norm}`) : ''
  }

  const currentSimStore = stores.find((s) => s.id === simStoreId) || stores[0]
  const currentSimStoreDisplayName = currentSimStore
    ? formatCustomerStoreName({ id: currentSimStore.id, name: currentSimStore.name }, isEn ? 'en' : 'es')
    : ''
  const selectedCallDetail = selectedCallId
    ? calls.find((c) => c.id === selectedCallId) || selectedCallFallback
    : null
  const selectedStoreForForwarding =
    selectedStoreIdForForwarding !== null
      ? stores.find((s) => s.id === selectedStoreIdForForwarding) || null
      : null
  const allStorePhoneStrings = stores.map((st) => st.phone).filter(Boolean)
  const directConflictTenDigitsForSelected = (() => {
    const conflictSet = new Set<string>()
    if (!selectedStoreForForwarding) return conflictSet
    const selMode = selectedStoreForForwarding.config.routing_mode
    for (const other of stores) {
      if (other.id === selectedStoreForForwarding.id || !other.config.twilio_phone_number) continue
      const d = other.config.twilio_phone_number.replace(/\D/g, '')
      const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
      if (ten.length === 10 && (selMode === 'direct_twilio' || other.config.routing_mode === 'direct_twilio')) {
        conflictSet.add(ten)
      }
    }
    return conflictSet
  })()
  const selectedTwilioValidation = selectedStoreForForwarding
    ? validateClientTwilioNumber(selectedStoreForForwarding.config.twilio_phone_number, {
        storePhones: allStorePhoneStrings,
        directConflictTenDigits: directConflictTenDigitsForSelected
      })
    : { valid: false, isEmpty: true, tenDigits: '' }
  const selectedDirtyFields = selectedStoreForForwarding
    ? dirtyStoreFieldsRef.current.get(selectedStoreForForwarding.id)
    : undefined
  const hasUnsavedForwardingDraftOnSelected = Boolean(
    selectedDirtyFields &&
      (selectedDirtyFields.has('twilio_phone_number') ||
        selectedDirtyFields.has('carrier_type') ||
        selectedDirtyFields.has('ring_timeout_seconds') ||
        selectedDirtyFields.has('routing_mode'))
  )
  const liveForwardingGuide = selectedStoreForForwarding
    ? computeClientForwardingGuide(
        selectedStoreForForwarding.config.carrier_type,
        selectedStoreForForwarding.config.twilio_phone_number,
        selectedStoreForForwarding.config.ring_timeout_seconds || 20,
        {
          storePhones: allStorePhoneStrings,
          directConflictTenDigits: directConflictTenDigitsForSelected
        }
      )
    : null
  const canCopySelectedForwardingCodes = Boolean(
    liveForwardingGuide?.hasValidTwilioNumber && !hasUnsavedForwardingDraftOnSelected
  )
  const filteredKnowledge = knowledgeBase.filter(
    (k) => kbFilterCategory === 'all' || k.category === kbFilterCategory
  )

  return (
    <ProtectedRoute
      allowedRoles={[
        'admin',
        'administrador',
        'supervisor',
        'manager',
        'general_manager',
        'regional_manager',
        'gerente',
        'asistente',
        'assistant'
      ]}
    >
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-6 space-y-6">
        {/* HEADER */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md">
              <PhoneCall size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                  {t('phone_agent.title')}
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-extrabold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {t('phone_agent.voice_badge_header')}
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {t('phone_agent.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end lg:self-center">
            <button
              type="button"
              onClick={() => void fetchDashboard(false)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              {t('phone_agent.refresh')}
            </button>
          </div>
        </div>

        {/* RBAC STORE SCOPE NOTICE FOR MANAGERS / ASSISTANTS */}
        {!isGlobalAdmin && stores.length > 0 && (
          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/80 dark:bg-indigo-950/30 px-4 py-3 flex flex-wrap items-center gap-2.5 text-xs text-indigo-900 dark:text-indigo-200">
            <ShieldCheck size={17} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="font-black uppercase">
              {t('phone_agent.rbac_store_scope_badge')}{' '}
              {stores.map((s) => `#${s.id} ${s.name}`).join(', ')}
            </span>
            <span className="opacity-70">•</span>
            <span className="font-medium">{t('phone_agent.rbac_readonly_notice')}</span>
          </div>
        )}

        {/* GLOBAL FEEDBACK BANNER (Floating high-z toast visible across scrolled tabs) */}
        {feedbackBanner && (
          <div
            className={`fixed top-4 right-4 z-[130] max-w-md rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-xs font-bold shadow-xl ${
              feedbackBanner.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackBanner.kind === 'ok' ? (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              )}
              <span>{feedbackBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_active_stores')}
              </span>
              <Store size={18} className="text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.activeStoresCount ?? 0} / {stores.length || (isGlobalAdmin ? 15 : 1)}
              </span>
              <span className="text-xs text-slate-500">
                ({kpis.verifiedForwardingCount} {t('phone_agent.kpi_carriers_summary')})
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_resolved_ai')}
              </span>
              <Sparkles size={18} className="text-blue-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.resolvedByAiPct}%
              </span>
              <span className="text-xs text-slate-500">
                ({kpis.realCallsCount} {t('phone_agent.kpi_calls_unit')}
                {kpis.simulatorCallsCount > 0
                  ? ` • +${kpis.simulatorCallsCount} ${t('phone_agent.kpi_sim_calls_note')}`
                  : ''}
                )
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_minutes_saved')}
              </span>
              <Clock size={18} className="text-purple-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {kpis.estimatedCashierMinutesSaved} min
              </span>
              <span className="text-xs text-slate-500">
                {t('phone_agent.kpi_minutes_saved_sub')}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t('phone_agent.kpi_pending_callbacks')}
              </span>
              <Bell
                size={18}
                className={
                  kpis.pendingCallbacksCount > 0 ? 'text-rose-600 animate-bounce' : 'text-slate-400'
                }
              />
            </div>
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <span
                className={`text-2xl font-black ${
                  kpis.pendingCallbacksCount > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'
                }`}
              >
                {kpis.pendingCallbacksCount}
              </span>
              <span className="text-xs text-slate-500">
                {t('phone_agent.kpi_callbacks_sub')}
                {kpis.pendingSimulatorCallbacksCount > 0
                  ? ` (+${kpis.pendingSimulatorCallbacksCount} ${t('phone_agent.kpi_sim_callbacks_note')})`
                  : ''}
              </span>
            </div>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'simulator'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <PhoneCall size={17} />
            {t('phone_agent.tab_simulator')}
          </button>

          {isGlobalAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('knowledge')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
                activeTab === 'knowledge'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
              }`}
            >
              <BookOpen size={17} />
              {t('phone_agent.tab_knowledge')}
              <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                {knowledgeBase.length}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('learning')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'learning'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Sparkles size={17} />
            {t('phone_agent.tab_learning')}
            {learningStats.pendingDoubts > 0 ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500 text-white font-black tabular-nums">
                {learningStats.pendingDoubts}
              </span>
            ) : learningStats.activeRules > 0 ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 tabular-nums">
                {learningStats.activeRules}
              </span>
            ) : null}
          </button>

          {isGlobalAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('stores')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
                activeTab === 'stores'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
              }`}
            >
              <Store size={17} />
              {t('phone_agent.tab_stores')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('calls')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === 'calls'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <MessageSquare size={17} />
            {t('phone_agent.tab_calls')}
            {kpis.pendingCallbacksCount > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-rose-600 text-white font-black">
                {kpis.pendingCallbacksCount}
              </span>
            )}
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SIMULADOR EN VIVO                                          */}
        {/* ================================================================= */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT PANEL */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
                <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (simEngineMode !== 'kore_live') {
                        stopMicrophone()
                        stopAllSimAudio(true)
                        if (simActive) void handleEndSimCall()
                        setSimEngineMode('kore_live')
                      }
                    }}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-black transition ${
                      simEngineMode === 'kore_live'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {t('phone_agent.sim_mode_live_badge')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (simEngineMode !== 'classic') {
                        void koreLiveSimRef.current?.endCall()
                        setSimEngineMode('classic')
                      }
                    }}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-black transition ${
                      simEngineMode === 'classic'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {t('phone_agent.sim_mode_classic_badge')}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      {t('phone_agent.sim_select_store')}
                    </label>
                    <select
                      value={simStoreId}
                      disabled={stores.length <= 1}
                      onChange={(e) => {
                        const nextId = Number(e.target.value)
                        stopMicrophone()
                        stopAllSimAudio(true)
                        if (simActive) {
                          void handleEndSimCall()
                        }
                        if (simEngineMode === 'kore_live') {
                          void koreLiveSimRef.current?.endCall()
                        }
                        setSimTranscript([])
                        setSimLastTools([])
                        setSimLastCallback(null)
                        setSimTransferPhone(null)
                        setSimAutoEndedNotice(false)
                        setSimErrorBanner(null)
                        setSimStoreId(nextId)
                        const nextStore = stores.find((st) => st.id === nextId)
                        if (nextStore?.config?.default_language === 'en' || nextStore?.config?.default_language === 'es') {
                          setSimLang(nextStore.config.default_language)
                        }
                      }}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white disabled:opacity-75"
                    >
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} - {s.name} ({s.phone})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                      {t('phone_agent.sim_select_lang')}
                    </label>
                    <select
                      value={simLang}
                      onChange={(e) => {
                        const nextLang = e.target.value as 'es' | 'en'
                        stopMicrophone()
                        stopAllSimAudio(true)
                        if (simActive) {
                          void handleEndSimCall()
                        }
                        if (simEngineMode === 'kore_live') {
                          void koreLiveSimRef.current?.endCall()
                        }
                        setSimTranscript([])
                        setSimLastTools([])
                        setSimLastCallback(null)
                        setSimTransferPhone(null)
                        setSimAutoEndedNotice(false)
                        setSimErrorBanner(null)
                        setSimLang(nextLang)
                      }}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white"
                    >
                      <option value="es">{t('phone_agent.sim_lang_es_option')}</option>
                      <option value="en">{t('phone_agent.sim_lang_en_option')}</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <span className="inline-flex items-center gap-1.5">
                        <Volume2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                        {t('phone_agent.sim_voice_badge')}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black uppercase">
                        {currentSimStore?.config.voice_id || 'Kore'} 3.8
                      </span>
                    </div>
                  </div>
                </div>

                {currentSimStore && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold uppercase text-slate-500">
                        {t('phone_agent.sim_live_store_info')}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                          currentSimStore.scheduleEval?.isOpenNow
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {currentSimStore.scheduleEval?.isOpenNow
                          ? t('phone_agent.sim_open_now')
                          : t('phone_agent.sim_closed_now')}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      Tacos Gavilan — {currentSimStoreDisplayName} ({currentSimStore.phone})
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      📍 {currentSimStore.address}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      🕐{' '}
                      {isEn
                        ? currentSimStore.scheduleEval?.statusMessageEn
                        : currentSimStore.scheduleEval?.statusMessageEs}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          currentSimStore.has_drive_thru
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        🚗{' '}
                        {currentSimStore.has_drive_thru
                          ? t('phone_agent.sim_drive_thru_yes')
                          : t('phone_agent.sim_drive_thru_no')}
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          currentSimStore.config.accepts_ebt
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        💳{' '}
                        {currentSimStore.config.accepts_ebt
                          ? t('phone_agent.sim_ebt_yes')
                          : t('phone_agent.sim_ebt_no')}
                      </span>

                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        📡{' '}
                        {currentSimStore.config.carrier_type === 'spectrum_landline'
                          ? t('phone_agent.stores_carrier_spectrum')
                          : t('phone_agent.stores_carrier_att')}
                      </span>
                    </div>
                  </div>
                )}

                {simErrorBanner && (
                  <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle size={14} className="shrink-0" />
                      {simErrorBanner}
                    </span>
                    <button type="button" onClick={() => setSimErrorBanner(null)}>
                      <X size={13} />
                    </button>
                  </div>
                )}

                {/* Call Start / Hangup Buttons (Classic Mode) */}
                {simEngineMode === 'classic' && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {!simActive ? (
                      <button
                        type="button"
                        onClick={() => void handleStartSimCall()}
                        disabled={simBusy || !hasSimStoreLoaded}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm shadow-md transition"
                      >
                        <PhoneCall size={18} />
                        {t('phone_agent.sim_start_call')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleEndSimCall()}
                        disabled={simBusy}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm shadow-md transition"
                      >
                        <PhoneOff size={18} />
                        {t('phone_agent.sim_end_call')}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={toggleMicrophone}
                      disabled={simBusy || !hasSimStoreLoaded}
                      className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-sm transition disabled:opacity-50 ${
                        simListening
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {simListening ? <MicOff size={18} /> : <Mic size={18} />}
                      {simListening ? t('phone_agent.sim_mic_listening') : t('phone_agent.sim_mic_speak')}
                    </button>
                  </div>
                )}
              </div>

              {/* QUICK 1-CLICK SCENARIOS */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                    {t('phone_agent.sim_quick_scenarios')}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-black">
                    {
                      QUICK_SCENARIOS.filter(
                        (sc) => simScenarioGroup === 'all' || sc.group === simScenarioGroup
                      ).length
                    }
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {SCENARIO_GROUPS.map((grp) => {
                    const count =
                      grp.id === 'all'
                        ? QUICK_SCENARIOS.length
                        : QUICK_SCENARIOS.filter((s) => s.group === grp.id).length
                    const active = simScenarioGroup === grp.id
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => setSimScenarioGroup(grp.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border ${
                          active
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                        }`}
                      >
                        {t(grp.key)} ({count})
                      </button>
                    )
                  })}
                </div>

                <div className="grid grid-cols-1 gap-2 max-h-[430px] overflow-y-auto pr-1">
                  {QUICK_SCENARIOS.filter(
                    (sc) => simScenarioGroup === 'all' || sc.group === simScenarioGroup
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => {
                        const txt = simLang === 'en' ? sc.textEn : sc.textEs
                        if (simEngineMode === 'kore_live') {
                          void koreLiveSimRef.current?.sendScenarioOrText(txt)
                        } else {
                          void handleSendSimTurn(txt)
                        }
                      }}
                      disabled={(simEngineMode === 'classic' && simBusy) || !hasSimStoreLoaded}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 disabled:opacity-50 transition text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between gap-2"
                    >
                      <span>{simLang === 'en' ? sc.labelEn : sc.labelEs}</span>
                      <Send size={13} className="text-emerald-600 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Live Conversation Transcript & Tool Telemetry */}
            {simEngineMode === 'kore_live' ? (
              <div className="lg:col-span-7">
                <KorePhoneLiveSimulator
                  ref={koreLiveSimRef}
                  storeId={simStoreId}
                  storeDisplayName={currentSimStoreDisplayName || 'Tacos Gavilan'}
                  lang={simLang}
                  onLangChange={(next) => setSimLang(next)}
                  disabled={!hasSimStoreLoaded}
                  getAuthHeaders={getAuthHeaders}
                  onDashboardRefresh={handleLiveDashboardRefresh}
                />
              </div>
            ) : (
            <div
              data-teg-live-sim={simActive ? 'true' : 'false'}
              className="lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden min-h-[560px]"
            >
              {/* Phone Call Top Bar */}
              <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      simActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-black">
                      {currentSimStore ? `Tacos Gavilan — ${currentSimStoreDisplayName}` : 'Tacos Gavilan'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {simActive
                        ? `${t('phone_agent.sim_call_in_progress')} (${currentSimStore?.config.voice_id || 'Kore'})`
                        : t('phone_agent.sim_ready_to_call')}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {simSynthesizingAudio && !simSpeaking && !simMuted && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold">
                      <RefreshCw size={12} className="animate-spin" />
                      {t('phone_agent.sim_synthesizing_voice')}
                    </span>
                  )}
                  {simSpeaking && !simMuted && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold">
                      <Volume2 size={14} className="animate-bounce" />
                      {currentSimStore?.config.voice_id || 'Kore'} • {t('phone_agent.sim_speaking_badge')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !simMutedRef.current
                      setSimMutedSync(next)
                      if (next) {
                        if (pendingAutoHangupRef.current) {
                          stopMicrophone()
                          stopAllSimAudio(true)
                          pendingAutoHangupRef.current = false
                          setSimActiveSync(false)
                          setSimCallSidSync(null)
                          setSimAutoEndedNotice(true)
                        } else {
                          stopAllSimAudio(false)
                        }
                      }
                    }}
                    title={simMuted ? t('phone_agent.sim_unmute_voice') : t('phone_agent.sim_mute_voice')}
                    className={`p-2 rounded-xl border text-xs font-bold transition ${
                      simMuted
                        ? 'bg-rose-500/20 border-rose-400/50 text-rose-200 hover:bg-rose-500/30'
                        : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {simMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                </div>
              </div>

              {/* Messages Container */}
              <div
                ref={transcriptContainerRef}
                className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[430px]"
              >
                {simTranscript.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-16 text-slate-400 space-y-3">
                    <Phone size={40} className="text-slate-300 dark:text-slate-700" />
                    <p className="text-sm font-bold max-w-md">
                      {t('phone_agent.sim_empty_prompt')}
                    </p>
                  </div>
                ) : (
                  simTranscript.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                          msg.role === 'user'
                            ? 'bg-emerald-600 text-white font-medium'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-[11px] font-black uppercase opacity-75">
                            {msg.role === 'user'
                              ? t('phone_agent.sim_caller_label')
                              : currentSimStore?.name
                                ? `${t('phone_agent.sim_assistant_label')} (${currentSimStore.name})`
                                : t('phone_agent.sim_assistant_label')}
                          </span>
                          <div className="flex items-center gap-2">
                            {typeof msg.firstAudioMs === 'number' && msg.firstAudioMs > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                ⚡ {(msg.firstAudioMs / 1000).toFixed(2)}s
                                {msg.fromCache ? ` • ${t('phone_agent.sim_cached_badge')}` : ''}
                              </span>
                            )}
                            {(msg.audioDataUrl || msg.audioUrl) && (
                              <button
                                type="button"
                                onClick={() => handleReplaySimMessage(msg)}
                                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                              >
                                <Volume2 size={13} />
                                {t('phone_agent.sim_replay')}
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}

                {simBusy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-4 py-3 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500 flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin text-emerald-600" />
                      {t('phone_agent.sim_streaming_status')}
                    </div>
                  </div>
                )}

                {simAutoEndedNotice && (
                  <div className="text-center py-1">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      <PhoneOff size={12} />
                      {t('phone_agent.sim_call_ended_auto')}
                    </span>
                  </div>
                )}
              </div>

              {/* Tools, Live Transfer & Simulator-Isolated Callback Banner */}
              {(simLastTools.length > 0 || simLastCallback || simTransferPhone) && (
                <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  {simLastTools.map((tool, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    >
                      ⚡ {t('phone_agent.sim_tool_prefix')} {tool}
                    </span>
                  ))}
                  {simTransferPhone && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                      <PhoneForwarded size={12} />
                      {t('phone_agent.sim_live_transfer_badge')} {simTransferPhone}
                    </span>
                  )}
                  {simLastCallback && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      🧪 {t('phone_agent.sim_callback_isolated_badge')}
                    </span>
                  )}
                </div>
              )}

              {/* Bottom Input Bar */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap sm:flex-nowrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSendSimTurn('9')}
                  disabled={simBusy || !hasSimStoreLoaded}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 disabled:opacity-50 text-indigo-700 dark:text-indigo-300 text-xs font-black transition shrink-0"
                  title="9"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-indigo-600 text-white text-[11px] font-black">
                    9
                  </span>
                  {simLang === 'en'
                    ? t('phone_agent.sim_keypad_9_to_es')
                    : t('phone_agent.sim_keypad_9_to_en')}
                </button>
                <input
                  type="text"
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSendSimTurn()
                  }}
                  placeholder={t('phone_agent.sim_type_placeholder')}
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void handleSendSimTurn()}
                  disabled={simBusy || !hasSimStoreLoaded || !simInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold transition shrink-0"
                >
                  <Send size={16} />
                  {t('phone_agent.sim_send')}
                </button>
              </div>
            </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: BASE DE CONOCIMIENTO EDITABLE + PREGUNTAS NUEVAS + FESTIVOS */}
        {/* ================================================================= */}
        {activeTab === 'knowledge' && isGlobalAdmin && (
          <div className="space-y-6">
            {/* Unanswered Questions Detector */}
            {unansweredQuestions.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 font-black text-base">
                  <HelpCircle size={20} />
                  {t('phone_agent.kb_unanswered_title')} ({unansweredQuestions.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {unansweredQuestions.map((uq) => (
                    <div
                      key={uq.callId}
                      className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-500 flex items-center gap-2 flex-wrap">
                          <span>{uq.storeName} • {formatStoreDateTime(uq.startedAt, isEn)}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                              uq.source === 'simulator'
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            }`}
                          >
                            {uq.source === 'simulator'
                              ? t('phone_agent.calls_badge_simulator')
                              : t('phone_agent.calls_badge_twilio')}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 break-words">
                          “{uq.question}”
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setResolveCallIdForRule(uq.callId)
                            setEditingRule({
                              store_id: null,
                              category: 'general',
                              title: String(uq.question || '').slice(0, 60),
                              title_en: '',
                              question_keywords: '',
                              answer_es: '',
                              answer_en: '',
                              priority: 80
                            })
                            setRuleEditorOpenSeq((n) => n + 1)
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                        >
                          {t('phone_agent.kb_convert_to_rule')}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(dismissingCallIds[uq.callId])}
                          onClick={() => void handleDismissUnanswered(uq.callId)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-600 dark:text-slate-300 text-xs font-bold"
                          title={t('phone_agent.kb_dismiss_unanswered')}
                        >
                          {t('phone_agent.kb_dismiss_unanswered')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Knowledge Base Header & Filter */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">
                    {t('phone_agent.kb_title')}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">{t('phone_agent.kb_subtitle')}</p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={kbFilterCategory}
                    onChange={(e) => setKbFilterCategory(e.target.value)}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="all">{t('phone_agent.kb_all_categories')}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.key)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setResolveCallIdForRule(null)
                      setEditingRule({
                        store_id: null,
                        category: 'general',
                        title: '',
                        title_en: '',
                        question_keywords: '',
                        answer_es: '',
                        answer_en: '',
                        priority: 80
                      })
                      setRuleEditorOpenSeq((n) => n + 1)
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm"
                  >
                    <Plus size={16} />
                    {t('phone_agent.kb_add_rule')}
                  </button>
                </div>
              </div>

              {/* Rule Editor Form */}
              {editingRule && (
                <div
                  ref={ruleEditorRef}
                  className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border-2 border-emerald-500 p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_scope_label')}
                      </label>
                      <select
                        value={editingRule.store_id ?? ''}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            store_id: e.target.value ? Number(e.target.value) : null
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      >
                        <option value="">{t('phone_agent.kb_scope_global')}</option>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            #{s.id} - {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_category')}
                      </label>
                      <select
                        value={editingRule.category || 'general'}
                        onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {t(c.key)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {'🇲🇽'} {t('phone_agent.kb_rule_title')}
                      </label>
                      <input
                        type="text"
                        value={editingRule.title || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, title: e.target.value })}
                        placeholder={t('phone_agent.kb_title_placeholder')}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {'🇺🇸'} {t('phone_agent.kb_rule_title_en')}
                      </label>
                      <input
                        type="text"
                        value={editingRule.title_en || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, title_en: e.target.value })}
                        placeholder={t('phone_agent.kb_title_en_placeholder')}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_keywords')}
                      </label>
                      <input
                        type="text"
                        value={editingRule.question_keywords || ''}
                        onChange={(e) =>
                          setEditingRule({ ...editingRule, question_keywords: e.target.value })
                        }
                        placeholder={t('phone_agent.kb_keywords_placeholder')}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        {t('phone_agent.kb_priority')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={editingRule.priority ?? 80}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            priority: Math.max(0, Math.min(1000, Number(e.target.value) || 0))
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        🇲🇽 {t('phone_agent.kb_answer_es')}
                      </label>
                      <textarea
                        rows={3}
                        value={editingRule.answer_es || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, answer_es: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                        🇺🇸 {t('phone_agent.kb_answer_en')}
                      </label>
                      <textarea
                        rows={3}
                        value={editingRule.answer_en || ''}
                        onChange={(e) => setEditingRule({ ...editingRule, answer_en: e.target.value })}
                        placeholder={t('phone_agent.kb_answer_en_placeholder')}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRule(null)
                        setResolveCallIdForRule(null)
                      }}
                      className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                    >
                      {t('phone_agent.kb_cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveKnowledgeRule()}
                      disabled={savingRule || !editingRule.title?.trim() || !editingRule.answer_es?.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black"
                    >
                      <Save size={14} />
                      {t('phone_agent.kb_save')}
                    </button>
                  </div>
                </div>
              )}

              {/* Rules List */}
              {filteredKnowledge.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">{t('phone_agent.kb_empty_filtered')}</p>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredKnowledge.map((rule) => {
                  const catObj = CATEGORIES.find((c) => c.id === rule.category)
                  return (
                    <div
                      key={rule.id}
                      className={`rounded-2xl border p-4 space-y-2 transition ${
                        rule.is_active
                          ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                          : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200/60 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              {rule.store_id
                                ? `${rule.stores?.name || `#${rule.store_id}`}`
                                : t('phone_agent.kb_scope_global')}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {catObj ? t(catObj.key) : rule.category}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400">
                              P{rule.priority}
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">
                            {isEn ? rule.title_en || rule.title : rule.title}
                          </h4>
                          {rule.title_en && rule.title_en !== rule.title && (
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              {isEn ? `🇲🇽 ${rule.title}` : `🇺🇸 ${rule.title_en}`}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={Boolean(togglingRuleIds[rule.id])}
                            onClick={() => void handleToggleRuleActive(rule)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black disabled:opacity-50 ${
                              rule.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {rule.is_active
                              ? t('phone_agent.kb_rule_active_on')
                              : t('phone_agent.kb_rule_active_off')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResolveCallIdForRule(null)
                              setEditingRule(rule)
                              setRuleEditorOpenSeq((n) => n + 1)
                            }}
                            title={t('phone_agent.kb_edit')}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(deletingRuleIds[rule.id])}
                            onClick={() => void handleDeleteRule(rule.id)}
                            title={t('phone_agent.kb_delete')}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {buildPhoneBilingualLines(rule.answer_es, rule.answer_en, isEn).map((ans, idx) => (
                        <p
                          key={ans.code}
                          className={idx === 0 ? 'text-xs text-slate-700 dark:text-slate-300 leading-relaxed' : 'text-xs text-slate-500 dark:text-slate-400 leading-relaxed'}
                        >
                          {ans.flag} {ans.text}
                        </p>
                      ))}
                    </div>
                  )
                })}
              </div>
              )}
            </div>

            {/* Special Holiday Hours Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <Calendar size={18} className="text-emerald-600" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    {t('phone_agent.holidays_title')}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">{t('phone_agent.holidays_subtitle')}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('phone_agent.holidays_field_store')}
                  </label>
                  <select
                    value={newHoliday.store_id}
                    onChange={(e) => setNewHoliday({ ...newHoliday, store_id: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="">{t('phone_agent.kb_scope_global')}</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('phone_agent.holidays_field_date')}
                  </label>
                  <input
                    type="date"
                    value={newHoliday.event_date}
                    onChange={(e) => setNewHoliday({ ...newHoliday, event_date: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div className="lg:col-span-3">
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('phone_agent.holidays_field_name')}
                  </label>
                  <input
                    type="text"
                    value={newHoliday.holiday_name}
                    onChange={(e) => setNewHoliday({ ...newHoliday, holiday_name: e.target.value })}
                    placeholder={t('phone_agent.holidays_name_placeholder')}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    {t('phone_agent.holidays_field_mode')}
                  </label>
                  <select
                    value={newHoliday.mode}
                    onChange={(e) =>
                      setNewHoliday({
                        ...newHoliday,
                        mode: e.target.value as 'closed' | 'early_close' | 'late_open' | 'custom'
                      })
                    }
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-bold"
                  >
                    <option value="closed">{t('phone_agent.holidays_mode_closed')}</option>
                    <option value="early_close">{t('phone_agent.holidays_mode_early_close')}</option>
                    <option value="late_open">{t('phone_agent.holidays_mode_late_open')}</option>
                    <option value="custom">{t('phone_agent.holidays_mode_custom')}</option>
                  </select>
                </div>

                {newHoliday.mode !== 'closed' && (
                  <div className="lg:col-span-2 grid grid-cols-2 gap-1.5">
                    {(newHoliday.mode === 'late_open' || newHoliday.mode === 'custom') && (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.holidays_open_time_label')}
                        </label>
                        <input
                          type="time"
                          value={newHoliday.open_time}
                          onChange={(e) =>
                            setNewHoliday({ ...newHoliday, open_time: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs font-bold"
                        />
                      </div>
                    )}
                    {(newHoliday.mode === 'early_close' || newHoliday.mode === 'custom') && (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.holidays_close_time_label')}
                        </label>
                        <input
                          type="time"
                          value={newHoliday.close_time}
                          onChange={(e) =>
                            setNewHoliday({ ...newHoliday, close_time: e.target.value })
                          }
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-xs font-bold"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="lg:col-span-1 flex gap-1.5">
                  <button
                    type="button"
                    disabled={savingHoliday || !newHoliday.event_date || !newHoliday.holiday_name.trim()}
                    onClick={() => void handleSaveHoliday()}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black whitespace-nowrap"
                  >
                    {editingHolidayId ? <Save size={14} /> : <Plus size={14} />}
                    {editingHolidayId
                      ? t('phone_agent.holidays_update_btn')
                      : t('phone_agent.holidays_add_btn')}
                  </button>
                  {editingHolidayId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHolidayId(null)
                        setNewHoliday({
                          store_id: '',
                          event_date: '',
                          holiday_name: '',
                          mode: 'closed',
                          open_time: '11:00',
                          close_time: '16:00'
                        })
                      }}
                      title={t('phone_agent.holidays_cancel_edit')}
                      className="px-2.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {specialHours.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {specialHours.map((sh) => {
                    const scopeLabel = sh.store_id
                      ? sh.stores?.name || `#${sh.store_id}`
                      : t('phone_agent.holidays_all_stores_badge')
                    const scheduleLabel = sh.is_closed
                      ? t('phone_agent.holidays_closed_badge')
                      : sh.open_time && sh.close_time
                        ? `${formatUiHhMm12h(sh.open_time)} - ${formatUiHhMm12h(sh.close_time)}`
                        : sh.close_time
                          ? `${t('phone_agent.holidays_regular_open_label')} → ${formatUiHhMm12h(sh.close_time)}`
                          : sh.open_time
                            ? `${formatUiHhMm12h(sh.open_time)} → ${t('phone_agent.holidays_regular_close_label')}`
                            : t('phone_agent.holidays_mode_custom')
                    const pillClass = sh.is_closed
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                      : sh.close_time && !sh.open_time
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                        : 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
                    return (
                      <div
                        key={sh.id}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${pillClass}`}
                      >
                        <span>
                          📅 {sh.event_date} • {sh.holiday_name} ({scopeLabel}): {scheduleLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleStartEditHoliday(sh)}
                          title={t('phone_agent.holidays_edit_btn')}
                          className="opacity-80 hover:opacity-100"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(deletingHolidayIds[sh.id])}
                          onClick={() => void handleDeleteHoliday(sh.id)}
                          title={t('phone_agent.kb_delete')}
                          className="text-rose-600 hover:text-rose-700 disabled:opacity-40"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2B: APRENDIZAJE CONTINUO DIARIO IA                            */}
        {/* ================================================================= */}
        {activeTab === 'learning' && (() => {
          const learningDoubts = learningItems.filter(
            (it) => it.status === 'needs_owner_input' && (isGlobalAdmin || it.storeId !== null)
          )
          const learningActive = learningItems.filter(
            (it) => it.status === 'approved' || it.status === 'auto_applied'
          )
          const renderLearningKindLabel = (kind: string) => {
            if (kind === 'doubt_for_owner') return t('phone_agent.learning_kind_doubt')
            if (kind === 'fast_reply_macro') return t('phone_agent.learning_kind_fast_macro')
            if (kind === 'stt_synonym') return t('phone_agent.learning_kind_stt')
            if (kind === 'audio_prewarm') return t('phone_agent.learning_kind_prewarm')
            if (kind === 'latency_insight') return t('phone_agent.learning_kind_latency')
            return t('phone_agent.learning_kind_rule')
          }
          const renderLearningScopeBadge = (storeId: number | null) => {
            if (storeId === null) {
              return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
                  {t('phone_agent.learning_scope_global')}
                </span>
              )
            }
            const storeObj = stores.find((s) => s.id === storeId)
            const label = storeObj
              ? `#${storeObj.id} ${storeObj.name}`
              : t('phone_agent.learning_scope_store', { id: storeId })
            return (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {label}
              </span>
            )
          }
          const renderLearningChannelBadge = (channel: PhoneLearningChannelScope) => {
            if (channel === 'phone_only') {
              return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {t('phone_agent.learning_channel_phone_only')}
                </span>
              )
            }
            if (channel === 'drive_thru_only') {
              return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                  {t('phone_agent.learning_channel_drive_thru_only')}
                </span>
              )
            }
            return (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                {t('phone_agent.learning_channel_both')}
              </span>
            )
          }
          const renderLearningDtSyncBadge = (
            item: PhoneLearningItemRow,
            activeChannel: PhoneLearningChannelScope
          ) => {
            if (!item.syncedDtItemId || activeChannel === 'phone_only') return null
            if (item.status === 'needs_owner_input') {
              return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-cyan-100 text-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-300">
                  {t('phone_agent.learning_linked_dt_doubt_badge')}
                </span>
              )
            }
            return (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300">
                {t('phone_agent.learning_synced_dt_badge')}
              </span>
            )
          }
          const renderLearningOriginDtBadge = (item: PhoneLearningItemRow) => {
            const src = item.sourceType.toLowerCase()
            if (src !== 'drive_thru' && src !== 'dt_kore_learning' && src !== 'kore_sim') return null
            return (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                {t('phone_agent.learning_src_dt_badge')}
              </span>
            )
          }

          return (
            <div className="space-y-5">
              {/* Header + Cron Daily Notice + Filter + Analyze Now */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-md shadow-orange-500/20 shrink-0">
                      <Sparkles className="text-white" size={22} />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-lg font-black text-slate-900 dark:text-white">
                        {t('phone_agent.learning_title')}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
                        {t('phone_agent.learning_subtitle')}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                          <Clock size={13} className="shrink-0" />
                          <span>{t('phone_agent.learning_cron_notice')}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 text-[11px] font-bold text-indigo-800 dark:text-indigo-300">
                          <Sparkles size={13} className="shrink-0" />
                          <span>{t('phone_agent.learning_bridge_notice')}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <select
                      value={learningStoreFilter}
                      disabled={!isGlobalAdmin && stores.length <= 1}
                      onChange={(e) => setLearningStoreFilter(e.target.value)}
                      className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-75"
                    >
                      {isGlobalAdmin && (
                        <option value="all">{t('phone_agent.learning_filter_all_stores')}</option>
                      )}
                      {stores.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          #{s.id} - {s.name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={learningAnalyzing}
                      onClick={() => void handleAnalyzeCallsNow()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs sm:text-sm font-black shadow-sm transition active:scale-95 disabled:opacity-60 cursor-pointer"
                    >
                      {learningAnalyzing ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Sparkles size={15} />
                      )}
                      <span>
                        {learningAnalyzing
                          ? t('phone_agent.learning_analyzing')
                          : t('phone_agent.learning_analyze_btn')}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={learningLoading}
                      onClick={() => void fetchPhoneLearning(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw size={14} className={learningLoading ? 'animate-spin' : ''} />
                      <span>{t('phone_agent.learning_refresh_btn')}</span>
                    </button>
                  </div>
                </div>

                {/* 4 Executive KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                  <div
                    className={`rounded-xl border p-3.5 ${
                      learningStats.pendingDoubts > 0
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
                    }`}
                  >
                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <HelpCircle size={13} />
                      <span>{t('phone_agent.learning_kpi_doubts')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-1">
                      {learningStats.pendingDoubts}
                    </p>
                  </div>

                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/25 p-3.5">
                    <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <BookOpen size={13} />
                      <span>{t('phone_agent.learning_kpi_rules')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
                      {learningStats.activeRules}
                    </p>
                  </div>

                  <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/25 p-3.5">
                    <p className="text-[11px] font-bold text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                      <Zap size={13} />
                      <span>{t('phone_agent.learning_kpi_prewarmed')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-sky-700 dark:text-sky-300 mt-1">
                      {learningStats.prewarmedClips}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3.5">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Gauge size={13} />
                      <span>{t('phone_agent.learning_kpi_analyzed')}</span>
                    </p>
                    <div className="flex items-baseline justify-between gap-2 mt-1">
                      <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">
                        {learningStats.analyzedCalls}
                      </p>
                      {learningStats.avgTurnLatencyMs !== null && (
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                          {t('phone_agent.learning_kpi_avg_latency', {
                            ms: learningStats.avgTurnLatencyMs
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {learningError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs sm:text-sm text-rose-700 dark:text-rose-300">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span className="flex-1 break-words">{learningError}</span>
                    <button
                      type="button"
                      onClick={() => setLearningError(null)}
                      className="shrink-0 hover:opacity-75 cursor-pointer"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>

              {learningLoading && learningItems.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-sm text-slate-500 flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-emerald-600" />
                  <span>{t('phone_agent.learning_loading')}</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* BANDEJA 1: DUDAS REALES (needs_owner_input) */}
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/15 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <HelpCircle size={18} className="text-amber-500 shrink-0" />
                          <span>{t('phone_agent.learning_doubts_title')}</span>
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t('phone_agent.learning_doubts_subtitle')}
                        </p>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 tabular-nums shrink-0">
                        {learningDoubts.length}
                      </span>
                    </div>

                    {learningDoubts.length === 0 ? (
                      <div className="bg-white/80 dark:bg-slate-900/70 rounded-xl border border-amber-100 dark:border-amber-900/40 p-5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                        {t('phone_agent.learning_doubts_empty')}
                      </div>
                    ) : (
                      <div className="space-y-3.5 max-h-[720px] overflow-y-auto pr-1">
                        {learningDoubts.map((item) => {
                          const isBusy = learningBusyId === item.id
                          const proposedDraft = isEn
                            ? item.proposedRuleEn || item.proposedRuleEs
                            : item.proposedRuleEs || item.proposedRuleEn
                          const primaryDoubtTitle = isEn
                            ? item.questionOrTriggerEn || item.questionOrTrigger
                            : item.questionOrTrigger
                          const primaryDoubtText = isEn
                            ? item.doubtForOwnerEn || item.doubtForOwner
                            : item.doubtForOwner || item.doubtForOwnerEn
                          const proposedRuleLines = buildPhoneBilingualLines(
                            item.proposedRuleEs,
                            item.proposedRuleEn,
                            isEn
                          )
                          const proposedFastLines = buildPhoneBilingualLines(
                            item.fastReplyEs,
                            item.fastReplyEn,
                            isEn
                          )
                          const fastExpanded = Boolean(learningExpandedFastIds[item.id])
                          const instructionVal = getLearningInstructionValue(item)
                          const fastEsVal = getLearningFastEsValue(item)
                          const fastEnVal = getLearningFastEnValue(item)
                          const applyGlobalVal = getLearningGlobalValue(item)
                          const channelVal = getLearningChannelsValue(item)

                          return (
                            <div
                              key={item.id}
                              className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm"
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300">
                                  {renderLearningKindLabel(item.itemKind)}
                                </span>
                                {renderLearningScopeBadge(item.storeId)}
                                {renderLearningChannelBadge(channelVal)}
                                {renderLearningDtSyncBadge(item, channelVal)}
                                {renderLearningOriginDtBadge(item)}
                                {item.evidenceCount > 1 && (
                                  <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 tabular-nums">
                                    {t('phone_agent.learning_evidence_count', {
                                      count: item.evidenceCount
                                    })}
                                  </span>
                                )}
                              </div>

                              <p className="text-sm font-black text-slate-900 dark:text-white break-words">
                                {primaryDoubtTitle}
                              </p>

                              {(item.customerQuote || item.koreQuote) && (
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60 p-3 space-y-1.5 text-xs">
                                  {item.customerQuote && (
                                    <p className="text-slate-800 dark:text-slate-200 break-words">
                                      <MessageSquareQuote
                                        size={13}
                                        className="inline mr-1 text-orange-500"
                                      />
                                      <strong className="font-bold">
                                        {t('phone_agent.learning_customer_quote')}
                                      </strong>{' '}
                                      “{item.customerQuote}”
                                    </p>
                                  )}
                                  {item.koreQuote && (
                                    <p className="text-slate-600 dark:text-slate-300 break-words">
                                      <strong className="font-bold">
                                        {t('phone_agent.learning_kore_quote')}
                                      </strong>{' '}
                                      “{item.koreQuote}”
                                    </p>
                                  )}
                                </div>
                              )}

                              {primaryDoubtText && (
                                <div className="rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3 py-2 text-xs text-amber-950 dark:text-amber-200 break-words">
                                  <strong className="font-black">
                                    {t('phone_agent.learning_doubt_label')}
                                  </strong>{' '}
                                  {primaryDoubtText}
                                </div>
                              )}

                              {proposedRuleLines.length > 0 && (
                                <div className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300">
                                  <div className="space-y-1 min-w-0">
                                    <p className="font-bold text-slate-700 dark:text-slate-200">
                                      {t('phone_agent.learning_proposed_hint')}
                                    </p>
                                    {proposedRuleLines.map((line, idx) => (
                                      <p
                                        key={line.code}
                                        className={idx === 0 ? 'text-xs text-slate-800 dark:text-slate-200 leading-relaxed break-words' : 'text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words'}
                                      >
                                        {line.flag} {line.text}
                                      </p>
                                    ))}
                                  </div>
                                  {proposedDraft && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        setLearningDraftInstruction((prev) => ({
                                          ...prev,
                                          [item.id]: proposedDraft
                                        }))
                                      }
                                      className="shrink-0 px-2 py-1 rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-[11px] font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
                                    >
                                      {t('phone_agent.learning_use_proposed_btn')}
                                    </button>
                                  )}
                                </div>
                              )}

                              {proposedFastLines.length > 0 && (
                                <div className="rounded-lg bg-sky-50/70 dark:bg-sky-950/30 px-2.5 py-1.5 space-y-1">
                                  <p className="text-[11px] font-bold text-sky-900 dark:text-sky-300">
                                    {t('phone_agent.learning_fast_reply_preview')}
                                  </p>
                                  {proposedFastLines.map((line, idx) => (
                                    <p
                                      key={line.code}
                                      className={idx === 0 ? 'text-[11px] text-sky-900 dark:text-sky-200 break-words' : 'text-[11px] text-sky-700 dark:text-sky-400 break-words'}
                                    >
                                      {line.flag} “{line.text}”
                                    </p>
                                  ))}
                                </div>
                              )}

                              <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                                  {t('phone_agent.learning_instruction_label')}
                                </label>
                                <textarea
                                  rows={2}
                                  value={instructionVal}
                                  disabled={isBusy}
                                  onChange={(e) =>
                                    setLearningDraftInstruction((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value
                                    }))
                                  }
                                  placeholder={t('phone_agent.learning_instruction_placeholder')}
                                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                              </div>

                              {/* Opción colapsable de respuesta rápida editable */}
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLearningExpandedFastIds((prev) => ({
                                      ...prev,
                                      [item.id]: !prev[item.id]
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                                >
                                  {fastExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                  <span>{t('phone_agent.learning_fast_reply_toggle')}</span>
                                </button>

                                {fastExpanded && (
                                  <div className="mt-2 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 p-3 space-y-2">
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                      {t('phone_agent.learning_fast_reply_placeholder')}
                                    </p>
                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                        {t('phone_agent.learning_fast_reply_es_label')}
                                      </label>
                                      <input
                                        type="text"
                                        maxLength={220}
                                        value={fastEsVal}
                                        disabled={isBusy}
                                        onChange={(e) =>
                                          setLearningDraftFastEs((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.value
                                          }))
                                        }
                                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                                        {t('phone_agent.learning_fast_reply_en_label')}
                                      </label>
                                      <input
                                        type="text"
                                        maxLength={220}
                                        value={fastEnVal}
                                        disabled={isBusy}
                                        onChange={(e) =>
                                          setLearningDraftFastEn((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.value
                                          }))
                                        }
                                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                  {t('phone_agent.learning_channel_label')}
                                </label>
                                <select
                                  value={channelVal}
                                  disabled={isBusy}
                                  onChange={(e) =>
                                    setLearningDraftChannels((prev) => ({
                                      ...prev,
                                      [item.id]: inferDefaultPhoneLearningChannels(
                                        e.target.value,
                                        item.category,
                                        ''
                                      )
                                    }))
                                  }
                                  className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                                >
                                  <option value="both">
                                    {t('phone_agent.learning_channel_both')}
                                  </option>
                                  <option value="phone_only">
                                    {t('phone_agent.learning_channel_phone_only')}
                                  </option>
                                  <option value="drive_thru_only">
                                    {t('phone_agent.learning_channel_drive_thru_only')}
                                  </option>
                                </select>
                              </div>

                              {isGlobalAdmin && (
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={applyGlobalVal}
                                    disabled={isBusy}
                                    onChange={(e) =>
                                      setLearningDraftGlobal((prev) => ({
                                        ...prev,
                                        [item.id]: e.target.checked
                                      }))
                                    }
                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                  />
                                  <span>{t('phone_agent.learning_apply_all_stores')}</span>
                                </label>
                              )}

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleAnswerLearningDoubt(item)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition disabled:opacity-50 cursor-pointer"
                                >
                                  {isBusy ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <CheckCircle2 size={14} />
                                  )}
                                  <span>
                                    {isBusy
                                      ? t('phone_agent.learning_saving')
                                      : t('phone_agent.learning_save_teach_btn')}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleDismissLearningItem(item.id)}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 disabled:opacity-50 cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                  <span>{t('phone_agent.learning_dismiss_btn')}</span>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* BANDEJA 2: REGLAS Y AUDIOS APRENDIDOS ACTIVOS (approved / auto_applied) */}
                  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/25 dark:bg-emerald-950/15 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                          <span>{t('phone_agent.learning_active_title')}</span>
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t('phone_agent.learning_active_subtitle')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLearningShowManualForm((v) => !v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer"
                      >
                        <Plus size={14} />
                        <span>
                          {learningShowManualForm
                            ? t('phone_agent.learning_cancel_btn')
                            : t('phone_agent.learning_add_manual_btn')}
                        </span>
                      </button>
                    </div>

                    {learningShowManualForm && (
                      <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                            {t('phone_agent.learning_manual_trigger_label')}
                          </label>
                          <input
                            type="text"
                            value={learningManualTrigger}
                            disabled={learningCreatingManual}
                            onChange={(e) => setLearningManualTrigger(e.target.value)}
                            placeholder={t('phone_agent.learning_manual_trigger_placeholder')}
                            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                            {t('phone_agent.learning_instruction_label')}
                          </label>
                          <textarea
                            rows={2}
                            value={learningManualInstruction}
                            disabled={learningCreatingManual}
                            onChange={(e) => setLearningManualInstruction(e.target.value)}
                            placeholder={t('phone_agent.learning_instruction_placeholder')}
                            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                              {t('phone_agent.learning_fast_reply_es_label')}
                            </label>
                            <input
                              type="text"
                              maxLength={220}
                              value={learningManualFastEs}
                              disabled={learningCreatingManual}
                              onChange={(e) => setLearningManualFastEs(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                              {t('phone_agent.learning_fast_reply_en_label')}
                            </label>
                            <input
                              type="text"
                              maxLength={220}
                              value={learningManualFastEn}
                              disabled={learningCreatingManual}
                              onChange={(e) => setLearningManualFastEn(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            {t('phone_agent.learning_channel_label')}
                          </label>
                          <select
                            value={learningManualChannels}
                            disabled={learningCreatingManual}
                            onChange={(e) =>
                              setLearningManualChannels(
                                inferDefaultPhoneLearningChannels(e.target.value, 'general', '')
                              )
                            }
                            className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer"
                          >
                            <option value="both">{t('phone_agent.learning_channel_both')}</option>
                            <option value="phone_only">
                              {t('phone_agent.learning_channel_phone_only')}
                            </option>
                            <option value="drive_thru_only">
                              {t('phone_agent.learning_channel_drive_thru_only')}
                            </option>
                          </select>
                        </div>
                        {isGlobalAdmin && (
                          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={learningManualGlobal}
                              disabled={learningCreatingManual}
                              onChange={(e) => setLearningManualGlobal(e.target.checked)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span>{t('phone_agent.learning_apply_all_stores')}</span>
                          </label>
                        )}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={learningCreatingManual}
                            onClick={() => void handleCreateManualLearnedRule()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition disabled:opacity-50 cursor-pointer"
                          >
                            {learningCreatingManual ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            <span>
                              {learningCreatingManual
                                ? t('phone_agent.learning_saving')
                                : t('phone_agent.learning_save_teach_btn')}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}

                    {learningActive.length === 0 ? (
                      <div className="bg-white/80 dark:bg-slate-900/70 rounded-xl border border-emerald-100 dark:border-emerald-900/40 p-5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                        {t('phone_agent.learning_active_empty')}
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
                        {learningActive.map((rule) => {
                          const isBusy = learningBusyId === rule.id
                          const primaryRuleTitle = isEn
                            ? rule.questionOrTriggerEn || rule.questionOrTrigger
                            : rule.questionOrTrigger
                          const activeRuleLines = buildPhoneBilingualLines(
                            rule.proposedRuleEs,
                            rule.proposedRuleEn,
                            isEn,
                            rule.ownerInstruction
                          )
                          const activeFastLines = buildPhoneBilingualLines(
                            rule.fastReplyEs,
                            rule.fastReplyEn,
                            isEn
                          )

                          return (
                            <div
                              key={rule.id}
                              className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-slate-900 p-3.5 space-y-1.5 shadow-sm"
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                      rule.status === 'auto_applied'
                                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    }`}
                                  >
                                    {rule.status === 'auto_applied'
                                      ? t('phone_agent.learning_status_auto')
                                      : t('phone_agent.learning_status_approved')}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    {renderLearningKindLabel(rule.itemKind)}
                                  </span>
                                  {renderLearningScopeBadge(rule.storeId)}
                                  {renderLearningChannelBadge(rule.appliesToChannels)}
                                  {renderLearningDtSyncBadge(rule, rule.appliesToChannels)}
                                  {renderLearningOriginDtBadge(rule)}
                                  {rule.audioPrewarmed && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                                      <Zap size={11} />
                                      {t('phone_agent.learning_audio_ready_badge')}
                                    </span>
                                  )}
                                </div>
                                {(isGlobalAdmin || rule.storeId !== null) && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleDismissLearningItem(rule.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50 cursor-pointer"
                                  >
                                    {isBusy ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Trash2 size={12} />
                                    )}
                                    <span>{t('phone_agent.learning_dismiss_btn')}</span>
                                  </button>
                                )}
                              </div>

                              <p className="text-xs font-black text-slate-800 dark:text-slate-200 break-words">
                                {primaryRuleTitle}
                              </p>
                              {activeRuleLines.length > 0 && (
                                <div className="space-y-1">
                                  {activeRuleLines.map((line, idx) => (
                                    <p
                                      key={line.code}
                                      className={idx === 0 ? 'text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed break-words' : 'text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words'}
                                    >
                                      {line.flag} {line.text}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {activeFastLines.length > 0 && (
                                <div className="rounded-lg bg-sky-50/70 dark:bg-sky-950/30 px-2.5 py-1.5 space-y-1">
                                  <p className="text-[11px] font-bold text-sky-900 dark:text-sky-300">
                                    {t('phone_agent.learning_fast_reply_preview')}
                                  </p>
                                  {activeFastLines.map((line, idx) => (
                                    <p
                                      key={line.code}
                                      className={idx === 0 ? 'text-[11px] text-sky-900 dark:text-sky-200 break-words' : 'text-[11px] text-sky-700 dark:text-sky-400 break-words'}
                                    >
                                      {line.flag} “{line.text}”
                                    </p>
                                  ))}
                                </div>
                              )}
                              {rule.resolvedByName && (
                                <p className="text-[11px] text-slate-400">
                                  {t('phone_agent.learning_resolved_by', {
                                    name: rule.resolvedByName
                                  })}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ================================================================= */}
        {/* TAB 3: 15 SUCURSALES & DESVÍO CONDICIONAL (SPECTRUM / AT&T)       */}
        {/* ================================================================= */}
        {activeTab === 'stores' && isGlobalAdmin && (
          <div className="space-y-4">
            {/* Twilio Connection & Global Webhook Setup */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldCheck size={17} className="text-emerald-600" />
                    {t('phone_agent.twilio_panel_title')}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{t('phone_agent.twilio_panel_desc')}</p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-black ${
                    twilioIntegration?.authTokenConfigured
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                  }`}
                >
                  {twilioIntegration?.authTokenConfigured
                    ? `✓ ${t('phone_agent.twilio_token_ready')}`
                    : `⚠️ ${t('phone_agent.twilio_token_missing')}`}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(() => {
                  const prodOrigin =
                    typeof window !== 'undefined' &&
                    window.location.protocol === 'https:' &&
                    /^tacosgavilan\.vercel\.app$/i.test(window.location.hostname)
                      ? window.location.origin
                      : 'https://tacosgavilan.vercel.app'
                  return [
                    {
                      label: t('phone_agent.twilio_webhook_incoming'),
                      url: `${prodOrigin}/api/phone/incoming`
                    },
                    {
                      label: t('phone_agent.twilio_webhook_status'),
                      url: `${prodOrigin}/api/phone/status`
                    }
                  ]
                })().map((wh) => (
                  <div
                    key={wh.url}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase text-slate-500">{wh.label}</div>
                      <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 truncate">
                        {wh.url}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(wh.url)}
                      className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                    >
                      {copiedCode === wh.url ? (
                        <Check size={14} className="text-emerald-600" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {stores.map((s) => {
                const isVerified = s.config.forwarding_status === 'verified'
                const isExpanded = expandedStoreId === s.id
                return (
                  <div
                    key={s.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-black text-slate-900 dark:text-white">
                            #{s.id} {s.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              s.config.carrier_type === 'spectrum_landline'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            }`}
                          >
                            {s.config.carrier_type === 'spectrum_landline'
                              ? t('phone_agent.stores_carrier_spectrum')
                              : t('phone_agent.stores_carrier_att')}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              isVerified
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {isVerified
                              ? `✓ ${t('phone_agent.stores_forwarding_verified')}`
                              : `⏳ ${t('phone_agent.stores_forwarding_pending')}`}
                          </span>
                          {dirtyStoreIds.includes(s.id) && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                              ● {t('phone_agent.stores_unsaved_badge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          📞 {s.phone} •{' '}
                          {s.has_drive_thru
                            ? `🚗 ${t('phone_agent.stores_drive_thru_short')}`
                            : `🍽️ ${t('phone_agent.stores_dine_in_short')}`}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={Boolean(savingStoreIds[s.id])}
                        onClick={() =>
                          void handleSaveStoreConfig(s, { is_enabled: !s.config.is_enabled }, true)
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-black shrink-0 disabled:opacity-50 ${
                          s.config.is_enabled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {s.config.is_enabled
                          ? t('phone_agent.stores_status_enabled')
                          : t('phone_agent.stores_status_disabled')}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_twilio_number')}
                        </label>
                        <input
                          type="text"
                          value={s.config.twilio_phone_number || ''}
                          onChange={(e) =>
                            updateLocalStoreConfig(s.id, 'twilio_phone_number', e.target.value)
                          }
                          placeholder={t('phone_agent.stores_twilio_placeholder')}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold"
                        />
                        {(() => {
                          const twVal = validateClientTwilioNumber(s.config.twilio_phone_number, {
                            storePhones: allStorePhoneStrings
                          })
                          if (!twVal.isEmpty && !twVal.valid) {
                            return (
                              <p className="mt-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 leading-tight">
                                ⚠️ {t('phone_agent.stores_inline_invalid_twilio')}
                              </p>
                            )
                          }
                          if (!twVal.valid) return null
                          const sharedCount = stores.filter((other) => {
                            if (other.id === s.id) return false
                            const otherVal = validateClientTwilioNumber(other.config.twilio_phone_number, {
                              storePhones: allStorePhoneStrings
                            })
                            return otherVal.valid && otherVal.tenDigits === twVal.tenDigits
                          }).length
                          if (sharedCount === 0) return null
                          return (
                            <p className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 leading-tight">
                              ⚠️ {t('phone_agent.pilot_shared_warning')}
                            </p>
                          )
                        })()}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_escalation_label')}
                        </label>
                        <div className="w-full rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-1.5 text-[11px] font-black text-emerald-800 dark:text-emerald-300 truncate">
                          {t('phone_agent.stores_escalation_pc_badge')}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_line_type')}
                        </label>
                        <select
                          value={s.config.carrier_type}
                          onChange={(e) =>
                            updateLocalStoreConfig(s.id, 'carrier_type', e.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                        >
                          <option value="spectrum_landline">
                            {t('phone_agent.stores_carrier_spectrum')}
                          </option>
                          <option value="att_wireless">
                            {t('phone_agent.stores_carrier_att')}
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_ring_timeout')}
                        </label>
                        <select
                          value={s.config.ring_timeout_seconds || 20}
                          onChange={(e) =>
                            updateLocalStoreConfig(
                              s.id,
                              'ring_timeout_seconds',
                              Number(e.target.value)
                            )
                          }
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                        >
                          <option value={5}>{t('phone_agent.stores_ring_5s')}</option>
                          <option value={10}>{t('phone_agent.stores_ring_10s')}</option>
                          <option value={15}>{t('phone_agent.stores_ring_15s')}</option>
                          <option value={20}>{t('phone_agent.stores_ring_20s')}</option>
                          <option value={25}>{t('phone_agent.stores_ring_25s')}</option>
                          <option value={30}>{t('phone_agent.stores_ring_30s')}</option>
                        </select>
                        {s.config.carrier_type === 'spectrum_landline' && (
                          <p className="mt-1 text-[10px] leading-tight text-blue-700 dark:text-blue-300">
                            {t('phone_agent.spectrum_fixed_ring_note')}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_voice_and_ebt')}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={s.config.voice_id || 'Kore'}
                            onChange={(e) =>
                              updateLocalStoreConfig(s.id, 'voice_id', e.target.value)
                            }
                            className="w-3/5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                          >
                            {CLIENT_VOICES.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              updateLocalStoreConfig(s.id, 'accepts_ebt', !s.config.accepts_ebt)
                            }
                            className={`w-2/5 py-1.5 rounded-xl text-[10px] font-black border ${
                              s.config.accepts_ebt
                                ? 'bg-amber-100 border-amber-300 text-amber-900'
                                : 'bg-slate-100 border-slate-300 text-slate-500'
                            }`}
                          >
                            {s.config.accepts_ebt
                              ? t('phone_agent.stores_ebt_yes')
                              : t('phone_agent.stores_ebt_no')}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_default_lang')}
                        </label>
                        <select
                          value={s.config.default_language || 'es'}
                          onChange={(e) =>
                            updateLocalStoreConfig(s.id, 'default_language', e.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                        >
                          <option value="es">{t('phone_agent.stores_lang_es')}</option>
                          <option value="en">{t('phone_agent.stores_lang_en')}</option>
                        </select>
                      </div>
                    </div>

                    {/* Collapsible Advanced Store Notes & Custom Greeting */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpandedStoreId(isExpanded ? null : s.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {t('phone_agent.stores_advanced_toggle')}
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200 dark:border-slate-700">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                              {t('phone_agent.stores_parking_es')}
                            </label>
                            <input
                              type="text"
                              value={s.config.parking_notes_es || ''}
                              onChange={(e) =>
                                updateLocalStoreConfig(s.id, 'parking_notes_es', e.target.value)
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                              {t('phone_agent.stores_parking_en')}
                            </label>
                            <input
                              type="text"
                              value={s.config.parking_notes_en || ''}
                              onChange={(e) =>
                                updateLocalStoreConfig(s.id, 'parking_notes_en', e.target.value)
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                              {t('phone_agent.stores_greeting_es')}
                            </label>
                            <textarea
                              rows={2}
                              value={s.config.custom_greeting_es || ''}
                              onChange={(e) =>
                                updateLocalStoreConfig(s.id, 'custom_greeting_es', e.target.value)
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
                              {t('phone_agent.stores_greeting_en')}
                            </label>
                            <textarea
                              rows={2}
                              value={s.config.custom_greeting_en || ''}
                              placeholder={t('phone_agent.stores_greeting_en_placeholder')}
                              onChange={(e) =>
                                updateLocalStoreConfig(s.id, 'custom_greeting_en', e.target.value)
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setSelectedStoreIdForForwarding(s.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200"
                      >
                        <Smartphone size={14} />
                        {t('phone_agent.stores_view_forwarding')}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSaveStoreConfig(s)}
                        disabled={Boolean(savingStoreIds[s.id])}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold"
                      >
                        <Save size={14} />
                        {savingStoreIds[s.id] ? '...' : t('phone_agent.stores_save_config')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Forwarding Instructions Modal (computed live from draft config) */}
            {selectedStoreForForwarding && liveForwardingGuide && (
              <div
                onClick={() => setSelectedStoreIdForForwarding(null)}
                className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] overflow-y-auto"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800">
                          {isEn
                            ? liveForwardingGuide.carrierLabelEn
                            : liveForwardingGuide.carrierLabelEs}
                        </span>
                        {selectedStoreForForwarding.config.carrier_type === 'att_wireless' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                            {t('phone_agent.stores_recommended_method_badge')}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                        #{selectedStoreForForwarding.id} {selectedStoreForForwarding.name} —{' '}
                        {t('phone_agent.stores_modal_title')}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedStoreIdForForwarding(null)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  {!canCopySelectedForwardingCodes && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>
                          {selectedTwilioValidation.isEmpty
                            ? t('phone_agent.stores_missing_twilio_warn')
                            : !selectedTwilioValidation.valid
                              ? t('phone_agent.stores_invalid_twilio_warn')
                              : t('phone_agent.stores_unsaved_forwarding_warn')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={selectedStoreForForwarding.config.twilio_phone_number || ''}
                          onChange={(e) =>
                            updateLocalStoreConfig(
                              selectedStoreForForwarding.id,
                              'twilio_phone_number',
                              e.target.value
                            )
                          }
                          placeholder={t('phone_agent.stores_twilio_placeholder')}
                          className="flex-1 rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveStoreConfig(selectedStoreForForwarding)}
                          disabled={
                            Boolean(savingStoreIds[selectedStoreForForwarding.id]) ||
                            !selectedTwilioValidation.valid
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black shrink-0"
                        >
                          {t('phone_agent.stores_save_config')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step by step list (en AT&T muestra primero el menú nativo Samsung/Android libre de error MMI) */}
                  <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-300 list-none bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5">
                    {(isEn ? liveForwardingGuide.stepsEn : liveForwardingGuide.stepsEs).map(
                      (step, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {step}
                        </li>
                      )
                    )}
                  </ol>

                  {selectedStoreForForwarding.config.carrier_type === 'att_wireless' && (
                    <div className="text-[11px] font-bold text-slate-500">
                      {t('phone_agent.stores_alt_codes_label')}
                    </div>
                  )}

                  {/* Quick Copy Codes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          {t('phone_agent.stores_code_no_answer')}
                        </div>
                        <div className="text-sm font-black font-mono text-emerald-600 truncate">
                          {isEn ? liveForwardingGuide.activateNoAnswerCodeEn : liveForwardingGuide.activateNoAnswerCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!canCopySelectedForwardingCodes}
                        onClick={() => {
                          if (!canCopySelectedForwardingCodes) return
                          copyToClipboard(
                            isEn ? liveForwardingGuide.activateNoAnswerCodeEn : liveForwardingGuide.activateNoAnswerCode
                          )
                        }}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedCode === (isEn ? liveForwardingGuide.activateNoAnswerCodeEn : liveForwardingGuide.activateNoAnswerCode) ? (
                          <Check size={14} className="text-emerald-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          {t('phone_agent.stores_code_busy')}
                        </div>
                        <div className="text-sm font-black font-mono text-blue-600 truncate">
                          {isEn ? liveForwardingGuide.activateBusyCodeEn : liveForwardingGuide.activateBusyCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!canCopySelectedForwardingCodes}
                        onClick={() => {
                          if (!canCopySelectedForwardingCodes) return
                          copyToClipboard(
                            isEn ? liveForwardingGuide.activateBusyCodeEn : liveForwardingGuide.activateBusyCode
                          )
                        }}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedCode === (isEn ? liveForwardingGuide.activateBusyCodeEn : liveForwardingGuide.activateBusyCode) ? (
                          <Check size={14} className="text-emerald-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>

                    {liveForwardingGuide.activateUnreachableCode && (
                      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase text-slate-500">
                            {t('phone_agent.stores_code_unreachable')}
                          </div>
                          <div className="text-sm font-black font-mono text-purple-600 truncate">
                            {isEn
                              ? liveForwardingGuide.activateUnreachableCodeEn || liveForwardingGuide.activateUnreachableCode
                              : liveForwardingGuide.activateUnreachableCode}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={!canCopySelectedForwardingCodes}
                          onClick={() => {
                            if (!canCopySelectedForwardingCodes) return
                            copyToClipboard(
                              isEn
                                ? liveForwardingGuide.activateUnreachableCodeEn || liveForwardingGuide.activateUnreachableCode!
                                : liveForwardingGuide.activateUnreachableCode!
                            )
                          }}
                          className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {copiedCode === (isEn ? liveForwardingGuide.activateUnreachableCodeEn || liveForwardingGuide.activateUnreachableCode : liveForwardingGuide.activateUnreachableCode) ? (
                            <Check size={14} className="text-emerald-600" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    )}

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        {t('phone_agent.stores_code_deactivate_all')}
                      </div>
                      {liveForwardingGuide.deactivateCodes && liveForwardingGuide.deactivateCodes.length > 0 ? (
                        <div className="space-y-1">
                          {selectedStoreForForwarding.config.carrier_type === 'spectrum_landline' && (
                            <div className="text-[10px] text-slate-500 leading-tight">
                              {t('phone_agent.stores_spectrum_deactivate_hint')}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {liveForwardingGuide.deactivateCodes.map((dc) => (
                              <button
                                key={dc}
                                type="button"
                                onClick={() => copyToClipboard(dc)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-black font-mono text-rose-600 hover:border-rose-400 transition"
                              >
                                {dc}
                                {copiedCode === dc ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-black font-mono text-rose-600 truncate">
                            {isEn ? liveForwardingGuide.deactivateAllCodeEn : liveForwardingGuide.deactivateAllCode}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(
                                isEn ? liveForwardingGuide.deactivateAllCodeEn : liveForwardingGuide.deactivateAllCode
                              )
                            }
                            className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                          >
                            {copiedCode === (isEn ? liveForwardingGuide.deactivateAllCodeEn : liveForwardingGuide.deactivateAllCode) ? (
                              <Check size={14} className="text-emerald-600" />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-300">
                    ⚠️ {isEn ? liveForwardingGuide.gotchaEn : liveForwardingGuide.gotchaEs}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    {selectedStoreForForwarding.config.forwarding_status === 'verified' && (
                      <button
                        type="button"
                        disabled={Boolean(savingStoreIds[selectedStoreForForwarding.id])}
                        onClick={async () => {
                          const ok = await handleSaveStoreConfig(
                            selectedStoreForForwarding,
                            { forwarding_status: 'pending' },
                            true
                          )
                          if (ok) setSelectedStoreIdForForwarding(null)
                        }}
                        className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-bold"
                      >
                        {t('phone_agent.stores_reset_pending')}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!canCopySelectedForwardingCodes || Boolean(savingStoreIds[selectedStoreForForwarding.id])}
                      onClick={async () => {
                        if (!canCopySelectedForwardingCodes) return
                        const ok = await handleSaveStoreConfig(selectedStoreForForwarding, {
                          forwarding_status: 'verified'
                        })
                        if (ok) setSelectedStoreIdForForwarding(null)
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black"
                    >
                      <CheckCircle2 size={15} />
                      {t('phone_agent.stores_mark_verified')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: BITÁCORA DE LLAMADAS & RECADOS PRIORITARIOS                */}
        {/* ================================================================= */}
        {activeTab === 'calls' && (
          <div className="space-y-6">
            {/* Store & Source Filters */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-slate-500">
                    {t('phone_agent.calls_filter_store')}
                  </span>
                  <select
                    value={callsFilterStoreId}
                    disabled={stores.length <= 1}
                    onChange={(e) => setCallsFilterStoreId(e.target.value)}
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold disabled:opacity-75"
                  >
                    {(isGlobalAdmin || stores.length > 1) && (
                      <option value="all">{t('phone_agent.calls_all_15_stores')}</option>
                    )}
                    {stores.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        #{s.id} - {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-slate-500">
                    {t('phone_agent.calls_filter_source')}
                  </span>
                  <select
                    value={callsFilterSource}
                    onChange={(e) =>
                      setCallsFilterSource(e.target.value as 'all' | 'twilio' | 'simulator')
                    }
                    className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold"
                  >
                    <option value="all">{t('phone_agent.calls_source_all')}</option>
                    <option value="twilio">{t('phone_agent.calls_source_twilio')}</option>
                    <option value="simulator">{t('phone_agent.calls_source_simulator')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Priority Callbacks Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Bell size={18} className="text-rose-600" />
                {t('phone_agent.callbacks_title')} (
                {callbacksPagination?.pendingTruncated
                  ? `${callbacks.filter((c) => c.status === 'pending').length}/${callbacksPagination.pendingTotal}`
                  : callbacks.filter((c) => c.status === 'pending').length}
                )
              </h3>

              {callbacksPagination?.criticalPendingTruncated ? (
                <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:text-rose-200">
                  {t('phone_agent.callbacks_critical_truncated_warning')
                    .replace('{shown}', String(callbacksPagination.criticalPendingReturned))
                    .replace('{total}', String(callbacksPagination.criticalPendingTotal))}
                </div>
              ) : callbacksPagination?.pendingTruncated ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 px-3.5 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-200">
                  {t('phone_agent.callbacks_pending_truncated_warning')
                    .replace('{shown}', String(callbacksPagination.pendingReturned))
                    .replace('{total}', String(callbacksPagination.pendingTotal))}
                </div>
              ) : null}

              {callbacks.length === 0 ? (
                <p className="text-xs text-slate-500">{t('phone_agent.callbacks_empty')}</p>
              ) : (
                (() => {
                  const managerCbList = callbacks.filter(
                    (c) => String(c.reason_category || '').toLowerCase() !== 'condiments_note'
                  )
                  const condimentCbList = callbacks.filter(
                    (c) => String(c.reason_category || '').toLowerCase() === 'condiments_note'
                  )
                  const renderCallbackCard = (cb: CallbackRow) => {
                    const isSimCb = cb.source === 'simulator'
                    const isCondimentNote = String(cb.reason_category || '').toLowerCase() === 'condiments_note'
                    const urgencyNorm = String(cb.urgency || 'normal').toLowerCase()
                    const reasonLabel = getReasonCategoryLabel(cb.reason_category)
                    const isCrossStore = Boolean(cb.origin_store_id && Number(cb.origin_store_id) !== Number(cb.store_id))
                    const originLabel = isCrossStore
                      ? formatCustomerStoreName(Number(cb.origin_store_id), isEn ? 'en' : 'es')
                      : ''
                    const cleanDigits = String(cb.caller_phone || '').replace(/\D/g, '')
                    const hasDialablePhone = cleanDigits.length >= 7
                    const isNoTicket = Boolean(
                      cb.ticket_or_order_number && /\bsin\s+ticket\b/i.test(cb.ticket_or_order_number)
                    )
                    const isRowBusy = Boolean(resolvingCallbackIds[cb.id])
                    return (
                      <div
                        key={cb.id}
                        className={`rounded-xl border p-4 space-y-2.5 ${
                          cb.status === 'pending'
                            ? isCondimentNote
                              ? 'bg-sky-50/80 dark:bg-sky-950/25 border-sky-300 dark:border-sky-800'
                              : isSimCb
                                ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
                                : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 opacity-75'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                  isCondimentNote
                                    ? 'bg-sky-700 text-white'
                                    : urgencyNorm === 'critical' || urgencyNorm === 'urgent'
                                      ? 'bg-rose-600 text-white'
                                      : urgencyNorm === 'high'
                                        ? 'bg-amber-600 text-white'
                                        : 'bg-slate-600 text-white'
                                }`}
                              >
                                {isCondimentNote
                                  ? `🌶️ ${cb.stores?.name || `#${cb.store_id}`} • ${reasonLabel || getCallerTypeLabel(cb.caller_type)}`
                                  : `${cb.stores?.name || `#${cb.store_id}`} • ${getCallerTypeLabel(cb.caller_type)} • ${getUrgencyLabel(cb.urgency)}${reasonLabel ? ` • ${reasonLabel}` : ''}`}
                              </span>
                              {isCrossStore && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-100 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100">
                                  ↪️ {t('phone_agent.banner_routed_from_prefix')} #{cb.origin_store_id}
                                  {originLabel ? ` ${originLabel}` : ''}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                  isSimCb
                                    ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                                    : 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'
                                }`}
                              >
                                {isSimCb
                                  ? t('phone_agent.calls_badge_simulator')
                                  : t('phone_agent.calls_badge_twilio')}
                              </span>
                            </div>
                            <div className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                              <span>{cb.caller_name} — 📞</span>
                              {cb.caller_phone ? (
                                hasDialablePhone ? (
                                  <>
                                    <a
                                      href={`tel:${cb.caller_phone.replace(/[^+\d]/g, '')}`}
                                      className="text-emerald-700 dark:text-emerald-400 hover:underline"
                                    >
                                      {cb.caller_phone}
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => copyCallbackPhone(cb.id, cb.caller_phone)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-[10px] font-bold text-slate-700 dark:text-slate-200 transition"
                                    >
                                      {copiedCbPhoneId === cb.id ? <Check size={10} /> : <Copy size={10} />}
                                      {copiedCbPhoneId === cb.id
                                        ? t('phone_agent.banner_copied_phone')
                                        : t('phone_agent.banner_copy_phone')}
                                    </button>
                                  </>
                                ) : (
                                  <span className="font-semibold text-slate-600 dark:text-slate-300">{cb.caller_phone}</span>
                                )
                              ) : (
                                '—'
                              )}
                            </div>
                          </div>

                          {cb.status === 'resolved' && (
                            <span className="text-xs font-bold text-emerald-600 shrink-0">
                              ✅ {t('phone_agent.callbacks_resolved_badge')}
                            </span>
                          )}
                          {cb.status === 'dismissed' && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 shrink-0">
                              {t('phone_agent.callbacks_dismissed_badge')}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium break-words">
                          {cb.reason_summary}
                        </p>

                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-slate-500">
                          <span>{formatStoreDateTime(cb.created_at, isEn)}</span>
                          {cb.ticket_or_order_number && (
                            <span
                              className={`px-2 py-0.5 rounded-md font-black ${
                                isNoTicket
                                  ? 'bg-amber-200 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100'
                                  : 'bg-slate-200/80 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
                              }`}
                            >
                              {t('phone_agent.banner_ticket_prefix')} {cb.ticket_or_order_number}
                            </span>
                          )}
                        </div>

                        {cb.status === 'pending' ? (
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1">
                            <input
                              type="text"
                              value={callbackNotes[cb.id] || ''}
                              onChange={(e) =>
                                setCallbackNotes((prev) => ({
                                  ...prev,
                                  [cb.id]: e.target.value.slice(0, 250)
                                }))
                              }
                              placeholder={t('phone_agent.callbacks_resolution_note_placeholder')}
                              className="flex-1 min-w-[140px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => void handleUpdateCallbackStatus(cb, 'resolved')}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg disabled:opacity-50 text-white text-xs font-black shrink-0 ${
                                isCondimentNote
                                  ? 'bg-sky-700 hover:bg-sky-800'
                                  : 'bg-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              <CheckCircle2 size={13} />
                              {isCondimentNote
                                ? t('phone_agent.banner_condiments_mark_done')
                                : t('phone_agent.callbacks_mark_resolved')}
                            </button>
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => void handleUpdateCallbackStatus(cb, 'dismissed')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-bold shrink-0"
                            >
                              <X size={12} />
                              {t('phone_agent.callbacks_dismiss_btn')}
                            </button>
                          </div>
                        ) : (
                          <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-[11px] text-slate-500 space-y-0.5 min-w-0">
                              {cb.resolved_by && (
                                <div>
                                  <span className="font-bold">
                                    {t('phone_agent.callbacks_resolved_by')}
                                  </span>{' '}
                                  {cb.resolved_by}
                                  {cb.resolved_at
                                    ? ` (${formatStoreDateTime(cb.resolved_at, isEn)})`
                                    : ''}
                                </div>
                              )}
                              {cb.resolution_notes && (
                                <div className="italic">“{cb.resolution_notes}”</div>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => void handleUpdateCallbackStatus(cb, 'pending')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-[11px] font-bold text-slate-700 dark:text-slate-200 shrink-0"
                            >
                              <RotateCcw size={11} />
                              {t('phone_agent.callbacks_reopen_btn')}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div className="space-y-5">
                      {managerCbList.length > 0 && (
                        <div className="space-y-2.5">
                          {condimentCbList.length > 0 && (
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-rose-700 dark:text-rose-300">
                              <Bell size={14} />
                              {t('phone_agent.callbacks_manager_section_title')} (
                              {managerCbList.filter((c) => c.status === 'pending').length})
                            </div>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {managerCbList.map(renderCallbackCard)}
                          </div>
                        </div>
                      )}
                      {condimentCbList.length > 0 && (
                        <div className="space-y-2.5 pt-2 border-t border-sky-200/80 dark:border-sky-900/60">
                          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">
                            <ShoppingBag size={14} />
                            🌶️ {t('phone_agent.callbacks_condiments_section_title')} (
                            {condimentCbList.filter((c) => c.status === 'pending').length})
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {condimentCbList.map(renderCallbackCard)}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>

            {/* Call Logs Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {t('phone_agent.calls_history_title')} ({calls.length})
              </h3>

              {calls.length === 0 ? (
                <p className="text-xs text-slate-500">{t('phone_agent.calls_empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_time')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_store')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_caller')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_source')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_duration')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_intent')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_summary')}</th>
                        <th className="py-2.5 px-3">{t('phone_agent.calls_col_outcome')}</th>
                        <th className="py-2.5 px-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {calls.map((c) => {
                        const isSim = c.source === 'simulator'
                        const renderOutcomeBadge = () => {
                          if (c.status === 'in_progress') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-sky-100 text-sky-800">
                                {t('phone_agent.calls_outcome_in_progress')}
                              </span>
                            )
                          }
                          if (c.status === 'transferred') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800">
                                {t('phone_agent.calls_outcome_transferred')}
                              </span>
                            )
                          }
                          if (c.status === 'callback_requested') {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                                {t('phone_agent.calls_outcome_callback')}
                              </span>
                            )
                          }
                          if ((c.turns_count || 0) === 0) {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700">
                                {t('phone_agent.calls_outcome_abandoned')}
                              </span>
                            )
                          }
                          if (c.resolved_by_ai) {
                            return (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                                {t('phone_agent.calls_outcome_resolved_ai')}
                              </span>
                            )
                          }
                          return (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700">
                              {t('phone_agent.calls_outcome_incomplete')}
                            </span>
                          )
                        }

                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 whitespace-nowrap font-medium">
                              {formatStoreDateTime(c.started_at, isEn)}
                            </td>
                            <td className="py-2.5 px-3 font-bold whitespace-nowrap">
                              {c.stores?.name || `#${c.store_id}`}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {c.caller_name && (
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span
                                    title={c.caller_name}
                                    className="font-bold text-xs text-slate-900 dark:text-white max-w-[160px] truncate"
                                  >
                                    {c.caller_name}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${getCallerSourceMeta(c.caller_name_source).cls}`}
                                  >
                                    {getCallerSourceMeta(c.caller_name_source).label}
                                  </span>
                                </div>
                              )}
                              <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {!isSimulatorPlaceholderCaller(c.caller_number)
                                  ? c.caller_number
                                  : isSim
                                    ? t('phone_agent.calls_unknown_caller')
                                    : t('phone_agent.calls_anonymous_caller')}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                                  isSim
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                                }`}
                              >
                                {isSim
                                  ? t('phone_agent.calls_badge_simulator')
                                  : t('phone_agent.calls_badge_twilio')}{' '}
                                ({String(c.language || 'es').toUpperCase()})
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                              {c.duration_seconds || 0}s • {c.turns_count || 0}{' '}
                              {t('phone_agent.calls_turns_short')}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">
                              {getIntentLabel(c.primary_intent)}
                            </td>
                            <td
                              title={c.summary || undefined}
                              className="py-2.5 px-3 max-w-xs truncate text-slate-600 dark:text-slate-400"
                            >
                              {c.summary || '—'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {renderOutcomeBadge()}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCallId(c.id)
                                  setSelectedCallFallback(c)
                                }}
                                className="text-emerald-600 font-bold hover:underline"
                              >
                                {t('phone_agent.calls_view_transcript')}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Call Transcript Modal with Voice Replay (live-refreshed via selectedCallId) */}
            {selectedCallDetail && (
              <div
                onClick={() => {
                  stopTranscriptReplay()
                  setSelectedCallId(null)
                  setSelectedCallFallback(null)
                }}
                className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-base font-black text-slate-900 dark:text-white">
                        {selectedCallDetail.stores?.name || `#${selectedCallDetail.store_id}`} —{' '}
                        {formatStoreDateTime(selectedCallDetail.started_at, isEn)}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5 break-all">
                        {selectedCallDetail.caller_name && (
                          <>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {t('phone_agent.calls_modal_caller_name')} {selectedCallDetail.caller_name}
                            </span>{' '}
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase align-middle ${getCallerSourceMeta(selectedCallDetail.caller_name_source).cls}`}
                            >
                              {getCallerSourceMeta(selectedCallDetail.caller_name_source).label}
                            </span>{' '}
                            •{' '}
                          </>
                        )}
                        {t('phone_agent.calls_modal_caller')}{' '}
                        {!isSimulatorPlaceholderCaller(selectedCallDetail.caller_number)
                          ? selectedCallDetail.caller_number
                          : selectedCallDetail.source === 'simulator'
                            ? t('phone_agent.calls_unknown_caller')
                            : t('phone_agent.calls_anonymous_caller')}{' '}
                        • {t('phone_agent.calls_modal_duration')}{' '}
                        {selectedCallDetail.duration_seconds || 0}s (
                        {selectedCallDetail.turns_count || 0} {t('phone_agent.calls_turns_short')}) •
                        SID: {selectedCallDetail.call_sid || '—'}
                      </p>
                      {selectedCallDetail.summary && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 bg-slate-50 dark:bg-slate-800/70 rounded-lg px-2.5 py-1.5">
                          <span className="font-bold">{t('phone_agent.calls_modal_summary')}</span>{' '}
                          {selectedCallDetail.summary}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        stopTranscriptReplay()
                        setSelectedCallId(null)
                        setSelectedCallFallback(null)
                      }}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {(() => {
                      const validTranscript = (
                        Array.isArray(selectedCallDetail.transcript) ? selectedCallDetail.transcript : []
                      ).filter((item): item is NonNullable<typeof item> => Boolean(item && typeof item === 'object'))
                      if (validTranscript.length === 0) {
                        return (
                          <p className="text-xs text-slate-500 text-center py-6">
                            {t('phone_agent.calls_transcript_empty')}
                          </p>
                        )
                      }
                      return validTranscript.map((tItem, idx) => {
                        const roleLabel =
                          tItem.role === 'user'
                            ? t('phone_agent.calls_role_user')
                            : tItem.role === 'tool'
                              ? tItem.toolName
                                ? `${t('phone_agent.calls_role_tool')} (${tItem.toolName})`
                                : t('phone_agent.calls_role_tool')
                              : t('phone_agent.calls_role_assistant')
                        const isThisPlaying = replayingMsgIdx === idx
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl text-xs ${
                              tItem.role === 'user'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800'
                                : tItem.role === 'tool'
                                  ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 font-mono text-[11px]'
                                  : 'bg-slate-100 dark:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-black uppercase text-[10px] opacity-75">
                                {roleLabel}
                              </span>
                              {tItem.role === 'assistant' && tItem.text && (
                                <button
                                  type="button"
                                  disabled={replayingMsgIdx !== null && !isThisPlaying}
                                  onClick={() =>
                                    void handleReplayTranscriptTurn(
                                      tItem.text,
                                      selectedCallDetail.language,
                                      selectedCallDetail.store_id,
                                      idx
                                    )
                                  }
                                  className={`inline-flex items-center gap-1 text-[11px] font-bold hover:underline disabled:opacity-40 ${
                                    isThisPlaying
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  {isThisPlaying ? <VolumeX size={12} /> : <Volume2 size={12} />}
                                  {isThisPlaying
                                    ? t('phone_agent.calls_modal_stop_tts')
                                    : t('phone_agent.calls_modal_play_tts')}
                                </button>
                              )}
                            </div>
                            <div className="leading-relaxed whitespace-pre-wrap break-words">{tItem.text}</div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
