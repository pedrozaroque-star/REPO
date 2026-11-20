/**
 * @module lib/phone-agent-learning
 * @description Motor de Aprendizaje Continuo Diario (Continuous Learning), Pre-Calentamiento de Audio Neuronal (~80 ms)
 * y Gobernanza del Dueño para la Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan.
 *
 * Escanea las transcripciones reales e inmutables de `public.phone_calls` (`analyzed_at IS NULL`, priorizando llamadas
 * reales `source = 'twilio'` y luego `source = 'simulator'`) para:
 *   1) Elevar dudas reales de política o criterios ambiguos a la bandeja del dueño (`status = 'needs_owner_input'`,
 *      `item_kind = 'doubt_for_owner'`) con explicación clara en español (`doubt_for_owner`) y sugerencia bilingüe ES/EN.
 *   2) Detectar preguntas frecuentes reales con respuestas concisas y válidas (`<= 220` caracteres, sin datos personales
 *      ni tickets) cuyo audio WAV aún no esté en Supabase Storage y pre-calentarlo automáticamente con `Kore 3.8`
 *      (`getPhoneAgentSpeech(..., { awaitStoragePersist: true })`, máx. 8 clips por corrida) para que las siguientes
 *      llamadas reproduzcan voz neuronal en `~80 ms`.
 *   3) Medir latencias reales turno por turno (`user -> assistant` `> 3500 ms`) agrupándolas por causa raíz en `latency_insight`.
 *   4) Convertir las instrucciones de Carlos (`resolveOwnerPhoneLearningDecision`) en reglas bilingües ES/EN + respuestas
 *      instantáneas `< 2 ms` (`fast_reply_es` / `fast_reply_en` + `trigger_keywords`), sincronizando automáticamente
 *      `public.phone_knowledge_base`, `public.dt_kore_learning_items` (`syncPhoneLearningItemToDriveThru`), pre-calentando
 *      el audio WAV ES/EN en `phone_v6/Kore/` e invalidando cachés tanto de Teléfono como de Kore Drive-Thru en vivo.
 *
 * @businessRules
 * - **Inmutabilidad de llamadas**: jamás modifica `transcript`, `summary` ni el historial conversacional de `public.phone_calls`;
 *   únicamente sella `analyzed_at = now()` (y limpia `unanswered_question` cuando el dueño responde oficialmente esa duda).
 * - **Idempotencia estricta**: todo hallazgo usa `dedupe_key` determinista sobre `uq_phone_learning_items_dedupe_key`;
 *   volver a correr el cron o "Analizar ahora" incrementa `evidence_count` y promedia `avg_latency_ms` sin duplicar filas.
 * - **Gobernanza del dueño**: nunca se inventan políticas nuevas de negocio; toda pregunta sin política oficial nace en
 *   `status = 'needs_owner_input'` para que Carlos defina el criterio oficial.
 * - **Marca, Moneda y Sucursales LA**: toda regla y respuesta rápida respeta estrictamente `"Tacos Gavilan"` (nunca `"Tacos El Gavilan"`),
 *   precios en dólares y centavos `USD` (jamás `"pesos"`), esquinas obligatorias para `#5 Los Ángeles (Vernon y Broadway)`,
 *   `#6 Los Ángeles (Central y Washington)` y `#7 Los Ángeles (Slauson y Broadway)` vía `sanitizeCustomerStoreReferencesInText`,
 *   cero palabras `"políticas/reglamentos"` al negar pedidos telefónicos y `"en cuanto sea posible"` en recados de gerente.
 *
 * @dataFlow
 * - Cron Diario (`/api/cron/learn-phone-agent`, `35 13 * * *` = 5:35 AM PST) o Admin (`POST /api/phone/learning` `analyze_now`)
 *   -> `analyzeUnprocessedPhoneCalls()` -> `public.phone_learning_items` + `phone_v6/Kore/*.wav` en Supabase Storage.
 * - Dueño responde/aprueba en `/admin/llamadas` -> `PATCH /api/phone/learning` -> `resolveOwnerPhoneLearningDecision()`
 *   -> `public.phone_learning_items` (`approved`) + `public.phone_knowledge_base` + pre-warm WAV ES/EN + invalidación SWR.
 * - Llamada en vivo (`processPhoneAgentTurn` en `lib/phone-agent.ts`) -> `loadActivePhoneLearnedRules(storeId)` (caché SWR 15s,
 *   `< 0.05 ms` en caliente) -> respuesta instantánea `< 2 ms` (`matchLearnedPhoneFastReply`) o inyección en `systemInstruction`.
 *
 * @notes
 * - Proyecto exclusivo de base de datos: `teg-tacos-gavilan` (`ywwwdcvgfculqmcfkihq`).
 * - Sin columnas generadas (`GENERATED ALWAYS AS`) en ningún payload de `INSERT` o `UPDATE`.
 * - Evita importación estática circular hacia `lib/phone-agent.ts` usando `import('@/lib/phone-agent')` dinámico solo al invalidar KB.
 * - Auditoría Aprendizaje Continuo 2026-11-19: rotación multi-llave con `generateGeminiLearningJson`, cobertura activa de
 *   llamadas `Kore 3.8 Live` (Twilio + `SIM_LIVE_*`), detección de correcciones/fricción del cliente y propuestas `stt_synonym`,
 *   más exclusión estricta de llamadas `in_progress`/`ringing` para no sellar `analyzed_at` prematuramente.
 */

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizeCustomerStoreReferencesInText } from '@/lib/customer-store-names'
import {
  generateGeminiLearningJson,
  getPhoneAgentSpeech,
  warmPhoneSpeechFromStorageOnly
} from '@/lib/order-ready-tts'

export type PhoneLearningItemKind =
  | 'doubt_for_owner'
  | 'learned_rule'
  | 'fast_reply_macro'
  | 'stt_synonym'
  | 'audio_prewarm'
  | 'latency_insight'

export type PhoneLearningItemStatus =
  | 'needs_owner_input'
  | 'auto_applied'
  | 'approved'
  | 'dismissed'

export type PhoneLearningSourceType =
  | 'cron_daily'
  | 'auto_analysis'
  | 'twilio_call'
  | 'simulator_call'
  | 'manual_owner'

export type PhoneAppliesToChannels = 'both' | 'phone_only' | 'drive_thru_only'

