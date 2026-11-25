/**
 * @module lib/inventory/usage-sync
 * @description Motor de sincronización y cálculo de consumo teórico diario por ingrediente.
 *   Toma las ventas registradas en Toast POS (PMIX), las cruza con las recetas estándar
 *   y las recetas virtuales de Party Trays (banquetes), aplica conversiones de unidad y
 *   factores de rendimiento (yield %), y guarda el consumo teórico desglosado por producto
 *   en la tabla `inventory_usage_log`.
 *
 * @businessRules
 *   - El consumo se calcula a nivel de ingrediente básico de inventario (`inventory_item_id`).
 *   - Party Trays (15-20, 20-25, 25-30, 30-40 personas): Se parsean dinámicamente sus insumos
 *     (carnes, arroz, frijol, tortillas, salsas, acompañantes, aguas y desechables).
 *   - Modificadores "Half Meat" (media porción): ajustan -50% carne primaria, +50% carne sustituta.
 *   - Rendimiento por cocción (`yield_percent`): Convierte de plated (cocido) a raw (crudo).
 *   - Salsa de 20 oz sin color explícito: 10 oz roja y 10 oz verde, según confirmación operativa;
 *     galones de agua y Party Trays conservan su asignación histórica de sabor.
 *   - Persistencia: Upsert en la tabla `inventory_usage_log` por (`store_id`, `business_date`, `inventory_item_id`).
 *
 * @dataFlow
 *   Toast PMIX (`pmix_daily_cache`) → Recetas (Standard + Virtual) → Conversión de Unidades
 *   → inventory_usage_log (Supabase)
 *
 * @notes
 *   - [2026-09-09] BUGFIX: Corregido error en fallback de caché donde se consultaba la columna inexistente 'pmix_data' en lugar de 'items'.
 *   - [2026-09-26] El 50/50 de salsa de 20 oz reemplaza solo el fallback de esa venta; no altera sabores explícitos ni el de aguas.
 *     Corregida comparación case-insensitive del nombre exacto: antes omitía ambas salsas y solo contabilizaba empaques.
 *   - [2026-09-27] Unificación con motor determinista de CODEX (calculateDailyOrderConsumption):
 *     Asegura paridad exacta de recetas, rendimientos de carne (Asada 61.5%, Pastor 61.5%, etc.)
 *     y ensamblajes (Taco Plate, Burritos, Mulitas, Teleras, Party Trays) para todos los insumos de bodega.
 *   - [2026-11-17] Sincronizadas charolas de aluminio por componente (`getPartyTrayFoodTrayAllocation` según
 *     `docs/Party Tray Instructions.pdf`: `25-30` usa `2 × RC1150+RL970` + `1 × RC1174+RL990`; `15-20` usa `3 × RC1150+RL970`)
 *     y anclados UUIDs canónicos de `DX900GE` (`6,000 pzas/CS`) y `358_9604BT` (`8 in` harina).
 *   - [2026-11-23] FIX CRÍTICO Stage A & Paginación: (1) Resolución real de nombres de modificadores desde `toast_menu_items`
 *     (`guid -> name`) con conteo agrupado `quantity` y fallback parentético para sub-tacos de `Taco Plate`;
 *     (2) Tickets sintéticos agrupados por canal real `diningOptionName: p.group_name || 'To Go'` en vez de `'Take Out'` fijo;
 *     (3) Paginación `.range()` en catálogos y filtro de empaque por canal en Stage B sin inflación `qtySold²`.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix, ProductMixItem } from '@/lib/toast-pmix'
import { calculateRawUsage, calculateInventoryUsage } from './conversions'
import { InventoryItem, Recipe } from '@/types/inventory'
import {
  getPartyTrayFoodTrayAllocation,
  getPartyTrayTortillaAllocation,
  PARTY_TRAY_EMPTY_GALLON_ITEM_ID,
  PARTY_TRAY_FLOUR_TORTILLA_ITEM_ID,
  PARTY_TRAY_GUIDELINES,
  PARTY_TRAY_NAPKIN_ITEM_ID,
  PARTY_TRAY_NAPKINS_PER_PACK,
  resolvePartyTraySize,
} from './party-tray-guidelines'
import { calculateHistoricalAllocation, type HistoricalOrder } from './historical-allocation'
import { ACTIVE_PROTEIN_IDS, parseProteinAllocation } from './meat-allocation'
import { calculateDailyOrderConsumption, type RawToastTicket } from './daily-order-consumption-engine'

export interface DailyUsageSummary {
  inventoryItemId: string
  itemName: string
  theoreticalUsage: number
  unitType: string
}

/**
 * Receta virtual para Banquetes (Party Trays) basada en la guía oficial TEG
 */
