import { InventoryItem, Recipe, RecipeIngredient } from '@/types/inventory'
import { calculateRawUsage, normalizeToLbs } from './conversions'

export interface CostBreakdown {
    itemName: string
    quantity: number
    unit: string
    yieldPercent: number
    cost: number
    isMissingPrice: boolean
}

export interface RecipeCostResult {
    totalCost: number
    breakdown: CostBreakdown[]
    missingPrices: number // Count of items with 0 or missing price
}

/**
 * Calculates the theoretical cost of a recipe based on its ingredients and their current inventory prices.
 */
export function calculateRecipeCost(recipe: Recipe, inventoryItems: InventoryItem[]): RecipeCostResult {
    let totalCost = 0
    let missingPrices = 0
    const breakdown: CostBreakdown[] = []

    // Map for fast lookup
    const itemMap = new Map(inventoryItems.map(i => [i.id, i]))

    recipe.ingredients.forEach(ing => {
        const item = itemMap.get(ing.inventory_item_id)
        if (!item) return // Should not happen if DB is consistent

        // 1. Calculate Raw Usage (Apply Yield)
        // If yield is 0 or missing, default to 100% to avoid division by zero
        const yieldPct = item.yield_percent ? Number(item.yield_percent) : 100

        const rawUsage = calculateRawUsage(
            ing.quantity,
            ing.unit,
            yieldPct,
            ing.type // 'raw' or 'cooked'
        )

        // 2. Normalize to Cost Unit
        // For this phase, we assume Purchase Cost is per comparable unit OR we convert both to Lbs if they are weight
        // If the item unit is 'box' and we used 'lbs', we perform a naive check or assume the cost is per Unit Type.

        // Strategy:
        // If Item Unit is Weight (lb, oz, kg, g) AND Recipe Unit is Weight -> Normalize both to LB
        // Else -> Assume direct proportion (dangerous but MVP) or 1:1 if unit matches.

        let cost = 0
        let isMissingPrice = false
        const unitCost = Number(item.purchase_unit_cost || 0)

        if (unitCost <= 0) {
            isMissingPrice = true
            missingPrices++
        } else {
            // TRY WEIGHT CONVERSION FIRST
            try {
                const usageInLbs = normalizeToLbs(rawUsage.quantity, rawUsage.unit)
                const itemUnitInLbs = normalizeToLbs(1, item.unit_type)

                // If both are valid weights (didn't return original quantity implying no conversion)
                // Actually normalizeToLbs returns same quantity if unknown. 
                // We need to check if units are weights.
                const isUsageWeight = ['lb', 'oz', 'kg', 'g'].includes(rawUsage.unit)
                const isItemWeight = ['lb', 'oz', 'kg', 'g'].includes(item.unit_type)

                if (isUsageWeight && isItemWeight) {
                    // Cost per LB = Unit Cost / Item Unit in Lbs
                    // e.g. $40 per Case(40lb) -> we don't know Case weight here yet without conversion factor.
                    // BUT if Item Unit is 'lb' and cost is $4, then Cost per lb is $4.

                    const costPerLb = unitCost / itemUnitInLbs
                    cost = usageInLbs * costPerLb

                } else if (rawUsage.unit === item.unit_type) {
                    // Direct match (e.g. pza -> pza)
                    cost = rawUsage.quantity * unitCost
                } else {
                    // Mismatched units without weight conversion (e.g. pza vs box)
                    // Fallback: This requires a "conversion factor" field in InventoryItem (e.g. 1 Box = 50 Pza).
                    // For now, we flag as 0 cost or log error?
                    // Let's assume 0 and flag as missing price/config logic
                    console.warn(`Unit mismatch for item ${item.name}: ${item.unit_type} vs ${rawUsage.unit}`)
                    isMissingPrice = true // Soft error
                }

            } catch (e) {
                console.error("Error calculating cost", e)
                isMissingPrice = true
            }
        }

        breakdown.push({
            itemName: item.name,
            quantity: rawUsage.quantity,
            unit: rawUsage.unit,
            yieldPercent: yieldPct,
            cost: Number(cost.toFixed(4)),
            isMissingPrice
        })

        totalCost += cost
    })

    return {
        totalCost: Number(totalCost.toFixed(4)),
        breakdown,
        missingPrices
    }
}
