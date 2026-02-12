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

        // 2. Fetch Recipes with Ingredients
        const { data: recipes, error: recipeError } = await supabase
            .from('recipes')
            .select(`
                *,
                ingredients:recipe_ingredients(
                    inventory_item_id,
                    quantity,
                    unit,
                    type
                )
            `)

        if (recipeError) throw recipeError

        // 3. Fetch Inventory Items for Price Lookup
        const { data: inventoryItems, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // 4. Process Costs
        const report = (menuItems || []).map((menuItem: any) => {
            const recipe = (recipes || []).find((r: any) => r.toast_menu_item_guid === menuItem.guid)

            let theoreticalCost = 0
            let foodCostPercent = 0
            let margin = 0
            let missingPrices = 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let breakdown: any[] = []

            if (recipe) {
                const costResult = calculateRecipeCost(recipe, inventoryItems || [])
                theoreticalCost = costResult.totalCost
                missingPrices = costResult.missingPrices
                breakdown = costResult.breakdown
            }

            // Calculate Metrics
            const price = menuItem.price || 0
            if (price > 0) {
                foodCostPercent = (theoreticalCost / price) * 100
                margin = price - theoreticalCost
            }

            return {
                ...menuItem,
                hasRecipe: !!recipe,
                theoreticalCost,
                foodCostPercent,
                margin,
                missingPrices,
                ingredientsCount: recipe?.ingredients?.length || 0,
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
