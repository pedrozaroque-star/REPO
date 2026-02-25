import { InventoryItem, Recipe, RecipeIngredient } from '@/types/inventory'
import { calculateRawUsage, normalizeToLbs, calculateInventoryUsage } from './conversions'

export interface CostBreakdown {
    inventoryItemId: string
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemMap = new Map<string, InventoryItem>(inventoryItems.map((i: any) => [i.id, i]))

    recipe.ingredients.forEach(ing => {
        const item = itemMap.get(ing.inventory_item_id)
        if (!item) return

        // 1. Calculate Raw Usage (Apply Yield)
        // If yield is 0 or missing, default to 100% to avoid division by zero
        const yieldPct = item.yield_percent ? Number(item.yield_percent) : 100

        // This returns the amount of RAW product needed in the RECIPE'S unit
        // e.g. Recipe needs 1.5 oz Cooked -> Returns 2.46 oz Raw
        const rawUsage = calculateRawUsage(
            ing.quantity,
            ing.unit,
            yieldPct,
            ing.type // 'raw' or 'cooked'
        )

        let cost = 0
        let isMissingPrice = false
        const unitCost = Number(item.purchase_unit_cost || 0)

        if (unitCost <= 0) {
            isMissingPrice = true
            missingPrices++
        } else {
            // 2. Calculate Inventory Usage Fraction
            // How much of the "Purchase Unit" (e.g. "10 lb bag") is used?
            // e.g. Need 0.5 lb Raw. Inventory Item is "10 lb". Usage is 0.05.

            try {
                const inventoryUsage = calculateInventoryUsage(
                    rawUsage.quantity, // Amount needed (Raw)
                    rawUsage.unit,     // Unit of amount needed
                    item.unit_type,    // "10 lb", "25 pza", etc.
                    item.quantity_per_unit
                )

                // Cost = Usage * Cost of Inventory Item
                cost = inventoryUsage * unitCost

            } catch (e: unknown) {
                console.error("Error calculating usage fraction", e)
                // Fallback or explicit failure
                // For now, if conversion fails (e.g. incompatible units), cost is 0
                isMissingPrice = true
            }
        }

        breakdown.push({
            inventoryItemId: item.id,
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
