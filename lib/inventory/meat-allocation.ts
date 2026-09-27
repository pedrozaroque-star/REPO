/**
 * @module lib/inventory/meat-allocation
 * @description Interpreta proteínas y modificadores de carne que Toast adjunta al nombre del producto y genera porciones cocidas por proteína.
 * @businessRules
 *   - Si el ticket identifica varias carnes, la porción total se divide en partes iguales; si no hay evidencia, la receta base no cambia.
 *   - Extra/Doble Carne agrega una porción completa adicional; Carne Dorada en una porción de taco usa 1.9 oz totales.
 *   - Solo reemplaza ingredientes de carne; tortillas, arroz, frijoles, toppings y empaques permanecen intactos.
 *   - Tripa está descontinuada y nunca se infiere como proteína activa.
 * @dataFlow
 *   PMIX item name + receta base → parseProteinAllocation() → consumo teórico / food cost.
 * @notes
 *   - Una instrucción verbal que no fue capturada por Toast no puede rastrearse; entonces se conserva la proteína de la receta base.
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

const proteinTerms: Record<keyof typeof ACTIVE_PROTEIN_IDS, string[]> = {
  asada: ['asada'], pastor: ['pastor'], pollo: ['pollo', 'chicken'], cabeza: ['cabeza'],
  lengua: ['lengua'], chorizo: ['chorizo'], carnitas: ['carnitas'], buche: ['buche'],
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
  pastor: 0.615,   // 61.5% merma trompo y cocción
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

  const detected = Object.entries(proteinTerms)
    .filter(([, terms]) => terms.some(term => new RegExp(`\\b${term}\\b`, 'i').test(text)))
    .map(([protein]) => ACTIVE_PROTEIN_IDS[protein as keyof typeof ACTIVE_PROTEIN_IDS])

  const selectedProteinIds = detected.length > 0
    ? Array.from(new Set(detected))
    : (baseMeats.length > 0 ? baseMeats.map(ingredient => ingredient.inventory_item_id) : [ACTIVE_PROTEIN_IDS.asada])

  const isDouble = /(?:double\s*(?:meat|carne)|doble\s*carne|extra\s*(?:meat|carne))/.test(text)
  const isCarneDorada = /carne\s*dorada/.test(text)

  // Regla confirmada por Carlos:
  // - Carne Dorada en tacos: 1.9 oz cocidas servidas en plato (porción copeteada frente a 1.5 oz normal)
  // - Doble Carne: +1.5 oz en tacos (total 3.0 oz cocidas), +6.0 oz en burritos/platos (total 12.0 oz cocidas)
  let totalOz: number
  if (isCarneDorada && baseTotalOz <= 1.5) {
    totalOz = 1.9
  } else if (isDouble) {
    totalOz = baseTotalOz <= 1.5 ? 3.0 : baseTotalOz + 6.0
  } else {
    totalOz = baseTotalOz
  }

  // Mitad y Mitad (Half Meat): divide la porción total equitativamente entre las proteínas detectadas
  // Tacos: 1.5 oz / 2 = 0.75 oz c/u | Burritos: 6.0 oz / 2 = 3.0 oz c/u
  const portionsOz = new Map<string, number>()
  for (const proteinId of selectedProteinIds) {
    portionsOz.set(proteinId, totalOz / selectedProteinIds.length)
  }

  return { portionsOz, replacedBaseMeat: true }
}
