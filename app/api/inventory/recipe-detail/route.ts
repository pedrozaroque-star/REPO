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

        // 5. Calculate breakdown
        const finalRecipe = adjustedRecipeObj || recipe
        const result = calculateRecipeCost(finalRecipe, inventoryData as InventoryItem[])

        return NextResponse.json({
            has_recipe: true,
            match_method: matchMethod,
            total_cost: result.totalCost,
            missing_prices: result.missingPrices,
            breakdown: result.breakdown
        })

    } catch (e: any) {
        console.error('Recipe Detail API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
