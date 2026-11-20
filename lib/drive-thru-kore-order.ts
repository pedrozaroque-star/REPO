/**
 * @module lib/drive-thru-kore-order
 * @description Motor de orden PURO e isomórfico (servidor + navegador) del simulador "Kore Drive-Thru" de Tacos Gavilan.
 * Convierte las llamadas a herramientas (function calls) de la asistente de voz Kore (Gemini Live API `gemini-3.8-live`)
 * en un ticket en vivo validado contra el menú REAL de la sucursal (`app_menu_cache` -> `KoreMenuItem[]`), con
 * precios reales, modificadores reales de Toast y totales en centavos enteros (USD).
 *
 * @businessRules
 * - **Nunca inventa productos ni precios**: todo `add_item` se resuelve contra `KoreMenuItem[]`; si no existe o es ambiguo
 *   (ej. "horchata" sin tamaño, "taco" sin carne) regresa `ok:false` + sugerencias REALES del menú para que Kore pregunte.
 * - **Coincidencia tolerante (fuzzy matching)**: mayúsculas/minúsculas, acentos (`Piña`/`Pina`, `Jalapeños`), plurales,
 *   sinónimos ES/EN (horchata/rice water, agua de jamaica/hibiscus, coca/coke, crema/sour cream, harina/flour, maíz/corn),
 *   tamaños (`mediana`=Medium 22 oz, `grande`=Large 32 oz; no existe tamaño chico) y errores de 1–2 letras (Levenshtein).
 * - **Modificadores validados contra `modifierGroups` de Toast**: mínimo/máximo/requerido por grupo (ej. Taco Plate exige
 *   EXACTAMENTE 3 tacos en "Taco Choice"; Super Nachos exige "Queso Modifiers"; Platos exigen "Tortillas"). Se permiten
 *   repeticiones en grupos multi-selección (ej. Taco Plate con 3 Taco Asada; Agua Choice 3 de 4 sabores).
 * - **Tacos "Served Plain" y Condimentos Gratis ($0.00)**: los condimentos gratis viven en "Side Condiments" (Salsa Roja,
 *   Salsa Verde, Onions & Cilantro, Limes, Pickled Jalapeños) más las cortesías universales sin cargo **Cebolla Asada**
 *   (`Cebolla Asada (Cortesía)`) y **Frijol de la Olla** (`Frijol de la Olla (Cortesía)`), ambos `$0.00` (jamás cobrar
 *   `Beans $2.49`). Kore NUNCA pregunta condimentos de oficio; si el cliente dice `"con todo"`, se acepta directo a `$0.00`.
 * - **Cantidades**: enteros de 1 a 50 por línea (`KORE_MAX_LINE_QUANTITY`) y máximo 200 piezas por orden; 0, negativos,
 *   decimales, NaN o texto inválido se rechazan sin tocar el ticket.
 * - **Dinero en centavos enteros**: `computeKoreTotals` calcula subtotal/impuesto/total con enteros (tasa en puntos base,
 *   redondeo half-up), sin errores de punto flotante, sin NaN/Infinity; carrito vacío = 0.
 * - **Estados**: `building` -> `confirmed` (confirm_order) / `cancelled` (cancel_order), más cierre automático de carril
 *   con `end_session` (`should_end_session: true`) cuando la orden ya fue confirmada y el cliente indica que no falta nada,
 *   o tras despachar a un repartidor a Ventana 2 o despedir una orden cancelada/EBT (rechaza con `nothing_to_close` si el
 *   ticket está vacío, sin repartidor y no cancelado). Modificar una orden confirmada la reabre (`building`).
 * - **Pagos EBT (regla oficial del dueño, 2026-11-19)**: NO hay cobro EBT por Drive-Thru. Si el cliente decide pasar al
 *   comedor a pagar con EBT, Kore llama `cancel_order({ reason: "EBT: pasa al comedor" })`; el motivo se guarda en
 *   `state.cancelReason` (solo mientras la orden siga cancelada) y el resultado incluye `ebt_dining_room_only: true`.
 * - **Desayunos hasta las 2:00 PM (regla oficial del dueño, 15 sucursales)**: `isKoreBreakfastOpen(now)` evalúa la hora en
 *   `America/Los_Angeles` (06:00 <= hh:mm < 14:00). Fuera de esa ventana `add_item`/`add_items` rechazan los platillos de la
 *   categoría `Breakfast` con `error_code: 'breakfast_closed'` (`cutoff: '2:00 PM'`); bebidas como Coffee/Champurrado no se
 *   afectan. El reloj es inyectable vía `opts.now` para pruebas de bordes horarios y DST.
 * - Simulación pura: NADA se envía a Toast (la llave no tiene `orders:write`).
 *
 * @dataFlow
 * - Servidor: `lib/drive-thru-kore.ts` -> `mapAppMenuRowsToKoreMenu(app_menu_cache rows)` -> `KoreMenuItem[]` (respuesta de
 *   `POST /api/drive-thru/kore/session`) + `KORE_TOOL_DECLARATIONS` dentro del `setup` de Live API.
 * - Navegador: `toolCall.functionCalls[]` -> `applyKoreTool(state, menu, name, args, { taxRatePct })` -> `{ state, result }`
 *   -> `toolResponse.functionResponses[].response = result` + ticket en vivo con `computeKoreTotals(state, taxRatePct)`.
 *
 * @notes
 * - Sin imports de servidor (sin supabase, sin `node:*`): se puede importar en componentes cliente.
 * - Comparte normalización fonética STT e identificación de colisiones (`"dos nada"` / TV de fondo) con
 *   `lib/phone-agent.ts` a través del módulo puro isomórfico `lib/kore-shared-speech.ts`.
 * - `applyKoreTool` es inmutable: nunca muta el `state` recibido (seguro para React `setState`).
 * - Dinero: `price`/`unitPrice`/`lineTotal` en dólares (para mostrar) y sus espejos `*Cents` enteros (para sumar).
 *   `unitPrice` = precio por pieza INCLUYENDO modificadores; `basePrice` = precio del platillo en el menú.
 * - `line_id` secuencial legible para voz/modelo (`L1`, `L2`, ...), nunca se reutiliza dentro de la misma orden.
 * - Fiesta Platters se excluyen del menú del drive-thru en el servidor (requieren anticipación, ver KB de catering).
 */

import {
  KORE_BREAKFAST_CUTOFF_LABEL,
  KORE_BREAKFAST_CUTOFF_MINUTES,
  KORE_BREAKFAST_START_MINUTES,
  detectAmbiguousMeatNadaCollision,
  isKoreBreakfastCategory,
  isKoreBreakfastOpen,
  isLikelyBackgroundMediaSpeech,
  normalizeKoreCustomerSpeech,
  type KoreBreakfastWindow
} from '@/lib/kore-shared-speech'

export {
  KORE_BREAKFAST_CUTOFF_LABEL,
  KORE_BREAKFAST_CUTOFF_MINUTES,
  KORE_BREAKFAST_START_MINUTES,
  detectAmbiguousMeatNadaCollision,
  isKoreBreakfastCategory,
  isKoreBreakfastOpen,
  isLikelyBackgroundMediaSpeech,
  normalizeKoreCustomerSpeech,
  type KoreBreakfastWindow
}

export type KoreOrderStatus = 'building' | 'confirmed' | 'cancelled'

export interface KoreModifierOption {
  guid: string
  name: string
  /** Precio adicional en dólares (puede ser 0 o negativo, ej. "No Cheese / No Queso" -0.50). */
  price: number
}

export interface KoreModifierGroup {
  guid: string
  name: string
  required: boolean
  /** Mínimo efectivo de selecciones (si `required` y Toast trae 0, se fuerza a 1). */
  minSelections: number
  /** Máximo de selecciones; 0 = sin tope (solo en multi-selección). */
  maxSelections: number
  multiSelect: boolean
  options: KoreModifierOption[]
}

export interface KoreMenuItem {
  guid: string
  name: string
  category: string
  /** Precio del menú en dólares USD. */
  price: number
  description: string
  modifierGroups: KoreModifierGroup[]
}

export interface KoreOrderModifier {
  guid: string
  name: string
  /** Precio por unidad del modificador en dólares. */
  price: number
  priceCents: number
  groupName: string
  groupGuid: string
  /** Veces que se eligió dentro de la línea (ej. Taco Plate: 2 × Taco Asada). */
  quantity: number
}

export interface KoreOrderLine {
  lineId: string
  itemGuid: string
  name: string
  category: string
  quantity: number
  /** Precio del menú del platillo (sin modificadores), dólares. */
  basePrice: number
  basePriceCents: number
  /** Precio por pieza incluyendo modificadores, dólares. */
  unitPrice: number
  unitPriceCents: number
  modifiers: KoreOrderModifier[]
  notes?: string
  /** unitPrice × quantity, dólares. */
  lineTotal: number
  lineTotalCents: number
}

export type KoreSessionKind = 'customer_order' | 'driver_pickup'

export type KoreDriverOrderLookupStatus =
  | 'ready'
  | 'preparing'
  | 'already_handed'
  | 'ambiguous'
  | 'not_found'

export function isValidKoreDriverOrderLookupStatus(v: unknown): v is KoreDriverOrderLookupStatus {
  return v === 'ready' || v === 'preparing' || v === 'already_handed' || v === 'ambiguous' || v === 'not_found'
}

export interface KoreDriverPickupOrder {
  customerName: string
  orderCode?: string
  lookupStatus?: KoreDriverOrderLookupStatus
  matchedDisplayNumber?: string | null
  matchedShortKey?: string | null
  matchedPlatform?: string | null
  itemsCount?: number | null
  packedAndSealed?: boolean
}

export const KORE_COURTESY_GROUP_GUID = 'courtesy:free_condiments'
export const KORE_COURTESY_GROUP_NAME = 'Side Condiments (Cortesía)'

export const KORE_COURTESY_MODIFIERS: Readonly<Record<'cebolla_asada' | 'frijol_olla' | 'con_todo', Omit<KoreOrderModifier, 'quantity'>>> =
  Object.freeze({
    cebolla_asada: {
      guid: 'courtesy:mod:cebolla_asada',
      name: 'Cebolla Asada (Cortesía)',
      price: 0,
      priceCents: 0,
      groupName: KORE_COURTESY_GROUP_NAME,
      groupGuid: KORE_COURTESY_GROUP_GUID
    },
    frijol_olla: {
      guid: 'courtesy:mod:frijol_de_la_olla',
      name: 'Frijol de la Olla (Cortesía)',
      price: 0,
      priceCents: 0,
      groupName: KORE_COURTESY_GROUP_NAME,
      groupGuid: KORE_COURTESY_GROUP_GUID
    },
    con_todo: {
      guid: 'courtesy:mod:con_todo',
      name: 'Con Todo (Cortesía)',
      price: 0,
      priceCents: 0,
      groupName: KORE_COURTESY_GROUP_NAME,
      groupGuid: KORE_COURTESY_GROUP_GUID
    }
  })

export const KORE_COURTESY_STANDALONE_ITEMS: Readonly<Record<string, KoreMenuItem>> = Object.freeze({
  'courtesy:item:cebolla_asada': {
    guid: 'courtesy:item:cebolla_asada',
    name: 'Cebolla Asada (Cortesía)',
    category: 'Cortesías',
    price: 0,
    description: 'Orden de cortesía sin costo de cebolla asada ($0.00).',
    modifierGroups: []
  },
  'courtesy:item:frijol_de_la_olla': {
    guid: 'courtesy:item:frijol_de_la_olla',
    name: 'Frijol de la Olla (Cortesía)',
    category: 'Cortesías',
    price: 0,
    description: 'Vasito de cortesía sin costo de frijol de la olla ($0.00).',
    modifierGroups: []
  }
})

export interface KoreDriverPickup {
  platform: string
  orders: KoreDriverPickupOrder[]
  notes?: string
}

export interface KoreOrderState {
  lines: KoreOrderLine[]
  status: KoreOrderStatus
  /** Tipo de sesión: orden de cliente (`customer_order`) o recolección de repartidor (`driver_pickup`). */
  sessionKind?: KoreSessionKind
  /** Datos de recolección cuando `sessionKind === 'driver_pickup'` (1 o varias órdenes en el mismo vehículo). */
  driverPickup?: KoreDriverPickup | null
  /** Siguiente número para `line_id` (L1, L2...). Opcional para tolerar estados creados a mano como `{lines:[],status}`. */
  nextLineNumber?: number
  /** Contador de mutaciones exitosas (útil para animaciones/keys en la UI). */
  version?: number
  /** Motivo corto de cancelación (ej. "EBT: cliente pasa al comedor"); solo existe mientras `status === 'cancelled'`. */
  cancelReason?: string
}

export interface KoreOrderTotals {
  subtotalCents: number
  taxCents: number
  totalCents: number
  /** Suma de cantidades de todas las líneas. */
  itemCount: number
  lineCount: number
  /** Tasa efectivamente aplicada tras sanear la entrada (0 si fue inválida). */
  taxRatePct: number
}

export interface KoreToolOptions {
  /** Tasa de impuesto en porcentaje (ej. 11.25). Si se omite, el resultado no incluye impuesto/total con impuesto. */
  taxRatePct?: number | null
  /** Reloj inyectable (pruebas). Por defecto `new Date()`; se evalúa SIEMPRE en `America/Los_Angeles`. */
  now?: Date
  /** Si la ciudad/sucursal acepta EBT CalFresh en mostrador del comedor (`true` en las 13 del Condado de LA; `false` en Rialto #1 y Santa Ana #9). */
  acceptsEbt?: boolean
  /** Idioma activo detectado en el turno del cliente (`'es' | 'en'`); inyecta `reply_language` + `language_directive` en el resultado. */
  lang?: 'es' | 'en'
}

/** Platillos exclusivos de desayuno: categoría Toast `Breakfast` (bebidas como Coffee/Champurrado viven en `Misc. Drinks`). */
export function isKoreBreakfastItem(item: Pick<KoreMenuItem, 'category'> | null | undefined): boolean {
  return Boolean(item && isKoreBreakfastCategory(item.category))
}

export interface KoreToolOutcome {
  state: KoreOrderState
  /** Objeto JSON plano listo para `functionResponses[].response`. */
  result: Record<string, unknown>
}

export const KORE_TOOL_NAMES = [
  'add_item',
  'add_items',
  'update_item',
  'remove_item',
  'get_order',
  'search_menu',
  'register_driver_pickup',
  'confirm_order',
  'cancel_order',
  'end_session'
] as const
export type KoreToolName = (typeof KORE_TOOL_NAMES)[number]

export const KORE_MAX_LINE_QUANTITY = 50
export const KORE_MAX_ORDER_ITEMS = 200
export const KORE_MAX_DRIVER_ORDERS = 15
const MAX_TAX_RATE_PCT = 20

/**
 * Declaraciones de funciones (functionDeclarations) para el `setup` de Gemini Live API.
 * `behavior: 'BLOCKING'` => el modelo espera el `toolResponse` antes de seguir hablando (el ticket siempre está al día).
 */
