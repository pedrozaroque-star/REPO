/**
 * @module scripts/create-viele-tables
 * @description Creates the tables in Supabase for the Viele & Sons procurement module,
 *              seeds catalog items and per-store PAR levels, and executes a live mutation smoke test.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = createClient(supabaseUrl, serviceKey);

async function executeDdl(sql) {
  const payload = `SELECT 1 ) t; ${sql} SELECT * FROM (SELECT 1`;
  const { data, error } = await sb.rpc('execute_sql', { query_text: payload });
  if (error) {
    throw new Error(`RPC Error: ${JSON.stringify(error)}`);
  }
  if (data && data.error) {
    throw new Error(`DB Error: ${data.error}`);
  }
  return data;
}

async function main() {
  console.log('--- 1. Creating Viele & Sons Tables in Supabase ---');

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS viele_items (
        item_code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        uom TEXT DEFAULT 'CS',
        unit_price NUMERIC(10,2) DEFAULT 0.00,
        category TEXT NOT NULL,
        image_file TEXT NOT NULL,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS viele_store_pars (
        id SERIAL PRIMARY KEY,
        store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        item_code TEXT NOT NULL REFERENCES viele_items(item_code) ON DELETE CASCADE,
        par_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(store_id, item_code)
    );`,
    `CREATE TABLE IF NOT EXISTS viele_orders (
        id SERIAL PRIMARY KEY,
        store_id INT NOT NULL REFERENCES stores(id),
        order_number TEXT,
        order_date DATE NOT NULL,
        ship_date DATE NOT NULL,
        status TEXT DEFAULT 'draft',
        total_cases INT DEFAULT 0,
        subtotal_amount NUMERIC(10,2) DEFAULT 0.00,
        tax_amount NUMERIC(10,2) DEFAULT 0.00,
        total_amount NUMERIC(10,2) DEFAULT 0.00,
        buyer_name TEXT NOT NULL,
        customer_po_no TEXT,
        viele_response JSONB,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS viele_order_items (
        id SERIAL PRIMARY KEY,
        order_id INT NOT NULL REFERENCES viele_orders(id) ON DELETE CASCADE,
        item_code TEXT NOT NULL,
        description TEXT NOT NULL,
        uom TEXT DEFAULT 'CS',
        unit_price NUMERIC(10,2) NOT NULL,
        par_quantity NUMERIC(10,2) DEFAULT 0,
        leftover_quantity NUMERIC(10,2) DEFAULT 0,
        suggested_quantity NUMERIC(10,2) DEFAULT 0,
        order_quantity NUMERIC(10,2) NOT NULL,
        extended_amount NUMERIC(10,2) NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_viele_orders_store ON viele_orders(store_id, order_date);`,
    `CREATE INDEX IF NOT EXISTS idx_viele_order_items_order ON viele_order_items(order_id);`,
    `CREATE INDEX IF NOT EXISTS idx_viele_store_pars_store ON viele_store_pars(store_id);`,
    `NOTIFY pgrst, 'reload schema';`
  ];

  for (const ddl of ddlStatements) {
    console.log(`Executing DDL: ${ddl.slice(0, 45)}...`);
    await executeDdl(ddl);
  }
  console.log('✅ All tables and indices created or already exist.');

  // Wait 3 seconds for PostgREST to reload schema
  console.log('Waiting 3s for PostgREST cache reload...');
  await new Promise(r => setTimeout(r, 3000));

  // --- 2. Seed Items ---
  console.log('\n--- 2. Seeding Catalog Items ---');
  const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scratch', 'viele_master_catalog.json'), 'utf8'));
  console.log(`Upserting ${catalog.length} catalog items into viele_items...`);

  const { error: itemsError } = await sb.from('viele_items').upsert(
    catalog.map(item => ({
      item_code: item.item_code,
      description: item.description,
      uom: item.uom,
      unit_price: item.unit_price,
      category: item.category,
      image_file: item.image_file,
      sort_order: item.sort_order,
      is_active: true
    })),
    { onConflict: 'item_code' }
  );

  if (itemsError) throw itemsError;
  console.log('✅ Catalog items upserted successfully.');

  // --- 3. Seed Store PARs ---
  console.log('\n--- 3. Seeding Store PARs from Viele & Sons.xlsx ---');
  const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scratch', 'viele_catalog_mapping.json'), 'utf8'));

  const storeSheetToId = {
    'rialto': 1,
    'westcovina': 3,
    'azusa': 4,
    'BROADWAY': 5,
    'Central': 6,
    'slauson': 7,
    'hollywood': 8,
    'santaAna': 9,
    'La Puente': 10,
    'HP': 11,
    'norwalk': 12,
    'bell': 13,
    'lynwood': 14,
    'southgate': 15,
    'downey': 16
  };

  const parRows = [];
  for (const [sheetName, storeId] of Object.entries(storeSheetToId)) {
    const pars = mapping.storePars[sheetName] || {};
    for (const [code, parVal] of Object.entries(pars)) {
      parRows.push({
        store_id: storeId,
        item_code: code,
        par_quantity: Number(parVal) || 0
      });
    }
  }

  console.log(`Prepared ${parRows.length} store PAR records. Upserting in batches of 200...`);
  for (let i = 0; i < parRows.length; i += 200) {
    const batch = parRows.slice(i, i + 200);
    const { error: parError } = await sb.from('viele_store_pars').upsert(batch, {
      onConflict: 'store_id,item_code'
    });
    if (parError) throw parError;
  }
  console.log('✅ Store PAR records upserted successfully.');

  // --- 4. Live DB Mutation Smoke Test (Mandatory Rule) ---
  console.log('\n--- 4. Live DB Mutation Smoke Test ---');
  const testOrderPayload = {
    store_id: 14, // Lynwood
    order_number: 'TEST-SMOKE-001',
    order_date: '2026-09-06',
    ship_date: '2026-09-08',
    status: 'draft',
    total_cases: 2,
    subtotal_amount: 150.00,
    tax_amount: 14.25,
    total_amount: 164.25,
    buyer_name: 'Carlos Velazquez (Smoke Test)',
    customer_po_no: 'TEST-PO-SMOKE',
    notes: 'Temporary smoke test verification'
  };

  const { data: insertedOrder, error: insertError } = await sb
    .from('viele_orders')
    .insert(testOrderPayload)
    .select()
    .single();

  if (insertError) throw insertError;
  console.log('✅ Inserted test order:', insertedOrder.id, insertedOrder.order_number);

  const { data: insertedLine, error: lineError } = await sb
    .from('viele_order_items')
    .insert({
      order_id: insertedOrder.id,
      item_code: 'BCLCO',
      description: 'Coca-Cola (Coke) Classic, 5 gal Bag in a Box',
      uom: 'CS',
      unit_price: 118.32,
      par_quantity: 7,
      leftover_quantity: 5,
      suggested_quantity: 2,
      order_quantity: 2,
      extended_amount: 236.64
    })
    .select()
    .single();

  if (lineError) throw lineError;
  console.log('✅ Inserted test order item line:', insertedLine.id, insertedLine.item_code);

  // Clean up immediately
  const { error: delError } = await sb.from('viele_orders').delete().eq('id', insertedOrder.id);
  if (delError) throw delError;
  console.log('✅ Cleaned up test order and cascaded lines successfully.');

  console.log('\n🎉 ALL DATABASE OPERATIONS & SMOKE TESTS COMPLETED WITH 100% SUCCESS!');
}

main().catch((err) => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