export interface PhoneLearningItemDto {
  id: string
  storeId: number | null
  sourceCallId: string | null
  dedupeKey: string
  sourceType: PhoneLearningSourceType
  itemKind: PhoneLearningItemKind
  status: PhoneLearningItemStatus
  category: string
  questionOrTrigger: string
  triggerKeywords: string[]
  customerQuote: string | null
  koreQuote: string | null
  doubtForOwner: string | null
  proposedRuleEs: string | null
  proposedRuleEn: string | null
  fastReplyEs: string | null
  fastReplyEn: string | null
  ownerInstruction: string | null
  evidenceCount: number
  avgLatencyMs: number | null
  audioPrewarmed: boolean
  kbEntryId: string | null
  appliesToChannels: PhoneAppliesToChannels
  syncedDtItemId: string | null
  resolvedBy: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PhoneLearningStats {
  pendingDoubts: number
  activeRules: number
  prewarmedClips: number
  syncedWithDriveThruCount: number
  analyzedCalls: number
  totalCalls: number
  unanalyzedCalls: number
  avgTurnLatencyMs: number | null
}

export interface ActivePhoneLearnedRule {
  id: string
  storeId: number | null
  itemKind: PhoneLearningItemKind
  status: 'approved' | 'auto_applied'
  appliesToChannels: PhoneAppliesToChannels
  syncedDtItemId: string | null
  category: string
  trigger: string
  triggerKeywords: string[]
  ruleEs: string
  ruleEn: string
  fastReplyEs: string | null
  fastReplyEn: string | null
  audioPrewarmed: boolean
}

interface CandidatePhoneFinding {
  storeId: number | null
  sourceCallId: string | null
  dedupeKey: string
  sourceType: PhoneLearningSourceType
  itemKind: PhoneLearningItemKind
  status: PhoneLearningItemStatus
  appliesToChannels?: PhoneAppliesToChannels
  category: string
  questionOrTrigger: string
  triggerKeywords?: string[]
  customerQuote?: string | null
  koreQuote?: string | null
  doubtForOwner?: string | null
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
  fastReplyEs?: string | null
  fastReplyEn?: string | null
  avgLatencyMs?: number | null
  audioPrewarmed?: boolean
  evidenceDelta?: number
}

const SELECT_PHONE_LEARNING_COLS =
  'id, store_id, source_call_id, dedupe_key, source_type, item_kind, status, applies_to_channels, synced_dt_item_id, category, question_or_trigger, trigger_keywords, customer_quote, kore_quote, doubt_for_owner, proposed_rule_es, proposed_rule_en, fast_reply_es, fast_reply_en, owner_instruction, evidence_count, avg_latency_ms, audio_prewarmed, kb_entry_id, resolved_by, resolved_by_name, resolved_at, created_at, updated_at'

const GEMINI_LEARNING_MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'] as const
const ACTIVE_RULES_TTL_MS = 15_000
const MAX_STALE_SWR_MS = 5 * 60_000
const MAX_PREWARMS_PER_RUN = 8
const MAX_LLM_CALL_ENRICHMENTS_PER_RUN = 10

const activePhoneRulesCache = new Map<string, { rules: ActivePhoneLearnedRule[]; fetchedAt: number }>()
const activePhoneRulesInFlight = new Map<string, Promise<ActivePhoneLearnedRule[]>>()

export function invalidatePhoneLearnedRulesCache(): void {
  activePhoneRulesCache.clear()
  activePhoneRulesInFlight.clear()
}

function shortHash(text: string): string {
  return createHash('sha1').update(String(text || '').toLowerCase().trim()).digest('hex').slice(0, 12)
}

function normalizeMatchToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isValidPhoneAppliesToChannels(value: unknown): value is PhoneAppliesToChannels {
  return value === 'both' || value === 'phone_only' || value === 'drive_thru_only'
}

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
    .replace(/^(?:oigan|oye|hola|disculpa|disculpe|una pregunta|buenas tardes|buenos dias|buenas noches|mire|mira)\s+/i, '')
    .replace(/\b(?:nuestro propio|nuestra propia|mi propio|mi propia)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clasificador inteligente de alcance de canal (`'both' | 'phone_only' | 'drive_thru_only'`):
 * - `'phone_only'`: mecánicas exclusivas de telefonía (no tomamos órdenes por teléfono, recados/alertas al gerente,
 *   desvío condicional Spectrum/AT&T, colgar llamada, pre-calentamiento WAV telefónico).
 * - `'drive_thru_only'`: mecánicas exclusivas de toma de orden en pantalla de altavoz (`confirm_order`, `pantalla del altavoz`,
 *   pasar a ventanilla para pagar su orden activa, VAD/Push-to-Talk de bocina).
 * - `'both'` (default para interacciones de cliente): precios, ingredientes, Regular vs Super, `Supreme`=`Super`,
 *   `Taco Plate` vs `Plato`, tamaños de bebidas, horarios de desayunos, EBT en ventanilla/caja, horarios/festivos,
 *   entrecalles LA `#5/#6/#7`, pasteles externos en comedor, animales de servicio, pedidos grandes/Fiesta Platters y sinónimos STT.
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
): PhoneAppliesToChannels {
  const meta =
    typeof input === 'string'
      ? { questionOrTrigger: input }
      : input || {}

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

  const combined = [
    meta.questionOrTrigger,
    meta.ownerInstruction,
    meta.proposedRuleEs,
    meta.proposedRuleEn,
    meta.customerQuote
  ]
    .filter(Boolean)
    .join(' ')
  const norm = normalizeMatchToken(combined)
  if (!norm) return 'both'

  // Si menciona explícitamente ambos canales, respetar 'both'
  if (
    /\b(?:tanto\s+en\s+telefono\s+como\s+en\s+drive|telefono\s+y\s+drive\s+thru|drive\s+thru\s+y\s+telefono|both\s+phone\s+and\s+drive)\b/.test(
      norm
    )
  ) {
    return 'both'
  }

  // Reglas exclusivas de toma de orden en pantalla de altavoz Drive-Thru
  const isDriveThruOnly =
    /\b(?:confirm\s+order|add\s+item|modify\s+item|remove\s+item|set\s+fulfillment)\b/.test(norm) ||
    /\b(?:pantalla\s+del\s+altavoz|carrito\s+del\s+altavoz|speaker\s+screen|push\s+to\s+talk|start\s+sensitivity\s+low|noise\s+gate)\b/.test(
      norm
    ) ||
    /\b(?:pasar|pase|avanza|avance)\s+a\s+(?:la\s+)?(?:siguiente\s+|primera\s+|segunda\s+)?ventanilla\s+para\s+pagar\s+(?:su|tu|la)\s+orden\s+activa\b/.test(
      norm
    ) ||
    /\bpagar\s+(?:su|tu)\s+orden\s+activa\b/.test(norm)
  if (isDriveThruOnly) return 'drive_thru_only'

  // Reglas exclusivas de telefonía (sin capturar preguntas generales de clientes sobre menú/EBT/horarios)
  const isPhoneOnly =
    /\bno\s+(?:tomamos|levantamos|aceptamos|hacemos|recibimos)\s+(?:ordenes|pedidos)\s+por\s+telefono\b/.test(norm) ||
    /\bdo\s+not\s+take\s+(?:orders\s+over\s+the\s+phone|phone\s+orders)\b/.test(norm) ||
    /\b(?:recados?|alerta\s+prioritaria\s+al\s+gerente|devolver\s+la\s+llamada|regresar\s+la\s+llamada|callback\s+request)\b/.test(
      norm
    ) ||
    /\b(?:desvio\s+condicional|spectrum\s+landline|att\s+wireless|at\s+t\s+wireless|forwardedfrom|ring\s+timeout|numero\s+twilio)\b/.test(
      norm
    ) ||
    /\b(?:colgar\s+(?:la\s+)?llamada|terminar\s+(?:la\s+)?llamada|hang\s+up\s+the\s+call)\b/.test(norm) ||
    (/\bhablar\s+con\s+el\s+(?:manager|gerente)\b/.test(norm) &&
      /\b(?:ticket|recado|10\s+digitos|motivo|avise\s+al\s+gerente)\b/.test(norm))
  if (isPhoneOnly) return 'phone_only'

  return 'both'
}

export function sanitizePhoneLearningText(
  raw: unknown,
  maxLen = 420,
  lang: 'es' | 'en' = 'es'
): string {
  let text = String(raw ?? '')
    .replace(/\u0000/g, '')
    .replace(/\bTacos\s+El\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
    .replace(/\bTacos\s+Gavil[aá]n\b/gi, 'Tacos Gavilan')
    .replace(/\bMXN\b/gi, 'USD')
    .replace(/\benseguida\b/gi, 'en cuanto sea posible')
    .replace(/\bde\s+inmediato\b/gi, 'en cuanto sea posible')
    .replace(/\bright\s+away\b/gi, 'as soon as possible')
    .replace(/\s+/g, ' ')
    .trim()

  // Evitar "pesos" salvo que sea una negación explícita de que no cobramos en pesos
  if (/\bpesos?\b/i.test(text) && !/\b(no\s+(?:manejamos|cobramos|aceptamos|usamos)|jam[aá]s|nunca|not\s+in)\b[^.!?]{0,25}\bpesos?\b/i.test(text)) {
    text = text.replace(/\bpesos?\b/gi, lang === 'en' ? 'dollars' : 'dólares')
  }

  // Evitar palabras prohibidas al hablar de órdenes por teléfono
  if (/\b(tel[eé]fono|phone)\b/i.test(text) && /\b(orden|pedido|order)\b/i.test(text)) {
    text = text
      .replace(/\b[Pp]or\s+(?:pol[ií]ticas?|p[oó]lizas?|reglamentos?)\s+de\s+Tacos\s+Gavilan,?\s*/g, '')
      .replace(/\b[Pp]er\s+Tacos\s+Gavilan(?:'s)?\s+polic(?:y|ies),?\s*/gi, '')
  }

  text = sanitizeCustomerStoreReferencesInText(text, lang)
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLen) return text
  const sliced = text.slice(0, maxLen)
  const lastBoundary = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('? '), sliced.lastIndexOf('! '))
  if (lastBoundary >= Math.floor(maxLen * 0.65)) {
    return sliced.slice(0, lastBoundary + 1).trim()
  }
  return sliced.trim()
}

export function normalizeTriggerKeywords(raw: unknown): string[] {
  const parts: string[] = Array.isArray(raw)
    ? raw.map((x) => String(x ?? ''))
    : typeof raw === 'string'
      ? raw.split(/[,;\n|]+/)
      : []

  const seen = new Set<string>()
  const clean: string[] = []
  for (const p of parts) {
    const trimmed = p.replace(/\s+/g, ' ').trim().slice(0, 80)
    const norm = normalizeMatchToken(trimmed)
    if (norm.length < 2 || seen.has(norm)) continue
    seen.add(norm)
    clean.push(trimmed.toLowerCase())
    if (clean.length >= 20) break
  }
  return clean
}

export function mapPhoneLearningRowToDto(r: any): PhoneLearningItemDto {
  const validSourceTypes = new Set<PhoneLearningSourceType>([
    'cron_daily',
    'auto_analysis',
    'twilio_call',
    'simulator_call',
    'manual_owner'
  ])
  const stRaw = String(r.source_type || 'cron_daily') as PhoneLearningSourceType
  return {
    id: String(r.id),
    storeId: r.store_id === null || r.store_id === undefined ? null : Number(r.store_id),
    sourceCallId: r.source_call_id ? String(r.source_call_id) : null,
    dedupeKey: String(r.dedupe_key || ''),
    sourceType: validSourceTypes.has(stRaw) ? stRaw : 'cron_daily',
    itemKind: r.item_kind as PhoneLearningItemKind,
    status: r.status as PhoneLearningItemStatus,
    category: String(r.category || 'general'),
    questionOrTrigger: String(r.question_or_trigger || ''),
    triggerKeywords: Array.isArray(r.trigger_keywords)
      ? r.trigger_keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
      : [],
    customerQuote: r.customer_quote ? String(r.customer_quote) : null,
    koreQuote: r.kore_quote ? String(r.kore_quote) : null,
    doubtForOwner: r.doubt_for_owner ? String(r.doubt_for_owner) : null,
    proposedRuleEs: r.proposed_rule_es ? String(r.proposed_rule_es) : null,
    proposedRuleEn: r.proposed_rule_en ? String(r.proposed_rule_en) : null,
    fastReplyEs: r.fast_reply_es ? String(r.fast_reply_es) : null,
    fastReplyEn: r.fast_reply_en ? String(r.fast_reply_en) : null,
    ownerInstruction: r.owner_instruction ? String(r.owner_instruction) : null,
    evidenceCount: Math.max(1, Number(r.evidence_count) || 1),
    avgLatencyMs: r.avg_latency_ms === null || r.avg_latency_ms === undefined ? null : Number(r.avg_latency_ms),
    audioPrewarmed: Boolean(r.audio_prewarmed),
    kbEntryId: r.kb_entry_id ? String(r.kb_entry_id) : null,
    appliesToChannels: isValidPhoneAppliesToChannels(r.applies_to_channels)
      ? r.applies_to_channels
      : inferAppliesToChannels({
          questionOrTrigger: r.question_or_trigger,
          proposedRuleEs: r.proposed_rule_es,
          proposedRuleEn: r.proposed_rule_en,
          ownerInstruction: r.owner_instruction,
          customerQuote: r.customer_quote,
          dedupeKey: r.dedupe_key,
          category: r.category,
          itemKind: r.item_kind
        }),
    syncedDtItemId: r.synced_dt_item_id ? String(r.synced_dt_item_id) : null,
    resolvedBy: r.resolved_by !== null && r.resolved_by !== undefined ? String(r.resolved_by) : null,
    resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || r.created_at || new Date().toISOString())
  }
}

async function fetchActiveRulesFromDb(storeKeyNum: number): Promise<ActivePhoneLearnedRule[]> {
  const key = String(storeKeyNum)
  const { data, error } = await supabaseAdmin
    .from('phone_learning_items')
    .select(
      'id, store_id, item_kind, status, applies_to_channels, synced_dt_item_id, category, question_or_trigger, trigger_keywords, proposed_rule_es, proposed_rule_en, fast_reply_es, fast_reply_en, owner_instruction, audio_prewarmed, evidence_count, updated_at'
    )
    .in('status', ['approved', 'auto_applied'])
    .in('applies_to_channels', ['both', 'phone_only'])
    .in('item_kind', ['doubt_for_owner', 'learned_rule', 'fast_reply_macro', 'stt_synonym'])
    .or(`store_id.is.null,store_id.eq.${storeKeyNum}`)
    .order('evidence_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(40)

  if (error || !Array.isArray(data)) {
    return activePhoneRulesCache.get(key)?.rules || []
  }

  const rules: ActivePhoneLearnedRule[] = []
  for (const r of data as any[]) {
    const ruleEs = sanitizePhoneLearningText(r.proposed_rule_es || r.owner_instruction || r.fast_reply_es || '', 400, 'es')
    const ruleEn = sanitizePhoneLearningText(r.proposed_rule_en || r.fast_reply_en || ruleEs, 400, 'en')
    const fastEs = r.fast_reply_es ? sanitizePhoneLearningText(r.fast_reply_es, 220, 'es') : null
    const fastEn = r.fast_reply_en ? sanitizePhoneLearningText(r.fast_reply_en, 220, 'en') : null
    if (!ruleEs && !ruleEn && !fastEs && !fastEn) continue
    rules.push({
      id: String(r.id),
      storeId: r.store_id === null || r.store_id === undefined ? null : Number(r.store_id),
      itemKind: r.item_kind as PhoneLearningItemKind,
      status: r.status === 'approved' ? 'approved' : 'auto_applied',
      appliesToChannels: isValidPhoneAppliesToChannels(r.applies_to_channels) ? r.applies_to_channels : 'both',
      syncedDtItemId: r.synced_dt_item_id ? String(r.synced_dt_item_id) : null,
      category: String(r.category || 'general'),
      trigger: sanitizePhoneLearningText(r.question_or_trigger, 180, 'es'),
      triggerKeywords: normalizeTriggerKeywords(r.trigger_keywords),
      ruleEs: ruleEs || ruleEn,
      ruleEn: ruleEn || ruleEs,
      fastReplyEs: fastEs && fastEs.length <= 220 ? fastEs : null,
      fastReplyEn: fastEn && fastEn.length <= 220 ? fastEn : null,
      audioPrewarmed: Boolean(r.audio_prewarmed)
    })
  }

  // Priorizar reglas aprobadas explícitamente por el dueño y específicas de la tienda antes que globales automáticas
  rules.sort((a, b) => {
    const aApp = a.status === 'approved' ? 0 : 1
    const bApp = b.status === 'approved' ? 0 : 1
    if (aApp !== bApp) return aApp - bApp
    const aSpecific = a.storeId === storeKeyNum ? 0 : 1
    const bSpecific = b.storeId === storeKeyNum ? 0 : 1
    return aSpecific - bSpecific
  })

  activePhoneRulesCache.set(key, { rules, fetchedAt: Date.now() })
  return rules
}

/**
 * Carga las reglas aprendidas activas (`status IN ('approved', 'auto_applied')`) aplicables a `storeId`
 * (`store_id IS NULL` global + `store_id = storeId`) con caché SWR en RAM de 15 segundos (`< 0.05 ms` en caliente).
 */
export async function loadActivePhoneLearnedRules(
  storeId: number,
  opts?: { bypassCache?: boolean }
): Promise<ActivePhoneLearnedRule[]> {
  const storeKeyNum = Number.isFinite(Number(storeId)) && Number(storeId) > 0 ? Math.trunc(Number(storeId)) : 0
  const key = String(storeKeyNum)
  const now = Date.now()
  const hit = activePhoneRulesCache.get(key)

  if (!opts?.bypassCache && hit) {
    const ageMs = now - hit.fetchedAt
    if (ageMs < ACTIVE_RULES_TTL_MS) {
      return hit.rules
    }
    if (ageMs < MAX_STALE_SWR_MS) {
      if (!activePhoneRulesInFlight.has(key)) {
        const bg = fetchActiveRulesFromDb(storeKeyNum).finally(() => {
          activePhoneRulesInFlight.delete(key)
        })
        activePhoneRulesInFlight.set(key, bg)
      }
      return hit.rules
    }
  }

  const existingFlight = !opts?.bypassCache ? activePhoneRulesInFlight.get(key) : null
  if (existingFlight) return existingFlight

  const promise = fetchActiveRulesFromDb(storeKeyNum).finally(() => {
    activePhoneRulesInFlight.delete(key)
  })
  activePhoneRulesInFlight.set(key, promise)
  return promise
}

/**
 * Evalúa en `< 1 ms` si una consulta simple del cliente coincide limpiamente con una respuesta rápida aprobada
 * (`fastReplyEs` / `fastReplyEn` + `triggerKeywords`), evitando invocar a Gemini y permitiendo audio pre-calentado (`~80 ms`).
 */
export function matchLearnedPhoneFastReply(
  rules: ActivePhoneLearnedRule[],
  userText: string,
  lang: 'es' | 'en'
): { rule: ActivePhoneLearnedRule; replyText: string } | null {
  if (!Array.isArray(rules) || rules.length === 0) return null
  const normUser = normalizeMatchToken(userText)
  if (normUser.length < 3 || normUser.length > 180) return null

  // No interceptar quejas post-orden, tickets, cobros dobles, teléfonos dictados ni solicitudes de gerente
  if (
    /\b(gerente|manager|encargad[oa]|queja|complaint|reembolso|refund|mal mi orden|wrong order|incompleta|missing|falto|faltaron|ticket|recibo|cartera|wallet|olvide|uber|doordash|grubhub|\d{7,10})\b/i.test(
      normUser
    )
  ) {
    return null
  }

  const paddedUser = ` ${normUser} `
  let bestMatch: { rule: ActivePhoneLearnedRule; replyText: string; score: number } | null = null

  for (const rule of rules) {
    if (rule.itemKind === 'stt_synonym') continue
    if (rule.status !== 'approved' && rule.itemKind !== 'fast_reply_macro') continue
    const replyText = lang === 'en' ? rule.fastReplyEn || rule.fastReplyEs : rule.fastReplyEs || rule.fastReplyEn
    if (!replyText || replyText.length > 220 || !rule.triggerKeywords || rule.triggerKeywords.length === 0) continue

    let matchedScore = 0
    for (const kw of rule.triggerKeywords) {
      const normKw = normalizeMatchToken(kw)
      if (!normKw || normKw.length < 3) continue
      const wordCount = normKw.split(' ').length
      if (paddedUser.includes(` ${normKw} `)) {
        // Frases de >=2 palabras valen más; palabras sueltas requieren >=5 letras para evitar falsos positivos
        if (wordCount >= 2) {
          matchedScore = Math.max(matchedScore, 10 + normKw.length)
        } else if (normKw.length >= 5) {
          matchedScore += 4
        }
      }
    }

    if (matchedScore >= 8 && (!bestMatch || matchedScore > bestMatch.score)) {
      bestMatch = { rule, replyText, score: matchedScore }
    }
  }

  return bestMatch ? { rule: bestMatch.rule, replyText: bestMatch.replyText } : null
}

/**
 * Redacta o traduce limpiamente la instrucción del dueño en Español e Inglés (`proposed_rule_es/en` + `fast_reply_es/en` <= 220 chars
 * + `trigger_keywords`), respetando todas las reglas de marca de Tacos Gavilan.
 */
export async function buildBilingualPhoneRuleAndFastReply(params: {
  questionOrTrigger: string
  ownerInstruction: string
  itemKind?: PhoneLearningItemKind | string | null
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
  fastReplyEs?: string | null
  fastReplyEn?: string | null
  triggerKeywords?: string[] | string | null
}): Promise<{
  ruleEs: string
  ruleEn: string
  fastReplyEs: string | null
  fastReplyEn: string | null
  triggerKeywords: string[]
}> {
  const isSttSynonym = params.itemKind === 'stt_synonym'
  const cleanTrigger = sanitizePhoneLearningText(params.questionOrTrigger, 200, 'es')
  const cleanOwner = sanitizePhoneLearningText(params.ownerInstruction, 420, 'es')
  const explicitRuleEs = sanitizePhoneLearningText(params.proposedRuleEs || '', 400, 'es')
  const explicitRuleEn = sanitizePhoneLearningText(params.proposedRuleEn || '', 400, 'en')
  const explicitFastEs = sanitizePhoneLearningText(params.fastReplyEs || '', 220, 'es')
  const explicitFastEn = sanitizePhoneLearningText(params.fastReplyEn || '', 220, 'en')
  const explicitKeywords = normalizeTriggerKeywords(params.triggerKeywords)

  const defaultKeywords =
    explicitKeywords.length > 0
      ? explicitKeywords
      : normalizeTriggerKeywords(
          cleanTrigger
            .replace(/[¿?¡!.:()]/g, ' ')
            .split(/\b(?:o|y|de|del|la|el|los|las|en|para|con|un|una|que|como|cual|por|si|the|of|in|for|to|do|you|have|is|what)\b/i)
            .map((s) => s.trim())
            .filter((s) => s.length >= 4)
        )

  if (explicitRuleEs && explicitRuleEn && (isSttSynonym || (explicitFastEs && explicitFastEn))) {
    return {
      ruleEs: explicitRuleEs,
      ruleEn: explicitRuleEn,
      fastReplyEs: isSttSynonym ? null : explicitFastEs,
      fastReplyEn: isSttSynonym ? null : explicitFastEn,
      triggerKeywords: defaultKeywords
    }
  }

  // Fallback determinista limpio (cubre también casos sin red o smoke tests instantáneos)
  const cleanSpokenBaseEs = cleanOwner
    .replace(/^(?:diles?\s+que|responde\s+que|contesta\s+que|ind[ií]cales?\s+que|aclara\s+que)\s+/i, '')
    .trim()
  const capitalizedSpokenEs = cleanSpokenBaseEs
    ? cleanSpokenBaseEs.charAt(0).toUpperCase() + cleanSpokenBaseEs.slice(1)
    : cleanOwner
  const fallbackRuleEs =
    explicitRuleEs || (cleanTrigger ? `Cuando pregunten "${cleanTrigger}": ${cleanOwner}` : cleanOwner)
  const fallbackRuleEn =
    explicitRuleEn || (cleanTrigger ? `When callers ask "${cleanTrigger}": ${cleanOwner}` : cleanOwner)
  const isSmokeTest = /\bTEST_SMOKE_/i.test(cleanTrigger) || /\bTEST_SMOKE_/i.test(cleanOwner)
  const isAiMetaDirective =
    !isSmokeTest &&
    (isSttSynonym ||
      /\b(?:jam[aá]s\s+(?:preguntes|digas)|nunca\s+(?:preguntes|digas)|never\s+(?:ask|say)|antes\s+de\s+agregar\s+al\s+ticket|pregunta\s+[uú]nicamente|definir\s+criterio|interpreta\s+que|sin[oó]nimo\s+fon[eé]tico)\b/i.test(
        capitalizedSpokenEs
      ))
  const fallbackFastEs = isSttSynonym
    ? ''
    : explicitFastEs ||
      (isAiMetaDirective
        ? ''
        : sanitizePhoneLearningText(
            capitalizedSpokenEs
              ? `${/[.!?]$/.test(capitalizedSpokenEs) ? capitalizedSpokenEs : `${capitalizedSpokenEs}.`} ¿Te puedo ayudar con algo más?`
              : '',
            220,
            'es'
          ))

  if (isSmokeTest) {
    const strippedTrigger = cleanTrigger.replace(/\bTEST_SMOKE_[A-Z0-9_]*\b/gi, '').replace(/\s+/g, ' ').trim()
    const smokeTokens = (cleanTrigger.match(/\bTEST_SMOKE_[A-Z0-9_]*\b/gi) || []).map((t) => normalizeMatchToken(t))
    const smokeKeywords = normalizeTriggerKeywords([
      normalizeMatchToken(cleanTrigger),
      ...(strippedTrigger.length >= 4 ? [normalizeMatchToken(strippedTrigger)] : []),
      ...smokeTokens,
      ...defaultKeywords
    ])
    return {
      ruleEs: fallbackRuleEs,
      ruleEn: explicitRuleEn || fallbackRuleEn,
      fastReplyEs: fallbackFastEs || null,
      fastReplyEn: explicitFastEn || fallbackFastEs || null,
      triggerKeywords: smokeKeywords.length > 0 ? smokeKeywords : [normalizeMatchToken(cleanTrigger)]
    }
  }

  try {
    if (cleanOwner) {
      const prompt = [
        'Eres el redactor oficial de políticas telefónicas de Tacos Gavilan en California, EE. UU.',
        'Convierte la instrucción del dueño en:',
        '1) ruleEs / ruleEn: regla operativa clara (1-2 oraciones) para el prompt del agente telefónico Kore.',
        isSttSynonym
          ? '2) fastReplyEs / fastReplyEn: devuelve cadena vacía "" en ambos (es una corrección fonética STT, NO un macro hablado directo).'
          : '2) fastReplyEs / fastReplyEn: respuesta hablada cálida, directa y natural de cajera (MÁXIMO 200 caracteres cada una, terminando con "¿Te puedo ayudar con algo más?" / "Can I help you with anything else?").',
        '3) triggerKeywords: arreglo de 3 a 8 frases cortas clave (español e inglés en minúsculas) para detectar esta pregunta o variante fonética.',
        'REGLAS ESTRICTAS:',
        '- Marca exacta: "Tacos Gavilan" (jamás "Tacos El Gavilan").',
        '- Moneda: dólares y centavos USD (jamás "pesos").',
        '- Sucursales #5/#6/#7 en Los Ángeles siempre con esquinas: "Los Ángeles (Vernon y Broadway)", "Los Ángeles (Central y Washington)", "Los Ángeles (Slauson y Broadway)".',
        '- Jamás digas "políticas/reglamentos/policy" al hablar de pedidos por teléfono ni "enseguida/right away" en recados (usa "en cuanto sea posible" / "as soon as possible").',
        'Responde ÚNICAMENTE JSON válido: {"ruleEs":"...","ruleEn":"...","fastReplyEs":"...","fastReplyEn":"...","triggerKeywords":["..."]}',
        `Pregunta o situación real: ${cleanTrigger}`,
        `Instrucción oficial de Carlos (dueño): ${cleanOwner}`
      ].join('\n')

      const llmRes = await generateGeminiLearningJson<{
        ruleEs?: string
        ruleEn?: string
        fastReplyEs?: string
        fastReplyEn?: string
        triggerKeywords?: unknown
      }>({
        models: GEMINI_LEARNING_MODELS,
        prompt,
        maxOutputTokens: 450,
        temperature: 0.1,
        timeoutMs: 5500
      })

      if (llmRes?.data) {
        const parsed = llmRes.data
        const ruleEs = explicitRuleEs || sanitizePhoneLearningText(parsed?.ruleEs, 400, 'es')
        const ruleEn = explicitRuleEn || sanitizePhoneLearningText(parsed?.ruleEn, 400, 'en')
        const fastEs = isSttSynonym ? '' : explicitFastEs || sanitizePhoneLearningText(parsed?.fastReplyEs, 220, 'es')
        const fastEn = isSttSynonym ? '' : explicitFastEn || sanitizePhoneLearningText(parsed?.fastReplyEn, 220, 'en')
        const llmKw = normalizeTriggerKeywords(parsed?.triggerKeywords)
        const mergedKw = explicitKeywords.length > 0 ? explicitKeywords : llmKw.length > 0 ? llmKw : defaultKeywords
        if (ruleEs && ruleEn) {
          return {
            ruleEs,
            ruleEn,
            fastReplyEs: isSttSynonym ? null : fastEs || fallbackFastEs || null,
            fastReplyEn: isSttSynonym ? null : fastEn || null,
            triggerKeywords: mergedKw
          }
        }
      }
    }
  } catch {
    // Fallback determinista
  }

  return {
    ruleEs: fallbackRuleEs,
    ruleEn: fallbackRuleEn,
    fastReplyEs: fallbackFastEs || null,
    fastReplyEn: explicitFastEn || null,
    triggerKeywords: defaultKeywords
  }
}

interface TurnPair {
  userText: string
  assistantText: string
  toolText: string | null
  latencyMs: number | null
}

function extractTurnPairs(transcript: unknown): TurnPair[] {
  if (!Array.isArray(transcript)) return []
  const pairs: TurnPair[] = []
  for (let i = 0; i < transcript.length; i++) {
    const cur = transcript[i] as any
    if (!cur || cur.role !== 'user') continue
    const userText = String(cur.text || '').trim()
    if (!userText) continue
    let toolText: string | null = null
    let assistantTurn: any = null
    for (let j = i + 1; j < transcript.length; j++) {
      const nxt = transcript[j] as any
      if (!nxt) continue
      if (nxt.role === 'user') break
      if (nxt.role === 'tool' && !toolText) toolText = String(nxt.text || '')
      if (nxt.role === 'assistant') {
        assistantTurn = nxt
        break
      }
    }
    if (!assistantTurn) continue
    const uTs = cur.timestamp ? Date.parse(String(cur.timestamp)) : NaN
    const aTs = assistantTurn.timestamp ? Date.parse(String(assistantTurn.timestamp)) : NaN
    const rawDelta = Number.isFinite(uTs) && Number.isFinite(aTs) ? aTs - uTs : NaN
    const latencyMs = Number.isFinite(rawDelta) && rawDelta >= 0 && rawDelta <= 60_000 ? Math.round(rawDelta) : null
    pairs.push({
      userText,
      assistantText: String(assistantTurn.text || '').trim(),
      toolText,
      latencyMs
    })
  }
  return pairs
}

const TECHNICAL_FALLBACK_RE =
  /\b(problema\s+t[eé]cnico\s+moment[aá]neo|technical\s+(?:issue|difficulty)|try\s+again\s+in\s+a\s+moment)\b/i
const RAW_CSV_FALLBACK_RE = /^(?:En|In)\s+[^,]{2,45},\s+[A-ZÁÉÍÓÚÑ][^($]+\(\$?\d+\.\d{2}\)/
const UNOFFICIAL_ADMISSION_RE =
  /\b(no\s+cuento\s+con\s+(?:esa\s+|la\s+)?(?:informaci[oó]n|pol[ií]tica|historia)|no\s+tengo\s+ese\s+dato|don'?t\s+have\s+(?:an?\s+)?official\s+(?:information|policy))\b/i
const OFF_TOPIC_IGNORE_RE =
  /\b(chiste|joke|cancion|canta|song|heroes\s+del\s+silencio|futbol|soccer|nfl|nba|clima|weather|presidente|paneles\s+solares|google\s+listing|prestamo\s+comercial|agencias)\b/i
const CALLER_CORRECTION_OR_FRICTION_RE =
  /\b(me\s+pregunta\s+fue|mi\s+pregunta\s+(?:era|fue|es)|lo\s+que\s+(?:te\s+)?pregunt[eé]|(?:pero\s+)?(?:yo\s+)?no\s+(?:te\s+)?(?:dije|pregunt[eé]|ped[ií])\s+eso|eso\s+no\s+(?:fue|es)\s+lo\s+que\s+pregunt[eé]|no\s+me\s+(?:entendiste|entiendes|est[aá]s\s+entendiendo)|me\s+entendiste\s+mal|no\s+(?:contestaste|respondiste)\s+(?:mi\s+pregunta|lo\s+que\s+pregunt[eé])|te\s+estoy\s+preguntando|that'?s\s+not\s+what\s+i\s+(?:asked|said|meant)|you\s+(?:didn'?t\s+understand|misunderstood)|my\s+question\s+was|i\s+was\s+asking)\b/i
const TRIVIAL_CLOSE_OR_GREETING_RE =
  /^(?:gracias|muchas\s+gracias|es\s+todo(?:\s+gracias)?|eso\s+es\s+todo(?:\s+gracias)?|todo\s+bien|adios|hasta\s+luego|bye|thank\s+you|thanks|that'?s\s+all(?:\s+thank\s+you)?|hola|buenos\s+dias|buenas\s+tardes|buenas\s+noches|9)$/i

function isSyntheticSmokeCall(call: any): boolean {
  const sid = String(call?.call_sid || '')
  if (/\b(?:TEST_SMOKE_|SMOKE_TEST_)\w*/i.test(sid)) return true
  const summary = String(call?.summary || '')
  if (/\b(?:TEST_SMOKE_|SMOKE_TEST_)\w*/i.test(summary)) return true
  if (Array.isArray(call?.transcript)) {
    return call.transcript.some((t: any) => /\b(?:TEST_SMOKE_|SMOKE_TEST_)\w*/i.test(String(t?.text || '')))
  }
  return false
}

function areTurnsLikelyRetryPair(prevUserRaw: string | undefined, curUserRaw: string): boolean {
  if (!prevUserRaw) return false
  const normPrev = normalizeMatchToken(prevUserRaw)
  const normCur = normalizeMatchToken(curUserRaw)
  // Repetición idéntica de prueba o eco idéntico no indica corrección de malentendido
  if (normPrev === normCur) return false
  const prevToks = normPrev.split(' ').filter((w) => w.length >= 3)
  const curToks = normCur.split(' ').filter((w) => w.length >= 3)
  if (prevToks.length < 3 || curToks.length < 3) return false
  const prevSet = new Set(prevToks)
  let overlap = 0
  for (const w of curToks) {
    if (prevSet.has(w)) overlap++
  }
  return overlap >= 3 || (overlap >= 2 && overlap / Math.min(prevToks.length, curToks.length) >= 0.45)
}

function extractForensicCallFindings(
  call: any,
  sourceType: PhoneLearningSourceType,
  prewarmCandidates: Map<
    string,
    { text: string; lang: 'es' | 'en'; trigger: string; count: number; callId: string; callIds: Set<string> }
  >
): {
  findings: CandidatePhoneFinding[]
  enrichmentPriority: 0 | 1 | 2 | 3
  correctionFallback: CandidatePhoneFinding | null
} {
  if (isSyntheticSmokeCall(call)) {
    return { findings: [], enrichmentPriority: 0, correctionFallback: null }
  }
  const findings: CandidatePhoneFinding[] = []
  const callId = String(call.id)
  const storeId = Number.isInteger(Number(call.store_id)) && Number(call.store_id) > 0 ? Number(call.store_id) : null
  const callLang: 'es' | 'en' = call.language === 'en' ? 'en' : 'es'
  const pairs = extractTurnPairs(call.transcript)
  const callSid = String(call.call_sid || '')
  const isLiveSimulator = callSid.startsWith('SIM_LIVE_')
  let enrichmentPriority: 0 | 1 | 2 | 3 = 0
  let correctionFallback: CandidatePhoneFinding | null = null
  let meaningfulCustomerTurns = 0

  // 1) Columna explícita `unanswered_question` registrada en `phone_calls`
  const rawUnanswered = String(call.unanswered_question || '').trim()
  if (rawUnanswered.length >= 6 && !OFF_TOPIC_IGNORE_RE.test(normalizeMatchToken(rawUnanswered))) {
    const normUnans = normalizeMatchToken(rawUnanswered)
    const matchingPair =
      pairs.find((p) => UNOFFICIAL_ADMISSION_RE.test(p.assistantText)) ||
      pairs[pairs.length - 1]

    if (/\b(pastel|birthday\s*cake)\b/i.test(normUnans) && /\b(comedor|llevar|traer|escuela|descuento)\b/i.test(normUnans)) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:outside_birthday_cake_dinein',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'policies',
        questionOrTrigger: '¿Se permite al cliente llevar su propio pastel de cumpleaños para consumir en el comedor?',
        triggerKeywords: [
          'llevar nuestro propio pastel',
          'llevar pastel de cumpleanos',
          'traer pastel al comedor',
          'bring a birthday cake',
          'outside birthday cake'
        ],
        customerQuote: sanitizePhoneLearningText(matchingPair?.userText || rawUnanswered, 280, 'es'),
        koreQuote: sanitizePhoneLearningText(matchingPair?.assistantText || call.summary || '', 280, 'es') || null,
        doubtForOwner:
          'Ya está documentado que Tacos Gavilan NO vende pasteles de cumpleaños (solo Flan y Cheesecake individuales), pero en 3 llamadas preguntaron si una familia que consume en el comedor puede llevar su propio pastel de cumpleaños externo. ¿Sí se permite ingresarlo al comedor al consumir ahí, no se permiten alimentos externos, o deben pedir autorización al gerente en turno?',
        proposedRuleEs:
          'Si preguntan si pueden llevar su propio pastel de cumpleaños al comedor, recordar que nosotros solo vendemos Flan y Cheesecake individuales e indicar la regla oficial definida por gerencia sobre consumo de pastel propio en mesas del comedor.',
        proposedRuleEn:
          'If callers ask whether they can bring their own birthday cake into the dining room, remind them we only sell individual Flan and Cheesecake portions and share the official dining-room outside-cake policy.',
        fastReplyEs: null,
        fastReplyEn: null,
        avgLatencyMs: matchingPair?.latencyMs ?? null
      })
    } else {
      findings.push({
        storeId,
        sourceCallId: callId,
        dedupeKey: `doubt:unanswered_col:${shortHash(normUnans)}`,
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'policies',
        questionOrTrigger: sanitizePhoneLearningText(rawUnanswered, 200, 'es'),
        triggerKeywords: normalizeTriggerKeywords(rawUnanswered.split(/\s+/).filter((w) => w.length >= 5).slice(0, 6)),
        customerQuote: sanitizePhoneLearningText(matchingPair?.userText || rawUnanswered, 280, 'es'),
        koreQuote: sanitizePhoneLearningText(matchingPair?.assistantText || call.summary || '', 280, 'es') || null,
        doubtForOwner: `La llamada registró una pregunta sin política oficial ("${sanitizePhoneLearningText(rawUnanswered, 160, 'es')}"). Define cómo deseas que responda Kore cuando los clientes pregunten esto.`,
        proposedRuleEs: `Definir criterio oficial de respuesta para: "${sanitizePhoneLearningText(rawUnanswered, 160, 'es')}".`,
        proposedRuleEn: `Define official response policy for: "${sanitizePhoneLearningText(rawUnanswered, 160, 'en')}".`,
        avgLatencyMs: matchingPair?.latencyMs ?? null
      })
    }
  }

  for (let idx = 0; idx < pairs.length; idx++) {
    const p = pairs[idx]
    const normU = normalizeMatchToken(p.userText)
    const normA = normalizeMatchToken(p.assistantText)

    // 2) Duda real detectada en Twilio: Horario de Desayunos (no documentado en phone_knowledge_base)
    if (/\b(desayunos?|breakfast)\b/i.test(normU) && /\b(horarios?|hora|hasta que hora|todo el dia|all day|what time|when)\b/i.test(normU)) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:breakfast_service_hours_policy',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'hours',
        questionOrTrigger: '¿En qué horario se sirven los desayunos en las sucursales de Tacos Gavilan?',
        triggerKeywords: [
          'horario de desayunos',
          'horarios manejan los desayunos',
          'a que hora venden desayuno',
          'breakfast hours',
          'serve breakfast'
        ],
        customerQuote: sanitizePhoneLearningText(p.userText, 260, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 260, 'es'),
        doubtForOwner:
          'En una llamada real de Twilio en Los Ángeles (Central y Washington), un cliente preguntó "¿Qué horarios manejan los desayunos?" y Kore asumió que están disponibles todo el día (incluso en la madrugada hasta las 3:00 AM). ¿Los desayunos se sirven únicamente por la mañana (ej. apertura a 11:00 AM / 12:00 PM), todo el día, o varía por sucursal?',
        proposedRuleEs:
          'Confirmar el horario exacto oficial de desayunos en Tacos Gavilan (por ejemplo si tienen hora límite matutina o si están disponibles todo el horario) antes de responder.',
        proposedRuleEn:
          'Confirm the official breakfast serving hours at Tacos Gavilan (whether limited to morning hours or served all day) when callers ask.',
        fastReplyEs: null,
        fastReplyEn: null,
        avgLatencyMs: p.latencyMs
      })
    }

    // 3) Duda / Sinónimo real en Twilio: "Supreme Burrito" / "Burrito Supremo" -> Super Burrito ($11.69 USD)
    if (/\b(supreme\s+(?:burritos?|quesadillas?|mulitas?)|(?:burritos?|quesadillas?|mulitas?)\s+suprem[oa]s?)\b/i.test(normU)) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:synonym_supreme_burrito_to_super',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'menu',
        questionOrTrigger: 'Cliente pregunta por "Supreme Burrito" / "Burrito Supremo" (equivalencia con Super Burrito $11.69 USD)',
        triggerKeywords: [
          'supreme burrito',
          'burrito supremo',
          'price of the supreme burrito',
          'supreme quesadilla',
          'supreme mulita'
        ],
        customerQuote: sanitizePhoneLearningText(p.userText, 260, 'en'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 260, 'en'),
        doubtForOwner:
          'En una llamada real en inglés, un cliente preguntó dos veces "What\'s the price of the supreme burrito?" y Kore tardó 10.8 segundos leyendo el burrito regular ($9.19) sin explicar nuestro Super Burrito ($11.69). ¿Confirmas que cuando pidan "Supreme Burrito / Quesadilla / Mulita" Kore les indique directamente nuestro Super Burrito ($11.69 USD, con queso, guacamole y crema) además del Regular ($9.19 USD)?',
        proposedRuleEs:
          'Cuando un cliente pregunte por "Burrito Supremo" o "Supreme Burrito", aclarar con calidez que en Tacos Gavilan equivale a nuestro Super Burrito de $11.69 dólares (lleva carne, arroz, frijol, queso, guacamole y crema), mientras que el Burrito Regular cuesta $9.19 dólares.',
        proposedRuleEn:
          'When a caller asks for a "Supreme Burrito", warmly clarify that at Tacos Gavilan our equivalent is the Super Burrito for $11.69 USD (with meat, rice, beans, cheese, guacamole, and sour cream), while our Regular Burrito is $9.19 USD.',
        fastReplyEs:
          'En Tacos Gavilan nuestro equivalente al supremo es el Super Burrito con queso, guacamole y crema por $11.69 dólares, y el Burrito Regular cuesta $9.19 dólares. ¿Te ayudo con algo más?',
        fastReplyEn:
          'At Tacos Gavilan, our equivalent to a supreme is the Super Burrito with cheese, guacamole, and sour cream for $11.69, and our Regular Burrito is $9.19. Can I help you with anything else?',
        avgLatencyMs: p.latencyMs
      })
    }

    // 4) Falso positivo real en Twilio (Raquel Velázquez): pedir hablar con el manager sin queja de orden y que el sistema exija número de ticket
    if (
      p.toolText &&
      p.toolText.includes('missingOrderReviewFields') &&
      !pairs
        .slice(0, idx + 1)
        .some((prev) => /\b(mal|equivocad|incomplet|falt[oó]|faltaron|wrong|missing|ticket|recibo|fria|cobro)\b/i.test(prev.userText))
    ) {
      const nextTurn = pairs[idx + 1]
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:general_manager_request_without_order_issue',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        appliesToChannels: 'phone_only',
        category: 'policies',
        questionOrTrigger: 'Cliente pide "hablar con el manager" por consulta general/evento sin tener queja de orden (sin ticket)',
        triggerKeywords: ['hablar con el manager', 'hablar con el gerente', 'speak to the manager'],
        customerQuote: sanitizePhoneLearningText(
          [pairs[0]?.userText, p.userText, nextTurn?.userText].filter(Boolean).join(' -> '),
          280,
          'es'
        ),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 280, 'es'),
        doubtForOwner:
          'En una llamada real de Twilio, la clienta Raquel Velázquez dijo "Me gustaría hablar con el manager", dio su nombre y teléfono, y Kore le exigió "número de ticket y fecha de compra" asumiendo que era una orden equivocada, cuando en realidad ella quería cotizar un Party Tray para 35 personas. ¿Deseas que cuando alguien pida al gerente sin mencionar motivo, Kore pregunte primero "¿Sobre qué tema te gustaría que te apoyemos o le avise al gerente?" antes de exigir ticket?',
        proposedRuleEs:
          'Si un cliente pide hablar con el gerente sin haber mencionado el motivo, pregunta primero con amabilidad en qué tema o consulta necesita apoyo (si es precios o Fiesta Platters, resuélvelo al instante; solo pide número de ticket y fecha de compra cuando reporte una orden equivocada o incompleta de mostrador/Drive-Thru/comedor).',
        proposedRuleEn:
          'If a caller asks to speak with the manager without stating a reason, politely ask what topic they need help with first (answer menu/Fiesta Platter questions right away; only require ticket number and purchase date when reporting a wrong or incomplete counter/Drive-Thru/dine-in order).',
        avgLatencyMs: p.latencyMs
      })
    }

    // 5) Pedidos masivos / descuentos por volumen (30 burritos, 50 tortas, 100+ personas, convenios escolares)
    const guestMatch = p.userText.match(/\b(\d{3,4})\s*(?:personas|invitados|people|guests)\b/i)
    const bulkBurritosMatch = p.userText.match(/\b([2-9]\d|\d{3})\s*(?:burritos?|tortas?|platos?)\b/i)
    const asksBulkDiscount =
      /\b(descuentos?|convenios?|discounts?)\b/i.test(normU) &&
      /\b(escuelas?|iglesias?|volumen|mayoreo|\d{2,3}\s*(?:tortas?|burritos?|tacos?)|schools?)\b/i.test(normU)
    if ((guestMatch && Number(guestMatch[1]) >= 100) || bulkBurritosMatch || asksBulkDiscount) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:bulk_orders_and_school_discounts',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'catering',
        questionOrTrigger:
          'Descuentos por volumen / convenios escolares y anticipación en pedidos grandes (30+ burritos, 50 tortas, 100+ personas)',
        triggerKeywords: [
          'descuento por volumen',
          'convenio de descuento para escuelas',
          '50 tortas',
          '30 burritos',
          '115 personas',
          'school discount'
        ],
        customerQuote: sanitizePhoneLearningText(p.userText, 260, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 260, 'es'),
        doubtForOwner:
          'En llamadas reales y del simulador preguntaron: "¿Me haces descuento si pido 50 tortas?", "¿Y si quisiera hacer una orden de 30 burritos?", "¿Tienen convenio de descuento para escuelas?" y eventos de 115 personas. (a) ¿Confirmas que los precios son fijos sin descuentos por volumen/escuelas y que la opción de ahorro grupal son los Fiesta Platters? (b) Para 30+ burritos/tortas o 100+ invitados en tacosgavilan.com, ¿qué anticipación debe recomendar Kore (ej. 1 hora o más)?',
        proposedRuleEs:
          'No manejamos descuentos por volumen ni convenios escolares porque nuestros Fiesta Platters ya tienen precio especial por paquete; para pedidos grandes de 30+ burritos/tortas o 100+ personas, invitar a ordenar en tacosgavilan.com con al menos 1 hora de anticipación.',
        proposedRuleEn:
          'We do not offer volume or school discounts since our Fiesta Platters already feature bundle pricing; for bulk orders of 30+ burritos/tortas or 100+ guests, invite callers to order at tacosgavilan.com at least 1 hour in advance.',
        avgLatencyMs: p.latencyMs
      })
    }

    // 5b) Tiempo estimado de preparación de órdenes normales en tacosgavilan.com ("¿tarda mucho?")
    if (
      /\b(tarda\s+mucho|se\s+tarda\s+un\s+poquito|cuanto\s+tarda|how\s+long\s+does\s+it\s+take)\b/i.test(normU) &&
      pairs.slice(0, idx + 1).some((prev) => /tacosgavilan\.com/i.test(prev.assistantText))
    ) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:regular_online_prep_time',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'policies',
        questionOrTrigger: 'Tiempo estimado de preparación para órdenes individuales normales en tacosgavilan.com ("¿tarda mucho?")',
        triggerKeywords: ['tarda mucho', 'cuanto tarda en linea', 'tiempo de preparacion', 'how long online order'],
        customerQuote: sanitizePhoneLearningText(p.userText, 240, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 240, 'es'),
        doubtForOwner:
          'En una llamada real de Twilio, tras indicarle pedir en tacosgavilan.com, el cliente preguntó "¿tarda mucho?" (y en otra llamada Kore confundió "se tarda un poquito" con la hora de anticipación de Fiesta Platters). Para órdenes normales individuales en tacosgavilan.com (tacos, burritos, tortas, NO charolas), ¿qué tiempo estimado de preparación debe informar Kore (ej. 15 a 20 minutos aprox., o guiarse por la hora estimada que muestra la página al pagar)?',
        proposedRuleEs:
          'Para órdenes individuales normales en tacosgavilan.com (no Fiesta Platters), indicar el tiempo estimado habitual de preparación (ej. alrededor de 15 a 20 minutos según la demanda en sucursal, confirmado en pantalla al pagar); solo los Fiesta Platters requieren mínimo 1 hora.',
        proposedRuleEn:
          'For regular individual online orders at tacosgavilan.com (not Fiesta Platters), state the typical preparation estimate (around 15 to 20 minutes depending on kitchen volume, shown at checkout); only Fiesta Platters require at least 1 hour advance notice.',
        avgLatencyMs: p.latencyMs
      })
    }

    // 5c) Taquizas a domicilio vs entrega / recolección de Fiesta Platters
    if (/\b(taquizas?|taquero\s+a\s+domicilio|parrillero|catering\s+delivery)\b/i.test(normU)) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:taquizas_catering_delivery',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'catering',
        questionOrTrigger: '¿Se hacen taquizas a domicilio o envío a domicilio de Fiesta Platters?',
        triggerKeywords: ['taquizas a domicilio', 'taquiza', 'taquero para fiesta', 'fiesta platter delivery'],
        customerQuote: sanitizePhoneLearningText(p.userText, 240, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 240, 'es'),
        doubtForOwner:
          'Clientes han preguntado "¿Se hacen taquizas a domicilio?". ¿Confirmas que NO ofrecemos servicio de taquero/parrillero a domicilio y si nuestros paquetes Fiesta Platter en tacosgavilan.com son exclusivamente para pasar a recoger en sucursal o también cuentan con opción de envío a domicilio?',
        proposedRuleEs:
          'No ofrecemos servicio de taquero ni parrillero a domicilio, pero manejamos paquetes completos Fiesta Platter listos para tu evento ordenando en tacosgavilan.com con al menos 1 hora de anticipación.',
        proposedRuleEn:
          'We do not offer on-site taco grillers at home, but we offer complete ready-to-serve Fiesta Platters ordered at tacosgavilan.com at least 1 hour in advance.',
        avgLatencyMs: p.latencyMs
      })
    }

    // 5d) Pago con tarjeta física EBT CalFresh RMP en ventanilla de Drive-Thru vs solo en caja de comedor
    if (
      /\b(ebt|ibt|abc|calfresh)\b/i.test(normU) &&
      /\b(drive\s*thru|drive\s*truck|dritro|driver|ventanilla)\b/i.test(normU)
    ) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'doubt:ebt_in_drive_thru_window',
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'payments',
        questionOrTrigger: '¿Se puede pagar con tarjeta EBT CalFresh RMP directamente en la ventanilla del Drive-Thru?',
        triggerKeywords: ['ebt en el drive thru', 'pagar con ebt por el drive thru', 'ebt drive thru window'],
        customerQuote: sanitizePhoneLearningText(p.userText, 240, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 240, 'es'),
        doubtForOwner:
          'Un cliente preguntó dos veces si puede pasar con su tarjeta EBT por la ventanilla del Drive-Thru. En las 6 sucursales con Drive-Thru que aceptan EBT CalFresh RMP (#3 West Covina, #6 Los Ángeles Central y Washington, #10 La Puente, #12 Norwalk, #14 Lynwood y #15 South Gate), ¿la terminal de EBT está disponible tanto en ventanilla de Drive-Thru como en caja de comedor (aclarando que no aplica en línea)?',
        proposedRuleEs:
          'En las sucursales con Drive-Thru participantes en EBT CalFresh RMP (#3, #6, #10, #12, #14 y #15), confirmar si el pago físico con tarjeta EBT se acepta tanto en caja de mostrador como en la ventanilla del Drive-Thru (no válido en pedidos en línea).',
        proposedRuleEn:
          'At participating EBT CalFresh RMP Drive-Thru locations (#3, #6, #10, #12, #14, and #15), confirm whether physical EBT card payment is accepted both at the counter and at the Drive-Thru window (not valid online).',
        avgLatencyMs: p.latencyMs
      })
    }

    // 6) Otras admisiones explícitas de falta de dato oficial de negocio (ej. historia del nombre)
    if (
      UNOFFICIAL_ADMISSION_RE.test(p.assistantText) &&
      !OFF_TOPIC_IGNORE_RE.test(normU) &&
      !rawUnanswered
    ) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: `doubt:unofficial_admission:${shortHash(normU)}`,
        sourceType,
        itemKind: 'doubt_for_owner',
        status: 'needs_owner_input',
        category: 'general',
        questionOrTrigger: sanitizePhoneLearningText(p.userText, 180, 'es'),
        triggerKeywords: normalizeTriggerKeywords(normU.split(' ').filter((w) => w.length >= 5).slice(0, 5)),
        customerQuote: sanitizePhoneLearningText(p.userText, 240, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 240, 'es'),
        doubtForOwner: `Un cliente preguntó "${sanitizePhoneLearningText(p.userText, 140, 'es')}" y Kore indicó no contar con información oficial registrada. Si deseas que Kore tenga una respuesta breve oficial, escríbela aquí (o descártala si prefieres que siga respondiendo así).`,
        proposedRuleEs: null,
        proposedRuleEn: null,
        avgLatencyMs: p.latencyMs
      })
    }

    // 7) Regla canónica correctiva automática: jamás decir que Regular vs Super es "el tamaño"
    if (
      /\bdiferencia\b/i.test(normU) &&
      /\b(burrito|quesadilla|mulita)\b/i.test(normU) &&
      /\bdiferencia\s+es\s+el\s+tama/i.test(normA)
    ) {
      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: 'rule:regular_vs_super_ingredients_not_size',
        sourceType,
        itemKind: 'learned_rule',
        status: 'auto_applied',
        category: 'menu',
        questionOrTrigger: 'Diferencia entre Regular y Super en burritos, quesadillas y mulitas (ingredientes, nunca "tamaño")',
        triggerKeywords: [
          'diferencia entre un burrito y un super burrito',
          'diferencia entre regular y super',
          'difference between regular and super burrito'
        ],
        customerQuote: sanitizePhoneLearningText(p.userText, 240, 'es'),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 240, 'es'),
        proposedRuleEs:
          'Jamás digas que la diferencia entre Regular y Super es "el tamaño": el Burrito Regular ($9.19 USD) lleva carne, arroz y frijol, y el Super Burrito ($11.69 USD) agrega queso, guacamole y crema; en Quesadilla y Mulita la Super también agrega guacamole y crema.',
        proposedRuleEn:
          'Never say the difference between Regular and Super is "size": the Regular Burrito ($9.19 USD) comes with meat, rice, and beans, while the Super Burrito ($11.69 USD) adds cheese, guacamole, and sour cream; Super Quesadillas and Super Mulitas also add guacamole and sour cream.',
        fastReplyEs:
          'El burrito regular lleva carne, arroz y frijol por $9.19 dólares, mientras que el Super Burrito añade queso, guacamole y crema por $11.69 dólares. ¿Te puedo ayudar con algo más?',
        fastReplyEn:
          'Our Regular Burrito includes meat, rice, and beans for $9.19, while the Super Burrito adds cheese, guacamole, and sour cream for $11.69. Can I help you with anything else?',
        avgLatencyMs: p.latencyMs
      })
    }

    // 8) Telemetría agrupada de latencia alta (> 3500 ms entre turno user y respuesta assistant)
    if (p.latencyMs !== null && p.latencyMs > 3500) {
      let bucketKey = 'general_llm_turn'
      let bucketTitle = 'Turnos conversacionales abiertos resueltos vía LLM (> 3.5s)'
      let bucketRuleEs =
        'Respaldo cross-model escalonado (0/650/1250 ms) y respuestas breves de 1-2 oraciones para mantener fluidez telefónica.'
      let bucketRuleEn =
        'Staggered cross-model hedge (0/650/1250 ms) and concise 1-2 sentence replies for fast phone cadence.'

      if (normU.length <= 4 || /^\d{1,5}$/.test(normU)) {
        bucketKey = 'twilio_short_noise_fragment'
        bucketTitle = 'Fragmentos cortos de ruido STT en línea telefónica ("it", "3177") con espera innecesaria (> 3.5s)'
        bucketRuleEs =
          'Interceptar fragmentos cortos de ruido o dígitos huérfanos sin recado abierto en < 2 ms con frase canónica pre-calentada sin invocar LLM.'
        bucketRuleEn =
          'Intercept short STT noise fragments or orphan digits without an active callback flow in < 2 ms using pre-warmed canonical audio.'
      } else if (/\b(cuanto|precio|cuesta|cuestan|cobras|how much|price)\b/i.test(normU)) {
        bucketKey = 'menu_price_llm_wait'
        bucketTitle = 'Consultas de precios de 1 a 3 platillos esperando generación LLM (> 3.5s)'
        bucketRuleEs =
          'Resolver consultas puras de precios del menú de forma determinista en < 2 ms (composeNaturalMenuPriceReply) con pre-calentamiento WAV (~80 ms).'
        bucketRuleEn =
          'Resolve pure menu price queries deterministically in < 2 ms (composeNaturalMenuPriceReply) with WAV audio pre-warming (~80 ms).'
      } else if (/\b(drive\s*thru|drivetru|drivers|cierra mas tarde|otras? sucursales?|otras? locaciones?)\b/i.test(normU)) {
        bucketKey = 'cross_store_comparison_latency'
        bucketTitle = 'Comparativas multi-sucursal de Drive-Thru y cierres nocturnos (> 3.5s)'
        bucketRuleEs =
          'Priorizar respuesta directa desde el directorio compacto en memoria de las 15 sucursales y las 6 ubicaciones con Drive-Thru.'
        bucketRuleEn =
          'Prioritize direct answers from the in-memory 15-store directory and 6 Drive-Thru locations.'
      }

      findings.push({
        storeId: null,
        sourceCallId: callId,
        dedupeKey: `latency:${bucketKey}`,
        sourceType,
        itemKind: 'latency_insight',
        status: 'auto_applied',
        appliesToChannels: 'phone_only',
        category: 'performance',
        questionOrTrigger: bucketTitle,
        customerQuote: sanitizePhoneLearningText(p.userText, 220, callLang),
        koreQuote: sanitizePhoneLearningText(p.assistantText, 220, callLang),
        proposedRuleEs: bucketRuleEs,
        proposedRuleEn: bucketRuleEn,
        avgLatencyMs: p.latencyMs
      })
    }

    // 9) Detectar respuestas frecuentes limpias y concisas (<= 220 chars, repetidas en >=2 llamadas distintas) candidatas a Pre-Warming WAV (~80 ms)
    const cleanReply = p.assistantText.trim()
    const looksCleanForPrewarm =
      cleanReply.length >= 28 &&
      cleanReply.length <= 220 &&
      /[.!?]$/.test(cleanReply) &&
      !TECHNICAL_FALLBACK_RE.test(cleanReply) &&
      !RAW_CSV_FALLBACK_RE.test(cleanReply) &&
      !UNOFFICIAL_ADMISSION_RE.test(cleanReply) &&
      !/\b(pol[ií]ticas?\s+de\s+Tacos\s+Gavilan|Per\s+Tacos\s+Gavilan\s+policy|tel[eé]fonos?\s+personales?|\$9\.49)\b/i.test(
        cleanReply
      ) &&
      !/\b(desayunos?|breakfast|tarda\s+mucho|se\s+tarda\s+un\s+poquito|por\s+politicas\s+de\s+tacos)\b/i.test(normU) &&
      !/\b(ticket\s*#?\d+|orden\s+\d{3,6}|order\s*#?\d{3,6}|\d{3}[-\s]\d{3}[-\s]\d{4}|Gracias,\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\b/.test(
        cleanReply
      ) &&
      normU.split(' ').length >= 2 &&
      normU.length >= 8

    if (looksCleanForPrewarm) {
      const replyLang: 'es' | 'en' = /\b(thanks|welcome|today|open|close|each|dollars|anything else|help you)\b/i.test(
        cleanReply
      )
        ? 'en'
        : callLang
      const normReplyKey = `${replyLang}:${normalizeMatchToken(cleanReply)}`
      const prev = prewarmCandidates.get(normReplyKey)
      if (prev) {
        prev.count += 1
        prev.callIds.add(callId)
      } else {
        prewarmCandidates.set(normReplyKey, {
          text: cleanReply,
          lang: replyLang,
          trigger: sanitizePhoneLearningText(p.userText, 160, replyLang),
          count: 1,
          callId,
          callIds: new Set([callId])
        })
      }
    }

    if (normU && !OFF_TOPIC_IGNORE_RE.test(normU) && !TRIVIAL_CLOSE_OR_GREETING_RE.test(normU) && normU.split(' ').length >= 2) {
      meaningfulCustomerTurns++
    }

    const prevPair = idx > 0 ? pairs[idx - 1] : undefined
    const explicitCorrection = CALLER_CORRECTION_OR_FRICTION_RE.test(normU)
    const retryPair = Boolean(prevPair && areTurnsLikelyRetryPair(prevPair.userText, p.userText))

    if ((explicitCorrection || retryPair) && !OFF_TOPIC_IGNORE_RE.test(normU)) {
      enrichmentPriority = 3
      if (explicitCorrection && !correctionFallback) {
        const quotePair = retryPair && prevPair
          ? `${sanitizePhoneLearningText(prevPair.userText, 120, callLang)} -> ${sanitizePhoneLearningText(p.userText, 120, callLang)}`
          : sanitizePhoneLearningText(p.userText, 240, callLang)
        const refAssistant = prevPair?.assistantText || p.assistantText
        correctionFallback = {
          storeId,
          sourceCallId: callId,
          dedupeKey: `phone_friction:correction:${shortHash(normalizeQuestionFingerprint(refAssistant || quotePair))}`,
          sourceType,
          itemKind: 'doubt_for_owner',
          status: 'needs_owner_input',
          appliesToChannels: 'both',
          category: 'general',
          questionOrTrigger: `Fricción o malentendido reportado por el cliente: "${sanitizePhoneLearningText(p.userText, 110, 'es')}"`,
          triggerKeywords: normalizeTriggerKeywords(normU.split(' ').filter((w) => w.length >= 4).slice(0, 6)),
          customerQuote: quotePair,
          koreQuote: sanitizePhoneLearningText(refAssistant, 240, callLang) || null,
          doubtForOwner: `Durante la llamada, el cliente tuvo que aclarar o corregir a Kore ("${sanitizePhoneLearningText(p.userText, 140, 'es')}"). Revisa qué contestó Kore y confirma la regla oficial o corrección de interpretación.`,
          proposedRuleEs: null,
          proposedRuleEn: null,
          avgLatencyMs: p.latencyMs
        }
      }
    }

    if (
      (call.source === 'twilio' || isLiveSimulator) &&
      (TECHNICAL_FALLBACK_RE.test(p.assistantText) ||
        RAW_CSV_FALLBACK_RE.test(p.assistantText) ||
        UNOFFICIAL_ADMISSION_RE.test(p.assistantText)) &&
      normU.length > 6
    ) {
      enrichmentPriority = 3
    }
  }

  if (String(call.unanswered_question || '').trim().length >= 6) {
    enrichmentPriority = 3
  } else if (enrichmentPriority < 2 && call.source === 'twilio' && meaningfulCustomerTurns >= 2) {
    enrichmentPriority = 2
  } else if (enrichmentPriority < 1 && isLiveSimulator && meaningfulCustomerTurns >= 2) {
    enrichmentPriority = 1
  }

  return { findings, enrichmentPriority, correctionFallback }
}

