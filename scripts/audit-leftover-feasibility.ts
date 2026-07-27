/**
 * AUDITORÍA EXHAUSTIVA: ¿Qué tan viable es el cálculo automático?
 * 
 * Preguntas clave que necesitamos responder:
 * 1. ¿Cuántos productos del template de orden diaria TIENEN receta vs NO tienen?
 * 2. ¿Hay continuidad diaria en los sobrantes o hay días sin datos (gaps)?
 * 3. ¿Las unidades de receta se pueden convertir correctamente a unidades de orden?
 * 4. ¿Cuánto varían los sobrantes vs el consumo implícito calculado?
 * 5. ¿Las recetas cubren TODOS los ingredientes o solo las carnes?
 * 6. ¿Qué productos nunca tendrán receta y necesitan burn rate?
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function deepAudit() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  AUDITORÍA EXHAUSTIVA: VIABILIDAD DEL SOBRANTE TEÓRICO')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // ═══════════════════════════════════════════════════
  // PREGUNTA 1: Cobertura de recetas vs items de orden
  // ═══════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 1: ¿Cuántos items del pedido diario TIENEN receta?')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Traer todos los items que aparecen en órdenes diarias
  const { data: orderItemIds } = await supabase
    .from('inventory_order_lines')
    .select('inventory_item_id')

  const uniqueOrderItemIds = [...new Set((orderItemIds || []).map(o => o.inventory_item_id))]

  // Traer info de esos items
  const { data: orderItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, quantity_per_unit, yield_percent, is_bodega, category_id')
    .in('id', uniqueOrderItemIds)

  // Traer todas las recetas y ver qué inventory_item_ids están cubiertos
  const { data: allRecipes } = await supabase
    .from('recipes')
    .select('id, toast_menu_item_guid, inventory_item_id, quantity, unit, type')

  // Crear set de inventory_item_ids que aparecen en recetas
  const itemsInRecipes = new Set((allRecipes || []).map(r => r.inventory_item_id))

  // Clasificar cada item del pedido
  const withRecipe: any[] = []
  const withoutRecipe: any[] = []

  for (const item of (orderItems || [])) {
    if (itemsInRecipes.has(item.id)) {
      withRecipe.push(item)
    } else {
      withoutRecipe.push(item)
    }
  }

  console.log(`  Total items que aparecen en órdenes diarias: ${uniqueOrderItemIds.length}`)
  console.log(`  ✅ Items CON receta (consumo calculable por Toast): ${withRecipe.length}`)
  console.log(`  ❌ Items SIN receta (necesitan burn rate): ${withoutRecipe.length}`)
  console.log(`  📊 Cobertura de recetas: ${((withRecipe.length / uniqueOrderItemIds.length) * 100).toFixed(1)}%\n`)

  console.log('  ✅ ITEMS CON RECETA (se puede calcular consumo teórico por Toast):')
  for (const item of withRecipe.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))) {
    // Contar en cuántas recetas aparece
    const recipeCount = (allRecipes || []).filter(r => r.inventory_item_id === item.id).length
    const types = [...new Set((allRecipes || []).filter(r => r.inventory_item_id === item.id).map(r => r.type))].join(', ')
    console.log(`     ${(item.name || '?').padEnd(40)} | ${(item.unit_type || '?').padEnd(12)} | En ${recipeCount} recetas | Tipos: ${types}`)
  }

  console.log('\n  ❌ ITEMS SIN RECETA (necesitan burn rate o conteo manual):')
  for (const item of withoutRecipe.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))) {
    console.log(`     ${(item.name || '?').padEnd(40)} | ${(item.unit_type || '?').padEnd(12)} | Bodega: ${item.is_bodega ? 'Sí' : 'No'}`)
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 2: Continuidad de datos día a día
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 2: ¿Hay continuidad diaria? (¿gaps en los datos?)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Traer todas las órdenes diarias agrupadas por tienda
  const { data: allOrders } = await supabase
    .from('inventory_orders')
    .select('store_id, order_date, status, order_type')
    .eq('order_type', 'daily')
    .in('status', ['sent', 'received', 'pending', 'draft'])
    .order('order_date', { ascending: true })

  // Agrupar por tienda
  const storeOrders = new Map<number, string[]>()
  for (const o of (allOrders || [])) {
    if (!storeOrders.has(o.store_id)) storeOrders.set(o.store_id, [])
    storeOrders.get(o.store_id)!.push(o.order_date)
  }

  // Traer nombres de tiendas
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name')
    .eq('is_active', true)

  const storeNameMap = new Map((stores || []).map(s => [s.id, s.name]))

  console.log('  Tienda                    | Total Días | Primer Día  | Último Día  | Gaps (días sin orden)')
  console.log('  ' + '─'.repeat(95))

  for (const [storeId, dates] of storeOrders) {
    const sorted = [...new Set(dates)].sort()
    const storeName = (storeNameMap.get(storeId) || `Store ${storeId}`).substring(0, 25).padEnd(25)

    // Detectar gaps
    const gaps: string[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + 'T12:00:00')
      const curr = new Date(sorted[i] + 'T12:00:00')
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays > 1) {
        gaps.push(`${sorted[i - 1]}→${sorted[i]} (${diffDays - 1}d)`)
      }
    }

    console.log(`  ${storeName} | ${String(sorted.length).padEnd(10)} | ${sorted[0]} | ${sorted[sorted.length - 1]} | ${gaps.length === 0 ? '✅ Sin gaps' : `⚠️ ${gaps.length} gaps: ${gaps.slice(0, 3).join(', ')}${gaps.length > 3 ? '...' : ''}`}`)
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 3: ¿Las recetas cubren TODOS los tipos de ingrediente?
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 3: Distribución de tipos de ingredientes en recetas')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const typeCounts: Record<string, number> = {}
  for (const r of (allRecipes || [])) {
    const t = r.type || 'null/undefined'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  }

  console.log('  Tipo de Ingrediente     | Recetas | Descripción')
  console.log('  ' + '─'.repeat(70))
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const desc = {
      'food': 'Ingrediente alimenticio general (materia prima)',
      'raw': 'Producto crudo (se aplica yield de cocción)',
      'cooked': 'Producto cocido (cantidad plated, yield inverso)',
      'cogs_dine_in': 'Empaque/desechable para comer aquí',
      'cogs_takeout': 'Empaque/desechable para llevar',
      'cogs_delivery': 'Empaque/desechable para delivery',
      'null/undefined': '⚠️ Sin clasificar'
    }[type] || 'Otro'
    console.log(`  ${type.padEnd(23)} | ${String(count).padEnd(7)} | ${desc}`)
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 4: Unidades de receta vs unidades de orden
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 4: Compatibilidad de unidades (receta vs orden)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Para items con receta, comparar la unidad de la receta vs la unidad de compra del item
  const unitMismatches: any[] = []
  const unitMatches: any[] = []

  for (const item of withRecipe) {
    const itemRecipes = (allRecipes || []).filter(r => r.inventory_item_id === item.id)
    const recipeUnits = [...new Set(itemRecipes.map(r => r.unit))]
    const orderUnit = item.unit_type || '?'
    const qtyPerUnit = item.quantity_per_unit

    // Check if conversion is straightforward
    const recipeUnitStr = recipeUnits.join('/')
    const entry = {
      name: item.name,
      recipeUnits: recipeUnitStr,
      orderUnit,
      qtyPerUnit,
      yieldPct: item.yield_percent
    }

    // Simple compatibility check
    const compatible = recipeUnits.every(ru => {
      const ruLower = (ru || '').toLowerCase()
      const ouLower = (orderUnit || '').toLowerCase()
      // Same unit family
      if (ruLower === ouLower) return true
      // Weight conversions (oz ↔ lb)
      if (['oz', 'lb', 'g', 'kg'].includes(ruLower) && ['lb', 'oz', 'g', 'kg'].includes(ouLower)) return true
      // Piece/count
      if (['pza', 'pz', 'ct', 'dz', 'unit'].includes(ruLower) && ['pza', 'pz', 'ct', 'dz', 'unit'].includes(ouLower)) return true
      // Volume
      if (['gal', 'l', 'ml', 'oz'].includes(ruLower) && ['gal', 'l', 'ml'].includes(ouLower)) return true
      return false
    })

    if (compatible) {
      unitMatches.push(entry)
    } else {
      unitMismatches.push(entry)
    }
  }

  console.log(`  ✅ Conversión de unidades compatible: ${unitMatches.length} items`)
  console.log(`  ⚠️ Posibles incompatibilidades de unidades: ${unitMismatches.length} items\n`)

  if (unitMismatches.length > 0) {
    console.log('  ⚠️ ITEMS CON POSIBLE INCOMPATIBILIDAD DE UNIDADES:')
    for (const m of unitMismatches) {
      console.log(`     ${(m.name || '?').padEnd(35)} | Receta: ${(m.recipeUnits || '?').padEnd(8)} → Orden: ${(m.orderUnit || '?').padEnd(12)} | qty_per_unit: ${m.qtyPerUnit} | yield: ${m.yieldPct}%`)
    }
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 5: Consumo implícito vs datos disponibles
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 5: Consumo implícito calculado de datos históricos')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Tomemos una tienda con buena data y calculemos el consumo implícito
  // para ver la variabilidad
  const targetStoreId = [...storeOrders.keys()][0]
  const targetStoreName = storeNameMap.get(targetStoreId) || `Store ${targetStoreId}`

  const { data: storeOrdersFull } = await supabase
    .from('inventory_orders')
    .select('id, order_date, status')
    .eq('store_id', targetStoreId)
    .eq('order_type', 'daily')
    .in('status', ['sent', 'received', 'pending', 'draft'])
    .order('order_date', { ascending: true })

  if (storeOrdersFull && storeOrdersFull.length >= 3) {
    const orderIdList = storeOrdersFull.map(o => o.id)
    const { data: allLines } = await supabase
      .from('inventory_order_lines')
      .select('order_id, inventory_item_id, leftover_value, par_value, calculated_qty, adjusted_qty, final_qty')
      .in('order_id', orderIdList)

    // Map order_id to date
    const idToDate = new Map(storeOrdersFull.map(o => [o.id, o.order_date]))

    // Build timeline per item: date → { leftover, ordered }
    const itemTimeline = new Map<string, { date: string; leftover: number | null; ordered: number | null; par: number | null }[]>()
    for (const line of (allLines || [])) {
      const date = idToDate.get(line.order_id) || '?'
      const key = line.inventory_item_id
      if (!itemTimeline.has(key)) itemTimeline.set(key, [])
      itemTimeline.get(key)!.push({
        date,
        leftover: line.leftover_value,
        ordered: line.final_qty || line.adjusted_qty || line.calculated_qty,
        par: line.par_value
      })
    }

    // Calculate implicit consumption for key items
    console.log(`  Tienda: ${targetStoreName} (ID: ${targetStoreId})`)
    console.log(`  Fórmula: Consumo = Sobrante_Ayer + Pedido_Hoy - Sobrante_Hoy\n`)

    // Pick some interesting items (meats + high volume)
    const interestingItems = [...itemTimeline.entries()]
      .filter(([_, timeline]) => timeline.length >= 4 && timeline.every(t => t.leftover !== null))
      .slice(0, 15)

    for (const [itemId, timeline] of interestingItems) {
      const item = (orderItems || []).find(i => i.id === itemId)
      if (!item) continue

      const sorted = timeline.sort((a, b) => a.date.localeCompare(b.date))
      const consumptions: number[] = []

      console.log(`  📦 ${item.name} (${item.unit_type}):`)

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const curr = sorted[i]

        // Check if consecutive days
        const prevDate = new Date(prev.date + 'T12:00:00')
        const currDate = new Date(curr.date + 'T12:00:00')
        const daysDiff = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))

        if (daysDiff === 1 && prev.leftover !== null && curr.leftover !== null && prev.ordered !== null) {
          // Consumption = yesterday_leftover + today_order - today_leftover
          // But wait: the "ordered" on day X is what arrives on day X+1
          // Actually: leftover_value on order_date X = what was counted on date X
          // ordered on date X = what will arrive for date X+1
          // So: consumption on date X = leftover_X-1 + ordered_X-1 (arrived today) - leftover_X
          const consumption = (prev.leftover || 0) + (prev.ordered || 0) - (curr.leftover || 0)
          consumptions.push(consumption)
          console.log(`     ${prev.date}→${curr.date}: Sob=${prev.leftover} + Ped=${prev.ordered} - SobHoy=${curr.leftover} = Consumo: ${consumption}`)
        }
      }

      if (consumptions.length > 0) {
        const avg = consumptions.reduce((a, b) => a + b, 0) / consumptions.length
        const min = Math.min(...consumptions)
        const max = Math.max(...consumptions)
        const stddev = Math.sqrt(consumptions.reduce((sum, c) => sum + (c - avg) ** 2, 0) / consumptions.length)
        console.log(`     📊 Promedio: ${avg.toFixed(1)} | Min: ${min} | Max: ${max} | StdDev: ${stddev.toFixed(1)} | Variabilidad: ${((stddev / avg) * 100).toFixed(1)}%`)
      }
      console.log()
    }
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 6: ¿Cuántos platillos en Toast tienen receta?
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 6: Cobertura de recetas en Toast Menu Items')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Traer platillos de Toast
  const { count: toastItemCount } = await supabase
    .from('toast_menu_items')
    .select('*', { count: 'exact', head: true })

  // Traer GUIDs únicos que tienen receta
  const recipeGuids = [...new Set((allRecipes || []).map(r => r.toast_menu_item_guid))]

  console.log(`  Total platillos en Toast Menu: ${toastItemCount ?? 'N/A'}`)
  console.log(`  Platillos con receta asignada (GUIDs únicos): ${recipeGuids.length}`)
  if (toastItemCount) {
    console.log(`  Cobertura Toast: ${((recipeGuids.length / toastItemCount) * 100).toFixed(1)}%`)
  }

  // ═══════════════════════════════════════════════════
  // PREGUNTA 7: PMIX - ¿Cuántos items vendidos tienen receta?
  // ═══════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  PREGUNTA 7: ¿Cuántos items VENDIDOS en PMIX tienen receta?')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Get a recent PMIX cache entry and check coverage
  const { data: recentPmix } = await supabase
    .from('pmix_daily_cache')
    .select('business_date, store_id, pmix_data')
    .order('business_date', { ascending: false })
    .limit(1)

  if (recentPmix && recentPmix.length > 0) {
    const pmixData = recentPmix[0].pmix_data
    let pmixItems: any[] = []
    try {
      pmixItems = typeof pmixData === 'string' ? JSON.parse(pmixData) : pmixData
    } catch { pmixItems = [] }

    const recipeGuidSet = new Set(recipeGuids)
    let withR = 0, withoutR = 0, totalQty = 0, qtyWithR = 0

    const missingRecipeItems: { name: string; qty: number; sales: number }[] = []

    for (const item of pmixItems) {
      const hasRecipe = recipeGuidSet.has(item.guid)
      const qty = item.quantity || 0
      totalQty += qty
      if (hasRecipe) {
        withR++
        qtyWithR += qty
      } else {
        withoutR++
        missingRecipeItems.push({ name: item.name, qty, sales: item.net_sales || 0 })
      }
    }

    console.log(`  PMIX del ${recentPmix[0].business_date} (${recentPmix[0].store_id}):`)
    console.log(`  Total items vendidos (líneas únicas): ${pmixItems.length}`)
    console.log(`  ✅ Con receta: ${withR} items (${((withR / pmixItems.length) * 100).toFixed(1)}%)`)
    console.log(`  ❌ Sin receta: ${withoutR} items (${((withoutR / pmixItems.length) * 100).toFixed(1)}%)`)
    console.log(`  📊 Cobertura por VOLUMEN de ventas: ${((qtyWithR / totalQty) * 100).toFixed(1)}% de unidades vendidas tienen receta`)

    if (missingRecipeItems.length > 0) {
      console.log(`\n  ❌ TOP 20 ITEMS VENDIDOS SIN RECETA (por volumen):`)
      missingRecipeItems
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 20)
        .forEach(item => {
          console.log(`     ${(item.name || '?').substring(0, 50).padEnd(50)} | Qty: ${item.qty} | Sales: $${item.sales.toFixed(2)}`)
        })
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  FIN DE LA AUDITORÍA EXHAUSTIVA')
  console.log('═══════════════════════════════════════════════════════════════')
}

deepAudit().catch(console.error)