function getPartyTrayVirtualRecipe(
  itemName: string,
  itemsMap: Map<string, InventoryItem>,
  historicalOrders: HistoricalOrder[],
  businessDate: string,
): { itemId: string; qty: number; unit: string }[] {
  const nameLower = itemName.toLowerCase()
  if (!/party\s*tray|fiesta\s*platter|\d+\s*-\s*\d+\s*people|\btray\b/.test(nameLower)) return []

  // Helper para buscar ítems por coincidencia de nombre
  const findItem = (term: string) => {
    for (const [id, item] of itemsMap.entries()) {
      if (item.name.toLowerCase().includes(term.toLowerCase())) {
        return item
      }
    }
    return null
  }
  const findItemBySku = (sku: string) => {
    for (const item of itemsMap.values()) {
      if ((item as InventoryItem & { sku?: string }).sku === sku) return item
    }
    return null
  }

  const asadaItem = findItem('carne asada')
  const polloItem = findItem('pollo')
  const pastorItem = findItem('pastor')
  const arrozItem = findItem('arroz')
  const frijolItem = findItem('frijol molido') || findItem('frijol entero')
  const tortillaCornItem = findItem('1100 tortilla')
  const tortillaFlourItem =
    itemsMap.get(PARTY_TRAY_FLOUR_TORTILLA_ITEM_ID) || findItem('358_9604bt') || findItem('flour tortilla')
  const salsaRojaItem = findItem('1.5 oz salsa roja pack')
  const salsaVerdeItem = findItem('1.5 oz salsa verde pack')
  const mixtaItem = findItem('1 oz bolsa de mixta')
  const limaItem = findItem('lima bolsita')
  const jalapeñoItem = findItem('rajas y zanahorias')
  const galonesVaciosItem = itemsMap.get(PARTY_TRAY_EMPTY_GALLON_ITEM_ID) || findItem('galones vacios')
  const waterItems = [
    { keys: ['tamarindo'], item: findItem('tamarindo') },
    { keys: ['horchata'], item: findItem('horchata') },
    { keys: ['jamaica'], item: findItem('jamaica') },
    { keys: ['piña', 'pina'], item: findItem('piña') || findItem('pina') },
  ]
  const platoItem = findItem('plato #3') || findItem('plato ovalado')
  const tenedorItem = findItem('heavy duty plastic fork') || findItem('fork, heavy white')
  const cucharaItem = findItem('heavy duty plastic spoon') || findItem('spoon, heavy white')
  const vasoItem = findItem('water cup, 12 oz')
  const servilletaItem =
    itemsMap.get(PARTY_TRAY_NAPKIN_ITEM_ID) ||
    Array.from(itemsMap.values()).find(
      (item) => (item as InventoryItem & { sku?: string }).sku === 'DX900GE' && Number(item.quantity_per_unit || 0) >= 250
    ) ||
    findItemBySku('DX900GE')
  const cutleryBagItem = findItem('bag, 7x15+2.5 seal2go')
  const tortillaContainerItem = findItem('aluminum container, 9" round')
  const tortillaContainerLidItem = findItem('container dome lid, 9" round')

  // Determinar tamaño de Party Tray
  const config = PARTY_TRAY_GUIDELINES[resolvePartyTraySize(itemName)]
  const tortillas = getPartyTrayTortillaAllocation(itemName, config)
  const trayAllocation = getPartyTrayFoodTrayAllocation(config)
  const selectedWaterItems = waterItems
    .filter(({ keys, item }) => item && keys.some(key => nameLower.includes(key)))
    .map(({ item }) => item!)

  const ingredients: { itemId: string; qty: number; unit: string }[] = []

  // Carnes: detectar si la carne viene en el nombre
  let primaryMeat = asadaItem
  if (nameLower.includes('pollo') || nameLower.includes('chicken')) primaryMeat = polloItem
  else if (nameLower.includes('pastor')) primaryMeat = pastorItem

  if (primaryMeat) {
    ingredients.push({ itemId: primaryMeat.id, qty: config.meatLbs, unit: 'lb' })
  }

  if (arrozItem) ingredients.push({ itemId: arrozItem.id, qty: config.riceLbs, unit: 'lb' })
  if (frijolItem) ingredients.push({ itemId: frijolItem.id, qty: config.beansLbs, unit: 'lb' })
  if (tortillaCornItem && tortillas.cornTortillas > 0) ingredients.push({ itemId: tortillaCornItem.id, qty: tortillas.cornTortillas, unit: 'pza' })
  if (tortillaFlourItem && tortillas.flourTortillas > 0) ingredients.push({ itemId: tortillaFlourItem.id, qty: tortillas.flourTortillas, unit: 'pza' })
  if (tortillaContainerItem) ingredients.push({ itemId: tortillaContainerItem.id, qty: tortillas.containerPairs, unit: 'pza' })
  if (tortillaContainerLidItem) ingredients.push({ itemId: tortillaContainerLidItem.id, qty: tortillas.containerPairs, unit: 'pza' })
  for (const trayLine of trayAllocation.lines) {
    ingredients.push({ itemId: trayLine.containerId, qty: trayLine.quantity, unit: 'pza' })
    ingredients.push({ itemId: trayLine.lidId, qty: trayLine.quantity, unit: 'pza' })
  }
  if (salsaRojaItem) ingredients.push({ itemId: salsaRojaItem.id, qty: config.salsaRojaPacks, unit: 'pza' })
  if (salsaVerdeItem) ingredients.push({ itemId: salsaVerdeItem.id, qty: config.salsaVerdePacks, unit: 'pza' })
  if (mixtaItem) ingredients.push({ itemId: mixtaItem.id, qty: config.mixtaBags, unit: 'pza' })
  if (limaItem) ingredients.push({ itemId: limaItem.id, qty: config.limeBags, unit: 'pza' })
  if (jalapeñoItem) ingredients.push({ itemId: jalapeñoItem.id, qty: config.jalapenoOz / 16, unit: 'lb' })
  if (selectedWaterItems.length > 0) {
    for (const waterItem of selectedWaterItems) {
      ingredients.push({ itemId: waterItem.id, qty: config.aguaGallons / selectedWaterItems.length, unit: 'gal' })
    }
  } else {
    const candidates = waterItems.flatMap(({ item }) => item ? [item] : [])
    const allocation = calculateHistoricalAllocation(historicalOrders, candidates.map(item => item.id), businessDate)
    for (const waterItem of candidates) {
      const share = allocation.shares.get(waterItem.id) || 0
      if (share > 0) ingredients.push({ itemId: waterItem.id, qty: config.aguaGallons * share, unit: 'gal' })
    }
  }
  if (galonesVaciosItem) ingredients.push({ itemId: galonesVaciosItem.id, qty: config.aguaGallons, unit: 'pza' })
  if (platoItem) ingredients.push({ itemId: platoItem.id, qty: config.plates, unit: 'pza' })
  if (tenedorItem) ingredients.push({ itemId: tenedorItem.id, qty: config.forks, unit: 'pza' })
  if (cucharaItem) ingredients.push({ itemId: cucharaItem.id, qty: config.spoons, unit: 'pza' })
  if (vasoItem) ingredients.push({ itemId: vasoItem.id, qty: config.cups, unit: 'pza' })
  if (cutleryBagItem) ingredients.push({ itemId: cutleryBagItem.id, qty: 1, unit: 'pza' })
  if (servilletaItem) ingredients.push({ itemId: servilletaItem.id, qty: config.napkinPacks * PARTY_TRAY_NAPKINS_PER_PACK, unit: 'pza' })

  return ingredients
}