async function extractLlmPhoneCallDoubts(
  call: any,
  sourceType: PhoneLearningSourceType,
  alreadyCoveredTriggers: string[]
): Promise<CandidatePhoneFinding[]> {
  const pairs = extractTurnPairs(call.transcript)
  if (pairs.length === 0) return []
  try {
    const transcriptCompact = pairs
      .slice(0, 14)
      .map((p) => `CLIENTE: ${p.userText.slice(0, 180)}\nKORE: ${p.assistantText.slice(0, 220)}`)
      .join('\n---\n')

    const coveredSnippet = alreadyCoveredTriggers.slice(0, 35).join(' | ') || 'ninguno'
    const prompt = [
      'Audita esta llamada telefónica real o simulación Kore 3.8 Live de Tacos Gavilan en California (cada llamada ya entra en la línea directa de una sucursal específica).',
      'Si Kore respondió correctamente con datos reales (horario de esa tienda, lista de 6 Drive-Thru, regla de desayunos hasta 2 PM, precios USD) y el cliente no reportó error, DEVUELVE {"items":[]} obligatoriamente.',
      'Solo reporta MÁXIMO 1 hallazgo genuino NO cubierto:',
      '  A) itemKind="stt_synonym": cuando el audio/transcripción deformó una palabra real (ej. "ibt"->"EBT", "hadas"->"asada", "sasada"->"asada", "dritro"->"Drive-Thru") generando confusión o repetición.',
      '  B) itemKind="doubt_for_owner": cuando Kore dio una respuesta falsa, fuera de tema (ej. responder cancelación cuando preguntan ubicaciones), o faltó una política real de negocio.',
      `Temas ya cubiertos en sistema/bandeja (NO repetir ni duplicar): ${coveredSnippet}.`,
      'PROHIBIDO reportar: tecla "9" (es nuestro comando DTMF oficial para cambiar Español/Inglés), preguntar por horario o ubicación cuando Kore ya contestó con los datos de su tienda, preguntas sobre el modelo de IA, ruido suelto ("it", "3177") o spam.',
      'Reglas de marca obligatorias: usa "Tacos Gavilan" (jamás "El"), precios en dólares USD (jamás pesos).',
      'Devuelve SOLO JSON válido usando exactamente "doubt_for_owner" o "stt_synonym" en itemKind (sin barra "|"): {"items":[{"itemKind":"doubt_for_owner","category":"menu|hours|policies|catering|payments|general","spokenVariant":"solo si stt_synonym, ej: ibt","intendedTerm":"solo si stt_synonym, ej: EBT","questionOrTrigger":"...","customerQuote":"...","koreQuote":"...","doubtForOwner":"Explicación clara en español para Carlos","proposedRuleEs":"Regla operativa clara para Kore ES","proposedRuleEn":"Clear operational rule for Kore EN"}]}',
      'Si itemKind="stt_synonym", redacta proposedRuleEs exactamente indicando qué palabra deformada escuchar e interpretar como cuál término oficial.',
      transcriptCompact
    ].join('\n')

    const llmRes = await generateGeminiLearningJson<{ items?: any[] }>({
      models: GEMINI_LEARNING_MODELS,
      prompt,
      maxOutputTokens: 600,
      temperature: 0.1,
      timeoutMs: 6500
    })
    if (!llmRes?.data) return []

    const arr = Array.isArray(llmRes.data?.items) ? llmRes.data.items.slice(0, 1) : []
    const out: CandidatePhoneFinding[] = []
    const coveredNorms = new Set(alreadyCoveredTriggers.map((t) => normalizeMatchToken(t)).filter((t) => t.length >= 6))

    for (const it of arr) {
      const spokenVariant = sanitizePhoneLearningText(it?.spokenVariant || '', 60, 'es')
      const intendedTerm = sanitizePhoneLearningText(it?.intendedTerm || '', 60, 'es')
      const rawKindStr = String(it?.itemKind || '').trim().toLowerCase()
      const hasSttPair =
        spokenVariant.length >= 2 &&
        intendedTerm.length >= 2 &&
        normalizeMatchToken(spokenVariant) !== normalizeMatchToken(intendedTerm)
      const rawKind: 'stt_synonym' | 'doubt_for_owner' =
        rawKindStr === 'stt_synonym' || (hasSttPair && (rawKindStr.includes('stt_synonym') || rawKindStr !== 'doubt_for_owner'))
          ? 'stt_synonym'
          : 'doubt_for_owner'
      const trigger = sanitizePhoneLearningText(it?.questionOrTrigger, 180, 'es')
      const doubt = sanitizePhoneLearningText(it?.doubtForOwner, 420, 'es')
      if (trigger.length < 10 || doubt.length < 15) continue
      if (/^(?:\bit\b|3177)$/i.test(trigger) || /\bTEST_SMOKE_/i.test(trigger)) continue

      const normTrig = normalizeMatchToken(trigger)
      if (coveredNorms.has(normTrig)) continue

      const dedupeKey =
        rawKind === 'stt_synonym' && spokenVariant && intendedTerm
          ? `stt:${shortHash(`${normalizeMatchToken(spokenVariant)}=>${normalizeMatchToken(intendedTerm)}`)}`
          : `doubt:llm_phone:${shortHash(normTrig)}`

      const triggerKeywords =
        rawKind === 'stt_synonym'
          ? normalizeTriggerKeywords([spokenVariant, intendedTerm])
          : normalizeTriggerKeywords(normTrig.split(' ').filter((w) => w.length >= 4).slice(0, 6))

      out.push({
        storeId:
          rawKind === 'stt_synonym'
            ? null
            : Number.isInteger(Number(call.store_id)) && Number(call.store_id) > 0
              ? Number(call.store_id)
              : null,
        sourceCallId: String(call.id),
        dedupeKey,
        sourceType,
        itemKind: rawKind,
        status: 'needs_owner_input',
        appliesToChannels: 'both',
        category: String(it?.category || 'general').slice(0, 40),
        questionOrTrigger: trigger,
        triggerKeywords,
        customerQuote: sanitizePhoneLearningText(it?.customerQuote, 260, 'es') || null,
        koreQuote: sanitizePhoneLearningText(it?.koreQuote, 260, 'es') || null,
        doubtForOwner: doubt,
        proposedRuleEs: sanitizePhoneLearningText(it?.proposedRuleEs, 380, 'es') || null,
        proposedRuleEn: sanitizePhoneLearningText(it?.proposedRuleEn, 380, 'en') || null
      })
    }
    return out
  } catch {
    return []
  }
}

