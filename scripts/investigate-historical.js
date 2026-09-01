const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.trim().startsWith('#')) {
      env[l.substring(0, idx).trim()] = l.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  });
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function investigateHistoricalPrices() {
  // 1. Get the supplier
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id')
    .eq('supplier_code', 'VIELE')
    .single();

  // 2. Get all mappings with inventory items
  const { data: mappings } = await supabase
    .from('supplier_item_mappings')
    .select(`
      supplier_sku,
      supplier_description,
      master_item_id,
      inventory_items (
        id, name, sku, purchase_unit_cost, updated_at
      )
    `)
    .eq('supplier_id', supplier.id);

  // 3. Get ALL price history records for context
  const { data: history } = await supabase
    .from('supplier_price_history')
    .select('supplier_sku, case_price, effective_date, source_type, created_at, created_by')
    .eq('supplier_id', supplier.id)
    .order('created_at', { ascending: false });

  // 4. Get the latest Viele prices live
  // We'll use the sync function
  // But first let's just check what's in DB vs what was in the email

  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('📋 INVESTIGACIÓN: ¿Contra qué precio histórico se compara el correo?');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  console.log('El correo compara: Precio Actual de Viele (API en vivo) vs inventory_items.purchase_unit_cost');
  console.log('La columna purchase_unit_cost es el ÚLTIMO PRECIO APROBADO en el sistema.\n');

  // Group history by SKU
  const historyBySku = {};
  (history || []).forEach(h => {
    if (!historyBySku[h.supplier_sku]) historyBySku[h.supplier_sku] = [];
    historyBySku[h.supplier_sku].push(h);
  });

  console.log('═══ DESGLOSE POR INSUMO (Solo los que tienen cambio de precio) ═══\n');

  // Show items where there would be a price difference
  // We need to simulate what the email showed
  const { syncVielePortalDirect } = require('../lib/vendor-scraper');
  const scrapeResult = await syncVielePortalDirect();

  const mappingMap = new Map();
  (mappings || []).forEach(m => mappingMap.set(m.supplier_sku.toUpperCase(), m));

  let increases = [];
  let decreases = [];

  for (const parsed of scrapeResult.items) {
    const mapping = mappingMap.get(parsed.supplierSku);
    const mi = mapping?.inventory_items;
    if (!mapping || !mi || !mi.purchase_unit_cost) continue;

    const currentCasePrice = Number(mi.purchase_unit_cost) || 0;
    const newCasePrice = parsed.casePrice;
    const diffAmount = Number((newCasePrice - currentCasePrice).toFixed(2));

    if (Math.abs(diffAmount) > 0.009) {
      const changePercent = Number(((diffAmount / currentCasePrice) * 100).toFixed(2));
      const histRecords = historyBySku[parsed.supplierSku] || [];
      const latestHist = histRecords[0]; // Most recent

      const item = {
        sku: parsed.supplierSku,
        desc: mapping.supplier_description || mi.name,
        dbPrice: currentCasePrice,
        dbUpdatedAt: mi.updated_at,
        vielePrice: newCasePrice,
        diff: diffAmount,
        pct: changePercent,
        histCount: histRecords.length,
        lastHistDate: latestHist?.created_at || 'N/A',
        lastHistSource: latestHist?.source_type || 'N/A',
        lastHistPrice: latestHist?.case_price || 'N/A',
        lastHistBy: latestHist?.created_by || 'N/A',
      };

      if (diffAmount > 0) increases.push(item);
      else decreases.push(item);
    }
  }

  console.log(`🚨 AUMENTOS (${increases.length} items):`);
  console.log('─────────────────────────────────────────────────────────────────────');
  for (const i of increases) {
    console.log(`  SKU: ${i.sku} — ${i.desc}`);
    console.log(`    • Precio en BD (purchase_unit_cost): $${i.dbPrice} (actualizado: ${i.dbUpdatedAt})`);
    console.log(`    • Precio Viele HOY (API en vivo):    $${i.vielePrice}`);
    console.log(`    • Diferencia: +$${i.diff} (+${i.pct}%)`);
    console.log(`    • Historial: ${i.histCount} registros | Último: $${i.lastHistPrice} el ${i.lastHistDate} (${i.lastHistSource} por ${i.lastHistBy})`);
    console.log('');
  }

  console.log(`\n🎉 REBAJAS (${decreases.length} items):`);
  console.log('─────────────────────────────────────────────────────────────────────');
  for (const d of decreases) {
    console.log(`  SKU: ${d.sku} — ${d.desc}`);
    console.log(`    • Precio en BD (purchase_unit_cost): $${d.dbPrice} (actualizado: ${d.dbUpdatedAt})`);
    console.log(`    • Precio Viele HOY (API en vivo):    $${d.vielePrice}`);
    console.log(`    • Diferencia: -$${Math.abs(d.diff)} (${d.pct}%)`);
    console.log(`    • Historial: ${d.histCount} registros | Último: $${d.lastHistPrice} el ${d.lastHistDate} (${d.lastHistSource} por ${d.lastHistBy})`);
    console.log('');
  }

  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('📌 CONCLUSIÓN:');
  console.log('   La columna "Precio Anterior" en el correo = inventory_items.purchase_unit_cost');
  console.log('   Es el ÚLTIMO costo aprobado guardado en la base de datos maestra.');
  console.log('   Los precios fueron cargados inicialmente desde el seed de Viele el 26-Ago-2026');
  console.log('   (source_type: api_sync por Admin).');
  console.log('════════════════════════════════════════════════════════════════════════');
}

investigateHistoricalPrices().catch(console.error);
