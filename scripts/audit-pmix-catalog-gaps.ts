/**
 * @module scripts/audit-pmix-catalog-gaps
 * @description Audita el universo completo de ítems vendidos en las 15 tiendas entre 2026-08-01 y 2026-09-23
 *              desde pmix_daily_cache, cruzándolos contra recipes, inventory_items y reglas de automatización.
 * @businessRules
 *   - Solo evalúa días cerrados (2026-08-01 a 2026-09-23; excluye 2026-09-24 por estar en curso).
 *   - Cruza cada GUID vendido contra `recipes` para detectar ítems sin receta o con receta parcial.
 *   - Detecta productos descontinuados (Tripa, Full Cheesecake) y no consumibles (Empleado, etc.).
 * @dataFlow Supabase pmix_daily_cache + recipes + inventory_items → Reporte JSON estructurado.
 * @notes No expone credenciales ni modifica tablas.
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: '.env.local', quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

interface PMIXItem {
  guid: string
  name: string
  quantity: number
  net_sales: number
  group_name?: string
  unit_price?: number
  gross_sales?: number
  modifier_guids?: string[]
}

async function runAudit() {
  console.log('1. Cargando tiendas activas...')
  const { data: stores, error: sErr } = await supabase
    .from('stores')
    .select('id, name, external_id')
    .order('name')
  if (sErr) throw sErr
  const storeMap = new Map<number, string>(stores.map(s => [s.id, s.name]))
  const storeExtMap = new Map<string, string>(stores.map(s => [s.external_id, s.name]))

  console.log('2. Cargando catálogo de recetas e insumos...')
  const { data: recipes, error: rErr } = await supabase
    .from('recipes')
    .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')
  if (rErr) throw rErr

  const { data: invItems, error: iErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, purchase_unit_cost, quantity_per_unit, is_bodega')
  if (iErr) throw iErr
  const invMap = new Map(invItems.map(i => [i.id, i]))

  // Agrupar recetas por toast_menu_item_guid
  const recipeByItem = new Map<string, typeof recipes>()
  recipes.forEach(r => {
    if (!r.toast_menu_item_guid) return
    const list = recipeByItem.get(r.toast_menu_item_guid) || []
    list.push(r)
    recipeByItem.set(r.toast_menu_item_guid, list)
  })

  console.log(`Recetas cargadas: ${recipes.length} ingredientes para ${recipeByItem.size} ítems Toast.`)

  console.log('3. Consultando pmix_daily_cache por tienda para Agosto y Septiembre 2026 (2026-08-01 a 2026-09-23)...')
  const pmixRows: any[] = []
  for (const store of stores) {
    const { data: storeRows, error: pErr } = await supabase
      .from('pmix_daily_cache')
      .select('store_id, business_date, items')
      .eq('store_id', store.external_id)
      .gte('business_date', '2026-08-01')
      .lte('business_date', '2026-09-23')
    if (pErr) {
      console.warn(`Error en tienda ${store.name} (${store.external_id}):`, pErr.message)
      // Intentar también por store.id numérico si aplica
      const { data: numericRows, error: numErr } = await supabase
        .from('pmix_daily_cache')
        .select('store_id, business_date, items')
        .eq('store_id', String(store.id))
        .gte('business_date', '2026-08-01')
        .lte('business_date', '2026-09-23')
      if (!numErr && numericRows) pmixRows.push(...numericRows)
    } else if (storeRows) {
      pmixRows.push(...storeRows)
    }
  }


  console.log(`Registros de PMIX cargados: ${pmixRows?.length || 0} tienda-días.`)

  // Acumular estadísticas por ítem vendido
  interface ItemStats {
    guid: string
    name: string
    totalQuantity: number
    totalNetSales: number
    storesSeen: Set<string>
    firstDate: string
    lastDate: string
    diningGroups: Set<string>
  }

  const itemsMap = new Map<string, ItemStats>()

  for (const row of pmixRows || []) {
    const storeName = storeExtMap.get(row.store_id) || storeMap.get(Number(row.store_id)) || String(row.store_id)
    const date = row.business_date
    const items = (row.items || []) as PMIXItem[]

    for (const item of items) {
      if (!item.guid) continue
      const existing = itemsMap.get(item.guid) || {
        guid: item.guid,
        name: item.name || 'Sin nombre',
        totalQuantity: 0,
        totalNetSales: 0,
        storesSeen: new Set<string>(),
        firstDate: date,
        lastDate: date,
        diningGroups: new Set<string>(),
      }

      existing.totalQuantity += Number(item.quantity) || 0
      existing.totalNetSales += Number(item.net_sales) || 0
      existing.storesSeen.add(storeName)
      if (date < existing.firstDate) existing.firstDate = date
      if (date > existing.lastDate) existing.lastDate = date
      if (item.group_name) existing.diningGroups.add(item.group_name)

      itemsMap.set(item.guid, existing)
    }
  }

  console.log(`\nTotal de ítems Toast únicos vendidos en el período: ${itemsMap.size}`)

  // Clasificar cada ítem en el universo
  const unmappedItems: any[] = []
  const partialItems: any[] = []
  const mappedItems: any[] = []
  const discontinuedItems: any[] = []
  const nonFoodOrDiscounts: any[] = []

  const isTripa = (name: string) => /\btripa\b/i.test(name)
  const isFullCheesecake = (name: string) => /full\s*cheese/i.test(name)
  const isEmployeeOrDiscount = (name: string) => /\b(empleado|employee|discount|propina|tip)\b/i.test(name)

  for (const item of itemsMap.values()) {
    const itemRec = recipeByItem.get(item.guid)
    const isDisc = isTripa(item.name) || isFullCheesecake(item.name)
    const isNonFood = isEmployeeOrDiscount(item.name)

    const baseRecord = {
      guid: item.guid,
      name: item.name,
      totalQuantity: item.totalQuantity,
      totalNetSales: Math.round(item.totalNetSales * 100) / 100,
      storeCount: item.storesSeen.size,
      stores: Array.from(item.storesSeen).sort(),
      firstDate: item.firstDate,
      lastDate: item.lastDate,
      diningGroups: Array.from(item.diningGroups).sort(),
    }

    if (isDisc) {
      discontinuedItems.push({ ...baseRecord, reason: 'Producto descontinuado (Tripa o Full Cheesecake)' })
    } else if (isNonFood) {
      nonFoodOrDiscounts.push({ ...baseRecord, reason: 'Registro no consumible / Descuento / Empleado' })
    } else if (!itemRec || itemRec.length === 0) {
      unmappedItems.push({ ...baseRecord, reason: 'Sin receta en Supabase recipes' })
    } else {
      // Verificar si la receta tiene ingredientes válidos
      const hasFood = itemRec.some(r => r.type === 'food' || !r.type)
      const hasPackaging = itemRec.some(r => r.type && r.type.startsWith('cogs_'))
      const invalidIngredients = itemRec.filter(r => !invMap.has(r.inventory_item_id))

      if (invalidIngredients.length > 0) {
        partialItems.push({
          ...baseRecord,
          reason: 'Ingredientes huérfanos (no existen en inventory_items)',
          invalidCount: invalidIngredients.length,
          ingredientCount: itemRec.length,
        })
      } else if (!hasFood) {
        partialItems.push({
          ...baseRecord,
          reason: 'Receta sin insumos clasificados como food',
          ingredientCount: itemRec.length,
        })
      } else {
        mappedItems.push({
          ...baseRecord,
          ingredientCount: itemRec.length,
          hasPackaging,
        })
      }
    }
  }

  // Ordenar por volumen de ventas descendente
  unmappedItems.sort((a, b) => b.totalNetSales - a.totalNetSales)
  partialItems.sort((a, b) => b.totalNetSales - a.totalNetSales)
  discontinuedItems.sort((a, b) => b.totalNetSales - a.totalNetSales)
  mappedItems.sort((a, b) => b.totalNetSales - a.totalNetSales)

  console.log('\n========================================================')
  console.log('📊 RESUMEN AUDITORÍA PMIX AGOSTO - SEPTIEMBRE 2026')
  console.log('========================================================')
  console.log(`- Ítems Toast vendidos: ${itemsMap.size}`)
  console.log(`- Totalmente mapeados con receta válida: ${mappedItems.length}`)
  console.log(`- SIN RECETA en Supabase: ${unmappedItems.length}`)
  console.log(`- Con receta PARCIAL / ingredientes inválidos: ${partialItems.length}`)
  console.log(`- Descontinuados detectados: ${discontinuedItems.length}`)
  console.log(`- Registros no consumibles (Empleado/Descuento): ${nonFoodOrDiscounts.length}`)

  console.log('\nTop 20 ítems SIN RECETA por volumen de ventas ($):')
  unmappedItems.slice(0, 20).forEach((item, idx) => {
    console.log(`${idx + 1}. [${item.guid}] ${item.name} | Qty: ${item.totalQuantity} | Ventas: $${item.totalNetSales.toLocaleString()} | Tiendas: ${item.storeCount}`)
  })

  if (discontinuedItems.length > 0) {
    console.log('\n⚠️ Ítems DESCONTINUADOS que siguen apareciendo en ventas:')
    discontinuedItems.forEach(item => {
      console.log(`- [${item.guid}] ${item.name} | Qty: ${item.totalQuantity} | Ventas: $${item.totalNetSales.toLocaleString()} | Tiendas: ${item.stores.join(', ')}`)
    })
  }

  // Guardar reporte detallado en JSON
  const reportPath = path.join(process.cwd(), 'reports', 'audit-pmix-catalog-gaps-2026-09-24.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({
    auditRange: { start: '2026-08-01', end: '2026-09-23', closedDays: 54 },
    summary: {
      totalSoldItems: itemsMap.size,
      mappedCount: mappedItems.length,
      unmappedCount: unmappedItems.length,
      partialCount: partialItems.length,
      discontinuedCount: discontinuedItems.length,
      nonFoodCount: nonFoodOrDiscounts.length,
    },
    unmappedItems,
    partialItems,
    discontinuedItems,
    nonFoodOrDiscounts,
  }, null, 2))

  console.log(`\n💾 Reporte guardado en: ${reportPath}`)
}

runAudit().catch(err => {
  console.error('Error fatal:', err)
  process.exitCode = 1
})
