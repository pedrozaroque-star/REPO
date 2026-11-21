/**
 * @module lib/drive-thru-kore-learning
 * @description Motor de Aprendizaje Continuo Bidireccional (Continuous Learning) entre el asistente de voz
 * "Kore Drive-Thru" (`dt_kore_learning_items` + `dt_kore_sim_sessions`) y la Contestadora IA Telefónica
 * (`/admin/llamadas` -> `phone_knowledge_base` + `phone_calls`) de Tacos Gavilan:
 *   1) Analiza simulaciones de `dt_kore_sim_sessions` (`analyzed_at IS NULL`, priorizando intervenciones humanas en
 *      headset `A1` donde `transcript` contiene `role === 'cashier'` o `order_json.cashierIntervention?.triggered === true`)
 *      y llamadas terminadas de `phone_calls`
 *      (`kore_analyzed_at IS NULL`, `turns_count > 0`, `unanswered_question` + `transcript` JSONB) para detectar
 *      errores conversacionales, dudas sin respuesta, resoluciones reales de cajeras y colisiones fonéticas de STT.
 *   2) Sincroniza en tiempo real (`syncLearningItemToPhoneKnowledgeBase`) toda duda o regla con
 *      `applies_to_channels IN ('both', 'phone_only')` hacia `public.phone_knowledge_base` y `public.phone_learning_items`
 *      (incluyendo generación de `fast_reply_es/en` `<= 220` chars, `trigger_keywords` y pre-calentamiento WAV `Kore 3.8`
 *      al aprobarse), invalidando al instante `invalidatePhoneLearnedRulesCache` + `invalidateStorePhoneContextCache`.
 *   3) Sincroniza en sentido inverso (`syncPhoneKbMutationBackToLearning`) cualquier edición, desactivación o borrado
 *      hecho en `/admin/llamadas -> Base de Conocimiento` de vuelta hacia `public.dt_kore_learning_items` e invalida
 *      `invalidateKoreKnowledgeCache` para mantener un espejo bidireccional 100% real.
 *
 * @businessRules
 * - **Idempotencia estricta**:
 *   * `dt_kore_sim_sessions` se marca con `analyzed_at` y `phone_calls` se marca con `kore_analyzed_at` tras escanearse
 *     una sola vez; las preguntas idénticas entre llamadas distintas (`phone_calls.id`) comparten huella normalizada
 *     `phone_q:<hash>` e incrementan `evidence_count` únicamente entre llamadas diferentes (jamás re-contando la misma).
 *   * Si una misma duda aparece en más de una sucursal, se promueve automáticamente a global (`store_id = null`).
 * - **Canales de aplicación (`applies_to_channels`)**:
 *   * `'both'` (por defecto): activa en Drive-Thru (`loadActiveKoreLearnedRules`) y en Llamadas (`phone_knowledge_base`).
 *   * `'drive_thru_only'`: activa solo en Drive-Thru; si tenía `synced_kb_id`, desactiva (`is_active = false`) en Llamadas.
 *   * `'phone_only'`: activa solo en Llamadas (`phone_knowledge_base`); excluida de Drive-Thru.
 * - **Inmutabilidad de sesiones y llamadas**: jamás altera el `transcript` u `order_json` de sesiones o llamadas reales;
 *   solo limpia `phone_calls.unanswered_question = null` cuando el dueño aprueba su regla oficial.
 * - **Marca y moneda**: toda regla generada respeta estrictamente `"Tacos Gavilan"` y dólares `USD` (jamás `"pesos"`).
 * - **Reglas globales dependientes de ciudad o capacidad de tienda (`EBT CalFresh` / `Drive-Thru` / `Ventana 2`)**:
 *   cuando `store_id === null` y la regla depende de la ciudad (`accepts_ebt`: Rialto #1 y Santa Ana #9 NO aceptan EBT;
 *   13 sucursales del Condado de LA SÍ aceptan EBT en comedor) o de si la sucursal tiene Drive-Thru (`has_drive_thru`),
 *   se sincroniza en `phone_learning_items` como `item_kind = 'learned_rule'` con `fast_reply_es = null` y
 *   `fast_reply_en = null` para que `matchLearnedPhoneFastReply` no intercepte con un macro único de una sola tienda y
 *   permita que `resolveCanonicalPreparedReply` (`case 'payments_ebt'`) o Gemini respondan exactamente según la ciudad.
 *
 * @dataFlow
 * - `POST/PATCH /api/drive-thru/kore/learning` <-> `syncLearningItemToPhoneKnowledgeBase` <-> `public.phone_knowledge_base`
 *   -> `invalidateStorePhoneContextCache()` + `invalidateKoreKnowledgeCache()`.
 * - `POST/PATCH/DELETE /api/phone/dashboard` (`entity === 'knowledge_base'`) -> `syncPhoneKbMutationBackToLearning`
 *   -> `public.dt_kore_learning_items` + `invalidateKoreKnowledgeCache()`.
 * - `GET /api/cron/learn-kore-drive-thru` / `POST analyze_now` -> `analyzeUnprocessedKoreSessions()`.
 *
 * @notes
 * - En `DELETE /api/phone/dashboard?entity=knowledge_base`, consultar primero `findLearningItemIdsBySyncedKbId(id)` antes
 *   del `DELETE` porque la FK `synced_kb_id` tiene `ON DELETE SET NULL`.
 * - Proyecto exclusivo de base de datos: `teg-tacos-gavilan` (`ywwwdcvgfculqmcfkihq`).
 * - Auditoría Aprendizaje Continuo 2026-11-19: usa `generateGeminiLearningJson` con rotación multi-llave/multi-modelo
 *   (evita fallo 429 en `keys[0]`) y amplía detector de fricciones/repeticiones telefónicas (`me pregunta fue...`).
 * - Calibración Anti-TV / YouTube y Turnos Mixtos 2026-11-21 (sesión `9026505b`): `insight:vad_bg_noise` usa
 *   `isLikelyBackgroundMediaSpeech` + `extractDirectCustomerIntentFromNoisyTurn` y documenta el `KoreNoiseGate` adaptativo
 *   de campo cercano + extracción directa de voz del cliente / respuesta a `"¿Me escuchas?"` sin repetir `"ruido de fondo"`.
 * - Calibración Fase 21 (`2026-11-21`, sesión `99d29f93`): agrega detectores deterministas `rule:kore_drive_thru_manager_window`
 *   (prohibido pedir teléfono de 10 dígitos en Drive-Thru al pedir hablar con el manager), `rule:kore_super_mulita_addon_math`
 *   (aritmética exacta `Mulita Regular + Guacamole` vs `Super Mulita`) y `rule:kore_no_cancel_on_olvidalo` (bloqueo de `cancel_order`
 *   ante `"Olvídalo entonces."`).
 */

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizeCustomerStoreReferencesInText } from '@/lib/customer-store-names'
import { generateGeminiLearningJson } from '@/lib/order-ready-tts'
import { invalidateStorePhoneContextCache } from '@/lib/phone-agent'
import { invalidateKoreKnowledgeCache } from '@/lib/drive-thru-kore'
import {
  extractDirectCustomerIntentFromNoisyTurn,
  isExplicitWholeOrderCancelIntent,
  isLikelyBackgroundMediaSpeech
} from '@/lib/kore-shared-speech'

export type KoreLearningItemKind = 'doubt_for_owner' | 'learned_rule' | 'synonym_fix' | 'latency_insight'
export type KoreLearningItemStatus = 'needs_owner_input' | 'auto_applied' | 'approved' | 'dismissed'
export type KoreAppliesToChannels = 'both' | 'drive_thru_only' | 'phone_only'
export type PhoneKbCategory = 'menu' | 'delivery' | 'policies' | 'payments' | 'hours' | 'catering' | 'general'
export type KoreLearningSourceType =
  | 'auto_analysis'
  | 'cron_daily'
  | 'manual_owner'
  | 'dt_simulation'
  | 'phone_call'
  | 'manual'
  | 'cron_audit'

export interface KoreLearningItemDto {
  id: string
  storeId: number | null
  sourceSessionId: string | null
  sourceType: string
  itemKind: KoreLearningItemKind
  status: KoreLearningItemStatus
  questionOrTrigger: string
  customerQuote: string | null
  koreQuote: string | null
  proposedRuleEs: string | null
  proposedRuleEn: string | null
  ownerInstruction: string | null
  evidenceCount: number
  avgLatencyMs: number | null
  resolvedByName: string | null
  resolvedAt: string | null
  createdAt: string
  appliesToChannels: KoreAppliesToChannels
  syncedKbId: string | null
  syncedPhoneItemId: string | null
  sourcePhoneCallId: string | null
}

export interface KoreLearningStats {
  pendingDoubts: number
  activeRules: number
  analyzedSessions: number
  avgLatencyMs: number | null
  syncedToPhoneCount: number
}

export interface ActiveKoreLearnedRule {
  id: string
  storeId: number | null
  itemKind: KoreLearningItemKind
  trigger: string
  ruleEs: string
  ruleEn: string
  appliesToChannels: KoreAppliesToChannels
  syncedKbId: string | null
}

interface CandidateFinding {
  storeId: number | null
  sourceSessionId: string | null
  sourcePhoneCallId?: string | null
  dedupeKey: string
  sourceType: KoreLearningSourceType
  itemKind: KoreLearningItemKind
  status: KoreLearningItemStatus
  appliesToChannels?: KoreAppliesToChannels
  questionOrTrigger: string
  customerQuote?: string | null
  koreQuote?: string | null
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
  avgLatencyMs?: number | null
}

export const SELECT_LEARNING_COLS =
  'id, store_id, source_session_id, source_phone_call_id, synced_kb_id, synced_phone_item_id, applies_to_channels, dedupe_key, source_type, item_kind, status, question_or_trigger, customer_quote, kore_quote, proposed_rule_es, proposed_rule_en, owner_instruction, evidence_count, avg_latency_ms, resolved_by, resolved_by_name, resolved_at, created_at, updated_at'

const GEMINI_REST_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'] as const
const ACTIVE_RULES_TTL_MS = 15_000
const activeRulesCache = new Map<string, { rules: ActiveKoreLearnedRule[]; fetchedAt: number }>()

const KEYWORD_STOPWORDS = new Set([
  'para', 'como', 'cuando', 'donde', 'cual', 'cuales', 'quien', 'porque', 'pero', 'sino', 'este', 'esta',
  'estos', 'estas', 'unos', 'unas', 'todo', 'toda', 'todos', 'todas', 'tienen', 'tiene', 'hay', 'puedo',
  'puede', 'pueden', 'quiero', 'quiere', 'decir', 'pregunta', 'respuesta', 'llamada', 'telefonica',
  'tacos', 'gavilan', 'sucursal', 'tienda', 'cliente', 'favor', 'gracias', 'hola', 'buenas', 'buenos',
  'when', 'what', 'where', 'which', 'with', 'from', 'that', 'this', 'have', 'does', 'they', 'want',
  'customer', 'asks', 'about', 'store', 'only', 'both'
])

export function isValidAppliesToChannels(value: unknown): value is KoreAppliesToChannels {
  return value === 'both' || value === 'drive_thru_only' || value === 'phone_only'
}

export function invalidateKoreLearnedRulesCache() {
  activeRulesCache.clear()
}

