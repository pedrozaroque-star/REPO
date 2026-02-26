import { NextRequest, NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { normalizeToLbs } from '@/lib/inventory/conversions'
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
            const supabase = await getSupabaseClient()
            const { data: storesData } = await supabase
                .from('stores')
                .select('name, external_id')
                .eq('is_active', true)

            // Filter valid stores
            const validStores = storesData?.filter(s => s.external_id) || []

            if (validStores.length === 0) {
                console.error("[FoodCostAPI] No valid stores found with external_id")
                throw new Error("No valid stores found")
            }

            console.log(`[FoodCostAPI] Fetching for ${validStores.length} stores...`)
            // Fetch concurrently with error handling & rate limiting (chunks of 3)
            const STORE_CONCURRENCY = 3
            const results: any[] = []

            for (let i = 0; i < validStores.length; i += STORE_CONCURRENCY) {
                const batch = validStores.slice(i, i + STORE_CONCURRENCY)
                console.log(`[FoodCostAPI] Fetching stores batch ${Math.floor(i / STORE_CONCURRENCY) + 1}...`)
                const batchResults = await Promise.all(
                    batch.map(async (s) => {
                        try {
                            const items = await getProductMix({ storeId: s.external_id, startDate, endDate, bundleModifiers: true })
                            return items.map(item => ({
                                ...item,
                                store_id: s.external_id,
                                store_name: s.name || 'Unknown'
                            }))
                        } catch (err) {
                            console.error(`[FoodCostAPI] Failed to fetch store ${s.external_id}:`, err)
                            return [] // Return empty array on failure to avoid breaking entire report
                        }
                    })
                )
                results.push(...batchResults)
            }

            // Aggregate by STORE + GUID + Group Name + Name (Variation)
            // We include Store Name in the key to prevent merging different stores
            const aggMap = new Map<string, any>()

            results.flat().forEach(item => {
                const key = `${item.store_name}_${item.guid}_${item.group_name || 'Uncategorized'}_${item.name}`

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
            // Single store fetch
            const supabase = await getSupabaseClient()
            const currentStore = await supabase.from('stores').select('name').eq('external_id', storeId).single()
            pmixItems = await getProductMix({ storeId, startDate, endDate, bundleModifiers: true })
            pmixItems = pmixItems.map(item => ({
                ...item,
                store_id: storeId,
                store_name: currentStore.data?.name || 'Unknown'
            }))
        }

        // 2. Fetch ALL Recipes and Inventory Items from DB
        const supabase = await getSupabaseClient()
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

        // 3b. Build NAME-based fallback map for GUID mismatches
        // When Toast has different GUIDs for the same product across menus/stores,
        // this allows matching by product name as a safety net.
        const nameToRecipeMap = new Map<string, Recipe>()

        const { data: menuItemsWithRecipes } = await supabase
            .from('toast_menu_items')
            .select('guid, name')
            .in('guid', Array.from(recipeMap.keys()))

        if (menuItemsWithRecipes) {
            menuItemsWithRecipes.forEach((mi: any) => {
                const normalizedName = mi.name.trim().toLowerCase()
                if (!nameToRecipeMap.has(normalizedName)) {
                    const recipe = recipeMap.get(mi.guid)
                    if (recipe) {
                        nameToRecipeMap.set(normalizedName, recipe)
                    }
                }
            })
            console.log(`[FoodCostAPI] Built name fallback map with ${nameToRecipeMap.size} entries`)
        }

        // 4. Combine Data
        const filteredPmix = pmixItems.filter(item => !item.name.toLowerCase().includes('separator'))

        const report = filteredPmix.map(item => {
            // Primary: match by exact GUID
            let recipe = recipeMap.get(item.guid)
            let matchedByName = false

            // Fallback: match by product name (strip modifier suffixes like "(Asada)")
            if (!recipe) {
                const baseName = item.name.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase()
                recipe = nameToRecipeMap.get(baseName)
                if (recipe) {
                    matchedByName = true
                    console.log(`[FoodCostAPI] ✅ Name fallback: "${item.name}" → matched recipe from GUID ${recipe.toast_menu_item_guid}`)
                }
            }

            // Helper to get base portion for meat (in ounces)
            const getMeatBaseOz = (name: string): number => {
                const lower = name.toLowerCase()
                if (lower.includes('taco plate')) return 0 // Explicitly ignored (uses individual taco recipes)
                if (lower.includes('burrito') || lower.includes('nacho') || lower.includes('fries') || lower.includes('torta') || lower.includes('quesadilla') || lower.includes('bowl') || lower.includes('plato')) return 6.0
                if (lower.includes('taco') || lower.includes('mulita') || lower.includes('sope') || lower.includes('gordita')) return 1.5
                return 0 // Doesn't apply or unknown
            }

            // The main 8 meat inventory IDs
            const mainMeatIds = [
                'fab9d589-8ae8-4381-87da-85f836068996', // Asada
                '4ea7ef9c-986e-4fc1-a363-7200ca558aab', // Pollo
                'ad7e3703-2701-4a05-aa97-77866c8c717e', // Pastor
                '14990e85-0d90-467c-ad9d-362e6ed4f1cd', // Carnitas
                'baac1d41-3b80-4f80-acfc-7a19f46e03c2', // Buche
                '511e341b-ca42-44ed-89df-a4a84b51a619', // Cabeza
                '0fb87578-1185-41a9-a318-97428db20a5d', // Lengua
                '1e4c43b6-4e1b-4e51-8617-e127b89467f1', // Chorizo
            ]

            let baseUnitCost = 0
            let unitCost = 0 // Weight average for final report
            let missingPrices = 0
            let meatLbsPerUnit = 0 // New metric

            // -- NEW: Dynamic Half-Meat Recipe Adjustment --
            // If the item has Half meat modifiers, we intercept the base recipe calculate step,
            // remove its full meat portion, and inject the half portions correctly.
            const halfMeatMods: any[] = []
            let normalMods: string[] = []

            if (item.modifier_guids && item.modifier_guids.length > 0) {
                item.modifier_guids.forEach((modGuid: string) => {
                    // Check if this modifier is a Half modifier (by name from toast_menu_items via nameToRecipeMap or direct lookup)
                    // But we actually only have the modRecipe here. We can find its name via the global map or we can inspect ingredients.
                    // Let's rely on the name of the modifier if we can. Since we don't have the mod name easily, we rely on the logic in toast-pmix
                    // that already gives us `half_meat_adjustments` count.
                    // Wait, even better: we can find the name of the modGuid from a lookup, or we can use the `item.name` which contains "(Half Pollo)".
                })
            }

            // Let's extract half names from the parent item name itself because Toast appends them: "Super Burrito Asada (Con cebolla, Half Pastor...)"
            const parentNameLower = item.name.toLowerCase()
            const hasHalfMod = parentNameLower.includes('half asada') || parentNameLower.includes('half pollo') ||
                parentNameLower.includes('half pastor') || parentNameLower.includes('half carnitas') ||
                parentNameLower.includes('half buche') || parentNameLower.includes('half cabeza') ||
                parentNameLower.includes('half lengua') || parentNameLower.includes('half chorizo')

            // 1. Calculate unadulterated base recipe unit cost
            if (recipe) {
                const costResult = calculateRecipeCost(recipe, inventoryData as InventoryItem[])
                baseUnitCost = costResult.totalCost
                missingPrices += costResult.missingPrices

                // Sum meat pounds for the unadulterated base item
                costResult.breakdown.forEach(b => {
                    if (mainMeatIds.includes(b.inventoryItemId)) {
                        meatLbsPerUnit += normalizeToLbs(b.quantity, b.unit as any)
                    }
                })
            }

            let totalBaseCost = baseUnitCost * item.quantity
            let totalBaseMeatLbs = meatLbsPerUnit * item.quantity

            let totalModCost = 0
            let totalModMeatLbs = 0

            // 2. Apply "Half Meat" substitutions directly to the BATCH TOTALS
            // This prevents the substitution from being amplified by item.quantity
            if (recipe && item.modifier_guids && item.modifier_guids.length > 0) {
                const halfModsFound = item.modifier_guids.filter((g: string) => [
                    'ed889228-98e7-4c49-bc46-8e0718ec1fcf', // Half Asada
                    'b52ffce5-cc66-4930-bb96-70891c41643e', // Half Pastor
                    'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', // Half Cabeza
                    '443938bb-ec20-4a64-9fa3-91d4f89de0a5', // Half Pollo
                    '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', // Half Carnitas
                    'fbe42d67-a0f8-481f-bb28-e1717075c290', // Half Buche
                    '8717b04b-62c0-4276-96e9-d86430b32b64', // Half Lengua
                    '37c0cb59-fa76-4b81-b327-cd96784d9f78'  // Half Chorizo
                ].includes(g))

                if (halfModsFound.length > 0) {
                    const halfMapping: Record<string, string> = {
                        'ed889228-98e7-4c49-bc46-8e0718ec1fcf': 'fab9d589-8ae8-4381-87da-85f836068996', // asada
                        'b52ffce5-cc66-4930-bb96-70891c41643e': 'ad7e3703-2701-4a05-aa97-77866c8c717e', // pastor
                        'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3': '511e341b-ca42-44ed-89df-a4a84b51a619', // cabeza
                        '443938bb-ec20-4a64-9fa3-91d4f89de0a5': '4ea7ef9c-986e-4fc1-a363-7200ca558aab', // pollo
                        '6d1bfd79-8c97-4c81-8e03-729fa08ecc75': '14990e85-0d90-467c-ad9d-362e6ed4f1cd', // carnitas
                        'fbe42d67-a0f8-481f-bb28-e1717075c290': 'baac1d41-3b80-4f80-acfc-7a19f46e03c2', // buche
                        '8717b04b-62c0-4276-96e9-d86430b32b64': '0fb87578-1185-41a9-a318-97428db20a5d', // lengua
                        '37c0cb59-fa76-4b81-b327-cd96784d9f78': '1e4c43b6-4e1b-4e51-8617-e127b89467f1'  // chorizo
                    }

                    const meatIds = [
                        'fab9d589-8ae8-4381-87da-85f836068996', '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
                        'ad7e3703-2701-4a05-aa97-77866c8c717e', '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
                        'baac1d41-3b80-4f80-acfc-7a19f46e03c2', '511e341b-ca42-44ed-89df-a4a84b51a619',
                        '0fb87578-1185-41a9-a318-97428db20a5d', '1e4c43b6-4e1b-4e51-8617-e127b89467f1'
                    ]
                    const primaryMeatIng = recipe.ingredients.find((i: any) => meatIds.includes(i.inventory_item_id))

                    if (primaryMeatIng) {
                        const deltaRecipe = { ingredients: [] as any[] }

                        // We remove X portions of primary meat based on how many halves were ordered
                        const portionsToRemove = halfModsFound.length * 0.5
                        deltaRecipe.ingredients.push({
                            ...primaryMeatIng,
                            quantity: -(primaryMeatIng.quantity * portionsToRemove)
                        })

                        // We inject the halves (0.5 portion of primary quantity per half)
                        halfModsFound.forEach((modGuid: string) => {
                            deltaRecipe.ingredients.push({
                                inventory_item_id: halfMapping[modGuid],
                                quantity: primaryMeatIng.quantity * 0.5,
                                unit: primaryMeatIng.unit,
                                type: primaryMeatIng.type
                            })
                        })

                        const deltaRes = calculateRecipeCost(deltaRecipe as any, inventoryData as InventoryItem[])
                        totalBaseCost += deltaRes.totalCost
                        // Avoid double counting missing prices for delta

                        deltaRes.breakdown.forEach(b => {
                            if (mainMeatIds.includes(b.inventoryItemId)) {
                                totalBaseMeatLbs += normalizeToLbs(b.quantity, b.unit as any)
                            }
                        })
                    }
                }
            }

            // 3. Calculate Modifiers Cost
            // Skip "Half Meat" modifiers since we've already accounted for them in the batch delta
            if (item.modifier_guids && item.modifier_guids.length > 0) {
                const halfGuids = [
                    'ed889228-98e7-4c49-bc46-8e0718ec1fcf', 'b52ffce5-cc66-4930-bb96-70891c41643e',
                    'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', '443938bb-ec20-4a64-9fa3-91d4f89de0a5',
                    '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', 'fbe42d67-a0f8-481f-bb28-e1717075c290',
                    '8717b04b-62c0-4276-96e9-d86430b32b64', '37c0cb59-fa76-4b81-b327-cd96784d9f78'
                ]

                item.modifier_guids.forEach((modGuid: string) => {
                    const modRecipe = recipeMap.get(modGuid)
                    if (modRecipe) {
                        if (!halfGuids.includes(modGuid)) {
                            const modRes = calculateRecipeCost(modRecipe, inventoryData as InventoryItem[])
                            totalModCost += modRes.totalCost
                            missingPrices += modRes.missingPrices

                            // Modifiers meat goes to totalModMeatLbs and is NEVER multiplied by item.quantity
                            modRes.breakdown.forEach(b => {
                                if (mainMeatIds.includes(b.inventoryItemId)) {
                                    totalModMeatLbs += normalizeToLbs(b.quantity, b.unit as any)
                                }
                            })
                        }
                    }
                })
            }

            // totalBaseCost = baseUnitCost * item.quantity (Calculated for the whole batch)
            // totalModCost = sum of all OTHER recipes for modifiers found in the batch
            const totalCost = totalBaseCost + totalModCost

            // Calculate final per-unit averages
            if (item.quantity > 0) {
                unitCost = totalCost / item.quantity
            }

            const fcPercent = (item.net_sales > 0) ? (totalCost / item.net_sales) * 100 : 0

            const modRevenuePerUnit = item.quantity > 0 ? (item.modifier_gross_sales / item.quantity) : 0
            const basePricePerUnit = item.quantity > 0 ? (item.gross_sales / item.quantity) : 0

            return {
                ...item,
                unit_price: basePricePerUnit, // Fixed: Already base gross
                total_modifier_cost: modRevenuePerUnit,
                unit_cost: unitCost,
                total_cost: totalCost,
                food_cost_percent: fcPercent,
                has_recipe: !!recipe,
                missing_prices: missingPrices > 0,
                store_id: item.store_id, // Pass through
                store_name: item.store_name, // Pass through
                total_meat_lbs: totalBaseMeatLbs + totalModMeatLbs,
                modifier_guids: item.modifier_guids
            }
        })

        // ═══ DEBUG: Log items without recipes ═══
        const noRecipeItems = report.filter(r => !r.has_recipe && r.quantity > 0)
        if (noRecipeItems.length > 0) {
            console.log(`\n🔴 [FOOD-COST DEBUG] ${noRecipeItems.length} items WITHOUT recipe match:`)
            noRecipeItems
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 30)
                .forEach(item => {
                    console.log(`   GUID: ${item.guid} | Name: "${item.name}" | Group: ${item.group_name} | Qty: ${item.quantity} | Sales: $${item.net_sales.toFixed(2)}`)
                })
            console.log(`   (Showing top 30 by quantity)\n`)
        } else {
            console.log(`\n✅ [FOOD-COST DEBUG] All items with sales have recipe matches!\n`)
        }
        // ═══ END DEBUG ═══

        // Default Sort: Quantity Desc
        report.sort((a, b) => b.quantity - a.quantity)

        return NextResponse.json({ data: report })

    } catch (e: any) {
        console.error('Food Cost API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
