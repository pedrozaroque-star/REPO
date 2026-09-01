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
import { syncVielePortalDirect } from '../lib/vendor-scraper'
import { ESTIMATED_ANNUAL_VOLUMES, DEFAULT_ANNUAL_VOLUME } from '../lib/constants/supplier-volumes'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function investigate() {
  const { data: supplier } = await supabase.from('suppliers').select('id').eq('supplier_code', 'VIELE').single()
  
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`supplier_sku, supplier_description, master_item_id, pack_quantity,
      inventory_items (id, name, sku, purchase_unit_cost, updated_at)`)
    .eq('supplier_id', supplier!.id)

  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('supplier_sku, case_price, effective_date, source_type, created_at, created_by')
    .eq('supplier_id', supplier!.id)
    .order('created_at', { ascending: false })

  const scrapeResult = await syncVielePortalDirect()

  const mappingMap = new Map<string, any>()
  ;(mappings || []).forEach((m: any) => mappingMap.set(m.supplier_sku.toUpperCase(), m))

  const historyBySku: Record<string, any[]> = {}
  ;(history || []).forEach((h: any) => {
    if (!historyBySku[h.supplier_sku]) historyBySku[h.supplier_sku] = []
    historyBySku[h.supplier_sku].push(h)
  })

  const increases: any[] = []
  const decreases: any[] = []

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const mi = (mapping as any)?.inventory_items
    if (!mapping || !mi || !mi.purchase_unit_cost) continue

    const currentCasePrice = Number(mi.purchase_unit_cost) || 0
    const newCasePrice = parsed.casePrice
    const diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2))

    if (Math.abs(diffAmount) > 0.009) {
      const changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2))
      const histRecords = historyBySku[parsed.supplierSku] || []
      const latestHist = histRecords[0]

      const item = {
        sku: parsed.supplierSku,
        desc: mapping.supplier_description || mi.name,
        dbPrice: currentCasePrice,
        dbUpdatedAt: mi.updated_at,
        vielePrice: newCasePrice,
        diff: diffAmount,
        pct: changePercent,
        histCount: histRecords.length,
        lastHistDate: latestHist?.created_at?.split('T')[0] || 'N/A',
        lastHistSource: latestHist?.source_type || 'N/A',
        lastHistPrice: latestHist?.case_price || 'N/A',
        lastHistBy: latestHist?.created_by || 'N/A',
      }
      item.diff > 0 ? increases.push(item) : decreases.push(item)
    }
  }

  console.log('════════════════════════════════════════════════════════════════════════════════════')
  console.log('📋 INVESTIGACIÓN: ¿Contra qué precio histórico se compara el correo TEST?')
  console.log('════════════════════════════════════════════════════════════════════════════════════')
  console.log('')
  console.log('La columna "Precio Anterior" del correo = inventory_items.purchase_unit_cost')
  console.log('Es el ÚLTIMO costo aprobado guardado en la base de datos maestra del sistema.')
  console.log('')

  console.log(`🚨 AUMENTOS (${increases.length} insumos):`)
  console.log('────────────────────────────────────────────────────────────────────────────────────')
  for (const i of increases) {
    console.log(`  ${i.sku} — ${i.desc}`)
    console.log(`    DB (último aprobado): $${i.dbPrice.toFixed(2)}  |  Viele HOY: $${i.vielePrice.toFixed(2)}  |  Δ +$${i.diff.toFixed(2)} (+${i.pct}%)`)
    console.log(`    Fecha del precio en BD: ${i.dbUpdatedAt}`)
    console.log(`    Historial: ${i.histCount} registro(s), último el ${i.lastHistDate} ($${i.lastHistPrice}) via ${i.lastHistSource}`)
    console.log('')
  }

  console.log(`\n🎉 REBAJAS (${decreases.length} insumos):`)
  console.log('────────────────────────────────────────────────────────────────────────────────────')
  for (const d of decreases) {
    console.log(`  ${d.sku} — ${d.desc}`)
    console.log(`    DB (último aprobado): $${d.dbPrice.toFixed(2)}  |  Viele HOY: $${d.vielePrice.toFixed(2)}  |  Δ -$${Math.abs(d.diff).toFixed(2)} (${d.pct}%)`)
    console.log(`    Fecha del precio en BD: ${d.dbUpdatedAt}`)
    console.log(`    Historial: ${d.histCount} registro(s), último el ${d.lastHistDate} ($${d.lastHistPrice}) via ${d.lastHistSource}`)
    console.log('')
  }
}

investigate().catch(console.error)
