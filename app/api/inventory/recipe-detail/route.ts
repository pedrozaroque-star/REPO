import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { Recipe, InventoryItem } from '@/types/inventory'

/**
 * GET /api/inventory/recipe-detail?guid=<toast_menu_item_guid>
 * Returns the recipe breakdown for a specific product GUID.
 * Includes name-based fallback matching (same logic as food-cost API).
 */
export async function GET(request: NextRequest) {
    try {
        const guid = request.nextUrl.searchParams.get('guid')
        const itemName = request.nextUrl.searchParams.get('name') || ''
        const quantityParam = request.nextUrl.searchParams.get('quantity')
        const quantity = quantityParam ? parseFloat(quantityParam) : 1
        const modifiersParam = request.nextUrl.searchParams.get('modifiers')
        const modifiers = modifiersParam ? modifiersParam.split(',') : []

        if (!guid) {
            return NextResponse.json({ error: 'Missing guid' }, { status: 400 })
        }

        const supabase = await getSupabaseClient()

        // 1. Fetch all recipes and inventory items
        const [{ data: recipesData, error: rErr }, { data: inventoryData, error: iErr }] = await Promise.all([
            supabase.from('recipes').select('*'),
            supabase.from('inventory_items').select('*')
        ])

        if (rErr) throw rErr
        if (iErr) throw iErr

        // 2. Build recipe map by GUID
        const recipeMap = new Map<string, Recipe>()
        recipesData.forEach((row: any) => {
            const g = row.toast_menu_item_guid
            if (!recipeMap.has(g)) {
                recipeMap.set(g, { id: g, toast_menu_item_guid: g, ingredients: [] })
            }
            recipeMap.get(g)!.ingredients.push({
                inventory_item_id: row.inventory_item_id,
                quantity: row.quantity,
                unit: row.unit,
                type: row.type || 'cooked'
            })
        })

        // 3. Try direct GUID match
        let recipe = recipeMap.get(guid)
        let matchMethod = 'guid'

        // 4. Fallback: name-based match
        if (!recipe) {
            // Get the name of this GUID from toast_menu_items
            // First check if the requested GUID exists in toast_menu_items
            const { data: requestedItem } = await supabase
                .from('toast_menu_items')
                .select('name')
                .eq('guid', guid)
                .maybeSingle()

            // If we know the name, search for alternative GUIDs with the same name that have recipes
            const productName = requestedItem?.name
            if (productName) {
                const baseName = productName.trim().toLowerCase()
                // Build name map from all recipe GUIDs
                const { data: menuItemsWithRecipes } = await supabase
                    .from('toast_menu_items')
                    .select('guid, name')
                    .in('guid', Array.from(recipeMap.keys()))

                if (menuItemsWithRecipes) {
                    const match = menuItemsWithRecipes.find(
                        mi => mi.name.trim().toLowerCase() === baseName
                    )
                    if (match) {
                        recipe = recipeMap.get(match.guid)
                        matchMethod = 'name_fallback'
                    }
                }
            }
        }

        if (!recipe) {
            return NextResponse.json({
                has_recipe: false,
                breakdown: [],
                total_cost: 0,
                match_method: 'none'
            })
        }

        // Helper to get base portion for meat (in ounces)
        const getMeatBaseOz = (name: string): number => {
            const lower = name.toLowerCase()
            if (lower.includes('taco plate')) return 0 // Explicitly ignored (uses individual taco recipes)
            if (lower.includes('burrito') || lower.includes('nacho') || lower.includes('fries') || lower.includes('torta') || lower.includes('quesadilla') || lower.includes('bowl') || lower.includes('plato')) return 6.0
            if (lower.includes('taco') || lower.includes('mulita') || lower.includes('sope') || lower.includes('gordita')) return 1.5
            return 0 // Doesn't apply or unknown
        }

        // Apply Dynamic Half-Meat Recipe Adjustment if needed
        let adjustedRecipeObj: any = null
        if (recipe && itemName) {
            const parentNameLower = itemName.toLowerCase()
            const hasHalfMod = parentNameLower.includes('half asada') || parentNameLower.includes('half pollo') ||
                parentNameLower.includes('half pastor') || parentNameLower.includes('half carnitas') ||
                parentNameLower.includes('half buche') || parentNameLower.includes('half cabeza') ||
                parentNameLower.includes('half lengua') || parentNameLower.includes('half chorizo')

            const meatOz = getMeatBaseOz(itemName)

            if (hasHalfMod && meatOz > 0) {
                const halfMeatsFound: string[] = []
                const checkMeats = ['asada', 'pollo', 'pastor', 'carnitas', 'buche', 'cabeza', 'lengua', 'chorizo']
                checkMeats.forEach(mt => {
                    if (parentNameLower.includes(`half ${mt}`)) halfMeatsFound.push(mt)
                })

                if (halfMeatsFound.length > 0) {
                    adjustedRecipeObj = {
                        ...recipe,
                        ingredients: [...recipe.ingredients]
                    }

                    const meatIds = [
                        'fab9d589-8ae8-4381-87da-85f836068996', // Asada
                        '4ea7ef9c-986e-4fc1-a363-7200ca558aab', // Pollo
                        'ad7e3703-2701-4a05-aa97-77866c8c717e', // Pastor
                        '14990e85-0d90-467c-ad9d-362e6ed4f1cd', // Carnitas
                        'baac1d41-3b80-4f80-acfc-7a19f46e03c2', // Buche
                        '511e341b-ca42-44ed-89df-a4a84b51a619', // Cabeza
                        '0fb87578-1185-41a9-a318-97428db20a5d', // Lengua
                        '1e4c43b6-4e1b-4e51-8617-e127b89467f1', // Chorizo
                    ]

                    const remainingPercentage = Math.max(0, 1 - (0.5 * halfMeatsFound.length))
                    let foundPrimaryMeat = false

                    adjustedRecipeObj.ingredients = adjustedRecipeObj.ingredients.map((ing: any) => {
                        if (meatIds.includes(ing.inventory_item_id)) {
                            foundPrimaryMeat = true
                            return { ...ing, quantity: ing.quantity * remainingPercentage }
                        }
                        return ing
                    })

                    const halfMapping: Record<string, string> = {
                        'asada': 'fab9d589-8ae8-4381-87da-85f836068996',
                        'pollo': '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
                        'pastor': 'ad7e3703-2701-4a05-aa97-77866c8c717e',
                        'carnitas': '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
                        'buche': 'baac1d41-3b80-4f80-acfc-7a19f46e03c2',
                        'cabeza': '511e341b-ca42-44ed-89df-a4a84b51a619',
                        'lengua': '0fb87578-1185-41a9-a318-97428db20a5d',
                        'chorizo': '1e4c43b6-4e1b-4e51-8617-e127b89467f1'
                    }

                    if (foundPrimaryMeat) {
                        const halfOzQty = meatOz * 0.5

                        halfMeatsFound.forEach(mt => {
                            adjustedRecipeObj.ingredients.push({
                                inventory_item_id: halfMapping[mt],
                                quantity: halfOzQty,
                                unit: 'oz',
                                type: 'cooked'
                            })
                        })
                    }
                }
            }
        }

        const finalRecipe = adjustedRecipeObj || recipe
        const result = calculateRecipeCost(finalRecipe, inventoryData as InventoryItem[])

        // 6. Integrate Modifiers
        let totalCost = result.totalCost
        let missingPrices = result.missingPrices
        const aggregatedBreakdown = [...result.breakdown]

        if (modifiers.length > 0) {
            const halfGuids = [
                'ed889228-98e7-4c49-bc46-8e0718ec1fcf', 'b52ffce5-cc66-4930-bb96-70891c41643e',
                'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', '443938bb-ec20-4a64-9fa3-91d4f89de0a5',
                '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', 'fbe42d67-a0f8-481f-bb28-e1717075c290',
                '8717b04b-62c0-4276-96e9-d86430b32b64', '37c0cb59-fa76-4b81-b327-cd96784d9f78'
            ]

            // We will group extra ingredients by inventoryItemId so we don't return 96 rows of tortillas for 32 taco plates
            const extraMap = new Map<string, {
                inventoryItemId: string,
                itemName: string,
                unit: string,
                yieldPercent: number,
                isMissingPrice: boolean,
                totalQty: number,
                totalCost: number
            }>()

            modifiers.forEach(modGuid => {
                if (!halfGuids.includes(modGuid)) {
                    const modRecipe = recipeMap.get(modGuid)
                    if (modRecipe) {
                        const modRes = calculateRecipeCost(modRecipe, inventoryData as InventoryItem[])

                        // Modifier costs are accumulated across ALL quantities, so we must divide by quantity to get PER UNIT cost
                        const perUnitModCost = quantity > 0 ? (modRes.totalCost / quantity) : 0
                        totalCost += perUnitModCost
                        missingPrices += modRes.missingPrices // missing price flag carries over

                        // Aggregate into the map
                        modRes.breakdown.forEach(modIng => {
                            const existing = extraMap.get(modIng.inventoryItemId) || {
                                inventoryItemId: modIng.inventoryItemId,
                                itemName: `[Extra] ${modIng.itemName}`,
                                unit: modIng.unit,
                                yieldPercent: modIng.yieldPercent,
                                isMissingPrice: modIng.isMissingPrice,
                                totalQty: 0,
                                totalCost: 0
                            }

                            existing.totalQty += modIng.quantity
                            existing.totalCost += modIng.cost

                            extraMap.set(modIng.inventoryItemId, existing)
                        })
                    }
                }
            })

            // Now, push the consolidated fractional ingredients to the breakdown
            Array.from(extraMap.values()).forEach(groupedExtra => {
                const fractionalQty = quantity > 0 ? (groupedExtra.totalQty / quantity) : 0
                const fractionalCost = quantity > 0 ? (groupedExtra.totalCost / quantity) : 0

                aggregatedBreakdown.push({
                    inventoryItemId: groupedExtra.inventoryItemId,
                    itemName: groupedExtra.itemName,
                    quantity: fractionalQty,
                    unit: groupedExtra.unit,
                    yieldPercent: groupedExtra.yieldPercent,
                    cost: fractionalCost,
                    isMissingPrice: groupedExtra.isMissingPrice
                })
            })
        }

        return NextResponse.json({
            has_recipe: true,
            match_method: matchMethod,
            total_cost: totalCost,
            missing_prices: missingPrices,
            breakdown: aggregatedBreakdown
        })

    } catch (e: any) {
        console.error('Recipe Detail API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
