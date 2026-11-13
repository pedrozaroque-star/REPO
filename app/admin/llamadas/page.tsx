/**
 * @module app/admin/llamadas/page
 * @description Centro de Control de la Contestadora IA Multi-Sucursal (15 Tiendas) de Tacos Gavilan (`/admin/llamadas`).
 * Incluye:
 * 1. Simulador Interactivo de Llamada en Vivo con micrófono (barge-in real) y voz neuronal `Kore` en streaming PCM 24kHz.
 * 2. Base de Conocimiento Editable en tiempo real (`phone_knowledge_base`) global o por sucursal + Detector Automático de
 *    Preguntas Nuevas (con opción de convertir en regla o descartar) + Días Festivos (`phone_special_hours` crear/editar/borrar).
 * 3. Configuración avanzada de las 15 Sucursales (idioma inicial, transferencia en vivo, segundos de timbrado, EBT, voz,
 *    estacionamiento y saludo personalizado) y Asistente de Desvío Condicional para Spectrum Business y AT&T Android.
 * 4. Bitácora de Llamadas (`phone_calls`) con filtro de origen (Twilio Real vs Simulador) y reproducción de voz bajo demanda,
 *    más Panel de Recados Prioritarios (`phone_callback_requests`) con notas de resolución.
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
 * - UI `/admin/llamadas` -> `/api/phone/dashboard` (GET/POST/PATCH/DELETE con polling autenticado) &
 *   `/api/phone/simulate` (POST NDJSON PCM stream) & `/api/phone/tts` (POST WAV replay).
 *
 * @notes
 * - Con RLS estricto habilitado en todas las tablas `phone_*`, la actualización automática se realiza mediante polling
 *   HTTP autenticado cada 12s (y al recuperar foco/red) en lugar de suscripciones `anon` de Supabase Realtime.
 * - Incluye respaldo automático de síntesis de voz femenina del navegador (con filtro estricto anti-Raul).
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { useLanguage } from '@/lib/i18n'
import { normalizeTextForPhoneSpeech, pickStrictFemaleBrowserVoice } from '@/lib/phone-speech-format'
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
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
  ShieldCheck
} from 'lucide-react'

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
  deactivateNoAnswerCode: string
  activateBusyCode: string
  deactivateBusyCode: string
  activateUnreachableCode?: string
  deactivateAllCode: string
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

function computeClientForwardingGuide(
  carrierType: 'spectrum_landline' | 'att_wireless',
  rawTwilioNumber: string | null | undefined,
  ringSeconds = 20
): ForwardingGuide {
  const digits = String(rawTwilioNumber || '').replace(/\D/g, '')
  const tenDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const hasValidTwilioNumber = tenDigits.length === 10
  const target10Es = hasValidTwilioNumber ? tenDigits : 'TU_NUMERO_TWILIO'
  const target10En = hasValidTwilioNumber ? tenDigits : 'TWILIO_NUMBER'
  const clampedSec = Math.min(30, Math.max(5, Math.round(ringSeconds / 5) * 5))

  if (carrierType === 'spectrum_landline') {
    return {
      carrierLabelEs: 'Spectrum Business Voice (Línea Fija)',
      carrierLabelEn: 'Spectrum Business Voice (Landline)',
      hasValidTwilioNumber,
      activateNoAnswerCode: `*92${target10Es}`,
      deactivateNoAnswerCode: '*93',
      activateBusyCode: `*90${target10Es}`,
      deactivateBusyCode: '*91',
      deactivateAllCode: '*93 y *91',
      stepsEs: [
        '1. Levanta el auricular del teléfono fijo de la sucursal y espera tono.',
        `2. Marca *92${target10Es} (o *71${target10Es}) y espera el tono de confirmación para activar desvío cuando nadie conteste.`,
        `3. Cuelga, vuelve a levantar y marca *90${target10Es} para desviar también si la línea está ocupada.`,
        '4. Opcional desde oficina: entra a voice.spectrum.com -> Call Forwarding -> "When Busy or No Answer" -> ingresa el número Twilio.'
      ],
      stepsEn: [
        '1. Pick up the store landline handset and wait for a dial tone.',
        `2. Dial *92${target10En} (or *71${target10En}) and wait for confirmation tone to forward when unanswered.`,
        `3. Hang up, pick up again, and dial *90${target10En} to also forward when the line is busy.`,
        '4. Optional remote setup: log into voice.spectrum.com -> Call Forwarding -> "When Busy or No Answer".'
      ],
      gotchaEs:
        'Importante: Desactiva el Buzón de Voz de Spectrum (Voice Portal) o ponlo en más de 5 timbrazos para que no gane la llamada antes que la IA.',
      gotchaEn:
        'Important: Disable Spectrum Voicemail or set rings higher so voicemail does not intercept before the AI.'
    }
  }

  return {
    carrierLabelEs: 'Celular Android con AT&T Wireless',
    carrierLabelEn: 'Android Cellphone on AT&T Wireless',
    hasValidTwilioNumber,
    activateNoAnswerCode: `**61*+1${target10Es}**${clampedSec}#`,
    deactivateNoAnswerCode: '##61#',
    activateBusyCode: `**67*+1${target10Es}#`,
    deactivateBusyCode: '##67#',
    activateUnreachableCode: `**62*+1${target10Es}#`,
    deactivateAllCode: '##002#',
    stepsEs: [
      '1. En el celular Android de la tienda, desactiva temporalmente "Llamadas Wi-Fi" (Wi-Fi Calling) para que AT&T acepte códigos GSM.',
      `2. Abre el teclado de llamadas y marca **61*+1${target10Es}**${clampedSec}# y presiona Llamar (desvía a la IA tras ${clampedSec}s sin contestar).`,
      `3. Marca **67*+1${target10Es}# y presiona Llamar (desvía a la IA si rechazan la llamada o la línea está ocupada).`,
      `4. Marca **62*+1${target10Es}# y presiona Llamar (desvía a la IA si el celular se descarga o pierde señal).`,
      '5. Vuelve a activar Wi-Fi Calling si la sucursal lo utiliza.'
    ],
    stepsEn: [
      '1. On the store Android phone, temporarily turn OFF Wi-Fi Calling so AT&T accepts GSM star codes.',
      `2. Open the Phone dialer, type **61*+1${target10En}**${clampedSec}# and tap Call (forwards to AI after ${clampedSec}s unanswered).`,
      `3. Dial **67*+1${target10En}# and tap Call (forwards to AI when busy or declined).`,
      `4. Dial **62*+1${target10En}# and tap Call (forwards to AI if battery dies or out of signal).`,
      '5. Re-enable Wi-Fi Calling if needed.'
    ],
    gotchaEs:
      'Si AT&T muestra "MMI Code Error" con Wi-Fi apagado, abre Teléfono -> Ajustes -> Servicios Suplementarios -> Desvío de llamadas y edita las 3 opciones manualmente.',
    gotchaEn:
      'If AT&T shows "MMI Code Error" with Wi-Fi off, open Phone -> Settings -> Supplementary Services -> Call Forwarding and set the 3 conditional fields manually.'
  }
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
    labelEs: '🚫 Platillos que NO vendemos: ¿Tienen menudo, birria o cerveza?',
    labelEn: '🚫 Items we DO NOT sell: Do you have menudo, birria, or beer?',
    textEs: 'Oye, una pregunta rápida: ¿venden menudo los domingos, birria o cerveza michelada en esta sucursal?',
    textEn: 'Quick question: do you guys sell menudo on Sundays, birria, or beer and micheladas at this location?'
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
    labelEs: '🚨 Orden incompleta: Faltaron 3 tacos en mi orden (Recado Simulador)',
    labelEn: '🚨 Missing items: 3 tacos missing from my order (Simulator Callback)',
    textEs: 'Acabo de pasar hace 10 minutos por mi orden ticket #148 y al llegar a mi casa vi que me faltaron 3 tacos de asada. Me llamo Roberto Gómez y mi teléfono es 323-555-0144, necesito que me llame el gerente.',
    textEn: 'I just picked up my order ticket #148 10 minutes ago and when I got home I noticed 3 Carne Asada tacos were missing. My name is Roberto Gomez and my phone is 323-555-0144, please have the manager call me.'
  },
  {
    id: 'double_charge',
    group: 'issues',
    labelEs: '💸 Cobro duplicado en tarjeta hace 15 min (Recado Simulador)',
    labelEn: '💸 Duplicate card charge 15 mins ago (Simulator Callback)',
    textEs: 'Pagué hace 15 minutos en caja y en la app de mi banco me aparece cobrado dos veces por $28.40. Soy Laura Méndez, mi celular es 323-555-0192, por favor que me marque el gerente.',
    textEn: 'I paid at the register 15 minutes ago and my banking app shows two charges of $28.40. My name is Laura Mendez, my cell is 323-555-0192, please have the manager call me.'
  },
  {
    id: 'lost_item',
    group: 'issues',
    labelEs: '👛 Objeto olvidado: Dejé mi cartera en una mesa (Recado Simulador)',
    labelEn: '👛 Lost & Found: Left my wallet at a table (Simulator Callback)',
    textEs: 'Estuve cenando hace media hora ahí en el comedor y creo que dejé olvidada mi cartera café en la mesa. Me llamo Daniel Ortiz y mi número es 562-555-0163, ¿le puedes avisar urgente al gerente?',
    textEn: 'I was dining there half an hour ago and I think I left my brown wallet on the table. My name is Daniel Ortiz and my number is 562-555-0163, can you urgently alert the manager?'
  },
  {
    id: 'delivery_customer_issue',
    group: 'issues',
    labelEs: '📱 Cliente de Uber Eats: Pedido llegó incompleto (Recado Simulador)',
    labelEn: '📱 Uber Eats customer: Order arrived missing drinks (Simulator Callback)',
    textEs: 'Pedí a domicilio por Uber Eats y el repartidor me entregó la bolsa sellada pero no venían mis dos aguas de horchata. Soy Sofía Lara, 213-555-0175, ¿me ayuda el gerente?',
    textEn: 'I ordered delivery on Uber Eats and the sealed bag arrived without my two large Horchatas. My name is Sofia Lara, 213-555-0175, can the manager help me?'
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
    textEs: 'Hola, soy Juan Hernández de la estación de parrilla, voy a llegar 20 minutos tarde al turno porque hay un accidente en el freeway. Mi celular es 562-555-0188, avísale al gerente por favor.',
    textEn: 'Hi, this is Juan Hernandez from the grill station, I am going to be 20 minutes late for my shift due to a freeway accident. My cell is 562-555-0188, please notify the manager.'
  },
  {
    id: 'vendor_arrival',
    group: 'staff',
    labelEs: '🔧 Técnico de refrigeración afuera de sucursal (Recado Simulador)',
    labelEn: '🔧 Refrigeration technician outside store (Simulator Callback)',
    textEs: 'Hablo de servicio técnico de refrigeración, ya estoy afuera de la tienda para revisar el cuarto frío. Soy Marcos Vega, 714-555-0139, avísale al gerente que me abra por favor.',
    textEn: 'This is Marcos Vega from refrigeration service, I am outside the store to inspect the walk-in cooler. My number is 714-555-0139, please let the manager on duty know.'
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
    textEs: 'Oigan, ¿permiten llevar nuestro propio pastel de cumpleaños al comedor o tienen convenio de descuento para escuelas?',
    textEn: 'Hey, do you allow bringing our own birthday cake into the dining room, or do you offer school discount partnerships?'
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

  const [activeTab, setActiveTab] = useState<'simulator' | 'knowledge' | 'stores' | 'calls'>('simulator')
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState<ViewerInfo | null>(null)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeRule[]>([])
  const [specialHours, setSpecialHours] = useState<SpecialHourRow[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [callbacks, setCallbacks] = useState<CallbackRow[]>([])
  const [unansweredQuestions, setUnansweredQuestions] = useState<any[]>([])
  const [kpis, setKpis] = useState({
    totalCalls: 0,
    realCallsCount: 0,
    simulatorCallsCount: 0,
    evaluatedCallsCount: 0,
    resolvedByAiCount: 0,
    realResolvedByAiCount: 0,
    resolvedByAiPct: 100,
    pendingCallbacksCount: 0,
    pendingSimulatorCallbacksCount: 0,
    estimatedCashierMinutesSaved: 0,
    activeStoresCount: 15,
    verifiedForwardingCount: 0
  })

  const [feedbackBanner, setFeedbackBanner] = useState<{
    kind: 'ok' | 'err'
    text: string
  } | null>(null)

  // Simulator state
  const [simStoreId, setSimStoreId] = useState<number>(14)
  const [simLang, setSimLang] = useState<'es' | 'en'>('es')
  const [simActive, setSimActive] = useState(false)
  const [simCallSid, setSimCallSid] = useState<string | null>(null)
  const [simBusy, setSimBusy] = useState(false)
  const [simSpeaking, setSimSpeaking] = useState(false)
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
  const nextPlayTimeRef = useRef<number>(0)
  const streamAbortRef = useRef<AbortController | null>(null)
  const recognitionRef = useRef<any>(null)
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const fetchSeqRef = useRef(0)
  const dirtyStoreIdsRef = useRef<Set<number>>(new Set())
  const simStoreIdRef = useRef<number>(simStoreId)
  simStoreIdRef.current = simStoreId
  const simCallSidRef = useRef<string | null>(simCallSid)
  simCallSidRef.current = simCallSid

  // Knowledge Base Editor state
  const [editingRule, setEditingRule] = useState<Partial<KnowledgeRule> | null>(null)
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
  const [savingStoreId, setSavingStoreId] = useState<number | null>(null)
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)
  const [deletingHolidayId, setDeletingHolidayId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Calls & Callbacks filter (decoupled from global KPIs)
  const [callsFilterStoreId, setCallsFilterStoreId] = useState<string>('all')
  const [callsFilterSource, setCallsFilterSource] = useState<'all' | 'twilio' | 'simulator'>('all')
  const [selectedCallDetail, setSelectedCallDetail] = useState<CallRow | null>(null)
  const [callbackNotes, setCallbackNotes] = useState<Record<string, string>>({})
  const [replayingMsgIdx, setReplayingMsgIdx] = useState<number | null>(null)

  const isGlobalAdmin = viewer ? viewer.isGlobalAdmin : false

  const showFeedback = useCallback((kind: 'ok' | 'err', text: string) => {
    setFeedbackBanner({ kind, text })
    setTimeout(() => {
      setFeedbackBanner((prev) => (prev?.text === text ? null : prev))
    }, 5000)
  }, [])

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, [])

  const stopMicrophone = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.onend = null
        recognitionRef.current.abort?.()
        recognitionRef.current.stop?.()
      } catch {}
      recognitionRef.current = null
    }
    setSimListening(false)
  }, [])

  const fetchDashboard = useCallback(
    async (silent = false) => {
      const seq = ++fetchSeqRef.current
      if (!silent) setLoading(true)
      try {
        const params = new URLSearchParams({
          callsStoreId: callsFilterStoreId,
          callsSource: callsFilterSource
        })
        const res = await fetch(`/api/phone/dashboard?${params.toString()}`, {
          headers: getAuthHeaders(),
          cache: 'no-store'
        })
        if (!res.ok) {
          if (!silent) showFeedback('err', t('phone_agent.dashboard_load_error'))
          return
        }
        const data = await res.json()
        if (seq !== fetchSeqRef.current) return
        const loadedStores: StoreRow[] = data.stores || []
        setStores((prev) => {
          if (dirtyStoreIdsRef.current.size === 0 || prev.length === 0) return loadedStores
          const prevById = new Map(prev.map((s) => [s.id, s]))
          return loadedStores.map((incoming) => {
            if (dirtyStoreIdsRef.current.has(incoming.id)) {
              const localEdited = prevById.get(incoming.id)
              if (localEdited) {
                return { ...incoming, config: localEdited.config }
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
            setCallsFilterStoreId((prev) =>
              prev !== 'all' && loadedStores.some((s) => String(s.id) === prev)
                ? prev
                : String(loadedStores[0].id)
            )
          }
        }
        setKnowledgeBase(data.knowledgeBase || [])
        setSpecialHours(data.specialHours || [])
        setCalls(data.calls || [])
        setCallbacks(data.callbacks || [])
        setUnansweredQuestions(data.unansweredQuestions || [])
        if (data.kpis) {
          setKpis((prev) => ({ ...prev, ...data.kpis }))
        }
      } catch (e) {
        console.error('[ContestadoraIA] Error cargando datos:', e)
        if (!silent) showFeedback('err', t('phone_agent.dashboard_load_error'))
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoading(false)
        }
      }
    },
    [callsFilterStoreId, callsFilterSource, getAuthHeaders, showFeedback, t]
  )

  useEffect(() => {
    void fetchDashboard(false)
  }, [fetchDashboard])

  // Si un usuario de sucursal intenta quedar en pestañas exclusivas de admin global, redirigir a Simulador
  useEffect(() => {
    if (viewer && !viewer.isGlobalAdmin && (activeTab === 'knowledge' || activeTab === 'stores')) {
      setActiveTab('simulator')
    }
  }, [viewer, activeTab])

  // Polling autenticado silencioso cada 12s + recarga al volver a la pestaña o recuperar red
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchDashboard(true)
      }
    }, 12000)

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
  }, [simTranscript, simBusy])

  const ensureUnlockedAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (typeof window === 'undefined') return null
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return null
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])

  const playPhoneRingTone = useCallback(async () => {
    try {
      const ctx = ensureUnlockedAudioCtx()
      if (!ctx) return
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
        osc1.start(startTime)
        osc2.start(startTime)
        osc1.stop(startTime + duration)
        osc2.stop(startTime + duration)
      }
      playBurst(ctx.currentTime, 0.28)
      await new Promise((r) => setTimeout(r, 340))
    } catch {
      // Ignore audio context restrictions
    }
  }, [ensureUnlockedAudioCtx])

  const speakWithFemaleBrowserVoice = useCallback((text: string, lang: 'es' | 'en') => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSimSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    const preferredFemale = pickStrictFemaleBrowserVoice(window.speechSynthesis.getVoices(), lang)
    // PROHIBICIÓN ABSOLUTA DE VOZ MASCULINA: si el sistema operativo (ej. Windows sin voz femenina en español)
    // no tiene una voz femenina explícitamente verificada, NO invocar `speechSynthesis.speak`, ya que Windows
    // usaría por defecto `Microsoft David` (masculina).
    if (!preferredFemale) {
      setSimSpeaking(false)
      return
    }
    const utter = new SpeechSynthesisUtterance(normalizeTextForPhoneSpeech(text, lang))
    utter.lang = preferredFemale.lang || (lang === 'en' ? 'en-US' : 'es-MX')
    utter.rate = 1.04
    utter.voice = preferredFemale
    setSimSpeaking(true)
    utter.onend = () => setSimSpeaking(false)
    utter.onerror = () => setSimSpeaking(false)
    window.speechSynthesis.speak(utter)
  }, [])

  const stopAllSimAudio = useCallback((abortStream = false) => {
    if (abortStream && streamAbortRef.current) {
      try {
        streamAbortRef.current.abort()
      } catch {}
      streamAbortRef.current = null
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null
        activeSourceRef.current.stop()
      } catch {}
      activeSourceRef.current = null
    }
    if (scheduledSourcesRef.current.length > 0) {
      for (const src of scheduledSourcesRef.current) {
        try {
          src.onended = null
          src.stop()
        } catch {}
      }
      scheduledSourcesRef.current = []
    }
    nextPlayTimeRef.current = 0
    if (audioRef.current) {
      audioRef.current.pause()
    }
    if (nextAudioRef.current) {
      nextAudioRef.current.pause()
      nextAudioRef.current = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSimSpeaking(false)
  }, [])

  // Limpiar audio y micrófono al desmontar la página o cambiar de pestaña
  useEffect(() => {
    if (activeTab !== 'simulator') {
      stopMicrophone()
    }
  }, [activeTab, stopMicrophone])

  useEffect(() => {
    return () => {
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
      const ctx = ensureUnlockedAudioCtx()
      let streamFinished = false
      let playedAny = false
      let isFirstChunk = true
      let completedNotified = false

      const notifyDoneOnce = () => {
        if (!completedNotified) {
          completedNotified = true
          onPlaybackComplete?.()
        }
      }

      const pushPcmBase64 = (pcmBase64: string, sampleRate = 24000) => {
        if (!ctx || !pcmBase64) return
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
        }
        const binary = window.atob(pcmBase64)
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

        if (isFirstChunk) {
          isFirstChunk = false
          const fadeSamples = Math.min(64, sampleCount)
          for (let i = 0; i < fadeSamples; i++) {
            floats[i] *= i / fadeSamples
          }
        }

        const audioBuf = ctx.createBuffer(1, sampleCount, sampleRate)
        audioBuf.getChannelData(0).set(floats)

        const source = ctx.createBufferSource()
        source.buffer = audioBuf
        source.connect(ctx.destination)

        const startAt = Math.max(ctx.currentTime + 0.035, nextPlayTimeRef.current)
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
          if (streamFinished && scheduledSourcesRef.current.length === 0) {
            setSimSpeaking(false)
            notifyDoneOnce()
          }
        }

        source.start(startAt)
      }

      const finish = () => {
        streamFinished = true
        if (!playedAny || scheduledSourcesRef.current.length === 0) {
          setSimSpeaking(false)
          if (playedAny) notifyDoneOnce()
        }
      }

      return {
        pushPcmBase64,
        finish,
        hasPlayedAny: () => playedAny
      }
    },
    [ensureUnlockedAudioCtx, stopAllSimAudio]
  )

  // Pre-calentar en RAM el contexto, menú en vivo y saludo al cambiar de tienda o idioma
  const hasSimStoreLoaded = stores.some((s) => s.id === simStoreId)
  useEffect(() => {
    if (loading || activeTab !== 'simulator' || !hasSimStoreLoaded) return
    const ctrl = new AbortController()
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
    return () => ctrl.abort()
  }, [loading, activeTab, simStoreId, simLang, hasSimStoreLoaded, getAuthHeaders])

  const playVoiceUrl = useCallback(
    async (
      primarySrc: string,
      fallbackText: string,
      lang: 'es' | 'en',
      nextAudioUrl?: string | null,
      onComplete?: () => void
    ) => {
      try {
        stopAllSimAudio(false)
        setSimSpeaking(true)
        const ctx = ensureUnlockedAudioCtx()

        const fetchAndDecode = async (src: string, retryViaAuthPost = false): Promise<AudioBuffer | null> => {
          if (!ctx) return null
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await fetch(src)
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const arrayBuf = await res.arrayBuffer()
              if (arrayBuf.byteLength <= 44) throw new Error('Empty WAV')
              return await ctx.decodeAudioData(arrayBuf.slice(0))
            } catch {
              if (attempt === 0) await new Promise((r) => setTimeout(r, 250))
            }
          }
          if (retryViaAuthPost && fallbackText && !src.startsWith('blob:')) {
            try {
              const postRes = await fetch('/api/phone/tts', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ text: fallbackText, lang, voice: 'Kore' })
              })
              if (postRes.ok) {
                const arrayBuf = await postRes.arrayBuffer()
                if (arrayBuf.byteLength > 44) {
                  return await ctx.decodeAudioData(arrayBuf.slice(0))
                }
              }
            } catch {
              // Ignore and fall through
            }
          }
          return null
        }

        if (ctx) {
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {})
          }
          const nextBufferPromise = nextAudioUrl ? fetchAndDecode(nextAudioUrl, false) : Promise.resolve(null)
          const firstBuffer = await fetchAndDecode(primarySrc, true)

          if (firstBuffer && ctx.state === 'running') {
            const playBuffer = (buf: AudioBuffer): Promise<void> =>
              new Promise((resolve) => {
                const source = ctx.createBufferSource()
                source.buffer = buf
                source.connect(ctx.destination)
                activeSourceRef.current = source
                source.onended = () => {
                  if (activeSourceRef.current === source) {
                    activeSourceRef.current = null
                  }
                  resolve()
                }
                source.start(0)
              })

            await playBuffer(firstBuffer)
            const nextBuffer = await nextBufferPromise
            if (nextBuffer) {
              await playBuffer(nextBuffer)
            }
            setSimSpeaking(false)
            onComplete?.()
            return
          }
        }

        await new Promise<void>((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            setSimSpeaking(false)
            onComplete?.()
            resolve()
          }
          const audio = new Audio(primarySrc)
          audioRef.current = audio
          let preloadedNext: HTMLAudioElement | null = null
          if (nextAudioUrl) {
            preloadedNext = new Audio(nextAudioUrl)
            preloadedNext.preload = 'auto'
            nextAudioRef.current = preloadedNext
          }

          audio.onended = () => {
            if (preloadedNext) {
              audioRef.current = preloadedNext
              preloadedNext.onended = finish
              preloadedNext.onerror = finish
              preloadedNext.play().catch(finish)
            } else {
              finish()
            }
          }
          audio.onerror = () => {
            speakWithFemaleBrowserVoice(fallbackText, lang)
            finish()
          }
          audio.play().catch(() => {
            speakWithFemaleBrowserVoice(fallbackText, lang)
            finish()
          })
        })
      } catch {
        setSimSpeaking(false)
        onComplete?.()
      }
    },
    [ensureUnlockedAudioCtx, getAuthHeaders, speakWithFemaleBrowserVoice, stopAllSimAudio]
  )

  const handleStartSimCall = async () => {
    ensureUnlockedAudioCtx()
    stopMicrophone()
    stopAllSimAudio(true)
    setSimErrorBanner(null)
    setSimAutoEndedNotice(false)
    setSimTransferPhone(null)
    setSimBusy(true)
    setSimLastTools([])
    setSimLastCallback(null)

    const abortCtrl = new AbortController()
    streamAbortRef.current = abortCtrl
    const clickStart = performance.now()

    try {
      const [, res] = await Promise.all([
        playPhoneRingTone(),
        fetch('/api/phone/simulate', {
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
      ])

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || t('phone_agent.sim_error_start'))
      }

      const pcmPlayer = createPcmStreamPlayer()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let ndjsonBuf = ''
      let startMeta: any = null
      let clientFirstAudioMs: number | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        ndjsonBuf += decoder.decode(value, { stream: true })
        const lines = ndjsonBuf.split('\n')
        ndjsonBuf = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const evt = JSON.parse(line)
          if (evt.type === 'start_meta') {
            startMeta = evt
            setSimCallSid(evt.callSid)
            setSimActive(true)
            setSimBusy(false)
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
            if (clientFirstAudioMs === undefined) {
              clientFirstAudioMs = Math.round(performance.now() - clickStart)
            }
            pcmPlayer.pushPcmBase64(evt.pcmBase64, evt.sampleRate || 24000)
          } else if (evt.type === 'done') {
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
      }

      pcmPlayer.finish()
      if (startMeta && !pcmPlayer.hasPlayedAny() && startMeta.audioUrl) {
        void playVoiceUrl(startMeta.audioUrl, startMeta.greetingText, startMeta.language, null)
      }
      void fetchDashboard(true)
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setSimErrorBanner(e.message || t('phone_agent.sim_error_start'))
      }
    } finally {
      setSimBusy(false)
    }
  }

  const handleEndSimCall = async () => {
    stopMicrophone()
    stopAllSimAudio(true)
    const closingSid = simCallSid
    setSimActive(false)
    setSimCallSid(null)
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
    if (!message || simBusy) return

    ensureUnlockedAudioCtx()
    stopMicrophone()
    stopAllSimAudio(true)
    setSimErrorBanner(null)
    setSimAutoEndedNotice(false)
    setSimInput('')
    setSimBusy(true)

    let activeSid = simCallSid
    if (!simActive || !activeSid) {
      activeSid = `SIM_${simStoreId}_${Date.now()}`
      setSimCallSid(activeSid)
      setSimActive(true)
    }

    setSimTranscript((prev) => [
      ...prev,
      { role: 'user', text: message, timestamp: new Date().toISOString() }
    ])

    const abortCtrl = new AbortController()
    streamAbortRef.current = abortCtrl
    const turnStart = performance.now()
    let shouldAutoHangup = false

    const finalizeAutoHangupIfNeeded = () => {
      if (shouldAutoHangup) {
        setSimActive(false)
        setSimCallSid(null)
        setSimAutoEndedNotice(true)
      }
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

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || t('phone_agent.sim_error_turn'))
      }

      const pcmPlayer = createPcmStreamPlayer(() => finalizeAutoHangupIfNeeded())
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let ndjsonBuf = ''
      let turnMeta: any = null
      let assistantMsgTimestamp = ''
      let clientFirstAudioMs: number | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        ndjsonBuf += decoder.decode(value, { stream: true })
        const lines = ndjsonBuf.split('\n')
        ndjsonBuf = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const evt = JSON.parse(line)

          if (evt.type === 'turn_meta') {
            turnMeta = evt
            shouldAutoHangup = Boolean(evt.shouldHangup || evt.shouldTransferToPhone)
            assistantMsgTimestamp = new Date().toISOString()
            setSimBusy(false)
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
            if (clientFirstAudioMs === undefined) {
              clientFirstAudioMs = Math.round(performance.now() - turnStart)
            }
            pcmPlayer.pushPcmBase64(evt.pcmBase64, evt.sampleRate || 24000)
          } else if (evt.type === 'done') {
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
      }

      pcmPlayer.finish()
      if (turnMeta && !pcmPlayer.hasPlayedAny()) {
        if (turnMeta.audioUrl) {
          void playVoiceUrl(
            turnMeta.audioUrl,
            turnMeta.replyText,
            turnMeta.language,
            null,
            finalizeAutoHangupIfNeeded
          )
        } else {
          finalizeAutoHangupIfNeeded()
        }
      }
      void fetchDashboard(true)
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setSimErrorBanner(e.message || t('phone_agent.sim_error_turn'))
      }
    } finally {
      setSimBusy(false)
    }
  }

  const toggleMicrophone = () => {
    if (simListening && recognitionRef.current) {
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

    // Barge-in real: silenciar cualquier audio de la IA antes de abrir el micrófono para que no se transcriba a sí misma
    stopAllSimAudio(true)
    setSimErrorBanner(null)

    const rec = new SpeechRec()
    rec.lang = simLang === 'en' ? 'en-US' : 'es-MX'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onstart = () => setSimListening(true)
    rec.onend = () => setSimListening(false)
    rec.onerror = (ev: any) => {
      setSimListening(false)
      const errCode = String(ev?.error || '')
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setSimErrorBanner(t('phone_agent.sim_mic_denied'))
      } else if (errCode === 'no-speech') {
        setSimErrorBanner(t('phone_agent.sim_mic_no_speech'))
      }
    }
    rec.onresult = (event: any) => {
      const transcriptText = event?.results?.[0]?.[0]?.transcript
      if (transcriptText) {
        void handleSendSimTurn(transcriptText)
      }
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      setSimListening(false)
    }
  }

  // Reproducir cualquier mensaje de la asistente desde la Bitácora de Llamadas (Tab 4)
  const handleReplayTranscriptTurn = async (
    text: string,
    langStr: string,
    storeId: number,
    idx: number
  ) => {
    if (!text.trim() || replayingMsgIdx !== null) return
    setReplayingMsgIdx(idx)
    const callLang: 'es' | 'en' = String(langStr || '').toLowerCase() === 'en' ? 'en' : 'es'
    const msgLang: 'es' | 'en' =
      /[¿¡áéíóúñ]|(\b(gracias|hola|abierto|cerrado|tienda|sucursal|precio|cuesta|tacos)\b)/i.test(text)
        ? 'es'
        : /\b(thank you|we are|open|closed|price|how can i|tacos gavilan|address|dollars)\b/i.test(text)
          ? 'en'
          : callLang
    const storeVoice = stores.find((s) => s.id === storeId)?.config.voice_id || 'Kore'
    let blobUrl: string | null = null
    try {
      ensureUnlockedAudioCtx()
      const res = await fetch('/api/phone/tts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          text,
          lang: msgLang,
          voice: storeVoice
        })
      })
      if (!res.ok) throw new Error('TTS failed')
      const blob = await res.blob()
      blobUrl = URL.createObjectURL(blob)
      await playVoiceUrl(blobUrl, text, msgLang, null)
    } catch {
      speakWithFemaleBrowserVoice(text, msgLang)
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      setReplayingMsgIdx(null)
    }
  }

  // Knowledge Base handlers
  const handleSaveKnowledgeRule = async () => {
    if (!editingRule?.title || !editingRule?.answer_es) return
    setSavingRule(true)
    try {
      const isEdit = Boolean(editingRule.id)
      const res = await fetch('/api/phone/dashboard', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'knowledge_base',
          ...editingRule,
          priority: Number(editingRule.priority ?? 80),
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
      setSavingRule(false)
    }
  }

  const handleDismissUnanswered = async (callId: string) => {
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
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    }
  }

  const handleToggleRuleActive = async (rule: KnowledgeRule) => {
    if (togglingRuleId === rule.id) return
    setTogglingRuleId(rule.id)
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
      setTogglingRuleId(null)
    }
  }

  const handleDeleteRule = async (id: string) => {
    if (deletingRuleId === id) return
    if (typeof window !== 'undefined' && !window.confirm(t('phone_agent.kb_confirm_delete_rule'))) {
      return
    }
    setDeletingRuleId(id)
    try {
      const res = await fetch(`/api/phone/dashboard?entity=knowledge_base&id=${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      setDeletingRuleId(null)
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

  const handleSaveHoliday = async () => {
    if (!newHoliday.event_date || !newHoliday.holiday_name.trim()) return
    const isClosed = newHoliday.mode === 'closed'
    const openTime =
      newHoliday.mode === 'late_open' || newHoliday.mode === 'custom' ? newHoliday.open_time : null
    const closeTime =
      newHoliday.mode === 'early_close' || newHoliday.mode === 'custom' ? newHoliday.close_time : null

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
    if (deletingHolidayId === id) return
    if (typeof window !== 'undefined' && !window.confirm(t('phone_agent.holidays_confirm_delete'))) {
      return
    }
    setDeletingHolidayId(id)
    try {
      const res = await fetch(`/api/phone/dashboard?entity=special_hours&id=${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      if (editingHolidayId === id) {
        setEditingHolidayId(null)
      }
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    } finally {
      setDeletingHolidayId(null)
    }
  }

  // Store Config handler
  const handleSaveStoreConfig = async (
    storeRow: StoreRow,
    customUpdates?: Record<string, any>
  ): Promise<boolean> => {
    setSavingStoreId(storeRow.id)
    try {
      const payload = {
        entity: 'store_config',
        ...storeRow.config,
        store_id: storeRow.id,
        ...(customUpdates || {})
      }
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error')
      }
      dirtyStoreIdsRef.current.delete(storeRow.id)
      showFeedback('ok', `#${storeRow.id} ${storeRow.name}: ${t('phone_agent.stores_saved_ok')}`)
      await fetchDashboard(true)
      return true
    } catch (e: any) {
      showFeedback('err', e.message)
      return false
    } finally {
      setSavingStoreId(null)
    }
  }

  const updateLocalStoreConfig = (storeId: number, field: string, value: any) => {
    dirtyStoreIdsRef.current.add(storeId)
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, config: { ...s.config, [field]: value } } : s))
    )
  }

  const handleResolveCallback = async (cb: CallbackRow) => {
    try {
      const note = (callbackNotes[cb.id] || '').trim()
      const res = await fetch('/api/phone/dashboard', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          entity: 'callback_request',
          id: cb.id,
          status: 'resolved',
          ...(note ? { resolution_notes: note } : {})
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('phone_agent.banner_resolve_error'))
      }
      setCallbackNotes((prev) => {
        const next = { ...prev }
        delete next[cb.id]
        return next
      })
      await fetchDashboard(true)
    } catch (e: any) {
      showFeedback('err', e.message)
    }
  }

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
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
      'complaint_missing_item',
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
      'general'
    ])
    return knownIntents.has(norm) ? t(`phone_agent.intent_${norm}`) : intent
  }

  const currentSimStore = stores.find((s) => s.id === simStoreId) || stores[0]
  const selectedStoreForForwarding =
    selectedStoreIdForForwarding !== null
      ? stores.find((s) => s.id === selectedStoreIdForForwarding) || null
      : null
  const liveForwardingGuide = selectedStoreForForwarding
    ? computeClientForwardingGuide(
        selectedStoreForForwarding.config.carrier_type,
        selectedStoreForForwarding.config.twilio_phone_number,
        selectedStoreForForwarding.config.ring_timeout_seconds || 20
      )
    : null
  const filteredKnowledge = knowledgeBase.filter(
    (k) => kbFilterCategory === 'all' || k.category === kbFilterCategory
  )

  return (
    <ProtectedRoute
      allowedRoles={[
        'admin',
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
            className={`fixed top-4 right-4 z-[60] max-w-md rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-xs font-bold shadow-xl ${
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
                {kpis.activeStoresCount} / {stores.length || 15}
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
                        setSimTranscript([])
                        setSimLastTools([])
                        setSimLastCallback(null)
                        setSimTransferPhone(null)
                        setSimAutoEndedNotice(false)
                        setSimErrorBanner(null)
                        setSimStoreId(nextId)
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
                          currentSimStore.scheduleEval.isOpenNow
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {currentSimStore.scheduleEval.isOpenNow
                          ? t('phone_agent.sim_open_now')
                          : t('phone_agent.sim_closed_now')}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      Tacos Gavilan — {currentSimStore.name} ({currentSimStore.phone})
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      📍 {currentSimStore.address}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      🕐{' '}
                      {isEn
                        ? currentSimStore.scheduleEval.statusMessageEn
                        : currentSimStore.scheduleEval.statusMessageEs}
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

                {/* Call Start / Hangup Buttons */}
                <div className="flex flex-wrap gap-3 pt-1">
                  {!simActive ? (
                    <button
                      type="button"
                      onClick={() => void handleStartSimCall()}
                      disabled={simBusy}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm shadow-md transition"
                    >
                      <PhoneCall size={18} />
                      {t('phone_agent.sim_start_call')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleEndSimCall()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm shadow-md transition"
                    >
                      <PhoneOff size={18} />
                      {t('phone_agent.sim_end_call')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleMicrophone}
                    disabled={simBusy}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-sm transition ${
                      simListening
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {simListening ? <MicOff size={18} /> : <Mic size={18} />}
                    {simListening ? t('phone_agent.sim_mic_listening') : t('phone_agent.sim_mic_speak')}
                  </button>
                </div>
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
                      onClick={() => void handleSendSimTurn(simLang === 'en' ? sc.textEn : sc.textEs)}
                      disabled={simBusy}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between gap-2"
                    >
                      <span>{simLang === 'en' ? sc.labelEn : sc.labelEs}</span>
                      <Send size={13} className="text-emerald-600 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: Live Conversation Transcript & Tool Telemetry */}
            <div className="lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden min-h-[560px]">
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
                      {currentSimStore ? `Tacos Gavilan — ${currentSimStore.name}` : 'Tacos Gavilan'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {simActive
                        ? `${t('phone_agent.sim_call_in_progress')} (${currentSimStore?.config.voice_id || 'Kore'})`
                        : t('phone_agent.sim_ready_to_call')}
                    </div>
                  </div>
                </div>

                {simSpeaking && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-bold">
                    <Volume2 size={14} className="animate-bounce" />
                    {currentSimStore?.config.voice_id || 'Kore'} • {t('phone_agent.sim_speaking_badge')}
                  </span>
                )}
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
                              : `${t('phone_agent.sim_assistant_label')} (${currentSimStore?.name || ''})`}
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
                                onClick={() =>
                                  void playVoiceUrl(
                                    (msg.audioDataUrl || msg.audioUrl)!,
                                    msg.text,
                                    msg.lang || simLang
                                  )
                                }
                                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                              >
                                <Volume2 size={13} />
                                {t('phone_agent.sim_replay')}
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="leading-relaxed">{msg.text}</p>
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
                  disabled={simBusy}
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
                  disabled={simBusy || !simInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold transition shrink-0"
                >
                  <Send size={16} />
                  {t('phone_agent.sim_send')}
                </button>
              </div>
            </div>
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
                        <div className="text-xs font-bold text-slate-500">
                          {uq.storeName} • {new Date(uq.startedAt).toLocaleString()}
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
                              question_keywords: '',
                              answer_es: '',
                              answer_en: '',
                              priority: 80
                            })
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                        >
                          {t('phone_agent.kb_convert_to_rule')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDismissUnanswered(uq.callId)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold"
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
                        question_keywords: '',
                        answer_es: '',
                        answer_en: '',
                        priority: 80
                      })
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
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border-2 border-emerald-500 p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                        {t('phone_agent.kb_rule_title')}
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
                        max={100}
                        value={editingRule.priority ?? 80}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            priority: Math.max(0, Math.min(100, Number(e.target.value || 0)))
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
                      disabled={savingRule || !editingRule.title || !editingRule.answer_es}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black"
                    >
                      <Save size={14} />
                      {t('phone_agent.kb_save')}
                    </button>
                  </div>
                </div>
              )}

              {/* Rules List */}
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
                            {rule.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={togglingRuleId === rule.id}
                            onClick={() => void handleToggleRuleActive(rule)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-black ${
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
                            }}
                            title={t('phone_agent.kb_edit')}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={deletingRuleId === rule.id}
                            onClick={() => void handleDeleteRule(rule.id)}
                            title={t('phone_agent.kb_delete')}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        🇲🇽 {rule.answer_es}
                      </p>
                      {rule.answer_en && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          🇺🇸 {rule.answer_en}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
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
                    onClick={() => void handleSaveHoliday()}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black whitespace-nowrap"
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
                          : `${formatUiHhMm12h(sh.open_time)} → ${t('phone_agent.holidays_regular_close_label')}`
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
                          disabled={deletingHolidayId === sh.id}
                          onClick={() => void handleDeleteHoliday(sh.id)}
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
        {/* TAB 3: 15 SUCURSALES & DESVÍO CONDICIONAL (SPECTRUM / AT&T)       */}
        {/* ================================================================= */}
        {activeTab === 'stores' && isGlobalAdmin && (
          <div className="space-y-4">
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
                        onClick={() =>
                          void handleSaveStoreConfig(s, { is_enabled: !s.config.is_enabled })
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-black shrink-0 ${
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
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">
                          {t('phone_agent.stores_manager_phone')}
                        </label>
                        <input
                          type="text"
                          value={s.config.manager_transfer_phone || ''}
                          onChange={(e) =>
                            updateLocalStoreConfig(s.id, 'manager_transfer_phone', e.target.value)
                          }
                          placeholder={t('phone_agent.stores_manager_placeholder')}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold"
                        />
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
                          <option value={15}>15 s</option>
                          <option value={20}>20 s</option>
                          <option value={25}>25 s</option>
                          <option value={30}>30 s</option>
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
                          {t('phone_agent.stores_default_lang')} • {t('phone_agent.stores_live_transfer_label')}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={s.config.default_language || 'es'}
                            onChange={(e) =>
                              updateLocalStoreConfig(s.id, 'default_language', e.target.value)
                            }
                            className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs font-bold"
                          >
                            <option value="es">ES</option>
                            <option value="en">EN</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              updateLocalStoreConfig(
                                s.id,
                                'allow_live_transfer',
                                !s.config.allow_live_transfer
                              )
                            }
                            className={`w-1/2 py-1.5 rounded-xl text-[10px] font-black border ${
                              s.config.allow_live_transfer
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-900'
                                : 'bg-slate-100 border-slate-300 text-slate-500'
                            }`}
                          >
                            {s.config.allow_live_transfer
                              ? t('phone_agent.stores_live_transfer_yes')
                              : t('phone_agent.stores_live_transfer_no')}
                          </button>
                        </div>
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
                        disabled={savingStoreId === s.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                      >
                        <Save size={14} />
                        {savingStoreId === s.id ? '...' : t('phone_agent.stores_save_config')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Forwarding Instructions Modal (computed live from draft config) */}
            {selectedStoreForForwarding && liveForwardingGuide && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800">
                        {isEn
                          ? liveForwardingGuide.carrierLabelEn
                          : liveForwardingGuide.carrierLabelEs}
                      </span>
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

                  {!liveForwardingGuide.hasValidTwilioNumber && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-start gap-2">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                      <span>{t('phone_agent.stores_missing_twilio_warn')}</span>
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
                          {liveForwardingGuide.activateNoAnswerCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(liveForwardingGuide.activateNoAnswerCode)}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                      >
                        {copiedCode === liveForwardingGuide.activateNoAnswerCode ? (
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
                          {liveForwardingGuide.activateBusyCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(liveForwardingGuide.activateBusyCode)}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                      >
                        {copiedCode === liveForwardingGuide.activateBusyCode ? (
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
                            {liveForwardingGuide.activateUnreachableCode}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyToClipboard(liveForwardingGuide.activateUnreachableCode!)
                          }
                          className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                        >
                          {copiedCode === liveForwardingGuide.activateUnreachableCode ? (
                            <Check size={14} className="text-emerald-600" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    )}

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase text-slate-500">
                          {t('phone_agent.stores_code_deactivate_all')}
                        </div>
                        <div className="text-sm font-black font-mono text-rose-600 truncate">
                          {liveForwardingGuide.deactivateAllCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(liveForwardingGuide.deactivateAllCode)}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shrink-0"
                      >
                        {copiedCode === liveForwardingGuide.deactivateAllCode ? (
                          <Check size={14} className="text-emerald-600" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Step by step list */}
                  <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-300 list-none">
                    {(isEn ? liveForwardingGuide.stepsEn : liveForwardingGuide.stepsEs).map(
                      (step, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {step}
                        </li>
                      )
                    )}
                  </ol>

                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-300">
                    ⚠️ {isEn ? liveForwardingGuide.gotchaEn : liveForwardingGuide.gotchaEs}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    {selectedStoreForForwarding.config.forwarding_status === 'verified' && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await handleSaveStoreConfig(selectedStoreForForwarding, {
                            forwarding_status: 'pending'
                          })
                          if (ok) setSelectedStoreIdForForwarding(null)
                        }}
                        className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold"
                      >
                        {t('phone_agent.stores_reset_pending')}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!liveForwardingGuide.hasValidTwilioNumber}
                      onClick={async () => {
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
                    {isGlobalAdmin && (
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
                {callbacks.filter((c) => c.status === 'pending').length})
              </h3>

              {callbacks.length === 0 ? (
                <p className="text-xs text-slate-500">{t('phone_agent.callbacks_empty')}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {callbacks.map((cb) => {
                    const isSimCb = cb.source === 'simulator'
                    return (
                      <div
                        key={cb.id}
                        className={`rounded-xl border p-4 space-y-2.5 ${
                          cb.status === 'pending'
                            ? isSimCb
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
                                  cb.urgency === 'critical' || cb.urgency === 'urgent'
                                    ? 'bg-rose-600 text-white'
                                    : cb.urgency === 'high'
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-slate-600 text-white'
                                }`}
                              >
                                {cb.stores?.name || `#${cb.store_id}`} •{' '}
                                {getCallerTypeLabel(cb.caller_type)} • {getUrgencyLabel(cb.urgency)}
                              </span>
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
                            <div className="text-sm font-black text-slate-900 dark:text-white">
                              {cb.caller_name} — 📞 {cb.caller_phone}
                            </div>
                          </div>

                          {cb.status !== 'pending' && (
                            <span className="text-xs font-bold text-emerald-600 shrink-0">
                              ✅ {t('phone_agent.callbacks_resolved_badge')}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                          {cb.reason_summary}
                        </p>

                        <div className="text-[11px] text-slate-400">
                          {new Date(cb.created_at).toLocaleString()}
                          {cb.ticket_or_order_number
                            ? ` • ${t('phone_agent.banner_ticket_prefix')} ${cb.ticket_or_order_number}`
                            : ''}
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
                              className="flex-1 min-w-[160px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => void handleResolveCallback(cb)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shrink-0"
                            >
                              <CheckCircle2 size={13} />
                              {t('phone_agent.callbacks_mark_resolved')}
                            </button>
                          </div>
                        ) : (
                          (cb.resolved_by || cb.resolution_notes) && (
                            <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70 text-[11px] text-slate-500 space-y-0.5">
                              {cb.resolved_by && (
                                <div>
                                  <span className="font-bold">
                                    {t('phone_agent.callbacks_resolved_by')}
                                  </span>{' '}
                                  {cb.resolved_by}
                                  {cb.resolved_at
                                    ? ` (${new Date(cb.resolved_at).toLocaleString()})`
                                    : ''}
                                </div>
                              )}
                              {cb.resolution_notes && (
                                <div className="italic">“{cb.resolution_notes}”</div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
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
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                              {t('phone_agent.calls_outcome_callback')}
                            </span>
                          )
                        }

                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 whitespace-nowrap font-medium">
                              {new Date(c.started_at).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 font-bold whitespace-nowrap">
                              {c.stores?.name || `#${c.store_id}`}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                              {c.caller_number && c.caller_number !== 'SIMULATOR_WEB'
                                ? c.caller_number
                                : isSim
                                  ? t('phone_agent.calls_unknown_caller')
                                  : t('phone_agent.calls_anonymous_caller')}
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
                            <td className="py-2.5 px-3 max-w-xs truncate text-slate-600 dark:text-slate-400">
                              {c.summary || '—'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {renderOutcomeBadge()}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setSelectedCallDetail(c)}
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

            {/* Call Transcript Modal with Voice Replay */}
            {selectedCallDetail && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 space-y-4 border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-black text-slate-900 dark:text-white">
                        {selectedCallDetail.stores?.name || `#${selectedCallDetail.store_id}`} —{' '}
                        {new Date(selectedCallDetail.started_at).toLocaleString()}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t('phone_agent.calls_modal_caller')}{' '}
                        {selectedCallDetail.caller_number || t('phone_agent.calls_unknown_caller')} •{' '}
                        {t('phone_agent.calls_modal_duration')}{' '}
                        {selectedCallDetail.duration_seconds || 0}s (
                        {selectedCallDetail.turns_count || 0} {t('phone_agent.calls_turns_short')}) •
                        SID: {selectedCallDetail.call_sid}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        stopAllSimAudio(false)
                        setSelectedCallDetail(null)
                      }}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {(selectedCallDetail.transcript || []).map((tItem, idx) => {
                      const roleLabel =
                        tItem.role === 'user'
                          ? t('phone_agent.calls_role_user')
                          : tItem.role === 'tool'
                            ? `${t('phone_agent.calls_role_tool')} (${tItem.toolName || ''})`
                            : t('phone_agent.calls_role_assistant')
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
                                disabled={replayingMsgIdx !== null}
                                onClick={() =>
                                  void handleReplayTranscriptTurn(
                                    tItem.text,
                                    selectedCallDetail.language,
                                    selectedCallDetail.store_id,
                                    idx
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
                              >
                                <Volume2 size={12} />
                                {t('phone_agent.calls_modal_play_tts')}
                              </button>
                            )}
                          </div>
                          <div className="leading-relaxed">{tItem.text}</div>
                        </div>
                      )
                    })}
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
