/**
 * @module lib/inventory/meat-dish-equivalence
 * @description Motor compartido determinista de equivalencia operativa **"Platillos Vendidos en POS -> Bolsas Teóricas Cocinadas vs. Bolsas Reales Cocinadas"**.
 *   Clasifica cada línea de venta del Product Mix (incluyendo modificadores agrupados, *Taco Plates* desglosados por sub-taco y recetas virtuales de *Party Trays*)
 *   en las 7 familias oficiales de cocina de Tacos Gavilan, calcula las unidades reales servidas, onzas/libras cocidas, libras crudas y bolsas equivalentes,
 *   y concilia contra las bolsas físicas consumidas de cámara fría (`Count(t0) + Arrived - Count(t1)`).
 *
 * @businessRules
 * - **8 Familias Oficiales del Menú Real de Tacos Gavilan (`DishFamilyKey`)**:
 *   1. `'tacos'` — Tacos regulares (`1.5 oz`), Carne Dorada (`1.9 oz`), Doble Carne (`3.0 oz`) y los sub-tacos individuales dentro de cada *Taco Plate* (`3` tacos por plato).
 *   2. `'burritos'` — *Burrito* regular (`6.0 oz`), *Super Burrito* (`6.0 oz`), *Meat Only Burrito* / *Meat Only Super Burrito* (`12.0 oz`), *Double Meat* y *Burrito Huevos con Carne* (`3.0 oz`).
 *   3. `'quesadillas'` — *Quesadilla* regular y *Super Quesadilla* (`6.0 oz`, `12.0 oz` Doble Carne, `3.0 oz` Mitad Carne).
 *   4. `'mulitas'` — *Mulita* regular y *Super Mulita* (`1.5 oz` base, `3.0 oz` Doble Carne).
 *   5. `'sopes'` — *Sope* (`1.5 oz` base, `3.0 oz` Doble Carne).
 *   6. `'tortas'` — *Torta* (`6.0 oz` base, `12.0 oz` Doble Carne, `3.0 oz` *Torta Huevos con Carne*).
 *   7. `'plates_nachos_sides'` — *Plato* (`6.0 oz`), *Super Nachos* (`6.0 oz`), *Side Order Carne* (`6.0 oz`) y *Huevos con Carne* (`3.0 oz`).
 *   8. `'party_trays_lbs'` — *Party Trays / Fiesta Platters* (`15-20`, `20-25`, `25-30`, `30-40 People` -> `6 / 7.5 / 10 / 12 lb` cocidas repartidas entre las carnes elegidas) y carnes por libra (`2 lb / 6 lb / 12 lb Meat`).
 * - **Conteo Real de Tacos en Taco Plates**:
 *   Para un *Taco Plate* de cantidad `10` con los 3 sub-tacos de la proteína analizada, `ordersOrPlatesSold = 10` y `exactUnitsServed = 30` tacos reales servidos.
 *   Cuando el *Taco Plate* combina varias proteínas (ej. `2 Taco Asada + 1 Taco Pollo`) o incluye opciones sin carne (`Taco Vegetariano`), asigna exactamente los sub-tacos correspondientes a cada proteína sin inflar las demás.
 * - **Conciliación contra Cámara Fría (`BagCookingReconciliation`)**:
 *   Dado `physicalBagsCooked` (`Count(t0) + Arrived - Count(t1)`), calcula `excessBagsCooked` (`physical - theoretical`), `excessRawLbs`, `excessCookedOz`,
 *   `unbilledTacosEquiv` (`excessCookedOz / 1.5`), `unbilledBurritosEquiv` (`excessCookedOz / 6.0`), `dollarLossStoreUsd` y `dollarLossBodegaUsd`.
 *
 * @dataFlow
 *   `GET /api/inventory/meat-analysis` (`pmixItems` + `recipes` + `party-tray-guidelines` + `meat-allocation` + `inventory_counts`/`inventory_orders`)
 *   -> `classifyMeatDishFamily()` / `resolveTacoPlateProteinPortion()` / `buildBagCookingReconciliation()` -> `familyEquivalence` & `breakdown[].familyKey`.
 *
 * @notes
 * - Soporta paréntesis anidados de Toast POS (ej. `"Taco Asada (Tortilla No Grasa (In Store))"`) extrayendo de forma segura el nombre base antes del primer `(`
 *   y limpiando anotaciones operativas `(In Store)` al evaluar modificadores de *Taco Plate*.
 */

