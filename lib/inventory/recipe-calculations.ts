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
 *     cuando existe un token explícito de medida (`ml`, `gal`, `qt`, `lb`, `fl oz`, `oz`, `kg`, `g`/`gr`/`gram`/`gramos`,
 *     `l`/`lt`/`ltr`/`litro`/`liter`), jamás por coincidencia parcial en palabras como `'Bolsa'`, `'Bag'`, `'Grande'`, `'Roll'` o `'Pail'`.
 *   - Matriz completa y transitivamente exacta de peso (`lb`, `oz`, `kg`, `g`) y volumen (`gal`, `qt`, `l`, `ml`, `fl oz`),
 *     evitando cualquier caída silenciosa a `1` entre pares válidos.
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
 *   - [2026-11-23] Agregadas conversiones faltantes `g <-> lb` (`453.59237`), `kg <-> oz` (`35.27396195`),
 *     `fl oz <-> lb`, `qt` y detección segura de gramos (`g`, `gr`, `gram`, `gramos`) con fronteras estrictas
 *     para que `'bag'`, `'grande'`, `'seal2go'` o `'el1cs2g'` jamás generen falsos positivos.
 */

export interface InventoryCostData {
    purchase_unit_cost?: number | null | undefined
    quantity_per_unit?: number | null | undefined
    unit_measure?: string | null | undefined
    unit_type?: string | null | undefined
    yield_percent?: number | null | undefined
}

const WEIGHT_OR_VOLUME_UNITS = new Set(['lb', 'oz', 'fl oz', 'kg', 'g', 'gal', 'qt', 'l', 'ml'])

const GRAMS_PER_LB = 453.59237
const GRAMS_PER_OZ = GRAMS_PER_LB / 16 // 28.349523125
const OZ_PER_KG = 1000 / GRAMS_PER_OZ   // 35.27396194958041 (~35.27396195)
const LBS_PER_KG = 1000 / GRAMS_PER_LB  // 2.2046226218487757

const ML_PER_GAL = 3785.411784
const L_PER_GAL = ML_PER_GAL / 1000     // 3.785411784
const ML_PER_FL_OZ = ML_PER_GAL / 128   // 29.5735295625
const FL_OZ_PER_L = 1000 / ML_PER_FL_OZ // 33.814022701843
const ML_PER_QT = ML_PER_GAL / 4        // 946.352946

