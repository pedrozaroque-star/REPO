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

async function restoreApprovedPrices() {
  const { data: supplier } = await supabase.from('suppliers').select('id').eq('supplier_code', 'VIELE').single()

  // Get ALL history records, latest first
  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('supplier_sku, case_price, master_item_id, created_at')
    .eq('supplier_id', supplier!.id)
    .order('created_at', { ascending: false })

  // Get all mappings
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`supplier_sku, master_item_id,
      inventory_items (id, name, purchase_unit_cost)`)
    .eq('supplier_id', supplier!.id)

  // Get latest history price per SKU
  const latestBySku: Record<string, any> = {}
  ;(history || []).forEach((h: any) => {
    if (!latestBySku[h.supplier_sku]) latestBySku[h.supplier_sku] = h
  })

  let updatedCount = 0
  let skippedCount = 0
  const updates: { sku: string; name: string; oldPrice: number; newPrice: number }[] = []

  for (const m of (mappings || [])) {
    const mi = (m as any).inventory_items
    if (!mi) continue

    const lastHist = latestBySku[m.supplier_sku]
    if (!lastHist) continue

    const dbPrice = Number(mi.purchase_unit_cost) || 0
    const histPrice = Number(lastHist.case_price) || 0

    if (Math.abs(dbPrice - histPrice) > 0.009 && histPrice > 0) {
      // Update inventory_items to the approved Viele price
      const { error } = await supabase
        .from('inventory_items')
        .update({ 
          purchase_unit_cost: histPrice,
          updated_at: new Date().toISOString()
        })
        .eq('id', mi.id)

      if (error) {
        console.error(`❌ Error updating ${m.supplier_sku}: ${error.message}`)
      } else {
        updatedCount++
        updates.push({ sku: m.supplier_sku, name: mi.name, oldPrice: dbPrice, newPrice: histPrice })
      }
    } else {
      skippedCount++
    }
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════')
  console.log('🔧 RESTAURACIÓN DE PRECIOS APROBADOS EN inventory_items')
  console.log('════════════════════════════════════════════════════════════════════════════════════\n')
  console.log(`✅ Restaurados: ${updatedCount} insumos`)
  console.log(`⚪ Sin cambio necesario: ${skippedCount} insumos\n`)

  if (updates.length > 0) {
    console.log('Detalle de restauración:')
    for (const u of updates) {
      console.log(`  ${u.sku}: $${u.oldPrice.toFixed(2)} → $${u.newPrice.toFixed(2)} (${u.name})`)
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════════════════════')
  console.log('📌 Los precios ahora reflejan lo que tú aprobaste en el Historial.')
  console.log('   QuickBooks ya NO puede volver a pisar estos precios (blindaje is_bodega activo).')
  console.log('════════════════════════════════════════════════════════════════════════════════════')
}

restoreApprovedPrices().catch(console.error)
