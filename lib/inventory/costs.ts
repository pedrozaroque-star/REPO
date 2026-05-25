import { InventoryItem, Recipe, RecipeIngredient } from '@/types/inventory'
import { calculateRawUsage, normalizeToLbs } from './conversions'
import { calculateIngredientCost } from './recipe-calculations'

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
    foodCost: number
    packagingCost: number
    breakdown: CostBreakdown[]
    missingPrices: number // Count of items with 0 or missing price
}

/**
 * Calculates the theoretical cost of a recipe based on its ingredients and their current inventory prices.
 * Optionally filters packaging based on the dining option (e.g. 'for here', 'to go', 'uber eats').
 */
export function calculateRecipeCost(recipe: Recipe, inventoryItems: InventoryItem[], diningOption?: string): RecipeCostResult {
    let totalCost = 0
    let foodCost = 0
    let packagingCost = 0
    let missingPrices = 0
    const breakdown: CostBreakdown[] = []

    // Map for fast lookup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemMap = new Map<string, InventoryItem>(inventoryItems.map((i: any) => [i.id, i]))

    recipe.ingredients.forEach(ing => {
        const item = itemMap.get(ing.inventory_item_id)
        if (!item) return
        
        // --- Filter Packaging by Dining Option ---
        const type = ing.type || 'food'
        if (type !== 'food' && diningOption !== undefined) {
            const doLower = diningOption.toLowerCase()
            
            const isDineIn = doLower.includes('here') || doLower.includes('dine')
            const isDelivery = doLower.includes('uber') || doLower.includes('door') || doLower.includes('grub') || doLower.includes('delivery')
            const isTakeout = !isDineIn && !isDelivery // Default to takeout if not dine-in or delivery
            
            if (type === 'cogs_dine_in' && !isDineIn) return
            if (type === 'cogs_delivery' && !isDelivery) return
            if (type === 'cogs_takeout' && !isTakeout) return
        }

        // 1. Calculate Raw Usage (Apply Yield)
        // If yield is 0 or missing, default to 100% to avoid division by zero
        const yieldPct = item.yield_percent ? Number(item.yield_percent) : 100

        // This returns the amount of RAW product needed in the RECIPE'S unit
        // e.g. Recipe needs 1.5 oz Cooked -> Returns 2.46 oz Raw
        // We STILL call calculateRawUsage ONLY to show in the breakdown UI what the raw "quantity requirement" is.
        // But for COST, we use the central calculator directly.
        const rawUsage = calculateRawUsage(
            ing.quantity,
            ing.unit,
            yieldPct,
            ing.type // 'raw' or 'cooked'
        )

        let isMissingPrice = false
        const unitCost = Number(item.purchase_unit_cost || 0)

        // Calculate Cost Using Central Logic
        const cost = calculateIngredientCost(ing.quantity, ing.unit, item, ing.type)

        if (unitCost <= 0 || cost === 0 && ing.quantity > 0) {
             // If calculation fails entirely due to missing data or unit cost is missing
             if (unitCost <= 0) { // Only increment missing price if the unit cost is genuinely 0
                isMissingPrice = true
                missingPrices++
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

        if (type === 'food') {
            foodCost += cost
        } else {
            packagingCost += cost
        }
        totalCost += cost
    })

    return {
        totalCost: Number(totalCost.toFixed(4)),
        foodCost: Number(foodCost.toFixed(4)),
        packagingCost: Number(packagingCost.toFixed(4)),
        breakdown,
        missingPrices
    }
}
