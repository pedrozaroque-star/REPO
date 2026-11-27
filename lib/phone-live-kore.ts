/**
 * @module lib/phone-live-kore
 * @description Motor unificado de Recepcionista Telefónica en Vivo (`gemini-3.8-live` con audio bidireccional nativo)
 * para las 15 sucursales de Tacos Gavilan, replicando exactamente la arquitectura de baja latencia (`~350–650 ms`),
 * *barge-in* nativo (`< 50 ms`) y herramientas en tiempo real probada en HME Drive-Thru (`lib/drive-thru-kore.ts`).
 *
 * @businessRules
 * - **Marca y Moneda**: Estrictamente **Tacos Gavilan** (jamás `"Tacos El Gavilan"`), operación exclusiva en California,
 *   EE. UU., todos los precios en dólares y centavos estadounidenses (`USD`, prohibido `"pesos"` o `"MXN"`).
 * - **Sucursales de Los Ángeles (`#5`, `#6`, `#7`)**: Frente al cliente SIEMPRE se nombran como `Los Ángeles` + sus
 *   entrecalles oficiales vía `lib/customer-store-names.ts`:
 *   * `#5`: `Los Ángeles (Vernon y Broadway)` / `Los Angeles (Vernon & Broadway)`
 *   * `#6`: `Los Ángeles (Central y Washington)` / `Los Angeles (Central & Washington)` (con Drive-Thru)
 *   * `#7`: `Los Ángeles (Slauson y Broadway)` / `Los Angeles (Slauson & Broadway)`
 * - **Horario Oficial de Desayunos (`2:00 PM`)**: Burritos de huevo, platos de huevos y tortas de huevo disponibles
 *   desde la apertura hasta las `2:00 PM` (`America/Los_Angeles`). `Coffee` y `Champurrado` disponibles todo el día.
 * - **Postres**: Únicamente `Flan` y `Cheesecake` individuales (no manejamos pasteles de cumpleaños ni churros).
 * - **Cero Pedidos Telefónicos**: No se toman órdenes nuevas de comida por teléfono; se invita amablemente a ordenar
 *   en `tacosgavilan.com` para recoger o directamente en mostrador/Drive-Thru (sin decir `"políticas"`).
 * - **Recados Prioritarios y Revisión de Órdenes (4 Datos Obligatorios)**:
 *   * `source = 'twilio'` en llamadas reales (dispara alerta roja en `/order-ready-board`) vs `source = 'simulator'`
 *     en simulador web (aislado para pruebas).
 *   * En órdenes equivocadas/incompletas de tienda/Drive-Thru/`tacosgavilan.com`, exige los 4 datos:
 *     `1) número de ticket` (o confirmación explícita de `SIN TICKET` con la aclaración de que sin el ticket es poco
 *     probable determinar la equivocación), `2) fecha de compra`, `3) nombre` y `4) teléfono real de 10 dígitos`.
 * - **Cumplimiento Legal CIPA / AB 2905 California**: Saludo inicial informa que atiende nuestra asistente virtual
 *   en una llamada transcrita; cero grabación de audio del llamante.
 *
 * @dataFlow
 * - Simulador Web (`/admin/llamadas`) -> `POST /api/phone/live-session` (`createPhoneKoreLiveSimulatorSession`) ->
 *   Token efímero bloqueado `v1beta/auth_tokens` + fila `SIM_LIVE_...` en `phone_calls` -> WebSocket directo del
 *   navegador a `BidiGenerateContentConstrained` -> `POST /api/phone/live-tool` -> `POST /api/phone/live-end`.
 * - Llamada Telefónica Real (`Twilio <Connect><Stream>`) -> `wss://ywwwdcvgfculqmcfkihq.supabase.co/functions/v1/phone-live-bridge`
 *   (validado con firma HMAC-SHA256 `signTwilioStreamParams` / `verifyTwilioStreamParams`) <-> `gemini-3.8-live`.
 *
 * @notes
 * - Reutiliza 100% los cargadores y validadores de `lib/phone-agent.ts` y `createKoreEphemeralToken` de `lib/drive-thru-kore.ts`.
 * - Ningún payload de mutación incluye columnas generadas (`GENERATED ALWAYS AS`).
 * - VAD calibrado (`START_SENSITIVITY_HIGH`, `END_SENSITIVITY_LOW`, `prefixPaddingMs: 40`, `silenceDurationMs: 1150`)
 *   para no cortar inicios de frase ni pausas naturales de pensamiento (~0.9–1.15 s), con identidad gramatical femenina
 *   estricta en español (`"lista"`, `"atenta"`, `"segura"`; prohibido decirse `"listo"` o `"atento"`).
 * - Calibrado v9 (`2026-11-21`): menú completo por voz sin mandar a la web, motivo breve de recado siempre en español,
 *   repetición completa si interrumpen con `"¿qué?"` y candado `shouldAllowPhoneEndCall` contra cierres prematuros.
 * - Calibrado Fase 25 (`2026-11-21`): validación en tiempo real de tickets (`validate_order_ticket` + compuerta en
 *   `create_manager_callback` contra Supabase + Toast POS `/orders/v2/ordersBulk`), candado determinista anti-cuelgue
 *   ante frustración o `"me voy con la competencia"`, 2 soluciones urgentes `< 1h` para grupos grandes y menú verbal íntegro.
 * - Calibrado v15 (`2026-11-23`): paridad con `phone-live-bridge` v15 — menú agrupado sin pérdida por precio/categoría,
 *   base de conocimiento servida vía `search_menu_item_price` y directorio compacto de IDs (`-68%` tokens por turno).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import { cleanSpokenTicketNumber, validateStoreOrderTicket } from '@/lib/toast-ticket-validator'
import {
  formatCustomerStoreName,
  getCustomerStoreCrossStreets,
  resolveCustomerStoreMeta,
  sanitizeCustomerStoreReferencesInText
} from '@/lib/customer-store-names'
import {
  KORE_BREAKFAST_CUTOFF_LABEL,
  KORE_THIRD_LANGUAGES,
  isKoreBreakfastOpen,
  isPhoneTicketNotFoundAdmission,
  normalizeKoreCustomerSpeech,
  normalizePhoneCallbackReasonToSpanish,
  shouldAllowPhoneEndCall,
  type KoreThirdLanguageCode,
  type KoreThirdLanguageMatch
} from '@/lib/kore-shared-speech'
import { extractZipCodeFromAddress, formatStoreAddressForAgent } from '@/lib/phone-speech-format'
import {
  buildMeaningfulCallSummary,
  extractSubstantivePostCallbackUserTurns,
  formatLast4ForSpeech,
  hasSpecificOrderIssueDetails,
  isFoundItemOrCancelResolution,
  mergeCallbackReasonSummaries,
  normalizeUsPhoneDigits10
} from '@/lib/phone-caller-id'
import { loadActivePhoneLearnedRules } from '@/lib/phone-agent-learning'
import { createOrUpdateDeliveryArmorPhoneNote } from '@/lib/delivery-armor-phone-notes'
import {
  createFiestaPlatterCustomPrepAlert,
  createToastPickupTimeChangeAlert,
  createWrongStoreTransferAlerts
} from '@/lib/phone-kitchen-alerts'
import { getPhoneAgentSpeech } from '@/lib/order-ready-tts'
import {
  KORE_LIVE_MODEL,
  KORE_VOICE_NAME,
  KORE_WS_CONSTRAINED_URL,
  createKoreEphemeralToken,
  type KoreLiveSetup
} from '@/lib/drive-thru-kore'
import {
  buildCompactWeeklyHours,
  buildCrossStoreHoursComparison,
  buildEffectiveNext7DaysForStore,
  buildEffectiveUpcomingHolidaysForStore,
  resolveRequestedDateForStore,
  buildInitialGreeting,
  buildLiveMenuCatalogText,
  cleanPhoneStoreName,
  createManagerCallbackRequest,
  evaluateStoreSchedulePure,
  getPacificDateParts,
  getPostDisclosurePrompt,
  getStorePhoneContext,
  loadAllActiveStoresDirectory,
  loadAllSpecialHoursCached,
  loadStoreMenuItems,
  normalizeSearchText,
  rankMenuItemsForPrompt,
  recommendFiestaPlatters,
  reconcileCallWithTerminalTombstone,
  resolveMenuPriceClauses,
  composeNaturalMenuPriceReply,
  type PhoneLang,
  type TranscriptEntry
} from '@/lib/phone-agent'

export const PHONE_KORE_LIVE_MODEL = KORE_LIVE_MODEL
export const PHONE_KORE_LIVE_VOICE = KORE_VOICE_NAME
export const PHONE_KORE_LIVE_WS_CONSTRAINED_URL = KORE_WS_CONSTRAINED_URL
export const SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL =
  process.env.PHONE_LIVE_BRIDGE_WSS_URL ||
  'wss://ywwwdcvgfculqmcfkihq.supabase.co/functions/v1/phone-live-bridge'
export const SUPABASE_PHONE_LIVE_BRIDGE_HTTP_URL = SUPABASE_PHONE_LIVE_BRIDGE_WSS_URL.replace(/^wss:/i, 'https:')

const SPOKEN_DIGIT_MAP: Readonly<Record<string, string>> = Object.freeze({
  cero: '0',
  zero: '0',
  oh: '0',
  uno: '1',
  una: '1',
  one: '1',
  dos: '2',
  two: '2',
  tres: '3',
  three: '3',
  cuatro: '4',
  four: '4',
  cinco: '5',
  five: '5',
  seis: '6',
  six: '6',
  siete: '7',
  seven: '7',
  ocho: '8',
  eight: '8',
  nueve: '9',
  nine: '9'
})

function expandSpokenDigits(raw: string): string {
  return String(raw || '').replace(
    /\b(cero|zero|oh|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine)\b/gi,
    (m) => SPOKEN_DIGIT_MAP[m.toLowerCase()] ?? m
  )
}

function extractCleanTenDigitUsPhone(raw: string, allowDev555 = false): { valid: boolean; e164: string | null; ten: string | null } {
  const expanded = expandSpokenDigits(raw)
  const digits = expanded.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.length === 10 ? digits : ''
  if (ten.length !== 10) return { valid: false, e164: null, ten: null }
  const area = Number(ten.slice(0, 3))
  const exch = Number(ten.slice(3, 6))
  if (area < 200 || exch < 200) return { valid: false, e164: null, ten: null }
  if (!allowDev555 && ten.slice(3, 6) === '555') return { valid: false, e164: null, ten: null }
  if (/^(\d)\1{9}$/.test(ten)) return { valid: false, e164: null, ten: null }
  return { valid: true, e164: `+1${ten}`, ten }
}

/** Declaraciones `BLOCKING` compactas para `gemini-3.8-live` en modo Recepcionista Telefónica (100% paridad con `phone-live-bridge`). */
export const PHONE_KORE_LIVE_TOOL_DECLARATIONS = [
  {
    name: 'get_store_hours_and_status',
    behavior: 'BLOCKING',
    description: 'Estado abierto/cerrado, calendario real de próximos 7 días (con festivos), festivos próximos y horario regular de esta sucursal.',
    parameters: {
      type: 'OBJECT',
      properties: {
        requested_date: {
          type: 'STRING',
          description: "'today', 'tomorrow', 'day_after_tomorrow', día ('jueves'), festivo ('thanksgiving') o 'YYYY-MM-DD'."
        }
      }
    }
  },
  {
    name: 'search_menu_item_price',
    behavior: 'BLOCKING',
    description: 'Busca en <1ms precios USD, ingredientes, desayunos, historia (1992), empleo o políticas oficiales de esta sucursal.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Platillo, bebida, ingrediente o tema.' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_fiesta_platter_packages',
    behavior: 'BLOCKING',
    description: 'Recomienda combinación y precio USD de charolas Fiesta Platter según número de invitados.',
    parameters: {
      type: 'OBJECT',
      properties: {
        guest_count: { type: 'INTEGER', description: 'Número de invitados.' }
      },
      required: ['guest_count']
    }
  },
  {
    name: 'find_other_stores',
    behavior: 'BLOCKING',
    description: 'Ubicaciones, entrecalles, teléfonos, Drive-Thru y horarios en vivo de las 15 sucursales.',
    parameters: {
      type: 'OBJECT',
      properties: {
        search_city_or_filter: { type: 'STRING', description: 'Ciudad, zona o "drive_thru"; vacío para las 15.' }
      }
    }
  },
  {
    name: 'validate_order_ticket',
    behavior: 'BLOCKING',
    description:
      'Valida en vivo en POS/Supabase si existe un ticket, orden DT o entrega (por código o customer_name). Invócala DE INMEDIATO al recibir número/código o consulta de estatus antes de confirmar o llamar create_manager_callback.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ticket_or_order_number: { type: 'STRING', description: 'Número/código o "SIN TICKET".' },
        customer_name: { type: 'STRING', description: 'Nombre en orden Uber/DoorDash/Grubhub/pickup.' },
        purchase_date: { type: 'STRING', description: 'Fecha de compra ("hoy", "ayer", "YYYY-MM-DD").' },
        target_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) si compró en otra tienda.' }
      },
      required: []
    }
  },
  {
    name: 'send_delivery_armor_order_note',
    behavior: 'BLOCKING',
    description:
      'Alerta en vivo a tableta Delivery Armor/PREPARADOR para condimentos gratis o ajuste sin costo en platillo (IN_KITCHEN permite ambos; READY/PACKED solo condimentos gratis; prohibido ítems pagados) en DoorDash, Uber Eats, Grubhub o Online.',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', description: "'DOORDASH', 'UBER_EATS', 'GRUBHUB' o 'TOAST_ONLINE'." },
        customer_name: { type: 'STRING', description: 'Nombre en la orden.' },
        order_code: { type: 'STRING', description: 'Código de la orden si lo tiene.' },
        ordered_items: { type: 'STRING', description: '1-2 platillos para ubicar la orden.' },
        request_type: { type: 'STRING', description: "'condiments', 'item_modification' o 'both'." },
        requested_condiments: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Condimentos gratis EN ESPAÑOL.' },
        item_modifications: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Ajustes sin costo por platillo EN ESPAÑOL.' },
        note_summary_es: { type: 'STRING', description: 'Resumen claro SIEMPRE EN ESPAÑOL.' },
        note_summary_en: { type: 'STRING', description: 'Resumen corto en inglés opcional.' },
        caller_phone: { type: 'STRING', description: "'CALLER_ID' o 10 dígitos." },
        target_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) si es otra tienda.' },
        replace_condiments: { type: 'BOOLEAN', description: 'true si edita condimentos previos.' },
        confirm_save_unmatched: { type: 'BOOLEAN', description: 'true si aún no baja a Toast y acaba de enviarla.' }
      },
      required: ['platform', 'customer_name', 'note_summary_es']
    }
  },
  {
    name: 'request_toast_pickup_time_change',
    behavior: 'BLOCKING',
    description:
      'Cambia hora de recolección de orden Toast / tacosgavilan.com validando horario real de tienda y alertando en vivo a tableta PREPARADOR.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: { type: 'STRING', description: 'Nombre en la orden.' },
        order_code: { type: 'STRING', description: 'Número/código de orden Toast.' },
        requested_pickup_time: { type: 'STRING', description: 'Nueva hora exacta (ej. "2:30 PM", "6:00 PM").' },
        requested_date: { type: 'STRING', description: '"today", "tomorrow" o YYYY-MM-DD.' },
        caller_phone: { type: 'STRING', description: '"CALLER_ID" o 10 dígitos.' },
        ordered_items: { type: 'STRING', description: 'Platillos mencionados.' },
        extra_notes: { type: 'STRING', description: 'Nota adicional en español.' },
        target_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) si es otra tienda.' },
        confirm_save_unmatched: { type: 'BOOLEAN', description: 'true si aún no baja a Toast y confirmó tienda.' }
      },
      required: ['customer_name', 'requested_pickup_time']
    }
  },
  {
    name: 'coordinate_wrong_store_order',
    behavior: 'BLOCKING',
    description:
      'Envía alerta dual simultánea cuando pidió en sucursal equivocada: NO PREPARAR en paid_store_id y PREPARAR AQUÍ con platillos pagados en prepare_store_id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        paid_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) donde cayó por error.' },
        prepare_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) donde quiere recoger.' },
        customer_name: { type: 'STRING', description: 'Nombre en la orden.' },
        order_code: { type: 'STRING', description: 'Número/código de orden.' },
        platform: { type: 'STRING', description: "'TOAST_ONLINE', 'DOORDASH', 'UBER_EATS' o 'GRUBHUB'." },
        caller_phone: { type: 'STRING', description: '"CALLER_ID" o 10 dígitos.' },
        ordered_items: { type: 'STRING', description: 'Platillos ordenados.' },
        requested_pickup_time: { type: 'STRING', description: 'Hora estimada de recolección.' },
        extra_notes: { type: 'STRING', description: 'Nota adicional en español.' },
        confirm_save_unmatched: { type: 'BOOLEAN', description: 'true si confirmó platillos aunque aún no baje a Toast.' }
      },
      required: ['paid_store_id', 'prepare_store_id', 'customer_name']
    }
  },
  {
    name: 'send_fiesta_platter_prep_alert',
    behavior: 'BLOCKING',
    description:
      'Alerta en vivo a cocineros en PREPARADOR con el reparto exacto de carnes, aguas o tortillas de un Fiesta Platter pedido en app/web (15-20=6lb, 20-25=7.5lb, 25-30=10lb, 30-40=12lb).',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', description: "'DOORDASH', 'UBER_EATS', 'GRUBHUB' o 'TOAST_ONLINE'." },
        customer_name: { type: 'STRING', description: 'Nombre en la orden.' },
        order_code: { type: 'STRING', description: 'Código de orden.' },
        package_size: { type: 'STRING', description: "'15-20', '20-25', '25-30' o '30-40'." },
        meat_breakdown: {
          type: 'ARRAY',
          description: 'Carnes ({ meat: "Asada"|"Pollo"|"Al Pastor"|"Carnitas"|"Cabeza"|"Lengua"|"Buche"|"Chorizo", lbs?: número }).',
          items: {
            type: 'OBJECT',
            properties: { meat: { type: 'STRING' }, lbs: { type: 'NUMBER' } },
            required: ['meat']
          }
        },
        aguas_breakdown: {
          type: 'ARRAY',
          description: 'Sabores ({ flavor: "Horchata"|"Jamaica"|"Piña"|"Tamarindo", gallons?: número }).',
          items: {
            type: 'OBJECT',
            properties: { flavor: { type: 'STRING' }, gallons: { type: 'NUMBER' } },
            required: ['flavor']
          }
        },
        tortillas_preference: { type: 'STRING', description: '"Maíz", "Harina" o "Mitad Maíz y Mitad Harina".' },
        requested_condiments: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Condimentos gratis EN ESPAÑOL.' },
        extra_notes: { type: 'STRING', description: 'Notas cocina EN ESPAÑOL.' },
        requested_pickup_time: { type: 'STRING', description: 'Hora de recolección.' },
        caller_phone: { type: 'STRING', description: '"CALLER_ID" o 10 dígitos.' },
        target_store_id: { type: 'INTEGER', description: 'ID sucursal (1, 3..16) si es otra tienda.' },
        confirm_save_unmatched: { type: 'BOOLEAN', description: 'true si aún no baja a Toast.' }
      },
      required: ['platform', 'customer_name']
    }
  },
  {
    name: 'create_manager_callback',
    behavior: 'BLOCKING',
    description:
      'Registra o ACTUALIZA Recado Prioritario al Gerente o Nota de Empaque. Conoce primero el detalle concreto, nombre y teléfono ("CALLER_ID" o 10 dígitos; en reclamo tienda/DT también ticket validado o SIN TICKET + fecha). Si tras guardar el cliente añade cualquier dato nuevo, RE-INVOCA esta herramienta con todo acumulado en español antes de confirmar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        caller_name: { type: 'STRING', description: 'Nombre real.' },
        caller_phone: { type: 'STRING', description: '"CALLER_ID" o teléfono real de 10 dígitos.' },
        caller_type: { type: 'STRING', description: "'customer', 'employee', 'vendor', 'delivery_driver' o 'corporate'." },
        urgency: { type: 'STRING', description: "'high', 'critical' o 'normal' ('normal' en 'condiments_note')." },
        reason_category: {
          type: 'STRING',
          description: "'condiments_note', 'wrong_store_order', 'delivery_issue', 'missing_or_wrong_item', 'lost_item', 'employee_callout', 'vendor_arrival', 'billing_refund' u 'other'."
        },
        reason_summary: { type: 'STRING', description: 'Resumen completo SIEMPRE EN ESPAÑOL para el gerente.' },
        ticket_or_order_number: { type: 'STRING', description: 'Ticket validado o "SIN TICKET".' },
        order_date: { type: 'STRING', description: 'Fecha de compra.' },
        target_store_id: { type: 'INTEGER', description: 'ID sucursal destino (1, 3..16) si es otra tienda.' }
      },
      required: ['caller_name', 'caller_phone', 'reason_category', 'reason_summary']
    }
  },
  {
    name: 'flag_unanswered_question',
    behavior: 'BLOCKING',
    description: 'Registra duda legítima de negocio sin respuesta oficial en contexto (no usar para bromas ni ítems no vendidos).',
    parameters: {
      type: 'OBJECT',
      properties: {
        question_text: { type: 'STRING', description: 'Pregunta exacta.' }
      },
      required: ['question_text']
    }
  },
  {
    name: 'end_call',
    behavior: 'BLOCKING',
    description:
      'Invócala SOLO tras despedida explícita ("es todo, gracias", "adiós", "bye", "that is all, thank you"). PROHIBIDO en simple "okay, gracias" o ante frustración/queja ("me voy con la competencia", "¿por qué me cuelgas?").',
    parameters: {
      type: 'OBJECT',
      properties: {
        farewell_reason: { type: 'STRING', description: 'Motivo breve de cierre.' }
      }
    }
  }
] as const