function sanitizeRuleText(raw: unknown, maxLen = 420, lang: 'es' | 'en' = 'es'): string {
  const base = String(raw ?? '')
    .replace(/\u0000/g, '')
    .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
    .replace(/\bTacos\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
    .replace(/\bMXN\b/gi, 'USD')
    .replace(/\bpesos?\b/gi, lang === 'en' ? 'USD dollars' : 'dólares USD')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitizeCustomerStoreReferencesInText(base, lang).replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

/**
 * Clasificador inteligente de alcance de canal (`'both' | 'phone_only' | 'drive_thru_only'`) compartido con Teléfono.
 */
export function inferAppliesToChannels(
  input:
    | string
    | {
        questionOrTrigger?: string | null
        proposedRuleEs?: string | null
        proposedRuleEn?: string | null
        ownerInstruction?: string | null
        customerQuote?: string | null
        dedupeKey?: string | null
        category?: string | null
        itemKind?: string | null
      }
): KoreAppliesToChannels {
  const meta = typeof input === 'string' ? { questionOrTrigger: input } : input || {}
  const kind = String(meta.itemKind || '').trim()
  const dedupe = String(meta.dedupeKey || '').trim().toLowerCase()
  if (kind === 'audio_prewarm' || dedupe.startsWith('prewarm:')) return 'phone_only'
  if (kind === 'latency_insight') {
    if (dedupe.startsWith('insight:vad_bg_noise')) return 'drive_thru_only'
    if (dedupe.startsWith('latency:')) return 'phone_only'
  }
  if (
    dedupe === 'doubt:general_manager_request_without_order_issue' ||
    dedupe === 'phone_friction:manager_request_without_wrong_order_ticket_gate'
  ) {
    return 'phone_only'
  }
  if (dedupe === 'rule:kore_drive_thru_manager_window' || dedupe === 'rule:kore_no_cancel_on_olvidalo') {
    return 'drive_thru_only'
  }

  const combined = [
    meta.questionOrTrigger,
    meta.ownerInstruction,
    meta.proposedRuleEs,
    meta.proposedRuleEn,
    meta.customerQuote
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!combined) return 'both'
  if (
    /\b(?:tanto\s+en\s+telefono\s+como\s+en\s+drive|telefono\s+y\s+drive\s+thru|drive\s+thru\s+y\s+telefono|both\s+phone\s+and\s+drive)\b/.test(
      combined
    )
  ) {
    return 'both'
  }

  if (
    /\b(?:confirm\s+order|add\s+item|modify\s+item|remove\s+item|set\s+fulfillment|register_driver_pickup|end_session)\b/.test(
      combined
    ) ||
    /\b(?:pantalla\s+del\s+altavoz|carrito\s+del\s+altavoz|speaker\s+screen|push\s+to\s+talk|start\s+sensitivity\s+low|noise\s+gate|blindaje\s+delivery)\b/.test(
      combined
    ) ||
    /\b(?:pregunta(?:r)?\s+(?:siempre\s+)?corto\s+.{0,16}(?:regular\s+o\s+super|que\s+carne)|ask\s+(?:briefly|shortly)\s+.{0,16}regular\s+or\s+super)\b/.test(
      combined
    ) ||
    /\b(?:envia(?:lo|la|r)?\s+(?:siempre\s+)?a\s+(?:la\s+)?ventana\s+2|pasa\s+a\s+(?:la\s+)?ventana\s+2\s+por\s+(?:tu|su)\s+orden|send\s+(?:the\s+)?driver\s+to\s+window\s+2)\b/.test(
      combined
    ) ||
    /\b(?:pasar|pase|avanza|avance)\s+a\s+(?:la\s+)?(?:siguiente\s+|primera\s+|segunda\s+)?ventanilla\s+para\s+pagar\s+(?:su|tu|la)\s+orden\s+activa\b/.test(
      combined
    ) ||
    /\bpagar\s+(?:su|tu)\s+orden\s+activa\b/.test(combined)
  ) {
    return 'drive_thru_only'
  }

  if (
    /\bno\s+(?:tomamos|levantamos|aceptamos|hacemos|recibimos)\s+(?:ordenes|pedidos)\s+por\s+telefono\b/.test(combined) ||
    /\bdo\s+not\s+take\s+(?:orders\s+over\s+the\s+phone|phone\s+orders)\b/.test(combined) ||
    /\b(?:recados?|alerta\s+prioritaria\s+al\s+gerente|devolver\s+la\s+llamada|regresar\s+la\s+llamada|callback\s+request)\b/.test(
      combined
    ) ||
    /\b(?:desvio\s+condicional|spectrum\s+landline|att\s+wireless|at\s+t\s+wireless|forwardedfrom|ring\s+timeout|numero\s+twilio)\b/.test(
      combined
    ) ||
    /\b(?:colgar\s+(?:la\s+)?llamada|terminar\s+(?:la\s+)?llamada|hang\s+up\s+the\s+call)\b/.test(combined) ||
    (/\bhablar\s+con\s+el\s+(?:manager|gerente)\b/.test(combined) &&
      /\b(?:ticket|recado|10\s+digitos|motivo|avise\s+al\s+gerente)\b/.test(combined))
  ) {
    return 'phone_only'
  }

  return 'both'
}

export function shortHash(text: string): string {
  return createHash('sha1').update(text.toLowerCase().trim()).digest('hex').slice(0, 12)
}

/**
 * Normaliza preguntas de clientes (quita tildes, signos, muletillas iniciales y espacios extra) para deduplicar
 * preguntas equivalentes entre distintas llamadas telefónicas y limpiar `unanswered_question` al aprobarlas.
 */
export function normalizeQuestionFingerprint(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^pregunta sin respuesta en llamada telefonica:\s*/i, '')
    .replace(/^friccion detectada en llamada telefonica:\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:oigan|oye|hola|disculpa|disculpe|una pregunta|buenas tardes|buenos dias|buenas noches|buen dia|mire|mira|por favor)\s+)+/i, '')
    .replace(/\b(?:nuestro propio|nuestra propia|mi propio|mi propia)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildCleanKbTitle(questionOrTrigger: string): string {
  const cleaned = sanitizeRuleText(questionOrTrigger, 220)
    .replace(/^Pregunta sin respuesta en llamada telefónica:\s*/i, '')
    .replace(/^Fricción detectada en llamada telefónica:\s*/i, '')
    .trim()
  return (cleaned || sanitizeRuleText(questionOrTrigger, 180)).slice(0, 180)
}

/** Infiere la categoría limpia de `phone_knowledge_base` a partir del disparador y regla aprobada. */
export function inferPhoneKbCategory(text: string): PhoneKbCategory {
  const s = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (/\b(charolas?|fiesta\s*platters?|party\s*(?:trays?|play)|paquetes?\s+para\s+\d+|banquetes?|catering)\b/.test(s)) {
    return 'catering'
  }
  if (/\b(doordash|uber\s*eats?|grubhub|caviar|postmates|repartidor(?:es)?|delivery|driver|pickup)\b/.test(s)) {
    return 'delivery'
  }
  if (/\b(pagos?|efectivo|cash|tarjetas?|apple\s*pay|google\s*pay|ebt|calfresh|reembolsos?|refund|cobros?)\b/.test(s)) {
    return 'payments'
  }
  if (/\b(horarios?|abren|cierran|abierto|cerrado|open|close|hours|thanksgiving|navidad|christmas|ano\s+nuevo|viernes\s+santo|festivos?)\b/.test(s)) {
    return 'hours'
  }
  if (
    /\b(pastel(?:es)?\s+(?:externos?|de\s+cumpleanos)|cumpleanos|escuelas?|escolares?|descuentos?|convenios?|quejas?|gerente|manager|ticket|mascotas?|banos?|comedor|estacionamiento|politica)\b/.test(
      s
    )
  ) {
    return 'policies'
  }
  if (
    /\b(tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|platos?|aguas?\s+frescas?|horchata|jamaica|pina|tamarindo|champurrado|cafe|flan|cheesecake|postres?|carnes?|asada|pastor|pollo|cabeza|lengua|buche|chorizo|carnitas|queso|frijol|arroz|guacamole|crema|salsas?|condimentos?|tamanos?|regular|super)\b/.test(
      s
    )
  ) {
    return 'menu'
  }
  return 'general'
}

export function extractQuestionKeywords(trigger: string, ruleEs: string, ruleEn = ''): string {
  const raw = `${trigger} ${ruleEs} ${ruleEn}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of raw.split(/\s+/)) {
    if (w.length < 4 || KEYWORD_STOPWORDS.has(w) || /^\d+$/.test(w)) continue
    if (!seen.has(w)) {
      seen.add(w)
      out.push(w)
      if (out.length >= 24) break
    }
  }
  return out.join(', ').slice(0, 480)
}

export function mapLearningRowToDto(r: any): KoreLearningItemDto {
  const appliesToChannels: KoreAppliesToChannels = isValidAppliesToChannels(r.applies_to_channels)
    ? r.applies_to_channels
    : 'both'
  return {
    id: String(r.id),
    storeId: r.store_id === null || r.store_id === undefined ? null : Number(r.store_id),
    sourceSessionId: r.source_session_id ? String(r.source_session_id) : null,
    sourceType: String(r.source_type || 'auto_analysis'),
    itemKind: r.item_kind as KoreLearningItemKind,
    status: r.status as KoreLearningItemStatus,
    questionOrTrigger: String(r.question_or_trigger || ''),
    customerQuote: r.customer_quote ? String(r.customer_quote) : null,
    koreQuote: r.kore_quote ? String(r.kore_quote) : null,
    proposedRuleEs: r.proposed_rule_es ? String(r.proposed_rule_es) : null,
    proposedRuleEn: r.proposed_rule_en ? String(r.proposed_rule_en) : null,
    ownerInstruction: r.owner_instruction ? String(r.owner_instruction) : null,
    evidenceCount: Math.max(1, Number(r.evidence_count) || 1),
    avgLatencyMs: r.avg_latency_ms === null || r.avg_latency_ms === undefined ? null : Number(r.avg_latency_ms),
    resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    createdAt: String(r.created_at),
    appliesToChannels,
    syncedKbId: r.synced_kb_id ? String(r.synced_kb_id) : null,
    syncedPhoneItemId: r.synced_phone_item_id ? String(r.synced_phone_item_id) : null,
    sourcePhoneCallId: r.source_phone_call_id ? String(r.source_phone_call_id) : null
  }
}

/**
 * Carga las reglas aprendidas activas (`approved` o `auto_applied`, excluyendo `latency_insight` y `phone_only`)
 * aplicables a una sucursal (`store_id IS NULL` o `store_id = storeId`) para inyectarlas en `buildKoreSystemPrompt`.
 */
export async function loadActiveKoreLearnedRules(
  storeId: number,
  opts?: { bypassCache?: boolean }
): Promise<ActiveKoreLearnedRule[]> {
  const key = String(Math.trunc(storeId))
  const hit = activeRulesCache.get(key)
  if (!opts?.bypassCache && hit && Date.now() - hit.fetchedAt < ACTIVE_RULES_TTL_MS) return hit.rules

  const { data, error } = await supabaseAdmin
    .from('dt_kore_learning_items')
    .select(
      'id, store_id, item_kind, status, applies_to_channels, synced_kb_id, question_or_trigger, proposed_rule_es, proposed_rule_en, owner_instruction, evidence_count, updated_at'
    )
    .in('status', ['approved', 'auto_applied'])
    .in('applies_to_channels', ['both', 'drive_thru_only'])
    .neq('item_kind', 'latency_insight')
    .or(`store_id.is.null,store_id.eq.${Math.trunc(storeId)}`)
    .order('evidence_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(25)

  if (error || !Array.isArray(data)) return hit?.rules || []

  const rules: ActiveKoreLearnedRule[] = []
  for (const r of data as any[]) {
    const ruleEs = sanitizeRuleText(r.proposed_rule_es || r.owner_instruction || '')
    const ruleEn = sanitizeRuleText(r.proposed_rule_en || r.owner_instruction || ruleEs, 420, 'en')
    if (!ruleEs && !ruleEn) continue
    rules.push({
      id: String(r.id),
      storeId: r.store_id === null || r.store_id === undefined ? null : Number(r.store_id),
      itemKind: r.item_kind as KoreLearningItemKind,
      trigger: sanitizeRuleText(r.question_or_trigger, 160),
      ruleEs: ruleEs || ruleEn,
      ruleEn: ruleEn || ruleEs,
      appliesToChannels: isValidAppliesToChannels(r.applies_to_channels) ? r.applies_to_channels : 'both',
      syncedKbId: r.synced_kb_id ? String(r.synced_kb_id) : null
    })
  }
  activeRulesCache.set(key, { rules, fetchedAt: Date.now() })
  return rules
}

async function resolveMatchingPhoneCallsQuestions(itemRow: any): Promise<void> {
  const directCallId = itemRow.source_phone_call_id ? String(itemRow.source_phone_call_id) : null
  if (directCallId) {
    await supabaseAdmin.from('phone_calls').update({ unanswered_question: null }).eq('id', directCallId)
  }

  const candidateQuestion = String(itemRow.customer_quote || buildCleanKbTitle(String(itemRow.question_or_trigger || ''))).trim()
  const targetFp = normalizeQuestionFingerprint(candidateQuestion)
  if (targetFp.length < 8) return

  let q = supabaseAdmin
    .from('phone_calls')
    .select('id, unanswered_question')
    .not('unanswered_question', 'is', null)
    .limit(100)
  if (itemRow.store_id !== null && itemRow.store_id !== undefined && Number.isInteger(Number(itemRow.store_id))) {
    q = q.eq('store_id', Number(itemRow.store_id))
  }
  const { data: openCalls } = await q
  const matchingIds = (openCalls || [])
    .filter((c: any) => normalizeQuestionFingerprint(c.unanswered_question) === targetFp)
    .map((c: any) => String(c.id))

  if (matchingIds.length > 0) {
    await supabaseAdmin.from('phone_calls').update({ unanswered_question: null }).in('id', matchingIds)
  }
}

function mapDriveThruSourceToPhoneSource(
  src: string,
  hasSourceCallId: boolean
): 'cron_daily' | 'auto_analysis' | 'twilio_call' | 'manual_owner' {
  if (src === 'manual_owner' || src === 'manual') return 'manual_owner'
  if (src === 'cron_daily' || src === 'cron_audit') return 'cron_daily'
  if (src === 'phone_call' || hasSourceCallId) return 'twilio_call'
  return 'auto_analysis'
}

/**
 * Dirección Drive-Thru -> Llamadas: sincroniza un registro de `dt_kore_learning_items` hacia `public.phone_knowledge_base`
 * Y `public.phone_learning_items` (con generación de `fast_reply_es/en <= 220` chars, `trigger_keywords` y pre-calentamiento WAV
 * `Kore 3.8` al pasar a `approved`), invalidando al instante todas las cachés de Teléfono y Drive-Thru.
 * Devuelve la fila actualizada (con `synced_kb_id` y `synced_phone_item_id` al día).
 */
export async function syncLearningItemToPhoneKnowledgeBase(itemRow: any): Promise<any> {
  if (!itemRow || !itemRow.id) return itemRow
  const dtId = String(itemRow.id)
  const nowIso = new Date().toISOString()
  const status = String(itemRow.status || 'needs_owner_input')
  const itemKind = String(itemRow.item_kind || 'learned_rule')
  const channels: KoreAppliesToChannels = isValidAppliesToChannels(itemRow.applies_to_channels)
    ? itemRow.applies_to_channels
    : inferAppliesToChannels({
        questionOrTrigger: itemRow.question_or_trigger,
        proposedRuleEs: itemRow.proposed_rule_es,
        proposedRuleEn: itemRow.proposed_rule_en,
        ownerInstruction: itemRow.owner_instruction,
        customerQuote: itemRow.customer_quote,
        dedupeKey: itemRow.dedupe_key,
        itemKind
      })
  const storeId = itemRow.store_id === null || itemRow.store_id === undefined ? null : Number(itemRow.store_id)
  let syncedKbId: string | null = itemRow.synced_kb_id ? String(itemRow.synced_kb_id) : null
  let syncedPhoneItemId: string | null = itemRow.synced_phone_item_id ? String(itemRow.synced_phone_item_id) : null

  const phoneLearnMod = await import('@/lib/phone-agent-learning')

  // 1) Buscar gemelo existente en phone_learning_items antes de crear KB para reutilizar kb_entry_id si ya existe
  let phoneTwin: any = null
  if (itemKind !== 'latency_insight') {
    if (syncedPhoneItemId) {
      const { data } = await supabaseAdmin
        .from('phone_learning_items')
        .select('*')
        .eq('id', syncedPhoneItemId)
        .maybeSingle()
      if (data?.id) phoneTwin = data
    }
    if (!phoneTwin) {
      const { data } = await supabaseAdmin
        .from('phone_learning_items')
        .select('*')
        .eq('synced_dt_item_id', dtId)
        .limit(1)
        .maybeSingle()
      if (data?.id) phoneTwin = data
    }
    if (!phoneTwin && syncedKbId) {
      const { data } = await supabaseAdmin
        .from('phone_learning_items')
        .select('*')
        .eq('kb_entry_id', syncedKbId)
        .limit(1)
        .maybeSingle()
      if (data?.id && (!data.synced_dt_item_id || String(data.synced_dt_item_id) === dtId)) {
        phoneTwin = data
      }
    }
    if (!phoneTwin && itemRow.dedupe_key) {
      const { data } = await supabaseAdmin
        .from('phone_learning_items')
        .select('*')
        .eq('dedupe_key', String(itemRow.dedupe_key))
        .maybeSingle()
      if (data?.id && (!data.synced_dt_item_id || String(data.synced_dt_item_id) === dtId)) {
        phoneTwin = data
      }
    }
    if (!phoneTwin) {
      const fpTrigger = normalizeQuestionFingerprint(itemRow.question_or_trigger)
      const fpQuote = normalizeQuestionFingerprint(itemRow.customer_quote)
      if (fpTrigger.length >= 8 || fpQuote.length >= 8 || itemRow.source_phone_call_id) {
        const { data: openPhone } = await supabaseAdmin
          .from('phone_learning_items')
          .select('*')
          .is('synced_dt_item_id', null)
          .not('item_kind', 'in', '("audio_prewarm","latency_insight")')
          .limit(100)
        phoneTwin =
          (openPhone || []).find((p: any) => {
            const pFpT = normalizeQuestionFingerprint(p.question_or_trigger)
            const pFpQ = normalizeQuestionFingerprint(p.customer_quote)
            if (fpTrigger.length >= 8 && (pFpT === fpTrigger || pFpQ === fpTrigger)) return true
            if (fpQuote.length >= 8 && (pFpT === fpQuote || pFpQ === fpQuote)) return true
            if (
              itemRow.source_phone_call_id &&
              p.source_call_id &&
              String(p.source_call_id) === String(itemRow.source_phone_call_id) &&
              p.status === status
            ) {
              return true
            }
            return false
          }) || null
      }
    }
    if (!syncedKbId && phoneTwin?.kb_entry_id) {
      syncedKbId = String(phoneTwin.kb_entry_id)
    }
  }

  const isSmokeTest =
    /\bTEST_SMOKE_/i.test(String(itemRow.dedupe_key || '')) ||
    /\bTEST_SMOKE_/i.test(String(itemRow.question_or_trigger || '')) ||
    /\bTEST_SMOKE_/i.test(String(itemRow.owner_instruction || '')) ||
    /\bTEST_SMOKE_/i.test(String(itemRow.proposed_rule_es || ''))

  if (status === 'approved' && !isSmokeTest && (itemRow.source_phone_call_id || itemRow.source_type === 'phone_call')) {
    await resolveMatchingPhoneCallsQuestions(itemRow)
  }

  const shouldBeActiveInPhone =
    itemKind !== 'latency_insight' &&
    (status === 'approved' || status === 'auto_applied') &&
    (channels === 'both' || channels === 'phone_only')

  const cleanTitle = buildCleanKbTitle(String(phoneTwin?.question_or_trigger || itemRow.question_or_trigger || ''))
  let builtPhoneRule: {
    ruleEs: string
    ruleEn: string
    fastReplyEs: string | null
    fastReplyEn: string | null
    triggerKeywords: string[]
  } | null = null

  const combinedScopeText = `${cleanTitle} ${itemRow.dedupe_key || ''} ${itemRow.owner_instruction || ''} ${itemRow.proposed_rule_es || ''} ${itemRow.proposed_rule_en || ''}`
  const isCityOrStoreCapabilityDependent =
    storeId === null &&
    /\b(ebt|calfresh|food\s*stamps?|estampillas?|drive[\s-]*thru|ventana\s*2|window\s*2|rialto|santa\s*ana)\b/i.test(
      combinedScopeText
    )

  if (shouldBeActiveInPhone) {
    const ownerChanged =
      Boolean(itemRow.owner_instruction) &&
      String(itemRow.owner_instruction).trim() !== String(phoneTwin?.owner_instruction || '').trim()

    builtPhoneRule = await phoneLearnMod.buildBilingualPhoneRuleAndFastReply({
      questionOrTrigger: cleanTitle,
      ownerInstruction: String(
        itemRow.owner_instruction || itemRow.proposed_rule_es || cleanTitle
      ).slice(0, 420),
      proposedRuleEs: itemRow.proposed_rule_es || phoneTwin?.proposed_rule_es || null,
      proposedRuleEn: itemRow.proposed_rule_en || phoneTwin?.proposed_rule_en || null,
      fastReplyEs: isCityOrStoreCapabilityDependent || ownerChanged ? null : phoneTwin?.fast_reply_es || null,
      fastReplyEn: isCityOrStoreCapabilityDependent || ownerChanged ? null : phoneTwin?.fast_reply_en || null,
      triggerKeywords: phoneTwin?.trigger_keywords?.length ? phoneTwin.trigger_keywords : null
    })

    const answerEs = sanitizeRuleText(
      isCityOrStoreCapabilityDependent
        ? itemRow.proposed_rule_es || builtPhoneRule.ruleEs || builtPhoneRule.fastReplyEs
        : builtPhoneRule.fastReplyEs || builtPhoneRule.ruleEs,
      1400,
      'es'
    )
    const answerEn = sanitizeRuleText(
      isCityOrStoreCapabilityDependent
        ? itemRow.proposed_rule_en || builtPhoneRule.ruleEn || builtPhoneRule.fastReplyEn || answerEs
        : builtPhoneRule.fastReplyEn || builtPhoneRule.ruleEn || answerEs,
      1400,
      'en'
    )

    if (cleanTitle && answerEs) {
      const category = inferPhoneKbCategory(`${cleanTitle} ${answerEs} ${answerEn}`)
      const questionKeywords =
        builtPhoneRule.triggerKeywords.length > 0
          ? builtPhoneRule.triggerKeywords.join(', ').slice(0, 480)
          : extractQuestionKeywords(cleanTitle, answerEs, answerEn)
      const kbPayload = {
        store_id: storeId,
        category,
        title: cleanTitle,
        question_keywords: questionKeywords || null,
        answer_es: answerEs,
        answer_en: answerEn,
        is_active: true,
        priority: 75,
        updated_at: nowIso
      }

      let updatedExisting = false
      if (syncedKbId) {
        const { data: updKb, error: updErr } = await supabaseAdmin
          .from('phone_knowledge_base')
          .update(kbPayload)
          .eq('id', syncedKbId)
          .select('id')
          .maybeSingle()
        if (!updErr && updKb?.id) {
          syncedKbId = String(updKb.id)
          updatedExisting = true
        }
      }

      if (!updatedExisting) {
        let sameTitleQuery = supabaseAdmin.from('phone_knowledge_base').select('id').eq('title', cleanTitle)
        sameTitleQuery = storeId === null ? sameTitleQuery.is('store_id', null) : sameTitleQuery.eq('store_id', storeId)
        const { data: sameTitle } = await sameTitleQuery.maybeSingle()
        if (sameTitle?.id) {
          await supabaseAdmin.from('phone_knowledge_base').update(kbPayload).eq('id', sameTitle.id)
          syncedKbId = String(sameTitle.id)
          updatedExisting = true
        }
      }

      if (!updatedExisting) {
        const { data: createdKb, error: insErr } = await supabaseAdmin
          .from('phone_knowledge_base')
          .insert(kbPayload)
          .select('id')
          .single()
        if (!insErr && createdKb?.id) {
          syncedKbId = String(createdKb.id)
        }
      }
    }
  } else if (
    syncedKbId &&
    (channels === 'drive_thru_only' || status === 'dismissed' || status === 'needs_owner_input' || itemKind === 'latency_insight')
  ) {
    await supabaseAdmin
      .from('phone_knowledge_base')
      .update({ is_active: false, updated_at: nowIso })
      .eq('id', syncedKbId)
  }

  // 2) Sincronizar con public.phone_learning_items (excepto latency_insight)
  if (itemKind !== 'latency_insight') {
    if (channels === 'drive_thru_only' || status === 'dismissed') {
      if (phoneTwin?.id) {
        syncedPhoneItemId = String(phoneTwin.id)
        const nextPhoneStatus =
          status === 'dismissed'
            ? 'dismissed'
            : phoneTwin.status === 'needs_owner_input'
              ? 'dismissed'
              : String(phoneTwin.status)
        if (phoneTwin.kb_entry_id && String(phoneTwin.kb_entry_id) !== String(syncedKbId || '')) {
          await supabaseAdmin
            .from('phone_knowledge_base')
            .update({ is_active: false, updated_at: nowIso })
            .eq('id', String(phoneTwin.kb_entry_id))
        }
        await supabaseAdmin
          .from('phone_learning_items')
          .update({
            status: nextPhoneStatus,
            applies_to_channels: channels,
            synced_dt_item_id: dtId,
            updated_at: nowIso
          })
          .eq('id', syncedPhoneItemId)
      }
    } else if (channels === 'both' || channels === 'phone_only') {
      const category = phoneTwin?.category || inferPhoneKbCategory(`${cleanTitle} ${itemRow.proposed_rule_es || ''}`)
      const mappedPhoneSource = mapDriveThruSourceToPhoneSource(
        String(itemRow.source_type || ''),
        Boolean(itemRow.source_phone_call_id)
      )

      const effectiveFastReplyEs = isCityOrStoreCapabilityDependent
        ? null
        : builtPhoneRule
          ? builtPhoneRule.fastReplyEs
          : phoneTwin?.fast_reply_es ?? null
      const effectiveFastReplyEn = isCityOrStoreCapabilityDependent
        ? null
        : builtPhoneRule
          ? builtPhoneRule.fastReplyEn
          : phoneTwin?.fast_reply_en ?? null

      let audioPrewarmed = isCityOrStoreCapabilityDependent ? false : Boolean(phoneTwin?.audio_prewarmed)
      if (!isCityOrStoreCapabilityDependent && status === 'approved' && builtPhoneRule) {
        const warmedNow = await phoneLearnMod.prewarmApprovedFastReplies(
          builtPhoneRule.fastReplyEs,
          builtPhoneRule.fastReplyEn,
          isSmokeTest
        )
        audioPrewarmed = audioPrewarmed || warmedNow
      }

      const mappedPhoneKind =
        itemKind === 'synonym_fix'
          ? 'stt_synonym'
          : status === 'needs_owner_input'
            ? 'doubt_for_owner'
            : !isCityOrStoreCapabilityDependent && effectiveFastReplyEs && (builtPhoneRule?.triggerKeywords.length || 0) > 0
              ? 'fast_reply_macro'
              : 'learned_rule'

      const fallbackKeywords = phoneLearnMod.normalizeTriggerKeywords(
        cleanTitle
          .replace(/[¿?¡!.:()]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 4)
          .slice(0, 8)
      )
      const triggerKeywords =
        builtPhoneRule?.triggerKeywords && builtPhoneRule.triggerKeywords.length > 0
          ? builtPhoneRule.triggerKeywords
          : phoneTwin?.trigger_keywords?.length
            ? phoneTwin.trigger_keywords
            : fallbackKeywords

      const ruleEs = isCityOrStoreCapabilityDependent
        ? sanitizeRuleText(itemRow.proposed_rule_es || builtPhoneRule?.ruleEs || '', 1200, 'es') || null
        : builtPhoneRule?.ruleEs ||
          phoneLearnMod.sanitizePhoneLearningText(itemRow.proposed_rule_es || '', 400, 'es') ||
          null
      const ruleEn = isCityOrStoreCapabilityDependent
        ? sanitizeRuleText(itemRow.proposed_rule_en || builtPhoneRule?.ruleEn || ruleEs || '', 1200, 'en') || null
        : builtPhoneRule?.ruleEn ||
          phoneLearnMod.sanitizePhoneLearningText(itemRow.proposed_rule_en || ruleEs || '', 400, 'en') ||
          null
      const doubtText =
        status === 'needs_owner_input'
          ? phoneTwin?.doubt_for_owner ||
            `Hallazgo compartido de Kore Drive-Thru ("${cleanTitle.slice(0, 150)}"): define el criterio oficial para aplicarlo al instante tanto en Drive-Thru como en la Contestadora Telefónica.`
          : phoneTwin?.doubt_for_owner ?? null

      if (phoneTwin?.id) {
        syncedPhoneItemId = String(phoneTwin.id)
        await supabaseAdmin
          .from('phone_learning_items')
          .update({
            store_id: storeId,
            source_call_id: itemRow.source_phone_call_id || phoneTwin.source_call_id || null,
            synced_dt_item_id: dtId,
            applies_to_channels: channels,
            item_kind: mappedPhoneKind,
            status,
            category,
            question_or_trigger: cleanTitle || phoneTwin.question_or_trigger,
            trigger_keywords: triggerKeywords,
            customer_quote: itemRow.customer_quote ?? phoneTwin.customer_quote ?? null,
            kore_quote: itemRow.kore_quote ?? phoneTwin.kore_quote ?? null,
            doubt_for_owner: doubtText,
            proposed_rule_es: ruleEs ?? phoneTwin.proposed_rule_es ?? null,
            proposed_rule_en: ruleEn ?? phoneTwin.proposed_rule_en ?? null,
            fast_reply_es: effectiveFastReplyEs,
            fast_reply_en: effectiveFastReplyEn,
            owner_instruction: itemRow.owner_instruction ?? phoneTwin.owner_instruction ?? null,
            evidence_count: Math.max(Number(itemRow.evidence_count) || 1, Number(phoneTwin.evidence_count) || 1),
            audio_prewarmed: audioPrewarmed,
            kb_entry_id: syncedKbId ?? phoneTwin.kb_entry_id ?? null,
            resolved_by:
              itemRow.resolved_by !== null && itemRow.resolved_by !== undefined
                ? String(itemRow.resolved_by)
                : phoneTwin.resolved_by ?? null,
            resolved_by_name: itemRow.resolved_by_name ?? phoneTwin.resolved_by_name ?? null,
            resolved_at: itemRow.resolved_at ?? phoneTwin.resolved_at ?? null,
            updated_at: nowIso
          })
          .eq('id', syncedPhoneItemId)
      } else {
        const phoneDedupeKey = itemRow.dedupe_key
          ? String(itemRow.dedupe_key)
          : isSmokeTest
            ? `TEST_SMOKE_DT_${shortHash(`${cleanTitle}:${dtId}`)}`
            : `dt_sync:${dtId}`

        const insertPhonePayload = {
          store_id: storeId,
          source_call_id: itemRow.source_phone_call_id || null,
          dedupe_key: phoneDedupeKey,
          source_type: mappedPhoneSource,
          item_kind: mappedPhoneKind,
          status,
          applies_to_channels: channels,
          synced_dt_item_id: dtId,
          category,
          question_or_trigger: cleanTitle || sanitizeRuleText(itemRow.question_or_trigger, 200, 'es'),
          trigger_keywords: triggerKeywords,
          customer_quote: itemRow.customer_quote ?? null,
          kore_quote: itemRow.kore_quote ?? null,
          doubt_for_owner: doubtText,
          proposed_rule_es: ruleEs,
          proposed_rule_en: ruleEn,
          fast_reply_es: effectiveFastReplyEs,
          fast_reply_en: effectiveFastReplyEn,
          owner_instruction: itemRow.owner_instruction ?? null,
          evidence_count: Math.max(1, Number(itemRow.evidence_count) || 1),
          avg_latency_ms:
            itemRow.avg_latency_ms !== null && itemRow.avg_latency_ms !== undefined
              ? Number(itemRow.avg_latency_ms)
              : null,
          audio_prewarmed: audioPrewarmed,
          kb_entry_id: syncedKbId,
          resolved_by:
            itemRow.resolved_by !== null && itemRow.resolved_by !== undefined ? String(itemRow.resolved_by) : null,
          resolved_by_name: itemRow.resolved_by_name ?? null,
          resolved_at: itemRow.resolved_at ?? null,
          updated_at: nowIso
        }

        const { data: createdPhone, error: insPhoneErr } = await supabaseAdmin
          .from('phone_learning_items')
          .insert(insertPhonePayload)
          .select('id')
          .maybeSingle()

        if (!insPhoneErr && createdPhone?.id) {
          syncedPhoneItemId = String(createdPhone.id)
        } else if (insPhoneErr?.code === '23505') {
          const { data: racePhone } = await supabaseAdmin
            .from('phone_learning_items')
            .update(insertPhonePayload)
            .eq('dedupe_key', phoneDedupeKey)
            .select('id')
            .maybeSingle()
          if (racePhone?.id) syncedPhoneItemId = String(racePhone.id)
        }
      }
    }
  }

  if (
    syncedKbId !== (itemRow.synced_kb_id ? String(itemRow.synced_kb_id) : null) ||
    syncedPhoneItemId !== (itemRow.synced_phone_item_id ? String(itemRow.synced_phone_item_id) : null) ||
    channels !== itemRow.applies_to_channels
  ) {
    await supabaseAdmin
      .from('dt_kore_learning_items')
      .update({
        applies_to_channels: channels,
        synced_kb_id: syncedKbId,
        synced_phone_item_id: syncedPhoneItemId,
        updated_at: nowIso
      })
      .eq('id', dtId)
  }

  phoneLearnMod.invalidatePhoneLearnedRulesCache()
  invalidateStorePhoneContextCache(storeId ?? undefined)
  invalidateKoreKnowledgeCache(storeId ?? undefined)
  invalidateKoreLearnedRulesCache()

  return {
    ...itemRow,
    applies_to_channels: channels,
    synced_kb_id: syncedKbId,
    synced_phone_item_id: syncedPhoneItemId
  }
}

/** Obtiene los IDs de `dt_kore_learning_items` vinculados a un `phone_knowledge_base.id` (llamar ANTES de `DELETE`). */
export async function findLearningItemIdsBySyncedKbId(kbId: string): Promise<string[]> {
  if (!kbId) return []
  const { data } = await supabaseAdmin
    .from('dt_kore_learning_items')
    .select('id')
    .eq('synced_kb_id', kbId)
  return (data || []).map((r: any) => String(r.id))
}

/**
 * Dirección Llamadas -> Drive-Thru: refleja en `dt_kore_learning_items` cualquier edición, desactivación o borrado
 * ejecutado desde `/admin/llamadas` (`/api/phone/dashboard` con `entity === 'knowledge_base'`).
 */
export async function syncPhoneKbMutationBackToLearning(params: {
  kbId: string
  action: 'updated' | 'deleted'
  row?: any
  preFetchedLearningIds?: string[]
}): Promise<void> {
  const nowIso = new Date().toISOString()
  invalidateKoreKnowledgeCache()
  invalidateKoreLearnedRulesCache()

  if (params.action === 'deleted') {
    const targetIds =
      params.preFetchedLearningIds && params.preFetchedLearningIds.length > 0
        ? params.preFetchedLearningIds
        : await findLearningItemIdsBySyncedKbId(params.kbId)
    if (targetIds.length > 0) {
      await supabaseAdmin
        .from('dt_kore_learning_items')
        .update({
          synced_kb_id: null,
          status: 'dismissed',
          updated_at: nowIso
        })
        .in('id', targetIds)
      invalidateKoreLearnedRulesCache()
      invalidateKoreKnowledgeCache()
    }
    return
  }

  if (params.action === 'updated' && params.row) {
    const row = params.row
    const { data: linked } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select('id, status, applies_to_channels')
      .eq('synced_kb_id', params.kbId)

    if (!linked || linked.length === 0) return

    const isActive = row.is_active !== false
    const cleanTitle = sanitizeRuleText(row.title, 220)
    const cleanEs = sanitizeRuleText(row.answer_es, 420)
    const cleanEn = sanitizeRuleText(row.answer_en || row.answer_es, 420, 'en')
    const storeId = row.store_id === null || row.store_id === undefined ? null : Number(row.store_id)

    for (const item of linked as any[]) {
      const nextStatus: KoreLearningItemStatus = !isActive
        ? 'dismissed'
        : item.status === 'auto_applied'
          ? 'auto_applied'
          : 'approved'
      const curChannels: KoreAppliesToChannels = isValidAppliesToChannels(item.applies_to_channels)
        ? item.applies_to_channels
        : 'both'
      const nextChannels: KoreAppliesToChannels = isActive && curChannels === 'drive_thru_only' ? 'both' : curChannels

      const updateFields: Record<string, any> = {
        store_id: storeId,
        status: nextStatus,
        applies_to_channels: nextChannels,
        updated_at: nowIso
      }
      if (cleanTitle) updateFields.question_or_trigger = cleanTitle
      if (cleanEs) updateFields.proposed_rule_es = cleanEs
      if (cleanEn) updateFields.proposed_rule_en = cleanEn

      await supabaseAdmin.from('dt_kore_learning_items').update(updateFields).eq('id', item.id)
    }

    invalidateKoreLearnedRulesCache()
    invalidateKoreKnowledgeCache()
  }
}

/**
 * Cuando un administrador crea una regla en `/admin/llamadas` resolviendo un `resolveCallId` de `phone_calls`,
 * vincula y aprueba automáticamente cualquier duda gemela pendiente en `dt_kore_learning_items`.
 */
export async function syncPhoneKbCreatedFromCallToLearning(params: {
  kbRow: any
  resolveCallId: string
}): Promise<void> {
  const { kbRow, resolveCallId } = params
  if (!kbRow?.id || !resolveCallId) return
  const nowIso = new Date().toISOString()

  const { data: callRow } = await supabaseAdmin
    .from('phone_calls')
    .select('id, unanswered_question')
    .eq('id', resolveCallId)
    .maybeSingle()

  const fp = callRow?.unanswered_question ? normalizeQuestionFingerprint(callRow.unanswered_question) : ''
  const dedupeKey = fp.length >= 8 ? `phone_q:${shortHash(fp)}` : null

  const orParts = [`source_phone_call_id.eq.${resolveCallId}`]
  if (dedupeKey) orParts.push(`dedupe_key.eq.${dedupeKey}`)

  const { data: matching } = await supabaseAdmin
    .from('dt_kore_learning_items')
    .select('id')
    .eq('status', 'needs_owner_input')
    .or(orParts.join(','))

  if (matching && matching.length > 0) {
    const ids = matching.map((m: any) => String(m.id))
    const cleanEs = sanitizeRuleText(kbRow.answer_es, 420)
    const cleanEn = sanitizeRuleText(kbRow.answer_en || kbRow.answer_es, 420, 'en')
    await supabaseAdmin
      .from('dt_kore_learning_items')
      .update({
        status: 'approved',
        synced_kb_id: String(kbRow.id),
        store_id: kbRow.store_id === null || kbRow.store_id === undefined ? null : Number(kbRow.store_id),
        proposed_rule_es: cleanEs || null,
        proposed_rule_en: cleanEn || null,
        applies_to_channels: 'both',
        resolved_at: nowIso,
        updated_at: nowIso
      })
      .in('id', ids)
  }

  invalidateKoreKnowledgeCache()
  invalidateKoreLearnedRulesCache()
}

/** Genera par de reglas limpias ES/EN a partir de una instrucción escrita por el dueño (con fallback determinista). */
export async function buildBilingualRuleFromOwnerInstruction(params: {
  questionOrTrigger: string
  ownerInstruction: string
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
}): Promise<{ ruleEs: string; ruleEn: string }> {
  const cleanTrigger = sanitizeRuleText(params.questionOrTrigger, 200)
  const cleanOwner = sanitizeRuleText(params.ownerInstruction, 400)
  const explicitEs = sanitizeRuleText(params.proposedRuleEs || '', 400)
  const explicitEn = sanitizeRuleText(params.proposedRuleEn || '', 400, 'en')
  if (explicitEs && explicitEn) return { ruleEs: explicitEs, ruleEn: explicitEn }

  const fallbackEs = explicitEs || (cleanTrigger ? `Cuando ocurra "${cleanTrigger}": ${cleanOwner}` : cleanOwner)
  const fallbackEn = explicitEn || (cleanTrigger ? `When "${cleanTrigger}": ${cleanOwner}` : cleanOwner)

  try {
    if (!cleanOwner) return { ruleEs: fallbackEs, ruleEn: fallbackEn }
    const prompt = [
      'Convierte la instrucción operativa del dueño de Tacos Gavilan en una regla imperativa concisa (1 oración) en español y en inglés para la asistente de voz Kore (Drive-Thru y Teléfono).',
      'Reglas estrictas: usa siempre "Tacos Gavilan" (jamás agregues "El"), precios solo en dólares USD (jamás pesos), burritos/quesadillas/mulitas son Regular o Super (nunca tamaños). Responde SOLO JSON válido {"es":"...","en":"..."}.',
      `Situación/Disparador: ${cleanTrigger}`,
      `Instrucción del dueño: ${cleanOwner}`
    ].join('\n')

    const llmRes = await generateGeminiLearningJson<{ es?: string; en?: string }>({
      models: GEMINI_REST_MODELS,
      prompt,
      maxOutputTokens: 280,
      temperature: 0.1,
      timeoutMs: 5000
    })
    if (llmRes?.data) {
      const es = sanitizeRuleText(llmRes.data?.es, 400)
      const en = sanitizeRuleText(llmRes.data?.en, 400, 'en')
      if (es && en) return { ruleEs: es, ruleEn: en }
    }
  } catch {
    // Fallback determinista
  }
  return { ruleEs: fallbackEs, ruleEn: fallbackEn }
}

const FOOD_OR_DT_WORDS_RE =
  /\b(tacos?|burritos?|quesadillas?|mulitas?|sopes?|tortas?|nachos?|platos?|horchata|jamaica|pi[nñ]a|tamarindo|coca|coke|sprite|fanta|agua|limonada|lemonade|champurrado|caf[eé]|coffee|flan|cheesecake|asada|pastor|pollo|cabeza|lengua|buche|chorizo|carnitas|huevo|salsa|lim[oó]n|cebolla|cilantro|guacamole|crema|queso|frijol|arroz|orden|pedido|cu[aá]nto|precio|gracias|hola|buenos|buenas|ventana|doordash|uber|grubhub|repartidor|driver|pickup|regular|s[uú]per|grande|median[oa])\b/i

export function extractDeterministicSessionFindings(
  session: any,
  sourceType: KoreLearningSourceType
): CandidateFinding[] {
  const findings: CandidateFinding[] = []
  const sessionId = String(session.id)
  const storeId = Number.isInteger(Number(session.store_id)) ? Number(session.store_id) : null
  const turns: Array<{ role: string; text: string }> = Array.isArray(session.transcript) ? session.transcript : []
  const avgLat = Number.isFinite(Number(session.avg_latency_ms)) ? Number(session.avg_latency_ms) : null
  const bargeIns = Number(session.barge_in_count) || 0

  // 1) Error real de negocio: decir "tamaño" / "size" en burritos, quesadillas o mulitas
  const koreSizeTurn = turns.find(
    (t) =>
      t.role === 'kore' &&
      /\b(tamañ[oa]s?|what\s+size|which\s+size)\b/i.test(t.text) &&
      /\b(burritos?|quesadillas?|mulitas?)\b/i.test(t.text)
  )
  const custSizePushback = turns.find(
    (t) => t.role === 'customer' && /\b(tamañ[oa]s?\s+de\s+(?:burrito|quesadilla|mulita)|burrito\s+sizes?)\b/i.test(t.text)
  )
  if (koreSizeTurn || custSizePushback) {
    const prevCust = turns.find((t) => t.role === 'customer' && /\b(burritos?|quesadillas?|mulitas?)\b/i.test(t.text))
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:no_size_on_burrito_quesadilla_mulita',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'both',
      questionOrTrigger: 'Cliente pide burritos, quesadillas o mulitas sin especificar Regular o Super',
      customerQuote: sanitizeRuleText(
        [prevCust?.text, custSizePushback?.text].filter(Boolean).join(' / ') || custSizePushback?.text || '',
        280
      ),
      koreQuote: sanitizeRuleText(koreSizeTurn?.text || '', 280),
      proposedRuleEs:
        'En Tacos Gavilan los burritos, quesadillas y mulitas NO tienen tamaños (chico/mediano/grande): jamás preguntes "¿qué tamaño?", pregunta únicamente qué carne desea y si lo quiere Regular o Super.',
      proposedRuleEn:
        'At Tacos Gavilan, burritos, quesadillas, and mulitas do NOT have small/medium/large sizes: never ask "what size?", only ask which meat they want and Regular or Super.',
      avgLatencyMs: avgLat
    })
  }

  // 2) Interferencia de TV/YouTube/radio de fondo, turnos mezclados o corte a mitad de frase
  const bgNoiseTurn = turns.find((t) => {
    if (t.role !== 'customer') return false
    const txt = String(t.text || '').trim()
    if (!txt) return false
    if (isLikelyBackgroundMediaSpeech(txt)) return true
    const noisyAnalysis = extractDirectCustomerIntentFromNoisyTurn(txt)
    if (noisyAnalysis.hasMixedBackgroundNoise) return true
    const words = txt.split(/\s+/).filter(Boolean)
    if (words.length >= 7 && !FOOD_OR_DT_WORDS_RE.test(txt) && turns.some((k) => k.role === 'kore' && !/[.!?¡¿]$/.test(k.text.trim()))) {
      return true
    }
    return false
  })
  const repeatedBgApologyCount = turns.filter(
    (t) => t.role === 'kore' && /se\s+escuch[oó]\s+ruido\s+de\s+fondo|background\s+(?:noise|audio)/i.test(String(t.text || ''))
  ).length
  const cutOffKoreTurn = turns.find(
    (t) => t.role === 'kore' && t.text.trim().length > 4 && !/[.!?…"]$/.test(t.text.trim())
  )
  if (bgNoiseTurn || repeatedBgApologyCount >= 2 || bargeIns >= 3 || (avgLat !== null && avgLat > 2400)) {
    findings.push({
      storeId,
      sourceSessionId: sessionId,
      dedupeKey: `insight:vad_bg_noise:store_${storeId ?? 'all'}`,
      sourceType,
      itemKind: 'latency_insight',
      status: 'auto_applied',
      appliesToChannels: 'drive_thru_only',
      questionOrTrigger:
        avgLat !== null && avgLat > 2400
          ? `Latencia promedio elevada (${avgLat} ms) o interrupciones de audio (${bargeIns})`
          : 'Audio de fondo (TV/YouTube/conversación externa) mezclado con voz del cliente o interrumpiendo a Kore',
      customerQuote: bgNoiseTurn ? sanitizeRuleText(bgNoiseTurn.text, 260) : null,
      koreQuote: cutOffKoreTurn ? sanitizeRuleText(cutOffKoreTurn.text, 220) : null,
      proposedRuleEs:
        'VAD silenceDurationMs=1150 ms + Barge-In 128 ms (4 bloques, pre-ataque 192 ms, continuación suave 64 ms @ 0.024) + KoreCustomerHoldController (45 s) + isNonLatinNoiseTranscript ("जी के") + endsWithDanglingClauseConnector ("...no crema es", "...hablar con el") + isExplicitWholeOrderCancelIntent ("Olvídalo entonces" jamás cancela la orden).',
      proposedRuleEn:
        'VAD silenceDurationMs=1150 ms + Barge-In 128 ms (4 chunks, 192 ms pre-onset, 64 ms @ 0.024 continuation grace) + KoreCustomerHoldController (45 s) + isNonLatinNoiseTranscript ("जी के") + endsWithDanglingClauseConnector ("...no crema es", "...hablar con el") + isExplicitWholeOrderCancelIntent ("Olvídalo entonces" never cancels the order).',
      avgLatencyMs: avgLat
    })
  }

  // 2d) Manager en Drive-Thru: prohibido pedir nombre o teléfono de 10 dígitos en bocina (enviar directo a ventanilla)
  const custManagerTurn = turns.find(
    (t) => t.role === 'customer' && /\b(manager|gerente|encargad[oa]|supervisor)\b/i.test(t.text)
  )
  const korePhoneDemandTurn = turns.find(
    (t) =>
      t.role === 'kore' &&
      /\b(?:diez\s+d[ií]gitos|10\s+d[ií]gitos|n[uú]mero\s+de\s+tel[eé]fono|phone\s+number|10[\s-]*digit|devolver(?:le)?\s+la\s+llamada|call\s+you\s+back)\b/i.test(
        t.text
      )
  )
  if (custManagerTurn && korePhoneDemandTurn) {
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:kore_drive_thru_manager_window',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'drive_thru_only',
      questionOrTrigger: 'Cliente pide hablar con el manager en la bocina del Drive-Thru ("¿Puedo hablar con el manager?")',
      customerQuote: sanitizeRuleText(custManagerTurn.text, 240),
      koreQuote: sanitizeRuleText(korePhoneDemandTurn.text, 240),
      proposedRuleEs:
        'En la bocina del Drive-Thru está PROHIBIDO pedir nombre, teléfono de 10 dígitos, ticket o devolución de llamada cuando el cliente pide hablar con el manager/gerente; invítalo en 1 frase corta a pasar directo a la ventanilla donde el manager en turno lo atiende en persona, conservando su orden lista.',
      proposedRuleEn:
        'At the Drive-Thru speaker it is STRICTLY FORBIDDEN to ask for a name, 10-digit phone number, ticket, or callback when a customer asks to speak with the manager; kindly invite them in 1 short sentence to pull forward to the window where the manager on duty will assist in person, keeping their order intact.',
      avgLatencyMs: avgLat
    })
  }

  // 2e) Aritmética falsa en Mulita sin crema vs Mulita Regular + Guacamole
  const custCheaperMulitaTurn = turns.find(
    (t) =>
      t.role === 'customer' &&
      /\b(?:m[aá]s\s+barat[oa]|cheaper|conviene|sale\s+mejor)\b/i.test(t.text) &&
      turns.some((u) => /\bmulitas?\b/i.test(u.text))
  )
  const koreFalseSuperCheaperTurn = turns.find(
    (t) =>
      t.role === 'kore' &&
      /\b(?:s[uú]per\s+mulitas?\b[^.!?]{0,80}\b(?:m[aá]s\s+barat[oa]|m[aá]s\s+econ[oó]mic[oa]|ahorra)|sale\s+m[aá]s\s+barat[oa]\s+pedir(?:las?|los?)?\s+s[uú]per|super\s+mulitas?\b[^.!?]{0,80}\b(?:cheaper|saves))\b/i.test(
        t.text
      )
  )
  if (custCheaperMulitaTurn && koreFalseSuperCheaperTurn) {
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:kore_super_mulita_addon_math',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'both',
      questionOrTrigger: 'Cliente pregunta qué sale más barato: Super Mulita sin crema vs Mulita Regular con guacamole',
      customerQuote: sanitizeRuleText(custCheaperMulitaTurn.text, 240),
      koreQuote: sanitizeRuleText(koreFalseSuperCheaperTurn.text, 240),
      proposedRuleEs:
        'La Mulita y Quesadilla Regular YA incluyen queso Monterey Jack derretido: al quitar la crema de una Super Mulita ($5.99), la Mulita Regular ($4.79) + Guacamole ($0.99) = $5.78 SÍ es más barata ($0.21 menos c/u), mientras que en Super Burrito sin crema ($11.69 vs $13.17) y Super Quesadilla sin crema ($10.59 vs $11.18) el Super sí ahorra. Informar siempre la suma exacta del POS.',
      proposedRuleEn:
        'Regular Mulitas and Quesadillas ALREADY include melted Monterey Jack cheese: when removing sour cream from a Super Mulita ($5.99), Regular Mulita ($4.79) + Guacamole ($0.99) = $5.78 IS cheaper (saves $0.21 each), whereas Super Burrito without sour cream ($11.69 vs $13.17) and Super Quesadilla without sour cream ($10.59 vs $11.18) save money. Always state exact POS arithmetic.',
      avgLatencyMs: avgLat
    })
  }

  // 2f) Cancelación errónea de toda la orden ante frase ambigua ("Olvídalo entonces" / "Never mind")
  const hadCancelAction =
    String(session.outcome || '') === 'cancelled' ||
    turns.some(
      (t) =>
        ((t.role === 'system' || t.role === 'tool') &&
          /\b(?:cancel_order|cancel[oó]\s+la\s+orden|cancelled\s+the\s+order)\b/i.test(t.text)) ||
        (t.role === 'kore' &&
          /\b(?:he\s+cancelado\s+su\s+orden|su\s+orden\s+(?:ha\s+sido|qued[oó])\s+cancelada|cancelled\s+your\s+order|canceled\s+your\s+order)\b/i.test(
            t.text
          ))
    )
  const hadExplicitOrderCancel = turns.some((t) => t.role === 'customer' && isExplicitWholeOrderCancelIntent(t.text))
  const ambiguousCancelTurn = turns.find(
    (t) =>
      t.role === 'customer' &&
      /\b(?:olv[ií]dalo(?:\s+entonces)?|mejor\s+no|no\s+importa|d[eé]jalo\s+as[ií]|ya\s+d[eé]jalo|never\s*mind|forget\s+it|la\s+orden\s+s[ií]\s+la\s+quiero)\b/i.test(
        t.text
      )
  )
  if (hadCancelAction && !hadExplicitOrderCancel && ambiguousCancelTurn) {
    const cancelKoreTurn = turns.find((t) => t.role === 'kore' && /\bcancelad[oa]|cancelled|canceled\b/i.test(t.text))
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:kore_no_cancel_on_olvidalo',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'drive_thru_only',
      questionOrTrigger: 'Frase ambigua de subtema ("Olvídalo entonces" / "Never mind") NO debe cancelar una orden activa',
      customerQuote: sanitizeRuleText(ambiguousCancelTurn.text, 240),
      koreQuote: cancelKoreTurn ? sanitizeRuleText(cancelKoreTurn.text, 240) : null,
      proposedRuleEs:
        'PROHIBIDO ejecutar cancel_order ante descartes ambiguos como "Olvídalo", "Olvídalo entonces", "Mejor no", "Never mind" o al cancelar hablar con el manager; mantener el ticket intacto y solo cancelar si el cliente pide explícitamente cancelar toda su orden o pasa al comedor por EBT.',
      proposedRuleEn:
        'STRICTLY FORBIDDEN to call cancel_order on ambiguous dismissals like "Olvídalo", "Olvídalo entonces", "Mejor no", "Never mind", or when canceling speaking to the manager; keep the food order intact unless the customer explicitly asks to cancel their entire order or goes inside for EBT.',
      avgLatencyMs: avgLat
    })
  }

  // 2c) Concordancia gramatical femenina de Kore en español (evitar "aquí sigo listo" / "estoy listo")
  const koreMasculineSelfTurn = turns.find(
    (t) => t.role === 'kore' && /\b(?:aqu[ií]\s+sigo\s+listo|estoy\s+listo|quedo\s+atento)\b/i.test(t.text)
  )
  if (koreMasculineSelfTurn) {
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:kore_spanish_feminine_agreement',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'both',
      questionOrTrigger: 'Concordancia gramatical femenina de Kore en español ("lista" / "atenta", nunca "listo")',
      customerQuote: sanitizeRuleText(
        turns.find((t) => t.role === 'customer' && /\b(?:voz\s+de\s+mujer|listo)\b/i.test(t.text))?.text || 'Ahi voy, espérame, estoy pensando.',
        240
      ),
      koreQuote: sanitizeRuleText(koreMasculineSelfTurn.text, 240),
      proposedRuleEs:
        'Kore tiene voz e identidad femenina: al referirse a sí misma en español debe usar SIEMPRE adjetivos femeninos ("aquí quedo lista", "estoy lista", "atenta", "segura"; jamás "listo" ni "atento") y fórmulas neutras para el cliente ("tómese su tiempo", "cuando guste").',
      proposedRuleEn:
        'Kore has a female voice and identity: when referring to herself in Spanish she must ALWAYS use feminine adjectives ("aquí quedo lista", "estoy lista", "atenta", "segura"; never masculine "listo" or "atento") and polite neutral phrasing for the customer ("tómese su tiempo", "cuando guste").',
      avgLatencyMs: avgLat
    })
  }

  // 2b) Error real de ingredientes: decir que el Sope lleva lechuga / lettuce
  const koreSopeLettuceTurn = turns.find(
    (t) =>
      t.role === 'kore' &&
      /\b(lechuga|lettuce)\b/i.test(t.text) &&
      !/\b(?:no\s+lleva|sin\s+lechuga|no\s+lettuce|without\s+lettuce|tortas?)\b/i.test(t.text) &&
      turns.some((u) => /\bsopes?\b/i.test(u.text))
  )
  if (koreSopeLettuceTurn) {
    findings.push({
      storeId: null,
      sourceSessionId: sessionId,
      dedupeKey: 'rule:sope_official_recipe_no_lettuce',
      sourceType,
      itemKind: 'learned_rule',
      status: 'auto_applied',
      appliesToChannels: 'both',
      questionOrTrigger: 'Cliente pregunta qué lleva el Sope (ingredientes oficiales sin lechuga)',
      customerQuote: sanitizeRuleText(
        turns.find((t) => t.role === 'customer' && /\bsopes?\b/i.test(t.text))?.text || '¿Qué lleva el sope?',
        240
      ),
      koreQuote: sanitizeRuleText(koreSopeLettuceTurn.text, 240),
      proposedRuleEs:
        'En Tacos Gavilan el Sope es una tortilla gruesa de maíz con frijoles refritos, crema (sour cream), queso Cotija desmoronado y la carne a elegir (el Sope de Queso lleva Queso Fresco y Cotija); JAMÁS lleva lechuga ni tomate.',
      proposedRuleEn:
        'At Tacos Gavilan, a Sope is a thick corn tortilla topped with refried beans, sour cream, crumbled Cotija cheese, and choice of meat (Cheese Sope uses Queso Fresco and Cotija); it NEVER comes with lettuce or tomato.',
      avgLatencyMs: avgLat
    })
  }

  // 3) Frases ambiguas de micrófono / posibles colisiones STT al responder preguntas de Kore (ej. "Quiero dos nada" por "dos de asada")
  for (let i = 0; i < turns.length; i++) {
    const cur = turns[i]
    if (cur.role !== 'customer') continue
    const txt = cur.text.trim()
    if (/\b(?:quiero|dame|deme|ponme)\s+(?:un|una|uno|dos|tres|cuatro|\d+)\s+nada\b/i.test(txt)) {
      const prevKore = turns.slice(0, i).reverse().find((t) => t.role === 'kore')
      const nextKore = turns.slice(i + 1).find((t) => t.role === 'kore')
      findings.push({
        storeId,
        sourceSessionId: sessionId,
        dedupeKey: `doubt:stt_collision_dos_nada:${shortHash(txt)}`,
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        appliesToChannels: 'both',
        questionOrTrigger: 'Audio ambiguo en micrófono al elegir carne ("Quiero dos nada" — posible colisión STT con "dos de asada")',
        customerQuote: sanitizeRuleText(txt, 240),
        koreQuote: sanitizeRuleText(nextKore?.text || prevKore?.text || '', 240),
        proposedRuleEs:
          'Si el micrófono transcribe "dos nada" / "tres nada" cuando se pregunta la carne, confirmar en frase corta "¿Dos de asada, regulares o super?" antes de agregar al ticket.',
        proposedRuleEn:
          'If the microphone transcribes "dos nada" / "tres nada" while asking for meat, confirm briefly "Two carne asada, regular or super?" before adding to the ticket.',
        avgLatencyMs: avgLat
      })
    }
  }

  // 4) Preguntas del cliente en sesiones abandonadas o con errores de herramienta no resueltos
  const toolErrorTurn = turns.find((t) => t.role === 'tool' && /\b(error|not on this store|invalid|no_results)\b/i.test(t.text))
  if (toolErrorTurn) {
    const lastCust = [...turns].reverse().find((t) => t.role === 'customer' && FOOD_OR_DT_WORDS_RE.test(t.text))
    findings.push({
      storeId,
      sourceSessionId: sessionId,
      dedupeKey: `doubt:tool_rejection:${shortHash(toolErrorTurn.text)}`,
      sourceType,
      itemKind: 'doubt_for_owner',
      status: 'needs_owner_input',
      appliesToChannels: 'both',
      questionOrTrigger: `Solicitud rechazada por el motor de menú: ${sanitizeRuleText(toolErrorTurn.text, 120)}`,
      customerQuote: lastCust ? sanitizeRuleText(lastCust.text, 240) : null,
      koreQuote: sanitizeRuleText(toolErrorTurn.text, 240),
      proposedRuleEs: 'Definir qué alternativa oficial del menú debe ofrecer Kore cuando un cliente pida esta combinación.',
      proposedRuleEn: 'Define which official menu alternative Kore should offer when a customer requests this combination.',
      avgLatencyMs: avgLat
    })
  }

  return findings
}

/**
 * Construye de forma determinista un hallazgo prioritario cuando la cajera abrió su línea `A1` del headset
 * (`role === 'cashier'` en `transcript` o `order_json.cashierIntervention?.triggered === true`), capturando
 * exactamente qué pidió el cliente antes de la intervención y cómo lo resolvió la cajera en la bocina exterior.
 */
export function buildDeterministicCashierInterventionFinding(
  session: any,
  sourceType: KoreLearningSourceType = 'auto_analysis'
): CandidateFinding | null {
  const turns: Array<{ role: string; text: string }> = Array.isArray(session?.transcript) ? session.transcript : []
  const cashierTurns = turns.filter((t) => t?.role === 'cashier' && String(t.text || '').trim().length > 0)
  const ciMeta = session?.order_json?.cashierIntervention
  const triggeredMeta = Boolean(ciMeta && typeof ciMeta === 'object' && ciMeta.triggered === true)
  if (cashierTurns.length === 0 && !triggeredMeta) return null

  const sessionId = String(session.id)
  const storeId = Number.isInteger(Number(session.store_id)) ? Number(session.store_id) : null
  const avgLat = Number.isFinite(Number(session.avg_latency_ms)) ? Number(session.avg_latency_ms) : null
  const firstCashierIdx = turns.findIndex((t) => t?.role === 'cashier' && String(t.text || '').trim().length > 0)
  const sliceEnd = firstCashierIdx >= 0 ? firstCashierIdx : turns.length

  const priorCustomerTurns = turns
    .slice(0, sliceEnd)
    .filter((t) => t?.role === 'customer' && String(t.text || '').trim().length > 0)
  const lastCustomerBefore =
    priorCustomerTurns[priorCustomerTurns.length - 1]?.text ||
    [...turns].reverse().find((t) => t?.role === 'customer' && String(t.text || '').trim().length > 0)?.text ||
    ''
  const priorKoreTurn = turns
    .slice(0, sliceEnd)
    .reverse()
    .find((t) => t?.role === 'kore' && String(t.text || '').trim().length > 0)

  const cashierJoinedRaw = cashierTurns.map((t) => String(t.text || '').trim()).filter(Boolean).join(' / ')
  const cleanCust = sanitizeRuleText(lastCustomerBefore, 240)
  const cleanCashier = sanitizeRuleText(cashierJoinedRaw, 240)
  const triggerSrc = String(ciMeta?.triggerSource || (cashierTurns.length > 0 ? 'verbal_cue' : 'manual_button'))

  const fpSeed = normalizeQuestionFingerprint(cleanCust || cleanCashier || sessionId)
  const dedupeKey = `cashier_takeover:${shortHash(fpSeed || sessionId)}`

  const questionOrTrigger = cleanCust
    ? `Intervención de cajera en Headset (${triggerSrc}): "${cleanCust.slice(0, 125)}"`
    : `Intervención de cajera en Headset (${triggerSrc}) durante atención en Drive-Thru`

  const koreQuoteParts: string[] = []
  if (cleanCashier) koreQuoteParts.push(`[Cajera Headset A1]: ${cleanCashier}`)
  else if (priorKoreTurn?.text) koreQuoteParts.push(sanitizeRuleText(priorKoreTurn.text, 220))
  const koreQuote = sanitizeRuleText(koreQuoteParts.join(' | '), 260) || null

  const hasCashierResolution = cleanCashier.length >= 6
  const proposedRuleEs = hasCashierResolution
    ? sanitizeRuleText(
        `Cuando el cliente plantee "${cleanCust || 'esta situación especial'}", aplicar el criterio dado por caja en Tacos Gavilan: ${cleanCashier}`,
        380
      )
    : 'Definir la respuesta oficial que Kore debe dar en Tacos Gavilan para evitar que la cajera tenga que intervenir por headset.'
  const proposedRuleEn = hasCashierResolution
    ? sanitizeRuleText(
        `When a customer asks "${cleanCust || 'this special case'}", apply the Tacos Gavilan cashier's resolution: ${cleanCashier}`,
        380,
        'en'
      )
    : 'Define the official Tacos Gavilan response Kore should give so the cashier does not need to take over on the headset.'

  return {
    storeId,
    sourceSessionId: sessionId,
    dedupeKey,
    sourceType,
    itemKind: hasCashierResolution ? 'learned_rule' : 'doubt_for_owner',
    status: 'needs_owner_input',
    appliesToChannels: inferAppliesToChannels({
      questionOrTrigger,
      proposedRuleEs,
      proposedRuleEn,
      customerQuote: cleanCust,
      dedupeKey,
      itemKind: hasCashierResolution ? 'learned_rule' : 'doubt_for_owner'
    }),
    questionOrTrigger,
    customerQuote: cleanCust || null,
    koreQuote,
    proposedRuleEs,
    proposedRuleEn,
    avgLatencyMs: avgLat
  }
}

