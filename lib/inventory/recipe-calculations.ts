export interface InventoryCostData {
    purchase_unit_cost?: number | null | undefined
    quantity_per_unit?: number | null | undefined
    unit_measure?: string | null | undefined
    unit_type?: string | null | undefined
    yield_percent?: number | null | undefined
}

export function getConversionFactor(rUnit: string, iUnit: string): number {
    rUnit = rUnit?.toLowerCase()?.trim() || ''
    iUnit = iUnit?.toLowerCase()?.trim() || ''
    if (rUnit === iUnit) return 1

    // Weight
    if (rUnit === 'oz' && iUnit === 'lb') return 1 / 16
    if (rUnit === 'lb' && iUnit === 'oz') return 16
    if (rUnit === 'g' && iUnit === 'kg') return 1 / 1000
    if (rUnit === 'kg' && iUnit === 'g') return 1000
    // Volume
    if (rUnit === 'ml' && iUnit === 'l') return 1 / 1000
    if (rUnit === 'l' && iUnit === 'ml') return 1000
    if ((rUnit === 'gal' || rUnit === 'gallon') && (iUnit === 'oz' || iUnit === 'fl oz')) return 128
    if ((rUnit === 'oz' || rUnit === 'fl oz') && (iUnit === 'gal' || iUnit === 'gallon')) return 1 / 128

    // Count
    if (rUnit === 'dz' && (iUnit === 'pza' || iUnit === 'unit')) return 12

    return 1
}

export function calculateIngredientCost(recipeQuantity: number, recipeUnit: string, inv: InventoryCostData, recipeType: string = 'cooked'): number {
    const rawCount = Number(recipeQuantity) || 0
    if (rawCount === 0) return 0

    const purchaseUnit = inv.unit_type?.toLowerCase() || ''
    let iUnit = inv.unit_measure?.toLowerCase()?.trim() || ''
    const rUnit = recipeUnit?.toLowerCase()?.trim() || ''

    // Smart Fallback: If inventory unit is 'pza' or 'unit', try to detect real unit from the description string (unit_type)
    if (iUnit === 'pza' || iUnit === 'unit') {
        if (purchaseUnit.includes('gallon') || purchaseUnit.includes('gal')) iUnit = 'gal'
        else if (purchaseUnit.includes('lb')) iUnit = 'lb'
        else if (purchaseUnit.includes('oz')) iUnit = 'oz'
        else if (purchaseUnit.includes('kg')) iUnit = 'kg'
        else if (purchaseUnit.includes('l') && !purchaseUnit.includes('gal')) iUnit = 'l'
        else if (purchaseUnit.includes('ml')) iUnit = 'ml'
    }

    const costPerUnit = (inv.purchase_unit_cost || 0) / (inv.quantity_per_unit || 1)
    
    // Support recipeType matching the original logic: if raw, yield is assumed already factored or 100%
    const yieldPct = (recipeType === 'raw') ? 100 : (inv.yield_percent || 100)
    const yieldFactor = yieldPct / 100

    let conversion = getConversionFactor(rUnit, iUnit)

    // SPECIAL CASE: If calling for 'pza'/'unit' on a Weight/Volume item, 
    // assume '1 pza' = '1 Whole Purchase Unit' (e.g. 1 bag of 3.9oz)
    if ((rUnit === 'pza' || rUnit === 'unit') && iUnit !== 'pza' && iUnit !== 'unit') {
        conversion = inv.quantity_per_unit || 1
    }

    // Example calculation:
    // Case 1: Refried Beans: Cost=$10, q_p_u=5, u_m=lb, u_t="Bag 5 lbs", recipe wants 1 "pza"
    // costPerUnit = 10 / 5 = $2/lb
    // iUnit = lb. rUnit = pza.
    // conversion = 5
    // cost = (2 * 1 * 5) / 1 = $10. (Correct, 1 whole bag costs $10)
    
    // Case 2: Mayo: Cost=$20, q_p_u=1, u_m=gal, u_t="1 Gallon", recipe wants 1 "fl oz"
    // costPerUnit = 20 / 1 = $20/gal
    // iUnit = gal. rUnit = fl oz.
    // conversion = 1/128
    // cost = (20 * 1 * 1/128) / 1 = $0.15. (Correct)

    const cost = (costPerUnit * rawCount * conversion) / yieldFactor
    return cost
}
