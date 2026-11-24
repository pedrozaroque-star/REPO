/**
 * @module app/api/inventory/recipe-detail
 * @description Devuelve el desglose unitario de receta y empaque (con `type` explícito por insumo)
 *   para platillos de Toast POS, incluyendo recetas virtuales de Party Trays y asignación dinámica de proteínas.
 * @businessRules
 *   - Party Trays usan la guía oficial (`buildPartyTrayVirtualIngredients`): mitad maíz/harina cuando ambos se seleccionan,
 *     charolas térmicas, vasos, cubiertos y servilletas clasificados como `cogs_takeout` y comestibles como `'cooked'` / `'raw'`.
 *   - Cada renglón de `breakdown[]` incluye explícitamente `type: r.type || 'food'` para que `ProductDetailModal`
 *     separe Comida vs Empaque estrictamente por `ing.type.startsWith('cogs_')` (jamás por subcadenas como `"bolsa"`).
 *   - Usa `getSupabaseAdminClient()` con paginación `.limit(5000)` / `.range()` tras `verifyStaffAuth` para compatibilidad con RLS.
 * @dataFlow
 *   Toast item + modifiers + price + dining_option -> `recipes` / `party-tray-guidelines` + `parseProteinAllocation` -> `calculateRecipeCost` -> JSON.
 * @notes
 *   - [2026-11-23] Paginación de `recipes`, `inventory_items` y `toast_menu_items`, `type` incluido en cada elemento de `breakdown[]`,
 *     separación explícita `food_cost` vs `packaging_cost` y paridad con `parseProteinAllocation`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { buildPartyTrayVirtualIngredients, isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import { ACTIVE_PROTEIN_IDS, parseProteinAllocation } from '@/lib/inventory/meat-allocation'
import { Recipe, InventoryItem } from '@/types/inventory'
import { verifyStaffAuth } from '@/lib/auth-server'

export async function GET(request: NextRequest) {
    try {
        const auth = await verifyStaffAuth(request)
        if (!auth.authorized) {
            return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
        }

        const guid = request.nextUrl.searchParams.get('guid')
        const itemName = request.nextUrl.searchParams.get('name') || ''
        const quantityParam = request.nextUrl.searchParams.get('quantity')
        const quantity = quantityParam ? parseFloat(quantityParam) : 1
        const modifiersParam = request.nextUrl.searchParams.get('modifiers')
        const modifiers = modifiersParam ? modifiersParam.split(',').filter(Boolean) : []
        const diningOptionParam = request.nextUrl.searchParams.get('dining_option') || ''

        if (!guid) {
            return NextResponse.json({ error: 'Missing guid' }, { status: 400 })
        }

        const supabase = await getSupabaseAdminClient()

        // 1. Fetch all recipes and inventory items (with .limit(5000) to avoid PostgREST 1,000-row cap)
        const [{ data: recipesData, error: rErr }, { data: inventoryData, error: iErr }] = await Promise.all([
            supabase.from('recipes').select('*').limit(5000),
            supabase.from('inventory_items').select('*').limit(5000)
        ])

        if (rErr) throw rErr
        if (iErr) throw iErr

        const invList = (inventoryData || []) as InventoryItem[]
        const itemMap = new Map<string, InventoryItem>(invList.map(i => [i.id, i]))

        // 2. Determine allowed COGS type based on dining option
        const doUpper = diningOptionParam.toUpperCase()
        let allowedCogsType = 'cogs_takeout'
        if (doUpper.includes('HERE') || doUpper.includes('DINE')) allowedCogsType = 'cogs_dine_in'
        else if (doUpper.includes('UBER') || doUpper.includes('DOOR') || doUpper.includes('DELIVERY') || doUpper.includes('GRUB')) allowedCogsType = 'cogs_delivery'
        else if (doUpper.includes('GO') || doUpper.includes('TAKE')) allowedCogsType = 'cogs_takeout'

        const recipeMap = new Map<string, Recipe>()
        ;(recipesData || []).forEach((row: any) => {
            const g = row.toast_menu_item_guid
            if (!recipeMap.has(g)) {
                recipeMap.set(g, { id: g, toast_menu_item_guid: g, ingredients: [] })
            }

            const rType = row.type || 'food'
            if (rType.startsWith('cogs_') && rType !== allowedCogsType) {
                return
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

        // 4. Fallback: name-based match & Party Tray detection
        let effectiveItemName = itemName
        if (!effectiveItemName) {
            const { data: requestedMeta } = await supabase
                .from('toast_menu_items')
                .select('name')
                .eq('guid', guid)
                .maybeSingle()
            if (requestedMeta?.name) {
                effectiveItemName = requestedMeta.name
            }
        }

        const requestedNameLower = effectiveItemName.toLowerCase()
        const isPotentialPartyTray = isPartyTrayMenuItem(effectiveItemName, guid)

        if (!recipe && !isPotentialPartyTray) {
            const productName = effectiveItemName
            if (productName) {
                const baseName = productName.trim().toLowerCase()
                const { data: menuItemsWithRecipes } = await supabase
                    .from('toast_menu_items')
                    .select('guid, name')
                    .in('guid', Array.from(recipeMap.keys()))
                    .limit(5000)

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

        if (!recipe && !isPotentialPartyTray) {
            return NextResponse.json({
                has_recipe: false,
                breakdown: [],
                total_cost: 0,
                food_cost: 0,
                packaging_cost: 0,
                match_method: 'none',
                missing_prices: 0
            })
        }

        const parentNameLower = requestedNameLower
        const isPartyTray15 = parentNameLower.includes('15') && parentNameLower.includes('20') && parentNameLower.includes('people')
        const isPartyTray20 = parentNameLower.includes('20') && parentNameLower.includes('25') && parentNameLower.includes('people')
        const isPartyTray25 = parentNameLower.includes('25') && parentNameLower.includes('30') && parentNameLower.includes('people')
        const isPartyTray30 = parentNameLower.includes('30') && parentNameLower.includes('40') && parentNameLower.includes('people')
        const isPartyTray = isPotentialPartyTray || isPartyTray15 || isPartyTray20 || isPartyTray25 || isPartyTray30

        let skipModCostCalculation = false

        if (isPartyTray) {
            const priceParam = Number(request.nextUrl.searchParams.get('price') || 0)
            const modNames: string[] = []
            if (modifiers.length > 0) {
                const { data: modRows } = await supabase
                    .from('toast_menu_items')
                    .select('name')
                    .in('guid', modifiers)
                    .limit(5000)
                if (modRows) {
                    modRows.forEach((m: any) => {
                        if (m?.name) modNames.push(String(m.name))
                    })
                }
            }
            const virtualParty = buildPartyTrayVirtualIngredients({
                itemName: effectiveItemName,
                unitPrice: Number.isFinite(priceParam) && priceParam > 0 ? priceParam : 0,
                toastGuid: guid,
                isDeliveryChannel: allowedCogsType === 'cogs_delivery',
                modifierTexts: modNames,
                inventoryItems: invList,
            })
            const filteredVirtualIngredients = virtualParty.ingredients.filter(
                ing => !ing.type.startsWith('cogs_') || ing.type === allowedCogsType
            )

            recipe = { id: 'virtual-party-tray', toast_menu_item_guid: guid, ingredients: filteredVirtualIngredients }
            matchMethod = 'party_tray_heuristic'
            skipModCostCalculation = true
        }

        // 5. Dynamic Protein Allocation (Half Meat EN/ES, Extra Meat, Carne Dorada, Meat Only, Catering lb Meat)
        let finalRecipe: Recipe = recipe!
        const activeProteinIds = new Set<string>(Object.values(ACTIVE_PROTEIN_IDS))
        const proteinAllocation = !isPartyTray && recipe && effectiveItemName
            ? parseProteinAllocation(effectiveItemName, recipe.ingredients)
            : null

        if (proteinAllocation && recipe) {
            const primaryProteinIngredient = recipe.ingredients.find(ing => activeProteinIds.has(ing.inventory_item_id))
            finalRecipe = {
                ...recipe,
                ingredients: [
                    ...recipe.ingredients.filter(ing => !activeProteinIds.has(ing.inventory_item_id)),
                    ...Array.from(proteinAllocation.portionsOz.entries()).map(([inventory_item_id, qtyOz]): Recipe['ingredients'][number] => ({
                        inventory_item_id,
                        quantity: qtyOz,
                        unit: 'oz',
                        type: primaryProteinIngredient?.type || 'cooked'
                    }))
                ]
            }
        }

        const validBaseIngredients = finalRecipe.ingredients.filter(ing => itemMap.has(ing.inventory_item_id))
        const result = calculateRecipeCost(finalRecipe, invList)

        let totalCost = result.totalCost
        let totalFoodCost = result.foodCost
        let totalPackagingCost = result.packagingCost
        let missingPrices = result.missingPrices

        const aggregatedBreakdown = result.breakdown.map((b, idx) => ({
            ...b,
            type: validBaseIngredients[idx]?.type || 'food'
        }))

        // 6. Integrate Modifiers (excluding Half/Double meat modifiers already accounted for by parseProteinAllocation)
        if (!skipModCostCalculation && modifiers.length > 0) {
            const halfGuids = new Set([
                'ed889228-98e7-4c49-bc46-8e0718ec1fcf', 'b52ffce5-cc66-4930-bb96-70891c41643e',
                'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', '443938bb-ec20-4a64-9fa3-91d4f89de0a5',
                '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', 'fbe42d67-a0f8-481f-bb28-e1717075c290',
                '8717b04b-62c0-4276-96e9-d86430b32b64', '37c0cb59-fa76-4b81-b327-cd96784d9f78'
            ])

            const extraMap = new Map<string, {
                inventoryItemId: string
                itemName: string
                unit: string
                type: string
                yieldPercent: number
                isMissingPrice: boolean
                totalQty: number
                totalCost: number
            }>()

            modifiers.forEach(modGuid => {
                if (halfGuids.has(modGuid)) return
                const modRecipe = recipeMap.get(modGuid)
                if (!modRecipe) return

                // If parseProteinAllocation already handled Double/Extra meat in itemName, skip meat-only modifiers to prevent double-counting
                if (proteinAllocation && modRecipe.ingredients.length > 0 && modRecipe.ingredients.every(i => activeProteinIds.has(i.inventory_item_id))) {
                    const lowerName = effectiveItemName.toLowerCase()
                    if (/\b(?:extra|doble|double)\b/.test(lowerName) && !lowerName.includes('taco plate')) {
                        return
                    }
                }

                const validModIngs = modRecipe.ingredients.filter(ing => itemMap.has(ing.inventory_item_id))
                const modRes = calculateRecipeCost(modRecipe, invList)

                const perUnitModCost = quantity > 0 ? (modRes.totalCost / quantity) : 0
                const perUnitModFood = quantity > 0 ? (modRes.foodCost / quantity) : 0
                const perUnitModPkg = quantity > 0 ? (modRes.packagingCost / quantity) : 0
                totalCost += perUnitModCost
                totalFoodCost += perUnitModFood
                totalPackagingCost += perUnitModPkg
                missingPrices += modRes.missingPrices

                modRes.breakdown.forEach((modIng, mIdx) => {
                    const ingType = validModIngs[mIdx]?.type || 'food'
                    const mapKey = `${modIng.inventoryItemId}::${ingType}`
                    const existing = extraMap.get(mapKey) || {
                        inventoryItemId: modIng.inventoryItemId,
                        itemName: `[Extra] ${modIng.itemName}`,
                        unit: modIng.unit,
                        type: ingType,
                        yieldPercent: modIng.yieldPercent,
                        isMissingPrice: modIng.isMissingPrice,
                        totalQty: 0,
                        totalCost: 0
                    }

                    existing.totalQty += modIng.quantity
                    existing.totalCost += modIng.cost
                    extraMap.set(mapKey, existing)
                })
            })

            Array.from(extraMap.values()).forEach(groupedExtra => {
                const fractionalQty = quantity > 0 ? (groupedExtra.totalQty / quantity) : 0
                const fractionalCost = quantity > 0 ? (groupedExtra.totalCost / quantity) : 0

                aggregatedBreakdown.push({
                    inventoryItemId: groupedExtra.inventoryItemId,
                    itemName: groupedExtra.itemName,
                    quantity: fractionalQty,
                    unit: groupedExtra.unit,
                    type: groupedExtra.type,
                    yieldPercent: groupedExtra.yieldPercent,
                    cost: Number(fractionalCost.toFixed(4)),
                    isMissingPrice: groupedExtra.isMissingPrice
                })
            })
        }

        return NextResponse.json({
            has_recipe: true,
            match_method: matchMethod,
            total_cost: Number(totalCost.toFixed(4)),
            food_cost: Number(totalFoodCost.toFixed(4)),
            packaging_cost: Number(totalPackagingCost.toFixed(4)),
            missing_prices: missingPrices,
            breakdown: aggregatedBreakdown
        })

    } catch (e: any) {
        console.error('Recipe Detail API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
