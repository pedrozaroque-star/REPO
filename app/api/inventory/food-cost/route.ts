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
 *   - [2026-11-23] FIX CRÍTICO (`food-cost-sales-resolver`): Para el día en curso (intraday), `net_sales` usa el mismo
 *     snapshot vivo de Toast PMIX (evitando desfase 10-20 min contra `sales_daily_cache` que inflaba Downey a 41.8%
 *     y Santa Ana a 41.2%, y eliminando sobrescritura en `$0` que dejaba LA Central en `0.0%`). Para días cerrados
 *     usa `sales_daily_cache` únicamente si `> 0`.
 *   - [2026-11-23] Separación estricta de `food_cost` (materia prima pura) vs `packaging_cost` (empaques/desechables
 *     filtrados por canal `item.group_name`: `cogs_dine_in`, `cogs_takeout`, `cogs_delivery`), preservando `total_cost = food_cost`
 *     y exponiendo `total_cogs = food_cost + packaging_cost`, `meat_cost`, `asada_raw_lbs` y `asada_cost`.
 *   - [2026-11-23] Paginación determinista `fetchAllRows` (`.range()`) en `recipes`, `inventory_items`,
 *     `inventory_price_history`, `toast_menu_items` y `sales_daily_cache` para eliminar truncamientos silenciosos de 1,000 filas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { calculateRecipeCost } from '@/lib/inventory/costs'
import { normalizeToLbs } from '@/lib/inventory/conversions'
import { buildPartyTrayVirtualIngredients, isPartyTrayMenuItem } from '@/lib/inventory/party-tray-guidelines'
import { ACTIVE_PROTEIN_IDS, detectNonGrillSideProteinKind, parseProteinAllocation } from '@/lib/inventory/meat-allocation'
import {
    addDaysIso,
    buildLAInstant,
    calculateSafeFoodCostPct,
    calculateSafePackagingCostPct,
    FOOD_COST_MAX_RANGE_ALL_STORES_DAYS,
    FOOD_COST_MAX_RANGE_FOOD_COST_SINGLE_DAYS,
    getBusinessDateLA,
    resolveFoodCostNetSales,
    validateDateRangeWithinMaxDays,
} from '@/lib/inventory/food-cost-sales-resolver'
import { Recipe, InventoryItem } from '@/types/inventory'
import { verifyStaffAuth } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ASADA_ITEM_ID = ACTIVE_PROTEIN_IDS.asada

interface FoodCostStaticCatalog {
    expiresAt: number
    recipesData: any[]
    inventoryData: any[]
    allMenuItems: { guid: string; name: string }[]
}

const FOOD_COST_CATALOG_TTL_MS = 5 * 60 * 1000
const FOOD_COST_RESPONSE_TTL_CLOSED_MS = 3 * 60 * 1000
const FOOD_COST_RESPONSE_TTL_LIVE_MS = 45 * 1000
const FOOD_COST_RESPONSE_MAX_CACHE = 12

let foodCostCatalogCache: FoodCostStaticCatalog | null = null
let foodCostCatalogInFlight: Promise<FoodCostStaticCatalog> | null = null
const foodCostResponseCache = new Map<string, { expiresAt: number; payload: { data: any[]; salesNetSales: Record<string, number> } }>()
const foodCostInFlight = new Map<string, Promise<{ data: any[]; salesNetSales: Record<string, number> }>>()

function setFoodCostCacheBounded(key: string, ttlMs: number, payload: { data: any[]; salesNetSales: Record<string, number> }) {
    if (foodCostResponseCache.size >= FOOD_COST_RESPONSE_MAX_CACHE) {
        const firstKey = foodCostResponseCache.keys().next().value
        if (firstKey !== undefined) foodCostResponseCache.delete(firstKey)
    }
    foodCostResponseCache.set(key, { expiresAt: Date.now() + ttlMs, payload })
}

async function fetchAllRows<T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    pageSize = 1000,
    maxPages = 50
): Promise<T[]> {
    const all: T[] = []
    for (let page = 0; page < maxPages; page++) {
        const offset = page * pageSize
        const { data, error } = await buildQuery(offset, offset + pageSize - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < pageSize) break
    }
    return all
}