async function upsertPhoneLearningFinding(
  f: CandidatePhoneFinding
): Promise<'inserted' | 'incremented' | 'skipped'> {
  const delta = Math.max(1, Math.trunc(Number(f.evidenceDelta) || 1))
  const inferredChannels: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(f.appliesToChannels)
    ? f.appliesToChannels
    : inferAppliesToChannels({
        questionOrTrigger: f.questionOrTrigger,
        proposedRuleEs: f.proposedRuleEs,
        proposedRuleEn: f.proposedRuleEn,
        customerQuote: f.customerQuote,
        dedupeKey: f.dedupeKey,
        category: f.category,
        itemKind: f.itemKind
      })

  let { data: existing } = await supabaseAdmin
    .from('phone_learning_items')
    .select(SELECT_PHONE_LEARNING_COLS)
    .eq('dedupe_key', f.dedupeKey)
    .maybeSingle()

  // Si el cron de Drive-Thru (5:25 AM) ya propagó una fila genérica phone_q: para la misma llamada/huella, reutilizarla sin duplicar
  if (!existing && f.itemKind !== 'audio_prewarm' && f.itemKind !== 'latency_insight') {
    const fpQuote = normalizeQuestionFingerprint(f.customerQuote || f.questionOrTrigger)
    const altDedupeKey = fpQuote.length >= 8 ? `phone_q:${shortHash(fpQuote)}` : null
    if (altDedupeKey && altDedupeKey !== f.dedupeKey) {
      const { data: altRow } = await supabaseAdmin
        .from('phone_learning_items')
        .select(SELECT_PHONE_LEARNING_COLS)
        .eq('dedupe_key', altDedupeKey)
        .maybeSingle()
      if (altRow?.id) existing = altRow
    }
  }

  if (existing?.id) {
    const prevCount = Math.max(1, Number(existing.evidence_count || 1))
    const nextCount = prevCount + delta
    const nextLat =
      f.avgLatencyMs !== null && f.avgLatencyMs !== undefined
        ? existing.avg_latency_ms !== null && existing.avg_latency_ms !== undefined
          ? Math.round((Number(existing.avg_latency_ms) * prevCount + f.avgLatencyMs * delta) / nextCount)
          : f.avgLatencyMs
        : existing.avg_latency_ms

    const patchPayload: Record<string, any> = {
      evidence_count: nextCount,
      avg_latency_ms: nextLat,
      updated_at: new Date().toISOString()
    }
    if (f.audioPrewarmed && !existing.audio_prewarmed) {
      patchPayload.audio_prewarmed = true
    }
    const { data: updatedExisting } = await supabaseAdmin
      .from('phone_learning_items')
      .update(patchPayload)
      .eq('id', existing.id)
      .select(SELECT_PHONE_LEARNING_COLS)
      .maybeSingle()

    if (
      updatedExisting &&
      updatedExisting.item_kind !== 'audio_prewarm' &&
      updatedExisting.item_kind !== 'latency_insight' &&
      !updatedExisting.synced_dt_item_id &&
      (updatedExisting.applies_to_channels === 'both' || updatedExisting.applies_to_channels === 'drive_thru_only')
    ) {
      await syncPhoneLearningItemToDriveThru(updatedExisting)
    }
    return 'incremented'
  }

  let kbEntryId: string | null = null
  if (
    f.status === 'auto_applied' &&
    f.itemKind !== 'audio_prewarm' &&
    f.itemKind !== 'latency_insight' &&
    (inferredChannels === 'both' || inferredChannels === 'phone_only') &&
    (f.fastReplyEs || f.proposedRuleEs)
  ) {
    kbEntryId = await syncLearnedRuleToKnowledgeBase({
      existingKbEntryId: null,
      storeId: f.storeId,
      category: f.category || 'general',
      title: f.questionOrTrigger.slice(0, 180),
      triggerKeywords: f.triggerKeywords ?? [],
      answerEs: (f.fastReplyEs || f.proposedRuleEs || '').slice(0, 1500),
      answerEn: (f.fastReplyEn || f.proposedRuleEn || f.proposedRuleEs || '').slice(0, 1500)
    })
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('phone_learning_items')
    .insert({
      store_id: f.storeId,
      source_call_id: f.sourceCallId,
      dedupe_key: f.dedupeKey,
      source_type: f.sourceType,
      item_kind: f.itemKind,
      status: f.status,
      applies_to_channels: inferredChannels,
      category: f.category || 'general',
      question_or_trigger: f.questionOrTrigger,
      trigger_keywords: f.triggerKeywords ?? [],
      customer_quote: f.customerQuote ?? null,
      kore_quote: f.koreQuote ?? null,
      doubt_for_owner: f.doubtForOwner ?? null,
      proposed_rule_es: f.proposedRuleEs ?? null,
      proposed_rule_en: f.proposedRuleEn ?? null,
      fast_reply_es: f.fastReplyEs ?? null,
      fast_reply_en: f.fastReplyEn ?? null,
      kb_entry_id: kbEntryId,
      evidence_count: delta,
      avg_latency_ms: f.avgLatencyMs ?? null,
      audio_prewarmed: Boolean(f.audioPrewarmed)
    })
    .select(SELECT_PHONE_LEARNING_COLS)
    .single()

  if (error || !inserted) return 'skipped'

  if (inserted.item_kind !== 'audio_prewarm' && inserted.item_kind !== 'latency_insight') {
    await syncPhoneLearningItemToDriveThru(inserted)
  }

  return 'inserted'
}

/**
 * Escanea llamadas no procesadas (`analyzed_at IS NULL`, o recientes si se pasa `reanalyzeRecentHours`) en
 * `public.phone_calls` priorizando llamadas reales `source = 'twilio'` antes que `simulator`, ejecuta detectores
 * forenses + enriquecimiento Gemini estructurado, pre-calienta hasta 8 clips frecuentes en Supabase Storage (`~80 ms`)
 * y sella `analyzed_at = now()` sin tocar jamás `transcript`.
 */
export async function analyzeUnprocessedPhoneCalls(opts?: {
  storeId?: number | null
  limit?: number
  reanalyzeRecentHours?: number
  prewarmAudio?: boolean
  triggerSource?: string
}): Promise<{
  analyzedCallsCount: number
  twilioCallsAnalyzed: number
  simulatorCallsAnalyzed: number
  insertedItems: number
  incrementedItems: number
  prewarmedNowCount: number
}> {
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(opts?.limit) || 80)))
  const validSources = new Set<PhoneLearningSourceType>([
    'cron_daily',
    'auto_analysis',
    'twilio_call',
    'simulator_call',
    'manual_owner'
  ])
  const baseTrigger: PhoneLearningSourceType = validSources.has(opts?.triggerSource as PhoneLearningSourceType)
    ? (opts!.triggerSource as PhoneLearningSourceType)
    : 'auto_analysis'

  const selectCols =
    'id, call_sid, store_id, source, language, primary_intent, status, resolved_by_ai, turns_count, unanswered_question, summary, transcript, started_at, analyzed_at'

  const applyFilters = (q: any) => {
    if (opts?.storeId && Number.isInteger(opts.storeId) && opts.storeId > 0) {
      q = q.eq('store_id', Math.trunc(opts.storeId))
    }
    // Nunca sellar `analyzed_at` sobre llamadas vivas aún en curso (`in_progress` / `ringing`)
    q = q.not('status', 'in', '("in_progress","in-progress","ringing","queued","initiated")')
    if (opts?.reanalyzeRecentHours && Number(opts.reanalyzeRecentHours) > 0) {
      const sinceIso = new Date(Date.now() - Number(opts.reanalyzeRecentHours) * 3600_000).toISOString()
      q = q.or(`analyzed_at.is.null,started_at.gte.${sinceIso}`)
    } else {
      q = q.is('analyzed_at', null)
    }
    return q
  }

  // Priorizar SIEMPRE llamadas reales `source = 'twilio'` primero
  const { data: twilioRows, error: twErr } = await applyFilters(
    supabaseAdmin.from('phone_calls').select(selectCols).eq('source', 'twilio')
  )
    .order('started_at', { ascending: false })
    .limit(limit)

  if (twErr) throw new Error(`Error consultando llamadas Twilio por analizar: ${twErr.message}`)

  const remaining = Math.max(0, limit - (twilioRows?.length || 0))
  let simRows: any[] = []
  if (remaining > 0) {
    const { data: sRows, error: sErr } = await applyFilters(
      supabaseAdmin.from('phone_calls').select(selectCols).neq('source', 'twilio')
    )
      .order('started_at', { ascending: false })
      .limit(remaining)
    if (sErr) throw new Error(`Error consultando llamadas de simulador por analizar: ${sErr.message}`)
    simRows = sRows || []
  }

  const callsToAnalyze = [...(twilioRows || []), ...simRows]
  const prewarmCandidates = new Map<
    string,
    { text: string; lang: 'es' | 'en'; trigger: string; count: number; callId: string; callIds: Set<string> }
  >()
  const aggregatedFindings = new Map<string, CandidatePhoneFinding>()

  const mergeFinding = (f: CandidatePhoneFinding) => {
    const prev = aggregatedFindings.get(f.dedupeKey)
    if (!prev) {
      aggregatedFindings.set(f.dedupeKey, { ...f, evidenceDelta: 1 })
    } else {
      const prevDelta = prev.evidenceDelta || 1
      const nextDelta = prevDelta + 1
      prev.evidenceDelta = nextDelta
      if (f.avgLatencyMs !== null && f.avgLatencyMs !== undefined) {
        prev.avgLatencyMs =
          prev.avgLatencyMs !== null && prev.avgLatencyMs !== undefined
            ? Math.round((prev.avgLatencyMs * prevDelta + f.avgLatencyMs) / nextDelta)
            : f.avgLatencyMs
      }
    }
  }

  const enrichmentCandidates: Array<{
    call: any
    sourceType: PhoneLearningSourceType
    detTriggers: string[]
    priority: 1 | 2 | 3
    correctionFallback: CandidatePhoneFinding | null
  }> = []

  for (const call of callsToAnalyze) {
    const itemSource: PhoneLearningSourceType =
      baseTrigger === 'cron_daily'
        ? 'cron_daily'
        : call.source === 'twilio'
          ? 'twilio_call'
          : 'auto_analysis'

    const { findings: detFindings, enrichmentPriority, correctionFallback } = extractForensicCallFindings(
      call,
      itemSource,
      prewarmCandidates
    )

    for (const f of detFindings) mergeFinding(f)

    if (enrichmentPriority > 0) {
      enrichmentCandidates.push({
        call,
        sourceType: itemSource,
        detTriggers: detFindings.map((d) => d.questionOrTrigger),
        priority: enrichmentPriority as 1 | 2 | 3,
        correctionFallback
      })
    } else if (correctionFallback) {
      mergeFinding(correctionFallback)
    }
  }

  if (enrichmentCandidates.length > 0) {
    enrichmentCandidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return Date.parse(String(b.call.started_at || '')) - Date.parse(String(a.call.started_at || ''))
    })

    const { data: existingRuleRows } = await supabaseAdmin
      .from('phone_learning_items')
      .select('question_or_trigger')
      .neq('item_kind', 'audio_prewarm')
      .neq('item_kind', 'latency_insight')
      .order('updated_at', { ascending: false })
      .limit(50)

    const globalCovered = (existingRuleRows || [])
      .map((r: any) => String(r?.question_or_trigger || '').trim())
      .filter(Boolean)

    const topForLlm = enrichmentCandidates.slice(0, MAX_LLM_CALL_ENRICHMENTS_PER_RUN)
    const overflow = enrichmentCandidates.slice(MAX_LLM_CALL_ENRICHMENTS_PER_RUN)

    const LLM_CONCURRENCY = 3
    for (let i = 0; i < topForLlm.length; i += LLM_CONCURRENCY) {
      const slice = topForLlm.slice(i, i + LLM_CONCURRENCY)
      await Promise.all(
        slice.map(async (item) => {
          const llmFindings = await extractLlmPhoneCallDoubts(item.call, item.sourceType, [
            ...globalCovered,
            ...item.detTriggers
          ])
          if (llmFindings.length > 0) {
            for (const lf of llmFindings) mergeFinding(lf)
          } else if (item.correctionFallback) {
            mergeFinding(item.correctionFallback)
          }
        })
      )
    }

    for (const item of overflow) {
      if (item.correctionFallback) mergeFinding(item.correctionFallback)
    }
  }

  let insertedItems = 0
  let incrementedItems = 0

  for (const finding of aggregatedFindings.values()) {
    const res = await upsertPhoneLearningFinding(finding)
    if (res === 'inserted') insertedItems++
    else if (res === 'incremented') incrementedItems++
  }

  // Pre-calentar en Supabase Storage hasta 8 respuestas frecuentes reales (vistas en >=2 llamadas distintas) que aún no tengan clip WAV
  let prewarmedNowCount = 0
  if (opts?.prewarmAudio !== false && prewarmCandidates.size > 0) {
    const sortedCandidates = Array.from(prewarmCandidates.values())
      .filter((c) => c.callIds.size >= 2)
      .sort((a, b) => b.callIds.size - a.callIds.size || b.count - a.count)
      .slice(0, 12)

    let synthesesUsed = 0
    for (const cand of sortedCandidates) {
      if (synthesesUsed >= MAX_PREWARMS_PER_RUN) break
      const dedupeKey = `prewarm:${cand.lang}:${shortHash(normalizeMatchToken(cand.text))}`
      try {
        const alreadyInStorage = await warmPhoneSpeechFromStorageOnly(cand.text, cand.lang, 'Kore')
        let wavReady = alreadyInStorage
        if (!alreadyInStorage) {
          synthesesUsed++
          const wav = await getPhoneAgentSpeech(cand.text, cand.lang, 'Kore', false, {
            awaitStoragePersist: true,
            maxTotalMs: 12_000
          })
          wavReady = Boolean(wav && wav.length > 44)
          if (wavReady) prewarmedNowCount++
        }
        if (wavReady) {
          const outcome = await upsertPhoneLearningFinding({
            storeId: null,
            sourceCallId: cand.callId,
            dedupeKey,
            sourceType: baseTrigger,
            itemKind: 'audio_prewarm',
            status: 'auto_applied',
            appliesToChannels: 'phone_only',
            category: 'audio_cache',
            questionOrTrigger: cand.trigger || cand.text.slice(0, 120),
            koreQuote: cand.text,
            fastReplyEs: cand.lang === 'es' ? cand.text : null,
            fastReplyEn: cand.lang === 'en' ? cand.text : null,
            audioPrewarmed: true,
            evidenceDelta: cand.callIds.size
          })
          if (outcome === 'inserted') insertedItems++
          else if (outcome === 'incremented') incrementedItems++
        }
      } catch {
        // Ignorar fallo individual de TTS para no detener el lote del cron
      }
    }
  }

  // Sellar `analyzed_at` en bloques de 50 IDs sin tocar jamás `transcript`
  const analyzedIds = callsToAnalyze.map((c) => String(c.id)).filter(Boolean)
  const nowIso = new Date().toISOString()
  for (let i = 0; i < analyzedIds.length; i += 50) {
    const batch = analyzedIds.slice(i, i + 50)
    await supabaseAdmin.from('phone_calls').update({ analyzed_at: nowIso }).in('id', batch)
  }

  invalidatePhoneLearnedRulesCache()
  return {
    analyzedCallsCount: callsToAnalyze.length,
    twilioCallsAnalyzed: twilioRows?.length || 0,
    simulatorCallsAnalyzed: simRows.length,
    insertedItems,
    incrementedItems,
    prewarmedNowCount
  }
}

