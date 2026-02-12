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
        'liter': 'l',
        'litre': 'l',
        'milliliter': 'ml',
        'pound': 'lb',
        'ounce': 'oz',
        'gram': 'g',
        'kilogram': 'kg',
        'piece': 'pza',
        'each': 'pza',
        'count': 'ct',
        'unit': 'pza'
    }
    return ALIASES[s] || s
}

// Helper to parse "10 lb", "25 pza", "1 gal", "4.5 oz" strings
function parseUnitString(unitString: string): { factor: number, baseUnit: string } {
    if (!unitString) return { factor: 1, baseUnit: 'pza' }

    // Normalize
    const u = unitString.toLowerCase().trim()

    // Match "Number Unit" pattern (e.g. "10 lb", "2.5 oz", "25 pza")
    const match = u.match(/^([\d.]+)\s*([a-z]+)$/)

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
    const { baseUnit: safeFrom, factor: recipeFactor } = parseUnitString(fromUnitRaw) // Usually factor 1 for recipes, but handle "2 oz" string if passed
    // Actually recipeUnit is usually just the unit string "oz". 
    // If recipe pass "2 oz" as unit, we treat it as unit "oz".
    // Let's stick to simple normalization for fromUnit if it's just a word.
    const normFrom = normalizeUnit(fromUnitRaw)

    const invUnitString = inventoryItemUnit || 'pza'

    // 1. Parse Inventory Unit Configuration (e.g. "10 lb", "25 pza")
    // This gives us the PACK SIZE.
    const { factor: invFactor, baseUnit: invBase } = parseUnitString(invUnitString)

    let quantityInBase = recipeQuantity

    // Weight Conversions (Base: lb/oz/kg)
    if (['lb', 'oz', 'kg', 'g'].includes(invBase)) {
        // Convert TO LBS as standard middle ground
        let lbs = 0
        if (normFrom === 'lb') lbs = recipeQuantity
        else if (normFrom === 'oz') lbs = recipeQuantity / 16
        else if (normFrom === 'kg') lbs = recipeQuantity * 2.20462
        else if (normFrom === 'g') lbs = recipeQuantity * 0.00220462
        else return recipeQuantity / invFactor // Mismatch

        // Convert LBS to INV BASE
        if (invBase === 'lb') quantityInBase = lbs
        else if (invBase === 'oz') quantityInBase = lbs * 16
        else if (invBase === 'kg') quantityInBase = lbs / 2.20462
        else if (invBase === 'g') quantityInBase = lbs / 0.00220462
    }
    // Volume Conversions (Base: gal/l/oz/ml)
    else if (['gal', 'l', 'ml', 'fl oz'].includes(invBase)) {
        // Convert TO GAL as standard
        let gals = 0
        if (normFrom === 'gal') gals = recipeQuantity
        else if (normFrom === 'l') gals = recipeQuantity * 0.264172
        else if (normFrom === 'ml') gals = recipeQuantity * 0.000264172
        else if (normFrom === 'oz' || normFrom === 'fl oz') gals = recipeQuantity / 128
        else return recipeQuantity / invFactor

        if (invBase === 'gal') quantityInBase = gals
        else if (invBase === 'l') quantityInBase = gals / 0.264172
        else if (invBase === 'ml') quantityInBase = gals / 0.000264172
        else if (invBase === 'oz' || invBase === 'fl oz') quantityInBase = gals * 128
    }
    // Piece / Count Matches
    else {
        // Direct match
        if (normFrom === invBase) {
            quantityInBase = recipeQuantity
        }
        // Fallback or mismatch -> simple ratio
    }

    // 3. Apply the Inventory Factor (Pack Size)
    const usage = quantityInBase / invFactor

    return usage
}
