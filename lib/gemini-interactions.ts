/**
 * @module lib/gemini-interactions
 * @description Motor compartido de última generación para Gemini Interactions API (`@google/genai` >= 3.x),
 * centralizando transcripción inteligente de voz (`gemini-3.5-transcribe`), lectura estructurada de recibos/facturas
 * en imagen o PDF (`gemini-3.8-flash` + JSON Schema) y diagnóstico visual de equipos de mantenimiento.
 *
 * @businessRules
 * - Se conecta exclusivamente al fondo oficial de llaves (`getGeminiKeyPoolWithRemote()` de `lib/order-ready-tts.ts`),
 *   respetando el modo Single-Key Tier 1 (`pool.length === 1`, sin bloqueos largos de 6h ante errores transitorios).
 * - Usa únicamente modelos vigentes de la familia 3.8 / 3.5 (`gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`,
 *   `gemini-3.5-transcribe`), nunca modelos deprecados (`1.5`, `2.0`, `2.5`).
 * - Privacidad por defecto: todas las llamadas a `interactions.create` envían `store: false` para no retener recibos,
 *   facturas ni audios operativos en servidores externos.
 * - Todos los montos extraídos se normalizan estrictamente a dólares y centavos estadounidenses (`USD`), previniendo
 *   valores `NaN`, `Infinity` o negativos.
 * - En transcripción (`gemini-3.5-transcribe`), aplica vocabulario personalizado de Tacos Gavilan (15 sucursales, carnes,
 *   platillos y módulos) y modo `smart` para limpiar muletillas y autocorrecciones habladas en español, inglés o Spanglish.
 *
 * @dataFlow
 * - Audio / Imagen / PDF (Base64 o archivo de Supabase Storage validado) -> `lib/gemini-interactions.ts`
 *   -> `GoogleGenAI.interactions.create` con failover automático -> Salida validada y tipada para UI/API.
 *
 * @notes
 * - Creado en actualización `@[plugin:gemini-api]` (2026-11-20) migrando del paquete obsoleto `@google/generative-ai`
 *   al SDK oficial `@google/genai` sobre `/v1beta/interactions`, con `timeout_ms: 20000` y `retries: { strategy: 'none' }`
 *   para evitar reintentos ocultos Speakeasy (5x) o sockets infinitos (`timeout_ms: -1`).
 * - `fetchTrustedMaintenanceAssetAsBase64` normaliza rutas con `path.posix.normalize`, exige `.startsWith('/storage/v1/object/public/checklist-photos/maintenance/')`,
 *   aplica `AbortSignal.timeout(12000)`, infiere `.heic`/`.heif` y topa descargas en `4 MB` bajo el límite de `4.5 MB` de Vercel.
 * - En Interactions API, los PDFs deben enviarse como `{ type: 'document', mime_type: 'application/pdf', data }`,
 *   las imágenes como `{ type: 'image', mime_type, data }` y el audio como `{ type: 'audio', mime_type, data }`.
 */

import path from 'node:path'
import { GoogleGenAI } from '@google/genai'
import { getGeminiKeyPoolWithRemote } from '@/lib/order-ready-tts'

export const GEMINI_MULTIMODAL_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
] as const

export const GEMINI_TRANSCRIBE_MODELS = [
  'gemini-3.5-transcribe',
  'gemini-3.8-flash',
] as const

/**
 * Vocabulario de dominio de Tacos Gavilan (<= 100 términos recomendados por Google para máxima precisión ASR).
 */