async function syncLearnedRuleToKnowledgeBase(params: {
  existingKbEntryId: string | null
  storeId: number | null
  category: string
  title: string
  triggerKeywords: string[]
  answerEs: string
  answerEn: string
}): Promise<string | null> {
  const cleanTitle = params.title.slice(0, 180)
  const cleanKeywords = params.triggerKeywords.join(', ').slice(0, 500) || null
  const cleanEs = params.answerEs.slice(0, 1500)
  const cleanEn = params.answerEn.slice(0, 1500)
  const nowIso = new Date().toISOString()

  if (params.existingKbEntryId) {
    const { data: updated } = await supabaseAdmin
      .from('phone_knowledge_base')
      .update({
        store_id: params.storeId,
        category: params.category || 'general',
        title: cleanTitle,
        question_keywords: cleanKeywords,
        answer_es: cleanEs,
        answer_en: cleanEn,
        is_active: true,
        updated_at: nowIso
      })
      .eq('id', params.existingKbEntryId)
      .select('id')
      .maybeSingle()
    if (updated?.id) return String(updated.id)
  }

  let matchQuery = supabaseAdmin.from('phone_knowledge_base').select('id').eq('title', cleanTitle)
  matchQuery = params.storeId === null ? matchQuery.is('store_id', null) : matchQuery.eq('store_id', params.storeId)
  const { data: sameTitle } = await matchQuery.maybeSingle()

  if (sameTitle?.id) {
    await supabaseAdmin
      .from('phone_knowledge_base')
      .update({
        category: params.category || 'general',
        question_keywords: cleanKeywords,
        answer_es: cleanEs,
        answer_en: cleanEn,
        is_active: true,
        updated_at: nowIso
      })
      .eq('id', sameTitle.id)
    return String(sameTitle.id)
  }

  const { data: created } = await supabaseAdmin
    .from('phone_knowledge_base')
    .insert({
      store_id: params.storeId,
      category: params.category || 'general',
      title: cleanTitle,
      question_keywords: cleanKeywords,
      answer_es: cleanEs,
      answer_en: cleanEn,
      is_active: true,
      priority: 88
    })
    .select('id')
    .single()

  return created?.id ? String(created.id) : null
}

