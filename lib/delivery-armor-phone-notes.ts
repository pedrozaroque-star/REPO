/**
 * @module lib/delivery-armor-phone-notes
 * @description Puente en tiempo real entre la Contestadora IA (Kore 3.8 Live / teléfono) y la tableta
 *   de empaque **Delivery Armor** (`BlindajeDeliveryEmpaque`) para órdenes de DoorDash, Uber Eats,
 *   Grubhub y Tacos Gavilan Online (`Toast Online`).
 *
 * @businessRules
 * - Cuando un cliente de DoorDash, Uber Eats, Grubhub o pedido en línea llama para pedir **condimentos gratuitos**
 *   (salsas, chiles, limones, cebollas, servilletas, utensilios) o una **modificación sin costo** a un platillo
 *   ya pedido (ej. *"sin queso en el Taco Plate"*, *"sin cebolla en el burrito"*, *"tortillas de harina"*, *"salsa aparte"*):
 *   1. Identifica en vivo la orden exacta contra `fetchOffPremiseOrders(storeId)` (cubriendo órdenes en cocina `IN_KITCHEN`,
 *      listas para empacar `READY`, ya selladas `PACKED_AND_SEALED` antes de entregar al chofer y ya entregadas `DELIVERED`).
 *   2. Soporta códigos alfanuméricos incluyendo códigos solo-letras de Uber Eats (`ABCDE`), prefijos `DD`/`SF`/`CAV`/`GH`/`#`,
 *      nombres en formato `"Nombre InicialApellido"` (`"Cameron K"`, `"Ernesto L."`), similitud fonética (`areCustomerNamesConfusable`),
 *      filtro de plataforma y desempate por platillos pedidos (`orderedItemsHint`).
 *   3. Si la orden ya fue entregada al repartidor (`DELIVERED`), informa con honestidad que ya salió de la tienda
 *      sin hacer parpadear una orden que ya se fue.
 *   4. Si hay 2 órdenes activas ambiguas (ej. dos clientes llamados `"Maria"` en DoorDash), responde `outcome: 'AMBIGUOUS'`
 *      con pistas seguras sin revelar PII completo para que Kore pida inicial de apellido, código o un platillo.
 *   5. Al crear o fusionar una nota activa en `delivery_armor_phone_notes`, emite un ping ligero vía Supabase Realtime Broadcast
 *      (sin PII en el payload) al canal `blindaje-delivery-phone-notes-${storeId}` para alertar y hacer parpadear la orden
 *      en `< 500 ms` en la tableta Delivery Armor.
 *   6. Al marcar la cajera la nota como `applied` en la tableta, también resuelve automáticamente cualquier recado ligado
 *      en `phone_callback_requests` (`callback_id`) para evitar alertas obsoletas en `/order-ready-board`.
 * - **Aislamiento Operativo**: Las notas con `source = 'simulator'` no se muestran en las tabletas reales de tienda
 *   salvo que se solicite explícitamente `includeSimulator: true`.
 *
 * @dataFlow
 * - `phone-live-bridge` / `lib/phone-live-kore` / `lib/phone-agent` -> `createOrUpdateDeliveryArmorPhoneNote()`
 *   -> `fetchOffPremiseOrders()` -> `public.delivery_armor_phone_notes` (+ `phone_callback_requests`)
 *   -> Supabase Realtime Broadcast -> `/api/delivery-armor/orders` & `/api/delivery-armor/phone-notes` -> Tableta Delivery Armor.
 *
 * @notes
 * - Creado 2026-11-24 tras solicitud de Carlos para conectar llamadas telefónicas de condimentos/ajustes de plataformas
 *   DD/Uber/Grubhub directamente con parpadeo y sonido en la tableta Delivery Armor de empaque.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import {
  areCustomerNamesConfusable,
  fetchOffPremiseOrders,
  type DeliveryPlatform,
  type OffPremiseOrder
} from '@/lib/delivery-armor'

export type DeliveryArmorNoteRequestType =
  | 'condiments'
  | 'item_modification'
  | 'both'
  | 'pickup_time_change'
  | 'wrong_store_stop'
  | 'wrong_store_prepare'
  | 'fiesta_platter_custom'
export type DeliveryArmorNoteStatus = 'pending' | 'acknowledged' | 'applied' | 'dismissed'
export type DeliveryArmorNoteMatchStatus = 'MATCHED' | 'UNMATCHED' | 'ALREADY_DELIVERED'

export interface FiestaPlatterCustomSpec {
  packageSize: '15-20' | '20-25' | '25-30' | '30-40'
  totalMeatLbs: number
  totalAguaGallons: number
  meats: Array<{ meat: string; lbs: number }>
  aguas: Array<{ flavor: string; gallons: number }>
  tortillas: string | null
  extraNotes: string | null
}

export interface DeliveryArmorPhoneNote {
  id: string
  storeId: number
  originStoreId: number | null
  relatedStoreId: number | null
  relatedNoteId: string | null
  businessDate: string
  source: 'twilio' | 'simulator' | 'manual'
  callId: string | null
  callbackId: string | null
  matchStatus: DeliveryArmorNoteMatchStatus
  toastOrderGuid: string | null
  toastDisplayNumber: string | null
  platform: DeliveryPlatform
  platformOrderKey: string | null
  shortOrderKey: string | null
  orderCustomerName: string | null
  orderStageAtAlert: string | null
  callerName: string
  callerPhone: string | null
  requestType: DeliveryArmorNoteRequestType
  noteSummaryEs: string
  noteSummaryEn: string | null
  requestedCondiments: string[]
  itemModifications: string[]
  orderedItemsHint: string | null
  requestedPickupTime: string | null
  originalPickupTime: string | null
  platterSpec: FiestaPlatterCustomSpec | null
  status: DeliveryArmorNoteStatus
  acknowledgedByName: string | null
  acknowledgedAt: string | null
  appliedByName: string | null
  appliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderMatchCandidate {
  order: OffPremiseOrder
  score: number
  codeScore: number
  nameScore: number
  itemScore: number
  platformScore: number
  stageScore: number
}

export interface DeliveryArmorOrderMatchResult {
  outcome: 'MATCHED_ACTIVE' | 'MATCHED_PACKED_NOT_HANDED' | 'ALREADY_DELIVERED' | 'AMBIGUOUS' | 'NOT_FOUND'
  matchedOrder: OffPremiseOrder | null
  candidates: Array<{
    orderGuid: string
    displayNumber: string
    platform: DeliveryPlatform
    shortOrderKey: string
    maskedCustomerName: string
    stage: string
    score: number
  }>
  totalActiveScanned: number
}

export interface CreateDeliveryArmorPhoneNoteParams {
  storeId: number
  source?: 'twilio' | 'simulator' | 'manual'
  callSid?: string | null
  callId?: string | null
  callbackId?: string | null
  platform?: string | null
  customerName: string
  orderCode?: string | null
  orderedItemsHint?: string | null
  callerName?: string | null
  callerPhone?: string | null
  requestType?: string | null
  noteSummaryEs: string
  noteSummaryEn?: string | null
  requestedCondiments?: string[] | null
  itemModifications?: string[] | null
  /** Si true, reemplaza la lista previa de condimentos al editar una nota activa en vez de solo anexar. */
  replaceCondiments?: boolean
  confirmSaveUnmatched?: boolean
  /** Opcional: para pruebas unitarias o inyección de órdenes en memoria sin llamar a Toast. */
  ordersOverride?: OffPremiseOrder[]
}