export const KORE_TOOL_DECLARATIONS = [
  {
    name: 'add_item',
    behavior: 'BLOCKING',
    description:
      'Add a menu item to the drive-thru order. Use the exact menu item name when possible (e.g. "Taco Asada", "Super Burrito Pollo", "Medium Horchata", "Large Piña"). Always call this instead of adding items from memory. Returns the updated ticket and totals, or an error with real menu suggestions/options that you must ask the customer about.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_name: { type: 'STRING', description: 'Menu item name as listed in the catalog (include drink size Medium/Large).' },
        quantity: { type: 'INTEGER', description: 'How many of this exact item (1-50). Defaults to 1.' },
        modifiers: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description:
            'Modifier option names ONLY if requested by the customer or required by the dish (e.g. "Taco Asada", "Corn Tortilla", "Guacamole", "Salsa Verde", "Cebolla Asada", "Frijol de la Olla", "Con Todo"). Repeat a name (or prefix "2x ") to choose it more than once, e.g. Taco Plate needs 3 tacos.'
        },
        notes: { type: 'STRING', description: 'Optional short kitchen note that has NO price impact.' }
      },
      required: ['item_name']
    }
  },
  {
    name: 'add_items',
    behavior: 'BLOCKING',
    description:
      'Add MULTIPLE menu items in ONE single round-trip whenever the customer orders 2 or more items at once (faster than calling add_item repeatedly). Valid items are added immediately and any ambiguous/missing item is reported back for clarification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: 'List of 1-25 items to add.',
          items: {
            type: 'OBJECT',
            properties: {
              item_name: { type: 'STRING', description: 'Exact menu item name (include Medium/Large on drinks).' },
              quantity: { type: 'INTEGER', description: 'Whole number 1-50 (defaults to 1).' },
              modifiers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modifier option names.' },
              notes: { type: 'STRING', description: 'Optional short kitchen note.' }
            },
            required: ['item_name']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'update_item',
    behavior: 'BLOCKING',
    description:
      'Change an existing ticket line (quantity, modifiers or notes) using its line_id (e.g. "L2"). "modifiers" REPLACES all modifiers; use add_modifiers/remove_modifiers for partial changes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        line_id: { type: 'STRING', description: 'Ticket line id such as "L1".' },
        quantity: { type: 'INTEGER', description: 'New quantity for the line (1-50).' },
        modifiers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Full replacement list of modifier names.' },
        add_modifiers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modifier names to add.' },
        remove_modifiers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Modifier names to remove.' },
        notes: { type: 'STRING', description: 'Replacement kitchen note (empty string clears it).' }
      },
      required: ['line_id']
    }
  },
  {
    name: 'remove_item',
    behavior: 'BLOCKING',
    description:
      'Remove a ticket line by line_id (preferred) or by item_name. Optional quantity removes only that many pieces from the line.',
    parameters: {
      type: 'OBJECT',
      properties: {
        line_id: { type: 'STRING', description: 'Ticket line id such as "L1".' },
        item_name: { type: 'STRING', description: 'Item name if the line id is unknown.' },
        quantity: { type: 'INTEGER', description: 'Pieces to remove (defaults to the whole line).' }
      }
    }
  },
  {
    name: 'get_order',
    behavior: 'BLOCKING',
    description: 'Get the current ticket with line ids, prices, subtotal, estimated tax and total.'
  },
  {
    name: 'search_menu',
    behavior: 'BLOCKING',
    description:
      'Search the real store menu for items, prices and modifier options (use it to answer price questions or before adding an item you are unsure about).',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'What the customer asked for, in English or Spanish (e.g. "agua de jamaica", "super burrito", "postres").' }
      },
      required: ['query']
    }
  },
  {
    name: 'register_driver_pickup',
    behavior: 'BLOCKING',
    description:
      'Look up and register a delivery driver picking up 1 or MULTIPLE platform orders in the same vehicle (DoorDash, Uber Eats, Grubhub, Caviar, Postmates, Tacos Gavilan, Other) against live Delivery Armor status, and direct them to Drive-Thru Window 2 (ventana 2). Total is $0.00.',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: {
          type: 'STRING',
          description: 'Platform name: DoorDash, Uber Eats, Grubhub, Caviar, Postmates, Tacos Gavilan or Other.'
        },
        orders: {
          type: 'ARRAY',
          description: '1 or more orders being picked up by this driver (provide customer_name and/or order_code).',
          items: {
            type: 'OBJECT',
            properties: {
              customer_name: { type: 'STRING', description: 'Customer name shown on the driver app (e.g. "Maria G").' },
              order_code: { type: 'STRING', description: 'Order code/ID shown on the driver app (if provided).' }
            }
          }
        },
        notes: { type: 'STRING', description: 'Optional pickup note.' },
        confirm_pickup: {
          type: 'BOOLEAN',
          description: 'Set true once the driver orders are verified to mark the pickup confirmed.'
        }
      },
      required: ['orders']
    }
  },
  {
    name: 'confirm_order',
    behavior: 'BLOCKING',
    description:
      'Confirm the order once the customer says it is complete. Returns the final ticket and total to read back before asking them to pull forward to the window.'
  },
  {
    name: 'cancel_order',
    behavior: 'BLOCKING',
    description:
      'Cancel the whole order when the customer explicitly asks to cancel, OR when they decide to go inside to the dining-room counter to pay with EBT (EBT is not accepted at the Drive-Thru). Pass a short reason (e.g. "EBT: pasa al comedor").',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Optional short reason (e.g. "EBT: cliente pasa al comedor").' }
      }
    }
  },
  {
    name: 'end_session',
    behavior: 'BLOCKING',
    description:
      'End and close this car session ONLY AFTER the order is confirmed and the customer clearly indicates there is nothing else ("Sí, está bien", "Correcto, gracias", "Ya es todo"), OR after a delivery driver acknowledges Window 2 dispatch, OR after a customer with a cancelled/EBT order confirms they are going inside or leaving. After calling this tool, give ONE brief warm send-off with NO question.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Optional close reason: "order_confirmed", "driver_dispatched", or "customer_cancelled".'
        }
      }
    }
  }
] as const

// ---------------------------------------------------------------------------
// Dinero y estado
// ---------------------------------------------------------------------------