/**
 * Extrae hallazgos forenses de una llamada telefónica terminada (`phone_calls`), analizando tanto `unanswered_question`
 * como el `transcript` JSONB (respuestas "no cuento con información", correcciones del cliente, fricciones de menú/recados).
 * Deduplica dentro de la misma llamada por `dedupeKey` para que un `phone_calls.id` jamás sume más de +1.
 */
export function extractPhoneCallFindings(call: any): CandidateFinding[] {
  const callId = String(call.id)
  const storeId = Number.isInteger(Number(call.store_id)) ? Number(call.store_id) : null
  const turns: Array<{ role: string; text: string; toolName?: string }> = Array.isArray(call.transcript)
    ? call.transcript
    : []
  const summaryText = String(call.summary || '')

  // Omitir corridas sintéticas del benchmark de velocidad telefónica de otros módulos
  const rawBlob = `${summaryText} ${turns.map((t) => String(t.text || '')).join(' ')}`
  if (/\b(?:TEST_SMOKE_\w+|SMOKE_TEST_\w+)\b/i.test(rawBlob)) {
    return []
  }

  const out: CandidateFinding[] = []
  const seenKeys = new Set<string>()
  const pushUnique = (f: CandidateFinding) => {
    if (seenKeys.has(f.dedupeKey)) return
    seenKeys.add(f.dedupeKey)
    out.push(f)
  }

  // 1) Pregunta explícita marcada como `unanswered_question`
  const qText = sanitizeRuleText(call.unanswered_question, 220)
  if (qText.length >= 8) {
    const fp = normalizeQuestionFingerprint(qText)
    if (fp.length >= 6) {
      let assistantReply = ''
      for (let i = 0; i < turns.length; i++) {
        if (turns[i].role === 'user' && normalizeQuestionFingerprint(turns[i].text).includes(fp.slice(0, 18))) {
          const nextAssistant = turns.slice(i + 1).find((t) => t.role === 'assistant')
          if (nextAssistant?.text) assistantReply = nextAssistant.text
          break
        }
      }
      pushUnique({
        storeId,
        sourceSessionId: null,
        sourcePhoneCallId: callId,
        dedupeKey: `phone_q:${shortHash(fp)}`,
        sourceType: 'phone_call',
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        appliesToChannels: 'both',
        questionOrTrigger: `Pregunta sin respuesta en llamada telefónica: ${qText}`,
        customerQuote: qText,
        koreQuote: sanitizeRuleText(assistantReply || summaryText, 240) || null,
        proposedRuleEs: 'Definir criterio oficial de respuesta para tanto teléfono como Drive-Thru.',
        proposedRuleEn: 'Define official response guideline for both phone and Drive-Thru.'
      })
    }
  }

  // 2) En transcript: asistente admite que no cuenta con información oficial sobre un tema real del restaurante
  const RESTAURANT_RELEVANT_QUESTION_RE =
    /\b(tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|platos?|charolas?|fiesta|party|paquetes?|aguas?|horchata|jamaica|pi[nñ]a|tamarindo|champurrado|caf[eé]|flan|cheesecake|postres?|pastel(?:es)?|cumplea[nñ]os|carnes?|asada|pastor|pollo|cabeza|lengua|buche|chorizo|carnitas|queso|frijol|arroz|guacamole|crema|salsas?|condimentos?|lim[oó]n|cebolla|cilantro|tortillas?|gluten|vegan[oa]|vegetarian[oa]|alergia|precio|cu[aá]nto|cuesta|cobran|pago|efectivo|tarjeta|ebt|apple\s*pay|propina|descuento|convenio|escuela|militar|senior|estudiante|cup[oó]n|promoci[oó]n|horario|abren|cierran|abierto|cerrado|sucursal|tienda|direcci[oó]n|estacionamiento|parking|ba[nñ]o|comedor|mesa|silla|mascotas?|perros?|drive[\s-]*thru|ventana|pedido|orden|ticket|recibo|reembolso|doordash|uber|grubhub|repartidor|delivery|catering|evento|trabajo|empleo|vacante|gerente|manager)\b/i

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]
    if (t.role !== 'assistant') continue
    if (
      /\b(no\s+cuento\s+con\s+(?:esa\s+)?informaci[oó]n|no\s+tengo\s+(?:esa\s+|confirmada\s+)?informaci[oó]n|don'?t\s+have\s+(?:official\s+)?information)\b/i.test(
        String(t.text || '')
      )
    ) {
      const prevUser = turns
        .slice(0, i)
        .reverse()
        .find((u) => u.role === 'user' && String(u.text || '').trim().length >= 8)
      if (prevUser && RESTAURANT_RELEVANT_QUESTION_RE.test(String(prevUser.text || ''))) {
        const uQuote = sanitizeRuleText(prevUser.text, 220)
        const fp = normalizeQuestionFingerprint(uQuote)
        if (fp.length >= 6) {
          pushUnique({
            storeId,
            sourceSessionId: null,
            sourcePhoneCallId: callId,
            dedupeKey: `phone_q:${shortHash(fp)}`,
            sourceType: 'phone_call',
            itemKind: 'doubt_for_owner',
            status: 'needs_owner_input',
            appliesToChannels: 'both',
            questionOrTrigger: `Pregunta sin respuesta en llamada telefónica: ${uQuote}`,
            customerQuote: uQuote,
            koreQuote: sanitizeRuleText(t.text, 240),
            proposedRuleEs: 'Definir criterio oficial de respuesta para tanto teléfono como Drive-Thru.',
            proposedRuleEn: 'Define official response guideline for both phone and Drive-Thru.'
          })
        }
      }
    }
  }

  // 3) Fricción de cliente corrigiendo una asunción errónea o candado indebido de orden equivocada al pedir gerente
  const hasWrongOrderMention = turns.some(
    (t) =>
      t.role === 'user' &&
      /\b(mal|equivocad[oa]|incomplet[oa]|falt[oó]|err[oó]ne[oa]|wrong|missing|fr[ií][oa]|quemad[oa])\b/i.test(String(t.text || ''))
  )
  const wrongGateTool = turns.find(
    (t) => t.role === 'tool' && /missingOrderReviewFields/i.test(String(t.text || '')) && !hasWrongOrderMention
  )
  if (wrongGateTool) {
    const userReq = turns.find((t) => t.role === 'user' && /\b(manager|gerente|encargad[oa])\b/i.test(String(t.text || '')))
    const aiDemand = turns.find((t) => t.role === 'assistant' && /\b(n[uú]mero\s+de\s+ticket|receipt)\b/i.test(String(t.text || '')))
    pushUnique({
      storeId: null,
      sourceSessionId: null,
      sourcePhoneCallId: callId,
      dedupeKey: 'phone_friction:manager_request_without_wrong_order_ticket_gate',
      sourceType: 'phone_call',
      itemKind: 'doubt_for_owner',
      status: 'needs_owner_input',
      appliesToChannels: 'phone_only',
      questionOrTrigger:
        'Fricción detectada en llamada telefónica: cliente pidió hablar con el gerente sin reportar orden equivocada y se le exigió número de ticket',
      customerQuote: sanitizeRuleText(userReq?.text || 'Me gustaría hablar con el manager.', 220),
      koreQuote: sanitizeRuleText(aiDemand?.text || wrongGateTool.text, 240),
      proposedRuleEs:
        'Cuando el cliente pida hablar con el gerente por una consulta general o cotización (sin reportar orden equivocada/incompleta), pedir solo nombre, teléfono de 10 dígitos y motivo breve sin exigir número de ticket.',
      proposedRuleEn:
        'When a caller asks to speak with the manager for a general inquiry or quote (not reporting a wrong/incomplete order), ask only for name, 10-digit phone, and brief reason without requiring a ticket number.'
    })
  } else {
    for (let i = 0; i < turns.length; i++) {
      const cur = turns[i]
      if (cur.role !== 'user') continue
      if (
        /\b(pero\s+yo\s+no\s+(?:le\s+)?dije|no\s+ped[ií]\s+eso|eso\s+no\s+fue\s+lo\s+que\s+pregunt[eé]|me\s+pregunta\s+fue|mi\s+pregunta\s+(?:era|fue|es)|te\s+estoy\s+preguntando|genera\s+la\s+respuesta\s+que\s+no\s+existe|no\s+me\s+entendiste|that'?s\s+not\s+what\s+i\s+asked|you\s+misunderstood)\b/i.test(
          String(cur.text || '')
        )
      ) {
        const prevAi = turns.slice(0, i).reverse().find((a) => a.role === 'assistant')
        const uTxt = sanitizeRuleText(cur.text, 220)
        pushUnique({
          storeId,
          sourceSessionId: null,
          sourcePhoneCallId: callId,
          dedupeKey: `phone_friction:correction:${shortHash(normalizeQuestionFingerprint(prevAi?.text || uTxt))}`,
          sourceType: 'phone_call',
          itemKind: 'doubt_for_owner',
          status: 'needs_owner_input',
          appliesToChannels: 'both',
          questionOrTrigger: `Fricción detectada en llamada telefónica: corrección del cliente ("${uTxt.slice(0, 90)}")`,
          customerQuote: uTxt,
          koreQuote: prevAi ? sanitizeRuleText(prevAi.text, 240) : null,
          proposedRuleEs: 'Revisar la respuesta anterior y definir el criterio exacto para teléfono y Drive-Thru.',
          proposedRuleEn: 'Review the prior response and define the exact guideline for both phone and Drive-Thru.'
        })
      }
    }
  }

  return out
}

