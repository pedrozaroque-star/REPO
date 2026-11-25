/**
 * @module app/api/inventory/costs
 * @description Reporte teórico de costos (Comida vs Empaque separado) y márgenes del catálogo maestro de Toast POS (`/inventory/costs`).
 * @businessRules
 *   - Calcula `foodCost` (`'food' | 'raw' | 'cooked'`) y `packagingCost` (`worstCogs = max(cogs_dine_in, cogs_takeout, cogs_delivery)`) por separado.
 *   - `foodCostPercent = (foodCost / price) * 100` (estrictamente comida pura, sin mezclar empaque).
 *   - `packagingPercent = (packagingCost / price) * 100` (empaque separado).
 *   - Para Party Trays / Fiesta Platters, construye la receta virtual completa desde `buildPartyTrayVirtualIngredients`.
 *   - Usa `getSupabaseAdminClient()` con `.limit(10000)` tras `verifyStaffAuth` para compatibilidad con RLS.
 * @dataFlow
 *   `toast_menu_items` + `recipes` + `inventory_items` + `PARTY_TRAY_GUIDELINES` -> `calculateRecipeCost` -> JSON.
 * @notes
 *   - [2026-11-23] Separados `foodCost`, `packagingCost`, `foodCostPercent` y `packagingPercent`, y añadido `.limit(10000)` con `getSupabaseAdminClient()`.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { buildPartyTrayVirtualIngredients, isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import { InventoryItem, Recipe } from '@/types/inventory'
import { verifyStaffAuth } from '@/lib/auth-server'

let costsResponseCache: { expiresAt: number; payload: any } | null = null
let costsInFlight: Promise<any> | null = null
const COSTS_CACHE_TTL_MS = 2 * 60 * 1000

async function fetchAllCostRows<T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    pageSize = 1000,
    maxPages = 20
): Promise<T[]> {
    const rows: T[] = []
    for (let page = 0; page < maxPages; page++) {
        const from = page * pageSize
        const { data, error } = await buildQuery(from, from + pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < pageSize) break
    }
    return rows
}

export async function GET(request: Request) {
    const auth = await verifyStaffAuth(request)
    if (!auth.authorized) {
        return auth.response || NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 })
    }

    const url = new URL(request.url)
    const bypassCache = url.searchParams.get('nocache') === '1'
    if (!bypassCache && costsResponseCache && costsResponseCache.expiresAt > Date.now()) {
        return NextResponse.json(costsResponseCache.payload, {
            headers: { 'Cache-Control': 'private, max-age=120' },
        })
    }

    try {
        let loader = !bypassCache ? costsInFlight : null
        if (!loader) {
            loader = (async () => {
                const supabase = await getSupabaseAdminClient()
                const [menuItems, recipeRows, inventoryItems] = await Promise.all([
                    fetchAllCostRows<any>((from, to) =>
                        supabase
                            .from('toast_menu_items')
                            .select('*')
                            .order('name', { ascending: true })
                            .order('guid', { ascending: true })
                            .range(from, to)
                    ),
                    fetchAllCostRows<any>((from, to) =>
                        supabase
                            .from('recipes')
                            .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
                            .order('id', { ascending: true })
                            .range(from, to)
                    ),
                    fetchAllCostRows<any>((from, to) =>
                        supabase
                            .from('inventory_items')
                            .select('*')
                            .order('id', { ascending: true })
                            .range(from, to)
                    ),
                ])

                const recipeMap = new Map<string, any[]>()
                recipeRows.forEach((row: any) => {
                    const guid = row.toast_menu_item_guid
                    if (!recipeMap.has(guid)) {
                        recipeMap.set(guid, [])
                    }
                    recipeMap.get(guid)!.push({
                        inventory_item_id: row.inventory_item_id,
                        quantity: row.quantity,
                        unit: row.unit,
                        type: row.type || 'cooked'
                    })
                })

                const invList = inventoryItems as InventoryItem[]
                const invItemMap = new Map<string, InventoryItem>(invList.map((i) => [i.id, i]))

                const report = menuItems.map((menuItem: any) => {
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
                            inventoryItems: invList,
                        })
                        ingredients = virtualParty.ingredients
                    }

                    const foodIngredients = ingredients.filter(
                        (i: any) => !i.type || i.type === 'food' || i.type === 'raw' || i.type === 'cooked'
                    )
                    const cogsDineInIngs = ingredients.filter((i: any) => i.type === 'cogs_dine_in')
                    const cogsTakeoutIngs = ingredients.filter((i: any) => i.type === 'cogs_takeout')
                    const cogsDeliveryIngs = ingredients.filter((i: any) => i.type === 'cogs_delivery')

                    const hasRecipe = foodIngredients.length > 0 || ingredients.length > 0

                    let foodCost = 0
                    let cogsDineIn = 0
                    let cogsTakeout = 0
                    let cogsDelivery = 0
                    let packagingCost = 0
                    let foodCostPercent = 0
                    let packagingPercent = 0
                    let margin = 0
                    let missingPrices = 0
                    let breakdown: any[] = []

                    if (hasRecipe) {
                        if (foodIngredients.length > 0) {
                            const foodRes = calculateRecipeCost(
                                { id: menuItem.guid, toast_menu_item_guid: menuItem.guid, ingredients: foodIngredients } as Recipe,
                                invList,
                                undefined,
                                invItemMap
                            )
                            foodCost = foodRes.foodCost
                            missingPrices += foodRes.missingPrices
                            breakdown = foodRes.breakdown
                        }
                        if (cogsDineInIngs.length > 0) {
                            const res = calculateRecipeCost(
                                { id: `${menuItem.guid}_di`, toast_menu_item_guid: menuItem.guid, ingredients: cogsDineInIngs } as Recipe,
                                invList,
                                undefined,
                                invItemMap
                            )
                            cogsDineIn = res.packagingCost
                            missingPrices += res.missingPrices
                        }
                        if (cogsTakeoutIngs.length > 0) {
                            const res = calculateRecipeCost(
                                { id: `${menuItem.guid}_to`, toast_menu_item_guid: menuItem.guid, ingredients: cogsTakeoutIngs } as Recipe,
                                invList,
                                undefined,
                                invItemMap
                            )
                            cogsTakeout = res.packagingCost
                            missingPrices += res.missingPrices
                        }
                        if (cogsDeliveryIngs.length > 0) {
                            const res = calculateRecipeCost(
                                { id: `${menuItem.guid}_del`, toast_menu_item_guid: menuItem.guid, ingredients: cogsDeliveryIngs } as Recipe,
                                invList,
                                undefined,
                                invItemMap
                            )
                            cogsDelivery = res.packagingCost
                            missingPrices += res.missingPrices
                        }
                        packagingCost = Number(Math.max(cogsDineIn, cogsTakeout, cogsDelivery).toFixed(4))
                    }

                    const price = Number(menuItem.price) || 0
                    if (price > 0 && foodCost > 0) {
                        foodCostPercent = Number(((foodCost / price) * 100).toFixed(2))
                    }
                    if (price > 0 && packagingCost > 0) {
                        packagingPercent = Number(((packagingCost / price) * 100).toFixed(2))
                    }
                    if (price > 0 && (foodCost > 0 || packagingCost > 0)) {
                        margin = Number((price - foodCost).toFixed(4))
                    }

                    return {
                        ...menuItem,
                        hasRecipe,
                        foodCost,
                        theoreticalCost: foodCost,
                        packagingCost,
                        cogsDineIn,
                        cogsTakeout,
                        cogsDelivery,
                        foodCostPercent,
                        packagingPercent,
                        margin,
                        missingPrices,
                        ingredientsCount: foodIngredients.length,
                        breakdown
                    }
                })

                report.sort((a: any, b: any) => b.foodCostPercent - a.foodCostPercent)

                const built = {
                    data: report,
                    meta: {
                        totalItems: report.length,
                        itemsWithRecipe: report.filter((i: any) => i.hasRecipe).length,
                        missingPricesCount: report.filter((i: any) => i.missingPrices > 0).length
                    }
                }
                costsResponseCache = { expiresAt: Date.now() + COSTS_CACHE_TTL_MS, payload: built }
                return built
            })()
            if (!bypassCache) costsInFlight = loader
        }

        let payload: any
        try {
            payload = await loader
        } finally {
            if (costsInFlight === loader) costsInFlight = null
        }

        return NextResponse.json(payload, {
            headers: { 'Cache-Control': 'private, max-age=120' },
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