/** Convierte dólares (number/string) a centavos enteros; valores no finitos => 0. */
export function toKoreCents(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** Formatea centavos enteros como USD (`$12.34`, `-$0.50`). */
export function formatKoreUsd(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  const abs = Math.abs(safe)
  const str = `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return safe < 0 ? `-${str}` : str
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100
}

/** Estado inicial vacío de una orden. */
export function createKoreOrderState(): KoreOrderState {
  return { lines: [], status: 'building', sessionKind: 'customer_order', driverPickup: null, nextLineNumber: 1, version: 0 }
}

function sanitizeTaxRatePct(taxRatePct: unknown): number {
  const n = Number(taxRatePct)
  if (!Number.isFinite(n) || n < 0 || n > MAX_TAX_RATE_PCT) return 0
  return Math.round(n * 1000) / 1000
}

function recomputeLine(line: KoreOrderLine): KoreOrderLine {
  const basePriceCents = Number.isFinite(line.basePriceCents) ? Math.round(line.basePriceCents) : toKoreCents(line.basePrice)
  const modsCents = (line.modifiers || []).reduce((acc, m) => {
    const pc = Number.isFinite(m.priceCents) ? Math.round(m.priceCents) : toKoreCents(m.price)
    const q = Number.isInteger(m.quantity) && m.quantity > 0 ? m.quantity : 1
    return acc + pc * q
  }, 0)
  const unitPriceCents = Math.max(0, basePriceCents + modsCents)
  const qty = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0
  const lineTotalCents = unitPriceCents * qty
  return {
    ...line,
    basePriceCents,
    basePrice: centsToDollars(basePriceCents),
    unitPriceCents,
    unitPrice: centsToDollars(unitPriceCents),
    lineTotalCents,
    lineTotal: centsToDollars(lineTotalCents)
  }
}

/**
 * Totales de la orden en centavos enteros. Recalcula cada línea desde sus centavos (no confía en `lineTotal`).
 * Impuesto = round_half_up(subtotal × tasa); tasa inválida (NaN, negativa, > 20%) => 0.
 */
export function computeKoreTotals(state: KoreOrderState | null | undefined, taxRatePct: number | null | undefined): KoreOrderTotals {
  const rate = sanitizeTaxRatePct(taxRatePct)
  const lines = Array.isArray(state?.lines) ? state!.lines : []
  let subtotalCents = 0
  let itemCount = 0
  for (const raw of lines) {
    if (!raw) continue
    const line = recomputeLine(raw)
    subtotalCents += line.lineTotalCents
    itemCount += Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0
  }
  // Tasa en milésimas de punto porcentual (11.25% => 11250) para operar solo con enteros.
  const rateMilli = Math.round(rate * 1000)
  const taxCents = subtotalCents > 0 ? Math.floor((subtotalCents * rateMilli + 50000) / 100000) : 0
  return {
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    itemCount,
    lineCount: lines.length,
    taxRatePct: rate
  }
}

// ---------------------------------------------------------------------------
// Normalización y coincidencia tolerante
// ---------------------------------------------------------------------------

/** Minúsculas, sin acentos (Piña -> pina), `&` -> and, sin puntuación. */
export function normalizeKoreText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(?<=[a-z0-9])['’](?=[a-z0-9])/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CON_TODO_TOKEN = 'zzcontodo'
const COURTESY_CEBOLLA_ASADA_TOKEN = 'zzcebollaasada'
const COURTESY_FRIJOL_OLLA_TOKEN = 'zzfrijoldelaolla'
const COURTESY_CONTAINER_TOKENS = new Set([
  'side', 'vasito', 'vasitos', 'vaso', 'vasos', 'porcion', 'porciones', 'porcione', 'bolsita', 'bolsitas',
  'cortesia', 'cortesias', 'gratis', 'grati', 'free', 'cup', 'cups', 'orden', 'ordenes', 'ordene',
  'quiero', 'quisiera', 'dame', 'deme', 'regala', 'regalame', 'unas', 'unos', 'una', 'un'
])

/** Reescrituras de frases (sobre texto ya normalizado) aplicadas igual a consultas y a nombres del menú. */
const PHRASE_REWRITES: Array<[RegExp, string]> = [
  [/\b(?:ceboll(?:a|as|ita|itas)\s+(?:asad(?:a|as)|toread(?:a|as)|al\s+grill|cambray)|cebollitas?\b|(?:grilled|roasted|charred)\s+onions?)\b/g, ` ${COURTESY_CEBOLLA_ASADA_TOKEN} `],
  [
    /\b(?:frijol(?:es|itos)?\s+(?:de\s+(?:la\s+)?olla|enteros?|en\s+caldo|caldosos?)|(?:whole(?:\s+pot)?|pot)\s+beans?|beans?\s+(?:from|in)\s+the\s+pot|frijol\s+d\s*l\s*o)\b/g,
    ` ${COURTESY_FRIJOL_OLLA_TOKEN} `
  ],
  [/\b(?:con todo|with everything|everything on it|all the way|todo incluido)\b/g, ` ${CON_TODO_TOKEN} `],
  [/\b(?:agua|aguas) (?:natural|embotellada|purificada|de botella)\b/g, 'bottled water'],
  [/\bbotellas? de agua\b/g, 'bottled water'],
  [/\b(?:bottles? of water|water bottles?)\b/g, 'bottled water'],
  [/\bcoca(?: cola)? (?:de dieta|light|diet)\b/g, 'diet coke'],
  [/\bdiet coca(?: cola)?\b/g, 'diet coke'],
  [/\bcoca(?: cola)?\b/g, 'coke'],
  [/\bfanta (?:de )?naranja\b/g, 'orange fanta'],
  [/\borange soda\b/g, 'orange fanta'],
  [/\bfanta (?:de )?fresa\b/g, 'strawberry fanta'],
  [/\bstrawberry soda\b/g, 'strawberry fanta'],
  [/\bte (?:helado|frio)\b/g, 'iced tea'],
  [/\bice tea\b/g, 'iced tea'],
  [/\bcafecito\b/g, 'coffee'],
  [/\bcafe\b/g, 'coffee'],
  [/\blimonada\b/g, 'lemonade'],
  [/\b(?:agua|aguas) (?:frescas? )?de (horchata|orchata|jamaica|pina|tamarindo|limon)\b/g, '$1'],
  [/\borchata\b/g, 'horchata'],
  [/\brice water\b/g, 'horchata'],
  [/\bhibiscus\b/g, 'jamaica'],
  [/\bpineapple\b/g, 'pina'],
  [/\btamarind\b/g, 'tamarindo'],
  [/\b(?:cheese cake|pay de queso)\b/g, 'cheesecake'],
  [
    /\b(?:tacos?\s+plates?|(?:platos?|plates?|combos?|ordenes?|orden)\s+(?:de\s+|of\s+|with\s+|con\s+)?(?:(?:3|tres|three)\s+)?tacos?(?:\s+sencillos?)?(?:\s+(?:con|with)\s+(?:arroz|frijol(?:es)?|rice|beans?)(?:\s+(?:y|and)\s+(?:arroz|frijol(?:es)?|rice|beans?))?)?|(?:3|tres|three)\s+tacos?\s+(?:plate|combo|(?:con|with)\s+(?:arroz|frijol(?:es)?|rice|beans?)(?:\s+(?:y|and)\s+(?:arroz|frijol(?:es)?|rice|beans?))?))\b/g,
    'taco plate'
  ],
  [/(?<!taco )\bplates?\b/g, 'plato'],
  [/\b(?:solo|puro|pura|nomas|nada mas|all) carne asada\b/g, 'meat only asada'],
  [/\b(?:solo|puro|pura|nomas|nada mas|all) (?:carne|meat)\b/g, 'meat only'],
  [/\bcarne asada\b/g, 'asada'],
  [/\bal pastor\b/g, 'pastor'],
  [/(?<!super )\bnachos?\b/g, 'super nachos'],
  [/\bmuletas?\b/g, 'mulita'],
  [/\bcrema(?: agria)?\b/g, 'sour cream'],
  [/\b(?:sin|without|hold the|hold)\b/g, 'no'],
  [/\btortillas? de harina\b/g, 'flour tortilla'],
  [/\btortillas? de maiz\b/g, 'corn tortilla'],
  [/\b(?:mitad y mitad|mitad harina mitad maiz|half and half|mixtas?|mixed|combinadas?)\b/g, 'half flour corn'],
  [/\b(?:huevos? )?revueltos?\b/g, 'scrambled'],
  [/\b(?:huevos? )?estrellados?\b/g, 'sunny side up'],
  [/\b(?:huevos? )?volteados?\b/g, 'over easy'],
  [/\bbien cocidos?\b/g, 'well done'],
  [/\btermino medio\b/g, 'medium well'],
  [/\bno yema\b/g, 'no yolk'],
  [/\bqueso (?:aparte|al lado|a un lado|por separado|en un lado)\b/g, 'queso on the side'],
  [/\bcheese on the side\b/g, 'queso on the side'],
  [/\bqueso (?:encima|arriba|sobre los chips|en los chips|sobre los totopos)\b/g, 'queso on the chips'],
  [/\bcheese on (?:top|the chips)\b/g, 'queso on the chips'],
  [/\b(?:cebollas?|onions?) (?:y|con|and|with) cilantro\b/g, 'onions and cilantro'],
  [/\bcilantro (?:y|con|and|with) (?:cebollas?|onions?)\b/g, 'onions and cilantro'],
  [/\bsalsa (?:rojo|roja|red)\b/g, 'salsa roja'],
  [/\b(?:red salsa|red sauce)\b/g, 'salsa roja'],
  [/\bsalsa (?:green|verde)\b/g, 'salsa verde'],
  [/\b(?:green salsa|green sauce)\b/g, 'salsa verde'],
  [/\b(?:doble|double|extra) (?:carne|meat)\b/g, 'double carne'],
  [/\bgalon(?:es)?\b/g, 'gallon'],
  [/\b(?:termico|to go box|caja)\b/g, 'box']
]

/** Sinónimos/canónicos por token (se aplican a ambos lados: consulta y menú). */
const TOKEN_CANON: Record<string, string> = {
  vegetariano: 'vegetarian', vegetariana: 'vegetarian', vegetarianos: 'vegetarian', veggie: 'vegetarian', vegetal: 'vegetarian',
  huevo: 'huevo', huevos: 'huevo', egg: 'huevo', eggs: 'huevo',
  frijol: 'bean', frijoles: 'bean', bean: 'bean', beans: 'bean', refried: 'bean',
  arroz: 'rice', rice: 'rice',
  queso: 'cheese', cheese: 'cheese', quesito: 'cheese',
  pollo: 'pollo', chicken: 'pollo',
  asada: 'asada', steak: 'asada', beef: 'asada', sasada: 'asada',
  pastor: 'pastor', adobada: 'pastor', adobado: 'pastor',
  super: 'super', supreme: 'super', supremo: 'super', suprema: 'super', supremos: 'super', supremas: 'super',
  lengua: 'lengua', tongue: 'lengua', lingua: 'lengua',
  cabeza: 'cabeza', head: 'cabeza',
  maw: 'buche', tripa: 'buche',
  sausage: 'chorizo',
  jamon: 'jamon', ham: 'jamon',
  salchicha: 'salchicha', wiener: 'salchicha', hotdog: 'salchicha', salchichas: 'salchicha',
  milanesa: 'milanesa', breaded: 'milanesa', empanizada: 'milanesa', empanizado: 'milanesa',
  carne: 'carne', meat: 'carne',
  tortilla: 'tortilla', tortillas: 'tortilla',
  harina: 'flour', flour: 'flour',
  maiz: 'corn', corn: 'corn',
  medium: 'medium', mediana: 'medium', mediano: 'medium', medianas: 'medium', medianos: 'medium', regularsize: 'medium',
  large: 'large', grande: 'large', grandes: 'large', big: 'large',
  small: 'small', chica: 'small', chico: 'small', pequena: 'small', pequeno: 'small', chiquita: 'small',
  cebolla: 'onion', cebollas: 'onion', onion: 'onion', onions: 'onion', cebollita: 'onion',
  limon: 'lime', limones: 'lime', lime: 'lime', limes: 'lime',
  jalapeno: 'jalapeno', jalapenos: 'jalapeno', chile: 'jalapeno', chiles: 'jalapeno',
  pickled: 'pickled', vinagre: 'pickled', escabeche: 'pickled', curtido: 'pickled', curtidos: 'pickled',
  roja: 'roja', rojo: 'roja', red: 'roja',
  verde: 'verde', green: 'verde',
  salsa: 'salsa', sauce: 'salsa', salsas: 'salsa',
  agua: 'water', water: 'water', aguas: 'water',
  papitas: 'chips', totopos: 'chips', chip: 'chips', chips: 'chips',
  guac: 'guacamole', guacamole: 'guacamole', aguacate: 'guacamole', avocado: 'guacamole',
  doble: 'double', double: 'double',
  mexican: 'mexicana', mexicana: 'mexicana', mexicano: 'mexicana',
  nacho: 'nacho', nachos: 'nacho',
  soda: 'soda_generic', sodas: 'soda_generic', refresco: 'soda_generic', refrescos: 'soda_generic',
  lechuga: 'lettuce', lettuce: 'lettuce',
  mayonesa: 'mayo', mayo: 'mayo', mayonnaise: 'mayo',
  tomate: 'tomato', tomates: 'tomato', jitomate: 'tomato', jitomates: 'tomato', tomato: 'tomato', tomatoes: 'tomato',
  naranja: 'orange', orange: 'orange',
  fresa: 'strawberry', strawberry: 'strawberry',
  azucar: 'sugar', sugar: 'sugar',
  postre: 'dessert', postres: 'dessert', dessert: 'dessert', desserts: 'dessert', pastel: 'dessert', pasteles: 'dessert', cake: 'dessert', cakes: 'dessert',
  bebida: 'drink', bebidas: 'drink', drink: 'drink', drinks: 'drink', toma: 'drink',
  desayuno: 'breakfast', desayunos: 'breakfast', breakfast: 'breakfast',
  lado: 'side', side: 'side', sides: 'side', aparte: 'side'
}

const STOP_TOKENS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'y', 'and', 'of', 'the', 'a', 'an', 'with',
  'por', 'favor', 'please', 'para', 'me', 'da', 'das', 'quiero', 'want', 'order', 'orders', 'orden', 'ordenes', 'i', 'to', 'en', 'al', 'on',
  'get', 'can', 'could', 'have', 'dame', 'deme', 'pon', 'ponle', 'le', 'lo', 'tambien', 'also', 'some', 'otro', 'otra',
  'another', 'porfa', 'pls', 'that', 'this', 'ese', 'esa', 'este', 'esta', 'it', 'its', 'tu', 'su', 'mi', 'oz'
])

/** Tokens "suaves": se descartan si la consulta completa no coincide (ej. "extra guacamole" en burrito => Guacamole). */
const SOFT_TOKENS = new Set([
  'extra', 'add', 'agregar', 'agrega', 'mas', 'more', 'regular', 'plain', 'normal', 'sencillo', 'sencilla',
  'medium', 'large', 'small', 'soda_generic'
])
const SIZE_TOKENS = new Set(['medium', 'large', 'small'])

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, doce: 12, twelve: 12
}

function singularize(tok: string): string {
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1)
  return tok
}

function canonicalToken(tok: string): string {
  if (TOKEN_CANON[tok]) return TOKEN_CANON[tok]
  const sing = singularize(tok)
  if (TOKEN_CANON[sing]) return TOKEN_CANON[sing]
  return sing
}

function applyPhraseRewrites(normalized: string): string {
  let out = ` ${normalized} `
  for (const [re, rep] of PHRASE_REWRITES) out = out.replace(re, rep)
  return out.replace(/\s+/g, ' ').trim()
}

/** Tokens canónicos (sin stopwords, sin duplicados) de un texto. */
export function koreCanonicalTokens(text: unknown): string[] {
  const speechNormalized = normalizeKoreCustomerSpeech(String(text ?? ''), { mode: 'drive_thru' })
  const rewritten = applyPhraseRewrites(normalizeKoreText(speechNormalized))
  const out: string[] = []
  for (const raw of rewritten.split(' ')) {
    if (!raw || STOP_TOKENS.has(raw)) continue
    const c = canonicalToken(raw)
    if (c && !STOP_TOKENS.has(c) && !out.includes(c)) out.push(c)
  }
  return out
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
    cur = []
  }
  return prev[b.length]
}

function tokenMatches(q: string, t: string): boolean {
  if (q === t) return true
  if (q.length < 5 || t.length < 5 || q[0] !== t[0]) return false
  const max = Math.min(q.length, t.length) >= 8 ? 2 : 1
  return levenshtein(q, t, max) <= max
}

interface Candidate<T> {
  value: T
  tokens: string[]
  label: string
}

interface Ranked<T> extends Candidate<T> {
  qMatched: number
  coverage: number
  noPenalty: number
}

function rankCandidates<T>(queryTokens: string[], candidates: Candidate<T>[]): Ranked<T>[] {
  const queryHasNo = queryTokens.includes('no')
  const ranked: Ranked<T>[] = []
  for (const c of candidates) {
    if (c.tokens.length === 0) continue
    const matchedItem = new Set<number>()
    let qMatched = 0
    for (const q of queryTokens) {
      let hit = false
      c.tokens.forEach((t, idx) => {
        if (tokenMatches(q, t)) {
          matchedItem.add(idx)
          hit = true
        }
      })
      if (hit) qMatched++
    }
    if (qMatched === 0) continue
    ranked.push({
      ...c,
      qMatched,
      coverage: matchedItem.size / c.tokens.length,
      noPenalty: !queryHasNo && c.tokens.includes('no') ? 1 : 0
    })
  }
  ranked.sort(
    (a, b) =>
      b.qMatched - a.qMatched ||
      a.noPenalty - b.noPenalty ||
      b.coverage - a.coverage ||
      a.label.length - b.label.length
  )
  return ranked
}

interface PickResult<T> {
  match: T | null
  ambiguous: Ranked<T>[]
  partial: Ranked<T>[]
  droppedTokens: string[]
}

function pickOnce<T>(queryTokens: string[], candidates: Candidate<T>[], mode: 'item' | 'option'): PickResult<T> {
  const ranked = rankCandidates(queryTokens, candidates)
  const full = ranked.filter((r) => r.qMatched === queryTokens.length)
  if (queryTokens.length === 0 || full.length === 0) {
    return { match: null, ambiguous: [], partial: ranked.slice(0, 6), droppedTokens: [] }
  }
  const best = full[0]
  const second = full[1]
  const strictlyBetter = (a: Ranked<T>, b?: Ranked<T>) =>
    !b || a.noPenalty < b.noPenalty || (a.noPenalty === b.noPenalty && a.coverage > b.coverage + 1e-9)
  if (mode === 'item') {
    if (best.coverage >= 0.999 && strictlyBetter(best, second)) return { match: best.value, ambiguous: [], partial: [], droppedTokens: [] }
    if (best.coverage >= 0.6 && strictlyBetter(best, second)) return { match: best.value, ambiguous: [], partial: [], droppedTokens: [] }
  } else if (strictlyBetter(best, second)) {
    return { match: best.value, ambiguous: [], partial: [], droppedTokens: [] }
  }
  const ambiguous = full.filter((r) => r.noPenalty === best.noPenalty && Math.abs(r.coverage - best.coverage) < 0.34).slice(0, 6)
  return { match: null, ambiguous: ambiguous.length > 1 ? ambiguous : full.slice(0, 6), partial: [], droppedTokens: [] }
}

function pickCandidate<T>(queryTokens: string[], candidates: Candidate<T>[], mode: 'item' | 'option'): PickResult<T> {
  const first = pickOnce(queryTokens, candidates, mode)
  if (first.match || first.ambiguous.length > 0) return first
  const soft = queryTokens.filter((t) => SOFT_TOKENS.has(t))
  if (soft.length === 0 || soft.length === queryTokens.length) return first
  const reduced = queryTokens.filter((t) => !SOFT_TOKENS.has(t))
  const second = pickOnce(reduced, candidates, mode)
  return { ...second, droppedTokens: soft, partial: second.partial.length ? second.partial : first.partial }
}

/** Extrae una cantidad inicial ("2 tacos", "dos tacos", "2x taco", "taco x2"). */
function splitLeadingQuantity(text: string): { qty: number | null; rest: string } {
  const speechNormalized = normalizeKoreCustomerSpeech(String(text ?? ''), { mode: 'drive_thru' })
  const norm = normalizeKoreText(speechNormalized)
  // "3 taco plate" / "tres tacos con arroz y frijol" = 1 Taco Plate (los 3 tacos son el contenido del plato, no 3 platos)
  if (/^(?:3|tres|three)\s+tacos?\s+(?:plate|combo|(?:con|with)\s+(?:arroz|frijol(?:es)?|rice|beans?))\b/.test(norm)) {
    return { qty: null, rest: norm }
  }
  if (/^unos\s+(?:super\s+)?nachos?\b/.test(norm)) {
    return { qty: 1, rest: norm.replace(/^unos\s+/, '') }
  }
  let m = norm.match(/^(\d{1,3})\s*x?\s+(.+)$/)
  if (m) return { qty: Number(m[1]), rest: m[2] }
  m = norm.match(/^(.+?)\s+x\s*(\d{1,3})$/)
  if (m) return { qty: Number(m[2]), rest: m[1] }
  m = norm.match(/^([a-z]+)\s+(.+)$/)
  if (m && NUMBER_WORDS[m[1]] !== undefined && m[2]) return { qty: NUMBER_WORDS[m[1]], rest: m[2] }
  return { qty: null, rest: norm }
}

// ---------------------------------------------------------------------------
// Menú: mapeo desde app_menu_cache y resolución de productos
// ---------------------------------------------------------------------------

function toInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * Convierte filas de `app_menu_cache` (`toast_item_guid, name, category_name, description, price, modifier_groups_json,
 * is_available`) en `KoreMenuItem[]`. Descarta productos no disponibles, sin GUID/nombre o con precio inválido, y
 * deduplica grupos/opciones repetidos (ej. "Torta Modifiers" duplicado en Torta Vegetariana).
 */
export function mapAppMenuRowsToKoreMenu(
  rows: unknown[],
  opts?: { excludeCategory?: (category: string) => boolean }
): KoreMenuItem[] {
  const items: KoreMenuItem[] = []
  const seen = new Set<string>()
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = (raw || {}) as Record<string, any>
    if (r.is_available === false) continue
    const guid = String(r.toast_item_guid || r.guid || '').trim()
    const name = String(r.name || '').replace(/\s+/g, ' ').trim()
    const category = String(r.category_name || r.category || 'Menu').replace(/\s+/g, ' ').trim()
    const priceCents = toKoreCents(r.price)
    if (!guid || !name || priceCents <= 0) continue
    if (opts?.excludeCategory && opts.excludeCategory(category)) continue
    const key = `${guid}|${normalizeKoreText(name)}`
    if (seen.has(key)) continue
    seen.add(key)
    let description = String(r.description || '').replace(/\s+/g, ' ').trim()
    // Mismo saneamiento que lib/phone-agent.ts: Toast trae "Steamed Beef Head" en productos de Lengua.
    if (/\blengua\b/i.test(name) && /Steamed Beef Head/i.test(description)) {
      description = description.replace(/Steamed Beef Head/gi, 'Steamed Beef Tongue')
    }
    const groups: KoreModifierGroup[] = []
    const seenGroups = new Set<string>()
    const seenGroupSignatures = new Set<string>()
    const rawGroups = Array.isArray(r.modifier_groups_json) ? r.modifier_groups_json : Array.isArray(r.modifierGroups) ? r.modifierGroups : []
    for (const g of rawGroups) {
      if (!g || typeof g !== 'object') continue
      const gName = String(g.name || '').replace(/\s+/g, ' ').trim()
      const gGuid = String(g.guid || gName).trim()
      if (!gName || seenGroups.has(gGuid)) continue
      const options: KoreModifierOption[] = []
      const seenOpts = new Set<string>()
      const seenOptNames = new Set<string>()
      for (const o of Array.isArray(g.options) ? g.options : []) {
        const oName = String(o?.name || '').replace(/\s+/g, ' ').trim()
        const oGuid = String(o?.guid || oName).trim()
        const oNameNorm = normalizeKoreText(oName)
        if (!oName || seenOpts.has(oGuid) || seenOptNames.has(oNameNorm)) continue
        seenOpts.add(oGuid)
        seenOptNames.add(oNameNorm)
        options.push({ guid: oGuid, name: oName, price: centsToDollars(toKoreCents(o?.price)) })
      }
      if (options.length === 0) continue
      const gNameNorm = normalizeKoreText(gName)
      const optSig = `${gNameNorm}::${Array.from(seenOptNames).sort().join('|')}`
      const overlapsSameNamedGroup = groups.some(
        (existing) =>
          normalizeKoreText(existing.name) === gNameNorm &&
          existing.options.some((eo) => seenOptNames.has(normalizeKoreText(eo.name)))
      )
      if (seenGroupSignatures.has(optSig) || overlapsSameNamedGroup) continue
      seenGroups.add(gGuid)
      seenGroupSignatures.add(optSig)
      const multiSelect = g.isMultiSelect !== false && g.multiSelect !== false
      const required = Boolean(g.required)
      let minSelections = Math.max(0, toInt(g.minSelections, 0))
      if (required && minSelections < 1) minSelections = 1
      let maxSelections = Math.max(0, toInt(g.maxSelections, 0))
      if (!multiSelect) maxSelections = 1
      if (maxSelections > 0 && minSelections > maxSelections) minSelections = maxSelections
      groups.push({ guid: gGuid, name: gName, required: required || minSelections > 0, minSelections, maxSelections, multiSelect, options })
    }
    items.push({ guid, name, category, price: centsToDollars(priceCents), description, modifierGroups: groups })
  }
  return items
}

function itemCandidates(menu: KoreMenuItem[]): Candidate<KoreMenuItem>[] {
  return menu.map((it) => ({ value: it, tokens: koreCanonicalTokens(it.name), label: it.name }))
}

export interface KoreItemResolution {
  item: KoreMenuItem | null
  /** Coincidencias igual de buenas (ej. Medium/Large Horchata) que requieren preguntar al cliente. */
  ambiguous: KoreMenuItem[]
  /** Productos reales parecidos cuando no hubo coincidencia. */
  suggestions: KoreMenuItem[]
  droppedTokens: string[]
  wantsConTodo: boolean
  wantsCebollaAsada?: boolean
  wantsFrijolOlla?: boolean
  askedSmallSize: boolean
}

const SODA_ITEM_RE = /\b(coke|sprite|fanta)\b/i

function filterMenuSodas(menu: KoreMenuItem[], sizeTokens: string[]): KoreMenuItem[] {
  const sodas = menu.filter((m) => SODA_ITEM_RE.test(m.name))
  const wantedSize = sizeTokens.includes('large') ? 'large' : sizeTokens.includes('medium') ? 'medium' : null
  if (!wantedSize) return sodas
  const sized = sodas.filter((m) => koreCanonicalTokens(m.name).includes(wantedSize))
  return sized.length > 0 ? sized : sodas
}

const TACO_PLATE_MEAT_TOKENS = new Set([
  'asada',
  'pastor',
  'pollo',
  'cabeza',
  'lengua',
  'buche',
  'chorizo',
  'carnitas',
  'vegetarian'
])

/** Resuelve un nombre hablado/escrito a un `KoreMenuItem` real (nunca inventa). */
export function resolveKoreMenuItem(menu: KoreMenuItem[], rawName: unknown): KoreItemResolution {
  const safeMenu = Array.isArray(menu) ? menu : []
  const text = String(rawName ?? '').trim()
  const empty: KoreItemResolution = {
    item: null,
    ambiguous: [],
    suggestions: [],
    droppedTokens: [],
    wantsConTodo: false,
    wantsCebollaAsada: false,
    wantsFrijolOlla: false,
    askedSmallSize: false
  }
  if (!text) return empty
  if (KORE_COURTESY_STANDALONE_ITEMS[text]) {
    return { ...empty, item: KORE_COURTESY_STANDALONE_ITEMS[text] }
  }
  const byGuid = safeMenu.find((m) => m.guid === text)
  if (byGuid) return { ...empty, item: byGuid }
  const speechNormalized = normalizeKoreCustomerSpeech(text, { mode: 'drive_thru' })
  const allTokens = koreCanonicalTokens(speechNormalized)
  const wantsConTodo = allTokens.includes(CON_TODO_TOKEN)
  const wantsCebollaAsada = allTokens.includes(COURTESY_CEBOLLA_ASADA_TOKEN)
  const wantsFrijolOlla = allTokens.includes(COURTESY_FRIJOL_OLLA_TOKEN)
  let tokens = allTokens.filter(
    (t) => t !== CON_TODO_TOKEN && t !== COURTESY_CEBOLLA_ASADA_TOKEN && t !== COURTESY_FRIJOL_OLLA_TOKEN
  )
  const askedSmallSize = tokens.includes('small')

  // Prioridad absoluta: si la consulta pide únicamente cebolla asada y/o frijol de la olla, siempre es cortesía $0.00 (jamás Beans/Whole Beans pagado).
  const nonContainerTokens = tokens.filter((t) => !COURTESY_CONTAINER_TOKENS.has(t) && !SOFT_TOKENS.has(t))
  if (nonContainerTokens.length === 0 && (wantsCebollaAsada || wantsFrijolOlla)) {
    const primaryCourtesy = wantsCebollaAsada
      ? KORE_COURTESY_STANDALONE_ITEMS['courtesy:item:cebolla_asada']
      : KORE_COURTESY_STANDALONE_ITEMS['courtesy:item:frijol_de_la_olla']
    return {
      ...empty,
      item: primaryCourtesy,
      wantsConTodo,
      wantsCebollaAsada,
      wantsFrijolOlla,
      askedSmallSize
    }
  }

  const norm = normalizeKoreText(speechNormalized)
  const exact = safeMenu.filter((m) => normalizeKoreText(m.name) === norm)
  if (exact.length === 1) return { ...empty, item: exact[0] }

  // Evitar confundir "plato de tres tacos [de asada]" con "Plato Asada": siempre es Taco Plate ($9.69)
  if (tokens.includes('taco') && tokens.includes('plate')) {
    const tacoPlateItem = safeMenu.find((m) => normalizeKoreText(m.name) === 'taco plate')
    const extraTokens = tokens.filter((t) => t !== 'taco' && t !== 'plate' && !SOFT_TOKENS.has(t))
    if (tacoPlateItem && extraTokens.every((t) => TACO_PLATE_MEAT_TOKENS.has(t))) {
      return { ...empty, item: tacoPlateItem, droppedTokens: extraTokens, wantsConTodo, wantsCebollaAsada, wantsFrijolOlla, askedSmallSize }
    }
  }
  if (tokens.includes('soda_generic')) {
    const withoutGeneric = tokens.filter((t) => t !== 'soda_generic')
    const specificFlavorOrBrand = withoutGeneric.filter((t) => !SIZE_TOKENS.has(t))
    if (specificFlavorOrBrand.length === 0) {
      const sodas = filterMenuSodas(safeMenu, withoutGeneric)
      if (sodas.length > 0) return { ...empty, ambiguous: sodas, wantsConTodo, wantsCebollaAsada, wantsFrijolOlla, askedSmallSize }
    } else {
      tokens = withoutGeneric
    }
  }
  const pick = pickCandidate(tokens, itemCandidates(safeMenu), 'item')
  if (pick.match) {
    return {
      ...empty,
      item: pick.match,
      droppedTokens: pick.droppedTokens.filter((t) => t !== 'regular'),
      wantsConTodo,
      wantsCebollaAsada,
      wantsFrijolOlla,
      askedSmallSize
    }
  }
  if (pick.ambiguous.length > 0) {
    return { ...empty, ambiguous: pick.ambiguous.map((r) => r.value), wantsConTodo, wantsCebollaAsada, wantsFrijolOlla, askedSmallSize }
  }
  // Sugerencias: coincidencia parcial por nombre o por categoría (ej. "pastel" => Desserts: Flan, Cheesecake).
  const catCands: Candidate<KoreMenuItem>[] = safeMenu.map((it) => ({
    value: it,
    tokens: Array.from(new Set([...koreCanonicalTokens(it.name), ...koreCanonicalTokens(it.category)])),
    label: it.name
  }))
  const partial = rankCandidates(tokens, catCands).slice(0, 6).map((r) => r.value)
  return { ...empty, suggestions: partial, wantsConTodo, wantsCebollaAsada, wantsFrijolOlla, askedSmallSize }
}

// ---------------------------------------------------------------------------
// Modificadores
// ---------------------------------------------------------------------------

interface OptionRef {
  group: KoreModifierGroup
  option: KoreModifierOption
}

interface ModifierResolution {
  modifiers: KoreOrderModifier[]
  errors: string[]
  warnings: string[]
  conTodo: boolean
}

function describeOption(o: KoreModifierOption): string {
  const cents = toKoreCents(o.price)
  return cents === 0 ? `${o.name} (free)` : `${o.name} (${cents > 0 ? '+' : ''}${formatKoreUsd(cents)})`
}

function describeGroupRule(g: KoreModifierGroup): string {
  if (g.maxSelections > 0 && g.minSelections === g.maxSelections) return `choose exactly ${g.minSelections}`
  if (g.minSelections > 0 && g.maxSelections > 0) return `choose ${g.minSelections}-${g.maxSelections}`
  if (g.minSelections > 0) return `choose at least ${g.minSelections}`
  if (g.maxSelections > 0) return `optional, up to ${g.maxSelections}`
  return 'optional'
}

function describeGroup(g: KoreModifierGroup, maxOptions = 12): string {
  const opts = g.options.slice(0, maxOptions).map(describeOption).join(', ')
  return `${g.name} [${g.required ? 'REQUIRED, ' : ''}${describeGroupRule(g)}]: ${opts}`
}

/** Descripción compacta de un grupo de modificadores (reglas + opciones con precio) para prompts y resultados. */
export function describeKoreModifierGroup(g: KoreModifierGroup, maxOptions = 12): string {
  return describeGroup(g, maxOptions)
}

function parseStringList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function resolveModifiers(item: KoreMenuItem, rawList: string[]): ModifierResolution {
  const errors: string[] = []
  const warnings: string[] = []
  let conTodo = false
  const refs: OptionRef[] = []
  for (const g of item.modifierGroups) for (const o of g.options) refs.push({ group: g, option: o })
  const cands: Candidate<OptionRef>[] = refs.map((r) => ({ value: r, tokens: koreCanonicalTokens(r.option.name), label: r.option.name }))
  const counts = new Map<string, { ref: OptionRef; qty: number }>()
  for (const raw of rawList) {
    let text = raw
    let scopedRefs = refs
    let scopedCands = cands
    // Soporta "Grupo: Opción", validando que el grupo pertenezca realmente a este platillo.
    const colon = text.indexOf(':')
    if (colon > 0) {
      const rawGroup = text.slice(0, colon).trim()
      const groupNorm = normalizeKoreText(rawGroup)
      text = text.slice(colon + 1)
      if (groupNorm) {
        const matchedGroups = item.modifierGroups.filter((g) => normalizeKoreText(g.name) === groupNorm || g.guid === rawGroup)
        if (matchedGroups.length === 0) {
          errors.push(`Modifier group "${rawGroup}" does not belong to ${item.name}.`)
          continue
        }
        const allowedGuids = new Set(matchedGroups.map((g) => g.guid))
        scopedRefs = refs.filter((r) => allowedGuids.has(r.group.guid))
        scopedCands = cands.filter((c) => allowedGuids.has(c.value.group.guid))
      }
    }
    const { qty, rest } = splitLeadingQuantity(text)
    const times = qty === null ? 1 : qty
    if (!Number.isInteger(times) || times < 1 || times > 10) {
      errors.push(`Invalid repeat count in modifier "${raw}".`)
      continue
    }
    const exactRef = scopedRefs.filter((r) => normalizeKoreText(r.option.name) === rest)
    let ref: OptionRef | null = exactRef.length === 1 ? exactRef[0] : null
    if (!ref) {
      const rawTokens = koreCanonicalTokens(rest)
      const isNegated = rawTokens.includes('no')
      let matchedCourtesy = false
      const addCourtesy = (cMod: Omit<KoreOrderModifier, 'quantity'>) => {
        const cRef: OptionRef = {
          group: {
            guid: cMod.groupGuid,
            name: cMod.groupName,
            required: false,
            minSelections: 0,
            maxSelections: 0,
            multiSelect: true,
            options: [{ guid: cMod.guid, name: cMod.name, price: 0 }]
          },
          option: { guid: cMod.guid, name: cMod.name, price: 0 }
        }
        const key = `${cRef.group.guid}|${cRef.option.guid}`
        const prev = counts.get(key)
        counts.set(key, { ref: cRef, qty: (prev?.qty || 0) + times })
        matchedCourtesy = true
      }
      if (!isNegated && rawTokens.includes(COURTESY_CEBOLLA_ASADA_TOKEN)) {
        addCourtesy(KORE_COURTESY_MODIFIERS.cebolla_asada)
      }
      if (!isNegated && rawTokens.includes(COURTESY_FRIJOL_OLLA_TOKEN)) {
        addCourtesy(KORE_COURTESY_MODIFIERS.frijol_olla)
      }
      if (!isNegated && rawTokens.includes(CON_TODO_TOKEN)) {
        conTodo = true
        addCourtesy(KORE_COURTESY_MODIFIERS.con_todo)
      }
      const tokens = rawTokens.filter(
        (t) =>
          t !== CON_TODO_TOKEN &&
          t !== COURTESY_CEBOLLA_ASADA_TOKEN &&
          t !== COURTESY_FRIJOL_OLLA_TOKEN &&
          (!matchedCourtesy || !COURTESY_CONTAINER_TOKENS.has(t))
      )
      if (tokens.length === 0 || (matchedCourtesy && isNegated && tokens.length === 1 && tokens[0] === 'no')) continue
      if (isNegated && (rawTokens.includes(COURTESY_CEBOLLA_ASADA_TOKEN) || rawTokens.includes(COURTESY_FRIJOL_OLLA_TOKEN))) {
        // ej. "sin cebolla asada": no agrega cargo ni error
        if (tokens.every((t) => t === 'no' || COURTESY_CONTAINER_TOKENS.has(t))) continue
      }
      const pick = pickCandidate(tokens, scopedCands, 'option')
      if (pick.match) {
        ref = pick.match
      } else if (pick.ambiguous.length > 0) {
        errors.push(`Modifier "${raw}" is ambiguous for ${item.name}: ${pick.ambiguous.map((a) => `${a.value.option.name} (${a.value.group.name})`).join(' / ')}.`)
        continue
      } else {
        errors.push(`"${raw}" is not an available option for ${item.name}.`)
        continue
      }
    }
    const key = `${ref.group.guid}|${ref.option.guid}`
    const prev = counts.get(key)
    counts.set(key, { ref, qty: (prev?.qty || 0) + times })
  }
  const modifiers: KoreOrderModifier[] = []
  for (const { ref, qty } of counts.values()) {
    const priceCents = toKoreCents(ref.option.price)
    modifiers.push({
      guid: ref.option.guid,
      name: ref.option.name,
      price: centsToDollars(priceCents),
      priceCents,
      groupName: ref.group.name,
      groupGuid: ref.group.guid,
      quantity: qty
    })
  }
  return { modifiers, errors, warnings, conTodo }
}

/** Valida min/max/requerido por grupo. Devuelve errores legibles para el modelo. */
function validateGroups(item: KoreMenuItem, modifiers: KoreOrderModifier[]): string[] {
  const errors: string[] = []
  for (const g of item.modifierGroups) {
    const selected = modifiers.filter((m) => m.groupGuid === g.guid)
    const count = selected.reduce((a, m) => a + m.quantity, 0)
    if (!g.multiSelect && selected.some((m) => m.quantity > 1)) {
      errors.push(`${g.name} allows only one choice. ${describeGroup(g)}`)
      continue
    }
    if (count < g.minSelections) {
      errors.push(`${item.name} needs ${g.name}: ${describeGroupRule(g)} (has ${count}). Options: ${g.options.map(describeOption).join(', ')}.`)
    } else if (g.maxSelections > 0 && count > g.maxSelections) {
      errors.push(`${g.name} allows at most ${g.maxSelections} (got ${count}).`)
    }
  }
  // Contradicciones entre grupos: "No Guacamole" + "Guacamole" (+$1.99) en la misma línea.
  const keyOf = (m: KoreOrderModifier) =>
    koreCanonicalTokens(m.name)
      .filter((t) => t !== 'no')
      .sort()
      .join(' ')
  const negatives = modifiers.filter((m) => koreCanonicalTokens(m.name).includes('no'))
  const positives = modifiers.filter((m) => !koreCanonicalTokens(m.name).includes('no'))
  for (const neg of negatives) {
    const clash = positives.find((p) => keyOf(p) === keyOf(neg))
    if (clash) errors.push(`"${neg.name}" contradicts "${clash.name}" on ${item.name}; ask the customer which one they want.`)
  }
  return errors
}

// ---------------------------------------------------------------------------
// Ticket y resultados para el modelo
// ---------------------------------------------------------------------------

function modifierLabel(m: KoreOrderModifier): string {
  const qty = m.quantity > 1 ? `${m.quantity}x ` : ''
  const price = m.priceCents !== 0 ? ` ${m.priceCents > 0 ? '+' : ''}${formatKoreUsd(m.priceCents * m.quantity)}` : ''
  return `${qty}${m.name}${price}`
}

/** Línea legible del ticket: `L1: 2 x Taco Asada [Onions & Cilantro] - $4.58`. */
export function formatKoreTicketLine(line: KoreOrderLine): string {
  const l = recomputeLine(line)
  const mods = l.modifiers.length ? ` [${l.modifiers.map(modifierLabel).join(', ')}]` : ''
  const note = l.notes ? ` (note: ${l.notes})` : ''
  return `${l.lineId}: ${l.quantity} x ${l.name}${mods}${note} - ${formatKoreUsd(l.lineTotalCents)}`
}

function orderSummary(state: KoreOrderState, opts?: KoreToolOptions): Record<string, unknown> {
  const hasTax = opts?.taxRatePct !== undefined && opts?.taxRatePct !== null
  const totals = computeKoreTotals(state, hasTax ? Number(opts!.taxRatePct) : 0)
  const sessionKind: KoreSessionKind = state.sessionKind === 'driver_pickup' ? 'driver_pickup' : 'customer_order'
  const summary: Record<string, unknown> = {
    status: state.status,
    session_kind: sessionKind,
    ticket: state.lines.map(formatKoreTicketLine),
    item_count: totals.itemCount,
    subtotal: formatKoreUsd(totals.subtotalCents)
  }
  if (sessionKind === 'driver_pickup' && state.driverPickup) {
    summary.driver_pickup = {
      platform: state.driverPickup.platform,
      pickup_count: state.driverPickup.orders.length,
      orders: state.driverPickup.orders,
      ...(state.driverPickup.notes ? { notes: state.driverPickup.notes } : {})
    }
  }
  if (hasTax) {
    summary.tax_estimated = formatKoreUsd(totals.taxCents)
    summary.total = formatKoreUsd(totals.totalCents)
  } else {
    summary.total_before_tax = formatKoreUsd(totals.subtotalCents)
  }
  return summary
}

function ok(state: KoreOrderState, action: string, message: string, opts?: KoreToolOptions, extra?: Record<string, unknown>): KoreToolOutcome {
  return { state, result: { ok: true, action, message, ...(extra || {}), ...orderSummary(state, opts) } }
}

function fail(state: KoreOrderState, code: string, message: string, opts?: KoreToolOptions, extra?: Record<string, unknown>): KoreToolOutcome {
  return { state, result: { ok: false, error_code: code, message, ...(extra || {}), ...orderSummary(state, opts) } }
}

function suggestionList(items: KoreMenuItem[]): Array<{ name: string; price: string }> {
  return items.slice(0, 6).map((it) => ({ name: it.name, price: formatKoreUsd(toKoreCents(it.price)) }))
}

function normalizeState(state: KoreOrderState | null | undefined): KoreOrderState {
  const lines = Array.isArray(state?.lines) ? state!.lines.filter(Boolean) : []
  const status: KoreOrderStatus =
    state?.status === 'confirmed' || state?.status === 'cancelled' ? state.status : 'building'
  const hasDriverPickup =
    state?.driverPickup &&
    typeof state.driverPickup === 'object' &&
    Array.isArray(state.driverPickup.orders)
  const sessionKind: KoreSessionKind =
    state?.sessionKind === 'driver_pickup' || (lines.length === 0 && hasDriverPickup && state!.driverPickup!.orders.length > 0)
      ? 'driver_pickup'
      : 'customer_order'
  const maxExisting = lines.reduce((acc, l) => {
    const m = /^L(\d+)$/.exec(String(l.lineId || ''))
    return m ? Math.max(acc, Number(m[1])) : acc
  }, 0)
  const next = Number.isInteger(state?.nextLineNumber) && (state!.nextLineNumber as number) > maxExisting ? (state!.nextLineNumber as number) : maxExisting + 1
  const cancelReason = status === 'cancelled' ? sanitizeNotes(state?.cancelReason) : undefined
  return {
    lines,
    status,
    sessionKind,
    driverPickup: sessionKind === 'driver_pickup' && hasDriverPickup ? state!.driverPickup! : null,
    nextLineNumber: next,
    version: Number.isInteger(state?.version) ? (state!.version as number) : 0,
    ...(cancelReason ? { cancelReason } : {})
  }
}

function parseQuantity(value: unknown, fallback: number | null): { qty: number | null; error?: string } {
  if (value === undefined || value === null || value === '') return { qty: fallback }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { qty: null, error: `Quantity must be a whole number (got "${String(value)}").` }
  if (n < 1) return { qty: null, error: `Quantity must be at least 1 (got ${n}). Use remove_item to delete a line.` }
  if (n > KORE_MAX_LINE_QUANTITY) return { qty: null, error: `Quantity ${n} exceeds the drive-thru limit of ${KORE_MAX_LINE_QUANTITY} per line.` }
  return { qty: n }
}

function sanitizeNotes(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = String(value).replace(/\s+/g, ' ').trim().slice(0, 140)
  return s || undefined
}

function parseArgs(args: unknown): Record<string, any> {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof args === 'object' ? (args as Record<string, any>) : {}
}

function totalPieces(lines: KoreOrderLine[]): number {
  return lines.reduce((a, l) => a + (Number.isInteger(l.quantity) ? l.quantity : 0), 0)
}

function bump(state: KoreOrderState, lines: KoreOrderLine[], extra?: Partial<KoreOrderState>): KoreOrderState {
  const merged: KoreOrderState = { ...state, ...extra, lines, version: (state.version || 0) + 1 }
  // `cancelReason` solo vive mientras la orden siga cancelada (ej. "EBT: pasa al comedor"); cualquier reapertura lo limpia.
  if (merged.status !== 'cancelled') delete merged.cancelReason
  return merged
}

function reopenWarning(state: KoreOrderState): string | null {
  return state.status === 'confirmed' ? 'The order was confirmed before; it is now re-opened. Read back the new total and confirm again.' : null
}

function findLine(state: KoreOrderState, lineId: unknown): KoreOrderLine | undefined {
  const id = String(lineId ?? '').trim().toUpperCase().replace(/^LINE\s*/, 'L').replace(/^(\d+)$/, 'L$1')
  return state.lines.find((l) => String(l.lineId).toUpperCase() === id)
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

function toolAddItem(state: KoreOrderState, menu: KoreMenuItem[], args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const rawName = String(args.item_name ?? args.itemName ?? args.name ?? '').trim()
  if (!rawName) return fail(state, 'missing_item_name', 'item_name is required.', opts)
  if (isLikelyBackgroundMediaSpeech(rawName)) {
    return fail(
      state,
      'background_media_ignored',
      'Input looks like background TV/radio monologue, not a food order. Do not add anything; briefly ask the customer to repeat their order.',
      opts
    )
  }
  const rawModifiersList = parseStringList(args.modifiers)
  const nadaItemCheck = detectAmbiguousMeatNadaCollision(rawName)
  const nadaModCheck = !nadaItemCheck.matched
    ? rawModifiersList.map((m) => detectAmbiguousMeatNadaCollision(m)).find((c) => c.matched)
    : null
  const activeNadaCollision = nadaItemCheck.matched ? nadaItemCheck : nadaModCheck
  if (activeNadaCollision?.matched) {
    const hintedQty =
      activeNadaCollision.quantity ??
      (typeof args.quantity === 'number' && Number.isInteger(args.quantity) && args.quantity > 0 ? args.quantity : null)
    const confirmEs = hintedQty && hintedQty > 1 ? `¿${hintedQty} de asada?` : '¿Te refieres a carne asada?'
    return fail(
      state,
      'clarify_meat_nada_asada',
      `Phonetic STT collision detected ("nada" sounds like "de asada"). Do NOT add anything yet — ask the customer briefly: "${confirmEs}" / "Did you mean carne asada?" before calling add_item again.`,
      opts,
      { suggested_meat: 'Asada', ...(hintedQty ? { detected_quantity: hintedQty } : {}) }
    )
  }

  const lead = splitLeadingQuantity(rawName)
  const qtyParse = parseQuantity(args.quantity, lead.qty ?? 1)
  if (qtyParse.error || qtyParse.qty === null) return fail(state, 'invalid_quantity', qtyParse.error || 'Invalid quantity.', opts)
  const quantity = qtyParse.qty
  const res = resolveKoreMenuItem(menu, lead.qty !== null ? lead.rest : rawName)
  if (!res.item) {
    // Desayunos fuera de horario: no obligar al cliente a escoger entre platillos de desayuno que luego serían rechazados.
    const bwAmb = isKoreBreakfastOpen(opts?.now)
    const allAmbiguousBreakfast = res.ambiguous.length > 0 && res.ambiguous.every((a) => isKoreBreakfastItem(a))
    const genericBreakfastWords =
      res.ambiguous.length === 0 &&
      /\b(?:desayunos?|breakfast|huevos?|eggs?|chilaquiles?)\b/i.test(
        String(rawName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      )
    if (!bwAmb.open && (allAmbiguousBreakfast || genericBreakfastWords)) {
      return fail(
        state,
        'breakfast_closed',
        `Breakfast is only available until ${KORE_BREAKFAST_CUTOFF_LABEL} at all Tacos Gavilan locations (now ${bwAmb.localTimeLabel}). Do NOT ask which breakfast item. Kindly say breakfast ended at 2:00 PM (ES: "Los desayunos son hasta las 2:00 de la tarde") and offer the regular menu: Regular/Super burritos, tacos, quesadillas, mulitas, tortas or platos.`,
        opts,
        { cutoff: KORE_BREAKFAST_CUTOFF_LABEL, local_time: bwAmb.localTimeLabel }
      )
    }
    const ambiguousOptions = bwAmb.open ? res.ambiguous : res.ambiguous.filter((a) => !isKoreBreakfastItem(a))
    if (ambiguousOptions.length > 0) {
      const isEn = opts?.lang === 'en'
      const hasFoodFamily = ambiguousOptions.some((a) =>
        /\b(burritos?|quesadillas?|mulitas?|tortas?|sopes?|tacos?|nachos?|platos?)\b/i.test(a.category)
      )
      if (!isEn) {
        const sizeHintEs = res.askedSmallSize
          ? ' No existe tamaño chico: el menor tamaño es Mediana (22 oz); jamás digas "chica" ni "pequeña".'
          : ''
        const regSuperHintEs = hasFoodFamily
          ? ' JAMÁS digas "tamaño" en comida: pregunta en ESPAÑOL qué carne desea (y "¿Regular o Super?" para burritos, quesadillas o mulitas). PROHIBIDO responder en inglés.'
          : ' Pregunta brevemente en ESPAÑOL cuál opción prefiere.'
        return fail(state, 'ambiguous_item', `"${rawName}" coincide con varias opciones del menú.${sizeHintEs}${regSuperHintEs}`, opts, {
          options: suggestionList(ambiguousOptions)
        })
      }
      const sizeHint = res.askedSmallSize
        ? ' There is no small size: Medium (22 oz) is the smallest (never say "chica", "pequeña", or "small").'
        : ''
      const regSuperHint = hasFoodFamily
        ? ' Never say "tamaño" or "size" for food items — ask which meat (and Regular or Super for burritos/quesadillas/mulitas).'
        : ''
      return fail(state, 'ambiguous_item', `"${rawName}" matches several menu items. Ask the customer which one.${sizeHint}${regSuperHint}`, opts, {
        options: suggestionList(ambiguousOptions)
      })
    }
    const suggestionOptions = bwAmb.open ? res.suggestions : res.suggestions.filter((s) => !isKoreBreakfastItem(s))
    return fail(state, 'item_not_found', `"${rawName}" is not on this store's menu. Do not invent it; offer a real alternative.`, opts, {
      suggestions: suggestionList(suggestionOptions)
    })
  }
  const item = res.item
  // Si pidió ambas cortesías sueltas en una sola frase (ej. "cebolla asada y frijol de la olla") sin platillo pagado:
  if (
    item.guid === 'courtesy:item:cebolla_asada' &&
    res.wantsCebollaAsada &&
    res.wantsFrijolOlla &&
    rawModifiersList.length === 0
  ) {
    const sub1 = toolAddItem(state, menu, { item_name: 'courtesy:item:cebolla_asada', quantity, notes: args.notes }, opts)
    if (!(sub1.result as any).ok) return sub1
    const sub2 = toolAddItem(sub1.state, menu, { item_name: 'courtesy:item:frijol_de_la_olla', quantity }, opts)
    return sub2
  }

  let effectiveRawModifiers = [...rawModifiersList]
  if (
    normalizeKoreText(item.name) === 'taco plate' &&
    effectiveRawModifiers.length === 0 &&
    res.droppedTokens.length === 1 &&
    TACO_PLATE_MEAT_TOKENS.has(res.droppedTokens[0])
  ) {
    const inferredMeat = res.droppedTokens[0] === 'vegetarian' ? 'Vegetariano' : res.droppedTokens[0]
    effectiveRawModifiers = [`3x Taco ${inferredMeat}`]
  }
  if (isKoreBreakfastItem(item)) {
    const bw = isKoreBreakfastOpen(opts?.now)
    if (!bw.open) {
      return fail(
        state,
        'breakfast_closed',
        `Breakfast items (like ${item.name}) are only available until ${KORE_BREAKFAST_CUTOFF_LABEL} at all Tacos Gavilan locations (now ${bw.localTimeLabel}). Do NOT add it. Kindly say breakfast ended at 2:00 PM (ES: "Los desayunos son hasta las 2:00 de la tarde") and offer the regular menu: Regular/Super burritos, tacos, quesadillas, mulitas, tortas or platos.`,
        opts,
        { item: item.name, cutoff: KORE_BREAKFAST_CUTOFF_LABEL, local_time: bw.localTimeLabel }
      )
    }
  }
  const isStandaloneCourtesyItem = Boolean(KORE_COURTESY_STANDALONE_ITEMS[item.guid])
  if (!isStandaloneCourtesyItem) {
    const existingModTokens = new Set(effectiveRawModifiers.flatMap((m) => koreCanonicalTokens(m)))
    if (res.wantsCebollaAsada && !existingModTokens.has(COURTESY_CEBOLLA_ASADA_TOKEN)) {
      effectiveRawModifiers.push('Cebolla Asada')
    }
    if (res.wantsFrijolOlla && !existingModTokens.has(COURTESY_FRIJOL_OLLA_TOKEN)) {
      effectiveRawModifiers.push('Frijol de la Olla')
    }
    if (res.wantsConTodo && !existingModTokens.has(CON_TODO_TOKEN)) {
      effectiveRawModifiers.push('Con Todo')
    }
  }
  const modRes = resolveModifiers(item, effectiveRawModifiers)
  if (modRes.errors.length > 0) {
    return fail(state, 'invalid_modifiers', modRes.errors.join(' '), opts, {
      item: item.name,
      available_modifier_groups: item.modifierGroups.map((g) => describeGroup(g))
    })
  }
  const groupErrors = validateGroups(item, modRes.modifiers)
  if (groupErrors.length > 0) {
    const errMsg =
      opts?.lang === 'en'
        ? groupErrors.join(' ')
        : `Falta elegir opción obligatoria (pregunta brevemente 100% en ESPAÑOL): ${groupErrors.join(' ')}`
    return fail(state, 'modifier_rules', errMsg, opts, { item: item.name })
  }
  if (totalPieces(state.lines) + quantity > KORE_MAX_ORDER_ITEMS) {
    return fail(state, 'order_too_large', `A drive-thru order is limited to ${KORE_MAX_ORDER_ITEMS} items.`, opts)
  }
  const warnings: string[] = []
  let base = state
  if (state.status === 'cancelled') {
    base = { ...state, lines: [], status: 'building' }
    warnings.push('The previous order was cancelled; a new order was started.')
  }
  const reopen = reopenWarning(state)
  if (reopen) warnings.push(reopen)
  if (res.droppedTokens.some((t) => SIZE_TOKENS.has(t))) warnings.push(`Size does not apply to ${item.name}; added without size.`)
  const lineNumber = base.nextLineNumber || 1
  const line = recomputeLine({
    lineId: `L${lineNumber}`,
    itemGuid: item.guid,
    name: item.name,
    category: item.category,
    quantity,
    basePrice: item.price,
    basePriceCents: toKoreCents(item.price),
    unitPrice: 0,
    unitPriceCents: 0,
    modifiers: modRes.modifiers,
    notes: sanitizeNotes(args.notes),
    lineTotal: 0,
    lineTotalCents: 0
  })
  const next = bump(base, [...base.lines, line], {
    status: 'building',
    sessionKind: 'customer_order',
    driverPickup: null,
    nextLineNumber: lineNumber + 1
  })
  return ok(next, 'added', `Added ${formatKoreTicketLine(line)}`, opts, {
    line_id: line.lineId,
    ...(warnings.length ? { warnings } : {})
  })
}