/**
 * Recetas variables de productos vendidos por volumen: galones de agua y salsa de 20 oz.
 * El sabor explícito de Toast prevalece; si falta, se aplica la misma asignación histórica local.
 */
export function getVariableFlavorVirtualRecipe(
  itemName: string,
  itemsMap: Map<string, InventoryItem>,
  historicalOrders: HistoricalOrder[],
  businessDate: string,
): { itemId: string; qty: number; unit: string }[] {
  const normalizedName = itemName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const findBySku = (sku: string) => Array.from(itemsMap.values()).find(item =>
    (item as InventoryItem & { sku?: string }).sku === sku
  ) || null
  const findExact = (name: string) => Array.from(itemsMap.values()).find(item => item.name.toLowerCase() === name.toLowerCase()) || null
  const findByName = (name: string) => Array.from(itemsMap.values()).find(item => item.name.toLowerCase().includes(name)) || null
  const allocate = (candidates: { item: InventoryItem; terms: string[] }[], total: number, missingFlavor: 'historical' | 'equal' = 'historical') => {
    const selected = candidates.filter(candidate => candidate.terms.some(term => normalizedName.includes(term)))
    const portions = selected.length > 0
      ? selected.map(({ item }) => [item, 1 / selected.length] as const)
      : candidates.map(({ item }) => [item, missingFlavor === 'equal' ? 1 / candidates.length : calculateHistoricalAllocation(historicalOrders, candidates.map(candidate => candidate.item.id), businessDate).shares.get(item.id) || 0] as const)
    return portions.filter(([, share]) => share > 0).map(([item, share]) => ({ itemId: item.id, qty: total * share, unit: 'gal' }))
  }

  const isWaterGallon = (normalizedName.includes('gallon agua') || normalizedName.includes('gallon de agua')) &&
    !normalizedName.includes('party tray') && !normalizedName.includes('fiesta platter')
  if (isWaterGallon) {
    const flavors = [
      { terms: ['tamarindo'], item: findExact('Tamarindo Concentrate') || findByName('tamarindo') },
      { terms: ['horchata'], item: findExact('Horchata') || findByName('horchata') },
      { terms: ['jamaica'], item: findExact('Jamaica Concentrate') || findByName('jamaica') },
      { terms: ['pina'], item: findExact('Piña Concentrate') || findByName('piña') || findByName('pina') },
    ]
    const candidates = flavors.flatMap(({ item, terms }) => item ? [{ item, terms }] : [])
    const ingredients = allocate(candidates, 1)
    const gallonEmpty = findByName('galones vacios')
    if (gallonEmpty) ingredients.push({ itemId: gallonEmpty.id, qty: 1, unit: 'pza' })
    return ingredients
  }

  const isTwentyOzSalsa = /(?:20\s*oz.*salsa|salsa.*20\s*oz)/.test(normalizedName)
  if (isTwentyOzSalsa) {
    const salsas = [
      { terms: ['roja', 'red'], item: findExact('Salsa Roja') },
      { terms: ['verde', 'green'], item: findExact('Salsa Verde') },
    ]
    const candidates = salsas.flatMap(({ item, terms }) => item ? [{ item, terms }] : [])
    const ingredients = allocate(candidates, 20 / 128, 'equal')
    for (const sku of ['RC478', '709DO', 'ELTSBALA']) {
      const item = findBySku(sku)
      if (item) ingredients.push({ itemId: item.id, qty: 1, unit: 'pza' })
    }
    return ingredients
  }

  return []
}