import type { ActiveProteinKey } from './meat-allocation'
import { isPartyTrayMenuItem } from './party-tray-guidelines'

export type DishFamilyKey =
  | 'tacos'
  | 'burritos'
  | 'quesadillas'
  | 'mulitas'
  | 'sopes'
  | 'tortas'
  | 'plates_nachos_sides'
  | 'party_trays_lbs'

export const DISH_FAMILY_ORDER: readonly DishFamilyKey[] = [
  'tacos',
  'burritos',
  'quesadillas',
  'mulitas',
  'sopes',
  'tortas',
  'plates_nachos_sides',
  'party_trays_lbs',
] as const

export interface DishFamilyCatalogMeta {
  familyKey: DishFamilyKey
  labelEs: string
  labelEn: string
  standardRuleEs: string
  standardRuleEn: string
}

export const DISH_FAMILY_METADATA: Record<DishFamilyKey, DishFamilyCatalogMeta> = {
  tacos: {
    familyKey: 'tacos',
    labelEs: 'Tacos y Taco Plates',
    labelEn: 'Tacos & Taco Plates',
    standardRuleEs: '1.5 oz cocidas/taco (1.9 oz Carne Dorada, 3.0 oz Doble Carne; Taco Plate = 3 tacos)',
    standardRuleEn: '1.5 oz cooked/taco (1.9 oz Crispy Meat, 3.0 oz Double Meat; Taco Plate = 3 tacos)',
  },
  burritos: {
    familyKey: 'burritos',
    labelEs: 'Burritos (Regular, Super, Meat Only y Huevos)',
    labelEn: 'Burritos (Regular, Super, Meat Only & Eggs)',
    standardRuleEs: '6.0 oz Regular/Super (12.0 oz Meat Only / Doble Carne, 3.0 oz Burrito Huevos)',
    standardRuleEn: '6.0 oz Regular/Super (12.0 oz Meat Only / Double Meat, 3.0 oz Egg Burrito)',
  },
  quesadillas: {
    familyKey: 'quesadillas',
    labelEs: 'Quesadillas (Regular y Super Quesadilla)',
    labelEn: 'Quesadillas (Regular & Super Quesadilla)',
    standardRuleEs: '6.0 oz cocidas/quesadilla (12.0 oz Doble Carne, 3.0 oz Mitad Carne)',
    standardRuleEn: '6.0 oz cooked/quesadilla (12.0 oz Double Meat, 3.0 oz Half Meat)',
  },
  mulitas: {
    familyKey: 'mulitas',
    labelEs: 'Mulitas (Regular y Super Mulita)',
    labelEn: 'Mulitas (Regular & Super Mulita)',
    standardRuleEs: '1.5 oz cocidas/mulita (3.0 oz Doble Carne)',
    standardRuleEn: '1.5 oz cooked/mulita (3.0 oz Double Meat)',
  },
  sopes: {
    familyKey: 'sopes',
    labelEs: 'Sopes',
    labelEn: 'Sopes',
    standardRuleEs: '1.5 oz cocidas/sope (3.0 oz Doble Carne)',
    standardRuleEn: '1.5 oz cooked/sope (3.0 oz Double Meat)',
  },
  tortas: {
    familyKey: 'tortas',
    labelEs: 'Tortas (Regular y Huevos con Carne)',
    labelEn: 'Tortas (Regular & Eggs with Meat)',
    standardRuleEs: '6.0 oz cocidas/torta (12.0 oz Doble Carne, 3.0 oz Torta Huevos)',
    standardRuleEn: '6.0 oz cooked/torta (12.0 oz Double Meat, 3.0 oz Egg Torta)',
  },
  plates_nachos_sides: {
    familyKey: 'plates_nachos_sides',
    labelEs: 'Platos, Super Nachos, Huevos y Side Order Carne',
    labelEn: 'Plates, Super Nachos, Eggs & Side Order Meat',
    standardRuleEs: '6.0 oz Plato / Super Nachos / Side Order Carne; 3.0 oz Huevos con Carne',
    standardRuleEn: '6.0 oz Plate / Super Nachos / Side Order Meat; 3.0 oz Eggs with Meat',
  },
  party_trays_lbs: {
    familyKey: 'party_trays_lbs',
    labelEs: 'Party Trays / Fiesta Platters y Carne por Libra (2 / 6 / 12 lb)',
    labelEn: 'Party Trays / Fiesta Platters & Meat by the Pound (2 / 6 / 12 lb)',
    standardRuleEs: 'Party Trays 6 / 7.5 / 10 / 12 lb cocidas y órdenes 2 / 6 / 12 lb Meat',
    standardRuleEn: '6 / 7.5 / 10 / 12 lb cooked Party Trays & 2 / 6 / 12 lb Meat orders',
  },
}

