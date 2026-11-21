/**
 * @module lib/inventory/recipe-calculations
 * @description Motor central de conversión de unidades y cálculo de costo teórico por ingrediente
 *   para recetas del menú de Toast POS y reportes de Food Cost.
 *
 * @businessRules
 *   - Costo base por unidad de medida = `purchase_unit_cost / quantity_per_unit`.
 *   - Si `recipeType === 'raw'`, el rendimiento (`yield_percent`) es 100%; si es `'cooked'` o `'food'`,
 *     se divide entre `yield_percent / 100`.
 *   - Si `unit_measure` es `'pza'` o `'unit'`, solo se infiere una unidad de peso/volumen desde `unit_type`
 *     cuando existe un token explícito de medida (`ml`, `gal`, `lb`, `fl oz`, `oz`, `kg`, `l`/`lt`/`ltr`/`litro`/`liter`),
 *     jamás por coincidencia parcial de la letra `'l'` en empaques como `'Bolsa'`, `'Roll'` o `'Pail'`.
 *   - Cuando la receta pide `'pza'`/`'unit'` y el insumo está expresado en peso o volumen real, `1 pza`
 *     equivale a la unidad completa de compra (`quantity_per_unit`).
 *
 * @dataFlow
 *   `RecipeIngredient` + `InventoryCostData` -> `calculateIngredientCost()` -> USD por porción.
 *
 * @notes
 *   - [2026-11-20] FIX CRÍTICO: Reemplazado `purchaseUnit.includes('l')` por coincidencia estricta de límites
 *     de palabra/unidad y evaluación prioritaria de `'ml'`/`'gal'`/`'lb'`/`'bolsa'`, eliminando la inflación
 *     `500x` cuando `unit_type` contenía `'Bolsa'` (o `'Pail'`/`'Roll'`) con `quantity_per_unit = 500`.
 */

export interface InventoryCostData {
    purchase_unit_cost?: number | null | undefined
    quantity_per_unit?: number | null | undefined
    unit_measure?: string | null | undefined
    unit_type?: string | null | undefined
    yield_percent?: number | null | undefined
}

const WEIGHT_OR_VOLUME_UNITS = new Set(['lb', 'oz', 'fl oz', 'kg', 'g', 'gal', 'l', 'ml'])

