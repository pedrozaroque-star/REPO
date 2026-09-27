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
 *   - Persistencia: Upsert en la tabla `inventory_usage_log` por (`store_id`, `business_date`, `inventory_item_id`).
 *
 * @dataFlow
 *   Toast PMIX (`pmix_daily_cache`) → Recetas (Standard + Virtual) → Conversión de Unidades
 *   → inventory_usage_log (Supabase)
 *
 * @notes
 *   - [2026-09-09] BUGFIX: Corregido error en fallback de caché donde se consultaba la columna inexistente 'pmix_data' en lugar de 'items'.
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix, ProductMixItem } from '@/lib/toast-pmix'
import { calculateRawUsage, calculateInventoryUsage } from './conversions'
import { InventoryItem, Recipe } from '@/types/inventory'
import { getPartyTrayTortillaAllocation, PARTY_TRAY_FOOD_TRAY_ITEMS, PARTY_TRAY_GUIDELINES, PARTY_TRAY_NAPKINS_PER_PACK, resolvePartyTraySize } from './party-tray-guidelines'
import { calculateHistoricalAllocation, type HistoricalOrder } from './historical-allocation'
import { ACTIVE_PROTEIN_IDS, parseProteinAllocation } from './meat-allocation'

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
  if (!nameLower.includes('party tray') && !nameLower.includes('tray')) return []

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
  const tortillaFlourItem = findItem('358_9604bt') || findItem('flour tortilla')
  const salsaRojaItem = findItem('1.5 oz salsa roja pack')
  const salsaVerdeItem = findItem('1.5 oz salsa verde pack')
  const mixtaItem = findItem('1 oz bolsa de mixta')
  const limaItem = findItem('lima bolsita')
  const jalapeñoItem = findItem('rajas y zanahorias')
  const galonesVaciosItem = findItem('galones vacios')
  const waterItems = [
    { keys: ['tamarindo'], item: findItem('tamarindo') },
    { keys: ['horchata'], item: findItem('horchata') },
    { keys: ['jamaica'], item: findItem('jamaica') },
    { keys: ['piña', 'pina'], item: findItem('piña') || findItem('pina') },
  ]
  const platoItem = findItem('plato #3') || findItem('plato ovalado')
  const tenedorItem = findItem('heavy duty plastic fork')
  const cucharaItem = findItem('heavy duty plastic spoon')
  const vasoItem = findItem('water cup, 12 oz')
  const servilletaItem = findItemBySku('DX900GE')
  const cutleryBagItem = findItem('bag, 7x15+2.5 seal2go')
  const tortillaContainerItem = findItem('aluminum container, 9\" round')
  const tortillaContainerLidItem = findItem('container dome lid, 9\" round')

  // Determinar tamaño de Party Tray
  const config = PARTY_TRAY_GUIDELINES[resolvePartyTraySize(itemName)]
  const tortillas = getPartyTrayTortillaAllocation(itemName, config)
  const foodTrays = PARTY_TRAY_FOOD_TRAY_ITEMS[config.foodTraySize]
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
  ingredients.push({ itemId: foodTrays.containerId, qty: 3, unit: 'pza' })
  ingredients.push({ itemId: foodTrays.lidId, qty: 3, unit: 'pza' })
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
function getVariableFlavorVirtualRecipe(
  itemName: string,
  itemsMap: Map<string, InventoryItem>,
  historicalOrders: HistoricalOrder[],
  businessDate: string,
): { itemId: string; qty: number; unit: string }[] {
  const normalizedName = itemName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const findBySku = (sku: string) => Array.from(itemsMap.values()).find(item =>
    (item as InventoryItem & { sku?: string }).sku === sku
  ) || null
  const findExact = (name: string) => Array.from(itemsMap.values()).find(item => item.name.toLowerCase() === name) || null
  const findByName = (name: string) => Array.from(itemsMap.values()).find(item => item.name.toLowerCase().includes(name)) || null
  const allocate = (candidates: { item: InventoryItem; terms: string[] }[], total: number) => {
    const selected = candidates.filter(candidate => candidate.terms.some(term => normalizedName.includes(term)))
    const portions = selected.length > 0
      ? selected.map(({ item }) => [item, 1 / selected.length] as const)
      : candidates.map(({ item }) => [item, calculateHistoricalAllocation(historicalOrders, candidates.map(candidate => candidate.item.id), businessDate).shares.get(item.id) || 0] as const)
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
    const ingredients = allocate(candidates, 20 / 128)
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

  // 2. Obtener catálogo maestro de inventario
  const { data: inventoryItemsData, error: invError } = await supabase
    .from('inventory_items')
    .select('id, sku, name, unit_type, purchase_unit_cost, quantity_per_unit, yield_percent')

  if (invError || !inventoryItemsData) {
    throw new Error(`Error al consultar inventory_items: ${invError?.message}`)
  }

  const inventoryItemsMap = new Map<string, InventoryItem>(
    inventoryItemsData.map(i => [i.id, i as InventoryItem])
  )

  // 3. Obtener recetas en la base de datos
  const { data: recipesData, error: recipesError } = await supabase
    .from('recipes')
    .select('*')

  if (recipesError) {
    throw new Error(`Error al consultar recetas: ${recipesError.message}`)
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

  // 4. Acumular consumo teórico por `inventory_item_id`
  const usageAccumulator = new Map<string, number>()

  for (const pmixItem of pmixItems) {
    const qtySold = pmixItem.quantity || 0
    if (qtySold <= 0) continue

    // A) Productos con sabor seleccionado por special request / historial.
    const variableFlavorIngredients = getVariableFlavorVirtualRecipe(pmixItem.name, inventoryItemsMap, historicalOrders, businessDate)
    if (variableFlavorIngredients.length > 0) {
      for (const ing of variableFlavorIngredients) {
        const item = inventoryItemsMap.get(ing.itemId)
        if (!item) continue
        const itemUsage = calculateInventoryUsage(ing.qty * qtySold, ing.unit, item.unit_type || 'pza', item.quantity_per_unit)
        usageAccumulator.set(item.id, (usageAccumulator.get(item.id) || 0) + itemUsage)
      }
      continue
    }

    // B) Probar si es Party Tray (Receta Virtual)
    const partyTrayIngredients = getPartyTrayVirtualRecipe(pmixItem.name, inventoryItemsMap, historicalOrders, businessDate)

    if (partyTrayIngredients.length > 0) {
      for (const ing of partyTrayIngredients) {
        const item = inventoryItemsMap.get(ing.itemId)
        if (!item) continue

        const itemUsage = calculateInventoryUsage(
          ing.qty * qtySold,
          ing.unit,
          item.unit_type || 'pza',
          item.quantity_per_unit
        )

        const current = usageAccumulator.get(item.id) || 0
        usageAccumulator.set(item.id, current + itemUsage)
      }
      continue
    }

    // C) Receta estándar de la base de datos
    const dbIngredients = recipeMap.get(pmixItem.guid)
    if (!dbIngredients || dbIngredients.length === 0) continue

    const proteinAllocation = parseProteinAllocation(
      pmixItem.name,
      dbIngredients.map(ingredient => ({
        inventory_item_id: ingredient.inventory_item_id,
        quantity: Number(ingredient.quantity) || 0,
        unit: ingredient.unit || 'oz',
      })),
    )
    const activeProteinIds = new Set(Object.values(ACTIVE_PROTEIN_IDS))
    const baseProteinIngredient = dbIngredients.find(ingredient => activeProteinIds.has(ingredient.inventory_item_id))

    for (const ing of dbIngredients) {
      const item = inventoryItemsMap.get(ing.inventory_item_id)
      if (!item) continue

      // La asignación dinámica reemplaza únicamente la carne base; el resto de la receta no cambia.
      if (proteinAllocation?.replacedBaseMeat && activeProteinIds.has(ing.inventory_item_id)) continue

      let ingQty = Number(ing.quantity) || 0
      const recipeType = ing.type || 'food'

      // Ajuste por rendimiento de cocción (yield %) si aplica
      const rawUsage = calculateRawUsage(
        ingQty,
        ing.unit || 'oz',
        item.yield_percent || 100,
        recipeType
      )

      // Convertir a unidades de pedido/inventario del ítem
      const itemUsage = calculateInventoryUsage(
        rawUsage.quantity * qtySold,
        rawUsage.unit,
        item.unit_type || 'pza',
        item.quantity_per_unit
      )

      const current = usageAccumulator.get(item.id) || 0
      usageAccumulator.set(item.id, current + itemUsage)
    }

    if (proteinAllocation?.replacedBaseMeat) {
      for (const [proteinId, portionOz] of proteinAllocation.portionsOz) {
        const item = inventoryItemsMap.get(proteinId)
        if (!item) continue
        const rawUsage = calculateRawUsage(
          portionOz,
          'oz',
          item.yield_percent || 100,
          baseProteinIngredient?.type || 'cooked',
        )
        const itemUsage = calculateInventoryUsage(
          rawUsage.quantity * qtySold,
          rawUsage.unit,
          item.unit_type || 'pza',
          item.quantity_per_unit,
        )
        usageAccumulator.set(item.id, (usageAccumulator.get(item.id) || 0) + itemUsage)
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