export interface CreateDeliveryArmorPhoneNoteResult {
  ok: boolean
  outcome:
    | 'SENT_TO_TABLET'
    | 'SENT_TO_TABLET_REOPEN_BAG'
    | 'SENT_CONDIMENTS_ONLY_ALREADY_PREPARED'
    | 'SENT_UNMATCHED_BANNER'
    | 'ALREADY_PREPARED_NO_ITEM_MOD'
    | 'PAID_ITEM_CHANGE_BLOCKED'
    | 'ALREADY_DELIVERED'
    | 'AMBIGUOUS'
    | 'NOT_FOUND'
    | 'MISSING_INFO'
  updatedExisting?: boolean
  note?: DeliveryArmorPhoneNote | null
  matchedOrder?: {
    orderGuid: string
    displayNumber: string
    platform: DeliveryPlatform
    platformOrderKey: string
    shortOrderKey: string
    customerName: string
    stage: string
  } | null
  ambiguousCandidates?: Array<{
    platform: DeliveryPlatform
    maskedCustomerName: string
    shortOrderKey: string
    stage: string
  }>
  messageEs: string
  messageEn: string
}

function foldAscii(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDeliveryPlatformInput(raw: string | null | undefined): DeliveryPlatform | null {
  const s = foldAscii(raw)
  if (!s) return null
  if (/\b(doordash|door\s*dash|dd|caviar|cav|dortmund|gordas|ordash)\b/i.test(s)) return 'DOORDASH'
  if (/\b(uber|ubereats|uber\s*eats|ue|postmates)\b/i.test(s)) return 'UBER_EATS'
  if (/\b(grubhub|grub\s*hub|gh|seamless)\b/i.test(s)) return 'GRUBHUB'
  if (/\b(toast|tacos\s*gavilan|tacosgavilan|order\s*online|online|web|website|app|pickup)\b/i.test(s)) return 'TOAST_ONLINE'
  return null
}

export function formatPlatformLabel(platform: DeliveryPlatform): string {
  switch (platform) {
    case 'DOORDASH':
      return 'DoorDash'
    case 'UBER_EATS':
      return 'Uber Eats'
    case 'GRUBHUB':
      return 'Grubhub'
    case 'TOAST_ONLINE':
      return 'Tacos Gavilan Online'
    case 'TAKEOUT':
      return 'Takeout'
    default:
      return 'Delivery'
  }
}

/**
 * Normaliza códigos de orden de plataformas eliminando `#`, espacios y prefijos (`DD`, `SF`, `CAV`, `GH`, `UBER`, `UE`, `TOAST`),
 * preservando códigos hexadecimales/alfanuméricos incluso cuando son SOLO LETRAS (ej. Uber Eats `ABCDE` o `FACEB`).
 */
export function normalizePlatformOrderCode(raw: string | null | undefined): string {
  const str = String(raw || '').trim()
  if (!str) return ''
  const upper = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/^(?:SIN\s*TICKET|NO\s*TICKET|NONE|N\/A|NA)$/i, '')
    .trim()
  if (!upper) return ''

  // Quitar frases habladas y prefijos de plataforma
  const cleaned = upper
    .replace(/\b(?:ORDEN|ORDER|TICKET|CODIGO|CODE|NUMERO|NUMBER|CHECK|DOORDASH|UBER\s*EATS|UBER|GRUBHUB|TOAST|ONLINE)\b/g, ' ')
    .replace(/^(?:DD|SF|CAV|GH|UE|QR)\s*#?\s*/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim()

  if (cleaned.length < 2 || cleaned.length > 24) return ''
  return cleaned
}

function extractOrderNormalizedCodes(order: OffPremiseOrder): {
  exactCodes: string[]
  longCodes: string[]
  displayNum: string
} {
  const rawList = [order.shortOrderKey, order.platformOrderKey, order.displayNumber]
  const exactSet = new Set<string>()
  const longSet = new Set<string>()

  for (const r of rawList) {
    const norm = normalizePlatformOrderCode(r)
    if (!norm) continue
    exactSet.add(norm)
    if (/^\d+$/.test(norm)) {
      const stripped = norm.replace(/^0+(?=\d)/, '')
      if (stripped) exactSet.add(stripped)
    }
    if (norm.length >= 4) {
      longSet.add(norm)
    }
  }
  const displayNum = normalizePlatformOrderCode(order.displayNumber).replace(/^0+(?=\d)/, '')
  return {
    exactCodes: Array.from(exactSet),
    longCodes: Array.from(longSet),
    displayNum
  }
}

function scoreOrderCodeMatch(queryCodeRaw: string | null | undefined, order: OffPremiseOrder): number {
  const q = normalizePlatformOrderCode(queryCodeRaw)
  if (!q) return 0
  const qNoZeros = /^\d+$/.test(q) ? q.replace(/^0+(?=\d)/, '') : q
  const { exactCodes, longCodes, displayNum } = extractOrderNormalizedCodes(order)

  if (exactCodes.includes(q) || (qNoZeros && exactCodes.includes(qNoZeros))) {
    return 125
  }
  if (q.length >= 4) {
    for (const lc of longCodes) {
      if (lc.endsWith(q) || lc.startsWith(q) || lc.includes(q) || q.endsWith(lc)) {
        return 98
      }
    }
  }
  if (q.length === 3 && /^\d{3}$/.test(q)) {
    if (displayNum === q || exactCodes.some((c) => c.endsWith(q))) {
      return 65
    }
  }
  return 0
}

function extractNameParts(raw: string): { first: string; lastInitial: string; full: string } {
  const clean = foldAscii(raw)
    .replace(/\b(cliente|customer|doordash|uber\s*eats|uber|grubhub|pickup|toast|online|delivery)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return { first: '', lastInitial: '', full: '' }
  const parts = clean.split(' ').filter(Boolean)
  const first = parts[0] || ''
  const last = parts.length >= 2 ? parts[parts.length - 1] : ''
  const lastInitial = last ? last[0] : ''
  return { first, lastInitial, full: clean }
}

function scoreCustomerNameMatch(queryNameRaw: string | null | undefined, orderNameRaw: string | null | undefined): number {
  const q = extractNameParts(queryNameRaw || '')
  const o = extractNameParts(orderNameRaw || '')
  if (!q.first || !o.first) return 0

  if (q.full === o.full) return 84

  const firstExact = q.first === o.first
  const firstStarts =
    !firstExact &&
    q.first.length >= 3 &&
    o.first.length >= 3 &&
    (q.first.startsWith(o.first) || o.first.startsWith(q.first))

  if (firstExact || firstStarts) {
    if (q.lastInitial && o.lastInitial) {
      if (q.lastInitial === o.lastInitial) {
        return firstExact ? 80 : 70
      }
      // Mismo primer nombre pero inicial de apellido diferente ("Maria G." vs "Maria R.") -> bloquear falso match
      return -30
    }
    return firstExact ? 58 : 46
  }

  // Coincidencia por segundo nombre / apellido o similitud fonética ("Sara" vs "Sarah", "Cristian" vs "Christian")
  const collision = areCustomerNamesConfusable(q.full, o.full)
  if (collision.confusable) {
    if (q.lastInitial && o.lastInitial && q.lastInitial !== o.lastInitial) {
      return -20
    }
    return collision.reason === 'EXACT_NAME' ? 78 : 44
  }

  // Si el usuario dio "Apellido" y el pedido trae "Nombre Apellido"
  if (q.first.length >= 4 && o.full.split(' ').includes(q.first)) {
    return 40
  }

  return 0
}

const ITEM_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  pollo: 'chicken',
  chicken: 'chicken',
  res: 'asada',
  steak: 'asada',
  beef: 'asada',
  asada: 'asada',
  pastor: 'pastor',
  pork: 'pastor',
  alpastor: 'pastor',
  carnitas: 'carnitas',
  cabeza: 'cabeza',
  lengua: 'lengua',
  tongue: 'lengua',
  buche: 'buche',
  chorizo: 'chorizo',
  sausage: 'chorizo',
  taco: 'taco',
  tacos: 'taco',
  burrito: 'burrito',
  burritos: 'burrito',
  mulita: 'mulita',
  mulitas: 'mulita',
  quesadilla: 'quesadilla',
  quesadillas: 'quesadilla',
  torta: 'torta',
  tortas: 'torta',
  cubana: 'cubana',
  milanesa: 'milanesa',
  sope: 'sope',
  sopes: 'sope',
  nacho: 'nachos',
  nachos: 'nachos',
  plato: 'plate',
  platos: 'plate',
  plate: 'plate',
  plates: 'plate',
  horchata: 'horchata',
  jamaica: 'jamaica',
  hibiscus: 'jamaica',
  pina: 'pineapple',
  pineapple: 'pineapple',
  tamarindo: 'tamarind',
  tamarind: 'tamarind',
  champurrado: 'champurrado',
  cafe: 'coffee',
  coffee: 'coffee',
  flan: 'flan',
  cheesecake: 'cheesecake',
  huevo: 'egg',
  huevos: 'egg',
  egg: 'egg',
  eggs: 'egg',
  desayuno: 'breakfast',
  breakfast: 'breakfast',
  frijol: 'beans',
  frijoles: 'beans',
  beans: 'beans',
  arroz: 'rice',
  rice: 'rice',
  queso: 'cheese',
  cheese: 'cheese',
  coca: 'coke',
  coke: 'coke',
  sprite: 'sprite',
  fanta: 'fanta',
  platter: 'platter',
  charola: 'platter',
  tray: 'platter'
})