function stripMeasureDiacritics(val?: string | null): string {
    return String(val || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
}

function normalizeMeasureUnit(raw?: string | null): string {
    const rawClean = stripMeasureDiacritics(raw)
    if (!rawClean) return ''
    // Soporta prefijos unitarios como "1 dz", "1 Gallon", "1 Litro" usados en recetas reales
    const u = rawClean.replace(/^1(?:\.0+)?\s+/, '').trim()
    if (!u) return ''

    if (/^(?:fl\.?\s*oz|floz|fluid\s*oz|fluid\s*ounces?)$/i.test(u)) return 'fl oz'
    if (/^(?:ml|mls|milliliters?|mililitros?)$/i.test(u)) return 'ml'
    if (/^(?:gal|gals|gallons?|galon(?:es)?)$/i.test(u)) return 'gal'
    if (/^(?:lb|lbs|pounds?|libras?)$/i.test(u)) return 'lb'
    if (/^(?:oz|ounces?|onzas?)$/i.test(u)) return 'oz'
    if (/^(?:kg|kgs|kilograms?|kilos?)$/i.test(u)) return 'kg'
    if (/^(?:g|gr|grams?|gramos?)$/i.test(u)) return 'g'
    if (/^(?:l|lt|lts|ltr|ltrs|liters?|litres?|litros?)$/i.test(u)) return 'l'
    if (/^(?:dz|doz|dozens?|docenas?)$/i.test(u)) return 'dz'
    if (/^(?:unit|units|unidad(?:es)?)$/i.test(u)) return 'unit'
    if (/^(?:pza|pzas|piezas?|pcs?|pieces?|ea|each|ct|count|bolsas?|bags?|cajas?|cases?|cs|box(?:es)?|packs?|pkgs?|paquetes?|rolls?|rollos?|pails?)$/i.test(u)) {
        return 'pza'
    }

    return u
}

function detectMeasureFromUnitType(unitTypeRaw?: string | null): string | null {
    const purchaseUnit = stripMeasureDiacritics(unitTypeRaw)
    if (!purchaseUnit) return null

    // Contenedores/unidades de conteo puros jamás deben reclasificarse como volumen o peso
    if (/^(?:bolsas?|bags?|cajas?|cases?|cs|\d+cs|box(?:es)?|packs?|pkgs?|paquetes?|rolls?|rollos?|pails?|units?|per\s+unit|ea|each|pzas?|piezas?|\d+\s*(?:ct|count|pzas?|piezas?|pcs|pieces|rolls?|rollos?|bags?|bolsas?|sheets|dz))$/i.test(purchaseUnit)) {
        return null
    }
    if (/\b(?:bolsas?|ct|count|pzas?|piezas?|pcs|pieces)\b/i.test(purchaseUnit)) {
        return null
    }

    // Evaluar unidades compuestas y específicas ANTES de 'l' (litros)
    if (/(?:^|[\s\d/(-])fl\.?\s*oz(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'fl oz'
    if (/(?:^|[\s\d/(-])(?:ml|mls|milliliters?|mililitros?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'ml'
    if (/(?:^|[\s\d/(-])(?:gal|gals|gallons?|galon(?:es)?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'gal'
    if (/(?:^|[\s\d/(-])(?:lb|lbs|pounds?|libras?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'lb'
    if (/(?:^|[\s\d/(-])(?:oz|ounces?|onzas?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'oz'
    if (/(?:^|[\s\d/(-])(?:kg|kgs|kilograms?|kilos?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'kg'
    if (
        /^(?:l|lt|lts|ltr|ltrs|liters?|litres?|litros?)$/i.test(purchaseUnit) ||
        /(?:^|[\s/(-])\d+(?:\.\d+)?\s*(?:l|lt|lts|ltr|ltrs|liters?|litres?|litros?)(?:$|[\s/.,)-])/i.test(purchaseUnit) ||
        /\b(?:lt|lts|ltr|ltrs|liters?|litres?|litros?)\b/i.test(purchaseUnit)
    ) {
        return 'l'
    }

    return null
}

export function getConversionFactor(rUnit: string, iUnit: string): number {
    const r = normalizeMeasureUnit(rUnit)
    const i = normalizeMeasureUnit(iUnit)
    if (r === i) return 1

    // Weight
    if (r === 'oz' && i === 'lb') return 1 / 16
    if (r === 'lb' && i === 'oz') return 16
    if (r === 'g' && i === 'kg') return 1 / 1000
    if (r === 'kg' && i === 'g') return 1000
    if (r === 'kg' && i === 'lb') return 2.20462
    if (r === 'lb' && i === 'kg') return 1 / 2.20462
    if (r === 'g' && i === 'oz') return 1 / 28.3495
    if (r === 'oz' && i === 'g') return 28.3495

    // Volume
    if (r === 'ml' && i === 'l') return 1 / 1000
    if (r === 'l' && i === 'ml') return 1000
    if ((r === 'oz' || r === 'fl oz') && i === 'l') return 1 / 33.814
    if (r === 'l' && (i === 'oz' || i === 'fl oz')) return 33.814
    if (r === 'ml' && (i === 'oz' || i === 'fl oz')) return 1 / 29.5735
    if ((r === 'oz' || r === 'fl oz') && i === 'ml') return 29.5735
    if (r === 'gal' && (i === 'oz' || i === 'fl oz')) return 128
    if ((r === 'oz' || r === 'fl oz') && i === 'gal') return 1 / 128
    if (r === 'gal' && i === 'l') return 3.78541
    if (r === 'l' && i === 'gal') return 1 / 3.78541
    if (r === 'gal' && i === 'ml') return 3785.41
    if (r === 'ml' && i === 'gal') return 1 / 3785.41

    // Count
    if (r === 'dz' && (i === 'pza' || i === 'unit')) return 12
    if ((r === 'pza' || r === 'unit') && i === 'dz') return 1 / 12

    return 1
}

export function calculateIngredientCost(recipeQuantity: number, recipeUnit: string, inv: InventoryCostData, recipeType: string = 'cooked'): number {
    const rawCount = Number(recipeQuantity) || 0
    if (rawCount === 0) return 0

    let iUnit = normalizeMeasureUnit(inv.unit_measure)
    const rUnit = normalizeMeasureUnit(recipeUnit)

    // Smart Fallback: If inventory unit is 'pza' or 'unit', try to detect real weight/volume unit from unit_type
    if (iUnit === 'pza' || iUnit === 'unit' || !iUnit) {
        const detected = detectMeasureFromUnitType(inv.unit_type)
        if (detected) {
            iUnit = detected
        } else if (!iUnit) {
            iUnit = 'pza'
        }
    }

    const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1)
    
    // Support recipeType matching the original logic: if raw, yield is assumed already factored or 100%
    const yieldPct = (recipeType === 'raw') ? 100 : (inv.yield_percent || 100)
    const yieldFactor = yieldPct / 100

    let conversion = getConversionFactor(rUnit, iUnit)

    // SPECIAL CASE: If calling for 'pza'/'unit' on a genuine Weight/Volume item, 
    // assume '1 pza' = '1 Whole Purchase Unit' (e.g. 1 bag of 3.9oz)
    if ((rUnit === 'pza' || rUnit === 'unit') && WEIGHT_OR_VOLUME_UNITS.has(iUnit)) {
        conversion = inv.quantity_per_unit || 1
    }

    const cost = (costPerUnit * rawCount * conversion) / yieldFactor
    return cost
}