async function extractLlmSessionDoubts(
  session: any,
  sourceType: KoreLearningSourceType,
  cashierFallback: CandidateFinding | null = null
): Promise<CandidateFinding[]> {
  const turns: Array<{ role: string; text: string }> = Array.isArray(session.transcript) ? session.transcript : []
  const meaningfulCustomerTurns = turns.filter((t) => t.role === 'customer' && FOOD_OR_DT_WORDS_RE.test(t.text))
  if (!cashierFallback && (meaningfulCustomerTurns.length < 2 || session.outcome === 'confirmed')) return []

  try {
    const compactTranscript = turns
      .slice(0, 28)
      .map((t) => `${t.role.toUpperCase()}: ${String(t.text || '').slice(0, 200)}`)
      .join('\n')
    const prompt = cashierFallback
      ? [
          'Analiza esta sesión de Drive-Thru de Tacos Gavilan donde la CAJERA HUMANA abrió su línea de Headset (CASHIER) para resolver una situación especial o anómala.',
          'Identifica exactamente: (1) qué pidió o preguntó el cliente justo antes de que entrara la cajera, y (2) cómo lo resolvió/contestó la cajera en la bocina exterior.',
          'Usa estrictamente la marca "Tacos Gavilan" (jamás agregues "El"), precios solo en USD (jamás pesos) y Regular o Super en comida.',
          'Devuelve SOLO JSON {"items":[{"itemKind":"learned_rule","questionOrTrigger":"...","customerQuote":"...","koreQuote":"[Cajera Headset A1]: ...","proposedRuleEs":"...","proposedRuleEn":"..."}]} (usa "doubt_for_owner" si la cajera no dio un criterio reutilizable claro).',
          compactTranscript
        ].join('\n')
      : [
          'Analiza esta transcripción de simulación del Drive-Thru de Tacos Gavilan.',
          'Devuelve SOLO JSON {"items":[...]} (máximo 1 hallazgo nuevo, o [] si ya está cubierto por: (a) no decir tamaño en burritos, (b) ruido de TV de fondo, (c) colisión "Quiero dos nada").',
          'Solo reporta una duda genuina de negocio/menú donde el dueño deba definir cómo contestar.',
          'Formato de cada item: {"questionOrTrigger":"...","customerQuote":"...","koreQuote":"...","proposedRuleEs":"...","proposedRuleEn":"..."}',
          compactTranscript
        ].join('\n')

    const llmRes = await generateGeminiLearningJson<{ items?: any[] }>({
      models: GEMINI_REST_MODELS,
      prompt,
      maxOutputTokens: 380,
      temperature: 0.1,
      timeoutMs: 5500
    })
    if (!llmRes?.data) return []

    const arr = Array.isArray(llmRes.data?.items) ? llmRes.data.items.slice(0, 1) : []
    const out: CandidateFinding[] = []
    for (const it of arr) {
      const trigger = sanitizeRuleText(it?.questionOrTrigger, 180)
      if (trigger.length < 10) continue
      if (
        !cashierFallback &&
        /tamañ|size|red bull|verstappen|checo|dos nada|gta|xbox|modders|youtube|capturadora|30 fps|ruido de fondo|background noise|me escuchas|can you hear me|sope.*lechuga|lechuga.*sope|voz de mujer|sigo listo|no me apresures|estoy pensando|olvidalo|never mind|hablar con el manager.*ventanilla/i.test(
          trigger
        )
      ) {
        continue
      }
      const rawKind = it?.itemKind === 'learned_rule' ? 'learned_rule' : cashierFallback?.itemKind || 'doubt_for_owner'
      const rawKoreQuote = sanitizeRuleText(it?.koreQuote, 240)
      const finalKoreQuote =
        cashierFallback && rawKoreQuote && !/cajera/i.test(rawKoreQuote)
          ? sanitizeRuleText(`[Cajera Headset A1]: ${rawKoreQuote}`, 260)
          : rawKoreQuote || cashierFallback?.koreQuote || null
      out.push({
        storeId: Number.isInteger(Number(session.store_id)) ? Number(session.store_id) : null,
        sourceSessionId: String(session.id),
        dedupeKey: cashierFallback ? cashierFallback.dedupeKey : `doubt:llm:${shortHash(trigger)}`,
        sourceType,
        itemKind: rawKind,
        status: 'needs_owner_input',
        appliesToChannels: cashierFallback ? cashierFallback.appliesToChannels : 'both',
        questionOrTrigger: trigger,
        customerQuote: sanitizeRuleText(it?.customerQuote, 240) || cashierFallback?.customerQuote || null,
        koreQuote: finalKoreQuote,
        proposedRuleEs: sanitizeRuleText(it?.proposedRuleEs, 380) || cashierFallback?.proposedRuleEs || null,
        proposedRuleEn: sanitizeRuleText(it?.proposedRuleEn, 380, 'en') || cashierFallback?.proposedRuleEn || null,
        avgLatencyMs: Number.isFinite(Number(session.avg_latency_ms)) ? Number(session.avg_latency_ms) : null
      })
    }
    return out
  } catch {
    return []
  }
}

