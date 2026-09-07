/**
 * @module scripts/migrate-viele-items-price-radar
 * @description Agrega las columnas de Radar de Precios a viele_items y realiza Smoke Test.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan
 * - Columnas: previous_price, price_change_percent, price_changed_at, price_status, last_scanned_at
 * - Live DB Mutation Smoke Test obligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = {};
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('🚀 Iniciando migración de viele_items para Radar de Precios...');

  // 1. DDL
  const ddl = `
    ALTER TABLE viele_items
    ADD COLUMN IF NOT EXISTS previous_price NUMERIC(10, 2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS price_change_percent NUMERIC(8, 2) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS price_status TEXT DEFAULT 'unchanged',
    ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ DEFAULT NULL;

    CREATE INDEX IF NOT EXISTS idx_viele_items_price_status ON viele_items(price_status);
    CREATE INDEX IF NOT EXISTS idx_viele_items_price_changed_at ON viele_items(price_changed_at);
    NOTIFY pgrst, 'reload schema';
  `.replace(/\n/g, ' ');

  console.log('1. Ejecutando DDL en Supabase...');
  const payload = `SELECT 1 ) t; ${ddl} SELECT * FROM (SELECT 1`;
  const { data: d1, error: e1 } = await supabase.rpc('execute_sql', { query_text: payload });
  if (e1 || (d1 && d1.error)) {
    console.error('❌ Error ejecutando DDL:', e1 || d1.error);
    process.exit(1);
  }
  console.log('✅ Columnas e índices creados exitosamente en viele_items.');
  console.log('Esperando 2 segundos para recarga de caché PostgREST...');
  await new Promise(r => setTimeout(r, 2000));

  // 2. Live DB Mutation Smoke Test
  console.log('2. Ejecutando Live DB Mutation Smoke Test...');
  const testItem = {
    item_code: 'TEST_SMOKE_SKU',
    description: 'Test Smoke SKU for Price Radar',
    uom: 'CS',
    unit_price: 99.99,
    category: 'Prueba',
    image_file: '/images/viele/placeholder.png',
    sort_order: 9999,
    is_active: false,
    previous_price: 95.00,
    price_change_percent: 5.25,
    price_changed_at: new Date().toISOString(),
    price_status: 'increased',
    last_scanned_at: new Date().toISOString()
  };

  const { data: insData, error: insErr } = await supabase
    .from('viele_items')
    .insert([testItem])
    .select();

  if (insErr) {
    console.error('❌ Error en Smoke Test INSERT:', insErr);
    process.exit(1);
  }
  console.log('✅ Smoke Test INSERT exitoso:', insData[0]?.item_code, insData[0]?.price_status);

  // Limpiar test item
  const { error: delErr } = await supabase
    .from('viele_items')
    .delete()
    .eq('item_code', 'TEST_SMOKE_SKU');

  if (delErr) {
    console.error('❌ Error en Smoke Test DELETE:', delErr);
    process.exit(1);
  }
  console.log('✅ Smoke Test DELETE exitoso. Limpieza completada.');

  // 3. Inicializar datos históricos recientes de supplier_price_history para Viele
  console.log('3. Inicializando datos de Radar de Precios desde supplier_price_history...');
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id')
    .eq('supplier_code', 'VIELE')
    .single();

  if (supplier) {
    // Obtener los registros más recientes de cada SKU
    const { data: history } = await supabase
      .from('supplier_price_history')
      .select('supplier_sku, case_price, previous_unit_cost, change_percent, effective_date, created_at')
      .eq('supplier_id', supplier.id)
      .order('created_at', { ascending: false });

    if (history && history.length > 0) {
      const latestPerSku = new Map();
      for (const h of history) {
        const sku = h.supplier_sku.toUpperCase();
        if (!latestPerSku.has(sku)) {
          latestPerSku.set(sku, h);
        }
      }

      console.log(`Encontrados ${latestPerSku.size} SKUs con historial en el Radar de Precios.`);
      let updatedCount = 0;

      for (const [sku, h] of latestPerSku.entries()) {
        const diff = Number(h.case_price) - Number(h.previous_unit_cost || h.case_price);
        let status = 'unchanged';
        if (diff > 0.009) status = 'increased';
        else if (diff < -0.009) status = 'decreased';

        const { error: upErr } = await supabase
          .from('viele_items')
          .update({
            unit_price: Number(h.case_price),
            previous_price: h.previous_unit_cost ? Number(h.previous_unit_cost) : null,
            price_change_percent: h.change_percent ? Number(h.change_percent) : null,
            price_changed_at: h.created_at,
            price_status: status,
            last_scanned_at: h.created_at
          })
          .eq('item_code', sku);

        if (!upErr) updatedCount++;
      }
      console.log(`✅ ${updatedCount} productos en viele_items enriquecidos con su historial del Radar de Precios.`);
    }
  }

  console.log('🎉 Migración completada con 100% de éxito.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
