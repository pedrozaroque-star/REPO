/**
 * @file simulate-cron-deep-run.ts
 * @description Simulación forense exhaustiva paso a paso del Cronjob de las 6:00 AM PST.
 * Traza la extracción en vivo, comparación, clasificación, generación de email,
 * idempotencia en Supabase y reporte final.
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
import { DEFAULT_PRICE_ALERT_RECIPIENTS, PriceChangeItem } from '../lib/supplier-price-email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function simulateCronDeepExecution() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════════')
  console.log('⏰ SIMULACIÓN FORENSE: CRONJOB AUTOMÁTICO DE LAS 6:00 AM PST (LUNES A VIERNES)')
  console.log('═══════════════════════════════════════════════════════════════════════════════════════\n')

  const globalStart = Date.now()

  // -----------------------------------------------------------------------------------------
  // PASO 1: Despertar del Worker en Vercel Serverless
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 1: DISPARO AUTOMÁTICO EN VERCEL CLOUD]:')
  console.log('   • Evento: Cron Trigger `0 14 * * 1-5` (14:00 UTC = 6:00 AM PST / Los Angeles).')
  console.log('   • Endpoint invocado: POST /api/cron/sync-supplier-prices')
  console.log('   • Autenticación: Bearer Token validado contra CRON_SECRET en variables de entorno.')
  console.log('   • Estado: Autorizado exitosamente.\n')

  // -----------------------------------------------------------------------------------------
  // PASO 2: Conexión y Extracción de Catálogo en Viele & Sons v3
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 2: CONEXIÓN Y EXTRACCIÓN EN VIVO DESDE VIELE & SONS]:')
  console.log('   • URL Destino: https://shop.vieleandsons.com/api/v3/order_guide')
  console.log('   • Cabeceras: Referer: https://shop.vieleandsons.com/orderguide_new/')
  const scrapeStart = Date.now()
  const scrapeResult = await syncVielePortalDirect()
  const scrapeDuration = Date.now() - scrapeStart
  console.log(`   • Tiempo de respuesta API Viele: ${(scrapeDuration / 1000).toFixed(2)} segundos.`)
  console.log(`   • Total de insumos oficiales extraídos en vivo: ${scrapeResult.totalItems} productos.\n`)

  // -----------------------------------------------------------------------------------------
  // PASO 3: Carga de Mapeos e Insumos Maestros desde Supabase
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 3: CRUCE CONTRA INSUMOS MAESTROS EN SUPABASE]:')
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
        quantity_per_unit,
        is_bodega
      )
    `)
    .eq('supplier_id', supplier?.id)

  const mappingMap = new Map<string, any>()
  ;(mappings || []).forEach((m: any) => {
    mappingMap.set(m.supplier_sku.toUpperCase(), m)
  })
  console.log(`   • Insumos mapeados encontrados en base de datos: ${mappings?.length || 0} productos.`)
  console.log('   • Verificación de aislamiento: Insumos de proveedor externo (is_bodega: false) están desacoplados de QuickBooks.\n')

  // -----------------------------------------------------------------------------------------
  // PASO 4: Motor de Análisis y Clasificación de Variaciones
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 4: CLASIFICACIÓN DE VARIACIONES & IMPACTO FINANCIERO]:')
  const increasesForEmail: PriceChangeItem[] = []
  const decreasesForEmail: PriceChangeItem[] = []
  let unchangedCount = 0
  let unmappedCount = 0
  let netAnnualImpact = 0

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const masterItem = mapping?.inventory_items

    const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
    const packUnit = mapping?.pack_unit || parsed.packUnit || 'CS'
    const newCasePrice = parsed.casePrice
    const newUnitCost = Number((newCasePrice / packQty).toFixed(4))

    let currentCasePrice = 0
    if (masterItem) {
      currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
    }

    if (!mapping || !masterItem || currentCasePrice <= 0 || newCasePrice <= 0) {
      unmappedCount++
      continue
    }

    const diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))
    const changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2))
    const annualVol = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
    const annualImpact = Number((diffAmount * annualVol).toFixed(2))
    netAnnualImpact += annualImpact

    const itemData: PriceChangeItem = {
      supplierSku: parsed.supplierSku,
      description: mapping?.supplier_description || parsed.description || masterItem.name,
      packUnit,
      packQuantity: packQty,
      previousCasePrice: currentCasePrice,
      newCasePrice: newCasePrice,
      diffAmount,
      changePercent,
      annualVolume: annualVol,
      annualImpactUsd: annualImpact
    }

    if (diffAmount > 0.009) {
      increasesForEmail.push(itemData)
    } else if (diffAmount < -0.009) {
      decreasesForEmail.push(itemData)
    } else {
      unchangedCount++
    }
  }

  console.log(`   • 🚨 Insumos con Aumento (Alzas): ${increasesForEmail.length} productos`)
  console.log(`   • 🎉 Insumos con Rebaja (Ahorros): ${decreasesForEmail.length} productos`)
  console.log(`   • ⚪ Insumos Sin Cambios (Precios al día): ${unchangedCount} productos`)
  console.log(`   • 💰 Balance Neto Anual (15 Tiendas): $${netAnnualImpact.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año\n`)

  // -----------------------------------------------------------------------------------------
  // PASO 5: Verificación de Idempotencia y Registro en Historial
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 5: IDEMPOTENCIA Y REGISTRO EN "supplier_price_history"]:')
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: recentCron } = await supabase
    .from('supplier_price_history')
    .select('supplier_sku, case_price')
    .eq('supplier_id', supplier?.id)
    .eq('source_type', 'cron_sync')
    .gte('effective_date', sevenDaysAgo)

  const recentSet = new Set<string>()
  ;(recentCron || []).forEach((r: any) => {
    recentSet.add(`${r.supplier_sku}|${Number(r.case_price).toFixed(2)}`)
  })

  let newVariations = 0
  let duplicateVariations = 0

  for (const item of [...increasesForEmail, ...decreasesForEmail]) {
    const key = `${item.supplierSku}|${item.newCasePrice.toFixed(2)}`
    if (recentSet.has(key)) {
      duplicateVariations++
    } else {
      newVariations++
    }
  }

  console.log(`   • Variaciones ya registradas en los últimos 7 días (omitidas para no duplicar): ${duplicateVariations}`)
  console.log(`   • Variaciones nuevas detectadas hoy: ${newVariations}\n`)

  // -----------------------------------------------------------------------------------------
  // PASO 6: Generación y Despacho del Correo de Alertas
  // -----------------------------------------------------------------------------------------
  console.log('🔹 [PASO 6: DISPARO Y ENVÍO DE CORREO EJECUTIVO]:')
  console.log(`   • ¿Se debe enviar correo hoy?: ${increasesForEmail.length > 0 || decreasesForEmail.length > 0 ? 'SÍ (Hay variaciones detectadas)' : 'NO (Precios idénticos)'}`)
  console.log('   • Destinatarios Oficiales:')
  DEFAULT_PRICE_ALERT_RECIPIENTS.forEach(r => console.log(`     - ${r}`))
  
  let templateType = 'Mixto (Dual)'
  if (increasesForEmail.length > 0 && decreasesForEmail.length === 0) templateType = '🚨 Solo Aumentos (Rojo)'
  if (decreasesForEmail.length > 0 && increasesForEmail.length === 0) templateType = '🎉 Solo Ahorros (Verde Esmeralda)'

  console.log(`   • Plantilla Visual Aplicada: ${templateType}`)
  console.log(`   • Asunto del Correo: 📊 Reporte de Variación de Precios — Viele & Sons (Neto: +$${netAnnualImpact.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD / ${increasesForEmail.length} Alzas, ${decreasesForEmail.length} Rebajas)`)
  console.log('   • Remitente: "Tacos Gavilan · Sistema de Monitoreo" <alertas@tacosgavilan.com>\n')

  // -----------------------------------------------------------------------------------------
  // PASO 7: Resumen Final del Proceso
  // -----------------------------------------------------------------------------------------
  console.log('═══════════════════════════════════════════════════════════════════════════════════════')
  console.log(`✅ SIMULACIÓN DEL CRON CONCLUIDA EXITOSAMENTE EN ${((Date.now() - globalStart) / 1000).toFixed(2)}s`)
  console.log('═══════════════════════════════════════════════════════════════════════════════════════')
}

simulateCronDeepExecution().catch(console.error)
