import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.substring(0, idx).trim()
      const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  })
}

import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function deepInvestigation() {
  const { data: supplier } = await supabase.from('suppliers').select('id').eq('supplier_code', 'VIELE').single()

  // Get ALL history records
  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('supplier_sku, case_price, effective_date, source_type, created_at, created_by, master_item_id')
    .eq('supplier_id', supplier!.id)
    .order('created_at', { ascending: false })

  // Get all mappings with current inventory_items price
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`supplier_sku, master_item_id,
      inventory_items (id, name, sku, purchase_unit_cost, updated_at)`)
    .eq('supplier_id', supplier!.id)

  console.log('════════════════════════════════════════════════════════════════════════════════════')
  console.log('🔍 INVESTIGACIÓN: ¿Por qué el correo muestra precios viejos si ya se aprobaron?')
  console.log('════════════════════════════════════════════════════════════════════════════════════\n')

  // Group history by SKU, get LATEST record
  const latestBySku: Record<string, any> = {}
  ;(history || []).forEach((h: any) => {
    if (!latestBySku[h.supplier_sku]) latestBySku[h.supplier_sku] = h
  })

  // Items where the screen shows "Historial" says it's one price but DB has another
  const mismatches: any[] = []
  const matches: any[] = []

  for (const m of (mappings || [])) {
    const mi = (m as any).inventory_items
    if (!mi) continue
    const lastHist = latestBySku[m.supplier_sku]
    if (!lastHist) continue

    const dbPrice = Number(mi.purchase_unit_cost) || 0
    const histPrice = Number(lastHist.case_price) || 0

    if (Math.abs(dbPrice - histPrice) > 0.009) {
      mismatches.push({
        sku: m.supplier_sku,
        name: mi.name,
        dbPrice,
        histPrice,
        histDate: lastHist.created_at,
        histSource: lastHist.source_type,
        dbUpdated: mi.updated_at
      })
    } else {
      matches.push({ sku: m.supplier_sku, dbPrice, histPrice })
    }
  }

  console.log(`📊 Total items mapeados: ${mappings?.length}`)
  console.log(`✅ Items donde DB = Historial (coinciden): ${matches.length}`)
  console.log(`❌ Items donde DB ≠ Historial (NO coinciden): ${mismatches.length}\n`)

  if (mismatches.length > 0) {
    console.log('❌ DISCREPANCIAS — El historial dice un precio pero la BD maestra tiene otro:\n')
    console.log('SKU          | Nombre                                      | BD Maestra   | Historial    | Fecha Historial      | Origen')
    console.log('─────────────|─────────────────────────────────────────────|──────────────|──────────────|──────────────────────|────────')
    for (const m of mismatches) {
      const name = m.name.substring(0, 43).padEnd(43)
      console.log(`${m.sku.padEnd(12)} | ${name} | $${m.dbPrice.toFixed(2).padStart(9)} | $${m.histPrice.toFixed(2).padStart(9)} | ${m.histDate.split('T')[0]}           | ${m.histSource}`)
    }

    console.log('\n════════════════════════════════════════════════════════════════════════════════════')
    console.log('📌 DIAGNÓSTICO:')
    console.log('   El historial (supplier_price_history) registró los precios reales de Viele')
    console.log('   pero inventory_items.purchase_unit_cost NUNCA fue actualizado con esos precios.')
    console.log('   CAUSA: QuickBooks sync sobreescribía los precios de vuelta a los costos viejos.')
    console.log('   FIX: Actualizar inventory_items al precio MÁS RECIENTE del historial aprobado.')
    console.log('════════════════════════════════════════════════════════════════════════════════════')
  }
}

deepInvestigation().catch(console.error)