export async function prewarmApprovedFastReplies(
  fastReplyEs: string | null,
  fastReplyEn: string | null,
  isSmokeTest: boolean
): Promise<boolean> {
  if (isSmokeTest) return false
  const tasks: Array<Promise<boolean>> = []
  if (fastReplyEs && fastReplyEs.length <= 220) {
    tasks.push(
      getPhoneAgentSpeech(fastReplyEs, 'es', 'Kore', false, {
        awaitStoragePersist: true,
        maxTotalMs: 10_000
      })
        .then((b) => Boolean(b && b.length > 44))
        .catch(() => false)
    )
  }
  if (fastReplyEn && fastReplyEn.length <= 220) {
    tasks.push(
      getPhoneAgentSpeech(fastReplyEn, 'en', 'Kore', false, {
        awaitStoragePersist: true,
        maxTotalMs: 10_000
      })
        .then((b) => Boolean(b && b.length > 44))
        .catch(() => false)
    )
  }
  if (tasks.length === 0) return false
  const outcomes = await Promise.all(tasks)
  return outcomes.some(Boolean)
}

async function notifyPhoneContextInvalidation(storeId?: number | null): Promise<void> {
  invalidatePhoneLearnedRulesCache()
  try {
    const mod = await import('@/lib/phone-agent')
    if (typeof mod.invalidateStorePhoneContextCache === 'function') {
      mod.invalidateStorePhoneContextCache(storeId ?? undefined)
    }
  } catch {
    // Seguro si phone-agent no está cargado en este proceso aislado
  }
}

async function notifyDriveThruCachesInvalidation(storeId?: number | null): Promise<void> {
  try {
    const [dtLearnMod, dtKoreMod] = await Promise.all([
      import('@/lib/drive-thru-kore-learning'),
      import('@/lib/drive-thru-kore')
    ])
    if (typeof dtLearnMod.invalidateKoreLearnedRulesCache === 'function') {
      dtLearnMod.invalidateKoreLearnedRulesCache()
    }
    if (typeof dtKoreMod.invalidateKoreKnowledgeCache === 'function') {
      dtKoreMod.invalidateKoreKnowledgeCache(storeId ?? undefined)
    }
  } catch {
    // Seguro si el módulo de Drive-Thru no está inicializado en un worker aislado
  }
}

function mapPhoneKindToDriveThruKind(
  kind: string
): 'doubt_for_owner' | 'learned_rule' | 'synonym_fix' | 'latency_insight' {
  if (kind === 'doubt_for_owner') return 'doubt_for_owner'
  if (kind === 'stt_synonym') return 'synonym_fix'
  if (kind === 'latency_insight') return 'latency_insight'
  return 'learned_rule'
}

function mapPhoneSourceToDriveThruSource(
  src: string
): 'auto_analysis' | 'cron_daily' | 'manual_owner' | 'phone_call' {
  if (src === 'manual_owner') return 'manual_owner'
  if (src === 'cron_daily') return 'cron_daily'
  if (src === 'twilio_call' || src === 'simulator_call') return 'phone_call'
  return 'auto_analysis'
}

/**
 * Dirección Teléfono -> Drive-Thru: sincroniza en tiempo real un ítem de `public.phone_learning_items` hacia
 * `public.dt_kore_learning_items`, enlazando `synced_dt_item_id <-> synced_phone_item_id` + `synced_kb_id` e
 * invalidando al instante `invalidateKoreLearnedRulesCache()` + `invalidateKoreKnowledgeCache()`.
 */