/**
 * Calcula y sincroniza el consumo teórico diario por ingrediente en `inventory_usage_log`
 */
export async function syncDailyInventoryUsage(
  storeIdInput: string,
  businessDate: string
): Promise<DailyUsageSummary[]> {
  const supabase = await getSupabaseAdminClient()

  // Resolve store record to get both numeric ID (dbStoreId) and Toast external_id
  let dbStoreId = storeIdInput
  let toastExternalId = storeIdInput

  const isNumeric = !isNaN(Number(storeIdInput))
  const { data: storeObj } = await supabase
    .from('stores')
    .select('id, external_id')
    .or(isNumeric ? `id.eq.${storeIdInput}` : `external_id.eq.${storeIdInput}`)
    .single()

  if (storeObj) {
    dbStoreId = storeObj.id.toString()
    toastExternalId = storeObj.external_id || storeIdInput
  }

  console.log(`[UsageSync] Sync de consumo teórico para tienda ID:${dbStoreId} (Toast:${toastExternalId}) en fecha ${businessDate}`)

  // 1. Obtener PMIX de Toast para el día (usando toastExternalId)
  let pmixItems: ProductMixItem[] = []
  try {
    pmixItems = await getProductMix({ storeId: toastExternalId, startDate: businessDate, endDate: businessDate, bundleModifiers: true })
  } catch (err) {
    console.error(`[UsageSync] Error al obtener PMIX de Toast:`, err)
    // Intentar leer de cache
    const { data: cacheRow } = await supabase
      .from('pmix_daily_cache')
      .select('items')
      .eq('store_id', toastExternalId)
      .eq('business_date', businessDate)
      .single()

    if (cacheRow?.items) {
      pmixItems = Array.isArray(cacheRow.items)
        ? cacheRow.items
        : (typeof cacheRow.items === 'string' ? JSON.parse(cacheRow.items) : [])
    }
  }

  if (pmixItems.length === 0) {
    console.log(`[UsageSync] No se encontraron datos PMIX para tienda ${dbStoreId} el ${businessDate}`)
    return []
  }

  // Helper determinista para paginar tablas PostgREST sin truncamiento en 1,000 filas
  const fetchAllUsageRows = async <T = any>(
    buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
    pageSize = 1000
  ): Promise<T[]> => {
    const rows: T[] = []
    let offset = 0
    while (true) {
      const { data, error } = await buildQuery(offset, offset + pageSize - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
    }
    return rows
  }

  // 2. Obtener catálogo maestro de inventario, recetas y nombres de menú Toast (paginados)
  let inventoryItemsData: any[] = []
  try {
    inventoryItemsData = await fetchAllUsageRows((from, to) =>
      supabase
        .from('inventory_items')
        .select('id, sku, name, unit_type, purchase_unit_cost, quantity_per_unit, yield_percent, unit_measure, order_rounding_rule, excel_reference')
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (invErr: any) {
    throw new Error(`Error al consultar inventory_items: ${invErr?.message}`)
  }

  const inventoryItemsMap = new Map<string, InventoryItem>(
    inventoryItemsData.map(i => [i.id, i as unknown as InventoryItem])
  )

  // 3. Obtener recetas y catálogo de nombres Toast en la base de datos
  let recipesData: any[] = []
  try {
    recipesData = await fetchAllUsageRows((from, to) =>
      supabase.from('recipes').select('*').order('id', { ascending: true }).range(from, to)
    )
  } catch (recipesErr: any) {
    throw new Error(`Error al consultar recetas: ${recipesErr?.message}`)
  }

  let toastMenuItemsData: { guid: string; name: string }[] = []
  try {
    toastMenuItemsData = await fetchAllUsageRows<{ guid: string; name: string }>((from, to) =>
      supabase.from('toast_menu_items').select('guid, name').order('guid', { ascending: true }).range(from, to)
    )
  } catch (menuErr: any) {
    console.warn(`[UsageSync] No se pudo cargar toast_menu_items completo: ${menuErr?.message}`)
  }
  const menuItemNameMap = new Map<string, string>()
  for (const mi of toastMenuItemsData) {
    if (mi.guid && mi.name) {
      menuItemNameMap.set(mi.guid, mi.name.trim())
    }
  }

  const historicalStartDate = new Date(`${businessDate}T12:00:00Z`)
  historicalStartDate.setUTCDate(historicalStartDate.getUTCDate() - 90)
  const { data: historicalOrdersData, error: historicalOrdersError } = await supabase
    .from('inventory_orders')
    .select('order_date, inventory_order_lines(inventory_item_id, final_qty, adjusted_qty, calculated_qty, leftover_value)')
    .eq('store_id', dbStoreId)
    .gte('order_date', historicalStartDate.toISOString().slice(0, 10))
    .lt('order_date', businessDate)

  if (historicalOrdersError) {
    console.warn(`[UsageSync] No se pudo cargar historial de sabores: ${historicalOrdersError.message}`)
  }
  const historicalOrders = (historicalOrdersData || []) as HistoricalOrder[]

  // Agrupar recetas por toast_menu_item_guid
  const recipeMap = new Map<string, any[]>()
  for (const r of (recipesData || [])) {
    if (!recipeMap.has(r.toast_menu_item_guid)) {
      recipeMap.set(r.toast_menu_item_guid, [])
    }
    recipeMap.get(r.toast_menu_item_guid)!.push(r)
  }

  // 4. Acumular consumo teórico utilizando el Motor Determinista de CODEX (Bodega Staples)
  const usageAccumulator = new Map<string, number>()
  const codexHandledItemIds = new Set<string>()

  // A) Ejecutar el Motor Determinista de CODEX agrupando por canal real (`diningOptionName`) y nombres reales de modificadores
  const normalizeModText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  try {
    const channelGroups = new Map<string, ProductMixItem[]>()
    for (const p of pmixItems) {
      const diningOptionName = (p.group_name && p.group_name !== 'Uncategorized') ? p.group_name : 'To Go'
      if (!channelGroups.has(diningOptionName)) {
        channelGroups.set(diningOptionName, [])
      }
      channelGroups.get(diningOptionName)!.push(p)
    }

    const synthesizedTickets: RawToastTicket[] = []
    let channelIdx = 0
    for (const [diningOptionName, channelItems] of channelGroups.entries()) {
      channelIdx++
      synthesizedTickets.push({
        orderGuid: `pmix-${businessDate}-${channelIdx}`,
        businessDate,
        diningOptionName,
        deliveryService: /uber|doordash|grubhub|postmates/i.test(diningOptionName) ? diningOptionName : undefined,
        selections: channelItems.map(p => {
          const sQty = Number(p.quantity) || 1
          const modGuidCounts = new Map<string, number>()
          for (const g of (p.modifier_guids || [])) {
            if (g) modGuidCounts.set(g, (modGuidCounts.get(g) || 0) + 1)
          }

          const resolvedMods: { guid?: string; name: string; quantity: number }[] = []
          const resolvedNormSet = new Set<string>()
          const baseMenuName = menuItemNameMap.get(p.guid)
          const baseNorm = baseMenuName ? normalizeModText(baseMenuName) : ''

          // 1. Extraer primero los tokens parentéticos de `p.name` (que representan exactamente 1 orden en PMIX bundleModifiers)
          //    y escalarlos por `sQty` para preservar conteos exactos en Taco Plate (3 * sQty) y Half & Half (1 * sQty).
          const parenTokenCounts = new Map<string, { raw: string; count: number }>()
          const cleanForParen = String(p.name || '').replace(/\(\s*in\s+store\s*\)/gi, '')
          for (const m of cleanForParen.matchAll(/\(([^)]+)\)/g)) {
            const groupContent = m[1].trim()
            if (baseNorm && baseNorm.includes(normalizeModText(`(${groupContent})`))) continue
            for (const rawTok of groupContent.split(',')) {
              const tok = rawTok.trim()
              const tokNorm = normalizeModText(tok)
              if (!tok || !tokNorm || tokNorm === 'in store' || /^\d+\s*-\s*\d+\s*people$/.test(tokNorm)) continue
              const prev = parenTokenCounts.get(tokNorm) || { raw: tok, count: 0 }
              prev.count += 1
              parenTokenCounts.set(tokNorm, prev)
            }
          }

          for (const [tokNorm, { raw, count }] of parenTokenCounts.entries()) {
            resolvedMods.push({ name: raw, quantity: count * sQty })
            resolvedNormSet.add(tokNorm)
          }

          // 2. Respaldo desde `modifier_guids` únicamente para modificadores que no estaban ya en el nombre agrupado
          for (const [guid, count] of modGuidCounts.entries()) {
            const modName = menuItemNameMap.get(guid)
            if (modName) {
              const normMod = normalizeModText(modName.replace(/\(\s*in\s+store\s*\)/gi, ''))
              if (resolvedNormSet.has(normMod) || resolvedNormSet.has(normalizeModText(modName))) continue
              resolvedMods.push({ guid, name: modName, quantity: count })
              resolvedNormSet.add(normMod)
            }
          }

          return {
            guid: p.guid,
            name: baseMenuName || p.name,
            price: p.unit_price || 0,
            quantity: p.quantity,
            modifiers: resolvedMods,
          }
        }),
      })
    }

    const codexOutput = calculateDailyOrderConsumption(
      Number(dbStoreId) || 14,
      businessDate,
      synthesizedTickets,
      (recipesData || []) as any,
      (inventoryItemsData || []) as any
    )

    for (const [id, res] of codexOutput.itemConsumption.entries()) {
      if (res.totalCalculatedUsage > 0) {
        usageAccumulator.set(res.inventoryItemId, res.totalCalculatedUsage)
        codexHandledItemIds.add(res.inventoryItemId)
      }
    }
  } catch (err: any) {
    console.error(`[UsageSync] Error ejecutando motor CODEX:`, err?.message || err)
  }

  // B) Fallback para insumos/ingredientes adicionales que tengan receta directa en DB pero no estén en el motor de bodega
  const matchesChannelType = (recipeType: string, groupName?: string) => {
    if (!recipeType || !recipeType.startsWith('cogs_')) return true
    const doLower = (groupName && groupName !== 'Uncategorized' ? groupName : 'To Go').toLowerCase()
    const isDineIn = doLower.includes('here') || doLower.includes('dine')
    const isDelivery = doLower.includes('uber') || doLower.includes('door') || doLower.includes('grub') || doLower.includes('delivery')
    const isTakeout = !isDineIn && !isDelivery
    if (recipeType === 'cogs_dine_in') return isDineIn
    if (recipeType === 'cogs_delivery') return isDelivery
    if (recipeType === 'cogs_takeout') return isTakeout
    return true
  }

  for (const pmixItem of pmixItems) {
    const qtySold = pmixItem.quantity || 0
    if (qtySold <= 0) continue

    const dbIngredients = recipeMap.get(pmixItem.guid)
    if (dbIngredients && dbIngredients.length > 0) {
      for (const ing of dbIngredients) {
        if (codexHandledItemIds.has(ing.inventory_item_id)) continue

        const recipeType = ing.type || 'food'
        if (!matchesChannelType(recipeType, pmixItem.group_name)) continue

        const item = inventoryItemsMap.get(ing.inventory_item_id)
        if (!item) continue

        const ingQty = Number(ing.quantity) || 0
        const rawUsage = calculateRawUsage(
          ingQty,
          ing.unit || 'oz',
          item.yield_percent || 100,
          recipeType
        )

        const itemUsage = calculateInventoryUsage(
          rawUsage.quantity * qtySold,
          rawUsage.unit,
          item.unit_type || 'pza',
          item.quantity_per_unit
        )

        const current = usageAccumulator.get(item.id) || 0
        usageAccumulator.set(item.id, current + itemUsage)
      }
    }

    // Modificadores para items no cubiertos por CODEX (`modifier_guids` ya viene pre-escalado por Toast)
    if (Array.isArray(pmixItem.modifier_guids) && pmixItem.modifier_guids.length > 0) {
      const modCounts = new Map<string, number>()
      for (const g of pmixItem.modifier_guids) {
        if (g) modCounts.set(g, (modCounts.get(g) || 0) + 1)
      }
      for (const [modGuid, rawCount] of modCounts.entries()) {
        const effectiveModCount = Math.min(rawCount, Math.max(1, qtySold))
        const modIngredients = recipeMap.get(modGuid)
        if (!modIngredients || modIngredients.length === 0) continue

        for (const modIng of modIngredients) {
          if (codexHandledItemIds.has(modIng.inventory_item_id)) continue

          const modRecipeType = modIng.type || 'food'
          if (!matchesChannelType(modRecipeType, pmixItem.group_name)) continue

          const modItem = inventoryItemsMap.get(modIng.inventory_item_id)
          if (!modItem) continue

          const modIngQty = Number(modIng.quantity) || 0
          const rawUsage = calculateRawUsage(
            modIngQty,
            modIng.unit || 'oz',
            modItem.yield_percent || 100,
            modRecipeType
          )

          const itemUsage = calculateInventoryUsage(
            rawUsage.quantity * effectiveModCount,
            rawUsage.unit,
            modItem.unit_type || 'pza',
            modItem.quantity_per_unit
          )

          const current = usageAccumulator.get(modItem.id) || 0
          usageAccumulator.set(modItem.id, current + itemUsage)
        }
      }
    }
  }

  // 5. Preparar filas para upsert en `inventory_usage_log`
  const summary: DailyUsageSummary[] = []
  const upsertRows: any[] = []

  for (const [itemId, usageQty] of usageAccumulator.entries()) {
    const item = inventoryItemsMap.get(itemId)
    if (!item) continue

    const roundedUsage = Number(usageQty.toFixed(4))

    summary.push({
      inventoryItemId: itemId,
      itemName: item.name,
      theoreticalUsage: roundedUsage,
      unitType: item.unit_type || 'pza'
    })

    upsertRows.push({
      store_id: dbStoreId,
      business_date: businessDate,
      inventory_item_id: itemId,
      theoretical_usage: roundedUsage
    })
  }

  // 6. Guardar en Supabase (`inventory_usage_log`)
  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase
      .from('inventory_usage_log')
      .upsert(upsertRows, { onConflict: 'store_id,business_date,inventory_item_id' })

    if (upsertError) {
      console.error(`[UsageSync] Error al hacer upsert en inventory_usage_log:`, upsertError.message)
      throw upsertError
    }

    console.log(`[UsageSync] Sincronizados exitosamente ${upsertRows.length} ingredientes en inventory_usage_log`)
  }

  return summary
}
