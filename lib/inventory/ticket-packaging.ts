/**
 * @module lib/inventory/ticket-packaging
 * @description Convierte el contexto crudo de cada ticket Toast en consumo teórico de empaque y condimentos para Tacos Gavilan.
 * @businessRules
 *   - La receta base se conserva en PMIX; este módulo cubre solamente insumos que dependen del canal, separadores, composición o tamaño del ticket.
 *   - Taco: plato de 9 pulgadas por cada cinco tacos o fracción del grupo; Mulita: máximo dos por plato; Quesadilla: una por plato; los separadores cierran un grupo.
 *   - Taco Plate usa 983BLKB y tapa 983LID fuera de For Here. Sope usa UP918PR cuando es uno y 981BLKB+981LID cuando son dos; For Here usa plato de 9 pulgadas, máximo dos sopes.
 *   - Salsa roja aplica a asada/pastor/chorizo y verde a pollo/lengua/cabeza/carnitas/buche. Tripa está descontinuada y nunca se infiere.
 *   - Las bolsas exteriores siguen siendo decisión a nivel ticket: no se inventa una capacidad ni se escriben movimientos hasta configurarla.
 *   - channel conserva el canal comercial; packagingChannel aplica Delivery a TakeOut de plataformas y Toast Online.
 *   - Bebida Medium/Large For Here o To Go de caja entrega un vaso ELDP22/ELDP32.
 *     El cliente puede servirse soda Coca-Cola, agua fresca o mezcla; no inferir líquido
 *     ni tapa a partir del botón Toast. Viele & Sons continúa con pedido semanal manual.
 * @dataFlow Toast snapshot + canal → clasificación determinista → TicketPackagingResult → preview/auditoría → futuro kardex.
 * @notes No genera movimientos: evita duplicar inventory_usage_log mientras PMIX siga activo.
 *   La bolsa interior se calcula después de todos los condimentos, incluidos tacos, para evitar omisiones en tickets solo de tacos.
 *   [2026-09-26] La tapa 709DO es domo de plástico transparente, no de cartón/aluminio; corregida la descripción operativa.
 *   [2026-10-01] Las recetas Medium/Large muestreadas no tienen línea de vaso;
 *   se registra una pieza por venta de autoservicio sin duplicar una receta existente.
 */

import { resolveTicketChannel, resolvePackagingChannel, type RecipeChannel } from './recipe-channels'

export type PackagingItemKey =
  | 'plate_9in' | 'taco_cover' | 'salsa_roja_pack' | 'salsa_verde_pack' | 'mixta_bag' | 'lime_bag' | 'jalapeno_2oz_bag'
  | '983BLKB' | '983LID' | 'UP918PR' | '981BLKB' | '981LID' | 'EL1254'
  | 'WRHEFOBL' | 'WRHESPBL' | 'HEFO' | 'HESP' | 'EL1CS2G'
  | 'RC478' | '709DO' | 'cup_8oz_paper' | 'lid_8oz_flat' | 'cup_4oz' | 'lid_4oz'
  | 'half_pan' | 'half_pan_lid' | 'full_pan' | 'full_pan_lid'
  | 'ELTSBALA' | 'ELMES2G' | 'ELLAS2G' | 'bolsa_agua_uber' | 'ELDP22' | 'ELDP32'

export interface ToastTicketSelection { guid?: string | null; name?: string | null; quantity?: number | null; modifiers?: Array<{ guid?: string | null; name?: string | null; quantity?: number | null }> | null }
export interface TicketPackagingTicket { diningOptionName?: string | null; diningOptionBehavior?: string | null; source?: string | null; deliveryService?: string | null; selections: ToastTicketSelection[] }
export interface TicketPackagingLine { key: PackagingItemKey; quantity: number; reason: string }
export interface TicketPackagingResult {
  packagingChannel: RecipeChannel | 'unknown'
  channel: RecipeChannel | 'unknown'; tacoCount: number; tacoGroups: number[]; redTacoCount: number; greenTacoCount: number; unclassifiedTacoCount: number
  recognizedSelections: number; lines: TicketPackagingLine[]; pendingOuterBagPlanning: boolean; warnings: string[]
}

type ProductKind =
  | 'taco' | 'taco_plate' | 'sope' | 'mulita' | 'quesadilla' | 'torta' | 'burrito' | 'nachos'
  | 'plato' | 'breakfast' | 'cheesecake' | 'flan'
  | 'frijol_dlo' | 'rice_beans' | 'guacamole' | 'catering_meat' | 'drink'
  | null