export interface DishFamilyEquivalenceRow {
  familyKey: DishFamilyKey
  labelEs: string
  labelEn: string
  ordersOrPlatesSold: number
  exactUnitsServed: number
  cookedOz: number
  cookedLbs: number
  rawLbs: number
  equivalentBagsCooked: number
  sharePct: number
  costStoreUsd: number
  costBodegaUsd: number
  standardRuleEs: string
  standardRuleEn: string
}

export interface BagCookingTotals {
  tacosServed: number
  burritosServed: number
  quesadillasServed: number
  mulitasServed: number
  tortasServed: number
  platesSidesServed: number
  partyTraysAndLbsServed: number
  totalCookedOz: number
  totalCookedLbs: number
  totalRawLbs: number
  theoreticalBagsCooked: number
}

export interface BagCookingReconciliation {
  families: DishFamilyEquivalenceRow[]
  totals: BagCookingTotals
  physicalBagsCooked: number | null
  excessBagsCooked: number | null
  excessRawLbs: number | null
  excessCookedOz: number | null
  unbilledTacosEquiv: number | null
  unbilledBurritosEquiv: number | null
  dollarLossStoreUsd: number | null
  dollarLossBodegaUsd: number | null
}

export interface DishConsumptionLineInput {
  guid?: string | null
  itemName: string
  soldQty: number
  exactUnitsServed?: number
  familyKey?: DishFamilyKey
  cookedLbs: number
  rawLbs: number
  costStoreUsd: number
  costBodegaUsd: number
}

export interface BuildBagCookingReconciliationParams {
  lines: DishConsumptionLineInput[]
  bagWeightLbs: number
  yieldRatio: number
  costPerRawLbStore: number
  costPerRawLbBodega: number
  physicalBagsCooked: number | null
  /** Libras crudas físicas exactas (opcional cuando el periodo cruza un cambio histórico de tamaño de bolsa). */
  physicalRawLbs?: number | null
}

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0
  return Math.round(val * 100) / 100
}

function normalizeText(val: unknown): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Extrae el nombre base del platillo en Toast POS antes del primer paréntesis de modificadores,
 * inmune a paréntesis anidados como `"Taco Asada (Tortilla No Grasa (In Store))"`.
 */
export function extractBaseMenuItemName(rawItemName?: string | null): string {
  const raw = String(rawItemName || '')
  const openIdx = raw.indexOf('(')
  return (openIdx >= 0 ? raw.slice(0, openIdx) : raw).trim()
}

/**
 * Extrae todos los bloques de modificadores entre paréntesis de nivel superior en `rawItemName`,
 * limpiando anotaciones operativas internas como `(In Store)` sin truncar el resto del grupo.
 */
