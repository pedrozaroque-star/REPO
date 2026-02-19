import { NextRequest, NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { Recipe, InventoryItem } from '@/types/inventory'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400 })
        }

        // 1. Fetch Product Mix (Sales) from Toast
        // This gives us: guid, name, quantity, net_sales
        let pmixItems: any[] = []

        if (storeId === 'all') {
            const supabase = await getSupabaseAdminClient()
            const { data: stores } = await supabase
                .from('stores')
                .select('external_id')
                .eq('is_active', true)

            if (!stores || stores.length === 0) {
                throw new Error("No active stores found")
            }

            // Fetch concurrently
            const results = await Promise.all(
                stores.map(s => getProductMix({ storeId: s.external_id, startDate, endDate }))
            )

            // Aggregate by GUID + Group Name
            const aggMap = new Map<string, any>()

            results.flat().forEach(item => {
                const key = `${item.guid}_${item.group_name || 'Uncategorized'}`
                if (!aggMap.has(key)) {
                    aggMap.set(key, { ...item })
                } else {
                    const existing = aggMap.get(key)
                    existing.quantity += item.quantity
                    existing.net_sales += item.net_sales
                    existing.gross_sales += item.gross_sales
                    existing.discounts += item.discounts
                    existing.voided_quantity += item.voided_quantity
                    // Unit price is recalculated later
                }
            })

            pmixItems = Array.from(aggMap.values()).map(item => ({
                ...item,
                unit_price: item.quantity > 0 ? item.gross_sales / item.quantity : 0
            }))

        } else {
            pmixItems = await getProductMix({ storeId, startDate, endDate })
        }

        // 2. Fetch ALL Recipes and Inventory Items from DB
        const supabase = await getSupabaseAdminClient()

        const { data: recipesData, error: recipeError } = await supabase
            .from('recipes')
            .select('*')

        if (recipeError) throw recipeError

        const { data: inventoryData, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // 3. Map Recipes by GUID
        // recipesData is array of ingredients: { toast_menu_item_guid, inventory_item_id, quantity, unit }
        // We need to group them by toast_menu_item_guid to form a "Recipe" object for calculateRecipeCost

        const recipeMap = new Map<string, Recipe>()

        recipesData.forEach((row: any) => {
            const guid = row.toast_menu_item_guid
            if (!recipeMap.has(guid)) {
                recipeMap.set(guid, {
                    id: guid, // Use guid as ID for the Recipe object
                    toast_menu_item_guid: guid,
                    ingredients: []
                })
            }
            recipeMap.get(guid)!.ingredients.push({
                inventory_item_id: row.inventory_item_id,
                quantity: row.quantity,
                unit: row.unit,
                type: row.type || 'cooked' // Default to COOKED to apply yield logic (most recipes are plated)
            })
        })

        // 4. Combine Data
        const report = pmixItems.map(item => {
            const recipe = recipeMap.get(item.guid)
            let unitCost = 0
            let missingPrices = 0

            if (recipe) {
                const costResult = calculateRecipeCost(recipe, inventoryData as InventoryItem[])
                unitCost = costResult.totalCost
                missingPrices = costResult.missingPrices
            }

            const totalCost = item.quantity * unitCost
            // Food Cost % = Total Cost / Net Sales
            // If Net Sales is 0, FC% is 0 (or undefined/infinite)
            const fcPercent = item.net_sales > 0 ? (totalCost / item.net_sales) * 100 : 0

            return {
                ...item,
                unit_cost: unitCost,
                total_cost: totalCost,
                food_cost_percent: fcPercent,
                has_recipe: !!recipe,
                missing_prices: missingPrices > 0
            }
        })

        // Default Sort: Quantity Desc
        report.sort((a, b) => b.quantity - a.quantity)

        return NextResponse.json({ data: report })

    } catch (e: any) {
        console.error('Food Cost API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