type SalsaColor = 'red' | 'green' | null
const normalize = (value: string | null | undefined) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const qty = (value: number | null | undefined) => Math.max(0, Math.floor(Number(value) || 0))
const textOf = (selection: ToastTicketSelection) => [selection.name, ...(selection.modifiers || []).map(modifier => modifier.name)].filter(Boolean).join(' ')
const isSeparator = (selection: ToastTicketSelection) => /\b(separator|separador)\b/.test(normalize(textOf(selection)))

function productKind(selection: ToastTicketSelection): ProductKind {
  const text = normalize(selection.name)
  if (/^(?:medium|large)\s+(?:horchata|jamaica|pina|tamarindo|coke|diet\s+coke|sprite|(?:orange|strawberry)\s+fanta|lemonade|iced\s+tea|agua\s+fresca)\b/.test(text)) return 'drink'
  if (/\b(taco\s*plate|plate\s*of\s*tacos?)\b/.test(text)) return 'taco_plate'
  if (/\bcheese\s*cake\b|\bcheesecake\b/.test(text) && !/full\s*cheese/.test(text)) return 'cheesecake'
  if (/\bflan\b/.test(text)) return 'flan'
  if (/\bsuper\s*mulitas?\b|\bmulitas?\b/.test(text)) return 'mulita'
  if (/\bquesadillas?\b/.test(text)) return 'quesadilla'
  if (/\bsopes?\b/.test(text)) return 'sope'
  if (/\btortas?\b/.test(text)) return 'torta'
  if (/\bburritos?\b/.test(text)) return 'burrito'
  if (/\b(nachos?|super\s*nachos?)\b/.test(text)) return 'nachos'
  if (/\b(desayun\w*|breakfast\w*|huevos?|chilaquil\w*|machaca\w*|omelet\w*)\b/.test(text)) return 'breakfast'
  if (/\b(platos?|plates?)\b/.test(text)) return 'plato'
  if (/\btacos?\b/.test(text)) return 'taco'
  if (/\bfrijol\s*(?:d\/?l\/?o|de\s*la\s*olla)\b/.test(text)) return 'frijol_dlo'
  if (/\b(rice|beans|arroz|frijol(?:es)?|side\s*(?:order\s*)?carne)\b/.test(text)) return 'rice_beans'
  if (/\bguacamole\b/.test(text)) return 'guacamole'
  if (/\b(\d+)\s*lb\s*meat\b/.test(text)) return 'catering_meat'
  if (/\b(horchata|jamaica|pina|piña|tamarindo|coke|sprite|diet\s*coke|champurrado|coffee|cafe|agua\s*fresca)\b/.test(text)) return 'drink'
  return null
}

function salsaColor(text: string): SalsaColor {
  const normalized = normalize(text)
  if (/\b(asada|pastor|chorizo)\b/.test(normalized)) return 'red'
  if (/\b(pollo|chicken|lengua|cabeza|carnitas|buche)\b/.test(normalized)) return 'green'
  return null
}

type Accumulator = Map<PackagingItemKey, { quantity: number; reasons: Set<string> }>
const add = (lines: Accumulator, key: PackagingItemKey, quantity: number, reason: string) => {
  if (quantity <= 0) return
  const current = lines.get(key) || { quantity: 0, reasons: new Set<string>() }
  current.quantity += quantity; current.reasons.add(reason); lines.set(key, current)
}
const addColoredSalsa = (lines: Accumulator, color: SalsaColor, amount: number, warning: string, warnings: string[]) => {
  if (!color) { warnings.push(warning); return }
  add(lines, color === 'red' ? 'salsa_roja_pack' : 'salsa_verde_pack', amount, `salsa ${color === 'red' ? 'roja' : 'verde'} según carne Toast`)
}

