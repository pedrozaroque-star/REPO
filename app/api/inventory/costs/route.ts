import { supabaseAdmin } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { InventoryItem, Recipe, ToastMenuItemCache } from '@/types/inventory'

export async function GET() {
    // Use Admin client to bypass RLS for internal reporting
    const supabase = supabaseAdmin

    try {
        // 1. Fetch Menu Items (Active only? Maybe all for audit)
        const { data: menuItems, error: menuError } = await supabase
            .from('toast_menu_items')
            .select('*')
            // .eq('active', true) // Optional: Filter active
            .order('name')

        if (menuError) throw menuError

        // 2. Fetch ALL Recipe Rows (These ARE the ingredients)
        // Note: The 'recipes' table structure is essentially (id, toast_menu_item_guid, inventory_item_id, quantity, unit)
        const { data: recipeRows, error: recipeError } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid, inventory_item_id, quantity, unit')

        if (recipeError) throw recipeError

        // 3. Group ingredients by Menu Item GUID in memory
        const recipeMap = new Map<string, any[]>()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recipeRows?.forEach((row: any) => {
            const guid = row.toast_menu_item_guid
            if (!recipeMap.has(guid)) {
                recipeMap.set(guid, [])
            }
            recipeMap.get(guid)?.push({
                inventory_item_id: row.inventory_item_id,
                quantity: row.quantity,
                unit: row.unit,
                type: 'raw' // Default to raw if missing
            })
        })

        // 3. Fetch Inventory Items for Price Lookup
        const { data: inventoryItems, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // 4. Process Costs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = (menuItems || []).map((menuItem: any) => {
            const ingredients = recipeMap.get(menuItem.guid) || []
            const hasRecipe = ingredients.length > 0

            let theoreticalCost = 0
            let foodCostPercent = 0
            let margin = 0
            let missingPrices = 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let breakdown: any[] = []

            if (hasRecipe) {
                // Construct a temporary Recipe object for the calculator
                const recipeObj: Recipe = {
                    id: menuItem.guid, // Fake ID
                    toast_menu_item_guid: menuItem.guid,
                    ingredients: ingredients
                }

                const costResult = calculateRecipeCost(recipeObj, inventoryItems || [])
                theoreticalCost = costResult.totalCost
                missingPrices = costResult.missingPrices
                breakdown = costResult.breakdown
            }

            // Calculate Metrics
            const price = menuItem.price || 0
            if (price > 0 && theoreticalCost > 0) {
                foodCostPercent = (theoreticalCost / price) * 100
                margin = price - theoreticalCost
            }

            return {
                ...menuItem,
                hasRecipe,
                theoreticalCost,
                foodCostPercent,
                margin,
                missingPrices,
                ingredientsCount: ingredients.length,
                breakdown // Included for future drill-down
            }
        })

        // Sort by Food Cost % Descending (Critical items first)
        report.sort((a: any, b: any) => b.foodCostPercent - a.foodCostPercent)

        return NextResponse.json({
            data: report,
            meta: {
                totalItems: report.length,
                itemsWithRecipe: report.filter((i: any) => i.hasRecipe).length,
                missingPricesCount: report.filter((i: any) => i.missingPrices > 0).length
            }
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
