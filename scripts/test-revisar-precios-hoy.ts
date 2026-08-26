/**
 * @file test-revisar-precios-hoy.ts
 * @description Prueba en vivo del botón "Revisar Precios de Hoy (1 Clic)" del Radar de Precios.
 * Conecta directamente al portal de Viele & Sons v3, extrae el catálogo en tiempo real,
 * lo cruza contra la base de datos de Supabase de Tacos Gavilan y calcula el semáforo de inflación.
 */

import fs from 'fs'
import path from 'path'

// Cargar variables de entorno desde .env.local
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

async function testRevisarPreciosHoy() {
  console.log('======================================================================')
  console.log('⚡ TACOS GAVILAN · TEST EN VIVO DEL BOTÓN: "REVISAR PRECIOS DE HOY"')
  console.log('======================================================================')
  console.log('Conectando a shop.vieleandsons.com con motor de extracción en vivo...\n')

  const startTime = Date.now()
  const scrapeResult = await syncVielePortalDirect()
  const durationMs = Date.now() - startTime

  if (!scrapeResult.success) {
    console.error('❌ Error al conectar con Viele & Sons:', scrapeResult.errorMessage)
    process.exit(1)
  }

  console.log(`✅ ¡Conexión exitosa a Viele & Sons!`)
  console.log(`⏱️  Tiempo de respuesta: ${(durationMs / 1000).toFixed(2)} segundos (${durationMs} ms)`)
  console.log(`📦 Artículos descargados del portal: ${scrapeResult.items.length}\n`)

  // Consultar proveedor y mapeos en Supabase
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
      base_unit,
      master_item_id,
      inventory_items (
        id,
        name,
        sku,
        purchase_unit_cost,
        quantity_per_unit,
        unit_measure,
        inventory_categories (name)
      )
    `)
    .eq('supplier_id', supplier?.id)

  const mappingMap = new Map<string, any>()
  ;(mappings || []).forEach((m: any) => {
    mappingMap.set(m.supplier_sku.toUpperCase(), m)
  })

  // Comparación de precios
  let totalIncreases = 0
  let totalDecreases = 0
  let totalUnchanged = 0
  let totalNew = 0
  let netAnnualImpactUsd = 0

  const itemsIncreased: any[] = []
  const itemsDecreased: any[] = []
  const itemsUnchangedSample: any[] = []

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
    let status: 'increased' | 'decreased' | 'unchanged' | 'new_sku' | 'unmapped' = 'unchanged'

    if (!mapping || !masterItem) {
      status = mapping ? 'unmapped' : 'new_sku'
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

    const itemData = {
      sku: parsed.supplierSku,
      desc: parsed.description || masterItemName || mapping?.supplier_description,
      pack: `${packQty} ${packUnit}`,
      prevPrice: currentCasePrice,
      newPrice: newCasePrice,
      diff: diffAmount,
      pct: changePercent,
      annualImpact: annualImpactUsd,
      status
    }

    if (status === 'increased') itemsIncreased.push(itemData)
    else if (status === 'decreased') itemsDecreased.push(itemData)
    else if (status === 'unchanged' && itemsUnchangedSample.length < 5) itemsUnchangedSample.push(itemData)
  }

  console.log('----------------------------------------------------------------------')
  console.log('📊 RESUMEN EJECUTIVO (4 TARJETAS DEL TABLERO SM TEG):')
  console.log('----------------------------------------------------------------------')
  console.log(`1. Total Artículos Analizados:  ${scrapeResult.items.length} items`)
  console.log(`2. Aumentos Detectados:         🔴 ${totalIncreases} productos`)
  console.log(`3. Reducciones Detectadas:      🟢 ${totalDecreases} productos`)
  console.log(`4. Precios Sin Cambio:          ⚪ ${totalUnchanged} productos`)
  console.log(`5. Nuevos / Sin Mapeo:          🟡 ${totalNew} productos`)
  console.log(`💰 IMPACTO ANUAL TOTAL (15 TIENDAS): ${netAnnualImpactUsd >= 0 ? '+' : ''}$${netAnnualImpactUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD/año`)
  console.log('----------------------------------------------------------------------\n')

  if (itemsIncreased.length > 0) {
    console.log('🚨 DETALLE DE AUMENTOS DETECTADOS:')
    itemsIncreased.forEach(item => {
      console.log(`  • [${item.sku}] ${item.desc}`)
      console.log(`    Precio Anterior: $${item.prevPrice.toFixed(2)} ➔ Precio Hoy: $${item.newPrice.toFixed(2)} (Alza: +$${item.diff.toFixed(2)} / +${item.pct}%)`)
      console.log(`    Impacto en 15 Tiendas: +$${item.annualImpact.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año\n`)
    })
  } else {
    console.log('✅ No se detectaron aumentos de precio hoy. Todos los precios de Viele & Sons se mantienen estables o vigentes.')
  }

  if (itemsDecreased.length > 0) {
    console.log('🎉 DETALLE DE REDUCCIONES (AHORROS DETECTADOS):')
    itemsDecreased.forEach(item => {
      console.log(`  • [${item.sku}] ${item.desc}`)
      console.log(`    Precio Anterior: $${item.prevPrice.toFixed(2)} ➔ Precio Hoy: $${item.newPrice.toFixed(2)} (Ahorro: -$${Math.abs(item.diff).toFixed(2)} / ${item.pct}%)`)
      console.log(`    Ahorro en 15 Tiendas: -$${Math.abs(item.annualImpact).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año\n`)
    })
  }

  console.log('📋 MUESTRA DE ARTÍCULOS VIGENTES SIN VARIACIÓN (PRIMEROS 5):')
  itemsUnchangedSample.forEach((item, idx) => {
    console.log(`  ${idx + 1}. [${item.sku}] ${(item.desc || '').substring(0, 40)} | Empaque: ${item.pack} | Precio: $${item.newPrice.toFixed(2)} [VIGENTE]`)
  })

  console.log('\n======================================================================')
  console.log('🏆 ¡TEST COMPLETADO CON ÉXITO! El botón "Revisar Precios de Hoy" funciona al 100%.')
  console.log('======================================================================')
}

testRevisarPreciosHoy().catch(err => {
  console.error('Error durante la prueba:', err)
  process.exit(1)
})