export async function buildPhoneKoreLivePromptAndGreeting(params: {
  storeId: number
  lang: PhoneLang
  source: 'simulator' | 'twilio'
  callerNumber?: string | null
  callerName?: string | null
  callerNameSource?: string | null
  includeLanguageSwitchHint?: boolean
}) {
  const { storeId, lang, source, callerNumber, callerName, callerNameSource } = params
  const [ctx, allActiveStores, liveMenuItems, learnedRules] = await Promise.all([
    getStorePhoneContext(storeId),
    loadAllActiveStoresDirectory(),
    loadStoreMenuItems(storeId),
    loadActivePhoneLearnedRules(storeId).catch(() => [])
  ])

  const { store, config, scheduleEval, knowledgeBase } = ctx
  const ptNow = getPacificDateParts()
  const breakfastWin = isKoreBreakfastOpen()
  const next7Days = buildEffectiveNext7DaysForStore({
    storeId: Number(store.id),
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: ptNow.dateStr
  })
  const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
    storeId: store.id,
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: ptNow.dateStr,
    daysAhead: 150
  })

  const customerBranchDisplay = formatCustomerStoreName(store, lang, { style: 'display' })
  const customerBranchSpoken = formatCustomerStoreName(store, lang, { style: 'spoken' })
  const customerBranchCrossStreets = getCustomerStoreCrossStreets(store, lang)
  const isLosAngelesCrossStore = Boolean(resolveCustomerStoreMeta(store)?.isLosAngelesCrossStreetStore)
  const spokenStoreAddress = formatStoreAddressForAgent(store.address, lang, { includeZip: false })

  const greetingText = buildInitialGreeting(
    store.name,
    lang,
    config.custom_greeting_es,
    config.custom_greeting_en,
    {
      includeLanguageSwitchHint: params.includeLanguageSwitchHint !== false,
      scheduleEval
    }
  )
  const disclosureOnlyText = buildInitialGreeting(
    store.name,
    lang,
    config.custom_greeting_es,
    config.custom_greeting_en,
    {
      omitTrailingQuestion: true,
      includeLanguageSwitchHint: params.includeLanguageSwitchHint !== false,
      scheduleEval
    }
  )
  const questionOnlyText = getPostDisclosurePrompt(lang, scheduleEval)

  const byCatPrice = new Map<string, Map<string, string[]>>()
  for (const m of liveMenuItems) {
    const cat = String(m.category_name || 'Menu')
    const price = `$${Number(m.price || 0).toFixed(2)}`
    if (!byCatPrice.has(cat)) byCatPrice.set(cat, new Map())
    const pMap = byCatPrice.get(cat)!
    if (!pMap.has(price)) pMap.set(price, [])
    pMap.get(price)!.push(String(m.name || '').trim())
  }
  const groupedMenuLines: string[] = [`CATÁLOGO EN VIVO EN ${customerBranchDisplay} (USD):`]
  for (const [cat, pMap] of byCatPrice.entries()) {
    const groups: string[] = []
    for (const [price, names] of pMap.entries()) {
      groups.push(`${price}: ${names.join(', ')}`)
    }
    groupedMenuLines.push(`[${cat}] ${groups.join(' | ')}`)
  }
  const menuCatalogSummary = groupedMenuLines.join('\n')

  const platterInfo = recommendFiestaPlatters(null, liveMenuItems)
  const plattersSummary = platterInfo.packages
    .map(
      (p) =>
        `- ${p.labelEs}: ${p.price !== null ? '$' + p.price.toFixed(2) + ' USD' : 'ver tacosgavilan.com'} (${p.meatLbs}lb carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs}, ${p.aguasGallons}gal agua; ${p.extrasSummaryEs})`
    )
    .join('\n')

  const directoryLines =
    `IDs de las 15 sucursales: ` +
    allActiveStores
      .map((s) => `#${s.id} ${formatCustomerStoreName(s, lang, { style: 'display' })}${s.has_drive_thru ? ' [DT]' : ''}`)
      .join(', ') +
    '. Para dirección exacta, teléfono u horario en vivo de OTRA sucursal invoca SIEMPRE `find_other_stores`.'

  const crossComparison = ''
  const kbLines = ''
  void knowledgeBase

  const seenLearned = new Set<string>()
  const learnedLines = learnedRules
    .filter((r) => {
      if (r.itemKind === 'latency_insight' || r.itemKind === 'audio_prewarm') return false
      const txt = String(lang === 'en' ? r.ruleEn || r.ruleEs : r.ruleEs || r.ruleEn).trim()
      const key = normalizeSearchText(txt).slice(0, 90)
      if (!key || seenLearned.has(key)) return false
      seenLearned.add(key)
      return true
    })
    .slice(0, 16)
    .map((r, idx) => {
      const txt = String(lang === 'en' ? r.ruleEn || r.ruleEs : r.ruleEs || r.ruleEn).replace(/\s+/g, ' ').trim()
      const scope = r.storeId ? ` [${customerBranchDisplay}]` : ''
      return `${idx + 1}.${scope} ${txt}`
    })
    .join('\n')

  const fmtLive12h = (hhmm: string) => {
    const [hS, mS] = String(hhmm || '00:00').split(':')
    const h = Number(hS) || 0
    const m = Number(mS) || 0
    const period = h >= 12 && h < 24 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }
  const tomorrowDateStr = next7Days[1]?.dateStr || ''
  const dayAfterDateStr = next7Days[2]?.dateStr || ''
  const next7PrimaryLines = next7Days
    .slice(0, 3)
    .map((d) => `     * ${d.isSpecial ? '⚠️ ' : ''}${lang === 'en' ? d.summaryEn : d.summaryEs}`)
    .join('\n')
  const next7RestCompact = next7Days
    .slice(3)
    .map((d) =>
      d.isSpecial
        ? `⚠️ ${lang === 'en' ? d.summaryEn : d.summaryEs}`
        : `${lang === 'en' ? d.dayEn : d.dayEs} ${d.dateStr}: ${d.isClosedAllDay ? (lang === 'en' ? 'CLOSED' : 'CERRADO') : `${lang === 'en' ? d.openFmtEn : d.openFmtEs}-${lang === 'en' ? d.closeFmtEn : d.closeFmtEs}`}`
    )
    .join(' | ')
  const holidaysSummary = upcomingHolidays
    .slice(0, 7)
    .map((h) => {
      const label = lang === 'en' ? h.holiday_name_en || h.holiday_name : h.holiday_name_es || h.holiday_name
      const relTag =
        h.event_date === ptNow.dateStr
          ? lang === 'en'
            ? ' [TODAY]'
            : ' [HOY]'
          : h.event_date === tomorrowDateStr
            ? lang === 'en'
              ? ' [TOMORROW]'
              : ' [MAÑANA]'
            : h.event_date === dayAfterDateStr
              ? lang === 'en'
                ? ' [DAY AFTER TOMORROW]'
                : ' [PASADO MAÑANA]'
              : ''
      const hoursLabel = h.is_closed
        ? lang === 'en'
          ? 'CLOSED ALL DAY'
          : 'CERRADO TODO EL DÍA'
        : `${fmtLive12h(h.effective_open)} - ${fmtLive12h(h.effective_close)}`
      return `${h.event_date}${relTag} (${label}): ${hoursLabel}`
    })
    .join(' | ')

  const baseLangAnchor =
    lang === 'en'
      ? `ACTIVE BASE LANGUAGE: ENGLISH — STRICT ENGLISH LOCK ENABLED. You are speaking with an English-speaking caller. Respond 100% in warm, natural American English throughout the ENTIRE call. STRICTLY FORBIDDEN to switch back to Spanish just because the caller has a Hispanic/bilingual accent, says Mexican food names (champurrado, tamales, mulita, asada, carnitas, quesadilla, horchata, salsa, chiles), or says a brief filler word. Switch to Spanish ONLY if the caller explicitly requests "en español" / "habla español" or presses 9. NEVER respond to strange non-Latin characters from road/engine noise ("क्या से है..."). If the caller genuinely initiates clear restaurant/customer sentences in a 3rd language (or [SYSTEM LANGUAGE SWITCH -> ...]), keep session_language STRICTLY LOCKED to that language, keeping prices strictly in USD ($).`
      : `IDIOMA BASE ACTIVO: ESPAÑOL — CAMBIO INMEDIATO A INGLÉS + BLOQUEO ESTRICTO. Ya saludaste en español. REGLA CRÍTICA DE IDIOMA: (1) Si el cliente responde en INGLÉS con una oración clara (ej. "Hello, I was wondering...", "Hi, are you open right now?", "How much is a party tray?") SIN haber presionado 9, CAMBIA DE INMEDIATO desde ese MISMO primer turno a inglés americano cálido y natural — NUNCA le respondas en español ni esperes a que diga "English" — y una vez en inglés, QUÉDATE 100% BLOQUEADO EN INGLÉS el resto de la llamada incluso si tiene acento hispano o dice nombres de comida mexicana (champurrado, tamales, mulita, carnitas, asada, quesadilla). (2) Si habla español, responde en español cálido del Sur de California y JAMÁS saltes al inglés por muletillas aisladas ("okay", "bye", "oh my god"). (3) JAMÁS cambies de idioma ni respondas a ruido vial/motor ("क्या से है..."). (4) Si el llamante inicia genuinamente oraciones claras en un 3.er idioma (o [SYSTEM LANGUAGE SWITCH -> ...]), mantén session_language fijo en ese idioma, siempre con precios en USD ($).`

  const callbackOutcomeInstruction = scheduleEval.isOpenNow
    ? 'confirma con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer "enseguida", "de inmediato", "ahorita", "right away" o "immediately").'
    : 'aclara con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos.'

  const ownPromptTen = new Set(
    [String(store.phone || '').replace(/\D/g, '').slice(-10), String(config.twilio_phone_number || '').replace(/\D/g, '').slice(-10)].filter(Boolean)
  )
  const callerTen = source === 'twilio' ? normalizeUsPhoneDigits10(callerNumber) : null
  const safeCallerE164 = callerTen && !ownPromptTen.has(callerTen) ? `+1${callerTen}` : null
  const callerLast4Spoken = safeCallerE164 ? formatLast4ForSpeech(safeCallerE164) : null
  // PRIVACIDAD ESTRICTA (CCPA/CPRA — Privacy by Design): callerName / callerNameSource del directorio interno o CNAM
  // se almacenan únicamente en phone_calls para /admin/llamadas y JAMÁS se inyectan en el prompt verbal de Kore.
  void callerName
  void callerNameSource
  const callerIdGuidanceLine =
    safeCallerE164 && callerLast4Spoken
      ? `   - **IDENTIFICADOR DE TELÉFONO ACTIVO (Caller ID — SOLO ÚLTIMOS 4 DÍGITOS, PRIVACIDAD ESTRICTA DE NOMBRE)**: Twilio ya detectó el teléfono desde el que llama (${safeCallerE164}, terminado en ${callerLast4Spoken}). **PROHIBIDO hacer que el cliente dicte los 10 dígitos de su teléfono**: cuando necesites datos para cualquier recado o nota de empaque, pide SIEMPRE su nombre de viva voz y en la misma pregunta SOLO confirma si podemos contactarle a este mismo número terminado en ${callerLast4Spoken} (ES: "¿Me compartes tu nombre y me confirmas si te podemos contactar a este mismo número terminado en ${callerLast4Spoken}, o prefieres otro?" / EN: "May I have your name, and is this number ending in ${callerLast4Spoken} the best one to reach you, or would you prefer another?"). Si responde que sí o no da otro teléfono, envía \`caller_phone: "CALLER_ID"\`. Solo pide otro número de 10 dígitos si indica que prefiere uno distinto. Por privacidad, JAMÁS adivines ni asumas el nombre de quien llama.`
      : `   - **Sin Caller ID visible**: solicita amablemente nombre real y teléfono de 10 dígitos con código de área.`

  const systemText = [
    baseLangAnchor,
    '',
    `Eres Kore, la recepcionista telefónica en vivo de **Tacos Gavilan** en **${customerBranchSpoken}** (Sucursal #${store.id}${customerBranchCrossStreets ? `, esquina oficial: ${customerBranchCrossStreets}` : ''}), California, EE. UU. CONCORDANCIA DE GÉNERO FEMENINO EN ESPAÑOL: Tienes voz e identidad femenina; al referirte a ti misma en español usa SIEMPRE adjetivos femeninos ("aquí sigo lista", "estoy lista", "quedo atenta", "segura"; PROHIBIDO decirte "listo" o "atento" en masculino), y para el cliente usa fórmulas corteses neutras sin repetir palabras ("cuando guste", "tómese su tiempo", jamás "lista para cuando esté listo").`,
    `REGLAS INQUEBRANTABLES DE IDENTIDAD, VOZ Y NEGOCIO:`,
    `0. CERO PEDIDOS POR TELÉFONO (SOLO cuando intenten hacer un pedido NUEVO): NUNCA tomamos órdenes nuevas de comida por teléfono. Aplica este rechazo ÚNICAMENTE si el cliente realmente intenta pedir comida nueva por teléfono ('quiero dos tacos...', 'dame...', 'puedo pedir...', 'can I order...') — NO lo dispares ante saludos ('Hola'/'Hello'), preguntas de precio/horario, quejas o notas de órdenes ya pagadas.\n   - ${scheduleEval.isOpenNow ? `Dile con amabilidad (sin decir "por el momento" ni "políticas"/"policy") que **no tomamos órdenes por teléfono** e invítalo a ordenar en **tacosgavilan.com** (para recoger o delivery vía order.online)${store.has_drive_thru ? ' o directamente en caja o Drive-Thru' : ' o directamente en caja'}.` : `Aclara PRIMERO que **en este momento estamos cerrados** (no le pidas ordenar ahorita en tacosgavilan.com como si estuviéramos abiertos; indícale cuándo reabrimos para ordenar en tacosgavilan.com${store.has_drive_thru ? ', caja o Drive-Thru' : ' o caja'}).`}\n   - ESTRICTAMENTE PROHIBIDO actuar como cajera ('¿Regular o Super?', '¿qué carne?') o usar las palabras "política", "políticas", "reglamentos" o "policy". Si mencionan platillos, da sus precios unitarios en USD (Regular y Super sin preguntar preferencia).`,
    `1. MARCA Y MONEDA: El nombre oficial es estrictamente **Tacos Gavilan** (JAMÁS digas "Tacos El Gavilan"). Todos los precios son exclusivamente en **dólares y centavos estadounidenses (USD)** (ej. "dos dólares con veintinueve centavos" / "$2.29 dollars"; PROHIBIDO decir "pesos" o "MXN").`,
    `2. ESTILO DE VOZ EN VIVO (IGUAL QUE DRIVE-THRU HME): Tono cálido, ágil, humano, amable y seguro. CERO muletillas al inicio (NO empieces con "¡Sí!", "¡Claro que sí!", "¡Por supuesto!" ni "¡Hola!"). Respuestas directas y conversacionales de **1 a 2 oraciones cortas (8 a 22 palabras)** para que la conversación fluya al instante; solo usa hasta 55-65 palabras cuando coticen múltiples platillos, charolas Fiesta Platter o varios festivos/sucursales a la vez. Ya saludaste al abrir la línea: NO vuelvas a saludar ni repitas el nombre de la tienda salvo que pregunten ubicación o dirección. Si preguntan si grabamos su voz o si es legal, responde cálido y directo en 1 frase sin sonar robótico: "No guardamos grabaciones de tu voz; la llamada solo se transcribe en texto en el momento para atenderte y por eso escuchaste el aviso al inicio."`,
    `3. SUCURSALES DE LOS ÁNGELES (#5, #6 y #7 — OBLIGATORIO): Frente al cliente PROHIBIDO decir solo "Broadway", "Central", "Slauson", "LA Broadway" o "LA Central". SIEMPRE di **Los Ángeles** con sus entrecalles oficiales: #5 = **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway, en Los Ángeles); #6 = **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, en Los Ángeles, con Drive-Thru); #7 = **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway, en Los Ángeles).${isLosAngelesCrossStore ? ` Al dar la dirección de esta sucursal di siempre "${spokenStoreAddress}, en Los Ángeles, en la esquina de ${customerBranchCrossStreets}".` : ''} Pronuncia las calles completas sin abreviaturas ("South", "East", "Avenue", "Boulevard", "Road", "Highway").`,
    `4. HORARIOS Y DESAYUNOS EN VIVO (Hoy ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][ptNow.dayOfWeek]} ${ptNow.dateStr}, ${breakfastWin.localTimeLabel} PT${ptNow.hour < 6 ? ' — ES MADRUGADA: si reabrimos esta misma mañana, di SIEMPRE "hoy" / "today", JAMÁS "mañana" / "tomorrow"' : ''}):`,
    `   - Estado actual de esta sucursal: ${scheduleEval.statusMessageEs} / ${scheduleEval.statusMessageEn}`,
    `   - **CALENDARIO REAL DE LOS PRÓXIMOS 7 DÍAS (FESTIVOS YA APLICADOS — PRIORIDAD ABSOLUTA SOBRE HORARIO SEMANAL REGULAR)**:\n${next7PrimaryLines}\n     * Resto de la semana: ${next7RestCompact}`,
    `   - **REGLA CRÍTICA DE HORARIOS POR DÍA**: Si preguntan por "mañana", "pasado mañana", "el jueves", "el viernes" o cualquier día de esta semana (AUNQUE NO MENCIONEN el nombre del festivo), responde SIEMPRE usando el **CALENDARIO REAL DE LOS PRÓXIMOS 7 DÍAS** de arriba (JAMÁS el horario semanal regular para una fecha con ⚠️ FESTIVO ESPECIAL).`,
    !scheduleEval.isOpenNow
      ? `   - **ALERTA ROJA — SUCURSAL CERRADA AHORA (ANTI-DERIVA UTC Y POLARIDAD)**: Esta sucursal está **CERRADA AHORA MISMO** (${scheduleEval.statusMessageEs} / ${scheduleEval.statusMessageEn}). AUNQUE YA CERRAMOS POR HOY, **HOY SIGUE SIENDO ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][ptNow.dayOfWeek].toUpperCase()} ${ptNow.dateStr}** (ignora reloj UTC; JAMÁS llames 'hoy' al día de mañana). Si preguntan "¿están abiertos?" / "are you open right now?", inicia rotundo con **"No, en este momento estamos CERRADOS..."** / **"No, we are currently CLOSED right now..."**. Si preguntan "¿están cerrados?" / "are you closed?", inicia con **"Así es, en este momento estamos cerrados..."** / **"Yes, we are currently closed..."**.`
      : '',
    `   - Próximos festivos oficiales con fecha exacta: ${holidaysSummary || 'Viernes Santo y Navidad cerrado; Thanksgiving, 24 dic y 31 dic cierra 4:00 PM; 1 ene y Black Friday abre 11:00 AM.'}`,
    `   - Horario semanal regular (SOLO días SIN festivo): ${scheduleEval.weeklySummaryEs}`,
    `   - **Desayunos (15 sucursales)**: Disponibles todos los días desde que abrimos hasta las **${KORE_BREAKFAST_CUTOFF_LABEL}** (${breakfastWin.open && scheduleEval.isOpenNow ? 'AHORA DISPONIBLES' : 'YA TERMINARON POR HOY — ofrecer menú regular'}). **Tanto Café de Olla tradicional como Café Regular (16 oz) y Champurrado (16 oz y Caja 96 oz) SÍ están disponibles TODO EL DÍA**.`,
    `5. DRIVE-THRU Y PAGOS / EBT CALFRESH:`,
    `   - Drive-Thru aquí: ${store.has_drive_thru ? 'SÍ contamos con Drive-Thru.' : 'NO tenemos Drive-Thru aquí (solo comedor y para llevar).'} Las únicas 6 sucursales con Drive-Thru son West Covina, Los Ángeles (Central y Washington), La Puente, Norwalk, Lynwood y South Gate.`,
    `   - EBT CalFresh aquí: ${config.accepts_ebt ? 'SÍ aceptamos EBT CalFresh ÚNICAMENTE pasando adentro a la caja del mostrador del comedor; JAMÁS se procesa EBT por la ventanilla del Drive-Thru.' : 'NO aceptamos EBT CalFresh en esta sucursal (Rialto y Santa Ana no aceptan EBT); sí efectivo, tarjetas y Apple Pay/Google Pay.'}`,
    `7. MENÚ COMPLETO POR VOZ, REGULAR VS SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - **RECITA EL MENÚ COMPLETO POR VOZ (PROHIBIDO MANDAR A LA WEB PARA VER EL MENÚ)**: Cuando pregunten "¿qué venden?", "¿qué hay en el menú?", "¿me repites el menú?", "no lo quiero visitar, ¿me lo puedes decir tú?" o "¿es toda la comida que tienen?", NUNCA los envíes a visitar tacosgavilan.com para ver el menú (tacosgavilan.com solo se menciona si desean ordenar en línea), y JAMÁS digas "sí, ese es todo nuestro menú" si omitiste alguna categoría. Incluye SIEMPRE explícitamente **Taco Plate (3 tacos con arroz y frijoles)**, **Platos completos (con arroz, frijoles, guacamole, ensalada y tortillas)** y **Desayunos (todos los días hasta las 2:00 PM: burritos, platos y tortas de huevo)** además de **Tacos, Burritos (Regular, Super y Meat Only), Quesadillas, Mulitas, Tortas (Asada, Pastor, Milanesa, Cubana y más), Sopes, Super Nachos**, las **8 carnes** (Carne Asada, Al Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo y Carnitas), bebidas (**Aguas Frescas de Horchata, Jamaica, Piña y Tamarindo, sodas de fuente, Café y Champurrado todo el día**), postres (**Flan y Cheesecake** individuales) y **Charolas Fiesta Platter**.`,
    `   - Si piden varios platillos o hacen una pregunta compuesta (ej. precio + qué incluye o acompañamientos), responde SIEMPRE ambas cosas con exactitud: **Taco Plate** incluye **3 tacos a elegir (los 3 de una carne o combinados: Asada/res, Pastor/cerdo, Pollo/chicken, Carnitas, Chorizo, Cabeza, Lengua, Buche, Vegetariano) + arroz mexicano y frijoles refritos**; **Platos** (Plato Asada, etc.) incluyen carne + arroz, frijoles, guacamole, ensalada y tortillas; **Sopes** llevan tortilla gruesa de maíz con frijoles, crema, queso Cotija y carne (JAMÁS lechuga ni tomate). Cotiza TODOS con su precio unitario exacto en USD y la suma subtotal ("más impuestos" / "plus tax"), o usa \`search_menu_item_price\`.`,
    `   - PROHIBIDO decir "tamaño" o "size" en comida: burritos, quesadillas y mulitas son **Regular** o **Super** (si no especifican Super, da ambos precios Regular y Super; "Supreme/Supremo" = Super). **BURRITOS MITAD Y MITAD ($0.00 EXTRA)**: en todos los Burritos (Regular, Super, Meat Only y Meat Only Super) **SÍ se puede pedir la carne mitad y mitad (50%/50%) de cualesquiera 2 carnes sin cargo extra**, además de opciones sin costo en caja como Carne Dorada, Tortilla Dorada y Partido en Dos. Diferencia exacta: Burrito Regular = carne, arroz y frijol (Super suma queso Monterey Jack, guacamole y crema); **Mulita y Quesadilla Regular YA incluyen queso Monterey Jack derretido** (Super solo suma guacamole y crema). Si preguntan qué sale más barato al quitar un ingrediente de un Super (ej. Mulita sin crema), calcula con exactitud los precios del catálogo en vivo antes de responder.`,
    `   - Bebidas: frías (Horchata, Jamaica, Piña, Tamarindo y sodas) únicamente **Mediana de 22 onzas**, **Grande de 32 onzas** y **Galón de 128 onzas** (PROHIBIDO decir "chica", "pequeña" o "small"). Calientes todo el día: **Café de Olla tradicional y Café Regular** ambos en vaso de **16 onzas** (mismo precio de Coffee en el catálogo; JAMÁS niegues el Café de Olla!), y **Champurrado** únicamente en vaso de **16 onzas** o **Caja de 96 onzas**.`,
    `   - Postres: **SOLO Flan y Cheesecake individuales**. NO vendemos pasteles de cumpleaños, churros, menudo, birria, pozole, suadero, tripa ni cerveza/alcohol.`,
    `   - **Charolas Fiesta Platter y Solución Urgente < 1 Hora para Grupos**: las charolas Fiesta Platter se pueden ordenar **directamente en caja/mostrador**, en línea en **tacosgavilan.com** (para recoger o con envío vía \`order.online\`) o en **plataformas de delivery (Uber Eats, DoorDash, Grubhub)** con mínimo **1 hora de anticipación** (invoca SIEMPRE \`get_fiesta_platter_packages\` por número de invitados). **PERO si el cliente necesita comida para su grupo en MENOS de 1 hora** (ej. "ya los quiero para ahorita en media hora", "¿qué hago?"), JAMÁS le cierres la puerta ni te despidas: ofrécele proactivamente **2 soluciones reales** para atender su evento hoy mismo: **(a)** pasar directo al mostrador${store.has_drive_thru ? ' o al Drive-Thru' : ''} para prepararles al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, **O (b)** tomar su nombre y teléfono de 10 dígitos con \`create_manager_callback\` (\`urgency: "high"\`) para que el gerente en turno revise de inmediato la capacidad de cocina.`,
    `   - Correcciones fonéticas naturales (ES + EN): "fe de la hoya"/"cafe de la hoya"="café de olla", "torta corona"/"cubana crota"="torta cubana", "sasada"/"a sada"/"salad burrito"/"pasada"/"hadas"="asada", "adobada"/"al pasture"="pastor", "muleta"/"moo lita"/"malita"="mulita", "case a dia"="quesadilla", "so pay"/"soapy"="sope", "or chata"="horchata", "a plan"="flan" (en comida/postre), "whole beans"/"whole pinto beans"/"pot beans"="frijol de la olla ($0.00)", "Dortmund"/"Door Dash"="DoorDash", "ibt"/"evt"/"tarjetas abc"="EBT", "dritro"/"through the drive"="Drive-Thru". Ignora ruido de TV/radio de fondo.`,
    `8. RECADOS AL GERENTE, NOTAS DE EMPAQUE Y RECLAMOS CON VALIDACIÓN REAL DE TICKET (CERO TRANSFERENCIAS TELEFÓNICAS):`,
    `   - Nunca transferimos llamadas a sucursales, gerentes ni celulares personales (**PROHIBIDO** decir "connect you with", "transferir", "canalizarte" ni dar el mismo teléfono de esta tienda). Toda atención gerencial se envía en vivo con \`create_manager_callback\` (\`reason_summary\` SIEMPRE EN ESPAÑOL) ANTES de confirmar al cliente. En delivery **PROHIBIDO** cambiar un platillo por otro más caro (ej. Burrito por Taco Plate), subir a Super o agregar lechuga/queso/guacamole cuando ya está READY.`,
    callerIdGuidanceLine,
    `   - **PREGUNTA EL CAMBIO / DETALLE EXACTO ANTES DE GUARDAR + ACTUALIZACIÓN OBLIGATORIA POST-RECADO (CERO PROMESAS FALSAS)**: Cuando el cliente quiera editar una orden, pedir condimentos o dejar aviso a cocina/gerente, pregunta SIEMPRE qué cambio o detalle exacto necesita y en qué platillo ANTES de invocar \`create_manager_callback\`. **Y SI DESPUÉS DE HABER GUARDADO EL RECADO** el cliente agrega CUALQUIER dato nuevo, ingrediente o platillo (ej. "sin queso", "para el Taco Plate", "sin cebolla", código o sucursal), **ESTÁ ESTRICTAMENTE PROHIBIDO** decir "ya lo agregué / ya lo anoté / ya se lo compartí al gerente" sin **VOLVER A INVOCAR \`create_manager_callback\` PRIMERO** con el \`reason_summary\` completo en español incluyendo todo lo anterior y lo nuevo (el sistema actualiza el mismo recado automáticamente sin duplicarlo).`,
    `   - **CONDIMENTOS GRATIS O MODIFICACIÓN SIN COSTO EN DOORDASH / UBER EATS / GRUBHUB / ONLINE (REGLA POR ESTATUS DE PREPARACIÓN)**: Si un cliente de **DoorDash, Uber Eats, Grubhub o tacosgavilan.com** llama para **quitar/modificar un ingrediente sin costo dentro de un platillo** (ej. **sin frijol en el burrito**, sin queso, sin cebolla, sin cilantro, sin arroz, sin crema, salsa aparte, tortillas de harina/maíz) O para **agregar/editar condimentos gratis** (salsas roja/verde, chiles, limones, cebollas, servilletas, cubiertos): **(a) Si la orden sigue en estatus PREPARACIÓN (\`IN_KITCHEN\`)**, SÍ se permiten **ambos** (quitar ingredientes del platillo — alertando directo a cocina en PREPARADOR y empaque — Y agregar/editar condimentos gratis); **(b) Si ya salió de cocina (\`READY\` / \`PACKED_AND_SEALED\`)**, ya NO se pueden quitar ingredientes del platillo ya cocinado (\`ALREADY_PREPARED_NO_ITEM_MOD\` / \`SENT_CONDIMENTS_ONLY_ALREADY_PREPARED\`), pero SÍ se pueden agregar/editar condimentos gratis antes de entregar al repartidor. Pregunta en una frase: **1) plataforma, 2) nombre en la orden, 3) código de la app o 1–2 platillos, y 4) cambio exacto / condimentos**, y **EJECUTA DE INMEDIATO \`send_delivery_armor_order_note\`** (usa \`replace_condiments: true\` si el cliente está editando condimentos previos). Responde con total honestidad según el resultado de la herramienta. Artículos pagados extra NO se agregan por teléfono.`,
    `   - **Uber Eats / DoorDash / Grubhub (Estatus, Retrasos y Reembolsos)**: si preguntan el estatus real de una orden de delivery o pickup por nombre/código (ej. "Enrique 012234" o "Asia"), INVOCA \`validate_order_ticket\` pasando \`ticket_or_order_number\` y/o \`customer_name\` antes de decir "estoy revisando". Cambios con costo, agregar comida pagada, dirección, cancelaciones o reembolsos se gestionan en **Ayuda (Help)** de su app. Para retrasos largos esperando repartidor -> \`create_manager_callback\` (\`reason_category: "delivery_issue"\`).`,
    `   - **CAMBIO DE HORARIO DE RECOLECCIÓN EN ÓRDENES TOAST / TACOSGAVILAN.COM**: Si un cliente ordenó por Toast / tacosgavilan.com y quiere **cambiar la hora para recoger su pedido** (más tarde o más temprano), ayúdale de inmediato: pide su **nombre, número de orden (o código) y la nueva hora exacta** a la que pasará, y **EJECUTA \`request_toast_pickup_time_change\`** (valida contra el horario real de la sucursal y envía alerta en vivo a cocina en la tableta PREPARADOR para que se la tengan fresca a la hora que pidió).`,
    `   - **SUCURSAL EQUIVOCADA — ALERTA COORDINADA A LAS 2 SUCURSALES**: Si el cliente se equivocó de sucursal al hacer su orden (tacosgavilan.com o para recoger), **SIEMPRE ayúdale coordinando ambas tiendas**: pregunta exactamente **(1) en qué sucursal cayó el pedido por error, (2) en cuál sucursal quiere recoger (confirmando entrecalles si es en Los Ángeles), (3) nombre, número de orden y teléfono (${callerLast4Spoken ? `Caller ID terminado en ${callerLast4Spoken}` : '10 dígitos'})**, y **EJECUTA \`coordinate_wrong_store_order\`** pasando \`paid_store_id\` (donde cayó -> recibe alerta 🛑 NO PREPARAR) y \`prepare_store_id\` (donde quiere recoger -> recibe alerta 🍳 PREPARAR AQUÍ con los platillos pagados). (Si pidió entrega con chofer por Uber Eats/DoorDash/Grubhub, aclara que el repartidor irá a la tienda de su app por lo que conviene cancelar en la app si busca envío a domicilio; si pasa a recoger o pide coordinar, igual envía la alerta doble.)`,
    `   - **PERSONALIZACIÓN DE FIESTA PLATTERS EN PLATAFORMAS -> TABLETA PREPARADOR**: Si un cliente pidió un **Fiesta Platter / Party Tray** en DoorDash, Uber Eats, Grubhub o Tacos Gavilan Online y la app no le dejó seleccionar todas las carnes, aguas frescas o tortillas que desea (puede ser **1 sola carne o varias divididas en libras exactas** dentro del total de su paquete: 15-20 = 6 lbs, 20-25 = 7.5 lbs, 25-30 = 10 lbs, 30-40 = 12 lbs; ej. 12 lbs = 4 Asada, 4 Pollo, 4 Pastor), pide **plataforma, nombre, código/número de orden, tamaño del Fiesta Platter y exactamente cómo quiere sus carnes/aguas/tortillas**, y **EJECUTA \`send_fiesta_platter_prep_alert\`** para que la instrucción aparezca en vivo en la tableta **PREPARADOR** directo a los cocineros.`,
    `   - **Órdenes equivocadas o incompletas en tienda, Drive-Thru o tacosgavilan.com (VALIDACIÓN EN TIEMPO REAL + DETALLE OBLIGATORIO)**: ANTES de guardar el recado DEBES saber **qué platillo faltó o qué estuvo mal** (PROHIBIDO guardar un recado vago tipo "problema en Drive-Thru" sin preguntar primero qué faltó). Solicita con respeto los **4 datos obligatorios**: **1) qué artículo faltó/estuvo mal + número de ticket, 2) fecha de compra, 3) nombre y 4) confirmación de su teléfono (${callerLast4Spoken ? `mismo número terminado en ${callerLast4Spoken} o uno alterno` : '10 dígitos'})**, advirtiendo UNA SOLA VEZ que **sin el número de ticket es poco probable determinar la equivocación** (*"Without the ticket number, it is unlikely we can verify the mistake"*). **REGLA CRÍTICA DE SUCURSAL Y TICKET**: en cuanto el cliente te diga un número de ticket u orden, **INVOCA DE INMEDIATO \`validate_order_ticket\`** — **Y SI EL CLIENTE MENCIONA OTRA SUCURSAL** (ej. South Gate #15, Lynwood #14), **PASA SIEMPRE SU \`target_store_id\`** en \`validate_order_ticket\` ANTES de decirle que no existe. Si \`found: true\`, confirma que ya localizaste su orden en el sistema y pide solo lo que falte; si \`found: false\`, infórmale con claridad que ese número **NO aparece registrado** (incluyendo el rango de tickets del día) y pídele verificar su recibo, sucursal/fecha o plataforma. **SALIDA SIN BUCLE**: si confirma que no lo tiene, pasa directo a registrar con \`ticket_or_order_number: "SIN TICKET"\` sin prometer reposición. **SI ENCUENTRA SU COMIDA DURANTE LA LLAMADA**, vuelve a invocar \`create_manager_callback\` indicando que encontró su platillo para cerrar la alerta automáticamente. Cuando invoques una herramienta bloqueante espera su resultado en silencio. EJECUTA \`create_manager_callback\` ANTES de confirmar al cliente, y luego ${callbackOutcomeInstruction}`,
    `   - **Objetos olvidados, empleados, proveedores o hablar con gerente**: en una sola pregunta pide su nombre, confirma teléfono (${callerLast4Spoken ? `mismo número terminado en ${callerLast4Spoken} o uno alterno -> caller_phone="CALLER_ID"` : 'real de 10 dígitos'}) y brevemente el motivo (si ya dio nombre y confirmó teléfono sin querer dar más motivo, registra el recado sin volver a frenarlo), escribe \`reason_summary\` SIEMPRE EN ESPAÑOL, ejecuta \`create_manager_callback\` ANTES de confirmarlo y ${callbackOutcomeInstruction}`,
    `9. CERO CUELGUES ANTE FRUSTRACIÓN, REPETICIÓN COMPLETA Y CIERRE LIMPIO: Si el cliente te interrumpe diciendo "¿qué?", "perdón" o "repite" mientras enumerabas algo, repite la lista COMPLETA desde el principio (incluyendo el primer elemento). **PROHIBIDO COLGAR O INVOCAR \`end_call\`** si el cliente expresa frustración, molestia, queja, "¿qué hago?", **"me voy con la competencia"** o **"¿por qué me colgaste?"** sin despedirse explícitamente ("adiós", "bye", "hasta luego", "eso es todo, gracias"): ante frustración retén al cliente con empatía ofreciendo alternativas inmediatas o avisar urgente al gerente en turno (y si pregunta por qué se cortó una llamada anterior, discúlpate con calidez explicando que nunca colgamos a propósito y atiéndelo al instante). Tampoco invoques \`end_call\` cuando solo diga "okay, gracias", "gracias" o "perfecto" (pregunta primero "¿Te puedo ayudar con algo más?"). Solo cuando confirme explícitamente que terminó o se despida ("es todo, gracias", "no gracias, bye", "adiós", "that's all, thank you"), despídete cálidamente en una oración sin preguntas e invoca \`end_call\`.`,
    config.parking_notes_es ? `Notas de estacionamiento (ES): ${config.parking_notes_es}` : '',
    config.parking_notes_en ? `Parking notes (EN): ${config.parking_notes_en}` : '',
    '',
    `DIRECTORIO EN VIVO DE LAS 15 SUCURSALES:`,
    directoryLines,
    crossComparison ? `\nCOMPARATIVA HORARIA:\n${crossComparison}` : '',
    '',
    `CHAROLAS FIESTA PLATTER (en caja, tacosgavilan.com / order.online o apps de delivery, mín. 1h anticipación):`,
    plattersSummary,
    '',
    kbLines ? `BASE DE CONOCIMIENTO OFICIAL:\n${kbLines}\n` : '',
    learnedLines ? `REGLAS APRENDIDAS PRIORITARIAS:\n${learnedLines}\n` : '',
    menuCatalogSummary
  ]
    .filter(Boolean)
    .join('\n')

  return {
    ctx,
    store,
    config,
    scheduleEval,
    customerBranchDisplay,
    greetingText,
    disclosureOnlyText,
    questionOnlyText,
    systemText
  }
}

