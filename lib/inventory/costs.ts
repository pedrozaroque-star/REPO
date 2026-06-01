/**
 * @module lib/inventory/costs
 *
 * MODULE:
 * Motor de cálculo de costo teórico (theoretical food cost) para recetas.
 * Toma una receta, la lista de items de inventario con sus precios actuales,
 * y opcionalmente el dining option (canal de venta) para producir un desglose
 * completo de costo: foodCost + packagingCost = totalCost.
 *
 * BUSINESS RULES:
 * - Cada ingrediente se busca en inventario por `inventory_item_id`.
 * - El costo unitario se calcula con `calculateIngredientCost()` (lógica central
 *   de conversión de unidades + yield).
 * - Clasificación de costos por `ingredient.type`:
 *     • 'food' | 'raw' | 'cooked' → foodCost (costo de materia prima / alimento)
 *     • 'cogs_dine_in'            → packagingCost SOLO para pedidos "For Here" / "Dine In"
 *     • 'cogs_delivery'           → packagingCost SOLO para Uber Eats, DoorDash, etc.
 *     • 'cogs_takeout'            → packagingCost SOLO para To Go (ni dine-in ni delivery)
 * - Si `diningOption` no se pasa, se incluyen TODOS los tipos de packaging.
 * - Items sin precio (`purchase_unit_cost <= 0`) se marcan como `isMissingPrice`.
 *
 * CRITICAL BUG FIX (2026-06-01):
 * Los tipos 'raw' y 'cooked' estaban siendo clasificados erróneamente como
 * packaging en vez de food. Esto causaba que productos como Party Trays
 * reportaran $0.00 de foodCost (toda la carne iba a packagingCost).
 * Fix: `isFood = (type === 'food' || type === 'raw' || type === 'cooked')`.
 *
 * DATA FLOW:
 * Recipe.ingredients[] → inventoryItems Map lookup → calculateRawUsage() (para UI)
 *                      → calculateIngredientCost() (para costo real)
 *                      → classify food vs packaging → aggregate → RecipeCostResult
 *
 * Dependencias:
 * - `./conversions` → `calculateRawUsage`, `normalizeToLbs` (yield adjustment)
 * - `./recipe-calculations` → `calculateIngredientCost` (unit conversion + pricing)
 * - `@/types/inventory` → `InventoryItem`, `Recipe`, `RecipeIngredient`
 *
 * NOTES:
 * - `calculateRawUsage()` se llama SOLO para mostrar la cantidad cruda en el
 *   breakdown de la UI. El costo real lo calcula `calculateIngredientCost()`.
 * - Los valores de retorno se redondean a 4 decimales para evitar errores
 *   de punto flotante en acumulaciones grandes.
 * - El filtro de dining option usa substring matching (case-insensitive):
 *   'here'/'dine' → dine-in, 'uber'/'door'/'grub'/'delivery' → delivery,
 *   cualquier otro → takeout.
 */
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

        // 'food', 'raw', 'cooked' are all food ingredients
        // Only 'cogs_*' types (cogs_dine_in, cogs_delivery, cogs_takeout) are packaging/supplies
        const isFood = (type === 'food' || type === 'raw' || type === 'cooked')
        if (isFood) {
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
