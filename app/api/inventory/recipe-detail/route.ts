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
        const diningOptionParam = request.nextUrl.searchParams.get('dining_option') || ''

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
        // Determine allowed COGS type based on dining option
        const doUpper = diningOptionParam.toUpperCase();
        let allowedCogsType = 'cogs_takeout'; // default for safety if unknown
        if (doUpper.includes('HERE') || doUpper.includes('DINE')) allowedCogsType = 'cogs_dine_in';
        else if (doUpper.includes('UBER') || doUpper.includes('DOOR') || doUpper.includes('DELIVERY') || doUpper.includes('GRUB')) allowedCogsType = 'cogs_delivery';
        else if (doUpper.includes('GO') || doUpper.includes('TAKE')) allowedCogsType = 'cogs_takeout';

        recipesData.forEach((row: any) => {
            const g = row.toast_menu_item_guid
            if (!recipeMap.has(g)) {
                recipeMap.set(g, { id: g, toast_menu_item_guid: g, ingredients: [] })
            }
            
            const rType = row.type || 'cooked'
            
            // Filter COGS out if it doesn't match the current sales dining option
            if (rType.startsWith('cogs_') && rType !== allowedCogsType) {
                return; // skip this packaging item
            }

            recipeMap.get(g)!.ingredients.push({
                inventory_item_id: row.inventory_item_id,
                quantity: row.quantity,
                unit: row.unit,
                type: rType
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

        const parentNameLower = itemName.toLowerCase()
        const isPartyTray15 = parentNameLower.includes('15') && parentNameLower.includes('20') && parentNameLower.includes('people')
        const isPartyTray20 = parentNameLower.includes('20') && parentNameLower.includes('25') && parentNameLower.includes('people')
        const isPartyTray25 = parentNameLower.includes('25') && parentNameLower.includes('30') && parentNameLower.includes('people')
        const isPartyTray30 = parentNameLower.includes('30') && parentNameLower.includes('40') && parentNameLower.includes('people')
        const isPartyTray = isPartyTray15 || isPartyTray20 || isPartyTray25 || isPartyTray30

        let skipModCostCalculation = false

        if (isPartyTray) {
            let meatLbs = 6; let riceLbs = 3; let beanLbs = 3; let salsaR = 12; let salsaV = 12;
            let onionLimonPts = 16; let jalapenoOz = 8; let plates = 30; let forks = 15; let spoons = 15;
            let cups = 20; let napkins = 1; let cornPk = 2; let flourPk = 5; let aguaGals = 3;

            if (isPartyTray20) {
                meatLbs = 7.5; riceLbs = 4; beanLbs = 4; salsaR = 16; salsaV = 16;
                onionLimonPts = 20; jalapenoOz = 12; plates = 35; forks = 15; spoons = 15;
                cups = 25; napkins = 1; cornPk = 3; flourPk = 7; aguaGals = 4;
            } else if (isPartyTray25) {
                meatLbs = 10; riceLbs = 6; beanLbs = 6; salsaR = 20; salsaV = 20;
                onionLimonPts = 20; jalapenoOz = 16; plates = 40; forks = 20; spoons = 20;
                cups = 30; napkins = 2; cornPk = 4; flourPk = 9; aguaGals = 5;
            } else if (isPartyTray30) {
                meatLbs = 12; riceLbs = 10; beanLbs = 10; salsaR = 24; salsaV = 24;
                onionLimonPts = 30; jalapenoOz = 20; plates = 50; forks = 25; spoons = 25;
                cups = 40; napkins = 3; cornPk = 5; flourPk = 12; aguaGals = 6;
            }

            const virtualIngredients: any[] = [];
            const modsArr = parentNameLower.match(/\(([^)]+)\)/) ? parentNameLower.match(/\(([^)]+)\)/)![1].split(',').map((s: string) => s.trim()) : [];
            const meatsFound: string[] = [];
            const aguasFound: string[] = [];
            const meatMapOpts: Record<string, string> = {
                'asada': 'fab9d589-8ae8-4381-87da-85f836068996',
                'pollo': '4ea7ef9c-986e-4fc1-a363-7200ca558aab',
                'pastor': 'ad7e3703-2701-4a05-aa97-77866c8c717e',
                'carnit': '14990e85-0d90-467c-ad9d-362e6ed4f1cd',
                'buche': 'baac1d41-3b80-4f80-acfc-7a19f46e03c2',
                'cabeza': '511e341b-ca42-44ed-89df-a4a84b51a619',
                'lengua': '0fb87578-1185-41a9-a318-97428db20a5d',
                'chorizo': '1e4c43b6-4e1b-4e51-8617-e127b89467f1'
            };
            const aguaMapOpts: Record<string, string> = {
                'tamarindo': 'b6f3f5de-c554-4650-b0df-09dd5d3ca053',
                'horchata': '085ecb0d-c711-4134-ae1a-f7630a22759c',
                'piña': '9851a32c-dc35-4653-a1e4-b2cf7bac9009',
                'pina': '9851a32c-dc35-4653-a1e4-b2cf7bac9009',
                'jamaica': '6051e960-7564-41f6-9a52-ff79ed7c6353'
            };

            let exclusiveMeatId: string | null = null;
            let exclusiveAguaId: string | null = null;
            const exclusivePrefixes = ['todo', 'toda', 'solo', 'pura', 'puro', 'only', 'all'];

            if (modsArr.length > 0) {
                modsArr.forEach((mod: string) => {
                    exclusivePrefixes.forEach(prefix => {
                        Object.keys(meatMapOpts).forEach(meatKey => {
                            if (mod.includes(`${prefix} ${meatKey}`) || mod.includes(`${prefix}${meatKey}`) || mod.includes(`${prefix} de ${meatKey}`)) {
                                exclusiveMeatId = meatMapOpts[meatKey];
                            }
                        });
                        Object.keys(aguaMapOpts).forEach(aguaKey => {
                            if (mod.includes(`${prefix} ${aguaKey}`) || mod.includes(`${prefix}${aguaKey}`) || mod.includes(`${prefix} de ${aguaKey}`)) {
                                exclusiveAguaId = aguaMapOpts[aguaKey];
                            }
                        });
                    });

                    Object.keys(meatMapOpts).forEach(k => { if (mod.includes(k)) meatsFound.push(meatMapOpts[k]); });
                    Object.keys(aguaMapOpts).forEach(k => { if (mod.includes(k)) aguasFound.push(aguaMapOpts[k]); });
                });
            }

            if (exclusiveMeatId) {
                meatsFound.length = 0;
                meatsFound.push(exclusiveMeatId);
            }
            if (exclusiveAguaId) {
                aguasFound.length = 0;
                aguasFound.push(exclusiveAguaId);
            }

            if (meatsFound.length === 0) meatsFound.push('fab9d589-8ae8-4381-87da-85f836068996', '4ea7ef9c-986e-4fc1-a363-7200ca558aab', 'ad7e3703-2701-4a05-aa97-77866c8c717e', '14990e85-0d90-467c-ad9d-362e6ed4f1cd');
            if (aguasFound.length === 0) aguasFound.push('b6f3f5de-c554-4650-b0df-09dd5d3ca053', '085ecb0d-c711-4134-ae1a-f7630a22759c', '9851a32c-dc35-4653-a1e4-b2cf7bac9009', '6051e960-7564-41f6-9a52-ff79ed7c6353');

            meatsFound.forEach(mId => { virtualIngredients.push({ inventory_item_id: mId, quantity: meatLbs / meatsFound.length, unit: 'lb', type: 'cooked' }); });
            aguasFound.forEach(aId => { virtualIngredients.push({ inventory_item_id: aId, quantity: aguaGals / aguasFound.length, unit: 'gal', type: 'raw' }); });

            virtualIngredients.push({ inventory_item_id: 'a1bbc13a-a481-4b7f-a5c6-8a44a96ad562', quantity: riceLbs, unit: 'lb', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: '557d9414-c769-4399-a6cc-15bb81cba85f', quantity: beanLbs, unit: 'lb', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'a639ad41-81bf-4de6-8dbc-0291005654ad', quantity: salsaR, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: '6c0a3378-8309-48c9-a438-15313cabd9d8', quantity: salsaV, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: '90fb17e3-6ba7-4545-b5a1-94df4f6a9fcb', quantity: onionLimonPts, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'f73fe7a6-105c-4624-a87b-07d5f78c09ea', quantity: onionLimonPts, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'd56d8df8-d30c-4964-a425-9aa25d962364', quantity: jalapenoOz / 16.0, unit: 'lb', type: 'raw' });
            const hasMaiz = parentNameLower.includes('maiz');
            const hasHarina = parentNameLower.includes('harina');

            if (hasMaiz && hasHarina) {
                virtualIngredients.push({ inventory_item_id: 'dcd79433-e97c-46dc-80c0-8429401e0fa0', quantity: (cornPk * 60) / 2, unit: 'pza', type: 'raw' });
                virtualIngredients.push({ inventory_item_id: '55798c3c-a86e-469d-ab70-24e0f1af0c2b', quantity: (flourPk * 12) / 2, unit: 'pza', type: 'raw' });
            } else if (hasHarina) {
                virtualIngredients.push({ inventory_item_id: '55798c3c-a86e-469d-ab70-24e0f1af0c2b', quantity: flourPk * 12, unit: 'pza', type: 'raw' });
            } else {
                virtualIngredients.push({ inventory_item_id: 'dcd79433-e97c-46dc-80c0-8429401e0fa0', quantity: cornPk * 60, unit: 'pza', type: 'raw' });
            }
            virtualIngredients.push({ inventory_item_id: 'ca959b14-fcef-4900-ae71-2388e4ac023c', quantity: plates, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'd920800f-e0ca-4799-8434-fea7712f7e98', quantity: forks, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'd11c55da-7bd1-4133-883c-f28eb9a31936', quantity: spoons, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: 'e26ad6ed-e91d-4dc5-8c1f-a8a89e977af5', quantity: cups, unit: 'pza', type: 'raw' });
            virtualIngredients.push({ inventory_item_id: '5ea5a92a-fb41-4237-aa91-f006b13c8cc4', quantity: napkins, unit: 'pza', type: 'raw' });

            recipe = { id: 'virtual-party-tray', toast_menu_item_guid: guid, ingredients: virtualIngredients };
            matchMethod = 'party_tray_heuristic';
            skipModCostCalculation = true;
        }

        // Apply Dynamic Half-Meat Recipe Adjustment if needed
        let adjustedRecipeObj: any = null
        if (!isPartyTray && recipe && itemName) {
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

        if (!skipModCostCalculation && modifiers.length > 0) {
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