export async function syncPhoneLearningItemToDriveThru(phoneItemRow: any): Promise<any> {
  if (!phoneItemRow || !phoneItemRow.id) return phoneItemRow
  const phoneId = String(phoneItemRow.id)
  const itemKind = String(phoneItemRow.item_kind || '')
  if (itemKind === 'audio_prewarm') return phoneItemRow

  const channels: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(phoneItemRow.applies_to_channels)
    ? phoneItemRow.applies_to_channels
    : inferAppliesToChannels({
        questionOrTrigger: phoneItemRow.question_or_trigger,
        proposedRuleEs: phoneItemRow.proposed_rule_es,
        proposedRuleEn: phoneItemRow.proposed_rule_en,
        ownerInstruction: phoneItemRow.owner_instruction,
        customerQuote: phoneItemRow.customer_quote,
        dedupeKey: phoneItemRow.dedupe_key,
        category: phoneItemRow.category,
        itemKind
      })

  if (itemKind === 'latency_insight' && channels === 'phone_only') {
    return phoneItemRow
  }

  const nowIso = new Date().toISOString()
  const status = String(phoneItemRow.status || 'needs_owner_input')
  const storeId =
    phoneItemRow.store_id === null || phoneItemRow.store_id === undefined ? null : Number(phoneItemRow.store_id)
  const kbEntryId = phoneItemRow.kb_entry_id ? String(phoneItemRow.kb_entry_id) : null
  const dedupeKey = phoneItemRow.dedupe_key ? String(phoneItemRow.dedupe_key) : null

  // 1) Buscar gemelo existente en dt_kore_learning_items por synced_dt_item_id, synced_phone_item_id, synced_kb_id, dedupe_key o huella
  let dtTwin: any = null
  if (phoneItemRow.synced_dt_item_id) {
    const { data } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select('*')
      .eq('id', String(phoneItemRow.synced_dt_item_id))
      .maybeSingle()
    if (data?.id) dtTwin = data
  }
  if (!dtTwin) {
    const { data } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select('*')
      .eq('synced_phone_item_id', phoneId)
      .limit(1)
      .maybeSingle()
    if (data?.id) dtTwin = data
  }
  if (!dtTwin && kbEntryId) {
    const { data } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select('*')
      .eq('synced_kb_id', kbEntryId)
      .limit(1)
      .maybeSingle()
    if (data?.id && (!data.synced_phone_item_id || String(data.synced_phone_item_id) === phoneId)) {
      dtTwin = data
    }
  }
  if (!dtTwin && dedupeKey) {
    const { data } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .select('*')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (data?.id && (!data.synced_phone_item_id || String(data.synced_phone_item_id) === phoneId)) {
      dtTwin = data
    }
  }
  if (!dtTwin) {
    const fpTrigger = normalizeQuestionFingerprint(phoneItemRow.question_or_trigger)
    const fpQuote = normalizeQuestionFingerprint(phoneItemRow.customer_quote)
    const candidateHashKeys: string[] = []
    if (fpTrigger.length >= 8) candidateHashKeys.push(`phone_q:${shortHash(fpTrigger)}`)
    if (fpQuote.length >= 8 && fpQuote !== fpTrigger) candidateHashKeys.push(`phone_q:${shortHash(fpQuote)}`)
    if (candidateHashKeys.length > 0) {
      const { data: byHash } = await supabaseAdmin
        .from('dt_kore_learning_items')
        .select('*')
        .in('dedupe_key', candidateHashKeys)
        .limit(5)
      dtTwin = (byHash || []).find((r: any) => !r.synced_phone_item_id || String(r.synced_phone_item_id) === phoneId) || null
    }
    if (!dtTwin && (fpTrigger.length >= 8 || fpQuote.length >= 8)) {
      const { data: openDt } = await supabaseAdmin
        .from('dt_kore_learning_items')
        .select('*')
        .is('synced_phone_item_id', null)
        .neq('item_kind', 'latency_insight')
        .limit(80)
      dtTwin =
        (openDt || []).find((r: any) => {
          const rFpT = normalizeQuestionFingerprint(r.question_or_trigger)
          const rFpQ = normalizeQuestionFingerprint(r.customer_quote)
          return (
            (fpTrigger.length >= 8 && (rFpT === fpTrigger || rFpQ === fpTrigger)) ||
            (fpQuote.length >= 8 && (rFpT === fpQuote || rFpQ === fpQuote))
          )
        }) || null
    }
  }

  // 2) Si es 'phone_only' o 'dismissed', reflejar en el gemelo de Drive-Thru (si existe) e invalidar cachés
  if (channels === 'phone_only' || status === 'dismissed') {
    let syncedDtId: string | null = phoneItemRow.synced_dt_item_id ? String(phoneItemRow.synced_dt_item_id) : null
    if (dtTwin?.id) {
      syncedDtId = String(dtTwin.id)
      const nextDtStatus =
        status === 'dismissed'
          ? 'dismissed'
          : dtTwin.status === 'needs_owner_input'
            ? 'dismissed'
            : String(dtTwin.status)
      await supabaseAdmin
        .from('dt_kore_learning_items')
        .update({
          applies_to_channels: channels,
          status: nextDtStatus,
          synced_phone_item_id: phoneId,
          synced_kb_id: kbEntryId ?? dtTwin.synced_kb_id ?? null,
          updated_at: nowIso
        })
        .eq('id', syncedDtId)

      if (phoneItemRow.synced_dt_item_id !== syncedDtId || phoneItemRow.applies_to_channels !== channels) {
        await supabaseAdmin
          .from('phone_learning_items')
          .update({ synced_dt_item_id: syncedDtId, applies_to_channels: channels, updated_at: nowIso })
          .eq('id', phoneId)
      }
      await notifyDriveThruCachesInvalidation(storeId)
    } else if (phoneItemRow.applies_to_channels !== channels) {
      await supabaseAdmin
        .from('phone_learning_items')
        .update({ applies_to_channels: channels, updated_at: nowIso })
        .eq('id', phoneId)
    }
    return {
      ...phoneItemRow,
      applies_to_channels: channels,
      synced_dt_item_id: syncedDtId
    }
  }

  // 3) Alcance 'both' o 'drive_thru_only' activo / pendiente -> UPDATE o INSERT en dt_kore_learning_items
  const mappedDtKind = mapPhoneKindToDriveThruKind(itemKind)
  const mappedDtSource = mapPhoneSourceToDriveThruSource(String(phoneItemRow.source_type || ''))
  const resolvedByBigint =
    phoneItemRow.resolved_by !== null &&
    phoneItemRow.resolved_by !== undefined &&
    /^\d+$/.test(String(phoneItemRow.resolved_by).trim())
      ? Number(String(phoneItemRow.resolved_by).trim())
      : null

  const cleanTrigger = sanitizePhoneLearningText(phoneItemRow.question_or_trigger, 220, 'es')
  const ruleEs =
    sanitizePhoneLearningText(
      phoneItemRow.proposed_rule_es || phoneItemRow.owner_instruction || phoneItemRow.fast_reply_es || '',
      420,
      'es'
    ) || null
  const ruleEn =
    sanitizePhoneLearningText(
      phoneItemRow.proposed_rule_en || phoneItemRow.fast_reply_en || ruleEs || '',
      420,
      'en'
    ) || null
  const effectiveKbId = kbEntryId || (dtTwin?.synced_kb_id ? String(dtTwin.synced_kb_id) : null)

  let syncedDtId: string | null = null

  if (dtTwin?.id) {
    syncedDtId = String(dtTwin.id)
    await supabaseAdmin
      .from('dt_kore_learning_items')
      .update({
        store_id: storeId,
        source_phone_call_id: phoneItemRow.source_call_id || dtTwin.source_phone_call_id || null,
        synced_phone_item_id: phoneId,
        synced_kb_id: effectiveKbId,
        applies_to_channels: channels,
        item_kind: mappedDtKind,
        status,
        question_or_trigger: cleanTrigger || dtTwin.question_or_trigger,
        customer_quote: phoneItemRow.customer_quote ?? dtTwin.customer_quote ?? null,
        kore_quote: phoneItemRow.kore_quote ?? dtTwin.kore_quote ?? null,
        proposed_rule_es: ruleEs ?? dtTwin.proposed_rule_es ?? null,
        proposed_rule_en: ruleEn ?? dtTwin.proposed_rule_en ?? null,
        owner_instruction: phoneItemRow.owner_instruction ?? dtTwin.owner_instruction ?? null,
        evidence_count: Math.max(Number(phoneItemRow.evidence_count) || 1, Number(dtTwin.evidence_count) || 1),
        resolved_by: resolvedByBigint ?? dtTwin.resolved_by ?? null,
        resolved_by_name: phoneItemRow.resolved_by_name ?? dtTwin.resolved_by_name ?? null,
        resolved_at: phoneItemRow.resolved_at ?? dtTwin.resolved_at ?? null,
        updated_at: nowIso
      })
      .eq('id', syncedDtId)
  } else {
    const dtDedupeKey = dedupeKey || `phone_sync:${phoneId}`
    const insertPayload = {
      store_id: storeId,
      source_session_id: null,
      source_phone_call_id: phoneItemRow.source_call_id || null,
      synced_phone_item_id: phoneId,
      synced_kb_id: effectiveKbId,
      applies_to_channels: channels,
      dedupe_key: dtDedupeKey,
      source_type: mappedDtSource,
      item_kind: mappedDtKind,
      status,
      question_or_trigger: cleanTrigger,
      customer_quote: phoneItemRow.customer_quote ?? null,
      kore_quote: phoneItemRow.kore_quote ?? null,
      proposed_rule_es: ruleEs,
      proposed_rule_en: ruleEn,
      owner_instruction: phoneItemRow.owner_instruction ?? null,
      evidence_count: Math.max(1, Number(phoneItemRow.evidence_count) || 1),
      avg_latency_ms:
        phoneItemRow.avg_latency_ms !== null && phoneItemRow.avg_latency_ms !== undefined
          ? Number(phoneItemRow.avg_latency_ms)
          : null,
      resolved_by: resolvedByBigint,
      resolved_by_name: phoneItemRow.resolved_by_name ?? null,
      resolved_at: phoneItemRow.resolved_at ?? null,
      updated_at: nowIso
    }

    const { data: createdDt, error: insDtErr } = await supabaseAdmin
      .from('dt_kore_learning_items')
      .insert(insertPayload)
      .select('id')
      .maybeSingle()

    if (!insDtErr && createdDt?.id) {
      syncedDtId = String(createdDt.id)
    } else if (insDtErr?.code === '23505') {
      const { data: raceDt } = await supabaseAdmin
        .from('dt_kore_learning_items')
        .update({
          ...insertPayload,
          dedupe_key: dtDedupeKey
        })
        .eq('dedupe_key', dtDedupeKey)
        .select('id')
        .maybeSingle()
      if (raceDt?.id) syncedDtId = String(raceDt.id)
    }
  }

  if (
    syncedDtId &&
    (phoneItemRow.synced_dt_item_id !== syncedDtId ||
      phoneItemRow.applies_to_channels !== channels ||
      (!phoneItemRow.kb_entry_id && effectiveKbId))
  ) {
    const phoneLinkPatch: Record<string, any> = {
      synced_dt_item_id: syncedDtId,
      applies_to_channels: channels,
      updated_at: nowIso
    }
    if (!phoneItemRow.kb_entry_id && effectiveKbId) {
      phoneLinkPatch.kb_entry_id = effectiveKbId
    }
    await supabaseAdmin.from('phone_learning_items').update(phoneLinkPatch).eq('id', phoneId)
  }

  await notifyDriveThruCachesInvalidation(storeId)
  return {
    ...phoneItemRow,
    applies_to_channels: channels,
    synced_dt_item_id: syncedDtId ?? phoneItemRow.synced_dt_item_id ?? null,
    kb_entry_id: phoneItemRow.kb_entry_id || effectiveKbId
  }
}

/** Obtiene los IDs de `phone_learning_items` vinculados a un `phone_knowledge_base.id` (llamar ANTES de `DELETE`). */
export async function findPhoneLearningItemIdsByKbId(kbId: string): Promise<string[]> {
  if (!kbId) return []
  const { data } = await supabaseAdmin
    .from('phone_learning_items')
    .select('id')
    .eq('kb_entry_id', kbId)
  return (data || []).map((r: any) => String(r.id))
}

/**
 * Refleja en `public.phone_learning_items` cualquier edición, desactivación o borrado directo sobre
 * `public.phone_knowledge_base` ejecutado desde `/admin/llamadas` (`/api/phone/dashboard?entity=knowledge_base`).
 */
export async function syncPhoneKbMutationToPhoneLearning(params: {
  kbId: string
  action: 'updated' | 'deleted'
  row?: any
  preFetchedPhoneLearningIds?: string[]
}): Promise<void> {
  const nowIso = new Date().toISOString()

  if (params.action === 'deleted') {
    const targetIds =
      params.preFetchedPhoneLearningIds && params.preFetchedPhoneLearningIds.length > 0
        ? params.preFetchedPhoneLearningIds
        : await findPhoneLearningItemIdsByKbId(params.kbId)
    if (targetIds.length > 0) {
      await supabaseAdmin
        .from('phone_learning_items')
        .update({
          kb_entry_id: null,
          status: 'dismissed',
          updated_at: nowIso
        })
        .in('id', targetIds)
    }
    await notifyPhoneContextInvalidation()
    return
  }

  if (params.action === 'updated' && params.row) {
    const row = params.row
    const { data: linked } = await supabaseAdmin
      .from('phone_learning_items')
      .select('id, status, applies_to_channels')
      .eq('kb_entry_id', params.kbId)

    if (linked && linked.length > 0) {
      const isActive = row.is_active !== false
      const cleanTitle = sanitizePhoneLearningText(row.title, 220, 'es')
      const cleanEs = sanitizePhoneLearningText(row.answer_es, 400, 'es')
      const cleanEn = sanitizePhoneLearningText(row.answer_en || row.answer_es, 400, 'en')
      const fastEs = row.answer_es && String(row.answer_es).trim().length <= 220 ? sanitizePhoneLearningText(row.answer_es, 220, 'es') : null
      const fastEn =
        row.answer_en && String(row.answer_en).trim().length <= 220 ? sanitizePhoneLearningText(row.answer_en, 220, 'en') : null
      const storeId = row.store_id === null || row.store_id === undefined ? null : Number(row.store_id)
      const kw = row.question_keywords ? normalizeTriggerKeywords(row.question_keywords) : null

      for (const item of linked as any[]) {
        const nextStatus: PhoneLearningItemStatus = !isActive
          ? 'dismissed'
          : item.status === 'auto_applied'
            ? 'auto_applied'
            : 'approved'
        const curCh: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(item.applies_to_channels)
          ? item.applies_to_channels
          : 'both'
        const nextCh: PhoneAppliesToChannels = isActive && curCh === 'drive_thru_only' ? 'both' : curCh

        const patch: Record<string, any> = {
          store_id: storeId,
          category: String(row.category || 'general').slice(0, 60),
          status: nextStatus,
          applies_to_channels: nextCh,
          updated_at: nowIso
        }
        if (cleanTitle) patch.question_or_trigger = cleanTitle
        if (cleanEs) patch.proposed_rule_es = cleanEs
        if (cleanEn) patch.proposed_rule_en = cleanEn
        if (fastEs !== null) patch.fast_reply_es = fastEs
        if (fastEn !== null) patch.fast_reply_en = fastEn
        if (kw && kw.length > 0) patch.trigger_keywords = kw

        await supabaseAdmin.from('phone_learning_items').update(patch).eq('id', item.id)
      }
    }
    await notifyPhoneContextInvalidation()
  }
}

/**
 * Cuando un administrador crea una regla en Base de Conocimiento desde una pregunta sin respuesta (`resolveCallId`),
 * vincula y aprueba también cualquier duda pendiente gemela en `phone_learning_items`.
 */
export async function syncPhoneKbCreatedFromCallToPhoneLearning(params: {
  kbRow: any
  resolveCallId: string
}): Promise<void> {
  const { kbRow, resolveCallId } = params
  if (!kbRow?.id || !resolveCallId) return
  const nowIso = new Date().toISOString()

  const { data: matching } = await supabaseAdmin
    .from('phone_learning_items')
    .select(SELECT_PHONE_LEARNING_COLS)
    .eq('status', 'needs_owner_input')
    .eq('source_call_id', resolveCallId)

  if (matching && matching.length > 0) {
    const cleanEs = sanitizePhoneLearningText(kbRow.answer_es, 400, 'es')
    const cleanEn = sanitizePhoneLearningText(kbRow.answer_en || kbRow.answer_es, 400, 'en')
    const fastEs = kbRow.answer_es && String(kbRow.answer_es).trim().length <= 220 ? sanitizePhoneLearningText(kbRow.answer_es, 220, 'es') : null
    const fastEn = kbRow.answer_en && String(kbRow.answer_en).trim().length <= 220 ? sanitizePhoneLearningText(kbRow.answer_en, 220, 'en') : null
    const kw = kbRow.question_keywords ? normalizeTriggerKeywords(kbRow.question_keywords) : []

    for (const m of matching as any[]) {
      const ch = inferAppliesToChannels({
        questionOrTrigger: kbRow.title || m.question_or_trigger,
        proposedRuleEs: cleanEs,
        proposedRuleEn: cleanEn,
        dedupeKey: m.dedupe_key,
        category: kbRow.category || m.category,
        itemKind: m.item_kind
      })
      const { data: upd } = await supabaseAdmin
        .from('phone_learning_items')
        .update({
          status: 'approved',
          item_kind: fastEs && kw.length > 0 ? 'fast_reply_macro' : 'learned_rule',
          applies_to_channels: ch,
          kb_entry_id: String(kbRow.id),
          store_id: kbRow.store_id === null || kbRow.store_id === undefined ? null : Number(kbRow.store_id),
          proposed_rule_es: cleanEs || m.proposed_rule_es,
          proposed_rule_en: cleanEn || m.proposed_rule_en,
          fast_reply_es: fastEs,
          fast_reply_en: fastEn,
          trigger_keywords: kw.length > 0 ? kw : m.trigger_keywords || [],
          resolved_at: nowIso,
          updated_at: nowIso
        })
        .eq('id', m.id)
        .select(SELECT_PHONE_LEARNING_COLS)
        .maybeSingle()
      if (upd) {
        await syncPhoneLearningItemToDriveThru(upd)
      }
    }
  }
  await notifyPhoneContextInvalidation()
}

/**
 * Procesa la decisión del dueño/admin sobre una duda o hallazgo (`approve` | `answer_doubt` | `dismiss`):
 * - Redacta/traduce reglas ES/EN + respuestas instantáneas `< 2 ms` (`<= 220` chars).
 * - Sincroniza `public.phone_knowledge_base`.
 * - Pre-calienta el audio WAV ES/EN en `phone_v6/Kore/`.
 * - Invalida al instante la caché SWR para que la siguiente llamada aplique el nuevo criterio.
 */