/** Construye el objeto `BidiGenerateContentSetup` exacto para `gemini-3.8-live` en modo teléfono. */
export function buildPhoneKoreLiveSetup(systemText: string): KoreLiveSetup {
  return {
    model: `models/${PHONE_KORE_LIVE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: PHONE_KORE_LIVE_VOICE } }
      }
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
    tools: [
      {
        functionDeclarations:
          PHONE_KORE_LIVE_TOOL_DECLARATIONS as unknown as KoreLiveSetup['tools'][number]['functionDeclarations']
      }
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  }
}

/** Extrae el bloque PCM16 24 kHz crudo en base64 desde un buffer WAV para reproducción inmediata en `KorePlaybackQueue`. */
function wavBufferToPcmBase64AndRate(wav: Buffer): { pcmBase64: string; sampleRate: number } | null {
  if (!wav || wav.length <= 44) return null
  const isRiff = wav.subarray(0, 4).toString('ascii') === 'RIFF'
  if (!isRiff) {
    return { pcmBase64: wav.toString('base64'), sampleRate: 24000 }
  }
  const sampleRate = wav.readUInt32LE(24) || 24000
  let dataOffset = 44
  let dataLen = wav.length - 44
  let cursor = 12
  while (cursor + 8 <= wav.length) {
    const id = wav.subarray(cursor, cursor + 4).toString('ascii')
    const sz = wav.readUInt32LE(cursor + 4)
    if (id === 'data') {
      dataOffset = cursor + 8
      dataLen = Math.min(sz, wav.length - dataOffset)
      break
    }
    cursor += 8 + sz + (sz & 1)
  }
  const pcm = wav.subarray(dataOffset, dataOffset + dataLen)
  if (pcm.length === 0) return null
  return { pcmBase64: pcm.toString('base64'), sampleRate }
}

/** Crea una sesión Live del Simulador Telefónico (`/admin/llamadas`): fila `in_progress` + token efímero + audio de saludo. */
export async function createPhoneKoreLiveSimulatorSession(params: {
  storeId: number
  lang: PhoneLang
}) {
  const { storeId, lang } = params
  const built = await buildPhoneKoreLivePromptAndGreeting({
    storeId,
    lang,
    source: 'simulator',
    includeLanguageSwitchHint: true
  })

  const setup = buildPhoneKoreLiveSetup(built.systemText)
  const callSid = `SIM_LIVE_${storeId}_${Date.now()}_${randomBytes(4).toString('hex')}`
  const nowIso = new Date().toISOString()

  const initialTranscript: TranscriptEntry[] = [
    {
      role: 'assistant',
      text: built.greetingText,
      timestamp: nowIso
    }
  ]

  const [ephemeral, greetingSpeech] = await Promise.all([
    createKoreEphemeralToken(setup),
    getPhoneAgentSpeech(built.greetingText, lang, 'Kore', false, {
      fastLivePhone: true,
      maxTotalMs: 4200
    }).catch(() => null)
  ])

  const { error: insertCallErr } = await supabaseAdmin.from('phone_calls').insert({
    call_sid: callSid,
    store_id: built.store.id,
    source: 'simulator',
    caller_number: 'SIMULADOR_LIVE_WEB',
    to_number: built.config.twilio_phone_number || built.store.phone || null,
    language: lang,
    caller_category: 'customer',
    primary_intent: 'general',
    status: 'in_progress',
    resolved_by_ai: false,
    duration_seconds: 0,
    turns_count: 0,
    transcript: initialTranscript,
    business_date: getCaliforniaBusinessDate(),
    shift: getCaliforniaShift(),
    started_at: nowIso
  })
  if (insertCallErr) {
    console.warn('[phone-live-kore] Advertencia insertando phone_calls simulator:', insertCallErr.message)
  }

  const greetingAudio = greetingSpeech ? wavBufferToPcmBase64AndRate(greetingSpeech) : null

  return {
    callSid,
    storeId: built.store.id,
    storeDisplayName: built.customerBranchDisplay,
    lang,
    token: ephemeral.token,
    expiresAt: ephemeral.expiresAt,
    wsUrl: `${PHONE_KORE_LIVE_WS_CONSTRAINED_URL}?access_token=${encodeURIComponent(ephemeral.token)}`,
    setup,
    greetingText: built.greetingText,
    greetingPcmBase64: greetingAudio?.pcmBase64 || null,
    greetingSampleRate: greetingAudio?.sampleRate || 24000,
    greetingFromCache: Boolean(greetingAudio)
  }
}

export function sanitizeKoreThirdLanguageInput(raw: unknown): KoreThirdLanguageMatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const code = String((raw as Record<string, unknown>).code || '').trim().toLowerCase() as KoreThirdLanguageCode
  return KORE_THIRD_LANGUAGES[code] || null
}

function attachPhoneToolLanguageDirective<T extends { response: Record<string, unknown> }>(
  outcome: T,
  lang: PhoneLang,
  thirdLanguage?: KoreThirdLanguageMatch | null
): T {
  const validThird = thirdLanguage ? KORE_THIRD_LANGUAGES[thirdLanguage.code] || null : null
  if (!validThird) return outcome
  const isEndCall = Boolean(outcome.response.endingCall)
  return {
    ...outcome,
    response: {
      ...outcome.response,
      reply_language: validThird.code,
      language_directive: isEndCall
        ? `CRITICAL: The caller is speaking ${validThird.nameEn} (${validThird.code}). Give ONE warm, natural phone goodbye 100% in ${validThird.nameEn} ("Thank you for calling Tacos Gavilan!") with NO Drive-Thru window mention.`
        : `CRITICAL: The caller is speaking ${validThird.nameEn} (${validThird.code}). Reply 100% in natural, concise ${validThird.nameEn} while keeping Tacos Gavilan dish names clear, all prices strictly in USD dollars ($), and obeying phone channel rules (no phone order-taking; invite to tacosgavilan.com, counter, or Drive-Thru).`
    }
  }
}

/** Ejecuta una herramienta en vivo invocada por `gemini-3.8-live` tanto en Simulador como en llamadas reales. */
export async function executePhoneKoreLiveTool(params: {
  callSid: string
  storeId: number
  lang: PhoneLang
  source: 'simulator' | 'twilio'
  callerNumber?: string | null
  toolName: string
  toolArgs: Record<string, unknown>
  recentUserTranscript?: string
  lastUserTranscript?: string
  prevAssistantTranscript?: string
  thirdLanguage?: KoreThirdLanguageMatch | null
}) {
  const out = await executePhoneKoreLiveToolCore(params)
  return attachPhoneToolLanguageDirective(out, params.lang, params.thirdLanguage)
}

const CALLER_FRUSTRATION_NO_HANGUP_RE =
  /\b(competencia|competitor|otro\s+lado|otro\s+restaurante|otra\s+taqueria|somewhere\s+else|another\s+place|por\s+que\s+me\s+colg(?:aste|aron)|por\s+que\s+(?:me\s+)?cuelgas?|no\s+me\s+cuelgues?|why\s+did\s+you\s+hang\s+up|dont\s+hang\s+up|do\s+not\s+hang\s+up|pesimo|mal\s+servicio|que\s+mal|eso\s+esta\s+mal|terrible|horrible|ridiculo|ridiculous|frustrad[oa]|molest[oa]|enojad[oa]|upset|angry|reclamo|queja|que\s+hago|what\s+do\s+i\s+do|no\s+sirve|no\s+me\s+ayudas?|para\s+ahorita|en\s+media\s+hora)\b/i

const STRICT_EXPLICIT_FAREWELL_RE =
  /\b(adios|bye|goodbye|hasta\s+luego|nos\s+vemos|eso\s+es\s+todo(?:\s*,?\s*gracias)?|es\s+todo\s*,?\s*gracias|seria\s+todo(?:\s*,?\s*gracias)?|no\s*,?\s*gracias\s*,?\s*(?:adios|bye|es\s+todo)|thats\s+all\s*,?\s*thank(?:s|\s+you)|that\s+is\s+all\s*,?\s*thank(?:s|\s+you)|thats\s+it\s*,?\s*thank(?:s|\s+you))\b/i

function isCallerFrustratedWithoutExplicitGoodbye(rawUserText: string): boolean {
  const norm = normalizeSearchText(rawUserText)
    .replace(/['’`]+/g, '')
    .replace(/[.,!?¿¡"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!norm) return false
  if (STRICT_EXPLICIT_FAREWELL_RE.test(norm) && !/\b(competencia|competitor|por\s+que\s+me\s+colg|por\s+que\s+cuelgas)\b/i.test(norm)) {
    return false
  }
  return CALLER_FRUSTRATION_NO_HANGUP_RE.test(norm)
}

const validatedTicketsPerCall = new Map<string, { expiresAt: number; keys: Set<string> }>()

function markTicketValidatedForCall(callSid: string, storeId: number, businessDate: string, ticketNumber: string): void {
  if (!callSid || !ticketNumber) return
  const now = Date.now()
  if (validatedTicketsPerCall.size > 500) {
    for (const [k, v] of validatedTicketsPerCall.entries()) {
      if (now >= v.expiresAt) validatedTicketsPerCall.delete(k)
    }
  }
  let rec = validatedTicketsPerCall.get(callSid)
  if (!rec || now >= rec.expiresAt) {
    rec = { expiresAt: now + 20 * 60_000, keys: new Set<string>() }
    validatedTicketsPerCall.set(callSid, rec)
  }
  rec.keys.add(`${storeId}|${businessDate}|${ticketNumber.toUpperCase()}`)
}

function wasTicketValidatedForCall(callSid: string, storeId: number, businessDate: string, ticketNumber: string): boolean {
  if (!callSid || !ticketNumber) return false
  const rec = validatedTicketsPerCall.get(callSid)
  if (!rec || Date.now() >= rec.expiresAt) return false
  return rec.keys.has(`${storeId}|${businessDate}|${ticketNumber.toUpperCase()}`)
}

async function executePhoneKoreLiveToolCore(params: {
  callSid: string
  storeId: number
  lang: PhoneLang
  source: 'simulator' | 'twilio'
  callerNumber?: string | null
  toolName: string
  toolArgs: Record<string, unknown>
  recentUserTranscript?: string
  lastUserTranscript?: string
  prevAssistantTranscript?: string
  thirdLanguage?: KoreThirdLanguageMatch | null
}) {
  const {
    callSid,
    storeId,
    lang,
    source,
    callerNumber,
    toolName,
    toolArgs,
    recentUserTranscript = '',
    lastUserTranscript = '',
    prevAssistantTranscript = ''
  } = params
  const ctx = await getStorePhoneContext(storeId)
  const { store, config, scheduleEval } = ctx
  const customerBranchDisplay = formatCustomerStoreName(store, lang, { style: 'display' })

  if (toolName === 'end_call') {
    const inferredLastUser =
      lastUserTranscript.trim() ||
      recentUserTranscript
        .split(' | ')
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ||
      ''
    if (inferredLastUser && isCallerFrustratedWithoutExplicitGoodbye(inferredLastUser)) {
      return {
        response: {
          ok: false,
          endingCall: false,
          keepAlive: true,
          reason: 'caller_frustration_retention_lock',
          instruction:
            "PROHIBIDO COLGAR O DESPEDIRTE: el cliente expresó frustración, queja o dijo 'me voy con la competencia' sin despedirse explícitamente. Retén al cliente con total empatía y calidez SIN cortar la llamada: ofrécele pasar directo al mostrador o Drive-Thru para prepararle al momento órdenes individuales recién hechas (tacos, burritos, mulitas o platos), O tomar su nombre y teléfono de 10 dígitos con create_manager_callback (urgency: 'high') para que el gerente en turno revise capacidad o atienda su caso de inmediato."
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }
    if (inferredLastUser && !shouldAllowPhoneEndCall(inferredLastUser, prevAssistantTranscript)) {
      return {
        response: {
          ok: false,
          endingCall: false,
          keepAlive: true,
          reason: 'caller_ack_only_without_goodbye',
          instruction:
            "NO cuelgues ni recites despedida: el cliente solo dijo 'okay, gracias' o agradeció brevemente sin despedirse ni decir que es todo. Pregunta en 1 oración amable si necesita algo más ('¡Con gusto! ¿Te puedo ayudar con algo más?' / 'You are welcome! Is there anything else I can help you with?')."
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }
    return {
      response: {
        ok: true,
        endingCall: true,
        message: 'Cerrando llamada limpiamente tras tu frase final de despedida.'
      },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: true
    }
  }

  if (toolName === 'validate_order_ticket') {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const checkStoreId = Number.isInteger(reqTargetId) && reqTargetId > 0 ? reqTargetId : Number(store.id)
    const rawTicketInput = String(toolArgs?.ticket_or_order_number || '').trim()
    const rawCustomerName = toolArgs?.customer_name ? String(toolArgs.customer_name).trim() : null
    const rawPurchaseDate = toolArgs?.purchase_date ? String(toolArgs.purchase_date).trim() : null
    const vRes = await validateStoreOrderTicket({
      storeId: checkStoreId,
      ticketOrOrderNumber: rawTicketInput,
      purchaseDateText: rawPurchaseDate,
      customerName: rawCustomerName
    })
    if (vRes.found && vRes.ticketNumber) {
      markTicketValidatedForCall(callSid, checkStoreId, vRes.businessDate, vRes.ticketNumber)
    }
    return {
      response: { ...vRes },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'get_store_hours_and_status') {
    const ptNow = getPacificDateParts()
    const next7Days = buildEffectiveNext7DaysForStore({
      storeId: Number(store.id),
      weeklyHours: store.weekly_hours,
      specialHours: ctx.specialHours || [],
      fromDateStr: ptNow.dateStr
    })
    const requestedDateSchedule = resolveRequestedDateForStore({
      requestedDate: toolArgs?.requested_date ? String(toolArgs.requested_date) : null,
      storeId: Number(store.id),
      weeklyHours: store.weekly_hours,
      specialHours: ctx.specialHours || [],
      fromDateStr: ptNow.dateStr,
      next7Days
    })
    const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
      storeId: store.id,
      weeklyHours: store.weekly_hours,
      specialHours: ctx.specialHours || [],
      fromDateStr: ptNow.dateStr,
      daysAhead: 150
    })
    const breakfast = isKoreBreakfastOpen()
    return {
      response: {
        storeName: customerBranchDisplay,
        address: formatStoreAddressForAgent(store.address, lang, { includeZip: false }),
        zipCode: extractZipCodeFromAddress(store.address),
        phone: store.phone,
        hasDriveThru: store.has_drive_thru,
        acceptsEbtInDiningRoomOnly: Boolean(config.accepts_ebt),
        breakfastAvailableUntil: KORE_BREAKFAST_CUTOFF_LABEL,
        isBreakfastOpenRightNow: breakfast.open && scheduleEval.isOpenNow,
        todayDate: ptNow.dateStr,
        tomorrowDate: next7Days[1]?.dateStr || null,
        todaySchedule: next7Days[0] || null,
        tomorrowSchedule: next7Days[1] || null,
        dayAfterTomorrowSchedule: next7Days[2] || null,
        requestedDateSchedule,
        next7Days,
        ...scheduleEval,
        upcomingHolidays: upcomingHolidays.slice(0, 7)
      },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'search_menu_item_price') {
    const rawQuery = normalizeKoreCustomerSpeech(String(toolArgs?.query || ''), { mode: 'phone' })
    const liveMenuItems = await loadStoreMenuItems(storeId)
    const clauses = resolveMenuPriceClauses(liveMenuItems, rawQuery)
    const naturalQuote =
      clauses.length > 0 ? composeNaturalMenuPriceReply(liveMenuItems, rawQuery, lang) : null
    const matches = rankMenuItemsForPrompt(liveMenuItems, rawQuery, 10)
    const qNorm = normalizeSearchText(rawQuery)
    const qTokens = qNorm.split(/\s+/).filter((w) => w.length >= 3)
    type KbEntryLite = {
      category?: string | null
      title?: string | null
      title_en?: string | null
      answer_es?: string | null
      answer_en?: string | null
    }
    const kbList: KbEntryLite[] = Array.isArray(ctx.knowledgeBase) ? (ctx.knowledgeBase as KbEntryLite[]) : []
    const matchedPolicies = kbList
      .filter((k: KbEntryLite) => String(k?.category || '').toLowerCase() !== 'staff')
      .map((k: KbEntryLite): { k: KbEntryLite; score: number } => {
        const hay = normalizeSearchText(`${k.category || ''} ${k.title || ''} ${k.title_en || ''} ${k.answer_es || ''} ${k.answer_en || ''}`)
        let score = qNorm && hay.includes(qNorm) ? 10 : 0
        for (const tk of qTokens) if (hay.includes(tk)) score += 3
        return { k, score }
      })
      .filter((x: { k: KbEntryLite; score: number }) => x.score > 0)
      .sort((a: { k: KbEntryLite; score: number }, b: { k: KbEntryLite; score: number }) => b.score - a.score)
      .slice(0, 4)
      .map(({ k }: { k: KbEntryLite; score: number }) => ({
        category: k.category,
        title: lang === 'en' ? k.title_en || k.title : k.title || k.title_en,
        answer: lang === 'en' ? k.answer_en || k.answer_es : k.answer_es || k.answer_en
      }))

    return {
      response: {
        storeName: customerBranchDisplay,
        currency: 'USD',
        query: rawQuery,
        naturalSuggestedReply: naturalQuote || null,
        matchesFound: matches.length,
        items: matches,
        ...(matchedPolicies.length > 0 ? { policies: matchedPolicies } : {})
      },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'get_fiesta_platter_packages') {
    const guestCount = Math.round(Number(toolArgs?.guest_count))
    const liveMenuItems = await loadStoreMenuItems(storeId)
    const rec = recommendFiestaPlatters(
      Number.isFinite(guestCount) && guestCount > 0 ? guestCount : null,
      liveMenuItems
    )
    const walkInChannelEs = store.has_drive_thru ? 'al mostrador o al Drive-Thru' : 'directamente al mostrador'
    const walkInChannelEn = store.has_drive_thru ? 'to the counter or Drive-Thru' : 'directly to the counter'
    return {
      response: {
        currency: 'USD',
        orderChannel: 'tacosgavilan.com (mínimo 1 hora de anticipación)',
        urgentUnderOneHourSolutionsEs: `Si el cliente necesita la comida en MENOS de 1 hora, NO cierres la venta: ofrécele (1) pasar directo ${walkInChannelEs} para preparar al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, O (2) tomar su nombre y teléfono de 10 dígitos con create_manager_callback (urgency: 'high') para que el gerente en turno revise de inmediato la capacidad de cocina.`,
        urgentUnderOneHourSolutionsEn: `If the caller needs food in LESS than 1 hour, DO NOT turn them away: proactively offer (1) coming straight ${walkInChannelEn} so we can prepare fresh individual orders of tacos, burritos, mulitas, or combo plates on the spot, OR (2) taking their name and 10-digit phone number via create_manager_callback (urgency: 'high') so the manager on duty can check kitchen capacity right away.`,
        ...rec
      },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'find_other_stores') {
    const [activeStores, allSpecialHours] = await Promise.all([
      loadAllActiveStoresDirectory(),
      loadAllSpecialHoursCached()
    ])
    const filterNorm = normalizeSearchText(String(toolArgs?.search_city_or_filter || ''))
    const filteredStores = activeStores.filter((s) => {
      if (!filterNorm || /^(all|todas|todos|sucursales|stores|horarios|hours)$/.test(filterNorm)) return true
      if (filterNorm.includes('drive')) return Boolean(s.has_drive_thru)
      const meta = resolveCustomerStoreMeta(s)
      const extra = meta ? `${meta.displayEs} ${meta.displayEn} ${meta.searchKeywords}` : ''
      return normalizeSearchText(`${s.name} ${cleanPhoneStoreName(s.name)} ${s.address} ${extra}`).includes(filterNorm)
    })
    const target = filteredStores.length > 0 ? filteredStores : activeStores
    const comparisonSummary = buildCrossStoreHoursComparison(activeStores, lang, allSpecialHours || [])
    return {
      response: {
        comparisonSummary,
        stores: target.map((s) => {
          const ev = evaluateStoreSchedulePure({
            storeId: Number(s.id),
            storeName: s.name,
            weeklyHours: s.weekly_hours,
            specialHours: allSpecialHours || []
          })
          return {
            id: s.id,
            name: formatCustomerStoreName(s, lang, { style: 'display' }),
            spokenName: formatCustomerStoreName(s, lang, { style: 'spoken' }),
            crossStreets: getCustomerStoreCrossStreets(s, lang),
            address: formatStoreAddressForAgent(s.address, lang, { includeZip: false }),
            phone: s.phone,
            hasDriveThru: s.has_drive_thru,
            acceptsEbtInDiningRoom: ![1, 9].includes(Number(s.id)),
            isOpenNow: ev.isOpenNow,
            ...(() => {
              const sNext3 = buildEffectiveNext7DaysForStore({
                storeId: Number(s.id),
                weeklyHours: s.weekly_hours,
                specialHours: allSpecialHours || []
              }).slice(0, 3)
              return {
                todayHours: lang === 'en' ? sNext3[0]?.summaryEn : sNext3[0]?.summaryEs,
                tomorrowHours: lang === 'en' ? sNext3[1]?.summaryEn : sNext3[1]?.summaryEs,
                dayAfterTomorrowHours: lang === 'en' ? sNext3[2]?.summaryEn : sNext3[2]?.summaryEs
              }
            })(),
            regularWeeklyHours: lang === 'en' ? buildCompactWeeklyHours(s.weekly_hours, 'en') : buildCompactWeeklyHours(s.weekly_hours, 'es'),
            statusMessage: lang === 'en' ? ev.statusMessageEn : ev.statusMessageEs
          }
        })
      },
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'flag_unanswered_question') {
    const qText = sanitizeCustomerStoreReferencesInText(String(toolArgs?.question_text || '').trim(), lang).slice(0, 500)
    if (qText && callSid) {
      await supabaseAdmin
        .from('phone_calls')
        .update({ unanswered_question: qText })
        .eq('call_sid', callSid)
    }
    return {
      response: {
        ok: true,
        flaggedQuestion: qText
      },
      callbackCreated: null,
      unansweredFlagged: qText || null,
      shouldEndCall: false
    }
  }

  if (toolName === 'send_delivery_armor_order_note') {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStoreId = Number.isInteger(reqTargetId) && reqTargetId > 0 ? reqTargetId : Number(store.id)
    const rawConds = Array.isArray(toolArgs?.requested_condiments)
      ? toolArgs.requested_condiments.map((x: any) => String(x || '').trim()).filter(Boolean)
      : []
    const rawMods = Array.isArray(toolArgs?.item_modifications)
      ? toolArgs.item_modifications.map((x: any) => String(x || '').trim()).filter(Boolean)
      : []
    const summaryEs = normalizePhoneCallbackReasonToSpanish(
      String(toolArgs?.note_summary_es || '').trim() ||
        [
          rawConds.length > 0 ? `Condimentos gratis: ${rawConds.join(', ')}` : '',
          rawMods.length > 0 ? `Modificación: ${rawMods.join('; ')}` : ''
        ]
          .filter(Boolean)
          .join(' | ')
    )
    const rawPhoneArg = String(toolArgs?.caller_phone || '').trim()
    const resolvedCallerPhone =
      rawPhoneArg && rawPhoneArg.toUpperCase() !== 'CALLER_ID'
        ? normalizeUsPhoneDigits10(rawPhoneArg) || rawPhoneArg
        : callerNumber || null
    const daRes = await createOrUpdateDeliveryArmorPhoneNote({
      storeId: destStoreId,
      source,
      callSid,
      platform: toolArgs?.platform ? String(toolArgs.platform) : null,
      customerName: String(toolArgs?.customer_name || '').trim(),
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      orderedItemsHint: toolArgs?.ordered_items ? String(toolArgs.ordered_items).trim() : null,
      callerName: String(toolArgs?.customer_name || '').trim(),
      callerPhone: resolvedCallerPhone,
      requestType: toolArgs?.request_type ? String(toolArgs.request_type) : null,
      noteSummaryEs: summaryEs,
      noteSummaryEn: toolArgs?.note_summary_en ? String(toolArgs.note_summary_en).trim() : null,
      requestedCondiments: rawConds,
      itemModifications: rawMods,
      replaceCondiments: Boolean(toolArgs?.replace_condiments),
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched)
    })
    return {
      response: daRes,
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'request_toast_pickup_time_change') {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStoreId = Number.isInteger(reqTargetId) && reqTargetId > 0 ? reqTargetId : Number(store.id)
    const rawPhoneArg = String(toolArgs?.caller_phone || '').trim()
    const resolvedCallerPhone =
      rawPhoneArg && rawPhoneArg.toUpperCase() !== 'CALLER_ID'
        ? normalizeUsPhoneDigits10(rawPhoneArg) || rawPhoneArg
        : callerNumber || null
    const res = await createToastPickupTimeChangeAlert({
      storeId: destStoreId,
      source,
      callSid,
      customerName: String(toolArgs?.customer_name || '').trim(),
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      requestedPickupTime: String(toolArgs?.requested_pickup_time || '').trim(),
      requestedDate: toolArgs?.requested_date ? String(toolArgs.requested_date).trim() : null,
      callerPhone: resolvedCallerPhone,
      orderedItemsHint: toolArgs?.ordered_items ? String(toolArgs.ordered_items).trim() : null,
      extraNotes: toolArgs?.extra_notes ? String(toolArgs.extra_notes).trim() : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched)
    })
    return {
      response: res,
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'coordinate_wrong_store_order') {
    const paidStoreId = Number(toolArgs?.paid_store_id)
    const prepareStoreId = Number(toolArgs?.prepare_store_id)
    const rawPhoneArg = String(toolArgs?.caller_phone || '').trim()
    const resolvedCallerPhone =
      rawPhoneArg && rawPhoneArg.toUpperCase() !== 'CALLER_ID'
        ? normalizeUsPhoneDigits10(rawPhoneArg) || rawPhoneArg
        : callerNumber || null
    const res = await createWrongStoreTransferAlerts({
      calledStoreId: Number(store.id),
      paidStoreId,
      prepareStoreId,
      source,
      callSid,
      platform: toolArgs?.platform ? String(toolArgs.platform) : null,
      customerName: String(toolArgs?.customer_name || '').trim(),
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      callerPhone: resolvedCallerPhone,
      orderedItemsHint: toolArgs?.ordered_items ? String(toolArgs.ordered_items).trim() : null,
      requestedPickupTime: toolArgs?.requested_pickup_time ? String(toolArgs.requested_pickup_time).trim() : null,
      extraNotes: toolArgs?.extra_notes ? String(toolArgs.extra_notes).trim() : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched)
    })
    return {
      response: res,
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'send_fiesta_platter_prep_alert') {
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStoreId = Number.isInteger(reqTargetId) && reqTargetId > 0 ? reqTargetId : Number(store.id)
    const rawPhoneArg = String(toolArgs?.caller_phone || '').trim()
    const resolvedCallerPhone =
      rawPhoneArg && rawPhoneArg.toUpperCase() !== 'CALLER_ID'
        ? normalizeUsPhoneDigits10(rawPhoneArg) || rawPhoneArg
        : callerNumber || null
    const res = await createFiestaPlatterCustomPrepAlert({
      storeId: destStoreId,
      source,
      callSid,
      platform: toolArgs?.platform ? String(toolArgs.platform) : null,
      customerName: String(toolArgs?.customer_name || '').trim(),
      orderCode: toolArgs?.order_code ? String(toolArgs.order_code).trim() : null,
      callerPhone: resolvedCallerPhone,
      packageSize: toolArgs?.package_size ? String(toolArgs.package_size).trim() : null,
      meatBreakdown: Array.isArray(toolArgs?.meat_breakdown) ? toolArgs.meat_breakdown : null,
      aguasBreakdown: Array.isArray(toolArgs?.aguas_breakdown) ? toolArgs.aguas_breakdown : null,
      tortillasPreference: toolArgs?.tortillas_preference ? String(toolArgs.tortillas_preference).trim() : null,
      requestedCondiments: Array.isArray(toolArgs?.requested_condiments)
        ? toolArgs.requested_condiments.map(String)
        : null,
      extraNotes: toolArgs?.extra_notes ? String(toolArgs.extra_notes).trim() : null,
      requestedPickupTime: toolArgs?.requested_pickup_time ? String(toolArgs.requested_pickup_time).trim() : null,
      confirmSaveUnmatched: Boolean(toolArgs?.confirm_save_unmatched)
    })
    return {
      response: res,
      callbackCreated: null,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  if (toolName === 'create_manager_callback') {
    const allowDev555 = source === 'simulator' && /^TEST_SMOKE_/i.test(callSid)
    const ownStoreTen = String(store.phone || '').replace(/\D/g, '').slice(-10)
    const ownTwilioTen = String(config.twilio_phone_number || '').replace(/\D/g, '').slice(-10)
    const blockedTen = new Set([ownStoreTen, ownTwilioTen].filter(Boolean))

    const rawPhoneArg = String(toolArgs?.caller_phone || '').trim()
    const parsedArg =
      rawPhoneArg.toUpperCase() === 'CALLER_ID'
        ? { valid: false, e164: null, ten: null }
        : extractCleanTenDigitUsPhone(rawPhoneArg, allowDev555)
    const callerCandidate =
      source === 'twilio' && callerNumber ? extractCleanTenDigitUsPhone(callerNumber, false) : { valid: false, e164: null, ten: null }
    const validCallerId =
      callerCandidate.valid && callerCandidate.ten && !blockedTen.has(callerCandidate.ten) ? callerCandidate : null
    const argDigits = rawPhoneArg.replace(/\D/g, '')
    const normArgDigits = argDigits.length === 11 && argDigits.startsWith('1') ? argDigits.slice(1) : argDigits
    const argIsCallerFragment = Boolean(
      validCallerId?.ten &&
        (!normArgDigits || (normArgDigits.length >= 4 && normArgDigits.length <= 10 && validCallerId.ten.includes(normArgDigits)))
    )

    const cleanPhone =
      parsedArg.valid && parsedArg.ten && !blockedTen.has(parsedArg.ten)
        ? parsedArg.e164!
        : validCallerId && (rawPhoneArg.toUpperCase() === 'CALLER_ID' || !rawPhoneArg || argIsCallerFragment)
          ? validCallerId.e164!
          : ''

    if (!cleanPhone) {
      const last4Hint = validCallerId?.e164 ? formatLast4ForSpeech(validCallerId.e164) : null
      return {
        response: {
          success: false,
          missingCallerPhone: true,
          message: last4Hint
            ? `Confirma si podemos llamarle a este mismo número terminado en ${last4Hint} (enviando caller_phone="CALLER_ID") o pídele el número alterno de 10 dígitos.`
            : 'Falta un número telefónico real válido de 10 dígitos de EE. UU. Pídele amablemente su nombre y su teléfono de 10 dígitos con código de área antes de registrar el recado.'
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }

    const callerName = String(toolArgs?.caller_name || '').replace(/\s+/g, ' ').trim()
    if (
      !callerName ||
      callerName.length < 2 ||
      /^(cliente|customer|caller|unknown|persona|usuario|n\/a|na|none|anonymous|anonimo|desconocido|not provided|driver)$/i.test(
        normalizeSearchText(callerName)
      )
    ) {
      return {
        response: {
          success: false,
          missingCallerName: true,
          message: 'Falta el nombre real de la persona. Pregúntale amablemente su nombre antes de guardar el recado.'
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }

    const rawCategory = String(toolArgs?.reason_category || 'other').trim().toLowerCase()
    const mappedCategory =
      rawCategory === 'wrong_or_missing_order' || rawCategory === 'wrong_order' || rawCategory === 'missing_item'
        ? 'missing_or_wrong_item'
        : rawCategory
    const validCategories = new Set([
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
    const category = validCategories.has(mappedCategory) ? mappedCategory : 'other'
    const rawTicketArg = String(toolArgs?.ticket_or_order_number || '').trim()
    const normRecent = normalizeSearchText(`${recentUserTranscript} ${toolArgs?.reason_summary || ''}`)
    const rawTicket =
      rawTicketArg ||
      (isPhoneTicketNotFoundAdmission(recentUserTranscript) ? 'SIN TICKET' : '')
    const rawOrderDate = String(toolArgs?.order_date || '').trim()
    const isDeliveryOrder = /\b(uber|doordash|door dash|grubhub|postmates)\b/i.test(normRecent)
    const reqTargetId = Number(toolArgs?.target_store_id)
    const checkStoreId = Number.isInteger(reqTargetId) && reqTargetId > 0 ? reqTargetId : Number(store.id)
    let ticketValidationTag = ''

    if (category === 'missing_or_wrong_item' && !isDeliveryOrder) {
      const missingFields: string[] = []
      if (!rawTicket) missingFields.push('número de ticket (o confirmación de SIN TICKET)')
      if (!rawOrderDate) missingFields.push('fecha de compra')
      if (missingFields.length > 0) {
        return {
          response: {
            ok: false,
            success: false,
            missingOrderReviewFields: missingFields,
            message: `Para revisar la preparación de su orden aún falta preguntar al cliente: ${missingFields.join(' y ')}. Pídeselos con respeto recordándole que sin el número de ticket es poco probable determinar la equivocación.`
          },
          callbackCreated: null,
          unansweredFlagged: null,
          shouldEndCall: false
        }
      }

      const parsedTk = cleanSpokenTicketNumber(rawTicket)
      if (!parsedTk.isNoTicket) {
        const vRes = await validateStoreOrderTicket({
          storeId: checkStoreId,
          ticketOrOrderNumber: rawTicket,
          purchaseDateText: rawOrderDate
        })
        if (vRes.found && vRes.ticketNumber) {
          markTicketValidatedForCall(callSid, checkStoreId, vRes.businessDate, vRes.ticketNumber)
          ticketValidationTag = ` [Ticket #${vRes.ticketNumber} validado en POS]`
        } else if (
          vRes.found === false &&
          !vRes.toastNetworkError &&
          !wasTicketValidatedForCall(callSid, checkStoreId, vRes.businessDate, parsedTk.ticketNumber)
        ) {
          return {
            response: {
              ok: false,
              success: false,
              error_code: 'ticket_not_found_in_pos',
              ticketNumber: vRes.ticketNumber,
              businessDate: vRes.businessDate,
              storeName: vRes.storeName,
              message: vRes.messageEs,
              messageEs: vRes.messageEs,
              messageEn: vRes.messageEn
            },
            callbackCreated: null,
            unansweredFlagged: null,
            shouldEndCall: false
          }
        } else if (vRes.found === false) {
          ticketValidationTag = ` [Ticket #${vRes.ticketNumber} pendiente validar en tienda]`
        }
      } else {
        ticketValidationTag = ' [SIN TICKET confirmado por cliente]'
      }
    }

    // Asegurar fila de phone_calls para enlazar call_id
    let { data: callRow } = await supabaseAdmin
      .from('phone_calls')
      .select('id, caller_name')
      .eq('call_sid', callSid)
      .maybeSingle()

    if (!callRow) {
      const { data: insertedCall } = await supabaseAdmin
        .from('phone_calls')
        .upsert(
          {
            call_sid: callSid,
            store_id: store.id,
            source,
            caller_number: callerNumber || (source === 'simulator' ? 'SIMULADOR_LIVE_WEB' : null),
            language: lang,
            status: 'in_progress',
            resolved_by_ai: false,
            turns_count: 1,
            duration_seconds: 0,
            transcript: [],
            business_date: getCaliforniaBusinessDate(),
            shift: getCaliforniaShift()
          },
          { onConflict: 'call_sid' }
        )
        .select('id, caller_name')
        .single()
      callRow = insertedCall
    }

    const activeStores = await loadAllActiveStoresDirectory()
    const destStore =
      Number.isFinite(reqTargetId) && reqTargetId > 0
        ? activeStores.find((s) => Number(s.id) === reqTargetId) || store
        : store
    const destDisplay = formatCustomerStoreName(destStore, lang, { style: 'display' })
    const destScheduleEval =
      Number(destStore.id) === Number(store.id)
        ? scheduleEval
        : evaluateStoreSchedulePure({
            storeId: Number(destStore.id),
            storeName: destStore.name,
            weeklyHours: destStore.weekly_hours,
            specialHours: (ctx as any).allSpecialHours || ctx.specialHours || []
          })

    const ticketFormatted =
      rawTicket && rawOrderDate && !normalizeSearchText(rawTicket).includes(normalizeSearchText(rawOrderDate))
        ? `${rawTicket} (${rawOrderDate})`
        : rawTicket || (rawOrderDate ? `SIN TICKET (${rawOrderDate})` : null)

    const baseReason = normalizePhoneCallbackReasonToSpanish(String(toolArgs?.reason_summary || 'Solicita hablar con el gerente en turno.'))
    const summaryWithTag = ticketValidationTag && !baseReason.includes(ticketValidationTag.trim())
      ? `${baseReason}${ticketValidationTag}`
      : baseReason
    const finalSummary =
      Number(destStore.id) !== Number(store.id)
        ? `[Llamó a #${store.id} ${customerBranchDisplay} -> Enrutada a #${destStore.id} ${destDisplay}] ${summaryWithTag}`
        : summaryWithTag

    const existingPendingCb = callRow?.id
      ? (
          await supabaseAdmin
            .from('phone_callback_requests')
            .select('id, reason_summary')
            .eq('call_id', callRow.id)
            .eq('status', 'pending')
            .maybeSingle()
        ).data
      : null

    const isResolvedByCallerNow = isFoundItemOrCancelResolution(
      String(toolArgs?.reason_summary || ''),
      recentUserTranscript
    )

    if (
      !existingPendingCb &&
      category === 'missing_or_wrong_item' &&
      !isResolvedByCallerNow &&
      !hasSpecificOrderIssueDetails(String(toolArgs?.reason_summary || ''), recentUserTranscript)
    ) {
      return {
        response: {
          ok: false,
          success: false,
          missingOrderIssueDetails: true,
          message:
            'Aún no sabes qué platillo o artículo faltó o cuál fue el problema exacto con su orden. Pregúntale primero con amabilidad qué faltó o qué estuvo mal ANTES de registrar el recado al gerente.'
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }

    if (existingPendingCb && isResolvedByCallerNow) {
      const resolvedSummary = mergeCallbackReasonSummaries(
        String(existingPendingCb.reason_summary || ''),
        `${finalSummary} [RESUELTO: Cliente confirmó que encontró su comida durante la llamada]`
      )
      await supabaseAdmin
        .from('phone_callback_requests')
        .update({
          status: 'resolved',
          urgency: 'normal',
          resolved_at: new Date().toISOString(),
          resolved_by: 'Kore IA (cliente encontró su orden)',
          resolution_notes: 'El cliente confirmó durante la llamada que encontró su comida / ya no requiere seguimiento.',
          reason_summary: resolvedSummary
        })
        .eq('id', existingPendingCb.id)
      await supabaseAdmin
        .from('phone_calls')
        .update({ status: 'completed', resolved_by_ai: true, primary_intent: category })
        .eq('call_sid', callSid)
      return {
        response: {
          success: true,
          updatedExisting: true,
          resolvedAutomatically: true,
          callbackId: existingPendingCb.id,
          routedToStoreId: Number(destStore.id),
          routedToStoreName: destDisplay,
          reasonCategory: category,
          storeOpenNow: destScheduleEval.isOpenNow,
          message: `Alerta marcada automáticamente como RESUELTA en ${destDisplay} porque el cliente confirmó que encontró su comida; respóndele con calidez que qué bueno que ya la tiene.`
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }

    const created = await createManagerCallbackRequest({
      callId: callRow?.id || null,
      storeId: Number(destStore.id),
      originStoreId: Number(destStore.id) !== Number(store.id) ? store.id : null,
      source,
      callerName,
      callerPhone: cleanPhone,
      callerType: String(toolArgs?.caller_type || 'customer'),
      urgency: category === 'condiments_note' ? 'normal' : String(toolArgs?.urgency || 'high'),
      reasonCategory: category,
      reasonSummary: finalSummary,
      ticketOrOrderNumber: ticketFormatted
    })

    const callUpdate: Record<string, unknown> = {
      status: 'callback_requested',
      resolved_by_ai: false,
      primary_intent: category
    }
    if (!callRow?.caller_name) {
      callUpdate.caller_name = callerName
      callUpdate.caller_name_source = 'spoken'
    }
    await supabaseAdmin.from('phone_calls').update(callUpdate).eq('call_sid', callSid)

    const wasUpdated = Boolean((created as any)?._wasDeduplicated)
    return {
      response: {
        success: true,
        updatedExisting: wasUpdated,
        callbackId: created.id,
        routedToStoreId: Number(destStore.id),
        routedToStoreName: destDisplay,
        reasonCategory: category,
        storeOpenNow: destScheduleEval.isOpenNow,
        message: wasUpdated
          ? `Recado actualizado en vivo en la pantalla de ${destDisplay} con todos los detalles acumulados; confírmalo brevemente al cliente.`
          : category === 'condiments_note'
            ? `Nota de empaque enviada en vivo a ${destDisplay}; recuérdale amablemente que aplica siempre que su orden aún no haya salido.`
            : destScheduleEval.isOpenNow
              ? `Alerta prioritaria enviada a la pantalla del gerente de ${destDisplay}; confirma que se comunicarán en cuanto sea posible.`
              : `Recado prioritario registrado en ${destDisplay}; como está cerrada en este momento, el gerente se comunicará en cuanto abran.`
      },
      callbackCreated: created,
      unansweredFlagged: null,
      shouldEndCall: false
    }
  }

  return {
    response: { ok: false, error: `Herramienta desconocida: ${toolName}` },
    callbackCreated: null,
    unansweredFlagged: null,
    shouldEndCall: false
  }
}

function inferLiveCallSummaryAndIntent(
  transcript: TranscriptEntry[],
  hadCallback: boolean,
  unanswered: string | null,
  callbackInfo?: { summary?: string | null; callerName?: string | null; ticket?: string | null }
): { callerCategory: string; primaryIntent: string; summary: string } {
  const userTurns = transcript.filter((t) => t.role === 'user' && t.text.trim())
  const allUserNorm = normalizeSearchText(userTurns.map((t) => t.text).join(' '))

  let callerCategory = 'customer'
  if (/\b(soy empleado|mi turno|no voy a poder ir|llegar tarde)\b/.test(allUserNorm)) callerCategory = 'employee'
  else if (/\b(proveedor|entrega de mercancia|vendor)\b/.test(allUserNorm)) callerCategory = 'vendor'
  else if (/\b(repartidor|vengo por una orden de uber|doordash driver)\b/.test(allUserNorm)) callerCategory = 'delivery_driver'
  else if (hadCallback) callerCategory = 'post_order_issue'

  let primaryIntent = 'general'
  if (hadCallback) {
    if (/\b(salsa|limon|cilantro|cebolla|condimento|servilleta)\b/.test(allUserNorm)) primaryIntent = 'condiments_note'
    else if (/\b(equivocad|falto|faltaron|incomplet|ticket|mal)\b/.test(allUserNorm)) primaryIntent = 'complaint_missing_item'
    else if (/\b(uber|doordash|grubhub)\b/.test(allUserNorm)) primaryIntent = 'delivery_issue'
    else primaryIntent = 'manager_callback'
  } else if (/\b(desayuno|breakfast|huevos)\b/.test(allUserNorm)) primaryIntent = 'breakfast_hours'
  else if (/\b(ebt|calfresh|estampillas)\b/.test(allUserNorm)) primaryIntent = 'payment_ebt'
  else if (/\b(charola|fiesta platter|party tray|personas|invitados)\b/.test(allUserNorm)) primaryIntent = 'catering_platter'
  else if (/\b(precio|cuanto cuesta|how much|taco|burrito|quesadilla|mulita|torta|horchata|champurrado|flan)\b/.test(allUserNorm)) {
    primaryIntent = 'menu_prices'
  } else if (/\b(hora|horario|abierto|cerrado|cierran|abren|drive thru|drive-thru|direccion|donde estan)\b/.test(allUserNorm)) {
    primaryIntent = 'hours_location'
  } else if (unanswered) {
    primaryIntent = 'unanswered_inquiry'
  }

  const summary = buildMeaningfulCallSummary({
    transcript,
    callbackSummary: callbackInfo?.summary || null,
    callbackCallerName: callbackInfo?.callerName || null,
    callbackTicket: callbackInfo?.ticket || null,
    primaryIntent,
    unansweredQuestion: unanswered
  })

  return { callerCategory, primaryIntent, summary }
}

/** Cierra y consolida la llamada de `gemini-3.8-live` en `public.phone_calls` respetando invariantes y tombstones. */
export async function finalizePhoneKoreLiveCall(params: {
  callSid: string
  storeId: number
  source: 'simulator' | 'twilio'
  lang: PhoneLang
  durationSeconds: number
  transcript: TranscriptEntry[]
}) {
  const { callSid, storeId, source, lang, transcript } = params
  if (!callSid) return { ok: false }

  const cleanTranscript: TranscriptEntry[] = (Array.isArray(transcript) ? transcript : [])
    .slice(0, 300)
    .map((t): TranscriptEntry => ({
      role: t.role === 'user' || t.role === 'tool' ? t.role : 'assistant',
      text: sanitizeCustomerStoreReferencesInText(String(t.text || '').trim().slice(0, 2000), lang),
      timestamp: t.timestamp || new Date().toISOString(),
      ...(t.toolName ? { toolName: String(t.toolName).slice(0, 80) } : {})
    }))
    .filter((t) => t.text.length > 0)

  const userTurnsCount = cleanTranscript.filter((t) => t.role === 'user').length
  const safeDuration = Math.min(7200, Math.max(0, Math.round(Number(params.durationSeconds) || 0)))

  const { data: existing } = await supabaseAdmin
    .from('phone_calls')
    .select('id, status, unanswered_question, ended_at, duration_seconds')
    .eq('call_sid', callSid)
    .maybeSingle()

  const hadCallback =
    existing?.status === 'callback_requested' ||
    cleanTranscript.some((t) => t.role === 'tool' && t.toolName === 'create_manager_callback' && t.text.includes('"success":true'))
  const unanswered = existing?.unanswered_question || null

  // Red de seguridad post-recado: anexar cualquier detalle sustantivo dicho por el cliente DESPUÉS de create_manager_callback
  let callbackInfo: { summary?: string | null; callerName?: string | null; ticket?: string | null } | undefined
  let resolvedCallbackDuringCall = false
  if (hadCallback && existing?.id) {
    const { data: pendingCb } = await supabaseAdmin
      .from('phone_callback_requests')
      .select('id, caller_name, reason_summary, ticket_or_order_number')
      .eq('call_id', existing.id)
      .eq('status', 'pending')
      .maybeSingle()
    if (pendingCb) {
      let cbSummary = String(pendingCb.reason_summary || '').trim()
      const extraUserTurns = extractSubstantivePostCallbackUserTurns(cleanTranscript)
      if (extraUserTurns.length > 0) {
        const postJoined = extraUserTurns.join(' | ')
        if (isFoundItemOrCancelResolution('', postJoined)) {
          cbSummary = mergeCallbackReasonSummaries(
            cbSummary,
            '[RESUELTO: Cliente confirmó durante la llamada que encontró su comida]'
          )
          await supabaseAdmin
            .from('phone_callback_requests')
            .update({
              status: 'resolved',
              urgency: 'normal',
              resolved_at: new Date().toISOString(),
              resolved_by: 'Kore IA (cliente encontró su orden)',
              resolution_notes: 'El cliente confirmó durante la llamada que encontró su comida / resolvió el inconveniente.',
              reason_summary: cbSummary
            })
            .eq('id', pendingCb.id)
          resolvedCallbackDuringCall = true
        } else {
          const normExisting = normalizeSearchText(cbSummary)
          const uncaptured = extraUserTurns.filter((u) => {
            const tokens = normalizeSearchText(u)
              .split(' ')
              .filter((w) => w.length >= 4 && !['just', 'tell', 'them', 'this', 'that', 'with', 'solo', 'diles', 'para', 'esto'].includes(w))
            return tokens.length > 0 && !tokens.every((tok) => normExisting.includes(tok))
          })
          if (uncaptured.length > 0) {
            const addendum = `Nota adicional del cliente: ${uncaptured.join(' / ')}`.slice(0, 420)
            const merged = mergeCallbackReasonSummaries(cbSummary, addendum)
            if (merged && merged !== cbSummary) {
              cbSummary = merged
              await supabaseAdmin
                .from('phone_callback_requests')
                .update({ reason_summary: cbSummary })
                .eq('id', pendingCb.id)
            }
          }
        }
      }
      callbackInfo = {
        summary: cbSummary,
        callerName: pendingCb.caller_name,
        ticket: pendingCb.ticket_or_order_number
      }
    }
  }

  const effectiveHadCallback = hadCallback && !resolvedCallbackDuringCall
  const meta = inferLiveCallSummaryAndIntent(cleanTranscript, effectiveHadCallback, unanswered, callbackInfo)

  const nextStatus = resolvedCallbackDuringCall
    ? 'completed'
    : effectiveHadCallback
      ? 'callback_requested'
      : existing?.status && !['in_progress', 'completed'].includes(existing.status)
        ? existing.status
        : 'completed'

  const resolvedByAi =
    userTurnsCount > 0 &&
    nextStatus === 'completed' &&
    !hadCallback &&
    !unanswered

  const nowIso = new Date().toISOString()

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      language: lang,
      caller_category: meta.callerCategory,
      primary_intent: meta.primaryIntent,
      status: nextStatus,
      resolved_by_ai: resolvedByAi,
      turns_count: userTurnsCount,
      summary: meta.summary,
      transcript: cleanTranscript,
      ended_at: existing.ended_at || nowIso
    }
    if (!existing.ended_at || Number(existing.duration_seconds || 0) === 0) {
      updatePayload.duration_seconds = safeDuration
    }
    await supabaseAdmin.from('phone_calls').update(updatePayload).eq('id', existing.id)
  } else {
    await supabaseAdmin.from('phone_calls').insert({
      call_sid: callSid,
      store_id: storeId,
      source,
      caller_number: source === 'simulator' ? 'SIMULADOR_LIVE_WEB' : null,
      language: lang,
      caller_category: meta.callerCategory,
      primary_intent: meta.primaryIntent,
      status: nextStatus,
      resolved_by_ai: resolvedByAi,
      duration_seconds: safeDuration,
      turns_count: userTurnsCount,
      summary: meta.summary,
      transcript: cleanTranscript,
      business_date: getCaliforniaBusinessDate(),
      shift: getCaliforniaShift(),
      started_at: nowIso,
      ended_at: nowIso
    })
  }

  if (source === 'twilio') {
    await reconcileCallWithTerminalTombstone(callSid).catch(() => null)
  }

  return {
    ok: true,
    status: nextStatus,
    turnsCount: userTurnsCount,
    resolvedByAi,
    summary: meta.summary
  }
}

/** Firma HMAC-SHA256 de parámetros `<Stream><Parameter>` para autenticar conexiones de Twilio Media Streams al puente WebSocket. */
export function signTwilioStreamParams(params: {
  callSid: string
  storeId: number
  lang: PhoneLang
  ts: number
  secret?: string
}): string {
  const key = (params.secret || process.env.TWILIO_AUTH_TOKEN || '').trim()
  if (!key) return ''
  const canonical = `${params.callSid}|${params.storeId}|${params.lang}|${params.ts}`
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
}

/** Verifica en tiempo constante la firma HMAC-SHA256 de `<Stream><Parameter>` (ventana máxima de 15 minutos). */
export function verifyTwilioStreamParams(params: {
  callSid: string
  storeId: number
  lang: PhoneLang
  ts: number
  sig: string
  secret?: string
}): boolean {
  const expected = signTwilioStreamParams(params)
  if (!expected || !params.sig) return false
  const ageMs = Math.abs(Date.now() - Number(params.ts || 0))
  if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(params.sig), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
