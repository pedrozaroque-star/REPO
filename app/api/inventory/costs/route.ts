/**
 * @module app/api/inventory/costs
 * @description Reporte teórico de costos y márgenes del catálogo maestro de Toast POS (`/inventory/costs`).
 * @businessRules
 *   - Calcula el costo teórico de materia prima (`foodCost`) por platillo usando `calculateRecipeCost`.
 *   - Para Party Trays / Fiesta Platters (`15-20`, `20-25`, `25-30`, `30-40` personas y `Fiesta Platters` Delivery),
 *     construye la receta virtual completa desde `PARTY_TRAY_GUIDELINES` (`buildPartyTrayVirtualIngredients`).
 * @dataFlow
 *   `toast_menu_items` + `recipes` + `inventory_items` + `PARTY_TRAY_GUIDELINES` -> `calculateRecipeCost` -> JSON.
 * @notes
 *   - [2026-11-17] Integrado `buildPartyTrayVirtualIngredients` para que Party Trays muestren su costo real completo
 *     en lugar de solo los 7 insumos fijos base de `recipes`.
 *   - Protegido con `verifyStaffAuth` para evitar exposición pública de costos y márgenes del menú.
 */

import { getSupabaseClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { buildPartyTrayVirtualIngredients, isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import { InventoryItem, Recipe } from '@/types/inventory'
import { verifyStaffAuth } from '@/lib/auth-server'

export async function GET(request: Request) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const supabase = await getSupabaseClient()

    try {
        const { data: menuItems, error: menuError } = await supabase
            .from('toast_menu_items')
            .select('*')
            .order('name')

        if (menuError) throw menuError

        const { data: recipeRows, error: recipeError } = await supabase
            .from('recipes')
            .select('toast_menu_item_guid, inventory_item_id, quantity, unit, type')

        if (recipeError) throw recipeError

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
                type: row.type || 'cooked'
            })
        })

        const { data: inventoryItems, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const report = (menuItems || []).map((menuItem: any) => {
            const isPartyTray = !menuItem.is_modifier && isPartyTrayMenuItem(menuItem.name, menuItem.guid)
            let ingredients = recipeMap.get(menuItem.guid) || []

            if (isPartyTray) {
                const groupLower = String(menuItem.group_name || '').toLowerCase()
                const isDelivery = groupLower.includes('3rd party') || groupLower.includes('delivery')
                const virtualParty = buildPartyTrayVirtualIngredients({
                    itemName: String(menuItem.name || ''),
                    unitPrice: Number(menuItem.price) || 0,
                    toastGuid: menuItem.guid,
                    isDeliveryChannel: isDelivery,
                    inventoryItems: (inventoryItems || []) as InventoryItem[],
                })
                ingredients = virtualParty.ingredients
            }

            const hasRecipe = ingredients.length > 0

            let theoreticalCost = 0
            let foodCostPercent = 0
            let margin = 0
            let missingPrices = 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let breakdown: any[] = []

            if (hasRecipe) {
                const foodIngredients = ingredients.filter(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (i: any) => !i.type || i.type === 'food' || i.type === 'raw' || i.type === 'cooked'
                )

                const recipeObj: Recipe = {
                    id: menuItem.guid,
                    toast_menu_item_guid: menuItem.guid,
                    ingredients: foodIngredients
                }

                const costResult = calculateRecipeCost(recipeObj, inventoryItems || [])
                theoreticalCost = costResult.foodCost
                missingPrices = costResult.missingPrices
                breakdown = costResult.breakdown
            }

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
                breakdown
            }
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        report.sort((a: any, b: any) => b.foodCostPercent - a.foodCostPercent)

        return NextResponse.json({
            data: report,
            meta: {
                totalItems: report.length,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                itemsWithRecipe: report.filter((i: any) => i.hasRecipe).length,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                missingPricesCount: report.filter((i: any) => i.missingPrices > 0).length
            }
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