function extractCanonicalItemTokens(text: string): Set<string> {
  const words = foldAscii(text).split(' ').filter(Boolean)
  const out = new Set<string>()
  for (const w of words) {
    const mapped = ITEM_SYNONYMS[w]
    if (mapped) out.add(mapped)
  }
  return out
}

function scoreOrderedItemsMatch(itemsHintRaw: string | null | undefined, order: OffPremiseOrder): number {
  const qTokens = extractCanonicalItemTokens(itemsHintRaw || '')
  if (qTokens.size === 0 || !Array.isArray(order.items) || order.items.length === 0) return 0

  const orderText = order.items
    .map((it) => `${it.displayName} ${(it.modifiers || []).join(' ')}`)
    .join(' ')
  const oTokens = extractCanonicalItemTokens(orderText)
  if (oTokens.size === 0) return 0

  let hits = 0
  for (const tok of qTokens) {
    if (oTokens.has(tok)) hits++
  }
  if (hits === 0) return -10
  return Math.min(40, hits * 18)
}

function resolveOrderStageLabel(order: OffPremiseOrder): string {
  const st = order.audit?.status
  if (st === 'DELIVERED') return 'DELIVERED'
  if (st === 'UNCLAIMED_2H') return 'UNCLAIMED_2H'
  if (st === 'PACKED_AND_SEALED') return 'PACKED_AND_SEALED'
  return order.kdsStatus === 'READY' ? 'READY' : 'IN_KITCHEN'
}

/**
 * Motor determinista de puntuación y emparejamiento entre una llamada telefónica de DD/Uber/Grubhub/Online
 * y las órdenes vivas de Delivery Armor (`OffPremiseOrder[]`). Función pura exportada para pruebas y runtime.
 */