async function getFoodCostStaticCatalog(supabase: any): Promise<FoodCostStaticCatalog> {
    if (foodCostCatalogCache && foodCostCatalogCache.expiresAt > Date.now()) {
        return foodCostCatalogCache
    }
    if (foodCostCatalogInFlight) {
        return foodCostCatalogInFlight
    }
    const loader = (async () => {
        const [recipesData, inventoryData, allMenuItems] = await Promise.all([
            fetchAllRows<any>((from, to) =>
                supabase
                    .from('recipes')
                    .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
            fetchAllRows<any>((from, to) =>
                supabase
                    .from('inventory_items')
                    .select('id, sku, name, unit_type, unit_measure, quantity_per_unit, purchase_unit_cost, yield_percent, is_bodega')
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
            fetchAllRows<{ guid: string; name: string }>((from, to) =>
                supabase
                    .from('toast_menu_items')
                    .select('guid, name')
                    .order('guid', { ascending: true })
                    .range(from, to)
            ),
        ])
        const built: FoodCostStaticCatalog = {
            expiresAt: Date.now() + FOOD_COST_CATALOG_TTL_MS,
            recipesData,
            inventoryData,
            allMenuItems,
        }
        foodCostCatalogCache = built
        return built
    })()
    foodCostCatalogInFlight = loader
    try {
        return await loader
    } finally {
        if (foodCostCatalogInFlight === loader) {
            foodCostCatalogInFlight = null
        }
    }
}

export async function GET(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowCron: true })
    if (!auth.authorized) return auth.response!

    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = (searchParams.get('storeId') || '').trim()
        const startDate = (searchParams.get('startDate') || '').trim()
        const endDate = (searchParams.get('endDate') || '').trim()

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400 })
        }

        const maxAllowedDays =
            storeId === 'all' ? FOOD_COST_MAX_RANGE_ALL_STORES_DAYS : FOOD_COST_MAX_RANGE_FOOD_COST_SINGLE_DAYS
        const rangeCheck = validateDateRangeWithinMaxDays(startDate, endDate, maxAllowedDays)
        if (!rangeCheck.ok) {
            return NextResponse.json(
                {
                    error: `${rangeCheck.error} Para consultas históricas mayores a ${maxAllowedDays} días utiliza /api/inventory/food-cost-cache.`,
                },
                { status: 400 }
            )
        }

        const todayBusinessDateLA = getBusinessDateLA()
        const isLiveRange = endDate >= todayBusinessDateLA
        const isCronBypass =
            Boolean(request.headers.get('x-vercel-cron')) ||
            searchParams.get('bypassCache') === '1'
        const responseCacheKey = `${storeId}|${startDate}|${endDate}`

        if (!isCronBypass) {
            const cachedResp = foodCostResponseCache.get(responseCacheKey)
            if (cachedResp && cachedResp.expiresAt > Date.now()) {
                return NextResponse.json(cachedResp.payload, {
                    headers: {
                        'Cache-Control': isLiveRange ? 'no-store' : 'private, max-age=180',
                    },
                })
            }
            const existingInFlight = foodCostInFlight.get(responseCacheKey)
            if (existingInFlight) {
                const sharedPayload = await existingInFlight
                return NextResponse.json(sharedPayload, {
                    headers: {
                        'Cache-Control': isLiveRange ? 'no-store' : 'private, max-age=180',
                    },
                })
            }
        }

        const computePromise = computeFoodCostReport({
            storeId,
            startDate,
            endDate,
            todayBusinessDateLA,
            isLiveRange,
        })
        if (!isCronBypass) {
            foodCostInFlight.set(responseCacheKey, computePromise)
        }

        let payload: { data: any[]; salesNetSales: Record<string, number> }
        try {
            payload = await computePromise
            if (!isCronBypass) {
                setFoodCostCacheBounded(
                    responseCacheKey,
                    isLiveRange ? FOOD_COST_RESPONSE_TTL_LIVE_MS : FOOD_COST_RESPONSE_TTL_CLOSED_MS,
                    payload
                )
            }
        } finally {
            if (!isCronBypass && foodCostInFlight.get(responseCacheKey) === computePromise) {
                foodCostInFlight.delete(responseCacheKey)
            }
        }

        return NextResponse.json(payload, {
            headers: {
                'Cache-Control': isLiveRange ? 'no-store' : 'private, max-age=180',
            },
        })
    } catch (e: any) {
        console.error('Food Cost API Error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

async function computeFoodCostReport(params: {
    storeId: string
    startDate: string
    endDate: string
    todayBusinessDateLA: string
    isLiveRange: boolean
}): Promise<{ data: any[]; salesNetSales: Record<string, number> }> {
        const { storeId, startDate, endDate, todayBusinessDateLA, isLiveRange } = params
        const supabase = await getSupabaseAdminClient()

        // 1. Fetch Product Mix (Sales) from Toast
        // This gives us: guid, name, quantity, net_sales
        let pmixItems: any[] = []
        const failedStoreIds = new Set<string>()
        const succeededStoreIds = new Set<string>()

        console.log(`[FoodCostAPI] Request storeId=${storeId}, start=${startDate}, end=${endDate}`)

        if (storeId === 'all') {
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
            // Concurrencia acotada (2 tiendas a la vez) para proteger Supabase ci_small y límites 429 de Toast
            const STORE_CONCURRENCY = 2
            const results: any[] = []

            for (let i = 0; i < validStores.length; i += STORE_CONCURRENCY) {
                const batch = validStores.slice(i, i + STORE_CONCURRENCY)
                console.log(`[FoodCostAPI] Fetching stores batch ${Math.floor(i / STORE_CONCURRENCY) + 1}...`)
                const batchResults = await Promise.all(
                    batch.map(async (s) => {
                        try {
                            const items = await getProductMix({ storeId: s.external_id, startDate, endDate, bundleModifiers: true })
                            succeededStoreIds.add(s.external_id)
                            return items.map(item => ({
                                ...item,
                                store_id: s.external_id,
                                store_name: s.name || 'Unknown'
                            }))
                        } catch (err) {
                            failedStoreIds.add(s.external_id)
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
                    existing.modifier_gross_sales = (existing.modifier_gross_sales || 0) + (item.modifier_gross_sales || 0)
                    existing.half_meat_adjustments = (existing.half_meat_adjustments || 0) + (item.half_meat_adjustments || 0)

                    // Merge modifiers safely without spread stack overflow
                    if (item.modifier_guids && item.modifier_guids.length > 0) {
                        if (!existing.modifier_guids) existing.modifier_guids = []
                        for (let mIdx = 0; mIdx < item.modifier_guids.length; mIdx++) {
                            existing.modifier_guids.push(item.modifier_guids[mIdx])
                        }
                    }
                }
            })

            pmixItems = Array.from(aggMap.values()).map(item => ({
                ...item,
                unit_price: item.quantity > 0 ? item.gross_sales / item.quantity : 0
            }))

        } else {
            // Single store fetch (acepta tanto UUID external_id como ID numérico de stores)
            let resolvedStoreGuid = storeId
            let resolvedStoreName = 'Unknown'
            if (/^\d+$/.test(storeId)) {
                const currentStore = await supabase.from('stores').select('name, external_id').eq('id', Number(storeId)).maybeSingle()
                if (currentStore.data?.external_id) resolvedStoreGuid = currentStore.data.external_id
                if (currentStore.data?.name) resolvedStoreName = currentStore.data.name
            } else {
                const currentStore = await supabase.from('stores').select('name').eq('external_id', storeId).maybeSingle()
                if (currentStore.data?.name) resolvedStoreName = currentStore.data.name
            }
            pmixItems = await getProductMix({ storeId: resolvedStoreGuid, startDate, endDate, bundleModifiers: true })
            succeededStoreIds.add(resolvedStoreGuid)
            pmixItems = pmixItems.map(item => ({
                ...item,
                store_id: resolvedStoreGuid,
                store_name: resolvedStoreName
            }))
        }

        // 2. Cargar catálogos estáticos desde caché TTL (5 min) + historial de precios indexado
        const staticCatalog = await getFoodCostStaticCatalog(supabase)
        const recipesData = staticCatalog.recipesData
        let inventoryData = staticCatalog.inventoryData
        const allMenuItems = staticCatalog.allMenuItems

        // --- SCENARIO B: HISTORICAL PRICES O "LA MÁQUINA DEL TIEMPO" ---
        // Buscamos cuál era el precio de los insumos al cierre laboral oficial (05:59 AM LA del día siguiente a endDate)
        const targetDate = buildLAInstant(addDaysIso(endDate, 1), 5, 59).toISOString()
        const historyData = await fetchAllRows<any>((from, to) =>
            supabase
                .from('inventory_price_history')
                .select('inventory_item_id, purchase_unit_cost, quantity_per_unit, effective_date')
                .lte('effective_date', targetDate)
                .order('effective_date', { ascending: false })
                .order('id', { ascending: false })
                .range(from, to)
        )

        if (historyData.length > 0 && inventoryData.length > 0) {
            const latestValidPrices = new Map<string, { price: number; qty?: number }>()
            historyData.forEach(h => {
                // Al estar ordenado Descendente, el primer registro positivo que leamos es el vigente en la fecha
                const priceNum = Number(h.purchase_unit_cost)
                if (!latestValidPrices.has(h.inventory_item_id) && Number.isFinite(priceNum) && priceNum > 0) {
                    latestValidPrices.set(h.inventory_item_id, {
                        price: priceNum,
                        qty: h.quantity_per_unit && Number(h.quantity_per_unit) > 0 ? Number(h.quantity_per_unit) : undefined
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
            console.log(`[FoodCostAPI] 🕰️ Historical Pricing & Packaging Applied for date: ${targetDate} (${historyData.length} history rows scanned)`)
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

        // 3b. Build NAME-based fallback map & prebuilt InventoryItem Map (evita reconstruir 15,000 Maps en calculateRecipeCost)
        const nameToRecipeMap = new Map<string, Recipe>()
        const inventoryItemMap = new Map<string, InventoryItem>(
            (inventoryData as InventoryItem[]).map((item) => [item.id, item])
        )
        const menuItemNameByGuid = new Map<string, string>(
            allMenuItems.map((mi) => [mi.guid, mi.name])
        )

        if (allMenuItems.length > 0) {
            allMenuItems.forEach((mi) => {
                if (!mi.name || !recipeMap.has(mi.guid)) return
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
                const unitPrice = (item.unit_price && item.unit_price > 0)
                    ? item.unit_price
                    : ((item.price && item.price > 0)
                        ? item.price
                        : ((item.quantity && item.quantity > 0) ? (item.net_sales / item.quantity) : 0));
                const groupLower = String(item.group_name || '').toLowerCase()
                const isDeliveryGroup = groupLower.includes('uber') || groupLower.includes('door') || groupLower.includes('grub') || groupLower.includes('delivery') || groupLower.includes('3rd party')
                const ptModTexts = Array.isArray(item.modifier_guids)
                    ? item.modifier_guids
                          .map((mg: string) => menuItemNameByGuid.get(mg) || '')
                          .filter(Boolean)
                    : []
                const virtualParty = buildPartyTrayVirtualIngredients({
                    itemName: item.name,
                    unitPrice,
                    toastGuid: item.guid,
                    isDeliveryChannel: isDeliveryGroup,
                    modifierTexts: ptModTexts,
                    inventoryItems: (inventoryData || []) as InventoryItem[],
                })

                recipe = {
                    id: 'virtual-party-tray',
                    toast_menu_item_guid: item.guid,
                    ingredients: virtualParty.ingredients
                };
                skipModCostCalculation = true;
                console.log(`[FoodCostAPI] 🛠️ Virtual Recipe Generated for Party Tray (${virtualParty.size}): "${item.name}"`)
            }

            // Canonical 8 active protein inventory IDs & dining channel for packaging filter
            const activeProteinIds = new Set<string>(Object.values(ACTIVE_PROTEIN_IDS))
            const mainMeatIds = Array.from(activeProteinIds)
            const channelName = item.group_name || 'To Go'

            let baseUnitFoodCost = 0
            let baseUnitPackagingCost = 0
            let unitCost = 0
            let unitPackagingCost = 0
            let missingPrices = 0
            let meatLbsPerUnit = 0
            let meatCostPerUnit = 0
            let asadaLbsPerUnit = 0
            let asadaCostPerUnit = 0

            const proteinAllocation = !isPartyTray && recipe ? parseProteinAllocation(item.name, recipe.ingredients) : null
            const nonGrillSideKind = !isPartyTray && /side\s*(?:order\s*)?carne/i.test(item.name)
                ? detectNonGrillSideProteinKind(item.name)
                : null
            const nonGrillSideExtraIngredients =
                nonGrillSideKind === 'milanesa'
                    ? [{ inventory_item_id: '5c59d80c-7d7b-45f9-997c-57540127d3a8', quantity: 3, unit: 'pza', type: 'food' }]
                    : nonGrillSideKind === 'salchicha'
                        ? [{ inventory_item_id: 'cac598b2-9c18-4055-8f2e-16de22d78535', quantity: 2.3, unit: 'oz', type: 'food' }]
                        : nonGrillSideKind === 'jamon'
                            ? [{ inventory_item_id: '5a962d06-d162-425e-a942-c7ad6dab663d', quantity: 4.2, unit: 'oz', type: 'food' }]
                            : []
            const primaryProteinIngredient = recipe?.ingredients.find(ingredient => activeProteinIds.has(ingredient.inventory_item_id))
            const recipeForCost = proteinAllocation && recipe
                ? {
                    ...recipe,
                    ingredients: [
                        ...recipe.ingredients.filter(ingredient => !activeProteinIds.has(ingredient.inventory_item_id)),
                        ...Array.from(proteinAllocation.portionsOz.entries()).map(([inventory_item_id, quantity]) => ({
                            inventory_item_id, quantity, unit: 'oz', type: primaryProteinIngredient?.type || 'cooked'
                        })),
                        ...nonGrillSideExtraIngredients,
                    ]
                }
                : recipe as Recipe | undefined

            // 1. Calculate base recipe unit cost (both foodCost and channel-filtered packagingCost)
            if (recipeForCost) {
                const costResult = calculateRecipeCost(recipeForCost as Recipe, inventoryData as InventoryItem[], channelName, inventoryItemMap)
                baseUnitFoodCost = costResult.foodCost
                baseUnitPackagingCost = costResult.packagingCost
                missingPrices += costResult.missingPrices

                costResult.breakdown.forEach(b => {
                    if (activeProteinIds.has(b.inventoryItemId)) {
                        const rawLbs = normalizeToLbs(b.quantity, b.unit as any)
                        meatLbsPerUnit += rawLbs
                        meatCostPerUnit += b.cost
                        if (b.inventoryItemId === ASADA_ITEM_ID) {
                            asadaLbsPerUnit += rawLbs
                            asadaCostPerUnit += b.cost
                        }
                    }
                })
            }

            let totalBaseFoodCost = baseUnitFoodCost * item.quantity
            let totalBasePackagingCost = baseUnitPackagingCost * item.quantity
            let totalBaseMeatLbs = meatLbsPerUnit * item.quantity
            let totalBaseMeatCost = meatCostPerUnit * item.quantity
            let totalBaseAsadaLbs = asadaLbsPerUnit * item.quantity
            let totalBaseAsadaCost = asadaCostPerUnit * item.quantity

            let totalModFoodCost = 0
            let totalModPackagingCost = 0
            let totalModMeatLbs = 0
            let totalModMeatCost = 0
            let totalModAsadaLbs = 0
            let totalModAsadaCost = 0

            // 2. Apply legacy "Half Meat" substitutions directly to the BATCH TOTALS when proteinAllocation is null
            if (!proteinAllocation && recipe && item.modifier_guids && item.modifier_guids.length > 0) {
                const halfMapping: Record<string, string> = {
                    'ed889228-98e7-4c49-bc46-8e0718ec1fcf': ACTIVE_PROTEIN_IDS.asada,    // Half Asada (In Store)
                    'b52ffce5-cc66-4930-bb96-70891c41643e': ACTIVE_PROTEIN_IDS.buche,    // Half Buche (In Store)
                    'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3': ACTIVE_PROTEIN_IDS.cabeza,   // Half Cabeza (In Store)
                    '443938bb-ec20-4a64-9fa3-91d4f89de0a5': ACTIVE_PROTEIN_IDS.carnitas, // Half Carnitas (In Store)
                    '6d1bfd79-8c97-4c81-8e03-729fa08ecc75': ACTIVE_PROTEIN_IDS.chorizo,  // Half Chorizo (In Store)
                    'fbe42d67-a0f8-481f-bb28-e1717075c290': ACTIVE_PROTEIN_IDS.lengua,   // Half Lengua (In Store)
                    '8717b04b-62c0-4276-96e9-d86430b32b64': ACTIVE_PROTEIN_IDS.pastor,   // Half Pastor (In Store)
                    '37c0cb59-fa76-4b81-b327-cd96784d9f78': ACTIVE_PROTEIN_IDS.pollo,    // Half Pollo (In Store)
                }
                const halfModsFound = item.modifier_guids.filter((g: string) => g in halfMapping)

                if (halfModsFound.length > 0) {
                    const primaryMeatIng = recipe.ingredients.find((i: any) => mainMeatIds.includes(i.inventory_item_id))

                    if (primaryMeatIng) {
                        const deltaRecipe = { ingredients: [] as any[] }
                        const portionsToRemove = halfModsFound.length * 0.5
                        deltaRecipe.ingredients.push({
                            ...primaryMeatIng,
                            quantity: -(primaryMeatIng.quantity * portionsToRemove)
                        })

                        halfModsFound.forEach((modGuid: string) => {
                            deltaRecipe.ingredients.push({
                                inventory_item_id: halfMapping[modGuid],
                                quantity: primaryMeatIng.quantity * 0.5,
                                unit: primaryMeatIng.unit,
                                type: primaryMeatIng.type
                            })
                        })

                        const deltaRes = calculateRecipeCost(deltaRecipe as any, inventoryData as InventoryItem[], channelName, inventoryItemMap)
                        totalBaseFoodCost += deltaRes.foodCost
                        totalBasePackagingCost += deltaRes.packagingCost

                        deltaRes.breakdown.forEach(b => {
                            if (activeProteinIds.has(b.inventoryItemId)) {
                                const rawLbs = normalizeToLbs(b.quantity, b.unit as any)
                                totalBaseMeatLbs += rawLbs
                                totalBaseMeatCost += b.cost
                                if (b.inventoryItemId === ASADA_ITEM_ID) {
                                    totalBaseAsadaLbs += rawLbs
                                    totalBaseAsadaCost += b.cost
                                }
                            }
                        })
                    }
                }
            }

            // 3. Calculate Modifiers Cost (capturing BOTH foodCost and channel-filtered packagingCost)
            if (!skipModCostCalculation && item.modifier_guids && item.modifier_guids.length > 0) {
                const halfGuids = new Set([
                    'ed889228-98e7-4c49-bc46-8e0718ec1fcf', 'b52ffce5-cc66-4930-bb96-70891c41643e',
                    'ac491d8e-07a9-4d1d-b8dc-9b4bbe2c0ed3', '443938bb-ec20-4a64-9fa3-91d4f89de0a5',
                    '6d1bfd79-8c97-4c81-8e03-729fa08ecc75', 'fbe42d67-a0f8-481f-bb28-e1717075c290',
                    '8717b04b-62c0-4276-96e9-d86430b32b64', '37c0cb59-fa76-4b81-b327-cd96784d9f78'
                ])

                const isTacoPlateItem = /^\s*taco\s*plate\b/i.test(item.name)
                const subTacoGuids = new Set([
                    '6141b8b8-8707-4632-a837-81cfccffc0e6', // Taco Asada
                    'a29735c2-48a6-4f65-86c1-e2f27614f718', // Taco Pastor
                    '87bbf158-caf5-4d15-b747-d8af3185c802', // Taco Pollo
                    '2073726e-5ec6-417d-a6d2-ae367e663c04', // Taco Cabeza
                    '24d8b7d3-a261-42a3-bdbb-d44345d51548', // Taco Lengua
                    'f6c84203-de05-485b-b1db-c80ff297d211', // Taco Chorizo
                    '51886888-6e37-477b-8147-9741c7145d0b', // Taco Carnitas
                    'f97a828f-18d0-48aa-ad0d-2b26d0ff59a1', // Taco Buche
                    '7b591175-fa2c-455a-83cf-2627cd11fcad', // Taco Vegetariano
                ])

                const modCounts = new Map<string, number>()
                item.modifier_guids.forEach((g: string) => modCounts.set(g, (modCounts.get(g) || 0) + 1))

                // Para Taco Plate, si Toast pre-escaló `m.quantity` (ej. 15 guids para qty=3), normalizar a exactamente `3 * item.quantity` sub-tacos totales
                const totalRawSubTacoCount = isTacoPlateItem
                    ? Array.from(modCounts.entries())
                          .filter(([g]) => subTacoGuids.has(g))
                          .reduce((acc, [, c]) => acc + c, 0)
                    : 0
                const subTacoScale =
                    isTacoPlateItem && totalRawSubTacoCount > item.quantity * 3 && totalRawSubTacoCount > 0
                        ? (item.quantity * 3) / totalRawSubTacoCount
                        : 1

                const normalizedModGuids: Array<{ guid: string; weight: number; isSubTaco: boolean }> = []
                modCounts.forEach((count, guid) => {
                    const isSubTaco = isTacoPlateItem && subTacoGuids.has(guid)
                    if (isSubTaco) {
                        normalizedModGuids.push({ guid, weight: count * subTacoScale, isSubTaco: true })
                    } else {
                        const capped = Math.min(count, item.quantity)
                        if (capped > 0) {
                            normalizedModGuids.push({ guid, weight: capped, isSubTaco: false })
                        }
                    }
                })

                normalizedModGuids.forEach(({ guid: modGuid, weight, isSubTaco }) => {
                    const modRecipe = recipeMap.get(modGuid)
                    if (modRecipe) {
                        const isProteinModifier = !!proteinAllocation && modRecipe.ingredients.some(ingredient => activeProteinIds.has(ingredient.inventory_item_id))
                        if (!halfGuids.has(modGuid) && !isProteinModifier) {
                            const modRes = calculateRecipeCost(modRecipe, inventoryData as InventoryItem[], channelName, inventoryItemMap)
                            totalModFoodCost += modRes.foodCost * weight
                            if (!isSubTaco) {
                                totalModPackagingCost += modRes.packagingCost * weight
                            }
                            missingPrices += modRes.missingPrices

                            modRes.breakdown.forEach(b => {
                                if (activeProteinIds.has(b.inventoryItemId)) {
                                    const rawLbs = normalizeToLbs(b.quantity, b.unit as any) * weight
                                    totalModMeatLbs += rawLbs
                                    totalModMeatCost += b.cost * weight
                                    if (b.inventoryItemId === ASADA_ITEM_ID) {
                                        totalModAsadaLbs += rawLbs
                                        totalModAsadaCost += b.cost * weight
                                    }
                                }
                            })
                        }
                    }
                })
            }

            // 3b. Taco Plate sub-taco fallback when Toast modifier GUIDs for sub-tacos are not in `recipes`
            if (!skipModCostCalculation && /^\s*taco\s*plate\b/i.test(item.name) && totalModMeatLbs === 0 && item.quantity > 0) {
                const parenTokens: string[] = []
                for (const m of item.name.matchAll(/\(([^)]+)\)/g)) {
                    m[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean).forEach((tok: string) => parenTokens.push(tok))
                }
                const tacoTokens = parenTokens.filter(tok => /^taco\s+(asada|pastor|pollo|chicken|cabeza|lengua|chorizo|carnitas|buche|vegetar\w*|veggie|vegie)$/i.test(tok))
                const slotMultiplier = tacoTokens.length > 0 && tacoTokens.length < 3 ? (3 / tacoTokens.length) : 1
                tacoTokens.forEach(tok => {
                    const normalizedTok = tok.replace(/\bchicken\b/i, 'pollo')
                    const subTacoRecipe = nameToRecipeMap.get(normalizedTok)
                    if (subTacoRecipe) {
                        const foodOnlySubRecipe: Recipe = {
                            ...subTacoRecipe,
                            ingredients: subTacoRecipe.ingredients.filter(ing => {
                                const t = ing.type || 'cooked'
                                return t === 'food' || t === 'raw' || t === 'cooked'
                            })
                        }
                        const subRes = calculateRecipeCost(foodOnlySubRecipe, inventoryData as InventoryItem[], channelName, inventoryItemMap)
                        const effectiveTacoQty = item.quantity * slotMultiplier
                        totalModFoodCost += subRes.foodCost * effectiveTacoQty
                        missingPrices += subRes.missingPrices
                        subRes.breakdown.forEach(b => {
                            if (activeProteinIds.has(b.inventoryItemId)) {
                                const rawLbs = normalizeToLbs(b.quantity, b.unit as any) * effectiveTacoQty
                                totalModMeatLbs += rawLbs
                                totalModMeatCost += b.cost * effectiveTacoQty
                                if (b.inventoryItemId === ASADA_ITEM_ID) {
                                    totalModAsadaLbs += rawLbs
                                    totalModAsadaCost += b.cost * effectiveTacoQty
                                }
                            }
                        })
                    }
                })
            }

            const foodCost = Number((totalBaseFoodCost + totalModFoodCost).toFixed(4))
            const packagingCost = Number((totalBasePackagingCost + totalModPackagingCost).toFixed(4))
            const totalCost = foodCost // Preserves pure Food Cost semantics on total_cost & food_cost_percent
            const totalCogs = Number((foodCost + packagingCost).toFixed(4))
            const meatCost = Number((totalBaseMeatCost + totalModMeatCost).toFixed(4))
            const totalMeatLbs = Number((totalBaseMeatLbs + totalModMeatLbs).toFixed(4))
            const asadaRawLbs = Number((totalBaseAsadaLbs + totalModAsadaLbs).toFixed(4))
            const asadaCost = Number((totalBaseAsadaCost + totalModAsadaCost).toFixed(4))

            if (item.quantity > 0) {
                unitCost = totalCost / item.quantity
                unitPackagingCost = packagingCost / item.quantity
            }

            const fcPercent = (item.net_sales > 0) ? (totalCost / item.net_sales) * 100 : 0
            const packagingCostPercent = (item.net_sales > 0) ? (packagingCost / item.net_sales) * 100 : 0
            const totalCogsPercent = (item.net_sales > 0) ? (totalCogs / item.net_sales) * 100 : 0

            const modRevenuePerUnit = item.quantity > 0 ? (item.modifier_gross_sales / item.quantity) : 0
            const basePricePerUnit = item.quantity > 0 ? (item.gross_sales / item.quantity) : 0

            return {
                ...item,
                unit_price: basePricePerUnit,
                total_modifier_cost: modRevenuePerUnit,
                unit_cost: unitCost,
                unit_packaging_cost: unitPackagingCost,
                food_cost: foodCost,
                packaging_cost: packagingCost,
                total_cost: totalCost,
                total_cogs: totalCogs,
                food_cost_percent: fcPercent,
                packaging_cost_percent: packagingCostPercent,
                total_cogs_percent: totalCogsPercent,
                meat_cost: meatCost,
                total_meat_lbs: totalMeatLbs,
                asada_raw_lbs: asadaRawLbs,
                asada_cost: asadaCost,
                has_recipe: !!recipe,
                matched_by_name: matchedByName,
                missing_prices: missingPrices > 0,
                store_id: item.store_id,
                store_name: item.store_name,
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
        // Fetch authoritative net_sales from sales_daily_cache for CLOSED days (exact parity with Ventas).
        // Omitimos consultar sales_daily_cache cuando `isLiveRange && startDate !== endDate` porque no se usa.
        const shouldWriteSingleDayCache = startDate === endDate && (!storeId || storeId === 'all')
        const shouldFetchSalesCache = !isLiveRange || shouldWriteSingleDayCache
        let salesNetSalesMap: Map<string, number> | null = null
        try {
            if (shouldFetchSalesCache) {
                const salesRows = await fetchAllRows<{ store_id: string; net_sales: number }>((from, to) => {
                    let q = supabase
                        .from('sales_daily_cache')
                        .select('store_id, net_sales')
                        .gte('business_date', startDate)
                        .lte('business_date', endDate)
                        .order('business_date', { ascending: true })
                        .order('store_id', { ascending: true })
                        .range(from, to)
                    if (storeId && storeId !== 'all' && succeededStoreIds.size === 1) {
                        const [singleGuid] = Array.from(succeededStoreIds)
                        q = q.eq('store_id', singleGuid)
                    }
                    return q
                })

                salesNetSalesMap = new Map<string, number>()
                salesRows.forEach((r: any) => {
                    const current = salesNetSalesMap!.get(r.store_id) || 0
                    salesNetSalesMap!.set(r.store_id, current + (Number(r.net_sales) || 0))
                })
            }

            // Write-through cache ONLY for single-day requests across ALL stores
            // Prevents partial cache poisoning when querying an individual store or when a store's Toast fetch failed
            if (shouldWriteSingleDayCache) {
                const storeAgg = new Map<string, any>()
                report.forEach(item => {
                    const sid = item.store_id || 'unknown'
                    if (sid === 'unknown' || failedStoreIds.has(sid)) return

                    if (!storeAgg.has(sid)) {
                        storeAgg.set(sid, {
                            business_date: startDate,
                            store_id: sid,
                            store_name: item.store_name || 'Unknown',
                            food_cost: 0,
                            packaging_cost: 0,
                            net_sales: 0,
                            total_items: 0,
                            items_with_recipe: 0,
                            total_meat_lbs: 0,
                            meat_cost: 0,
                            asada_raw_lbs: 0,
                            asada_cost: 0,
                            unmapped_sales: 0,
                        })
                    }
                    const agg = storeAgg.get(sid)
                    agg.food_cost += item.food_cost || 0
                    agg.packaging_cost += item.packaging_cost || 0
                    agg.net_sales += item.net_sales || 0
                    agg.total_items += 1
                    if (item.has_recipe) {
                        agg.items_with_recipe += 1
                    } else if ((item.net_sales || 0) > 0) {
                        agg.unmapped_sales += item.net_sales || 0
                    }
                    agg.total_meat_lbs += item.total_meat_lbs || 0
                    agg.meat_cost += item.meat_cost || 0
                    agg.asada_raw_lbs += item.asada_raw_lbs || 0
                    agg.asada_cost += item.asada_cost || 0
                })

                // Resolve net_sales deterministically & skip stores with 0 items / failed Toast fetch
                const cacheRows = Array.from(storeAgg.values())
                    .filter(s => !failedStoreIds.has(s.store_id) && s.total_items > 0)
                    .map(s => {
                        const authoritativeSales = salesNetSalesMap?.get(s.store_id)
                        const resolved = resolveFoodCostNetSales({
                            startDate,
                            endDate,
                            pmixNetSales: s.net_sales,
                            cachedDailySales: authoritativeSales,
                            todayBusinessDateLA,
                        })
                        const storeFoodCost = Number(s.food_cost.toFixed(2))
                        const storePackagingCost = Number(s.packaging_cost.toFixed(2))
                        return {
                            business_date: startDate,
                            store_id: s.store_id,
                            store_name: s.store_name,
                            total_cost: storeFoodCost,
                            food_cost: storeFoodCost,
                            packaging_cost: storePackagingCost,
                            net_sales: resolved.netSales,
                            cost_percentage: calculateSafeFoodCostPct(storeFoodCost, resolved.netSales),
                            packaging_percentage: calculateSafePackagingCostPct(storePackagingCost, resolved.netSales),
                            total_items: s.total_items,
                            items_with_recipe: s.items_with_recipe,
                            total_meat_lbs: Number(s.total_meat_lbs.toFixed(2)),
                            meat_cost: Number(s.meat_cost.toFixed(2)),
                            asada_raw_lbs: Number(s.asada_raw_lbs.toFixed(2)),
                            asada_cost: Number(s.asada_cost.toFixed(2)),
                            unmapped_sales: Number(s.unmapped_sales.toFixed(2)),
                            updated_at: new Date().toISOString()
                        }
                    })
                    .filter(row => row.net_sales > 0 || row.food_cost > 0)

                if (cacheRows.length > 0) {
                    const { error: cacheError } = await supabase
                        .from('food_cost_daily_cache')
                        .upsert(cacheRows, { onConflict: 'business_date, store_id' })

                    if (cacheError) {
                        console.warn('[FoodCostAPI] ⚠️ Cache write failed:', cacheError.message)
                    } else {
                        console.log(`[FoodCostAPI] 📦 Cached ${cacheRows.length} store aggregates for ${startDate} (failed=${failedStoreIds.size}, mode=${isLiveRange ? 'pmix_intraday' : 'closed_authoritative'})`)
                    }
                }
            }
        } catch (err: any) {
            console.warn('[FoodCostAPI] Authoritative sales fetch error:', err.message)
        }
        // ═══ END WRITE-THROUGH CACHE ═══

        // Include authoritative sales overrides ONLY for closed historical ranges and strictly positive values
        // For live intraday ranges, frontend uses the synchronized PMIX net_sales from `report` directly.
        const salesNetSales: Record<string, number> = {}
        if (!isLiveRange && salesNetSalesMap) {
            salesNetSalesMap.forEach((v, k) => {
                if (v > 0) salesNetSales[k] = Number(v.toFixed(2))
            })
        }

        // Default Sort: Quantity Desc
        report.sort((a, b) => b.quantity - a.quantity)

        return { data: report, salesNetSales }
}