export const TEG_SPEECH_VOCABULARY: string[] = [
  'Tacos Gavilan',
  'Rialto',
  'West Covina',
  'Azusa',
  'LA Broadway',
  'LA Central',
  'Slauson',
  'Hollywood',
  'Santa Ana',
  'La Puente',
  'Huntington Park',
  'Norwalk',
  'Bell',
  'Lynwood',
  'South Gate',
  'Downey',
  'La Bodega',
  'Vernon',
  'Asada',
  'Pastor',
  'Cabeza',
  'Lengua',
  'Buche',
  'Chorizo',
  'Carnitas',
  'Pollo',
  'Mulita',
  'Super Mulita',
  'Super Burrito',
  'Super Quesadilla',
  'Torta Cubana',
  'Torta Milanesa',
  'Sope',
  'Nachos',
  'Party Trays',
  'Fiesta Platters',
  'Flan',
  'Cheesecake',
  'Horchata',
  'Jamaica',
  'Toast',
  'QuickBooks',
  'Food Cost',
  'PMIX',
  'Labor',
  'RONOS',
  'Viele & Sons',
  'MilesIQ',
  'Kore',
  'Preparador',
  'DoorDash',
  'Uber Eats',
  'Grubhub',
  'FasTrak',
]

const ALLOWED_MAINTENANCE_CATEGORIES = [
  'hood_cleaning',
  'refrigeration',
  'grease_trap',
  'pest_control',
  'cooking_equipment',
  'electrical',
  'power_washing',
  'security_locks',
  'it_pos',
  'general',
] as const

const ALLOWED_MAINTENANCE_SERVICE_TYPES = [
  'preventive',
  'corrective',
  'emergency',
  'inspection',
  'installation',
  'warranty',
] as const

const ALLOWED_MAINTENANCE_STATUSES = [
  'completed',
  'pending_parts',
  'follow_up_needed',
] as const

export type MaintenanceCategoryEnum = (typeof ALLOWED_MAINTENANCE_CATEGORIES)[number]
export type MaintenanceServiceTypeEnum = (typeof ALLOWED_MAINTENANCE_SERVICE_TYPES)[number]
export type MaintenanceStatusEnum = (typeof ALLOWED_MAINTENANCE_STATUSES)[number]

export interface TranscribeAudioOptions {
  base64Audio: string
  mimeType: string
  languageHint?: 'es' | 'en' | 'auto'
  sourceText?: string
}

export interface TranscribeAudioResult {
  text: string
  usedModel: string
}

export interface ScannedReceiptData {
  is_valid_document: boolean
  expense_category: 'parking' | 'toll' | 'maintenance_invoice' | 'supplies' | 'fuel' | 'other'
  vendor_name: string
  invoice_number: string
  date_yyyy_mm_dd: string
  time_12h: string
  subtotal_usd: number
  tax_usd: number
  total_usd: number
  parts_or_items_summary: string
  summary_es: string
  summary_en: string
  quality_warning_es: string
  quality_warning_en: string
  used_model: string
}

export interface EquipmentVisualDiagnosis {
  is_equipment_or_issue_visible: boolean
  suggested_category: MaintenanceCategoryEnum
  suggested_service_type: MaintenanceServiceTypeEnum
  suggested_status: MaintenanceStatusEnum
  urgency_level: 'critical' | 'high' | 'medium' | 'low'
  equipment_es: string
  equipment_en: string
  brand: string
  model_number: string
  serial_number: string
  error_code: string
  technical_summary_es: string
  technical_summary_en: string
  suggested_parts_es: string
  suggested_parts_en: string
  used_model: string
}

// Cortacircuitos en memoria respetando modo Single-Key
const interactionKeyQuarantineUntil = new Map<string, number>()
let interactionKeyRoundRobin = 0

