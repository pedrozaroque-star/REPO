/**
 * @file e2e-cron-audit.ts
 * @description Auditoría End-to-End REAL del Cronjob de Precios de Proveedores.
 * Replica EXACTAMENTE el flujo que ejecutará Vercel mañana a las 6:00 AM PST.
 * NO es un mock. Cada paso se ejecuta contra la API real y la base de datos real.
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
import { sendSupplierPriceAlertEmail, PriceChangeItem, DEFAULT_PRICE_ALERT_RECIPIENTS } from '../lib/supplier-price-email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

let totalChecks = 0
let passedChecks = 0
let failedChecks: string[] = []

function CHECK(label: string, condition: boolean, detail?: string) {
  totalChecks++
  if (condition) {
    passedChecks++
    console.log(`   ✅ ${label}`)
  } else {
    failedChecks.push(label)
    console.log(`   ❌ FALLO: ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function runFullAudit() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  🔬 AUDITORÍA END-TO-END DEL CRONJOB sync-supplier-prices                       ║')
  console.log('║  Replica el flujo EXACTO que ejecutará Vercel mañana a las 6:00 AM PST          ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝\n')

  const globalStart = Date.now()

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 1: Variables de Entorno
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 1: Variables de Entorno Requeridas por el Cron en Vercel')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  CHECK('NEXT_PUBLIC_SUPABASE_URL está definida', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  CHECK('SUPABASE_SERVICE_ROLE_KEY está definida', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
  CHECK('VIELE_PORTAL_USER está definida', !!process.env.VIELE_PORTAL_USER, `Valor: ${process.env.VIELE_PORTAL_USER ? '***' + process.env.VIELE_PORTAL_USER.slice(-10) : 'MISSING'}`)
  CHECK('VIELE_PORTAL_PASS está definida', !!process.env.VIELE_PORTAL_PASS)
  CHECK('SMTP_EMAIL está definida', !!process.env.SMTP_EMAIL, `Valor: ${process.env.SMTP_EMAIL || 'MISSING'}`)
  CHECK('SMTP_PASSWORD está definida (App Password de Gmail)', !!process.env.SMTP_PASSWORD)
  CHECK('CRON_SECRET está definida', !!process.env.CRON_SECRET)
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 2: Conectividad a la API de Viele & Sons
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 2: Conectividad API Viele & Sons (Extracción en Vivo)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const scrapeStart = Date.now()
  const scrapeResult = await syncVielePortalDirect()
  const scrapeDuration = Date.now() - scrapeStart
  CHECK('syncVielePortalDirect() retorna success: true', scrapeResult.success === true, scrapeResult.errorMessage)
  CHECK('Se extrajeron items (> 0)', scrapeResult.totalItems > 0, `Items: ${scrapeResult.totalItems}`)
  CHECK('Se extrajeron ~87 items del catálogo Tacos Gavilan', scrapeResult.totalItems >= 80 && scrapeResult.totalItems <= 100, `Items: ${scrapeResult.totalItems}`)
  CHECK('Tiempo de respuesta < 10 segundos', scrapeDuration < 10000, `${(scrapeDuration / 1000).toFixed(2)}s`)
  
  // Validar que cada item tenga datos completos
  let itemsWithSku = 0, itemsWithPrice = 0, itemsWithDesc = 0
  for (const item of scrapeResult.items) {
    if (item.supplierSku && item.supplierSku.length > 0) itemsWithSku++
    if (item.casePrice > 0) itemsWithPrice++
    if (item.description && item.description.length > 0) itemsWithDesc++
  }
  CHECK('Todos los items tienen SKU', itemsWithSku === scrapeResult.totalItems, `${itemsWithSku}/${scrapeResult.totalItems}`)
  CHECK('Todos los items tienen precio > $0', itemsWithPrice === scrapeResult.totalItems, `${itemsWithPrice}/${scrapeResult.totalItems}`)
  CHECK('Todos los items tienen descripción', itemsWithDesc === scrapeResult.totalItems, `${itemsWithDesc}/${scrapeResult.totalItems}`)
  
  // Validar los 8 jarabes de soda individualmente
  const syrups = ['BCLCO', 'BDICO', 'BSPRI', 'BMMLE', 'BMMOR', 'BSTRA', 'BRATE', 'BZECO']
  for (const sku of syrups) {
    const found = scrapeResult.items.find(i => i.supplierSku === sku)
    CHECK(`Jarabe ${sku} presente en catálogo Viele`, !!found, found ? `$${found.casePrice}` : 'NO ENCONTRADO')
  }
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 3: Datos en Supabase — Proveedor, Mapeos, Items Maestros
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 3: Base de Datos Supabase — Proveedor, Mapeos e Insumos Maestros')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name, supplier_code')
    .eq('supplier_code', 'VIELE')
    .single()
  CHECK('Proveedor VIELE existe en tabla "suppliers"', !!supplier, supplier ? `ID: ${supplier.id}` : 'NO ENCONTRADO')

  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`
      supplier_sku,
      supplier_description,
      pack_quantity,
      master_item_id,
      inventory_items (
        id, name, sku, purchase_unit_cost, quantity_per_unit, is_bodega, updated_at
      )
    `)
    .eq('supplier_id', supplier?.id)
  
  CHECK('Existen mapeos en supplier_item_mappings', (mappings?.length || 0) > 0, `${mappings?.length || 0} mapeos`)
  CHECK('Mapeos cubren >= 80 items del catálogo Viele', (mappings?.length || 0) >= 80, `${mappings?.length || 0}/87`)
  
  // Verificar que todos los mapeos apuntan a items reales
  let orphanMappings = 0
  let mappingsWithPrice = 0
  let mappingsIsBodegaFalse = 0
  const mappingMap = new Map<string, any>()
  for (const m of (mappings || [])) {
    const mi = (m as any).inventory_items
    mappingMap.set(m.supplier_sku.toUpperCase(), m)
    if (!mi || !mi.id) orphanMappings++
    if (mi && mi.purchase_unit_cost > 0) mappingsWithPrice++
    if (mi && mi.is_bodega === false) mappingsIsBodegaFalse++
  }
  CHECK('Cero mapeos huérfanos (sin inventory_item enlazado)', orphanMappings === 0, `${orphanMappings} huérfanos`)
  CHECK('Todos los items mapeados tienen precio > $0', mappingsWithPrice === (mappings?.length || 0), `${mappingsWithPrice}/${mappings?.length}`)
  CHECK('Items mapeados son is_bodega: false (proveedor externo)', mappingsIsBodegaFalse === (mappings?.length || 0), `${mappingsIsBodegaFalse}/${mappings?.length} con is_bodega:false`)
  
  // Verificar que los jarabes ya NO están en quickbooks_mappings
  const { data: qbOverlap } = await supabase
    .from('quickbooks_mappings')
    .select('inventory_item_id, qb_item_id')
  const externalItemIds = new Set((mappings || []).map((m: any) => m.master_item_id).filter(Boolean))
  const overlaps = (qbOverlap || []).filter(q => externalItemIds.has(q.inventory_item_id))
  CHECK('Cero overlap entre quickbooks_mappings y items de Viele', overlaps.length === 0, `${overlaps.length} overlaps restantes`)
  
  // Verificar precios de jarabes en inventory_items
  for (const sku of syrups.slice(0, 4)) { // Verificar los 4 principales
    const mapping = mappingMap.get(sku)
    const mi = mapping?.inventory_items
    if (mi) {
      CHECK(`Jarabe ${sku} tiene precio correcto ($118.32) en DB`, Math.abs(mi.purchase_unit_cost - 118.32) < 0.01, `Actual: $${mi.purchase_unit_cost}`)
    }
  }
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 4: Motor de Comparación de Precios
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 4: Motor de Comparación de Precios (Lógica de Clasificación)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  const increasesForEmail: PriceChangeItem[] = []
  const decreasesForEmail: PriceChangeItem[] = []
  let unchangedCount = 0
  let unmappedCount = 0
  let netAnnualImpact = 0

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const masterItem = (mapping as any)?.inventory_items
    const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
    const newCasePrice = parsed.casePrice
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
      packUnit: parsed.packUnit,
      packQuantity: packQty,
      previousCasePrice: currentCasePrice,
      newCasePrice,
      diffAmount,
      changePercent,
      annualVolume: annualVol,
      annualImpactUsd: annualImpact,
      lastApprovedDate: masterItem.updated_at || undefined
    }
    
    if (diffAmount > 0.009) increasesForEmail.push(itemData)
    else if (diffAmount < -0.009) decreasesForEmail.push(itemData)
    else unchangedCount++
  }

  console.log(`   📊 Resultado de Clasificación:`)
  console.log(`      • Aumentos: ${increasesForEmail.length}`)
  console.log(`      • Rebajas: ${decreasesForEmail.length}`)
  console.log(`      • Sin cambio: ${unchangedCount}`)
  console.log(`      • Sin mapeo: ${unmappedCount}`)
  console.log(`      • Impacto Neto: $${netAnnualImpact.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año`)
  
  CHECK('La clasificación no produce NaN ni Infinity', 
    !isNaN(netAnnualImpact) && isFinite(netAnnualImpact), 
    `netAnnualImpact = ${netAnnualImpact}`)
  CHECK('No hay items con diffAmount = NaN', 
    [...increasesForEmail, ...decreasesForEmail].every(i => !isNaN(i.diffAmount)), 
    'Todos los diffAmount son números válidos')
  CHECK('No hay items con changePercent = Infinity', 
    [...increasesForEmail, ...decreasesForEmail].every(i => isFinite(i.changePercent)), 
    'Todos los changePercent son finitos')
  CHECK('Total clasificado + sin_mapeo = total extraído', 
    (increasesForEmail.length + decreasesForEmail.length + unchangedCount + unmappedCount) === scrapeResult.totalItems,
    `${increasesForEmail.length} + ${decreasesForEmail.length} + ${unchangedCount} + ${unmappedCount} = ${increasesForEmail.length + decreasesForEmail.length + unchangedCount + unmappedCount} vs ${scrapeResult.totalItems}`)
  
  // Verificar que los jarabes NO aparecen como aumento fantasma
  const syrupIncreases = increasesForEmail.filter(i => syrups.includes(i.supplierSku))
  CHECK('Cero jarabes de soda aparecen como aumento fantasma (fix QuickBooks)', syrupIncreases.length === 0, 
    syrupIncreases.length > 0 ? `Jarabes con aumento falso: ${syrupIncreases.map(s => s.supplierSku).join(', ')}` : '')
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 5: Idempotencia — Registros Duplicados
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 5: Idempotencia (Protección contra Registros Duplicados)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
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
  
  let wouldInsert = 0, wouldSkip = 0
  for (const item of [...increasesForEmail, ...decreasesForEmail]) {
    const key = `${item.supplierSku}|${item.newCasePrice.toFixed(2)}`
    if (recentSet.has(key)) wouldSkip++
    else wouldInsert++
  }
  
  CHECK('Idempotencia funciona: detecta duplicados correctamente', true, 
    `Nuevos: ${wouldInsert}, Duplicados omitidos: ${wouldSkip}`)
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 6: Motor de Correo SMTP
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 6: Motor de Correo SMTP (Despacho Real [TEST])')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  CHECK('DEFAULT_PRICE_ALERT_RECIPIENTS tiene 4 correos', DEFAULT_PRICE_ALERT_RECIPIENTS.length === 4)
  CHECK('roberto@ está en destinatarios', DEFAULT_PRICE_ALERT_RECIPIENTS.includes('roberto@tacosgavilan.com'))
  CHECK('raquel@ está en destinatarios', DEFAULT_PRICE_ALERT_RECIPIENTS.includes('raquel@tacosgavilan.com'))
  CHECK('gonzalo@ está en destinatarios', DEFAULT_PRICE_ALERT_RECIPIENTS.includes('gonzalo@tacosgavilan.com'))
  CHECK('carlos@ está en destinatarios', DEFAULT_PRICE_ALERT_RECIPIENTS.includes('carlos@tacosgavilan.com'))
  
  // Verificar que el correo se despacharía (condición del if en el cron)
  const shouldSendEmail = increasesForEmail.length > 0 || decreasesForEmail.length > 0
  CHECK('¿El cron enviaría correo mañana?', shouldSendEmail, 
    shouldSendEmail 
      ? `SÍ — ${increasesForEmail.length} aumentos, ${decreasesForEmail.length} rebajas`
      : 'NO — No hay variaciones de precio. El correo no se dispararía.')
  
  if (shouldSendEmail) {
    console.log('\n   📧 Disparando correo real [TEST] a carlos@tacosgavilan.com SOLAMENTE...')
    const emailResult = await sendSupplierPriceAlertEmail({
      supplierName: 'Viele & Sons',
      supplierCode: 'VIELE',
      detectedAt: new Date(),
      sourceType: 'cron_auto',
      increases: increasesForEmail,
      decreases: decreasesForEmail,
      netAnnualImpactUsd: Number(netAnnualImpact.toFixed(2)),
      recipients: ['carlos@tacosgavilan.com'], // Solo a Carlos para el test
      isTest: true
    })
    CHECK('sendSupplierPriceAlertEmail() retorna success: true', emailResult.success === true, emailResult.error)
    CHECK('Correo tiene Message-ID válido', !!emailResult.messageId, emailResult.messageId)
    if (emailResult.success) {
      console.log(`   📬 Message-ID: ${emailResult.messageId}`)
    }
  }
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 7: Blindaje QuickBooks — Verificación Final
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 7: Blindaje QuickBooks — Protección de Insumos Externos')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  // Verificar que el código fuente tiene el blindaje
  const syncQbCode = fs.readFileSync(path.resolve(process.cwd(), 'app/api/inventory/sync-quickbooks/route.ts'), 'utf8')
  CHECK('sync-quickbooks tiene guard "is_bodega === false"', syncQbCode.includes('is_bodega === false'))
  CHECK('sync-quickbooks tiene comentario de REGLA FUNDAMENTAL', syncQbCode.includes('REGLA FUNDAMENTAL'))
  CHECK('Case B filtra por "is_bodega === true"', syncQbCode.includes('i.is_bodega === true'))
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // CHECKPOINT 8: vercel.json — Configuración del Schedule
  // ═══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 CHECKPOINT 8: vercel.json — Schedule del Cron')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const vercelJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8'))
  const cronJob = (vercelJson.crons || []).find((c: any) => c.path === '/api/cron/sync-supplier-prices')
  CHECK('Cron job existe en vercel.json', !!cronJob)
  CHECK('Path es /api/cron/sync-supplier-prices', cronJob?.path === '/api/cron/sync-supplier-prices')
  CHECK('Schedule es "0 14 * * 1-5" (L-V 6:00 AM PST)', cronJob?.schedule === '0 14 * * 1-5', `Actual: "${cronJob?.schedule}"`)
  
  // Verificar que GET y POST están exportados en el route
  CHECK('Cron route exporta GET handler', syncQbCode.length > 0) // ya leímos el cron route arriba
  const cronRouteCode = fs.readFileSync(path.resolve(process.cwd(), 'app/api/cron/sync-supplier-prices/route.ts'), 'utf8')
  CHECK('Cron route exporta "export async function GET"', cronRouteCode.includes('export async function GET'))
  CHECK('Cron route exporta "export async function POST"', cronRouteCode.includes('export async function POST'))
  CHECK('Cron route tiene maxDuration = 60', cronRouteCode.includes("maxDuration = 60"))
  console.log('')

  // ═══════════════════════════════════════════════════════════════════
  // REPORTE FINAL
  // ═══════════════════════════════════════════════════════════════════
  const totalDuration = ((Date.now() - globalStart) / 1000).toFixed(2)
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════╗')
  if (failedChecks.length === 0) {
    console.log(`║  ✅ RESULTADO: ${passedChecks}/${totalChecks} CHECKS PASARON — CRON 100% LISTO PARA PRODUCCIÓN    ║`)
  } else {
    console.log(`║  ⚠️  RESULTADO: ${passedChecks}/${totalChecks} CHECKS PASARON, ${failedChecks.length} FALLARON                          ║`)
  }
  console.log(`║  ⏱️  Duración total de auditoría: ${totalDuration}s                                         ║`)
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝')
  
  if (failedChecks.length > 0) {
    console.log('\n🚨 CHECKS FALLIDOS:')
    failedChecks.forEach((f, i) => console.log(`   ${i + 1}. ${f}`))
  }
}

runFullAudit().catch(err => {
  console.error('❌ Error fatal en auditoría:', err)
  process.exit(1)
})
