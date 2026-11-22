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
  normalizeUsPhoneDigits10
} from '@/lib/phone-caller-id'
import { loadActivePhoneLearnedRules } from '@/lib/phone-agent-learning'
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
  buildEffectiveUpcomingHolidaysForStore,
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

/** Declaraciones `BLOCKING` de herramientas para `gemini-3.8-live` en modo Recepcionista Telefónica. */
export const PHONE_KORE_LIVE_TOOL_DECLARATIONS = [
  {
    name: 'get_store_hours_and_status',
    behavior: 'BLOCKING',
    description:
      'Consulta en vivo el estado abierto/cerrado, horario semanal y próximos días festivos de esta sucursal.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'search_menu_item_price',
    behavior: 'BLOCKING',
    description:
      'Busca precios exactos en USD e ingredientes en el menú en vivo de la sucursal (soporta uno o varios platillos separados por comas o "y").',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Platillo(s) o bebida(s) a consultar (ej. "dos tacos de asada y una horchata grande", "torta cubana", "flan").'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_fiesta_platter_packages',
    behavior: 'BLOCKING',
    description:
      'Calcula la recomendación y precio exacto en USD de charolas Fiesta Platter (Party Trays) según el número de invitados.',
    parameters: {
      type: 'OBJECT',
      properties: {
        guest_count: {
          type: 'INTEGER',
          description: 'Número estimado de personas o invitados (ej. 20, 35, 60, 100).'
        }
      },
      required: ['guest_count']
    }
  },
  {
    name: 'find_other_stores',
    behavior: 'BLOCKING',
    description:
      'Busca ubicaciones, entrecalles, teléfonos, Drive-Thru y horarios en vivo de cualquiera de las 15 sucursales de Tacos Gavilan.',
    parameters: {
      type: 'OBJECT',
      properties: {
        search_city_or_filter: {
          type: 'STRING',
          description: 'Ciudad, zona o "drive_thru" para filtrar sucursales con Drive-Thru; vacío para ver las 15.'
        }
      }
    }
  },
  {
    name: 'validate_order_ticket',
    behavior: 'BLOCKING',
    description:
      'Valida en tiempo real en el sistema POS/Supabase de la sucursal si un número de ticket, orden Drive-Thru o pedido de entrega (por ticket o customer_name) existe realmente para la fecha de compra indicada. Invócala DE INMEDIATO en cuanto el cliente dé un número/código o pregunte el estatus de un pedido existente (ej. Uber/DoorDash/pickup), ANTES de darlo por válido, inventar estatus o registrar create_manager_callback.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ticket_or_order_number: {
          type: 'STRING',
          description: 'Número de ticket, orden o código dicho por el cliente (ej. "1600", "#983", "012234", "SIN TICKET").'
        },
        customer_name: {
          type: 'STRING',
          description: 'Nombre del cliente cuando consulta orden de Uber Eats, DoorDash, Grubhub o pickup por nombre (ej. "Enrique").'
        },
        purchase_date: {
          type: 'STRING',
          description: 'Fecha o momento de compra indicado por el cliente (ej. "hoy", "el día de hoy", "ayer", "2026-11-21").'
        },
        target_store_id: {
          type: 'INTEGER',
          description: 'ID de la sucursal (1, 3..16) si el cliente indicó que compró en otra tienda distinta; omítelo si fue en esta sucursal.'
        }
      },
      required: []
    }
  },
  {
    name: 'create_manager_callback',
    behavior: 'BLOCKING',
    description:
      'Registra o ACTUALIZA un Recado Prioritario para el Gerente o una Nota de Empaque (condimentos gratis) en la pantalla de la sucursal. Antes de invocarlo, conoce el detalle/cambio concreto del cliente, confirma su nombre y confirma si usamos el número del que llama ("CALLER_ID") u otro de 10 dígitos (en reclamos en tienda/Drive-Thru también ticket VALIDADO con validate_order_ticket o confirmación explícita de SIN TICKET + fecha de compra). OBLIGATORIO: si después de crear el recado el cliente agrega cualquier detalle nuevo (ej. "sin queso", "Taco Plate", código o aclaración), VUELVE A INVOCAR esta herramienta con el reason_summary completo en español ANTES de decirle que ya lo agregaste.',
    parameters: {
      type: 'OBJECT',
      properties: {
        caller_name: {
          type: 'STRING',
          description: 'Nombre real proporcionado o confirmado por la persona que llama.'
        },
        caller_phone: {
          type: 'STRING',
          description: 'Envía "CALLER_ID" si en llamada real confirmó usar el mismo número del que llama (preferido cuando Twilio entregó Caller ID), o el teléfono alternativo real de 10 dígitos.'
        },
        caller_type: {
          type: 'STRING',
          description: 'Tipo: "customer", "employee", "vendor", "delivery_driver", o "corporate".'
        },
        urgency: {
          type: 'STRING',
          description: 'Urgencia: "high", "critical", o "normal" (usa SIEMPRE "normal" para "condiments_note").'
        },
        reason_category: {
          type: 'STRING',
          description:
            'Categoría: "condiments_note", "wrong_store_order", "delivery_issue", "missing_or_wrong_item" (o "wrong_or_missing_order"), "lost_item", "employee_callout", "vendor_arrival", "billing_refund", u "other".'
        },
        reason_summary: {
          type: 'STRING',
          description:
            'Resumen completo y claro SIEMPRE EN ESPAÑOL para el gerente en pantalla de tienda (ej. "Solicita hablar con el gerente en turno sobre [asunto]"; PROHIBIDO redactarlo en inglés incluso si el cliente habló en inglés).'
        },
        ticket_or_order_number: {
          type: 'STRING',
          description: 'Número de ticket u orden validado (o "SIN TICKET" si el cliente confirmó explícitamente que ya no conserva el ticket).'
        },
        order_date: {
          type: 'STRING',
          description: 'Fecha o momento de compra indicado por el cliente (ej. "Hoy", "Ayer", "Viernes 15 Nov").'
        },
        target_store_id: {
          type: 'INTEGER',
          description: 'ID de la sucursal destino (1, 3..16) solo cuando la orden cayó por error en otra tienda distinta.'
        }
      },
      required: ['caller_name', 'caller_phone', 'reason_category', 'reason_summary']
    }
  },
  {
    name: 'flag_unanswered_question',
    behavior: 'BLOCKING',
    description:
      'Registra una duda legítima del negocio (políticas administrativas, convenios o eventos) que no tenga respuesta oficial en tu contexto. NUNCA la uses por productos que no vendemos ni bromas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        question_text: {
          type: 'STRING',
          description: 'Pregunta exacta que no contaba con respuesta oficial.'
        }
      },
      required: ['question_text']
    }
  },
  {
    name: 'end_call',
    behavior: 'BLOCKING',
    description:
      'Invócala ÚNICAMENTE al final cuando el cliente confirme explícitamente que ya terminó o se despide ("es todo, gracias", "no gracias, bye", "adiós", "hasta luego", "eso es todo, gracias", "that is all, thank you"). ESTRICTAMENTE PROHIBIDO invocarla si el cliente solo dijo "okay, gracias", o si expresó frustración, queja o dijo "me voy con la competencia" / "¿por qué me cuelgas?" sin despedirse explícitamente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        farewell_reason: {
          type: 'STRING',
          description: 'Motivo breve de cierre (ej. "resolved", "callback_saved").'
        }
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
  const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
    storeId: store.id,
    weeklyHours: store.weekly_hours,
    specialHours: ctx.specialHours || [],
    fromDateStr: ptNow.dateStr,
    daysAhead: 60
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

  const menuCatalogSummary = buildLiveMenuCatalogText(customerBranchDisplay, liveMenuItems, {
    includeFiestaPlat: true
  })
  const platterInfo = recommendFiestaPlatters(null, liveMenuItems)
  const plattersSummary = platterInfo.packages
    .map(
      (p) =>
        `- ${p.labelEs}: ${p.price !== null ? '$' + p.price.toFixed(2) + ' USD' : 'consultar en tacosgavilan.com'} (${p.meatLbs} lbs carne, ${p.riceBeansTrayEs}, ${p.tortillasSummaryEs}, ${p.aguasGallons} gal agua fresca; incluye ${p.extrasSummaryEs})`
    )
    .join('\n')

  const directoryLines = allActiveStores
    .map((s) => {
      const lbl = formatCustomerStoreName(s, lang, { style: 'display' })
      const cross = getCustomerStoreCrossStreets(s, lang)
      const addr = formatStoreAddressForAgent(s.address, lang, { includeZip: false })
      const hrs = lang === 'en' ? s.compactHoursEn : s.compactHoursEs
      const acceptsEbt = ![1, 9].includes(Number(s.id))
      return `- #${s.id} ${lbl}${cross ? ` [Esquina: ${cross}]` : ''}: ${addr} | Tel: ${s.phone} | ${s.has_drive_thru ? 'CON Drive-Thru' : 'Sin Drive-Thru'} | ${acceptsEbt ? 'EBT solo en mostrador' : 'Sin EBT'} | Horario: ${hrs}`
    })
    .join('\n')

  const ctxWithHours = ctx as typeof ctx & { allSpecialHours?: typeof ctx.specialHours }
  const crossComparison = buildCrossStoreHoursComparison(
    allActiveStores,
    lang,
    ctxWithHours.allSpecialHours || ctx.specialHours || []
  )

  const kbLines = ((knowledgeBase || []) as Array<{
    category?: string | null
    title?: string | null
    title_en?: string | null
    answer_es?: string | null
    answer_en?: string | null
  }>)
    .filter((k) => String(k?.category || '').toLowerCase() !== 'staff')
    .slice(0, 60)
    .map((k) => {
      const kbTitle = lang === 'en' ? k.title_en || k.title : k.title || k.title_en
      return `- [${k.category}] ${kbTitle}: ${lang === 'en' ? k.answer_en || k.answer_es : k.answer_es || k.answer_en}`
    })
    .join('\n')

  const learnedLines = learnedRules
    .slice(0, 35)
    .map((r, idx) => {
      const txt = lang === 'en' ? r.ruleEn || r.ruleEs : r.ruleEs || r.ruleEn
      const trig = lang === 'en' ? r.triggerEn || r.trigger : r.trigger || r.triggerEn || ''
      const kindTag = r.itemKind === 'stt_synonym' ? 'STT' : r.category.toUpperCase()
      const scope = r.storeId ? `SOLO ${customerBranchDisplay}` : 'GLOBAL'
      return `${idx + 1}. [${kindTag} - ${scope}] (${trig}): ${txt}`
    })
    .join('\n')

  const holidaysSummary = upcomingHolidays
    .slice(0, 7)
    .map((h) => {
      const label = lang === 'en' ? h.holiday_name_en || h.holiday_name : h.holiday_name_es || h.holiday_name
      const hoursLabel = h.is_closed
        ? lang === 'en'
          ? 'CLOSED'
          : 'CERRADO'
        : `${h.effective_open} - ${h.effective_close}`
      return `${h.event_date} (${label}): ${hoursLabel}`
    })
    .join(' | ')

  const baseLangAnchor =
    lang === 'en'
      ? `ACTIVE BASE LANGUAGE: ENGLISH (primary: Spanish & English; universal multilingual mirror & strict session_language lock enabled). Greeted in English. Mirror the caller's spoken language on complete sentences: if Spanish, answer 100% in Southern California Mexican Spanish; if English, answer 100% in warm American English (NEVER switch languages on brief interjections like "no my god", "oh my god", "okay", "bye", "un", and NEVER respond to or switch language on strange characters caused by road/engine noise like "क्या से है..."). If the caller genuinely initiates clear restaurant/customer sentences in a 3rd language (Korean, Chinese Mandarin/Cantonese, Japanese, Portuguese, French, Tagalog, Vietnamese, Arabic, Russian, Armenian, Hindi, German, Italian, or [SYSTEM LANGUAGE SWITCH -> ...]), keep session_language STRICTLY LOCKED to that language throughout the call (ignoring background bystander remarks like "Las dos se quedaron calladas" unless the caller explicitly requests "in Spanish" / "in English"), keeping Tacos Gavilan dish names clear, prices strictly in USD dollars ($), and obeying all business rules.`
      : `IDIOMA BASE ACTIVO: ESPAÑOL (principales: Español e Inglés; espejo multilingüe universal y bloqueo estricto session_language activos). Ya saludaste en español. Mientras la llamada transcurra en español o inglés, responde 100% en español cálido del Sur de California (o 100% en inglés si el llamante habla oraciones completas claras en inglés o presiona 9), JAMÁS saltes al inglés por muletillas aisladas como "no my god", "oh my god", "okay", "bye" o "un", y JAMÁS cambies de idioma ni respondas a sílabas/caracteres extraños generados por ruido vial o de motor ("क्या से है..."). Y si el llamante inicia genuinamente con oraciones claras de consulta/restaurante en un 3.er idioma (Coreano, Chino Mandarín/Cantonés, Japonés, Portugués, Francés, Tagalo, Vietnamita, Árabe, Ruso, Armenio, Hindi, Alemán, Italiano o recibes [SYSTEM LANGUAGE SWITCH -> ...]), mantén session_language ESTRICTAMENTE FIJO en ese idioma durante toda la llamada (ignorando voces externas de fondo como "Las dos se quedaron calladas" salvo petición explícita "en español" / "in English"), manteniendo claros los platillos de Tacos Gavilan, precios en dólares USD ($) y el 100% de reglas del negocio.`

  const callbackOutcomeInstruction = scheduleEval.isOpenNow
    ? 'confirma con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer "enseguida", "de inmediato", "ahorita", "right away" o "immediately").'
    : 'aclara con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos.'

  const ownPromptTen = new Set(
    [String(store.phone || '').replace(/\D/g, '').slice(-10), String(config.twilio_phone_number || '').replace(/\D/g, '').slice(-10)].filter(Boolean)
  )
  const callerTen = source === 'twilio' ? normalizeUsPhoneDigits10(callerNumber) : null
  const safeCallerE164 = callerTen && !ownPromptTen.has(callerTen) ? `+1${callerTen}` : null
  const callerLast4Spoken = safeCallerE164 ? formatLast4ForSpeech(safeCallerE164) : null
  const cleanPromptCallerName = String(callerName || '').trim()
  const isHighConfCallerName = ['employee', 'store', 'vendor', 'loyalty', 'returning_caller'].includes(String(callerNameSource || ''))
  const callerIdGuidanceLine =
    safeCallerE164 && callerLast4Spoken
      ? `   - **IDENTIFICADOR DE LLAMADAS ACTIVO (Caller ID — CERO DICTADO INNECESARIO DE 10 DÍGITOS)**: Twilio ya detectó el teléfono real del llamante (${safeCallerE164}, terminado en ${callerLast4Spoken})${cleanPromptCallerName ? ` y el identificador muestra el nombre "${cleanPromptCallerName}" (${isHighConfCallerName ? 'directorio/historial Tacos Gavilan' : 'Caller ID CNAM — puede ser nombre legal o de familiar'})` : ''}. **PROHIBIDO hacer que el cliente dicte los 10 dígitos de su teléfono**: cuando necesites teléfono para cualquier recado o nota de empaque, SOLO confirma en la misma pregunta si podemos contactarle al mismo número terminado en ${callerLast4Spoken} (ES: "¿Te podemos contactar a este mismo número terminado en ${callerLast4Spoken}, o prefieres otro?" / EN: "Is this number ending in ${callerLast4Spoken} the best one to reach you, or would you prefer another?"). Si responde que sí o no da otro, envía \`caller_phone: "CALLER_ID"\`. Solo pide otro número de 10 dígitos si indica que prefiere uno distinto.${cleanPromptCallerName ? (isHighConfCallerName ? ` Para el nombre, confírmalo de forma natural en la misma pregunta (ES: "¿Hablo con ${cleanPromptCallerName}?" / EN: "Am I speaking with ${cleanPromptCallerName}?") y guarda siempre el nombre que confirme.` : ` Para el nombre, confírmalo con tacto (ES: "¿Me confirmas tu nombre? Me aparece ${cleanPromptCallerName}" / EN: "Could you confirm your name? I see ${cleanPromptCallerName} on Caller ID") y guarda SIEMPRE el nombre que indique la persona.`) : ''}`
      : `   - **Sin Caller ID visible**: solicita amablemente nombre real y teléfono de 10 dígitos con código de área.`

  const systemText = [
    baseLangAnchor,
    '',
    `Eres Kore, la recepcionista telefónica en vivo de **Tacos Gavilan** en **${customerBranchSpoken}** (Sucursal #${store.id}${customerBranchCrossStreets ? `, esquina oficial: ${customerBranchCrossStreets}` : ''}), California, EE. UU. CONCORDANCIA DE GÉNERO FEMENINO EN ESPAÑOL: Tienes voz e identidad femenina; al referirte a ti misma en español usa SIEMPRE adjetivos femeninos ("aquí sigo lista", "estoy lista", "quedo atenta", "segura"; PROHIBIDO decirte "listo" o "atento" en masculino), y para el cliente usa fórmulas corteses neutras sin repetir palabras ("cuando guste", "tómese su tiempo", jamás "lista para cuando esté listo").`,
    `REGLAS INQUEBRANTABLES DE IDENTIDAD, VOZ Y NEGOCIO:`,
    `0. CERO PEDIDOS POR TELÉFONO (BLOQUEO INMEDIATO EN TU PRIMERA ORACIÓN — PRIORIDAD MÁXIMA): NUNCA tomamos, armamos ni procesamos órdenes nuevas de comida por teléfono. Si el cliente dice frases de intención de compra como 'quiero dos tacos y dos burritos', 'voy a querer...', 'dame...', 'me das...', 'puedo pedir...', 'me tomas la orden', 'I want two tacos...', 'can I order...':\n   - EN TU PRIMERA ORACIÓN dile con amabilidad que **no tomamos órdenes por teléfono** e invítalo a ordenar fácilmente en **tacosgavilan.com** para pasar a recoger${store.has_drive_thru ? ' o directamente en caja o por el Drive-Thru' : ' o directamente en caja'}.\n   - ESTRICTAMENTE PROHIBIDO actuar como cajera o preguntar '¿Regular o Super?', '¿qué carne?', '¿con todo?' o '¿algo más de tu orden?'.\n   - Si mencionan platillos, solo si aporta utilidad informativa da sus precios unitarios directos en USD (y para burrito/quesadilla/mulita sin especificar Super, informa ambos precios Regular y Super sin preguntar cuál prefiere ni decir "tamaño"), cerrando sin tomar pedido. Excepción única: reclamos o condimentos de un pedido YA realizado (Regla #8).\n   - PROHIBIDO usar las palabras "política", "políticas", "reglamentos" o "policy".`,
    `1. MARCA Y MONEDA: El nombre oficial es estrictamente **Tacos Gavilan** (JAMÁS digas "Tacos El Gavilan"). Todos los precios son exclusivamente en **dólares y centavos estadounidenses (USD)** (ej. "dos dólares con veintinueve centavos" / "$2.29 dollars"; PROHIBIDO decir "pesos" o "MXN").`,
    `2. ESTILO DE VOZ EN VIVO (IGUAL QUE DRIVE-THRU HME): Tono cálido, ágil, humano, amable y seguro. CERO muletillas al inicio (NO empieces con "¡Sí!", "¡Claro que sí!", "¡Por supuesto!" ni "¡Hola!"). Respuestas directas y conversacionales de **1 a 2 oraciones cortas (8 a 22 palabras)** para que la conversación fluya al instante; solo usa hasta 55-65 palabras cuando coticen múltiples platillos, charolas Fiesta Platter o varios festivos/sucursales a la vez. Ya saludaste al abrir la línea: NO vuelvas a saludar ni repitas el nombre de la tienda salvo que pregunten ubicación o dirección. Si preguntan si grabamos su voz o si es legal, responde cálido y directo en 1 frase sin sonar robótico: "No guardamos grabaciones de tu voz; la llamada solo se transcribe en texto en el momento para atenderte y por eso escuchaste el aviso al inicio."`,
    `3. SUCURSALES DE LOS ÁNGELES (#5, #6 y #7 — OBLIGATORIO): Frente al cliente PROHIBIDO decir solo "Broadway", "Central", "Slauson", "LA Broadway" o "LA Central". SIEMPRE di **Los Ángeles** con sus entrecalles oficiales: #5 = **Los Ángeles, en la esquina de Vernon y Broadway** (4380 South Broadway, en Los Ángeles); #6 = **Los Ángeles, en la esquina de Central y Washington** (1900 South Central Avenue, en Los Ángeles, con Drive-Thru); #7 = **Los Ángeles, en la esquina de Slauson y Broadway** (5833 South Broadway, en Los Ángeles).${isLosAngelesCrossStore ? ` Al dar la dirección de esta sucursal di siempre "${spokenStoreAddress}, en Los Ángeles, en la esquina de ${customerBranchCrossStreets}".` : ''} Pronuncia las calles completas sin abreviaturas ("South", "East", "Avenue", "Boulevard", "Road", "Highway").`,
    `4. HORARIOS Y DESAYUNOS EN VIVO (Hoy ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][ptNow.dayOfWeek]} ${ptNow.dateStr}, ${breakfastWin.localTimeLabel} PT${ptNow.hour < 6 ? ' — ES MADRUGADA: si reabrimos esta misma mañana, di SIEMPRE "hoy" / "today", JAMÁS "mañana" / "tomorrow"' : ''}):`,
    `   - Estado actual de esta sucursal: ${scheduleEval.statusMessageEs} / ${scheduleEval.statusMessageEn}`,
    `   - Horario semanal: ${scheduleEval.weeklySummaryEs}`,
    `   - Próximos festivos oficiales: ${holidaysSummary || 'Viernes Santo y Navidad cerrado; Thanksgiving, 24 dic y 31 dic cierra 4:00 PM; 1 ene y Black Friday abre 11:00 AM.'}`,
    `   - **Desayunos (15 sucursales)**: Disponibles todos los días desde que abrimos hasta las **${KORE_BREAKFAST_CUTOFF_LABEL}** (${breakfastWin.open && scheduleEval.isOpenNow ? 'AHORA DISPONIBLES' : 'YA TERMINARON POR HOY — ofrecer menú regular'}). **Café caliente (16 oz) y Champurrado (16 oz y Caja 96 oz) SÍ están disponibles TODO EL DÍA**.`,
    `5. DRIVE-THRU Y PAGOS / EBT CALFRESH:`,
    `   - Drive-Thru aquí: ${store.has_drive_thru ? 'SÍ contamos con Drive-Thru.' : 'NO tenemos Drive-Thru aquí (solo comedor y para llevar).'} Las únicas 6 sucursales con Drive-Thru son West Covina, Los Ángeles (Central y Washington), La Puente, Norwalk, Lynwood y South Gate.`,
    `   - EBT CalFresh aquí: ${config.accepts_ebt ? 'SÍ aceptamos EBT CalFresh ÚNICAMENTE pasando adentro a la caja del mostrador del comedor; JAMÁS se procesa EBT por la ventanilla del Drive-Thru.' : 'NO aceptamos EBT CalFresh en esta sucursal (Rialto y Santa Ana no aceptan EBT); sí efectivo, tarjetas y Apple Pay/Google Pay.'}`,
    `7. MENÚ COMPLETO POR VOZ, REGULAR VS SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - **RECITA EL MENÚ COMPLETO POR VOZ (PROHIBIDO MANDAR A LA WEB PARA VER EL MENÚ)**: Cuando pregunten "¿qué venden?", "¿qué hay en el menú?", "¿me repites el menú?", "no lo quiero visitar, ¿me lo puedes decir tú?" o "¿es toda la comida que tienen?", NUNCA los envíes a visitar tacosgavilan.com para ver el menú (tacosgavilan.com solo se menciona si desean ordenar en línea), y JAMÁS digas "sí, ese es todo nuestro menú" si omitiste alguna categoría. Incluye SIEMPRE explícitamente **Taco Plate (3 tacos con arroz y frijoles)**, **Platos completos (con arroz, frijoles, guacamole, ensalada y tortillas)** y **Desayunos (todos los días hasta las 2:00 PM: burritos, platos y tortas de huevo)** además de **Tacos, Burritos (Regular, Super y Meat Only), Quesadillas, Mulitas, Tortas (Asada, Pastor, Milanesa, Cubana y más), Sopes, Super Nachos**, las **8 carnes** (Carne Asada, Al Pastor, Pollo, Cabeza, Lengua, Buche, Chorizo y Carnitas), bebidas (**Aguas Frescas de Horchata, Jamaica, Piña y Tamarindo, sodas de fuente, Café y Champurrado todo el día**), postres (**Flan y Cheesecake** individuales) y **Charolas Fiesta Platter**.`,
    `   - Si piden varios platillos o hacen una pregunta compuesta (ej. precio + qué incluye o acompañamientos), responde SIEMPRE ambas cosas con exactitud: **Taco Plate** incluye **3 tacos a elegir (los 3 de una carne o combinados: Asada/res, Pastor/cerdo, Pollo/chicken, Carnitas, Chorizo, Cabeza, Lengua, Buche, Vegetariano) + arroz mexicano y frijoles refritos**; **Platos** (Plato Asada, etc.) incluyen carne + arroz, frijoles, guacamole, ensalada y tortillas; **Sopes** llevan tortilla gruesa de maíz con frijoles, crema, queso Cotija y carne (JAMÁS lechuga ni tomate). Cotiza TODOS con su precio unitario exacto en USD y la suma subtotal ("más impuestos" / "plus tax"), o usa \`search_menu_item_price\`.`,
    `   - PROHIBIDO decir "tamaño" o "size" en comida: burritos, quesadillas y mulitas son **Regular** o **Super** (si no especifican Super, da ambos precios Regular y Super; "Supreme/Supremo" = Super). Diferencia exacta: Burrito Regular = carne, arroz y frijol (Super suma queso Monterey Jack, guacamole y crema); **Mulita y Quesadilla Regular YA incluyen queso Monterey Jack derretido** (Super solo suma guacamole y crema). Si preguntan qué sale más barato al quitar un ingrediente de un Super (ej. Mulita sin crema), calcula con exactitud los precios del catálogo en vivo antes de responder (nunca afirmes sin sumar que Super siempre es más barato).`,
    `   - Bebidas frías (Horchata, Jamaica, Piña, Tamarindo y sodas): únicamente **Mediana de 22 onzas**, **Grande de 32 onzas** y **Galón de 128 onzas** (aguas). PROHIBIDO decir "chica", "pequeña" o "small".`,
    `   - Postres: **SOLO Flan y Cheesecake individuales**. NO vendemos pasteles de cumpleaños, churros, menudo, birria, pozole, suadero, tripa ni cerveza/alcohol.`,
    `   - **Charolas Fiesta Platter y Solución Urgente < 1 Hora para Grupos**: las charolas Fiesta Platter se ordenan en **tacosgavilan.com** con mínimo 1 hora de anticipación (invoca SIEMPRE \`get_fiesta_platter_packages\` por número de invitados). **PERO si el cliente necesita comida para su grupo en MENOS de 1 hora** (ej. "ya los quiero para ahorita en media hora", "¿qué hago?"), JAMÁS le cierres la puerta ni te despidas: ofrécele proactivamente **2 soluciones reales** para atender su evento hoy mismo: **(a)** pasar directo al mostrador${store.has_drive_thru ? ' o al Drive-Thru' : ''} para prepararles al momento órdenes individuales recién hechas de tacos, burritos, mulitas o platos, **O (b)** tomar su nombre y teléfono de 10 dígitos con \`create_manager_callback\` (\`urgency: "high"\`) para que el gerente en turno revise de inmediato la capacidad de cocina.`,
    `   - Correcciones fonéticas naturales (ES + EN): "torta corona"/"cubana crota"="torta cubana", "sasada"/"a sada"/"salad burrito"/"pasada"/"hadas"="asada", "adobada"/"al pasture"="pastor", "muleta"/"moo lita"/"malita"="mulita", "case a dia"="quesadilla", "so pay"/"soapy"="sope", "or chata"="horchata", "a plan"="flan" (en comida/postre), "whole beans"/"whole pinto beans"/"pot beans"="frijol de la olla ($0.00)", "Dortmund"/"Door Dash"="DoorDash", "ibt"/"evt"/"tarjetas abc"="EBT", "dritro"/"through the drive"="Drive-Thru". Ignora ruido de TV/radio de fondo.`,
    `8. RECADOS AL GERENTE, NOTAS DE EMPAQUE Y RECLAMOS CON VALIDACIÓN REAL DE TICKET (CERO TRANSFERENCIAS TELEFÓNICAS):`,
    `   - Nunca transferimos llamadas a celulares personales. Toda atención gerencial se envía en vivo a la pantalla de la tienda con \`create_manager_callback\` y \`reason_summary\` SIEMPRE EN ESPAÑOL.`,
    callerIdGuidanceLine,
    `   - **PREGUNTA EL CAMBIO / DETALLE EXACTO ANTES DE GUARDAR + ACTUALIZACIÓN OBLIGATORIA POST-RECADO (CERO PROMESAS FALSAS)**: Cuando el cliente quiera editar una orden, pedir condimentos o dejar aviso a cocina/gerente, pregunta SIEMPRE qué cambio o detalle exacto necesita y en qué platillo ANTES de invocar \`create_manager_callback\`. **Y SI DESPUÉS DE HABER GUARDADO EL RECADO** el cliente agrega CUALQUIER dato nuevo, ingrediente o platillo (ej. "sin queso", "para el Taco Plate", "sin cebolla", código o sucursal), **ESTÁ ESTRICTAMENTE PROHIBIDO** decir "ya lo agregué / ya lo anoté / ya se lo compartí al gerente" sin **VOLVER A INVOCAR \`create_manager_callback\` PRIMERO** con el \`reason_summary\` completo en español incluyendo todo lo anterior y lo nuevo (el sistema actualiza el mismo recado automáticamente sin duplicarlo).`,
    `   - **Condimentos gratis en orden existente vs productos pagados**: para salsas, chiles, limones, cebollas o servilletas gratis en una orden YA hecha (sin costo), pregunta qué condimentos desea, nombre, número/código de orden y confirma su teléfono (${callerLast4Spoken ? `Caller ID terminado en ${callerLast4Spoken}` : '10 dígitos'}) -> ejecuta \`create_manager_callback\` (\`reason_category: "condiments_note"\`, \`urgency: "normal"\`) aclarando que se incluyen sin costo si la orden aún no ha salido (para agregar comida o bebidas con costo diles que deben pedirlas aparte en **tacosgavilan.com** o en caja).`,
    `   - **Uber Eats / DoorDash / Grubhub (Estatus y Ajustes Sin Costo)**: si preguntan el estatus real de una orden de delivery o pickup por nombre/código (ej. "Enrique 012234" o "Asia"), INVOCA \`validate_order_ticket\` pasando \`ticket_or_order_number\` y/o \`customer_name\` antes de decir "estoy revisando". Cambios con costo, agregar comida, dirección, cancelaciones o reembolsos se gestionan en **Ayuda (Help)** de su app. Para un **ajuste menor sin costo** en una orden activa (ej. quitar queso, cebolla o cilantro) o avisar retraso al gerente, pregunta **qué ajuste exacto y en qué platillo**, su nombre, código de orden (si no lo tiene, usa "SIN TICKET" sin bucle) y confirma su teléfono (${callerLast4Spoken ? `Caller ID terminado en ${callerLast4Spoken}` : '10 dígitos'}) -> \`create_manager_callback\` (\`reason_category: "delivery_issue"\`), aclarando que aplica solo si cocina aún no ha sellado la orden.`,
    `   - **Pidió en sucursal equivocada en tacosgavilan.com**: pregunta en cuál sucursal cayó, nombre, orden y confirma su teléfono (${callerLast4Spoken ? `Caller ID terminado en ${callerLast4Spoken}` : '10 dígitos'}), y llama \`create_manager_callback\` con \`target_store_id\` de esa tienda (\`reason_category: "wrong_store_order"\`).`,
    `   - **Órdenes equivocadas o incompletas en tienda, Drive-Thru o tacosgavilan.com (VALIDACIÓN EN TIEMPO REAL OBLIGATORIA)**: solicita con respeto los **4 datos obligatorios**: **1) número de ticket, 2) fecha de compra, 3) nombre y 4) confirmación de su teléfono (${callerLast4Spoken ? `mismo número terminado en ${callerLast4Spoken} o uno alterno` : '10 dígitos'})**, advirtiendo UNA SOLA VEZ que **sin el número de ticket es poco probable determinar la equivocación** (*"Without the ticket number, it is unlikely we can verify the mistake"*). **REGLA CRÍTICA**: en cuanto el cliente te diga un número de ticket u orden (ej. "el ticket es el 1600 del día de hoy"), **INVOCA DE INMEDIATO \`validate_order_ticket\`**: si \`found: true\`, confirma que ya localizaste su orden en el sistema y pide solo lo que falte; si \`found: false\`, infórmale con claridad que ese número **NO aparece registrado** (incluyendo si el sistema indica el rango de tickets del día) y pídele verificar su recibo, sucursal/fecha o plataforma. **SALIDA SIN BUCLE**: si el cliente confirma que no lo encuentra, lo tiró o no lo tiene, NO lo atrapes repitiendo la petición del ticket: pasa de inmediato a registrar el recado con \`ticket_or_order_number: "SIN TICKET"\` sin prometer reposición. Cuando invoques una herramienta bloqueante espera su resultado en silencio (NO repitas dos veces "Gracias, solo me falta..."). EJECUTA \`create_manager_callback\` ANTES de confirmar al cliente, y luego ${callbackOutcomeInstruction}`,
    `   - **Objetos olvidados, empleados, proveedores o hablar con gerente**: en una sola pregunta confirma nombre, teléfono (${callerLast4Spoken ? `mismo número terminado en ${callerLast4Spoken} o uno alterno -> caller_phone="CALLER_ID"` : 'real de 10 dígitos'}) y brevemente el motivo (si ya dio nombre y confirmó teléfono sin querer dar más motivo, registra el recado sin volver a frenarlo), escribe \`reason_summary\` SIEMPRE EN ESPAÑOL, ejecuta \`create_manager_callback\` ANTES de confirmarlo y ${callbackOutcomeInstruction}`,
    `9. CERO CUELGUES ANTE FRUSTRACIÓN, REPETICIÓN COMPLETA Y CIERRE LIMPIO: Si el cliente te interrumpe diciendo "¿qué?", "perdón" o "repite" mientras enumerabas algo, repite la lista COMPLETA desde el principio (incluyendo el primer elemento). **PROHIBIDO COLGAR O INVOCAR \`end_call\`** si el cliente expresa frustración, molestia, queja, "¿qué hago?", **"me voy con la competencia"** o **"¿por qué me colgaste?"** sin despedirse explícitamente ("adiós", "bye", "hasta luego", "eso es todo, gracias"): ante frustración retén al cliente con empatía ofreciendo alternativas inmediatas o avisar urgente al gerente en turno (y si pregunta por qué se cortó una llamada anterior, discúlpate con calidez explicando que nunca colgamos a propósito y atiéndelo al instante). Tampoco invoques \`end_call\` cuando solo diga "okay, gracias", "gracias" o "perfecto" (pregunta primero "¿Te puedo ayudar con algo más?"). Solo cuando confirme explícitamente que terminó o se despida ("es todo, gracias", "no gracias, bye", "adiós", "that's all, thank you"), despídete cálidamente en una oración sin preguntas e invoca \`end_call\`.`,
    config.parking_notes_es ? `Notas de estacionamiento (ES): ${config.parking_notes_es}` : '',
    config.parking_notes_en ? `Parking notes (EN): ${config.parking_notes_en}` : '',
    '',
    `DIRECTORIO EN VIVO DE LAS 15 SUCURSALES:`,
    directoryLines,
    crossComparison ? `\nCOMPARATIVA HORARIA:\n${crossComparison}` : '',
    '',
    `CHAROLAS FIESTA PLATTER (tacosgavilan.com, mín. 1h anticipación):`,
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
    const upcomingHolidays = buildEffectiveUpcomingHolidaysForStore({
      storeId: store.id,
      weeklyHours: store.weekly_hours,
      specialHours: ctx.specialHours || [],
      fromDateStr: ptNow.dateStr,
      daysAhead: 60
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
    return {
      response: {
        storeName: customerBranchDisplay,
        currency: 'USD',
        query: rawQuery,
        naturalSuggestedReply: naturalQuote || null,
        matchesFound: matches.length,
        items: matches
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
            weeklyHours: lang === 'en' ? buildCompactWeeklyHours(s.weekly_hours, 'en') : buildCompactWeeklyHours(s.weekly_hours, 'es'),
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
        const normExisting = normalizeSearchText(cbSummary)
        const uncaptured = extraUserTurns.filter((u) => {
          const tokens = normalizeSearchText(u)
            .split(' ')
            .filter((w) => w.length >= 4 && !['just', 'tell', 'them', 'this', 'that', 'with', 'solo', 'diles', 'para', 'esto'].includes(w))
          return tokens.length > 0 && !tokens.every((tok) => normExisting.includes(tok))
        })
        if (uncaptured.length > 0) {
          const addendum = `Nota adicional del cliente: ${uncaptured.join(' / ')}`.slice(0, 420)
          cbSummary = cbSummary ? `${cbSummary} | ${addendum}`.slice(0, 2000) : addendum
          await supabaseAdmin
            .from('phone_callback_requests')
            .update({ reason_summary: cbSummary })
            .eq('id', pendingCb.id)
        }
      }
      callbackInfo = {
        summary: cbSummary,
        callerName: pendingCb.caller_name,
        ticket: pendingCb.ticket_or_order_number
      }
    }
  }

  const meta = inferLiveCallSummaryAndIntent(cleanTranscript, hadCallback, unanswered, callbackInfo)

  const nextStatus = hadCallback
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
