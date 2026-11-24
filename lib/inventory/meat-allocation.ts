/**
 * @module lib/inventory/meat-allocation
 * @description Interpreta proteínas y modificadores de carne que Toast adjunta al nombre del producto,
 *   genera porciones cocidas exactas por proteína y exporta los pesos canónicos por bolsa de Bodega.
 * @businessRules
 *   - Si el ticket identifica varias carnes base (ej. `Half Pastor`), la porción base se divide en partes iguales;
 *     si no hay evidencia, la receta base no cambia.
 *   - Extra/Doble Carne genérica (`Double Meat`, `Extra Carne`) agrega una porción adicional (`+1.5 oz` en tacos `<= 1.5 oz`, `+6.0 oz` en platillos mayores).
 *   - Extra/Doble de una proteína específica (`Extra Pastor`, `Doble Asada`, `Extra Carne Pastor`) conserva íntegra la porción base
 *     de la proteína principal y suma la porción extra (`+1.5 oz` o `+6.0 oz`) a la proteína extra indicada (jamás divide 50/50 la base).
 *   - `Carne Dorada` en tacos (`baseTotalOz <= 1.5`) agrega `+0.4 oz` por porción copeteada (`1.9 oz` simple; `3.4 oz` cuando además lleva `Double/Extra Meat`).
 *   - Pesos físicos reales por bolsa de Bodega (`MEAT_DEFAULT_BAG_LBS`): Asada `10 lb`, Pastor `5 lb`, Pollo `5 lb`,
 *     Cabeza `2.5 lb`, Lengua `2.5 lb`, Chorizo `0.5 lb` (`8 oz`), Buche `0.375 lb` (`6 oz`), Carnitas `0.375 lb` (`6 oz`).
 *   - Solo reemplaza ingredientes de carne; tortillas, arroz, frijoles, toppings y empaques permanecen intactos.
 *   - Tripa está descontinuada y nunca se infiere como proteína activa.
 * @dataFlow
 *   PMIX item name + receta base → `parseProteinAllocation()` → consumo teórico / food cost / varianza AvT.
 * @notes
 *   - Una instrucción verbal que no fue capturada por Toast no puede rastrearse; entonces se conserva la proteína de la receta base.
 *   - [2026-11-23] Corregida combinación `Carne Dorada + Double/Extra Meat` (`1.9 + 1.5 = 3.4 oz`, antes descartaba `Double Meat` quedando en `1.9 oz`),
 *     corregido modificador `Extra <Proteína>` / `Doble <Proteína>` (`6 oz Asada + 6 oz Pastor = 12 oz` en vez de `3 + 3 = 6 oz`),
 *     y exportado `MEAT_DEFAULT_BAG_LBS` canónico alineado con `daily-order-consumption-engine.ts`.
 */

export const ACTIVE_PROTEIN_IDS = {
  asada: 'fab9d589-8ae8-4381-87da-85f836068996',
  pastor: 'ad7e3703-2701-4a05-aa97-77866c8c717e',
  pollo: '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
  cabeza: '511e341b-ca42-44ed-89df-a4a84b51a619',
  lengua: '0fb87578-1185-41a9-a318-97428db20a5d',
  chorizo: '1e4c43b6-4e1b-4e51-8617-e127b89467f1',
  carnitas: '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
  buche: 'baac1d41-3b80-4f80-acfc-7a19f46e03c2',
} as const

export type ActiveProteinKey = keyof typeof ACTIVE_PROTEIN_IDS

/**
 * Peso físico real en libras crudas por bolsa/paquete estándar entregado por La Bodega a sucursales.
 * Alineado 1:1 con `daily-order-consumption-engine.ts`.
 */
export const MEAT_DEFAULT_BAG_LBS: Record<ActiveProteinKey, number> = {
  asada: 10,
  pastor: 5,
  pollo: 5,
  cabeza: 2.5,
  lengua: 2.5,
  chorizo: 0.5,
  buche: 0.375,
  carnitas: 0.375,
}

