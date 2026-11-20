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
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate, getCaliforniaShift } from '@/lib/business-date'
import {
  formatCustomerStoreName,
  getCustomerStoreCrossStreets,
  resolveCustomerStoreMeta,
  sanitizeCustomerStoreReferencesInText
} from '@/lib/customer-store-names'
import {
  KORE_BREAKFAST_CUTOFF_LABEL,
  isKoreBreakfastOpen,
  normalizeKoreCustomerSpeech
} from '@/lib/kore-shared-speech'
import { extractZipCodeFromAddress, formatStoreAddressForAgent } from '@/lib/phone-speech-format'
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
    name: 'create_manager_callback',
    behavior: 'BLOCKING',
    description:
      'Registra un Recado Prioritario para el Gerente o una Nota de Empaque (condimentos gratis) en la pantalla de la sucursal. Úsalo ÚNICAMENTE cuando ya tengas el nombre real y el teléfono real de 10 dígitos de la persona (y en reclamos de orden equivocada/incompleta en tienda o Drive-Thru también número de ticket o confirmación de SIN TICKET + fecha de compra).',
    parameters: {
      type: 'OBJECT',
      properties: {
        caller_name: {
          type: 'STRING',
          description: 'Nombre real proporcionado por la persona que llama.'
        },
        caller_phone: {
          type: 'STRING',
          description: 'Teléfono real de 10 dígitos confirmado por la persona (o "CALLER_ID" si en llamada real autorizó usar el mismo número del que llama).'
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
            'Categoría: "condiments_note", "wrong_store_order", "delivery_issue", "missing_or_wrong_item", "lost_item", "employee_callout", "vendor_arrival", "billing_refund", u "other".'
        },
        reason_summary: {
          type: 'STRING',
          description: 'Resumen completo y claro del asunto.'
        },
        ticket_or_order_number: {
          type: 'STRING',
          description: 'Número de ticket u orden (o "SIN TICKET" si el cliente confirmó que ya no conserva el ticket).'
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
      'Invócala al final cuando la consulta o recado ya quedó resuelto y el cliente se despide o confirma que no necesita nada más ("es todo, gracias", "no thanks, that is all"), justo para cerrar limpiamente la llamada después de tu frase cálida de despedida.',
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
  includeLanguageSwitchHint?: boolean
}) {
  const { storeId, lang, source, callerNumber } = params
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
    answer_es?: string | null
    answer_en?: string | null
  }>)
    .filter((k) => String(k?.category || '').toLowerCase() !== 'staff')
    .slice(0, 35)
    .map((k) => `- [${k.category}] ${k.title}: ${lang === 'en' ? k.answer_en || k.answer_es : k.answer_es || k.answer_en}`)
    .join('\n')

  const learnedLines = learnedRules
    .slice(0, 30)
    .map((r, idx) => {
      const txt = lang === 'en' ? r.ruleEn || r.ruleEs : r.ruleEs || r.ruleEn
      const kindTag = r.itemKind === 'stt_synonym' ? 'STT' : r.category.toUpperCase()
      const scope = r.storeId ? `SOLO ${customerBranchDisplay}` : 'GLOBAL'
      return `${idx + 1}. [${kindTag} - ${scope}] (${r.trigger}): ${txt}`
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
      ? `ACTIVE BASE LANGUAGE: ENGLISH. Greeted in English. Mirror the caller's spoken language immediately on every turn: if the caller speaks Spanish, answer 100% in natural Southern California Mexican Spanish; if English, answer 100% in warm American English.`
      : `IDIOMA BASE ACTIVO: ESPAÑOL. Ya saludaste en español. Espeja de inmediato el idioma real que hable la persona en cada turno: si habla en inglés, respóndele 100% en inglés natural; si habla en español, respóndele 100% en español cálido y natural del Sur de California.`

  const callbackOutcomeInstruction = scheduleEval.isOpenNow
    ? 'confirma con calidez que el gerente en turno ya recibió la alerta prioritaria en su pantalla y se comunicará en cuanto sea posible / as soon as possible (PROHIBIDO prometer "enseguida", "de inmediato", "ahorita", "right away" o "immediately").'
    : 'aclara con transparencia que como la sucursal está cerrada ahora, su recado prioritario quedó registrado en la pantalla de la tienda para que el gerente se comunique en cuanto abramos.'

  const systemText = [
    baseLangAnchor,
    '',
    `Eres Kore, la recepcionista telefónica en vivo de **Tacos Gavilan** en **${customerBranchSpoken}** (Sucursal #${store.id}${customerBranchCrossStreets ? `, esquina oficial: ${customerBranchCrossStreets}` : ''}), California, EE. UU.`,
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
    `7. MENÚ, REGULAR VS SUPER, BEBIDAS, POSTRES Y CHAROLAS:`,
    `   - Si piden varios platillos, cotiza TODOS con su precio unitario exacto del catálogo y la suma subtotal ("más impuestos" / "plus tax"), o usa \`search_menu_item_price\` si quieres verificar el cálculo.`,
    `   - PROHIBIDO decir "tamaño" o "size" en comida: burritos, quesadillas y mulitas son **Regular** o **Super** (si no especifican Super, da ambos precios Regular y Super; "Supreme/Supremo" = Super).`,
    `   - Bebidas frías (Horchata, Jamaica, Piña, Tamarindo y sodas): únicamente **Mediana de 22 onzas**, **Grande de 32 onzas** y **Galón de 128 onzas** (aguas). PROHIBIDO decir "chica", "pequeña" o "small".`,
    `   - Postres: **SOLO Flan y Cheesecake individuales**. NO vendemos pasteles de cumpleaños, churros, menudo, birria, pozole, suadero, tripa ni cerveza/alcohol.`,
    `   - Charolas Fiesta Platter: se ordenan exclusivamente en **tacosgavilan.com** con mínimo 1 hora de anticipación. Cuando pregunten precio o combinación por cantidad de personas (especialmente +40 invitados), INVOCA SIEMPRE \`get_fiesta_platter_packages\` para calcular la combinación más económica exacta.`,
    `   - Correcciones fonéticas naturales: "torta corona"="torta cubana", "sasada"/"salad burrito"="asada", "adobada"="pastor", "muleta"="mulita", "ibt"/"evt"/"tarjetas abc"="EBT", "dritro"/"driver"="Drive-Thru". Ignora ruido de TV/radio de fondo.`,
    `8. RECADOS AL GERENTE, NOTAS DE EMPAQUE Y RECLAMOS (CERO TRANSFERENCIAS TELEFÓNICAS):`,
    `   - Nunca transferimos llamadas a celulares personales. Toda atención gerencial se envía en vivo a la pantalla de la tienda con \`create_manager_callback\`.`,
    `   - **Condimentos gratis en orden existente**: pide nombre, número/código de orden, condimentos y teléfono real de 10 dígitos -> ejecuta \`create_manager_callback\` (\`reason_category: "condiments_note"\`, \`urgency: "normal"\`) aclarando que se incluyen siempre que la orden aún no haya salido.`,
    `   - **Uber Eats / DoorDash / Grubhub**: cambios con costo, dirección, cancelación o reembolso se hacen directo en la sección **Ayuda (Help)** de su app; si desean dejar aviso al gerente o lleva mucho retraso, toma nombre, teléfono de 10 dígitos y código (\`reason_category: "delivery_issue"\`).`,
    `   - **Pidió en sucursal equivocada en tacosgavilan.com**: pregunta en cuál sucursal cayó, toma nombre, teléfono de 10 dígitos y orden, y llama \`create_manager_callback\` con \`target_store_id\` de esa tienda (\`reason_category: "wrong_store_order"\`).`,
    `   - **Órdenes equivocadas o incompletas en tienda, Drive-Thru o tacosgavilan.com**: solicita SIEMPRE con respeto estos **4 datos obligatorios**: **1) número de ticket, 2) fecha de compra, 3) nombre y 4) teléfono real de 10 dígitos**, advirtiendo siempre con respeto que **sin el número de ticket es poco probable determinar la equivocación** (*"Without the ticket number, it is unlikely we can verify the mistake"*). Si confirma que perdió/tiró el ticket, envía \`ticket_or_order_number: "SIN TICKET"\` sin prometer reposición. EJECUTA \`create_manager_callback\` ANTES de confirmar al cliente, y luego ${callbackOutcomeInstruction}`,
    `   - **Objetos olvidados, empleados, proveedores o hablar con gerente**: pide nombre real y teléfono real de 10 dígitos${source === 'twilio' && callerNumber ? ` (Caller ID entrante: ${callerNumber}; si autoriza explícitamente que le marquen a este mismo número envía caller_phone="CALLER_ID")` : ''}, ejecuta \`create_manager_callback\` ANTES de confirmarlo y ${callbackOutcomeInstruction}`,
    `9. CIERRE LIMPIO DE LLAMADA: Cuando ya respondiste o registraste el recado y el cliente dice "es todo, gracias", "no gracias", "that's all, thank you" o similar, despídete cálidamente en una sola oración sin preguntas ("Con gusto. ¡Gracias por llamar a Tacos Gavilan, que tengas un excelente día!" / "You're very welcome! Thank you for calling Tacos Gavilan, have a wonderful day!") e invoca \`end_call\`.`,
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
        startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
        endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
        prefixPaddingMs: 40,
        silenceDurationMs: 320
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
}) {
  const { callSid, storeId, lang, source, callerNumber, toolName, toolArgs, recentUserTranscript = '' } = params
  const ctx = await getStorePhoneContext(storeId)
  const { store, config, scheduleEval } = ctx
  const customerBranchDisplay = formatCustomerStoreName(store, lang, { style: 'display' })

  if (toolName === 'end_call') {
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
    return {
      response: {
        currency: 'USD',
        orderChannel: 'tacosgavilan.com (mínimo 1 hora de anticipación)',
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
    const parsedCaller =
      source === 'twilio' && callerNumber && rawPhoneArg.toUpperCase() === 'CALLER_ID'
        ? extractCleanTenDigitUsPhone(callerNumber, false)
        : { valid: false, e164: null, ten: null }

    const cleanPhone =
      parsedArg.valid && parsedArg.ten && !blockedTen.has(parsedArg.ten)
        ? parsedArg.e164!
        : parsedCaller.valid && parsedCaller.ten && !blockedTen.has(parsedCaller.ten)
          ? parsedCaller.e164!
          : ''

    if (!cleanPhone) {
      return {
        response: {
          success: false,
          missingCallerPhone: true,
          message:
            'Falta un número telefónico real válido de 10 dígitos de EE. UU. Pídele amablemente su nombre y su teléfono de 10 dígitos con código de área antes de registrar el recado.'
        },
        callbackCreated: null,
        unansweredFlagged: null,
        shouldEndCall: false
      }
    }

    const callerName = String(toolArgs?.caller_name || '').trim()
    if (!callerName || /^(cliente|customer|caller|unknown|persona|usuario)$/i.test(normalizeSearchText(callerName))) {
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
    const category = validCategories.has(rawCategory) ? rawCategory : 'other'
    const rawTicket = String(toolArgs?.ticket_or_order_number || '').trim()
    const rawOrderDate = String(toolArgs?.order_date || '').trim()
    const normRecent = normalizeSearchText(`${recentUserTranscript} ${toolArgs?.reason_summary || ''}`)
    const isDeliveryOrder = /\b(uber|doordash|door dash|grubhub|postmates)\b/i.test(normRecent)

    if (category === 'missing_or_wrong_item' && !isDeliveryOrder) {
      const missingFields: string[] = []
      if (!rawTicket) missingFields.push('número de ticket (o confirmación de SIN TICKET)')
      if (!rawOrderDate) missingFields.push('fecha de compra')
      if (missingFields.length > 0) {
        return {
          response: {
            success: false,
            missingOrderReviewFields: missingFields,
            message: `Para revisar la preparación de su orden aún falta preguntar al cliente: ${missingFields.join(' y ')}. Pídeselos con respeto recordándole que sin el número de ticket es poco probable determinar la equivocación.`
          },
          callbackCreated: null,
          unansweredFlagged: null,
          shouldEndCall: false
        }
      }
    }

    // Asegurar fila de phone_calls para enlazar call_id
    let { data: callRow } = await supabaseAdmin
      .from('phone_calls')
      .select('id')
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
        .select('id')
        .single()
      callRow = insertedCall
    }

    const activeStores = await loadAllActiveStoresDirectory()
    const reqTargetId = Number(toolArgs?.target_store_id)
    const destStore =
      Number.isFinite(reqTargetId) && reqTargetId > 0
        ? activeStores.find((s) => Number(s.id) === reqTargetId) || store
        : store
    const destDisplay = formatCustomerStoreName(destStore, lang, { style: 'display' })

    const ticketFormatted =
      rawTicket && rawOrderDate && !normalizeSearchText(rawTicket).includes(normalizeSearchText(rawOrderDate))
        ? `${rawTicket} (${rawOrderDate})`
        : rawTicket || (rawOrderDate ? `SIN TICKET (${rawOrderDate})` : null)

    const baseReason = String(toolArgs?.reason_summary || 'Solicitud de llamada al gerente').trim()
    const finalSummary =
      Number(destStore.id) !== Number(store.id)
        ? `[Llamó a #${store.id} ${customerBranchDisplay} -> Enrutada a #${destStore.id} ${destDisplay}] ${baseReason}`
        : baseReason

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

    await supabaseAdmin
      .from('phone_calls')
      .update({
        status: 'callback_requested',
        resolved_by_ai: false,
        primary_intent: category
      })
      .eq('call_sid', callSid)

    return {
      response: {
        success: true,
        callbackId: created.id,
        routedToStoreId: Number(destStore.id),
        routedToStoreName: destDisplay,
        reasonCategory: category,
        storeOpenNow: scheduleEval.isOpenNow,
        message:
          category === 'condiments_note'
            ? `Nota de empaque enviada en vivo a ${destDisplay}; recuérdale amablemente que aplica siempre que su orden aún no haya salido.`
            : scheduleEval.isOpenNow
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
  unanswered: string | null
): { callerCategory: string; primaryIntent: string; summary: string } {
  const userTurns = transcript.filter((t) => t.role === 'user' && t.text.trim())
  const assistantTurns = transcript.filter((t) => t.role === 'assistant' && t.text.trim())
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

  const lastUser = userTurns[userTurns.length - 1]?.text?.trim() || ''
  const lastAssistant = assistantTurns[assistantTurns.length - 1]?.text?.trim() || ''
  const summary =
    userTurns.length === 0
      ? 'Llamada finalizada durante el saludo inicial (Kore 3.8 Live).'
      : `${lastUser.slice(0, 140)} -> ${lastAssistant.slice(0, 180)}`

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
  const meta = inferLiveCallSummaryAndIntent(cleanTranscript, hadCallback, unanswered)

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