async function upsertCandidateFinding(f: CandidateFinding): Promise<'inserted' | 'incremented' | 'skipped'> {
  const appliesToChannels: KoreAppliesToChannels = isValidAppliesToChannels(f.appliesToChannels)
    ? f.appliesToChannels
    : inferAppliesToChannels({
        questionOrTrigger: f.questionOrTrigger,
        proposedRuleEs: f.proposedRuleEs,
        proposedRuleEn: f.proposedRuleEn,
        customerQuote: f.customerQuote,
        dedupeKey: f.dedupeKey,
        itemKind: f.itemKind
      })

  // No contaminar Drive-Thru con dudas exclusivas de telefonía extraídas de phone_calls
  if (f.sourcePhoneCallId && appliesToChannels === 'phone_only') {
    return 'skipped'
  }

  let { data: existing } = await supabaseAdmin
    .from('dt_kore_learning_items')
    .select(SELECT_LEARNING_COLS)
    .eq('dedupe_key', f.dedupeKey)
    .maybeSingle()

  // Si phone-agent-learning ya sincronizó un gemelo para la misma llamada o huella, reutilizarlo sin duplicar
  if (!existing && f.sourcePhoneCallId && f.itemKind !== 'latency_insight') {
    const { data: sameCallRows } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select(SELECT_LEARNING_COLS)
      .eq('source_phone_call_id', f.sourcePhoneCallId)
      .neq('item_kind', 'latency_insight')
      .limit(5)
    if (sameCallRows && sameCallRows.length > 0) {
      existing = sameCallRows[0]
    }
  }

  if (existing?.id) {
    if (existing.status === 'dismissed') {
      return 'skipped'
    }
    const nextEvidence = Math.max(1, Number(existing.evidence_count || 1)) + 1
    const nextLat =
      f.avgLatencyMs !== null && f.avgLatencyMs !== undefined
        ? existing.avg_latency_ms !== null && existing.avg_latency_ms !== undefined
          ? Math.round((Number(existing.avg_latency_ms) + f.avgLatencyMs) / 2)
          : f.avgLatencyMs
        : existing.avg_latency_ms
    const promoteGlobal =
      existing.store_id !== null &&
      existing.store_id !== undefined &&
      (f.storeId === null || Number(existing.store_id) !== Number(f.storeId))

    const updateFields: Record<string, any> = {
      evidence_count: nextEvidence,
      avg_latency_ms: nextLat,
      updated_at: new Date().toISOString()
    }
    if (promoteGlobal) updateFields.store_id = null
    if (
      existing.item_kind === 'latency_insight' &&
      existing.status === 'auto_applied' &&
      !existing.owner_instruction
    ) {
      updateFields.question_or_trigger = f.questionOrTrigger
      updateFields.proposed_rule_es = f.proposedRuleEs
      updateFields.proposed_rule_en = f.proposedRuleEn
      if (f.customerQuote) updateFields.customer_quote = f.customerQuote
      if (f.koreQuote) updateFields.kore_quote = f.koreQuote
    }

    const { data: updExisting } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .update(updateFields)
      .eq('id', existing.id)
      .select(SELECT_LEARNING_COLS)
      .maybeSingle()

    if (
      updExisting &&
      updExisting.item_kind !== 'latency_insight' &&
      !updExisting.synced_phone_item_id &&
      (updExisting.applies_to_channels === 'both' || updExisting.applies_to_channels === 'phone_only')
    ) {
      await syncLearningItemToPhoneKnowledgeBase(updExisting)
    }
    return 'incremented'
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('dt_kore_learning_items')
    .insert({
      store_id: f.storeId,
      source_session_id: f.sourceSessionId,
      source_phone_call_id: f.sourcePhoneCallId ?? null,
      applies_to_channels: appliesToChannels,
      dedupe_key: f.dedupeKey,
      source_type: f.sourceType,
      item_kind: f.itemKind,
      status: f.status,
      question_or_trigger: f.questionOrTrigger,
      customer_quote: f.customerQuote ?? null,
      kore_quote: f.koreQuote ?? null,
      proposed_rule_es: f.proposedRuleEs ?? null,
      proposed_rule_en: f.proposedRuleEn ?? null,
      evidence_count: 1,
      avg_latency_ms: f.avgLatencyMs ?? null
    })
    .select(SELECT_LEARNING_COLS)
    .single()

  if (error || !inserted) return 'skipped'

  if (
    inserted.item_kind !== 'latency_insight' &&
    (appliesToChannels === 'both' || appliesToChannels === 'phone_only')
  ) {
    await syncLearningItemToPhoneKnowledgeBase(inserted)
  }

  return 'inserted'
}

/**
 * Analiza de forma idempotente las simulaciones pendientes de `dt_kore_sim_sessions` (`analyzed_at IS NULL`) y las
 * llamadas telefónicas terminadas pendientes de `phone_calls` (`kore_analyzed_at IS NULL`, `turns_count > 0`).
 */
export async function analyzeUnprocessedKoreSessions(opts?: {
  storeId?: number | null
  limit?: number
  includePhoneCalls?: boolean
  triggerSource?: KoreLearningSourceType
}): Promise<{
  analyzedSessionsCount: number
  analyzedPhoneCallsCount: number
  insertedItems: number
  incrementedItems: number
  phoneInsightsAdded: number
}> {
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(opts?.limit) || 25)))
  const sourceType: KoreLearningSourceType = opts?.triggerSource || 'dt_simulation'

  let q = supabaseAdmin
    .from('dt_kore_sim_sessions')
    .select(
      'id, store_id, started_at, ended_at, duration_sec, lang, transcript, order_json, outcome, avg_latency_ms, p95_latency_ms, barge_in_count, session_kind, analyzed_at'
    )
    .is('analyzed_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (opts?.storeId && Number.isInteger(opts.storeId) && opts.storeId > 0) {
    q = q.eq('store_id', opts.storeId)
  }

  const { data: sessions, error } = await q
  if (error) throw new Error(`Error consultando sesiones por analizar: ${error.message}`)

  let insertedItems = 0
  let incrementedItems = 0
  const list = sessions || []

  for (const s of list) {
    const det = extractDeterministicSessionFindings(s, sourceType)
    const cashierFallback = buildDeterministicCashierInterventionFinding(s, sourceType)
    const llm = await extractLlmSessionDoubts(s, sourceType, cashierFallback)
    const combinedFindings =
      cashierFallback && !llm.some((item) => item.dedupeKey === cashierFallback.dedupeKey)
        ? [...det, cashierFallback, ...llm]
        : [...det, ...llm]
    for (const f of combinedFindings) {
      const outcome = await upsertCandidateFinding(f)
      if (outcome === 'inserted') insertedItems++
      else if (outcome === 'incremented') incrementedItems++
    }
    await supabaseAdmin
      .from('dt_kore_sim_sessions')
      .update({ analyzed_at: new Date().toISOString() })
      .eq('id', s.id)
  }

  let phoneInsightsAdded = 0
  let analyzedPhoneCallsCount = 0
  if (opts?.includePhoneCalls !== false) {
    let pq = supabaseAdmin
      .from('phone_calls')
      .select('id, store_id, source, status, turns_count, unanswered_question, summary, transcript, started_at, ended_at, kore_analyzed_at')
      .is('kore_analyzed_at', null)
      .gt('turns_count', 0)
      .not('status', 'in', '("in_progress","ringing","queued")')
      .order('started_at', { ascending: true })
      .limit(40)

    if (opts?.storeId && Number.isInteger(opts.storeId) && opts.storeId > 0) {
      pq = pq.eq('store_id', opts.storeId)
    }

    const { data: pRows } = await pq
    for (const pr of pRows || []) {
      const callFindings = extractPhoneCallFindings(pr)
      for (const cf of callFindings) {
        const res = await upsertCandidateFinding(cf)
        if (res === 'inserted') {
          phoneInsightsAdded++
          insertedItems++
        } else if (res === 'incremented') {
          incrementedItems++
        }
      }
      await supabaseAdmin
        .from('phone_calls')
        .update({ kore_analyzed_at: new Date().toISOString() })
        .eq('id', (pr as any).id)
      analyzedPhoneCallsCount++
    }
  }

  invalidateKoreLearnedRulesCache()
  invalidateKoreKnowledgeCache()
  return {
    analyzedSessionsCount: list.length,
    analyzedPhoneCallsCount,
    insertedItems,
    incrementedItems,
    phoneInsightsAdded
  }
}