// Rate limiter ligero por IP para rutas públicas de mantenimiento QR (máx 20 escaneos cada 10 minutos por IP)
const publicAiRateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkPublicAiRateLimit(ipKey: string, maxRequests = 20, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now()
  if (publicAiRateBuckets.size > 500) {
    for (const [k, v] of publicAiRateBuckets.entries()) {
      if (v.resetAt <= now) publicAiRateBuckets.delete(k)
    }
  }
  const cleanIp = (ipKey || 'unknown').trim().slice(0, 120)
  const existing = publicAiRateBuckets.get(cleanIp)
  if (!existing || existing.resetAt <= now) {
    publicAiRateBuckets.set(cleanIp, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (existing.count >= maxRequests) {
    return false
  }
  existing.count += 1
  return true
}

/**
 * Normaliza MIME types provenientes de navegadores móviles/escritorio (ej. `audio/webm;codecs=opus` -> `audio/webm`).
 */
export function normalizeMediaMimeType(rawMime: string, fallback = 'application/octet-stream'): string {
  const base = String(rawMime || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!base) return fallback
  if (base === 'image/jpg') return 'image/jpeg'
  if (base === 'audio/x-m4a') return 'audio/m4a'
  if (base === 'audio/x-wav') return 'audio/wav'
  if (base === 'audio/mp4') return 'audio/m4a'
  return base
}

function clampMoneyUsd(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? Math.round(val * 100) / 100 : 0
  }
  const match = String(val ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  const n = match ? Number(match[0]) : NaN
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100) / 100
}

function normalizeIsoDateOrEmpty(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    if (y >= 2020 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const check = new Date(Date.UTC(y, m - 1, d))
      if (
        check.getUTCFullYear() === y &&
        check.getUTCMonth() === m - 1 &&
        check.getUTCDate() === d
      ) {
        return s
      }
    }
  }
  return ''
}

function parseGeminiStructuredJson(rawText: string): any {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!cleaned) {
    throw new Error('El modelo de IA devolvió una respuesta vacía.')
  }
  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error('Respuesta JSON incompleta o inválida del modelo de IA. Intenta con una imagen más clara.')
  }
}

async function getOrderedGeminiKeys(): Promise<string[]> {
  const rawPool = await getGeminiKeyPoolWithRemote()
  if (rawPool.length === 0) {
    throw new Error('No Gemini API keys configured in pool.')
  }
  const now = Date.now()
  const active = rawPool.filter((k) => (interactionKeyQuarantineUntil.get(k) || 0) <= now)
  const candidates = active.length > 0 ? active : rawPool
  const startIdx = interactionKeyRoundRobin++ % candidates.length
  const rotated = [...candidates.slice(startIdx), ...candidates.slice(0, startIdx)]
  const modern = rotated.filter((k) => k.startsWith('AQ.'))
  const classic = rotated.filter((k) => !k.startsWith('AQ.'))
  return [...modern, ...classic]
}

async function runInteractionWithFailover(
  models: readonly string[],
  buildParams: (model: string) => Record<string, any>
): Promise<{ interaction: any; usedModel: string; usedKey: string }> {
  const orderedKeys = await getOrderedGeminiKeys()
  let lastErrorMsg = 'Gemini Interactions service unavailable.'

  for (const key of orderedKeys) {
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { apiVersion: 'v1beta' },
    })

    for (const model of models) {
      try {
        const params = buildParams(model)
        const interaction: any = await ai.interactions.create(
          {
            store: false,
            ...params,
            model,
          } as any,
          {
            timeout_ms: 20000,
            retries: { strategy: 'none' },
          } as any
        )

        if (interaction && (typeof interaction.output_text === 'string' || Array.isArray(interaction.steps))) {
          return { interaction, usedModel: model, usedKey: key }
        }
        lastErrorMsg = `Empty interaction output from ${model}`
      } catch (err: any) {
        const msg = String(err?.message || err || 'Unknown Gemini error')
        const status = Number(err?.status || err?.httpStatusCode || 0)
        lastErrorMsg = msg
        console.warn(`[Gemini Interactions Failover] Key ...${key.slice(-4)} / ${model} failed (${status || 'ERR'}): ${msg.slice(0, 140)}`)

        const isAuthOrBilling =
          status === 401 ||
          status === 402 ||
          status === 403 ||
          /API key not valid|prepayment credits|depleted|PERMISSION_DENIED/i.test(msg)
        if (isAuthOrBilling) {
          if (orderedKeys.length > 1) {
            interactionKeyQuarantineUntil.set(key, Date.now() + 6 * 60 * 60 * 1000)
            break
          }
          continue
        }

        const isRateLimit = status === 429 || /RESOURCE_EXHAUSTED|Too Many Requests|quota/i.test(msg)
        if (isRateLimit) {
          if (orderedKeys.length > 1) {
            interactionKeyQuarantineUntil.set(key, Date.now() + 2 * 60 * 1000)
            break
          }
          continue
        }
      }
    }
  }

  throw new Error(lastErrorMsg)
}