export async function resolveOwnerPhoneLearningDecision(params: {
  id: string
  action: 'approve' | 'answer_doubt' | 'dismiss' | 'set_channel'
  ownerInstruction?: string | null
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
  fastReplyEs?: string | null
  fastReplyEn?: string | null
  triggerKeywords?: string[] | string | null
  appliesToChannels?: PhoneAppliesToChannels | null
  storeId?: number | null
  applyAllStores?: boolean
  category?: string | null
  resolvedBy?: string | number | null
  resolvedByName?: string | null
}): Promise<PhoneLearningItemDto> {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('phone_learning_items')
    .select(SELECT_PHONE_LEARNING_COLS)
    .eq('id', params.id)
    .maybeSingle()

  if (fetchErr) throw new Error(`Error consultando item de aprendizaje: ${fetchErr.message}`)
  if (!existing) throw new Error('NOT_FOUND: Item de aprendizaje no encontrado.')

  const nowIso = new Date().toISOString()
  const resolvedByStr =
    params.resolvedBy !== null && params.resolvedBy !== undefined && String(params.resolvedBy).trim()
      ? String(params.resolvedBy).trim()
      : null
  const resolvedByName = String(params.resolvedByName || 'Admin').slice(0, 120)

  if (params.action === 'set_channel') {
    const nextChannels: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(params.appliesToChannels)
      ? params.appliesToChannels
      : isValidPhoneAppliesToChannels(existing.applies_to_channels)
        ? existing.applies_to_channels
        : 'both'

    if (existing.kb_entry_id) {
      const shouldKeepKbActive =
        (existing.status === 'approved' || existing.status === 'auto_applied') &&
        (nextChannels === 'both' || nextChannels === 'phone_only')
      await supabaseAdmin
        .from('phone_knowledge_base')
        .update({ is_active: shouldKeepKbActive, updated_at: nowIso })
        .eq('id', existing.kb_entry_id)
    }

    const { data: chUpdated, error: chErr } = await supabaseAdmin
      .from('phone_learning_items')
      .update({
        applies_to_channels: nextChannels,
        updated_at: nowIso
      })
      .eq('id', params.id)
      .select(SELECT_PHONE_LEARNING_COLS)
      .single()

    if (chErr || !chUpdated) {
      throw new Error(`No se pudo actualizar el canal del item: ${chErr?.message || 'error desconocido'}`)
    }
    const syncedChRow = await syncPhoneLearningItemToDriveThru(chUpdated)
    await notifyPhoneContextInvalidation(existing.store_id ?? null)
    return mapPhoneLearningRowToDto(syncedChRow)
  }

  if (params.action === 'dismiss') {
    if (existing.kb_entry_id) {
      await supabaseAdmin
        .from('phone_knowledge_base')
        .update({ is_active: false, updated_at: nowIso })
        .eq('id', existing.kb_entry_id)
    }
    const { data: dismissed, error: disErr } = await supabaseAdmin
      .from('phone_learning_items')
      .update({
        status: 'dismissed',
        applies_to_channels: isValidPhoneAppliesToChannels(params.appliesToChannels)
          ? params.appliesToChannels
          : isValidPhoneAppliesToChannels(existing.applies_to_channels)
            ? existing.applies_to_channels
            : 'both',
        owner_instruction:
          params.ownerInstruction !== undefined
            ? String(params.ownerInstruction || '').trim().slice(0, 500) || null
            : existing.owner_instruction,
        resolved_by: resolvedByStr,
        resolved_by_name: resolvedByName,
        resolved_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', params.id)
      .select(SELECT_PHONE_LEARNING_COLS)
      .single()

    if (disErr || !dismissed) {
      throw new Error(`No se pudo descartar el item: ${disErr?.message || 'error desconocido'}`)
    }
    const syncedDismissed = await syncPhoneLearningItemToDriveThru(dismissed)
    await notifyPhoneContextInvalidation(existing.store_id ?? null)
    return mapPhoneLearningRowToDto(syncedDismissed)
  }

  const rawInstruction = String(
    params.ownerInstruction ??
      existing.owner_instruction ??
      params.proposedRuleEs ??
      existing.proposed_rule_es ??
      existing.question_or_trigger ??
      ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)

  if (rawInstruction.length < 3) {
    throw new Error('VALIDATION: Escribe una instrucción válida (mínimo 3 caracteres) para enseñar a Kore.')
  }

  const targetStoreId =
    params.applyAllStores === true
      ? null
      : params.storeId !== undefined
        ? params.storeId
        : existing.store_id === null || existing.store_id === undefined
          ? null
          : Number(existing.store_id)

  const category = String(params.category || existing.category || 'general').trim().slice(0, 60) || 'general'
  const built = await buildBilingualPhoneRuleAndFastReply({
    questionOrTrigger: String(existing.question_or_trigger || ''),
    ownerInstruction: rawInstruction,
    itemKind: existing.item_kind as PhoneLearningItemKind,
    proposedRuleEs: params.proposedRuleEs ?? existing.proposed_rule_es,
    proposedRuleEn: params.proposedRuleEn ?? existing.proposed_rule_en,
    fastReplyEs: params.fastReplyEs ?? existing.fast_reply_es,
    fastReplyEn: params.fastReplyEn ?? existing.fast_reply_en,
    triggerKeywords: params.triggerKeywords ?? existing.trigger_keywords
  })

  const effectiveChannels: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(params.appliesToChannels)
    ? params.appliesToChannels
    : isValidPhoneAppliesToChannels(existing.applies_to_channels)
      ? existing.applies_to_channels
      : inferAppliesToChannels({
          questionOrTrigger: existing.question_or_trigger,
          ownerInstruction: rawInstruction,
          proposedRuleEs: built.ruleEs,
          proposedRuleEn: built.ruleEn,
          customerQuote: existing.customer_quote,
          dedupeKey: existing.dedupe_key,
          category,
          itemKind: existing.item_kind
        })

  const isSmokeTest =
    /\bTEST_SMOKE_/i.test(String(existing.dedupe_key || '')) ||
    /\bTEST_SMOKE_/i.test(String(existing.question_or_trigger || '')) ||
    /\bTEST_SMOKE_/i.test(rawInstruction)

  const shouldSyncPhoneKb = effectiveChannels === 'both' || effectiveChannels === 'phone_only'
  const [kbEntryId, prewarmed] = await Promise.all([
    shouldSyncPhoneKb
      ? syncLearnedRuleToKnowledgeBase({
          existingKbEntryId: existing.kb_entry_id ? String(existing.kb_entry_id) : null,
          storeId: targetStoreId,
          category,
          title: String(existing.question_or_trigger || rawInstruction).slice(0, 180),
          triggerKeywords: built.triggerKeywords,
          answerEs: built.fastReplyEs || built.ruleEs,
          answerEn: built.fastReplyEn || built.ruleEn
        })
      : (async () => {
          if (existing.kb_entry_id) {
            await supabaseAdmin
              .from('phone_knowledge_base')
              .update({ is_active: false, updated_at: nowIso })
              .eq('id', String(existing.kb_entry_id))
            return String(existing.kb_entry_id)
          }
          return null
        })(),
    shouldSyncPhoneKb
      ? prewarmApprovedFastReplies(built.fastReplyEs, built.fastReplyEn, isSmokeTest)
      : Promise.resolve(false)
  ])

  if (existing.source_call_id && !isSmokeTest) {
    await supabaseAdmin
      .from('phone_calls')
      .update({ unanswered_question: null })
      .eq('id', String(existing.source_call_id))
  }

  const nextKind: PhoneLearningItemKind =
    existing.item_kind === 'doubt_for_owner' || existing.item_kind === 'latency_insight'
      ? built.fastReplyEs && built.triggerKeywords.length > 0
        ? 'fast_reply_macro'
        : 'learned_rule'
      : (existing.item_kind as PhoneLearningItemKind)

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('phone_learning_items')
    .update({
      store_id: targetStoreId,
      item_kind: nextKind,
      status: 'approved',
      applies_to_channels: effectiveChannels,
      category,
      trigger_keywords: built.triggerKeywords,
      owner_instruction: rawInstruction,
      proposed_rule_es: built.ruleEs,
      proposed_rule_en: built.ruleEn,
      fast_reply_es: built.fastReplyEs,
      fast_reply_en: built.fastReplyEn,
      audio_prewarmed: Boolean(existing.audio_prewarmed || prewarmed),
      kb_entry_id: kbEntryId,
      resolved_by: resolvedByStr,
      resolved_by_name: resolvedByName,
      resolved_at: nowIso,
      updated_at: nowIso
    })
    .eq('id', params.id)
    .select(SELECT_PHONE_LEARNING_COLS)
    .single()

  if (updErr || !updated) {
    throw new Error(`No se pudo guardar la decisión de aprendizaje: ${updErr?.message || 'error desconocido'}`)
  }

  const syncedRow = await syncPhoneLearningItemToDriveThru(updated)
  await notifyPhoneContextInvalidation(targetStoreId)
  return mapPhoneLearningRowToDto(syncedRow)
}

/**
 * Crea una nueva regla manual directa del dueño/admin, sincronizando `phone_knowledge_base` y pre-calentando audio WAV.
 */
export async function createManualPhoneLearnedRule(params: {
  storeId: number | null
  category?: string | null
  appliesToChannels?: PhoneAppliesToChannels | null
  questionOrTrigger: string
  ownerInstruction: string
  proposedRuleEs?: string | null
  proposedRuleEn?: string | null
  fastReplyEs?: string | null
  fastReplyEn?: string | null
  triggerKeywords?: string[] | string | null
  resolvedBy?: string | number | null
  resolvedByName?: string | null
}): Promise<PhoneLearningItemDto> {
  const cleanTrigger = params.questionOrTrigger.replace(/\s+/g, ' ').trim().slice(0, 220)
  const cleanInstruction = params.ownerInstruction.replace(/\s+/g, ' ').trim().slice(0, 500)
  const category = String(params.category || 'general').trim().slice(0, 60) || 'general'

  const built = await buildBilingualPhoneRuleAndFastReply({
    questionOrTrigger: cleanTrigger,
    ownerInstruction: cleanInstruction,
    proposedRuleEs: params.proposedRuleEs,
    proposedRuleEn: params.proposedRuleEn,
    fastReplyEs: params.fastReplyEs,
    fastReplyEn: params.fastReplyEn,
    triggerKeywords: params.triggerKeywords
  })

  const effectiveChannels: PhoneAppliesToChannels = isValidPhoneAppliesToChannels(params.appliesToChannels)
    ? params.appliesToChannels
    : inferAppliesToChannels({
        questionOrTrigger: cleanTrigger,
        ownerInstruction: cleanInstruction,
        proposedRuleEs: built.ruleEs,
        proposedRuleEn: built.ruleEn,
        category
      })

  const isSmokeTest = /\bTEST_SMOKE_/i.test(cleanTrigger) || /\bTEST_SMOKE_/i.test(cleanInstruction)
  const dedupeKey = isSmokeTest
    ? `TEST_SMOKE_MANUAL_${shortHash(`${cleanTrigger}:${Date.now()}`)}`
    : `manual:${params.storeId ?? 'all'}:${shortHash(normalizeMatchToken(cleanTrigger))}`

  const shouldSyncPhoneKb = effectiveChannels === 'both' || effectiveChannels === 'phone_only'
  const [kbEntryId, prewarmed] = await Promise.all([
    shouldSyncPhoneKb
      ? syncLearnedRuleToKnowledgeBase({
          existingKbEntryId: null,
          storeId: params.storeId,
          category,
          title: cleanTrigger.slice(0, 180),
          triggerKeywords: built.triggerKeywords,
          answerEs: built.fastReplyEs || built.ruleEs,
          answerEn: built.fastReplyEn || built.ruleEn
        })
      : Promise.resolve(null),
    shouldSyncPhoneKb
      ? prewarmApprovedFastReplies(built.fastReplyEs, built.fastReplyEn, isSmokeTest)
      : Promise.resolve(false)
  ])

  const nowIso = new Date().toISOString()
  const itemKind: PhoneLearningItemKind =
    built.fastReplyEs && built.triggerKeywords.length > 0 ? 'fast_reply_macro' : 'learned_rule'

  const { data: upserted, error } = await supabaseAdmin
    .from('phone_learning_items')
    .upsert(
      {
        store_id: params.storeId,
        source_call_id: null,
        dedupe_key: dedupeKey,
        source_type: 'manual_owner',
        item_kind: itemKind,
        status: 'approved',
        applies_to_channels: effectiveChannels,
        category,
        question_or_trigger: cleanTrigger,
        trigger_keywords: built.triggerKeywords,
        owner_instruction: cleanInstruction,
        proposed_rule_es: built.ruleEs,
        proposed_rule_en: built.ruleEn,
        fast_reply_es: built.fastReplyEs,
        fast_reply_en: built.fastReplyEn,
        evidence_count: 1,
        audio_prewarmed: prewarmed,
        kb_entry_id: kbEntryId,
        resolved_by: params.resolvedBy !== null && params.resolvedBy !== undefined ? String(params.resolvedBy) : null,
        resolved_by_name: String(params.resolvedByName || 'Admin').slice(0, 120),
        resolved_at: nowIso,
        updated_at: nowIso
      },
      { onConflict: 'dedupe_key' }
    )
    .select(SELECT_PHONE_LEARNING_COLS)
    .single()

  if (error || !upserted) {
    throw new Error(`No se pudo crear la regla de aprendizaje: ${error?.message || 'error desconocido'}`)
  }

  const syncedRow = await syncPhoneLearningItemToDriveThru(upserted)
  await notifyPhoneContextInvalidation(params.storeId)
  return mapPhoneLearningRowToDto(syncedRow)
}

/**
 * Obtiene la bandeja completa y métricas reales de Aprendizaje Continuo para `/admin/llamadas`.
 */
export async function getPhoneLearningDashboard(storeId?: number | null): Promise<{
  items: PhoneLearningItemDto[]
  stats: PhoneLearningStats
}> {
  const scopedStore = storeId && Number.isInteger(storeId) && storeId > 0 ? Math.trunc(storeId) : null

  let itemsQuery = supabaseAdmin
    .from('phone_learning_items')
    .select(SELECT_PHONE_LEARNING_COLS)
    .order('evidence_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(120)

  if (scopedStore) {
    itemsQuery = itemsQuery.or(`store_id.is.null,store_id.eq.${scopedStore}`)
  }

  const buildCallsCount = (onlyAnalyzed: boolean) => {
    let q = supabaseAdmin.from('phone_calls').select('id', { count: 'exact', head: true })
    if (scopedStore) q = q.eq('store_id', scopedStore)
    if (onlyAnalyzed) q = q.not('analyzed_at', 'is', null)
    return q
  }

  let recentTranscriptsQuery = supabaseAdmin
    .from('phone_calls')
    .select('transcript')
    .gt('turns_count', 0)
    .order('started_at', { ascending: false })
    .limit(60)
  if (scopedStore) recentTranscriptsQuery = recentTranscriptsQuery.eq('store_id', scopedStore)

  const [itemsRes, totalCallsRes, analyzedCallsRes, recentTranscriptsRes] = await Promise.all([
    itemsQuery,
    buildCallsCount(false),
    buildCallsCount(true),
    recentTranscriptsQuery
  ])

  if (itemsRes.error) {
    throw new Error(`Error consultando bandeja de aprendizaje telefónico: ${itemsRes.error.message}`)
  }

  const items = (itemsRes.data || []).map(mapPhoneLearningRowToDto)

  // Ordenar: primero `needs_owner_input`, luego `approved`, luego `auto_applied`, al final `dismissed`
  const statusOrder: Record<PhoneLearningItemStatus, number> = {
    needs_owner_input: 0,
    approved: 1,
    auto_applied: 2,
    dismissed: 3
  }
  items.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 9
    const sb = statusOrder[b.status] ?? 9
    if (sa !== sb) return sa - sb
    if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  const pendingDoubts = items.filter(
    (i) => i.status === 'needs_owner_input' && i.appliesToChannels !== 'drive_thru_only'
  ).length
  const activeRules = items.filter(
    (i) =>
      (i.status === 'approved' || i.status === 'auto_applied') &&
      i.appliesToChannels !== 'drive_thru_only' &&
      i.itemKind !== 'latency_insight' &&
      i.itemKind !== 'audio_prewarm'
  ).length
  const prewarmedClips = items.filter((i) => i.audioPrewarmed && i.status !== 'dismissed').length
  const syncedWithDriveThruCount = items.filter(
    (i) =>
      (i.status === 'approved' || i.status === 'auto_applied' || i.status === 'needs_owner_input') &&
      i.appliesToChannels === 'both' &&
      Boolean(i.syncedDtItemId)
  ).length

  const totalCalls = Math.max(0, Number(totalCallsRes.count || 0))
  const analyzedCalls = Math.max(0, Number(analyzedCallsRes.count || 0))
  const unanalyzedCalls = Math.max(0, totalCalls - analyzedCalls)

  const turnLatencies: number[] = []
  for (const row of recentTranscriptsRes.data || []) {
    for (const pair of extractTurnPairs((row as any).transcript)) {
      if (pair.latencyMs !== null && pair.latencyMs > 0) {
        turnLatencies.push(pair.latencyMs)
      }
    }
  }
  const avgTurnLatencyMs =
    turnLatencies.length > 0
      ? Math.round(turnLatencies.reduce((acc, v) => acc + v, 0) / turnLatencies.length)
      : null

  return {
    items,
    stats: {
      pendingDoubts,
      activeRules,
      prewarmedClips,
      syncedWithDriveThruCount,
      analyzedCalls,
      totalCalls,
      unanalyzedCalls,
      avgTurnLatencyMs
    }
  }
}
