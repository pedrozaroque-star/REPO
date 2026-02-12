import { UnitType } from '@/types/inventory'

// Factores de conversión a unidad base común (ej: onzas para peso, ml para volumen)
// Peso Base: Onza (oz)
// Volumen Base: Mililitro (ml)
const WEIGHT_CONVERSION: Record<string, number> = {
    'oz': 1,
    'lb': 16,
    'kg': 35.274,
    'g': 0.035274,
}

// TODO: Definir conversiones de volumen si es necesario (gal, l, fl oz)

/**
 * Calcula el consumo REAL de inventario (Raw) basado en una cantidad de receta.
 * Mambo #5 Logic: "A little bit of yield logic makes the inventory right"
 * 
 * @param quantity Cantidad solicitada en la receta
 * @param unit Unidad de la receta
 * @param itemYieldPercent Porcentaje de rendimiento del item (0-100). Ej: 60.83 para Carne Asada.
 * @param recipeType 'raw' o 'cooked'. Si es 'cooked', aplicamos el factor de rendimiento.
 */
export function calculateRawUsage(
    quantity: number,
    unit: UnitType,
    itemYieldPercent: number = 100,
    recipeType: 'raw' | 'cooked' = 'raw'
): { quantity: number, unit: UnitType } {

    // 1. Si la receta ya es en crudo, el uso es directo.
    if (recipeType === 'raw') {
        return { quantity, unit }
    }

    // 2. Si es cocinado, inflamos el número según el rendimiento.
    // Ej: 1.5 oz cooked / 0.6083 yield = 2.46 oz raw
    const yieldFactor = itemYieldPercent / 100
    if (yieldFactor <= 0) return { quantity, unit } // Avoid division by zero safety

    const rawQuantity = quantity / yieldFactor

    return {
        quantity: Number(rawQuantity.toFixed(4)),
        unit: unit
    }
}

/**
 * Normaliza cualquier unidad de peso a Libras (lb) para estandarizar cálculos de PAR.
 */
export function normalizeToLbs(quantity: number, unit: UnitType): number {
    const factor = WEIGHT_CONVERSION[unit]
    if (!factor) {
        // Si no es unidad de peso conocida (ej: 'pza', 'caja'), retornamos tal cual
        // asumiendo que el sistema downstream manejan esas unidades enteras.
        return quantity
    }

    const oz = quantity * factor
    return oz / 16 // Return in lbs
}

/**
 * Ejemplo de uso con los datos del usuario:
 * Carne Asada:
 * - Bolsa: 10.11 lbs Raw
 * - Cocinado: 6.15 lbs
 * - Yield: 60.83%
 * 
 * Receta Taco: 1.5 oz Cooked
 * 
 * Usage = calculateRawUsage(1.5, 'oz', 60.83, 'cooked')
 * -> 2.465 oz Raw
 * 
 * Convert to Lbs = normalizeToLbs(2.465, 'oz')
 * -> 0.154 lbs Raw
 * 
 * Check: 66 tacos * 0.154 = 10.16 lbs (Approx 10.11 lbs bag) -> CORRECTO
 */