function extractInteractionText(interaction: any): string {
  if (typeof interaction?.output_text === 'string' && interaction.output_text.trim().length > 0) {
    return interaction.output_text.trim()
  }
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
  const chunks: string[] = []
  for (const step of steps) {
    if (step?.type === 'model_output' && Array.isArray(step?.content)) {
      for (const part of step.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          chunks.push(part.text)
        }
      }
    }
  }
  return chunks.join('').trim()
}

/**
 * Transcribe voz grabada en navegador/móvil usando `gemini-3.5-transcribe` en modo `smart`
 * con vocabulario de Tacos Gavilan y soporte opcional de edición por voz (`sourceText`).
 */
export async function transcribeAudioWithGemini(
  options: TranscribeAudioOptions
): Promise<TranscribeAudioResult> {
  const cleanMime = normalizeMediaMimeType(options.mimeType, 'audio/webm')
  const base64Data = options.base64Audio.replace(/^data:[^;]+;base64,/, '').trim()
  if (!base64Data) {
    throw new Error('Empty audio payload.')
  }

  const trimmedSource = String(options.sourceText || '').trim().slice(0, 8000)
  const languageCodes =
    options.languageHint === 'es'
      ? ['es-US', 'en-US']
      : options.languageHint === 'en'
        ? ['en-US', 'es-US']
        : []

  const { interaction, usedModel } = await runInteractionWithFailover(
    GEMINI_TRANSCRIBE_MODELS,
    (model) => {
      if (model === 'gemini-3.5-transcribe') {
        const modeConfig = trimmedSource
          ? { type: 'smart', source_text: trimmedSource }
          : 'smart'

        return {
          input: [
            {
              type: 'audio',
              data: base64Data,
              mime_type: cleanMime,
            },
          ],
          generation_config: {
            transcription_config: {
              language_codes: languageCodes,
              custom_vocabulary: TEG_SPEECH_VOCABULARY,
              mode: modeConfig,
            },
          },
        }
      }

      // Fallback sobre gemini-3.8-flash si gemini-3.5-transcribe tuviera saturación temporal
      const fallbackPrompt = trimmedSource
        ? `Transcribe the spoken audio accurately (Spanish, English, or Spanglish for Tacos Gavilan) and merge/apply it naturally to this existing draft text: "${trimmedSource}". Output ONLY the final clean text without quotes or commentary.`
        : 'Transcribe the spoken audio accurately (Spanish, English, or Spanglish for Tacos Gavilan). Clean up filler words and output ONLY the transcribed text without quotes or commentary.'

      return {
        input: [
          { type: 'text', text: fallbackPrompt },
          {
            type: 'audio',
            data: base64Data,
            mime_type: cleanMime,
          },
        ],
      }
    }
  )

  const rawText = extractInteractionText(interaction)
  // Guard against silent-clip ASR vocabulary echo (space or comma/semicolon separated) when zero speech was spoken
  const vocabDumpSequenceRe = /Rialto[,;\s]+West Covina[,;\s]+Azusa[,;\s]+LA Broadway/i
  let text = rawText
  if (vocabDumpSequenceRe.test(rawText)) {
    const stripped = rawText
      .replace(/[,;\s]*(?:Tacos Gavilan[,;\s]+)?Rialto[,;\s]+West Covina[,;\s]+Azusa[,;\s]+LA Broadway[\s\S]*$/i, '')
      .trim()
    text = stripped || trimmedSource
  }
  return { text, usedModel }
}

