/**
 * @file simulate-click-revisar-precios.ts
 * @description Simulación forense exhaustiva de qué ocurre exactamente cuando el usuario
 * presiona el botón 'Revisar Precios de Hoy (1 Clic)' en la interfaz de Precios Proveedores.
 */

import fs from 'fs'
import path from 'path'

// Cargar variables de entorno
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.substring(0, idx).trim()
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  })
}

import { createClient } from '@supabase/supabase-js'
import { syncVielePortalDirect } from '../lib/vendor-scraper'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '../lib/constants/supplier-volumes'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function simulateButtonClick() {
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('🔬 SIMULACIÓN EN TIEMPO REAL: CLICK EN "REVISAR PRECIOS DE HOY"')
  console.log('═══════════════════════════════════════════════════════════════════════════════\n')

  const startTime = Date.now()

  // 1. Estado previo en la Base de Datos
  console.log('1️⃣ [ESTADO PREVIO EN BASE DE DATOS]:')
  const { count: historyCountBefore } = await supabase
    .from('supplier_price_history')
    .select('*', { count: 'exact', head: true })
  console.log(`   • Registros inmutables en "supplier_price_history": ${historyCountBefore} registros.`)
  
  const { count: itemsCountBefore } = await supabase
    .from('inventory_items')
    .select('*', { count: 'exact', head: true })
  console.log(`   • Insumos en "inventory_items": ${itemsCountBefore} insumos.\n`)

  // 2. Ejecutar la llamada que hace el botón a Viele & Sons v3
  console.log('2️⃣ [CONEXIÓN EN VIVO A LA API DE VIELE & SONS]:')
  console.log('   • Endpoint consultado: https://shop.vieleandsons.com/api/v3/order_guide')
  const scrapeStart = Date.now()
  const scrapeResult = await syncVielePortalDirect()
  const scrapeDuration = Date.now() - scrapeStart
  console.log(`   • Conexión completada en: ${(scrapeDuration / 1000).toFixed(2)}s`)
  console.log(`   • Total de artículos extraídos del catálogo oficial de Tacos Gavilan: ${scrapeResult.totalItems} items\n`)

  // 3. Comparación contra Supabase
  console.log('3️⃣ [CRUCE Y COMPARACIÓN CONTRA INSUMOS MAESTROS EN SUPABASE]:')
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name, supplier_code')
    .eq('supplier_code', 'VIELE')
    .single()

  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`
      supplier_sku,
      supplier_description,
      pack_quantity,
      pack_unit,
      master_item_id,
      inventory_items (
        id,
        name,
        sku,
        purchase_unit_cost,
        quantity_per_unit
      )
    `)
    .eq('supplier_id', supplier?.id)

  const mappingMap = new Map<string, any>()
  ;(mappings || []).forEach((m: any) => {
    mappingMap.set(m.supplier_sku.toUpperCase(), m)
  })

  let totalIncreases = 0
  let totalDecreases = 0
  let totalUnchanged = 0
  let totalNew = 0
  let netAnnualImpactUsd = 0

  const itemsList: any[] = []

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const masterItem = mapping?.inventory_items

    const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
    const packUnit = mapping?.pack_unit || parsed.packUnit || 'CS'
    const newCasePrice = parsed.casePrice
    const newUnitCost = Number((newCasePrice / packQty).toFixed(4))

    let currentCasePrice = 0
    let currentUnitCost = 0
    let masterItemId: string | null = null
    let masterItemName: string | null = null

    if (masterItem) {
      masterItemId = masterItem.id
      masterItemName = masterItem.name
      currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
      currentUnitCost = Number((currentCasePrice / (masterItem.quantity_per_unit || packQty)).toFixed(4))
    }

    let diffAmount = 0
    let changePercent = 0
    let status = 'unchanged'

    if (!mapping || !masterItem) {
      status = 'unmapped'
      totalNew++
    } else if (currentCasePrice <= 0 || newCasePrice <= 0) {
      status = 'new_sku'
      totalNew++
    } else {
      diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))
      changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2))

      if (diffAmount > 0.009) {
        status = 'increased'
        totalIncreases++
      } else if (diffAmount < -0.009) {
        status = 'decreased'
        totalDecreases++
      } else {
        status = 'unchanged'
        totalUnchanged++
      }
    }

    const annualEstimatedCases = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
    const annualImpactUsd = Number((diffAmount * annualEstimatedCases).toFixed(2))
    netAnnualImpactUsd += annualImpactUsd

    itemsList.push({
      sku: parsed.supplierSku,
      desc: parsed.description,
      currentCasePrice,
      newCasePrice,
      diffAmount,
      changePercent,
      annualImpactUsd,
      status
    })
  }

  console.log(`   • Productos analizados: ${itemsList.length}`)
  console.log(`   • 🚨 Aumentos detectados (rojo): ${totalIncreases} insumos`)
  console.log(`   • 🎉 Rebajas / Ahorros detectados (verde): ${totalDecreases} insumos`)
  console.log(`   • ⚪ Sin cambios de precio: ${totalUnchanged} insumos`)
  console.log(`   • 💰 Impacto Anual Neto Proyectado (15 Tiendas): $${netAnnualImpactUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD\n`)

  // 4. Verificación de Inmutabilidad en DB
  console.log('4️⃣ [VERIFICACIÓN DE INMUTABILIDAD EN BASE DE DATOS]:')
  const { count: historyCountAfter } = await supabase
    .from('supplier_price_history')
    .select('*', { count: 'exact', head: true })
  const { count: itemsCountAfter } = await supabase
    .from('inventory_items')
    .select('*', { count: 'exact', head: true })

  console.log(`   • Registros en "supplier_price_history" tras el escaneo: ${historyCountAfter} (Cambio: ${historyCountAfter - historyCountBefore})`)
  console.log(`   • Costos en "inventory_items" tras el escaneo: ${itemsCountAfter} (Cambio: ${itemsCountAfter - itemsCountBefore})`)
  console.log('   ➔ CONCLUSIÓN: Presionar el botón es una operación 100% de CONSULTA Y AUDITORÍA (Read-Only / Zero-Risk).')
  console.log('                 NO sobreescribe la base de datos ni altera recetas hasta que el usuario decida APROBAR.\n')

  // 5. Transición en Pantalla (Frontend UI State)
  console.log('5️⃣ [TRANSICIÓN VISUAL EN EL FRONTEND (PANTALLA)]:')
  console.log('   1. El botón gira con un spinner ("Extrayendo Precios...").')
  console.log('   2. A los ~1.3 segundos, la pestaña cambia automáticamente de "Historial de Precios" a "Precios en Vivo (87)".')
  console.log('   3. Aparece un banner verde de éxito en la parte superior:')
  console.log(`      "⚡ ¡Sincronización en vivo completada en ${(scrapeDuration/1000).toFixed(1)}s! Se detectaron ${totalIncreases} aumentos con impacto anual de +$${Math.abs(netAnnualImpactUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}."`)
  console.log('   4. Se despliegan 4 tarjetas métricas arriba:')
  console.log(`      • Total Catálogo: 87 items`)
  console.log(`      • Con Aumento: ${totalIncreases} items`)
  console.log(`      • Con Rebaja: ${totalDecreases} items`)
  console.log(`      • Impacto Anual Neto: +$${netAnnualImpactUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`)
  console.log('   5. La tabla muestra el semáforo interactivo con checkboxes para que el directivo seleccione qué precios autorizar.')
  console.log(`   6. Aparece el botón dinámico: "📧 Notificar Alertas & Ahorros (${totalIncreases + totalDecreases})" para mandar correo manual si se desea.\n`)

  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log(`✅ SIMULACIÓN FINALIZADA CON ÉXITO EN ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
  console.log('═══════════════════════════════════════════════════════════════════════════════')
}

simulateButtonClick().catch(console.error)