export function extractTopLevelParentheticalGroups(rawItemName?: string | null): string[] {
  const raw = String(rawItemName || '')
  if (!raw.includes('(')) return []

  const groups: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '(') {
      if (depth > 0) current += ' '
      depth += 1
    } else if (ch === ')') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0) {
          const cleaned = current.replace(/\bin\s+store\b/gi, ' ').replace(/\s+/g, ' ').trim()
          if (cleaned) groups.push(cleaned)
          current = ''
        } else {
          current += ' '
        }
      }
    } else if (depth > 0) {
      current += ch
    }
  }

  // Si un paréntesis quedó sin cerrar por truncamiento de nombre en POS, conservar el remanente
  if (depth > 0 && current.trim()) {
    const cleaned = current.replace(/\bin\s+store\b/gi, ' ').replace(/\s+/g, ' ').trim()
    if (cleaned) groups.push(cleaned)
  }

  return groups
}

/**
 * Determina si el platillo corresponde a un *Taco Plate* (plato de 3 tacos con arroz y frijol).
 */
export function isTacoPlateMenuItem(rawItemName?: string | null): boolean {
  const baseNorm = normalizeText(extractBaseMenuItemName(rawItemName))
  return /\b(?:taco\s*plates?|plates?\s*of\s*tacos?|platos?\s*de\s*tacos?)\b/.test(baseNorm)
}

/**
 * Resuelve cuántos sub-tacos individuales y cuántas onzas cocidas de `proteinKey` contiene un *Taco Plate*
 * por cada orden vendida (`3` sub-tacos × `1.5 oz` = `4.5 oz` totales por plato).
 *
 * Respeta elecciones sin proteína activa (`Taco Vegetariano`, `Taco Tripa`) como slots reales del plato
 * para jamás sobre-asignar carne a las demás proteínas del mismo plato.
 */
export function resolveTacoPlateProteinPortion(params: {
  itemName: string
  modifierTexts?: string[]
  proteinKey: ActiveProteinKey
}): {
  recognizedSlotsCount: number
  subTacosPerOrder: number
  cookedOzPerOrder: number
} {
  const parenGroups = extractTopLevelParentheticalGroups(params.itemName)
  // Cuando `bundleModifiers: true`, `itemName` ya contiene los modificadores exactos de 1 orden entre paréntesis;
  // solo usamos `modifierTexts` como respaldo si el nombre vino sin paréntesis.
  const rawSources =
    parenGroups.length > 0
      ? parenGroups.map(normalizeText)
      : (params.modifierTexts || []).map((m) => normalizeText(String(m || '').replace(/\(\s*in\s+store\s*\)/gi, ' ')))

  const tokens = rawSources
    .flatMap((src) => src.split(/[,;/]/))
    .map((s) => s.trim())
    .filter(Boolean)

  type TacoSlotKind = ActiveProteinKey | 'non_active_taco'
  const slots: TacoSlotKind[] = []

  const proteinPatterns: Array<[ActiveProteinKey, RegExp]> = [
    ['asada', /\basada\b/],
    ['pastor', /\bpastor\b/],
    ['pollo', /\b(?:pollo|chicken)\b/],
    ['cabeza', /\bcabeza\b/],
    ['lengua', /\blengua\b/],
    ['chorizo', /\bchorizo\b/],
    ['carnitas', /\bcarnitas\b/],
    ['buche', /\bbuche\b/],
  ]

  for (const tok of tokens) {
    let matchedProtein: ActiveProteinKey | null = null
    for (const [pk, rx] of proteinPatterns) {
      if (rx.test(tok)) {
        matchedProtein = pk
        break
      }
    }
    if (matchedProtein) {
      slots.push(matchedProtein)
    } else if (/\b(?:vegetariano|veggie|tripa)\b/.test(tok)) {
      slots.push('non_active_taco')
    }
  }

  if (slots.length === 0) {
    return {
      recognizedSlotsCount: 0,
      subTacosPerOrder: 0,
      cookedOzPerOrder: 0,
    }
  }

  const targetMatches = slots.filter((s) => s === params.proteinKey).length
  if (targetMatches === 0) {
    return {
      recognizedSlotsCount: slots.length,
      subTacosPerOrder: 0,
      cookedOzPerOrder: 0,
    }
  }

  const subTacosPerOrder = (3 * targetMatches) / slots.length
  const combinedNorm = rawSources.join(' ')
  const hasDoubleMeat = /\b(?:double|doble|extra)\s*(?:meat|carne)\b/.test(combinedNorm)
  const hasCarneDorada = /\bcarne\s*dorada\b/.test(combinedNorm)
  const ozPerSubTaco = 1.5 + (hasDoubleMeat ? 1.5 : 0) + (hasCarneDorada ? 0.4 : 0)
  const cookedOzPerOrder = subTacosPerOrder * ozPerSubTaco // 4.5 oz base por plato de 3 tacos (+ extras si aplica)

  return {
    recognizedSlotsCount: slots.length,
    subTacosPerOrder,
    cookedOzPerOrder,
  }
}

