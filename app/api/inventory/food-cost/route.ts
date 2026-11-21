/**
 * @module FoodCostAPI
 * @description Motor principal de cálculo de Food Cost teórico.
 *   Recibe un rango de fechas y (opcionalmente) un storeId, obtiene el Product Mix
 *   (PMIX) de Toast, cruza cada item vendido con su receta en Supabase, y calcula
 *   el costo teórico de cada ingrediente usando precios históricos del inventario.
 *
 * @businessRules
 *   - El food cost se calcula a nivel de ITEM vendido (cada línea del PMIX).
 *   - Items sin receta contribuyen $0 al food cost (se marcan has_recipe=false).
 *   - Las recetas se buscan por GUID primero, luego por nombre (fallback).
 *   - Los Party Trays (15-20, 20-25, 25-30, 30-40 People) NO tienen receta en DB:
 *     se generan recetas VIRTUALES parseando los modificadores del nombre del item.
 *   - Los modificadores "Half Meat" (e.g., Half Pastor en un Burrito Asada) ajustan
 *     la porción de carne base -50% e inyectan +50% de la carne sustituta.
 *   - Precios históricos: usa `inventory_price_history` para obtener el precio vigente
 *     en la fecha del reporte ("La Máquina del Tiempo").
 *
 * @dataFlow
 *   Toast Orders API → getProductMix() → PMIX items
 *   Supabase recipes → recipeMap (GUID → Recipe)
 *   Supabase inventory_items + price_history → inventoryData con precios históricos
 *   PMIX × Recipes × Prices → calculateRecipeCost() → report[]
 *   report → food_cost_daily_cache (write-through para single-day queries)
 *
 * @notes
 *   - [2026-06-01] FIX: costs.ts clasificaba 'raw'/'cooked' como packaging → $0 food cost en party trays.
 *   - [2026-06-01] net_sales en cache se toma de sales_daily_cache (no del PMIX) para paridad con Ventas.
 *   - [2026-09-10] FIX: Write-through cache restricted to storeId='all' to prevent partial 1-store cache poisoning.
 *   - La normalización defensiva de modifiers (cap qty) protege contra cache corrupto antiguo.
 *   - [2026-11-17] Unificado con `buildPartyTrayVirtualIngredients` (`Party Tray Guidelines`), corrigiendo
 *     tortilla de harina a `358_9604BT Tortilla Regular 8 in` (`1df90372-7648-4ec1-9a6c-fca4032095a6`),
 *     respetando `Fiesta Platters` Delivery como `15-20` y aislando Party Trays de `parseProteinAllocation`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseClient, getSupabaseAdminClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { normalizeToLbs } from '@/lib/inventory/conversions'
import { buildPartyTrayVirtualIngredients, isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import { ACTIVE_PROTEIN_IDS, parseProteinAllocation } from '@/lib/inventory/meat-allocation'
import { Recipe, InventoryItem } from '@/types/inventory'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowCron: true })
    if (!auth.authorized) return auth.response!

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

        let { data: inventoryData, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // --- SCENARIO B: HISTORICAL PRICES O "LA MÁQUINA DEL TIEMPO" ---
        // Buscamos cuál era el precio de los insumos exáctamente el último día de este reporte (endDate)
        const targetDate = `${endDate}T23:59:59.999Z`
        const { data: historyData } = await supabase
            .from('inventory_price_history')
            .select('inventory_item_id, purchase_unit_cost, quantity_per_unit, effective_date')
            .lte('effective_date', targetDate)
            .order('effective_date', { ascending: false })
            
        if (historyData && inventoryData) {
            const latestValidPrices = new Map<string, { price: number; qty?: number }>()
            historyData.forEach(h => {
                // Al estar ordenado Descendente, el primer registro que leamos es el correcto para la fecha
                if (!latestValidPrices.has(h.inventory_item_id)) {
                    latestValidPrices.set(h.inventory_item_id, {
                        price: h.purchase_unit_cost,
                        qty: h.quantity_per_unit ? Number(h.quantity_per_unit) : undefined
                    })
                }
            })
            
            inventoryData = inventoryData.map(item => {
                const hist = latestValidPrices.get(item.id)
                return {
                    ...item,
                    purchase_unit_cost: hist ? hist.price : item.purchase_unit_cost,
                    quantity_per_unit: (hist && hist.qty) ? hist.qty : item.quantity_per_unit
                }
            })
            console.log(`[FoodCostAPI] 🕰️ Historical Pricing & Packaging Applied for date: ${targetDate}`)
        }
        // --- FIN SCENARIO B ---

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

            let skipModCostCalculation = false;

            // --- HEURISTIC RECIPE GENERATOR FOR PARTY TRAYS & FIESTA PLATTERS ---
            const parentNameLower = item.name.toLowerCase();
            const hasPartyTrayKeywords = parentNameLower.includes('party tray') || 
                                         parentNameLower.includes('fiesta platter') || 
                                         parentNameLower.includes('people');
            
            const isPartyTray15Name = (parentNameLower.includes('15') && parentNameLower.includes('20')) || parentNameLower.includes('15-20') || parentNameLower.includes('15 - 20');
            const isPartyTray20Name = (parentNameLower.includes('20') && parentNameLower.includes('25')) || parentNameLower.includes('20-25') || parentNameLower.includes('20 - 25');
            const isPartyTray25Name = (parentNameLower.includes('25') && parentNameLower.includes('30')) || parentNameLower.includes('25-30') || parentNameLower.includes('25 - 30');
            const isPartyTray30Name = (parentNameLower.includes('30') && parentNameLower.includes('40')) || parentNameLower.includes('30-40') || parentNameLower.includes('30 - 40');
            
            const isPartyTray = isPartyTrayMenuItem(item.name, item.guid) || hasPartyTrayKeywords || isPartyTray15Name || isPartyTray20Name || isPartyTray25Name || isPartyTray30Name;

            if (isPartyTray) {
                const unitPrice = (item.price && item.price > 0) ? item.price : ((item.quantity && item.quantity > 0) ? (item.net_sales / item.quantity) : 0);
                const groupLower = String(item.group_name || '').toLowerCase()
                const isDeliveryGroup = groupLower.includes('uber') || groupLower.includes('door') || groupLower.includes('grub') || groupLower.includes('delivery') || groupLower.includes('3rd party')
                const virtualParty = buildPartyTrayVirtualIngredients({
                    itemName: item.name,
                    unitPrice,
                    toastGuid: item.guid,
                    isDeliveryChannel: isDeliveryGroup,
                    inventoryItems: (inventoryData || []) as InventoryItem[],
                })

                recipe = {
                    id: 'virtual-party-tray',
                    toast_menu_item_guid: item.guid,
                    ingredients: virtualParty.ingredients
                };
                skipModCostCalculation = true;
                console.log(`[FoodCostAPI] 🛠️ Virtual Recipe Generated for Party Tray (${virtualParty.size}): "${item.name}"`)
            } else if (!recipe) {
                // If it's not a party tray, and we still have no recipe
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
            const hasHalfMod = parentNameLower.includes('half asada') || parentNameLower.includes('half pollo') ||
                parentNameLower.includes('half pastor') || parentNameLower.includes('half carnitas') ||
                parentNameLower.includes('half buche') || parentNameLower.includes('half cabeza') ||
                parentNameLower.includes('half lengua') || parentNameLower.includes('half chorizo')

            const proteinAllocation = !isPartyTray && recipe ? parseProteinAllocation(item.name, recipe.ingredients) : null
            const activeProteinIds = new Set<string>(Object.values(ACTIVE_PROTEIN_IDS))
            const primaryProteinIngredient = recipe?.ingredients.find(ingredient => activeProteinIds.has(ingredient.inventory_item_id))
            const recipeForCost = proteinAllocation && recipe
                ? {
                    ...recipe,
                    ingredients: [
                        ...recipe.ingredients.filter(ingredient => !activeProteinIds.has(ingredient.inventory_item_id)),
                        ...Array.from(proteinAllocation.portionsOz.entries()).map(([inventory_item_id, quantity]) => ({
                            inventory_item_id, quantity, unit: 'oz', type: primaryProteinIngredient?.type || 'cooked'
                        }))
                    ]
                }
                : recipe as Recipe | undefined

            // 1. Calculate unadulterated base recipe unit cost
            if (recipeForCost) {
                const costResult = calculateRecipeCost(recipeForCost as Recipe, inventoryData as InventoryItem[], item.group_name)
                baseUnitCost = costResult.foodCost // STRICTLY FOOD COST, matches Menu Catalog "Costo"
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
            if (!proteinAllocation && recipe && item.modifier_guids && item.modifier_guids.length > 0) {
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

                        const deltaRes = calculateRecipeCost(deltaRecipe as any, inventoryData as InventoryItem[], item.group_name)
                        totalBaseCost += deltaRes.foodCost
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
            if (!skipModCostCalculation && item.modifier_guids && item.modifier_guids.length > 0) {
                const halfGuids = [
                    'ed889228-98e7-4c49-bc46-8e0718ec1fcf', 'b52ffce5-cc66-4930-bb96-70891c41643e',
                    'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', '443938bb-ec20-4a64-9fa3-91d4f89de0a5',
                    '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', 'fbe42d67-a0f8-481f-bb28-e1717075c290',
                    '8717b04b-62c0-4276-96e9-d86430b32b64', '37c0cb59-fa76-4b81-b327-cd96784d9f78'
                ]

                // DEFENSIVE NORMALIZATION: Old PMIX cache (pre-fix) has modifier GUIDs
                // inflated by qty² instead of qty. Cap each unique modifier to at most
                // item.quantity occurrences to ensure correct cost regardless of cache age.
                const modCounts = new Map<string, number>()
                item.modifier_guids.forEach((g: string) => modCounts.set(g, (modCounts.get(g) || 0) + 1))

                const normalizedModGuids: string[] = []
                modCounts.forEach((count, guid) => {
                    const capped = Math.min(count, item.quantity)
                    for (let i = 0; i < capped; i++) {
                        normalizedModGuids.push(guid)
                    }
                })

                normalizedModGuids.forEach((modGuid: string) => {
                    const modRecipe = recipeMap.get(modGuid)
                    if (modRecipe) {
                        const isProteinModifier = !!proteinAllocation && modRecipe.ingredients.some(ingredient => activeProteinIds.has(ingredient.inventory_item_id))
                        if (!halfGuids.includes(modGuid) && !isProteinModifier) {
                            const modRes = calculateRecipeCost(modRecipe, inventoryData as InventoryItem[], item.group_name)
                            totalModCost += modRes.foodCost
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

        // ═══ WRITE-THROUGH CACHE & AUTHORITATIVE SALES ═══
        // Fetch authoritative net_sales from sales_daily_cache (same source as Ventas page)
        // regardless of range, so the frontend can align sales numbers.
        let salesNetSalesMap: Map<string, number> | null = null
        try {
            const supabaseAdmin = await getSupabaseAdminClient()
            const { data: salesRows } = await supabaseAdmin
                .from('sales_daily_cache')
                .select('store_id, net_sales')
                .gte('business_date', startDate)
                .lte('business_date', endDate)

            salesNetSalesMap = new Map<string, number>()
            salesRows?.forEach((r: any) => {
                const current = salesNetSalesMap!.get(r.store_id) || 0
                salesNetSalesMap!.set(r.store_id, current + (Number(r.net_sales) || 0))
            })

            // Write-through cache ONLY for single-day requests across ALL stores
            // Prevents partial cache poisoning when querying an individual store
            if (startDate === endDate && (!storeId || storeId === 'all')) {
                const storeAgg = new Map<string, any>()
                report.forEach(item => {
                    const sid = item.store_id || 'unknown'
                    if (!storeAgg.has(sid)) {
                        storeAgg.set(sid, {
                            business_date: startDate,
                            store_id: sid,
                            store_name: item.store_name || 'Unknown',
                            total_cost: 0,
                            net_sales: 0,
                            total_items: 0,
                            items_with_recipe: 0,
                            total_meat_lbs: 0
                        })
                    }
                    const agg = storeAgg.get(sid)
                    agg.total_cost += item.total_cost || 0
                    agg.net_sales += item.net_sales || 0
                    agg.total_items += 1
                    if (item.has_recipe) agg.items_with_recipe += 1
                    agg.total_meat_lbs += item.total_meat_lbs || 0
                })

                // Override net_sales with sales_daily_cache values when available
                const cacheRows = Array.from(storeAgg.values()).map(s => {
                    const authoritativeSales = salesNetSalesMap!.get(s.store_id)
                    const netSales = authoritativeSales !== undefined ? authoritativeSales : s.net_sales
                    return {
                        ...s,
                        net_sales: netSales,
                        cost_percentage: netSales > 0 ? Number(((s.total_cost / netSales) * 100).toFixed(2)) : 0,
                        updated_at: new Date().toISOString()
                    }
                })

                const { error: cacheError } = await supabaseAdmin
                    .from('food_cost_daily_cache')
                    .upsert(cacheRows, { onConflict: 'business_date, store_id' })

                if (cacheError) {
                    console.warn('[FoodCostAPI] ⚠️ Cache write failed:', cacheError.message)
                } else {
                    console.log(`[FoodCostAPI] 📦 Cached ${cacheRows.length} store aggregates for ${startDate}`)
                }
            }
        } catch (err: any) {
            console.warn('[FoodCostAPI] Authoritative sales fetch error:', err.message)
        }
        // ═══ END WRITE-THROUGH CACHE ═══

        // Include authoritative sales data in response so frontend can use it
        const salesNetSales: Record<string, number> = {}
        if (salesNetSalesMap) {
            salesNetSalesMap.forEach((v, k) => salesNetSales[k] = v)
        }

        // Default Sort: Quantity Desc
        report.sort((a, b) => b.quantity - a.quantity)

        return NextResponse.json({ data: report, salesNetSales })

    } catch (e: any) {
        console.error('Food Cost API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