/** Calculates all currently-defined per-item packaging rules, excluding variable outer-bag capacity. */
export function calculateTicketPackaging(ticket: TicketPackagingTicket): TicketPackagingResult {
  const context = { diningOption: ticket.diningOptionName, behavior: ticket.diningOptionBehavior, source: ticket.source, deliveryService: ticket.deliveryService }
  const salesChannel = resolveTicketChannel(context)
  const channel = resolvePackagingChannel(context)
  if (channel === 'unknown') return {
    channel: salesChannel, packagingChannel: channel, tacoCount: 0, tacoGroups: [], redTacoCount: 0, greenTacoCount: 0, unclassifiedTacoCount: 0,
    recognizedSelections: 0, lines: [], pendingOuterBagPlanning: true,
    warnings: ['Canal sin evidencia suficiente: empaque pendiente; no se asume For Here.'],
  }
  const lines: Accumulator = new Map(); const warnings: string[] = []
  const tacoGroups: number[] = []; const mulitaGroups: number[] = []
  let tacoCurrent = 0; let mulitaCurrent = 0; let tacos = 0; let redTacos = 0; let greenTacos = 0; let unclassifiedTacos = 0; let recognizedSelections = 0
  const closeGroups = () => { if (tacoCurrent > 0) tacoGroups.push(tacoCurrent); if (mulitaCurrent > 0) mulitaGroups.push(mulitaCurrent); tacoCurrent = 0; mulitaCurrent = 0 }

  for (const selection of ticket.selections || []) {
    if (isSeparator(selection)) { closeGroups(); continue }
    const kind = productKind(selection); const quantity = qty(selection.quantity)
    if (!kind || quantity === 0) continue
    recognizedSelections++
    const color = salsaColor(textOf(selection))
    if (kind === 'taco' || kind === 'taco_plate') {
      const tacoEquivalent = quantity * (kind === 'taco_plate' ? 3 : 1)
      tacos += tacoEquivalent
      if (kind === 'taco') tacoCurrent += tacoEquivalent
      if (color === 'red') redTacos += tacoEquivalent; else if (color === 'green') greenTacos += tacoEquivalent; else unclassifiedTacos += tacoEquivalent
      if (kind === 'taco_plate') { add(lines, '983BLKB', quantity, 'Taco Plate: base por plato'); if (channel !== 'for_here') add(lines, '983LID', quantity, 'Taco Plate fuera de For Here: tapa') }
    } else if (kind === 'mulita') {
      mulitaCurrent += quantity; add(lines, 'mixta_bag', Math.ceil(quantity / 2), 'Mulita: regla de tacos'); add(lines, 'lime_bag', Math.ceil(quantity / 3), 'Mulita: regla de tacos')
      addColoredSalsa(lines, color, Math.ceil(quantity / 3), `${quantity} mulita(s) sin carne identificable: no se asignó salsa.`, warnings)
    } else if (kind === 'sope') {
      if (channel === 'for_here') add(lines, 'plate_9in', Math.ceil(quantity / 2), 'For Here: máximo 2 sopes por plato')
      else { add(lines, '981BLKB', Math.floor(quantity / 2), '2 sopes: contenedor Nachos'); add(lines, '981LID', Math.floor(quantity / 2), '2 sopes: tapa contenedor Nachos'); if (quantity % 2) add(lines, 'UP918PR', 1, '1 sope: contenedor con tapa incluida') }
      add(lines, 'jalapeno_2oz_bag', quantity, 'Sope: un jalapeño preparado'); add(lines, 'mixta_bag', Math.ceil(quantity / 2), 'Sope: regla de tacos'); add(lines, 'lime_bag', Math.ceil(quantity / 3), 'Sope: regla de tacos')
      addColoredSalsa(lines, color, Math.ceil(quantity / 3), `${quantity} sope(s) sin carne identificable: no se asignó salsa.`, warnings)
    } else if (kind === 'torta') {
      add(lines, 'EL1254', quantity * (channel === 'for_here' ? 1 : 2), 'Torta: papel wax por canal'); add(lines, 'jalapeno_2oz_bag', quantity, 'Torta: un jalapeño preparado')
      if (color) {
        addColoredSalsa(lines, color, quantity * 2, `${quantity} torta(s) sin carne identificable: no se asignó salsa.`, warnings)
      } else {
        add(lines, 'salsa_roja_pack', quantity * 2, 'Torta especial (Cubana/Milanesa/Jamon/Queso): 2 salsas rojas por defecto confirmadas por Carlos')
      }
    } else if (kind === 'burrito') {
      add(lines, 'lime_bag', quantity * 2, 'Burrito: 2 limones')
      if (color) {
        addColoredSalsa(lines, color, quantity * 2, `${quantity} burrito(s) sin carne identificable: no se asignó salsa.`, warnings)
      } else {
        add(lines, 'salsa_roja_pack', quantity * 2, 'Burrito frijol/queso/vegetariano: 2 salsas rojas por defecto confirmadas por Carlos')
      }
    } else if (kind === 'quesadilla') {
      add(lines, 'plate_9in', quantity, 'Quesadilla: un plato por pieza'); if (channel !== 'for_here') add(lines, 'taco_cover', quantity, 'Quesadilla fuera de For Here: cover')
      add(lines, 'mixta_bag', quantity * 2, 'Quesadilla: 2 mixta')
      if (color) {
        addColoredSalsa(lines, color, quantity * 2, `${quantity} quesadilla(s) sin carne identificable: no se asignó salsa.`, warnings)
      } else {
        add(lines, 'salsa_roja_pack', quantity * 2, 'Quesadilla queso: 2 salsas rojas por defecto confirmadas por Carlos')
      }
    } else if (kind === 'frijol_dlo') {
      add(lines, 'cup_4oz', quantity, 'Frijol D/L/O: vaso 4 oz confirmado por Carlos')
      add(lines, 'lid_4oz', quantity, 'Frijol D/L/O: tapa para vaso 4 oz')
    } else if (kind === 'rice_beans') {
      add(lines, 'cup_8oz_paper', quantity, 'Rice/Beans/Side Carne: vaso 8 oz papel confirmado por Carlos')
      add(lines, 'lid_8oz_flat', quantity, 'Rice/Beans/Side Carne: tapa plana para vaso 8 oz')
    } else if (kind === 'guacamole') {
      add(lines, 'cup_4oz', quantity, 'Guacamole: vasito 4 oz transparente con tapa confirmado por Carlos')
      add(lines, 'lid_4oz', quantity, 'Guacamole: tapa para vasito 4 oz')
    } else if (kind === 'catering_meat') {
      const text = normalize(selection.name)
      if (text.includes('2 lb') || text.includes('2lb')) {
        add(lines, 'RC478', quantity, '2 lb Meat: contenedor redondo de aluminio RC478 confirmado por Carlos')
        add(lines, '709DO', quantity, '2 lb Meat: tapa domo plástico transparente 709DO')
      } else if (text.includes('6 lb') || text.includes('6lb')) {
        add(lines, 'half_pan', quantity, '6 lb Meat: charola aluminio Half Pan confirmada por Carlos')
        add(lines, 'half_pan_lid', quantity, '6 lb Meat: tapa aluminio Half Pan')
      } else if (text.includes('12 lb') || text.includes('12lb')) {
        add(lines, 'full_pan', quantity, '12 lb Meat: charola aluminio Full Pan confirmada por Carlos')
        add(lines, 'full_pan_lid', quantity, '12 lb Meat: tapa aluminio Full Pan')
      }
    } else if (kind === 'drink') {
      if (channel === 'for_here' || channel === 'to_go') {
        const size = normalize(selection.name).match(/^(medium|large)\s+/)?.[1]
        if (size === 'medium') add(lines, 'ELDP22', quantity, 'Autoservicio Medium: vaso 22 oz; líquido no identificado')
        if (size === 'large') add(lines, 'ELDP32', quantity, 'Autoservicio Large: vaso 32 oz; líquido no identificado')
      }
      if (channel === 'delivery') {
        add(lines, 'bolsa_agua_uber', quantity, 'Delivery: bolsa individual transparente para bebida')
      }
    } else if (kind === 'nachos') {
      add(lines, 'jalapeno_2oz_bag', quantity * 2, 'Super Nachos: 2 jalapeños'); addColoredSalsa(lines, color, quantity * 2, `${quantity} nacho(s) sin carne identificable: no se asignó salsa.`, warnings)
    } else if (kind === 'plato') {
      add(lines, 'mixta_bag', quantity * 2, 'Plato: hasta 2 mixta'); add(lines, 'jalapeno_2oz_bag', quantity, 'Plato: un jalapeño preparado'); addColoredSalsa(lines, color, quantity * 2, `${quantity} plato(s) sin carne identificable: no se asignó salsa.`, warnings)
    } else if (kind === 'breakfast') {
      add(lines, 'jalapeno_2oz_bag', quantity, 'Desayuno: un jalapeño preparado'); addColoredSalsa(lines, color, quantity * 2, `${quantity} desayuno(s) sin carne identificable: no se asignó salsa.`, warnings)
    } else if (kind === 'cheesecake' || kind === 'flan') {
      const utensil: PackagingItemKey = kind === 'cheesecake' ? (channel === 'for_here' || channel === 'to_go' ? 'HEFO' : 'WRHEFOBL') : (channel === 'for_here' || channel === 'to_go' ? 'HESP' : 'WRHESPBL')
      add(lines, utensil, quantity, `${kind === 'cheesecake' ? 'Cheesecake' : 'Flan'}: utensilio por canal`); if (channel === 'delivery') add(lines, 'EL1CS2G', quantity, 'Delivery: bolsa interior sellada para postre')
    }
  }
  closeGroups()
  const tacoPlates = tacoGroups.reduce((total, group) => total + Math.ceil(group / 5), 0); const mulitaPlates = mulitaGroups.reduce((total, group) => total + Math.ceil(group / 2), 0)
  if (tacoPlates) { add(lines, 'plate_9in', tacoPlates, `${tacoGroups.length} grupo(s) de tacos; máximo 5 por plato`); if (channel !== 'for_here') add(lines, 'taco_cover', tacoPlates, 'Tacos fuera de For Here: cover por plato') }
  if (mulitaPlates) { add(lines, 'plate_9in', mulitaPlates, `${mulitaGroups.length} grupo(s) de mulitas; máximo 2 por plato`); if (channel !== 'for_here') add(lines, 'taco_cover', mulitaPlates, 'Mulitas fuera de For Here: cover por plato') }
  if (tacos > 0) {
    add(lines, 'mixta_bag', Math.ceil(tacos / 2), 'Tacos y Taco Plates: una mixta por cada 2 tacos')
    add(lines, 'lime_bag', Math.ceil(tacos / 3), 'Tacos y Taco Plates: un limón por cada 3 tacos')
    if (redTacos > 0) add(lines, 'salsa_roja_pack', Math.ceil(redTacos / 3), 'Tacos y Taco Plates: salsa roja por carne')
    if (greenTacos > 0) add(lines, 'salsa_verde_pack', Math.ceil(greenTacos / 3), 'Tacos y Taco Plates: salsa verde por carne')
  }
  if (unclassifiedTacos > 0) warnings.push(`${unclassifiedTacos} taco(s) equivalentes sin carne identificable; revisar captura Toast.`)
  if (channel === 'delivery' && ['salsa_roja_pack', 'salsa_verde_pack', 'mixta_bag', 'lime_bag', 'jalapeno_2oz_bag'].some(key => lines.has(key as PackagingItemKey))) {
    add(lines, 'EL1CS2G', 1, 'Delivery: bolsa interior sellada para condimentos')
  }

  // Bolsas exteriores confirmadas por Carlos:
  // - To Go de caja y Drive Thru: usan ELTSBALA (bolsa camiseta chica)
  // - Delivery, TakeOut de plataformas y Toast Online: usan ELMES2G o ELLAS2G
  if (recognizedSelections > 0) {
    if (channel === 'to_go' || channel === 'drive_thru') {
      const bagQty = Math.max(1, Math.ceil(recognizedSelections / 6))
      add(lines, 'ELTSBALA', bagQty, `${salesChannel === 'drive_thru' ? 'Drive Thru' : 'To Go'}: bolsa camiseta chica ELTSBALA`)
    } else if (channel === 'delivery') {
      const bagKey: PackagingItemKey = recognizedSelections > 4 ? 'ELLAS2G' : 'ELMES2G'
      add(lines, bagKey, 1, 'Delivery: bolsa exterior sellada ELMES2G/ELLAS2G')
    }
  }

  return { channel: salesChannel, packagingChannel: channel, tacoCount: tacos, tacoGroups, redTacoCount: redTacos, greenTacoCount: greenTacos, unclassifiedTacoCount: unclassifiedTacos, recognizedSelections,
    lines: Array.from(lines.entries()).map(([key, data]) => ({ key, quantity: data.quantity, reason: Array.from(data.reasons).join('; ') })), pendingOuterBagPlanning: false, warnings: Array.from(new Set(warnings)) }
}

/** Backward-compatible facade retained for callers introduced during the Taco-first rollout. */
export function calculateTacoTicketPackaging(ticket: TicketPackagingTicket): TicketPackagingResult { return calculateTicketPackaging(ticket) }