/**
 * Clasifica determinísticamente cualquier platillo del menú POS en una de las 7 familias de cocina.
 */
export function classifyMeatDishFamily(rawItemName?: string | null, toastGuid?: string | null): DishFamilyKey {
  if (isPartyTrayMenuItem(rawItemName, toastGuid)) {
    return 'party_trays_lbs'
  }

  const baseNorm = normalizeText(extractBaseMenuItemName(rawItemName))
  const fullNorm = normalizeText(rawItemName)

  // 1. Party Trays / Charolas y Carnes por Libra (2 lb / 6 lb / 12 lb Meat, botones de 1 lb por proteína)
  if (
    /\b\d+(?:\.\d+)?\s*lbs?\s*(?:meat|carne|asada|pastor|pollo|chicken|cabeza|lengua|carnitas|chorizo|buche)\b/.test(baseNorm) ||
    /\b\d+(?:\.\d+)?\s*lbs?\s*meat\b/.test(fullNorm) ||
    /\b(?:party\s*trays?|fiesta\s*platters?|charolas?|catering\s*meat|carne\s*por\s*libra)\b/.test(baseNorm) ||
    /^(?:asada|pastor|pollo|chicken|cabeza|lengua|carnitas|chorizo|buche)$/.test(baseNorm)
  ) {
    return 'party_trays_lbs'
  }

  // 2. Tacos (incluye Taco Plates cuyos sub-tacos son tacos reales servidos)
  if (isTacoPlateMenuItem(rawItemName) || /\btacos?\b/.test(baseNorm)) {
    return 'tacos'
  }

  // 3. Burritos (Regular, Super, Meat Only y Huevos con Carne)
  if (/\bburritos?\b/.test(baseNorm)) {
    return 'burritos'
  }

  // 4. Quesadillas (Regular y Super Quesadilla)
  if (/\bquesadillas?\b/.test(baseNorm)) {
    return 'quesadillas'
  }

  // 5. Mulitas (Regular y Super Mulita)
  if (/\bmulitas?\b/.test(baseNorm)) {
    return 'mulitas'
  }

  // 6. Sopes
  if (/\bsopes?\b/.test(baseNorm)) {
    return 'sopes'
  }

  // 7. Tortas
  if (/\btortas?\b/.test(baseNorm)) {
    return 'tortas'
  }

  // 8. Platos, Super Nachos, Side Order Carne y Huevos con Carne
  return 'plates_nachos_sides'
}

/**
 * Resuelve cuántas piezas reales se sirvieron en una línea de venta POS:
 * - Para *Taco Plate*: cuenta los sub-tacos individuales de esa proteína (ej. `10` platos × `3` tacos = `30` tacos).
 * - Para combinaciones explícitas con conteo de tacos en nombre (ej. `"2 Tacos Combo"`): multiplica por ese conteo.
 * - Para el resto de platillos (Taco regular/dorado/doble, Burrito, Quesadilla, Mulita, Torta, Plato, Party Tray): `soldQty`.
 */