function toolAddItems(state: KoreOrderState, menu: KoreMenuItem[], args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const rawItems = args.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail(state, 'missing_items', 'items must be a non-empty array.', opts)
  }
  if (rawItems.length > 25) {
    return fail(state, 'too_many_items', 'add_items accepts at most 25 entries per call.', opts)
  }
  let working = state
  const addedLines: string[] = []
  const lineIds: string[] = []
  const failedItems: Array<Record<string, unknown>> = []
  for (const rawEntry of rawItems) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      failedItems.push({ item_name: String(rawEntry ?? ''), error_code: 'invalid_entry', message: 'Each entry must be an object with item_name.' })
      continue
    }
    const sub = toolAddItem(working, menu, rawEntry as Record<string, any>, opts)
    if (sub.result.ok === true) {
      working = sub.state
      const last = working.lines[working.lines.length - 1]
      if (last) {
        addedLines.push(formatKoreTicketLine(last))
        lineIds.push(last.lineId)
      }
    } else {
      failedItems.push({
        item_name: String((rawEntry as any).item_name ?? (rawEntry as any).itemName ?? ''),
        error_code: sub.result.error_code,
        message: sub.result.message,
        ...(sub.result.options ? { options: sub.result.options } : {}),
        ...(sub.result.suggestions ? { suggestions: sub.result.suggestions } : {}),
        ...(sub.result.available_modifier_groups ? { available_modifier_groups: sub.result.available_modifier_groups } : {})
      })
    }
  }
  if (failedItems.length === 0) {
    const batchMsg =
      opts?.lang === 'en'
        ? `Added ${addedLines.length} line(s): ${addedLines.join(' | ')}`
        : `Agregados (${addedLines.length}): ${addedLines.join(' | ')}. Confirma brevemente 100% en ESPAÑOL.`
    return ok(working, 'added_batch', batchMsg, opts, {
      added_count: addedLines.length,
      line_ids: lineIds
    })
  }
  const msg =
    opts?.lang === 'en'
      ? addedLines.length
        ? `Added ${addedLines.join(' | ')}; clarify remaining item(s): ${failedItems.map((f) => String(f.message)).join(' ')}`
        : failedItems.map((f) => String(f.message)).join(' ')
      : addedLines.length
        ? `Ya se agregó ${addedLines.join(' | ')}; falta aclarar 100% en ESPAÑOL: ${failedItems.map((f) => String(f.message)).join(' ')} (PROHIBIDO hablar en inglés).`
        : failedItems.map((f) => String(f.message)).join(' ')
  return fail(working, String(failedItems[0].error_code || 'batch_error'), msg, opts, {
    partial: addedLines.length > 0,
    added_lines: addedLines,
    line_ids: lineIds,
    failed_items: failedItems
  })
}

