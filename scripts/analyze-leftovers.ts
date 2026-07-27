/**
 * Script de análisis: Sobrantes históricos vs Consumo PMIX
 * Consulta Supabase directamente para cruzar datos reales
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
)

async function analyze() {
  console.log('=== ANÁLISIS HISTÓRICO: SOBRANTES vs PEDIDOS vs CONSUMO PMIX ===\n')

  // 1. ¿Cuántas órdenes históricas hay?
  const { data: orderStats, error: e1 } = await supabase
    .from('inventory_orders')
    .select('id, store_id, order_date, status, order_type')
    .in('status', ['sent', 'received', 'pending', 'draft'])
    .order('order_date', { ascending: false })
    .limit(500)

  if (e1) { console.error('Error orders:', e1.message); return }

  const sentOrders = orderStats?.filter(o => o.status === 'sent') || []
  const dates = orderStats?.map(o => o.order_date) || []
  const uniqueDates = [...new Set(dates)]
  const uniqueStores = [...new Set(orderStats?.map(o => o.store_id) || [])]

  console.log(`📊 RESUMEN DE ÓRDENES HISTÓRICAS:`)
  console.log(`   Total órdenes: ${orderStats?.length}`)
  console.log(`   Órdenes enviadas (sent): ${sentOrders.length}`)
  console.log(`   Rango de fechas: ${uniqueDates[uniqueDates.length - 1]} → ${uniqueDates[0]}`)
  console.log(`   Tiendas con órdenes: ${uniqueStores.length}`)
  console.log(`   Tipos: ${[...new Set(orderStats?.map(o => o.order_type))].join(', ')}`)
  console.log()

  // 2. Traer líneas de órdenes recientes con sobrantes (últimas 2 semanas de una tienda)
  const recentStoreId = uniqueStores[0]
  const { data: recentOrders } = await supabase
    .from('inventory_orders')
    .select('id, order_date, status')
    .eq('store_id', recentStoreId)
    .eq('order_type', 'daily')
    .in('status', ['sent', 'received', 'pending', 'draft'])
    .order('order_date', { ascending: false })
    .limit(10)

  if (!recentOrders || recentOrders.length === 0) {
    console.log('❌ No hay órdenes recientes para analizar')
    return
  }

  console.log(`📋 ÚLTIMAS 10 ÓRDENES DIARIAS DE TIENDA ${recentStoreId}:`)
  for (const o of recentOrders) {
    console.log(`   ${o.order_date} - Status: ${o.status} - ID: ${o.id}`)
  }
  console.log()

  // 3. Traer las líneas detalladas de las últimas 5 órdenes con sobrantes
  const orderIds = recentOrders.slice(0, 5).map(o => o.id)
  const { data: lines } = await supabase
    .from('inventory_order_lines')
    .select('order_id, inventory_item_id, leftover_value, calculated_qty, adjusted_qty, final_qty, par_value')
    .in('order_id', orderIds)

  // Traer nombres de items
  const itemIds = [...new Set(lines?.map(l => l.inventory_item_id) || [])]
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name, unit_type, quantity_per_unit, yield_percent, category_id')
    .in('id', itemIds.slice(0, 100))

  const itemMap = new Map((items || []).map(i => [i.id, i]))
  const orderDateMap = new Map((recentOrders || []).map(o => [o.id, o.order_date]))

  // 4. Agrupar sobrantes por producto a lo largo de los días
  console.log(`📊 HISTORIAL DE SOBRANTES POR PRODUCTO (últimas 5 órdenes de Tienda ${recentStoreId}):`)
  console.log('─'.repeat(120))
  console.log(`${'Producto'.padEnd(35)} | ${'Unidad'.padEnd(8)} | ${'Yield%'.padEnd(7)} | Fechas → Sobrante / PAR / Pedido`)
  console.log('─'.repeat(120))

  // Agrupar por item
  const itemHistory = new Map<string, { date: string; leftover: number | null; par: number | null; qty: number | null }[]>()
  for (const l of (lines || [])) {
    const date = orderDateMap.get(l.order_id) || '?'
    const key = l.inventory_item_id
    if (!itemHistory.has(key)) itemHistory.set(key, [])
    itemHistory.get(key)!.push({
      date,
      leftover: l.leftover_value,
      par: l.par_value,
      qty: l.final_qty || l.adjusted_qty || l.calculated_qty
    })
  }

  // Mostrar solo items con datos interesantes (carnes primero, luego otros)
  const meatKeywords = ['asada', 'pollo', 'pastor', 'carnitas', 'cabeza', 'lengua', 'buche', 'chorizo']
  const sortedItems = [...itemHistory.entries()].sort((a, b) => {
    const nameA = (itemMap.get(a[0])?.name || '').toLowerCase()
    const nameB = (itemMap.get(b[0])?.name || '').toLowerCase()
    const isMeatA = meatKeywords.some(k => nameA.includes(k))
    const isMeatB = meatKeywords.some(k => nameB.includes(k))
    if (isMeatA && !isMeatB) return -1
    if (!isMeatA && isMeatB) return 1
    return nameA.localeCompare(nameB)
  })

  let meatsPrinted = false
  let othersPrinted = false
  for (const [itemId, history] of sortedItems) {
    const item = itemMap.get(itemId)
    if (!item) continue
    const isMeat = meatKeywords.some(k => (item.name || '').toLowerCase().includes(k))

    if (isMeat && !meatsPrinted) {
      console.log('\n  🥩 === CARNES ===')
      meatsPrinted = true
    }
    if (!isMeat && !othersPrinted) {
      console.log('\n  📦 === OTROS PRODUCTOS ===')
      othersPrinted = true
    }

    const sorted = history.sort((a, b) => a.date.localeCompare(b.date))
    const details = sorted.map(h =>
      `${h.date}: Sob=${h.leftover ?? 'NULL'} / PAR=${h.par ?? '-'} / Ped=${h.qty ?? '-'}`
    ).join('  |  ')

    console.log(`  ${(item.name || '?').substring(0, 33).padEnd(33)} | ${(item.unit_type || '?').padEnd(8)} | ${String(item.yield_percent ?? '-').padEnd(7)} | ${details}`)
  }

  // 5. Verificar tabla inventory_usage_log
  console.log('\n\n=== VERIFICACIÓN: inventory_usage_log ===')
  const { data: usageLog, error: usageErr } = await supabase
    .from('inventory_usage_log')
    .select('*')
    .limit(5)

  if (usageErr) {
    console.log(`❌ Error al consultar inventory_usage_log: ${usageErr.message}`)
  } else if (!usageLog || usageLog.length === 0) {
    console.log('⚠️  La tabla inventory_usage_log existe pero está VACÍA (0 registros)')
    console.log('   → Esta es la tabla que necesitamos poblar con el consumo teórico diario por ingrediente')
  } else {
    console.log(`✅ inventory_usage_log tiene ${usageLog.length}+ registros`)
    console.log('   Ejemplo:', JSON.stringify(usageLog[0], null, 2))
  }

  // 6. Verificar tabla inventory_counts (conteos físicos)
  console.log('\n\n=== VERIFICACIÓN: inventory_counts (conteos físicos) ===')
  const { data: counts, error: countsErr } = await supabase
    .from('inventory_counts')
    .select('*')
    .limit(5)

  if (countsErr) {
    console.log(`❌ Error al consultar inventory_counts: ${countsErr.message}`)
    console.log(`   Código: ${countsErr.code}, Detalle: ${countsErr.details}`)
  } else if (!counts || counts.length === 0) {
    console.log('⚠️  La tabla inventory_counts está VACÍA (0 registros)')
    console.log('   → Los conteos se guardan directamente como snapshots en inventory_order_lines.leftover_value')
  } else {
    console.log(`✅ inventory_counts tiene ${counts.length}+ registros`)
  }

  // 7. Verificar PMIX daily cache
  console.log('\n\n=== VERIFICACIÓN: pmix_daily_cache ===')
  const { data: pmix, error: pmixErr } = await supabase
    .from('pmix_daily_cache')
    .select('business_date, store_id')
    .order('business_date', { ascending: false })
    .limit(10)

  if (pmixErr) {
    console.log(`❌ Error: ${pmixErr.message}`)
  } else {
    console.log(`✅ pmix_daily_cache últimas 10 entradas:`)
    for (const p of (pmix || [])) {
      console.log(`   ${p.business_date} - Store: ${p.store_id}`)
    }
  }

  // 8. Verificar food_cost_daily_cache
  console.log('\n\n=== VERIFICACIÓN: food_cost_daily_cache ===')
  const { data: fc, error: fcErr } = await supabase
    .from('food_cost_daily_cache')
    .select('business_date, store_id, store_name, total_cost, net_sales, cost_percentage, total_meat_lbs')
    .order('business_date', { ascending: false })
    .limit(10)

  if (fcErr) {
    console.log(`❌ Error: ${fcErr.message}`)
  } else {
    console.log(`✅ food_cost_daily_cache últimas 10 entradas:`)
    for (const f of (fc || [])) {
      console.log(`   ${f.business_date} | ${(f.store_name || '').substring(0, 20).padEnd(20)} | Cost: $${f.total_cost} | Sales: $${f.net_sales} | %: ${f.cost_percentage}% | Meat: ${f.total_meat_lbs} lbs`)
    }
  }

  // 9. Verificar meat_consumption_history
  console.log('\n\n=== VERIFICACIÓN: meat_consumption_history ===')
  const { data: meatHist, error: meatErr } = await supabase
    .from('meat_consumption_history')
    .select('business_date, store_id, meat_type, raw_lbs')
    .order('business_date', { ascending: false })
    .limit(20)

  if (meatErr) {
    console.log(`❌ Error: ${meatErr.message}`)
  } else {
    console.log(`✅ meat_consumption_history últimas 20 entradas:`)
    // Agrupar por fecha
    const byDate = new Map<string, { type: string; lbs: number }[]>()
    for (const m of (meatHist || [])) {
      const key = `${m.business_date}|${m.store_id}`
      if (!byDate.has(key)) byDate.set(key, [])
      byDate.get(key)!.push({ type: m.meat_type, lbs: Number(m.raw_lbs) })
    }
    for (const [key, entries] of byDate) {
      const [date, store] = key.split('|')
      const summary = entries.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + e.lbs
        return acc
      }, {} as Record<string, number>)
      const parts = Object.entries(summary).map(([t, l]) => `${t}: ${l.toFixed(1)} lbs`).join(', ')
      console.log(`   ${date} | Store ${store} | ${parts}`)
    }
  }

  // 10. Contar recetas registradas
  console.log('\n\n=== COBERTURA DE RECETAS ===')
  const { count: recipeCount } = await supabase
    .from('recipes')
    .select('*', { count: 'exact', head: true })

  const { count: ingredientCount } = await supabase
    .from('recipe_ingredients')
    .select('*', { count: 'exact', head: true })

  // Ver si la tabla se llama 'recipes' o tiene otra estructura
  const { data: recipeSample } = await supabase
    .from('recipes')
    .select('*')
    .limit(3)

  console.log(`   Total recetas (recipes): ${recipeCount ?? 'N/A'}`)
  console.log(`   Total ingredientes (recipe_ingredients): ${ingredientCount ?? 'N/A'}`)
  if (recipeSample && recipeSample.length > 0) {
    console.log(`   Ejemplo receta:`, JSON.stringify(recipeSample[0], null, 2))
  }

  console.log('\n\n=== FIN DEL ANÁLISIS ===')
}

analyze().catch(console.error)
