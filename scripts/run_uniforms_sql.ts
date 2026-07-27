import pg from 'pg'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const regions = [
  'us-west-1', 'us-west-2', 'us-east-1', 'us-east-2',
  'eu-central-1', 'eu-west-1', 'ap-southeast-1'
]

async function connectToDb(): Promise<pg.Client> {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`
    const client = new pg.Client({
      connectionString: `postgresql://postgres.ywwwdcvgfculqmcfkihq:100Prechivas.com@${host}:6543/postgres`,
      ssl: { rejectUnauthorized: false }
    })
    try {
      await client.connect()
      console.log(`✅ Conectado a PostgreSQL via ${region}`)
      return client
    } catch (e: any) {
      console.log(`❌ ${region}: ${e.message}`)
      try { await client.end() } catch {}
    }
  }
  throw new Error('No se pudo conectar a ninguna region')
}

async function run() {
  const client = await connectToDb()
  console.log('✅ Conectado a PostgreSQL')

  try {
    // Drop
    console.log('\n1. Eliminando tablas viejas...')
    await client.query('DROP TABLE IF EXISTS uniforms_transactions')
    await client.query('DROP TABLE IF EXISTS uniforms_inventory_stock')
    await client.query('DROP TABLE IF EXISTS uniforms_pricing')
    console.log('   ✅ Tablas eliminadas')

    // Create pricing
    console.log('\n2. Creando uniforms_pricing...')
    await client.query(`
      CREATE TABLE uniforms_pricing (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        item_category TEXT UNIQUE NOT NULL,
        display_name_es TEXT NOT NULL,
        display_name_en TEXT NOT NULL,
        sale_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
        is_free_for_roles TEXT[] DEFAULT '{}',
        provider_name TEXT,
        provider_cost NUMERIC(10, 2) DEFAULT 0,
        effective_from TIMESTAMPTZ DEFAULT now(),
        notes TEXT,
        updated_by TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `)
    console.log('   ✅ uniforms_pricing creada')

    // Seed
    console.log('\n3. Insertando datos de precios...')
    await client.query(`
      INSERT INTO uniforms_pricing (item_category, display_name_es, display_name_en, sale_price, is_free_for_roles)
      VALUES 
        ('shirt_red',    'Camisa Roja',    'Red Shirt',     7.00, '{}'),
        ('shirt_black',  'Camisa Negra',   'Black Shirt',   7.00, '{manager}'),
        ('cap_red',      'Gorra Roja',     'Red Cap',       1.00, '{}'),
        ('cap_black',    'Gorra Negra',    'Black Cap',     1.00, '{}'),
        ('jacket_red',   'Chamarra Roja',  'Red Jacket',   20.00, '{}'),
        ('jacket_black', 'Chamarra Negra', 'Black Jacket', 20.00, '{}')
    `)
    console.log('   ✅ 6 categorias insertadas')

    // Stock table
    console.log('\n4. Creando uniforms_inventory_stock...')
    await client.query(`
      CREATE TABLE uniforms_inventory_stock (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id INTEGER NOT NULL REFERENCES stores(id),
        item_category TEXT NOT NULL,
        size TEXT NOT NULL DEFAULT 'ONE_SIZE',
        quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
        min_stock NUMERIC DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(store_id, item_category, size)
      )
    `)
    console.log('   ✅ uniforms_inventory_stock creada')

    // Transactions table
    console.log('\n5. Creando uniforms_transactions...')
    await client.query(`
      CREATE TABLE uniforms_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        store_id INTEGER NOT NULL REFERENCES stores(id),
        item_category TEXT NOT NULL,
        size TEXT NOT NULL DEFAULT 'ONE_SIZE',
        transaction_type TEXT NOT NULL,
        quantity NUMERIC NOT NULL,
        previous_stock NUMERIC NOT NULL DEFAULT 0,
        new_stock NUMERIC NOT NULL DEFAULT 0,
        unit_price NUMERIC(10, 2),
        total_amount NUMERIC(10, 2),
        employee_toast_guid TEXT,
        employee_name TEXT,
        reason TEXT,
        reference_order_id UUID,
        business_date DATE NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)
    console.log('   ✅ uniforms_transactions creada')

    // Indexes
    console.log('\n6. Creando indices...')
    await client.query('CREATE INDEX idx_uniforms_stock_store ON uniforms_inventory_stock(store_id)')
    await client.query('CREATE INDEX idx_uniforms_tx_store_date ON uniforms_transactions(store_id, business_date)')
    await client.query('CREATE INDEX idx_uniforms_tx_employee ON uniforms_transactions(employee_toast_guid)')
    await client.query('CREATE INDEX idx_uniforms_tx_type ON uniforms_transactions(transaction_type)')
    console.log('   ✅ 4 indices creados')

    // RLS
    console.log('\n7. Habilitando RLS y politicas...')
    await client.query('ALTER TABLE uniforms_pricing ENABLE ROW LEVEL SECURITY')
    await client.query('ALTER TABLE uniforms_inventory_stock ENABLE ROW LEVEL SECURITY')
    await client.query('ALTER TABLE uniforms_transactions ENABLE ROW LEVEL SECURITY')
    await client.query(`CREATE POLICY "uniforms_pricing_all" ON uniforms_pricing FOR ALL USING (true) WITH CHECK (true)`)
    await client.query(`CREATE POLICY "uniforms_stock_all" ON uniforms_inventory_stock FOR ALL USING (true) WITH CHECK (true)`)
    await client.query(`CREATE POLICY "uniforms_tx_all" ON uniforms_transactions FOR ALL USING (true) WITH CHECK (true)`)
    console.log('   ✅ RLS habilitado con politicas permisivas')

    // Verify
    console.log('\n========== VERIFICACION ==========')
    const result = await client.query('SELECT item_category, sale_price FROM uniforms_pricing ORDER BY item_category')
    console.log(`uniforms_pricing: ${result.rows.length} filas`)
    result.rows.forEach((r: any) => console.log(`   ${r.item_category}: $${r.sale_price}`))

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE 'uniforms%'
      ORDER BY table_name
    `)
    console.log(`\nTablas creadas: ${tables.rows.map((r: any) => r.table_name).join(', ')}`)
    console.log('\n🎉 TODO LISTO!')

  } catch (err: any) {
    console.error('❌ Error:', err.message)
  } finally {
    await client.end()
  }
}

run()
