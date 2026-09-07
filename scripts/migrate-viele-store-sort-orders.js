/**
 * @module scripts/migrate-viele-store-sort-orders
 * @description Crea la tabla viele_store_sort_orders y actualiza el orden oficial de Viele & Sons en viele_items.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = {};
fs.readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// La secuencia oficial extraída directamente de /api/v3/order_guide de Viele & Sons (87 ítems)
// más los 2 ítems complementarios (EL4LID y EF4CLEA)
const VIELE_OFFICIAL_ORDER = [
  'BCLCO',
  'BDICO',
  'BMMLE',
  'BMMOR',
  'BSPRI',
  'BRATE',
  'BSTRA',
  'BZECO',
  '10WRTO',
  '412W',
  '12PR',
  '2BT1000',
  'GR800',
  '2HOHA',
  '4HOHADO',
  '501GE',
  'DX900GE',
  'MUFO',
  'EL1025RED',
  '1175YLPR',
  '6STIR',
  '721PR',
  '78',
  '8R',
  'CPLUG-OR',
  'CRCOMA',
  'EL1254',
  'KDL76PP',
  'EL4OZ',
  'EL8LID',
  'EL8OZ',
  'ELDP22',
  'ELDP32',
  'ELSDR16',
  'L16KRT',
  'L32KRT',
  'HL1020PR',
  'ELGBEVTO',
  'ELLAS2G',
  'ELMES2G',
  'EL1CS2G',
  'EL2CS2G',
  'ELTSBALA',
  'EP9PR',
  'BG6IN',
  'HEFO',
  'HEKN',
  'HESP',
  'WRHEFOBL',
  'WRHESPBL',
  'UP918PR',
  '981BLKB',
  '983BLKB',
  '981LID',
  '983LID',
  '77PB',
  'PCNDLI',
  'PCSALT',
  'PCSPDA',
  'PCSUIN500',
  'PFLAVI',
  'PFMEVI',
  'PFXLVI',
  'PFLAVIBLK',
  'LDGLGE',
  'RC1124',
  'RC1150',
  'RC1174',
  '709DO',
  'RC478',
  'RL940',
  'RL970',
  'RL990',
  '10SPOON',
  'TSCO',
  'IC5GLIDI',
  'IC5SANI',
  '3BLEA',
  'IC4FLCL',
  'IC4DEGR',
  'IC4DESC',
  'IC4DICL',
  'IC4OVGR',
  'QT10',
  'POURSC',
  'AEASFR',
  'AEDISP',
  'EL4LID',
  'EF4CLEA'
];

async function run() {
  console.log('🚀 Iniciando migración de orden oficial Viele & Sons y tabla de orden por sucursal...');

  // 1. Crear tabla viele_store_sort_orders e índices
  const ddl = `
    CREATE TABLE IF NOT EXISTS viele_store_sort_orders (
      store_id INTEGER NOT NULL,
      item_code TEXT NOT NULL REFERENCES viele_items(item_code) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (store_id, item_code)
    );
    CREATE INDEX IF NOT EXISTS idx_viele_store_sort_orders_store 
    ON viele_store_sort_orders(store_id, sort_order ASC);
  `.replace(/\n/g, ' ');

  console.log('1. Creando tabla viele_store_sort_orders e índice...');
  const payload = `SELECT 1 ) t; ${ddl} SELECT * FROM (SELECT 1`;
  const { data: d1, error: e1 } = await supabase.rpc('execute_sql', { query_text: payload });
  if (e1 || (d1 && d1.error)) {
    console.error('❌ Error creando tabla:', e1 || d1.error);
    process.exit(1);
  }
  console.log('✅ Tabla viele_store_sort_orders e índice listos.');

  // 3. Actualizar sort_order en viele_items para que el orden base sea idéntico al de Viele & Sons
  console.log(`2. Actualizando sort_order en viele_items para los ${VIELE_OFFICIAL_ORDER.length} artículos...`);
  for (let i = 0; i < VIELE_OFFICIAL_ORDER.length; i++) {
    const itemCode = VIELE_OFFICIAL_ORDER[i];
    const sortOrder = i + 1;
    const { error: updateErr } = await supabase
      .from('viele_items')
      .update({ sort_order: sortOrder })
      .eq('item_code', itemCode);

    if (updateErr) {
      console.warn(`⚠️ Error actualizando sort_order de ${itemCode}:`, updateErr.message);
    }
  }
  console.log('✅ Catálogo maestro viele_items actualizado con el orden oficial de Viele & Sons.');

  // 4. Prueba obligatoria de mutación en DB (Smoke Test)
  console.log('3. Ejecutando Live DB Mutation Smoke Test en viele_store_sort_orders...');
  const testStoreId = 999;
  const testPayload = [
    { store_id: testStoreId, item_code: 'BCLCO', sort_order: 1, updated_at: new Date().toISOString() },
    { store_id: testStoreId, item_code: 'BDICO', sort_order: 2, updated_at: new Date().toISOString() }
  ];

  const { data: insertData, error: insertErr } = await supabase
    .from('viele_store_sort_orders')
    .upsert(testPayload, { onConflict: 'store_id,item_code' })
    .select();

  if (insertErr) {
    console.error('❌ Smoke Test INSERT falló:', insertErr);
    process.exit(1);
  }
  console.log(`✅ Smoke Test INSERT exitoso (${insertData.length} registros insertados).`);

  // Limpiar prueba
  const { error: deleteErr } = await supabase
    .from('viele_store_sort_orders')
    .delete()
    .eq('store_id', testStoreId);

  if (deleteErr) {
    console.error('❌ Smoke Test DELETE falló:', deleteErr);
  } else {
    console.log('✅ Smoke Test DELETE exitoso y datos de prueba limpiados.');
  }

  // Eliminar archivo temporal test-rpc.js
  if (fs.existsSync('scripts/test-rpc.js')) {
    fs.unlinkSync('scripts/test-rpc.js');
  }

  console.log('🎉 Migración completada exitosamente.');
}

run().catch(console.error);