export const MEAT_DEFAULT_BAG_LBS_BY_ID: Record<string, number> = {
  [ACTIVE_PROTEIN_IDS.asada]: MEAT_DEFAULT_BAG_LBS.asada,
  [ACTIVE_PROTEIN_IDS.pastor]: MEAT_DEFAULT_BAG_LBS.pastor,
  [ACTIVE_PROTEIN_IDS.pollo]: MEAT_DEFAULT_BAG_LBS.pollo,
  [ACTIVE_PROTEIN_IDS.cabeza]: MEAT_DEFAULT_BAG_LBS.cabeza,
  [ACTIVE_PROTEIN_IDS.lengua]: MEAT_DEFAULT_BAG_LBS.lengua,
  [ACTIVE_PROTEIN_IDS.chorizo]: MEAT_DEFAULT_BAG_LBS.chorizo,
  [ACTIVE_PROTEIN_IDS.buche]: MEAT_DEFAULT_BAG_LBS.buche,
  [ACTIVE_PROTEIN_IDS.carnitas]: MEAT_DEFAULT_BAG_LBS.carnitas,
}

const proteinTerms: Record<ActiveProteinKey, string[]> = {
  asada: ['asada'], pastor: ['pastor'], pollo: ['pollo', 'chicken'], cabeza: ['cabeza'],
  lengua: ['lengua'], chorizo: ['chorizo'], carnitas: ['carnitas'], buche: ['buche'],
}

const termToProteinId: Record<string, string> = {
  asada: ACTIVE_PROTEIN_IDS.asada,
  pastor: ACTIVE_PROTEIN_IDS.pastor,
  pollo: ACTIVE_PROTEIN_IDS.pollo,
  chicken: ACTIVE_PROTEIN_IDS.pollo,
  cabeza: ACTIVE_PROTEIN_IDS.cabeza,
  lengua: ACTIVE_PROTEIN_IDS.lengua,
  chorizo: ACTIVE_PROTEIN_IDS.chorizo,
  carnitas: ACTIVE_PROTEIN_IDS.carnitas,
  buche: ACTIVE_PROTEIN_IDS.buche,
}

export interface MeatRecipeIngredient {
  inventory_item_id: string
  quantity: number
  unit: string
}

export interface ProteinAllocation {
  portionsOz: Map<string, number>
  replacedBaseMeat: boolean
}

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const toOz = (quantity: number, unit: string) => {
  if (unit === 'lb') return quantity * 16
  return unit === 'oz' ? quantity : 0
}

export const MEAT_COOKING_YIELDS: Record<keyof typeof ACTIVE_PROTEIN_IDS, number> = {
  asada: 0.615,    // 61.5% merma parrilla
  pastor: 0.615,   // 61.5% merma parrilla y cocción
  pollo: 0.650,    // 65.0% merma cocción
  cabeza: 0.870,   // 87.0% cocción vapor
  lengua: 1.000,   // 100.0% procesada
  carnitas: 1.000, // 100.0% pesaje directo
  buche: 1.000,    // 100.0% pesaje directo
  chorizo: 0.750,  // 75.0% (2.0 oz crudo rinde 1.5 oz cocido)
}

/**
 * Convierte onzas de carne cocinada servida en el restaurante a libras crudas para descuento de inventario en Bodega.
 */
export function cookedOzToRawLbs(cookedOz: number, protein: keyof typeof ACTIVE_PROTEIN_IDS): number {
  const yieldFactor = MEAT_COOKING_YIELDS[protein] || 1.0
  const cookedLbs = cookedOz / 16
  return cookedLbs / yieldFactor
}

/**
 * Resuelve el peso estándar por bolsa (en lbs crudas) a partir de la clave de proteína, UUID de inventario o nombre del insumo.
 */
export function getMeatDefaultBagLbs(proteinOrItemId?: string | null, fallbackLbs = 10): number {
  if (!proteinOrItemId) return fallbackLbs
  const raw = String(proteinOrItemId).trim()
  if (raw in MEAT_DEFAULT_BAG_LBS_BY_ID) {
    return MEAT_DEFAULT_BAG_LBS_BY_ID[raw]
  }
  const clean = normalized(raw)
  if (clean in MEAT_DEFAULT_BAG_LBS) {
    return MEAT_DEFAULT_BAG_LBS[clean as ActiveProteinKey]
  }
  for (const [protein, terms] of Object.entries(proteinTerms)) {
    if (terms.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(clean))) {
      return MEAT_DEFAULT_BAG_LBS[protein as ActiveProteinKey]
    }
  }
  return fallbackLbs
}