const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    is_valid_document: {
      type: 'boolean',
      description: 'True if the image or PDF shows a receipt, invoice, ticket, work order, or toll statement.',
    },
    expense_category: {
      type: 'string',
      enum: ['parking', 'toll', 'maintenance_invoice', 'supplies', 'fuel', 'other'],
      description: 'Best matching operational expense category.',
    },
    vendor_name: {
      type: 'string',
      description: 'Merchant, company, parking operator, toll agency, or technician vendor name.',
    },
    invoice_number: {
      type: 'string',
      description: 'Invoice, receipt, ticket, or reference number if visible, otherwise empty string.',
    },
    date_yyyy_mm_dd: {
      type: 'string',
      description: 'Transaction or invoice date formatted strictly as YYYY-MM-DD, or empty string if unreadable.',
    },
    time_12h: {
      type: 'string',
      description: 'Transaction time in 12-hour format like 02:30 PM if visible, otherwise empty string.',
    },
    subtotal_usd: {
      type: 'number',
      description: 'Subtotal amount in USD before tax (0 if not itemized).',
    },
    tax_usd: {
      type: 'number',
      description: 'Sales tax amount in USD (0 if none or not shown).',
    },
    total_usd: {
      type: 'number',
      description: 'Final total amount paid or due in USD.',
    },
    parts_or_items_summary: {
      type: 'string',
      description: 'Concise comma-separated list of parts replaced, line items, or services billed (max 250 chars).',
    },
    summary_es: {
      type: 'string',
      description: 'Resumen claro en español (ej. Estacionamiento LAZ Parking • $14.50 USD).',
    },
    summary_en: {
      type: 'string',
      description: 'Clear summary in English (e.g. LAZ Parking receipt • $14.50 USD).',
    },
    quality_warning_es: {
      type: 'string',
      description: 'Advertencia breve en español si la foto está borrosa, incompleta o no es en USD; cadena vacía si es legible.',
    },
    quality_warning_en: {
      type: 'string',
      description: 'Short warning in English if blurry, incomplete, or non-USD; empty string if clear.',
    },
  },
  required: [
    'is_valid_document',
    'expense_category',
    'vendor_name',
    'invoice_number',
    'date_yyyy_mm_dd',
    'time_12h',
    'subtotal_usd',
    'tax_usd',
    'total_usd',
    'parts_or_items_summary',
    'summary_es',
    'summary_en',
    'quality_warning_es',
    'quality_warning_en',
  ],
}

/**
 * Extrae datos estructurados exactos de una foto o PDF de recibo/factura con `gemini-3.8-flash`.
 */