export function matchDeliveryArmorOrderFromList(params: {
  orders: OffPremiseOrder[]
  platform?: string | null
  customerName?: string | null
  orderCode?: string | null
  orderedItemsHint?: string | null
}): DeliveryArmorOrderMatchResult {
  const requestedPlatform = normalizeDeliveryPlatformInput(params.platform)
  const candidatesPool = (params.orders || []).filter((o) => !o.isVoided)
  const scored: OrderMatchCandidate[] = []

  for (const order of candidatesPool) {
    const codeScore = scoreOrderCodeMatch(params.orderCode, order)
    const nameScore = scoreCustomerNameMatch(params.customerName, order.customerName)
    const itemScore = scoreOrderedItemsMatch(params.orderedItemsHint, order)

    let platformScore = 0
    if (requestedPlatform) {
      if (order.platform === requestedPlatform) {
        platformScore = 28
      } else if (order.platform !== 'OTHER') {
        platformScore = -50
      }
    }

    const stage = resolveOrderStageLabel(order)
    const stageScore =
      stage === 'IN_KITCHEN'
        ? 14
        : stage === 'READY'
          ? 12
          : stage === 'PACKED_AND_SEALED'
            ? 6
            : stage === 'DELIVERED'
              ? -18
              : -25

    // Requerir al menos señal real de código o nombre (no empatar solo por plataforma + "taco")
    if (codeScore <= 0 && nameScore < 40) continue

    const totalScore = codeScore + nameScore + itemScore + platformScore + stageScore
    if (totalScore >= 55) {
      scored.push({
        order,
        score: totalScore,
        codeScore,
        nameScore,
        itemScore,
        platformScore,
        stageScore
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const summarizeCandidate = (c: OrderMatchCandidate) => ({
    orderGuid: c.order.orderGuid,
    displayNumber: c.order.displayNumber,
    platform: c.order.platform,
    shortOrderKey: c.order.shortOrderKey || `#${c.order.displayNumber}`,
    maskedCustomerName: c.order.maskedCustomerName,
    stage: resolveOrderStageLabel(c.order),
    score: c.score
  })

  if (scored.length === 0) {
    return {
      outcome: 'NOT_FOUND',
      matchedOrder: null,
      candidates: [],
      totalActiveScanned: candidatesPool.length
    }
  }

  const top = scored[0]
  const runnerUp = scored[1]

  // Si hubo conflicto de plataforma sin código exacto, no aceptar match falso
  if (top.platformScore < 0 && top.codeScore < 98) {
    return {
      outcome: 'NOT_FOUND',
      matchedOrder: null,
      candidates: [],
      totalActiveScanned: candidatesPool.length
    }
  }

  // Si hay 2 órdenes activas muy cercanas sin código exacto -> pedir aclaración
  if (
    runnerUp &&
    top.codeScore < 98 &&
    runnerUp.score >= 58 &&
    top.score - runnerUp.score < 14
  ) {
    return {
      outcome: 'AMBIGUOUS',
      matchedOrder: null,
      candidates: scored.slice(0, 3).map(summarizeCandidate),
      totalActiveScanned: candidatesPool.length
    }
  }

  const topStage = resolveOrderStageLabel(top.order)
  if (topStage === 'DELIVERED' || topStage === 'UNCLAIMED_2H') {
    return {
      outcome: 'ALREADY_DELIVERED',
      matchedOrder: top.order,
      candidates: scored.slice(0, 2).map(summarizeCandidate),
      totalActiveScanned: candidatesPool.length
    }
  }

  if (topStage === 'PACKED_AND_SEALED') {
    return {
      outcome: 'MATCHED_PACKED_NOT_HANDED',
      matchedOrder: top.order,
      candidates: scored.slice(0, 2).map(summarizeCandidate),
      totalActiveScanned: candidatesPool.length
    }
  }

  return {
    outcome: 'MATCHED_ACTIVE',
    matchedOrder: top.order,
    candidates: scored.slice(0, 2).map(summarizeCandidate),
    totalActiveScanned: candidatesPool.length
  }
}

export function mapDbRowToPhoneNote(row: any): DeliveryArmorPhoneNote {
  return {
    id: String(row.id),
    storeId: Number(row.store_id),
    originStoreId: row.origin_store_id != null && Number.isFinite(Number(row.origin_store_id)) ? Number(row.origin_store_id) : null,
    relatedStoreId: row.related_store_id != null && Number.isFinite(Number(row.related_store_id)) ? Number(row.related_store_id) : null,
    relatedNoteId: row.related_note_id ? String(row.related_note_id) : null,
    businessDate: String(row.business_date || ''),
    source: (row.source === 'simulator' || row.source === 'manual' ? row.source : 'twilio') as DeliveryArmorPhoneNote['source'],
    callId: row.call_id ? String(row.call_id) : null,
    callbackId: row.callback_id ? String(row.callback_id) : null,
    matchStatus: (row.match_status || 'MATCHED') as DeliveryArmorNoteMatchStatus,
    toastOrderGuid: row.toast_order_guid ? String(row.toast_order_guid) : null,
    toastDisplayNumber: row.toast_display_number ? String(row.toast_display_number) : null,
    platform: (row.platform || 'OTHER') as DeliveryPlatform,
    platformOrderKey: row.platform_order_key ? String(row.platform_order_key) : null,
    shortOrderKey: row.short_order_key ? String(row.short_order_key) : null,
    orderCustomerName: row.order_customer_name ? String(row.order_customer_name) : null,
    orderStageAtAlert: row.order_stage_at_alert ? String(row.order_stage_at_alert) : null,
    callerName: String(row.caller_name || ''),
    callerPhone: row.caller_phone ? String(row.caller_phone) : null,
    requestType: (row.request_type || 'condiments') as DeliveryArmorNoteRequestType,
    noteSummaryEs: String(row.note_summary_es || ''),
    noteSummaryEn: row.note_summary_en ? String(row.note_summary_en) : null,
    requestedCondiments: Array.isArray(row.requested_condiments) ? row.requested_condiments.map(String) : [],
    itemModifications: Array.isArray(row.item_modifications) ? row.item_modifications.map(String) : [],
    orderedItemsHint: row.ordered_items_hint ? String(row.ordered_items_hint) : null,
    requestedPickupTime: row.requested_pickup_time ? String(row.requested_pickup_time) : null,
    originalPickupTime: row.original_pickup_time ? String(row.original_pickup_time) : null,
    platterSpec: row.platter_spec && typeof row.platter_spec === 'object' ? (row.platter_spec as FiestaPlatterCustomSpec) : null,
    status: (row.status || 'pending') as DeliveryArmorNoteStatus,
    acknowledgedByName: row.acknowledged_by_name ? String(row.acknowledged_by_name) : null,
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
    appliedByName: row.applied_by_name ? String(row.applied_by_name) : null,
    appliedAt: row.applied_at ? String(row.applied_at) : null,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString())
  }
}

function dedupeStringArray(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const clean = String(v || '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const key = foldAscii(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean.slice(0, 140))
  }
  return out.slice(0, 20)
}

function mergeNoteSummary(prev: string | null | undefined, next: string): string {
  const p = String(prev || '').replace(/\s+/g, ' ').trim()
  const n = String(next || '').replace(/\s+/g, ' ').trim()
  if (!p) return n.slice(0, 1000)
  if (!n) return p.slice(0, 1000)
  const fp = foldAscii(p)
  const fn = foldAscii(n)
  if (fn.includes(fp)) return n.slice(0, 1000)
  if (fp.includes(fn)) return p.slice(0, 1000)
  return `${p} | ${n}`.slice(0, 1000)
}

function normalizeRequestType(
  raw: string | null | undefined,
  condiments: string[],
  modifications: string[]
): DeliveryArmorNoteRequestType {
  const r = String(raw || '').trim().toLowerCase()
  if (
    r === 'pickup_time_change' ||
    r === 'wrong_store_stop' ||
    r === 'wrong_store_prepare' ||
    r === 'fiesta_platter_custom'
  ) {
    return r
  }
  if (condiments.length > 0 && modifications.length > 0) return 'both'
  if (r === 'both') return 'both'
  if (r === 'item_modification' || r === 'modification' || modifications.length > 0) return 'item_modification'
  return 'condiments'
}

/**
 * Emite un ping ligero vía Supabase Realtime Broadcast (sin PII) para despertar de inmediato
 * todas las tabletas de Delivery Armor abiertas en la sucursal (`< 500 ms`).
 */
export async function broadcastDeliveryArmorPhoneNotePing(params: {
  storeId: number
  noteId: string
  toastOrderGuid: string | null
  status: DeliveryArmorNoteStatus
}): Promise<void> {
  try {
    const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!baseUrl || !serviceKey) return

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1800)
    try {
      await fetch(`${baseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          messages: [
            {
              topic: `blindaje-delivery-phone-notes-${params.storeId}`,
              event: 'phone_note_updated',
              payload: {
                storeId: params.storeId,
                noteId: params.noteId,
                toastOrderGuid: params.toastOrderGuid,
                status: params.status,
                ts: Date.now()
              }
            }
          ]
        })
      })
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Nunca fallar la operación principal por fallo transitorio de broadcast (polling 8s actúa de respaldo)
  }
}

/**
 * Busca la orden activa en Delivery Armor (`fetchOffPremiseOrders`), valida estatus y crea/fusiona
 * la alerta parpadeante en `delivery_armor_phone_notes` + sincroniza auditoría en `phone_callback_requests`.
 */
export async function createOrUpdateDeliveryArmorPhoneNote(
  params: CreateDeliveryArmorPhoneNoteParams
): Promise<CreateDeliveryArmorPhoneNoteResult> {
  const storeId = Number(params.storeId)
  const customerName = String(params.customerName || params.callerName || '').replace(/\s+/g, ' ').trim()
  const callerName = String(params.callerName || customerName).replace(/\s+/g, ' ').trim()
  const condiments = dedupeStringArray(params.requestedCondiments || [])
  const modifications = dedupeStringArray(params.itemModifications || [])
  const noteSummaryEs = String(params.noteSummaryEs || '').replace(/\s+/g, ' ').trim()
  const noteSummaryEn = params.noteSummaryEn ? String(params.noteSummaryEn).replace(/\s+/g, ' ').trim() : null

  if (!Number.isInteger(storeId) || storeId <= 0) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Sucursal inválida para enviar la nota de Delivery Armor.',
      messageEn: 'Invalid store ID for Delivery Armor note.'
    }
  }
  if (!customerName || customerName.length < 2) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pide primero el nombre como aparece en la orden de DoorDash, Uber Eats o Grubhub.',
      messageEn: 'Ask first for the name on the DoorDash, Uber Eats, or Grubhub order.'
    }
  }
  if (!noteSummaryEs && condiments.length === 0 && modifications.length === 0) {
    return {
      ok: false,
      outcome: 'MISSING_INFO',
      messageEs: 'Pregunta primero qué condimentos gratuitos o qué modificación sin costo (y en qué platillo) necesita el cliente.',
      messageEn: 'Ask first which free condiments or no-cost item modification (and on which dish) the customer needs.'
    }
  }

  const finalSummaryEs =
    noteSummaryEs ||
    [
      condiments.length > 0 ? `Condimentos gratis: ${condiments.join(', ')}` : '',
      modifications.length > 0 ? `Modificación: ${modifications.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join(' | ')

  // Blindaje determinista contra cambios de platillo con costo (ej. Burrito -> Taco Plate, Taco -> Taco Plate, Regular -> Super, agregar platillos/bebidas pagadas)
  const combinedModIntent = foldAscii([noteSummaryEs, noteSummaryEn || '', ...modifications].join(' '))
  const DISH_SWAP_FAMILIES_RE =
    /(?:taco\s+plates?|fiesta\s+platters?|burritos?|tacos?|platos?|plates?|quesadillas?|mulitas?|tortas?|sopes?|nachos?|charolas?|aguas?\s+frescas?|horchatas?|jamaicas?|champurrados?|flan(?:es)?|cheesecakes?|sodas?|bebidas?|drinks?)/
  const swapMatch =
    combinedModIntent.match(
      /\b(?:cambiar|cambia|change|swap|switch|replace|convertir|convert)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|my\s+|the\s+|one\s+|a\s+)?([a-z0-9\s]{2,36}?)\s+(?:por|a|para|to|for|into|with)\s+(?:un\s+|una\s+|el\s+|la\s+|a\s+|an\s+|the\s+)?([a-z0-9\s]{2,36})\b/
    ) ||
    combinedModIntent.match(
      /\b(?:en\s+vez\s+de|en\s+lugar\s+de|instead\s+of)\s+(?:el\s+|la\s+|un\s+|una\s+|the\s+|a\s+|an\s+)?([a-z0-9\s]{2,36}?)\s+(?:quiere|quiero|poner|pon|dar|make\s+it|wants?|give\s+me|send)?\s*(?:un\s+|una\s+|el\s+|la\s+|a\s+|an\s+|the\s+)?([a-z0-9\s]{2,36})\b/
    )
  let isPaidDishSwap = false
  if (swapMatch) {
    const left = swapMatch[1].trim()
    const right = swapMatch[2].trim()
    const leftDish = left.match(DISH_SWAP_FAMILIES_RE)?.[0] || ''
    const rightDish = right.match(DISH_SWAP_FAMILIES_RE)?.[0] || ''
    const normalizeFamily = (d: string) => {
      if (/taco\s+plate/.test(d)) return 'taco_plate'
      if (/^taco/.test(d)) return 'taco'
      if (/^burrito/.test(d)) return 'burrito'
      if (/^plato|^plate/.test(d)) return 'plate'
      if (/^quesadilla/.test(d)) return 'quesadilla'
      if (/^mulita/.test(d)) return 'mulita'
      if (/^torta/.test(d)) return 'torta'
      if (/^sope/.test(d)) return 'sope'
      if (/^nacho/.test(d)) return 'nachos'
      if (/fiesta|charola/.test(d)) return 'platter'
      if (/agua|horchata|jamaica|champurrado|soda|bebida|drink/.test(d)) return 'drink'
      if (/flan|cheesecake/.test(d)) return 'dessert'
      return d
    }
    if (leftDish && rightDish && normalizeFamily(leftDish) !== normalizeFamily(rightDish)) {
      isPaidDishSwap = true
    }
  }
  const isPaidUpgradeOrAdd =
    /\b(?:hacerlo\s+super|cambiar(?:lo)?\s+a\s+super|upgrade\s+(?:to\s+)?super|make\s+(?:it|the\s+\w+)\s+super|extra\s+(?:carne|meat|asada|pastor|pollo|queso|cheese|guacamole|aguacate|avocado|crema|sour\s+cream|arroz|rice)|(?:agregar|anadir|add)\s+(?:un|una|unos|unas|dos|tres|\d+|a|an|one|two|extra)\s+(?:burrito|taco|torta|quesadilla|mulita|sope|plato|plate|nacho|bebida|drink|horchata|jamaica|champurrado|flan|cheesecake|arroz|rice|guacamole|queso))\b/.test(
      combinedModIntent
    )

  if (isPaidDishSwap || isPaidUpgradeOrAdd) {
    return {
      ok: false,
      outcome: 'PAID_ITEM_CHANGE_BLOCKED',
      messageEs:
        'No podemos cambiar un platillo por otro distinto, subir de Regular a Super ni agregar comida, bebidas o extras con costo por teléfono en una orden pagada. Esos cambios deben hacerse directamente en la sección de Ayuda (Help) de tu aplicación de delivery (DoorDash, Uber Eats o Grubhub). Por teléfono solo podemos quitar ingredientes sin costo si sigue en preparación o agregar condimentos gratis (salsas, chiles, limones, servilletas).',
      messageEn:
        'We cannot swap one dish for a different menu item, upgrade Regular to Super, or add paid food, drinks, or paid extras over the phone on an already-paid order. Please make paid item changes or cancellations directly in the Help section of your delivery app (DoorDash, Uber Eats, or Grubhub). By phone we can only remove no-cost ingredients while still in kitchen prep or add free condiments (salsas, jalapeños, limes, napkins).'
    }
  }

  const requestType = normalizeRequestType(params.requestType, condiments, modifications)
  const requestedPlatform = normalizeDeliveryPlatformInput(params.platform)
  const source = params.source || 'twilio'
  const businessDate = getCaliforniaBusinessDate()

  // 1. Obtener órdenes vivas de Delivery Armor (Toast 180 min + audits + L2 cache fallback)
  let liveOrders: OffPremiseOrder[] = []
  if (Array.isArray(params.ordersOverride)) {
    liveOrders = params.ordersOverride
  } else {
    try {
      const res = await fetchOffPremiseOrders(storeId)
      liveOrders = res.orders || []
    } catch (err) {
      console.error('[delivery-armor-phone-notes] fetchOffPremiseOrders error:', err)
      liveOrders = []
    }
  }

  // 2. Emparejar contra órdenes vivas
  const match = matchDeliveryArmorOrderFromList({
    orders: liveOrders,
    platform: params.platform,
    customerName,
    orderCode: params.orderCode,
    orderedItemsHint: params.orderedItemsHint
  })

  if (match.outcome === 'AMBIGUOUS') {
    return {
      ok: false,
      outcome: 'AMBIGUOUS',
      ambiguousCandidates: match.candidates.map((c) => ({
        platform: c.platform,
        maskedCustomerName: c.maskedCustomerName,
        shortOrderKey: c.shortOrderKey,
        stage: c.stage
      })),
      messageEs:
        'Hay más de una orden activa parecida en la tableta de empaque. Pídele al cliente la inicial de su apellido, el código de orden de su app o 1 o 2 platillos que pidió para identificar exactamente cuál es la suya.',
      messageEn:
        'There is more than one similar active order on the packing tablet. Ask the caller for their last initial, the order code from their app, or 1–2 items they ordered so we can match the exact order.'
    }
  }

  if (match.outcome === 'ALREADY_DELIVERED' && match.matchedOrder) {
    const platName = formatPlatformLabel(match.matchedOrder.platform)
    return {
      ok: false,
      outcome: 'ALREADY_DELIVERED',
      matchedOrder: {
        orderGuid: match.matchedOrder.orderGuid,
        displayNumber: match.matchedOrder.displayNumber,
        platform: match.matchedOrder.platform,
        platformOrderKey: match.matchedOrder.platformOrderKey,
        shortOrderKey: match.matchedOrder.shortOrderKey,
        customerName: match.matchedOrder.customerName,
        stage: 'DELIVERED'
      },
      messageEs: `Localizamos la orden de ${platName} (${match.matchedOrder.shortOrderKey || `#${match.matchedOrder.displayNumber}`}), pero ya fue entregada al repartidor y salió de la tienda, por lo que ya no es posible agregar condimentos ni modificar platillos.`,
      messageEn: `We located the ${platName} order (${match.matchedOrder.shortOrderKey || `#${match.matchedOrder.displayNumber}`}), however it was already handed off to the driver and has left the store, so we can no longer add condiments or modify items.`
    }
  }

  if (match.outcome === 'NOT_FOUND' && !params.confirmSaveUnmatched) {
    const platHint = requestedPlatform ? formatPlatformLabel(requestedPlatform) : 'delivery'
    return {
      ok: false,
      outcome: 'NOT_FOUND',
      messageEs: `Aún no aparece una orden activa de ${platHint} a nombre de "${customerName}"${params.orderCode ? ` (código ${params.orderCode})` : ''} en la tableta de empaque de esta sucursal. Pídele al cliente verificar: (1) el nombre o código exacto en su app, (2) que sí la haya pedido en ESTA sucursal, o (3) si la acaba de enviar hace segundos, confirma y vuelve a llamar con confirm_save_unmatched=true para dejar el aviso en la barra superior de la tableta.`,
      messageEn: `No active ${platHint} order under "${customerName}"${params.orderCode ? ` (code ${params.orderCode})` : ''} has arrived on this store's packing tablet yet. Ask the customer to verify: (1) the exact name or code on their app, (2) that it was placed at THIS location, or (3) if they literally just submitted it seconds ago, confirm and re-invoke with confirm_save_unmatched=true to post an incoming alert on the tablet.`
    }
  }

  // 3. Resolver call_id si viene callSid
  let resolvedCallId: string | null = params.callId || null
  if (!resolvedCallId && params.callSid) {
    const { data: cRow } = await supabaseAdmin
      .from('phone_calls')
      .select('id')
      .eq('call_sid', params.callSid)
      .maybeSingle()
    if (cRow?.id) resolvedCallId = String(cRow.id)
  }

  const matched = match.matchedOrder
  const finalPlatform: DeliveryPlatform = matched?.platform || requestedPlatform || 'OTHER'
  const finalStage = matched ? resolveOrderStageLabel(matched) : 'UNMATCHED'
  const finalMatchStatus: DeliveryArmorNoteMatchStatus = matched ? 'MATCHED' : 'UNMATCHED'

  // Regla operativa de estatus de preparación (2026-11-24):
  // - En estatus PREPARACIÓN (`IN_KITCHEN`): SÍ se permite quitar/modificar ingredientes sin costo del platillo
  //   (ej. "sin frijol en el burrito", "sin queso", "sin cebolla") Y agregar/editar condimentos gratis.
  // - Cuando la orden YA salió de cocina (`READY` = EMPACANDO o `PACKED_AND_SEALED` = LISTA):
  //   ya NO se pueden quitar ingredientes de un platillo ya cocinado, pero SÍ se pueden agregar/editar condimentos gratis.
  const isPastPreparationStage = Boolean(matched && (finalStage === 'READY' || finalStage === 'PACKED_AND_SEALED'))
  const DISALLOWED_KITCHEN_PREP_AS_CONDIMENT_RE =
    /\b(?:lechuga|lettuce|tomate|tomato(?:es)?|queso|cheese|guacamole|aguacate|avocado|crema|sour\s+cream|arroz|rice|carne|meat|asada|pastor|pollo|chicken|carnitas|cabeza|lengua|buche|chorizo|mayonesa|mayo|tortillas?\s+extra)\b/
  const effectiveCondiments = isPastPreparationStage
    ? condiments.filter((c) => !DISALLOWED_KITCHEN_PREP_AS_CONDIMENT_RE.test(foldAscii(c)))
    : condiments
  const droppedKitchenIngredientFromCondiments = isPastPreparationStage && effectiveCondiments.length < condiments.length
  const askedForItemModification =
    modifications.length > 0 || requestType === 'item_modification' || droppedKitchenIngredientFromCondiments
  let droppedItemModsDueToPrepared = false
  let effectiveModifications = modifications
  let effectiveRequestType = requestType
  let effectiveSummaryEs = finalSummaryEs
  let effectiveSummaryEn = noteSummaryEn

  if (isPastPreparationStage && askedForItemModification && matched) {
    const platName = formatPlatformLabel(matched.platform)
    const orderRef = matched.shortOrderKey || `#${matched.displayNumber}`
    const stageLabelEs = finalStage === 'PACKED_AND_SEALED' ? 'ya está empacada y sellada' : 'ya salió de cocina a empaque'
    const stageLabelEn = finalStage === 'PACKED_AND_SEALED' ? 'is already packed and sealed' : 'has already left the kitchen for packing'

    if (effectiveCondiments.length === 0) {
      return {
        ok: false,
        outcome: 'ALREADY_PREPARED_NO_ITEM_MOD',
        matchedOrder: {
          orderGuid: matched.orderGuid,
          displayNumber: matched.displayNumber,
          platform: matched.platform,
          platformOrderKey: matched.platformOrderKey,
          shortOrderKey: matched.shortOrderKey,
          customerName: matched.customerName,
          stage: finalStage
        },
        messageEs: `Localizamos la orden de ${platName} (${orderRef}, ${matched.customerName}), pero ${stageLabelEs}, por lo que ya no es posible modificar ingredientes de cocina del platillo (como quitar frijol o agregar lechuga, queso o guacamole). Si deseas agregar o cambiar condimentos gratis de estación de empaque (salsas roja/verde, limones, chiles, rábanos, servilletas), con gusto podemos enviarlos antes de que salga con el repartidor.`,
        messageEn: `We located the ${platName} order (${orderRef}, ${matched.customerName}), however it ${stageLabelEn}, so we can no longer modify kitchen ingredients (such as removing beans or adding lettuce, cheese, or guacamole). If you would like free packing-station condiments (red/green salsa, limes, jalapeños, radishes, napkins), we can still send those before driver handoff.`
      }
    }

    // Pidió ambos (ingrediente de cocina + condimentos gratis): enviar SOLO los condimentos gratis permitidos e informar con honestidad
    droppedItemModsDueToPrepared = true
    effectiveModifications = []
    effectiveRequestType = 'condiments'
    effectiveSummaryEs = `Condimentos gratis: ${effectiveCondiments.join(', ')}`
    effectiveSummaryEn = `Free condiments: ${effectiveCondiments.join(', ')}`
  }

  const matchedItemsSummary =
    matched && Array.isArray(matched.items) && matched.items.length > 0
      ? (() => {
          const parts = matched.items.slice(0, 8).map((it) => {
            const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1
            const mods =
              Array.isArray(it.modifiers) && it.modifiers.length > 0
                ? ` (${it.modifiers.slice(0, 3).join(', ')})`
                : ''
            return `${qty}× ${it.displayName}${mods}`
          })
          const extra = matched.items.length > 8 ? ` +${matched.items.length - 8}` : ''
          return `${parts.join(' • ')}${extra}`.slice(0, 320)
        })()
      : null
  const resolvedOrderedItemsHint =
    matchedItemsSummary || (params.orderedItemsHint ? String(params.orderedItemsHint).trim().slice(0, 240) : null)

  // 4. Deduplicar si ya existe una nota activa de condimentos/modificación en esta misma llamada o para esta misma orden reciente
  // (Nunca sobreescribir alertas especiales de cocina: pickup_time_change, wrong_store_*, fiesta_platter_custom)
  const STANDARD_DELIVERY_NOTE_TYPES = ['condiments', 'item_modification', 'both'] as const
  let existingRow: any = null
  if (resolvedCallId) {
    const { data } = await supabaseAdmin
      .from('delivery_armor_phone_notes')
      .select('*')
      .eq('call_id', resolvedCallId)
      .in('request_type', [...STANDARD_DELIVERY_NOTE_TYPES])
      .in('status', ['pending', 'acknowledged'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) existingRow = data
  }
  if (!existingRow && matched?.orderGuid) {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data } = await supabaseAdmin
      .from('delivery_armor_phone_notes')
      .select('*')
      .eq('store_id', storeId)
      .eq('toast_order_guid', matched.orderGuid)
      .in('request_type', [...STANDARD_DELIVERY_NOTE_TYPES])
      .in('status', ['pending', 'acknowledged'])
      .gte('created_at', tenMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) existingRow = data
  }

  let savedRow: any = null
  let updatedExisting = false

  if (existingRow) {
    const mergedCondiments = params.replaceCondiments
      ? dedupeStringArray(effectiveCondiments)
      : dedupeStringArray([
          ...(Array.isArray(existingRow.requested_condiments) ? existingRow.requested_condiments : []),
          ...effectiveCondiments
        ])
    const mergedMods = dedupeStringArray([
      ...(Array.isArray(existingRow.item_modifications) ? existingRow.item_modifications : []),
      ...effectiveModifications
    ])
    const rebuiltSummaryEs = [
      mergedCondiments.length > 0 ? `Condimentos gratis: ${mergedCondiments.join(', ')}` : '',
      mergedMods.length > 0 ? `Modificación: ${mergedMods.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join(' | ')
    const rebuiltSummaryEn = [
      mergedCondiments.length > 0 ? `Free condiments: ${mergedCondiments.join(', ')}` : '',
      mergedMods.length > 0 ? `Modification: ${mergedMods.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join(' | ')
    const mergedSummaryEs = params.replaceCondiments
      ? rebuiltSummaryEs || effectiveSummaryEs
      : mergeNoteSummary(existingRow.note_summary_es, effectiveSummaryEs)
    const mergedSummaryEn = params.replaceCondiments
      ? rebuiltSummaryEn || effectiveSummaryEn || existingRow.note_summary_en
      : effectiveSummaryEn
        ? mergeNoteSummary(existingRow.note_summary_en, effectiveSummaryEn)
        : existingRow.note_summary_en
    const mergedType = normalizeRequestType(effectiveRequestType, mergedCondiments, mergedMods)

    const patchPayload: Record<string, unknown> = {
      match_status: matched ? 'MATCHED' : existingRow.match_status,
      toast_order_guid: matched?.orderGuid || existingRow.toast_order_guid,
      toast_display_number: matched?.displayNumber || existingRow.toast_display_number,
      platform: matched?.platform || (requestedPlatform || existingRow.platform),
      platform_order_key: matched?.platformOrderKey || existingRow.platform_order_key || params.orderCode || null,
      short_order_key: matched?.shortOrderKey || existingRow.short_order_key || params.orderCode || null,
      order_customer_name: matched?.customerName || existingRow.order_customer_name || customerName,
      order_stage_at_alert: matched ? finalStage : existingRow.order_stage_at_alert,
      caller_name: callerName || existingRow.caller_name,
      caller_phone: params.callerPhone || existingRow.caller_phone,
      request_type: mergedType,
      note_summary_es: mergedSummaryEs,
      note_summary_en: mergedSummaryEn,
      requested_condiments: mergedCondiments,
      item_modifications: mergedMods,
      ordered_items_hint: resolvedOrderedItemsHint || existingRow.ordered_items_hint,
      callback_id: params.callbackId || existingRow.callback_id,
      status: 'pending', // Re-encender parpadeo si el cliente agregó un dato nuevo
      updated_at: new Date().toISOString()
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('delivery_armor_phone_notes')
      .update(patchPayload)
      .eq('id', existingRow.id)
      .select()
      .single()

    if (updErr) {
      throw new Error(`Error actualizando nota Delivery Armor: ${updErr.message}`)
    }
    savedRow = updated
    updatedExisting = true
  } else {
    const insertPayload = {
      store_id: storeId,
      business_date: businessDate,
      source,
      call_id: resolvedCallId,
      callback_id: params.callbackId || null,
      match_status: finalMatchStatus,
      toast_order_guid: matched?.orderGuid || null,
      toast_display_number: matched?.displayNumber || null,
      platform: finalPlatform,
      platform_order_key: matched?.platformOrderKey || (params.orderCode ? String(params.orderCode).trim() : null),
      short_order_key: matched?.shortOrderKey || (params.orderCode ? String(params.orderCode).trim() : null),
      order_customer_name: matched?.customerName || customerName,
      order_stage_at_alert: finalStage,
      caller_name: callerName,
      caller_phone: params.callerPhone || null,
      request_type: effectiveRequestType,
      note_summary_es: effectiveSummaryEs,
      note_summary_en: effectiveSummaryEn,
      requested_condiments: effectiveCondiments,
      item_modifications: effectiveModifications,
      ordered_items_hint: resolvedOrderedItemsHint,
      status: 'pending'
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('delivery_armor_phone_notes')
      .insert(insertPayload)
      .select()
      .single()

    if (insErr) {
      throw new Error(`Error creando nota Delivery Armor: ${insErr.message}`)
    }
    savedRow = inserted
  }

  const note = mapDbRowToPhoneNote(savedRow)

  // 5. Push instantáneo a la tableta vía Supabase Realtime Broadcast (sin bloquear)
  await broadcastDeliveryArmorPhoneNotePing({
    storeId,
    noteId: note.id,
    toastOrderGuid: note.toastOrderGuid,
    status: note.status
  })

  const platLabel = formatPlatformLabel(note.platform)
  const orderRef = note.shortOrderKey || (note.toastDisplayNumber ? `#${note.toastDisplayNumber}` : note.orderCustomerName || customerName)

  if (droppedItemModsDueToPrepared && matched) {
    const stageLabelEs = finalStage === 'PACKED_AND_SEALED' ? 'ya estaba empacada y sellada' : 'ya había salido de cocina a empaque'
    const stageLabelEn = finalStage === 'PACKED_AND_SEALED' ? 'was already packed and sealed' : 'had already left the kitchen for packing'
    return {
      ok: true,
      outcome: 'SENT_CONDIMENTS_ONLY_ALREADY_PREPARED',
      updatedExisting,
      note,
      matchedOrder: {
        orderGuid: matched.orderGuid,
        displayNumber: matched.displayNumber,
        platform: matched.platform,
        platformOrderKey: matched.platformOrderKey,
        shortOrderKey: matched.shortOrderKey,
        customerName: matched.customerName,
        stage: finalStage
      },
      messageEs: `Tu orden de ${platLabel} (${orderRef}, ${matched.customerName}) ${stageLabelEs}, así que ya no fue posible modificar ingredientes de cocina del platillo; sin embargo, SÍ enviamos la alerta parpadeante a empaque para agregar tus condimentos gratis (${effectiveCondiments.join(', ')}) antes de entregarla al repartidor.`,
      messageEn: `Your ${platLabel} order (${orderRef}, ${matched.customerName}) ${stageLabelEn}, so we could no longer modify kitchen ingredients; however, we DID send a flashing alert to packing to include your free condiments (${effectiveCondiments.join(', ')}) before driver handoff.`
    }
  }

  if (match.outcome === 'MATCHED_PACKED_NOT_HANDED' && matched) {
    return {
      ok: true,
      outcome: 'SENT_TO_TABLET_REOPEN_BAG',
      updatedExisting,
      note,
      matchedOrder: {
        orderGuid: matched.orderGuid,
        displayNumber: matched.displayNumber,
        platform: matched.platform,
        platformOrderKey: matched.platformOrderKey,
        shortOrderKey: matched.shortOrderKey,
        customerName: matched.customerName,
        stage: 'PACKED_AND_SEALED'
      },
      messageEs: `Orden ${platLabel} (${orderRef}, ${matched.customerName}) localizada ya empacada esperando al repartidor. Enviamos alerta parpadeante de alta prioridad a empaque para que la cajera agregue tus condimentos gratis antes de entregarla si todavía no sale.`,
      messageEn: `Found ${platLabel} order (${orderRef}, ${matched.customerName}) already packed waiting for the driver. Sent a high-priority flashing alert to packing so the cashier can add your free condiments before handoff if it hasn't left yet.`
    }
  }

  if (matched) {
    const prepTargetEs =
      finalStage === 'IN_KITCHEN' && effectiveModifications.length > 0
        ? 'la tableta de cocina (PREPARADOR) y empaque porque tu orden sigue en preparación'
        : 'la tableta de empaque'
    const prepTargetEn =
      finalStage === 'IN_KITCHEN' && effectiveModifications.length > 0
        ? 'the kitchen (PREPARADOR) and packing tablets since your order is still being prepared'
        : 'our packing tablet'
    return {
      ok: true,
      outcome: 'SENT_TO_TABLET',
      updatedExisting,
      note,
      matchedOrder: {
        orderGuid: matched.orderGuid,
        displayNumber: matched.displayNumber,
        platform: matched.platform,
        platformOrderKey: matched.platformOrderKey,
        shortOrderKey: matched.shortOrderKey,
        customerName: matched.customerName,
        stage: finalStage
      },
      messageEs: `¡Orden ${platLabel} (${orderRef}, ${matched.customerName}) localizada en tiempo real! Ya está parpadeando en ${prepTargetEs} con tu solicitud: "${note.noteSummaryEs}".`,
      messageEn: `Found your ${platLabel} order (${orderRef}, ${matched.customerName}) live! It is now flashing on ${prepTargetEn} with your request.`
    }
  }

  return {
    ok: true,
    outcome: 'SENT_UNMATCHED_BANNER',
    updatedExisting,
    note,
    matchedOrder: null,
    messageEs: `Aviso enviado a la barra superior de la tableta de Delivery Armor para la orden de ${platLabel} a nombre de ${customerName}; en cuanto baje a empaque la cajera verá tu solicitud (siempre que aún no haya salido).`,
    messageEn: `Alert posted to the top of our Delivery Armor packing tablet for the ${platLabel} order under ${customerName}; as soon as it reaches packing our cashier will see your request (as long as it hasn't left yet).`
  }
}

/**
 * Consulta las notas telefónicas activas y recientemente aplicadas (últimas 4 horas o del día laboral activo)
 * para mostrarlas y hacer parpadear las órdenes correspondientes en la tableta Delivery Armor.
 */
export async function listDeliveryArmorPhoneNotes(
  storeId: number,
  options?: { businessDate?: string; includeSimulator?: boolean }
): Promise<DeliveryArmorPhoneNote[]> {
  const bDate = options?.businessDate || getCaliforniaBusinessDate()
  const fourHoursAgoIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

  let query = supabaseAdmin
    .from('delivery_armor_phone_notes')
    .select('*')
    .eq('store_id', storeId)
    .neq('status', 'dismissed')
    .or(`business_date.eq.${bDate},created_at.gte.${fourHoursAgoIso}`)
    .order('created_at', { ascending: false })
    .limit(60)

  if (!options?.includeSimulator) {
    query = query.in('source', ['twilio', 'manual'])
  }

  const { data, error } = await query
  if (error) {
    console.error('[delivery-armor-phone-notes] list error:', error.message)
    return []
  }

  return (data || [])
    .filter((row: any) => {
      if (row.status === 'pending' || row.status === 'acknowledged') return true
      // Conservar notas aplicadas recientes (últimas 3 horas) para mostrar badge verde "✓ Aplicado" en tarjetas activas
      if (row.status === 'applied') {
        const refMs = Date.parse(String(row.applied_at || row.updated_at || row.created_at || ''))
        return Number.isFinite(refMs) && Date.now() - refMs <= 3 * 60 * 60 * 1000
      }
      return false
    })
    .map(mapDbRowToPhoneNote)
}

/**
 * Actualiza el estado de una nota telefónica desde la tableta Delivery Armor (`acknowledge` | `apply` | `dismiss`).
 * Al marcarla como `applied`, resuelve automáticamente el recado ligado en `phone_callback_requests` si existe.
 */
export async function updateDeliveryArmorPhoneNoteStatus(params: {
  noteId: string
  storeId: number
  action: 'acknowledge' | 'apply' | 'dismiss'
  actorName: string
  actorPin?: string | null
  actorSourceLabel?: string | null
  matchedOrderGuid?: string | null
  matchedDisplayNumber?: string | null
}): Promise<DeliveryArmorPhoneNote> {
  const nowIso = new Date().toISOString()
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .select('*')
    .eq('id', params.noteId)
    .eq('store_id', params.storeId)
    .maybeSingle()

  if (fetchErr || !existing) {
    throw new Error('No se encontró la nota telefónica para esta sucursal.')
  }

  const patch: Record<string, unknown> = {
    updated_at: nowIso
  }

  if (params.matchedOrderGuid && !existing.toast_order_guid) {
    patch.toast_order_guid = params.matchedOrderGuid
    patch.match_status = 'MATCHED'
    if (params.matchedDisplayNumber) patch.toast_display_number = params.matchedDisplayNumber
  }

  if (params.action === 'acknowledge') {
    patch.status = 'acknowledged'
    patch.acknowledged_by_name = params.actorName
    patch.acknowledged_by_pin = params.actorPin || null
    patch.acknowledged_at = nowIso
  } else if (params.action === 'apply') {
    patch.status = 'applied'
    patch.applied_by_name = params.actorName
    patch.applied_by_pin = params.actorPin || null
    patch.applied_at = nowIso
    if (!existing.acknowledged_at) {
      patch.acknowledged_by_name = params.actorName
      patch.acknowledged_by_pin = params.actorPin || null
      patch.acknowledged_at = nowIso
    }
  } else if (params.action === 'dismiss') {
    patch.status = 'dismissed'
    patch.applied_by_name = params.actorName
    patch.applied_by_pin = params.actorPin || null
    patch.applied_at = nowIso
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('delivery_armor_phone_notes')
    .update(patch)
    .eq('id', params.noteId)
    .eq('store_id', params.storeId)
    .select()
    .single()

  if (updErr || !updated) {
    throw new Error(`No se pudo actualizar la nota telefónica: ${updErr?.message || 'error desconocido'}`)
  }

  // Si la nota venía ligada a un recado de condimentos/delivery en phone_callback_requests, marcarlo resuelto al aplicarse
  if ((params.action === 'apply' || params.action === 'dismiss') && existing.callback_id) {
    const sourceLabel = (params.actorSourceLabel || 'Delivery Armor').trim()
    await supabaseAdmin
      .from('phone_callback_requests')
      .update({
        status: 'resolved',
        resolved_by: `${params.actorName} (${sourceLabel})`,
        resolved_at: nowIso,
        resolution_notes:
          params.action === 'apply'
            ? `Condimentos / modificación aplicados desde ${sourceLabel}.`
            : `Nota telefónica descartada desde ${sourceLabel}.`
      })
      .eq('id', existing.callback_id)
      .eq('status', 'pending')
  }

  const mapped = mapDbRowToPhoneNote(updated)

  await broadcastDeliveryArmorPhoneNotePing({
    storeId: mapped.storeId,
    noteId: mapped.id,
    toastOrderGuid: mapped.toastOrderGuid,
    status: mapped.status
  })

  return mapped
}