export function parseProteinAllocation(itemName: string, recipeIngredients: MeatRecipeIngredient[]): ProteinAllocation | null {
  const text = normalized(itemName)
  const baseMeats = recipeIngredients.filter(ingredient => Object.values(ACTIVE_PROTEIN_IDS).includes(ingredient.inventory_item_id as never))
  let baseTotalOz = baseMeats.reduce((sum, ingredient) => sum + toOz(Number(ingredient.quantity) || 0, ingredient.unit || 'oz'), 0)

  // Side Order Carne: confirmado por Carlos en 6.0 oz cocidas servidas en vaso de 8 oz
  if (baseTotalOz <= 0 && /side\s*(?:order\s*)?carne/.test(text)) {
    baseTotalOz = 6.0
  }

  // Carne individual por libra (Catering): confirmado por Carlos que en Toast ya es cocinada
  if (baseTotalOz <= 0) {
    const lbMatch = text.match(/\b(\d+)\s*lb\s*meat\b/)
    if (lbMatch) {
      baseTotalOz = parseInt(lbMatch[1], 10) * 16 // 2 lb = 32 oz, 6 lb = 96 oz, 12 lb = 192 oz
    }
  }

  if (baseTotalOz <= 0) return null

  // 1. Extraer modificadores explícitos de Extra/Doble con proteína específica
  //    ej. "Burrito Asada (Extra Pastor)", "Taco Asada (Extra Asada)", "Burrito Pollo (Doble Carne Pastor)"
  const explicitExtraRegex = /\b(?:extra|doble|double)(?:\s+(?:meat|carne))?(?:[\s:/-]+(?:de\s+)?)?(asada|pastor|pollo|chicken|cabeza|lengua|chorizo|carnitas|buche)\b/gi
  const explicitExtraProteinIds: string[] = []
  for (const match of text.matchAll(explicitExtraRegex)) {
    const pId = termToProteinId[match[1].toLowerCase()]
    if (pId) explicitExtraProteinIds.push(pId)
  }

  // Remover los fragmentos "Extra <Proteína>" antes de detectar la(s) proteína(s) base / Half Meat
  const remainingText = text.replace(explicitExtraRegex, ' ')

  const detectedBase = Object.entries(proteinTerms)
    .filter(([, terms]) => terms.some(term => new RegExp(`\\b${term}\\b`, 'i').test(remainingText)))
    .map(([protein]) => ACTIVE_PROTEIN_IDS[protein as ActiveProteinKey])

  const selectedBaseProteinIds = detectedBase.length > 0
    ? Array.from(new Set(detectedBase))
    : (baseMeats.length > 0 ? baseMeats.map(ingredient => ingredient.inventory_item_id) : [ACTIVE_PROTEIN_IDS.asada])

  const hasGenericDouble = /\b(?:double\s*(?:meat|carne)|doble\s*(?:meat|carne)|extra\s*(?:meat|carne))\b/i.test(remainingText)
  const isCarneDorada = /\bcarne\s*dorada\b/i.test(text)

  // Regla operativa oficial:
  // - Porción extra unitaria: +1.5 oz en tacos/sopes/mulitas (<= 1.5 oz base), +6.0 oz en burritos/platos/tortas/quesadillas/nachos
  // - Carne Dorada en tacos (<= 1.5 oz base): +0.4 oz copeteada sobre la porción base (1.9 oz simple; 3.4 oz con Double/Extra Meat)
  const extraUnitOz = baseTotalOz <= 1.5 ? 1.5 : 6.0
  const baseEffectiveOz =
    (isCarneDorada && baseTotalOz <= 1.5 ? 1.9 : baseTotalOz) +
    (hasGenericDouble ? extraUnitOz : 0)

  // Mitad y Mitad (Half Meat): divide la porción base (y Double genérico si aplica) equitativamente entre las proteínas base
  const portionsOz = new Map<string, number>()
  const perBaseProteinOz = baseEffectiveOz / selectedBaseProteinIds.length
  for (const proteinId of selectedBaseProteinIds) {
    portionsOz.set(proteinId, (portionsOz.get(proteinId) || 0) + perBaseProteinOz)
  }

  // Sumar porciones de Extra/Doble con proteína específica sin diluir la proteína base
  for (const extraProteinId of explicitExtraProteinIds) {
    portionsOz.set(extraProteinId, (portionsOz.get(extraProteinId) || 0) + extraUnitOz)
  }

  return { portionsOz, replacedBaseMeat: true }
}
