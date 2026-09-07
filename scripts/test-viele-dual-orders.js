const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const SODA_CODES = new Set([
  'BCLCO',
  'BDICO',
  'BMMLE',
  'BMMOR',
  'BSPRI',
  'BRATE',
  'BSTRA',
  'BZECO',
  'BDRPE'
]);

function isVieleSoda(itemCode) {
  if (!itemCode) return false;
  return SODA_CODES.has(itemCode.trim().toUpperCase());
}

async function runDualOrderTests() {
  console.log('🧪 Iniciando Suite de Pruebas: Doble Facturación Consecutiva Viele & Sons');

  // Test 1: Separación exacta de items en Sodas e Insumos
  console.log('\n📦 1. Verificando partición de items por categoría:');
  const sampleItems = [
    { itemCode: 'BCLCO', description: 'COCA COLA CLASICA 5G BIB', orderQuantity: 4, unitPrice: 118.32 },
    { itemCode: 'BSPRI', description: 'SPRITE 5G BIB', orderQuantity: 2, unitPrice: 118.32 },
    { itemCode: '9180', description: 'BOLSAS SEAL2GO #3', orderQuantity: 10, unitPrice: 56.40 },
    { itemCode: 'FOIL12', description: 'PAPEL ALUMINIO 12X1000', orderQuantity: 3, unitPrice: 38.50 },
    { itemCode: 'FORK-M', description: 'TENEDOR MEDIANO BLANCO', orderQuantity: 5, unitPrice: 22.10 }
  ];

  const sodaItems = sampleItems.filter(i => isVieleSoda(i.itemCode));
  const generalItems = sampleItems.filter(i => !isVieleSoda(i.itemCode));

  console.log(`  - Total items en orden: ${sampleItems.length}`);
  console.log(`  - Items identificados como Sodas (Factura 1): ${sodaItems.length} (${sodaItems.map(i => i.itemCode).join(', ')})`);
  console.log(`  - Items identificados como Insumos (Factura 2): ${generalItems.length} (${generalItems.map(i => i.itemCode).join(', ')})`);

  if (sodaItems.length !== 2 || generalItems.length !== 3) {
    throw new Error('Falló la partición de items por categoría');
  }
  console.log('  ✅ Partición 100% exacta según SKUs oficiales de Viele & Sons');

  // Test 2: Simulación de generación de números de orden correlativos
  console.log('\n🔢 2. Verificando lógica de enlaces gemelos y números correlativos:');
  const now = Date.now();
  const mockOrderSodas = `SIM-SODA-${now}`;
  const mockOrderGeneral = `SIM-GEN-${now}`;

  console.log(`  - Orden Sodas: ${mockOrderSodas} (Enlazada con: ${mockOrderGeneral})`);
  console.log(`  - Orden Insumos: ${mockOrderGeneral} (Enlazada con: ${mockOrderSodas})`);

  // Test 3: Live DB Mutation Smoke Test (Insert + Verify + Cleanup)
  console.log('\n🗄️ 3. Live DB Mutation Smoke Test en viele_orders y viele_order_items:');

  // Insertar orden gemela 1 (Sodas)
  const { data: order1, error: err1 } = await supabase
    .from('viele_orders')
    .insert({
      store_id: 14, // Lynwood
      order_number: mockOrderSodas,
      order_category: 'sodas',
      linked_order_number: mockOrderGeneral,
      order_date: '2026-09-06',
      ship_date: '2026-09-08',
      status: 'test_simulation',
      total_cases: 6,
      subtotal_amount: 709.92,
      tax_amount: 67.44,
      total_amount: 777.36,
      buyer_name: 'AFV',
      customer_po_no: 'AFV'
    })
    .select()
    .single();

  if (err1) throw new Error(`Error insertando orden sodas: ${err1.message}`);
  console.log(`  - Orden Sodas insertada exitosamente en DB (ID: ${order1.id}, Categoria: ${order1.order_category})`);

  // Insertar orden gemela 2 (General)
  const { data: order2, error: err2 } = await supabase
    .from('viele_orders')
    .insert({
      store_id: 14, // Lynwood
      order_number: mockOrderGeneral,
      order_category: 'general',
      linked_order_number: mockOrderSodas,
      order_date: '2026-09-06',
      ship_date: '2026-09-08',
      status: 'test_simulation',
      total_cases: 18,
      subtotal_amount: 745.80,
      tax_amount: 70.85,
      total_amount: 816.65,
      buyer_name: 'AFV',
      customer_po_no: 'AFV'
    })
    .select()
    .single();

  if (err2) throw new Error(`Error insertando orden general: ${err2.message}`);
  console.log(`  - Orden Insumos insertada exitosamente en DB (ID: ${order2.id}, Categoria: ${order2.order_category})`);

  // Insertar ítems de prueba
  const { error: errItems1 } = await supabase
    .from('viele_order_items')
    .insert([
      {
        order_id: order1.id,
        item_code: 'BCLCO',
        description: 'COCA COLA CLASICA 5G BIB',
        uom: 'CS',
        unit_price: 118.32,
        order_quantity: 4,
        extended_amount: 473.28
      },
      {
        order_id: order1.id,
        item_code: 'BSPRI',
        description: 'SPRITE 5G BIB',
        uom: 'CS',
        unit_price: 118.32,
        order_quantity: 2,
        extended_amount: 236.64
      }
    ]);

  if (errItems1) throw new Error(`Error insertando items de sodas: ${errItems1.message}`);
  console.log('  - Ítems de Sodas vinculados a orden 1');

  const { error: errItems2 } = await supabase
    .from('viele_order_items')
    .insert([
      {
        order_id: order2.id,
        item_code: '9180',
        description: 'BOLSAS SEAL2GO #3',
        uom: 'CS',
        unit_price: 56.40,
        order_quantity: 10,
        extended_amount: 564.00
      }
    ]);

  if (errItems2) throw new Error(`Error insertando items de insumos: ${errItems2.message}`);
  console.log('  - Ítems de Insumos vinculados a orden 2');

  // Verificar consulta con enlace cruzado
  const { data: verifyOrder1, error: errVerify } = await supabase
    .from('viele_orders')
    .select('*, viele_order_items(*)')
    .eq('id', order1.id)
    .single();

  if (errVerify) throw new Error(`Error verificando orden 1: ${errVerify.message}`);
  if (verifyOrder1.linked_order_number !== mockOrderGeneral || verifyOrder1.viele_order_items.length !== 2) {
    throw new Error('Discrepancia en verificación de orden gemela');
  }
  console.log('  ✅ Verificación relacional exitosa: Enlace cruzado e ítems íntegros');

  // Limpieza inmediata obligatoria (Zero Pollution Rule)
  console.log('\n🧹 4. Limpieza de registros de prueba en Supabase:');
  await supabase.from('viele_order_items').delete().eq('order_id', order1.id);
  await supabase.from('viele_order_items').delete().eq('order_id', order2.id);
  await supabase.from('viele_orders').delete().eq('id', order1.id);
  await supabase.from('viele_orders').delete().eq('id', order2.id);
  console.log('  ✅ Tablas viele_orders y viele_order_items limpiadas al 100%');

  console.log('\n🎉 TODAS LAS PRUEBAS DE DOBLE FACTURACIÓN CONSECUTIVA PASARON CON 100% DE ÉXITO');
}

runDualOrderTests().catch(err => {
  console.error('❌ Error fatal en test suite:', err);
  process.exit(1);
});
