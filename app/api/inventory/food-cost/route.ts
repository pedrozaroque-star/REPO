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

        console.log(`[FoodCostAPI] Request storeId=${storeId}, start=${startDate}, end=${endDate}`)

        if (storeId === 'all') {
            const supabase = await getSupabaseAdminClient()
            const { data: stores } = await supabase
                .from('stores')
                .select('external_id')
                .eq('is_active', true)

            // Filter valid stores
            const validStores = stores?.filter(s => s.external_id) || []

            if (validStores.length === 0) {
                console.error("[FoodCostAPI] No valid stores found with external_id")
                throw new Error("No valid stores found")
            }

            console.log(`[FoodCostAPI] Fetching for ${validStores.length} stores...`)

            // Fetch concurrently with error handling
            const results = await Promise.all(
                validStores.map(async (s) => {
                    try {
                        return await getProductMix({ storeId: s.external_id, startDate, endDate, bundleModifiers: true })
                    } catch (err) {
                        console.error(`[FoodCostAPI] Failed to fetch store ${s.external_id}:`, err)
                        return [] // Return empty array on failure to avoid breaking entire report
                    }
                })
            )

            // Aggregate by GUID + Group Name + Name (Variation)
            const aggMap = new Map<string, any>()

            results.flat().forEach(item => {
                const key = `${item.guid}_${item.group_name || 'Uncategorized'}_${item.name}`

                if (!aggMap.has(key)) {
                    // Create deep copy for array
                    const newItem = { ...item }
                    if (item.modifier_guids) {
                        newItem.modifier_guids = [...item.modifier_guids]
                    }
                    aggMap.set(key, newItem)
                } else {
                    const existing = aggMap.get(key)
                    existing.quantity += item.quantity
                    existing.net_sales += item.net_sales
                    existing.gross_sales += item.gross_sales
                    existing.discounts += item.discounts
                    existing.voided_quantity += item.voided_quantity

                    // Merge modifiers
                    if (item.modifier_guids && item.modifier_guids.length > 0) {
                        if (!existing.modifier_guids) existing.modifier_guids = []
                        existing.modifier_guids.push(...item.modifier_guids)
                    }
                }
            })

            pmixItems = Array.from(aggMap.values()).map(item => ({
                ...item,
                unit_price: item.quantity > 0 ? item.gross_sales / item.quantity : 0
            }))

        } else {
            // Bundle modifiers to capture full plate costs (e.g. Taco Plate + 3 Tacos)
            pmixItems = await getProductMix({ storeId, startDate, endDate, bundleModifiers: true })
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
                missingPrices += costResult.missingPrices
            }

            let totalBaseCost = unitCost * item.quantity
            let totalModCost = 0

            // Calculate Modifiers Cost (if any)
            if (item.modifier_guids && item.modifier_guids.length > 0) {
                item.modifier_guids.forEach((modGuid: string) => {
                    // Try to find recipe for modifier
                    const modRecipe = recipeMap.get(modGuid)
                    if (modRecipe) {
                        const modRes = calculateRecipeCost(modRecipe, inventoryData as InventoryItem[])
                        totalModCost += modRes.totalCost
                        missingPrices += modRes.missingPrices
                    }
                    // If no recipe for modifier, we assume cost 0 (common for text mods)
                })
            }

            const totalCost = totalBaseCost + totalModCost

            // Recalculate Unit Cost (Weighted Average)
            // If we have varied modifiers, the unit cost is the average of all plates sold
            if (item.quantity > 0) {
                unitCost = totalCost / item.quantity
            }
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