function stripMeasureDiacritics(val?: string | null): string {
    return String(val || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
}

export function normalizeMeasureUnit(raw?: string | null): string {
    const rawClean = stripMeasureDiacritics(raw)
    if (!rawClean) return ''
    // Soporta prefijos unitarios como "1 dz", "1 Gallon", "1 Litro" usados en recetas reales
    const u = rawClean.replace(/^1(?:\.0+)?\s+/, '').trim()
    if (!u) return ''

    if (/^(?:fl\.?\s*oz|floz|fluid\s*oz|fluid\s*ounces?)$/i.test(u)) return 'fl oz'
    if (/^(?:ml|mls|milliliters?|mililitros?)$/i.test(u)) return 'ml'
    if (/^(?:gal|gals|gallons?|galon(?:es)?)$/i.test(u)) return 'gal'
    if (/^(?:qt|qts|quarts?)$/i.test(u)) return 'qt'
    if (/^(?:lb|lbs|pounds?|libras?)$/i.test(u)) return 'lb'
    if (/^(?:oz|ounces?|onzas?)$/i.test(u)) return 'oz'
    if (/^(?:kg|kgs|kilograms?|kilos?)$/i.test(u)) return 'kg'
    if (/^(?:g|gr|grs|gm|gms|grams?|gramos?)$/i.test(u)) return 'g'
    if (/^(?:l|lt|lts|ltr|ltrs|liters?|litres?|litros?)$/i.test(u)) return 'l'
    if (/^(?:dz|doz|dozens?|docenas?)$/i.test(u)) return 'dz'
    if (/^(?:unit|units|unidad(?:es)?)$/i.test(u)) return 'unit'
    if (/^(?:pza|pzas|piezas?|pcs?|pieces?|ea|each|ct|count|bolsas?|bags?|cajas?|cases?|cs|box(?:es)?|packs?|pkgs?|paquetes?|rolls?|rollos?|pails?)$/i.test(u)) {
        return 'pza'
    }

    return u
}

export function detectMeasureFromUnitType(unitTypeRaw?: string | null): string | null {
    const purchaseUnit = stripMeasureDiacritics(unitTypeRaw)
    if (!purchaseUnit) return null

    // Contenedores/unidades de conteo puros jamás deben reclasificarse como volumen o peso
    if (/^(?:bolsas?|bags?|cajas?|cases?|cs|\d+cs|box(?:es)?|packs?|pkgs?|paquetes?|rolls?|rollos?|pails?|units?|per\s+unit|ea|each|pzas?|piezas?|\d+\s*(?:ct|count|pzas?|piezas?|pcs|pieces|rolls?|rollos?|bags?|bolsas?|sheets|dz))$/i.test(purchaseUnit)) {
        return null
    }
    if (/\b(?:bolsas?|ct|count|pzas?|piezas?|pcs|pieces)\b/i.test(purchaseUnit)) {
        return null
    }

    // Evaluar unidades compuestas y específicas ANTES de 'g' (gramos) y 'l' (litros)
    if (/(?:^|[\s\d/(-])fl\.?\s*oz(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'fl oz'
    if (/(?:^|[\s\d/(-])(?:ml|mls|milliliters?|mililitros?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'ml'
    if (/(?:^|[\s\d/(-])(?:gal|gals|gallons?|galon(?:es)?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'gal'
    if (/(?:^|[\s\d/(-])(?:qt|qts|quarts?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'qt'
    if (/(?:^|[\s\d/(-])(?:lb|lbs|pounds?|libras?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'lb'
    if (/(?:^|[\s\d/(-])(?:oz|ounces?|onzas?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'oz'
    if (/(?:^|[\s\d/(-])(?:kg|kgs|kilograms?|kilos?)(?:$|[\s/.,)-])/i.test(purchaseUnit)) return 'kg'
    if (
        /^(?:g|gr|grs|gm|gms|grams?|gramos?)$/i.test(purchaseUnit) ||
        /(?:^|[\s/(-])\d+(?:\.\d+)?\s*(?:g|gr|grs|gm|gms|grams?|gramos?)(?:$|[\s/.,)-])/i.test(purchaseUnit) ||
        /(?:^|[\s/(-])(?:gr|grs|gm|gms|grams?|gramos?)(?:$|[\s/.,)-])/i.test(purchaseUnit) ||
        /(?:^|[\s/(-])g(?:$|[\s/.,)-])/i.test(purchaseUnit)
    ) {
        return 'g'
    }
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
    if ((r === 'fl oz' && i === 'oz') || (r === 'oz' && i === 'fl oz')) return 1
    if ((r === 'pza' && i === 'unit') || (r === 'unit' && i === 'pza')) return 1

    // Weight (lb, oz, kg, g — 100% transitive & reciprocal)
    if ((r === 'oz' || r === 'fl oz') && i === 'lb') return 1 / 16
    if (r === 'lb' && (i === 'oz' || i === 'fl oz')) return 16
    if (r === 'g' && i === 'kg') return 1 / 1000
    if (r === 'kg' && i === 'g') return 1000
    if (r === 'g' && i === 'lb') return 1 / GRAMS_PER_LB
    if (r === 'lb' && i === 'g') return GRAMS_PER_LB
    if (r === 'kg' && i === 'lb') return LBS_PER_KG
    if (r === 'lb' && i === 'kg') return 1 / LBS_PER_KG
    if (r === 'g' && i === 'oz') return 1 / GRAMS_PER_OZ
    if (r === 'oz' && i === 'g') return GRAMS_PER_OZ
    if (r === 'kg' && i === 'oz') return OZ_PER_KG
    if (r === 'oz' && i === 'kg') return 1 / OZ_PER_KG

    // Volume (gal, qt, l, ml, fl oz — 100% transitive & reciprocal)
    if (r === 'ml' && i === 'l') return 1 / 1000
    if (r === 'l' && i === 'ml') return 1000
    if ((r === 'oz' || r === 'fl oz') && i === 'l') return 1 / FL_OZ_PER_L
    if (r === 'l' && (i === 'oz' || i === 'fl oz')) return FL_OZ_PER_L
    if (r === 'ml' && (i === 'oz' || i === 'fl oz')) return 1 / ML_PER_FL_OZ
    if ((r === 'oz' || r === 'fl oz') && i === 'ml') return ML_PER_FL_OZ
    if (r === 'gal' && (i === 'oz' || i === 'fl oz')) return 128
    if ((r === 'oz' || r === 'fl oz') && i === 'gal') return 1 / 128
    if (r === 'gal' && i === 'l') return L_PER_GAL
    if (r === 'l' && i === 'gal') return 1 / L_PER_GAL
    if (r === 'gal' && i === 'ml') return ML_PER_GAL
    if (r === 'ml' && i === 'gal') return 1 / ML_PER_GAL
    if (r === 'gal' && i === 'qt') return 4
    if (r === 'qt' && i === 'gal') return 1 / 4
    if (r === 'qt' && (i === 'oz' || i === 'fl oz')) return 32
    if ((r === 'oz' || r === 'fl oz') && i === 'qt') return 1 / 32
    if (r === 'qt' && i === 'ml') return ML_PER_QT
    if (r === 'ml' && i === 'qt') return 1 / ML_PER_QT
    if (r === 'qt' && i === 'l') return ML_PER_QT / 1000
    if (r === 'l' && i === 'qt') return 1000 / ML_PER_QT

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
