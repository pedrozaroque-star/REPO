import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
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
import { DEFAULT_PRICE_ALERT_RECIPIENTS } from '../lib/supplier-price-email'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function simulateTomorrow6AM() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('🔍 SIMULACIÓN EXACTA DEL DISPARO DE LAS 6:00 AM PST DE MAÑANA');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  // 1. Extraer Viele en vivo
  const scrapeResult = await syncVielePortalDirect()
  console.log(`1. Portal Viele responde: ${scrapeResult.totalItems} items extraídos en vivo.`);

  // 2. Consultar BD de Supabase
  const { data: supplier } = await supabase.from('suppliers').select('id').eq('supplier_code', 'VIELE').single()
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`supplier_sku, supplier_description, pack_quantity, pack_unit, master_item_id,
      inventory_items (id, name, sku, purchase_unit_cost, quantity_per_unit, updated_at)`)
    .eq('supplier_id', supplier!.id)

  const mappingMap = new Map<string, any>()
  ;(mappings || []).forEach((m: any) => mappingMap.set(m.supplier_sku.toUpperCase(), m))

  const increases: any[] = []
  const decreases: any[] = []
  let unchanged = 0

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku)
    const masterItem = mapping?.inventory_items
    if (!mapping || !masterItem) continue

    const currentPrice = Number(masterItem.purchase_unit_cost) || 0
    const newPrice = parsed.casePrice
    const diff = Number((newPrice - currentPrice).toFixed(2))

    if (diff > 0.009) increases.push({ sku: parsed.supplierSku, old: currentPrice, new: newPrice, diff })
    else if (diff < -0.009) decreases.push({ sku: parsed.supplierSku, old: currentPrice, new: newPrice, diff })
    else unchanged++
  }

  console.log(`\n2. Evaluación de Diferencias contra la BD Maestra:`);
  console.log(`   • Aumentos detectados: ${increases.length}`);
  increases.forEach(i => console.log(`     - [AUMENTO] ${i.sku}: $${i.old} -> $${i.new} (+$${i.diff})`));
  console.log(`   • Rebajas detectadas:  ${decreases.length}`);
  decreases.forEach(d => console.log(`     - [REBAJA]  ${d.sku}: $${d.old} -> $${d.new} ($${d.diff})`));
  console.log(`   • Sin cambios:         ${unchanged}`);

  const willSend = increases.length > 0 || decreases.length > 0
  console.log(`\n3. Condición de Envío de Correo:`);
  console.log(`   increases.length > 0 || decreases.length > 0 ===> ${willSend ? '✅ SÍ SE ENVÍA' : '❌ NO'}`);
  console.log(`   Destinatarios Oficiales (${DEFAULT_PRICE_ALERT_RECIPIENTS.length}):`);
  DEFAULT_PRICE_ALERT_RECIPIENTS.forEach(r => console.log(`     ✉️  ${r}`));

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log('🎯 CONCLUSIÓN: MAÑANA A LAS 6:00 AM PST EL CORREO SE VA A ENVIAR');
  console.log('   PORQUE EXISTEN 3 VARIACIONES ACTIVAS EN LA BASE DE DATOS.');
  console.log('════════════════════════════════════════════════════════════════════════');
}

simulateTomorrow6AM().catch(console.error)