export function resolveExactUnitsServedForLine(params: {
  itemName: string
  soldQty: number
  cookedLbsPerOrder?: number
  explicitSubUnitsPerOrder?: number
}): number {
  const qty = Number(params.soldQty || 0)
  if (!Number.isFinite(qty) || qty <= 0) return 0

  if (params.explicitSubUnitsPerOrder !== undefined && params.explicitSubUnitsPerOrder > 0) {
    return round2(qty * params.explicitSubUnitsPerOrder)
  }

  if (isTacoPlateMenuItem(params.itemName)) {
    const cookedOzPerOrder = Number(params.cookedLbsPerOrder || 0) * 16
    const inferredSubTacos = cookedOzPerOrder > 0 ? cookedOzPerOrder / 1.5 : 3
    return round2(qty * inferredSubTacos)
  }

  const baseNorm = normalizeText(extractBaseMenuItemName(params.itemName))
  const multiTacoMatch = baseNorm.match(/\b(\d+)\s*tacos?\b/)
  if (multiTacoMatch) {
    const countPerOrder = parseInt(multiTacoMatch[1], 10)
    if (Number.isFinite(countPerOrder) && countPerOrder > 0) {
      return round2(qty * countPerOrder)
    }
  }

  return round2(qty)
}

/**
 * Construye la matriz completa de equivalencia de las 7 familias de platillos a bolsas cocinadas
 * y la conciliación directa contra las bolsas físicas reales de cámara fría (`Count(t0) + Arrived - Count(t1)`).
 */
