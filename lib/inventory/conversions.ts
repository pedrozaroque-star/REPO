import { UnitType } from '@/types/inventory'

const WEIGHT_CONVERSION: Record<string, number> = {
    'oz': 1,
    'lb': 16,
    'kg': 35.274,
    'g': 0.035274,
}

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

export function normalizeToLbs(quantity: number, unit: UnitType): number {
    const factor = WEIGHT_CONVERSION[unit]
    if (!factor) {
        return quantity
    }

    const oz = quantity * factor
    return oz / 16 // Return in lbs
}

// Helper to normalize unit strings (e.g. "gallons" -> "gal")
function normalizeUnit(u: string): string {
    const s = u.toLowerCase().trim().replace(/s$/, '') // simple plural removal first

    const ALIASES: Record<string, string> = {
        'gallon': 'gal',
        'gal': 'gal',
        'liter': 'l',
        'litre': 'l',
        'l': 'l',
        'milliliter': 'ml',
        'ml': 'ml',
        'pound': 'lb',
        'lb': 'lb',
        'ounce': 'oz',
        'oz': 'oz',
        'fl oz': 'fl oz',
        'gram': 'g',
        'g': 'g',
        'kilogram': 'kg',
        'kg': 'kg',
        'piece': 'pza',
        'pza': 'pza',
        'each': 'pza',
        'count': 'ct', // treats as pza usually
        'ct': 'ct',
        'unit': 'pza',
        'dozen': 'dz',
        'doz': 'dz',
        'dz': 'dz'
    }
    return ALIASES[s] || s
}

// Helper to parse "10 lb", "25 pza", "1 gal", "4.5 oz" strings
function parseUnitString(unitString: string): { factor: number, baseUnit: string } {
    if (!unitString) return { factor: 1, baseUnit: 'pza' }

    // Normalize
    const u = unitString.toLowerCase().trim()

    // Match "Number Unit" pattern (e.g. "10 lb", "2.5 oz", "25 pza")
    const match = u.match(/^([\d.]+)\s*([a-z\s]+)$/)

    if (match) {
        return {
            factor: parseFloat(match[1]),
            baseUnit: normalizeUnit(match[2])
        }
    }

    // Special handling for known patterns
    const normalized = normalizeUnit(u)
    return { factor: 1, baseUnit: normalized }
}

/**
 * Calculates HOW MUCH of an Inventory Item is used based on Recipe amount.
 */
export function calculateInventoryUsage(
    recipeQuantity: number,
    recipeUnit: string,
    inventoryItemUnit: string
): number {
    const fromUnitRaw = recipeUnit || 'pza'
    // Normalize Inputs
    const { baseUnit: safeFrom, factor: recipeFactor } = parseUnitString(fromUnitRaw)
    const normFrom = normalizeUnit(fromUnitRaw)

    const invUnitString = inventoryItemUnit || 'pza'
    const { factor: invFactor, baseUnit: invBase } = parseUnitString(invUnitString)

    let quantityInBase = recipeQuantity * recipeFactor // Adjust if recipe unit input was complex like "2 oz"

    // 1. Weight Conversions (Base: lb/oz/kg)
    if (['lb', 'oz', 'kg', 'g'].includes(invBase)) {
        // Convert TO LBS as standard middle ground
        let lbs = 0
        if (normFrom === 'lb') lbs = quantityInBase
        else if (normFrom === 'oz') lbs = quantityInBase / 16
        else if (normFrom === 'kg') lbs = quantityInBase * 2.20462
        else if (normFrom === 'g') lbs = quantityInBase * 0.00220462
        else return quantityInBase / invFactor // Mismatch fallback

        // Convert LBS to INV BASE
        if (invBase === 'lb') quantityInBase = lbs
        else if (invBase === 'oz') quantityInBase = lbs * 16
        else if (invBase === 'kg') quantityInBase = lbs / 2.20462
        else if (invBase === 'g') quantityInBase = lbs / 0.00220462
    }
    // 2. Volume Conversions (Base: gal/l/oz/ml)
    else if (['gal', 'l', 'ml', 'fl oz'].includes(invBase)) {
        // Convert TO GAL as standard
        let gals = 0
        if (normFrom === 'gal') gals = quantityInBase
        else if (normFrom === 'l') gals = quantityInBase * 0.264172
        else if (normFrom === 'ml') gals = quantityInBase * 0.000264172
        else if (normFrom === 'oz' || normFrom === 'fl oz') gals = quantityInBase / 128
        else return quantityInBase / invFactor // Mismatch fallback

        if (invBase === 'gal') quantityInBase = gals
        else if (invBase === 'l') quantityInBase = gals / 0.264172
        else if (invBase === 'ml') quantityInBase = gals / 0.000264172
        else if (invBase === 'oz' || invBase === 'fl oz') quantityInBase = gals * 128
    }
    // 3. Dozen / Piece Conversions
    else if (['dz', 'pza', 'ct'].includes(invBase) || ['dz', 'pza', 'ct'].includes(normFrom)) {
        let pieces = quantityInBase

        // Convert FROM to PIECES
        if (normFrom === 'dz') pieces = quantityInBase * 12
        else if (normFrom === 'pza' || normFrom === 'ct') pieces = quantityInBase
        // If unknown unit but we are targetting pieces/dz, assume direct PZA mapping? 
        // Or error. For now, assume pieces.

        // Convert PIECES to INV BASE
        if (invBase === 'dz') quantityInBase = pieces / 12
        else quantityInBase = pieces
    }
    else {
        // Direct match
        if (normFrom === invBase) {
            quantityInBase = recipeQuantity
        }
    }

    // 4. Apply the Inventory Factor (Pack Size)
    const usage = quantityInBase / invFactor

    return usage
}