/** Lista los items de aprendizaje y estadísticas consolidadas para una sucursal (o globales si storeId es null). */
export async function getKoreLearningDashboard(storeId?: number | null): Promise<{
  items: KoreLearningItemDto[]
  stats: KoreLearningStats
}> {
  let itemsQuery = supabaseAdmin
    .from('dt_kore_learning_items')
    .select(SELECT_LEARNING_COLS)
    .order('created_at', { ascending: false })
    .limit(80)

  if (storeId && Number.isInteger(storeId) && storeId > 0) {
    itemsQuery = itemsQuery.or(`store_id.is.null,store_id.eq.${Math.trunc(storeId)}`)
  }

  let sessionsQuery = supabaseAdmin
    .from('dt_kore_sim_sessions')
    .select('id, analyzed_at, avg_latency_ms')
    .order('created_at', { ascending: false })
    .limit(200)

  if (storeId && Number.isInteger(storeId) && storeId > 0) {
    sessionsQuery = sessionsQuery.eq('store_id', Math.trunc(storeId))
  }

  const [{ data: itemRows, error: itemErr }, { data: simRows, error: simErr }] = await Promise.all([
    itemsQuery,
    sessionsQuery
  ])
  if (itemErr) throw new Error(`Error consultando items de aprendizaje: ${itemErr.message}`)
  if (simErr) throw new Error(`Error consultando telemetría de sesiones: ${simErr.message}`)

  const items = (itemRows || [])
    .map(mapLearningRowToDto)
    .filter((i) => !(i.status === 'needs_owner_input' && i.appliesToChannels === 'phone_only'))
  const pendingDoubts = items.filter((i) => i.status === 'needs_owner_input').length
  const activeRules = items.filter(
    (i) => (i.status === 'approved' || i.status === 'auto_applied') && i.itemKind !== 'latency_insight'
  ).length
  const syncedToPhoneCount = items.filter(
    (i) =>
      (i.status === 'approved' || i.status === 'auto_applied') &&
      i.itemKind !== 'latency_insight' &&
      (Boolean(i.syncedKbId) || Boolean(i.syncedPhoneItemId)) &&
      (i.appliesToChannels === 'both' || i.appliesToChannels === 'phone_only')
  ).length

  const sims = simRows || []
  const analyzedSessions = sims.filter((s: any) => Boolean(s.analyzed_at)).length
  const latValues = sims
    .map((s: any) => Number(s.avg_latency_ms))
    .filter((v: number) => Number.isFinite(v) && v > 0)
  const avgLatencyMs =
    latValues.length > 0 ? Math.round(latValues.reduce((a: number, b: number) => a + b, 0) / latValues.length) : null

  return {
    items,
    stats: {
      pendingDoubts,
      activeRules,
      analyzedSessions,
      avgLatencyMs,
      syncedToPhoneCount
    }
  }
}
