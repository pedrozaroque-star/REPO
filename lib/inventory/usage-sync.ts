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
 */

import { getSupabaseAdminClient } from '@/lib/supabase'
import { getProductMix, ProductMixItem } from '@/lib/toast-pmix'
import { calculateRawUsage, calculateInventoryUsage } from './conversions'
import { InventoryItem, Recipe } from '@/types/inventory'

export interface DailyUsageSummary {
  inventoryItemId: string
  itemName: string
  theoreticalUsage: number
  unitType: string
}

/**
 * Receta virtual para Banquetes (Party Trays) basada en la guía oficial TEG
 */
function getPartyTrayVirtualRecipe(itemName: string, itemsMap: Map<string, InventoryItem>): { itemId: string; qty: number; unit: string }[] {
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
  const jalapeñoItem = findItem('2 oz bolsas de rajas')
  const horchataItem = findItem('horchata')
  const platoItem = findItem('plato #3') || findItem('plato ovalado')
  const tenedorItem = findItem('heavy duty plastic fork')
  const cucharaItem = findItem('heavy duty plastic spoon')
  const vasoItem = findItem('el gavilan - cup, 22 oz')
  const servilletaItem = findItem('dispenser napkin')

  // Determinar tamaño de Party Tray
  let size: '15-20' | '20-25' | '25-30' | '30-40' = '15-20'
  if (nameLower.includes('30-40') || nameLower.includes('30 - 40')) size = '30-40'
  else if (nameLower.includes('25-30') || nameLower.includes('25 - 30')) size = '25-30'
  else if (nameLower.includes('20-25') || nameLower.includes('20 - 25')) size = '20-25'

  // Configuración por tamaño de la guía oficial TEG
  const config = {
    '15-20': { riceLbs: 3, beansLbs: 3, meatLbs: 6, plates: 30, forks: 15, spoons: 15, cups: 20, napkins: 50, roja: 12, verde: 12, mixta: 16, limas: 16, jalapeñosOz: 8, cornPks: 2, flourPks: 5, aguasGal: 3 },
    '20-25': { riceLbs: 4, beansLbs: 4, meatLbs: 7.5, plates: 35, forks: 15, spoons: 15, cups: 25, napkins: 50, roja: 16, verde: 16, mixta: 20, limas: 20, jalapeñosOz: 12, cornPks: 3, flourPks: 7, aguasGal: 4 },
    '25-30': { riceLbs: 6, beansLbs: 6, meatLbs: 10, plates: 40, forks: 20, spoons: 20, cups: 30, napkins: 100, roja: 20, verde: 20, mixta: 20, limas: 20, jalapeñosOz: 16, cornPks: 4, flourPks: 9, aguasGal: 5 },
    '30-40': { riceLbs: 10, beansLbs: 10, meatLbs: 12, plates: 50, forks: 25, spoons: 25, cups: 40, napkins: 150, roja: 24, verde: 24, mixta: 30, limas: 30, jalapeñosOz: 20, cornPks: 5, flourPks: 12, aguasGal: 6 }
  }[size]

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
  if (tortillaCornItem) ingredients.push({ itemId: tortillaCornItem.id, qty: config.cornPks * 60, unit: 'pza' })
  if (tortillaFlourItem) ingredients.push({ itemId: tortillaFlourItem.id, qty: config.flourPks * 12, unit: 'pza' })
  if (salsaRojaItem) ingredients.push({ itemId: salsaRojaItem.id, qty: config.roja, unit: 'pza' })
  if (salsaVerdeItem) ingredients.push({ itemId: salsaVerdeItem.id, qty: config.verde, unit: 'pza' })
  if (mixtaItem) ingredients.push({ itemId: mixtaItem.id, qty: config.mixta, unit: 'pza' })
  if (limaItem) ingredients.push({ itemId: limaItem.id, qty: config.limas, unit: 'pza' })
  if (horchataItem) ingredients.push({ itemId: horchataItem.id, qty: config.aguasGal, unit: 'gal' })
  if (platoItem) ingredients.push({ itemId: platoItem.id, qty: config.plates, unit: 'pza' })
  if (tenedorItem) ingredients.push({ itemId: tenedorItem.id, qty: config.forks, unit: 'pza' })
  if (cucharaItem) ingredients.push({ itemId: cucharaItem.id, qty: config.spoons, unit: 'pza' })
  if (vasoItem) ingredients.push({ itemId: vasoItem.id, qty: config.cups, unit: 'pza' })
  if (servilletaItem) ingredients.push({ itemId: servilletaItem.id, qty: config.napkins, unit: 'pza' })

  return ingredients
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
      .select('pmix_data')
      .eq('store_id', toastExternalId)
      .eq('business_date', businessDate)
      .single()

    if (cacheRow?.pmix_data) {
      pmixItems = typeof cacheRow.pmix_data === 'string' ? JSON.parse(cacheRow.pmix_data) : cacheRow.pmix_data
    }
  }

  if (pmixItems.length === 0) {
    console.log(`[UsageSync] No se encontraron datos PMIX para tienda ${dbStoreId} el ${businessDate}`)
    return []
  }

  // 2. Obtener catálogo maestro de inventario
  const { data: inventoryItemsData, error: invError } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, yield_percent')

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

    // A) Probar primero si es un Party Tray (Receta Virtual)
    const partyTrayIngredients = getPartyTrayVirtualRecipe(pmixItem.name, inventoryItemsMap)

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

    // B) Receta estándar de la base de datos
    const dbIngredients = recipeMap.get(pmixItem.guid)
    if (!dbIngredients || dbIngredients.length === 0) continue

    for (const ing of dbIngredients) {
      const item = inventoryItemsMap.get(ing.inventory_item_id)
      if (!item) continue

      let ingQty = Number(ing.quantity) || 0
      const recipeType = ing.type || 'food'

      // Ajuste por modificador Half-Meat (media porción)
      if (pmixItem.half_meat_adjustments && pmixItem.half_meat_adjustments > 0) {
        ingQty = ingQty * 0.5
      }

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