export function buildBagCookingReconciliation(
  params: BuildBagCookingReconciliationParams
): BagCookingReconciliation {
  const safeBagWeightLbs = Number(params.bagWeightLbs) > 0 ? Number(params.bagWeightLbs) : 10
  const safeYieldRatio = Number(params.yieldRatio) > 0 ? Number(params.yieldRatio) : 1
  const costPerRawLbStore = Number.isFinite(params.costPerRawLbStore) ? params.costPerRawLbStore : 0
  const costPerRawLbBodega = Number.isFinite(params.costPerRawLbBodega) ? params.costPerRawLbBodega : 0

  const accumulators = new Map<
    DishFamilyKey,
    {
      ordersOrPlatesSold: number
      exactUnitsServed: number
      cookedLbs: number
      rawLbs: number
      costStoreUsd: number
      costBodegaUsd: number
    }
  >()

  for (const key of DISH_FAMILY_ORDER) {
    accumulators.set(key, {
      ordersOrPlatesSold: 0,
      exactUnitsServed: 0,
      cookedLbs: 0,
      rawLbs: 0,
      costStoreUsd: 0,
      costBodegaUsd: 0,
    })
  }

  let exactTotalCookedLbs = 0
  let exactTotalRawLbs = 0

  for (const line of params.lines) {
    const soldQty = Number(line.soldQty || 0)
    const rawLbs = Number(line.rawLbs || 0)
    const cookedLbs = Number(line.cookedLbs || 0)
    if (!Number.isFinite(soldQty) || soldQty <= 0 || !Number.isFinite(rawLbs) || rawLbs <= 0) {
      continue
    }

    const familyKey = line.familyKey || classifyMeatDishFamily(line.itemName, line.guid)
    const cookedLbsPerOrder = soldQty > 0 ? cookedLbs / soldQty : 0
    const unitsServed =
      line.exactUnitsServed !== undefined && Number.isFinite(line.exactUnitsServed)
        ? Number(line.exactUnitsServed)
        : resolveExactUnitsServedForLine({
            itemName: line.itemName,
            soldQty,
            cookedLbsPerOrder,
          })

    const bucket = accumulators.get(familyKey)!
    bucket.ordersOrPlatesSold += soldQty
    bucket.exactUnitsServed += unitsServed
    bucket.cookedLbs += cookedLbs
    bucket.rawLbs += rawLbs
    bucket.costStoreUsd += Number.isFinite(line.costStoreUsd) ? line.costStoreUsd : rawLbs * costPerRawLbStore
    bucket.costBodegaUsd += Number.isFinite(line.costBodegaUsd) ? line.costBodegaUsd : rawLbs * costPerRawLbBodega

    exactTotalCookedLbs += cookedLbs
    exactTotalRawLbs += rawLbs
  }

  const families: DishFamilyEquivalenceRow[] = DISH_FAMILY_ORDER.map((familyKey) => {
    const meta = DISH_FAMILY_METADATA[familyKey]
    const acc = accumulators.get(familyKey)!
    const cookedOz = acc.cookedLbs * 16
    const equivalentBags = safeBagWeightLbs > 0 ? acc.rawLbs / safeBagWeightLbs : 0
    const sharePct = exactTotalRawLbs > 0 ? (acc.rawLbs / exactTotalRawLbs) * 100 : 0

    return {
      familyKey,
      labelEs: meta.labelEs,
      labelEn: meta.labelEn,
      ordersOrPlatesSold: round2(acc.ordersOrPlatesSold),
      exactUnitsServed: round2(acc.exactUnitsServed),
      cookedOz: round2(cookedOz),
      cookedLbs: round2(acc.cookedLbs),
      rawLbs: round2(acc.rawLbs),
      equivalentBagsCooked: round2(equivalentBags),
      sharePct: round2(sharePct),
      costStoreUsd: round2(acc.costStoreUsd),
      costBodegaUsd: round2(acc.costBodegaUsd),
      standardRuleEs: meta.standardRuleEs,
      standardRuleEn: meta.standardRuleEn,
    }
  })

  const exactTotalCookedOz = exactTotalCookedLbs * 16
  const exactTheoreticalBags = safeBagWeightLbs > 0 ? exactTotalRawLbs / safeBagWeightLbs : 0

  const totals: BagCookingTotals = {
    tacosServed: round2(accumulators.get('tacos')!.exactUnitsServed),
    burritosServed: round2(accumulators.get('burritos')!.exactUnitsServed),
    quesadillasServed: round2(accumulators.get('quesadillas')!.exactUnitsServed),
    mulitasServed: round2(accumulators.get('mulitas')!.exactUnitsServed),
    tortasServed: round2(accumulators.get('tortas')!.exactUnitsServed),
    platesSidesServed: round2(
      accumulators.get('plates_nachos_sides')!.exactUnitsServed + accumulators.get('sopes')!.exactUnitsServed
    ),
    partyTraysAndLbsServed: round2(accumulators.get('party_trays_lbs')!.exactUnitsServed),
    totalCookedOz: round2(exactTotalCookedOz),
    totalCookedLbs: round2(exactTotalCookedLbs),
    totalRawLbs: round2(exactTotalRawLbs),
    theoreticalBagsCooked: round2(exactTheoreticalBags),
  }

  const hasPhysical =
    params.physicalBagsCooked !== null &&
    params.physicalBagsCooked !== undefined &&
    Number.isFinite(params.physicalBagsCooked)

  if (!hasPhysical) {
    return {
      families,
      totals,
      physicalBagsCooked: null,
      excessBagsCooked: null,
      excessRawLbs: null,
      excessCookedOz: null,
      unbilledTacosEquiv: null,
      unbilledBurritosEquiv: null,
      dollarLossStoreUsd: null,
      dollarLossBodegaUsd: null,
    }
  }

  const resolvedPhysicalBags = Number(params.physicalBagsCooked)
  const resolvedPhysicalRawLbs =
    params.physicalRawLbs !== null &&
    params.physicalRawLbs !== undefined &&
    Number.isFinite(params.physicalRawLbs)
      ? Number(params.physicalRawLbs)
      : resolvedPhysicalBags * safeBagWeightLbs

  const exactExcessRawLbs = resolvedPhysicalRawLbs - exactTotalRawLbs
  const exactExcessBags = safeBagWeightLbs > 0 ? exactExcessRawLbs / safeBagWeightLbs : 0
  const exactExcessCookedOz = exactExcessRawLbs * safeYieldRatio * 16

  return {
    families,
    totals,
    physicalBagsCooked: round2(resolvedPhysicalBags),
    excessBagsCooked: round2(exactExcessBags),
    excessRawLbs: round2(exactExcessRawLbs),
    excessCookedOz: round2(exactExcessCookedOz),
    unbilledTacosEquiv: round2(exactExcessCookedOz / 1.5),
    unbilledBurritosEquiv: round2(exactExcessCookedOz / 6.0),
    dollarLossStoreUsd: round2(exactExcessRawLbs * costPerRawLbStore),
    dollarLossBodegaUsd: round2(exactExcessRawLbs * costPerRawLbBodega),
  }
}
