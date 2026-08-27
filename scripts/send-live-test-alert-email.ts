/**
 * @file send-live-test-alert-email.ts
 * @description Despacha un correo [TEST] real a los 4 directivos (Roberto, Raquel, Gonzalo y Carlos)
 * utilizando el motor oficial lib/supplier-price-email.ts con los datos extraídos en vivo de Viele & Sons.
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
import { sendSupplierPriceAlertEmail, DEFAULT_PRICE_ALERT_RECIPIENTS, PriceChangeItem } from '../lib/supplier-price-email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function sendTestEmailToExecutives() {
  console.log('======================================================================')
  console.log('📧 ENVIANDO CORREO [TEST] DE ALERTA DE PRECIOS A DIRECTIVOS')
  console.log('======================================================================')
  console.log('Destinatarios:', DEFAULT_PRICE_ALERT_RECIPIENTS.join(', '))
  console.log('Conectando en vivo a Viele & Sons para obtener las variaciones reales...\n')

  // 1. Extraer catálogo en vivo
  const scrapeResult = await syncVielePortalDirect()
  if (!scrapeResult.success) {
    console.error('❌ Error al conectar con Viele:', scrapeResult.errorMessage)
    process.exit(1)
  }

  // 2. Mapeos en Supabase
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

  // 3. Clasificar variaciones
  const increasesForEmail: PriceChangeItem[] = []
  const decreasesForEmail: PriceChangeItem[] = []
  let netAnnualImpactUsd = 0

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const masterItem = mapping?.inventory_items

    const packQty = mapping?.pack_quantity || parsed.packQuantity || 1
    const packUnit = mapping?.pack_unit || parsed.packUnit || 'CS'
    const newCasePrice = parsed.casePrice

    let currentCasePrice = 0
    if (masterItem) {
      currentCasePrice = Number(masterItem.purchase_unit_cost) || 0
    }

    if (!mapping || !masterItem || currentCasePrice <= 0 || newCasePrice <= 0) {
      continue
    }

    const diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))
    const changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2))
    const annualVol = ESTIMATED_ANNUAL_VOLUMES[parsed.supplierSku] || DEFAULT_ANNUAL_VOLUME
    const annualImpact = Number((diffAmount * annualVol).toFixed(2))
    netAnnualImpactUsd += annualImpact

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
    }
  }

  console.log(`Variaciones detectadas: ${increasesForEmail.length} aumentos, ${decreasesForEmail.length} rebajas/ahorros.`)
  console.log(`Impacto Neto Anual: +$${netAnnualImpactUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD/año\n`)

  console.log('Despachando correo con plantilla oficial y marca [TEST]...')

  // 4. Enviar Correo oficial con isTest: true
  const result = await sendSupplierPriceAlertEmail({
    supplierName: 'Viele & Sons',
    supplierCode: 'VIELE',
    detectedAt: new Date(),
    sourceType: 'cron_auto',
    increases: increasesForEmail,
    decreases: decreasesForEmail,
    netAnnualImpactUsd,
    recipients: DEFAULT_PRICE_ALERT_RECIPIENTS,
    isTest: true
  })

  if (!result.success) {
    console.error('❌ Error al enviar correo:', result.error)
    process.exit(1)
  }

  console.log('\n======================================================================')
  console.log('✅ ¡CORREO [TEST] ENVIADO EXITOSAMENTE A LOS 4 DIRECTIVOS!')
  console.log('======================================================================')
  console.log('Message ID:', result.messageId)
  console.log('Destinatarios:', result.recipients?.join(', '))
  console.log('Aumentos reportados:', increasesForEmail.length)
  console.log('Rebajas / Ahorros reportados:', decreasesForEmail.length)
  console.log('======================================================================\n')
}

sendTestEmailToExecutives().catch(err => {
  console.error('Error durante el envío de prueba:', err)
  process.exit(1)
})