function toolUpdateItem(state: KoreOrderState, menu: KoreMenuItem[], args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  if (state.status === 'cancelled') return fail(state, 'order_cancelled', 'The order is cancelled. Use add_item to start a new order.', opts)
  const line = findLine(state, args.line_id ?? args.lineId)
  if (!line) return fail(state, 'line_not_found', `Line "${String(args.line_id ?? '')}" does not exist. Call get_order to see valid line ids.`, opts)
  const item = KORE_COURTESY_STANDALONE_ITEMS[line.itemGuid] || menu.find((m) => m.guid === line.itemGuid)
  if (!item) return fail(state, 'item_unavailable', `${line.name} is no longer on the menu; remove it and offer an alternative.`, opts)
  const qtyParse = parseQuantity(args.quantity, line.quantity)
  if (qtyParse.error || qtyParse.qty === null) return fail(state, 'invalid_quantity', qtyParse.error || 'Invalid quantity.', opts)

  let modifiers: KoreOrderModifier[] = line.modifiers.map((m) => ({ ...m }))
  const errors: string[] = []
  if (args.modifiers !== undefined && args.modifiers !== null) {
    const r = resolveModifiers(item, parseStringList(args.modifiers))
    errors.push(...r.errors)
    modifiers = r.modifiers
  }
  const toAdd = parseStringList(args.add_modifiers)
  if (toAdd.length) {
    const r = resolveModifiers(item, toAdd)
    errors.push(...r.errors)
    for (const m of r.modifiers) {
      const existing = modifiers.find((x) => x.guid === m.guid && x.groupGuid === m.groupGuid)
      if (existing) existing.quantity += m.quantity
      else modifiers.push(m)
    }
  }
  const toRemove = parseStringList(args.remove_modifiers)
  if (toRemove.length) {
    const r = resolveModifiers(item, toRemove)
    errors.push(...r.errors)
    for (const m of r.modifiers) {
      const existing = modifiers.find((x) => x.guid === m.guid && x.groupGuid === m.groupGuid)
      if (!existing) {
        errors.push(`${m.name} is not on line ${line.lineId}.`)
        continue
      }
      existing.quantity -= m.quantity
    }
    modifiers = modifiers.filter((m) => m.quantity > 0)
  }
  if (errors.length) {
    return fail(state, 'invalid_modifiers', errors.join(' '), opts, { available_modifier_groups: item.modifierGroups.map((g) => describeGroup(g)) })
  }
  const groupErrors = validateGroups(item, modifiers)
  if (groupErrors.length) return fail(state, 'modifier_rules', groupErrors.join(' '), opts, { item: item.name })
  const newQty = qtyParse.qty
  if (totalPieces(state.lines) - line.quantity + newQty > KORE_MAX_ORDER_ITEMS) {
    return fail(state, 'order_too_large', `A drive-thru order is limited to ${KORE_MAX_ORDER_ITEMS} items.`, opts)
  }
  const notes = args.notes === undefined ? line.notes : sanitizeNotes(args.notes)
  const updated = recomputeLine({ ...line, quantity: newQty, modifiers, notes })
  const lines = state.lines.map((l) => (l.lineId === line.lineId ? updated : l))
  const reopen = reopenWarning(state)
  const next = bump(state, lines, { status: 'building' })
  return ok(next, 'updated', `Updated ${formatKoreTicketLine(updated)}`, opts, reopen ? { warnings: [reopen] } : undefined)
}