export async function scanReceiptOrInvoiceWithGemini(params: {
  base64Data: string
  mimeType: string
  contextHint?: 'mileage' | 'maintenance' | 'general'
}): Promise<ScannedReceiptData> {
  const cleanMime = normalizeMediaMimeType(params.mimeType, 'image/jpeg')
  const rawB64 = params.base64Data.replace(/^data:[^;]+;base64,/, '').trim()
  if (!rawB64) {
    throw new Error('Empty document/image payload.')
  }

  const isPdf = cleanMime === 'application/pdf'
  const mediaBlock = isPdf
    ? { type: 'document', data: rawB64, mime_type: 'application/pdf' }
    : { type: 'image', data: rawB64, mime_type: cleanMime }

  const contextLine =
    params.contextHint === 'mileage'
      ? 'Context: Supervisor mileage reimbursement at Tacos Gavilan (California, USD). Pay special attention to distinguishing parking receipts ("parking") vs toll road/FasTrak/ExpressLanes ("toll") vs store supplies ("supplies").'
      : params.contextHint === 'maintenance'
        ? 'Context: Restaurant equipment maintenance service invoice/work order at Tacos Gavilan (California, USD). Extract vendor company name, invoice/ticket number, total USD, and any replacement parts or labor items.'
        : 'Context: Operational expense receipt or vendor invoice for Tacos Gavilan (California, USD).'

  const prompt = [
    'Analyze this receipt, ticket, or invoice image/PDF with forensic accounting precision.',
    contextLine,
    'Rules:',
    '1. Never invent numbers. If total is unreadable, set total_usd to 0 and explain in quality_warning_es / quality_warning_en.',
    '2. All amounts are in US Dollars (USD). Never mention pesos or MXN.',
    '3. Convert any visible date to YYYY-MM-DD.',
    '4. Return strictly valid JSON matching the schema.',
  ].join('\n')

  const { interaction, usedModel } = await runInteractionWithFailover(
    GEMINI_MULTIMODAL_MODELS,
    () => ({
      input: [{ type: 'text', text: prompt }, mediaBlock],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: RECEIPT_JSON_SCHEMA,
      },
    })
  )

  const rawJson = extractInteractionText(interaction)
  const parsed = parseGeminiStructuredJson(rawJson)

  const validCats = new Set(['parking', 'toll', 'maintenance_invoice', 'supplies', 'fuel', 'other'])
  const category = validCats.has(parsed.expense_category) ? parsed.expense_category : 'other'

  return {
    is_valid_document: Boolean(parsed.is_valid_document),
    expense_category: category,
    vendor_name: String(parsed.vendor_name || '').trim().slice(0, 140),
    invoice_number: String(parsed.invoice_number || '').trim().slice(0, 80),
    date_yyyy_mm_dd: normalizeIsoDateOrEmpty(parsed.date_yyyy_mm_dd),
    time_12h: String(parsed.time_12h || '').trim().slice(0, 20),
    subtotal_usd: clampMoneyUsd(parsed.subtotal_usd),
    tax_usd: clampMoneyUsd(parsed.tax_usd),
    total_usd: clampMoneyUsd(parsed.total_usd),
    parts_or_items_summary: String(parsed.parts_or_items_summary || '').trim().slice(0, 450),
    summary_es: String(parsed.summary_es || '').trim().slice(0, 280),
    summary_en: String(parsed.summary_en || '').trim().slice(0, 280),
    quality_warning_es: String(parsed.quality_warning_es || '').trim().slice(0, 220),
    quality_warning_en: String(parsed.quality_warning_en || '').trim().slice(0, 220),
    used_model: usedModel,
  }
}

