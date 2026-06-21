// Direct PostgreSQL DDL migration using pg module
const { Pool } = require('pg')
require('dotenv').config({ path: '.env.local' })

async function main() {
  // Supabase direct connection via pooler
  // Format: postgresql://postgres.[ref]:[db_password]@aws-0-[region].pooler.supabase.com:6543/postgres
  const projectRef = 'ywwwdcvgfculqmcfkihq'
  
  // Try known Supabase pooler connection formats
  // The service role JWT can be used as password for the pooler in session mode
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Try direct connection via supabase pooler using service role as password
  const connectionString = `postgresql://postgres.${projectRef}:${serviceKey}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`
  
  console.log('Connecting to Supabase PostgreSQL...')
  
  const pool = new Pool({ 
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  try {
    const client = await pool.connect()
    console.log('✅ Connected!')

    console.log('Creating table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_completions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        store_id TEXT NOT NULL,
        checklist_date DATE NOT NULL,
        shift_type TEXT NOT NULL,
        activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ DEFAULT NOW(),
        completed_by TEXT,
        completed_by_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(store_id, checklist_date, shift_type, activity_id)
      );
    `)
    console.log('✅ Table created')

    console.log('Creating index...')
    await client.query(`CREATE INDEX IF NOT EXISTS idx_checklist_date_store ON checklist_completions(store_id, checklist_date, shift_type);`)
    console.log('✅ Index created')

    console.log('Enabling RLS...')
    await client.query(`ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;`)
    console.log('✅ RLS enabled')

    console.log('Granting permissions...')
    await client.query(`GRANT ALL ON checklist_completions TO anon, authenticated, service_role;`)
    console.log('✅ Grants applied')

    console.log('Creating policy...')
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'checklist_all_access' AND tablename = 'checklist_completions') THEN
          CREATE POLICY "checklist_all_access" ON checklist_completions FOR ALL USING (true);
        END IF;
      END $$;
    `)
    console.log('✅ Policy created')

    console.log('Reloading schema cache...')
    await client.query(`NOTIFY pgrst, 'reload schema';`)
    console.log('✅ Schema cache notified')

    // Verify
    const { rows } = await client.query('SELECT count(*) as cnt FROM checklist_completions')
    console.log(`\n🎉 Table verified! Current rows: ${rows[0].cnt}`)

    client.release()
    await pool.end()
  } catch (err) {
    console.error('❌ Error:', err.message)
    
    // Try alternative port (6543 for transaction mode)
    console.log('\nTrying port 6543 (transaction mode)...')
    const pool2 = new Pool({ 
      connectionString: `postgresql://postgres.${projectRef}:${serviceKey}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    })
    
    try {
      const client2 = await pool2.connect()
      console.log('✅ Connected on port 6543!')
      
      await client2.query(`
        CREATE TABLE IF NOT EXISTS checklist_completions (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          store_id TEXT NOT NULL,
          checklist_date DATE NOT NULL,
          shift_type TEXT NOT NULL,
          activity_id UUID REFERENCES operating_procedures(id) ON DELETE CASCADE,
          completed_at TIMESTAMPTZ DEFAULT NOW(),
          completed_by TEXT,
          completed_by_name TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(store_id, checklist_date, shift_type, activity_id)
        );
      `)
      
      await client2.query(`CREATE INDEX IF NOT EXISTS idx_checklist_date_store ON checklist_completions(store_id, checklist_date, shift_type);`)
      await client2.query(`ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;`)
      await client2.query(`GRANT ALL ON checklist_completions TO anon, authenticated, service_role;`)
      await client2.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'checklist_all_access' AND tablename = 'checklist_completions') THEN
            CREATE POLICY "checklist_all_access" ON checklist_completions FOR ALL USING (true);
          END IF;
        END $$;
      `)
      await client2.query(`NOTIFY pgrst, 'reload schema';`)
      
      const { rows } = await client2.query('SELECT count(*) as cnt FROM checklist_completions')
      console.log(`🎉 Table verified! Current rows: ${rows[0].cnt}`)
      
      client2.release()
      await pool2.end()
    } catch (err2) {
      console.error('❌ Also failed on 6543:', err2.message)
      await pool2.end()
    }
    
    await pool.end()
  }
}

main()