function toolRemoveItem(state: KoreOrderState, menu: KoreMenuItem[], args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  if (state.status === 'cancelled') return fail(state, 'order_cancelled', 'The order is cancelled. Use add_item to start a new order.', opts)
  if (state.lines.length === 0) return fail(state, 'empty_order', 'The order is empty; there is nothing to remove.', opts)
  let line: KoreOrderLine | undefined
  const hasLineId = args.line_id !== undefined && args.line_id !== null && String(args.line_id).trim() !== ''
  if (hasLineId) {
    line = findLine(state, args.line_id)
    if (!line) return fail(state, 'line_not_found', `Line "${String(args.line_id)}" does not exist. Call get_order to see valid line ids.`, opts)
  } else {
    const rawName = String(args.item_name ?? args.itemName ?? '').trim()
    if (!rawName) return fail(state, 'missing_target', 'Provide line_id or item_name.', opts)
    const res = resolveKoreMenuItem(menu, rawName)
    let matches = res.item ? state.lines.filter((l) => l.itemGuid === res.item!.guid) : []
    if (matches.length === 0) {
      const tokens = koreCanonicalTokens(rawName)
      matches = state.lines.filter((l) => {
        const lt = koreCanonicalTokens(l.name)
        return tokens.length > 0 && tokens.every((t) => lt.some((x) => tokenMatches(t, x)))
      })
    }
    if (matches.length === 0) return fail(state, 'line_not_found', `No ticket line matches "${rawName}".`, opts)
    if (matches.length > 1) {
      return fail(state, 'ambiguous_line', `Several lines match "${rawName}". Ask which one and use its line_id.`, opts, {
        matching_lines: matches.map(formatKoreTicketLine)
      })
    }
    line = matches[0]
  }
  const qtyParse = parseQuantity(args.quantity, line.quantity)
  if (qtyParse.error || qtyParse.qty === null) return fail(state, 'invalid_quantity', qtyParse.error || 'Invalid quantity.', opts)
  const reopen = reopenWarning(state)
  const extra = reopen ? { warnings: [reopen] } : undefined
  if (qtyParse.qty < line.quantity) {
    const updated = recomputeLine({ ...line, quantity: line.quantity - qtyParse.qty })
    const next = bump(state, state.lines.map((l) => (l.lineId === line!.lineId ? updated : l)), { status: 'building' })
    return ok(next, 'removed', `Removed ${qtyParse.qty} from ${line.lineId}; now ${formatKoreTicketLine(updated)}`, opts, extra)
  }
  const next = bump(state, state.lines.filter((l) => l.lineId !== line!.lineId), { status: 'building' })
  return ok(next, 'removed', `Removed ${formatKoreTicketLine(line)}`, opts, extra)
}

function toolSearchMenu(state: KoreOrderState, menu: KoreMenuItem[], args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const query = String(args.query ?? args.q ?? '').trim()
  if (!query) return fail(state, 'missing_query', 'query is required.', opts)
  const tokens = koreCanonicalTokens(query).filter((t) => t !== CON_TODO_TOKEN)
  const cands: Candidate<KoreMenuItem>[] = menu.map((it) => ({
    value: it,
    tokens: Array.from(new Set([...koreCanonicalTokens(it.name), ...koreCanonicalTokens(it.category)])),
    label: it.name
  }))
  const resolved = resolveKoreMenuItem(menu, query)
  let ranked = rankCandidates(tokens, cands)
  const fullMatches = ranked.filter((r) => r.qMatched === tokens.length)
  if (fullMatches.length > 0) ranked = fullMatches
  const results = ranked.slice(0, 10).map((r) => r.value)
  if (resolved.item && !results.some((r) => r.guid === resolved.item!.guid)) results.unshift(resolved.item)
  for (const amb of resolved.ambiguous) {
    if (!results.some((r) => r.guid === amb.guid)) results.push(amb)
  }
  if (results.length === 0) {
    return fail(state, 'no_results', `Nothing on this store's menu matches "${query}". Do not invent items or prices.`, opts)
  }
  const detailed = resolved.item ? [resolved.item] : results.length <= 2 ? results : []
  const hasBreakfastResult = results.slice(0, 10).some((it) => isKoreBreakfastItem(it))
  const bwSearch = hasBreakfastResult ? isKoreBreakfastOpen(opts?.now) : null
  return {
    state,
    result: {
      ok: true,
      action: 'search',
      query,
      ...(bwSearch
        ? {
            breakfast_available: bwSearch.open,
            breakfast_note: bwSearch.open
              ? `Breakfast is available until ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${bwSearch.localTimeLabel}).`
              : `Breakfast ended at ${KORE_BREAKFAST_CUTOFF_LABEL} (now ${bwSearch.localTimeLabel}); offer the regular menu instead.`
          }
        : {}),
      results: results.slice(0, 10).map((it) => ({ name: it.name, category: it.category, price: formatKoreUsd(toKoreCents(it.price)) })),
      details: detailed.map((it) => ({
        name: it.name,
        price: formatKoreUsd(toKoreCents(it.price)),
        description: it.description.slice(0, 160),
        modifier_groups: it.modifierGroups.map((g) => describeGroup(g))
      })),
      status: state.status
    }
  }
}

const DRIVER_PLATFORM_MAP: Array<[RegExp, string]> = [
  [/\b(?:door\s*dash|dor\s*dash|dordash|ordash|(?:nas)?redor\s*da\w*|(?:de|por|para)\s+gordas|gordash)\b/i, 'DoorDash'],
  [/\buber(?:\s*eats)?\b/i, 'Uber Eats'],
  [/\bgrub\s*hub\b/i, 'Grubhub'],
  [/\bcaviar\b/i, 'Caviar'],
  [/\bpostmates\b/i, 'Postmates'],
  [/\b(?:tacos?\s*gavilan|order\.online|web(?:site)?|online|direct[oa]?)\b/i, 'Tacos Gavilan'],
  [/\b(?:other|otr[oa]s?)\b/i, 'Other']
]

export function normalizeKoreDriverPlatform(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  for (const [re, canon] of DRIVER_PLATFORM_MAP) {
    if (re.test(s)) return canon
  }
  return null
}

function sanitizeOrderCode(raw: unknown): string | undefined {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return s || undefined
}

function sanitizeDriverOrderExtras(ro: any): Partial<KoreDriverPickupOrder> {
  if (!ro || typeof ro !== 'object') return {}
  const out: Partial<KoreDriverPickupOrder> = {}
  if (isValidKoreDriverOrderLookupStatus(ro.lookupStatus)) out.lookupStatus = ro.lookupStatus
  if (ro.matchedDisplayNumber !== undefined) {
    out.matchedDisplayNumber = ro.matchedDisplayNumber === null ? null : String(ro.matchedDisplayNumber).trim().slice(0, 40) || null
  }
  if (ro.matchedShortKey !== undefined) {
    out.matchedShortKey = ro.matchedShortKey === null ? null : String(ro.matchedShortKey).trim().slice(0, 40) || null
  }
  if (ro.matchedPlatform !== undefined) {
    out.matchedPlatform = ro.matchedPlatform === null ? null : String(ro.matchedPlatform).trim().slice(0, 40) || null
  }
  if (ro.itemsCount !== undefined) {
    const ic = Number(ro.itemsCount)
    out.itemsCount = ro.itemsCount === null ? null : Number.isInteger(ic) && ic >= 0 && ic <= 500 ? ic : null
  }
  if (typeof ro.packedAndSealed === 'boolean') out.packedAndSealed = ro.packedAndSealed
  return out
}