const EQUIPMENT_DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    is_equipment_or_issue_visible: {
      type: 'boolean',
      description: 'True if the photo shows restaurant equipment, facility infrastructure, a data plate/nameplate, or an error display.',
    },
    suggested_category: {
      type: 'string',
      enum: [...ALLOWED_MAINTENANCE_CATEGORIES],
      description: 'Exact maintenance category for Tacos Gavilan.',
    },
    suggested_service_type: {
      type: 'string',
      enum: [...ALLOWED_MAINTENANCE_SERVICE_TYPES],
      description: 'Suggested service type based on visible state (emergency if active leak/fire/hazard/critical down, corrective if broken/error code, preventive if routine cleaning).',
    },
    suggested_status: {
      type: 'string',
      enum: [...ALLOWED_MAINTENANCE_STATUSES],
      description: 'Suggested status (follow_up_needed or pending_parts if visibly broken, completed if visibly clean/repaired).',
    },
    urgency_level: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low'],
      description: 'Operational urgency level.',
    },
    equipment_es: {
      type: 'string',
      description: 'Nombre claro del equipo o área en español (ej. Refrigerador Walk-In, Plancha de Asada, Máquina de Hielo).',
    },
    equipment_en: {
      type: 'string',
      description: 'Clear equipment or area name in English (e.g. Walk-In Cooler, Flat-Top Grill, Ice Machine).',
    },
    brand: {
      type: 'string',
      description: 'Manufacturer brand if visible on logo or nameplate (e.g. True, Hoshizaki, Vulcan, Toast), else empty string.',
    },
    model_number: {
      type: 'string',
      description: 'Exact model number if visible on nameplate/sticker, else empty string.',
    },
    serial_number: {
      type: 'string',
      description: 'Exact serial number (S/N) if visible on nameplate/sticker, else empty string.',
    },
    error_code: {
      type: 'string',
      description: 'Digital display error code or alarm temperature if visible, else empty string.',
    },
    technical_summary_es: {
      type: 'string',
      description: 'Diagnóstico visual técnico conciso en español describiendo lo observado, placa o falla visible (máx 350 caracteres).',
    },
    technical_summary_en: {
      type: 'string',
      description: 'Concise technical visual summary in English describing observed condition, nameplate, or fault (max 350 chars).',
    },
    suggested_parts_es: {
      type: 'string',
      description: 'Piezas posiblemente involucradas en español si son evidentes, o cadena vacía.',
    },
    suggested_parts_en: {
      type: 'string',
      description: 'Likely involved parts in English if evident, or empty string.',
    },
  },
  required: [
    'is_equipment_or_issue_visible',
    'suggested_category',
    'suggested_service_type',
    'suggested_status',
    'urgency_level',
    'equipment_es',
    'equipment_en',
    'brand',
    'model_number',
    'serial_number',
    'error_code',
    'technical_summary_es',
    'technical_summary_en',
    'suggested_parts_es',
    'suggested_parts_en',
  ],
}

/**
 * Analiza visualmente la foto de un equipo de restaurante, placa de serie/modelo o código de error.
 */
export async function diagnoseEquipmentPhotoWithGemini(params: {
  base64Data: string
  mimeType: string
}): Promise<EquipmentVisualDiagnosis> {
  const cleanMime = normalizeMediaMimeType(params.mimeType, 'image/jpeg')
  const rawB64 = params.base64Data.replace(/^data:[^;]+;base64,/, '').trim()
  if (!rawB64) {
    throw new Error('Empty image payload.')
  }

  const prompt = [
    'You are a senior commercial restaurant facilities & kitchen equipment technician for Tacos Gavilan in California.',
    'Inspect this photo carefully. It may show commercial kitchen equipment (refrigeration, grill/plancha, hood/exhaust, grease trap, ice machine, electrical panel, POS/Toast terminal, doors/locks), a manufacturer data nameplate (Brand, Model, Serial Number), or a digital temperature/error code display.',
    'Rules:',
    '1. Extract Brand, Model Number, Serial Number, and Error Code ONLY if actually legible in the image; otherwise return empty strings (never guess serial/model numbers).',
    '2. Provide concise, accurate technical summaries in BOTH Spanish (technical_summary_es) and English (technical_summary_en).',
    '3. Map suggested_category strictly to the allowed enum.',
  ].join('\n')

  const { interaction, usedModel } = await runInteractionWithFailover(
    GEMINI_MULTIMODAL_MODELS,
    () => ({
      input: [
        { type: 'text', text: prompt },
        { type: 'image', data: rawB64, mime_type: cleanMime },
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: EQUIPMENT_DIAGNOSIS_SCHEMA,
      },
    })
  )

  const rawJson = extractInteractionText(interaction)
  const parsed = parseGeminiStructuredJson(rawJson)

  const catSet = new Set<string>(ALLOWED_MAINTENANCE_CATEGORIES)
  const svcSet = new Set<string>(ALLOWED_MAINTENANCE_SERVICE_TYPES)
  const stSet = new Set<string>(ALLOWED_MAINTENANCE_STATUSES)
  const urgSet = new Set(['critical', 'high', 'medium', 'low'])

  return {
    is_equipment_or_issue_visible: Boolean(parsed.is_equipment_or_issue_visible),
    suggested_category: (catSet.has(parsed.suggested_category)
      ? parsed.suggested_category
      : 'general') as MaintenanceCategoryEnum,
    suggested_service_type: (svcSet.has(parsed.suggested_service_type)
      ? parsed.suggested_service_type
      : 'corrective') as MaintenanceServiceTypeEnum,
    suggested_status: (stSet.has(parsed.suggested_status)
      ? parsed.suggested_status
      : 'follow_up_needed') as MaintenanceStatusEnum,
    urgency_level: (urgSet.has(parsed.urgency_level) ? parsed.urgency_level : 'medium') as
      | 'critical'
      | 'high'
      | 'medium'
      | 'low',
    equipment_es: String(parsed.equipment_es || '').trim().slice(0, 120),
    equipment_en: String(parsed.equipment_en || '').trim().slice(0, 120),
    brand: String(parsed.brand || '').trim().slice(0, 60),
    model_number: String(parsed.model_number || '').trim().slice(0, 80),
    serial_number: String(parsed.serial_number || '').trim().slice(0, 80),
    error_code: String(parsed.error_code || '').trim().slice(0, 60),
    technical_summary_es: String(parsed.technical_summary_es || '').trim().slice(0, 500),
    technical_summary_en: String(parsed.technical_summary_en || '').trim().slice(0, 500),
    suggested_parts_es: String(parsed.suggested_parts_es || '').trim().slice(0, 250),
    suggested_parts_en: String(parsed.suggested_parts_en || '').trim().slice(0, 250),
    used_model: usedModel,
  }
}

/**
 * Descarga de forma segura únicamente archivos alojados en el bucket oficial `checklist-photos`
 * de este proyecto Supabase (previniendo SSRF en rutas públicas de mantenimiento).
 */
export async function fetchTrustedMaintenanceAssetAsBase64(
  fileUrl: string,
  maxBytes = 4 * 1024 * 1024
): Promise<{ base64Data: string; mimeType: string }> {
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    : ''
  if (!supabaseOrigin) {
    throw new Error('Supabase URL not configured.')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(fileUrl)
  } catch {
    throw new Error('Invalid asset URL.')
  }

  let decodedPathname = parsedUrl.pathname
  try {
    decodedPathname = decodeURIComponent(parsedUrl.pathname)
  } catch {
    throw new Error('Invalid asset URL.')
  }

  const normalizedPathname = path.posix.normalize(decodedPathname)
  if (
    Boolean(parsedUrl.username || parsedUrl.password) ||
    parsedUrl.origin !== supabaseOrigin ||
    parsedUrl.pathname.includes('..') ||
    decodedPathname.includes('..') ||
    !normalizedPathname.startsWith('/storage/v1/object/public/checklist-photos/maintenance/')
  ) {
    throw new Error('Untrusted asset URL: only Tacos Gavilan maintenance storage assets are permitted.')
  }

  const res = await fetch(parsedUrl.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) {
    throw new Error(`Failed to read uploaded asset (HTTP ${res.status}).`)
  }

  const arrayBuffer = await res.arrayBuffer()
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > maxBytes) {
    throw new Error('Asset size out of allowed bounds (max 4 MB).')
  }

  const headerMime = normalizeMediaMimeType(res.headers.get('content-type') || '', '')
  const pathLower = normalizedPathname.toLowerCase()
  const inferredMime =
    headerMime && headerMime !== 'application/octet-stream'
      ? headerMime
      : pathLower.endsWith('.pdf')
        ? 'application/pdf'
        : pathLower.endsWith('.heic')
          ? 'image/heic'
          : pathLower.endsWith('.heif')
            ? 'image/heif'
            : pathLower.endsWith('.png')
              ? 'image/png'
              : pathLower.endsWith('.webp')
                ? 'image/webp'
                : 'image/jpeg'

  return {
    base64Data: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: inferredMime,
  }
}