function toolRegisterDriverPickup(state: KoreOrderState, args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const hasExplicitPlatform = args.platform !== undefined && args.platform !== null && String(args.platform).trim() !== ''
  const platform = hasExplicitPlatform
    ? normalizeKoreDriverPlatform(args.platform)
    : state.driverPickup?.platform || 'Other'
  if (!platform) {
    return fail(
      state,
      'invalid_platform',
      'Ask the driver which delivery platform they are picking up for (DoorDash, Uber Eats, Grubhub, Caviar, Postmates, Tacos Gavilan, or Other).',
      opts
    )
  }
  const rawOrders = args.orders
  if (!Array.isArray(rawOrders) || rawOrders.length === 0) {
    return fail(state, 'missing_driver_orders', 'Ask the driver for the customer name or order code of each order they are picking up.', opts)
  }
  const parsedIncoming: KoreDriverPickupOrder[] = []
  for (let i = 0; i < rawOrders.length; i++) {
    const entry = rawOrders[i]
    if (!entry || typeof entry !== 'object') {
      return fail(state, 'invalid_driver_order', `Order #${i + 1} must include customer_name or order_code.`, opts)
    }
    const orderCode = sanitizeOrderCode((entry as any).order_code ?? (entry as any).orderCode)
    let customerName = String((entry as any).customer_name ?? (entry as any).customerName ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    if (customerName.length < 2 && orderCode && orderCode.length >= 2) {
      customerName = `Orden ${orderCode}`
    }
    if (customerName.length < 2) {
      return fail(state, 'missing_customer_name', `Order #${i + 1} is missing customer_name; ask the driver for the customer name or code on their app.`, opts)
    }
    const extras = sanitizeDriverOrderExtras(entry)
    parsedIncoming.push({ customerName, ...(orderCode ? { orderCode } : {}), ...extras })
  }

  // Fusionar con órdenes previas del mismo repartidor (salvo replace===true o cambio de plataforma tras cancelar)
  const shouldReplace =
    Boolean(args.replace) ||
    state.status === 'cancelled' ||
    !state.driverPickup ||
    (hasExplicitPlatform && state.driverPickup.platform !== platform && state.driverPickup.platform !== 'Other')
  const merged: KoreDriverPickupOrder[] = shouldReplace ? [] : state.driverPickup!.orders.map((o) => ({ ...o }))
  for (const inc of parsedIncoming) {
    const normName = normalizeKoreText(inc.customerName)
    const normCode = inc.orderCode ? normalizeKoreText(inc.orderCode) : ''
    const existing = merged.find((m) => {
      const mName = normalizeKoreText(m.customerName)
      const mCode = m.orderCode ? normalizeKoreText(m.orderCode) : ''
      if (normCode && mCode) return mCode === normCode || (mName === normName && mCode === normCode)
      return mName === normName
    })
    if (existing) {
      if (inc.orderCode && !existing.orderCode) existing.orderCode = inc.orderCode
      Object.assign(existing, sanitizeDriverOrderExtras(inc))
    } else {
      merged.push(inc)
    }
  }
  if (merged.length > KORE_MAX_DRIVER_ORDERS) {
    return fail(state, 'too_many_driver_orders', `A single vehicle pickup cannot exceed ${KORE_MAX_DRIVER_ORDERS} orders.`, opts)
  }

  const notes = args.notes !== undefined ? sanitizeNotes(args.notes) : state.driverPickup?.notes
  const confirmNow = Boolean(args.confirm_pickup)
  const nextStatus: KoreOrderStatus = confirmNow ? 'confirmed' : 'building'
  const driverPickup: KoreDriverPickup = notes ? { platform, orders: merged, notes } : { platform, orders: merged }
  const next = bump(state, [], {
    status: nextStatus,
    sessionKind: 'driver_pickup',
    driverPickup
  })
  const summaryList = merged.map((o, idx) => `#${idx + 1} ${o.customerName}${o.orderCode ? ` (${o.orderCode})` : ''}`).join(', ')
  return ok(
    next,
    'driver_pickup_registered',
    `Registered ${platform} driver pickup (${merged.length} order${merged.length === 1 ? '' : 's'}): ${summaryList}. Direct the driver to pull forward to Drive-Thru Window 2 (ventana 2) for pickup.`,
    opts,
    { pickup_count: merged.length, window_number: 2 }
  )
}

function toolConfirm(state: KoreOrderState, opts?: KoreToolOptions): KoreToolOutcome {
  const isEn = opts?.lang === 'en'
  if (state.sessionKind === 'driver_pickup' && state.driverPickup && state.driverPickup.orders.length > 0) {
    const next = bump(state, [], { status: 'confirmed', sessionKind: 'driver_pickup', driverPickup: state.driverPickup })
    const count = state.driverPickup.orders.length
    return ok(
      next,
      'confirmed',
      isEn
        ? `Driver pickup confirmed (${state.driverPickup.platform}, ${count} order${count === 1 ? '' : 's'}, total $0.00). Confirm the ${count} order(s) briefly in English ONLY and ask the driver to pull forward to Drive-Thru Window 2.`
        : `Recolección de repartidor confirmada (${state.driverPickup.platform}, ${count} orden${count === 1 ? '' : 'es'}, total $0.00). Confirma brevemente en ESPAÑOL y pide avanzar a la Ventana 2 (PROHIBIDO hablar en inglés).`,
      opts,
      { window_number: 2 }
    )
  }
  if (state.lines.length === 0) return fail(state, 'empty_order', isEn ? 'The order is empty; nothing to confirm.' : 'La orden está vacía; aún no hay nada que confirmar.', opts)
  const warnings = state.status === 'cancelled' ? ['The order had been cancelled; it is now restored and confirmed.'] : []
  const next = bump(state, state.lines, { status: 'confirmed' })
  return ok(
    next,
    'confirmed',
    isEn
      ? 'Order confirmed (SIMULATION, not sent to the kitchen). In 100% English ONLY, read back the items + exact total and briefly ask "Does everything look right?"; once the customer confirms and there is nothing else, call end_session to send them to the window and close the car session.'
      : 'Orden confirmada (SIMULACIÓN). Lee en ESPAÑOL los artículos y el total exacto en dólares y pregunta brevemente: "¿Está correcta su orden?" (PROHIBIDO hablar en inglés; cuando confirme que no falta nada, llama end_session).',
    opts,
    {
      instruction: isEn
        ? 'Read back the items + exact total in 100% English ONLY and ask "Does everything look right?".'
        : 'Lee en ESPAÑOL los artículos y el total exacto en dólares y pregunta brevemente: "¿Está correcta su orden?" (PROHIBIDO hablar en inglés).',
      ...(warnings.length ? { warnings } : {})
    }
  )
}

const EBT_REASON_RE = /\b(?:ebt|calfresh|cal\s*fresh|food\s*stamps?|estampillas?|cupones?\s+de\s+comida|snap)\b/i
const EBT_NOT_VALID_REASON_RE = /\b(?:no\s+v[aá]lid[oa]|no\s+acept|not\s+accepted|not\s+valid|rialto|santa\s+ana)\b/i

function toolCancel(state: KoreOrderState, args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const isEn = opts?.lang === 'en'
  const reason = sanitizeNotes(args.reason)
  const isEbt = Boolean(reason && EBT_REASON_RE.test(reason))
  const ebtValidInCity =
    opts?.acceptsEbt !== false && !(reason && EBT_NOT_VALID_REASON_RE.test(reason))
  const ebtExtra = isEbt
    ? ebtValidInCity
      ? {
          ebt_dining_room_only: true,
          ebt_accepted_in_city: true,
          instruction: isEn
            ? 'EBT is NOT accepted at the Drive-Thru window, but IS valid in this city inside at the dining-room counter. Reply in English ONLY: "We gladly accept EBT inside at the dining-room counter, just not at the Drive-Thru window."'
            : 'El pago con EBT NO se recibe en ventanilla de Drive-Thru, pero SÍ es válido en esta ciudad adentro en el mostrador del comedor. Responde 100% en ESPAÑOL: "Con gusto, el pago con EBT se hace adentro en el mostrador del comedor." (PROHIBIDO hablar en inglés).'
        }
      : {
          ebt_dining_room_only: false,
          ebt_accepted_in_city: false,
          ebt_not_accepted_in_city: true,
          instruction: isEn
            ? 'EBT is NOT valid or accepted in this city (neither at the Drive-Thru nor inside the dining room; only cash, debit/credit cards, Apple Pay and Google Pay). Kindly explain in English that EBT is not available at this location.'
            : 'En esta ciudad NO se acepta EBT ni en comedor ni en Drive-Thru (solo efectivo, tarjetas, Apple Pay y Google Pay). Explícalo amablemente 100% en ESPAÑOL.'
        }
    : {}
  if (state.status === 'cancelled') {
    if (reason && reason !== state.cancelReason) {
      const updated: KoreOrderState = { ...state, cancelReason: reason, version: (state.version || 0) + 1 }
      return ok(updated, 'cancelled', 'The order was already cancelled; reason updated.', opts, { reason, ...ebtExtra })
    }
    return ok(state, 'cancelled', 'The order was already cancelled.', opts, { ...(reason ? { reason } : {}), ...ebtExtra })
  }
  const next = bump(state, state.lines, { status: 'cancelled', ...(reason ? { cancelReason: reason } : {}) })
  const msg = !isEbt
    ? isEn ? 'Order cancelled.' : 'Orden cancelada.'
    : ebtValidInCity
      ? isEn
        ? 'Order cancelled so the customer can pay with EBT inside at the dining-room counter.'
        : 'Orden cancelada para que el cliente pase a pagar con EBT al mostrador del comedor.'
      : isEn
        ? 'Order cancelled because EBT is not valid/accepted in this city.'
        : 'Orden cancelada porque en esta ciudad no se acepta EBT.'
  return ok(next, 'cancelled', msg, opts, { ...(reason ? { reason } : {}), ...ebtExtra })
}

function toolEndSession(state: KoreOrderState, args: Record<string, any>, opts?: KoreToolOptions): KoreToolOutcome {
  const isEn = opts?.lang === 'en'
  const hasDriverOrders = (state.driverPickup?.orders?.length ?? 0) > 0
  if (state.status === 'cancelled') {
    const reason = sanitizeNotes(args.reason) || state.cancelReason || 'customer_cancelled'
    return {
      state,
      result: {
        ok: true,
        action: 'end_session',
        should_end_session: true,
        ...orderSummary(state, opts),
        ...computeKoreTotals(state, opts?.taxRatePct ?? null),
        status: 'cancelled',
        reason,
        instruction: isEn
          ? 'Give ONE brief warm goodbye in English ONLY (with NO question); the session will close automatically right after your audio finishes.'
          : 'Da UNA despedida breve y cálida 100% en ESPAÑOL (SIN hacer ninguna pregunta); la sesión se cerrará automáticamente al terminar tu voz.'
      }
    }
  }
  if (state.lines.length > 0 || hasDriverOrders) {
    const defaultReason = hasDriverOrders ? 'driver_dispatched' : 'order_confirmed'
    const reason = sanitizeNotes(args.reason) || defaultReason
    const next = state.status === 'confirmed' ? state : bump(state, state.lines, { status: 'confirmed' })
    return {
      state: next,
      result: {
        ok: true,
        action: 'end_session',
        should_end_session: true,
        ...orderSummary(next, opts),
        ...computeKoreTotals(next, opts?.taxRatePct ?? null),
        status: next.status,
        reason,
        instruction: isEn
          ? 'Give ONE brief warm send-off in English ONLY (e.g. "Awesome, thank you! Please pull forward to the window.") with NO question; the lane session will close automatically right after your audio finishes.'
          : 'Da UNA despedida breve y cálida 100% en ESPAÑOL (ej. "¡Perfecto, muchas gracias! Pase a la ventanilla por favor.") SIN ninguna pregunta; la sesión se cerrará automáticamente al terminar tu voz.'
      }
    }
  }
  return fail(
    state,
    'nothing_to_close',
    'Cannot end session yet: no items ordered, no driver pickup, and order is not cancelled.',
    opts
  )
}

/**
 * Determina si el último mensaje hablado por Kore es una despedida final que envía al auto
 * a avanzar a ventanilla (`pase/avance a la ventanilla`, `ventana 2`, `pull forward`, `to the window`)
 * o a pasar al comedor (ej. EBT), SIN hacer ninguna pregunta abierta (`?`) en la oración final.
 */
export function isKoreClosingSendoffText(text: string): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/\?\s*["'”’)]*\s*$/.test(trimmed)) return false

  const safeSplit = trimmed.replace(/(\d)\.(\d)/g, '$1_$2')
  const sentences = safeSplit
    .split(/[.!¡]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const lastSentence = sentences.length > 0 ? sentences[sentences.length - 1] : safeSplit
  if (/[?¿]/.test(lastSentence)) return false

  const norm = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')

  const esWindowSendoff =
    /\b(?:pase|pasa|pasen|pasar|avance|avanza|avancen|avanzar|adelante|siga|sigan|acercate|acerquese|te\s+esperamos|le\s+esperamos|los\s+esperamos|lo\s+esperamos|nos\s+vemos)\b[^?¿]{0,60}\b(?:ventanilla|ventana(?:\s*[12])?|primera\s+ventanilla|segunda\s+ventanilla|siguiente\s+ventanilla)\b/.test(
      norm
    )
  const enWindowSendoff =
    /\b(?:pull\s+(?:up|forward|ahead)|drive\s+(?:up|forward|ahead)|proceed\s+to\s+(?:the\s+)?(?:first\s+|second\s+|next\s+|pickup\s+)?window|head\s+(?:up\s+|forward\s+)?to\s+(?:the\s+)?(?:first\s+|second\s+|next\s+|pickup\s+)?window|(?:see|meet)\s+you\s+at\s+(?:the\s+)?(?:first\s+|second\s+|next\s+|pickup\s+)?window|go\s+(?:ahead\s+|up\s+|forward\s+)?to\s+(?:the\s+)?(?:first\s+|second\s+|next\s+|pickup\s+)?window|to\s+(?:the\s+)?(?:first\s+|second\s+|pickup\s+)?window(?:\s*[12])?)\b/.test(
      norm
    ) && !/\b(?:not|never|no)\s+(?:available\s+|accepted\s+|valid\s+)?(?:at|in|by|through)\s+(?:the\s+)?(?:drive[\s-]*thru\s+)?window\b/.test(norm)

  const esDiningSendoff =
    /\b(?:pase|pasa|pasen|pasar|adelante|te\s+atendemos|le\s+atendemos|los\s+atendemos|lo\s+atendemos|te\s+esperamos|le\s+esperamos|los\s+esperamos|con\s+gusto[^?¿]{0,35}(?:atendemos|esperamos|hace))\b[^?¿]{0,60}\b(?:adentro|comedor|mostrador)\b/.test(
      norm
    )
  const enDiningSendoff =
    /\b(?:(?:help|assist|take\s+care\s+of|see)\s+you\s+inside|(?:come|head|step|go|walk)\s+(?:on\s+|right\s+)?inside(?:\s+(?:to|at)\s+the\s+(?:dining[\s-]*room|counter))?|see\s+you\s+at\s+the\s+(?:dining[\s-]*room\s+)?counter)\b/.test(
      norm
    )

  return esWindowSendoff || enWindowSendoff || esDiningSendoff || enDiningSendoff
}

const KORE_LANG_NEUTRAL_MENU_WORDS = new Set([
  'taco', 'tacos', 'burrito', 'burritos', 'quesadilla', 'quesadillas', 'mulita', 'mulitas',
  'torta', 'tortas', 'sope', 'sopes', 'nacho', 'nachos', 'plato', 'platos', 'combo', 'combos',
  'asada', 'pastor', 'adobada', 'pollo', 'cabeza', 'lengua', 'buche', 'chorizo', 'carnitas',
  'milanesa', 'cubana', 'jamon', 'salchicha', 'huevo', 'huevos', 'ranchero', 'rancheros',
  'mexicana', 'chilaquiles', 'horchata', 'jamaica', 'pina', 'tamarindo', 'flan', 'cheesecake',
  'champurrado', 'cebolla', 'cilantro', 'frijol', 'frijoles', 'olla', 'salsa', 'salsas',
  'roja', 'verde', 'guacamole', 'crema', 'queso', 'tortilla', 'tortillas', 'maiz', 'harina',
  'limon', 'limones', 'jalapeno', 'jalapenos', 'arroz', 'chips', 'totopos',
  'regular', 'super', 'supreme', 'supremo', 'suprema', 'extra', 'extras', 'normal', 'menu', 'auto',
  'uber', 'eats', 'doordash', 'grubhub', 'caviar', 'postmates', 'ebt', 'calfresh', 'snap',
  'tacosgavilan', 'gavilan', 'coca', 'cola', 'sprite', 'fanta', 'pepsi', 'jarritos', 'sidral',
  'mundet', 'sangria', 'senorial', 'agua', 'aguas', 'fresca', 'frescas',
  'ok', 'okay', 'no', 'nah', 'uh', 'um', 'ah', 'eh', 'mm', 'hmm', 'mhm'
])

const KORE_LANG_EN_WORDS = new Set([
  'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening',
  'can', 'could', 'may', 'would', 'should', 'will', 'do', 'does', 'did', 'dont', 'doesnt', 'cant', 'wont',
  'i', 'im', 'id', 'ill', 'ive', 'you', 'your', 'we', 'our', 'they', 'my', 'it', 'its',
  'get', 'have', 'want', 'wanted', 'like', 'need', 'order', 'ordering', 'take', 'make', 'add', 'remove', 'change', 'cancel',
  'give', 'excuse', 'let', 'tell', 'help', 'hear', 'show', 'see', 'meet',
  'please', 'thank', 'thanks', 'yes', 'yeah', 'yep', 'yup', 'sure', 'awesome', 'great', 'perfect', 'right', 'correct', 'looks',
  'that', 'thats', 'this', 'these', 'those', 'what', 'whats', 'how', 'much', 'when', 'where', 'which', 'until', 'time',
  'all', 'everything', 'nothing', 'anything', 'something', 'else', 'more', 'only', 'just', 'also', 'too',
  'with', 'without', 'side', 'on', 'the', 'an', 'and', 'or', 'for', 'from', 'at', 'to', 'in', 'inside',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'medium', 'large', 'gallon', 'small', 'size', 'drink', 'drinks', 'water', 'bottle', 'coke', 'diet', 'coffee', 'box',
  'chicken', 'steak', 'beef', 'pork', 'tongue', 'beans', 'rice', 'cheese', 'sour', 'cream', 'onions', 'grilled',
  'spicy', 'mild', 'hot', 'green', 'red', 'corn', 'flour', 'plain', 'limes', 'napkins',
  'english', 'speak', 'speaking', 'picking', 'pickup', 'pick', 'up', 'driver', 'delivery', 'ready', 'still',
  'accept', 'pay', 'paying', 'card', 'cards', 'credit', 'debit', 'cash', 'food', 'stamps',
  'window', 'first', 'second', 'pull', 'forward', 'ahead', 'drive', 'thru', 'through', 'proceed', 'open', 'close', 'closed', 'breakfast', 'serve', 'served'
])

const KORE_LANG_ES_WORDS = new Set([
  'hola', 'buenos', 'buenas', 'dias', 'tardes', 'noches', 'disculpa', 'disculpe', 'oiga', 'oye',
  'das', 'dame', 'deme', 'da', 'dan', 'ponle', 'ponme', 'poner', 'echale', 'regalas', 'regalame',
  'quiero', 'quisiera', 'gustaria', 'puedes', 'puede', 'pueden', 'podria', 'podrias', 'necesito', 'ocupo',
  'por', 'favor', 'gracias', 'muchas', 'si', 'claro', 'sale', 'listo', 'perfecto', 'bien', 'correcto', 'asi', 'mero',
  'eso', 'es', 'son', 'esta', 'estan', 'todo', 'seria', 'nada', 'mas', 'algo', 'solo', 'tambien', 'otro', 'otra', 'otros', 'otras',
  'con', 'sin', 'aparte', 'lado', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'del', 'al', 'en', 'y', 'o',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'mediana', 'mediano', 'grande', 'grandes', 'galon', 'vaso', 'caja', 'botella', 'cafe', 'refresco', 'bebida', 'bebidas',
  'para', 'llevar', 'recoger', 'vengo', 'voy', 'repartidor', 'orden', 'ordenes', 'pedido', 'lista', 'listas',
  'cuanto', 'cuanta', 'cuesta', 'cuestan', 'precio', 'precios', 'total', 'cobran', 'vale',
  'hasta', 'que', 'hora', 'horario', 'tienen', 'manejan', 'venden', 'sirven', 'desayuno', 'desayunos', 'abiertos', 'cerrado',
  'aceptan', 'agarran', 'pagar', 'pago', 'efectivo', 'tarjeta', 'tarjetas', 'estampillas',
  'ventana', 'ventanilla', 'comedor', 'mostrador', 'adentro', 'pase', 'pasa', 'avance', 'avanza', 'espanol', 'hablas', 'habla'
])

/**
 * Detecta en tiempo real el idioma hablado por el cliente (`'es' | 'en'`), ignorando sustantivos propios
 * del menú mexicano y marcas para que frases como `"Can I get three tacos de asada and a large horchata"`
 * cuenten 100% como inglés (`'en'`) y `"Me das un cheesecake"` cuente 100% como español (`'es'`).
 */
export function detectKoreSpokenLanguage(text: string, fallback: 'es' | 'en' = 'es'): 'es' | 'en' {
  if (!text || typeof text !== 'string') return fallback
  const stripped = text
    .replace(/\[[^\]]*\]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    // Neutralizar conectores internos de platillos mexicanos cuando un cliente angloparlante los pronuncia por su nombre
    .replace(/\b(?:tacos?|burritos?|quesadillas?|mulitas?|tortas?|sopes?|platos?|agua|aguas)\s+de\b/g, ' ')
    .replace(/\bfrijol(?:es)?\s+de\s+la\s+olla\b/g, ' ')
    .replace(/\bhuevos?\s+a\s+la\s+mexicana\b/g, ' ')
    .replace(/\bcebolla\s+asada\b/g, ' ')

  // Prioridad #0: petición explícita de cambio de idioma (incluso dicha en el otro idioma, ej. "en inglés, por favor")
  if (/\bno\s+hablo\s+(?:en\s+)?(?:ingles|english)\b/.test(stripped)) return 'es'
  if (/\b(?:dont|do\s+not)\s+speak\s+(?:in\s+)?(?:spanish|espanol)\b/.test(stripped)) return 'en'
  if (
    /\b(?:en\s+ingles|habla[sr]?(?:\s+en)?\s+ingles|puedes?\s+hablar(?:\s+en)?\s+ingles|cambiar?(?:lo)?\s+a\s+ingles|in\s+english|speak\s+english|english\s+please|switch\s+to\s+english)\b/.test(
      stripped
    )
  ) {
    return 'en'
  }
  if (
    /\b(?:en\s+espanol|habla[sr]?(?:\s+en)?\s+espanol|puedes?\s+hablar(?:\s+en)?\s+espanol|cambiar?(?:lo)?\s+a\s+espanol|in\s+spanish|speak\s+spanish|spanish\s+please|switch\s+to\s+spanish)\b/.test(
      stripped
    )
  ) {
    return 'es'
  }

  let enScore = 0
  let esScore = 0

  if (/\b(?:give|excuse|let|tell|help|hear|for)\s+me\b/.test(stripped)) enScore += 1
  if (/\bme\s+(?:das?|pones?|pone|puedes?|puede|gustaria|regalas?|cobras?|dices?|escuchas?|falta|haces?|tomas?)\b/.test(stripped)) {
    esScore += 2
  }

  const tokens = stripped.split(/[^a-z0-9]+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok === 'a' || tok === 'me' || KORE_LANG_NEUTRAL_MENU_WORDS.has(tok)) continue
    if (KORE_LANG_EN_WORDS.has(tok)) enScore += 1
    else if (KORE_LANG_ES_WORDS.has(tok)) esScore += 1
  }

  if (enScore > esScore) return 'en'
  if (esScore > enScore) return 'es'
  return fallback
}

function attachToolLanguageDirective(outcome: KoreToolOutcome, opts?: KoreToolOptions): KoreToolOutcome {
  const effectiveLang: 'es' | 'en' = opts?.lang === 'en' ? 'en' : 'es'
  const languageDirective =
    effectiveLang === 'en'
      ? 'CRITICAL: Customer is speaking ENGLISH. Reply 100% in natural English ONLY (NEVER in Spanish).'
      : 'CRÍTICO: El cliente habló en ESPAÑOL. Responde ESTRICTAMENTE 100% en ESPAÑOL (PROHIBIDO usar frases en inglés como "Sure thing", "Got it" o "Does everything look right?").'
  return {
    state: outcome.state,
    result: {
      ...outcome.result,
      reply_language: effectiveLang,
      language_directive: languageDirective
    }
  }
}

/**
 * Ejecuta una herramienta de Kore sobre el estado de la orden. Inmutable y determinista.
 * Herramienta desconocida o argumentos inválidos => `ok:false` sin cambiar el estado.
 */
export function applyKoreTool(
  state: KoreOrderState | null | undefined,
  menu: KoreMenuItem[],
  toolName: string,
  args: unknown,
  opts?: KoreToolOptions
): KoreToolOutcome {
  const current = normalizeState(state)
  const safeMenu = Array.isArray(menu) ? menu : []
  const a = parseArgs(args)
  const run = (): KoreToolOutcome => {
    try {
      switch (String(toolName || '').trim()) {
        case 'add_item':
          return toolAddItem(current, safeMenu, a, opts)
        case 'add_items':
          return toolAddItems(current, safeMenu, a, opts)
        case 'update_item':
          return toolUpdateItem(current, safeMenu, a, opts)
        case 'remove_item':
          return toolRemoveItem(current, safeMenu, a, opts)
        case 'get_order':
          return ok(
            current,
            'order',
            current.sessionKind === 'driver_pickup' && current.driverPickup?.orders.length
              ? `Driver pickup (${current.driverPickup.platform}, ${current.driverPickup.orders.length} order(s)).`
              : current.lines.length
                ? 'Current order.'
                : 'The order is empty.',
            opts
          )
        case 'search_menu':
          return toolSearchMenu(current, safeMenu, a, opts)
        case 'register_driver_pickup':
          return toolRegisterDriverPickup(current, a, opts)
        case 'confirm_order':
          return toolConfirm(current, opts)
        case 'cancel_order':
          return toolCancel(current, a, opts)
        case 'end_session':
          return toolEndSession(current, a, opts)
        default:
          return fail(current, 'unknown_tool', `Unknown tool "${String(toolName)}".`, opts)
      }
    } catch (err: any) {
      return fail(current, 'internal_error', `Tool failed: ${String(err?.message || err).slice(0, 160)}`, opts)
    }
  }
  return attachToolLanguageDirective(run(), opts)
}

/**
 * Reconstruye y RE-COTIZA una orden recibida del navegador contra el menú vigente del servidor (para guardarla en
 * `dt_kore_sim_sessions` sin confiar en precios del cliente). Cada línea debe existir en el menú (por `itemGuid`), cada
 * modificador debe pertenecer a un grupo real del producto y cumplir min/max; precios y totales salen del menú.
 */
export function rebuildKoreOrderFromMenu(raw: unknown, menu: KoreMenuItem[]): { state: KoreOrderState | null; errors: string[] } {
  const errors: string[] = []
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null
  if (!obj) return { state: null, errors: ['order must be an object.'] }
  if (!Array.isArray(obj.lines)) return { state: null, errors: ['order.lines must be an array.'] }
  if (obj.lines.length > 100) return { state: null, errors: ['order.lines exceeds 100 lines.'] }
  const status: KoreOrderStatus | null =
    obj.status === 'building' || obj.status === 'confirmed' || obj.status === 'cancelled' ? obj.status : null
  if (!status) errors.push('order.status must be building, confirmed or cancelled.')
  const safeMenu = Array.isArray(menu) ? menu : []
  const lines: KoreOrderLine[] = []
  const seenIds = new Set<string>()
  let maxLine = 0
  obj.lines.forEach((rl: any, idx: number) => {
    const lineId = String(rl?.lineId ?? '').trim()
    const m = /^L(\d{1,4})$/.exec(lineId)
    if (!m || seenIds.has(lineId)) {
      errors.push(`line #${idx + 1}: invalid or duplicated lineId.`)
      return
    }
    seenIds.add(lineId)
    maxLine = Math.max(maxLine, Number(m[1]))
    const rawItemGuid = String(rl?.itemGuid ?? '')
    const item = KORE_COURTESY_STANDALONE_ITEMS[rawItemGuid] || safeMenu.find((it) => it.guid === rawItemGuid)
    if (!item) {
      errors.push(`${lineId}: item is not on the current store menu.`)
      return
    }
    const qty = Number(rl?.quantity)
    if (!Number.isInteger(qty) || qty < 1 || qty > KORE_MAX_LINE_QUANTITY) {
      errors.push(`${lineId}: invalid quantity.`)
      return
    }
    const courtesyModsByGuid = new Map<string, Omit<KoreOrderModifier, 'quantity'>>(
      Object.values(KORE_COURTESY_MODIFIERS).map((cm) => [cm.guid, cm])
    )
    const rawMods = Array.isArray(rl?.modifiers) ? rl.modifiers : []
    const mods: KoreOrderModifier[] = []
    for (const rm of rawMods) {
      if (!rm || typeof rm !== 'object') {
        errors.push(`${lineId}: modifier must be an object.`)
        continue
      }
      const mq = rm?.quantity === undefined ? 1 : Number(rm.quantity)
      const courtesyHit =
        (rm.guid && courtesyModsByGuid.get(String(rm.guid))) ||
        (!rm.guid &&
          rm.name &&
          Object.values(KORE_COURTESY_MODIFIERS).find((cm) => normalizeKoreText(cm.name) === normalizeKoreText(rm.name)))
      if (courtesyHit) {
        if (!Number.isInteger(mq) || mq < 1 || mq > 10) {
          errors.push(`${lineId}: invalid modifier quantity on "${courtesyHit.name}".`)
          continue
        }
        const badCourtesyPrice =
          (rm.price !== undefined && (!Number.isFinite(Number(rm.price)) || toKoreCents(rm.price) !== 0)) ||
          (rm.priceCents !== undefined && (!Number.isInteger(rm.priceCents) || rm.priceCents !== 0))
        if (badCourtesyPrice) {
          errors.push(`${lineId}: manipulated modifier price on "${courtesyHit.name}" (expected $0.00).`)
          continue
        }
        const existingC = mods.find((x) => x.guid === courtesyHit.guid && x.groupGuid === courtesyHit.groupGuid)
        if (existingC) existingC.quantity += mq
        else mods.push({ ...courtesyHit, quantity: mq })
        continue
      }
      const hasGroupGuid = rm.groupGuid !== undefined && rm.groupGuid !== null && String(rm.groupGuid).trim() !== ''
      const hasGroupName = rm.groupName !== undefined && rm.groupName !== null && String(rm.groupName).trim() !== ''
      let group: KoreModifierGroup | undefined
      if (hasGroupGuid) {
        group = item.modifierGroups.find((g) => g.guid === String(rm.groupGuid).trim())
      } else if (hasGroupName) {
        const gNorm = normalizeKoreText(rm.groupName)
        group = item.modifierGroups.find((g) => normalizeKoreText(g.name) === gNorm)
      } else if (rm.guid) {
        const matchingGroups = item.modifierGroups.filter((g) => g.options.some((o) => o.guid === String(rm.guid)))
        if (matchingGroups.length === 1) group = matchingGroups[0]
      }
      const option = group?.options.find(
        (o) => (rm.guid && o.guid === String(rm.guid)) || (!rm.guid && rm.name && normalizeKoreText(o.name) === normalizeKoreText(rm.name))
      )
      if (!group || !option || !Number.isInteger(mq) || mq < 1 || mq > 10) {
        errors.push(`${lineId}: invalid modifier "${String(rm?.name ?? rm?.guid ?? '').slice(0, 60)}".`)
        continue
      }
      const expectedOptCents = toKoreCents(option.price)
      const badModPrice =
        (rm.price !== undefined && (!Number.isFinite(Number(rm.price)) || toKoreCents(rm.price) !== expectedOptCents)) ||
        (rm.priceCents !== undefined && (!Number.isInteger(rm.priceCents) || rm.priceCents !== expectedOptCents))
      if (badModPrice) {
        errors.push(`${lineId}: manipulated modifier price on "${option.name}" (expected ${formatKoreUsd(expectedOptCents)}).`)
        continue
      }
      const existing = mods.find((x) => x.guid === option.guid && x.groupGuid === group!.guid)
      if (existing) {
        existing.quantity += mq
        continue
      }
      mods.push({
        guid: option.guid,
        name: option.name,
        price: centsToDollars(expectedOptCents),
        priceCents: expectedOptCents,
        groupName: group.name,
        groupGuid: group.guid,
        quantity: mq
      })
    }
    const ruleErrors = validateGroups(item, mods)
    if (ruleErrors.length) errors.push(`${lineId}: ${ruleErrors.join(' ')}`)
    const rebuiltLine = recomputeLine({
      lineId,
      itemGuid: item.guid,
      name: item.name,
      category: item.category,
      quantity: qty,
      basePrice: item.price,
      basePriceCents: toKoreCents(item.price),
      unitPrice: 0,
      unitPriceCents: 0,
      modifiers: mods,
      notes: sanitizeNotes(rl?.notes),
      lineTotal: 0,
      lineTotalCents: 0
    })
    const badLinePrice =
      (rl.basePrice !== undefined && (!Number.isFinite(Number(rl.basePrice)) || toKoreCents(rl.basePrice) !== rebuiltLine.basePriceCents)) ||
      (rl.basePriceCents !== undefined && (!Number.isInteger(rl.basePriceCents) || rl.basePriceCents !== rebuiltLine.basePriceCents)) ||
      (rl.unitPrice !== undefined && (!Number.isFinite(Number(rl.unitPrice)) || toKoreCents(rl.unitPrice) !== rebuiltLine.unitPriceCents)) ||
      (rl.unitPriceCents !== undefined && (!Number.isInteger(rl.unitPriceCents) || rl.unitPriceCents !== rebuiltLine.unitPriceCents)) ||
      (rl.lineTotal !== undefined && (!Number.isFinite(Number(rl.lineTotal)) || toKoreCents(rl.lineTotal) !== rebuiltLine.lineTotalCents)) ||
      (rl.lineTotalCents !== undefined && (!Number.isInteger(rl.lineTotalCents) || rl.lineTotalCents !== rebuiltLine.lineTotalCents))
    if (badLinePrice) {
      errors.push(
        `${lineId}: manipulated line price on "${item.name}" (expected unit ${formatKoreUsd(rebuiltLine.unitPriceCents)}, total ${formatKoreUsd(rebuiltLine.lineTotalCents)}).`
      )
    }
    lines.push(rebuiltLine)
  })
  if (totalPieces(lines) > KORE_MAX_ORDER_ITEMS) errors.push(`order exceeds ${KORE_MAX_ORDER_ITEMS} items.`)
  const rawKind = obj.sessionKind
  if (rawKind !== undefined && rawKind !== 'customer_order' && rawKind !== 'driver_pickup') {
    errors.push('order.sessionKind must be customer_order or driver_pickup.')
  }
  const isDriverPickup = rawKind === 'driver_pickup' || (rawKind === undefined && lines.length === 0 && Boolean(obj.driverPickup))
  let driverPickup: KoreDriverPickup | null = null
  if (isDriverPickup) {
    if (lines.length > 0) errors.push('driver_pickup order cannot contain paid menu lines.')
    const dp = obj.driverPickup && typeof obj.driverPickup === 'object' ? obj.driverPickup : null
    if (!dp) {
      errors.push('driverPickup object is required when sessionKind is driver_pickup.')
    } else {
      const platform = normalizeKoreDriverPlatform(dp.platform)
      if (!platform) errors.push(`Invalid driverPickup.platform "${String(dp.platform ?? '').slice(0, 40)}".`)
      if (!Array.isArray(dp.orders) || dp.orders.length === 0 || dp.orders.length > KORE_MAX_DRIVER_ORDERS) {
        errors.push(`driverPickup.orders must contain 1-${KORE_MAX_DRIVER_ORDERS} orders.`)
      } else {
        const cleanOrders: KoreDriverPickupOrder[] = []
        dp.orders.forEach((ro: any, i: number) => {
          const orderCode = sanitizeOrderCode(ro?.orderCode ?? ro?.order_code)
          let customerName = String(ro?.customerName ?? ro?.customer_name ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          if (customerName.length < 2 && orderCode && orderCode.length >= 2) {
            customerName = `Orden ${orderCode}`
          }
          if (customerName.length < 2) {
            errors.push(`driverPickup.orders[${i}]: invalid customerName.`)
            return
          }
          const extras = sanitizeDriverOrderExtras(ro)
          cleanOrders.push({ customerName, ...(orderCode ? { orderCode } : {}), ...extras })
        })
        if (platform && cleanOrders.length === dp.orders.length) {
          const notes = sanitizeNotes(dp.notes)
          driverPickup = notes ? { platform, orders: cleanOrders, notes } : { platform, orders: cleanOrders }
        }
      }
    }
  }
  if (errors.length) return { state: null, errors }
  const version = Number(obj.version)
  const rebuiltCancelReason = status === 'cancelled' ? sanitizeNotes(obj.cancelReason) : undefined
  return {
    state: {
      lines,
      status: status as KoreOrderStatus,
      sessionKind: isDriverPickup ? 'driver_pickup' : 'customer_order',
      driverPickup: isDriverPickup ? driverPickup : null,
      nextLineNumber: maxLine + 1,
      version: Number.isInteger(version) && version >= 0 ? version : 0,
      ...(rebuiltCancelReason ? { cancelReason: rebuiltCancelReason } : {})
    },
    errors
  }
}
